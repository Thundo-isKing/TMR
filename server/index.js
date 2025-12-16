require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const express = require('express');
const webpush = require('web-push');
const db = require('./db');

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

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  googleCalendarManager = new GoogleCalendarManager(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    db
  );
  console.log('[GoogleCalendar] Manager initialized with OAuth credentials');
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
  if(!subscription) return res.status(400).json({ error: 'missing subscription' });
  // Deduplicate: try to avoid storing the same subscription endpoint twice
  try{
    const endpoint = (subscription && subscription.endpoint) ? subscription.endpoint : null;
    if(endpoint){
      db.getAllSubscriptions((err, subs) => {
        if(err) return res.status(500).json({ error: 'db error' });
        const exists = (subs || []).find(s => (s.subscription && s.subscription.endpoint ? s.subscription.endpoint : (JSON.parse(s.subscription || '{}').endpoint)) === endpoint);
        if(exists) return res.json({ ok: true, id: exists.id, note: 'already_exists' });
        // not found -> insert
        db.addSubscription(userId || null, subscription, (err2, id) => {
          if(err2) return res.status(500).json({ error: 'db error' });
          res.json({ ok: true, id });
        });
      });
    } else {
      // Fallback: just add
      db.addSubscription(userId || null, subscription, (err, id) => {
        if(err) return res.status(500).json({ error: 'db error' });
        res.json({ ok: true, id });
      });
    }
  }catch(e){
    // On error, attempt add as last resort
    db.addSubscription(userId || null, subscription, (err, id) => {
      if(err) return res.status(500).json({ error: 'db error' });
      res.json({ ok: true, id });
    });
  }
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
  const { userId, title, body, deliverAt } = req.body;
  const now = Date.now();
  const deliverAtNum = Number(deliverAt);
  const delayMs = deliverAtNum - now;
  const delaySecs = Math.round(delayMs / 1000);
  console.log('[Reminder] POST received:', { title, body, deliverAt: deliverAtNum });
  console.log('[Reminder] Current time:', now, 'Deliver at:', deliverAtNum, 'Delay:', delaySecs, 'seconds');
  if(!deliverAt) return res.status(400).json({ error: 'deliverAt required (epoch ms)' });
  db.addReminder(userId || null, title || '', body || '', deliverAtNum, (err, id) => {
    if(err) return res.status(500).json({ error: 'db error' });
    console.log('[Reminder] Added reminder:', id, 'delivering at:', new Date(deliverAtNum), '(in', delaySecs, 'seconds)');
    res.json({ ok: true, id });
  });
});

// ========== GOOGLE CALENDAR ENDPOINTS ==========

// Get OAuth authorization URL
app.get('/auth/google', (req, res) => {
  if (!googleCalendarManager) {
    console.error('[GoogleCalendar] Manager not initialized - missing OAuth credentials in .env');
    return res.status(503).json({ error: 'Google Calendar not configured - missing credentials' });
  }
  
  try {
    const state = 'state_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const userId = req.query.userId || 'default';
    
    // Store state temporarily (in production, use a proper session store)
    process.env.OAUTH_STATE = state;
    process.env.OAUTH_USER_ID = userId;
    
    const authUrl = googleCalendarManager.getAuthUrl(state);
    console.log('[GoogleCalendar] Generated auth URL for user:', userId);
    res.json({ authUrl });
  } catch (err) {
    console.error('[GoogleCalendar] Failed to generate auth URL:', err);
    res.status(500).json({ error: 'Failed to generate authorization URL', details: err.message });
  }
});

