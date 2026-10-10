// เทสต์ระบบบัญชีผู้ใช้ (routes/auth.js + middleware/auth.js) ใช้ฐานข้อมูลจำลอง
// รันด้วย: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'users-test-secret';

// ฐานข้อมูลจำลองเฉพาะตาราง users: บัญชีเจ้าของคลินิก พยาบาล และแพทย์ รหัสผ่านเริ่มต้น secret1
const hash = bcrypt.hashSync('secret1', 4);
const users = [
  {id: 1, username: 'owner', full_name: 'Owner', role: 'admin', is_active: 1, password_hash: hash},
  {id: 2, username: 'nurse', full_name: 'Nurse', role: 'nurse', is_active: 1, password_hash: hash},
  {id: 3, username: 'doctor', full_name: 'Doctor', role: 'doctor', is_active: 1, password_hash: hash},
];
const byId = id => users.find(u => u.id === Number(id));
// จำลองคำสั่ง SQL ที่ routes/auth.js และ middleware/auth.js ใช้
const query = async (sql, values = []) => {
  if (sql.includes('WHERE username = ? AND is_active = TRUE')) return [users.filter(u => u.username === values[0] && u.is_active)];
  if (sql.includes('WHERE id = ? AND is_active = TRUE')) return [users.filter(u => u.id === Number(values[0]) && u.is_active)];
  if (sql.startsWith('SELECT password_hash')) return [[byId(values[0])].filter(Boolean)];
  if (sql.includes('FROM users WHERE id = ?')) return [[byId(values[0])].filter(Boolean)];
  if (sql.includes('FROM users ORDER BY')) return [users.map(({password_hash, ...u}) => u)];
  if (sql.startsWith('INSERT INTO users')) {
    if (users.some(u => u.username === values[0])) throw Object.assign(Error('dup'), {code: 'ER_DUP_ENTRY'});
    const user = {id: users.length + 1, username: values[0], password_hash: values[1], full_name: values[2], role: values[3], is_active: 1};
    users.push(user); return [{insertId: user.id}];
  }
  if (sql.startsWith('UPDATE users SET full_name')) Object.assign(byId(values[2]), {full_name: values[0], role: values[1]});
  if (sql.startsWith('UPDATE users SET is_active')) byId(values[1]).is_active = values[0] ? 1 : 0;
  if (sql.startsWith('UPDATE users SET password_hash')) byId(values[1]).password_hash = values[0];
  return [{affectedRows: 1}];
};
const dbPath = require.resolve('../config/db');
// แทนที่ config/db.js ด้วยฐานข้อมูลจำลอง ก่อนโหลด routes
require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: {query}};
const authRoutes = require('../routes/auth');
const app = express(); app.use(express.json()); app.use('/api/auth', authRoutes);
const server = app.listen(0, '127.0.0.1');
test.after(() => server.close());

