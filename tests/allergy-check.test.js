const test = require('node:test');
const assert = require('node:assert/strict');
const allergy = require('../public/js/allergy-check');

const ibuprofen = {id: 2, name: 'ไอบูโพรเฟน 200 มก.', generic_name: 'ibuprofen', drug_group: 'NSAIDs'};
const naproxen = {id: 9, name: 'นาพรอกเซน 250 มก.', generic_name: 'naproxen', drug_group: 'NSAIDs'};
const paracetamol = {id: 1, name: 'พาราเซตามอล 500 มก.', generic_name: 'paracetamol', drug_group: 'Paracetamol'};
const ors = {id: 5, name: 'ผงเกลือแร่ ORS', generic_name: 'oral rehydration salts', drug_group: null};
const catalog = [ibuprofen, naproxen, paracetamol, ors];
const level = (allergies, medicine) => allergy.check(allergies, medicine, catalog)?.level || null;

test('allergy text is split into terms and "no allergy" answers are ignored', () => {
  assert.deepEqual(allergy.terms('แพ้ Ibuprofen (ผื่นขึ้น), Penicillin'), ['ibuprofen', 'penicillin']);
  assert.deepEqual(allergy.terms('ซัลฟา และ แอสไพริน / codeine'), ['ซัลฟา', 'แอสไพริน', 'codeine']);
  for (const none of ['', null, '-', '–', 'ไม่มี', 'ไม่แพ้ยา', 'NKDA', 'none']) assert.deepEqual(allergy.terms(none), []);
});

test('English allergy names match Thai medicine names through the generic name', () => {
  assert.equal(level('Ibuprofen', ibuprofen), 'direct');
  assert.equal(level('IBUPROFEN', ibuprofen), 'direct');
  assert.equal(level('แพ้ยา ibuprofen แล้วหน้าบวม', ibuprofen), 'direct');
  assert.equal(level('ไอบูโพรเฟน', ibuprofen), 'direct');
  assert.equal(level('แพ้พารา', paracetamol), 'direct');
});

test('drug group allergies and same-group medicines raise a group warning', () => {
  assert.equal(level('NSAIDs', ibuprofen), 'group');
  assert.equal(level('Ibuprofen', naproxen), 'group');
  assert.match(allergy.check('Ibuprofen', naproxen, catalog).reason, /NSAIDs/);
});

test('unrelated medicines and missing data do not warn', () => {
  assert.equal(level('Ibuprofen', paracetamol), null);
  assert.equal(level('Penicillin', ibuprofen), null);
  assert.equal(level('-', ibuprofen), null);
  assert.equal(level('Ibuprofen', ors), null);
  assert.equal(allergy.check('Ibuprofen', {id: 7, name: 'ยาใหม่', generic_name: null, drug_group: null}, catalog), null);
  assert.equal(allergy.check('Ibuprofen', null, catalog), null);
});

test('conflicts lists only the risky medicines in an order', () => {
  const found = allergy.conflicts('Ibuprofen', [paracetamol, ibuprofen, naproxen], catalog);
  assert.deepEqual(found.map(c => [c.medicine_id, c.level]), [[2, 'direct'], [9, 'group']]);
});
