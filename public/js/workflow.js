(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token = localStorage.getItem('token');
  let user, visits = [], medicines = [], selected, filter, busy = false;
  const doctor = document.body.dataset.workspace === 'doctor';
  const labels = { waiting: 'รอตรวจ', ready: 'รอจ่ายยา', completed: 'เสร็จสิ้นวันนี้', cancelled: 'ยกเลิกวันนี้' };
  const cancelReasons = ['ผู้ป่วยกลับก่อนตรวจ', 'ลงทะเบียนผิดหรือซ้ำ', 'ผู้ป่วยไม่รับยา', 'ส่งต่อโรงพยาบาล'];
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
  // เตือนเมื่อแพทย์เลือกยาที่ผู้ป่วยมีประวัติแพ้ ถ้าจะสั่งต่อต้องระบุเหตุผล (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
  const allergyPanel = document.createElement('section');
  allergyPanel.className = 'allergy-panel'; allergyPanel.hidden = true; allergyPanel.setAttribute('role', 'alert');
  allergyPanel.innerHTML = '<h3>⚠ พบยาที่ผู้ป่วยอาจแพ้</h3><ul></ul><label for="allergyOverride">เหตุผลที่ยืนยันสั่งยานี้ *</label><textarea id="allergyOverride" rows="2" minlength="5" placeholder="เช่น ผู้ป่วยเคยใช้ยานี้ได้โดยไม่มีอาการแพ้ หรือไม่มียาทดแทน"></textarea><p class="field-help">ถ้าไม่ต้องการสั่งยานี้ ให้เปลี่ยนเป็นยาอื่นหรือกด “เอาออก” · เหตุผลจะถูกบันทึกในประวัติการรักษา</p>';
  medicineNotice.after(allergyPanel);
  const medicineRisk = medicine => selected && AllergyCheck.check(selected.allergies, medicine, medicines);
  const riskLabel = risk => risk.level === 'direct' ? '⚠ ผู้ป่วยแพ้ยานี้' : '⚠ กลุ่มเดียวกับยาที่แพ้';
  function updateAllergyWarnings() {
    const found = [];
    $('medicineRows').querySelectorAll('.medicine-row').forEach(row => {
      const medicine = medicines.find(m => m.id === Number(row.querySelector('select').value));
      const result = medicineRisk(medicine);
      row.classList.toggle('allergy-direct', result?.level === 'direct');
      row.classList.toggle('allergy-group', result?.level === 'group');
      const rowAlert = row.querySelector('.row-alert');
      rowAlert.hidden = !result;
      rowAlert.innerHTML = result ? `<b>${riskLabel(result)}</b> · ${escape(result.reason)}` : '';
      if (result) found.push(`<li class="${result.level}"><b>${escape(medicine.name)}</b> — ${escape(result.reason)}${result.level === 'group' ? ' (ยากลุ่มเดียวกัน)' : ''}</li>`);
    });
    allergyPanel.hidden = !found.length;
    allergyPanel.querySelector('ul').innerHTML = found.join('');
    $('allergyOverride').required = Boolean(found.length);
  }
  // ค้นหายาเพื่อเพิ่มในใบสั่งยา: ค้นได้ทั้งชื่อไทย ชื่อสามัญ รหัสยา กลุ่มยา และหมวดหมู่
  // ยาที่ผู้ป่วยแพ้จะขึ้นด้านบนสุดของผลค้นหาพร้อมป้ายเตือน เพื่อให้แพทย์เห็นก่อนเลือก
  const picker = document.createElement('div');
  picker.className = 'medicine-picker';
  picker.innerHTML = '<div class="allergy-banner" role="note" hidden></div><label for="medicineSearch">ค้นหายาเพื่อเพิ่มในใบสั่งยา</label><input id="medicineSearch" type="search" autocomplete="off" placeholder="พิมพ์ชื่อยา ชื่อสามัญ รหัสยา หรือกลุ่มยา เช่น พารา, ibuprofen, NSAIDs" aria-controls="medicineResults" aria-expanded="false"><ul id="medicineResults" class="medicine-results" role="listbox" aria-label="ผลการค้นหายา" hidden></ul>';
  $('medicineRows').before(picker);
  const searchText = m => [m.name, m.generic_name, m.code, m.drug_group, m.category].map(v => String(v || '').toLowerCase()).join(' ');
  const chosenIds = () => new Set([...$('medicineRows').querySelectorAll('select')].map(select => Number(select.value)).filter(Boolean));
  function renderAllergyBanner() {
    const banner = picker.querySelector('.allergy-banner');
    banner.hidden = !(selected && hasText(selected.allergies));
    banner.innerHTML = banner.hidden ? '' : `<span class="banner-icon" aria-hidden="true">⚠</span><div><b>ผู้ป่วยแพ้ยา: ${escape(selected.allergies)}</b><small>ระบบจะเตือนเมื่อเลือกยาที่แพ้หรือยากลุ่มเดียวกัน</small></div>`;
  }
  function renderMedicineResults() {
    const list = $('medicineResults'), query = $('medicineSearch').value.trim().toLowerCase();
    if (!query) { list.hidden = true; $('medicineSearch').setAttribute('aria-expanded', 'false'); return; }
    const chosen = chosenIds();
    const rank = m => { const risk = medicineRisk(m); return risk ? (risk.level === 'direct' ? 0 : 1) : 2; };
    const found = medicines.filter(m => searchText(m).includes(query)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'th')).slice(0, 8);
    list.innerHTML = found.length ? found.map(m => {
      const risk = medicineRisk(m), taken = chosen.has(m.id), empty = Number(m.stock_quantity) <= 0;
      const details = [m.generic_name, m.drug_group, `คงเหลือ ${m.stock_quantity} ${m.unit}`].filter(Boolean).map(escape).join(' · ');
      return `<li role="option" aria-selected="false"><button type="button" class="medicine-result${risk ? ` risk-${risk.level}` : ''}" data-pick="${m.id}" ${taken ? 'disabled' : ''}>
        <span class="result-main"><b>${escape(m.name)}</b><small>${details}</small>${risk ? `<small class="result-reason">${escape(risk.reason)}</small>` : ''}</span>
        <span class="result-tags">${risk ? `<span class="result-badge ${risk.level}">${riskLabel(risk)}</span>` : ''}${empty ? '<span class="result-badge stock">สต๊อกหมด</span>' : ''}${taken ? '<span class="result-badge taken">เลือกแล้ว</span>' : ''}</span>
      </button></li>`;
    }).join('') : '<li class="no-result">ไม่พบยาที่ค้นหา</li>';
    list.hidden = false; $('medicineSearch').setAttribute('aria-expanded', 'true');
  }
  function addMedicineRow(medicineId) {
    if ($('medicineRows').children.length >= medicines.length) return null;
    const row = document.createElement('div'); row.className = 'medicine-row';
    row.innerHTML = `<select aria-label="ยา" required><option value="">เลือกยา</option>${medicines.map(m => { const risk = medicineRisk(m); return `<option value="${m.id}"${risk ? ` class="opt-risk-${risk.level}"` : ''}>${risk ? '⚠ แพ้ · ' : ''}${escape(m.name)} · เหลือ ${m.stock_quantity} ${escape(m.unit)}</option>`; }).join('')}</select><input type="number" aria-label="จำนวนยา" min="1" step="1" required placeholder="จำนวน"><input aria-label="วิธีใช้" required placeholder="วิธีใช้"><button type="button" class="secondary" data-remove>เอาออก</button><p class="row-alert" role="alert" hidden></p>`;
    $('medicineRows').append(row);
    if (medicineId) row.querySelector('select').value = String(medicineId);
    syncMedicineChoices(); updateAllergyWarnings();
    return row;
  }
  function pickMedicine(id) {
    const existing = [...$('medicineRows').querySelectorAll('select')].find(select => Number(select.value) === id);
    const row = existing ? existing.parentElement : addMedicineRow(id);
    medicineNotice.textContent = existing ? 'ยานี้อยู่ในใบสั่งยาแล้ว ปรับจำนวนในรายการเดิมได้เลย' : '';
    $('medicineSearch').value = ''; renderMedicineResults();
    if (row) row.querySelector('[type=number]').focus();
  }
  $('medicineSearch').addEventListener('input', renderMedicineResults);
  $('medicineSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = $('medicineResults').querySelector('[data-pick]:not(:disabled)');
      if (first) pickMedicine(Number(first.dataset.pick));
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); $('medicineResults').querySelector('[data-pick]:not(:disabled)')?.focus(); }
    if (event.key === 'Escape' && $('medicineSearch').value) { event.preventDefault(); $('medicineSearch').value = ''; renderMedicineResults(); }
  });
  $('medicineResults').addEventListener('keydown', event => {
    const buttons = [...$('medicineResults').querySelectorAll('[data-pick]:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[Math.min(index + 1, buttons.length - 1)]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); (index > 0 ? buttons[index - 1] : $('medicineSearch')).focus(); }
  });
  picker.addEventListener('focusout', event => {
    if (!picker.contains(event.relatedTarget)) { $('medicineResults').hidden = true; $('medicineSearch').setAttribute('aria-expanded', 'false'); }
  });
  $('medicineSearch').addEventListener('focus', renderMedicineResults);
  // หน้าต่างยืนยันยกเลิกคิว ต้องระบุเหตุผลทุกครั้ง
  const cancelDialog = document.createElement('dialog');
  cancelDialog.id = 'cancelDialog';
  cancelDialog.setAttribute('aria-labelledby', 'cancelTitle');
  cancelDialog.innerHTML = `<h2 id="cancelTitle">ยกเลิกคิว</h2><div id="cancelPatient"></div><form id="cancelForm"><p class="cancel-hint" id="cancelHint"></p><fieldset class="reason-chips"><legend>เลือกเหตุผล</legend>${cancelReasons.map(r => `<button type="button" class="chip" data-reason="${r}">${r}</button>`).join('')}</fieldset><label for="cancelReason">เหตุผลที่ยกเลิก *</label><textarea id="cancelReason" rows="2" minlength="3" maxlength="255" required placeholder="เลือกจากด้านบน หรือพิมพ์เหตุผลเอง"></textarea><div class="actions"><button type="button" class="secondary" data-close>กลับ</button><button type="submit" class="danger">ยืนยันยกเลิกคิว</button></div></form>`;
  document.body.append(cancelDialog);
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
    syncMedicineChoices(); updateAllergyWarnings();
  });
  function info(v) {
    const vs = vitals(v);
    return `<div class="visit-info">${hasText(v.allergies) ? `<div class="flags"><span class="flag danger">⚠ แพ้ยา: ${escape(v.allergies)}</span></div>` : ''}<section class="patient-summary">${patientSummary(v)}</section><div class="symptom"><small>อาการครั้งนี้</small><p>${escape(v.symptoms || '-')}</p></div>${vitalChips(vs)}</div>`;
  }
  const hasText = value => Boolean(value && !['-', '–', 'ไม่มี', 'none'].includes(String(value).trim().toLowerCase()));
  const clock = value => { const d = new Date(value); return isNaN(d) ? '' : d.toLocaleTimeString('th-TH', {hour: '2-digit', minute: '2-digit'}); };
  function waited(value) {
    const minutes = Math.floor((Date.now() - new Date(value)) / 60000);
    if (!(minutes >= 0)) return '';
    return minutes < 60 ? `รอ ${minutes} นาที` : `รอ ${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
  }
  function vitalChips(vs) {
    const bmi = PatientMetrics.bmi(vs.weight_kg, vs.height_cm);
    const systolic = Number(String(vs.bp || '').split('/')[0]);
    const chips = [
      ['ความดัน', vs.bp, 'mmHg', systolic >= 140 || (systolic > 0 && systolic < 90)],
      ['ชีพจร', vs.pulse, '/นาที', Number(vs.pulse) > 100 || (Number(vs.pulse) > 0 && Number(vs.pulse) < 50)],
      ['อุณหภูมิ', vs.temp, '°C', Number(vs.temp) >= 37.5],
      ['น้ำหนัก', vs.weight_kg, 'กก.', false],
      ['ส่วนสูง', vs.height_cm, 'ซม.', false],
      ['BMI', bmi === null ? '' : bmi.toFixed(1), '', bmi !== null && (bmi >= 30 || bmi < 18.5)],
    ];
    return `<div class="vital-chips">${chips.map(([label, value, unit, alert]) => `<span class="vital${alert ? ' alert-high' : ''}${hasText(value) ? '' : ' empty-value'}"><small>${label}</small><b>${hasText(value) ? escape(value) : '–'}</b>${hasText(value) && unit ? `<i>${unit}</i>` : ''}</span>`).join('')}</div>`;
  }
  function visitCard(v, index) {
    const vs = vitals(v);
    const age = PatientMetrics.age(v.date_of_birth);
    const gender = {male: 'ชาย', female: 'หญิง', other: 'อื่น ๆ'}[v.gender] || 'ไม่ระบุเพศ';
    const facts = [escape(v.hn_code), gender, age === null ? 'ไม่ระบุอายุ' : `${age} ปี`, v.blood_type ? `กรุ๊ป ${escape(v.blood_type)}` : ''].filter(Boolean).join(' · ');
    const time = v.status === 'completed' ? `เสร็จ ${clock(v.dispensed_at)}` : v.status === 'cancelled' ? `ยกเลิก ${clock(v.cancelled_at)}` : `${clock(v.created_at)} · ${waited(v.created_at)}`;
    const cancellable = ['waiting', 'ready'].includes(v.status);
    const flags = `${hasText(v.allergies) ? `<span class="flag danger">⚠ แพ้ยา: ${escape(v.allergies)}</span>` : '<span class="flag ok">ไม่มีประวัติแพ้ยา</span>'}${hasText(v.underlying_conditions) ? `<span class="flag warn">โรคประจำตัว: ${escape(v.underlying_conditions)}</span>` : ''}`;
    const action = doctor && v.status === 'waiting' ? `<button data-treat="${v.id}">ตรวจรักษา</button>`
      : !doctor && v.status === 'ready' ? `<button data-dispense="${v.id}">${v.prescriptions.length ? 'ตรวจสอบและจ่ายยา' : 'ปิดคิว · ไม่มียา'}</button>` : '';
    return `<article class="visit-card status-${v.status}">
      <header class="visit-head"><span class="queue-no" aria-label="ลำดับคิว">${index + 1}</span><div class="who"><h3>${escape(v.prefix || '')}${escape(v.first_name)} ${escape(v.last_name)}</h3><p>${facts}</p></div><div class="visit-status"><span class="tag ${v.status}">${labels[v.status]}</span><small>${time}</small></div></header>
      <div class="flags">${flags}</div>
      <div class="symptom"><small>อาการสำคัญ</small><p>${escape(v.symptoms || '-')}</p></div>
      ${v.status === 'cancelled' ? `<p class="cancel-note"><b>ยกเลิกคิว</b> · ${escape(v.cancel_reason || '-')}<br><small>โดย ${escape(v.cancelled_by_name || '-')} เวลา ${clock(v.cancelled_at)}</small></p>` : ''}
      ${vitalChips(vs)}
      ${v.diagnosis ? `<div class="order"><p><small>การวินิจฉัย</small>${escape(v.diagnosis)}</p>${hasText(v.treatment_notes) ? `<p><small>คำสั่งแพทย์</small>${escape(v.treatment_notes)}</p>` : ''}<p class="muted">แพทย์: ${escape(v.doctor_name || '-')} · ยา ${v.prescriptions.length} รายการ</p>${overrideNote(v.allergy_override)}${prescriptions(v.prescriptions, v.allergies)}</div>` : ''}
      <footer class="visit-actions">${cancellable ? `<button class="secondary cancel-visit" data-cancel="${v.id}">ยกเลิกคิว</button>` : ''}<button class="secondary" data-history="${v.patient_id}">ดูประวัติ</button>${action}</footer>
    </article>`;
  }
  function prescriptions(items, allergies) {
    if (!items.length) return '<p class="muted">ไม่มีรายการยา</p>';
    const catalog = items.map(p => ({...p, id: p.medicine_id}));
    return `<table><thead><tr><th>ยา</th><th>จำนวน</th><th>วิธีใช้</th></tr></thead><tbody>${catalog.map(p => {
      const risk = allergies && AllergyCheck.check(allergies, p, catalog);
      return `<tr class="${risk ? `allergy-hit ${risk.level}` : ''}"><td>${risk ? `<span class="rx-flag" title="${escape(risk.reason)}">⚠ แพ้</span> ` : ''}${escape(p.name || p.medicine_name)}</td><td>${escape(p.quantity)} ${escape(p.unit)}</td><td>${escape(p.dosage_instructions)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  const overrideNote = reason => hasText(reason) ? `<p class="allergy-override-note"><b>⚠ แพทย์ยืนยันสั่งยาที่ผู้ป่วยมีประวัติแพ้</b><br>เหตุผล: ${escape(reason)}</p>` : '';
  function render() {
    const step = ['completed', 'cancelled'].includes(filter) ? -1 : filter === 'ready' ? 2 : doctor ? 1 : 0;
    document.querySelectorAll('.flow span').forEach((span, index) => {
      span.classList.toggle('current', index === step);
      if (index === step) span.setAttribute('aria-current', 'step');
      else span.removeAttribute('aria-current');
    });
    const hints = { waiting: doctor ? 'ผู้ป่วยที่พร้อมให้ตรวจ' : 'ส่งเข้าคิวแล้ว รอหมอตรวจ', ready: doctor ? 'ส่งต่อพยาบาลแล้ว' : 'หมอสั่งยาแล้ว รอจ่าย', completed: 'จ่ายยาและปิดคิวแล้ว', cancelled: 'ผู้ป่วยกลับหรือลงทะเบียนผิด' };
    $('filters').innerHTML = `<div class="stat-tiles" role="tablist" aria-label="สถานะคิว">${Object.keys(labels).map(s => `<button type="button" role="tab" aria-selected="${filter === s}" class="stat-tile tile-${s}${filter === s ? ' active' : ''}" data-filter="${s}"><span>${labels[s]}</span><b>${visits.filter(v => v.status === s).length}</b><small>${hints[s]}</small></button>`).join('')}</div><div class="toolbar-actions">${!doctor ? '<button id="newIntake">+ บันทึกก่อนตรวจ</button><a class="button secondary" href="/patients.html">ลงทะเบียนผู้ป่วยใหม่</a>' : ''}<button class="secondary" id="refresh">↻ รีเฟรชคิว</button></div>`;
    const rows = visits.filter(v => v.status === filter);
    // คิวที่เสร็จสิ้นแล้ว เรียงจากที่จ่ายยาล่าสุดไว้บนสุด (คิวอื่นเรียงตามลำดับมาก่อน-หลังเหมือนเดิม)
    if (filter === 'completed') rows.sort((a, b) => new Date(b.dispensed_at) - new Date(a.dispensed_at));
    if (filter === 'cancelled') rows.sort((a, b) => new Date(b.cancelled_at) - new Date(a.cancelled_at));
    $('queue').innerHTML = rows.length ? `<div class="visit-grid">${rows.map(visitCard).join('')}</div>` :`<div class="empty"><h3>${filter === 'completed' ? 'ยังไม่มีคิวที่เสร็จสิ้นวันนี้' : filter === 'cancelled' ? 'ไม่มีคิวที่ยกเลิกวันนี้' : `ไม่มีผู้ป่วย${labels[filter]}`}</h3><p>${filter === 'cancelled' ? 'คิวที่ยกเลิกด้วยปุ่ม “ยกเลิกคิว” จะแสดงที่นี่พร้อมเหตุผล' : doctor ? 'เมื่อพยาบาลบันทึกข้อมูลก่อนตรวจ คิวผู้ป่วยจะแสดงที่นี่' : filter === 'ready' ? 'เมื่อหมอตรวจเสร็จ รายการจ่ายยาจะแสดงที่นี่' : 'เลือก “บันทึกก่อนตรวจ” เพื่อส่งผู้ป่วยเข้าคิว'}</p></div>`;
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
      try { medicines = (await api('/api/medicines')).data; syncMedicineChoices(); updateAllergyWarnings(); renderAllergyBanner(); renderMedicineResults(); $('treatmentDialog').showModal(); } catch (err) { notice(err); }
    }
    if (button.id === 'addMedicine') addMedicineRow();
    if (button.dataset.pick) pickMedicine(Number(button.dataset.pick));
    if (button.hasAttribute('data-remove')) { button.parentElement.remove(); medicineNotice.textContent = ''; syncMedicineChoices(); updateAllergyWarnings(); }
    if (button.dataset.cancel) {
      selected = visits.find(v => v.id === Number(button.dataset.cancel));
      $('cancelForm').reset();
      cancelDialog.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active'));
      $('cancelPatient').innerHTML = `<p class="cancel-who"><b>${name(selected)}</b><br><small>สถานะ: ${labels[selected.status]}</small></p>`;
      $('cancelHint').textContent = selected.status === 'ready'
        ? 'แพทย์ตรวจแล้ว ประวัติการรักษายังถูกเก็บไว้ แต่จะไม่จ่ายยาและไม่ตัดสต๊อก'
        : 'ผู้ป่วยจะถูกนำออกจากคิวรอตรวจ และส่งเข้าคิวใหม่ได้ภายหลัง';
      cancelDialog.showModal();
    }
    if (button.dataset.reason) {
      $('cancelReason').value = button.dataset.reason;
      cancelDialog.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip === button));
    }
    if (button.dataset.dispense) {
      selected = visits.find(v => v.id === Number(button.dataset.dispense)); $('dispenseForm').reset();
      $('dispenseDetails').innerHTML = `${info(selected)}<p>การวินิจฉัย: ${escape(selected.diagnosis)}<br>คำสั่งแพทย์: ${escape(selected.treatment_notes || '-')}</p>${overrideNote(selected.allergy_override)}${prescriptions(selected.prescriptions, selected.allergies)}`;
      $('dispenseSubmit').textContent = selected.prescriptions.length ? 'ยืนยันจ่ายยาและตัดสต๊อก' : 'ยืนยันปิดคิว';
      $('dispenseDialog').showModal();
    }
    if (button.dataset.history) {
      $('historyDetails').textContent = 'กำลังโหลด…'; $('historyDialog').showModal();
      try {
        const result = await api(`/api/records/patient/${button.dataset.history}`);
        $('historyDetails').innerHTML = result.data.length ? result.data.map(r => `<div class="card"><p>${escape(r.visit_date)} · ${escape(r.doctor_name)}<br>อาการ: ${escape(r.symptoms)}<br>การวินิจฉัย: ${escape(r.diagnosis)}<br>คำสั่ง: ${escape(r.treatment_notes)}</p>${overrideNote(r.allergy_override)}${bodyMeasurements(vitals(r))}${prescriptions(r.prescriptions || [])}</div>`).join('') : '<p>ยังไม่มีประวัติการรักษา</p>';
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
  $('treatmentForm').addEventListener('submit', e => submit(e, () => api(`/api/visits/${selected.id}/treatment`, 'POST', {diagnosis: $('diagnosis').value, treatment_notes: $('notes').value, medicines: [...document.querySelectorAll('.medicine-row')].map(row => ({medicine_id: Number(row.querySelector('select').value), quantity: Number(row.querySelector('[type=number]').value), dosage_instructions: row.querySelector('input:not([type=number])').value})), ...(allergyPanel.hidden ? {} : {allergy_override: $('allergyOverride').value})})));
  $('dispenseForm').addEventListener('submit', e => submit(e, () => api(`/api/visits/${selected.id}/dispense`, 'POST', {})));
  $('cancelForm').addEventListener('submit', e => submit(e, () => api(`/api/visits/${selected.id}/cancel`, 'POST', {reason: $('cancelReason').value})));
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
      $('subtitle').textContent = `${user.full_name || user.username} · ${doctor ? `${user.role === 'admin' ? 'เจ้าของคลินิก' : 'แพทย์'} — ตรวจ วินิจฉัย และสั่งยา` : 'พยาบาล — บันทึกก่อนตรวจ และจ่ายยาตามคำสั่งแพทย์'}`;
      $('navigation').innerHTML = `<strong>Clinic Flow</strong><p>${{admin: 'เจ้าของคลินิก', doctor: 'แพทย์', nurse: 'พยาบาล'}[user.role]}</p><a class="active" href="${home}">${doctor ? 'ห้องตรวจ' : 'คิวตรวจและจ่ายยา'}</a><a href="/patients.html">ข้อมูลผู้ป่วย</a><a href="/records.html">ประวัติการรักษา</a><a href="/inventory.html">คลังยา</a>${doctor ? '<a href="/dashboard.html">ภาพรวมคลินิก</a>' : ''}${user.role === 'admin' ? '<a href="/users.html">บัญชีผู้ใช้งาน</a>' : ''}<a href="/account.html">บัญชีของฉัน</a>`;
      await refresh();
    } catch (err) { notice(err); $('queue').innerHTML = ''; }
  })();
})();
