// สคริปต์เพิ่มรายการยาเริ่มต้นจาก data/starter-medicines.json
// วิธีใช้: npm run seed:medicines (รันซ้ำได้ ยาที่มีอยู่แล้วจะถูกข้าม)

const pool = require('./config/db');
// รายการยาเริ่มต้นพร้อมชื่อสามัญและกลุ่มยา
const catalog = require('./data/starter-medicines.json');
// ทำทั้งหมดใน transaction เดียว ถ้าเพิ่มยาตัวใดไม่สำเร็จ จะยกเลิกทั้งชุด
(async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    // ดึงรหัสและชื่อยาที่มีอยู่แล้ว เพื่อข้ามยาที่ซ้ำ
    const [existing] = await connection.query('SELECT code, name FROM medicines');
    const codes = new Set(existing.map(m => m.code.toLowerCase()));
    const names = new Set(existing.map(m => m.name.trim().toLowerCase()));
    let added = 0, skipped = 0;
    for (const item of catalog) {
      // ข้ามยาที่มีรหัสหรือชื่อซ้ำกับของเดิม
      if (codes.has(item.code.toLowerCase()) || names.has(item.name.trim().toLowerCase())) { skipped++; continue; }
      // เพิ่มยาใหม่ สต๊อก 0 ราคา 0 จุดสั่งซื้อ 10 (ปรับภายหลังในหน้าคลังยา)
      await connection.query(`INSERT INTO medicines
        (code, name, generic_name, drug_group, category, unit, price_per_unit, stock_quantity, reorder_level, expiry_date)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, 10, NULL)`, [item.code, item.name, item.generic_name, item.drug_group, item.category, item.unit]);
      codes.add(item.code.toLowerCase()); names.add(item.name.trim().toLowerCase()); added++;
    }
    await connection.commit();
    // สรุปผลว่าเพิ่มกี่ตัว ข้ามกี่ตัว
    console.log(JSON.stringify({added, skipped, initialStock:0, initialPrice:0, expiryDate:null}));
  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err.message); process.exitCode = 1;
  } finally { if (connection) connection.release(); await pool.end(); }
})();
