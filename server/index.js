const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const bcrypt = require('bcrypt');
const nodeCrypto = require('crypto');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const webpush = require('web-push');
const db = require('./db');

// ADD: Import security modules
const SessionStore = require('./session-store');
const TokenRefreshManager = require('./token-refresh');

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
});

const buildErrorInfo = (err) => {
  if (!err) return { message: 'Unknown error' };
  const info = {
    message: err.message,
    name: err.name,
    code: err.code,
    errno: err.errno,
    syscall: err.syscall,
    address: err.address,
    port: err.port,
    detail: err.detail,
    hint: err.hint,
    where: err.where,
    schema: err.schema,
    table: err.table,
    column: err.column,
    constraint: err.constraint,
    routine: err.routine
  };

  // Avoid dumping huge objects in logs.
  if (err.stack) info.stack = err.stack;
  return info;
};

const logError = (label, err, extra) => {
  try {
    console.error(label, {
      ...(extra || {}),
      error: buildErrorInfo(err)
    });
  } catch (_) {
    console.error(label, err && err.message ? err.message : err);
  }
};

// Load environment variables from the project root (.env)
// so local development works without manually exporting env vars.
const envPath = path.join(__dirname, '..', '.env');
try {
  dotenv.config({ path: envPath });
} catch (e) {
  // Non-fatal: fall back to process.env
}

// Ensure VAPID keys exist; if not, generate and write to .env
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

// Initialize Google Calendar Manager
const GoogleCalendarManager = require('./google-calendar');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3002/auth/google/callback';

let googleCalendarManager = null;
let sessionStore = null;
let tokenRefreshManager = null;

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  googleCalendarManager = new GoogleCalendarManager(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    db
  );
  console.log('[GoogleCalendar] Manager initialized with OAuth credentials');
  
  // ADD: Initialize secure session store and token refresh
  sessionStore = new SessionStore();
  tokenRefreshManager = new TokenRefreshManager(db, googleCalendarManager);
  
  // Cleanup expired sessions every 5 minutes
  setInterval(() => {
    sessionStore.cleanup();
  }, 5 * 60 * 1000);
  
} else {
  console.warn('[GoogleCalendar] OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
}

// start scheduler
require('./scheduler')({ db, webpush });

const SESSION_COOKIE = 'tmr_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const secureCookie = process.env.NODE_ENV === 'production';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

const dbAsync = (fn, ...args) => new Promise((resolve, reject) => {
  try {
    fn(...args, (err, result) => err ? reject(err) : resolve(result));
  } catch (err) {
    reject(err);
  }
});

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: secureCookie,
  maxAge: SESSION_TTL_MS
};

const setSessionCookie = (res, token) => {
  res.cookie(SESSION_COOKIE, token, cookieOptions);
};

const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: secureCookie });
};

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'auth_required' });
  }
  next();
};

const app = express();
// Needed for correct client IP handling behind proxies (ngrok/vercel/reverse proxies)
// and to satisfy express-rate-limit validation when X-Forwarded-For is present.
app.set('trust proxy', 1);
// Avoid client/proxy cache oddities while iterating UI via ngrok.
app.disable('etag');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// First-visit routing:
// - First-time visitors hitting the bare domain (/) should see intro.html.
// - Returning visitors go to TMR.html (login modal shown client-side if not authed).
// - Authenticated users go straight to TMR.html (calendar UI).
const INTRO_SEEN_COOKIE = 'tmr_intro_seen';
const introSeenCookieOptions = {
  httpOnly: false,
  sameSite: 'lax',
  secure: secureCookie,
  maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
};

// Serve the static client from the project root so the push API and the
// web app share the same origin (helps when exposing via a single ngrok
// HTTPS tunnel). This makes `https://<ngrok>/TMR.html` and `/sw.js`
// available from the same server as the push endpoints.
const staticRoot = path.join(__dirname, '..');
// NOTE: We mount express.static AFTER first-visit routing so we can intercept
// direct hits to /TMR.html for first-time users.

// Simple CORS middleware to allow the client (served on a different port
// during development) to call this API. In production restrict origins.
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Attach authenticated user from session cookie if present
const attachUser = async (req, res, next) => {
  const token = req.cookies ? req.cookies[SESSION_COOKIE] : null;
  if (!token) return next();
  try {
    const session = await dbAsync(db.getSession, token);
    if (!session) return next();
    if (session.expiresAt <= Date.now()) {
      db.deleteSession(token, () => {});
      return next();
    }

    const user = await dbAsync(db.getUserById, session.userId);
    if (!user) {
      db.deleteSession(token, () => {});
      return next();
    }

    req.user = { id: user.id, username: user.username };
    req.sessionToken = token;
  } catch (err) {
    logError('[Auth] Failed to attach user', err);
  }
  return next();
};

app.use(attachUser);

// If a first-time user directly hits /TMR.html, show intro.html once.
// Otherwise, fall through to static serving of TMR.html.
app.get('/TMR.html', (req, res, next) => {
  if (req.user) return next();
  const seen = req.cookies ? req.cookies[INTRO_SEEN_COOKIE] : null;
  if (seen === '1') return next();
  try { res.cookie(INTRO_SEEN_COOKIE, '1', introSeenCookieOptions); } catch (_) {}
  return res.redirect(302, '/intro.html');
});

app.get(['/', '/index.html'], (req, res) => {
  // If already authenticated, go straight to the app.
  if (req.user) return res.redirect(302, '/TMR.html');

  // If they've seen the intro on this device/browser, go to the app (login modal).
  const seen = req.cookies ? req.cookies[INTRO_SEEN_COOKIE] : null;
  if (seen === '1') return res.redirect(302, '/TMR.html');

  // First visit: mark and show the intro.
  try { res.cookie(INTRO_SEEN_COOKIE, '1', introSeenCookieOptions); } catch (_) {}
  return res.redirect(302, '/intro.html');
});

