// การเชื่อมต่อฐานข้อมูล MySQL ที่ใช้ร่วมกันทั้งระบบ

const mysql = require('mysql2/promise');
require('dotenv').config();

// สร้าง connection pool: เปิดการเชื่อมต่อค้างไว้หลายเส้นแล้วหมุนเวียนใช้
// เร็วกว่าการเปิด-ปิดการเชื่อมต่อใหม่ทุกครั้งที่ query ค่าทั้งหมดอ่านจาก .env
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'clinic_flow',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  // เปิดพร้อมกันได้สูงสุด 10 การเชื่อมต่อ ถ้าเต็มให้รอคิว (waitForConnections)
  connectionLimit: 10,
  queueLimit: 0,
  // ส่งวันที่กลับมาเป็นข้อความ (เช่น '2026-10-10') แทน Date object เพื่อไม่ให้เวลาเพี้ยนตาม timezone
  dateStrings: true,
});

// ไฟล์อื่นเรียกใช้ด้วย require('../config/db') แล้วใช้ pool.query(...) หรือ pool.getConnection()
module.exports = pool;
