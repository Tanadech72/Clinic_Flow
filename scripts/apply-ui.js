const fs = require('fs');
for (const page of ['doctor','nurse','patients','records','inventory','dashboard']) {
  const path = `public/${page}.html`;
  let html = fs.readFileSync(path, 'utf8');
  html = html.replace(/<link[^>]*app-ui[^>]*>/g, '').replace(/<script[^>]*app-ui[^>]*><\/script>/g, '');
  html = html.replace('</head>', '<link rel="stylesheet" href="/css/app-ui.css?v=2">\n</head>');
  html = html.replace('</body>', '<script src="/js/app-ui.js?v=2"></script>\n</body>');
  fs.writeFileSync(path, html);
}
