const form = document.getElementById('userForm');
const message = document.getElementById('message');
const accountToken = localStorage.getItem('token');
const roleLabels = {admin: 'เจ้าของคลินิก', doctor: 'แพทย์', nurse: 'พยาบาล'};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let currentUser, users = [], selected;
form.hidden = true;

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {method, headers: {Authorization: `Bearer ${accountToken}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  const data = await res.json();
  if (res.status === 401) { localStorage.clear(); location.replace('/'); throw Error(data.message); }
  if (!res.ok) throw Error(data.message || 'ดำเนินการไม่สำเร็จ');
  return data;
}

function formatDate(value) {
  const date = new Date(value);
  return isNaN(date) ? '-' : date.toLocaleDateString('th-TH', {day: 'numeric', month: 'short', year: 'numeric'});
}

function renderUsers() {
  const active = users.filter(u => u.is_active).length;
  document.getElementById('userCount').textContent = `ใช้งานอยู่ ${active} · ปิดแล้ว ${users.length - active}`;
  document.getElementById('userRows').innerHTML = users.length ? users.map(u => {
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

async function loadUsers() {
  try { users = (await api('/api/auth/users')).data; renderUsers(); }
  catch (err) { document.getElementById('userRows').innerHTML = `<tr><td colspan="6">${escapeHtml(err.message)}</td></tr>`; }
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  dialog.querySelector('form').reset();
  dialog.querySelector('.dialog-error').textContent = '';
  dialog.showModal();
  return dialog;
}

(async () => {
  if (!accountToken) { location.replace('/'); return; }
  try {
    currentUser = (await api('/api/auth/me')).user;
    if (currentUser.role !== 'admin') { location.replace(currentUser.role === 'nurse' ? '/nurse.html' : '/doctor.html'); return; }
    form.hidden = false;
    await loadUsers();
  } catch { form.hidden = false; form.querySelector('[type=submit]').disabled = true; message.dataset.state = 'error'; message.textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาโหลดหน้าใหม่'; }
})();

form.addEventListener('submit', async e => {
  e.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'กำลังสร้างบัญชี…'; message.textContent = '';
  try {
    const username = document.getElementById('username').value.trim();
    await api('/api/auth/users', 'POST', {username, password: document.getElementById('password').value, full_name: document.getElementById('fullName').value.trim(), role: document.getElementById('role').value});
    message.dataset.state = 'success'; message.textContent = `สร้างบัญชีสำเร็จ · เข้าสู่ระบบด้วยชื่อบัญชี ${username}`; form.reset();
    await loadUsers();
  } catch (err) { message.dataset.state = 'error'; message.textContent = err.message; } finally { button.disabled = false; button.textContent = '+ สร้างบัญชี'; }
});
form.addEventListener('reset', () => {
  document.getElementById('password').type = 'password';
  const toggle = document.getElementById('togglePassword');
  if (toggle) { toggle.textContent = 'แสดง'; toggle.setAttribute('aria-pressed', 'false'); }
});

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close')) { button.closest('dialog').close(); return; }
  const id = Number(button.dataset.edit || button.dataset.reset || button.dataset.status);
  if (!id) return;
  selected = users.find(u => u.id === id);
  if (!selected) return;
  const account = `${selected.full_name} (${selected.username})`;
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
  if (button.dataset.reset) {
    openDialog('resetDialog');
    document.getElementById('resetAccount').textContent = `บัญชี: ${account}`;
  }
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
document.getElementById('editForm').addEventListener('submit', e => submitDialog(e, () => {
  const roleSelect = document.getElementById('editRole');
  return api(`/api/auth/users/${selected.id}`, 'PUT', {full_name: document.getElementById('editFullName').value.trim(), ...(roleSelect.disabled ? {} : {role: roleSelect.value})});
}));
document.getElementById('resetForm').addEventListener('submit', e => submitDialog(e, () => api(`/api/auth/users/${selected.id}/reset-password`, 'POST', {password: document.getElementById('resetPassword').value})));
document.getElementById('statusForm').addEventListener('submit', e => submitDialog(e, () => api(`/api/auth/users/${selected.id}/status`, 'PATCH', {is_active: !selected.is_active})));
