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

// In-memory chat history store - stores conversations by deviceId
// Structure: { deviceId: [{ role: 'user'|'assistant', content: '...' }, ...] }
const chatHistory = new Map();

// Serve TMR.html as the root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'TMR.html'));
});

app.post('/api/meibot', async (req, res) => {
  const { message, context, consent, deviceId } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Invalid message' });
  if (context && !consent) return res.status(403).json({ error: 'Consent required for calendar context.' });

  const systemPrompt = `You are Meibot, a helpful assistant for scheduling and calendars. You are helpful, clear, and complete in your responses.

IMPORTANT: When users ask you to create events or todos, ALWAYS create ALL of them, even if it's multiple events.

For creating tasks, use this format for EACH item:
- "[ACTION: CREATE_TODO] Title: <task title>"

For creating events, use this format for EACH event (create multiple if needed):
- "[ACTION: CREATE_EVENT] Title: <event name> | Date: <YYYY-MM-DD> | Time: <HH:MM> | Duration: <minutes>"

Guidelines:
- If someone asks for "meetings all week at 2pm", create 7 events (Monday through Sunday) at 14:00
- If someone says "Mon, Tue, Wed at 3pm", create 3 events at 15:00 on those dates
- Today is ${new Date().toISOString().split('T')[0]}
- Always interpret times in 24-hour format (e.g., "2pm" = "14:00", "3am" = "03:00")
- If no year is specified, assume the current year or next year if the date has passed
- Be generous with duration - if not specified, use 60 minutes for meetings
- Include ALL action tags for ALL events/todos requested - don't skip any

Always confirm what you're creating with specific dates and times.`;

  // Get or initialize chat history for this device
  const historyKey = deviceId || 'default';
  if (!chatHistory.has(historyKey)) {
    chatHistory.set(historyKey, []);
  }
  const history = chatHistory.get(historyKey);

  // Build messages array with chat history
  const messages = [
    { role: 'system', content: systemPrompt },
    context && consent ? { role: 'system', content: `Calendar context: ${context}` } : null,
    ...history,
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
    
    // Save user message and assistant response to history
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: aiText });
    
    // Keep history to last 20 messages to avoid bloating memory
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }
    
    // Parse actions from response - support multiple actions
    let actionType = null;
    let actionData = null;
    let allActions = [];
    
    // Parse all CREATE_TODO actions
    const todoMatches = aiText.matchAll(/\[ACTION: CREATE_TODO\]\s*Title:\s*(.+?)(?:\n|$)/g);
    for (const match of todoMatches) {
      allActions.push({
        type: 'createTodo',
        data: { text: match[1].trim() }
      });
    }
    
    // Parse all CREATE_EVENT actions
    const eventRegex = /\[ACTION: CREATE_EVENT\]\s*Title:\s*(.+?)\s*\|\s*Date:\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Time:\s*(\d{2}:\d{2})(?:\s*\|\s*Duration:\s*(\d+))?/g;
    const eventMatches = aiText.matchAll(eventRegex);
    for (const match of eventMatches) {
      allActions.push({
        type: 'createEvent',
        data: {
          title: match[1].trim(),
          date: match[2],
          time: match[3],
          duration: match[4] ? parseInt(match[4]) : 60
        }
      });
    }
    
    // Set primary action for backward compatibility
    if (allActions.length > 0) {
      actionType = allActions[0].type;
      actionData = allActions[0].data;
    }
    
    res.json({ 
      reply: aiText,
      suggestedAction: actionType,
      actionData: actionData,
      allActions: allActions, // Send all parsed actions
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
