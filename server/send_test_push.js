const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const webpush = require('web-push');
const db = require('./db');

const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
if(!PUBLIC || !PRIVATE){
  console.error('Missing VAPID keys in .env');
  process.exit(1);
}
webpush.setVapidDetails('mailto:you@example.com', PUBLIC, PRIVATE);

function sendToAll(){
  db.getAllSubscriptions((err, subs) => {
    if(err) return console.error('DB error', err);
    console.log('Found', (subs||[]).length, 'subscriptions');
    if(!subs || subs.length === 0) return;
    const payload = JSON.stringify({ title: 'TMR Test', body: 'This is a test push from server', data: { test: true } });
    subs.forEach(s => {
      const sub = s.subscription;
      webpush.sendNotification(sub, payload).then(res => {
        console.log('Sent to id=', s.id, 'endpoint=', (sub && sub.endpoint) ? sub.endpoint.slice(0,80) : 'no-endpoint');
      }).catch(err => {
        console.warn('Failed to send to id=', s.id, 'err=', err && err.statusCode ? err.statusCode : err);
      });
    });
  });
}

sendToAll();
