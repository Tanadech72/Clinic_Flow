// ส่วนเสริม UI ที่ใช้ร่วมกันหลายหน้า: ตกแต่งเมนูด้านซ้าย และปุ่มแสดง/ซ่อนรหัสผ่าน

(() => {
  // สัญลักษณ์สำรองของแต่ละเมนู (ไอคอนจริงที่แสดงกำหนดไว้ใน theme.css)
  const icons = {'doctor.html':'✚','nurse.html':'✚','patients.html':'♧','records.html':'▤','inventory.html':'▦','dashboard.html':'◫','users.html':'♙','account.html':'◉'};
  const sidebar = document.querySelector('body > nav, .sidebar');
  // ใส่ไอคอนให้ลิงก์ในเมนู และเพิ่มข้อความท้ายแถบเมนู
  function decorate() {
    if (!sidebar) return;
    sidebar.querySelectorAll('a[href]').forEach(link => {
      const page = link.getAttribute('href').split('/').pop();
      if (icons[page]) link.dataset.icon = icons[page];
    });
    if (!sidebar.querySelector('.nav-footer')) {
      const footer = document.createElement('div'); footer.className = 'nav-footer';
      footer.textContent = 'CLINIC FLOW · ระบบจัดการคลินิก'; sidebar.append(footer);
    }
  }
  decorate();
  // บางหน้าสร้างเมนูทีหลังด้วย JavaScript จึงคอยดูการเปลี่ยนแปลงแล้วตกแต่งใหม่
  if (sidebar) new MutationObserver(decorate).observe(sidebar, {childList:true, subtree:true});
  // บอกโปรแกรมอ่านหน้าจอ (screen reader) ว่าเมนูไหนคือหน้าปัจจุบัน
  document.querySelectorAll('a.active').forEach(a => a.setAttribute('aria-current','page'));
  // ปุ่ม "แสดง/ซ่อน" รหัสผ่านในหน้าสร้างบัญชี
  const toggle = document.getElementById('togglePassword');
  if (toggle) toggle.addEventListener('click', () => {
    const password = document.getElementById('password');
    const show = password.type === 'password'; password.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'ซ่อน' : 'แสดง'; toggle.setAttribute('aria-pressed', String(show));
  });
})();
