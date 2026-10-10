// หน้าบัญชีผู้ใช้งาน (users.html) เฉพาะเจ้าของคลินิก
// สร้างบัญชีแพทย์/พยาบาล แก้ไขชื่อและบทบาท รีเซ็ตรหัสผ่าน และปิด/เปิดบัญชี (ไม่มีการลบบัญชี)

// ฟอร์มสร้างบัญชี, ช่องข้อความผลลัพธ์ และ token ของผู้ที่ล็อกอินอยู่
const form = document.getElementById('userForm');
const message = document.getElementById('message');
const accountToken = localStorage.getItem('token');
// ชื่อบทบาทภาษาไทยที่แสดงในตาราง
const roleLabels = {admin: 'เจ้าของคลินิก', doctor: 'แพทย์', nurse: 'พยาบาล'};
// แปลงอักขระพิเศษก่อนใส่ลง HTML กันการฝังโค้ดอันตราย (XSS) จากข้อมูลที่ผู้ใช้กรอก
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// currentUser = ผู้ที่ล็อกอินอยู่, users = รายชื่อบัญชีทั้งหมด, selected = บัญชีที่กดปุ่มจัดการล่าสุด
let currentUser, users = [], selected;
// ซ่อนฟอร์มไว้ก่อนจนกว่าจะยืนยันว่าเป็นเจ้าของคลินิก
form.hidden = true;

