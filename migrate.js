const fs = require('fs');
const path = require('path');
const pool = require('./config/db');
const catalog = require('./data/starter-medicines.json');

// เพิ่มคอลัมน์เฉพาะเมื่อยังไม่มี (MySQL ไม่รองรับ ADD COLUMN IF NOT EXISTS)
async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/workflow.sql'), 'utf8'));
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/patient-hn.sql'), 'utf8'));

    // ระบบเตือนแพ้ยา
    await addColumnIfMissing('medicines', 'generic_name', "VARCHAR(100) COMMENT 'ชื่อสามัญภาษาอังกฤษ ใช้ตรวจประวัติแพ้ยา' AFTER name");
    await addColumnIfMissing('medicines', 'drug_group', "VARCHAR(100) COMMENT 'กลุ่มยา ใช้เตือนแพ้ข้ามยาในกลุ่มเดียวกัน' AFTER generic_name");
    await addColumnIfMissing('medical_records', 'allergy_override', "TEXT COMMENT 'เหตุผลที่แพทย์ยืนยันสั่งยาที่ผู้ป่วยมีประวัติแพ้' AFTER vital_signs");
    let filled = 0;
    for (const item of catalog) {
      const [result] = await pool.query(
        `UPDATE medicines SET generic_name = ?, drug_group = ?
         WHERE generic_name IS NULL AND (code = ? OR TRIM(name) = ?)`,
        [item.generic_name, item.drug_group, item.code, item.name.trim()]
      );
      filled += result.affectedRows;
    }

    console.log(`Clinic workflow migration complete (existing records preserved, generic names filled: ${filled}).`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