// IMPORTANT: disable automatic index.html serving so our custom '/' handler can run.
// Also: avoid stale HTML during ngrok/mobile testing (force re-fetch of .html).
app.use(express.static(staticRoot, {
  index: false,
  setHeaders: (res, filePath) => {
    // Debug/provenance header to confirm which server build is serving assets.
    // Safe to keep; helps diagnose caching issues during ngrok/mobile testing.
    res.setHeader('X-TMR-Build', '20260108a');

    const lower = (typeof filePath === 'string') ? filePath.toLowerCase() : '';

    // HTML should never be cached (prevents stale layout / missing newest markup).
    if (lower.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }

    // CSS/JS should revalidate so changes show up quickly on mobile browsers.
    if (lower.endsWith('.css') || lower.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const createSessionForUser = async (userId) => {
  const token = nodeCrypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await dbAsync(db.createSession, userId, token, expiresAt);
  return { token, expiresAt };
};

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
  
  if (!subscription) {
    return res.status(400).json({ error: 'missing subscription' });
  }
  
  if (!subscription.endpoint) {
    return res.status(400).json({ error: 'subscription.endpoint required' });
  }

  // If authenticated, always bind subscription to the signed-in account
  // so reminders can be broadcast to all devices on that account.
  const effectiveUserId = (req.user && req.user.id != null) ? String(req.user.id) : (userId || null);

  db.addSubscription(effectiveUserId, subscription, (err, id) => {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        // Duplicate subscription - silently accept
        console.log('[Subscribe] Duplicate subscription ignored');
        return res.json({ ok: true, id, note: 'duplicate_ignored' });
      }
      console.error('[Subscribe] Error:', err.message);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }
    console.log('[Subscribe] Subscription added:', id, 'userId:', effectiveUserId);
    res.json({ ok: true, id });
  });
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
  const { subscriptionId, userId, title, body, deliverAt } = req.body;

  // Prefer authenticated account id when available.
  const effectiveUserId = (req.user && req.user.id != null) ? String(req.user.id) : (userId || null);

  if (!subscriptionId && !effectiveUserId) {
    return res.status(400).json({ error: 'subscriptionId or userId required' });
  }
  
  if (!deliverAt) {
    return res.status(400).json({ error: 'deliverAt required (epoch ms)' });
  }
  
  if (typeof deliverAt !== 'number' && typeof Number(deliverAt) !== 'number') {
    return res.status(400).json({ error: 'deliverAt must be number (epoch ms)' });
  }

  const now = Date.now();
  const deliverAtNum = Number(deliverAt);
  const delayMs = deliverAtNum - now;
  
  if (deliverAtNum < now - 60000) {
    return res.status(400).json({ error: 'deliverAt cannot be more than 1 minute in past' });
  }

  const delaySecs = Math.round(delayMs / 1000);
  console.log('[Reminder] POST received:', { subscriptionId, userId: effectiveUserId, title, body, deliverAt: deliverAtNum, delaySecs });
  
  db.addReminder(subscriptionId || null, effectiveUserId, title || '', body || '', deliverAtNum, (err, id) => {
    if (err) {
      console.error('[Reminder] Error:', err.message);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }
    console.log('[Reminder] Added:', id, '- delivering in', delaySecs, 'seconds', { subscriptionId: subscriptionId || null, userId: effectiveUserId });
    res.json({ ok: true, id, deliversIn: delaySecs });
  });
});

function computeEventReminderAtMs(event) {
  if (!event || typeof event !== 'object') return null;
  const dateStr = typeof event.date === 'string' ? event.date : null;
  const timeStr = typeof event.startTime === 'string'
    ? event.startTime
    : (typeof event.time === 'string' ? event.time : null);

  // Explicit reminderAt wins (if provided by client).
  if (event.reminderAt != null) {
    const explicit = Number(event.reminderAt);
    if (Number.isFinite(explicit)) return explicit;
  }

  if (!dateStr || !timeStr) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return null;
  const [y, mo, d] = parts;
  const tparts = timeStr.split(':').map(Number);
  if (tparts.length < 2) return null;
  const [hh, mm] = tparts;
  if (![y, mo, d, hh, mm].every(Number.isFinite)) return null;

  const startMs = new Date(y, mo - 1, d, hh || 0, mm || 0, 0, 0).getTime();
  if (!Number.isFinite(startMs)) return null;

  const mins = Number(event.reminderMinutes || 0);
  if (Number.isFinite(mins) && mins > 0) {
    return startMs - mins * 60 * 1000;
  }
  return startMs;
}

function scheduleEventReminderForUser(userId, event, eventId) {
  const deliverAt = computeEventReminderAtMs(event);
  if (!deliverAt) return;
  const now = Date.now();
  if (deliverAt < now - 60_000) return;

  const title = 'Event: ' + (event && event.title ? String(event.title) : 'Reminder');
  const timeStr = (event && (event.startTime || event.time)) ? String(event.startTime || event.time) : '';
  const body = (event && (event.description || event.notes))
    ? String(event.description || event.notes)
    : (event && event.date ? `Starts ${event.date}${timeStr ? ' ' + timeStr : ''}` : '');

  // userId-based reminder: scheduler will broadcast to all subscriptions for the account.
  db.addReminder(null, String(userId), title, body, Number(deliverAt), (err, id) => {
    if (err) {
      console.warn('[Events] Failed to schedule reminder', { eventId, deliverAt, err: err.message });
      return;
    }
    console.log('[Events] Scheduled reminder', { reminderId: id, eventId, deliverAt });
  });
}

// ========== AUTHENTICATION ==========

app.get('/auth/session', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  res.json({ user: req.user });
});

