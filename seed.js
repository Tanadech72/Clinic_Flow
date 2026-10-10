// สคริปต์สำหรับสร้างผู้ใช้ admin เริ่มต้น
// วิธีใช้: node seed.js <username> <password> <full_name>
// ตัวอย่าง: node seed.js admin Admin@123 "ผู้ดูแลระบบ"

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function seed() {
  // อ่านค่าจาก command line ถ้าไม่ระบุจะใช้ค่าเริ่มต้น admin / Admin@123
  const [, , username = 'admin', password = 'Admin@123', fullName = 'ผู้ดูแลระบบ'] = process.argv;

  try {
    // เข้ารหัสรหัสผ่านก่อนเก็บ (ไม่เก็บรหัสผ่านจริงในฐานข้อมูล)
    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      // ถ้ามี username นี้อยู่แล้ว จะอัปเดตรหัสผ่านแทนการเพิ่มใหม่ (ON DUPLICATE KEY UPDATE)
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
    // ปิดการเชื่อมต่อฐานข้อมูล ไม่อย่างนั้นสคริปต์จะค้างไม่จบ
    await pool.end();
  }
}

seed();
