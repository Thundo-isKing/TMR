const http = require('http');

const server = http.createServer((req, res) => {
  console.log('Request:', req.url);
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('OK');
});

server.listen(3003, () => {
  console.log('Native HTTP server listening on port 3003');
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

setInterval(() => {
  console.log('Alive...');
}, 5000);
