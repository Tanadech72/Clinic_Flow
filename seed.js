// สคริปต์สำหรับสร้างผู้ใช้ admin เริ่มต้น
// วิธีใช้: node seed.js <username> <password> <full_name>
// ตัวอย่าง: node seed.js admin Admin@123 "ผู้ดูแลระบบ"

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function seed() {
  const [, , username = 'admin', password = 'Admin@123', fullName = 'ผู้ดูแลระบบ'] = process.argv;

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES (?, ?, ?, 'admin')
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [username, passwordHash, fullName]
    );

    console.log(`สร้าง/อัปเดตผู้ใช้ admin สำเร็จ -> username: ${username}, password: ${password}`);
    console.log('กรุณาเปลี่ยนรหัสผ่านนี้หลังเข้าสู่ระบบครั้งแรก');
  } catch (err) {
    console.error('เกิดข้อผิดพลาดในการสร้างผู้ใช้:', err.message);
  } finally {
    await pool.end();
  }
}

seed();
