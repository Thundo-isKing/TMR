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

const targetId = Number(process.argv[2]);
if(!targetId) {
  console.error('Usage: node send_targeted_push.js <subscriptionId>');
  process.exit(1);
}

function sendToId(id){
  db.getAllSubscriptions((err, subs) => {
    if(err) return console.error('DB error', err);
    const s = (subs||[]).find(x => Number(x.id) === Number(id));
    if(!s) return console.error('Subscription id not found:', id);
    const payload = JSON.stringify({ title: 'TMR Targeted Test', body: 'Targeted push to id ' + id, data: { targeted: true, id } });
    webpush.sendNotification(s.subscription, payload).then(res => {
      console.log('Sent to id=', s.id, 'endpoint=', (s.subscription && s.subscription.endpoint) ? s.subscription.endpoint.substring(0,120) : 'no-endpoint');
    }).catch(err => {
      console.error('Failed to send to id=', s.id, 'err=', err && err.statusCode ? err.statusCode : err);
    });
  });
}

sendToId(targetId);
