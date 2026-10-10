-- ตารางล็อตยา (ใช้โดย migrate.js กับฐานข้อมูลเดิม) โครงสร้างเดียวกับใน schema.sql
-- ยาแต่ละตัวมีได้หลายล็อต แต่ละล็อตมีวันหมดอายุของตัวเอง
-- medicines.stock_quantity = ผลรวม quantity_remaining ของทุกล็อต
CREATE TABLE IF NOT EXISTS medicine_lots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,                             -- เป็นล็อตของยาตัวไหน
  lot_number VARCHAR(50) NOT NULL COMMENT 'เลขที่ล็อต (Lot No.) ตามฉลากหรือใบส่งของ',
  expiry_date DATE COMMENT 'วันหมดอายุของล็อตนี้ (NULL = ยอดยกมาก่อนมีระบบล็อต ไม่ทราบวันหมดอายุ)',
  quantity_received INT NOT NULL COMMENT 'จำนวนที่รับเข้ารวมของล็อตนี้',
  quantity_remaining INT NOT NULL COMMENT 'จำนวนคงเหลือของล็อตนี้',
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INT COMMENT 'ผู้รับเข้าครั้งแรก (users.id)',
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,  -- ถ้าลบผู้ใช้ ล็อตยังอยู่ แค่ไม่รู้ผู้รับ
  UNIQUE KEY uq_medicine_lot (medicine_id, lot_number), -- ยาตัวเดียวกันห้ามมีเลขล็อตซ้ำ
  INDEX idx_lot_expiry (medicine_id, expiry_date)       -- ช่วยเรียงล็อตตามวันหมดอายุตอนจ่ายยาให้เร็ว
);
