const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();
const failure = (status, message) => Object.assign(new Error(message), { status });
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const metrics = require('../public/js/patient-metrics');
const allergyCheck = require('../public/js/allergy-check');
const MIN_OVERRIDE_REASON = 5;

router.use(authenticate, authorize('admin', 'doctor', 'nurse'));

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT v.*, p.hn_code, p.prefix, p.first_name, p.last_name,
      p.date_of_birth, p.gender, p.blood_type, p.phone, p.address,
      p.allergies, p.underlying_conditions, mr.diagnosis, mr.treatment_notes, mr.allergy_override, u.full_name AS doctor_name
      FROM clinic_visits v JOIN patients p ON p.id = v.patient_id
      LEFT JOIN medical_records mr ON mr.id = v.medical_record_id
      LEFT JOIN users u ON u.id = mr.doctor_id
      WHERE v.status != 'completed' OR DATE(v.dispensed_at) = CURDATE()
      ORDER BY v.created_at ASC`);
    for (const visit of rows) {
      visit.prescriptions = [];
      if (visit.medical_record_id) {
        const [items] = await pool.query(`SELECT pr.*, m.name, m.generic_name, m.drug_group, m.unit, m.stock_quantity
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
    intakeVitals = {...vital_signs, weight_kg, height_cm, bmi: metrics.bmi(weight_kg, height_cm)};
  } catch (err) { return res.status(400).json({message:err.message}); }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[patient]] = await connection.query('SELECT id FROM patients WHERE id = ? AND is_active = TRUE FOR UPDATE', [patient_id]);
    if (!patient) throw failure(404, 'ไม่พบผู้ป่วย');
    const [open] = await connection.query("SELECT id FROM clinic_visits WHERE patient_id = ? AND status != 'completed'", [patient_id]);
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

router.post('/:id/treatment', authorize('admin', 'doctor'), async (req, res) => {
  const { diagnosis, treatment_notes = '', medicines = [], allergy_override } = req.body;
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
    const [[visit]] = await connection.query('SELECT * FROM clinic_visits WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!visit) throw failure(404, 'ไม่พบคิวตรวจ');
    if (visit.status !== 'waiting') throw failure(409, 'คิวนี้บันทึกการรักษาแล้ว');

    // ตรวจยาที่สั่งกับประวัติแพ้ยา ถ้าพบต้องมีเหตุผลยืนยันจากแพทย์จึงบันทึกได้
    const [[patient]] = await connection.query('SELECT allergies FROM patients WHERE id = ?', [visit.patient_id]);
    const [catalog] = await connection.query('SELECT id, name, generic_name, drug_group FROM medicines WHERE is_active = TRUE');
    const ordered = medicines.map(item => catalog.find(m => m.id === Number(item.medicine_id)));
    if (ordered.some(medicine => !medicine)) throw failure(400, 'ไม่พบยาที่เลือก');
    const conflicts = allergyCheck.conflicts(patient && patient.allergies, ordered, catalog);
    const overrideReason = typeof allergy_override === 'string' ? allergy_override.trim() : '';
    if (conflicts.length && overrideReason.length < MIN_OVERRIDE_REASON) {
      await connection.rollback();
      return res.status(409).json({
        message: `พบยาที่ผู้ป่วยอาจแพ้: ${conflicts.map(c => c.name).join(', ')} กรุณาเปลี่ยนยา หรือระบุเหตุผลที่ยืนยันสั่งยา`,
        code: 'ALLERGY_CONFLICT', conflicts,
      });
    }

    const [record] = await connection.query(`INSERT INTO medical_records
      (patient_id, doctor_id, symptoms, diagnosis, treatment_notes, vital_signs, allergy_override) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [visit.patient_id, req.user.id, visit.symptoms, diagnosis.trim(), treatment_notes, typeof visit.vital_signs === 'string' ? visit.vital_signs : JSON.stringify(visit.vital_signs || {}),
      conflicts.length ? overrideReason : null]);
    for (const item of medicines) {
      await connection.query(`INSERT INTO prescriptions (medical_record_id, medicine_id, quantity, dosage_instructions)
        VALUES (?, ?, ?, ?)`, [record.insertId, item.medicine_id, item.quantity, item.dosage_instructions.trim()]);
    }
    await connection.query("UPDATE clinic_visits SET status = 'ready', medical_record_id = ? WHERE id = ?", [record.insertId, visit.id]);
    await connection.commit();
    res.json({ message: 'บันทึกการรักษาแล้ว ส่งต่อให้พยาบาลจ่ายยา', recordId: record.insertId });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(err.status || 500).json({ message: err.status ? err.message : 'บันทึกการรักษาไม่สำเร็จ' });
  } finally { if (connection) connection.release(); }
});

router.post('/:id/dispense', authorize('nurse'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'รหัสคิวไม่ถูกต้อง' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[visit]] = await connection.query('SELECT * FROM clinic_visits WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!visit) throw failure(404, 'ไม่พบคิว');
    if (visit.status !== 'ready') throw failure(409, 'คิวนี้ยังไม่พร้อมจ่ายยา หรือจ่ายยาแล้ว');
    const [items] = await connection.query('SELECT * FROM prescriptions WHERE medical_record_id = ? ORDER BY medicine_id', [visit.medical_record_id]);
    for (const item of items) {
      const [[medicine]] = await connection.query('SELECT * FROM medicines WHERE id = ? FOR UPDATE', [item.medicine_id]);
      if (!medicine || !medicine.is_active || medicine.stock_quantity < item.quantity) {
        throw failure(409, `ยา ${medicine ? medicine.name : item.medicine_id} ไม่พร้อมจ่ายหรือมีสต๊อกไม่เพียงพอ`);
      }
      await connection.query('UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ?', [item.quantity, item.medicine_id]);
      await connection.query(`INSERT INTO stock_transactions (medicine_id, change_type, quantity, reason, reference_id, created_by)
        VALUES (?, 'out', ?, ?, ?, ?)`, [item.medicine_id, -item.quantity, `จ่ายตามใบสั่งยา #${item.id}`, item.id, req.user.id]);
    }
    await connection.query("UPDATE clinic_visits SET status = 'completed', dispensed_by = ?, dispensed_at = NOW() WHERE id = ?", [req.user.id, visit.id]);
    await connection.commit();
    res.json({ message: items.length ? 'ยืนยันจ่ายยาและตัดสต๊อกเรียบร้อย' : 'ปิดคิวเรียบร้อย (ไม่มีรายการยา)' });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(err.status || 500).json({ message: err.status ? err.message : 'จ่ายยาไม่สำเร็จ' });
  } finally { if (connection) connection.release(); }
});
module.exports = router;
