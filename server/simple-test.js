const express = require('express');
const app = express();

console.log('1. Creating express app');

app.get('/test', (req, res) => {
  console.log('Request received!');
  res.json({ok: true});
});

console.log('2. Created GET route');

const server = app.listen(3003);

console.log('3. Called listen()');

server.on('listening', () => {
  console.log('4. Server is listening on port 3003');
});

server.on('error', (err) => {
  console.error('[ERROR] Server error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT] Exception:', err);
});

console.log('5. Handlers attached');

// Keep process alive
setInterval(() => {
  console.log('Process alive check...');
}, 5000);
