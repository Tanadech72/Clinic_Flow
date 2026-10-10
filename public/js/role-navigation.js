(async () => {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { localStorage.clear(); location.replace('/'); return; }
    const { user } = await res.json();
    const nurse = user.role === 'nurse';
    const home = nurse ? '/nurse.html' : '/doctor.html';
    if (nurse && location.pathname === '/dashboard.html') { location.replace(home); return; }
    const menu = document.querySelector('.sidebar-menu');
    if (menu) {
      menu.innerHTML = `<li><a href="${home}">${nurse ? 'คิวตรวจและจ่ายยา' : 'ห้องตรวจแพทย์'}</a></li><li><a href="/patients.html">ข้อมูลผู้ป่วย</a></li><li><a href="/records.html">ประวัติการรักษา</a></li><li><a href="/inventory.html">คลังยา</a></li>${!nurse ? '<li><a href="/dashboard.html">ภาพรวมคลินิก</a></li>' : ''}${user.role === 'admin' ? '<li><a href="/users.html">บัญชีผู้ใช้งาน</a></li>' : ''}<li><a href="/account.html">บัญชีของฉัน</a></li>`;
      menu.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === location.pathname));
    }
    const link = document.getElementById('workspaceLink');
    if (link) link.href = home;
    const brand = document.querySelector('.sidebar-brand');
    if (brand) {
      brand.textContent = 'Clinic Flow';
      let role = document.querySelector('.sidebar-role');
      if (!role) { role = document.createElement('p'); role.className = 'sidebar-role'; brand.after(role); }
      role.textContent = {admin: 'เจ้าของคลินิก', doctor: 'แพทย์', nurse: 'พยาบาล'}[user.role] || '';
    }
  } catch (err) { console.error('โหลดสิทธิ์ไม่สำเร็จ', err); }
})();
