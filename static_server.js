const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3002;
const BASE_DIR = __dirname;

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  let filePath = path.join(BASE_DIR, url === '/' ? 'TMR.html' : url);
  
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    let contentType = 'text/plain';
    if (ext === '.html') contentType = 'text/html';
    else if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.json') contentType = 'application/json';

    // Reduce the chance of stale assets on mobile browsers.
    // HTML should never be cached; CSS/JS can revalidate.
    const headers = { 'Content-Type': contentType };
    if (ext === '.html') headers['Cache-Control'] = 'no-store, must-revalidate';
    else if (ext === '.css' || ext === '.js') headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Static server running on port ${PORT}`);
});
