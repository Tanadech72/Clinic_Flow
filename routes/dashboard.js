const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard - สรุปข้อมูลภาพรวมของคลินิก
router.get('/', authenticate, async (req, res) => {
  try {
    const [[patientCount]] = await pool.query(
      'SELECT COUNT(*) AS total FROM patients WHERE is_active = TRUE'
    );

    const [[visitsToday]] = await pool.query(
      'SELECT COUNT(*) AS total FROM medical_records WHERE DATE(visit_date) = CURDATE()'
    );

    const [lowStockMedicines] = await pool.query(
      `SELECT id, code, name, stock_quantity, reorder_level
       FROM medicines
       WHERE is_active = TRUE AND stock_quantity <= reorder_level
       ORDER BY stock_quantity ASC
       LIMIT 10`
    );

    const [expiringSoon] = await pool.query(
      `SELECT id, code, name, expiry_date, stock_quantity
       FROM medicines
       WHERE is_active = TRUE
         AND expiry_date IS NOT NULL
         AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
       ORDER BY expiry_date ASC
       LIMIT 10`
    );

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
