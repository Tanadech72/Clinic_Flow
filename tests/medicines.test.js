// เทสต์สิทธิ์แก้ไขข้อมูลยา และการรับยาเข้าแยกตามล็อต (routes/medicines.js) ใช้ฐานข้อมูลจำลอง
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
// connection จำลองสำหรับรับยาเข้า: เก็บล็อต สต๊อกรวม และประวัติการเคลื่อนไหว
const lots = [], transactions = [], stockById = {1: 0, 2: 0};
let committed = 0;
const connection = {
  beginTransaction: async () => {}, commit: async () => { committed++; }, rollback: async () => {}, release() {},
  query: async (sql, values) => {
    if (sql.startsWith('SELECT id FROM medicines')) return [medicines.filter(m => m.id === Number(values[0])).map(m => ({id: m.id}))];
    if (sql.startsWith('SELECT id, DATE_FORMAT')) return [lots.filter(l => l.medicine_id === values[0] && l.lot_number === values[1]).map(l => ({id: l.id, expiry: l.expiry_date}))];
    if (sql.startsWith('INSERT INTO medicine_lots')) {
      const [medicine_id, lot_number, expiry_date, quantity_received, quantity_remaining] = values;
      lots.push({id: lots.length + 1, medicine_id, lot_number, expiry_date, quantity_received, quantity_remaining});
      return [{insertId: lots.length}];
    }
    // ตัดยาหมดอายุ: หาล็อต, อ่านล็อตพร้อมสถานะหมดอายุ (เทียบกับวันนี้), ล้างยอดคงเหลือของล็อต
    if (sql.startsWith('SELECT medicine_id FROM medicine_lots')) return [lots.filter(l => l.id === Number(values[0]))];
    if (sql.startsWith('SELECT id, medicine_id, lot_number')) {
      const today = new Date().toISOString().slice(0, 10);
      return [lots.filter(l => l.id === Number(values[0])).map(l => ({...l, is_expired: l.expiry_date < today ? 1 : 0}))];
    }
    if (sql.startsWith('UPDATE medicine_lots SET quantity_remaining = 0')) { lots.find(l => l.id === values[0]).quantity_remaining = 0; return [{affectedRows: 1}]; }
    if (sql.startsWith('UPDATE medicine_lots')) {
      const lot = lots.find(l => l.id === values[2]);
      lot.quantity_received += values[0]; lot.quantity_remaining += values[1];
    }
    if (sql.startsWith('UPDATE medicines SET stock_quantity')) stockById[values[1]] += sql.includes('- ?') ? -values[0] : values[0];
    if (sql.startsWith('INSERT INTO stock_transactions')) transactions.push({medicine_id: values[0], quantity: values[1], reason: values[2], lot_id: values[3]});
    return [{affectedRows: 1}];
  },
};
const dbPath = require.resolve('../config/db');
require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: {query, getConnection: async () => connection}};
const app = express(); app.use(express.json()); app.use('/api/medicines', require('../routes/medicines'));
const server = app.listen(0, '127.0.0.1');
test.after(() => server.close());

// ตัวช่วยเรียก API ในฐานะผู้ใช้ userId แล้วคืนรหัสสถานะ HTTP
async function call(method, path, userId, body) {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/medicines${path}`, {
    method, body: JSON.stringify(body),
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({id: userId}, process.env.JWT_SECRET)}`},
  });
  return res.status;
}
// POST /api/medicines/lots/:lotId/write-off
const writeOff = (lotId, userId, body) => call('POST', `/lots/${lotId}/write-off`, userId, body);
// PUT /api/medicines/:id
const edit = (id, userId, body) => call('PUT', `/${id}`, userId, body);
// POST /api/medicines/:id/stock-in
const stockIn = (id, userId, body) => call('POST', `/${id}/stock-in`, userId, body);

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

// รับยาเข้าต้องระบุเลขล็อต วันหมดอายุ (ยังไม่หมดอายุ) และจำนวนเต็มบวก ค่าผิดต้องไม่แตะฐานข้อมูล
test('stock-in requires a lot number, a valid future expiry date and a positive quantity', async () => {
  const lot = {lot_number: 'A2410', expiry_date: '2099-12-31', quantity: 20};
  for (const body of [{...lot, lot_number: '  '}, {...lot, lot_number: undefined}, {...lot, lot_number: 'x'.repeat(51)},
    {...lot, expiry_date: undefined}, {...lot, expiry_date: '2099-02-30'}, {...lot, expiry_date: '31/12/2099'}, {...lot, expiry_date: '2000-01-01'},
    {...lot, quantity: 0}, {...lot, quantity: -5}, {...lot, quantity: 1.5}, {...lot, quantity: '20'}]) {
    assert.equal(await stockIn(1, 2, body), 400, JSON.stringify(body));
  }
  assert.equal(lots.length, 0); assert.equal(committed, 0);
  assert.equal(await stockIn(99, 2, lot), 404);
  assert.equal(lots.length, 0);
});

