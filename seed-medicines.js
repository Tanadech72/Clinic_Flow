const pool = require('./config/db');
const catalog = require('./data/starter-medicines.json');
(async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT code, name FROM medicines');
    const codes = new Set(existing.map(m => m.code.toLowerCase()));
    const names = new Set(existing.map(m => m.name.trim().toLowerCase()));
    let added = 0, skipped = 0;
    for (const item of catalog) {
      if (codes.has(item.code.toLowerCase()) || names.has(item.name.trim().toLowerCase())) { skipped++; continue; }
      await connection.query(`INSERT INTO medicines
        (code, name, category, unit, price_per_unit, stock_quantity, reorder_level, expiry_date)
        VALUES (?, ?, ?, ?, 0, 0, 10, NULL)`, [item.code, item.name, item.category, item.unit]);
      codes.add(item.code.toLowerCase()); names.add(item.name.trim().toLowerCase()); added++;
    }
    await connection.commit();
    console.log(JSON.stringify({added, skipped, initialStock:0, initialPrice:0, expiryDate:null}));
  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err.message); process.exitCode = 1;
  } finally { if (connection) connection.release(); await pool.end(); }
})();