// สร้าง token ของผู้ใช้ตาม id เหมือนตอนเข้าสู่ระบบจริง
const tokenFor = id => jwt.sign({id, role: byId(id)?.role || 'nurse'}, process.env.JWT_SECRET);
// ตัวช่วยเรียก API ในฐานะผู้ใช้ userId (ไม่ส่ง userId = ไม่ได้ล็อกอิน)
async function call(method, path, userId, body) {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${path}`, {
    method, headers: {'Content-Type': 'application/json', ...(userId ? {Authorization: `Bearer ${tokenFor(userId)}`} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  return {status: res.status, body: await res.json()};
}
const login = (username, password) => call('POST', '/login', null, {username, password});

// แพทย์และพยาบาลจัดการบัญชีไม่ได้ (403) รายชื่อไม่มีรหัสผ่าน และไม่มี API ลบบัญชี
test('only the clinic owner can manage accounts', async () => {
  for (const userId of [2, 3]) {
    assert.equal((await call('GET', '/users', userId)).status, 403);
    assert.equal((await call('POST', '/users', userId, {username: 'x', password: 'secret1', full_name: 'X', role: 'nurse'})).status, 403);
    assert.equal((await call('PUT', '/users/2', userId, {full_name: 'X'})).status, 403);
    assert.equal((await call('PATCH', '/users/2/status', userId, {is_active: false})).status, 403);
    assert.equal((await call('POST', '/users/2/reset-password', userId, {password: 'secret2'})).status, 403);
  }
  const list = await call('GET', '/users', 1);
  assert.equal(list.status, 200);
  assert(list.body.data.every(u => !('password_hash' in u)));
  assert(!authRoutes.stack.some(layer => layer.route && layer.route.methods.delete));
});

// สร้างบัญชี: รหัสผ่านสั้นเกิน, บทบาท admin, ชื่อซ้ำ ต้องถูกปฏิเสธ
test('creating accounts validates role, password length and duplicates', async () => {
  const base = {username: 'newnurse', full_name: 'New Nurse', role: 'nurse'};
  assert.equal((await call('POST', '/users', 1, {...base, password: '123'})).status, 400);
  assert.equal((await call('POST', '/users', 1, {...base, password: 'secret1', role: 'admin'})).status, 400);
  assert.equal((await call('POST', '/users', 1, {...base, password: 'secret1'})).status, 201);
  assert.equal((await call('POST', '/users', 1, {...base, password: 'secret1'})).status, 409);
  assert.equal((await login('newnurse', 'secret1')).status, 200);
});

// เปลี่ยนบทบาทมีผลทันทีแม้ token เดิม และห้ามเปลี่ยนบทบาทตัวเอง/เจ้าของคลินิก
test('role changes apply immediately and protect the owner account', async () => {
  assert.equal((await call('PUT', '/users/1', 1, {full_name: 'Owner', role: 'doctor'})).status, 400);
  assert.equal((await call('PUT', '/users/1', 1, {full_name: 'Clinic Owner'})).status, 200);
  assert.equal(byId(1).full_name, 'Clinic Owner');
  assert.equal((await call('PUT', '/users/2', 1, {full_name: 'Nurse', role: 'admin'})).status, 400);
  assert.equal((await call('PUT', '/users/2', 1, {full_name: '  '})).status, 400);
  assert.equal((await call('PUT', '/users/2', 1, {full_name: 'Nurse Now Doctor', role: 'doctor'})).status, 200);
  const me = await call('GET', '/me', 2); // token still says nurse, database says doctor
  assert.equal(me.body.user.role, 'doctor');
  assert.equal((await call('PUT', '/users/2', 1, {full_name: 'Nurse', role: 'nurse'})).status, 200);
  assert.equal((await call('PUT', '/users/99', 1, {full_name: 'Ghost'})).status, 404);
});

// ปิดบัญชีแล้วใช้ token เดิมและล็อกอินใหม่ไม่ได้ทันที เปิดกลับแล้วใช้ได้
test('deactivated accounts are blocked immediately and can be reactivated', async () => {
  assert.equal((await call('PATCH', '/users/1/status', 1, {is_active: false})).status, 400);
  assert.equal((await call('PATCH', '/users/3/status', 1, {is_active: 'no'})).status, 400);
  assert.equal((await call('PATCH', '/users/3/status', 1, {is_active: false})).status, 200);
  assert.equal((await call('GET', '/me', 3)).status, 401);
  assert.equal((await login('doctor', 'secret1')).status, 401);
  assert.equal((await call('PATCH', '/users/3/status', 1, {is_active: true})).status, 200);
  assert.equal((await call('GET', '/me', 3)).status, 200);
  assert.equal((await login('doctor', 'secret1')).status, 200);
});

// รีเซ็ตรหัสผ่านโดยเจ้าของคลินิก และผู้ใช้เปลี่ยนรหัสผ่านเอง (ต้องรู้รหัสเดิม)
test('owner resets a password and users change their own', async () => {
  assert.equal((await call('POST', '/users/3/reset-password', 1, {password: '12'})).status, 400);
  assert.equal((await call('POST', '/users/3/reset-password', 1, {password: 'reset99'})).status, 200);
  assert.equal((await login('doctor', 'secret1')).status, 401);
  assert.equal((await login('doctor', 'reset99')).status, 200);

  assert.equal((await call('PUT', '/me/password', 3, {current_password: 'wrong', new_password: 'mine123'})).status, 400);
  assert.equal((await call('PUT', '/me/password', 3, {current_password: 'reset99', new_password: '123'})).status, 400);
  assert.equal((await call('PUT', '/me/password', 3, {current_password: 'reset99', new_password: 'reset99'})).status, 400);
  assert.equal((await call('PUT', '/me/password', 3, {current_password: 'reset99', new_password: 'mine123'})).status, 200);
  assert.equal((await login('doctor', 'reset99')).status, 401);
  assert.equal((await login('doctor', 'mine123')).status, 200);
});
