const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const dbPath = path.join(__dirname, 'tmr_server.db');

if(!fs.existsSync(dbPath)){
  // ensure dir exists (should exist)
  fs.writeFileSync(dbPath, '');
}

const db = new sqlite3.Database(dbPath);

// Initialize tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    subscription TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    title TEXT,
    body TEXT,
    deliverAt INTEGER,
    deliveredAt INTEGER,
    createdAt INTEGER NOT NULL
  )`);
});

module.exports = {
  addSubscription: function(userId, subscription, cb){
    const now = Date.now();
    const subJson = JSON.stringify(subscription);
    db.run(`INSERT INTO subscriptions (userId, subscription, createdAt) VALUES (?,?,?)`, [userId || null, subJson, now], function(err){
      if(cb) cb(err, this && this.lastID);
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
  addReminder: function(userId, title, body, deliverAtMs, cb){
    const now = Date.now();
    db.run(`INSERT INTO reminders (userId, title, body, deliverAt, deliveredAt, createdAt) VALUES (?,?,?,?,?,?)`, [userId || null, title || '', body || '', deliverAtMs || null, null, now], function(err){
      if(cb) cb(err, this && this.lastID);
    });
  },
  getDueReminders: function(nowMs, cb){
    db.all(`SELECT id, userId, title, body, deliverAt FROM reminders WHERE deliveredAt IS NULL AND deliverAt IS NOT NULL AND deliverAt <= ?`, [nowMs], (err, rows) => {
      if(err) return cb(err);
      cb(null, rows || []);
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
  }
};
