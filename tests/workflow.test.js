const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'workflow-test-secret';
let queries = [], visit = {id: 1, patient_id: 2, status: 'waiting', symptoms: 'cough', vital_signs: {}, medical_record_id: 9};
let stock = 10, committed = 0, rolledBack = 0;
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
    if (sql.startsWith('SELECT id FROM medicines')) return [[{id: 3}]];
    if (sql.startsWith('SELECT * FROM prescriptions')) return [[{id: 8, medicine_id: 3, quantity: 2}]];
    if (sql.startsWith('SELECT * FROM medicines')) return [[{id: 3, name: 'Test', is_active: 1, stock_quantity: stock}]];
    if (sql.includes("SET status = 'ready'")) visit.status = 'ready';
    if (sql.includes("SET status = 'completed'")) visit.status = 'completed';
    if (sql.startsWith('UPDATE medicines')) stock -= values[0];
    return [{affectedRows: 1}];
  }
};
const dbPath = require.resolve('../config/db');
require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: {getConnection: async () => connection}};
const app = express(); app.use(express.json()); app.use('/api/visits', require('../routes/visits'));
const server = app.listen(0, '127.0.0.1');
test.after(() => server.close());
const request = async (path, role, body = {}) => {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  return fetch(`http://127.0.0.1:${server.address().port}/api/visits${path}`, {method:'POST', headers:{'Content-Type':'application/json', ...(role ? {Authorization: `Bearer ${jwt.sign({id: 4, role}, process.env.JWT_SECRET)}`} : {})}, body:JSON.stringify(body)});
};
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
  assert.equal((await request('/1/dispense', 'nurse')).status, 409);
  assert.equal(stock, 8); assert(rolledBack > 0);
});
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
