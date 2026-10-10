-- ============================================
-- Clinic Flow Database Schema (MySQL)
-- ============================================
-- ไฟล์นี้ใช้สร้างฐานข้อมูลใหม่ทั้งหมดในครั้งเดียว (เช่น mysql -u root -p < schema.sql)
-- ฐานข้อมูลเดิมที่มีข้อมูลอยู่แล้ว ให้ใช้ npm run migrate แทน เพื่อไม่ให้ข้อมูลหาย
-- ทุกตารางใช้ CREATE TABLE IF NOT EXISTS จึงรันซ้ำได้โดยไม่ error

-- สร้างฐานข้อมูล ใช้ utf8mb4 เพื่อเก็บภาษาไทยและอักขระพิเศษได้ครบ
CREATE DATABASE IF NOT EXISTS clinic_flow
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE clinic_flow;

-- ---------------------------------------------
-- ตารางลำดับเลข HN: มีแถวเดียว (id = 1) เก็บเลข HN ล่าสุดที่ออกไปแล้ว
-- ตอนลงทะเบียนผู้ป่วย ระบบล็อกแถวนี้แล้วบวก 1 กันสองคนได้เลขซ้ำกัน (ดู routes/patients.js)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS patient_hn_sequence (
  id TINYINT PRIMARY KEY,                               -- ใช้ค่า 1 เสมอ
  last_number BIGINT UNSIGNED NOT NULL DEFAULT 0        -- เลข HN ล่าสุดที่ออกไปแล้ว
);

-- ---------------------------------------------
-- ตารางผู้ใช้งานระบบ (สำหรับ Login และสิทธิ์การใช้งาน)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,                 -- ชื่อเข้าสู่ระบบ ห้ามซ้ำ
  password_hash VARCHAR(255) NOT NULL,                  -- รหัสผ่านที่เข้ารหัสด้วย bcrypt (ไม่เก็บรหัสจริง)
  full_name VARCHAR(150) NOT NULL,                      -- ชื่อที่แสดงในระบบ
  -- บทบาท: admin = เจ้าของคลินิก, doctor = แพทย์, nurse = พยาบาล (pharmacist/staff เผื่อขยายในอนาคต)
  role ENUM('admin', 'doctor', 'nurse', 'pharmacist', 'staff') NOT NULL DEFAULT 'staff',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,              -- FALSE = ปิดบัญชี (เข้าสู่ระบบไม่ได้ แต่ประวัติยังอยู่)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP  -- อัปเดตเวลาอัตโนมัติเมื่อแก้แถว
);

-- ---------------------------------------------
-- ตารางข้อมูลผู้ป่วย
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  hn_code VARCHAR(20) NOT NULL UNIQUE COMMENT 'เลขประจำตัวผู้ป่วย (Hospital Number)',
  national_id VARCHAR(20) UNIQUE,                       -- เลขบัตรประชาชน (ไม่บังคับ แต่ถ้ากรอกต้องไม่ซ้ำ)
  prefix VARCHAR(20),                                   -- คำนำหน้า เช่น นาย นาง ด.ช.
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  gender ENUM('male', 'female', 'other') NOT NULL,
  date_of_birth DATE,                                   -- ใช้คำนวณอายุ (ไม่เก็บอายุตรง ๆ เพราะเปลี่ยนทุกปี)
  phone VARCHAR(20),
  address TEXT,
  blood_type VARCHAR(5),                                -- หมู่เลือด เช่น A, B, AB, O
  allergies TEXT COMMENT 'ประวัติการแพ้ยา/อาหาร',       -- คั่นหลายรายการด้วย , หรือ / (ดู public/js/allergy-check.js)
  underlying_conditions TEXT COMMENT 'โรคประจำตัว',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,              -- ระบบไม่ลบผู้ป่วย ใช้ปิดการใช้งานแทน
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_patient_name (first_name, last_name),       -- ช่วยให้ค้นหาผู้ป่วยด้วยชื่อเร็วขึ้น
  INDEX idx_national_id (national_id)
);

