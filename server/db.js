const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const dbPath = path.join(__dirname, 'tmr_server.db');

if(!fs.existsSync(dbPath)){
  // ensure dir exists (should exist)
  fs.writeFileSync(dbPath, '');
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[Database] Connection error:', err);
  } else {
    console.log('[Database] Connected to:', dbPath);
  }
});

// Add transaction support
const runTransaction = (callback) => {
  db.serialize(() => {
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) {
        console.error('[Database] Transaction BEGIN failed:', err);
        return callback(err);
      }
      callback((transactionErr) => {
        if (transactionErr) {
          console.error('[Database] Transaction error, rolling back:', transactionErr.message);
          db.run('ROLLBACK', (rollbackErr) => {
            callback(rollbackErr || transactionErr);
          });
        } else {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              console.error('[Database] Transaction COMMIT failed:', commitErr);
            }
            callback(commitErr);
          });
        }
      });
    });
  });
};

// Initialize tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    subscription TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,    subscriptionId INTEGER,    userId TEXT,
    title TEXT,
    body TEXT,
    deliverAt INTEGER,
    deliveredAt INTEGER,
    createdAt INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS google_calendar_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT UNIQUE NOT NULL,
    accessToken TEXT NOT NULL,
    refreshToken TEXT,
    expiresAt INTEGER,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS event_sync_mapping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tmrEventId TEXT UNIQUE,
    googleEventId TEXT,
    googleCalendarId TEXT,
    userId TEXT,
    lastSyncedAt INTEGER,
    createdAt INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    syncType TEXT,
    status TEXT,
    eventCount INTEGER,
    errorMessage TEXT,
    timestamp INTEGER NOT NULL
  )`);
});

module.exports = {
  runTransaction: runTransaction,
  
  addSubscription: function(userId, subscription, cb){
    if (!subscription || !subscription.endpoint) {
      console.error('[Database] Invalid subscription - missing endpoint');
      return cb && cb(new Error('Invalid subscription'));
    }

    const now = Date.now();
    const subJson = JSON.stringify(subscription);
    
    // Check for duplicate to prevent race conditions
    runTransaction((txDone) => {
      db.get(
        `SELECT id FROM subscriptions WHERE subscription = ?`,
        [subJson],
        (err, row) => {
          if (err) return txDone(err);
          
          if (row) {
            console.log('[Database] Subscription already exists, skipping duplicate');
            return txDone(null); // Already exists
          }
          
          db.run(
            `INSERT INTO subscriptions (userId, subscription, createdAt) VALUES (?,?,?)`,
            [userId || null, subJson, now],
            function(err) {
              if (err) return txDone(err);
              console.log('[Database] Subscription added:', this.lastID);
              if (cb) cb(null, this.lastID);
              txDone(null);
            }
          );
        }
      );
    });
  },
  getSubscriptionsByUserId: function(userId, cb){
    db.all(`SELECT id, subscription, createdAt FROM subscriptions WHERE userId = ?`, [userId], (err, rows) => {
      if(err) return cb(err);
      const subs = (rows||[]).map(r => ({ id: r.id, subscription: JSON.parse(r.subscription), createdAt: r.createdAt }));
      cb(null, subs);
    });
  },
  getAllSubscriptions: function(cb){
    db.all(`SELECT id, subscription, createdAt FROM subscriptions`, [], (err, rows) => {
      if(err) return cb(err);
      const subs = (rows||[]).map(r => ({ id: r.id, subscription: JSON.parse(r.subscription), createdAt: r.createdAt }));
      cb(null, subs);
    });
  },
  addReminder: function(subscriptionId, userId, title, body, deliverAtMs, cb){
    // Validate input
    if (!deliverAtMs) {
      console.error('[Database] Invalid reminder - missing deliverAt');
      return cb && cb(new Error('deliverAt required'));
    }

    if (typeof deliverAtMs !== 'number') {
      console.error('[Database] Invalid reminder - deliverAt must be number');
      return cb && cb(new Error('deliverAt must be number'));
    }

    const now = Date.now();
    
    // Warn if time is in the past
    if (deliverAtMs < now - 60000) {
      console.warn('[Database] Reminder scheduled for past time:', new Date(deliverAtMs));
    }

    db.run(
      `INSERT INTO reminders (subscriptionId, userId, title, body, deliverAt, deliveredAt, createdAt) VALUES (?,?,?,?,?,?,?)`,
      [subscriptionId || null, userId || null, title || '', body || '', deliverAtMs, null, now],
      function(err) {
        if (err) {
          console.error('[Database] Failed to add reminder:', err);
          return cb && cb(err);
        }
        console.log('[Database] Reminder added:', this.lastID, 'for subscriptionId:', subscriptionId, 'deliverAt:', new Date(deliverAtMs));
        if (cb) cb(null, this.lastID);
      }
    );
  },
  getDueReminders: function(nowMs, cb){
    db.all(`SELECT id, subscriptionId, userId, title, body, deliverAt FROM reminders WHERE deliveredAt IS NULL AND deliverAt IS NOT NULL AND deliverAt <= ?`, [nowMs], (err, rows) => {
      if(err) return cb(err);
      cb(null, rows || []);
    });
  },
  getSubscriptionById: function(subscriptionId, cb){
    db.get(`SELECT id, subscription, createdAt FROM subscriptions WHERE id = ?`, [subscriptionId], (err, row) => {
      if(err) return cb(err);
      if(!row) return cb(null, null);
      try {
        const sub = { id: row.id, subscription: JSON.parse(row.subscription), createdAt: row.createdAt };
        cb(null, sub);
      } catch(parseErr) {
        console.error('[Database] Error parsing subscription JSON:', parseErr);
        cb(parseErr);
      }
    });
  },
  markDelivered: function(reminderId, cb){
    const now = Date.now();
    db.run(`UPDATE reminders SET deliveredAt = ? WHERE id = ?`, [now, reminderId], function(err){ if(cb) cb(err); });
  }
  ,
  // Return all reminders (optionally filter by pending/delivered)
  getAllReminders: function(cb){
    db.all(`SELECT id, userId, title, body, deliverAt, deliveredAt, createdAt FROM reminders ORDER BY createdAt DESC`, [], (err, rows) => {
      if(err) return cb(err);
      cb(null, rows || []);
    });
  },
  getPendingReminders: function(cb){
    db.all(`SELECT id, userId, title, body, deliverAt, createdAt FROM reminders WHERE deliveredAt IS NULL AND deliverAt IS NOT NULL ORDER BY deliverAt ASC`, [], (err, rows) => {
      if(err) return cb(err);
      cb(null, rows || []);
    });
  }
  ,
  // Remove a subscription by its numeric id
  removeSubscriptionById: function(id, cb){
    db.run(`DELETE FROM subscriptions WHERE id = ?`, [id], function(err){ if(cb) cb(err, this && this.changes); });
  },
  // Remove subscription(s) by endpoint string (partial match allowed)
  removeSubscriptionByEndpoint: function(endpoint, cb){
    // store subscriptions as JSON; match by JSON LIKE
    db.run(`DELETE FROM subscriptions WHERE subscription LIKE ?`, ['%"' + endpoint.replace(/%/g,'') + '%'], function(err){ if(cb) cb(err, this && this.changes); });
  },

  // Google Calendar token management
  saveGoogleCalendarToken: function(userId, accessToken, refreshToken, expiresAt, cb){
    const now = Date.now();
    db.run(`INSERT OR REPLACE INTO google_calendar_tokens (userId, accessToken, refreshToken, expiresAt, createdAt, updatedAt) 
            VALUES (?, ?, ?, ?, ?, ?)`, 
           [userId, accessToken, refreshToken, expiresAt, now, now], 
           function(err){ if(cb) cb(err, this && this.lastID); });
  },

  getGoogleCalendarToken: function(userId, cb){
    db.get(`SELECT userId, accessToken, refreshToken, expiresAt, updatedAt FROM google_calendar_tokens WHERE userId = ?`, 
           [userId], 
           (err, row) => { if(cb) cb(err, row || null); });
  },

  deleteGoogleCalendarToken: function(userId, cb){
    db.run(`DELETE FROM google_calendar_tokens WHERE userId = ?`, 
           [userId], 
           function(err){ if(cb) cb(err, this && this.changes); });
  },

  // Event sync mapping
  mapEventIds: function(tmrEventId, googleEventId, googleCalendarId, userId, cb){
    db.run(`INSERT OR REPLACE INTO event_sync_mapping (tmrEventId, googleEventId, googleCalendarId, userId, lastSyncedAt, createdAt) 
            VALUES (?, ?, ?, ?, ?, ?)`, 
           [tmrEventId, googleEventId, googleCalendarId, userId, Date.now(), Date.now()], 
           function(err){ if(cb) cb(err); });
  },

  getEventMapping: function(tmrEventId, cb){
    db.get(`SELECT tmrEventId, googleEventId, googleCalendarId, userId FROM event_sync_mapping WHERE tmrEventId = ?`, 
           [tmrEventId], 
           (err, row) => { if(cb) cb(err, row || null); });
  },

  getEventMappingByGoogle: function(googleEventId, cb){
    db.get(`SELECT tmrEventId, googleEventId, googleCalendarId, userId FROM event_sync_mapping WHERE googleEventId = ?`, 
           [googleEventId], 
           (err, row) => { if(cb) cb(err, row || null); });
  },

  getAllEventMappingsForUser: function(userId, cb){
    db.all(`SELECT tmrEventId, googleEventId, googleCalendarId FROM event_sync_mapping WHERE userId = ?`, 
           [userId], 
           (err, rows) => { if(cb) cb(err, rows || []); });
  },

  deleteEventMapping: function(tmrEventId, cb){
    db.run(`DELETE FROM event_sync_mapping WHERE tmrEventId = ?`, [tmrEventId], 
           function(err){ if(cb) cb(err, this && this.changes); });
  },

  deleteAllEventMappingsForUser: function(userId, cb){
    db.run(`DELETE FROM event_sync_mapping WHERE userId = ?`, [userId], 
           function(err){ if(cb) cb(err, this && this.changes); });
  },

  // Sync log
  logSync: function(userId, syncType, status, eventCount, errorMessage, cb){
    db.run(`INSERT INTO sync_log (userId, syncType, status, eventCount, errorMessage, timestamp) 
            VALUES (?, ?, ?, ?, ?, ?)`, 
           [userId, syncType, status, eventCount, errorMessage, Date.now()], 
           function(err){ if(cb) cb(err); });
  },

  getRecentSyncLogs: function(userId, limit, cb){
    db.all(`SELECT syncType, status, eventCount, errorMessage, timestamp FROM sync_log 
            WHERE userId = ? ORDER BY timestamp DESC LIMIT ?`, 
           [userId, limit || 10], 
           (err, rows) => { if(cb) cb(err, rows || []); });
  }
};
