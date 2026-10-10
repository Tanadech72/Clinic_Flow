// API ระบบคิวตรวจ (/api/visits): หัวใจของขั้นตอนทำงานในคลินิก
// 1. พยาบาลบันทึกก่อนตรวจ -> คิว "รอตรวจ" (waiting)
// 2. แพทย์วินิจฉัยและสั่งยา (ตรวจแพ้ยา) -> "รอจ่ายยา" (ready)
// 3. พยาบาลจ่ายยาและตัดสต๊อก -> "เสร็จสิ้น" (completed)
// ยกเลิกได้ระหว่างขั้น 1-2 -> "ยกเลิก" (cancelled)

const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();
// สร้าง error ที่มีรหัส HTTP แนบไว้ เพื่อ throw ใน transaction แล้วส่งรหัสนั้นกลับใน catch
const failure = (status, message) => Object.assign(new Error(message), { status });
// ตรวจว่าเป็นเลข id ที่ถูกต้อง (จำนวนเต็มบวก)
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const metrics = require('../public/js/patient-metrics');
const allergyCheck = require('../public/js/allergy-check');
// ความยาวขั้นต่ำของเหตุผลเมื่อแพทย์ยืนยันสั่งยาที่ผู้ป่วยแพ้ และเหตุผลยกเลิกคิว
const MIN_OVERRIDE_REASON = 5;
const MIN_CANCEL_REASON = 3;

// ทุก API ในไฟล์นี้ต้องเข้าสู่ระบบ และเป็นเจ้าของคลินิก แพทย์ หรือพยาบาล
router.use(authenticate, authorize('admin', 'doctor', 'nurse'));

