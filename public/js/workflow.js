// หน้าทำงานแพทย์ (doctor.html) และพยาบาล (nurse.html) ใช้ไฟล์นี้ร่วมกัน
// จัดการคิวทั้งหมด: บันทึกก่อนตรวจ -> ตรวจรักษาและสั่งยา (ค้นหายา + เตือนแพ้ยา) -> จ่ายยา และยกเลิกคิว
// ต้องโหลด patient-metrics.js และ allergy-check.js ก่อนไฟล์นี้
//
// สารบัญ
//   1. ค่าคงที่และสถานะของหน้า
//   2. ฟังก์ชันช่วยทั่วไป (escapeHtml, callApi, การแสดงเวลา ฯลฯ)
//   3. หน้าต่างบันทึกก่อนตรวจ (พยาบาล)
//   4. หน้าต่างตรวจรักษาและสั่งยา (แพทย์): แถวยา ค้นหายา เตือนแพ้ยา
//   5. การ์ดคิวและตารางยา
//   6. วาดหน้าและรีเฟรชคิวอัตโนมัติ
//   7. ปุ่มต่าง ๆ และการส่งฟอร์ม
//   8. เริ่มต้นเมื่อเปิดหน้า

(function () {

  // =================================================================
  // 1. ค่าคงที่และสถานะของหน้า
  // =================================================================

  // token ที่ได้ตอนล็อกอิน ใช้แนบทุกครั้งที่เรียก API
  const token = localStorage.getItem('token');

  // ไฟล์นี้ใช้ทั้งหน้าแพทย์และพยาบาล แยกด้วย data-workspace ใน <body>
  const isDoctorPage = document.body.dataset.workspace === 'doctor';

  // ชื่อแท็บ/สถานะคิว (ลำดับนี้คือลำดับการ์ดสถานะบนหน้าจอ)
  const STATUSES = ['waiting', 'ready', 'completed', 'cancelled'];
  const STATUS_LABELS = {
    waiting: 'รอตรวจ',
    ready: 'รอจ่ายยา',
    completed: 'เสร็จสิ้นวันนี้',
    cancelled: 'ยกเลิกวันนี้',
  };

  // เหตุผลยกเลิกคิวที่ใช้บ่อย (ปุ่มลัดในหน้าต่างยกเลิกคิว)
  const CANCEL_REASONS = ['ผู้ป่วยกลับก่อนตรวจ', 'ลงทะเบียนผิดหรือซ้ำ', 'ผู้ป่วยไม่รับยา', 'ส่งต่อโรงพยาบาล'];

  // รีเฟรชคิวอัตโนมัติทุก 15 วินาที
  const AUTO_REFRESH_MS = 15000;

  // ข้อมูลที่หน้าเว็บจำไว้
  let currentUser = null;   // ผู้ที่ล็อกอินอยู่
  let visits = [];          // คิวทั้งหมดที่โหลดมา
  let medicines = [];       // รายการยาในคลัง (โหลดตอนเปิดหน้าต่างตรวจรักษา)
  let selected = null;      // คิวที่กำลังเปิดดู/ทำงานอยู่
  let currentTab = 'waiting'; // แท็บสถานะที่เลือกอยู่
  let busy = false;         // กำลังส่งฟอร์มอยู่ (กันกดซ้ำ)

  // ข้อมูลสำหรับรีเฟรชอัตโนมัติ
  let lastSync = null;          // เวลาที่โหลดคิวสำเร็จล่าสุด
  let syncFailed = false;       // รอบล่าสุดโหลดไม่สำเร็จ
  let lastPayload = '';         // ข้อมูลคิวรอบก่อน (ไว้เทียบว่าเปลี่ยนไหม)
  let lastRenderMinute = -1;    // นาทีที่วาดหน้าล่าสุด
  let knownIds = null;          // id คิวที่เคยเห็นแล้ว
  let highlightIds = [];        // id คิวใหม่ที่ต้องไฮไลต์

  // ลำดับการโหลด (กันผลลัพธ์เก่ามาทับผลใหม่ เมื่อผู้ใช้เปลี่ยนเร็ว ๆ)
  let patientDetailSerial = 0;  // การโหลดข้อมูลผู้ป่วยในหน้าต่างบันทึกก่อนตรวจ
  let patientSearchSerial = 0;  // การค้นหาผู้ป่วย
  let intakePatientReady = false; // โหลดข้อมูลผู้ป่วยที่เลือกเสร็จแล้ว จึงอนุญาตให้ส่งเข้าคิว

  // =================================================================
  // 2. ฟังก์ชันช่วยทั่วไป
  // =================================================================

  // ตัวช่วยสั้น ๆ: getElement('x') = document.getElementById('x')
  function getElement(id) {
    return document.getElementById(id);
  }

  // แปลงอักขระพิเศษก่อนใส่ลง HTML กันการฝังโค้ดอันตราย (XSS)
  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // เรียก API พร้อมแนบ token ถ้าได้ 401 (หมดอายุ/บัญชีถูกปิด) จะออกจากระบบอัตโนมัติ
  async function callApi(url, method, body) {
    const options = {
      method: method || 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    const result = await res.json();
    if (res.status === 401) {
      localStorage.clear();
      location.replace('/');
      throw new Error('กรุณาเข้าสู่ระบบใหม่');
    }
    if (!res.ok) {
      throw new Error(result.message || 'ดำเนินการไม่สำเร็จ');
    }
    return result;
  }

  // แสดงหรือล้างข้อความแจ้งเตือนด้านบนของหน้า
  function showNotice(error) {
    if (error) {
      getElement('notice').textContent = error.message;
    } else {
      getElement('notice').textContent = '';
    }
  }

  // มีข้อมูลจริงหรือไม่ (ถือว่า '-', 'ไม่มี' = ไม่มีข้อมูล)
  function hasText(value) {
    if (!value) {
      return false;
    }
    const text = String(value).trim().toLowerCase();
    return text !== '-' && text !== '–' && text !== 'ไม่มี' && text !== 'none';
  }

  // ชื่อบทบาทภาษาไทย
  function roleLabel(role) {
    if (role === 'admin') {
      return 'เจ้าของคลินิก';
    }
    if (role === 'doctor') {
      return 'แพทย์';
    }
    if (role === 'nurse') {
      return 'พยาบาล';
    }
    return '';
  }

  // ชื่อเพศภาษาไทย
  function genderLabel(gender, unknownText) {
    if (gender === 'male') {
      return 'ชาย';
    }
    if (gender === 'female') {
      return 'หญิง';
    }
    if (gender === 'other') {
      return 'อื่น ๆ';
    }
    return unknownText;
  }

  // ชื่อผู้ป่วยแบบเต็มสำหรับแสดงผล เช่น "HN0001 · นายสมชาย ใจดี"
  function patientName(patient) {
    return escapeHtml(patient.hn_code) + ' · ' + escapeHtml(patient.prefix || '') + escapeHtml(patient.first_name) + ' ' + escapeHtml(patient.last_name);
  }

  // แสดงเวลาเป็น ชั่วโมง:นาที
  function formatClock(value) {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  // ระยะเวลาที่ผู้ป่วยรอคิว เช่น "รอ 12 นาที"
  function waitingTime(value) {
    const minutes = Math.floor((Date.now() - new Date(value)) / 60000);
    if (!(minutes >= 0)) {
      return '';
    }
    if (minutes < 60) {
      return 'รอ ' + minutes + ' นาที';
    }
    return 'รอ ' + Math.floor(minutes / 60) + ' ชม. ' + (minutes % 60) + ' นาที';
  }

  // แสดงจำนวนเงินแบบบาท ทศนิยม 2 ตำแหน่ง เช่น ฿1,250.00
  function formatBaht(value) {
    return '฿' + Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // อ่านสัญญาณชีพ (เก็บเป็น JSON) ให้เป็น object เสมอ แม้ข้อมูลเสีย
  function readVitals(visit) {
    try {
      if (typeof visit.vital_signs === 'string') {
        return JSON.parse(visit.vital_signs);
      }
      return visit.vital_signs || {};
    } catch (err) {
      return {};
    }
  }

  // หาคิวจาก id ในรายการที่โหลดไว้
  function findVisit(id) {
    for (const visit of visits) {
      if (visit.id === id) {
        return visit;
      }
    }
    return null;
  }

  // หายาจาก id ในรายการยาที่โหลดไว้
  function findMedicine(id) {
    for (const medicine of medicines) {
      if (medicine.id === id) {
        return medicine;
      }
    }
    return null;
  }

  // ช่องเลือกยาทุกแถวในใบสั่งยา
  function medicineSelects() {
    return getElement('medicineRows').querySelectorAll('select');
  }

  // =================================================================
  // 3. หน้าต่างบันทึกก่อนตรวจ (พยาบาล)
  // =================================================================

  // กล่องแสดงข้อมูลผู้ป่วยที่เลือก (สร้างแล้ววางต่อจากช่องเลือกผู้ป่วย)
  const patientPanel = document.createElement('section');
  patientPanel.id = 'intakePatientDetails';
  patientPanel.className = 'patient-summary';
  patientPanel.setAttribute('aria-live', 'polite');
  getElement('patient').after(patientPanel);

  // ล้างกล่องข้อมูลผู้ป่วย และยกเลิกผลการโหลดที่ค้างอยู่ (เพิ่ม serial)
  function clearPatientDetails() {
    patientDetailSerial = patientDetailSerial + 1;
    intakePatientReady = false;
    patientPanel.innerHTML = '<p class="muted">เลือกผู้ป่วยเพื่อแสดงข้อมูลให้หมอประกอบการตรวจ</p>';
  }

  // สร้าง HTML สรุปข้อมูลผู้ป่วย: อายุ เพศ กรุ๊ปเลือด ประวัติแพ้ยา โรคประจำตัว และข้อมูลติดต่อ
  function patientSummaryHtml(patient) {
    const age = PatientMetrics.age(patient.date_of_birth);
    let ageText = 'ไม่ระบุ';
    if (age !== null) {
      ageText = age + ' ปี';
    }
    let birthDate = 'ไม่ระบุ';
    if (patient.date_of_birth) {
      birthDate = String(patient.date_of_birth).split('T')[0];
    }

    let html = '<h3>' + patientName(patient) + '</h3>';
    html += '<div class="patient-detail-grid">';
    html += '<span><small>อายุ</small><strong>' + ageText + '</strong></span>';
    html += '<span><small>เพศ</small><strong>' + genderLabel(patient.gender, 'ไม่ระบุ') + '</strong></span>';
    html += '<span><small>กรุ๊ปเลือด</small><strong>' + escapeHtml(patient.blood_type || 'ไม่ระบุ') + '</strong></span>';
    html += '<span><small>วันเกิด</small><strong>' + escapeHtml(birthDate) + '</strong></span>';
    html += '</div>';
    html += '<div class="patient-medical">';
    html += '<p><strong>ประวัติแพ้ยา:</strong> ' + escapeHtml(patient.allergies || 'ยังไม่ระบุ') + '</p>';
    html += '<p><strong>โรคประจำตัว:</strong> ' + escapeHtml(patient.underlying_conditions || 'ยังไม่ระบุ') + '</p>';
    html += '</div>';
    html += '<details class="patient-contact"><summary>ข้อมูลติดต่อผู้ป่วย</summary>';
    html += '<p>เบอร์โทร: ' + escapeHtml(patient.phone || 'ไม่ระบุ') + '<br>ที่อยู่: ' + escapeHtml(patient.address || 'ไม่ระบุ') + '</p>';
    html += '</details>';
    return html;
  }

  // โหลดข้อมูลผู้ป่วยเมื่อพยาบาลเลือกจากรายการ
  // ใช้ serial กันผลลัพธ์เก่ามาทับ ถ้าผู้ใช้เปลี่ยนผู้ป่วยเร็ว ๆ ระหว่างรอโหลด
  async function loadPatientDetails() {
    const id = getElement('patient').value;
    clearPatientDetails();
    if (!id) {
      return;
    }
    // จำลำดับของการโหลดครั้งนี้ไว้ เทียบตอนผลกลับมา
    const serial = patientDetailSerial;
    patientPanel.innerHTML = '<p class="muted">กำลังดึงข้อมูลผู้ป่วย…</p>';
    try {
      const result = await callApi('/api/patients/' + encodeURIComponent(id));
      // ผู้ใช้เปลี่ยนผู้ป่วยไปแล้วระหว่างรอ -> ทิ้งผลนี้
      if (serial !== patientDetailSerial || getElement('patient').value !== id) {
        return;
      }
      patientPanel.innerHTML = patientSummaryHtml(result.data);
      intakePatientReady = true;
    } catch (err) {
      if (serial !== patientDetailSerial) {
        return;
      }
      patientPanel.textContent = err.message + ' กรุณาเลือกผู้ป่วยอีกครั้ง';
    }
  }

  // ค้นหาผู้ป่วยในหน้าต่างบันทึกก่อนตรวจ (ใช้ serial กันผลค้นหาเก่ามาทับผลใหม่)
  async function searchPatients() {
    patientSearchSerial = patientSearchSerial + 1;
    const serial = patientSearchSerial;
    clearPatientDetails();
    getElement('patient').innerHTML = '<option value="">กำลังค้นหาผู้ป่วย…</option>';
    try {
      const keyword = encodeURIComponent(getElement('patientSearch').value);
      const result = await callApi('/api/patients?limit=100&search=' + keyword);
      // มีการค้นหาใหม่กว่าเกิดขึ้นแล้ว -> ทิ้งผลนี้
      if (serial !== patientSearchSerial) {
        return;
      }
      let html = '<option value="">เลือกผู้ป่วย</option>';
      for (const patient of result.data) {
        html += '<option value="' + patient.id + '">' + patientName(patient) + '</option>';
      }
      getElement('patient').innerHTML = html;
    } catch (err) {
      showNotice(err);
    }
  }

  // คำนวณ BMI ทันทีเมื่อพยาบาลกรอกน้ำหนักหรือส่วนสูง
  function updateIntakeBmi() {
    const bmi = PatientMetrics.bmi(getElement('intake_weight_kg').value, getElement('intake_height_cm').value);
    if (bmi === null) {
      getElement('intake_bmi').value = '';
    } else {
      getElement('intake_bmi').value = bmi.toFixed(1);
    }
  }

  // =================================================================
  // 4. หน้าต่างตรวจรักษาและสั่งยา (แพทย์)
  // =================================================================

  // ข้อความแจ้งเตือนใต้รายการยา (เช่น เลือกยาซ้ำ)
  const medicineNotice = document.createElement('p');
  medicineNotice.className = 'field-help';
  medicineNotice.setAttribute('role', 'status');
  medicineNotice.setAttribute('aria-live', 'polite');
  getElement('medicineRows').after(medicineNotice);

  // กล่องเตือนเมื่อแพทย์เลือกยาที่ผู้ป่วยมีประวัติแพ้ ถ้าจะสั่งต่อต้องระบุเหตุผล (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
  const allergyPanel = document.createElement('section');
  allergyPanel.className = 'allergy-panel';
  allergyPanel.hidden = true;
  allergyPanel.setAttribute('role', 'alert');
  allergyPanel.innerHTML =
    '<h3>⚠ พบยาที่ผู้ป่วยอาจแพ้</h3>' +
    '<ul></ul>' +
    '<label for="allergyOverride">เหตุผลที่ยืนยันสั่งยานี้ *</label>' +
    '<textarea id="allergyOverride" rows="2" minlength="5" placeholder="เช่น ผู้ป่วยเคยใช้ยานี้ได้โดยไม่มีอาการแพ้ หรือไม่มียาทดแทน"></textarea>' +
    '<p class="field-help">ถ้าไม่ต้องการสั่งยานี้ ให้เปลี่ยนเป็นยาอื่นหรือกด “เอาออก” · เหตุผลจะถูกบันทึกในประวัติการรักษา</p>';
  medicineNotice.after(allergyPanel);

  // ส่วนค้นหายา: แถบแดงบอกยาที่แพ้ + ช่องค้นหา + รายการผลค้นหา (วางไว้เหนือแถวยา)
  const picker = document.createElement('div');
  picker.className = 'medicine-picker';
  picker.innerHTML =
    '<div class="allergy-banner" role="note" hidden></div>' +
    '<label for="medicineSearch">ค้นหายาเพื่อเพิ่มในใบสั่งยา</label>' +
    '<input id="medicineSearch" type="search" autocomplete="off" placeholder="พิมพ์ชื่อยา ชื่อสามัญ รหัสยา หรือกลุ่มยา เช่น พารา, ibuprofen, NSAIDs" aria-controls="medicineResults" aria-expanded="false">' +
    '<ul id="medicineResults" class="medicine-results" role="listbox" aria-label="ผลการค้นหายา" hidden></ul>';
  getElement('medicineRows').before(picker);

  // ตรวจว่าผู้ป่วยที่กำลังตรวจอาจแพ้ยาตัวนี้หรือไม่ (ดู allergy-check.js)
  function medicineRisk(medicine) {
    if (!selected) {
      return null;
    }
    return AllergyCheck.check(selected.allergies, medicine, medicines);
  }

  // ข้อความป้ายเตือนตามระดับความเสี่ยง
  function riskLabel(risk) {
    if (risk.level === 'direct') {
      return '⚠ ผู้ป่วยแพ้ยานี้';
    }
    return '⚠ กลุ่มเดียวกับยาที่แพ้';
  }

  // จำนวนที่จ่ายได้จริง = คงเหลือ - ส่วนที่หมดอายุแล้ว (ระบบไม่ให้จ่ายยาจากล็อตที่หมดอายุ)
  function usableStock(medicine) {
    return Number(medicine.stock_quantity) - Number(medicine.expired_quantity || 0);
  }

  // ตรวจยาทุกแถวที่เลือกไว้ แล้วไฮไลต์แถวที่แพ้ (แดง = แพ้ตรงตัว, ส้ม = กลุ่มเดียวกัน)
  // ถ้ามียาที่แพ้ จะแสดงกล่องเตือนและบังคับให้กรอกเหตุผล
  function updateAllergyWarnings() {
    let warningItems = '';
    let warningCount = 0;
    const rows = getElement('medicineRows').querySelectorAll('.medicine-row');
    for (const row of rows) {
      // หายาที่เลือกในแถวนี้ แล้วตรวจกับประวัติแพ้ยา
      const medicine = findMedicine(Number(row.querySelector('select').value));
      const risk = medicineRisk(medicine);
      const rowAlert = row.querySelector('.row-alert');

      row.classList.remove('allergy-direct');
      row.classList.remove('allergy-group');
      if (!risk) {
        rowAlert.hidden = true;
        rowAlert.innerHTML = '';
        continue;
      }

      row.classList.add('allergy-' + risk.level);
      rowAlert.hidden = false;
      rowAlert.innerHTML = '<b>' + riskLabel(risk) + '</b> · ' + escapeHtml(risk.reason);

      let extra = '';
      if (risk.level === 'group') {
        extra = ' (ยากลุ่มเดียวกัน)';
      }
      warningItems += '<li class="' + risk.level + '"><b>' + escapeHtml(medicine.name) + '</b> — ' + escapeHtml(risk.reason) + extra + '</li>';
      warningCount = warningCount + 1;
    }

    // มียาที่แพ้อย่างน้อย 1 ตัว -> แสดงกล่องเตือน และบังคับกรอกเหตุผล (ฟอร์มส่งไม่ได้ถ้าว่าง)
    allergyPanel.hidden = warningCount === 0;
    allergyPanel.querySelector('ul').innerHTML = warningItems;
    getElement('allergyOverride').required = warningCount > 0;
  }

  // แถบแดงบอกว่าผู้ป่วยแพ้อะไร แสดงเหนือช่องค้นหายาตลอดเวลาที่สั่งยา
  function renderAllergyBanner() {
    const banner = picker.querySelector('.allergy-banner');
    if (selected && hasText(selected.allergies)) {
      banner.hidden = false;
      banner.innerHTML =
        '<span class="banner-icon" aria-hidden="true">⚠</span>' +
        '<div><b>ผู้ป่วยแพ้ยา: ' + escapeHtml(selected.allergies) + '</b>' +
        '<small>ระบบจะเตือนเมื่อเลือกยาที่แพ้หรือยากลุ่มเดียวกัน</small></div>';
    } else {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }

  // id ของยาที่เลือกไว้แล้วในใบสั่งยา
  function chosenMedicineIds() {
    const ids = [];
    for (const select of medicineSelects()) {
      const id = Number(select.value);
      if (id) {
        ids.push(id);
      }
    }
    return ids;
  }

  // รวมข้อความที่ใช้ค้นหายา: ชื่อ ชื่อสามัญ รหัส กลุ่มยา หมวดหมู่
  function medicineSearchText(medicine) {
    const fields = [medicine.name, medicine.generic_name, medicine.code, medicine.drug_group, medicine.category];
    const parts = [];
    for (const field of fields) {
      parts.push(String(field || '').toLowerCase());
    }
    return parts.join(' ');
  }

  // คะแนนสำหรับเรียงผลค้นหา: 0 = แพ้ตรงตัว, 1 = กลุ่มเดียวกัน, 2 = ไม่มีความเสี่ยง
  function riskRank(medicine) {
    const risk = medicineRisk(medicine);
    if (!risk) {
      return 2;
    }
    if (risk.level === 'direct') {
      return 0;
    }
    return 1;
  }

  // สร้าง HTML ของผลค้นหายา 1 รายการ
  function medicineResultHtml(medicine, chosenIds) {
    const risk = medicineRisk(medicine);
    const taken = chosenIds.includes(medicine.id);  // เลือกไว้แล้ว (ปุ่มกดไม่ได้)
    const empty = usableStock(medicine) <= 0;        // ไม่มีสต๊อกที่จ่ายได้

    // รายละเอียดใต้ชื่อยา: ชื่อสามัญ · กลุ่มยา · คงเหลือ
    const details = [];
    if (medicine.generic_name) {
      details.push(escapeHtml(medicine.generic_name));
    }
    if (medicine.drug_group) {
      details.push(escapeHtml(medicine.drug_group));
    }
    details.push(escapeHtml('คงเหลือ ' + usableStock(medicine) + ' ' + medicine.unit));

    let buttonClass = 'medicine-result';
    if (risk) {
      buttonClass += ' risk-' + risk.level;
    }
    let disabled = '';
    if (taken) {
      disabled = 'disabled';
    }

    let html = '<li role="option" aria-selected="false">';
    html += '<button type="button" class="' + buttonClass + '" data-pick="' + medicine.id + '" ' + disabled + '>';
    html += '<span class="result-main"><b>' + escapeHtml(medicine.name) + '</b><small>' + details.join(' · ') + '</small>';
    if (risk) {
      html += '<small class="result-reason">' + escapeHtml(risk.reason) + '</small>';
    }
    html += '</span>';
    html += '<span class="result-tags">';
    if (risk) {
      html += '<span class="result-badge ' + risk.level + '">' + riskLabel(risk) + '</span>';
    }
    if (empty) {
      html += '<span class="result-badge stock">สต๊อกหมด</span>';
    }
    if (taken) {
      html += '<span class="result-badge taken">เลือกแล้ว</span>';
    }
    html += '</span>';
    html += '</button></li>';
    return html;
  }

  // แสดงผลค้นหายา (สูงสุด 8 รายการ)
  // เรียง: ยาที่แพ้ตรงตัวขึ้นก่อน -> ยากลุ่มเดียวกัน -> ยาอื่นตามชื่อ เพื่อให้แพทย์เห็นคำเตือนก่อน
  function renderMedicineResults() {
    const list = getElement('medicineResults');
    const searchBox = getElement('medicineSearch');
    const query = searchBox.value.trim().toLowerCase();

    // ช่องค้นหาว่าง -> ซ่อนรายการผลค้นหา
    if (query === '') {
      list.hidden = true;
      searchBox.setAttribute('aria-expanded', 'false');
      return;
    }

    // หายาที่มีคำค้นอยู่
    const found = [];
    for (const medicine of medicines) {
      if (medicineSearchText(medicine).includes(query)) {
        found.push(medicine);
      }
    }
    // เรียงตามความเสี่ยงก่อน ถ้าเท่ากันเรียงตามชื่อ
    found.sort(function (a, b) {
      const difference = riskRank(a) - riskRank(b);
      if (difference !== 0) {
        return difference;
      }
      return a.name.localeCompare(b.name, 'th');
    });
    const shown = found.slice(0, 8);

    if (shown.length === 0) {
      list.innerHTML = '<li class="no-result">ไม่พบยาที่ค้นหา</li>';
    } else {
      const chosenIds = chosenMedicineIds();
      let html = '';
      for (const medicine of shown) {
        html += medicineResultHtml(medicine, chosenIds);
      }
      list.innerHTML = html;
    }
    list.hidden = false;
    searchBox.setAttribute('aria-expanded', 'true');
  }

  // ปิดตัวเลือกยาที่ถูกเลือกในแถวอื่นแล้ว (กันสั่งยาซ้ำ) และปิดปุ่มเพิ่มยาเมื่อเลือกครบทุกตัว
  function syncMedicineChoices() {
    const selects = medicineSelects();
    const chosenValues = [];
    for (const select of selects) {
      if (select.value) {
        chosenValues.push(select.value);
      }
    }

    for (const select of selects) {
      for (const option of select.options) {
        // จำชื่อเดิมของตัวเลือกไว้ก่อน เพื่อเติม/ลบคำว่า "(เลือกแล้ว)" ได้ถูกต้อง
        if (!option.dataset.label) {
          option.dataset.label = option.textContent;
        }
        // ปิดตัวเลือกที่แถวอื่นเลือกไปแล้ว (ยกเว้นตัวที่แถวนี้เลือกอยู่เอง)
        const usedElsewhere = option.value !== '' && option.value !== select.value && chosenValues.includes(option.value);
        option.disabled = usedElsewhere;
        if (usedElsewhere) {
          option.textContent = option.dataset.label + ' (เลือกแล้ว)';
        } else {
          option.textContent = option.dataset.label;
        }
      }
    }
    getElement('addMedicine').disabled = selects.length >= medicines.length;
  }

  // สร้าง HTML ของช่องเลือกยา (ยาที่แพ้มีป้าย "⚠ แพ้" นำหน้า)
  function medicineSelectHtml() {
    let html = '<select aria-label="ยา" required><option value="">เลือกยา</option>';
    for (const medicine of medicines) {
      const risk = medicineRisk(medicine);
      let optionClass = '';
      let prefix = '';
      if (risk) {
        optionClass = ' class="opt-risk-' + risk.level + '"';
        prefix = '⚠ แพ้ · ';
      }
      html += '<option value="' + medicine.id + '"' + optionClass + '>' + prefix + escapeHtml(medicine.name) +
        ' · เหลือ ' + usableStock(medicine) + ' ' + escapeHtml(medicine.unit) + '</option>';
    }
    html += '</select>';
    return html;
  }

  // เพิ่มแถวยาใหม่ในใบสั่งยา (มีช่องเลือกยา จำนวน วิธีใช้ และข้อความเตือนแพ้ยาของแถว)
  function addMedicineRow(medicineId) {
    // เลือกยาครบทุกตัวในคลังแล้ว เพิ่มแถวไม่ได้อีก
    if (getElement('medicineRows').children.length >= medicines.length) {
      return null;
    }
    const row = document.createElement('div');
    row.className = 'medicine-row';
    row.innerHTML =
      medicineSelectHtml() +
      '<input type="number" aria-label="จำนวนยา" min="1" step="1" required placeholder="จำนวน">' +
      '<input aria-label="วิธีใช้" required placeholder="วิธีใช้">' +
      '<button type="button" class="secondary" data-remove>เอาออก</button>' +
      '<p class="row-alert" role="alert" hidden></p>';
    getElement('medicineRows').append(row);

    // ถ้าเพิ่มจากผลค้นหา ให้เลือกยานั้นไว้เลย แล้วอัปเดตตัวเลือกและคำเตือนแพ้ยา
    if (medicineId) {
      row.querySelector('select').value = String(medicineId);
    }
    syncMedicineChoices();
    updateAllergyWarnings();
    return row;
  }

  // เลือกยาจากผลค้นหา: ถ้ามีอยู่แล้วจะไม่เพิ่มซ้ำ แต่พาไปช่องจำนวนของแถวเดิม
  function pickMedicine(id) {
    let existingSelect = null;
    for (const select of medicineSelects()) {
      if (Number(select.value) === id) {
        existingSelect = select;
      }
    }

    let row;
    if (existingSelect) {
      row = existingSelect.parentElement;
      medicineNotice.textContent = 'ยานี้อยู่ในใบสั่งยาแล้ว ปรับจำนวนในรายการเดิมได้เลย';
    } else {
      row = addMedicineRow(id);
      medicineNotice.textContent = '';
    }

    // ล้างคำค้น แล้วย้ายเคอร์เซอร์ไปช่องจำนวน ให้พิมพ์ต่อได้ทันที
    getElement('medicineSearch').value = '';
    renderMedicineResults();
    if (row) {
      row.querySelector('[type=number]').focus();
    }
  }

  // ปุ่มที่กดได้ในรายการผลค้นหา
  function enabledResultButtons() {
    return getElement('medicineResults').querySelectorAll('[data-pick]:not(:disabled)');
  }

  // พิมพ์ในช่องค้นหา -> แสดงผลค้นหาใหม่ทันที
  getElement('medicineSearch').addEventListener('input', renderMedicineResults);

  // กลับมาที่ช่องค้นหา -> แสดงผลค้นหาเดิมอีกครั้ง
  getElement('medicineSearch').addEventListener('focus', renderMedicineResults);

  // คีย์ลัดในช่องค้นหา: Enter เลือกผลแรก, ↓ ไปที่ผลค้นหา, Esc ล้างคำค้น
  getElement('medicineSearch').addEventListener('keydown', function (event) {
    const buttons = enabledResultButtons();
    if (event.key === 'Enter') {
      event.preventDefault();
      if (buttons.length > 0) {
        pickMedicine(Number(buttons[0].dataset.pick));
      }
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (buttons.length > 0) {
        buttons[0].focus();
      }
    }
    if (event.key === 'Escape' && getElement('medicineSearch').value !== '') {
      event.preventDefault();
      getElement('medicineSearch').value = '';
      renderMedicineResults();
    }
  });

  // ใช้ปุ่มลูกศรเลื่อนขึ้น-ลงในรายการผลค้นหา
  getElement('medicineResults').addEventListener('keydown', function (event) {
    const buttons = Array.from(enabledResultButtons());
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = buttons[Math.min(index + 1, buttons.length - 1)];
      if (next) {
        next.focus();
      }
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index > 0) {
        buttons[index - 1].focus();
      } else {
        getElement('medicineSearch').focus();
      }
    }
  });

  // ซ่อนผลค้นหาเมื่อผู้ใช้คลิกหรือกด Tab ออกนอกส่วนค้นหายา
  picker.addEventListener('focusout', function (event) {
    if (!picker.contains(event.relatedTarget)) {
      getElement('medicineResults').hidden = true;
      getElement('medicineSearch').setAttribute('aria-expanded', 'false');
    }
  });

  // เมื่อเปลี่ยนยาในแถวใด: กันเลือกซ้ำ แล้วตรวจแพ้ยาใหม่
  getElement('medicineRows').addEventListener('change', function (event) {
    const select = event.target;
    if (select.tagName !== 'SELECT') {
      return;
    }
    // ยาที่เลือกซ้ำกับแถวอื่นหรือไม่
    let duplicate = false;
    if (select.value) {
      for (const other of medicineSelects()) {
        if (other !== select && other.value === select.value) {
          duplicate = true;
        }
      }
    }
    if (duplicate) {
      select.value = '';
      medicineNotice.textContent = 'ยานี้ถูกเลือกแล้ว กรุณาปรับจำนวนในรายการเดิมหรือเลือกยาอื่น';
    } else {
      medicineNotice.textContent = '';
    }
    syncMedicineChoices();
    updateAllergyWarnings();
  });

  // หน้าต่างยืนยันยกเลิกคิว ต้องระบุเหตุผลทุกครั้ง (สร้างด้วย JavaScript ใช้ร่วมกันทั้งสองหน้า)
  const cancelDialog = document.createElement('dialog');
  cancelDialog.id = 'cancelDialog';
  cancelDialog.setAttribute('aria-labelledby', 'cancelTitle');
  let reasonButtons = '';
  for (const reason of CANCEL_REASONS) {
    reasonButtons += '<button type="button" class="chip" data-reason="' + reason + '">' + reason + '</button>';
  }
  cancelDialog.innerHTML =
    '<h2 id="cancelTitle">ยกเลิกคิว</h2>' +
    '<div id="cancelPatient"></div>' +
    '<form id="cancelForm">' +
    '<p class="cancel-hint" id="cancelHint"></p>' +
    '<fieldset class="reason-chips"><legend>เลือกเหตุผล</legend>' + reasonButtons + '</fieldset>' +
    '<label for="cancelReason">เหตุผลที่ยกเลิก *</label>' +
    '<textarea id="cancelReason" rows="2" minlength="3" maxlength="255" required placeholder="เลือกจากด้านบน หรือพิมพ์เหตุผลเอง"></textarea>' +
    '<div class="actions"><button type="button" class="secondary" data-close>กลับ</button><button type="submit" class="danger">ยืนยันยกเลิกคิว</button></div>' +
    '</form>';
  document.body.append(cancelDialog);

  // =================================================================
  // 5. การ์ดคิวและตารางยา
  // =================================================================

  // กล่องสัญญาณชีพ 6 ช่อง ค่าที่ผิดปกติจะเป็นสีแดง:
  // ความดันตัวบน ≥140 หรือ <90, ชีพจร >100 หรือ <50, อุณหภูมิ ≥37.5, BMI ≥30 หรือ <18.5
  function vitalChipsHtml(vitals) {
    const bmi = PatientMetrics.bmi(vitals.weight_kg, vitals.height_cm);
    const systolic = Number(String(vitals.bp || '').split('/')[0]);
    const pulse = Number(vitals.pulse);

    let bmiText = '';
    if (bmi !== null) {
      bmiText = bmi.toFixed(1);
    }

    // แต่ละช่อง: ชื่อ, ค่า, หน่วย, ผิดปกติหรือไม่
    const chips = [
      { label: 'ความดัน', value: vitals.bp, unit: 'mmHg', alert: systolic >= 140 || (systolic > 0 && systolic < 90) },
      { label: 'ชีพจร', value: vitals.pulse, unit: '/นาที', alert: pulse > 100 || (pulse > 0 && pulse < 50) },
      { label: 'อุณหภูมิ', value: vitals.temp, unit: '°C', alert: Number(vitals.temp) >= 37.5 },
      { label: 'น้ำหนัก', value: vitals.weight_kg, unit: 'กก.', alert: false },
      { label: 'ส่วนสูง', value: vitals.height_cm, unit: 'ซม.', alert: false },
      { label: 'BMI', value: bmiText, unit: '', alert: bmi !== null && (bmi >= 30 || bmi < 18.5) },
    ];

    let html = '<div class="vital-chips">';
    for (const chip of chips) {
      const hasValue = hasText(chip.value);
      let chipClass = 'vital';
      if (chip.alert) {
        chipClass += ' alert-high';
      }
      if (!hasValue) {
        chipClass += ' empty-value';
      }
      html += '<span class="' + chipClass + '"><small>' + chip.label + '</small>';
      if (hasValue) {
        html += '<b>' + escapeHtml(chip.value) + '</b>';
        if (chip.unit) {
          html += '<i>' + chip.unit + '</i>';
        }
      } else {
        html += '<b>–</b>';
      }
      html += '</span>';
    }
    html += '</div>';
    return html;
  }

  // แถวแสดงน้ำหนัก ส่วนสูง และ BMI (ใช้ในหน้าต่างประวัติการรักษา)
  function bodyMeasurementsHtml(vitals) {
    const bmi = PatientMetrics.bmi(vitals.weight_kg, vitals.height_cm);
    let weight = '-';
    if (vitals.weight_kg !== null && vitals.weight_kg !== undefined) {
      weight = vitals.weight_kg;
    }
    let height = '-';
    if (vitals.height_cm !== null && vitals.height_cm !== undefined) {
      height = vitals.height_cm;
    }
    let bmiText = '-';
    if (bmi !== null) {
      bmiText = bmi.toFixed(1);
    }
    return '<div class="meta"><span>น้ำหนัก ' + escapeHtml(weight) + ' กก.</span><span>ส่วนสูง ' + escapeHtml(height) +
      ' ซม.</span><span>BMI ' + bmiText + '</span></div>';
  }

  // ข้อมูลผู้ป่วย + คำเตือนแพ้ยา + อาการ + สัญญาณชีพ ใช้ในหน้าต่างตรวจรักษาและจ่ายยา
  function visitInfoHtml(visit) {
    let html = '<div class="visit-info">';
    if (hasText(visit.allergies)) {
      html += '<div class="flags"><span class="flag danger">⚠ แพ้ยา: ' + escapeHtml(visit.allergies) + '</span></div>';
    }
    html += '<section class="patient-summary">' + patientSummaryHtml(visit) + '</section>';
    html += '<div class="symptom"><small>อาการครั้งนี้</small><p>' + escapeHtml(visit.symptoms || '-') + '</p></div>';
    html += vitalChipsHtml(readVitals(visit));
    html += '</div>';
    return html;
  }

  // กล่องแสดงเหตุผลที่แพทย์ยืนยันสั่งยาที่ผู้ป่วยแพ้
  function overrideNoteHtml(reason) {
    if (!hasText(reason)) {
      return '';
    }
    return '<p class="allergy-override-note"><b>⚠ แพทย์ยืนยันสั่งยาที่ผู้ป่วยมีประวัติแพ้</b><br>เหตุผล: ' + escapeHtml(reason) + '</p>';
  }

  // ทุกรายการยามีราคาที่บันทึกตอนจ่ายแล้วหรือไม่ (คิวที่จ่ายยาเสร็จ)
  function allPricesRecorded(items) {
    for (const item of items) {
      if (item.unit_price === null || item.unit_price === undefined) {
        return false;
      }
    }
    return true;
  }

  // ตารางรายการยา ถ้าส่งประวัติแพ้มาด้วยจะไฮไลต์แถวยาที่แพ้
  // withPrice = true: เพิ่มคอลัมน์ราคาและยอดรวมค่ายา (ใช้ในหน้าต่างจ่ายยาและคิวที่จ่ายแล้ว)
  // ถ้าจ่ายยาแล้วจะใช้ราคาที่บันทึกไว้ตอนจ่าย (unit_price) ถ้ายังไม่จ่ายใช้ราคาปัจจุบันเป็นราคาโดยประมาณ
  function prescriptionsHtml(items, allergies, withPrice) {
    if (items.length === 0) {
      return '<p class="muted">ไม่มีรายการยา</p>';
    }
    const recorded = allPricesRecorded(items);

    // เตรียมข้อมูลยาแต่ละรายการ: ใส่ id (ให้ AllergyCheck.check ใช้ได้) และราคาที่จะใช้คำนวณ
    const catalog = [];
    for (const item of items) {
      const copy = Object.assign({}, item);
      copy.id = item.medicine_id;
      if (recorded) {
        copy.price_per_unit = item.unit_price;
      }
      catalog.push(copy);
    }

    let total = 0;          // ยอดรวม = ผลรวมของ ราคา x จำนวน ทุกรายการ
    let hasUnpriced = false; // มียาที่ยังไม่ได้ตั้งราคา (ราคา 0)

    let tableClass = '';
    if (withPrice) {
      tableClass = 'rx-priced';
    }
    let html = '<table class="' + tableClass + '"><thead><tr><th>ยา</th><th>จำนวน</th><th>วิธีใช้</th>';
    if (withPrice) {
      html += '<th class="num">ราคา/หน่วย</th><th class="num">รวม</th>';
    }
    html += '</tr></thead><tbody>';

    for (const item of catalog) {
      const price = Number(item.price_per_unit || 0);
      const lineTotal = price * Number(item.quantity || 0);
      total = total + lineTotal;
      if (!(Number(item.price_per_unit) > 0)) {
        hasUnpriced = true;
      }

      let risk = null;
      if (allergies) {
        risk = AllergyCheck.check(allergies, item, catalog);
      }
      let rowClass = '';
      let flag = '';
      if (risk) {
        rowClass = 'allergy-hit ' + risk.level;
        flag = '<span class="rx-flag" title="' + escapeHtml(risk.reason) + '">⚠ แพ้</span> ';
      }

      html += '<tr class="' + rowClass + '">';
      html += '<td>' + flag + escapeHtml(item.name || item.medicine_name) + '</td>';
      html += '<td>' + escapeHtml(item.quantity) + ' ' + escapeHtml(item.unit) + '</td>';
      html += '<td>' + escapeHtml(item.dosage_instructions) + '</td>';
      if (withPrice) {
        html += '<td class="num">' + formatBaht(item.price_per_unit) + '</td><td class="num">' + formatBaht(lineTotal) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody>';

    if (withPrice) {
      let label = 'ค่ายาโดยประมาณ <small>(ไม่รวมค่าตรวจและค่าบริการ · ไม่ใช่ใบเสร็จ)</small>';
      if (recorded) {
        label = 'ค่ายา <small>(ราคา ณ เวลาที่จ่ายยา · ไม่รวมค่าตรวจและค่าบริการ)</small>';
      }
      if (hasUnpriced) {
        label += '<br><small class="price-warning">มียาที่ยังไม่ได้ตั้งราคา คิดเป็น ฿0.00</small>';
      }
      html += '<tfoot><tr><td colspan="4">' + label + '</td><td class="num total">' + formatBaht(total) + '</td></tr></tfoot>';
    }
    html += '</table>';
    return html;
  }

  // การ์ดคิวผู้ป่วย 1 ใบ: ข้อมูลผู้ป่วย ป้ายแพ้ยา อาการ สัญญาณชีพ ผลวินิจฉัย และปุ่มตามบทบาท/สถานะ
  function visitCardHtml(visit, index) {
    // ข้อมูลย่อยใต้ชื่อ: HN · เพศ · อายุ · กรุ๊ปเลือด
    const age = PatientMetrics.age(visit.date_of_birth);
    const facts = [escapeHtml(visit.hn_code), genderLabel(visit.gender, 'ไม่ระบุเพศ')];
    if (age === null) {
      facts.push('ไม่ระบุอายุ');
    } else {
      facts.push(age + ' ปี');
    }
    if (visit.blood_type) {
      facts.push('กรุ๊ป ' + escapeHtml(visit.blood_type));
    }

    // เวลาที่แสดงมุมขวาบนของการ์ด
    let timeText;
    if (visit.status === 'completed') {
      timeText = 'เสร็จ ' + formatClock(visit.dispensed_at);
    } else if (visit.status === 'cancelled') {
      timeText = 'ยกเลิก ' + formatClock(visit.cancelled_at);
    } else {
      timeText = formatClock(visit.created_at) + ' · ' + waitingTime(visit.created_at);
    }

    // ป้ายแพ้ยาและโรคประจำตัว
    let flags = '';
    if (hasText(visit.allergies)) {
      flags += '<span class="flag danger">⚠ แพ้ยา: ' + escapeHtml(visit.allergies) + '</span>';
    } else {
      flags += '<span class="flag ok">ไม่มีประวัติแพ้ยา</span>';
    }
    if (hasText(visit.underlying_conditions)) {
      flags += '<span class="flag warn">โรคประจำตัว: ' + escapeHtml(visit.underlying_conditions) + '</span>';
    }

    // ปุ่มหลักตามบทบาทและสถานะ: แพทย์ตรวจคิวรอตรวจ, พยาบาลจ่ายยาคิวรอจ่ายยา
    let actionButton = '';
    if (isDoctorPage && visit.status === 'waiting') {
      actionButton = '<button data-treat="' + visit.id + '">ตรวจรักษา</button>';
    } else if (!isDoctorPage && visit.status === 'ready') {
      if (visit.prescriptions.length > 0) {
        actionButton = '<button data-dispense="' + visit.id + '">ตรวจสอบและจ่ายยา</button>';
      } else {
        actionButton = '<button data-dispense="' + visit.id + '">ปิดคิว · ไม่มียา</button>';
      }
    }

    let cardClass = 'visit-card status-' + visit.status;
    if (highlightIds.includes(visit.id)) {
      cardClass += ' is-new';
    }

    let html = '<article class="' + cardClass + '">';
    html += '<header class="visit-head">';
    html += '<span class="queue-no" aria-label="ลำดับคิว">' + (index + 1) + '</span>';
    html += '<div class="who"><h3>' + escapeHtml(visit.prefix || '') + escapeHtml(visit.first_name) + ' ' + escapeHtml(visit.last_name) + '</h3><p>' + facts.join(' · ') + '</p></div>';
    html += '<div class="visit-status"><span class="tag ' + visit.status + '">' + STATUS_LABELS[visit.status] + '</span><small>' + timeText + '</small></div>';
    html += '</header>';
    html += '<div class="flags">' + flags + '</div>';
    html += '<div class="symptom"><small>อาการสำคัญ</small><p>' + escapeHtml(visit.symptoms || '-') + '</p></div>';

    if (visit.status === 'cancelled') {
      html += '<p class="cancel-note"><b>ยกเลิกคิว</b> · ' + escapeHtml(visit.cancel_reason || '-') +
        '<br><small>โดย ' + escapeHtml(visit.cancelled_by_name || '-') + ' เวลา ' + formatClock(visit.cancelled_at) + '</small></p>';
    }

    html += vitalChipsHtml(readVitals(visit));

    // ผลการตรวจ (มีเมื่อแพทย์ตรวจแล้ว)
    if (visit.diagnosis) {
      html += '<div class="order">';
      html += '<p><small>การวินิจฉัย</small>' + escapeHtml(visit.diagnosis) + '</p>';
      if (hasText(visit.treatment_notes)) {
        html += '<p><small>คำสั่งแพทย์</small>' + escapeHtml(visit.treatment_notes) + '</p>';
      }
      html += '<p class="muted">แพทย์: ' + escapeHtml(visit.doctor_name || '-') + ' · ยา ' + visit.prescriptions.length + ' รายการ</p>';
      html += overrideNoteHtml(visit.allergy_override);
      html += prescriptionsHtml(visit.prescriptions, visit.allergies, visit.status === 'completed');
      html += '</div>';
    }

    // ปุ่มด้านล่างการ์ด
    html += '<footer class="visit-actions">';
    if (visit.status === 'waiting' || visit.status === 'ready') {
      html += '<button class="secondary cancel-visit" data-cancel="' + visit.id + '">ยกเลิกคิว</button>';
    }
    html += '<button class="secondary" data-history="' + visit.patient_id + '">ดูประวัติ</button>';
    html += actionButton;
    html += '</footer>';
    html += '</article>';
    return html;
  }

  // =================================================================
  // 6. วาดหน้าและรีเฟรชคิวอัตโนมัติ
  // =================================================================

  // ไฮไลต์ขั้นตอน 1-2-3 ตามแท็บที่เลือก
  // 0 = บันทึกก่อนตรวจ, 1 = ตรวจรักษา, 2 = จ่ายยา, -1 = ไม่ไฮไลต์ (แท็บเสร็จสิ้น/ยกเลิก)
  function updateFlowSteps() {
    let step;
    if (currentTab === 'completed' || currentTab === 'cancelled') {
      step = -1;
    } else if (currentTab === 'ready') {
      step = 2;
    } else if (isDoctorPage) {
      step = 1;
    } else {
      step = 0;
    }
    const spans = document.querySelectorAll('.flow span');
    for (let index = 0; index < spans.length; index++) {
      if (index === step) {
        spans[index].classList.add('current');
        spans[index].setAttribute('aria-current', 'step');
      } else {
        spans[index].classList.remove('current');
        spans[index].removeAttribute('aria-current');
      }
    }
  }

  // คำอธิบายใต้ตัวเลขของแต่ละแท็บ (ต่างกันระหว่างหน้าแพทย์กับพยาบาล)
  function statusHint(status) {
    if (status === 'waiting') {
      return isDoctorPage ? 'ผู้ป่วยที่พร้อมให้ตรวจ' : 'ส่งเข้าคิวแล้ว รอหมอตรวจ';
    }
    if (status === 'ready') {
      return isDoctorPage ? 'ส่งต่อพยาบาลแล้ว' : 'หมอสั่งยาแล้ว รอจ่าย';
    }
    if (status === 'completed') {
      return 'จ่ายยาและปิดคิวแล้ว';
    }
    return 'ผู้ป่วยกลับหรือลงทะเบียนผิด';
  }

  // นับจำนวนคิวในแต่ละสถานะ
  function countVisits(status) {
    let count = 0;
    for (const visit of visits) {
      if (visit.status === status) {
        count = count + 1;
      }
    }
    return count;
  }

  // การ์ดสรุปจำนวนแต่ละสถานะ (กดเพื่อเปลี่ยนแท็บ) + ปุ่มด้านบน
  function renderToolbar() {
    let html = '<div class="stat-tiles" role="tablist" aria-label="สถานะคิว">';
    for (const status of STATUSES) {
      const isActive = currentTab === status;
      let tileClass = 'stat-tile tile-' + status;
      if (isActive) {
        tileClass += ' active';
      }
      html += '<button type="button" role="tab" aria-selected="' + isActive + '" class="' + tileClass + '" data-filter="' + status + '">';
      html += '<span>' + STATUS_LABELS[status] + '</span><b>' + countVisits(status) + '</b><small>' + statusHint(status) + '</small>';
      html += '</button>';
    }
    html += '</div>';

    html += '<div class="toolbar-actions">';
    if (!isDoctorPage) {
      html += '<button id="newIntake">+ บันทึกก่อนตรวจ</button><a class="button secondary" href="/patients.html">ลงทะเบียนผู้ป่วยใหม่</a>';
    }
    html += '<span class="sync-status" id="syncStatus" role="status" aria-live="polite"></span>';
    html += '<button class="secondary" id="refresh">↻ รีเฟรชคิว</button>';
    html += '</div>';
    getElement('filters').innerHTML = html;
  }

  // ข้อความเมื่อแท็บไม่มีคิว
  function emptyQueueHtml() {
    let title;
    if (currentTab === 'completed') {
      title = 'ยังไม่มีคิวที่เสร็จสิ้นวันนี้';
    } else if (currentTab === 'cancelled') {
      title = 'ไม่มีคิวที่ยกเลิกวันนี้';
    } else {
      title = 'ไม่มีผู้ป่วย' + STATUS_LABELS[currentTab];
    }

    let hint;
    if (currentTab === 'cancelled') {
      hint = 'คิวที่ยกเลิกด้วยปุ่ม “ยกเลิกคิว” จะแสดงที่นี่พร้อมเหตุผล';
    } else if (isDoctorPage) {
      hint = 'เมื่อพยาบาลบันทึกข้อมูลก่อนตรวจ คิวผู้ป่วยจะแสดงที่นี่';
    } else if (currentTab === 'ready') {
      hint = 'เมื่อหมอตรวจเสร็จ รายการจ่ายยาจะแสดงที่นี่';
    } else {
      hint = 'เลือก “บันทึกก่อนตรวจ” เพื่อส่งผู้ป่วยเข้าคิว';
    }
    return '<div class="empty"><h3>' + title + '</h3><p>' + hint + '</p></div>';
  }

  // วาดหน้าใหม่ทั้งหมด: ขั้นตอน 1-2-3, การ์ดสรุปจำนวนแต่ละสถานะ, ปุ่ม และรายการคิวของแท็บที่เลือก
  function render() {
    updateFlowSteps();
    renderToolbar();

    // เฉพาะคิวของแท็บที่เลือก
    const rows = [];
    for (const visit of visits) {
      if (visit.status === currentTab) {
        rows.push(visit);
      }
    }
    // คิวที่เสร็จสิ้น/ยกเลิก เรียงจากล่าสุดไว้บนสุด (คิวอื่นเรียงตามลำดับมาก่อน-หลังเหมือนเดิม)
    if (currentTab === 'completed') {
      rows.sort(function (a, b) {
        return new Date(b.dispensed_at) - new Date(a.dispensed_at);
      });
    }
    if (currentTab === 'cancelled') {
      rows.sort(function (a, b) {
        return new Date(b.cancelled_at) - new Date(a.cancelled_at);
      });
    }

    if (rows.length === 0) {
      getElement('queue').innerHTML = emptyQueueHtml();
    } else {
      let html = '<div class="visit-grid">';
      for (let index = 0; index < rows.length; index++) {
        html += visitCardHtml(rows[index], index);
      }
      html += '</div>';
      getElement('queue').innerHTML = html;
    }
    updateSyncStatus();
  }

  // ข้อความสถานะการอัปเดตมุมจอ เช่น "อัปเดตอัตโนมัติ · ล่าสุด 10:15:30"
  function updateSyncStatus() {
    const status = getElement('syncStatus');
    if (!status) {
      return;
    }
    if (syncFailed) {
      status.classList.add('failed');
      status.textContent = 'อัปเดตไม่สำเร็จ · จะลองใหม่อัตโนมัติ';
    } else {
      status.classList.remove('failed');
      if (lastSync) {
        status.textContent = 'อัปเดตอัตโนมัติ · ล่าสุด ' + lastSync.toLocaleTimeString('th-TH');
      } else {
        status.textContent = '';
      }
    }
  }

  // โหลดคิวล่าสุดจากเซิร์ฟเวอร์แล้ววาดหน้าใหม่
  // isBackground = true: รีเฟรชอัตโนมัติ ถ้าโหลดไม่สำเร็จจะคงคิวเดิมไว้ แทนการล้างหน้าจอ
  async function refresh(isBackground) {
    try {
      const result = await callApi('/api/visits');
      const data = result.data;
      // แปลงข้อมูลเป็นข้อความ ใช้เทียบกับรอบก่อนได้ง่าย
      const payload = JSON.stringify(data);

      // คิวที่เพิ่งปรากฏ (ไม่ใช่ตอนโหลดครั้งแรก) จะถูกไฮไลต์สั้น ๆ
      highlightIds = [];
      if (knownIds) {
        for (const visit of data) {
          if (!knownIds.includes(visit.id)) {
            highlightIds.push(visit.id);
          }
        }
      }
      knownIds = [];
      for (const visit of data) {
        knownIds.push(visit.id);
      }

      lastSync = new Date();
      syncFailed = false;

      // ข้อมูลไม่เปลี่ยน -> ไม่ต้องวาดใหม่ ยกเว้นขึ้นนาทีใหม่ (ให้ข้อความ "รอ x นาที" บนการ์ดเดินต่อ)
      const minute = Math.floor(Date.now() / 60000);
      if (isBackground && payload === lastPayload && minute === lastRenderMinute) {
        updateSyncStatus();
        return;
      }
      visits = data;
      lastPayload = payload;
      lastRenderMinute = minute;
      render();
      showNotice(null);
    } catch (err) {
      // รีเฟรชอัตโนมัติล้มเหลว -> แจ้งที่มุมจอเฉย ๆ แล้วรอรอบถัดไป
      if (isBackground) {
        syncFailed = true;
        updateSyncStatus();
        return;
      }
      showNotice(err);
      getElement('queue').innerHTML = '<div class="card empty">โหลดคิวไม่สำเร็จ กรุณาลองรีเฟรช</div>';
    }
  }

  // รีเฟรชอัตโนมัติ: ข้ามรอบถ้าแท็บถูกซ่อน หรือกำลังส่งฟอร์มอยู่ (busy)
  function autoRefresh() {
    if (!document.hidden && !busy) {
      refresh(true);
    }
  }

  function startAutoRefresh() {
    setInterval(autoRefresh, AUTO_REFRESH_MS);
    // กลับมาที่แท็บนี้ -> รีเฟรชทันที ไม่ต้องรอรอบถัดไป
    document.addEventListener('visibilitychange', autoRefresh);
  }

  // =================================================================
  // 7. ปุ่มต่าง ๆ และการส่งฟอร์ม
  // =================================================================

  // พยาบาลกด "บันทึกก่อนตรวจ": สลับไปแท็บรอตรวจ เปิดหน้าต่าง แล้วโหลดรายชื่อผู้ป่วย
  async function openIntakeDialog() {
    currentTab = 'waiting';
    render();
    getElement('intakeForm').reset();
    getElement('intakeDialog').showModal();
    await searchPatients();
  }

  // แพทย์กด "ตรวจรักษา": โหลดรายการยาล่าสุด แล้วเปิดหน้าต่างตรวจรักษา
  async function openTreatmentDialog(visitId) {
    selected = findVisit(visitId);
    getElement('treatmentForm').reset();
    getElement('medicineRows').innerHTML = '';
    medicineNotice.textContent = '';
    getElement('treatmentPatient').innerHTML = visitInfoHtml(selected);
    try {
      const result = await callApi('/api/medicines');
      medicines = result.data;
      syncMedicineChoices();
      updateAllergyWarnings();
      renderAllergyBanner();
      renderMedicineResults();
      getElement('treatmentDialog').showModal();
    } catch (err) {
      showNotice(err);
    }
  }

  // กด "ยกเลิกคิว": เปิดหน้าต่างยืนยันพร้อมคำอธิบายตามสถานะคิว
  function openCancelDialog(visitId) {
    selected = findVisit(visitId);
    getElement('cancelForm').reset();
    for (const chip of cancelDialog.querySelectorAll('.chip')) {
      chip.classList.remove('active');
    }
    getElement('cancelPatient').innerHTML = '<p class="cancel-who"><b>' + patientName(selected) + '</b><br><small>สถานะ: ' + STATUS_LABELS[selected.status] + '</small></p>';
    if (selected.status === 'ready') {
      getElement('cancelHint').textContent = 'แพทย์ตรวจแล้ว ประวัติการรักษายังถูกเก็บไว้ แต่จะไม่จ่ายยาและไม่ตัดสต๊อก';
    } else {
      getElement('cancelHint').textContent = 'ผู้ป่วยจะถูกนำออกจากคิวรอตรวจ และส่งเข้าคิวใหม่ได้ภายหลัง';
    }
    cancelDialog.showModal();
  }

  // กดปุ่มเหตุผลลัด: ใส่ข้อความลงช่องเหตุผล และไฮไลต์ปุ่มที่เลือก
  function chooseCancelReason(button) {
    getElement('cancelReason').value = button.dataset.reason;
    for (const chip of cancelDialog.querySelectorAll('.chip')) {
      if (chip === button) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    }
  }

  // พยาบาลกด "จ่ายยา": แสดงรายการยาและค่ายาให้ตรวจสอบก่อนยืนยัน
  function openDispenseDialog(visitId) {
    selected = findVisit(visitId);
    getElement('dispenseForm').reset();
    let html = visitInfoHtml(selected);
    html += '<p>การวินิจฉัย: ' + escapeHtml(selected.diagnosis) + '<br>คำสั่งแพทย์: ' + escapeHtml(selected.treatment_notes || '-') + '</p>';
    html += overrideNoteHtml(selected.allergy_override);
    html += prescriptionsHtml(selected.prescriptions, selected.allergies, true);
    getElement('dispenseDetails').innerHTML = html;
    if (selected.prescriptions.length > 0) {
      getElement('dispenseSubmit').textContent = 'ยืนยันจ่ายยาและตัดสต๊อก';
    } else {
      getElement('dispenseSubmit').textContent = 'ยืนยันปิดคิว';
    }
    getElement('dispenseDialog').showModal();
  }

  // กด "ดูประวัติ": โหลดประวัติการรักษาทั้งหมดของผู้ป่วย
  async function openHistoryDialog(patientId) {
    getElement('historyDetails').textContent = 'กำลังโหลด…';
    getElement('historyDialog').showModal();
    try {
      const result = await callApi('/api/records/patient/' + patientId);
      if (result.data.length === 0) {
        getElement('historyDetails').innerHTML = '<p>ยังไม่มีประวัติการรักษา</p>';
        return;
      }
      let html = '';
      for (const record of result.data) {
        const items = record.prescriptions || [];
        // แสดงราคาเฉพาะครั้งที่จ่ายยาแล้ว (ทุกรายการมีราคาที่บันทึกไว้)
        const showPrice = items.length > 0 && allPricesRecorded(items);
        html += '<div class="card">';
        html += '<p>' + escapeHtml(record.visit_date) + ' · ' + escapeHtml(record.doctor_name) +
          '<br>อาการ: ' + escapeHtml(record.symptoms) +
          '<br>การวินิจฉัย: ' + escapeHtml(record.diagnosis) +
          '<br>คำสั่ง: ' + escapeHtml(record.treatment_notes) + '</p>';
        html += overrideNoteHtml(record.allergy_override);
        html += bodyMeasurementsHtml(readVitals(record));
        html += prescriptionsHtml(items, null, showPrice);
        html += '</div>';
      }
      getElement('historyDetails').innerHTML = html;
    } catch (err) {
      getElement('historyDetails').textContent = err.message;
    }
  }

  // ลบแถวยาที่กด "เอาออก"
  function removeMedicineRow(button) {
    button.parentElement.remove();
    medicineNotice.textContent = '';
    syncMedicineChoices();
    updateAllergyWarnings();
  }

  // จัดการการคลิกปุ่มทั้งหน้าในที่เดียว (event delegation)
  // เพราะการ์ดและปุ่มถูกสร้างใหม่ทุกครั้งที่ render จึงผูก event ไว้ที่ document แทน
  document.addEventListener('click', async function (event) {
    const button = event.target.closest('button');
    if (!button) {
      return;
    }
    // ปุ่มปิดหน้าต่าง
    if (button.hasAttribute('data-close')) {
      button.closest('dialog').close();
      return;
    }
    // กดการ์ดสถานะ -> เปลี่ยนแท็บ
    if (button.dataset.filter) {
      currentTab = button.dataset.filter;
      render();
    }
    if (button.id === 'refresh') {
      await refresh(false);
    }
    if (button.id === 'newIntake') {
      await openIntakeDialog();
    }
    if (button.dataset.treat) {
      await openTreatmentDialog(Number(button.dataset.treat));
    }
    // ปุ่ม "+ เพิ่มยา" (เพิ่มแถวว่าง), เลือกยาจากผลค้นหา, และ "เอาออก" (ลบแถวยา)
    if (button.id === 'addMedicine') {
      addMedicineRow();
    }
    if (button.dataset.pick) {
      pickMedicine(Number(button.dataset.pick));
    }
    if (button.hasAttribute('data-remove')) {
      removeMedicineRow(button);
    }
    if (button.dataset.cancel) {
      openCancelDialog(Number(button.dataset.cancel));
    }
    if (button.dataset.reason) {
      chooseCancelReason(button);
    }
    if (button.dataset.dispense) {
      openDispenseDialog(Number(button.dataset.dispense));
    }
    if (button.dataset.history) {
      await openHistoryDialog(button.dataset.history);
    }
  });

  // หน้าต่างบันทึกก่อนตรวจ: พิมพ์ค้นหา -> ค้นผู้ป่วย, เลือกผู้ป่วย -> โหลดข้อมูล,
  // กรอกน้ำหนัก/ส่วนสูง -> คำนวณ BMI, ล้างฟอร์ม -> ล้าง BMI และกล่องข้อมูลผู้ป่วย
  getElement('patientSearch').addEventListener('input', searchPatients);
  getElement('patient').addEventListener('change', loadPatientDetails);
  getElement('intake_weight_kg').addEventListener('input', updateIntakeBmi);
  getElement('intake_height_cm').addEventListener('input', updateIntakeBmi);
  getElement('intakeForm').addEventListener('reset', function () {
    getElement('intake_bmi').value = '';
    clearPatientDetails();
  });

  // มียาซ้ำในใบสั่งยาหรือไม่
  function hasDuplicateMedicine() {
    const values = [];
    for (const select of medicineSelects()) {
      if (select.value) {
        if (values.includes(select.value)) {
          return true;
        }
        values.push(select.value);
      }
    }
    return false;
  }

  // ส่งฟอร์มทุกแบบผ่านฟังก์ชันนี้: ตรวจข้อมูลเบื้องต้น กันกดซ้ำ (busy)
  // เรียก API แล้วปิดหน้าต่างและโหลดคิวใหม่ ถ้าผิดพลาดแสดงข้อความ
  async function submitForm(event, sendRequest) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const form = event.target;
    // บันทึกก่อนตรวจ: ต้องเลือกผู้ป่วยและโหลดข้อมูลเสร็จก่อน
    if (form.id === 'intakeForm' && !intakePatientReady) {
      alert('กรุณาเลือกผู้ป่วยและรอให้ข้อมูลแสดงครบก่อนส่งเข้าคิว');
      return;
    }
    // ตรวจรักษา: ห้ามมียาซ้ำในใบสั่งยา
    if (form.id === 'treatmentForm' && hasDuplicateMedicine()) {
      medicineNotice.textContent = 'เลือกยาซ้ำ กรุณาปรับจำนวนในรายการเดิมหรือเลือกยาอื่น';
      return;
    }

    busy = true;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await sendRequest();
      // สำเร็จ -> ปิดหน้าต่างแล้วโหลดคิวใหม่
      form.closest('dialog').close();
      await refresh(false);
    } catch (err) {
      alert(err.message);
    } finally {
      // ไม่ว่าสำเร็จหรือไม่ คืนสถานะปุ่ม
      busy = false;
      button.disabled = false;
    }
  }

  // ค่าตัวเลขจากช่องกรอก (ช่องว่าง = null)
  function numberOrNull(id) {
    const value = getElement(id).value;
    if (value === '') {
      return null;
    }
    return Number(value);
  }

  // ฟอร์มบันทึกก่อนตรวจ -> POST /api/visits
  getElement('intakeForm').addEventListener('submit', function (event) {
    submitForm(event, function () {
      return callApi('/api/visits', 'POST', {
        patient_id: Number(getElement('patient').value),
        symptoms: getElement('symptoms').value,
        vital_signs: {
          bp: getElement('bp').value,
          pulse: getElement('pulse').value,
          temp: getElement('temp').value,
          weight_kg: numberOrNull('intake_weight_kg'),
          height_cm: numberOrNull('intake_height_cm'),
        },
      });
    });
  });

  // ฟอร์มตรวจรักษา -> POST /api/visits/:id/treatment
  getElement('treatmentForm').addEventListener('submit', function (event) {
    submitForm(event, function () {
      // รวบรวมรายการยาจากทุกแถว
      const orderedMedicines = [];
      for (const row of document.querySelectorAll('.medicine-row')) {
        orderedMedicines.push({
          medicine_id: Number(row.querySelector('select').value),
          quantity: Number(row.querySelector('[type=number]').value),
          dosage_instructions: row.querySelector('input:not([type=number])').value,
        });
      }
      const body = {
        diagnosis: getElement('diagnosis').value,
        treatment_notes: getElement('notes').value,
        medicines: orderedMedicines,
      };
      // ส่งเหตุผลยืนยันสั่งยาที่แพ้ เฉพาะเมื่อกล่องเตือนแพ้ยาแสดงอยู่
      if (!allergyPanel.hidden) {
        body.allergy_override = getElement('allergyOverride').value;
      }
      return callApi('/api/visits/' + selected.id + '/treatment', 'POST', body);
    });
  });

  // ฟอร์มยืนยันจ่ายยา -> POST /api/visits/:id/dispense
  getElement('dispenseForm').addEventListener('submit', function (event) {
    submitForm(event, function () {
      return callApi('/api/visits/' + selected.id + '/dispense', 'POST', {});
    });
  });

  // ฟอร์มยกเลิกคิว -> POST /api/visits/:id/cancel
  getElement('cancelForm').addEventListener('submit', function (event) {
    submitForm(event, function () {
      return callApi('/api/visits/' + selected.id + '/cancel', 'POST', { reason: getElement('cancelReason').value });
    });
  });

  // ออกจากระบบ: ลบ token แล้วกลับหน้า login
  getElement('logout').addEventListener('click', function () {
    localStorage.clear();
    location.href = '/';
  });

  // =================================================================
  // 8. เริ่มต้นเมื่อเปิดหน้า
  // =================================================================

  // สร้างเมนูด้านซ้ายตามบทบาท
  function buildNavigation(home) {
    let html = '<strong>Clinic Flow</strong><p>' + roleLabel(currentUser.role) + '</p>';
    if (isDoctorPage) {
      html += '<a class="active" href="' + home + '">ห้องตรวจ</a>';
    } else {
      html += '<a class="active" href="' + home + '">คิวตรวจและจ่ายยา</a>';
    }
    html += '<a href="/patients.html">ข้อมูลผู้ป่วย</a>';
    html += '<a href="/records.html">ประวัติการรักษา</a>';
    html += '<a href="/inventory.html">คลังยา</a>';
    if (isDoctorPage) {
      html += '<a href="/dashboard.html">ภาพรวมคลินิก</a>';
    }
    if (currentUser.role === 'admin') {
      html += '<a href="/users.html">บัญชีผู้ใช้งาน</a>';
    }
    html += '<a href="/account.html">บัญชีของฉัน</a>';
    getElement('navigation').innerHTML = html;
  }

  // ตรวจการเข้าสู่ระบบและบทบาท
  // ถ้าบทบาทไม่ตรงกับหน้า (เช่น พยาบาลเปิดหน้าแพทย์) จะส่งไปหน้าที่ถูกต้อง แล้วสร้างเมนูและโหลดคิว
  async function startPage() {
    if (!token) {
      location.replace('/');
      return;
    }
    try {
      const result = await callApi('/api/auth/me');
      currentUser = result.user;
      const role = currentUser.role;
      if (role !== 'admin' && role !== 'doctor' && role !== 'nurse') {
        throw new Error('บัญชีนี้ยังไม่ได้กำหนดสิทธิ์หมอหรือพยาบาล');
      }

      // หน้าหลักของบทบาทนี้
      const isNurse = role === 'nurse';
      let home = '/doctor.html';
      if (isNurse) {
        home = '/nurse.html';
      }
      // หน้านี้เป็นหน้าแพทย์ แต่ผู้ใช้เป็นพยาบาล (หรือกลับกัน) -> ส่งไปหน้าที่ถูกต้อง
      if (isDoctorPage === isNurse) {
        location.replace(home);
        return;
      }

      currentTab = 'waiting';
      if (isDoctorPage) {
        getElement('heading').textContent = 'ห้องตรวจแพทย์';
        getElement('subtitle').textContent = (currentUser.full_name || currentUser.username) + ' · ' + roleLabel(role) + ' — ตรวจ วินิจฉัย และสั่งยา';
      } else {
        getElement('heading').textContent = 'เคาน์เตอร์พยาบาล';
        getElement('subtitle').textContent = (currentUser.full_name || currentUser.username) + ' · พยาบาล — บันทึกก่อนตรวจ และจ่ายยาตามคำสั่งแพทย์';
      }
      buildNavigation(home);

      // โหลดคิวครั้งแรก แล้วเริ่มรีเฟรชอัตโนมัติ
      await refresh(false);
      startAutoRefresh();
    } catch (err) {
      showNotice(err);
      getElement('queue').innerHTML = '';
    }
  }

  startPage();
})();
