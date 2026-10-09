const fs = require('fs');
const path = require('path');
const pool = require('./config/db');
(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/workflow.sql'), 'utf8'));
    await pool.query(fs.readFileSync(path.join(__dirname, 'migrations/patient-hn.sql'), 'utf8'));
    console.log('Clinic workflow migration complete (existing records preserved).');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
