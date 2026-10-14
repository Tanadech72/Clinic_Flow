// ส่วนเสริม UI ที่ใช้ร่วมกันหลายหน้า: ตกแต่งเมนูด้านซ้าย และปุ่มแสดง/ซ่อนรหัสผ่าน
// โค้ดทั้งหมดอยู่ใน function ที่เรียกทันที เพื่อไม่ให้ตัวแปรไปชนกับไฟล์อื่น

(function () {
  // สัญลักษณ์สำรองของแต่ละเมนู (ไอคอนจริงที่แสดงกำหนดไว้ใน theme.css)
  const icons = {
    'doctor.html': '✚',
    'nurse.html': '✚',
    'patients.html': '♧',
    'records.html': '▤',
    'inventory.html': '▦',
    'dashboard.html': '◫',
    'users.html': '♙',
    'account.html': '◉',
  };

  // แถบเมนูด้านซ้าย (บางหน้าใช้ <nav> บางหน้าใช้ class sidebar)
  const sidebar = document.querySelector('body > nav, .sidebar');

  // ใส่ไอคอนให้ลิงก์ในเมนู และเพิ่มข้อความท้ายแถบเมนู
  function decorate() {
    if (!sidebar) {
      return;
    }
    const links = sidebar.querySelectorAll('a[href]');
    for (const link of links) {
      // ตัดเอาเฉพาะชื่อไฟล์ เช่น /patients.html -> patients.html แล้วหาไอคอนที่ตรงกัน
      const parts = link.getAttribute('href').split('/');
      const page = parts[parts.length - 1];
      if (icons[page]) {
        link.dataset.icon = icons[page];
      }
    }
    // ใส่ข้อความท้ายเมนูครั้งเดียว (ตรวจก่อนว่ายังไม่มี เพราะฟังก์ชันนี้ถูกเรียกซ้ำได้)
    if (!sidebar.querySelector('.nav-footer')) {
      const footer = document.createElement('div');
      footer.className = 'nav-footer';
      footer.textContent = 'CLINIC FLOW · ระบบจัดการคลินิก';
      sidebar.append(footer);
    }
  }

  decorate();

  // บางหน้าสร้างเมนูทีหลังด้วย JavaScript จึงคอยดูการเปลี่ยนแปลงแล้วตกแต่งใหม่
  if (sidebar) {
    const observer = new MutationObserver(decorate);
    observer.observe(sidebar, { childList: true, subtree: true });
  }

  // บอกโปรแกรมอ่านหน้าจอ (screen reader) ว่าเมนูไหนคือหน้าปัจจุบัน
  const activeLinks = document.querySelectorAll('a.active');
  for (const link of activeLinks) {
    link.setAttribute('aria-current', 'page');
  }

  // ปุ่ม "แสดง/ซ่อน" รหัสผ่านในหน้าสร้างบัญชี
  const toggle = document.getElementById('togglePassword');
  if (toggle) {
    toggle.addEventListener('click', function () {
      const password = document.getElementById('password');
      // สลับชนิดช่องระหว่าง password (ซ่อนเป็นจุด) กับ text (แสดงตัวอักษร)
      if (password.type === 'password') {
        password.type = 'text';
        toggle.textContent = 'ซ่อน';
        toggle.setAttribute('aria-pressed', 'true');
      } else {
        password.type = 'password';
        toggle.textContent = 'แสดง';
        toggle.setAttribute('aria-pressed', 'false');
      }
    });
  }
})();
