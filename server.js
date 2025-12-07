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
app.use(express.static(path.join(__dirname))); // Serve static files from current directory
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

// Serve TMR.html as the root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'TMR.html'));
});

app.post('/api/meibot', async (req, res) => {
  const { message, context, consent } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Invalid message' });
  if (context && !consent) return res.status(403).json({ error: 'Consent required for calendar context.' });

  const systemPrompt = `You are Meibot, a helpful assistant for scheduling and calendars. 
If the user wants to create a todo or event, respond with a clear confirmation and include a JSON action in your message like this:
- For todos: "[ACTION: CREATE_TODO] Title: <task title>"
- For events: "[ACTION: CREATE_EVENT] Title: <event name> | Date: <YYYY-MM-DD> | Time: <HH:MM> | Duration: <minutes>"

Always include the action tag with clear structured data so the client can parse and execute it.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    context && consent ? { role: 'system', content: `Calendar context: ${context}` } : null,
    { role: 'user', content: message }
  ].filter(Boolean);

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 600
      })
    });
    
    if (!r.ok) {
      console.error('Groq API error response:', r.status, await r.text());
      return res.status(500).json({ error: `Groq API error: ${r.status}` });
    }
    
    const data = await r.json();
    const aiText = data.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.';
    
    // Parse action from response
    let actionType = null;
    let actionData = null;
    
    if (aiText.includes('[ACTION: CREATE_TODO]')) {
      actionType = 'createTodo';
      const match = aiText.match(/\[ACTION: CREATE_TODO\]\s*Title:\s*(.+?)(?:\n|$)/);
      if (match) {
        actionData = { text: match[1].trim() };
      }
    } else if (aiText.includes('[ACTION: CREATE_EVENT]')) {
      actionType = 'createEvent';
      const titleMatch = aiText.match(/Title:\s*(.+?)\s*\|/);
      const dateMatch = aiText.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
      const timeMatch = aiText.match(/Time:\s*(\d{2}:\d{2})/);
      const durationMatch = aiText.match(/Duration:\s*(\d+)/);
      
      if (titleMatch && dateMatch) {
        actionData = {
          title: titleMatch[1].trim(),
          date: dateMatch[1],
          time: timeMatch ? timeMatch[1] : '09:00',
          duration: durationMatch ? parseInt(durationMatch[1]) : 60
        };
      }
    }
    
    res.json({ 
      reply: aiText,
      suggestedAction: actionType,
      actionData: actionData,
      meta: data 
    });
  } catch (err) {
    console.error('Meibot error', err.message);
    res.status(500).json({ error: 'AI provider error' });
  }
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
