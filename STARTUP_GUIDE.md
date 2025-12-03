# TMR Application — Complete Startup & Troubleshooting Guide

## Overview
The TMR application consists of:
1. **Push Server** (Node.js + Express) — handles Web Push notifications and subscriptions
2. **ngrok tunnel** — exposes the server to the internet (required for mobile & HTTPS)
3. **Client app** (HTML/JS/CSS) — loads from the push server, includes Service Worker for push

---

## Prerequisites

### System
- **Windows PowerShell 5.1+** (included in Windows 10+)
- **Node.js** (v14+) — [download](https://nodejs.org/)
  - Verify: Open PowerShell and run `node --version`
- **ngrok** (free account optional) — [download](https://ngrok.com/download)
  - Verify: In PowerShell, run `ngrok version`

### Project Files (should already exist)
```
c:\Users\akenj\TMR_Project\TMR_redo\
├── server/
│   ├── index.js               (main push server)
│   ├── db.js                  (SQLite wrapper)
│   ├── scheduler.js           (cron reminder sender)
│   ├── package.json           (Node dependencies)
│   ├── tmr_server.db          (SQLite database, auto-created)
│   ├── send_test_push.js      (broadcast test script)
│   └── send_targeted_push.js  (targeted push script)
├── .env                       (VAPID keys, auto-generated)
├── TMR.html                   (main app page)
├── TMR.js                     (client logic & push subscribe)
├── TMR.css                    (styles)
├── sw.js                      (Service Worker for push)
├── admin.html                 (admin UI for manual push/cleanup)
├── admin.js                   (admin client logic)
├── admin.css                  (admin styles)
└── ... (other files)
```

---

## Start-to-Finish Startup

### Step 1: Install Node Dependencies (First Time Only)
Open PowerShell, navigate to the server directory, and install packages:

```powershell
cd c:\Users\akenj\TMR_Project\TMR_redo\server
npm install
```

**Expected output:**
```
added 50+ packages in X seconds
```

**Troubleshooting:**
- If `npm: command not found`, ensure Node.js is installed (`node --version`).
- If `EACCES` or permission errors, run PowerShell as Administrator.

---

### Step 2: Start the Push Server

Open **a new PowerShell window** (keep it open), navigate to the server directory, and start the server:

```powershell
cd c:\Users\akenj\TMR_Project\TMR_redo\server
node index.js
```

**Expected output:**
```
VAPID keys loaded from .env
Scheduler started (checking every minute)
TMR push server listening on port 3002
```

**Troubleshooting:**

**Issue: "Port 3001 already in use"**
- Kill the existing process:
  ```powershell
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
  node index.js
  ```

**Issue: "Cannot find module 'express'" or similar**
- Dependencies not installed. Run `npm install` in the `server/` directory first.

**Issue: "VAPID keys not found"**
- The server auto-generates them on first run and saves to `.env`. If `.env` is missing or corrupted, delete it and restart the server:
  ```powershell
  Remove-Item c:\Users\akenj\TMR_Project\TMR_redo\.env
  node index.js
  ```

**Keep this PowerShell window open while using the app.**

---

### Step 3: Start ngrok Tunnel (to expose to internet/mobile)

Open **a separate PowerShell window** and start ngrok:

```powershell
cd c:\Users\akenj\TMR_Project\TMR_redo
ngrok http 3001
```

**Expected output:**
```
ngrok by @inconshrevat                          (Ctrl+C to quit)

Session Status                online
Account                       <your-account>
Version                        3.x.x
Region                         us (United States)
Latency                         45ms
Web Interface                   http://127.0.0.1:4040

Forwarding                      https://sensationistic-taunya-palingenesian.ngrok-free.dev -> http://localhost:3001
```

**Note the public URL** (e.g., `https://sensationistic-taunya-palingenesian.ngrok-free.dev`). This is your public address.

**Troubleshooting:**

**Issue: "command not found: ngrok"**
- ngrok is not in your PATH. Either:
  1. Add ngrok to PATH (see ngrok install docs), or
  2. Run ngrok from its installation directory:
     ```powershell
     & 'C:\Program Files\ngrok\ngrok.exe' http 3001
     ```

**Issue: ngrok shows "ERR_NGROK_6024" or interstitial page**
- On first access to the public URL, ngrok may show a browser interstitial. Click "Visit Site" in your browser to accept, then the tunneling will work normally.
- **For mobile**: open the public URL in your phone's browser once before testing push notifications.

**Issue: ngrok URL changes between restarts**
- On the free plan, ngrok assigns a new URL each time. You'll need to:
  1. Copy the new URL.
  2. Update any hardcoded references (currently this is handled by fallback logic in `TMR.js`).
  3. Re-open the app on your phone at the new URL.

**Keep this PowerShell window open while using the app.**

---

### Step 4: Open the App (Local or Remote)

#### Option A: Local (Desktop/Same Machine)
Open a browser and navigate to:
```
http://localhost:3001/TMR.html
```

#### Option B: Remote (Mobile or Another Device)
1. On your phone (or other device), open a browser.
2. Navigate to the ngrok public URL (from Step 3):
   ```
   https://sensationistic-taunya-palingenesian.ngrok-free.dev/TMR.html
   ```
   (Replace with your actual ngrok URL.)

**Troubleshooting:**

**Issue: "Connection refused" or "Cannot reach server"**
- Ensure the push server (Step 2) is running and listening on port 3001.
- Verify ngrok (Step 3) is running and shows "Forwarding" to `localhost:3001`.
- Test locally first:
  ```powershell
  Invoke-WebRequest -Uri 'http://127.0.0.1:3001/TMR.html' -UseBasicParsing
  ```

**Issue: App loads but push notifications don't work**
- Ensure you're accessing via HTTPS (not HTTP). Push API requires HTTPS or `localhost`.
- If using ngrok, use the `https://` URL.
- Check Service Worker registration in browser DevTools (F12 → Application → Service Workers).

---

### Step 5: Subscribe to Push Notifications (In the App)

1. Open the app (`TMR.html`).
2. Look for the **"Enable Push Notifications"** button or toggle.
3. Click it. Your browser/device will:
   - Request permission to show notifications.
   - Register the Service Worker.
   - Subscribe to push and send the subscription to the server.
4. You should see a confirmation message like **"Subscribed for push"** or similar.

**Troubleshooting:**

**Issue: "Browser does not support Web Push"**
- Modern browsers (Chrome, Edge, Firefox) support it. Safari on macOS/iOS do not.
- Try a different browser or device.

**Issue: Permission denied for notifications**
- Allow notifications in your browser settings:
  - **Chrome**: Click the lock icon in the address bar → Notifications → Allow.
  - **Edge**: Similar to Chrome.
  - **Firefox**: Preferences → Privacy → Permissions → Notifications.

**Issue: Service Worker fails to register**
- Service Worker requires HTTPS (or `localhost`).
- Check browser console (F12 → Console) for errors.
- Try clearing site data and reload:
  - Chrome DevTools (F12) → Application → Clear site data → Reload.

---

## Admin Panel

### Access the Admin Page

#### Local:
```
http://127.0.0.1:3001/admin.html
```

#### Remote (ngrok):
```
https://sensationistic-taunya-palingenesian.ngrok-free.dev/admin.html
```

### Features:

- **List Subscriptions**: Shows all active subscriptions with their IDs and creation dates.
- **Send to All**: Edit the JSON payload and click to send a test push to every subscription.
- **Send to Specific**: Click the **Send** button next to a subscription ID to push to that device only.
- **Run Cleanup**: Probes all subscriptions and removes stale/invalid ones (HTTP 401/403/404 errors).

### PowerShell Commands (Alternative to Admin UI):

**Send a test push to all subscriptions:**
```powershell
cd c:\Users\akenj\TMR_Project\TMR_redo\server
node send_test_push.js
```

**Send a targeted push to subscription ID 11:**
```powershell
cd c:\Users\akenj\TMR_Project\TMR_redo\server
node send_targeted_push.js 11
```

**Run cleanup via API:**
```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3001/admin/cleanup' -Method Post -UseBasicParsing
```

**Send a custom push via API:**
```powershell
$payload = @{
    title = "Custom Title"
    body = "Custom message body"
    url = "/TMR.html"
} | ConvertTo-Json

Invoke-RestMethod -Uri 'http://127.0.0.1:3001/admin/send/11' -Method Post `
  -ContentType 'application/json' `
  -Body $payload
```

---

## Common Issues & Solutions

### Server won't start

| Error | Cause | Solution |
|-------|-------|----------|
| "Port 3001 in use" | Another process is using the port. | Kill Node: `Get-Process node -ErrorAction SilentlyContinue \| Stop-Process -Force` |
| "Cannot find module" | Dependencies not installed. | Run `npm install` in `server/` dir. |
| "VAPID keys missing" | `.env` corrupted or deleted. | Delete `.env`, restart server (it will regenerate). |
| "ENOENT: no such file or directory, open 'tmr_server.db'" | DB path issue. | Ensure you're running `node index.js` from the `server/` directory. |

### App loads but no push notifications

| Issue | Solution |
|-------|----------|
| App says "Browser not supported" | Use Chrome, Edge, or Firefox (not Safari on macOS/iOS). |
| Permission denied | Allow notifications in browser settings. |
| Service Worker fails to load | Ensure HTTPS (ngrok) or `localhost`. Check browser console for errors. |
| App subscribed but no push received | Check admin panel — is the subscription listed? |

### ngrok issues

| Issue | Solution |
|-------|----------|
| "command not found" | Add ngrok to PATH or run with full path: `C:\Program Files\ngrok\ngrok.exe http 3001` |
| ERR_NGROK_334 (endpoint already online) | Kill existing ngrok process: `Get-Process ngrok -ErrorAction SilentlyContinue \| Stop-Process -Force`, wait 2 seconds, then restart. |
| ERR_NGROK_6024 interstitial | Open the public URL in a browser, accept, then it will work. |
| URL changes every restart | Free plan behavior. Copy the new URL and use it. |
| No traffic reaching local server | Verify `ngrok http 3001` shows "Forwarding" to `localhost:3001`. Test locally first. |

### Database/Subscription issues

| Issue | Solution |
|-------|----------|
| Subscription not showing in admin | Run cleanup to remove stale entries. |
| Old subscriptions return 401 errors | They're stale (invalid). Run cleanup to remove them. |
| Cleanup removes subscription I want | Subscriptions are removed if they fail push delivery (401/403/404). Re-subscribe in the app. |

---

## Development Workflow

### Everyday startup (assuming Node dependencies already installed):

**Terminal 1 (Push Server):**
```powershell
cd c:\Users\akenj\TMR_Project\TMR_redo\server
node index.js
```

**Terminal 2 (ngrok):**
```powershell
cd c:\Users\akenj\TMR_Project\TMR_redo
ngrok http 3002
```

**Terminal 3 or Browser:**
- Local: `http://localhost:3001/TMR.html`
- Remote: Open the ngrok HTTPS forwarding URL and append `/TMR.html` (e.g., `https://sensationistic-taunya-palingenesian.ngrok-free.dev/TMR.html`)

### Making changes to client code:

1. Edit `TMR.html`, `TMR.js`, `TMR.css`, or `sw.js`.
2. Reload the browser page (Ctrl+R or F5).
3. If Service Worker changes don't appear:
   - Clear site data: DevTools (F12) → Application → Clear site data → Reload.

### Making changes to server code:

1. Edit `server/index.js`, `server/db.js`, or `server/scheduler.js`.
2. Stop the server in Terminal 1 (Ctrl+C).
3. Restart it: `node index.js`.
4. Reload the browser (the client will re-fetch).

### Checking logs:

- **Server logs**: Watch Terminal 1 for messages from the Node server.
- **Client logs**: Open browser DevTools (F12 → Console) to see client-side errors and debug messages.
- **Subscription status**: Open the admin panel (`/admin.html`) to see live subscription list.

---

## Quick Command Reference

| Task | Command |
|------|---------|
| Install dependencies | `cd server; npm install` |
| Start push server | `cd server; node index.js` |
| Start ngrok | `ngrok http 3001` |
| Open app (local) | Browser: `http://localhost:3001/TMR.html` |
| Open admin panel (local) | Browser: `http://127.0.0.1:3001/admin.html` |
| Send test push to all | `cd server; node send_test_push.js` |
| Send push to ID 11 | `cd server; node send_targeted_push.js 11` |
| Run cleanup | `Invoke-RestMethod -Uri 'http://127.0.0.1:3001/admin/cleanup' -Method Post` |
| Kill running Node process | `Get-Process node -ErrorAction SilentlyContinue \| Stop-Process -Force` |
| Check if server is responding | `Invoke-RestMethod -Uri 'http://127.0.0.1:3001/debug/subscriptions' -Method Get` |

---

## Support & Next Steps

If you encounter issues:
1. **Check the logs** — server logs (Terminal 1) and browser console (F12).
2. **Check the admin panel** — see if subscriptions are listed.
3. **Try cleanup** — remove stale subscriptions and re-subscribe.
4. **Restart** — restart the server and reload the browser.

If you want to add more features:
- **More admin features** — edit `admin.html`, `admin.js`, `admin.css`.
- **Reminder scheduling** — edit `server/scheduler.js` to customize cron timing.
- **UI improvements** — edit `TMR.html`, `TMR.js`, `TMR.css`.
- **Mobile app** — the same code works on mobile browsers; no native app needed.

---

## File Reference

| File | Purpose |
|------|---------|
| `server/index.js` | Main Express server; handles API and static files. |
| `server/db.js` | SQLite database wrapper. |
| `server/scheduler.js` | Cron job to send reminders. |
| `server/package.json` | Node dependencies. |
| `.env` | VAPID keys (auto-generated). |
| `TMR.html` | Main app page. |
| `TMR.js` | Client logic and push subscription. |
| `TMR.css` | App styles. |
| `sw.js` | Service Worker for push notifications. |
| `admin.html` | Admin UI. |
| `admin.js` | Admin client logic. |
| `admin.css` | Admin styles. |

---

## Summary

**To run the app right now:**

1. Open PowerShell in `c:\Users\akenj\TMR_Project\TMR_redo\server` and run:
   ```powershell
   node index.js
   ```

2. Open another PowerShell in `c:\Users\akenj\TMR_Project\TMR_redo` and run:
   ```powershell
   ngrok http 3001
   ```

3. Open your browser and go to:
   - Local: `http://localhost:3001/TMR.html`
   - Mobile/Remote: Use the ngrok URL from the ngrok terminal

4. Enable push notifications in the app.

5. (Optional) Open the admin panel to manage subscriptions and send test pushes:
   - Local: `http://127.0.0.1:3001/admin.html`
   - Remote: Use the ngrok URL + `/admin.html`

That's it! You're running the TMR application with cross-device push notifications.

