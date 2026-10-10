// หน้าบัญชีของฉัน (account.html) ใช้ได้ทุกบทบาท: ดูข้อมูลบัญชี และเปลี่ยนรหัสผ่านของตัวเอง

(() => {
  const token = localStorage.getItem('token');
  const $ = id => document.getElementById(id);
  const roleLabels = {admin: 'เจ้าของคลินิก', doctor: 'แพทย์', nurse: 'พยาบาล'};
  const message = $('message');
  // แสดงข้อความผลลัพธ์ใต้ฟอร์ม (สีเขียวเมื่อสำเร็จ สีแดงเมื่อผิดพลาด)
  const show = (state, text) => { message.dataset.state = state; message.textContent = text; };

  async function api(url, method = 'GET', body) {
    const res = await fetch(url, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
    const data = await res.json();
    if (res.status === 401) { localStorage.clear(); location.replace('/'); throw Error(data.message); }
    if (!res.ok) throw Error(data.message || 'ดำเนินการไม่สำเร็จ');
    return data;
  }

  // ออกจากระบบ: ลบ token ในเบราว์เซอร์แล้วกลับหน้า login
  $('logout').onclick = () => { localStorage.clear(); location.href = '/'; };

  (async () => {
    if (!token) { location.replace('/'); return; }
    try {
      // โหลดข้อมูลบัญชีปัจจุบัน แล้วสร้างเมนูตามบทบาท
      const {user} = await api('/api/auth/me');
      const nurse = user.role === 'nurse', home = nurse ? '/nurse.html' : '/doctor.html';
      $('profileName').textContent = user.full_name || '-';
      $('profileUsername').textContent = user.username;
      $('profileRole').textContent = roleLabels[user.role] || user.role;
      $('navRole').textContent = roleLabels[user.role] || '';
      $('navRole').insertAdjacentHTML('afterend',`<a href="${home}">${nurse ? 'คิวตรวจและจ่ายยา' : 'ห้องตรวจแพทย์'}</a><a href="/patients.html">ข้อมูลผู้ป่วย</a><a href="/records.html">ประวัติการรักษา</a><a href="/inventory.html">คลังยา</a>${nurse ? '' : '<a href="/dashboard.html">ภาพรวมคลินิก</a>'}${user.role === 'admin' ? '<a href="/users.html">บัญชีผู้ใช้งาน</a>' : ''}<a class="active" aria-current="page" href="/account.html">บัญชีของฉัน</a>`);
    } catch (err) { show('error', err.message); }
  })();

  // เปลี่ยนรหัสผ่าน: ตรวจว่ารหัสใหม่กับช่องยืนยันตรงกันก่อนส่ง
  $('passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('newPassword').value !== $('confirmPassword').value) { show('error', 'รหัสผ่านใหม่และการยืนยันไม่ตรงกัน'); return; }
    const button = event.target.querySelector('[type=submit]');
    button.disabled = true; message.textContent = '';
    try {
      const result = await api('/api/auth/me/password', 'PUT', {current_password: $('currentPassword').value, new_password: $('newPassword').value});
      event.target.reset(); show('success', result.message);
    } catch (err) { show('error', err.message); }
    finally { button.disabled = false; }
  });
})();
