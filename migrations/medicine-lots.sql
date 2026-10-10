CREATE TABLE IF NOT EXISTS medicine_lots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  lot_number VARCHAR(50) NOT NULL COMMENT 'เลขที่ล็อต (Lot No.) ตามฉลากหรือใบส่งของ',
  expiry_date DATE COMMENT 'วันหมดอายุของล็อตนี้ (NULL = ยอดยกมาก่อนมีระบบล็อต ไม่ทราบวันหมดอายุ)',
  quantity_received INT NOT NULL COMMENT 'จำนวนที่รับเข้ารวมของล็อตนี้',
  quantity_remaining INT NOT NULL COMMENT 'จำนวนคงเหลือของล็อตนี้',
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INT COMMENT 'ผู้รับเข้าครั้งแรก (users.id)',
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_medicine_lot (medicine_id, lot_number),
  INDEX idx_lot_expiry (medicine_id, expiry_date)
);
