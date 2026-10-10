// API ภาพรวมคลินิก (/api/dashboard): รวมตัวเลขสรุปและรายการแจ้งเตือนไว้ในการเรียกครั้งเดียว

const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard - สรุปข้อมูลภาพรวมของคลินิก
router.get('/', authenticate, async (req, res) => {
  try {
    // จำนวนผู้ป่วยทั้งหมดที่ยังใช้งานอยู่
    const [[patientCount]] = await pool.query(
      'SELECT COUNT(*) AS total FROM patients WHERE is_active = TRUE'
    );

    // จำนวนการตรวจรักษาวันนี้ (นับจากประวัติการรักษาที่บันทึกวันนี้)
    const [[visitsToday]] = await pool.query(
      'SELECT COUNT(*) AS total FROM medical_records WHERE DATE(visit_date) = CURDATE()'
    );

    // ยาที่คงเหลือน้อยกว่าหรือเท่ากับจุดสั่งซื้อ (10 รายการแรก เรียงจากเหลือน้อยสุด)
    const [lowStockMedicines] = await pool.query(
      `SELECT id, code, name, stock_quantity, reorder_level
       FROM medicines
       WHERE is_active = TRUE AND stock_quantity <= reorder_level
       ORDER BY stock_quantity ASC
       LIMIT 10`
    );

    // ล็อตยาที่ยังมีของเหลือและจะหมดอายุภายใน 90 วัน (รวมที่หมดอายุไปแล้ว)
    const [expiringSoon] = await pool.query(
      `SELECT l.id, m.code, m.name, l.lot_number, l.expiry_date, l.quantity_remaining AS stock_quantity
       FROM medicine_lots l
       JOIN medicines m ON m.id = l.medicine_id
       WHERE m.is_active = TRUE
         AND l.quantity_remaining > 0
         AND l.expiry_date IS NOT NULL
         AND l.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
       ORDER BY l.expiry_date ASC
       LIMIT 10`
    );

    // ประวัติการรักษาล่าสุด 10 รายการ
    const [recentVisits] = await pool.query(
      `SELECT mr.id, mr.visit_date, p.first_name, p.last_name, p.hn_code, u.full_name AS doctor_name
       FROM medical_records mr
       JOIN patients p ON mr.patient_id = p.id
       LEFT JOIN users u ON mr.doctor_id = u.id
       ORDER BY mr.visit_date DESC
       LIMIT 10`
    );

    res.json({
      summary: {
        totalActivePatients: patientCount.total,
        visitsToday: visitsToday.total,
        lowStockCount: lowStockMedicines.length,
        expiringSoonCount: expiringSoon.length,
      },
      lowStockMedicines,
      expiringSoon,
      recentVisits,
    });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

module.exports = router;
