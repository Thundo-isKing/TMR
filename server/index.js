require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const express = require('express');
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
  
  if (!subscription) {
    return res.status(400).json({ error: 'missing subscription' });
  }
  
  if (!subscription.endpoint) {
    return res.status(400).json({ error: 'subscription.endpoint required' });
  }

  db.addSubscription(userId || null, subscription, (err, id) => {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        // Duplicate subscription - silently accept
        console.log('[Subscribe] Duplicate subscription ignored');
        return res.json({ ok: true, id, note: 'duplicate_ignored' });
      }
      console.error('[Subscribe] Error:', err.message);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }
    console.log('[Subscribe] Subscription added:', id, 'userId:', userId);
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
  
  if (!subscriptionId) {
    return res.status(400).json({ error: 'subscriptionId required' });
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
  console.log('[Reminder] POST received:', { subscriptionId, userId, title, body, deliverAt: deliverAtNum, delaySecs });
  
  db.addReminder(subscriptionId, userId || null, title || '', body || '', deliverAtNum, (err, id) => {
    if (err) {
      console.error('[Reminder] Error:', err.message);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }
    console.log('[Reminder] Added:', id, '- delivering in', delaySecs, 'seconds to subscriptionId:', subscriptionId);
    res.json({ ok: true, id, deliversIn: delaySecs });
  });
});

// ========== GOOGLE CALENDAR ENDPOINTS ==========

// Get OAuth authorization URL (with CSRF protection)
app.get('/auth/google', (req, res) => {
  if (!googleCalendarManager || !sessionStore) {
    console.error('[GoogleCalendar] Manager not initialized');
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }

  try {
    const userId = req.query.userId || 'default';
    
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

    // Update OAuth manager with correct redirect URI
    googleCalendarManager.setRedirectUri(redirectUri);
    const authUrl = googleCalendarManager.getAuthUrl(state);

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

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  try {
    // Validate session (CSRF protection)
    const session = sessionStore.validateSession(state, state);
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

      res.redirect(`/TMR.html?gcal_auth=success&userId=${encodeURIComponent(userId)}`);
    });

  } catch (err) {
    console.error('[GoogleCalendar] Callback error:', err);
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});

// Check if user has Google Calendar connected
app.get('/auth/google/status', (req, res) => {
  if (!googleCalendarManager) {
    return res.json({ connected: false });
  }
  
  const userId = req.query.userId || 'default';
  db.getGoogleCalendarToken(userId, (err, token) => {
    if (err || !token) {
      return res.json({ connected: false });
    }
    res.json({ connected: true, userId });
  });
});

// Logout: disconnect user from Google Calendar
app.post('/auth/google/logout', (req, res) => {
  console.log('[GoogleCalendar] Logout request received:', req.body);
  const userId = req.body.userId || 'default';
  
  if (!userId) {
    console.error('[GoogleCalendar] No userId provided');
    return res.status(400).json({ error: 'No userId provided' });
  }
  
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
app.post('/sync/google-calendar', async (req, res) => {
  if (!googleCalendarManager) {
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }
  
  const userId = req.body.userId || 'default';
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
app.post('/sync/google-calendar/delete', async (req, res) => {
  console.log('[GoogleCalendar] Delete request received:', req.body);
  
  if (!googleCalendarManager) {
    console.error('[GoogleCalendar] Manager not initialized');
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }
  
  const userId = req.body.userId || 'default';
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
app.get('/sync/google-calendar/fetch', async (req, res) => {
  if (!googleCalendarManager) {
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }
  
  const userId = req.query.userId || 'default';
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
    return res.status(503).json({ error: 'Groq assistant not initialized. Set GROQ_API_KEY in environment.' });
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
    
    const response = await groqAssistant.chat(message.trim(), context || '', userId || 'anonymous');
    
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
        error: 'Authentication failed with Groq API',
        details: 'Check GROQ_API_KEY' 
      });
    }
    
    if (err.status === 429) {
      return res.status(429).json({ 
        error: 'Rate limited - try again later',
        details: 'Groq API rate limit exceeded' 
      });
    }
    
    res.status(500).json({ 
      error: 'Meibot error', 
      details: err.message 
    });
  }
});

const port = process.env.PORT || process.env.PUSH_SERVER_PORT || 3002;
app.listen(port, () => console.log('[Server] TMR push server listening on port', port));