// Google OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  if (!googleCalendarManager) {
    return res.status(503).json({ error: 'Google Calendar not configured' });
  }
  
  const { code, state } = req.query;
  const userId = process.env.OAUTH_USER_ID || 'default';
  
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }
  
  try {
    const tokens = await googleCalendarManager.exchangeCodeForTokens(code);
    googleCalendarManager.saveTokens(userId, tokens, (err) => {
      if (err) {
        console.error('[GoogleCalendar] Failed to save tokens:', err);
        return res.status(500).json({ error: 'Failed to save tokens' });
      }
      
      // Redirect back to client with success message
      res.redirect(`/TMR.html?gcal_auth=success&userId=${encodeURIComponent(userId)}`);
    });
  } catch (err) {
    console.error('[GoogleCalendar] OAuth callback error:', err);
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
    
    // Fetch existing Google Calendar events to check for duplicates
    let googleCalendarEvents = [];
    try {
      const calendarId = await googleCalendarManager.getPrimaryCalendarId(userId);
      const response = await googleCalendarManager.oauth2Client.getAccessToken();
      // We'll build a map of existing Google Calendar events for deduplication
    } catch (e) {
      console.warn('[GoogleCalendar] Could not fetch existing events for dedup:', e.message);
    }

    // Process events sequentially with proper async/await
    for (const tmrEvent of events) {
      try {
        // If TMR event already has a googleEventId, use it directly (faster)
        if (tmrEvent.googleEventId) {
          try {
            const gcEvent = await googleCalendarManager.updateGoogleCalendarEvent(userId, tmrEvent.googleEventId, tmrEvent);
            results.push({ tmrId: tmrEvent.id, action: 'updated', googleId: gcEvent.id });
            syncedCount++;
            console.log('[GoogleCalendar] Updated event with known ID:', tmrEvent.id, '->', gcEvent.id);
          } catch (err) {
            console.error('[GoogleCalendar] Update with known ID failed:', err.message);
            // If update fails, try the database mapping
            const mapping = await new Promise((resolve) => {
              db.getEventMapping(tmrEvent.id, (err, mapping) => {
                resolve(mapping);
              });
            });
            
            if (mapping && mapping.googleEventId) {
              try {
                const gcEvent = await googleCalendarManager.updateGoogleCalendarEvent(userId, mapping.googleEventId, tmrEvent);
                results.push({ tmrId: tmrEvent.id, action: 'updated', googleId: gcEvent.id });
                syncedCount++;
              } catch (e2) {
                console.error('[GoogleCalendar] Update with mapped ID failed:', e2.message);
                results.push({ tmrId: tmrEvent.id, action: 'failed', error: 'Update failed: ' + e2.message });
              }
            } else {
              results.push({ tmrId: tmrEvent.id, action: 'failed', error: 'Update failed: ' + err.message });
            }
          }
          continue;
        }
        
        // Check if event already exists in our mapping
        const mapping = await new Promise((resolve) => {
          db.getEventMapping(tmrEvent.id, (err, mapping) => {
            resolve(mapping);
          });
        });

        if (mapping && mapping.googleEventId) {
          // Update existing event in Google Calendar
          try {
            const gcEvent = await googleCalendarManager.updateGoogleCalendarEvent(userId, mapping.googleEventId, tmrEvent);
            results.push({ tmrId: tmrEvent.id, action: 'updated', googleId: gcEvent.id });
            syncedCount++;
            console.log('[GoogleCalendar] Updated event:', tmrEvent.id, '->', gcEvent.id);
          } catch (err) {
            console.error('[GoogleCalendar] Update failed:', err.message);
            results.push({ tmrId: tmrEvent.id, action: 'failed', error: 'Update failed: ' + err.message });
          }
        } else {
          // Create new event in Google Calendar
          // First, check if an event with the same title and date already exists (duplicate prevention)
          try {
            const existingEvent = await googleCalendarManager.searchExistingEvent(userId, tmrEvent.title, tmrEvent.date, tmrEvent.time);
            
            if (existingEvent) {
              // Event already exists in Google Calendar, just create the mapping
              console.log('[GoogleCalendar] Event already exists in Google Calendar:', existingEvent.id);
              await new Promise((resolve) => {
                db.mapEventIds(tmrEvent.id, existingEvent.id, 'primary', userId, (err) => {
                  if (err) console.error('[GoogleCalendar] Mapping failed:', err);
                  resolve();
                });
              });
              results.push({ tmrId: tmrEvent.id, action: 'linked', googleId: existingEvent.id });
            } else {
              // Event doesn't exist, create it
              const gcEvent = await googleCalendarManager.createGoogleCalendarEvent(userId, tmrEvent);
              
              // Map the IDs in the database
              await new Promise((resolve) => {
                db.mapEventIds(tmrEvent.id, gcEvent.id, 'primary', userId, (err) => {
                  if (err) console.error('[GoogleCalendar] Mapping failed:', err);
                  resolve();
                });
              });
              
              results.push({ tmrId: tmrEvent.id, action: 'created', googleId: gcEvent.id });
              syncedCount++;
              console.log('[GoogleCalendar] Created event:', tmrEvent.id, '->', gcEvent.id);
            }
          } catch (err) {
            console.error('[GoogleCalendar] Create failed:', err.message);
            results.push({ tmrId: tmrEvent.id, action: 'failed', error: 'Create failed: ' + err.message });
          }
        }
      } catch (err) {
        console.error('[GoogleCalendar] Event sync error:', err);
        results.push({ tmrId: tmrEvent.id, action: 'failed', error: err.message });
      }
    }
    
    // Log sync attempt
    db.logSync(userId, 'manual', 'completed', syncedCount, null, (err) => {
      if (err) console.warn('[GoogleCalendar] Failed to log sync:', err);
    });
    
    res.json({ ok: true, synced: syncedCount, results });
  } catch (err) {
    console.error('[GoogleCalendar] Sync error:', err);
    db.logSync(userId, 'manual', 'failed', 0, err.message, (err) => {
      if (err) console.warn('[GoogleCalendar] Failed to log sync error:', err);
    });
    res.status(500).json({ error: 'Sync failed', details: err.message });
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
    return res.status(503).json({ error: 'Groq assistant not initialized. Set GROQ_API_KEY in .env' });
  }

  const { message, context, consent, userId } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  try {
    console.log('[Meibot] Received:', message.substring(0, 50));
    const response = await groqAssistant.chat(message, context || '', userId || 'default');
    console.log('[Meibot] Responding with action:', response.suggestedAction);
    if (response.actionData) {
      console.log('[Meibot] Action data:', JSON.stringify(response.actionData));
    }
    res.json(response);
  } catch (err) {
    console.error('[Meibot] Error:', err);
    console.error('[Meibot] Error message:', err.message);
    console.error('[Meibot] Error status:', err.status);
    res.status(500).json({ error: 'Meibot error', details: err.message });
  }
});

const port = process.env.PUSH_SERVER_PORT || 3002;
app.listen(port, () => console.log('TMR push server listening on port', port));
