// API ระบบคิวตรวจ (/api/visits): หัวใจของขั้นตอนทำงานในคลินิก
// 1. พยาบาลบันทึกก่อนตรวจ -> คิว "รอตรวจ" (waiting)
// 2. แพทย์วินิจฉัยและสั่งยา (ตรวจแพ้ยา) -> "รอจ่ายยา" (ready)
// 3. พยาบาลจ่ายยาและตัดสต๊อก -> "เสร็จสิ้น" (completed)
// ยกเลิกได้ระหว่างขั้น 1-2 -> "ยกเลิก" (cancelled)
//
// หมายเหตุ: pool.query() / connection.query() คืนค่าเป็น [แถวข้อมูล, ข้อมูลคอลัมน์]
// จึงเขียน const [rows] = await ... เพื่อเอาเฉพาะแถวข้อมูล แล้วใช้ rows[0] เมื่อต้องการแถวแรก

const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const metrics = require('../public/js/patient-metrics');
const allergyCheck = require('../public/js/allergy-check');

const router = express.Router();

// ความยาวขั้นต่ำของเหตุผลเมื่อแพทย์ยืนยันสั่งยาที่ผู้ป่วยแพ้ และเหตุผลยกเลิกคิว
const MIN_OVERRIDE_REASON = 5;
const MIN_CANCEL_REASON = 3;

// สร้าง error ที่มีรหัส HTTP แนบไว้ เพื่อ throw ใน transaction แล้วส่งรหัสนั้นกลับใน catch
function makeError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ตรวจว่าเป็นเลข id ที่ถูกต้อง (จำนวนเต็มบวก)
function isValidId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}

// ส่ง error กลับไปที่หน้าเว็บ: ถ้าเป็น error ที่เราสร้างเอง (มี status) ส่งข้อความนั้น
// ถ้าเป็น error อื่นที่ไม่คาดคิด ส่งรหัส 500 พร้อมข้อความกลาง
function sendError(res, err, defaultMessage) {
  if (err.status) {
    res.status(err.status).json({ message: err.message });
  } else {
    res.status(500).json({ message: defaultMessage });
  }
}

// ทุก API ในไฟล์นี้ต้องเข้าสู่ระบบ และเป็นเจ้าของคลินิก แพทย์ หรือพยาบาล
router.use(authenticate, authorize('admin', 'doctor', 'nurse'));

// ---------------------------------------------------------------
// GET /api/visits - คิวที่แสดงในหน้าแพทย์และพยาบาล:
// คิวที่ยังรอ (รอตรวจ/รอจ่ายยา) ทั้งหมด + คิวที่เสร็จหรือยกเลิกเฉพาะวันนี้
// พร้อมข้อมูลผู้ป่วย ผลวินิจฉัย และรายการยาที่สั่ง
// ---------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const [visits] = await pool.query(`SELECT v.*, p.hn_code, p.prefix, p.first_name, p.last_name,
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
    for (const visit of visits) {
      visit.prescriptions = [];
      if (visit.medical_record_id) {
        const [items] = await pool.query(`SELECT pr.*, m.name, m.generic_name, m.drug_group, m.unit, m.stock_quantity, m.price_per_unit
          FROM prescriptions pr JOIN medicines m ON m.id = pr.medicine_id
          WHERE pr.medical_record_id = ? ORDER BY pr.medicine_id`, [visit.medical_record_id]);
        visit.prescriptions = items;
      }
    }

    res.json({ data: visits });
  } catch (err) {
    res.status(500).json({ message: 'โหลดคิวไม่สำเร็จ', error: err.message });
  }
});