// เรียก API พร้อมแนบ token ถ้า token หมดอายุหรือบัญชีถูกปิด (401) จะกลับหน้า login
async function api(url, method = 'GET', body) {
  const res = await fetch(url, {method, headers: {Authorization: `Bearer ${accountToken}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  const data = await res.json();
  if (res.status === 401) { localStorage.clear(); location.replace('/'); throw Error(data.message); }
  if (!res.ok) throw Error(data.message || 'ดำเนินการไม่สำเร็จ');
  return data;
}

// แปลงวันที่เป็นรูปแบบไทย เช่น 10 ต.ค. 2569 (ค่าผิดรูปแบบแสดง -)
function formatDate(value) {
  const date = new Date(value);
  return isNaN(date) ? '-' : date.toLocaleDateString('th-TH', {day: 'numeric', month: 'short', year: 'numeric'});
}

// แสดงตารางสมาชิกในทีม พร้อมปุ่มจัดการ
// บัญชีตัวเองและบัญชีเจ้าของคลินิกจะไม่มีปุ่มปิดบัญชี (เซิร์ฟเวอร์ก็ห้ามไว้เช่นกัน)
function renderUsers() {
  // นับจำนวนบัญชีที่เปิด/ปิดใช้งาน แสดงเหนือตาราง
  const active = users.filter(u => u.is_active).length;
  document.getElementById('userCount').textContent = `ใช้งานอยู่ ${active} · ปิดแล้ว ${users.length - active}`;
  document.getElementById('userRows').innerHTML = users.length ? users.map(u => {
    // self = แถวนี้คือบัญชีตัวเอง, owner = แถวนี้คือบัญชีเจ้าของคลินิก
    const self = u.id === currentUser.id, owner = u.role === 'admin';
    return `<tr class="${u.is_active ? '' : 'inactive'}">
      <td><strong>${escapeHtml(u.full_name)}</strong>${self ? ' <span class="you">คุณ</span>' : ''}</td>
      <td>${escapeHtml(u.username)}</td>
      <td><span class="role-pill role-${u.role}">${roleLabels[u.role] || escapeHtml(u.role)}</span></td>
      <td><span class="status-pill ${u.is_active ? 'on' : 'off'}">${u.is_active ? 'ใช้งานอยู่' : 'ปิดแล้ว'}</span></td>
      <td>${formatDate(u.created_at)}</td>
      <td class="row-actions">
        <button type="button" class="btn btn-sm btn-warning" data-edit="${u.id}">แก้ไข</button>
        <button type="button" class="btn btn-sm btn-info" data-reset="${u.id}">รีเซ็ตรหัสผ่าน</button>
        ${self || owner ? '' : `<button type="button" class="btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-success'}" data-status="${u.id}">${u.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}</button>`}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="6">ยังไม่มีบัญชีผู้ใช้</td></tr>';
}

// โหลดรายชื่อบัญชีจากเซิร์ฟเวอร์แล้ววาดตารางใหม่ (ถ้าล้มเหลวแสดง error ในตาราง)
async function loadUsers() {
  try { users = (await api('/api/auth/users')).data; renderUsers(); }
  catch (err) { document.getElementById('userRows').innerHTML = `<tr><td colspan="6">${escapeHtml(err.message)}</td></tr>`; }
}

// เปิดหน้าต่าง (dialog) พร้อมล้างข้อมูลและข้อความ error เดิม
function openDialog(id) {
  const dialog = document.getElementById(id);
  dialog.querySelector('form').reset();
  dialog.querySelector('.dialog-error').textContent = '';
  dialog.showModal();
  return dialog;
}

(async () => {
  // เมื่อเปิดหน้า: ตรวจสิทธิ์ ถ้าไม่ใช่เจ้าของคลินิกส่งกลับหน้าทำงานของตัวเอง แล้วโหลดรายชื่อบัญชี
  if (!accountToken) { location.replace('/'); return; }
  try {
    currentUser = (await api('/api/auth/me')).user;
    if (currentUser.role !== 'admin') { location.replace(currentUser.role === 'nurse' ? '/nurse.html' : '/doctor.html'); return; }
    form.hidden = false;
    await loadUsers();
  // เชื่อมต่อไม่ได้ -> แสดงฟอร์มแต่ปิดปุ่มสร้าง พร้อมแจ้งให้โหลดหน้าใหม่
  } catch { form.hidden = false; form.querySelector('[type=submit]').disabled = true; message.dataset.state = 'error'; message.textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาโหลดหน้าใหม่'; }
})();

// ฟอร์มสร้างบัญชีใหม่
form.addEventListener('submit', async e => {
  // ปิดปุ่มและเปลี่ยนข้อความระหว่างรอ กันกดซ้ำ
  e.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'กำลังสร้างบัญชี…'; message.textContent = '';
  try {
    const username = document.getElementById('username').value.trim();
    await api('/api/auth/users', 'POST', {username, password: document.getElementById('password').value, full_name: document.getElementById('fullName').value.trim(), role: document.getElementById('role').value});
    // สำเร็จ -> แจ้งชื่อบัญชีที่ใช้ล็อกอิน ล้างฟอร์ม แล้วโหลดตารางใหม่
    message.dataset.state = 'success'; message.textContent = `สร้างบัญชีสำเร็จ · เข้าสู่ระบบด้วยชื่อบัญชี ${username}`; form.reset();
    await loadUsers();
  } catch (err) { message.dataset.state = 'error'; message.textContent = err.message; } finally { button.disabled = false; button.textContent = '+ สร้างบัญชี'; }
});
// เมื่อล้างฟอร์ม ให้ช่องรหัสผ่านกลับไปซ่อนตัวอักษรด้วย
form.addEventListener('reset', () => {
  document.getElementById('password').type = 'password';
  const toggle = document.getElementById('togglePassword');
  if (toggle) { toggle.textContent = 'แสดง'; toggle.setAttribute('aria-pressed', 'false'); }
});

// จัดการปุ่มทั้งหน้าในที่เดียว: ปิดหน้าต่าง, แก้ไข, รีเซ็ตรหัสผ่าน, ปิด/เปิดบัญชี
document.addEventListener('click', event => {
  // หาปุ่มที่ถูกกด (คลิกโดนตัวอักษรในปุ่มก็นับ) ถ้าไม่ได้กดปุ่มไม่ต้องทำอะไร
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close')) { button.closest('dialog').close(); return; }
  // ปุ่มจัดการแต่ละแถวเก็บ id บัญชีไว้ใน data-edit / data-reset / data-status
  const id = Number(button.dataset.edit || button.dataset.reset || button.dataset.status);
  if (!id) return;
  selected = users.find(u => u.id === id);
  if (!selected) return;
  const account = `${selected.full_name} (${selected.username})`;
  // ปุ่ม "แก้ไข": เติมชื่อเดิม และล็อกช่องบทบาทถ้าเป็นบัญชีเจ้าของหรือบัญชีตัวเอง
  if (button.dataset.edit) {
    openDialog('editDialog');
    document.getElementById('editAccount').textContent = `ชื่อบัญชี: ${selected.username}`;
    document.getElementById('editFullName').value = selected.full_name;
    const role = document.getElementById('editRole');
    role.value = selected.role;
    const locked = selected.role === 'admin' || selected.id === currentUser.id;
    role.disabled = locked;
    document.getElementById('editRoleHelp').textContent = locked ? 'บทบาทของบัญชีนี้เปลี่ยนไม่ได้' : 'เปลี่ยนบทบาทแล้วมีผลทันทีในการเรียกใช้งานครั้งถัดไป';
  }
  // ปุ่ม "รีเซ็ตรหัสผ่าน": เปิดหน้าต่างให้กรอกรหัสใหม่
  if (button.dataset.reset) {
    openDialog('resetDialog');
    document.getElementById('resetAccount').textContent = `บัญชี: ${account}`;
  }
  // ปุ่ม "ปิด/เปิดบัญชี": เปลี่ยนข้อความในหน้าต่างยืนยันตามสถานะปัจจุบัน
  if (button.dataset.status) {
    openDialog('statusDialog');
    const closing = Boolean(selected.is_active);
    document.getElementById('statusTitle').textContent = closing ? 'ปิดการใช้งานบัญชี' : 'เปิดการใช้งานบัญชี';
    document.getElementById('statusText').textContent = closing
      ? `${account} จะเข้าสู่ระบบไม่ได้ทันที ข้อมูลการทำงานเดิมยังอยู่ครบ และเปิดบัญชีกลับได้ภายหลัง`
      : `${account} จะกลับมาเข้าสู่ระบบได้ด้วยรหัสผ่านเดิม`;
    const submit = document.getElementById('statusSubmit');
    submit.textContent = closing ? 'ปิดบัญชี' : 'เปิดบัญชี';
    submit.className = closing ? 'danger' : '';
  }
});

// ส่งข้อมูลจากหน้าต่าง ถ้าสำเร็จจะปิดหน้าต่างและโหลดตารางใหม่ ถ้าไม่สำเร็จแสดง error ในหน้าต่าง
async function submitDialog(event, action, success) {
  event.preventDefault();
  const dialog = event.target.closest('dialog'), button = event.target.querySelector('[type=submit]');
  button.disabled = true;
  try {
    const result = await action();
    dialog.close();
    const list = document.getElementById('listMessage');
    list.dataset.state = 'success'; list.textContent = success || result.message;
    await loadUsers();
  } catch (err) { dialog.querySelector('.dialog-error').textContent = err.message; }
  finally { button.disabled = false; }
}
// ผูกฟอร์มในหน้าต่างทั้ง 3 แบบเข้ากับ API ที่ตรงกัน
// แก้ไข: ส่งบทบาทไปด้วยเฉพาะเมื่อช่องบทบาทไม่ถูกล็อก
document.getElementById('editForm').addEventListener('submit', e => submitDialog(e, () => {
  const roleSelect = document.getElementById('editRole');
  return api(`/api/auth/users/${selected.id}`, 'PUT', {full_name: document.getElementById('editFullName').value.trim(), ...(roleSelect.disabled ? {} : {role: roleSelect.value})});
}));
// รีเซ็ตรหัสผ่าน
document.getElementById('resetForm').addEventListener('submit', e => submitDialog(e, () => api(`/api/auth/users/${selected.id}/reset-password`, 'POST', {password: document.getElementById('resetPassword').value})));
// ปิด/เปิดบัญชี: ส่งสถานะตรงข้ามกับปัจจุบัน
document.getElementById('statusForm').addEventListener('submit', e => submitDialog(e, () => api(`/api/auth/users/${selected.id}/status`, 'PATCH', {is_active: !selected.is_active})));
