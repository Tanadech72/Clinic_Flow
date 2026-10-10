// เทสต์ระบบตรวจแพ้ยา (public/js/allergy-check.js) ไม่ต้องใช้ฐานข้อมูล
// รันด้วย: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const allergy = require('../public/js/allergy-check');

// ยาตัวอย่างสำหรับทดสอบ: ไอบูโพรเฟนกับนาพรอกเซนอยู่กลุ่ม NSAIDs เดียวกัน
const ibuprofen = {id: 2, name: 'ไอบูโพรเฟน 200 มก.', generic_name: 'ibuprofen', drug_group: 'NSAIDs'};
const naproxen = {id: 9, name: 'นาพรอกเซน 250 มก.', generic_name: 'naproxen', drug_group: 'NSAIDs'};
const paracetamol = {id: 1, name: 'พาราเซตามอล 500 มก.', generic_name: 'paracetamol', drug_group: 'Paracetamol'};
const ors = {id: 5, name: 'ผงเกลือแร่ ORS', generic_name: 'oral rehydration salts', drug_group: null};
const catalog = [ibuprofen, naproxen, paracetamol, ors];
// ตัวช่วย: คืนระดับคำเตือน ('direct' / 'group') หรือ null ถ้าไม่เตือน
const level = (allergies, medicine) => allergy.check(allergies, medicine, catalog)?.level || null;

// การแยกคำจากประวัติแพ้ และคำที่แปลว่าไม่แพ้ต้องถูกข้าม
test('allergy text is split into terms and "no allergy" answers are ignored', () => {
  assert.deepEqual(allergy.terms('แพ้ Ibuprofen (ผื่นขึ้น), Penicillin'), ['ibuprofen', 'penicillin']);
  assert.deepEqual(allergy.terms('ซัลฟา และ แอสไพริน / codeine'), ['ซัลฟา', 'แอสไพริน', 'codeine']);
  for (const none of ['', null, '-', '–', 'ไม่มี', 'ไม่แพ้ยา', 'NKDA', 'none']) assert.deepEqual(allergy.terms(none), []);
});

// แพ้ชื่อภาษาอังกฤษต้องเตือนยาชื่อไทย (ผ่านชื่อสามัญ) และพิมพ์ชื่อย่อก็ต้องเจอ
test('English allergy names match Thai medicine names through the generic name', () => {
  assert.equal(level('Ibuprofen', ibuprofen), 'direct');
  assert.equal(level('IBUPROFEN', ibuprofen), 'direct');
  assert.equal(level('แพ้ยา ibuprofen แล้วหน้าบวม', ibuprofen), 'direct');
  assert.equal(level('ไอบูโพรเฟน', ibuprofen), 'direct');
  assert.equal(level('แพ้พารา', paracetamol), 'direct');
});

// แพ้ระบุชื่อกลุ่ม หรือแพ้ยาตัวอื่นในกลุ่มเดียวกัน ต้องได้คำเตือนระดับกลุ่ม
test('drug group allergies and same-group medicines raise a group warning', () => {
  assert.equal(level('NSAIDs', ibuprofen), 'group');
  assert.equal(level('Ibuprofen', naproxen), 'group');
  assert.match(allergy.check('Ibuprofen', naproxen, catalog).reason, /NSAIDs/);
});

// ยาที่ไม่เกี่ยวข้อง หรือข้อมูลไม่ครบ ต้องไม่เตือน
test('unrelated medicines and missing data do not warn', () => {
  assert.equal(level('Ibuprofen', paracetamol), null);
  assert.equal(level('Penicillin', ibuprofen), null);
  assert.equal(level('-', ibuprofen), null);
  assert.equal(level('Ibuprofen', ors), null);
  assert.equal(allergy.check('Ibuprofen', {id: 7, name: 'ยาใหม่', generic_name: null, drug_group: null}, catalog), null);
  assert.equal(allergy.check('Ibuprofen', null, catalog), null);
});

// ตรวจทั้งใบสั่งยา ต้องคืนเฉพาะยาที่มีความเสี่ยง
test('conflicts lists only the risky medicines in an order', () => {
  const found = allergy.conflicts('Ibuprofen', [paracetamol, ibuprofen, naproxen], catalog);
  assert.deepEqual(found.map(c => [c.medicine_id, c.level]), [[2, 'direct'], [9, 'group']]);
});
