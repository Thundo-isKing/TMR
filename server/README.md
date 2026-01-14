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

Production persistence (important):
- By default this server uses SQLite at `server/tmr_server.db`.
- On Render Free (and most container hosts), the filesystem inside the service is ephemeral.
  That means users/notes/todos can appear to "reset" after deploys/restarts.

You have 2 options:

Option A) Postgres (recommended for Render Free)
- Create a free Postgres database (Neon / Supabase / etc)
- Set env var: `DATABASE_URL=postgres://...`
- (Optional) Force backend: `TMR_DB_BACKEND=postgres`
- (Optional) SSL control:
  - Default: SSL on in `NODE_ENV=production`
  - Force on: `TMR_PG_SSL=true`
  - Force off (local dev Postgres): `TMR_PG_SSL=false`

Option B) SQLite on a persistent disk
- Requires a persistent disk/mount from your host.
- Set env var: `TMR_DB_PATH=/var/data/tmr_server.db`
- (Optional) Force backend: `TMR_DB_BACKEND=sqlite`

Example (Render persistent disk):
- Add a disk mounted at `/var/data`
- Set env var: `TMR_DB_PATH=/var/data/tmr_server.db`

After that, your notes and other data should persist.
