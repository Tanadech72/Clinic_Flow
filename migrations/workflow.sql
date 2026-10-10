-- ตารางคิวการมารับบริการ (ใช้โดย migrate.js กับฐานข้อมูลเดิม) โครงสร้างเดียวกับใน schema.sql
-- 1 แถวต่อการมาคลินิก 1 ครั้ง
-- สถานะ: waiting (รอตรวจ) -> ready (แพทย์ตรวจแล้ว รอจ่ายยา) -> completed (จ่ายยาแล้ว)
--        หรือ cancelled (ยกเลิกระหว่างรอตรวจ/รอจ่ายยา)
CREATE TABLE IF NOT EXISTS clinic_visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  nurse_id INT NOT NULL,                                -- พยาบาลที่บันทึกข้อมูลก่อนตรวจ
  symptoms TEXT,                                        -- อาการสำคัญที่พยาบาลบันทึก
  vital_signs JSON,                                     -- สัญญาณชีพ น้ำหนัก ส่วนสูง BMI ของการมาครั้งนี้
  status ENUM('waiting', 'ready', 'completed', 'cancelled') NOT NULL DEFAULT 'waiting',
  medical_record_id INT UNIQUE,                         -- ผลตรวจของคิวนี้ (ว่างจนกว่าแพทย์จะบันทึก)
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
