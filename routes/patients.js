// API ข้อมูลผู้ป่วย (/api/patients): ค้นหา ดูรายบุคคล ลงทะเบียน (สร้าง HN อัตโนมัติ) และแก้ไข

const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const metrics = require('../public/js/patient-metrics');
// แปลงข้อมูลผู้ป่วยก่อนส่งกลับ: ตัดน้ำหนัก/ส่วนสูง/BMI เดิมทิ้ง (ย้ายไปเก็บตามการมารักษาแต่ละครั้งแล้ว)
// และเพิ่มอายุที่คำนวณจากวันเกิด
const withMetrics = patient => {
  const { weight_kg, height_cm, bmi, ...data } = patient;
  return {...data, age: metrics.age(patient.date_of_birth)};
};
// middleware ตรวจวันเกิด: ต้องเป็นวันที่ถูกต้องและไม่อยู่ในอนาคต
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
    // คำนวณตำแหน่งเริ่มของหน้าที่ขอ เช่น หน้า 2 ทีละ 20 รายการ -> ข้าม 20 รายการแรก
    const offset = (page - 1) * limit;

    // ค้นหาแบบมีคำนี้อยู่ตรงไหนก็ได้ ในชื่อ นามสกุล HN หรือเลขบัตรประชาชน
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

    // นับจำนวนทั้งหมดที่ตรงเงื่อนไข ใช้แสดงจำนวนหน้า
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

    // สร้างเลข HN อัตโนมัติใน transaction เพื่อไม่ให้ลงทะเบียนพร้อมกันแล้วได้เลขซ้ำ
    connection = await pool.getConnection();
    await connection.beginTransaction();
    // การลงทะเบียนทุกครั้งต้องผ่านแถวนี้ทีละคน (แม้แต่การลงทะเบียนครั้งแรกที่เกิดพร้อมกัน)
    // สร้างแถวเก็บลำดับเลข HN ถ้ายังไม่มี (ครั้งแรกของระบบ)
    await connection.query('INSERT IGNORE INTO patient_hn_sequence (id, last_number) VALUES (1, 0)');
    // ล็อกแถวลำดับเลข (FOR UPDATE) คนอื่นที่ลงทะเบียนพร้อมกันต้องรอจนกว่าจะ commit
    const [[sequence]] = await connection.query('SELECT last_number FROM patient_hn_sequence WHERE id = 1 FOR UPDATE');
    // หาเลข HN สูงสุดที่มีอยู่จริง กันกรณีมีข้อมูลเก่าที่เลขสูงกว่าลำดับที่เก็บไว้
    const [[existing]] = await connection.query(`SELECT COALESCE(MAX(CAST(SUBSTRING(hn_code, 3) AS UNSIGNED)), 0) AS highest
      FROM patients WHERE hn_code REGEXP '^HN[0-9]+$'`);
    // เลขถัดไป = ค่าที่มากกว่าระหว่างลำดับที่เก็บไว้กับ HN สูงสุดที่มีจริง แล้วบวก 1
    const nextNumber = Math.max(Number(sequence.last_number), Number(existing.highest)) + 1;
    // กันเลขเกินขอบเขตที่ JavaScript เก็บได้แม่นยำ (ไม่น่าเกิดในการใช้งานจริง)
    if (!Number.isSafeInteger(nextNumber)) throw new Error('HN sequence exceeds supported range');
    // จัดรูปแบบเป็น HN0001, HN0002, ...
    const hn_code = `HN${String(nextNumber).padStart(4, '0')}`;
    // บันทึกเลขล่าสุดกลับไป ให้คนถัดไปได้เลขต่อจากนี้
    await connection.query('UPDATE patient_hn_sequence SET last_number = ? WHERE id = 1', [nextNumber]);

    // บันทึกผู้ป่วยใหม่ ช่องที่ไม่กรอกเก็บเป็น NULL
    const [result] = await connection.query(
      `INSERT INTO patients
        (hn_code, national_id, prefix, first_name, last_name, gender, date_of_birth,
         phone, address, blood_type, allergies, underlying_conditions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [hn_code, national_id || null, prefix || null, first_name, last_name, gender, date_of_birth || null,
        phone || null, address || null, blood_type || null, allergies || null, underlying_conditions || null]
    );

    // commit = ยืนยันทั้งเลข HN และข้อมูลผู้ป่วยพร้อมกัน และปลดล็อกให้คนถัดไป
    await connection.commit();
    res.status(201).json({ message: `เพิ่มข้อมูลผู้ป่วยสำเร็จ · รหัส HN: ${hn_code}`, patientId: result.insertId, hn_code });
  } catch (err) {
    // เกิดข้อผิดพลาด -> ยกเลิกทุกอย่างใน transaction (เลข HN ไม่ถูกใช้ไป)
    if (connection) await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'เลขบัตรประชาชนหรือรหัสผู้ป่วยนี้มีอยู่แล้วในระบบ' });
    }
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  } finally { if (connection) connection.release(); } // คืนการเชื่อมต่อให้ pool เสมอ ไม่ว่าสำเร็จหรือไม่
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

      // รายชื่อช่องที่อนุญาตให้แก้ไข (กันการแก้ช่องอื่น เช่น hn_code หรือ is_active)
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

      // ช่องที่เว้นว่างได้ ถ้าส่งข้อความว่างมาจะเก็บเป็น NULL
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

      // สร้างคำสั่ง UPDATE เฉพาะช่องที่ส่งมาจริง ช่องที่ไม่ส่งมาจะไม่ถูกแตะ
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

      // id ผู้ป่วยเป็นค่าสุดท้าย ตรงกับ ? ใน WHERE id = ?
      values.push(patientId);

      // แก้ได้เฉพาะผู้ป่วยที่ยังใช้งานอยู่
      const [result] = await pool.query(
        `UPDATE patients
         SET ${updates.join(', ')}
         WHERE id = ? AND is_active = TRUE`,
        values
      );

      // ไม่มีแถวถูกแก้ = ไม่พบผู้ป่วย หรือผู้ป่วยถูกปิดการใช้งานแล้ว
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

// ไม่มี DELETE: ระบบตั้งใจไม่ให้ลบผู้ป่วย เพื่อคงประวัติการรักษาไว้ครบถ้วน
module.exports = router;
