const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('[Database] DATABASE_URL is required for Postgres backend');
}

const sslMode = String(process.env.TMR_PG_SSL || '').trim().toLowerCase();
const useSsl = sslMode === 'true' || (sslMode !== 'false' && process.env.NODE_ENV === 'production');

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[Database] Postgres pool error:', err && err.message ? err.message : err);
});

const runTransaction = (callback) => {
  // Most call sites in this codebase do not rely on actual transactional semantics.
  // Preserve the existing signature (callback(done)).
  const done = (err) => {
    if (err) {
      console.error('[Database] Transaction error:', err.message);
    }
  };
  callback(done);
};

async function query(text, params) {
  return pool.query(text, params);
}

async function ensureSchema() {
  // Keep userId columns TEXT for compatibility with existing code that sometimes
  // passes String(req.user.id). IDs within a table (id/categoryId/etc) remain BIGSERIAL.
  await query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    createdAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    userId BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expiresAt BIGINT NOT NULL,
    createdAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS subscriptions (
    id BIGSERIAL PRIMARY KEY,
    userId TEXT,
    subscription JSONB NOT NULL,
    createdAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS reminders (
    id BIGSERIAL PRIMARY KEY,
    subscriptionId BIGINT,
    userId TEXT,
    title TEXT,
    body TEXT,
    deliverAt BIGINT,
    deliveredAt BIGINT,
    createdAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS google_calendar_tokens (
    userId TEXT PRIMARY KEY,
    accessToken TEXT NOT NULL,
    refreshToken TEXT,
    expiresAt BIGINT,
    createdAt BIGINT NOT NULL,
    updatedAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS event_sync_mapping (
    tmrEventId TEXT PRIMARY KEY,
    googleEventId TEXT,
    googleCalendarId TEXT,
    userId TEXT,
    lastSyncedAt BIGINT,
    createdAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS sync_log (
    id BIGSERIAL PRIMARY KEY,
    userId TEXT,
    syncType TEXT,
    status TEXT,
    eventCount INTEGER,
    errorMessage TEXT,
    timestamp BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS user_themes (
    userId TEXT PRIMARY KEY,
    accentColor TEXT DEFAULT '#6366f1',
    backgroundImage TEXT,
    backgroundImageName TEXT,
    animation TEXT DEFAULT 'none',
    animationSpeed INTEGER DEFAULT 1,
    animationIntensity INTEGER DEFAULT 1,
    createdAt BIGINT NOT NULL,
    updatedAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS note_categories (
    id BIGSERIAL PRIMARY KEY,
    userId TEXT NOT NULL,
    categoryName TEXT NOT NULL,
    createdAt BIGINT NOT NULL,
    UNIQUE(userId, categoryName)
  )`);

  await query(`CREATE TABLE IF NOT EXISTS notes (
    id BIGSERIAL PRIMARY KEY,
    userId TEXT NOT NULL,
    categoryId BIGINT NOT NULL REFERENCES note_categories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    createdAt BIGINT NOT NULL,
    updatedAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS note_tasks (
    id BIGSERIAL PRIMARY KEY,
    userId TEXT NOT NULL,
    noteId BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    taskTitle TEXT NOT NULL,
    todoId BIGINT,
    createdAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS user_events (
    id BIGSERIAL PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    startTime TEXT,
    endTime TEXT,
    description TEXT DEFAULT '',
    reminderMinutes INTEGER DEFAULT 0,
    reminderAt BIGINT,
    syncId TEXT,
    createdAt BIGINT NOT NULL,
    updatedAt BIGINT NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS user_todos (
    id BIGSERIAL PRIMARY KEY,
    userId TEXT NOT NULL,
    text TEXT NOT NULL,
    notes TEXT DEFAULT '',
    completed INTEGER DEFAULT 0,
    reminderMinutes INTEGER DEFAULT 0,
    reminderAt BIGINT,
    createdAt BIGINT NOT NULL,
    updatedAt BIGINT NOT NULL
  )`);
}

let schemaReady = false;
async function ensureReady() {
  if (schemaReady) return;
  await ensureSchema();
  schemaReady = true;
  console.log('[Database] Postgres schema ready');
}

function cbWrap(promise, cb, mapper) {
  promise
    .then((result) => {
      const value = mapper ? mapper(result) : result;
      cb && cb(null, value);
    })
    .catch((err) => {
      cb && cb(err);
    });
}

module.exports = {
  runTransaction,

  // Users
  createUser: function (username, passwordHash, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `INSERT INTO users (username, passwordHash, createdAt) VALUES ($1, $2, $3) RETURNING id`,
          [username, passwordHash, now]
        );
        return r.rows[0] && r.rows[0].id;
      })(),
      cb
    );
  },

  getUserByUsername: function (username, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, username, passwordHash, createdAt FROM users WHERE username = $1`,
          [username]
        );
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  getUserById: function (id, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, username, passwordHash, createdAt FROM users WHERE id = $1`,
          [id]
        );
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  updateUserPasswordHash: function (userId, passwordHash, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`UPDATE users SET passwordHash = $1 WHERE id = $2`, [passwordHash, userId]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  // Sessions
  createSession: function (userId, token, expiresAt, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `INSERT INTO sessions (userId, token, expiresAt, createdAt) VALUES ($1, $2, $3, $4) RETURNING id`,
          [userId, token, expiresAt, now]
        );
        return r.rows[0] && r.rows[0].id;
      })(),
      cb
    );
  },

  getSession: function (token, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, userId, token, expiresAt, createdAt FROM sessions WHERE token = $1`,
          [token]
        );
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  deleteSession: function (token, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM sessions WHERE token = $1`, [token]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  deleteSessionsByUser: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM sessions WHERE userId = $1`, [userId]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  deleteExpiredSessions: function (cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM sessions WHERE expiresAt <= $1`, [Date.now()]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  // Subscriptions
  addSubscription: function (userId, subscription, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const sub = subscription || {};

        const existing = await query(`SELECT id FROM subscriptions WHERE subscription = $1::jsonb`, [sub]);
        if (existing.rows[0] && existing.rows[0].id) return existing.rows[0].id;

        const r = await query(
          `INSERT INTO subscriptions (userId, subscription, createdAt) VALUES ($1, $2::jsonb, $3) RETURNING id`,
          [userId || null, sub, now]
        );
        return r.rows[0] && r.rows[0].id;
      })(),
      cb
    );
  },

  getSubscriptionsByUserId: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, subscription, createdAt FROM subscriptions WHERE userId = $1`,
          [String(userId)]
        );
        return (r.rows || []).map((row) => ({
          id: row.id,
          subscription: row.subscription,
          createdAt: row.createdAt,
        }));
      })(),
      cb
    );
  },

  getAllSubscriptions: function (cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`SELECT id, userId, subscription, createdAt FROM subscriptions`, []);
        return (r.rows || []).map((row) => ({
          id: row.id,
          userId: row.userId,
          subscription: row.subscription,
          createdAt: row.createdAt,
        }));
      })(),
      cb
    );
  },

  removeSubscriptionById: function (id, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM subscriptions WHERE id = $1`, [id]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  removeSubscriptionByEndpoint: function (endpoint, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM subscriptions WHERE subscription->>'endpoint' = $1`, [endpoint]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  // Reminders
  addReminder: function (subscriptionId, userId, title, body, deliverAtMs, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `INSERT INTO reminders (subscriptionId, userId, title, body, deliverAt, createdAt) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [subscriptionId || null, userId || null, title || '', body || '', deliverAtMs, now]
        );
        return r.rows[0] && r.rows[0].id;
      })(),
      cb
    );
  },

  getDueReminders: function (nowMs, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, subscriptionId, userId, title, body, deliverAt FROM reminders
           WHERE deliveredAt IS NULL AND deliverAt IS NOT NULL AND deliverAt <= $1`,
          [nowMs]
        );
        return r.rows || [];
      })(),
      cb
    );
  },

  getSubscriptionById: function (subscriptionId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`SELECT id, subscription, createdAt FROM subscriptions WHERE id = $1`, [subscriptionId]);
        const row = r.rows[0];
        if (!row) return null;
        return { id: row.id, subscription: row.subscription, createdAt: row.createdAt };
      })(),
      cb
    );
  },

  markDelivered: function (reminderId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        await query(`UPDATE reminders SET deliveredAt = $1 WHERE id = $2`, [now, reminderId]);
        return true;
      })(),
      cb
    );
  },

  getAllReminders: function (cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, userId, title, body, deliverAt, deliveredAt, createdAt FROM reminders ORDER BY createdAt DESC`,
          []
        );
        return r.rows || [];
      })(),
      cb
    );
  },

  getPendingReminders: function (cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, userId, title, body, deliverAt, createdAt FROM reminders
           WHERE deliveredAt IS NULL AND deliverAt IS NOT NULL ORDER BY deliverAt ASC`,
          []
        );
        return r.rows || [];
      })(),
      cb
    );
  },

  // Google Calendar tokens
  saveGoogleCalendarToken: function (userId, accessToken, refreshToken, expiresAt, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        await query(
          `INSERT INTO google_calendar_tokens (userId, accessToken, refreshToken, expiresAt, createdAt, updatedAt)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (userId)
           DO UPDATE SET accessToken = EXCLUDED.accessToken,
                         refreshToken = EXCLUDED.refreshToken,
                         expiresAt = EXCLUDED.expiresAt,
                         updatedAt = EXCLUDED.updatedAt`,
          [String(userId), accessToken, refreshToken || null, expiresAt || null, now, now]
        );
        return true;
      })(),
      cb
    );
  },

  getGoogleCalendarToken: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT userId, accessToken, refreshToken, expiresAt, updatedAt FROM google_calendar_tokens WHERE userId = $1`,
          [String(userId)]
        );
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  deleteGoogleCalendarToken: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM google_calendar_tokens WHERE userId = $1`, [String(userId)]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  // Event mapping
  mapEventIds: function (tmrEventId, googleEventId, googleCalendarId, userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        await query(
          `INSERT INTO event_sync_mapping (tmrEventId, googleEventId, googleCalendarId, userId, lastSyncedAt, createdAt)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tmrEventId)
           DO UPDATE SET googleEventId = EXCLUDED.googleEventId,
                         googleCalendarId = EXCLUDED.googleCalendarId,
                         userId = EXCLUDED.userId,
                         lastSyncedAt = EXCLUDED.lastSyncedAt`,
          [String(tmrEventId), googleEventId || null, googleCalendarId || null, userId || null, now, now]
        );
        return true;
      })(),
      cb
    );
  },

  getEventMapping: function (tmrEventId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT tmrEventId, googleEventId, googleCalendarId, userId FROM event_sync_mapping WHERE tmrEventId = $1`,
          [String(tmrEventId)]
        );
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  getEventMappingByGoogle: function (googleEventId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT tmrEventId, googleEventId, googleCalendarId, userId FROM event_sync_mapping WHERE googleEventId = $1`,
          [String(googleEventId)]
        );
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  getAllEventMappingsForUser: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT tmrEventId, googleEventId, googleCalendarId FROM event_sync_mapping WHERE userId = $1`,
          [String(userId)]
        );
        return r.rows || [];
      })(),
      cb
    );
  },

  deleteEventMapping: function (tmrEventId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM event_sync_mapping WHERE tmrEventId = $1`, [String(tmrEventId)]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  deleteAllEventMappingsForUser: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM event_sync_mapping WHERE userId = $1`, [String(userId)]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  // Sync log
  logSync: function (userId, syncType, status, eventCount, errorMessage, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        await query(
          `INSERT INTO sync_log (userId, syncType, status, eventCount, errorMessage, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId || null, syncType, status, eventCount || 0, errorMessage || null, now]
        );
        return true;
      })(),
      cb
    );
  },

  getRecentSyncLogs: function (userId, limit, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const lim = Number.isFinite(Number(limit)) ? Number(limit) : 20;
        const r = await query(
          `SELECT syncType, status, eventCount, errorMessage, timestamp FROM sync_log WHERE userId = $1 ORDER BY timestamp DESC LIMIT $2`,
          [String(userId), lim]
        );
        return r.rows || [];
      })(),
      cb
    );
  },

  // Themes
  saveUserTheme: function (userId, theme, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const data = theme || {};
        await query(
          `INSERT INTO user_themes (userId, accentColor, backgroundImage, backgroundImageName, animation, animationSpeed, animationIntensity, createdAt, updatedAt)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (userId)
           DO UPDATE SET accentColor = EXCLUDED.accentColor,
                         backgroundImage = EXCLUDED.backgroundImage,
                         backgroundImageName = EXCLUDED.backgroundImageName,
                         animation = EXCLUDED.animation,
                         animationSpeed = EXCLUDED.animationSpeed,
                         animationIntensity = EXCLUDED.animationIntensity,
                         updatedAt = EXCLUDED.updatedAt`,
          [
            String(userId),
            data.accentColor || '#6366f1',
            data.backgroundImage || null,
            data.backgroundImageName || null,
            data.animation || 'none',
            Number.isFinite(Number(data.animationSpeed)) ? Number(data.animationSpeed) : 1,
            Number.isFinite(Number(data.animationIntensity)) ? Number(data.animationIntensity) : 1,
            now,
            now,
          ]
        );
        return true;
      })(),
      cb
    );
  },

  getUserTheme: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`SELECT * FROM user_themes WHERE userId = $1`, [String(userId)]);
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  deleteUserTheme: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM user_themes WHERE userId = $1`, [String(userId)]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  // Notes
  createNoteCategory: function (userId, categoryName, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `INSERT INTO note_categories (userId, categoryName, createdAt) VALUES ($1, $2, $3) RETURNING id`,
          [String(userId), categoryName, now]
        );
        return r.rows[0] && r.rows[0].id;
      })(),
      cb
    );
  },

  getNoteCategories: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, categoryName, createdAt FROM note_categories WHERE userId = $1 ORDER BY createdAt DESC`,
          [String(userId)]
        );
        return r.rows || [];
      })(),
      cb
    );
  },

  deleteNoteCategory: function (categoryId, userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM note_categories WHERE id = $1 AND userId = $2`, [categoryId, String(userId)]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  updateNoteCategory: function (categoryId, userId, categoryName, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `UPDATE note_categories SET categoryName = $1 WHERE id = $2 AND userId = $3`,
          [categoryName, categoryId, String(userId)]
        );
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  createNote: function (userId, categoryId, title, content, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `INSERT INTO notes (userId, categoryId, title, content, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [String(userId), categoryId, title, content || '', now, now]
        );
        return r.rows[0] && r.rows[0].id;
      })(),
      cb
    );
  },

  getNotesInCategory: function (categoryId, userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, title, content, createdAt, updatedAt FROM notes WHERE categoryId = $1 AND userId = $2 ORDER BY updatedAt DESC`,
          [categoryId, String(userId)]
        );
        return r.rows || [];
      })(),
      cb
    );
  },

  getNote: function (noteId, userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, userId, categoryId, title, content, createdAt, updatedAt FROM notes WHERE id = $1 AND userId = $2`,
          [noteId, String(userId)]
        );
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  updateNote: function (noteId, userId, title, content, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `UPDATE notes SET title = $1, content = $2, updatedAt = $3 WHERE id = $4 AND userId = $5`,
          [title, content || '', now, noteId, String(userId)]
        );
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  deleteNote: function (noteId, userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM notes WHERE id = $1 AND userId = $2`, [noteId, String(userId)]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  searchNotes: function (userId, queryText, categoryId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const like = '%' + String(queryText || '').replace(/%/g, '') + '%';
        const params = [String(userId), like, like];
        let sql = `SELECT n.id, n.categoryId, n.title, n.content, n.updatedAt FROM notes n WHERE n.userId = $1 AND (n.title ILIKE $2 OR n.content ILIKE $3)`;
        if (categoryId != null) {
          params.push(categoryId);
          sql += ` AND n.categoryId = $4`;
        }
        sql += ` ORDER BY n.updatedAt DESC`;
        const r = await query(sql, params);
        return r.rows || [];
      })(),
      cb
    );
  },

  // Note tasks
  addNoteTask: function (userId, noteId, taskTitle, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `INSERT INTO note_tasks (userId, noteId, taskTitle, createdAt) VALUES ($1, $2, $3, $4) RETURNING id`,
          [String(userId), noteId, taskTitle, now]
        );
        return r.rows[0] && r.rows[0].id;
      })(),
      cb
    );
  },

  updateNoteTaskTodoId: function (taskId, todoId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        await query(`UPDATE note_tasks SET todoId = $1 WHERE id = $2`, [todoId, taskId]);
        return true;
      })(),
      cb
    );
  },

  getNoteTasksForNote: function (noteId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`SELECT id, taskTitle, todoId FROM note_tasks WHERE noteId = $1 ORDER BY createdAt DESC`, [noteId]);
        return r.rows || [];
      })(),
      cb
    );
  },

  // Debug
  getAllCategoriesDebug: function (cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`SELECT id, userId, categoryName FROM note_categories ORDER BY userId, id`, []);
        return r.rows || [];
      })(),
      cb
    );
  },

  // User events
  createEvent: function (userId, event, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `INSERT INTO user_events (userId, title, date, startTime, endTime, description, reminderMinutes, reminderAt, syncId, createdAt, updatedAt)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            String(userId),
            event.title,
            event.date,
            event.startTime || null,
            event.endTime || null,
            event.description || '',
            event.reminderMinutes || 0,
            event.reminderAt || null,
            event.syncId || null,
            now,
            now,
          ]
        );
        return r.rows[0] && r.rows[0].id;
      })(),
      cb
    );
  },

  getEventsByUserId: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, title, date, startTime, endTime, description, reminderMinutes, reminderAt, syncId, createdAt, updatedAt
           FROM user_events WHERE userId = $1 ORDER BY date DESC, startTime DESC`,
          [String(userId)]
        );
        return r.rows || [];
      })(),
      cb
    );
  },

  getEventById: function (eventId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, userId, title, date, startTime, endTime, description, reminderMinutes, reminderAt, syncId, createdAt, updatedAt
           FROM user_events WHERE id = $1`,
          [eventId]
        );
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  updateEvent: function (eventId, event, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `UPDATE user_events SET title=$1, date=$2, startTime=$3, endTime=$4, description=$5, reminderMinutes=$6, reminderAt=$7, syncId=$8, updatedAt=$9 WHERE id=$10`,
          [
            event.title,
            event.date,
            event.startTime || null,
            event.endTime || null,
            event.description || '',
            event.reminderMinutes || 0,
            event.reminderAt || null,
            event.syncId || null,
            now,
            eventId,
          ]
        );
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  deleteEvent: function (eventId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM user_events WHERE id = $1`, [eventId]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  // Todos
  createTodo: function (userId, todo, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `INSERT INTO user_todos (userId, text, notes, completed, reminderMinutes, reminderAt, createdAt, updatedAt)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            String(userId),
            todo.text,
            todo.notes || '',
            todo.completed ? 1 : 0,
            todo.reminderMinutes || 0,
            todo.reminderAt || null,
            now,
            now,
          ]
        );
        return r.rows[0] && r.rows[0].id;
      })(),
      cb
    );
  },

  getTodosByUserId: function (userId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, text, notes, completed, reminderMinutes, reminderAt, createdAt, updatedAt
           FROM user_todos WHERE userId = $1 ORDER BY createdAt DESC`,
          [String(userId)]
        );
        return r.rows || [];
      })(),
      cb
    );
  },

  getTodoById: function (todoId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(
          `SELECT id, userId, text, notes, completed, reminderMinutes, reminderAt, createdAt, updatedAt
           FROM user_todos WHERE id = $1`,
          [todoId]
        );
        return r.rows[0] || null;
      })(),
      cb
    );
  },

  updateTodo: function (todoId, todo, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const now = Date.now();
        const r = await query(
          `UPDATE user_todos SET text=$1, notes=$2, completed=$3, reminderMinutes=$4, reminderAt=$5, updatedAt=$6 WHERE id=$7`,
          [
            todo.text,
            todo.notes || '',
            todo.completed ? 1 : 0,
            todo.reminderMinutes || 0,
            todo.reminderAt || null,
            now,
            todoId,
          ]
        );
        return r.rowCount || 0;
      })(),
      cb
    );
  },

  deleteTodo: function (todoId, cb) {
    cbWrap(
      (async () => {
        await ensureReady();
        const r = await query(`DELETE FROM user_todos WHERE id = $1`, [todoId]);
        return r.rowCount || 0;
      })(),
      cb
    );
  },
};
