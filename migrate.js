// สคริปต์อัปเกรดฐานข้อมูลเดิมให้รองรับฟีเจอร์ใหม่ โดยไม่ลบข้อมูลเดิม
// วิธีใช้: npm run migrate (รันซ้ำได้ ส่วนที่ทำไปแล้วจะถูกข้าม)
// ฐานข้อมูลใหม่ไม่ต้องรัน ใช้ schema.sql ได้เลย

const fs = require('fs');
const path = require('path');
const pool = require('./config/db');
// ใช้เติมชื่อสามัญ/กลุ่มยาให้ยาเดิมที่ยังไม่มีข้อมูล
const catalog = require('./data/starter-medicines.json');

// เพิ่มคอลัมน์เฉพาะเมื่อยังไม่มี (MySQL ไม่รองรับ ADD COLUMN IF NOT EXISTS)
async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// เพิ่ม foreign key เฉพาะเมื่อยังไม่มี (คอลัมน์ที่เพิ่มด้วย addColumnIfMissing จะยังไม่มีความสัมพันธ์)
async function addForeignKeyIfMissing(table, column, refTable, name) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
    [table, column, refTable]
  );
  if (!rows.length) await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${column}) REFERENCES ${refTable}(id)`);
}

(async () => {
  try {
    // สร้างตารางคิว (clinic_visits) และตารางลำดับเลข HN ถ้ายังไม่มี
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/workflow.sql'), 'utf8'));
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/patient-hn.sql'), 'utf8'));

    // ระบบเตือนแพ้ยา
    await addColumnIfMissing('medicines', 'generic_name', "VARCHAR(100) COMMENT 'ชื่อสามัญภาษาอังกฤษ ใช้ตรวจประวัติแพ้ยา' AFTER name");
    await addColumnIfMissing('medicines', 'drug_group', "VARCHAR(100) COMMENT 'กลุ่มยา ใช้เตือนแพ้ข้ามยาในกลุ่มเดียวกัน' AFTER generic_name");
    await addColumnIfMissing('medical_records', 'allergy_override', "TEXT COMMENT 'เหตุผลที่แพทย์ยืนยันสั่งยาที่ผู้ป่วยมีประวัติแพ้' AFTER vital_signs");
    // ยกเลิกคิว
    await pool.query("ALTER TABLE clinic_visits MODIFY status ENUM('waiting', 'ready', 'completed', 'cancelled') NOT NULL DEFAULT 'waiting'");
    await addColumnIfMissing('clinic_visits', 'cancelled_by', "INT COMMENT 'ผู้ยกเลิกคิว (users.id)' AFTER dispensed_at");
    await addColumnIfMissing('clinic_visits', 'cancelled_at', 'DATETIME AFTER cancelled_by');
    await addColumnIfMissing('clinic_visits', 'cancel_reason', "VARCHAR(255) COMMENT 'เหตุผลที่ยกเลิกคิว' AFTER cancelled_at");
    await addForeignKeyIfMissing('clinic_visits', 'cancelled_by', 'users', 'fk_clinic_visits_cancelled_by');
    // บันทึกค่ายาตอนจ่ายยา
    await addColumnIfMissing('prescriptions', 'unit_price', "DECIMAL(10,2) COMMENT 'ราคาต่อหน่วย ณ เวลาที่จ่ายยา' AFTER dosage_instructions");
    await addColumnIfMissing('clinic_visits', 'medicine_total', "DECIMAL(10,2) COMMENT 'ค่ายารวม ณ เวลาที่จ่ายยา' AFTER cancel_reason");
    // แยกสต๊อกยาตามล็อต (เลขล็อต + วันหมดอายุ)
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/medicine-lots.sql'), 'utf8'));
    await addColumnIfMissing('stock_transactions', 'lot_id', "INT COMMENT 'ล็อตที่รับเข้า/จ่ายออก (medicine_lots.id)' AFTER reference_id");
    await addForeignKeyIfMissing('stock_transactions', 'lot_id', 'medicine_lots', 'fk_stock_transactions_lot');
    // ยาที่มีสต๊อกอยู่แล้วแต่ยังไม่มีล็อต: ย้ายยอดเดิมเป็นล็อต "ยอดยกมา" ใช้วันหมดอายุเดิมของยา (ถ้ามี)
    const [carried] = await pool.query(
      `INSERT INTO medicine_lots (medicine_id, lot_number, expiry_date, quantity_received, quantity_remaining)
       SELECT m.id, 'ยอดยกมา', m.expiry_date, m.stock_quantity, m.stock_quantity FROM medicines m
       WHERE m.stock_quantity > 0 AND NOT EXISTS (SELECT 1 FROM medicine_lots l WHERE l.medicine_id = m.id)`
    );
    let filled = 0;
    // เติมชื่อสามัญและกลุ่มยาให้ยาเดิม จับคู่ด้วยรหัสยาหรือชื่อยา (ไม่ทับข้อมูลที่กรอกไว้แล้ว)
    for (const item of catalog) {
      const [result] = await pool.query(
        `UPDATE medicines SET generic_name = ?, drug_group = ?
         WHERE generic_name IS NULL AND (code = ? OR TRIM(name) = ?)`,
        [item.generic_name, item.drug_group, item.code, item.name.trim()]
      );
      filled += result.affectedRows;
    }

    console.log(`Clinic workflow migration complete (existing records preserved, generic names filled: ${filled}, carried-forward lots: ${carried.affectedRows}).`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
