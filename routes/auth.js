// API บัญชีผู้ใช้ (/api/auth): เข้าสู่ระบบ, จัดการบัญชี (เฉพาะเจ้าของคลินิก) และเปลี่ยนรหัสผ่านตัวเอง

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();

// POST /api/auth/login - เข้าสู่ระบบ
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'กรุณากรอก username และ password' });
    }

    const [rows] = await pool.query(
      // หาเฉพาะบัญชีที่ยังเปิดใช้งาน บัญชีที่ถูกปิดจะเข้าสู่ระบบไม่ได้
      'SELECT * FROM users WHERE username = ? AND is_active = TRUE',
      [username]
    );

    // ตอบข้อความเดียวกันทั้งกรณีไม่มี username และรหัสผ่านผิด เพื่อไม่ให้คนนอกเดาได้ว่ามี username นี้ในระบบ
    if (rows.length === 0) {
      return res.status(401).json({ message: 'username หรือ password ไม่ถูกต้อง' });
    }

    const user = rows[0];
    // เทียบรหัสผ่านที่กรอกกับรหัสที่เข้ารหัสไว้ (ไม่ได้ถอดรหัส แต่เข้ารหัสแล้วเทียบ)
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'username หรือ password ไม่ถูกต้อง' });
    }

    // สร้าง token สำหรับเรียก API ครั้งต่อไป อายุตาม JWT_EXPIRES_IN (ค่าเริ่มต้น 8 ชั่วโมง)
    // หน้าเว็บเก็บ token ไว้ใน localStorage แล้วแนบมาใน header Authorization ทุกครั้ง
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      message: 'เข้าสู่ระบบสำเร็จ',
      token,
      user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
    });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// ---------------------------------------------
// จัดการบัญชีผู้ใช้งาน (เฉพาะเจ้าของคลินิก / admin)
// ไม่มีการลบบัญชี ใช้การปิดการใช้งานแทน เพื่อคงประวัติผู้ปฏิบัติงานในเวชระเบียนและสต๊อกยา
// ---------------------------------------------
// ความยาวรหัสผ่านขั้นต่ำ
const MIN_PASSWORD_LENGTH = 6;
// บทบาทที่เจ้าของคลินิกสร้างหรือเปลี่ยนให้ได้ (สร้างบัญชี admin เพิ่มจากหน้าเว็บไม่ได้)
const STAFF_ROLES = ['doctor', 'nurse'];
// ตรวจว่าเป็นเลข id ที่ถูกต้อง (จำนวนเต็มบวก)
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
// คืนข้อความ error ถ้ารหัสผ่านสั้นเกินไป หรือ null ถ้าผ่าน
const passwordError = password => (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)
  ? `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` : null;

// ดึงข้อมูลบัญชีจาก id (ไม่รวมรหัสผ่าน)
async function findUser(id) {
  const [rows] = await pool.query('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?', [id]);
  return rows[0];
}

// GET /api/auth/users - รายชื่อบัญชีทั้งหมด
router.get('/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    // เรียง: บัญชีที่เปิดใช้งานก่อน -> ตามบทบาท (เจ้าของ แพทย์ พยาบาล) -> ตามชื่อ
    const [rows] = await pool.query(
      `SELECT id, username, full_name, role, is_active, created_at, updated_at
       FROM users ORDER BY is_active DESC, FIELD(role, 'admin', 'doctor', 'nurse'), full_name`
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: 'โหลดรายชื่อบัญชีไม่สำเร็จ', error: err.message });
  }
});

