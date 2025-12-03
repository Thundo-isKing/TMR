require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const webpush = require('web-push');
const db = require('./db');

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
});

// Ensure VAPID keys exist; if not, generate and write to .env
const envPath = path.join(__dirname, '..', '.env');
let VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
let VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if(!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY){
  console.log('VAPID keys not found in env — generating new keys (saved to .env)');
  const keys = webpush.generateVAPIDKeys();
  VAPID_PUBLIC_KEY = keys.publicKey;
  VAPID_PRIVATE_KEY = keys.privateKey;
  // append to .env in project root; mark generated
  try{
    fs.appendFileSync(envPath, `VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}\nVAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}\n`);
    console.log('Wrote VAPID keys to .env (project root)');
  }catch(e){ console.warn('Failed to write .env:', e); }
}

webpush.setVapidDetails('mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// start scheduler
require('./scheduler')({ db, webpush });

const app = express();
app.use(express.json());

// Serve the static client from the project root so the push API and the
// web app share the same origin (helps when exposing via a single ngrok
// HTTPS tunnel). This makes `https://<ngrok>/TMR.html` and `/sw.js`
// available from the same server as the push endpoints.
const staticRoot = path.join(__dirname, '..');
app.use(express.static(staticRoot));

// Simple CORS middleware to allow the client (served on a different port
// during development) to call this API. In production restrict origins.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/vapidPublicKey', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Debug endpoints (development only) to inspect stored subscriptions and reminders
app.get('/debug/subscriptions', (req, res) => {
  db.getAllSubscriptions((err, subs) => {
    if(err) return res.status(500).json({ error: 'db error' });
    res.json({ ok: true, subscriptions: subs });
  });
});

app.get('/debug/reminders', (req, res) => {
  // optional query ?pending=1 to return pending reminders only
  const pendingOnly = req.query && (req.query.pending === '1' || req.query.pending === 'true');
  if(pendingOnly){
    db.getPendingReminders((err, rows) => {
      if(err) return res.status(500).json({ error: 'db error' });
      res.json({ ok: true, reminders: rows });
    });
  } else {
    db.getAllReminders((err, rows) => {
      if(err) return res.status(500).json({ error: 'db error' });
      res.json({ ok: true, reminders: rows });
    });
  }
});

// Subscribe endpoint: store subscription and optional userId
app.post('/subscribe', (req, res) => {
  const { subscription, userId } = req.body;
  if(!subscription) return res.status(400).json({ error: 'missing subscription' });
  // Deduplicate: try to avoid storing the same subscription endpoint twice
  try{
    const endpoint = (subscription && subscription.endpoint) ? subscription.endpoint : null;
    if(endpoint){
      db.getAllSubscriptions((err, subs) => {
        if(err) return res.status(500).json({ error: 'db error' });
        const exists = (subs || []).find(s => (s.subscription && s.subscription.endpoint ? s.subscription.endpoint : (JSON.parse(s.subscription || '{}').endpoint)) === endpoint);
        if(exists) return res.json({ ok: true, id: exists.id, note: 'already_exists' });
        // not found -> insert
        db.addSubscription(userId || null, subscription, (err2, id) => {
          if(err2) return res.status(500).json({ error: 'db error' });
          res.json({ ok: true, id });
        });
      });
    } else {
      // Fallback: just add
      db.addSubscription(userId || null, subscription, (err, id) => {
        if(err) return res.status(500).json({ error: 'db error' });
        res.json({ ok: true, id });
      });
    }
  }catch(e){
    // On error, attempt add as last resort
    db.addSubscription(userId || null, subscription, (err, id) => {
      if(err) return res.status(500).json({ error: 'db error' });
      res.json({ ok: true, id });
    });
  }
});

// Unsubscribe / delete subscription endpoint (development helper)
app.post('/unsubscribe', (req, res) => {
  const { id, endpoint } = req.body || {};
  if(!id && !endpoint) return res.status(400).json({ error: 'provide id or endpoint' });
  if(id){
    db.removeSubscriptionById(id, (err, changes) => {
      if(err) return res.status(500).json({ error: 'db error' });
      res.json({ ok: true, removed: changes || 0 });
    });
    return;
  }
  if(endpoint){
    db.removeSubscriptionByEndpoint(endpoint, (err, changes) => {
      if(err) return res.status(500).json({ error: 'db error' });
      res.json({ ok: true, removed: changes || 0 });
    });
    return;
  }
});

// Reminder endpoint: persist a reminder to be delivered at deliverAt (ms)
app.post('/reminder', (req, res) => {
  const { userId, title, body, deliverAt } = req.body;
  const now = Date.now();
  const deliverAtNum = Number(deliverAt);
  const delayMs = deliverAtNum - now;
  const delaySecs = Math.round(delayMs / 1000);
  console.log('[Reminder] POST received:', { title, body, deliverAt: deliverAtNum });
  console.log('[Reminder] Current time:', now, 'Deliver at:', deliverAtNum, 'Delay:', delaySecs, 'seconds');
  if(!deliverAt) return res.status(400).json({ error: 'deliverAt required (epoch ms)' });
  db.addReminder(userId || null, title || '', body || '', deliverAtNum, (err, id) => {
    if(err) return res.status(500).json({ error: 'db error' });
    console.log('[Reminder] Added reminder:', id, 'delivering at:', new Date(deliverAtNum), '(in', delaySecs, 'seconds)');
    res.json({ ok: true, id });
  });
});

// Admin: send a targeted push to a subscription id (development helper)
app.post('/admin/send/:id', (req, res) => {
  const id = Number(req.params.id);
  if(!id) return res.status(400).json({ error: 'invalid id' });
  db.getAllSubscriptions((err, subs) => {
    if(err) return res.status(500).json({ error: 'db error' });
    const s = (subs || []).find(x => Number(x.id) === id);
    if(!s) return res.status(404).json({ error: 'subscription not found' });
    const payload = req.body && Object.keys(req.body).length ? req.body : { title: 'TMR Targeted Test', body: 'Targeted push (admin)' };
    webpush.sendNotification(s.subscription, JSON.stringify(payload)).then(() => {
      res.json({ ok: true, id });
    }).catch(e => {
      const status = e && (e.statusCode || e.status) ? (e.statusCode || e.status) : null;
      res.status(500).json({ ok: false, id, status, error: String(e) });
    });
  });
});

// Admin: cleanup stale subscriptions by attempting a push and removing those
// that return permanent errors (410, 404) or 401 (unauthorized/stale).
app.post('/admin/cleanup', async (req, res) => {
  db.getAllSubscriptions(async (err, subs) => {
    if(err) return res.status(500).json({ error: 'db error' });
    const results = [];
    for(const s of (subs || [])){
      try{
        await webpush.sendNotification(s.subscription, JSON.stringify({ title: 'TMR cleanup probe' }));
        results.push({ id: s.id, status: 'ok' });
      }catch(e){
        const status = e && (e.statusCode || e.status) ? (e.statusCode || e.status) : null;
        if(status === 410 || status === 404 || status === 401){
          // remove stale/subscriptions
          db.removeSubscriptionById(s.id, ()=>{});
          results.push({ id: s.id, removed: true, status });
        } else {
          results.push({ id: s.id, removed: false, status: status, error: String(e) });
        }
      }
    }
    res.json({ ok: true, results });
  });
});

// Groq Meibot endpoint
const GroqAssistant = require('./groq-assistant');
let groqAssistant = null;

try {
  groqAssistant = new GroqAssistant(process.env.GROQ_API_KEY);
  console.log('[Meibot] Groq assistant initialized');
} catch (err) {
  console.warn('[Meibot] Groq initialization failed:', err.message);
}

app.post('/api/meibot-test', (req, res) => {
  console.log('[Test] Test endpoint called');
  res.json({ status: 'ok', message: 'test endpoint works' });
});

app.post('/api/meibot', async (req, res) => {
  if (!groqAssistant) {
    return res.status(503).json({ error: 'Groq assistant not initialized. Set GROQ_API_KEY in .env' });
  }

  const { message, context, consent, userId } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  try {
    console.log('[Meibot] Received:', message.substring(0, 50));
    const response = await groqAssistant.chat(message, context || '', userId || 'default');
    console.log('[Meibot] Responding with action:', response.suggestedAction);
    if (response.actionData) {
      console.log('[Meibot] Action data:', JSON.stringify(response.actionData));
    }
    res.json(response);
  } catch (err) {
    console.error('[Meibot] Error:', err);
    console.error('[Meibot] Error message:', err.message);
    console.error('[Meibot] Error status:', err.status);
    res.status(500).json({ error: 'Meibot error', details: err.message });
  }
});

const port = process.env.PUSH_SERVER_PORT || 3001;
app.listen(port, () => console.log('TMR push server listening on port', port));
