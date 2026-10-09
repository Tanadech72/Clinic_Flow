const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/records/patient/:patientId - ดูประวัติการรักษาทั้งหมดของผู้ป่วยรายหนึ่ง
router.get('/patient/:patientId', authenticate, async (req, res) => {
  try {
    const [records] = await pool.query(
      `SELECT mr.*, u.full_name AS doctor_name
       FROM medical_records mr
       LEFT JOIN users u ON mr.doctor_id = u.id
       WHERE mr.patient_id = ?
       ORDER BY mr.visit_date DESC`,
      [req.params.patientId]
    );

    // ดึงรายการยาที่จ่ายในแต่ละครั้ง
    for (const record of records) {
      const [meds] = await pool.query(
        `SELECT p.quantity, p.dosage_instructions, m.name AS medicine_name, m.unit
         FROM prescriptions p
         JOIN medicines m ON p.medicine_id = m.id
         WHERE p.medical_record_id = ?`,
        [record.id]
      );
      record.prescriptions = meds;
    }

    res.json({ data: records });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// Treatment uses /api/visits/:id/treatment.
module.exports = router;