// POST /api/auth/users - สร้างบัญชีแพทย์หรือพยาบาล
router.post('/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const full_name = String(req.body.full_name || '').trim();
    const { password, role } = req.body;

    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }
    if (!STAFF_ROLES.includes(role)) {
      return res.status(400).json({ message: 'กรุณาเลือกบทบาทแพทย์หรือพยาบาล' });
    }
    const invalidPassword = passwordError(password);
    if (invalidPassword) return res.status(400).json({ message: invalidPassword });

    // เข้ารหัสรหัสผ่านก่อนเก็บ (10 = จำนวนรอบการเข้ารหัส ยิ่งมากยิ่งเดายาก แต่ช้าลง)
    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      [username, passwordHash, full_name, role]
    );

    res.status(201).json({ message: 'สร้างผู้ใช้งานสำเร็จ', userId: result.insertId });
  } catch (err) {
    // ER_DUP_ENTRY = MySQL ปฏิเสธเพราะ username ซ้ำ (คอลัมน์เป็น UNIQUE)
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'username นี้มีอยู่แล้วในระบบ' });
    }
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// PUT /api/auth/users/:id - แก้ไขชื่อและบทบาท
router.put('/users/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'รหัสผู้ใช้ไม่ถูกต้อง' });
    const target = await findUser(req.params.id);
    if (!target) return res.status(404).json({ message: 'ไม่พบบัญชีผู้ใช้' });

    const full_name = String(req.body.full_name || '').trim();
    // ถ้าไม่ได้ส่งบทบาทมา ใช้บทบาทเดิม
    const role = req.body.role || target.role;
    if (!full_name) return res.status(400).json({ message: 'กรุณากรอกชื่อแสดงผล' });
    if (role !== target.role) {
      // กฎป้องกัน: ห้ามเปลี่ยนบทบาทตัวเอง และห้ามเปลี่ยนบทบาทเจ้าของคลินิก กันไม่ให้ไม่มีใครดูแลระบบ
      if (target.id === req.user.id) return res.status(400).json({ message: 'ไม่สามารถเปลี่ยนบทบาทของบัญชีตัวเองได้' });
      if (target.role === 'admin') return res.status(400).json({ message: 'ไม่สามารถเปลี่ยนบทบาทของบัญชีเจ้าของคลินิกได้' });
      if (!STAFF_ROLES.includes(role)) return res.status(400).json({ message: 'กรุณาเลือกบทบาทแพทย์หรือพยาบาล' });
    }

    await pool.query('UPDATE users SET full_name = ?, role = ? WHERE id = ?', [full_name, role, target.id]);
    res.json({ message: 'บันทึกข้อมูลบัญชีสำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// PATCH /api/auth/users/:id/status - ปิดหรือเปิดการใช้งานบัญชี
router.patch('/users/:id/status', authenticate, authorize('admin'), async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'รหัสผู้ใช้ไม่ถูกต้อง' });
    if (typeof req.body.is_active !== 'boolean') return res.status(400).json({ message: 'กรุณาระบุสถานะบัญชี' });
    const target = await findUser(req.params.id);
    if (!target) return res.status(404).json({ message: 'ไม่พบบัญชีผู้ใช้' });
    // กฎป้องกัน: ห้ามปิดบัญชีตัวเองและบัญชีเจ้าของคลินิก
    if (target.id === req.user.id) return res.status(400).json({ message: 'ไม่สามารถปิดการใช้งานบัญชีตัวเองได้' });
    if (target.role === 'admin') return res.status(400).json({ message: 'ไม่สามารถปิดการใช้งานบัญชีเจ้าของคลินิกได้' });

    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [req.body.is_active, target.id]);
    res.json({ message: req.body.is_active ? 'เปิดการใช้งานบัญชีแล้ว' : 'ปิดการใช้งานบัญชีแล้ว' });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// POST /api/auth/users/:id/reset-password - ตั้งรหัสผ่านใหม่ให้ผู้ใช้ที่ลืมรหัสผ่าน
router.post('/users/:id/reset-password', authenticate, authorize('admin'), async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'รหัสผู้ใช้ไม่ถูกต้อง' });
    const invalidPassword = passwordError(req.body.password);
    if (invalidPassword) return res.status(400).json({ message: invalidPassword });
    const target = await findUser(req.params.id);
    if (!target) return res.status(404).json({ message: 'ไม่พบบัญชีผู้ใช้' });

    const passwordHash = await bcrypt.hash(req.body.password, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, target.id]);
    res.json({ message: `ตั้งรหัสผ่านใหม่ให้ ${target.username} แล้ว` });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// GET /api/auth/me - ดูข้อมูลผู้ใช้ที่ login อยู่
// หน้าเว็บใช้ตรวจบทบาทเพื่อซ่อน/แสดงเมนูและปุ่ม (req.user มาจาก middleware authenticate)
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/me/password - ผู้ใช้ทุกคนเปลี่ยนรหัสผ่านของตัวเอง
router.put('/me/password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password) return res.status(400).json({ message: 'กรุณากรอกรหัสผ่านปัจจุบัน' });
    const invalidPassword = passwordError(new_password);
    if (invalidPassword) return res.status(400).json({ message: invalidPassword });

    // ต้องยืนยันรหัสผ่านปัจจุบันก่อน กันคนอื่นที่แอบใช้เครื่องที่ล็อกอินค้างไว้เปลี่ยนรหัสผ่าน
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length || !(await bcrypt.compare(current_password, rows[0].password_hash))) {
      return res.status(400).json({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }
    if (current_password === new_password) {
      return res.status(400).json({ message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' });
    }

    const passwordHash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
    res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

module.exports = router;
