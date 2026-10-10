(() => {
  const icons = {'doctor.html':'✚','nurse.html':'✚','patients.html':'♧','records.html':'▤','inventory.html':'▦','dashboard.html':'◫','users.html':'♙','account.html':'◉'};
  const sidebar = document.querySelector('body > nav, .sidebar');
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
  if (sidebar) new MutationObserver(decorate).observe(sidebar, {childList:true, subtree:true});
  document.querySelectorAll('a.active').forEach(a => a.setAttribute('aria-current','page'));
  const toggle = document.getElementById('togglePassword');
  if (toggle) toggle.addEventListener('click', () => {
    const password = document.getElementById('password');
    const show = password.type === 'password'; password.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'ซ่อน' : 'แสดง'; toggle.setAttribute('aria-pressed', String(show));
  });
})();
