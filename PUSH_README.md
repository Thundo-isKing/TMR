Service Worker + Push integration for TMR
=====================================

Overview
--------
This project includes a minimal Service Worker (`sw.js`) and example Node push server (`push-server.js`) to demonstrate how to deliver push notifications to users' systems when they're subscribed.

Important: Web Push requires HTTPS (or localhost for development) and a server component to send push messages (or a 3rd-party push provider). You'll also need VAPID keys to authenticate your server.

Client-side
-----------
- `sw.js` -- the Service Worker that listens for `push` events and displays notifications. It also handles notificationclick to open/focus the client.
- `TMR.js` -- contains registration and subscription helpers:
  - Registers the Service Worker at `/sw.js`.
  - Attempts to fetch a VAPID public key from `/vapidPublicKey` on your server. If not present, you can paste the VAPID public key into the menu input field.
  - Calls `pushManager.subscribe()` with the applicationServerKey derived from the VAPID public key.
  - Sends the resulting subscription JSON to your server via `POST /subscribe` (example endpoint provided in `push-server.js`).

Server-side (example)
----------------------
Included: `push-server.js` — a demonstration Node/Express server using `web-push`:
- Exposes `GET /vapidPublicKey` to return your public VAPID key (useful for client-side auto-fill).
- Exposes `POST /subscribe` to accept subscription objects from clients and store them (example uses in-memory storage; persist to DB in production).
- Exposes `POST /sendNotification` which accepts { subscriptionId, payload } and sends a push message using `web-push`.

Setup (development)
-------------------
1. Generate VAPID keys (one-time):

   npm install -g web-push
   node -e "const webpush=require('web-push');console.log(JSON.stringify(webpush.generateVAPIDKeys()));"

   Save the two strings (publicKey and privateKey). Set them as environment variables when running `push-server.js`, or paste them into the file.

2. Install and run the example server (for demo only):

   npm install express body-parser web-push
   VAPID_PUBLIC=<your_public_key> VAPID_PRIVATE=<your_private_key> node push-server.js

3. Serve the site over HTTPS (or use localhost for testing). If you run the Node server on the same host and port, ensure the static files and endpoints are reachable (CORS may apply).

Production notes
----------------
- Use HTTPS for your site (required by Service Worker and Push APIs).
- Store subscriptions server-side in a database; remove stale subscriptions when `web-push` returns errors.
- Secure the `/sendNotification` endpoint so only authorized services can send messages.
- Consider using a message queue if you need to fan-out notifications to many subscriptions.

Limitations
-----------
- Browser/tab must be running the Service Worker for push events to be received. A Service Worker can receive push messages in the background while the browser is open (not strictly when closed), but a Push Service can wake browsers on many platforms — behavior varies.
- Desktop and mobile browsers have different push support. Service Worker + Push works best in Chrome/Edge/Firefox on desktop. Safari uses a different push model on macOS.

Next steps
----------
- Secure and persist subscriptions server-side.
- Add user preferences for which notifications to receive.
- Implement server-side scheduling (cron or queue) to send push payloads at the appropriate times.
