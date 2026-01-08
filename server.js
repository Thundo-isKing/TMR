// Minimal Meibot AI backend proxy for Groq
require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');

const app = express();
app.use(express.json());
// Serve static files from current directory.
// Explicit cache-control helps prevent mobile browsers from sticking to stale HTML/CSS/JS.
app.use(express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    const lower = String(filePath).toLowerCase();
    if (lower.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    } else if (lower.endsWith('.css') || lower.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
app.use(cors({ origin: ['http://localhost:3001', 'http://localhost:3002', 'http://127.0.0.1:3002', 'http://192.168.1.218:3002', 'http://192.168.1.218:3001', '*'] })); // Allow local network access
app.use(rateLimit({ windowMs: 60_000, max: 30 })); // 30 requests/min

// Setup VAPID for push notifications
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:you@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
}

// In-memory subscription store (in production, use a database)
const subscriptions = new Map();

// In-memory chat history store - stores conversations by deviceId
// Structure: { deviceId: [{ role: 'user'|'assistant', content: '...' }, ...] }
const chatHistory = new Map();

// Serve TMR.html as the root
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'TMR.html'));
});

app.post('/api/meibot', async (req, res) => {
  res.json({ test: 'ok' });
});

// Push notification endpoints
app.get('/vapidPublicKey', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body.subscription;
  if (!sub) return res.status(400).json({ error: 'Missing subscription' });
  const deviceId = req.body.deviceId || req.body.userId || Math.random().toString(36).substr(2, 9);
  subscriptions.set(deviceId, sub);
  res.json({ deviceId, id: deviceId });
});

app.post('/unsubscribe', (req, res) => {
  const deviceId = req.body.deviceId;
  if (!deviceId || !subscriptions.has(deviceId)) {
    return res.status(404).json({ error: 'Subscription not found' });
  }
  subscriptions.delete(deviceId);
  res.json({ success: true });
});

app.get('/debug/subscriptions', (req, res) => {
  res.json({ count: subscriptions.size, ids: Array.from(subscriptions.keys()) });
});

// Reminder scheduling endpoint - stores reminders to send later
const reminders = new Map();
let reminderIdCounter = 1;

app.post('/reminder', (req, res) => {
  const { title, body, deliverAt } = req.body;
  if (!deliverAt) {
    return res.status(400).json({ error: 'Missing deliverAt timestamp' });
  }

  // Get device ID from request or generate one
  let deviceId = req.body.deviceId;
  if (!deviceId) {
    // Try to extract from subscription or use a default
    deviceId = req.headers['x-device-id'] || 'unknown';
  }

  const reminderId = String(reminderIdCounter++);
  reminders.set(reminderId, {
    title,
    body,
    deliverAt,
    deviceId, // Store which device created this reminder
    createdAt: Date.now()
  });

  res.json({ reminderId, status: 'scheduled' });
});

app.get('/debug/reminders', (req, res) => {
  res.json({ count: reminders.size, reminders: Array.from(reminders.entries()) });
});

// Get chat history for a device
app.get('/api/chat-history/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const history = chatHistory.get(deviceId) || [];
  res.json({ deviceId, history });
});

// Clear chat history for a device
app.post('/api/chat-history/:deviceId/clear', (req, res) => {
  const { deviceId } = req.params;
  chatHistory.delete(deviceId);
  res.json({ deviceId, status: 'cleared' });
});

// Clear all chat histories
app.post('/api/chat-history/clear-all', (req, res) => {
  chatHistory.clear();
  res.json({ status: 'all cleared' });
});

// Background job to send reminders to the specific device that created them
setInterval(async () => {
  const now = Date.now();
  for (const [reminderId, reminder] of reminders.entries()) {
    if (reminder.deliverAt <= now && !reminder.sent) {
      // Send only to the device that created this reminder
      const deviceId = reminder.deviceId;
      if (subscriptions.has(deviceId)) {
        try {
          const sub = subscriptions.get(deviceId);
          await webpush.sendNotification(sub, JSON.stringify({
            title: reminder.title || 'Reminder',
            body: reminder.body || 'You have a reminder',
            icon: '/favicon.ico'
          }));
          console.log(`Sent reminder to device ${deviceId}`);
        } catch (err) {
          console.error(`Failed to send to device ${deviceId}:`, err.message);
          if (err.statusCode === 410) {
            subscriptions.delete(deviceId);
          }
        }
      } else {
        console.warn(`Device ${deviceId} not subscribed for reminder ${reminderId}`);
      }
      reminder.sent = true;
      reminders.delete(reminderId);
    }
  }
}, 5000); // Check every 5 seconds

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
