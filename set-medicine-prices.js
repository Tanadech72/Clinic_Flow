// สคริปต์ตั้งราคาขายตัวอย่างให้ยาเริ่มต้น
// วิธีใช้: node set-medicine-prices.js

// Example selling prices for the project, in THB per inventory unit.
const pool = require('./config/db');
// ราคาขายตัวอย่าง (บาทต่อหน่วย) จับคู่ด้วยรหัสยา
const prices = {
  'GEN-IBU200':3, 'GEN-LORA10':5, 'GEN-CPM4':1, 'GEN-ORS':10,
  'GEN-OME20':5, 'GEN-METOC10':3, 'GEN-SALB-MDI':180,
  'GEN-CLOTR1':60, 'GEN-HYDRO1':50, 'GEN-PVP10':40,
  'GEN-METFORM500':3, 'GEN-AMLO5':5,
};
(async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let updated = 0;
    for (const [code, price] of Object.entries(prices)) {
      // อัปเดตเฉพาะยาที่ราคายังเป็น 0 เพื่อไม่ทับราคาที่ตั้งเองไว้แล้ว
      const [result] = await connection.query('UPDATE medicines SET price_per_unit = ? WHERE code = ? AND price_per_unit = 0', [price, code]);
      updated += result.affectedRows;
    }
    await connection.commit();
    // แสดงราคาล่าสุดของยาทุกตัวหลังอัปเดต
    const [rows] = await connection.query('SELECT name, unit, price_per_unit FROM medicines WHERE is_active = TRUE ORDER BY id');
    console.log(JSON.stringify({updated, currency:'THB', type:'example selling prices', medicines:rows}));
  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err.message); process.exitCode = 1;
  } finally { if (connection) connection.release(); await pool.end(); }
})();
