/* Service Worker for TMR push notifications
   Registers push event handler and notification click behavior.
   Place this file at the site root so registration scope covers pages (or adjust registration scope).
*/
'use strict';

const TMR_SW_VERSION = '20260119a';

self.addEventListener('push', function(event) {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = { body: event.data ? event.data.text() : '' }; }

  const title = payload.title || 'TMR Notification';
  const options = Object.assign({
    body: payload.body || '',
    icon: payload.icon || '/favicon.ico',
    badge: payload.badge || '/favicon.ico',
    data: payload.data || {}
  }, payload.options || {});

  const receiptId = options && options.data && options.data.receiptId;
  const receiptUrl = options && options.data && options.data.receiptUrl;
  const clientPing = clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientList) => {
      for (const c of (clientList || [])) {
        try {
          c.postMessage({
            type: 'tmr_push_received',
            receiptId: receiptId || null,
            title,
            body: options && options.body ? options.body : ''
          });
        } catch (_) {}
      }
    })
    .catch(() => {});
  const receiptPromise = receiptId
    ? (
        receiptUrl
          // Cross-origin friendly ping (no-cors) so receipts work even if the SW origin != server origin.
          ? fetch(String(receiptUrl), { method: 'GET', mode: 'no-cors', cache: 'no-store' }).catch(() => {})
          // Same-origin JSON POST
          : fetch('/push/receipt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ receiptId })
            }).catch(() => {})
      )
    : Promise.resolve();

  event.waitUntil(Promise.allSettled([
    self.registration.showNotification(title, options),
    receiptPromise,
    clientPing
  ]));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    for (const client of clientList) {
      if (client.url === url && 'focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});

self.addEventListener('install', (e)=>{
  try { console.log('[TMR SW] install', TMR_SW_VERSION); } catch (_) {}
  self.skipWaiting();
});
self.addEventListener('activate', (e)=>{
  try { console.log('[TMR SW] activate', TMR_SW_VERSION); } catch (_) {}
  self.clients.claim();
});