app.post('/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 40) {
      return res.status(400).json({ error: 'username must be 3-40 characters' });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const normalizedUsername = username.trim();
    const existing = await dbAsync(db.getUserByUsername, normalizedUsername);
    if (existing) {
      return res.status(409).json({ error: 'username_taken' });
    }

    const hash = await bcrypt.hash(password, 10);
    const userId = await dbAsync(db.createUser, normalizedUsername, hash);
    const { token } = await createSessionForUser(userId);
    setSessionCookie(res, token);

    res.json({ user: { id: userId, username: normalizedUsername } });
  } catch (err) {
    logError('[Auth] Register error', err, {
      username: req && req.body && typeof req.body.username === 'string' ? req.body.username.trim() : undefined,
      dbBackend: db && db.__tmrBackend,
      dbInfo: db && db.__tmrConnectionInfo,
      nodeEnv: process.env.NODE_ENV
    });
    res.status(500).json({ error: 'register_failed' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    const user = await dbAsync(db.getUserByUsername, username.trim());
    if (!user) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const storedHash = String(user.passwordHash || '');
    const looksLikeBcrypt = /^\$2[aby]?\$/.test(storedHash);
    const looksLikeSha256 = /^[0-9a-fA-F]{64}$/.test(storedHash);

    let matches = false;
    if (looksLikeBcrypt) {
      matches = await bcrypt.compare(password, storedHash);
    } else if (looksLikeSha256) {
      const sha = nodeCrypto.createHash('sha256').update(String(password)).digest('hex');
      matches = (sha.toLowerCase() === storedHash.toLowerCase());

      // Transparent migration: rehash to bcrypt after a successful legacy login.
      if (matches) {
        try {
          const upgraded = await bcrypt.hash(password, 10);
          await dbAsync(db.updateUserPasswordHash, user.id, upgraded);
        } catch (e) {
          console.warn('[Auth] Password hash upgrade failed for user', user.id, e && e.message);
        }
      }
    } else {
      // Unknown/unsupported hash format
      matches = false;
    }

    if (!matches) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const { token } = await createSessionForUser(user.id);
    setSessionCookie(res, token);
    res.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    logError('[Auth] Login error', err, {
      username: req && req.body && typeof req.body.username === 'string' ? req.body.username.trim() : undefined,
      dbBackend: db && db.__tmrBackend,
      dbInfo: db && db.__tmrConnectionInfo,
      nodeEnv: process.env.NODE_ENV
    });
    res.status(500).json({ error: 'login_failed' });
  }
});

// Diagnostics endpoint (opt-in)
// Enable by setting:
// - TMR_DEBUG=true
// - TMR_DEBUG_TOKEN=<random secret>
// Then call with header: x-tmr-debug-token: <token>
const debugEnabled = String(process.env.TMR_DEBUG || '').trim().toLowerCase() === 'true';
const debugToken = process.env.TMR_DEBUG_TOKEN;

app.get('/debug/diagnostics', async (req, res) => {
  if (!debugEnabled || !debugToken) return res.sendStatus(404);
  const token = req.get('x-tmr-debug-token');
  if (token !== debugToken) return res.sendStatus(403);

  try {
    const dbDiag = db && typeof db.diagnostics === 'function'
      ? await dbAsync(db.diagnostics)
      : { ok: false, note: 'db.diagnostics not implemented' };

    res.json({
      ok: true,
      now: Date.now(),
      nodeEnv: process.env.NODE_ENV,
      build: '20260108a',
      db: {
        backend: db && db.__tmrBackend,
        info: db && db.__tmrConnectionInfo,
        diagnostics: dbDiag
      }
    });
  } catch (err) {
    logError('[Debug] Diagnostics error', err, {
      dbBackend: db && db.__tmrBackend,
      dbInfo: db && db.__tmrConnectionInfo,
      nodeEnv: process.env.NODE_ENV
    });
    res.status(500).json({ ok: false, error: 'diagnostics_failed' });
  }
});

app.post('/debug/user-lookup', async (req, res) => {
  if (!debugEnabled || !debugToken) return res.sendStatus(404);
  const token = req.get('x-tmr-debug-token');
  if (token !== debugToken) return res.sendStatus(403);

  try {
    const username = req && req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!username) return res.status(400).json({ ok: false, error: 'username_required' });

    const user = await dbAsync(db.getUserByUsername, username);
    if (!user) return res.json({ ok: true, exists: false });

    res.json({
      ok: true,
      exists: true,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    logError('[Debug] User lookup error', err, {
      dbBackend: db && db.__tmrBackend,
      dbInfo: db && db.__tmrConnectionInfo,
      nodeEnv: process.env.NODE_ENV
    });
    res.status(500).json({ ok: false, error: 'user_lookup_failed' });
  }
});

app.post('/debug/reset-password', async (req, res) => {
  if (!debugEnabled || !debugToken) return res.sendStatus(404);
  const token = req.get('x-tmr-debug-token');
  if (token !== debugToken) return res.sendStatus(403);

  try {
    const username = req && req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const newPassword = req && req.body && typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
    if (!username) return res.status(400).json({ ok: false, error: 'username_required' });
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ ok: false, error: 'password_too_short' });

    const user = await dbAsync(db.getUserByUsername, username);
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });

    const hash = await bcrypt.hash(newPassword, 10);
    await dbAsync(db.updateUserPasswordHash, user.id, hash);
    res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    logError('[Debug] Reset password error', err, {
      dbBackend: db && db.__tmrBackend,
      dbInfo: db && db.__tmrConnectionInfo,
      nodeEnv: process.env.NODE_ENV
    });
    res.status(500).json({ ok: false, error: 'reset_password_failed' });
  }
});

