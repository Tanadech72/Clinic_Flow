const form = document.getElementById('userForm');
const message = document.getElementById('message');
const accountToken = localStorage.getItem('token');
form.hidden = true;
(async () => {
  if (!accountToken) { location.replace('/'); return; }
  try {
    const res = await fetch('/api/auth/me', {headers: {Authorization: `Bearer ${accountToken}`}});
    if (!res.ok) { location.replace('/'); return; }
    const {user} = await res.json();
    if (!['admin', 'doctor'].includes(user.role)) { location.replace('/nurse.html'); return; }
    form.hidden = false;
  } catch { form.hidden = false; form.querySelector('[type=submit]').disabled = true; message.dataset.state = 'error'; message.textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาโหลดหน้าใหม่'; }
})();
form.addEventListener('submit', async e => {
  e.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'กำลังสร้างบัญชี…'; message.textContent = '';
  try {
    const res = await fetch('/api/auth/users', {method: 'POST', headers: {Authorization: `Bearer ${accountToken}`, 'Content-Type': 'application/json'}, body: JSON.stringify({username: document.getElementById('username').value.trim(), password: document.getElementById('password').value, full_name: document.getElementById('fullName').value.trim(), role: document.getElementById('role').value})});
    const data = await res.json(); if (!res.ok) throw Error(data.message);
    message.dataset.state = 'success'; message.textContent = `สร้างบัญชีสำเร็จ · เข้าสู่ระบบด้วยชื่อบัญชี ${document.getElementById('username').value.trim()}`; form.reset();
  } catch (err) { message.dataset.state = 'error'; message.textContent = err.message; } finally { button.disabled = false; button.textContent = '+ สร้างบัญชี'; }
});
form.addEventListener('reset', () => {
  document.getElementById('password').type = 'password';
  const toggle = document.getElementById('togglePassword');
  if (toggle) { toggle.textContent = 'แสดง'; toggle.setAttribute('aria-pressed', 'false'); }
});
