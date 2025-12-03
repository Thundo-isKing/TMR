/*
  Example Node.js push server using the `web-push` library.

  Usage (example):
    npm install express body-parser web-push
    node push-server.js

  This example exposes endpoints:
    GET  /vapidPublicKey    -> returns VAPID public key
    POST /subscribe         -> accepts { subscription } and stores it (in-memory here)
    POST /sendNotification  -> accepts { subscriptionId, payload } to send a push

  Note: This is a minimal demo. For production you must persist subscriptions securely,
  protect endpoints, and run on HTTPS.
*/

const express = require('express');
const bodyParser = require('body-parser');
const webpush = require('web-push');

// Replace with values you generate with web-push generate-vapid-keys
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || '<YOUR_PUBLIC_VAPID_KEY_HERE>';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || '<YOUR_PRIVATE_VAPID_KEY_HERE>';

webpush.setVapidDetails('mailto:you@example.com', VAPID_PUBLIC, VAPID_PRIVATE);

const app = express();
app.use(bodyParser.json());

// Simple in-memory store for demo purposes
const subscriptions = new Map();
let nextId = 1;

app.get('/vapidPublicKey', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body.subscription;
  if(!sub) return res.status(400).json({ error: 'Missing subscription' });
  const id = String(nextId++);
  subscriptions.set(id, sub);
  // In production, store with user mapping in DB
  res.json({ id });
});

app.post('/sendNotification', async (req, res) => {
  const { subscriptionId, payload } = req.body;
  if(!subscriptionId || !subscriptions.has(subscriptionId)) return res.status(404).json({ error: 'subscription not found' });
  const sub = subscriptions.get(subscriptionId);
  try{
    await webpush.sendNotification(sub, JSON.stringify(payload || { title: 'TMR', body: 'Test' }));
    res.json({ ok: true });
  }catch(err){ console.error('push error', err); res.status(500).json({ error: err.message }); }
});

const port = process.env.PORT || 3001;
app.listen(port, ()=> console.log('Push demo server listening on', port));
