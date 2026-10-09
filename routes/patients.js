const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const metrics = require('../public/js/patient-metrics');
const withMetrics = patient => {
  const { weight_kg, height_cm, bmi, ...data } = patient;
  return {...data, age: metrics.age(patient.date_of_birth)};
};
function validateMeasurements(req, res, next) {
  try {
    if (req.body.date_of_birth && metrics.age(req.body.date_of_birth) === null) {
      throw Error('วันเกิดไม่ถูกต้อง หรือตรงกับวันที่ในอนาคต');
    }
    next();
  } catch (err) { res.status(400).json({message: err.message}); }
}

const router = express.Router();

// GET /api/patients - ดึงรายชื่อผู้ป่วยทั้งหมด (รองรับค้นหาและแบ่งหน้า)
// query params: search, page, limit
router.get('/', authenticate, async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const searchTerm = `%${search}%`;
    const [rows] = await pool.query(
      `SELECT id, hn_code, national_id, prefix, first_name, last_name, gender,
              date_of_birth, phone, blood_type, allergies, underlying_conditions,
              is_active, created_at
       FROM patients
       WHERE is_active = TRUE
         AND (first_name LIKE ? OR last_name LIKE ? OR hn_code LIKE ? OR national_id LIKE ?)
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [searchTerm, searchTerm, searchTerm, searchTerm, Number(limit), Number(offset)]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM patients
       WHERE is_active = TRUE
         AND (first_name LIKE ? OR last_name LIKE ? OR hn_code LIKE ? OR national_id LIKE ?)`,
      [searchTerm, searchTerm, searchTerm, searchTerm]
    );

    res.json({ data: rows.map(withMetrics), total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// GET /api/patients/:id - ดูข้อมูลผู้ป่วยรายบุคคล
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM patients WHERE id = ?', [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ป่วย' });
    }

    res.json({ data: withMetrics(rows[0]) });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// POST /api/patients - เพิ่มผู้ป่วยใหม่
router.post('/', authenticate, authorize('admin', 'doctor', 'nurse'), validateMeasurements, async (req, res) => {
  let connection;
  try {
    const {
      national_id, prefix, first_name, last_name, gender,
      date_of_birth, phone, address, blood_type, allergies, underlying_conditions,
    } = req.body;

    if (!first_name || !last_name || !gender) {
      return res.status(400).json({ message: 'กรุณากรอกชื่อ นามสกุล และเพศให้ครบถ้วน' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    // All registrations serialize on this row, including simultaneous first registrations.
    await connection.query('INSERT IGNORE INTO patient_hn_sequence (id, last_number) VALUES (1, 0)');
    const [[sequence]] = await connection.query('SELECT last_number FROM patient_hn_sequence WHERE id = 1 FOR UPDATE');
    const [[existing]] = await connection.query(`SELECT COALESCE(MAX(CAST(SUBSTRING(hn_code, 3) AS UNSIGNED)), 0) AS highest
      FROM patients WHERE hn_code REGEXP '^HN[0-9]+$'`);
    const nextNumber = Math.max(Number(sequence.last_number), Number(existing.highest)) + 1;
    if (!Number.isSafeInteger(nextNumber)) throw new Error('HN sequence exceeds supported range');
    const hn_code = `HN${String(nextNumber).padStart(4, '0')}`;
    await connection.query('UPDATE patient_hn_sequence SET last_number = ? WHERE id = 1', [nextNumber]);

    const [result] = await connection.query(
      `INSERT INTO patients
        (hn_code, national_id, prefix, first_name, last_name, gender, date_of_birth,
         phone, address, blood_type, allergies, underlying_conditions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [hn_code, national_id || null, prefix || null, first_name, last_name, gender, date_of_birth || null,
        phone || null, address || null, blood_type || null, allergies || null, underlying_conditions || null]
    );

    await connection.commit();
    res.status(201).json({ message: `เพิ่มข้อมูลผู้ป่วยสำเร็จ · รหัส HN: ${hn_code}`, patientId: result.insertId, hn_code });
  } catch (err) {
    if (connection) await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'เลขบัตรประชาชนหรือรหัสผู้ป่วยนี้มีอยู่แล้วในระบบ' });
    }
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  } finally { if (connection) connection.release(); }
});

// PUT /api/patients/:id - แก้ไขข้อมูลผู้ป่วย
router.put(
  '/:id',
  authenticate,
  authorize('admin', 'doctor', 'nurse'),
  validateMeasurements,
  async (req, res) => {
    try {
      const patientId = Number(req.params.id);

      if (!Number.isInteger(patientId) || patientId <= 0) {
        return res.status(400).json({
          message: 'รหัสผู้ป่วยไม่ถูกต้อง'
        });
      }

      const fields = [
        'national_id',
        'prefix',
        'first_name',
        'last_name',
        'gender',
        'date_of_birth',
        'phone',
        'address',
        'blood_type',
        'allergies',
        'underlying_conditions'
      ];

      const nullableFields = [
        'national_id',
        'prefix',
        'date_of_birth',
        'phone',
        'address',
        'blood_type',
        'allergies',
        'underlying_conditions'
      ];

      const updates = [];
      const values = [];

      fields.forEach((field) => {
        if (req.body[field] !== undefined) {
          let value = req.body[field];

          // เปลี่ยนช่องว่างเป็น NULL เพื่อให้ MySQL บันทึกได้
          if (
            nullableFields.includes(field) &&
            typeof value === 'string' &&
            value.trim() === ''
          ) {
            value = null;
          }

          updates.push(`${field} = ?`);
          values.push(value);
        }
      });

      if (updates.length === 0) {
        return res.status(400).json({
          message: 'ไม่มีข้อมูลที่ต้องการแก้ไข'
        });
      }

      values.push(patientId);

      const [result] = await pool.query(
        `UPDATE patients
         SET ${updates.join(', ')}
         WHERE id = ? AND is_active = TRUE`,
        values
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          message: 'ไม่พบข้อมูลผู้ป่วย'
        });
      }

      res.json({
        message: 'แก้ไขข้อมูลผู้ป่วยสำเร็จ'
      });
    } catch (err) {
      console.error('Update patient error:', err);

      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          message: 'เลขบัตรประชาชนนี้มีอยู่แล้วในระบบ'
        });
      }

      res.status(500).json({
        message: 'เกิดข้อผิดพลาดในระบบ',
        error: err.message
      });
    }
  }
);

module.exports = router;
