const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../public/js/patient-metrics');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'patient-metrics-test';
let queries = [];
let lastNumber = 0, highest = 3, failInsert = false, commits = 0, rollbacks = 0;
let transactionTail = Promise.resolve();
const sample = {id: 1, date_of_birth:'2000-10-10', weight_kg:'70.00', height_cm:'175.00'};
const dbPath = require.resolve('../config/db');
const query = async (sql, values) => {
  if (sql.includes('FROM users')) return [[{id:values[0], role:'nurse'}]]; // authenticate middleware
  queries.push({sql, values});
  if (sql.includes('COUNT(*)')) return [[{total:1}]];
  if (sql.includes('SELECT')) return [[sample]];
  return [{affectedRows:1, insertId:1}];
};
require.cache[dbPath] = {id:dbPath, filename:dbPath, loaded:true, exports:{query, getConnection:async () => {
  let unlock, staged;
  return {
    beginTransaction:async () => {
      const preceding = transactionTail;
      transactionTail = new Promise(resolve => {unlock = resolve;});
      await preceding; staged = lastNumber;
    },
    query:async (sql, values) => {
      if(sql.startsWith('SELECT last_number')) { queries.push({sql,values}); return [[{last_number:staged}]]; }
      if(sql.includes('AS highest')) { queries.push({sql,values}); return [[{highest}]]; }
      if(sql.startsWith('UPDATE patient_hn_sequence')) staged = values[0];
      if(sql.includes('INSERT INTO patients') && failInsert) throw Object.assign(Error('Duplicate national id'),{code:'ER_DUP_ENTRY'});
      return query(sql,values);
    },
    commit:async () => { lastNumber=staged;commits++;unlock(); },
    rollback:async () => {rollbacks++;unlock();}, release() {}
  };
}}};
const app = express(); app.use(express.json()); app.use('/api/patients', require('../routes/patients'));
const server = app.listen(0,'127.0.0.1');
test.after(() => server.close());
async function request(method, path, body) {
  if (!server.listening) await new Promise(resolve => server.once('listening',resolve));
  return fetch(`http://127.0.0.1:${server.address().port}/api/patients${path}`, {method, headers:{Authorization:`Bearer ${jwt.sign({id:2,role:'nurse'},process.env.JWT_SECRET)}`, 'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
}
test('age tracks birthdays, valid leap dates, missing and future dates', () => {
  assert.equal(metrics.age('2000-10-10','2026-10-09'),25);
  assert.equal(metrics.age('2000-10-10','2026-10-10'),26);
  assert.equal(metrics.age('2000-10-10','2026-10-11'),26);
  assert.equal(metrics.age('2026-10-09','2026-10-09'),0);
  assert.equal(metrics.age(null),null);
  assert.equal(metrics.age('2027-01-01','2026-10-09'),null);
  assert.equal(metrics.age('2025-02-29','2026-10-09'),null);
  assert.equal(metrics.age('2024-02-29','2026-10-09'),2);
});
test('BMI converts centimetres to metres and handles partial inputs', () => {
  assert.equal(metrics.bmi(70,175),22.9);
  for (const [w,h] of [[null,175],[70,null],[0,175],[70,0],[-70,175],['invalid',175]]) assert.equal(metrics.bmi(w,h),null);
  assert.equal(metrics.measurement('',999),null);
  assert.equal(metrics.measurement('70.25',999),70.25);
  for (const v of [true,[],{},-1,0,'no',1.234,1000]) assert.throws(()=>metrics.measurement(v,999));
});
test('patient API retains age and no longer reads or writes intake measurements', async () => {
  const list = await (await request('GET','')).json();
  assert.equal(list.data[0].age, metrics.age(sample.date_of_birth));
  const detail = await (await request('GET','/1')).json();
  for (const data of [list.data[0], detail.data]) {
    for (const key of ['bmi','weight_kg','height_cm']) assert.equal(key in data,false);
  }
  queries=[];
  const created=await request('POST','',{hn_code:'TEST', first_name:'Test', last_name:'Patient', gender:'other', weight_kg:70.25, height_cm:175});
  assert.equal(created.status,201);
  const insertion = queries.find(q=>q.sql.includes('INSERT INTO patients'));
  assert(!insertion.sql.includes('weight_kg')); assert(!insertion.sql.includes('height_cm'));
  queries=[];
  assert.equal((await request('PUT','/1',{weight_kg:'',height_cm:null})).status,400);
  assert.equal(queries.length,0);
  queries=[];
  assert.equal((await request('PUT','/1',{phone:'0123'})).status,200);
  assert(!queries[0].sql.includes('weight_kg')); assert(!queries[0].sql.includes('height_cm'));
  for (const body of [{date_of_birth:'2099-01-01'}]) {
    queries=[]; assert.equal((await request('PUT','/1',body)).status,400); assert.equal(queries.length,0);
  }
});
test('automatic HN ignores manual input, advances existing sequence, serializes requests and rolls back failures', async () => {
  lastNumber=0; highest=3; queries=[];
  const body={first_name:'Test',last_name:'Patient',gender:'other',hn_code:'USER-SUPPLIED'};
  const created=await request('POST','',body); assert.equal(created.status,201);
  assert.equal((await created.json()).hn_code,'HN0004');
  assert(queries.some(q=>q.sql.includes('FOR UPDATE')));
  const responses = await Promise.all([request('POST','',body),request('POST','',body)]);
  const codes=await Promise.all(responses.map(async r=>{assert.equal(r.status,201);return (await r.json()).hn_code;}));
  assert.deepEqual(codes.sort(),['HN0005','HN0006']);
  failInsert=true; const before=commits;
  assert.equal((await request('POST','',body)).status,409); assert.equal(commits,before); assert.equal(lastNumber,6); assert(rollbacks>0);
  failInsert=false;
  assert.equal((await (await request('POST','',body)).json()).hn_code,'HN0007');
  highest=10000;
  assert.equal((await (await request('POST','',body)).json()).hn_code,'HN10001');
  queries=[];
  assert.equal((await request('POST','',{first_name:'Missing fields'})).status,400); assert.equal(queries.length,0);
});
