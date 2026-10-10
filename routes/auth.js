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
      'SELECT * FROM users WHERE username = ? AND is_active = TRUE',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'username หรือ password ไม่ถูกต้อง' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'username หรือ password ไม่ถูกต้อง' });
    }

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
const MIN_PASSWORD_LENGTH = 6;
const STAFF_ROLES = ['doctor', 'nurse'];
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const passwordError = password => (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)
  ? `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` : null;

async function findUser(id) {
  const [rows] = await pool.query('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?', [id]);
  return rows[0];
}

// GET /api/auth/users - รายชื่อบัญชีทั้งหมด
router.get('/users', authenticate, authorize('admin'), async (req, res) => {
  try {
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

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      [username, passwordHash, full_name, role]
    );

    res.status(201).json({ message: 'สร้างผู้ใช้งานสำเร็จ', userId: result.insertId });
  } catch (err) {
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
    const role = req.body.role || target.role;
    if (!full_name) return res.status(400).json({ message: 'กรุณากรอกชื่อแสดงผล' });
    if (role !== target.role) {
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
