-- ============================================
-- Clinic Flow Database Schema (MySQL)
-- ============================================

CREATE DATABASE IF NOT EXISTS clinic_flow
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE clinic_flow;

CREATE TABLE IF NOT EXISTS patient_hn_sequence (
  id TINYINT PRIMARY KEY,
  last_number BIGINT UNSIGNED NOT NULL DEFAULT 0
);

-- ---------------------------------------------
-- ตารางผู้ใช้งานระบบ (สำหรับ Login และสิทธิ์การใช้งาน)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('admin', 'doctor', 'nurse', 'pharmacist', 'staff') NOT NULL DEFAULT 'staff',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------
-- ตารางข้อมูลผู้ป่วย
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  hn_code VARCHAR(20) NOT NULL UNIQUE COMMENT 'เลขประจำตัวผู้ป่วย (Hospital Number)',
  national_id VARCHAR(20) UNIQUE,
  prefix VARCHAR(20),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  gender ENUM('male', 'female', 'other') NOT NULL,
  date_of_birth DATE,
  phone VARCHAR(20),
  address TEXT,
  blood_type VARCHAR(5),
  allergies TEXT COMMENT 'ประวัติการแพ้ยา/อาหาร',
  underlying_conditions TEXT COMMENT 'โรคประจำตัว',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_patient_name (first_name, last_name),
  INDEX idx_national_id (national_id)
);

-- ---------------------------------------------
-- ตารางยาและเวชภัณฑ์
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS medicines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  generic_name VARCHAR(100) COMMENT 'ชื่อสามัญภาษาอังกฤษ ใช้ตรวจประวัติแพ้ยา เช่น ibuprofen',
  drug_group VARCHAR(100) COMMENT 'กลุ่มยา ใช้เตือนแพ้ข้ามยาในกลุ่มเดียวกัน เช่น NSAIDs',
  category VARCHAR(100),
  unit VARCHAR(30) NOT NULL COMMENT 'หน่วยนับ เช่น เม็ด, ขวด, กล่อง',
  price_per_unit DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock_quantity INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 10 COMMENT 'จุดสั่งซื้อเพิ่ม',
  expiry_date DATE COMMENT 'เลิกใช้แล้ว วันหมดอายุแยกตามล็อตใน medicine_lots',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_medicine_name (name)
);

-- ---------------------------------------------
-- ตารางล็อตยา: ยาแต่ละตัวมีได้หลายล็อต แต่ละล็อตมีวันหมดอายุของตัวเอง
-- medicines.stock_quantity = ผลรวม quantity_remaining ของทุกล็อต
-- ---------------------------------------------
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

-- ---------------------------------------------
-- ตารางประวัติการรักษา
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS medical_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  doctor_id INT COMMENT 'ผู้ตรวจรักษา (users.id)',
  visit_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  symptoms TEXT COMMENT 'อาการที่มา',
  diagnosis TEXT COMMENT 'การวินิจฉัย',
  treatment_notes TEXT COMMENT 'บันทึกการรักษา',
  vital_signs JSON COMMENT 'เช่น {"bp":"120/80","temp":36.8,"pulse":72}',
  allergy_override TEXT COMMENT 'เหตุผลที่แพทย์ยืนยันสั่งยาที่ผู้ป่วยมีประวัติแพ้',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_record_patient (patient_id),
  INDEX idx_record_date (visit_date)
);

-- ---------------------------------------------
-- ตารางรายการยาที่จ่ายในแต่ละการรักษา (many-to-many)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS prescriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medical_record_id INT NOT NULL,
  medicine_id INT NOT NULL,
  quantity INT NOT NULL,
  dosage_instructions VARCHAR(255) COMMENT 'วิธีใช้ยา เช่น "1 เม็ด หลังอาหาร เช้า-เย็น"',
  unit_price DECIMAL(10,2) COMMENT 'ราคาต่อหน่วย ณ เวลาที่จ่ายยา (NULL = ยังไม่จ่าย)',
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);

-- ---------------------------------------------
-- ตารางประวัติการเคลื่อนไหวสต๊อกยา (เข้า/ออก)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  change_type ENUM('in', 'out', 'adjustment') NOT NULL,
  quantity INT NOT NULL COMMENT 'จำนวนที่เปลี่ยนแปลง (บวก=รับเข้า, ลบ=จ่ายออก/ปรับลด)',
  reason VARCHAR(255) COMMENT 'เช่น "รับสินค้าใหม่", "จ่ายตามใบสั่งยา #123", "ยาหมดอายุ"',
  reference_id INT COMMENT 'เช่น prescriptions.id เมื่อเป็นการจ่ายยา',
  lot_id INT COMMENT 'ล็อตที่รับเข้า/จ่ายออก (medicine_lots.id)',
  created_by INT COMMENT 'users.id',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  FOREIGN KEY (lot_id) REFERENCES medicine_lots(id),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_stock_medicine (medicine_id)
);

-- หมายเหตุ: สร้างผู้ใช้ admin เริ่มต้นด้วยการรันคำสั่ง `node seed.js`
-- (ดูรายละเอียดใน README.md) แทนการ INSERT รหัสผ่านตรงนี้ เพื่อความปลอดภัย


CREATE TABLE IF NOT EXISTS clinic_visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  nurse_id INT NOT NULL,
  symptoms TEXT,
  vital_signs JSON,
  status ENUM('waiting', 'ready', 'completed', 'cancelled') NOT NULL DEFAULT 'waiting',
  medical_record_id INT UNIQUE,
  dispensed_by INT,
  dispensed_at DATETIME,
  cancelled_by INT COMMENT 'ผู้ยกเลิกคิว (users.id)',
  cancelled_at DATETIME,
  cancel_reason VARCHAR(255) COMMENT 'เหตุผลที่ยกเลิกคิว',
  medicine_total DECIMAL(10,2) COMMENT 'ค่ายารวม ณ เวลาที่จ่ายยา',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (nurse_id) REFERENCES users(id),
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id),
  FOREIGN KEY (dispensed_by) REFERENCES users(id),
  FOREIGN KEY (cancelled_by) REFERENCES users(id),
  INDEX idx_visit_status (status, created_at)
);