// ล็อตใหม่สร้างแถวล็อต ล็อตเดิมวันหมดอายุเดียวกันบวกเพิ่ม วันหมดอายุไม่ตรงถูกปฏิเสธ สต๊อกรวมและประวัติตรงกันเสมอ
test('stock-in creates or tops up a lot and keeps the total stock and history in sync', async () => {
  assert.equal(await stockIn(1, 2, {lot_number: ' A2410 ', expiry_date: '2099-12-31', quantity: 20}), 200);
  assert.equal(await stockIn(1, 3, {lot_number: 'B2501', expiry_date: '2099-06-30', quantity: 5, reason: 'รับบริจาค'}), 200);
  assert.equal(await stockIn(1, 1, {lot_number: 'A2410', expiry_date: '2099-12-31', quantity: 10}), 200);
  assert.equal(await stockIn(1, 2, {lot_number: 'A2410', expiry_date: '2098-01-01', quantity: 10}), 409);
  assert.deepEqual(lots.map(l => [l.lot_number, l.expiry_date, l.quantity_received, l.quantity_remaining]),
    [['A2410', '2099-12-31', 30, 30], ['B2501', '2099-06-30', 5, 5]]);
  assert.equal(stockById[1], 35);
  assert.deepEqual(transactions.map(t => [t.quantity, t.lot_id, t.reason]),
    [[20, 1, 'รับสินค้าใหม่'], [5, 2, 'รับบริจาค'], [10, 1, 'รับสินค้าใหม่']]);
  // ล็อตเดียวกันของยาต่างตัวเป็นคนละล็อต
  assert.equal(await stockIn(2, 2, {lot_number: 'A2410', expiry_date: '2097-01-01', quantity: 3}), 200);
  assert.equal(lots.length, 3); assert.equal(stockById[2], 3);
});

// ตัดยาหมดอายุได้เฉพาะเจ้าของคลินิก เฉพาะล็อตที่หมดอายุแล้ว ตัดทั้งล็อต และบันทึกประวัติแบบปรับยอด
test('only the owner can write off an expired lot, once, with a recorded reason', async () => {
  // เตรียมล็อตหมดอายุของยาตัวที่ 2 จำนวน 4 (เพิ่มตรงในฐานข้อมูลจำลอง เพราะ API ไม่รับยาหมดอายุเข้า)
  lots.push({id: lots.length + 1, medicine_id: 2, lot_number: 'OLD1', expiry_date: '2000-01-01', quantity_received: 4, quantity_remaining: 4});
  const expiredId = lots.length;
  stockById[2] += 4;
  const stockBefore = stockById[2], historyBefore = transactions.length;

  assert.equal(await writeOff(expiredId, 2, {method: 'destroy'}), 403);
  assert.equal(await writeOff(expiredId, 3, {method: 'destroy'}), 403);
  assert.equal(await writeOff(expiredId, 1, {method: 'burn'}), 400);
  assert.equal(await writeOff(expiredId, 1, {method: 'destroy', note: 'x'.repeat(151)}), 400);
  assert.equal(await writeOff(999, 1, {method: 'destroy'}), 404);
  // ล็อต A2410 ยังไม่หมดอายุ (2099) ตัดไม่ได้
  assert.equal(await writeOff(1, 1, {method: 'destroy'}), 409);
  assert.equal(stockById[2], stockBefore); assert.equal(transactions.length, historyBefore);

  assert.equal(await writeOff(expiredId, 1, {method: 'return', note: ' ใบคืน #12 '}), 200);
  assert.equal(lots[expiredId - 1].quantity_remaining, 0);
  assert.equal(stockById[2], stockBefore - 4);
  assert.deepEqual(transactions.at(-1), {medicine_id: 2, quantity: -4, reason: 'ตัดยาหมดอายุ (คืนผู้จำหน่าย) · ใบคืน #12', lot_id: expiredId});
  // ตัดซ้ำไม่ได้ เพราะไม่มียาเหลือแล้ว
  assert.equal(await writeOff(expiredId, 1, {method: 'destroy'}), 409);
  assert.equal(stockById[2], stockBefore - 4);
});