app.post('/debug/verify-credentials', async (req, res) => {
  if (!debugEnabled || !debugToken) return res.sendStatus(404);
  const token = req.get('x-tmr-debug-token');
  if (token !== debugToken) return res.sendStatus(403);

  try {
    const username = req && req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = req && req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (!username) return res.status(400).json({ ok: false, error: 'username_required' });
    if (!password) return res.status(400).json({ ok: false, error: 'password_required' });

    const user = await dbAsync(db.getUserByUsername, username);
    if (!user) return res.json({ ok: true, exists: false });

    const storedHash = String(user.passwordHash || '');
    const looksLikeBcrypt = /^\$2[aby]?\$/.test(storedHash);
    const looksLikeSha256 = /^[0-9a-fA-F]{64}$/.test(storedHash);
    const hashFormat = looksLikeBcrypt ? 'bcrypt' : (looksLikeSha256 ? 'sha256' : 'unknown');

    let matches = false;
    if (looksLikeBcrypt) {
      matches = await bcrypt.compare(password, storedHash);
    } else if (looksLikeSha256) {
      const sha = nodeCrypto.createHash('sha256').update(String(password)).digest('hex');
      matches = (sha.toLowerCase() === storedHash.toLowerCase());
    }

    res.json({
      ok: true,
      exists: true,
      user: { id: user.id, username: user.username },
      hashFormat,
      matches
    });
  } catch (err) {
    logError('[Debug] Verify credentials error', err, {
      dbBackend: db && db.__tmrBackend,
      dbInfo: db && db.__tmrConnectionInfo,
      nodeEnv: process.env.NODE_ENV
    });
    res.status(500).json({ ok: false, error: 'verify_credentials_failed' });
  }
});

