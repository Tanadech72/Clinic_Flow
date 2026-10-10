-- ตารางลำดับเลข HN (ใช้โดย migrate.js กับฐานข้อมูลเดิม) โครงสร้างเดียวกับใน schema.sql
-- มีแถวเดียว เก็บเลข HN ล่าสุด ระบบล็อกแถวนี้แล้วบวก 1 ทุกครั้งที่ลงทะเบียนผู้ป่วยใหม่
CREATE TABLE IF NOT EXISTS patient_hn_sequence (
  id TINYINT PRIMARY KEY,                               -- ใช้ค่า 1 เสมอ
  last_number BIGINT UNSIGNED NOT NULL DEFAULT 0        -- เลข HN ล่าสุดที่ออกไปแล้ว
);
