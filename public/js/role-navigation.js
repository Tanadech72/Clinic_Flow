// สร้างเมนูด้านซ้ายตามบทบาทผู้ใช้ ใช้ในหน้าผู้ป่วย ประวัติการรักษา คลังยา และภาพรวมคลินิก

(async function () {
  // ไม่มี token = ยังไม่ล็อกอิน (แต่ละหน้าจัดการพากลับหน้า login เอง)
  const token = localStorage.getItem('token');
  if (!token) {
    return;
  }

  try {
    // ถามเซิร์ฟเวอร์ว่าผู้ใช้ที่ล็อกอินอยู่มีบทบาทอะไร (token หมดอายุ -> กลับหน้า login)
    const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) {
      localStorage.clear();
      location.replace('/');
      return;
    }
    const data = await res.json();
    const user = data.user;
    const isNurse = user.role === 'nurse';

    // หน้าทำงานหลักของแต่ละบทบาท
    let home = '/doctor.html';
    let homeLabel = 'ห้องตรวจแพทย์';
    if (isNurse) {
      home = '/nurse.html';
      homeLabel = 'คิวตรวจและจ่ายยา';
    }

    // พยาบาลไม่มีสิทธิ์ดูหน้าภาพรวม ส่งกลับหน้าทำงานของตัวเอง
    if (isNurse && location.pathname === '/dashboard.html') {
      location.replace(home);
      return;
    }

    // สร้างเมนูใหม่ตามบทบาท: พยาบาลไม่เห็นภาพรวมคลินิก
    // และเฉพาะเจ้าของคลินิก (admin) เห็นเมนูบัญชีผู้ใช้งาน
    const menu = document.querySelector('.sidebar-menu');
    if (menu) {
      let html = '';
      html += '<li><a href="' + home + '">' + homeLabel + '</a></li>';
      html += '<li><a href="/patients.html">ข้อมูลผู้ป่วย</a></li>';
      html += '<li><a href="/records.html">ประวัติการรักษา</a></li>';
      html += '<li><a href="/inventory.html">คลังยา</a></li>';
      if (!isNurse) {
        html += '<li><a href="/dashboard.html">ภาพรวมคลินิก</a></li>';
      }
      if (user.role === 'admin') {
        html += '<li><a href="/users.html">บัญชีผู้ใช้งาน</a></li>';
      }
      html += '<li><a href="/account.html">บัญชีของฉัน</a></li>';
      menu.innerHTML = html;

      // ไฮไลต์เมนูของหน้าที่เปิดอยู่
      const links = menu.querySelectorAll('a');
      for (const link of links) {
        if (link.getAttribute('href') === location.pathname) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      }
    }

    // ลิงก์ "กลับหน้าทำงาน" (ถ้าหน้านั้นมี) ให้ชี้ไปหน้าตามบทบาท
    const workspaceLink = document.getElementById('workspaceLink');
    if (workspaceLink) {
      workspaceLink.href = home;
    }

    // แสดงชื่อบทบาทใต้ชื่อระบบในแถบเมนู
    const brand = document.querySelector('.sidebar-brand');
    if (brand) {
      brand.textContent = 'Clinic Flow';
      let roleText = document.querySelector('.sidebar-role');
      if (!roleText) {
        roleText = document.createElement('p');
        roleText.className = 'sidebar-role';
        brand.after(roleText);
      }
      if (user.role === 'admin') {
        roleText.textContent = 'เจ้าของคลินิก';
      } else if (user.role === 'doctor') {
        roleText.textContent = 'แพทย์';
      } else if (user.role === 'nurse') {
        roleText.textContent = 'พยาบาล';
      } else {
        roleText.textContent = '';
      }
    }
  } catch (err) {
    console.error('โหลดสิทธิ์ไม่สำเร็จ', err);
  }
})();
