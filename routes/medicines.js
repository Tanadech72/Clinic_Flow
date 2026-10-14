// API คลังยา (/api/medicines): ดู/ค้นหายา เพิ่ม แก้ไข รับยาเข้าสต๊อกแยกตามล็อต และดูประวัติการเคลื่อนไหว
// การตัดสต๊อกเกิดตอนพยาบาลยืนยันจ่ายยาเท่านั้น (routes/visits.js) โดยตัดจากล็อตที่หมดอายุก่อน
//
// หมายเหตุ: pool.query() / connection.query() คืนค่าเป็น [แถวข้อมูล, ข้อมูลคอลัมน์]
// จึงเขียน const [rows] = await ... เพื่อเอาเฉพาะแถวข้อมูล แล้วใช้ rows[0] เมื่อต้องการแถวแรก

const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// วิธีจัดการยาหมดอายุที่เลือกได้ และข้อความที่บันทึกลงประวัติสต๊อก
const WRITE_OFF_METHODS = { destroy: 'ทำลาย', return: 'คืนผู้จำหน่าย' };

// สร้าง error ที่มีรหัส HTTP แนบไว้ เพื่อ throw ใน transaction แล้วส่งรหัสนั้นกลับใน catch
function makeError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// เติม 0 ข้างหน้าให้เป็นเลข 2 หลัก เช่น 5 -> "05"
function twoDigits(number) {
  if (number < 10) {
    return '0' + number;
  }
  return String(number);
}

// วันที่วันนี้ตามเวลาเครื่องเซิร์ฟเวอร์ รูปแบบ YYYY-MM-DD
function today() {
  const now = new Date();
  return now.getFullYear() + '-' + twoDigits(now.getMonth() + 1) + '-' + twoDigits(now.getDate());
}

