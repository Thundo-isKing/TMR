TMR Push Server (local dev)

This small server stores push subscriptions and reminders in SQLite and uses
web-push to send notifications when reminders are due. It's intended for
local testing and small-scale use. For production, use a hosted DB, TLS,
monitoring, and hardened error handling.

Quick start (PowerShell):

# from project root
cd server
npm install
# start server (will generate VAPID keys if none exist in project .env)
npm start

Endpoints:
- GET /vapidPublicKey -> { publicKey }
- POST /subscribe { subscription, userId? } -> { ok, id }
- POST /reminder { userId?, title?, body?, deliverAt } -> { ok, id }

Notes:
- deliverAt must be epoch milliseconds (Date.now()+...)
- The scheduler checks for due reminders every minute and sends web-push to
  stored subscriptions.
- The server writes VAPID keys to project root .env if they don't exist.
