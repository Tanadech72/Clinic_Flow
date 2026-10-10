// จุดเริ่มต้นของเซิร์ฟเวอร์ Clinic Flow
// หน้าที่: ตั้งค่า Express, เสิร์ฟไฟล์หน้าเว็บในโฟลเดอร์ public, ผูก API ทุกกลุ่ม และเปิดเซิร์ฟเวอร์
// รันด้วย: npm start (ปกติ) หรือ npm run dev (รีโหลดอัตโนมัติด้วย nodemon)

// โหลดไลบรารีหลัก: express (เว็บเซิร์ฟเวอร์), cors (อนุญาตให้เรียก API ข้ามโดเมน), path (จัดการ path ไฟล์)
const express = require('express');
const cors = require('cors');
const path = require('path');
// อ่านค่าตั้งค่าจากไฟล์ .env เช่น DB_PASSWORD, JWT_SECRET, PORT
require('dotenv').config();

// โหลดกลุ่ม API แต่ละส่วนจากโฟลเดอร์ routes/
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const recordRoutes = require('./routes/records');
const medicineRoutes = require('./routes/medicines');
const dashboardRoutes = require('./routes/dashboard');

// สร้างแอป Express
const app = express();

// middleware ที่ทำงานกับทุก request:
// - cors: อนุญาตให้หน้าเว็บจากโดเมนอื่นเรียก API ได้
// - express.json: แปลง body ที่เป็น JSON ให้อยู่ใน req.body
// - urlencoded: แปลง body จากฟอร์ม HTML
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// เปิดใช้งานไฟล์ Frontend ในโฟลเดอร์ public
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
// ผูก URL กับกลุ่ม API เช่น /api/patients -> routes/patients.js
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/visits', require('./routes/visits'));
app.use('/api/medicines', medicineRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Health check
// ใช้เช็กว่าเซิร์ฟเวอร์ยังทำงานอยู่หรือไม่
app.get('/api/health', (req, res) => {
  res.json({
    message: 'Clinic Flow API กำลังทำงานอยู่',
    status: 'ok'
  });
});

// จัดการ route ที่ไม่พบ
app.use((req, res) => {
  res.status(404).json({
    message: 'ไม่พบเส้นทางที่ร้องขอ (route not found)'
  });
});

// จัดการ error กลาง
app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(500).json({
    message: 'เกิดข้อผิดพลาดในระบบ',
    error: err.message
  });
});

// เริ่มเปิดเซิร์ฟเวอร์ที่ port ที่กำหนดใน .env (ค่าเริ่มต้น 3000)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Clinic Flow server กำลังทำงานที่ http://localhost:${PORT}`);
});
