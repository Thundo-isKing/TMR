const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// IMPORTANT (Render/containers): the default filesystem is ephemeral.
// Set TMR_DB_PATH to a persistent disk mount (e.g. /var/data/tmr_server.db)
// to keep users/notes/todos across deploys and restarts.
const dbPath = process.env.TMR_DB_PATH
  ? path.resolve(process.env.TMR_DB_PATH)
  : path.join(__dirname, 'tmr_server.db');

try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
} catch (_) {}

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, '');
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[Database] Connection error:', err);
  } else {
    console.log('[Database] Connected to:', dbPath);
  }
});

// Add transaction support - simplified version that just runs the callback
const runTransaction = (callback) => {
  // Just run the callback directly with a simple done function
  const done = (err) => {
    if (err) {
      console.error('[Database] Transaction error:', err.message);
    }
  };
  callback(done);
};

// Initialize tables
db.serialize(() => {
  // User accounts
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`);

  // User sessions
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
    FOREIGN KEY (userId) REFERENCES users(id)
  )`);

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

  db.run(`CREATE TABLE IF NOT EXISTS user_themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT UNIQUE NOT NULL,
    accentColor TEXT DEFAULT '#6366f1',
    backgroundImage TEXT,
    backgroundImageName TEXT,
    animation TEXT DEFAULT 'none',
    animationSpeed INTEGER DEFAULT 1,
    animationIntensity INTEGER DEFAULT 1,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS note_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    categoryName TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    UNIQUE(userId, categoryName)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    categoryId INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY(categoryId) REFERENCES note_categories(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS note_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    noteId INTEGER NOT NULL,
    taskTitle TEXT NOT NULL,
    todoId INTEGER,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY(noteId) REFERENCES notes(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    startTime TEXT,
    endTime TEXT,
    description TEXT DEFAULT '',
    reminderMinutes INTEGER DEFAULT 0,
    reminderAt INTEGER,
    syncId TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    text TEXT NOT NULL,
    notes TEXT DEFAULT '',
    completed INTEGER DEFAULT 0,
    reminderMinutes INTEGER DEFAULT 0,
    reminderAt INTEGER,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  )`);

  // Lightweight migrations (SQLite): add missing columns.
  // Render/hosted deployments often keep an existing DB file; this prevents crashes and preserves data.
  db.all(`PRAGMA table_info(user_todos)`, [], (err, rows) => {
    if (err || !Array.isArray(rows)) return;
    const names = new Set(rows.map(r => r && r.name).filter(Boolean));
    if (!names.has('notes')) {
      db.run(`ALTER TABLE user_todos ADD COLUMN notes TEXT DEFAULT ''`);
    }
  });
});