-- ---------------------------------------------
-- ตารางยาและเวชภัณฑ์
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS medicines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,                     -- รหัสยา เช่น GEN-PARA500 ห้ามซ้ำ
  name VARCHAR(200) NOT NULL,                           -- ชื่อยาที่แสดง เช่น พาราเซตามอล 500 มก.
  generic_name VARCHAR(100) COMMENT 'ชื่อสามัญภาษาอังกฤษ ใช้ตรวจประวัติแพ้ยา เช่น ibuprofen',
  drug_group VARCHAR(100) COMMENT 'กลุ่มยา ใช้เตือนแพ้ข้ามยาในกลุ่มเดียวกัน เช่น NSAIDs',
  category VARCHAR(100),                                -- หมวดหมู่ เช่น ยาแก้ปวด ยาแก้แพ้
  unit VARCHAR(30) NOT NULL COMMENT 'หน่วยนับ เช่น เม็ด, ขวด, กล่อง',
  price_per_unit DECIMAL(10,2) NOT NULL DEFAULT 0,      -- ราคาขายปัจจุบันต่อหน่วย (DECIMAL ไม่มีปัญหาปัดเศษแบบทศนิยมลอยตัว)
  stock_quantity INT NOT NULL DEFAULT 0,                -- คงเหลือรวมทุกล็อต (เปลี่ยนผ่านรับยาเข้า/จ่ายยาเท่านั้น)
  reorder_level INT NOT NULL DEFAULT 10 COMMENT 'จุดสั่งซื้อเพิ่ม',  -- คงเหลือ <= ค่านี้ ถือว่า "ใกล้หมด"
  expiry_date DATE COMMENT 'เลิกใช้แล้ว วันหมดอายุแยกตามล็อตใน medicine_lots',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,              -- FALSE = เลิกใช้ยานี้ (ไม่ลบ เพราะมีประวัติการจ่ายอ้างอิงอยู่)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_medicine_name (name)
);

-- ---------------------------------------------
-- ตารางล็อตยา: ยาแต่ละตัวมีได้หลายล็อต แต่ละล็อตมีวันหมดอายุของตัวเอง
-- medicines.stock_quantity = ผลรวม quantity_remaining ของทุกล็อต
-- ตอนจ่ายยา ระบบตัดจากล็อตที่หมดอายุก่อน (FEFO) และไม่จ่ายล็อตที่หมดอายุแล้ว (ดู routes/visits.js)
-- ---------------------------------------------
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
  UNIQUE KEY uq_medicine_lot (medicine_id, lot_number), -- ยาตัวเดียวกันห้ามมีเลขล็อตซ้ำ (ยาต่างตัวใช้เลขเดียวกันได้)
  INDEX idx_lot_expiry (medicine_id, expiry_date)       -- ช่วยเรียงล็อตตามวันหมดอายุตอนจ่ายยาให้เร็ว
);

-- ---------------------------------------------
-- ตารางประวัติการรักษา (สร้างตอนแพทย์บันทึกผลตรวจ 1 แถวต่อการตรวจ 1 ครั้ง)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS medical_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  doctor_id INT COMMENT 'ผู้ตรวจรักษา (users.id)',
  visit_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  symptoms TEXT COMMENT 'อาการที่มา',                   -- คัดลอกมาจากที่พยาบาลบันทึกในคิว
  diagnosis TEXT COMMENT 'การวินิจฉัย',
  treatment_notes TEXT COMMENT 'บันทึกการรักษา',
  vital_signs JSON COMMENT 'เช่น {"bp":"120/80","temp":36.8,"pulse":72}',  -- รวมน้ำหนัก ส่วนสูง BMI ของการมาครั้งนั้น
  allergy_override TEXT COMMENT 'เหตุผลที่แพทย์ยืนยันสั่งยาที่ผู้ป่วยมีประวัติแพ้',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_record_patient (patient_id),                -- ดึงประวัติของผู้ป่วยคนหนึ่งได้เร็ว
  INDEX idx_record_date (visit_date)                    -- นับจำนวนการตรวจรายวันในหน้าภาพรวม
);

