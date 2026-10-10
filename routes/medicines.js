// API คลังยา (/api/medicines): ดู/ค้นหายา เพิ่ม แก้ไข รับยาเข้าสต๊อก และดูประวัติการเคลื่อนไหว
// การตัดสต๊อกเกิดตอนพยาบาลยืนยันจ่ายยาเท่านั้น (routes/visits.js)

const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/medicines - ดูรายการยาทั้งหมด (รองรับค้นหา)
router.get('/', authenticate, async (req, res) => {
  try {
    const { search = '', lowStockOnly } = req.query;
    const searchTerm = `%${search}%`;

    // ค้นหาได้ทั้งชื่อยา รหัสยา และชื่อสามัญภาษาอังกฤษ
    let query = `SELECT * FROM medicines WHERE is_active = TRUE AND (name LIKE ? OR code LIKE ? OR generic_name LIKE ?)`;
    const params = [searchTerm, searchTerm, searchTerm];

    // ถ้าติ๊ก "แสดงเฉพาะยาใกล้หมด" จะกรองเฉพาะยาที่คงเหลือไม่เกินจุดสั่งซื้อ
    if (lowStockOnly === 'true') {
      query += ' AND stock_quantity <= reorder_level';
    }

    query += ' ORDER BY name ASC';

    const [rows] = await pool.query(query, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// POST /api/medicines - เพิ่มยาใหม่
router.post('/', authenticate, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    // generic_name และ drug_group ใช้ตรวจประวัติแพ้ยาตอนแพทย์สั่งยา (ดู public/js/allergy-check.js)
    const { code, name, generic_name, drug_group, category, unit, price_per_unit, stock_quantity, reorder_level, expiry_date } = req.body;

    if (!code || !name || !unit) {
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (code, name, unit)' });
    }

    const [result] = await pool.query(
      `INSERT INTO medicines (code, name, generic_name, drug_group, category, unit, price_per_unit, stock_quantity, reorder_level, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, name, generic_name || null, drug_group || null, category, unit, price_per_unit || 0, stock_quantity || 0, reorder_level || 10, expiry_date]
    );

    res.status(201).json({ message: 'เพิ่มยาสำเร็จ', medicineId: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'รหัสยานี้มีอยู่แล้วในระบบ' });
    }
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// PUT /api/medicines/:id - แก้ไขข้อมูลยา (เฉพาะเจ้าของคลินิก)
// เจ้าของคลินิกแก้รหัสยาได้ด้วย โดยรหัสใหม่ต้องไม่ว่างและไม่ซ้ำกับยาตัวอื่น
// ประวัติการจ่ายยาและสต๊อกอ้างอิงยาด้วย id จึงไม่กระทบเมื่อเปลี่ยนรหัส
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    if (req.body.code !== undefined) {
      req.body.code = String(req.body.code).trim();
      if (!req.body.code) return res.status(400).json({ message: 'รหัสยาต้องไม่เป็นค่าว่าง' });
    }
    // ช่องที่อนุญาตให้แก้ไข (ไม่รวมรหัสยาและจำนวนสต๊อก)
    // การเปลี่ยนจำนวนสต๊อกต้องทำผ่านการรับยาเข้า เพื่อให้มีประวัติการเคลื่อนไหวเสมอ
    const fields = ['code', 'name', 'generic_name', 'drug_group', 'category', 'unit', 'price_per_unit', 'reorder_level', 'expiry_date'];
    const updates = [];
    const values = [];

    // สร้างคำสั่ง UPDATE เฉพาะช่องที่ส่งมา
    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ message: 'ไม่มีข้อมูลที่ต้องการแก้ไข' });
    }

    values.push(req.params.id);

    const [result] = await pool.query(`UPDATE medicines SET ${updates.join(', ')} WHERE id = ?`, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลยา' });
    }

    res.json({ message: 'แก้ไขข้อมูลยาสำเร็จ' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'รหัสยานี้มีอยู่แล้วในระบบ' });
    }
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// POST /api/medicines/:id/stock-in - รับยาเข้าสต๊อก
router.post('/:id/stock-in', authenticate, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { quantity, reason } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ message: 'กรุณาระบุจำนวนที่ถูกต้อง' });
    }

    // เพิ่มจำนวนสต๊อกและบันทึกประวัติการรับเข้าใน transaction เดียว ต้องสำเร็จทั้งคู่หรือไม่ทำเลย
    await connection.beginTransaction();

    const [result] = await connection.query(
      'UPDATE medicines SET stock_quantity = stock_quantity + ? WHERE id = ?',
      [quantity, req.params.id]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'ไม่พบข้อมูลยา' });
    }

    await connection.query(
      // บันทึกประวัติ: รับเข้า (in) จำนวนเท่าไร เหตุผล และใครเป็นผู้ทำ
      `INSERT INTO stock_transactions (medicine_id, change_type, quantity, reason, created_by)
       VALUES (?, 'in', ?, ?, ?)`,
      [req.params.id, quantity, reason || 'รับสินค้าใหม่', req.user.id]
    );

    await connection.commit();
    res.json({ message: 'รับยาเข้าสต๊อกสำเร็จ' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  } finally {
    connection.release();
  }
});

// GET /api/medicines/:id/transactions - ดูประวัติการเคลื่อนไหวสต๊อกของยา
router.get('/:id/transactions', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT st.*, u.full_name AS created_by_name
       FROM stock_transactions st
       LEFT JOIN users u ON st.created_by = u.id
       WHERE st.medicine_id = ?
       ORDER BY st.created_at DESC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

module.exports = router;