app.post('/auth/logout', (req, res) => {
  const token = req.cookies ? req.cookies[SESSION_COOKIE] : null;
  if (token) {
    db.deleteSession(token, () => {});
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/auth/logout-all', requireAuth, (req, res) => {
  db.deleteSessionsByUser(req.user.id, () => {});
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ========== GOOGLE CALENDAR ENDPOINTS ==========

// Get OAuth authorization URL (with CSRF protection)
app.get('/auth/google', requireAuth, (req, res) => {
  if (!googleCalendarManager || !sessionStore) {
    console.error('[GoogleCalendar] Manager not initialized');
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }

  try {
    const userId = String(req.user.id);
    
    // Validate userId
    if (typeof userId !== 'string' || userId.length === 0 || userId.length > 255) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    // Create secure session with CSRF token
    const { sessionId, state } = sessionStore.createSession(userId);

    // Get origin
    let origin = req.get('origin');
    if (!origin) {
      const host = req.get('host');
      const protocol = req.get('X-Forwarded-Proto') || req.protocol;
      origin = `${protocol}://${host}`;
    }

    const redirectUri = `${origin}/auth/google/callback`;
    sessionStore.setRedirectUri(sessionId, redirectUri);

    console.log('[GoogleCalendar] Auth initiated - Session:', sessionId, 'User:', userId);
    console.log('[GoogleCalendar] Origin detected:', origin);
    console.log('[GoogleCalendar] Redirect URI being sent to Google:', redirectUri);
    console.log('[GoogleCalendar] Request headers - origin:', req.get('origin'), 'host:', req.get('host'), 'protocol:', req.protocol, 'x-forwarded-proto:', req.get('X-Forwarded-Proto'));

    // Update OAuth manager with correct redirect URI
    googleCalendarManager.setRedirectUri(redirectUri);
    const authUrl = googleCalendarManager.getAuthUrl(state);

    console.log('[GoogleCalendar] Auth URL generated:', authUrl.substring(0, 100) + '...');

    res.json({ authUrl, sessionId });

  } catch (err) {
    console.error('[GoogleCalendar] Auth error:', err);
    res.status(500).json({ error: 'Failed to generate auth URL', details: err.message });
  }
});

// Google OAuth callback (with CSRF validation)
app.get('/auth/google/callback', async (req, res) => {
  if (!googleCalendarManager || !sessionStore) {
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }

  const { code, state } = req.query;

  console.log('[GoogleCalendar] Callback received');
  console.log('[GoogleCalendar] Callback - code:', code ? code.substring(0, 20) + '...' : 'MISSING');
  console.log('[GoogleCalendar] Callback - state:', state);
  console.log('[GoogleCalendar] Callback - request origin:', req.get('origin'));
  console.log('[GoogleCalendar] Callback - request headers - host:', req.get('host'), 'protocol:', req.protocol, 'x-forwarded-proto:', req.get('X-Forwarded-Proto'));

  if (!code || !state) {
    console.error('[GoogleCalendar] Callback missing code or state');
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  try {
    // Validate session (CSRF protection)
    const session = sessionStore.validateSession(state, state);
    console.log('[GoogleCalendar] Session validation result:', session ? 'VALID' : 'INVALID');
    if (session) {
      console.log('[GoogleCalendar] Session found - userId:', session.userId, 'redirectUri:', session.redirectUri);
    }
    
    if (!session) {
      console.error('[GoogleCalendar] CSRF validation failed - State:', state);
      return res.status(403).json({ error: 'Invalid or expired session - possible CSRF attack' });
    }

    const userId = session.userId;
    const redirectUri = session.redirectUri;

    console.log('[GoogleCalendar] Callback - Exchanging code for user:', userId);

    googleCalendarManager.setRedirectUri(redirectUri);
    const tokens = await googleCalendarManager.exchangeCodeForTokens(code);

    // Save tokens
    googleCalendarManager.saveTokens(userId, tokens, (err) => {
      if (err) {
        console.error('[GoogleCalendar] Failed to save tokens:', err);
        return res.status(500).json({ error: 'Failed to save tokens' });
      }

      console.log('[GoogleCalendar] Tokens saved for user:', userId);

      // Start token refresh monitoring
      if (tokenRefreshManager && tokens.expiry_date) {
        const expiresIn = Math.round((tokens.expiry_date - Date.now()) / 1000);
        tokenRefreshManager.startTokenMonitoring(userId, expiresIn);
      }

      // Clean up session
      sessionStore.getAndDelete(state);

      res.redirect(`/TMR.html?gcal_auth=success`);
    });

  } catch (err) {
    console.error('[GoogleCalendar] Callback error:', err);
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});

// Check if user has Google Calendar connected
app.get('/auth/google/status', requireAuth, (req, res) => {
  if (!googleCalendarManager) {
    console.debug('[GoogleCalendar] Status check: googleCalendarManager not initialized');
    return res.json({ connected: false });
  }
  
  const userId = String(req.user.id);
  db.getGoogleCalendarToken(userId, (err, token) => {
    if (err) {
      console.error('[GoogleCalendar] Status check error for user', userId, ':', err.message);
      return res.json({ connected: false, error: err.message });
    }
    if (!token) {
      console.debug('[GoogleCalendar] Status check: no token found for user', userId);
      return res.json({ connected: false });
    }
    
    // Check if token is still valid (not expired)
    const now = Date.now();
    const isExpired = token.expiresAt && token.expiresAt < now;
    if (isExpired) {
      console.warn('[GoogleCalendar] Token expired for user', userId, '- requires refresh');
      return res.json({ connected: false, reason: 'token_expired' });
    }
    
    console.debug('[GoogleCalendar] Status check: connected for user', userId);
    res.json({ connected: true, userId });
  });
});

// Logout: disconnect user from Google Calendar
app.post('/auth/google/logout', requireAuth, (req, res) => {
  console.log('[GoogleCalendar] Logout request received:', req.body);
  const userId = String(req.user.id);
  
  try {
    let tokenDeleted = false;
    let mappingsDeleted = false;
    
    // Delete the token from database
    db.deleteGoogleCalendarToken(userId, (err) => {
      if (err) {
        console.error('[GoogleCalendar] Failed to delete tokens:', err);
        tokenDeleted = false;
      } else {
        console.log('[GoogleCalendar] Token deleted for user:', userId);
        tokenDeleted = true;
      }
    });
    
    // Delete all event mappings for this user
    db.deleteAllEventMappingsForUser(userId, (err) => {
      if (err) {
        console.error('[GoogleCalendar] Failed to delete event mappings:', err);
        mappingsDeleted = false;
      } else {
        console.log('[GoogleCalendar] Event mappings deleted for user:', userId);
        mappingsDeleted = true;
      }
    });
    
    console.log('[GoogleCalendar] User logged out:', userId);
    res.json({ ok: true, message: 'Logged out successfully', userId });
    
  } catch (err) {
    console.error('[GoogleCalendar] Logout error:', err);
    res.status(500).json({ error: 'Logout failed', details: err.message });
  }
});

// Manual sync endpoint: sync TMR events with Google Calendar
app.post('/sync/google-calendar', requireAuth, async (req, res) => {
  if (!googleCalendarManager) {
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }
  
  const userId = String(req.user.id);
  const events = req.body.events || []; // TMR events to sync
  
  console.log('[GoogleCalendar] Sync requested for user:', userId, 'Events to sync:', events.length);
  
  try {
    let syncedCount = 0;
    const results = [];
    
    // Process events sequentially with proper async/await
    for (const tmrEvent of events) {
      try {
        // Skip events without title or date
        if (!tmrEvent.title || !tmrEvent.date) {
          console.warn('[GoogleCalendar] Skipping event without title or date:', tmrEvent);
          results.push({ tmrId: tmrEvent.id, action: 'skipped', reason: 'Missing title or date' });
          continue;
        }

        // FIRST: Check if this TMR event already has a googleEventId in the database
        const existingMapping = await new Promise((resolve) => {
          db.getEventMapping(tmrEvent.id, (err, mapping) => {
            resolve(mapping);
          });
        });

        if (existingMapping && existingMapping.googleEventId) {
          // Event is already synced, update it
          try {
            const gcEvent = await googleCalendarManager.updateGoogleCalendarEvent(userId, existingMapping.googleEventId, tmrEvent);
            results.push({ tmrId: tmrEvent.id, action: 'updated', googleId: gcEvent.id });
            syncedCount++;
            console.log('[GoogleCalendar] Updated existing synced event:', tmrEvent.id, '->', gcEvent.id);
          } catch (err) {
            console.error('[GoogleCalendar] Update failed:', err.message);
            results.push({ tmrId: tmrEvent.id, action: 'failed', error: 'Update failed: ' + err.message });
          }
          continue;
        }

        // SECOND: Check Google Calendar for existing event (by title + date + time)
        // This catches events that were created in Google Calendar directly
        try {
          const existingEvent = await googleCalendarManager.searchExistingEvent(userId, tmrEvent.title, tmrEvent.date, tmrEvent.time);
          
          if (existingEvent) {
            // Found matching event in Google Calendar, create mapping and skip creation
            console.log('[GoogleCalendar] Event already exists in Google Calendar (found by title+date+time):', existingEvent.id);
            
            await new Promise((resolve) => {
              db.mapEventIds(tmrEvent.id, existingEvent.id, 'primary', userId, (err) => {
                if (err) console.error('[GoogleCalendar] Failed to create mapping:', err);
                resolve();
              });
            });
            
            results.push({ tmrId: tmrEvent.id, action: 'linked', googleId: existingEvent.id });
            syncedCount++;
            continue;
          }
        } catch (searchErr) {
          console.warn('[GoogleCalendar] Search failed:', searchErr.message);
          // Continue anyway - will try to create new event
        }

        // THIRD: No mapping and no existing event found, create new event
        try {
          const gcEvent = await googleCalendarManager.createGoogleCalendarEvent(userId, tmrEvent);
          
          // Map the IDs in the database for future syncs
          await new Promise((resolve) => {
            db.mapEventIds(tmrEvent.id, gcEvent.id, 'primary', userId, (err) => {
              if (err) console.error('[GoogleCalendar] Failed to create mapping:', err);
              resolve();
            });
          });
          
          results.push({ tmrId: tmrEvent.id, action: 'created', googleId: gcEvent.id });
          syncedCount++;
          console.log('[GoogleCalendar] Created new event:', tmrEvent.id, '->', gcEvent.id);
        } catch (createErr) {
          console.error('[GoogleCalendar] Create failed:', createErr.message);
          results.push({ tmrId: tmrEvent.id, action: 'failed', error: 'Create failed: ' + createErr.message });
        }
        
      } catch (eventErr) {
        console.error('[GoogleCalendar] Error processing event:', eventErr.message);
        results.push({ tmrId: tmrEvent.id, action: 'failed', error: eventErr.message });
      }
    }
    
    console.log('[GoogleCalendar] Sync completed. Synced:', syncedCount, '/', events.length);
    res.json({ ok: true, syncedCount, totalEvents: events.length, results });
    
  } catch (err) {
    console.error('[GoogleCalendar] Sync error:', err);
    res.status(500).json({ error: 'Sync failed', details: err.message });
  }
});

// Delete synced event from Google Calendar
app.post('/sync/google-calendar/delete', requireAuth, async (req, res) => {
  console.log('[GoogleCalendar] Delete request received:', req.body);
  
  if (!googleCalendarManager) {
    console.error('[GoogleCalendar] Manager not initialized');
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }
  
  const userId = String(req.user.id);
  const googleEventId = req.body.googleEventId;
  const tmrEventId = req.body.tmrEventId;
  
  if (!googleEventId) {
    console.error('[GoogleCalendar] No googleEventId provided');
    return res.status(400).json({ error: 'googleEventId required' });
  }
  
  try {
    console.log('[GoogleCalendar] Deleting event:', googleEventId, 'for user:', userId);
    
    await googleCalendarManager.deleteGoogleCalendarEvent(userId, googleEventId);
    console.log('[GoogleCalendar] Event deleted from Google Calendar successfully');
    
    // Delete mapping from database
    if (tmrEventId) {
      console.log('[GoogleCalendar] Deleting mapping for tmrEventId:', tmrEventId);
      await new Promise((resolve) => {
        db.deleteEventMapping(tmrEventId, (err) => {
          if (err) {
            console.error('[GoogleCalendar] Failed to delete mapping:', err);
          } else {
            console.log('[GoogleCalendar] Mapping deleted successfully');
          }
          resolve();
        });
      });
    }
    
    console.log('[GoogleCalendar] Event deleted successfully');
    res.json({ ok: true, deleted: googleEventId });
  } catch (err) {
    console.error('[GoogleCalendar] Delete error:', err);
    console.error('[GoogleCalendar] Error message:', err.message);
    console.error('[GoogleCalendar] Error stack:', err.stack);
    res.status(500).json({ error: 'Delete failed', details: err.message });
  }
});

// Fetch Google Calendar events
app.get('/sync/google-calendar/fetch', requireAuth, async (req, res) => {
  if (!googleCalendarManager) {
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }
  
  const userId = String(req.user.id);
  const daysBack = parseInt(req.query.daysBack) || 365; // Get past events
  const daysForward = parseInt(req.query.daysForward) || 365; // Get future events
  
  try {
    const now = new Date();
    const timeMin = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000).toISOString();
    
    console.log('[GoogleCalendar] Fetching events from', timeMin, 'to', timeMax);
    
    const gcalEvents = await googleCalendarManager.fetchGoogleCalendarEvents(userId, timeMin, timeMax);
    
    // Convert to TMR format
    const tmrEvents = gcalEvents.map(gcEvent => {
      const tmrEvent = googleCalendarManager.googleEventToTmrEvent(gcEvent);
      
      // Extract reminders for TMR (TMR-heavy approach)
      const reminders = googleCalendarManager.extractRemindersFromGoogleEvent(gcEvent);
      if (reminders.length > 0) {
        tmrEvent.googleReminders = reminders;
      }
      
      return tmrEvent;
    });
    
    console.log('[GoogleCalendar] Fetched', gcalEvents.length, 'events from Google Calendar');
    res.json({ ok: true, events: tmrEvents, count: tmrEvents.length });
  } catch (err) {
    console.error('[GoogleCalendar] Fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch events', details: err.message });
  }
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

// AI Assistants: prefer Claude if configured, otherwise fall back to Groq
const GroqAssistant = require('./groq-assistant');
const ClaudeAssistant = require('./claude-assistant');
let groqAssistant = null;
let claudeAssistant = null;

try {
  if (process.env.ANTHROPIC_API_KEY) {
    claudeAssistant = new ClaudeAssistant(process.env.ANTHROPIC_API_KEY, process.env.CLAUDE_MODEL);
    console.log('[Meibot] Claude assistant initialized');
  }
} catch (err) {
  console.warn('[Meibot] Claude initialization failed:', err.message);
}

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
  const assistant = claudeAssistant || groqAssistant;
  if (!assistant) {
    return res.status(503).json({ error: 'AI assistant not initialized. Set ANTHROPIC_API_KEY or GROQ_API_KEY in environment.' });
  }

  const { message, context, userId } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'message required' });
  }
  
  if (typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message must be non-empty string' });
  }
  
  if (message.length > 5000) {
    return res.status(400).json({ error: 'message too long (max 5000 characters)' });
  }

  try {
    console.log('[Meibot] Processing message from user:', userId || 'anonymous', 'Length:', message.length);

    const response = await assistant.chat(message.trim(), context || '', userId || 'anonymous', req.body && req.body.timezone);
    
    // Validate response structure
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from Groq API');
    }
    
    console.log('[Meibot] Response action:', response.suggestedAction);
    res.json(response);
    
  } catch (err) {
    console.error('[Meibot] Error:', err.message);
    
    // Differentiate between API errors and other errors
    if (err.status === 401 || err.status === 403) {
      return res.status(401).json({ 
        error: 'Authentication failed with AI provider',
        details: 'Check ANTHROPIC_API_KEY or GROQ_API_KEY' 
      });
    }
    
    if (err.status === 429) {
      return res.status(429).json({ 
        error: 'Rate limited - try again later',
        details: 'AI API rate limit exceeded' 
      });
    }
    
    res.status(500).json({ 
      error: 'Meibot error', 
      details: err.message 
    });
  }
});

