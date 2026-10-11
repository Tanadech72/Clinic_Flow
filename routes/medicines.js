// API คลังยา (/api/medicines): ดู/ค้นหายา เพิ่ม แก้ไข รับยาเข้าสต๊อกแยกตามล็อต และดูประวัติการเคลื่อนไหว
// การตัดสต๊อกเกิดตอนพยาบาลยืนยันจ่ายยาเท่านั้น (routes/visits.js) โดยตัดจากล็อตที่หมดอายุก่อน

const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
// สร้าง error ที่มีรหัส HTTP แนบไว้ เพื่อ throw ใน transaction แล้วส่งรหัสนั้นกลับใน catch
const failure = (status, message) => Object.assign(new Error(message), { status });
// วันที่วันนี้ตามเวลาเครื่องเซิร์ฟเวอร์ รูปแบบ YYYY-MM-DD
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
// ตรวจว่าเป็นวันที่ YYYY-MM-DD ที่มีอยู่จริง (กันค่าอย่าง 2026-02-30)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

// GET /api/medicines - ดูรายการยาทั้งหมด (รองรับค้นหา)
router.get('/', authenticate, async (req, res) => {
  try {
    const { search = '', lowStockOnly } = req.query;
    const searchTerm = `%${search}%`;

    // ค้นหาได้ทั้งชื่อยา รหัสยา และชื่อสามัญภาษาอังกฤษ
    // แนบวันหมดอายุที่ใกล้ที่สุดของล็อตที่ยังเหลือ และจำนวนที่หมดอายุแล้ว (จ่ายไม่ได้)
    let query = `SELECT m.*,
        (SELECT MIN(l.expiry_date) FROM medicine_lots l WHERE l.medicine_id = m.id AND l.quantity_remaining > 0) AS nearest_expiry,
        (SELECT COALESCE(SUM(l.quantity_remaining), 0) FROM medicine_lots l
         WHERE l.medicine_id = m.id AND l.expiry_date < CURDATE()) AS expired_quantity
      FROM medicines m WHERE m.is_active = TRUE AND (m.name LIKE ? OR m.code LIKE ? OR m.generic_name LIKE ?)`;
    const params = [searchTerm, searchTerm, searchTerm];

    // ถ้าติ๊ก "แสดงเฉพาะยาใกล้หมด" จะกรองเฉพาะยาที่คงเหลือ (ไม่นับส่วนที่หมดอายุ) ไม่เกินจุดสั่งซื้อ
    // ใช้ HAVING เพราะต้องอ้างถึง expired_quantity ที่คำนวณใน SELECT
    if (lowStockOnly === 'true') {
      query += ' HAVING m.stock_quantity - expired_quantity <= m.reorder_level';
    }

    query += ' ORDER BY m.name ASC';

    const [rows] = await pool.query(query, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// POST /api/medicines - เพิ่มยาใหม่ (สต๊อกเริ่มที่ 0 แล้วรับยาเข้าผ่าน stock-in เพื่อให้มีเลขล็อตและวันหมดอายุ)
router.post('/', authenticate, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    // generic_name และ drug_group ใช้ตรวจประวัติแพ้ยาตอนแพทย์สั่งยา (ดู public/js/allergy-check.js)
    const { code, name, generic_name, drug_group, category, unit, price_per_unit, reorder_level } = req.body;

    if (!code || !name || !unit) {
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (code, name, unit)' });
    }

    const [result] = await pool.query(
      `INSERT INTO medicines (code, name, generic_name, drug_group, category, unit, price_per_unit, stock_quantity, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [code, name, generic_name || null, drug_group || null, category, unit, price_per_unit || 0, reorder_level || 10]
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
    // ช่องที่อนุญาตให้แก้ไข (ไม่รวมจำนวนสต๊อกและวันหมดอายุ)
    // สต๊อกและวันหมดอายุเปลี่ยนผ่านการรับยาเข้าแยกตามล็อตเท่านั้น เพื่อให้มีประวัติการเคลื่อนไหวเสมอ
    const fields = ['code', 'name', 'generic_name', 'drug_group', 'category', 'unit', 'price_per_unit', 'reorder_level'];
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

// POST /api/medicines/:id/stock-in - รับยาเข้าสต๊อก ระบุเลขล็อต วันหมดอายุ และจำนวน
// เลขล็อตเดิมที่วันหมดอายุตรงกันจะบวกเข้าล็อตเดิม ถ้าวันหมดอายุไม่ตรงถือว่ากรอกผิด
router.post('/:id/stock-in', authenticate, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  const { quantity, reason, expiry_date: expiryDate } = req.body;
  const lotNumber = typeof req.body.lot_number === 'string' ? req.body.lot_number.trim() : '';

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ message: 'กรุณาระบุจำนวนเป็นจำนวนเต็มบวก' });
  }
  if (!lotNumber || lotNumber.length > 50) {
    return res.status(400).json({ message: 'กรุณาระบุเลขที่ล็อต (ไม่เกิน 50 ตัวอักษร)' });
  }
  if (!validDate(expiryDate)) {
    return res.status(400).json({ message: 'กรุณาระบุวันหมดอายุให้ถูกต้อง' });
  }
  if (expiryDate < today()) {
    return res.status(400).json({ message: 'ยาล็อตนี้หมดอายุแล้ว ไม่สามารถรับเข้าสต๊อกได้' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    // เพิ่มล็อต เพิ่มสต๊อกรวม และบันทึกประวัติการรับเข้าใน transaction เดียว ต้องสำเร็จทั้งหมดหรือไม่ทำเลย
    await connection.beginTransaction();

    const [[medicine]] = await connection.query('SELECT id FROM medicines WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!medicine) throw failure(404, 'ไม่พบข้อมูลยา');

    const [[lot]] = await connection.query(
      `SELECT id, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry FROM medicine_lots
       WHERE medicine_id = ? AND lot_number = ? FOR UPDATE`,
      [medicine.id, lotNumber]
    );
    let lotId;
    if (lot) {
      if (lot.expiry !== expiryDate) {
        throw failure(409, `ล็อต ${lotNumber} มีอยู่แล้ว แต่วันหมดอายุไม่ตรงกับที่บันทึกไว้ กรุณาตรวจสอบเลขล็อตและวันหมดอายุ`);
      }
      lotId = lot.id;
      await connection.query(
        'UPDATE medicine_lots SET quantity_received = quantity_received + ?, quantity_remaining = quantity_remaining + ? WHERE id = ?',
        [quantity, quantity, lotId]
      );
    } else {
      const [inserted] = await connection.query(
        `INSERT INTO medicine_lots (medicine_id, lot_number, expiry_date, quantity_received, quantity_remaining, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [medicine.id, lotNumber, expiryDate, quantity, quantity, req.user.id]
      );
      lotId = inserted.insertId;
    }

    await connection.query('UPDATE medicines SET stock_quantity = stock_quantity + ? WHERE id = ?', [quantity, medicine.id]);
    await connection.query(
      // บันทึกประวัติ: รับเข้า (in) ล็อตไหน จำนวนเท่าไร เหตุผล และใครเป็นผู้ทำ
      `INSERT INTO stock_transactions (medicine_id, change_type, quantity, reason, lot_id, created_by)
       VALUES (?, 'in', ?, ?, ?, ?)`,
      [medicine.id, quantity, (typeof reason === 'string' && reason.trim()) || 'รับสินค้าใหม่', lotId, req.user.id]
    );

    await connection.commit();
    res.json({ message: 'รับยาเข้าสต๊อกสำเร็จ', lotId });
  } catch (err) {
    if (connection) await connection.rollback();
    if (err.status) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// วิธีจัดการยาหมดอายุที่เลือกได้ และข้อความที่บันทึกลงประวัติสต๊อก
const WRITE_OFF_METHODS = { destroy: 'ทำลาย', return: 'คืนผู้จำหน่าย' };

// POST /api/medicines/lots/:lotId/write-off - ตัดยาหมดอายุออกจากสต๊อก (เฉพาะเจ้าของคลินิก)
// ตัดได้เฉพาะล็อตที่หมดอายุแล้วและยังมียาเหลือ ตัดทั้งล็อตในครั้งเดียว
// จำกัดสิทธิ์เพราะเป็นการลดสต๊อกโดยไม่มีใบสั่งยารองรับ ทุกครั้งบันทึกผู้ตัด วิธีจัดการ และหมายเหตุไว้ตรวจสอบย้อนหลัง
router.post('/lots/:lotId/write-off', authenticate, authorize('admin'), async (req, res) => {
  const { method } = req.body;
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (!WRITE_OFF_METHODS[method]) return res.status(400).json({ message: 'กรุณาเลือกวิธีจัดการยาหมดอายุ' });
  if (note.length > 150) return res.status(400).json({ message: 'หมายเหตุยาวเกิน 150 ตัวอักษร' });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // หาว่าล็อตนี้เป็นของยาตัวไหน แล้วล็อกแถวยาก่อนแถวล็อต (ลำดับเดียวกับตอนจ่ายยา กัน deadlock)
    const [[found]] = await connection.query('SELECT medicine_id FROM medicine_lots WHERE id = ?', [req.params.lotId]);
    if (!found) throw failure(404, 'ไม่พบล็อตยา');
    await connection.query('SELECT id FROM medicines WHERE id = ? FOR UPDATE', [found.medicine_id]);
    const [[lot]] = await connection.query(
      `SELECT id, medicine_id, lot_number, quantity_remaining, expiry_date < CURDATE() AS is_expired
       FROM medicine_lots WHERE id = ? FOR UPDATE`,
      [req.params.lotId]
    );
    if (!lot.is_expired) throw failure(409, `ล็อต ${lot.lot_number} ยังไม่หมดอายุ ตัดออกไม่ได้`);
    if (lot.quantity_remaining <= 0) throw failure(409, `ล็อต ${lot.lot_number} ไม่มียาเหลือแล้ว`);

    // ตัดยาที่เหลือทั้งล็อต ลดสต๊อกรวม และบันทึกประวัติเป็นการปรับยอด (adjustment) จำนวนติดลบ
    const quantity = lot.quantity_remaining;
    await connection.query('UPDATE medicine_lots SET quantity_remaining = 0 WHERE id = ?', [lot.id]);
    await connection.query('UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ?', [quantity, lot.medicine_id]);
    await connection.query(
      `INSERT INTO stock_transactions (medicine_id, change_type, quantity, reason, lot_id, created_by)
       VALUES (?, 'adjustment', ?, ?, ?, ?)`,
      [lot.medicine_id, -quantity, `ตัดยาหมดอายุ (${WRITE_OFF_METHODS[method]})${note ? ` · ${note}` : ''}`, lot.id, req.user.id]
    );

    await connection.commit();
    res.json({ message: `ตัดยาหมดอายุล็อต ${lot.lot_number} จำนวน ${quantity} ออกจากสต๊อกแล้ว`, quantity });
  } catch (err) {
    if (connection) await connection.rollback();
    if (err.status) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/medicines/:id/lots - ดูล็อตที่ยังมียาเหลือ เรียงตามลำดับที่ระบบตัดตอนจ่ายยา
// (ยอดยกมาที่ไม่ทราบวันหมดอายุก่อน แล้วตามด้วยล็อตที่หมดอายุก่อน)
router.get('/:id/lots', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.*, l.expiry_date < CURDATE() AS is_expired, u.full_name AS created_by_name
       FROM medicine_lots l
       LEFT JOIN users u ON l.created_by = u.id
       WHERE l.medicine_id = ? AND l.quantity_remaining > 0
       ORDER BY l.expiry_date IS NOT NULL, l.expiry_date, l.id`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// GET /api/medicines/:id/transactions - ดูประวัติการเคลื่อนไหวสต๊อกของยา
router.get('/:id/transactions', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT st.*, u.full_name AS created_by_name, l.lot_number
       FROM stock_transactions st
       LEFT JOIN users u ON st.created_by = u.id
       LEFT JOIN medicine_lots l ON st.lot_id = l.id
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
