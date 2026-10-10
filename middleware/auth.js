const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

// ตรวจสอบว่ามี token ที่ถูกต้อง และบัญชียังเปิดใช้งานอยู่
// อ่านบทบาทล่าสุดจากฐานข้อมูลทุกครั้ง เพื่อให้การปิดบัญชีหรือเปลี่ยนบทบาทมีผลทันที
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'ไม่พบ token กรุณาเข้าสู่ระบบ' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, username, full_name, role FROM users WHERE id = ? AND is_active = TRUE',
      [decoded.id]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อเจ้าของคลินิก' });
    }
    req.user = rows[0]; // { id, username, full_name, role }
    next();
  } catch (err) {
    res.status(500).json({ message: 'ตรวจสอบบัญชีผู้ใช้ไม่สำเร็จ', error: err.message });
  }
}

// ตรวจสอบสิทธิ์ตาม role เช่น authorize('admin', 'doctor')
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