// ---------------------------------------------------------------
// POST /api/visits - พยาบาลบันทึกอาการและสัญญาณชีพ แล้วส่งผู้ป่วยเข้าคิวรอตรวจ
// (ยังไม่มีผลวินิจฉัยของแพทย์ในขั้นนี้)
// ---------------------------------------------------------------
router.post('/', authorize('nurse'), async (req, res) => {
  const patientId = req.body.patient_id;
  const symptoms = req.body.symptoms;
  let vitalSigns = req.body.vital_signs;
  if (vitalSigns === undefined) {
    vitalSigns = {};
  }

  // ตรวจข้อมูลจำเป็น: ต้องเลือกผู้ป่วย และระบุอาการ
  if (!isValidId(patientId) || typeof symptoms !== 'string' || symptoms.trim() === '') {
    return res.status(400).json({ message: 'กรุณาเลือกผู้ป่วยและระบุอาการสำคัญ' });
  }

  // ตรวจสัญญาณชีพ แล้วคำนวณ BMI ที่เซิร์ฟเวอร์เสมอ ไม่เชื่อค่าที่หน้าเว็บส่งมา
  let intakeVitals;
  try {
    if (!vitalSigns || typeof vitalSigns !== 'object' || Array.isArray(vitalSigns)) {
      throw new Error('ข้อมูลก่อนตรวจไม่ถูกต้อง');
    }
    const weightKg = metrics.measurement(vitalSigns.weight_kg, 9999.99);
    const heightCm = metrics.measurement(vitalSigns.height_cm, 999.99);
    intakeVitals = Object.assign({}, vitalSigns);
    intakeVitals.weight_kg = weightKg;
    intakeVitals.height_cm = heightCm;
    intakeVitals.bmi = metrics.bmi(weightKg, heightCm);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // ตรวจว่ามีผู้ป่วยนี้อยู่จริงและยังใช้งานอยู่
    const [patientRows] = await connection.query('SELECT id FROM patients WHERE id = ? AND is_active = TRUE FOR UPDATE', [patientId]);
    if (patientRows.length === 0) {
      throw makeError(404, 'ไม่พบผู้ป่วย');
    }

    // กันผู้ป่วยคนเดียวมีคิวที่ยังรอซ้ำกันสองคิว
    const [openVisits] = await connection.query("SELECT id FROM clinic_visits WHERE patient_id = ? AND status IN ('waiting', 'ready')", [patientId]);
    if (openVisits.length > 0) {
      throw makeError(409, 'ผู้ป่วยรายนี้มีคิวที่ยังไม่เสร็จสิ้น');
    }

    const [result] = await connection.query(`INSERT INTO clinic_visits (patient_id, nurse_id, symptoms, vital_signs)
      VALUES (?, ?, ?, ?)`, [patientId, req.user.id, symptoms.trim(), JSON.stringify(intakeVitals)]);

    await connection.commit();
    res.status(201).json({ message: 'ส่งผู้ป่วยเข้าคิวตรวจแล้ว', visitId: result.insertId });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    sendError(res, err, 'บันทึกคิวไม่สำเร็จ');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ตรวจรายการยาที่แพทย์ส่งมา: ทุกรายการต้องมีรหัสยา จำนวนเต็มบวก และวิธีใช้ และห้ามเลือกยาซ้ำ
function isValidMedicineList(medicines) {
  if (!Array.isArray(medicines)) {
    return false;
  }
  const usedIds = [];
  for (const item of medicines) {
    if (!item || !isValidId(item.medicine_id) || !isValidId(item.quantity)) {
      return false;
    }
    if (typeof item.dosage_instructions !== 'string' || item.dosage_instructions.trim() === '') {
      return false;
    }
    const medicineId = Number(item.medicine_id);
    if (usedIds.includes(medicineId)) {
      return false; // เลือกยาซ้ำ
    }
    usedIds.push(medicineId);
  }
  return true;
}

// ---------------------------------------------------------------
// POST /api/visits/:id/treatment - แพทย์บันทึกผลวินิจฉัยและสั่งยา แล้วส่งต่อให้พยาบาลจ่ายยา
// ยังไม่ตัดสต๊อกตรงนี้ จะตัดตอนพยาบาลยืนยันจ่ายยา
// ---------------------------------------------------------------
router.post('/:id/treatment', authorize('admin', 'doctor'), async (req, res) => {
  const visitId = req.params.id;
  const diagnosis = req.body.diagnosis;
  let treatmentNotes = req.body.treatment_notes;
  if (treatmentNotes === undefined) {
    treatmentNotes = '';
  }
  let medicines = req.body.medicines;
  if (medicines === undefined) {
    medicines = [];
  }

  // ตรวจข้อมูล: ต้องมีผลวินิจฉัย และรายการยาต้องถูกต้อง
  if (!isValidId(visitId) || typeof diagnosis !== 'string' || diagnosis.trim() === '' || !isValidMedicineList(medicines)) {
    return res.status(400).json({ message: 'กรุณาระบุการวินิจฉัย และรายการยา จำนวนเต็มบวก วิธีใช้ให้ครบถ้วน โดยไม่เลือกยาซ้ำ' });
  }

  // เหตุผลที่แพทย์ยืนยันสั่งยาที่ผู้ป่วยแพ้ (ถ้ามี)
  let overrideReason = '';
  if (typeof req.body.allergy_override === 'string') {
    overrideReason = req.body.allergy_override.trim();
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // ล็อกแถวคิวไว้ กันแพทย์สองคนบันทึกคิวเดียวกันพร้อมกัน
    const [visitRows] = await connection.query('SELECT * FROM clinic_visits WHERE id = ? FOR UPDATE', [visitId]);
    const visit = visitRows[0];
    if (!visit) {
      throw makeError(404, 'ไม่พบคิวตรวจ');
    }
    if (visit.status !== 'waiting') {
      throw makeError(409, 'คิวนี้บันทึกการรักษาแล้ว');
    }

    // ตรวจยาที่สั่งกับประวัติแพ้ยา ถ้าพบต้องมีเหตุผลยืนยันจากแพทย์จึงบันทึกได้
    const [patientRows] = await connection.query('SELECT allergies FROM patients WHERE id = ?', [visit.patient_id]);
    const [catalog] = await connection.query('SELECT id, name, generic_name, drug_group FROM medicines WHERE is_active = TRUE');

    // หาข้อมูลยาแต่ละตัวที่สั่ง ถ้ามียาที่ไม่มีในคลังหรือปิดใช้งานแล้ว จะไม่ยอมบันทึก
    const orderedMedicines = [];
    for (const item of medicines) {
      let found = null;
      for (const medicine of catalog) {
        if (medicine.id === Number(item.medicine_id)) {
          found = medicine;
        }
      }
      if (!found) {
        throw makeError(400, 'ไม่พบยาที่เลือก');
      }
      orderedMedicines.push(found);
    }

    let allergies = null;
    if (patientRows[0]) {
      allergies = patientRows[0].allergies;
    }
    const conflicts = allergyCheck.conflicts(allergies, orderedMedicines, catalog);

    // พบยาที่แพ้แต่แพทย์ไม่ได้ระบุเหตุผล -> ยกเลิก transaction แล้วส่งรายการยาที่แพ้กลับไป (409)
    if (conflicts.length > 0 && overrideReason.length < MIN_OVERRIDE_REASON) {
      await connection.rollback();
      const names = [];
      for (const conflict of conflicts) {
        names.push(conflict.name);
      }
      return res.status(409).json({
        message: 'พบยาที่ผู้ป่วยอาจแพ้: ' + names.join(', ') + ' กรุณาเปลี่ยนยา หรือระบุเหตุผลที่ยืนยันสั่งยา',
        code: 'ALLERGY_CONFLICT',
        conflicts: conflicts,
      });
    }

    // สัญญาณชีพในคิวอาจเป็นข้อความ JSON อยู่แล้ว หรือเป็น object ก็ได้ ต้องเก็บเป็นข้อความ JSON
    let vitalSignsJson;
    if (typeof visit.vital_signs === 'string') {
      vitalSignsJson = visit.vital_signs;
    } else {
      vitalSignsJson = JSON.stringify(visit.vital_signs || {});
    }

    // เก็บเหตุผลยืนยันสั่งยาที่แพ้ เฉพาะเมื่อมียาที่แพ้จริง
    let savedOverride = null;
    if (conflicts.length > 0) {
      savedOverride = overrideReason;
    }

    // บันทึกประวัติการรักษา (คัดลอกอาการและสัญญาณชีพจากคิว)
    const [record] = await connection.query(`INSERT INTO medical_records
      (patient_id, doctor_id, symptoms, diagnosis, treatment_notes, vital_signs, allergy_override) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [visit.patient_id, req.user.id, visit.symptoms, diagnosis.trim(), treatmentNotes, vitalSignsJson, savedOverride]);

    // บันทึกรายการยาที่สั่ง
    for (const item of medicines) {
      await connection.query(`INSERT INTO prescriptions (medical_record_id, medicine_id, quantity, dosage_instructions)
        VALUES (?, ?, ?, ?)`, [record.insertId, item.medicine_id, item.quantity, item.dosage_instructions.trim()]);
    }

    // เปลี่ยนสถานะคิวเป็น "รอจ่ายยา"
    await connection.query("UPDATE clinic_visits SET status = 'ready', medical_record_id = ? WHERE id = ?", [record.insertId, visit.id]);

    await connection.commit();
    res.json({ message: 'บันทึกการรักษาแล้ว ส่งต่อให้พยาบาลจ่ายยา', recordId: record.insertId });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    sendError(res, err, 'บันทึกการรักษาไม่สำเร็จ');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ---------------------------------------------------------------
// POST /api/visits/:id/dispense - พยาบาลยืนยันจ่ายยา ตัดสต๊อก และปิดคิว
// ทั้งหมดอยู่ใน transaction เดียว ถ้ายาตัวใดไม่พอ จะยกเลิกการจ่ายทั้งรายการ
// ---------------------------------------------------------------
router.post('/:id/dispense', authorize('nurse'), async (req, res) => {
  const visitId = req.params.id;
  if (!isValidId(visitId)) {
    return res.status(400).json({ message: 'รหัสคิวไม่ถูกต้อง' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [visitRows] = await connection.query('SELECT * FROM clinic_visits WHERE id = ? FOR UPDATE', [visitId]);
    const visit = visitRows[0];
    if (!visit) {
      throw makeError(404, 'ไม่พบคิว');
    }
    if (visit.status !== 'ready') {
      throw makeError(409, 'คิวนี้ยังไม่พร้อมจ่ายยา หรือจ่ายยาแล้ว');
    }

    // ดึงรายการยาที่ต้องจ่าย (เรียงตามรหัสยา เพื่อให้ล็อกแถวตามลำดับเดียวกันเสมอ ลดโอกาส deadlock)
    const [items] = await connection.query('SELECT * FROM prescriptions WHERE medical_record_id = ? ORDER BY medicine_id', [visit.medical_record_id]);

    let medicineTotal = 0;
    for (const item of items) {
      // ล็อกแถวยาแล้วตรวจว่ายังใช้งานอยู่
      const [medicineRows] = await connection.query('SELECT * FROM medicines WHERE id = ? FOR UPDATE', [item.medicine_id]);
      const medicine = medicineRows[0];
      if (!medicine || !medicine.is_active) {
        let label = item.medicine_id;
        if (medicine) {
          label = medicine.name;
        }
        throw makeError(409, 'ยา ' + label + ' ไม่พร้อมจ่าย');
      }

      // ล็อตที่ยังไม่หมดอายุ เรียงแบบ FEFO (หมดอายุก่อนจ่ายก่อน) ยอดยกมาที่ไม่ทราบวันหมดอายุจ่ายก่อนสุด
      const [lots] = await connection.query(`SELECT id, quantity_remaining FROM medicine_lots
        WHERE medicine_id = ? AND quantity_remaining > 0 AND (expiry_date IS NULL OR expiry_date >= CURDATE())
        ORDER BY expiry_date IS NOT NULL, expiry_date, id FOR UPDATE`, [item.medicine_id]);

      // รวมจำนวนที่จ่ายได้จากทุกล็อต
      let available = 0;
      for (const lot of lots) {
        available = available + lot.quantity_remaining;
      }
      if (available < item.quantity) {
        const message = 'ยา ' + medicine.name + ' มีสต๊อกที่ยังไม่หมดอายุไม่เพียงพอ (เหลือ ' + available + ' ' + (medicine.unit || '') + ')';
        throw makeError(409, message.trim());
      }

      // ตัดจากล็อตตามลำดับจนครบ บันทึกประวัติการจ่ายออก (out) แยกตามล็อต อ้างอิงเลขใบสั่งยา
      let remaining = item.quantity;
      for (const lot of lots) {
        if (remaining === 0) {
          break;
        }
        let take = lot.quantity_remaining;
        if (remaining < take) {
          take = remaining;
        }
        await connection.query('UPDATE medicine_lots SET quantity_remaining = quantity_remaining - ? WHERE id = ?', [take, lot.id]);
        await connection.query(`INSERT INTO stock_transactions (medicine_id, change_type, quantity, reason, reference_id, lot_id, created_by)
          VALUES (?, 'out', ?, ?, ?, ?, ?)`, [item.medicine_id, -take, 'จ่ายตามใบสั่งยา #' + item.id, item.id, lot.id, req.user.id]);
        remaining = remaining - take;
      }

      // ลดสต๊อกรวมของยา
      await connection.query('UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ?', [item.quantity, item.medicine_id]);

      // บันทึกราคาต่อหน่วย ณ เวลาที่จ่าย ถ้าภายหลังเปลี่ยนราคายา ประวัติเดิมยังแสดงราคาที่จ่ายจริง
      const unitPrice = Number(medicine.price_per_unit || 0);
      await connection.query('UPDATE prescriptions SET unit_price = ? WHERE id = ?', [unitPrice, item.id]);
      medicineTotal = medicineTotal + unitPrice * item.quantity;
    }

    // ปิดคิว พร้อมบันทึกผู้จ่ายยา เวลา และค่ายารวม (ปัดทศนิยม 2 ตำแหน่ง)
    const roundedTotal = Math.round(medicineTotal * 100) / 100;
    await connection.query("UPDATE clinic_visits SET status = 'completed', dispensed_by = ?, dispensed_at = NOW(), medicine_total = ? WHERE id = ?",
      [req.user.id, roundedTotal, visit.id]);

    await connection.commit();
    if (items.length > 0) {
      res.json({ message: 'ยืนยันจ่ายยาและตัดสต๊อกเรียบร้อย' });
    } else {
      res.json({ message: 'ปิดคิวเรียบร้อย (ไม่มีรายการยา)' });
    }
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    sendError(res, err, 'จ่ายยาไม่สำเร็จ');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ---------------------------------------------------------------
// POST /api/visits/:id/cancel - ยกเลิกคิว เช่น ผู้ป่วยกลับก่อนตรวจ ลงทะเบียนผิด หรือไม่รับยา
// ยกเลิกได้เฉพาะคิวที่ยังไม่จ่ายยา ไม่ตัดสต๊อก และไม่ลบประวัติการรักษาที่แพทย์บันทึกไว้แล้ว
// ---------------------------------------------------------------
router.post('/:id/cancel', async (req, res) => {
  const visitId = req.params.id;
  let reason = '';
  if (typeof req.body.reason === 'string') {
    reason = req.body.reason.trim();
  }

  if (!isValidId(visitId)) {
    return res.status(400).json({ message: 'รหัสคิวไม่ถูกต้อง' });
  }
  if (reason.length < MIN_CANCEL_REASON || reason.length > 255) {
    return res.status(400).json({ message: 'กรุณาระบุเหตุผลที่ยกเลิกคิว (3–255 ตัวอักษร)' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [visitRows] = await connection.query('SELECT * FROM clinic_visits WHERE id = ? FOR UPDATE', [visitId]);
    const visit = visitRows[0];
    if (!visit) {
      throw makeError(404, 'ไม่พบคิว');
    }
    // ยกเลิกได้เฉพาะคิวที่ยังไม่จ่ายยา
    if (visit.status !== 'waiting' && visit.status !== 'ready') {
      throw makeError(409, 'คิวนี้จ่ายยาหรือยกเลิกไปแล้ว ยกเลิกซ้ำไม่ได้');
    }

    await connection.query(`UPDATE clinic_visits SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW(), cancel_reason = ?
      WHERE id = ?`, [req.user.id, reason, visit.id]);

    await connection.commit();
    res.json({ message: 'ยกเลิกคิวแล้ว' });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    sendError(res, err, 'ยกเลิกคิวไม่สำเร็จ');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

module.exports = router;
