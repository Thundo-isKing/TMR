require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

console.log('Starting minimal server...');

app.post('/api/test', (req, res) => {
  console.log('[Test] Endpoint called');
  console.log('[Test] Body:', req.body);
  
  try {
    res.json({ ok: true, received: req.body });
    console.log('[Test] Response sent');
  } catch (e) {
    console.error('[Test] Error sending response:', e.message);
  }
});

const port = process.env.PUSH_SERVER_PORT || 3003;
app.listen(port, () => {
  console.log('Minimal server listening on port', port);
});