-- ---------------------------------------------
-- ตารางรายการยาที่จ่ายในแต่ละการรักษา (many-to-many)
-- การรักษา 1 ครั้งสั่งยาได้หลายตัว และยา 1 ตัวถูกสั่งในหลายการรักษา
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS prescriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medical_record_id INT NOT NULL,                       -- สั่งในการรักษาครั้งไหน
  medicine_id INT NOT NULL,                             -- ยาที่สั่ง
  quantity INT NOT NULL,                                -- จำนวนที่สั่ง (หน่วยตาม medicines.unit)
  dosage_instructions VARCHAR(255) COMMENT 'วิธีใช้ยา เช่น "1 เม็ด หลังอาหาร เช้า-เย็น"',
  unit_price DECIMAL(10,2) COMMENT 'ราคาต่อหน่วย ณ เวลาที่จ่ายยา (NULL = ยังไม่จ่าย)',
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);

-- ---------------------------------------------
-- ตารางประวัติการเคลื่อนไหวสต๊อกยา (เข้า/ออก)
-- ทุกครั้งที่สต๊อกเปลี่ยนต้องมีแถวในตารางนี้ จึงตรวจย้อนหลังได้ว่ายาเข้า-ออกเมื่อไร โดยใคร
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  change_type ENUM('in', 'out', 'adjustment') NOT NULL, -- in = รับเข้า, out = จ่ายออก, adjustment = ปรับยอด (เผื่ออนาคต)
  quantity INT NOT NULL COMMENT 'จำนวนที่เปลี่ยนแปลง (บวก=รับเข้า, ลบ=จ่ายออก/ปรับลด)',
  reason VARCHAR(255) COMMENT 'เช่น "รับสินค้าใหม่", "จ่ายตามใบสั่งยา #123", "ยาหมดอายุ"',
  reference_id INT COMMENT 'เช่น prescriptions.id เมื่อเป็นการจ่ายยา',
  lot_id INT COMMENT 'ล็อตที่รับเข้า/จ่ายออก (medicine_lots.id)',
  created_by INT COMMENT 'users.id',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  FOREIGN KEY (lot_id) REFERENCES medicine_lots(id),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_stock_medicine (medicine_id)                -- ดึงประวัติของยาตัวหนึ่งได้เร็ว
);

-- หมายเหตุ: สร้างผู้ใช้ admin เริ่มต้นด้วยการรันคำสั่ง `node seed.js`
-- (ดูรายละเอียดใน README.md) แทนการ INSERT รหัสผ่านตรงนี้ เพื่อความปลอดภัย


-- ---------------------------------------------
-- ตารางคิวการมารับบริการ: 1 แถวต่อการมาคลินิก 1 ครั้ง
-- สถานะ: waiting (รอตรวจ) -> ready (แพทย์ตรวจแล้ว รอจ่ายยา) -> completed (จ่ายยาแล้ว)
--        หรือ cancelled (ยกเลิกระหว่างรอตรวจ/รอจ่ายยา)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  nurse_id INT NOT NULL,                                -- พยาบาลที่บันทึกข้อมูลก่อนตรวจ
  symptoms TEXT,                                        -- อาการสำคัญที่พยาบาลบันทึก
  vital_signs JSON,                                     -- สัญญาณชีพ น้ำหนัก ส่วนสูง BMI ของการมาครั้งนี้
  status ENUM('waiting', 'ready', 'completed', 'cancelled') NOT NULL DEFAULT 'waiting',
  medical_record_id INT UNIQUE,                         -- ผลตรวจของคิวนี้ (ว่างจนกว่าแพทย์จะบันทึก, 1 คิวต่อ 1 ผลตรวจ)
  dispensed_by INT,                                     -- พยาบาลที่ยืนยันจ่ายยา
  dispensed_at DATETIME,                                -- เวลาที่จ่ายยา
  cancelled_by INT COMMENT 'ผู้ยกเลิกคิว (users.id)',
  cancelled_at DATETIME,
  cancel_reason VARCHAR(255) COMMENT 'เหตุผลที่ยกเลิกคิว',
  medicine_total DECIMAL(10,2) COMMENT 'ค่ายารวม ณ เวลาที่จ่ายยา',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- เวลาเข้าคิว ใช้เรียงลำดับคิว
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (nurse_id) REFERENCES users(id),
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id),
  FOREIGN KEY (dispensed_by) REFERENCES users(id),
  FOREIGN KEY (cancelled_by) REFERENCES users(id),
  INDEX idx_visit_status (status, created_at)           -- ดึงคิวตามสถานะเรียงตามเวลาได้เร็ว
);
