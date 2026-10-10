// เทสต์ระบบคิว (routes/visits.js): บันทึกก่อนตรวจ -> ตรวจรักษา -> จ่ายยา และยกเลิกคิว (ใช้ฐานข้อมูลจำลอง)
// รันด้วย: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'workflow-test-secret';
// สถานะจำลอง: คิว 1 รายการ, สต๊อกยา, จำนวน commit/rollback และประวัติแพ้ยาของผู้ป่วย
// เทสต์แต่ละข้อปรับค่าพวกนี้เพื่อจำลองสถานการณ์ต่าง ๆ
let queries = [], visit = {id: 1, patient_id: 2, status: 'waiting', symptoms: 'cough', vital_signs: {}, medical_record_id: 9};
let stock = 10, committed = 0, rolledBack = 0, allergies = '-';
// connection จำลองของ MySQL: ตอบตามรูปแบบคำสั่ง SQL และอัปเดตสถานะจำลองตามคำสั่ง UPDATE
const connection = {
  beginTransaction: async () => {}, commit: async () => { committed++; }, rollback: async () => { rolledBack++; }, release() {},
  query: async (sql, values) => {
    queries.push({sql, values});
    if (sql.startsWith('SELECT id FROM patients')) return [[{id:2}]];
    if (sql.startsWith('SELECT id FROM clinic_visits')) return [[]];
    if (sql.startsWith('INSERT INTO clinic_visits')) {
      visit = {id:1, patient_id:values[0], symptoms:values[2], vital_signs:JSON.parse(values[3]), status:'waiting'};
      return [{insertId:1}];
    }
    if (sql.startsWith('SELECT * FROM clinic_visits')) return [[{...visit}]];
    if (sql.startsWith('INSERT INTO medical_records')) return [{insertId: 9}];
    if (sql.startsWith('SELECT allergies FROM patients')) return [[{allergies}]];
    if (sql.startsWith('SELECT id, name, generic_name')) return [[{id: 3, name: 'เทสตามอล 500 มก.', generic_name: 'testamol', drug_group: 'Tests'}, {id: 6, name: 'อีกตัว', generic_name: 'othermol', drug_group: 'Tests'}]];
    if (sql.startsWith('SELECT * FROM prescriptions')) return [[{id: 8, medicine_id: 3, quantity: 2}]];
    if (sql.startsWith('SELECT * FROM medicines')) return [[{id: 3, name: 'Test', is_active: 1, stock_quantity: stock, price_per_unit: '12.50'}]];
    if (sql.includes("SET status = 'ready'")) visit.status = 'ready';
    if (sql.includes("SET status = 'completed'")) visit.status = 'completed';
    if (sql.includes("SET status = 'cancelled'")) Object.assign(visit, {status: 'cancelled', cancelled_by: values[0], cancel_reason: values[1]});
    if (sql.startsWith('UPDATE medicines')) stock -= values[0];
    return [{affectedRows: 1}];
  }
};
// บทบาทของผู้ใช้จำลองแต่ละ id (middleware อ่านบทบาทจากฐานข้อมูลทุกครั้ง)
const roleById = {1: 'admin', 4: 'doctor', 5: 'nurse'};
const dbPath = require.resolve('../config/db');
// แทนที่ config/db.js ด้วยฐานข้อมูลจำลอง ก่อนโหลด routes/visits.js
require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: {getConnection: async () => connection, query: async (sql, values) => sql.includes('FROM users') ? [[{id: values[0], role: roleById[values[0]]}].filter(u => u.role)] : [[]]}};
const app = express(); app.use(express.json()); app.use('/api/visits', require('../routes/visits'));
const server = app.listen(0, '127.0.0.1');
test.after(() => server.close());
// ตัวช่วยเรียก POST /api/visits... ในฐานะบทบาทที่ระบุ (null = ไม่ได้ล็อกอิน)
const request = async (path, role, body = {}) => {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  return fetch(`http://127.0.0.1:${server.address().port}/api/visits${path}`, {method:'POST', headers:{'Content-Type':'application/json', ...(role ? {Authorization: `Bearer ${jwt.sign({id: {admin: 1, doctor: 4, nurse: 5}[role], role}, process.env.JWT_SECRET)}`} : {})}, body:JSON.stringify(body)});
};
// สิทธิ์ตามบทบาท, แพทย์สั่งยาแล้วยังไม่ตัดสต๊อก, ตัดสต๊อกครั้งเดียวตอนจ่าย, สต๊อกไม่พอต้องยกเลิกทั้งหมด
test('role authorization, treatment handoff, stock deducted once, shortages roll back', async () => {
  const treatment = {diagnosis:'Test diagnosis', medicines:[{medicine_id:3, quantity:2, dosage_instructions:'After meals'}]};
  assert.equal((await request('/1/treatment', null, treatment)).status, 401);
  assert.equal((await request('/1/treatment', 'nurse', treatment)).status, 403);
  assert.equal((await request('/1/dispense', 'doctor')).status, 403);
  assert.equal((await request('/', 'doctor')).status, 403);
  assert.equal((await request('/1/treatment', 'doctor', {...treatment, medicines:[{medicine_id:3, quantity:-2, dosage_instructions:'x'}]})).status, 400);
  assert.equal((await request('/1/treatment', 'doctor', {...treatment, medicines:[...treatment.medicines,...treatment.medicines]})).status, 400);
  assert.equal((await request('/1/dispense', 'nurse')).status, 409);
  queries = [];
  assert.equal((await request('/1/treatment', 'doctor', treatment)).status, 200);
  assert.equal(stock, 10);
  assert(!queries.some(q => q.sql.startsWith('UPDATE medicines') || q.sql.includes('INSERT INTO stock_transactions')));
  assert.equal(visit.status, 'ready');
  assert.equal((await request('/1/treatment', 'doctor', treatment)).status, 409);
  stock = 1;
  const before = committed;
  assert.equal((await request('/1/dispense', 'nurse')).status, 409);
  assert.equal(stock, 1); assert.equal(visit.status, 'ready'); assert.equal(committed, before);
  stock = 10;
  assert.equal((await request('/1/dispense', 'nurse')).status, 200);
  assert.equal(stock, 8); assert.equal(visit.status, 'completed');
  // บันทึกราคาต่อหน่วย ณ เวลาที่จ่าย และค่ายารวม (12.50 x 2 = 25)
  const priced = queries.find(q => q.sql.startsWith('UPDATE prescriptions SET unit_price'));
  assert.deepEqual(priced.values, [12.5, 8]);
  assert.equal(queries.find(q => q.sql.includes("SET status = 'completed'")).values[1], 25);
  assert.equal((await request('/1/dispense', 'nurse')).status, 409);
  assert.equal(stock, 8); assert(rolledBack > 0);
});
// น้ำหนัก/ส่วนสูงเก็บตามการมาแต่ละครั้ง, เซิร์ฟเวอร์คำนวณ BMI เอง, ค่าผิดรูปแบบถูกปฏิเสธ
test('intake stores measurements per visit, computes BMI on server, and preserves them in treatment', async () => {
  queries=[];
  assert.equal((await request('/', 'nurse', {patient_id:2,symptoms:'Test',vital_signs:{weight_kg:70,height_cm:175,bmi:999}})).status,201);
  assert.deepEqual(visit.vital_signs,{weight_kg:70,height_cm:175,bmi:22.9});
  assert.equal((await request('/1/treatment','doctor',{diagnosis:'Test',medicines:[]})).status,200);
  const saved=queries.find(q=>q.sql.startsWith('INSERT INTO medical_records'));
  assert.deepEqual(JSON.parse(saved.values[5]),{weight_kg:70,height_cm:175,bmi:22.9});
  assert.equal((await request('/', 'nurse', {patient_id:2,symptoms:'Next visit',vital_signs:{weight_kg:60,height_cm:175}})).status,201);
  assert.equal(visit.vital_signs.bmi,19.6);
  assert.equal(JSON.parse(saved.values[5]).weight_kg,70);
  for (const vital_signs of [{weight_kg:-1},{height_cm:0},{weight_kg:1.234},null,[]]) {
    queries=[]; assert.equal((await request('/','nurse',{patient_id:2,symptoms:'Test',vital_signs})).status,400); assert.equal(queries.length,0);
  }
  assert.equal((await request('/','nurse',{patient_id:2,symptoms:'No measurements'})).status,201);
  assert.deepEqual(visit.vital_signs,{weight_kg:null,height_cm:null,bmi:null});
});
// สั่งยาที่แพ้ต้องถูกปฏิเสธจนกว่าแพทย์จะระบุเหตุผล และเหตุผลถูกบันทึกไว้
test('allergy conflicts block treatment until the doctor records a reason', async () => {
  visit = {id: 1, patient_id: 2, status: 'waiting', symptoms: 'rash', vital_signs: {}};
  const treatment = {diagnosis: 'Test', medicines: [{medicine_id: 3, quantity: 1, dosage_instructions: 'Once'}]};
  allergies = 'แพ้ Testamol (ผื่น)';
  queries = [];
  const blocked = await request('/1/treatment', 'doctor', treatment);
  assert.equal(blocked.status, 409);
  const body = await blocked.json();
  assert.equal(body.code, 'ALLERGY_CONFLICT');
  assert.equal(body.conflicts[0].level, 'direct');
  assert(!queries.some(q => q.sql.startsWith('INSERT INTO medical_records')));
  assert.equal(visit.status, 'waiting');
  assert.equal((await request('/1/treatment', 'doctor', {...treatment, allergy_override: '  ok '})).status, 409);
  allergies = 'Othermol';
  assert.equal((await (await request('/1/treatment', 'doctor', treatment)).json()).conflicts[0].level, 'group');
  queries = [];
  assert.equal((await request('/1/treatment', 'doctor', {...treatment, allergy_override: 'ทดสอบแล้วไม่แพ้ เคยใช้ได้'})).status, 200);
  const saved = queries.find(q => q.sql.startsWith('INSERT INTO medical_records'));
  assert.equal(saved.values[6], 'ทดสอบแล้วไม่แพ้ เคยใช้ได้');
  allergies = '-';
  visit = {id: 1, patient_id: 2, status: 'waiting', symptoms: 'cough', vital_signs: {}};
  queries = [];
  assert.equal((await request('/1/treatment', 'doctor', {...treatment, allergy_override: 'ไม่จำเป็นต้องใช้'})).status, 200);
  assert.equal(queries.find(q => q.sql.startsWith('INSERT INTO medical_records')).values[6], null);
});
// ยกเลิกคิวได้เฉพาะคิวที่ยังไม่จ่ายยา ต้องมีเหตุผล และไม่ตัดสต๊อก
test('waiting or ready visits can be cancelled with a reason, finished ones cannot', async () => {
  visit = {id: 1, patient_id: 2, status: 'waiting', symptoms: 'cough', vital_signs: {}};
  assert.equal((await request('/1/cancel', null, {reason: 'กลับก่อนตรวจ'})).status, 401);
  assert.equal((await request('/1/cancel', 'nurse', {})).status, 400);
  assert.equal((await request('/1/cancel', 'nurse', {reason: ' x '})).status, 400);
  assert.equal(visit.status, 'waiting');
  assert.equal((await request('/1/cancel', 'nurse', {reason: '  ผู้ป่วยกลับก่อนตรวจ  '})).status, 200);
  assert.equal(visit.status, 'cancelled');
  assert.equal(visit.cancelled_by, 5);
  assert.equal(visit.cancel_reason, 'ผู้ป่วยกลับก่อนตรวจ');
  assert.equal((await request('/1/cancel', 'doctor', {reason: 'ซ้ำ'})).status, 409);
  assert.equal((await request('/1/treatment', 'doctor', {diagnosis: 'x', medicines: []})).status, 409);
  assert.equal((await request('/1/dispense', 'nurse')).status, 409);

  visit = {id: 1, patient_id: 2, status: 'ready', symptoms: 'cough', vital_signs: {}, medical_record_id: 9};
  const stockBefore = stock;
  assert.equal((await request('/1/cancel', 'doctor', {reason: 'ผู้ป่วยไม่รับยา'})).status, 200);
  assert.equal(visit.status, 'cancelled');
  assert.equal(stock, stockBefore);

  visit = {id: 1, patient_id: 2, status: 'completed', symptoms: 'cough', vital_signs: {}};
  assert.equal((await request('/1/cancel', 'nurse', {reason: 'จ่ายผิด'})).status, 409);
  assert.equal(visit.status, 'completed');
});
// ไฟล์ JS ทุกไฟล์ต้องไม่มี syntax error และระบบต้องไม่มีทางลบผู้ป่วย
test('all frontend scripts parse and legacy routes cannot dispense or delete patients', () => {
  for (const filename of fs.readdirSync('public').filter(f => f.endsWith('.html'))) {
    for (const match of fs.readFileSync(`public/${filename}`, 'utf8').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(match[1]);
  }
  for (const filename of fs.readdirSync('public/js').filter(f => f.endsWith('.js'))) new Function(fs.readFileSync(`public/js/${filename}`, 'utf8'));
  assert(!require('../routes/records').stack.some(s => s.route && s.route.methods.post));
  assert(!require('../routes/patients').stack.some(s => s.route && s.route.methods.delete));
  assert(!fs.readFileSync('public/patients.html', 'utf8').includes('deletePatient'));
  assert(!fs.readFileSync('public/patients.html', 'utf8').includes('weight_kg'));
  assert(!fs.readFileSync('public/patients.html', 'utf8').includes('height_cm'));
  assert(!fs.readFileSync('public/patients.html', 'utf8').includes('BMI'));
});