// ตรวจว่าเป็นวันที่ YYYY-MM-DD ที่มีอยู่จริง (กันค่าอย่าง 2026-02-30)
function isValidDate(value) {
  if (typeof value !== 'string') {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(value + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return false;
  }
  // ถ้าวันที่ไม่มีจริง JavaScript จะเลื่อนไปวันอื่น เช่น 2026-02-30 -> 2026-03-02 จึงเทียบกลับว่าตรงกันไหม
  return date.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------
// GET /api/medicines - ดูรายการยาทั้งหมด (รองรับค้นหา)
// ---------------------------------------------------------------
router.get('/', authenticate, async (req, res) => {
  try {
    let search = req.query.search;
    if (search === undefined) {
      search = '';
    }
    const searchTerm = '%' + search + '%';

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
    if (req.query.lowStockOnly === 'true') {
      query = query + ' HAVING m.stock_quantity - expired_quantity <= m.reorder_level';
    }
    query = query + ' ORDER BY m.name ASC';

    const [rows] = await pool.query(query, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// ---------------------------------------------------------------
// POST /api/medicines - เพิ่มยาใหม่
// สต๊อกเริ่มที่ 0 แล้วรับยาเข้าผ่าน stock-in เพื่อให้มีเลขล็อตและวันหมดอายุ
// ---------------------------------------------------------------
router.post('/', authenticate, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    const body = req.body;
    // generic_name และ drug_group ใช้ตรวจประวัติแพ้ยาตอนแพทย์สั่งยา (ดู public/js/allergy-check.js)

    if (!body.code || !body.name || !body.unit) {
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (code, name, unit)' });
    }

    const [result] = await pool.query(
      `INSERT INTO medicines (code, name, generic_name, drug_group, category, unit, price_per_unit, stock_quantity, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        body.code,
        body.name,
        body.generic_name || null,
        body.drug_group || null,
        body.category,
        body.unit,
        body.price_per_unit || 0,
        body.reorder_level || 10,
      ]
    );

    res.status(201).json({ message: 'เพิ่มยาสำเร็จ', medicineId: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'รหัสยานี้มีอยู่แล้วในระบบ' });
    }
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  }
});

// ---------------------------------------------------------------
// PUT /api/medicines/:id - แก้ไขข้อมูลยา (เฉพาะเจ้าของคลินิก)
// เจ้าของคลินิกแก้รหัสยาได้ด้วย โดยรหัสใหม่ต้องไม่ว่างและไม่ซ้ำกับยาตัวอื่น
// ประวัติการจ่ายยาและสต๊อกอ้างอิงยาด้วย id จึงไม่กระทบเมื่อเปลี่ยนรหัส
// ---------------------------------------------------------------
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    if (req.body.code !== undefined) {
      req.body.code = String(req.body.code).trim();
      if (req.body.code === '') {
        return res.status(400).json({ message: 'รหัสยาต้องไม่เป็นค่าว่าง' });
      }
    }

    // ช่องที่อนุญาตให้แก้ไข (ไม่รวมจำนวนสต๊อกและวันหมดอายุ)
    // สต๊อกและวันหมดอายุเปลี่ยนผ่านการรับยาเข้าแยกตามล็อตเท่านั้น เพื่อให้มีประวัติการเคลื่อนไหวเสมอ
    const fields = ['code', 'name', 'generic_name', 'drug_group', 'category', 'unit', 'price_per_unit', 'reorder_level'];
    const updates = [];
    const values = [];

    // สร้างคำสั่ง UPDATE เฉพาะช่องที่ส่งมา
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(field + ' = ?');
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'ไม่มีข้อมูลที่ต้องการแก้ไข' });
    }

    values.push(req.params.id);
    const [result] = await pool.query('UPDATE medicines SET ' + updates.join(', ') + ' WHERE id = ?', values);

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

// ---------------------------------------------------------------
// POST /api/medicines/:id/stock-in - รับยาเข้าสต๊อก ระบุเลขล็อต วันหมดอายุ และจำนวน
// เลขล็อตเดิมที่วันหมดอายุตรงกันจะบวกเข้าล็อตเดิม ถ้าวันหมดอายุไม่ตรงถือว่ากรอกผิด
// ---------------------------------------------------------------
router.post('/:id/stock-in', authenticate, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  const quantity = req.body.quantity;
  const expiryDate = req.body.expiry_date;
  let lotNumber = '';
  if (typeof req.body.lot_number === 'string') {
    lotNumber = req.body.lot_number.trim();
  }
  // เหตุผลการรับเข้า ถ้าไม่ระบุใช้ "รับสินค้าใหม่"
  let reason = 'รับสินค้าใหม่';
  if (typeof req.body.reason === 'string' && req.body.reason.trim() !== '') {
    reason = req.body.reason.trim();
  }

  // ตรวจข้อมูลก่อนแตะฐานข้อมูล
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ message: 'กรุณาระบุจำนวนเป็นจำนวนเต็มบวก' });
  }
  if (lotNumber === '' || lotNumber.length > 50) {
    return res.status(400).json({ message: 'กรุณาระบุเลขที่ล็อต (ไม่เกิน 50 ตัวอักษร)' });
  }
  if (!isValidDate(expiryDate)) {
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

    const [medicineRows] = await connection.query('SELECT id FROM medicines WHERE id = ? FOR UPDATE', [req.params.id]);
    const medicine = medicineRows[0];
    if (!medicine) {
      throw makeError(404, 'ไม่พบข้อมูลยา');
    }

    // ดูว่ามีล็อตเลขนี้ของยานี้อยู่แล้วหรือยัง
    const [lotRows] = await connection.query(
      `SELECT id, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry FROM medicine_lots
       WHERE medicine_id = ? AND lot_number = ? FOR UPDATE`,
      [medicine.id, lotNumber]
    );
    const existingLot = lotRows[0];

    let lotId;
    if (existingLot) {
      // ล็อตเดิม: วันหมดอายุต้องตรงกัน แล้วบวกจำนวนเพิ่ม
      if (existingLot.expiry !== expiryDate) {
        throw makeError(409, 'ล็อต ' + lotNumber + ' มีอยู่แล้ว แต่วันหมดอายุไม่ตรงกับที่บันทึกไว้ กรุณาตรวจสอบเลขล็อตและวันหมดอายุ');
      }
      lotId = existingLot.id;
      await connection.query(
        'UPDATE medicine_lots SET quantity_received = quantity_received + ?, quantity_remaining = quantity_remaining + ? WHERE id = ?',
        [quantity, quantity, lotId]
      );
    } else {
      // ล็อตใหม่: สร้างแถวล็อต
      const [inserted] = await connection.query(
        `INSERT INTO medicine_lots (medicine_id, lot_number, expiry_date, quantity_received, quantity_remaining, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [medicine.id, lotNumber, expiryDate, quantity, quantity, req.user.id]
      );
      lotId = inserted.insertId;
    }

    // เพิ่มสต๊อกรวมของยา
    await connection.query('UPDATE medicines SET stock_quantity = stock_quantity + ? WHERE id = ?', [quantity, medicine.id]);

    // บันทึกประวัติ: รับเข้า (in) ล็อตไหน จำนวนเท่าไร เหตุผล และใครเป็นผู้ทำ
    await connection.query(
      `INSERT INTO stock_transactions (medicine_id, change_type, quantity, reason, lot_id, created_by)
       VALUES (?, 'in', ?, ?, ?, ?)`,
      [medicine.id, quantity, reason, lotId, req.user.id]
    );

    await connection.commit();
    res.json({ message: 'รับยาเข้าสต๊อกสำเร็จ', lotId: lotId });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ---------------------------------------------------------------
// POST /api/medicines/lots/:lotId/write-off - ตัดยาหมดอายุออกจากสต๊อก (เฉพาะเจ้าของคลินิก)
// ตัดได้เฉพาะล็อตที่หมดอายุแล้วและยังมียาเหลือ ตัดทั้งล็อตในครั้งเดียว
// จำกัดสิทธิ์เพราะเป็นการลดสต๊อกโดยไม่มีใบสั่งยารองรับ ทุกครั้งบันทึกผู้ตัด วิธีจัดการ และหมายเหตุไว้ตรวจสอบย้อนหลัง
// ---------------------------------------------------------------
router.post('/lots/:lotId/write-off', authenticate, authorize('admin'), async (req, res) => {
  const method = req.body.method;
  let note = '';
  if (typeof req.body.note === 'string') {
    note = req.body.note.trim();
  }

  if (!WRITE_OFF_METHODS[method]) {
    return res.status(400).json({ message: 'กรุณาเลือกวิธีจัดการยาหมดอายุ' });
  }
  if (note.length > 150) {
    return res.status(400).json({ message: 'หมายเหตุยาวเกิน 150 ตัวอักษร' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // หาว่าล็อตนี้เป็นของยาตัวไหน แล้วล็อกแถวยาก่อนแถวล็อต (ลำดับเดียวกับตอนจ่ายยา กัน deadlock)
    const [foundRows] = await connection.query('SELECT medicine_id FROM medicine_lots WHERE id = ?', [req.params.lotId]);
    if (foundRows.length === 0) {
      throw makeError(404, 'ไม่พบล็อตยา');
    }
    await connection.query('SELECT id FROM medicines WHERE id = ? FOR UPDATE', [foundRows[0].medicine_id]);

    const [lotRows] = await connection.query(
      `SELECT id, medicine_id, lot_number, quantity_remaining, expiry_date < CURDATE() AS is_expired
       FROM medicine_lots WHERE id = ? FOR UPDATE`,
      [req.params.lotId]
    );
    const lot = lotRows[0];
    if (!lot.is_expired) {
      throw makeError(409, 'ล็อต ' + lot.lot_number + ' ยังไม่หมดอายุ ตัดออกไม่ได้');
    }
    if (lot.quantity_remaining <= 0) {
      throw makeError(409, 'ล็อต ' + lot.lot_number + ' ไม่มียาเหลือแล้ว');
    }

    // ตัดยาที่เหลือทั้งล็อต ลดสต๊อกรวม และบันทึกประวัติเป็นการปรับยอด (adjustment) จำนวนติดลบ
    const quantity = lot.quantity_remaining;
    await connection.query('UPDATE medicine_lots SET quantity_remaining = 0 WHERE id = ?', [lot.id]);
    await connection.query('UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ?', [quantity, lot.medicine_id]);

    let reason = 'ตัดยาหมดอายุ (' + WRITE_OFF_METHODS[method] + ')';
    if (note !== '') {
      reason = reason + ' · ' + note;
    }
    await connection.query(
      `INSERT INTO stock_transactions (medicine_id, change_type, quantity, reason, lot_id, created_by)
       VALUES (?, 'adjustment', ?, ?, ?, ?)`,
      [lot.medicine_id, -quantity, reason, lot.id, req.user.id]
    );

    await connection.commit();
    res.json({ message: 'ตัดยาหมดอายุล็อต ' + lot.lot_number + ' จำนวน ' + quantity + ' ออกจากสต๊อกแล้ว', quantity: quantity });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ', error: err.message });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ---------------------------------------------------------------
// GET /api/medicines/:id/lots - ดูล็อตที่ยังมียาเหลือ เรียงตามลำดับที่ระบบตัดตอนจ่ายยา
// (ยอดยกมาที่ไม่ทราบวันหมดอายุก่อน แล้วตามด้วยล็อตที่หมดอายุก่อน)
// ---------------------------------------------------------------
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

// ---------------------------------------------------------------
// GET /api/medicines/:id/transactions - ดูประวัติการเคลื่อนไหวสต๊อกของยา
// ---------------------------------------------------------------
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
