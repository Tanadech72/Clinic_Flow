// เทสต์สิทธิ์แก้ไขข้อมูลยา (routes/medicines.js) ใช้ฐานข้อมูลจำลอง
// รันด้วย: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'medicines-test-secret';

// ฐานข้อมูลจำลอง: ผู้ใช้ 3 บทบาท และยา 2 ตัว (รหัสยาห้ามซ้ำเหมือน UNIQUE ใน MySQL)
const roles = {1: 'admin', 2: 'nurse', 3: 'doctor'};
const medicines = [{id: 1, code: 'GEN-IBU200', name: 'ไอบูโพรเฟน 200 มก.'}, {id: 2, code: 'GEN-PARA500', name: 'พาราเซตามอล 500 มก.'}];
const query = async (sql, values = []) => {
  if (sql.includes('FROM users')) return [[{id: values[0], role: roles[values[0]]}].filter(u => u.role)];
  if (sql.startsWith('UPDATE medicines SET')) {
    const id = Number(values[values.length - 1]);
    const medicine = medicines.find(m => m.id === id);
    if (!medicine) return [{affectedRows: 0}];
    const columns = sql.slice('UPDATE medicines SET '.length, sql.indexOf(' WHERE')).split(', ').map(c => c.replace(' = ?', ''));
    const changes = Object.fromEntries(columns.map((c, i) => [c, values[i]]));
    if (changes.code && medicines.some(m => m.id !== id && m.code === changes.code)) throw Object.assign(Error('dup'), {code: 'ER_DUP_ENTRY'});
    Object.assign(medicine, changes);
    return [{affectedRows: 1}];
  }
  return [[]];
};
const dbPath = require.resolve('../config/db');
require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: {query}};
const app = express(); app.use(express.json()); app.use('/api/medicines', require('../routes/medicines'));
const server = app.listen(0, '127.0.0.1');
test.after(() => server.close());

// ตัวช่วยเรียก PUT /api/medicines/:id ในฐานะผู้ใช้ userId
async function edit(id, userId, body) {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/medicines/${id}`, {
    method: 'PUT', body: JSON.stringify(body),
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({id: userId}, process.env.JWT_SECRET)}`},
  });
  return res.status;
}

// แพทย์และพยาบาลแก้ไขข้อมูลยาไม่ได้ ข้อมูลต้องไม่เปลี่ยน
test('only the clinic owner can edit medicine details', async () => {
  assert.equal(await edit(1, 2, {name: 'แก้โดยพยาบาล'}), 403);
  assert.equal(await edit(1, 3, {name: 'แก้โดยแพทย์'}), 403);
  assert.equal(medicines[0].name, 'ไอบูโพรเฟน 200 มก.');
  assert.equal(await edit(1, 1, {name: 'ไอบูโพรเฟน 400 มก.'}), 200);
  assert.equal(medicines[0].name, 'ไอบูโพรเฟน 400 มก.');
});

// เจ้าของคลินิกแก้รหัสยาได้ แต่รหัสต้องไม่ว่างและไม่ซ้ำกับยาตัวอื่น
test('the owner can change a medicine code to a unique, non-empty value', async () => {
  assert.equal(await edit(1, 1, {code: '   '}), 400);
  assert.equal(await edit(1, 1, {code: 'GEN-PARA500'}), 409);
  assert.equal(medicines[0].code, 'GEN-IBU200');
  assert.equal(await edit(1, 1, {code: '  GEN-IBU400  '}), 200);
  assert.equal(medicines[0].code, 'GEN-IBU400');
  assert.equal(await edit(99, 1, {name: 'ไม่มีจริง'}), 404);
});
