(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token = localStorage.getItem('token');
  let user, visits = [], medicines = [], selected, filter, busy = false;
  const doctor = document.body.dataset.workspace === 'doctor';
  const labels = { waiting: 'รอตรวจ', ready: 'รอจ่ายยา', completed: 'เสร็จสิ้นวันนี้' };
  const name = v => `${escape(v.hn_code)} · ${escape(v.prefix || '')}${escape(v.first_name)} ${escape(v.last_name)}`;
  const patientPanel = document.createElement('section');
  patientPanel.id = 'intakePatientDetails'; patientPanel.className = 'patient-summary';
  patientPanel.setAttribute('aria-live', 'polite');
  $('patient').after(patientPanel);
  let patientDetailSerial = 0, intakePatientReady = false;
  function clearPatientDetails() {
    patientDetailSerial++; intakePatientReady = false;
    patientPanel.innerHTML = '<p class="muted">เลือกผู้ป่วยเพื่อแสดงข้อมูลให้หมอประกอบการตรวจ</p>';
  }
  function patientSummary(p) {
    const age = PatientMetrics.age(p.date_of_birth);
    const gender = {male:'ชาย',female:'หญิง',other:'อื่น ๆ'}[p.gender] || 'ไม่ระบุ';
    return `<h3>${name(p)}</h3><div class="patient-detail-grid"><span><small>อายุ</small><strong>${age === null ? 'ไม่ระบุ' : age + ' ปี'}</strong></span><span><small>เพศ</small><strong>${gender}</strong></span><span><small>กรุ๊ปเลือด</small><strong>${escape(p.blood_type || 'ไม่ระบุ')}</strong></span><span><small>วันเกิด</small><strong>${escape(p.date_of_birth ? String(p.date_of_birth).split('T')[0] : 'ไม่ระบุ')}</strong></span></div><div class="patient-medical"><p><strong>ประวัติแพ้ยา:</strong> ${escape(p.allergies || 'ยังไม่ระบุ')}</p><p><strong>โรคประจำตัว:</strong> ${escape(p.underlying_conditions || 'ยังไม่ระบุ')}</p></div><details class="patient-contact"><summary>ข้อมูลติดต่อผู้ป่วย</summary><p>เบอร์โทร: ${escape(p.phone || 'ไม่ระบุ')}<br>ที่อยู่: ${escape(p.address || 'ไม่ระบุ')}</p></details>`;
  }
  async function loadPatientDetails() {
    const id = $('patient').value;
    clearPatientDetails();
    if (!id) return;
    const serial = patientDetailSerial;
    patientPanel.innerHTML = '<p class="muted">กำลังดึงข้อมูลผู้ป่วย…</p>';
    try {
      const result = await api(`/api/patients/${encodeURIComponent(id)}`);
      if (serial !== patientDetailSerial || $('patient').value !== id) return;
      patientPanel.innerHTML = patientSummary(result.data); intakePatientReady = true;
    } catch (err) {
      if (serial !== patientDetailSerial) return;
      patientPanel.textContent = `${err.message} กรุณาเลือกผู้ป่วยอีกครั้ง`;
    }
  }
  async function api(url, method = 'GET', body) {
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? {body: JSON.stringify(body)} : {}) });
    const result = await res.json();
    if (res.status === 401) { localStorage.clear(); location.replace('/'); throw Error('กรุณาเข้าสู่ระบบใหม่'); }
    if (!res.ok) throw Error(result.message || 'ดำเนินการไม่สำเร็จ');
    return result;
  }
  const notice = error => { $('notice').textContent = error ? error.message : ''; };
  const vitals = v => { try { return typeof v.vital_signs === 'string' ? JSON.parse(v.vital_signs) : v.vital_signs || {}; } catch { return {}; } };
  function bodyMeasurements(vs) {
    const bmi = PatientMetrics.bmi(vs.weight_kg, vs.height_cm);
    return `<div class="meta"><span>น้ำหนัก ${escape(vs.weight_kg ?? '-')} กก.</span><span>ส่วนสูง ${escape(vs.height_cm ?? '-')} ซม.</span><span>BMI ${bmi === null ? '-' : bmi.toFixed(1)}</span></div>`;
  }
  function updateIntakeBmi() {
    const bmi = PatientMetrics.bmi($('intake_weight_kg').value, $('intake_height_cm').value);
    $('intake_bmi').value = bmi === null ? '' : bmi.toFixed(1);
  }
  const medicineNotice = document.createElement('p');
  medicineNotice.className = 'field-help'; medicineNotice.setAttribute('role', 'status');
  medicineNotice.setAttribute('aria-live', 'polite'); $('medicineRows').after(medicineNotice);
  function syncMedicineChoices() {
    const selects = [...$('medicineRows').querySelectorAll('select')];
    const chosen = new Set(selects.map(select => select.value).filter(Boolean));
    selects.forEach(select => {
      [...select.options].forEach(option => {
        if (!option.dataset.label) option.dataset.label = option.textContent;
        option.disabled = Boolean(option.value && option.value !== select.value && chosen.has(option.value));
        option.textContent = option.dataset.label + (option.disabled ? ' (เลือกแล้ว)' : '');
      });
    });
    $('addMedicine').disabled = selects.length >= medicines.length;
  }
  $('medicineRows').addEventListener('change', event => {
    const select = event.target;
    if (select.tagName !== 'SELECT') return;
    const duplicate = select.value && [...$('medicineRows').querySelectorAll('select')].some(other => other !== select && other.value === select.value);
    if (duplicate) {
      select.value = ''; medicineNotice.textContent = 'ยานี้ถูกเลือกแล้ว กรุณาปรับจำนวนในรายการเดิมหรือเลือกยาอื่น';
    } else { medicineNotice.textContent = ''; }
    syncMedicineChoices();
  });
  function info(v) {
    const vs = vitals(v);
    return `<section class="patient-summary">${patientSummary(v)}</section><p><strong>อาการครั้งนี้:</strong> ${escape(v.symptoms || '-')}</p><div class="meta"><span>BP ${escape(vs.bp || '-')}</span><span>ชีพจร ${escape(vs.pulse || '-')}</span><span>อุณหภูมิ ${escape(vs.temp || '-')} °C</span></div>${bodyMeasurements(vs)}`;
  }
  function prescriptions(items) {
    if (!items.length) return '<p class="muted">ไม่มีรายการยา</p>';
    return `<table><thead><tr><th>ยา</th><th>จำนวน</th><th>วิธีใช้</th></tr></thead><tbody>${items.map(p => `<tr><td>${escape(p.name || p.medicine_name)}</td><td>${escape(p.quantity)} ${escape(p.unit)}</td><td>${escape(p.dosage_instructions)}</td></tr>`).join('')}</tbody></table>`;
  }
  function render() {
    const step = filter === 'completed' ? -1 : filter === 'ready' ? 2 : doctor ? 1 : 0;
    document.querySelectorAll('.flow span').forEach((span, index) => {
      span.classList.toggle('current', index === step);
      if (index === step) span.setAttribute('aria-current', 'step');
      else span.removeAttribute('aria-current');
    });
    $('filters').innerHTML = `${!doctor ? '<button id="newIntake">+ บันทึกก่อนตรวจ</button><a class="button secondary" href="/patients.html">ลงทะเบียนผู้ป่วยใหม่</a>' : ''}${Object.keys(labels).map(s => `<button class="${filter === s ? 'active' : 'secondary'}" data-filter="${s}">${labels[s]} (${visits.filter(v => v.status === s).length})</button>`).join('')}<button class="secondary" id="refresh">รีเฟรชคิว</button>`;
    const rows = visits.filter(v => v.status === filter);
    $('queue').innerHTML = rows.length ? rows.map(v => `<article class="card"><div class="card-top"><div>${info(v)}</div><span class="tag ${v.status}">${labels[v.status]}</span></div>${v.diagnosis ? `<p><strong>การวินิจฉัย:</strong> ${escape(v.diagnosis)}<br><strong>คำสั่งแพทย์:</strong> ${escape(v.treatment_notes || '-')}<br><span class="muted">แพทย์: ${escape(v.doctor_name)}</span></p>${prescriptions(v.prescriptions)}` : ''}<div class="actions"><button class="secondary" data-history="${v.patient_id}">ดูประวัติ</button>${doctor && v.status === 'waiting' ? `<button data-treat="${v.id}">ตรวจรักษา</button>` : ''}${!doctor && v.status === 'ready' ? `<button data-dispense="${v.id}">${v.prescriptions.length ? 'ตรวจสอบและจ่ายยา' : 'ปิดคิว · ไม่มียา'}</button>` : ''}</div></article>`).join('') : `<div class="empty"><h3>${filter === 'completed' ? 'ยังไม่มีคิวที่เสร็จสิ้นวันนี้' : `ไม่มีผู้ป่วย${labels[filter]}`}</h3><p>${doctor ? 'เมื่อพยาบาลบันทึกข้อมูลก่อนตรวจ คิวผู้ป่วยจะแสดงที่นี่' : filter === 'ready' ? 'เมื่อหมอตรวจเสร็จ รายการจ่ายยาจะแสดงที่นี่' : 'เลือก “บันทึกก่อนตรวจ” เพื่อส่งผู้ป่วยเข้าคิว'}</p></div>`;
  }
  async function refresh() { try { visits = (await api('/api/visits')).data; render(); notice(); } catch (err) { notice(err); $('queue').innerHTML = '<div class="card empty">โหลดคิวไม่สำเร็จ กรุณาลองรีเฟรช</div>'; } }
  let searchSerial = 0;
  async function patients() {
    const serial = ++searchSerial;
    clearPatientDetails();
    $('patient').innerHTML = '<option value="">กำลังค้นหาผู้ป่วย…</option>';
    try {
      const result = await api(`/api/patients?limit=100&search=${encodeURIComponent($('patientSearch').value)}`);
      if (serial !== searchSerial) return;
      $('patient').innerHTML = '<option value="">เลือกผู้ป่วย</option>' + result.data.map(p => `<option value="${p.id}">${name(p)}</option>`).join('');
    } catch (err) { notice(err); }
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-close')) { button.closest('dialog').close(); return; }
    if (button.dataset.filter) { filter = button.dataset.filter; render(); }
    if (button.id === 'refresh') await refresh();
    if (button.id === 'newIntake') { filter = 'waiting'; render(); $('intakeForm').reset(); $('intakeDialog').showModal(); await patients(); }
    if (button.dataset.treat) {
      selected = visits.find(v => v.id === Number(button.dataset.treat));
      $('treatmentForm').reset(); $('medicineRows').innerHTML = ''; medicineNotice.textContent = ''; $('treatmentPatient').innerHTML = info(selected);
      try { medicines = (await api('/api/medicines')).data; syncMedicineChoices(); $('treatmentDialog').showModal(); } catch (err) { notice(err); }
    }
    if (button.id === 'addMedicine') {
      if ($('medicineRows').children.length >= medicines.length) return;
      const row = document.createElement('div'); row.className = 'medicine-row';
      row.innerHTML = `<select aria-label="ยา" required><option value="">เลือกยา</option>${medicines.map(m => `<option value="${m.id}">${escape(m.name)} · เหลือ ${m.stock_quantity} ${escape(m.unit)}</option>`).join('')}</select><input type="number" aria-label="จำนวนยา" min="1" step="1" required placeholder="จำนวน"><input aria-label="วิธีใช้" required placeholder="วิธีใช้"><button type="button" class="secondary" data-remove>เอาออก</button>`;
      $('medicineRows').append(row);
      syncMedicineChoices();
    }
    if (button.hasAttribute('data-remove')) { button.parentElement.remove(); medicineNotice.textContent = ''; syncMedicineChoices(); }
    if (button.dataset.dispense) {
      selected = visits.find(v => v.id === Number(button.dataset.dispense)); $('dispenseForm').reset();
      $('dispenseDetails').innerHTML = `${info(selected)}<p>การวินิจฉัย: ${escape(selected.diagnosis)}<br>คำสั่งแพทย์: ${escape(selected.treatment_notes || '-')}</p>${prescriptions(selected.prescriptions)}`;
      $('dispenseSubmit').textContent = selected.prescriptions.length ? 'ยืนยันจ่ายยาและตัดสต๊อก' : 'ยืนยันปิดคิว';
      $('dispenseDialog').showModal();
    }
    if (button.dataset.history) {
      $('historyDetails').textContent = 'กำลังโหลด…'; $('historyDialog').showModal();
      try {
        const result = await api(`/api/records/patient/${button.dataset.history}`);
        $('historyDetails').innerHTML = result.data.length ? result.data.map(r => `<div class="card"><p>${escape(r.visit_date)} · ${escape(r.doctor_name)}<br>อาการ: ${escape(r.symptoms)}<br>การวินิจฉัย: ${escape(r.diagnosis)}<br>คำสั่ง: ${escape(r.treatment_notes)}</p>${bodyMeasurements(vitals(r))}${prescriptions(r.prescriptions || [])}</div>`).join('') : '<p>ยังไม่มีประวัติการรักษา</p>';
      } catch (err) { $('historyDetails').textContent = err.message; }
    }
  });
  $('patientSearch').addEventListener('input', patients);
  $('patient').addEventListener('change', loadPatientDetails);
  ['intake_weight_kg', 'intake_height_cm'].forEach(id => $(id).addEventListener('input', updateIntakeBmi));
  $('intakeForm').addEventListener('reset', () => { $('intake_bmi').value = ''; clearPatientDetails(); });
  async function submit(event, action) {
    event.preventDefault(); if (busy) return;
    if (event.target.id === 'intakeForm' && !intakePatientReady) { alert('กรุณาเลือกผู้ป่วยและรอให้ข้อมูลแสดงครบก่อนส่งเข้าคิว'); return; }
    if (event.target.id === 'treatmentForm') {
      const ids = [...$('medicineRows').querySelectorAll('select')].map(select => select.value).filter(Boolean);
      if (new Set(ids).size !== ids.length) { medicineNotice.textContent = 'เลือกยาซ้ำ กรุณาปรับจำนวนในรายการเดิมหรือเลือกยาอื่น'; return; }
    }
    busy = true;
    const button = event.target.querySelector('[type=submit]'); button.disabled = true;
    try { await action(); event.target.closest('dialog').close(); await refresh(); }
    catch (err) { alert(err.message); }
    finally { busy = false; button.disabled = false; }
  }
  $('intakeForm').addEventListener('submit', e => submit(e, () => api('/api/visits', 'POST', {patient_id: Number($('patient').value), symptoms: $('symptoms').value, vital_signs: {bp: $('bp').value, pulse: $('pulse').value, temp: $('temp').value, weight_kg: $('intake_weight_kg').value === '' ? null : Number($('intake_weight_kg').value), height_cm: $('intake_height_cm').value === '' ? null : Number($('intake_height_cm').value)}})));
  $('treatmentForm').addEventListener('submit', e => submit(e, () => api(`/api/visits/${selected.id}/treatment`, 'POST', {diagnosis: $('diagnosis').value, treatment_notes: $('notes').value, medicines: [...document.querySelectorAll('.medicine-row')].map(row => ({medicine_id: Number(row.querySelector('select').value), quantity: Number(row.querySelector('[type=number]').value), dosage_instructions: row.querySelector('input:not([type=number])').value}))})));
  $('dispenseForm').addEventListener('submit', e => submit(e, () => api(`/api/visits/${selected.id}/dispense`, 'POST', {})));
  $('logout').onclick = () => { localStorage.clear(); location.href = '/'; };
  (async () => {
    if (!token) { location.replace('/'); return; }
    try {
      user = (await api('/api/auth/me')).user;
      if (!['admin', 'doctor', 'nurse'].includes(user.role)) throw Error('บัญชีนี้ยังไม่ได้กำหนดสิทธิ์หมอหรือพยาบาล');
      const home = user.role === 'nurse' ? '/nurse.html' : '/doctor.html';
      if (doctor !== (user.role !== 'nurse')) { location.replace(home); return; }
      filter = 'waiting';
      $('heading').textContent = doctor ? 'ห้องตรวจแพทย์' : 'เคาน์เตอร์พยาบาล';
      $('subtitle').textContent = `${user.full_name || user.username} · ${doctor ? 'แพทย์ / เจ้าของคลินิก — ตรวจ วินิจฉัย และสั่งยา' : 'พยาบาล — บันทึกก่อนตรวจ และจ่ายยาตามคำสั่งแพทย์'}`;
      $('navigation').innerHTML = `<strong>Clinic Flow</strong><p>${doctor ? 'แพทย์ / เจ้าของคลินิก' : 'พยาบาล'}</p><a class="active" href="${home}">${doctor ? 'ห้องตรวจ' : 'คิวตรวจและจ่ายยา'}</a><a href="/patients.html">ข้อมูลผู้ป่วย</a><a href="/records.html">ประวัติการรักษา</a><a href="/inventory.html">คลังยา</a>${doctor ? '<a href="/dashboard.html">ภาพรวมคลินิก</a><a href="/users.html">บัญชีผู้ใช้งาน</a>' : ''}`;
      await refresh();
    } catch (err) { notice(err); $('queue').innerHTML = ''; }
  })();
})();
