// สร้างเมนูด้านซ้ายตามบทบาทผู้ใช้ ใช้ในหน้าผู้ป่วย ประวัติการรักษา คลังยา และภาพรวมคลินิก

(async () => {
  // ไม่มี token = ยังไม่ล็อกอิน (แต่ละหน้าจัดการพากลับหน้า login เอง)
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    // ถามเซิร์ฟเวอร์ว่าผู้ใช้ที่ล็อกอินอยู่มีบทบาทอะไร (token หมดอายุ -> กลับหน้า login)
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { localStorage.clear(); location.replace('/'); return; }
    const { user } = await res.json();
    const nurse = user.role === 'nurse';
    const home = nurse ? '/nurse.html' : '/doctor.html';
    // พยาบาลไม่มีสิทธิ์ดูหน้าภาพรวม ส่งกลับหน้าทำงานของตัวเอง
    if (nurse && location.pathname === '/dashboard.html') { location.replace(home); return; }
    // สร้างเมนูใหม่ตามบทบาท: พยาบาลไม่เห็นภาพรวมคลินิก
    // และเฉพาะเจ้าของคลินิก (admin) เห็นเมนูบัญชีผู้ใช้งาน
    const menu = document.querySelector('.sidebar-menu');
    if (menu) {
      menu.innerHTML = `<li><a href="${home}">${nurse ? 'คิวตรวจและจ่ายยา' : 'ห้องตรวจแพทย์'}</a></li><li><a href="/patients.html">ข้อมูลผู้ป่วย</a></li><li><a href="/records.html">ประวัติการรักษา</a></li><li><a href="/inventory.html">คลังยา</a></li>${!nurse ? '<li><a href="/dashboard.html">ภาพรวมคลินิก</a></li>' : ''}${user.role === 'admin' ? '<li><a href="/users.html">บัญชีผู้ใช้งาน</a></li>' : ''}<li><a href="/account.html">บัญชีของฉัน</a></li>`;
      // ไฮไลต์เมนูของหน้าที่เปิดอยู่
      menu.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === location.pathname));
    }
    // ลิงก์ "กลับหน้าทำงาน" (ถ้าหน้านั้นมี) ให้ชี้ไปหน้าตามบทบาท
    const link = document.getElementById('workspaceLink');
    if (link) link.href = home;
    // แสดงชื่อบทบาทใต้ชื่อระบบในแถบเมนู
    const brand = document.querySelector('.sidebar-brand');
    if (brand) {
      brand.textContent = 'Clinic Flow';
      let role = document.querySelector('.sidebar-role');
      if (!role) { role = document.createElement('p'); role.className = 'sidebar-role'; brand.after(role); }
      role.textContent = {admin: 'เจ้าของคลินิก', doctor: 'แพทย์', nurse: 'พยาบาล'}[user.role] || '';
    }
  } catch (err) { console.error('โหลดสิทธิ์ไม่สำเร็จ', err); }
})();