module.exports = {
  runTransaction: runTransaction,

  // User accounts
  createUser: function(username, passwordHash, cb){
    const now = Date.now();
    db.run(
      `INSERT INTO users (username, passwordHash, createdAt) VALUES (?, ?, ?)`
      , [username, passwordHash, now]
      , function(err){ cb && cb(err, this && this.lastID); }
    );
  },

  getUserByUsername: function(username, cb){
    db.get(`SELECT id, username, passwordHash, createdAt FROM users WHERE username = ?`, [username], (err, row) => {
      if (cb) cb(err, row || null);
    });
  },

  getUserById: function(id, cb){
    db.get(`SELECT id, username, passwordHash, createdAt FROM users WHERE id = ?`, [id], (err, row) => {
      if (cb) cb(err, row || null);
    });
  },

  // Session persistence
  createSession: function(userId, token, expiresAt, cb){
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (userId, token, expiresAt, createdAt) VALUES (?, ?, ?, ?)`
      , [userId, token, expiresAt, now]
      , function(err){ cb && cb(err, this && this.lastID); }
    );
  },

  getSession: function(token, cb){
    db.get(`SELECT id, userId, token, expiresAt, createdAt FROM sessions WHERE token = ?`, [token], (err, row) => {
      if (cb) cb(err, row || null);
    });
  },

  deleteSession: function(token, cb){
    db.run(`DELETE FROM sessions WHERE token = ?`, [token], function(err){ cb && cb(err, this && this.changes); });
  },

  deleteSessionsByUser: function(userId, cb){
    db.run(`DELETE FROM sessions WHERE userId = ?`, [userId], function(err){ cb && cb(err, this && this.changes); });
  },
  
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
  },

  // User Themes
  saveUserTheme: function(userId, theme, cb){
    const now = Date.now();
    const query = `
      INSERT INTO user_themes (userId, accentColor, backgroundImage, backgroundImageName, animation, animationSpeed, animationIntensity, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET 
        accentColor = excluded.accentColor,
        backgroundImage = excluded.backgroundImage,
        backgroundImageName = excluded.backgroundImageName,
        animation = excluded.animation,
        animationSpeed = excluded.animationSpeed,
        animationIntensity = excluded.animationIntensity,
        updatedAt = excluded.updatedAt
    `;
    db.run(query, 
           [userId, 
            theme.accentColor || '#6366f1',
            theme.backgroundImage || null,
            theme.backgroundImageName || null,
            theme.animation || 'none',
            theme.animationSpeed || 1,
            theme.animationIntensity || 1,
            now, now],
           function(err){ if(cb) cb(err); });
  },

  getUserTheme: function(userId, cb){
    db.get(`SELECT * FROM user_themes WHERE userId = ?`, [userId], (err, row) => {
      if(cb) cb(err, row || null);
    });
  },

  deleteUserTheme: function(userId, cb){
    db.run(`DELETE FROM user_themes WHERE userId = ?`, [userId], 
           function(err){ if(cb) cb(err); });
  },

  // Notes - Categories
  createNoteCategory: function(userId, categoryName, cb){
    const now = Date.now();
    db.run(`INSERT INTO note_categories (userId, categoryName, createdAt) VALUES (?, ?, ?)`,
           [userId, categoryName, now],
           function(err){
             if(err) {
               console.error('[Database] Error creating category:', err);
               return cb && cb(err);
             }
             console.log('[Database] Category created:', this.lastID);
             cb && cb(null, this.lastID);
           });
  },

  getNoteCategories: function(userId, cb){
    db.all(`SELECT id, categoryName, createdAt FROM note_categories WHERE userId = ? ORDER BY createdAt DESC`,
           [userId],
           (err, rows) => {
             if(err) return cb && cb(err);
             cb && cb(null, rows || []);
           });
  },

  deleteNoteCategory: function(categoryId, userId, cb){
    db.run(`DELETE FROM note_categories WHERE id = ? AND userId = ?`,
           [categoryId, userId],
           function(err){ cb && cb(err, this && this.changes); });
  },

  updateNoteCategory: function(categoryId, userId, categoryName, cb){
    db.run(`UPDATE note_categories SET categoryName = ? WHERE id = ? AND userId = ?`,
           [categoryName, categoryId, userId],
           function(err){ cb && cb(err, this && this.changes); });
  },

  // Notes - Documents
  createNote: function(userId, categoryId, title, content, cb){
    const now = Date.now();
    db.run(`INSERT INTO notes (userId, categoryId, title, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
           [userId, categoryId, title, content || '', now, now],
           function(err){
             if(err) {
               console.error('[Database] Error creating note:', err);
               return cb && cb(err);
             }
             console.log('[Database] Note created:', this.lastID);
             cb && cb(null, this.lastID);
           });
  },

  getNotesInCategory: function(categoryId, userId, cb){
    db.all(`SELECT id, title, content, createdAt, updatedAt FROM notes WHERE categoryId = ? AND userId = ? ORDER BY updatedAt DESC`,
           [categoryId, userId],
           (err, rows) => {
             if(err) return cb && cb(err);
             cb && cb(null, rows || []);
           });
  },

  getNote: function(noteId, userId, cb){
    db.get(`SELECT id, userId, categoryId, title, content, createdAt, updatedAt FROM notes WHERE id = ? AND userId = ?`,
           [noteId, userId],
           (err, row) => {
             if(err) return cb && cb(err);
             cb && cb(null, row || null);
           });
  },

  updateNote: function(noteId, userId, title, content, cb){
    const now = Date.now();
    db.run(`UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ? AND userId = ?`,
           [title, content, now, noteId, userId],
           function(err){
             if(err) {
               console.error('[Database] Error updating note:', err);
               return cb && cb(err);
             }
             console.log('[Database] Note updated:', noteId);
             cb && cb(null);
           });
  },

  deleteNote: function(noteId, userId, cb){
    db.run(`DELETE FROM notes WHERE id = ? AND userId = ?`,
           [noteId, userId],
           function(err){ 
             if(err) return cb && cb(err);
             cb && cb(null, this && this.changes); 
           });
  },

  searchNotes: function(userId, query, categoryId, cb){
    let sql = `SELECT id, title, content, categoryId, createdAt, updatedAt FROM notes WHERE userId = ?`;
    let params = [userId];

    if(categoryId) {
      sql += ` AND categoryId = ?`;
      params.push(categoryId);
    }

    sql += ` AND (title LIKE ? OR content LIKE ?) ORDER BY updatedAt DESC`;
    params.push(`%${query}%`, `%${query}%`);

    db.all(sql, params, (err, rows) => {
      if(err) return cb && cb(err);
      cb && cb(null, rows || []);
    });
  },

  // Notes - Tasks (for Meibot integration)
  addNoteTask: function(userId, noteId, taskTitle, cb){
    const now = Date.now();
    db.run(`INSERT INTO note_tasks (userId, noteId, taskTitle, createdAt) VALUES (?, ?, ?, ?)`,
           [userId, noteId, taskTitle, now],
           function(err){
             if(err) {
               console.error('[Database] Error creating task:', err);
               return cb && cb(err);
             }
             console.log('[Database] Task created:', this.lastID);
             cb && cb(null, this.lastID);
           });
  },

  updateNoteTaskTodoId: function(taskId, todoId, cb){
    db.run(`UPDATE note_tasks SET todoId = ? WHERE id = ?`,
           [todoId, taskId],
           function(err){
             if(err) return cb && cb(err);
             cb && cb(null);
           });
  },

  getNoteTasksForNote: function(noteId, cb){
    db.all(`SELECT id, taskTitle, todoId FROM note_tasks WHERE noteId = ? ORDER BY createdAt DESC`,
           [noteId],
           (err, rows) => {
             if(err) return cb && cb(err);
             cb && cb(null, rows || []);
           });
  },

  // Debug: Get all categories from all users
  getAllCategoriesDebug: function(cb) {
    db.all(`SELECT id, userId, categoryName FROM note_categories ORDER BY userId, id`, [], (err, rows) => {
      if (err) return cb && cb(err);
      cb && cb(null, rows || []);
    });
  },

  // Authentication - Users
  createUser: function(username, passwordHash, cb) {
    const now = Date.now();
    db.run(`INSERT INTO users (username, passwordHash, createdAt) VALUES (?, ?, ?)`,
           [username, passwordHash, now],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.lastID);
           });
  },

  getUserByUsername: function(username, cb) {
    db.get(`SELECT id, username, passwordHash FROM users WHERE username = ?`,
           [username],
           (err, row) => {
             if (err) return cb && cb(err);
             cb && cb(null, row);
           });
  },

  getUserById: function(userId, cb) {
    db.get(`SELECT id, username FROM users WHERE id = ?`,
           [userId],
           (err, row) => {
             if (err) return cb && cb(err);
             cb && cb(null, row);
           });
  },

  updateUserPasswordHash: function(userId, passwordHash, cb) {
    db.run(`UPDATE users SET passwordHash = ? WHERE id = ?`,
           [passwordHash, userId],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.changes);
           });
  },

  // Sessions
  createSession: function(userId, token, expiresAt, cb) {
    const now = Date.now();
    db.run(`INSERT INTO sessions (userId, token, expiresAt, createdAt) VALUES (?, ?, ?, ?)`,
           [userId, token, expiresAt, now],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.lastID);
           });
  },

  getSessionByToken: function(token, cb) {
    db.get(`SELECT id, userId, token, expiresAt FROM sessions WHERE token = ? AND expiresAt > ?`,
           [token, Date.now()],
           (err, row) => {
             if (err) return cb && cb(err);
             cb && cb(null, row);
           });
  },

  deleteSession: function(token, cb) {
    db.run(`DELETE FROM sessions WHERE token = ?`,
           [token],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null);
           });
  },

  deleteExpiredSessions: function(cb) {
    db.run(`DELETE FROM sessions WHERE expiresAt <= ?`,
           [Date.now()],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.changes);
           });
  },

  // User Events
  createEvent: function(userId, event, cb) {
    const now = Date.now();
    db.run(`INSERT INTO user_events (userId, title, date, startTime, endTime, description, reminderMinutes, reminderAt, syncId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
           [userId, event.title, event.date, event.startTime || null, event.endTime || null, event.description || '', event.reminderMinutes || 0, event.reminderAt || null, event.syncId || null, now, now],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.lastID);
           });
  },

  getEventsByUserId: function(userId, cb) {
    db.all(`SELECT id, title, date, startTime, endTime, description, reminderMinutes, reminderAt, syncId, createdAt, updatedAt FROM user_events WHERE userId = ? ORDER BY date DESC, startTime DESC`,
           [userId],
           (err, rows) => {
             if (err) return cb && cb(err);
             cb && cb(null, rows || []);
           });
  },

  getEventById: function(eventId, cb) {
    db.get(`SELECT id, userId, title, date, startTime, endTime, description, reminderMinutes, reminderAt, syncId, createdAt, updatedAt FROM user_events WHERE id = ?`,
           [eventId],
           (err, row) => {
             if (err) return cb && cb(err);
             cb && cb(null, row);
           });
  },

  updateEvent: function(eventId, event, cb) {
    const now = Date.now();
    db.run(`UPDATE user_events SET title=?, date=?, startTime=?, endTime=?, description=?, reminderMinutes=?, reminderAt=?, syncId=?, updatedAt=? WHERE id=?`,
           [event.title, event.date, event.startTime || null, event.endTime || null, event.description || '', event.reminderMinutes || 0, event.reminderAt || null, event.syncId || null, now, eventId],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.changes);
           });
  },

  deleteEvent: function(eventId, cb) {
    db.run(`DELETE FROM user_events WHERE id = ?`,
           [eventId],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.changes);
           });
  },

  // User Todos
  createTodo: function(userId, todo, cb) {
    const now = Date.now();
    db.run(`INSERT INTO user_todos (userId, text, notes, completed, reminderMinutes, reminderAt, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
           [userId, todo.text, todo.notes || '', todo.completed ? 1 : 0, todo.reminderMinutes || 0, todo.reminderAt || null, now, now],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.lastID);
           });
  },

  getTodosByUserId: function(userId, cb) {
    db.all(`SELECT id, text, notes, completed, reminderMinutes, reminderAt, createdAt, updatedAt FROM user_todos WHERE userId = ? ORDER BY createdAt DESC`,
           [userId],
           (err, rows) => {
             if (err) return cb && cb(err);
             cb && cb(null, rows || []);
           });
  },

  getTodoById: function(todoId, cb) {
    db.get(`SELECT id, userId, text, notes, completed, reminderMinutes, reminderAt, createdAt, updatedAt FROM user_todos WHERE id = ?`,
           [todoId],
           (err, row) => {
             if (err) return cb && cb(err);
             cb && cb(null, row);
           });
  },

  updateTodo: function(todoId, todo, cb) {
    const now = Date.now();
    db.run(`UPDATE user_todos SET text=?, notes=?, completed=?, reminderMinutes=?, reminderAt=?, updatedAt=? WHERE id=?`,
           [todo.text, todo.notes || '', todo.completed ? 1 : 0, todo.reminderMinutes || 0, todo.reminderAt || null, now, todoId],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.changes);
           });
  },

  deleteTodo: function(todoId, cb) {
    db.run(`DELETE FROM user_todos WHERE id = ?`,
           [todoId],
           function(err) {
             if (err) return cb && cb(err);
             cb && cb(null, this.changes);
           });
  }
};
