// หน้าบัญชีผู้ใช้งาน (users.html) เฉพาะเจ้าของคลินิก
// สร้างบัญชีแพทย์/พยาบาล แก้ไขชื่อและบทบาท รีเซ็ตรหัสผ่าน และปิด/เปิดบัญชี (ไม่มีการลบบัญชี)

// ฟอร์มสร้างบัญชี, ช่องข้อความผลลัพธ์ และ token ของผู้ที่ล็อกอินอยู่
const form = document.getElementById('userForm');
const message = document.getElementById('message');
const accountToken = localStorage.getItem('token');

// currentUser = ผู้ที่ล็อกอินอยู่, users = รายชื่อบัญชีทั้งหมด, selected = บัญชีที่กดปุ่มจัดการล่าสุด
let currentUser = null;
let users = [];
let selected = null;

// ซ่อนฟอร์มไว้ก่อนจนกว่าจะยืนยันว่าเป็นเจ้าของคลินิก
form.hidden = true;

// ชื่อบทบาทภาษาไทยที่แสดงในตาราง
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
  return escapeHtml(role);
}

// แปลงอักขระพิเศษก่อนใส่ลง HTML กันการฝังโค้ดอันตราย (XSS) จากข้อมูลที่ผู้ใช้กรอก
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

// เรียก API พร้อมแนบ token ถ้า token หมดอายุหรือบัญชีถูกปิด (401) จะกลับหน้า login
async function callApi(url, method, body) {
  const options = {
    method: method || 'GET',
    headers: {
      Authorization: 'Bearer ' + accountToken,
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json();
  if (res.status === 401) {
    localStorage.clear();
    location.replace('/');
    throw new Error(data.message);
  }
  if (!res.ok) {
    throw new Error(data.message || 'ดำเนินการไม่สำเร็จ');
  }
  return data;
}

// แปลงวันที่เป็นรูปแบบไทย เช่น 10 ต.ค. 2569 (ค่าผิดรูปแบบแสดง -)
function formatDate(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

// สร้าง HTML ของแถวบัญชี 1 แถว
// บัญชีตัวเองและบัญชีเจ้าของคลินิกจะไม่มีปุ่มปิดบัญชี (เซิร์ฟเวอร์ก็ห้ามไว้เช่นกัน)
function userRowHtml(user) {
  const isSelf = user.id === currentUser.id;
  const isOwner = user.role === 'admin';

  let rowClass = '';
  let statusClass = 'on';
  let statusText = 'ใช้งานอยู่';
  if (!user.is_active) {
    rowClass = 'inactive';
    statusClass = 'off';
    statusText = 'ปิดแล้ว';
  }

  let html = '<tr class="' + rowClass + '">';
  html += '<td><strong>' + escapeHtml(user.full_name) + '</strong>';
  if (isSelf) {
    html += ' <span class="you">คุณ</span>';
  }
  html += '</td>';
  html += '<td>' + escapeHtml(user.username) + '</td>';
  html += '<td><span class="role-pill role-' + user.role + '">' + roleLabel(user.role) + '</span></td>';
  html += '<td><span class="status-pill ' + statusClass + '">' + statusText + '</span></td>';
  html += '<td>' + formatDate(user.created_at) + '</td>';

  html += '<td class="row-actions">';
  html += '<button type="button" class="btn btn-sm btn-warning" data-edit="' + user.id + '">แก้ไข</button> ';
  html += '<button type="button" class="btn btn-sm btn-info" data-reset="' + user.id + '">รีเซ็ตรหัสผ่าน</button> ';
  if (!isSelf && !isOwner) {
    if (user.is_active) {
      html += '<button type="button" class="btn btn-sm btn-danger" data-status="' + user.id + '">ปิดบัญชี</button>';
    } else {
      html += '<button type="button" class="btn btn-sm btn-success" data-status="' + user.id + '">เปิดบัญชี</button>';
    }
  }
  html += '</td>';
  html += '</tr>';
  return html;
}

// แสดงตารางสมาชิกในทีม พร้อมปุ่มจัดการ
function renderUsers() {
  // นับจำนวนบัญชีที่เปิด/ปิดใช้งาน แสดงเหนือตาราง
  let activeCount = 0;
  for (const user of users) {
    if (user.is_active) {
      activeCount = activeCount + 1;
    }
  }
  const closedCount = users.length - activeCount;
  document.getElementById('userCount').textContent = 'ใช้งานอยู่ ' + activeCount + ' · ปิดแล้ว ' + closedCount;

  const rows = document.getElementById('userRows');
  if (users.length === 0) {
    rows.innerHTML = '<tr><td colspan="6">ยังไม่มีบัญชีผู้ใช้</td></tr>';
    return;
  }
  let html = '';
  for (const user of users) {
    html += userRowHtml(user);
  }
  rows.innerHTML = html;
}

// โหลดรายชื่อบัญชีจากเซิร์ฟเวอร์แล้ววาดตารางใหม่ (ถ้าล้มเหลวแสดง error ในตาราง)
async function loadUsers() {
  try {
    const data = await callApi('/api/auth/users');
    users = data.data;
    renderUsers();
  } catch (err) {
    document.getElementById('userRows').innerHTML = '<tr><td colspan="6">' + escapeHtml(err.message) + '</td></tr>';
  }
}

// เปิดหน้าต่าง (dialog) พร้อมล้างข้อมูลและข้อความ error เดิม
function openDialog(id) {
  const dialog = document.getElementById(id);
  dialog.querySelector('form').reset();
  dialog.querySelector('.dialog-error').textContent = '';
  dialog.showModal();
  return dialog;
}

// หาบัญชีจาก id ในรายชื่อที่โหลดไว้
function findUser(id) {
  for (const user of users) {
    if (user.id === id) {
      return user;
    }
  }
  return null;
}

// เมื่อเปิดหน้า: ตรวจสิทธิ์ ถ้าไม่ใช่เจ้าของคลินิกส่งกลับหน้าทำงานของตัวเอง แล้วโหลดรายชื่อบัญชี
async function startPage() {
  if (!accountToken) {
    location.replace('/');
    return;
  }
  try {
    const data = await callApi('/api/auth/me');
    currentUser = data.user;
    if (currentUser.role !== 'admin') {
      if (currentUser.role === 'nurse') {
        location.replace('/nurse.html');
      } else {
        location.replace('/doctor.html');
      }
      return;
    }
    form.hidden = false;
    await loadUsers();
  } catch (err) {
    // เชื่อมต่อไม่ได้ -> แสดงฟอร์มแต่ปิดปุ่มสร้าง พร้อมแจ้งให้โหลดหน้าใหม่
    form.hidden = false;
    form.querySelector('[type=submit]').disabled = true;
    message.dataset.state = 'error';
    message.textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาโหลดหน้าใหม่';
  }
}

// ฟอร์มสร้างบัญชีใหม่
form.addEventListener('submit', async function (event) {
  event.preventDefault();
  // ปิดปุ่มและเปลี่ยนข้อความระหว่างรอ กันกดซ้ำ
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  button.textContent = 'กำลังสร้างบัญชี…';
  message.textContent = '';

  try {
    const username = document.getElementById('username').value.trim();
    await callApi('/api/auth/users', 'POST', {
      username: username,
      password: document.getElementById('password').value,
      full_name: document.getElementById('fullName').value.trim(),
      role: document.getElementById('role').value,
    });
    // สำเร็จ -> แจ้งชื่อบัญชีที่ใช้ล็อกอิน ล้างฟอร์ม แล้วโหลดตารางใหม่
    message.dataset.state = 'success';
    message.textContent = 'สร้างบัญชีสำเร็จ · เข้าสู่ระบบด้วยชื่อบัญชี ' + username;
    form.reset();
    await loadUsers();
  } catch (err) {
    message.dataset.state = 'error';
    message.textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = '+ สร้างบัญชี';
  }
});

// เมื่อล้างฟอร์ม ให้ช่องรหัสผ่านกลับไปซ่อนตัวอักษรด้วย
form.addEventListener('reset', function () {
  document.getElementById('password').type = 'password';
  const toggle = document.getElementById('togglePassword');
  if (toggle) {
    toggle.textContent = 'แสดง';
    toggle.setAttribute('aria-pressed', 'false');
  }
});

// ปุ่ม "แก้ไข": เติมชื่อเดิม และล็อกช่องบทบาทถ้าเป็นบัญชีเจ้าของหรือบัญชีตัวเอง
function openEditDialog() {
  openDialog('editDialog');
  document.getElementById('editAccount').textContent = 'ชื่อบัญชี: ' + selected.username;
  document.getElementById('editFullName').value = selected.full_name;

  const roleSelect = document.getElementById('editRole');
  roleSelect.value = selected.role;
  const locked = selected.role === 'admin' || selected.id === currentUser.id;
  roleSelect.disabled = locked;
  if (locked) {
    document.getElementById('editRoleHelp').textContent = 'บทบาทของบัญชีนี้เปลี่ยนไม่ได้';
  } else {
    document.getElementById('editRoleHelp').textContent = 'เปลี่ยนบทบาทแล้วมีผลทันทีในการเรียกใช้งานครั้งถัดไป';
  }
}

// ปุ่ม "รีเซ็ตรหัสผ่าน": เปิดหน้าต่างให้กรอกรหัสใหม่
function openResetDialog() {
  openDialog('resetDialog');
  document.getElementById('resetAccount').textContent = 'บัญชี: ' + selected.full_name + ' (' + selected.username + ')';
}

// ปุ่ม "ปิด/เปิดบัญชี": เปลี่ยนข้อความในหน้าต่างยืนยันตามสถานะปัจจุบัน
function openStatusDialog() {
  openDialog('statusDialog');
  const account = selected.full_name + ' (' + selected.username + ')';
  const submit = document.getElementById('statusSubmit');
  if (selected.is_active) {
    document.getElementById('statusTitle').textContent = 'ปิดการใช้งานบัญชี';
    document.getElementById('statusText').textContent = account + ' จะเข้าสู่ระบบไม่ได้ทันที ข้อมูลการทำงานเดิมยังอยู่ครบ และเปิดบัญชีกลับได้ภายหลัง';
    submit.textContent = 'ปิดบัญชี';
    submit.className = 'danger';
  } else {
    document.getElementById('statusTitle').textContent = 'เปิดการใช้งานบัญชี';
    document.getElementById('statusText').textContent = account + ' จะกลับมาเข้าสู่ระบบได้ด้วยรหัสผ่านเดิม';
    submit.textContent = 'เปิดบัญชี';
    submit.className = '';
  }
}

// จัดการปุ่มทั้งหน้าในที่เดียว: ปิดหน้าต่าง, แก้ไข, รีเซ็ตรหัสผ่าน, ปิด/เปิดบัญชี
document.addEventListener('click', function (event) {
  // หาปุ่มที่ถูกกด (คลิกโดนตัวอักษรในปุ่มก็นับ) ถ้าไม่ได้กดปุ่มไม่ต้องทำอะไร
  const button = event.target.closest('button');
  if (!button) {
    return;
  }
  if (button.hasAttribute('data-close')) {
    button.closest('dialog').close();
    return;
  }

  // ปุ่มจัดการแต่ละแถวเก็บ id บัญชีไว้ใน data-edit / data-reset / data-status
  const id = Number(button.dataset.edit || button.dataset.reset || button.dataset.status);
  if (!id) {
    return;
  }
  selected = findUser(id);
  if (!selected) {
    return;
  }

  if (button.dataset.edit) {
    openEditDialog();
  }
  if (button.dataset.reset) {
    openResetDialog();
  }
  if (button.dataset.status) {
    openStatusDialog();
  }
});

// ส่งข้อมูลจากหน้าต่าง ถ้าสำเร็จจะปิดหน้าต่างและโหลดตารางใหม่ ถ้าไม่สำเร็จแสดง error ในหน้าต่าง
async function submitDialog(event, sendRequest) {
  event.preventDefault();
  const dialog = event.target.closest('dialog');
  const button = event.target.querySelector('[type=submit]');
  button.disabled = true;
  try {
    const result = await sendRequest();
    dialog.close();
    const listMessage = document.getElementById('listMessage');
    listMessage.dataset.state = 'success';
    listMessage.textContent = result.message;
    await loadUsers();
  } catch (err) {
    dialog.querySelector('.dialog-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

// แก้ไข: ส่งบทบาทไปด้วยเฉพาะเมื่อช่องบทบาทไม่ถูกล็อก
document.getElementById('editForm').addEventListener('submit', function (event) {
  submitDialog(event, function () {
    const body = { full_name: document.getElementById('editFullName').value.trim() };
    const roleSelect = document.getElementById('editRole');
    if (!roleSelect.disabled) {
      body.role = roleSelect.value;
    }
    return callApi('/api/auth/users/' + selected.id, 'PUT', body);
  });
});

// รีเซ็ตรหัสผ่าน
document.getElementById('resetForm').addEventListener('submit', function (event) {
  submitDialog(event, function () {
    return callApi('/api/auth/users/' + selected.id + '/reset-password', 'POST', {
      password: document.getElementById('resetPassword').value,
    });
  });
});

// ปิด/เปิดบัญชี: ส่งสถานะตรงข้ามกับปัจจุบัน
document.getElementById('statusForm').addEventListener('submit', function (event) {
  submitDialog(event, function () {
    return callApi('/api/auth/users/' + selected.id + '/status', 'PATCH', { is_active: !selected.is_active });
  });
});

startPage();
