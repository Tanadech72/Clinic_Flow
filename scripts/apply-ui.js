// สคริปต์ช่วยงาน (รันครั้งเดียว): ใส่ไฟล์ app-ui.css และ app-ui.js ลงในหน้า HTML ทุกหน้า
// วิธีใช้: node scripts/apply-ui.js

const fs = require('fs');
// วนทุกหน้าที่ต้องใช้ UI กลาง
for (const page of ['doctor','nurse','patients','records','inventory','dashboard']) {
  const path = `public/${page}.html`;
  let html = fs.readFileSync(path, 'utf8');
  // ลบลิงก์ app-ui เดิมออกก่อน กันการใส่ซ้ำเมื่อรันสคริปต์หลายครั้ง
  html = html.replace(/<link[^>]*app-ui[^>]*>/g, '').replace(/<script[^>]*app-ui[^>]*><\/script>/g, '');
  // ใส่ CSS ไว้ท้าย <head> และ JS ไว้ท้าย <body>
  html = html.replace('</head>', '<link rel="stylesheet" href="/css/app-ui.css?v=2">\n</head>');
  html = html.replace('</body>', '<script src="/js/app-ui.js?v=2"></script>\n</body>');
  fs.writeFileSync(path, html);
}