// GET /api/visits - คิวที่แสดงในหน้าแพทย์และพยาบาล:
// คิวที่ยังรอ (รอตรวจ/รอจ่ายยา) ทั้งหมด + คิวที่เสร็จหรือยกเลิกเฉพาะวันนี้
// พร้อมข้อมูลผู้ป่วย ผลวินิจฉัย และรายการยาที่สั่ง
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT v.*, p.hn_code, p.prefix, p.first_name, p.last_name,
      p.date_of_birth, p.gender, p.blood_type, p.phone, p.address,
      p.allergies, p.underlying_conditions, mr.diagnosis, mr.treatment_notes, mr.allergy_override, u.full_name AS doctor_name, uc.full_name AS cancelled_by_name
      FROM clinic_visits v JOIN patients p ON p.id = v.patient_id
      LEFT JOIN medical_records mr ON mr.id = v.medical_record_id
      LEFT JOIN users u ON u.id = mr.doctor_id
      LEFT JOIN users uc ON uc.id = v.cancelled_by
      WHERE v.status IN ('waiting', 'ready')
        OR (v.status = 'completed' AND DATE(v.dispensed_at) = CURDATE())
        OR (v.status = 'cancelled' AND DATE(v.cancelled_at) = CURDATE())
      ORDER BY v.created_at ASC`);
    // แนบรายการยาที่แพทย์สั่ง (รวมชื่อสามัญ/กลุ่มยา ใช้ไฮไลต์ยาที่แพ้ในหน้าพยาบาล)
    for (const visit of rows) {
      visit.prescriptions = [];
      if (visit.medical_record_id) {
        const [items] = await pool.query(`SELECT pr.*, m.name, m.generic_name, m.drug_group, m.unit, m.stock_quantity, m.price_per_unit
          FROM prescriptions pr JOIN medicines m ON m.id = pr.medicine_id
          WHERE pr.medical_record_id = ? ORDER BY pr.medicine_id`, [visit.medical_record_id]);
        visit.prescriptions = items;
      }
    }
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: 'โหลดคิวไม่สำเร็จ', error: err.message });
  }
});

// Nursing intake creates a visit, without creating a doctor's diagnosis.
// POST /api/visits - พยาบาลบันทึกอาการและสัญญาณชีพ แล้วส่งผู้ป่วยเข้าคิวรอตรวจ
router.post('/', authorize('nurse'), async (req, res) => {
  const { patient_id, symptoms, vital_signs = {} } = req.body;
  if (!validId(patient_id) || typeof symptoms !== 'string' || !symptoms.trim()) {
    return res.status(400).json({ message: 'กรุณาเลือกผู้ป่วยและระบุอาการสำคัญ' });
  }
  let intakeVitals;
  try {
    if (!vital_signs || typeof vital_signs !== 'object' || Array.isArray(vital_signs)) {
      throw Error('ข้อมูลก่อนตรวจไม่ถูกต้อง');
    }
    const weight_kg = metrics.measurement(vital_signs.weight_kg, 9999.99);
    const height_cm = metrics.measurement(vital_signs.height_cm, 999.99);
    // คำนวณ BMI ที่เซิร์ฟเวอร์เสมอ ไม่เชื่อค่าที่หน้าเว็บส่งมา
    intakeVitals = {...vital_signs, weight_kg, height_cm, bmi: metrics.bmi(weight_kg, height_cm)};
  } catch (err) { return res.status(400).json({message:err.message}); }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[patient]] = await connection.query('SELECT id FROM patients WHERE id = ? AND is_active = TRUE FOR UPDATE', [patient_id]);
    if (!patient) throw failure(404, 'ไม่พบผู้ป่วย');
    // กันผู้ป่วยคนเดียวมีคิวที่ยังรอซ้ำกันสองคิว
    const [open] = await connection.query("SELECT id FROM clinic_visits WHERE patient_id = ? AND status IN ('waiting', 'ready')", [patient_id]);
    if (open.length) throw failure(409, 'ผู้ป่วยรายนี้มีคิวที่ยังไม่เสร็จสิ้น');
    const [result] = await connection.query(`INSERT INTO clinic_visits (patient_id, nurse_id, symptoms, vital_signs)
      VALUES (?, ?, ?, ?)`, [patient_id, req.user.id, symptoms.trim(), JSON.stringify(intakeVitals)]);
    await connection.commit();
    res.status(201).json({ message: 'ส่งผู้ป่วยเข้าคิวตรวจแล้ว', visitId: result.insertId });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(err.status || 500).json({ message: err.status ? err.message : 'บันทึกคิวไม่สำเร็จ' });
  } finally { if (connection) connection.release(); }
});

// POST /api/visits/:id/treatment - แพทย์บันทึกผลวินิจฉัยและสั่งยา แล้วส่งต่อให้พยาบาลจ่ายยา
// ยังไม่ตัดสต๊อกตรงนี้ จะตัดตอนพยาบาลยืนยันจ่ายยา
router.post('/:id/treatment', authorize('admin', 'doctor'), async (req, res) => {
  const { diagnosis, treatment_notes = '', medicines = [], allergy_override } = req.body;
  // ตรวจข้อมูล: ต้องมีผลวินิจฉัย ยาแต่ละรายการต้องมีจำนวนเป็นจำนวนเต็มบวกและวิธีใช้ และห้ามเลือกยาซ้ำ
  if (!validId(req.params.id) || typeof diagnosis !== 'string' || !diagnosis.trim() || !Array.isArray(medicines)
      || medicines.some(item => !item || !validId(item.medicine_id) || !validId(item.quantity)
        || typeof item.dosage_instructions !== 'string' || !item.dosage_instructions.trim())
      || new Set(medicines.map(item => Number(item.medicine_id))).size !== medicines.length) {
    return res.status(400).json({ message: 'กรุณาระบุการวินิจฉัย และรายการยา จำนวนเต็มบวก วิธีใช้ให้ครบถ้วน โดยไม่เลือกยาซ้ำ' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    // ล็อกแถวคิวไว้ กันแพทย์สองคนบันทึกคิวเดียวกันพร้อมกัน
    const [[visit]] = await connection.query('SELECT * FROM clinic_visits WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!visit) throw failure(404, 'ไม่พบคิวตรวจ');
    if (visit.status !== 'waiting') throw failure(409, 'คิวนี้บันทึกการรักษาแล้ว');

    // ตรวจยาที่สั่งกับประวัติแพ้ยา ถ้าพบต้องมีเหตุผลยืนยันจากแพทย์จึงบันทึกได้
    const [[patient]] = await connection.query('SELECT allergies FROM patients WHERE id = ?', [visit.patient_id]);
    const [catalog] = await connection.query('SELECT id, name, generic_name, drug_group FROM medicines WHERE is_active = TRUE');
    // หาข้อมูลยาแต่ละตัวที่สั่ง ถ้ามียาที่ไม่มีในคลังหรือปิดใช้งานแล้ว จะไม่ยอมบันทึก
    const ordered = medicines.map(item => catalog.find(m => m.id === Number(item.medicine_id)));
    if (ordered.some(medicine => !medicine)) throw failure(400, 'ไม่พบยาที่เลือก');
    const conflicts = allergyCheck.conflicts(patient && patient.allergies, ordered, catalog);
    const overrideReason = typeof allergy_override === 'string' ? allergy_override.trim() : '';
    // พบยาที่แพ้แต่แพทย์ไม่ได้ระบุเหตุผล -> ยกเลิก transaction แล้วส่งรายการยาที่แพ้กลับไป (409)
    if (conflicts.length && overrideReason.length < MIN_OVERRIDE_REASON) {
      await connection.rollback();
      return res.status(409).json({
        message: `พบยาที่ผู้ป่วยอาจแพ้: ${conflicts.map(c => c.name).join(', ')} กรุณาเปลี่ยนยา หรือระบุเหตุผลที่ยืนยันสั่งยา`,
        code: 'ALLERGY_CONFLICT', conflicts,
      });
    }

    // บันทึกประวัติการรักษา (คัดลอกอาการและสัญญาณชีพจากคิว) และเก็บเหตุผลยืนยันสั่งยาที่แพ้ ถ้ามี
    const [record] = await connection.query(`INSERT INTO medical_records
      (patient_id, doctor_id, symptoms, diagnosis, treatment_notes, vital_signs, allergy_override) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [visit.patient_id, req.user.id, visit.symptoms, diagnosis.trim(), treatment_notes, typeof visit.vital_signs === 'string' ? visit.vital_signs : JSON.stringify(visit.vital_signs || {}),
      conflicts.length ? overrideReason : null]);
    for (const item of medicines) {
      await connection.query(`INSERT INTO prescriptions (medical_record_id, medicine_id, quantity, dosage_instructions)
        VALUES (?, ?, ?, ?)`, [record.insertId, item.medicine_id, item.quantity, item.dosage_instructions.trim()]);
    }
    // เปลี่ยนสถานะคิวเป็น "รอจ่ายยา"
    await connection.query("UPDATE clinic_visits SET status = 'ready', medical_record_id = ? WHERE id = ?", [record.insertId, visit.id]);
    await connection.commit();
    res.json({ message: 'บันทึกการรักษาแล้ว ส่งต่อให้พยาบาลจ่ายยา', recordId: record.insertId });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(err.status || 500).json({ message: err.status ? err.message : 'บันทึกการรักษาไม่สำเร็จ' });
  } finally { if (connection) connection.release(); }
});