// Theme endpoints
app.post('/theme/save', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const theme = req.body.theme || {};
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    db.saveUserTheme(userId, theme, (err) => {
      if (err) {
        console.error('[Theme] Save error:', err);
        return res.status(500).json({ error: 'Failed to save theme' });
      }
      console.log('[Theme] Saved for user:', userId);
      res.json({ success: true, userId });
    });
  } catch (err) {
    console.error('[Theme] Save error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/theme/load', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    
    db.getUserTheme(userId, (err, theme) => {
      if (err) {
        console.error('[Theme] Load error:', err);
        return res.status(500).json({ error: 'Failed to load theme' });
      }
      console.log('[Theme] Loaded for user:', userId);
      res.json({ 
        theme: theme || {
          accentColor: '#6366f1',
          backgroundImage: null,
          animation: 'none',
          animationSpeed: 1,
          animationIntensity: 1
        }
      });
    });
  } catch (err) {
    console.error('[Theme] Load error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/theme/delete', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    
    db.deleteUserTheme(userId, (err) => {
      if (err) {
        console.error('[Theme] Delete error:', err);
        return res.status(500).json({ error: 'Failed to delete theme' });
      }
      console.log('[Theme] Deleted for user:', userId);
      res.json({ success: true });
    });
  } catch (err) {
    console.error('[Theme] Delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Notes API endpoints
app.post('/notes/category/create', requireAuth, (req, res) => {
  try {
    const { categoryName } = req.body;
    
    if (!categoryName) {
      return res.status(400).json({ error: 'categoryName required' });
    }
    
    db.createNoteCategory(req.user.id, categoryName, (err, categoryId) => {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(409).json({ error: 'Category already exists' });
        }
        console.error('[Notes] Category creation error:', err);
        return res.status(500).json({ error: 'Failed to create category' });
      }
      console.log('[Notes] Category created:', categoryId);
      res.json({ success: true, categoryId });
    });
  } catch (err) {
    console.error('[Notes] Category creation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/notes/category/:categoryId', requireAuth, (req, res) => {
  try {
    const { categoryId } = req.params;
    const { categoryName } = req.body;
    
    if (!categoryName) {
      return res.status(400).json({ error: 'categoryName required' });
    }
    
    db.updateNoteCategory(categoryId, req.user.id, categoryName, (err) => {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(409).json({ error: 'Category name already exists' });
        }
        console.error('[Notes] Category update error:', err);
        return res.status(500).json({ error: 'Failed to update category' });
      }
      console.log('[Notes] Category updated:', categoryId);
      res.json({ success: true });
    });
  } catch (err) {
    console.error('[Notes] Category update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/notes/categories', requireAuth, (req, res) => {
  try {
    db.getNoteCategories(req.user.id, (err, categories) => {
      if (err) {
        console.error('[Notes] Get categories error:', err);
        return res.status(500).json({ error: 'Failed to get categories' });
      }
      res.json({ categories });
    });
  } catch (err) {
    console.error('[Notes] Get categories error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/notes/category/:categoryId', requireAuth, (req, res) => {
  try {
    const { categoryId } = req.params;
    
    db.deleteNoteCategory(categoryId, req.user.id, (err, changes) => {
      if (err) {
        console.error('[Notes] Category delete error:', err);
        return res.status(500).json({ error: 'Failed to delete category' });
      }
      console.log('[Notes] Category deleted:', categoryId);
      res.json({ success: true });
    });
  } catch (err) {
    console.error('[Notes] Category delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/notes/create', requireAuth, (req, res) => {
  try {
    const { categoryId, title, content } = req.body;
    
    if (!categoryId || !title) {
      return res.status(400).json({ error: 'categoryId and title required' });
    }
    
    db.createNote(req.user.id, categoryId, title, content || '', (err, noteId) => {
      if (err) {
        console.error('[Notes] Note creation error:', err);
        return res.status(500).json({ error: 'Failed to create note' });
      }
      console.log('[Notes] Note created:', noteId);
      res.json({ success: true, noteId });
    });
  } catch (err) {
    console.error('[Notes] Note creation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/notes/category/:categoryId', requireAuth, (req, res) => {
  try {
    const { categoryId } = req.params;
    
    db.getNotesInCategory(categoryId, req.user.id, (err, notes) => {
      if (err) {
        console.error('[Notes] Get notes error:', err);
        return res.status(500).json({ error: 'Failed to get notes' });
      }
      res.json({ notes });
    });
  } catch (err) {
    console.error('[Notes] Get notes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/notes/:noteId', requireAuth, (req, res) => {
  try {
    const { noteId } = req.params;
    
    db.getNote(noteId, req.user.id, (err, note) => {
      if (err) {
        console.error('[Notes] Get note error:', err);
        return res.status(500).json({ error: 'Failed to get note' });
      }
      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }
      res.json({ note });
    });
  } catch (err) {
    console.error('[Notes] Get note error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/notes/:noteId', requireAuth, (req, res) => {
  try {
    const { noteId } = req.params;
    const { title, content } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'title required' });
    }
    
    db.updateNote(noteId, req.user.id, title, content || '', (err) => {
      if (err) {
        console.error('[Notes] Note update error:', err);
        return res.status(500).json({ error: 'Failed to update note' });
      }
      console.log('[Notes] Note updated:', noteId);
      res.json({ success: true });
    });
  } catch (err) {
    console.error('[Notes] Note update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/notes/:noteId', requireAuth, (req, res) => {
  try {
    const { noteId } = req.params;
    
    db.deleteNote(noteId, req.user.id, (err, changes) => {
      if (err) {
        console.error('[Notes] Note delete error:', err);
        return res.status(500).json({ error: 'Failed to delete note' });
      }
      console.log('[Notes] Note deleted:', noteId);
      res.json({ success: true });
    });
  } catch (err) {
    console.error('[Notes] Note delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/notes/search', requireAuth, (req, res) => {
  try {
    const { query, categoryId } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'query required' });
    }
    
    db.searchNotes(req.user.id, query, categoryId || null, (err, notes) => {
      if (err) {
        console.error('[Notes] Search error:', err);
        return res.status(500).json({ error: 'Failed to search notes' });
      }
      res.json({ notes });
    });
  } catch (err) {
    console.error('[Notes] Search error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/notes/tasks/extract', requireAuth, (req, res) => {
  try {
    const { noteId, content } = req.body;
    
    if (!noteId || !content) {
      return res.status(400).json({ error: 'noteId and content required' });
    }
    
    // Extract checkbox items from content
    const checkboxPattern = /☐\s+(.+?)(?:\n|$)/g;
    const matches = [];
    let match;
    
    while ((match = checkboxPattern.exec(content)) !== null) {
      matches.push(match[1].trim());
    }
    
    res.json({ tasks: matches });
  } catch (err) {
    console.error('[Notes] Task extraction error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/notes/tasks/confirm', requireAuth, (req, res) => {
  try {
    const { noteId, tasks } = req.body;
    
    if (!noteId || !Array.isArray(tasks)) {
      return res.status(400).json({ error: 'noteId and tasks array required' });
    }
    
    let completed = 0;
    let errors = [];
    
    tasks.forEach((task, index) => {
      db.addNoteTask(req.user.id, noteId, task, (err) => {
        if (err) {
          errors.push({ index, error: err.message });
        } else {
          completed++;
        }
        
        if (index === tasks.length - 1) {
          res.json({ success: true, completed, errors: errors.length > 0 ? errors : null });
        }
      });
    });
    
    if (tasks.length === 0) {
      res.json({ success: true, completed: 0 });
    }
  } catch (err) {
    console.error('[Notes] Task confirmation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== EVENTS ENDPOINTS ==========

app.post('/events/create', requireAuth, (req, res) => {
  try {
    const { event } = req.body;
    if (!event || !event.title || !event.date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    db.createEvent(req.user.id, event, (err, eventId) => {
      if (err) {
        console.error('[Events] Create error:', err);
        return res.status(500).json({ error: 'Failed to create event' });
      }

      // Best-effort push reminder scheduling for events with a start time.
      try { scheduleEventReminderForUser(req.user.id, event, eventId); } catch (_) {}
      res.json({ ok: true, eventId });
    });
  } catch (err) {
    console.error('[Events] Create error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/events', requireAuth, (req, res) => {
  try {
    db.getEventsByUserId(req.user.id, (err, events) => {
      if (err) {
        console.error('[Events] Get error:', err);
        return res.status(500).json({ error: 'Failed to get events' });
      }
      res.json({ events });
    });
  } catch (err) {
    console.error('[Events] Get error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/events/:eventId', requireAuth, (req, res) => {
  try {
    const { eventId } = req.params;
    const { event } = req.body;

    db.getEventById(eventId, (err, existing) => {
      if (err) return res.status(500).json({ error: 'Failed to load event' });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (String(existing.userId) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });

      db.updateEvent(eventId, event, (err2, changes) => {
        if (err2) {
          console.error('[Events] Update error:', err2);
          return res.status(500).json({ error: 'Failed to update event' });
        }

        // Best-effort: schedule a reminder based on updated event fields.
        try { scheduleEventReminderForUser(req.user.id, event, eventId); } catch (_) {}
        res.json({ ok: true, changes });
      });
    });
  } catch (err) {
    console.error('[Events] Update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/events/:eventId', requireAuth, (req, res) => {
  try {
    const { eventId } = req.params;

    db.getEventById(eventId, (err, existing) => {
      if (err) return res.status(500).json({ error: 'Failed to load event' });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (String(existing.userId) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });

      db.deleteEvent(eventId, (err2, changes) => {
        if (err2) {
          console.error('[Events] Delete error:', err2);
          return res.status(500).json({ error: 'Failed to delete event' });
        }
        res.json({ ok: true, changes });
      });
    });
  } catch (err) {
    console.error('[Events] Delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== TODOS ENDPOINTS ==========

app.post('/todos/create', requireAuth, (req, res) => {
  try {
    const { todo } = req.body;
    if (todo && !todo.text && todo.title) {
      // Back-compat for older clients that used `title`.
      todo.text = todo.title;
    }
    if (!todo || !todo.text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    db.createTodo(req.user.id, todo, (err, todoId) => {
      if (err) {
        console.error('[Todos] Create error:', err);
        return res.status(500).json({ error: 'Failed to create todo' });
      }
      res.json({ ok: true, todoId });
    });
  } catch (err) {
    console.error('[Todos] Create error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/todos', requireAuth, (req, res) => {
  try {
    db.getTodosByUserId(req.user.id, (err, todos) => {
      if (err) {
        console.error('[Todos] Get error:', err);
        return res.status(500).json({ error: 'Failed to get todos' });
      }
      res.json({ todos });
    });
  } catch (err) {
    console.error('[Todos] Get error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/todos/:todoId', requireAuth, (req, res) => {
  try {
    const { todoId } = req.params;
    const { todo } = req.body;

    if (todo && !todo.text && todo.title) {
      todo.text = todo.title;
    }
    if (!todo || !todo.text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    db.getTodoById(todoId, (err, existing) => {
      if (err) return res.status(500).json({ error: 'Failed to load todo' });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (String(existing.userId) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });

      db.updateTodo(todoId, todo, (err2, changes) => {
        if (err2) {
          console.error('[Todos] Update error:', err2);
          return res.status(500).json({ error: 'Failed to update todo' });
        }
        res.json({ ok: true, changes });
      });
    });
  } catch (err) {
    console.error('[Todos] Update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/todos/:todoId', requireAuth, (req, res) => {
  try {
    const { todoId } = req.params;

    db.getTodoById(todoId, (err, existing) => {
      if (err) return res.status(500).json({ error: 'Failed to load todo' });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (String(existing.userId) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });

      db.deleteTodo(todoId, (err2, changes) => {
        if (err2) {
          console.error('[Todos] Delete error:', err2);
          return res.status(500).json({ error: 'Failed to delete todo' });
        }
        res.json({ ok: true, changes });
      });
    });
  } catch (err) {
    console.error('[Todos] Delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

const port = process.env.PORT || process.env.PUSH_SERVER_PORT || 3002;
app.listen(port, () => console.log('[Server] TMR push server listening on port', port));
