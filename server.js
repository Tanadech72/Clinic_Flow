const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const recordRoutes = require('./routes/records');
const medicineRoutes = require('./routes/medicines');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// เปิดใช้งานไฟล์ Frontend ในโฟลเดอร์ public
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/visits', require('./routes/visits'));
app.use('/api/medicines', medicineRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Health check
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Clinic Flow server กำลังทำงานที่ http://localhost:${PORT}`);
});