// POST /api/visits/:id/dispense - พยาบาลยืนยันจ่ายยา ตัดสต๊อก และปิดคิว
// ทั้งหมดอยู่ใน transaction เดียว ถ้ายาตัวใดไม่พอ จะยกเลิกการจ่ายทั้งรายการ
router.post('/:id/dispense', authorize('nurse'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'รหัสคิวไม่ถูกต้อง' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[visit]] = await connection.query('SELECT * FROM clinic_visits WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!visit) throw failure(404, 'ไม่พบคิว');
    if (visit.status !== 'ready') throw failure(409, 'คิวนี้ยังไม่พร้อมจ่ายยา หรือจ่ายยาแล้ว');
    // ดึงรายการยาที่ต้องจ่าย (เรียงตามรหัสยา เพื่อให้ล็อกแถวตามลำดับเดียวกันเสมอ ลดโอกาส deadlock)
    const [items] = await connection.query('SELECT * FROM prescriptions WHERE medical_record_id = ? ORDER BY medicine_id', [visit.medical_record_id]);
    let medicineTotal = 0;
    for (const item of items) {
      // ล็อกแถวยาแล้วตรวจว่ายังใช้งานอยู่
      const [[medicine]] = await connection.query('SELECT * FROM medicines WHERE id = ? FOR UPDATE', [item.medicine_id]);
      if (!medicine || !medicine.is_active) throw failure(409, `ยา ${medicine ? medicine.name : item.medicine_id} ไม่พร้อมจ่าย`);
      // ล็อตที่ยังไม่หมดอายุ เรียงแบบ FEFO (หมดอายุก่อนจ่ายก่อน) ยอดยกมาที่ไม่ทราบวันหมดอายุจ่ายก่อนสุด
      const [lots] = await connection.query(`SELECT id, quantity_remaining FROM medicine_lots
        WHERE medicine_id = ? AND quantity_remaining > 0 AND (expiry_date IS NULL OR expiry_date >= CURDATE())
        ORDER BY expiry_date IS NOT NULL, expiry_date, id FOR UPDATE`, [item.medicine_id]);
      const available = lots.reduce((sum, lot) => sum + lot.quantity_remaining, 0);
      if (available < item.quantity) {
        throw failure(409, `ยา ${medicine.name} มีสต๊อกที่ยังไม่หมดอายุไม่เพียงพอ (เหลือ ${available} ${medicine.unit || ''})`.trim());
      }
      // ตัดจากล็อตตามลำดับจนครบ บันทึกประวัติการจ่ายออก (out) แยกตามล็อต อ้างอิงเลขใบสั่งยา
      let remaining = item.quantity;
      for (const lot of lots) {
        if (remaining === 0) break;
        const take = Math.min(remaining, lot.quantity_remaining);
        await connection.query('UPDATE medicine_lots SET quantity_remaining = quantity_remaining - ? WHERE id = ?', [take, lot.id]);
        await connection.query(`INSERT INTO stock_transactions (medicine_id, change_type, quantity, reason, reference_id, lot_id, created_by)
          VALUES (?, 'out', ?, ?, ?, ?, ?)`, [item.medicine_id, -take, `จ่ายตามใบสั่งยา #${item.id}`, item.id, lot.id, req.user.id]);
        remaining -= take;
      }
      await connection.query('UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ?', [item.quantity, item.medicine_id]);
      // บันทึกราคาต่อหน่วย ณ เวลาที่จ่าย ถ้าภายหลังเปลี่ยนราคายา ประวัติเดิมยังแสดงราคาที่จ่ายจริง
      const unitPrice = Number(medicine.price_per_unit || 0);
      await connection.query('UPDATE prescriptions SET unit_price = ? WHERE id = ?', [unitPrice, item.id]);
      medicineTotal += unitPrice * item.quantity;
    }
    // ปิดคิว พร้อมบันทึกผู้จ่ายยา เวลา และค่ายารวม (ปัดทศนิยม 2 ตำแหน่ง)
    await connection.query("UPDATE clinic_visits SET status = 'completed', dispensed_by = ?, dispensed_at = NOW(), medicine_total = ? WHERE id = ?",
      [req.user.id, Math.round(medicineTotal * 100) / 100, visit.id]);
    await connection.commit();
    res.json({ message: items.length ? 'ยืนยันจ่ายยาและตัดสต๊อกเรียบร้อย' : 'ปิดคิวเรียบร้อย (ไม่มีรายการยา)' });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(err.status || 500).json({ message: err.status ? err.message : 'จ่ายยาไม่สำเร็จ' });
  } finally { if (connection) connection.release(); }
});
// ยกเลิกคิว เช่น ผู้ป่วยกลับก่อนตรวจ ลงทะเบียนผิด หรือไม่รับยา
// ยกเลิกได้เฉพาะคิวที่ยังไม่จ่ายยา ไม่ตัดสต๊อก และไม่ลบประวัติการรักษาที่แพทย์บันทึกไว้แล้ว
// POST /api/visits/:id/cancel - ยกเลิกคิว
router.post('/:id/cancel', async (req, res) => {
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!validId(req.params.id)) return res.status(400).json({ message: 'รหัสคิวไม่ถูกต้อง' });
  if (reason.length < MIN_CANCEL_REASON || reason.length > 255) {
    return res.status(400).json({ message: 'กรุณาระบุเหตุผลที่ยกเลิกคิว (3–255 ตัวอักษร)' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[visit]] = await connection.query('SELECT * FROM clinic_visits WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!visit) throw failure(404, 'ไม่พบคิว');
    // ยกเลิกได้เฉพาะคิวที่ยังไม่จ่ายยา
    if (!['waiting', 'ready'].includes(visit.status)) throw failure(409, 'คิวนี้จ่ายยาหรือยกเลิกไปแล้ว ยกเลิกซ้ำไม่ได้');
    await connection.query(`UPDATE clinic_visits SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW(), cancel_reason = ?
      WHERE id = ?`, [req.user.id, reason, visit.id]);
    await connection.commit();
    res.json({ message: 'ยกเลิกคิวแล้ว' });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(err.status || 500).json({ message: err.status ? err.message : 'ยกเลิกคิวไม่สำเร็จ' });
  } finally { if (connection) connection.release(); }
});
module.exports = router;
