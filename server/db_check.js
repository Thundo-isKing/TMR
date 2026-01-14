const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbFile = process.env.TMR_DB_PATH
  ? path.resolve(process.env.TMR_DB_PATH)
  : path.join(__dirname, 'tmr_server.db');
const db = new sqlite3.Database(dbFile);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

(async () => {
  try {
    const users = await all('select id, username from users order by id');
    console.log('USERS');
    console.table(users);

    const todoCounts = await all('select userId, count(*) as count from user_todos group by userId order by userId');
    console.log('USER_TODOS');
    console.table(todoCounts);

    const eventCounts = await all('select userId, count(*) as count from user_events group by userId order by userId');
    console.log('USER_EVENTS');
    console.table(eventCounts);

    // Notes tables historically vary; try the common ones.
    const tables = await all("select name from sqlite_master where type='table' order by name");
    const names = new Set(tables.map(t => t.name));
    const noteTables = ['notes', 'user_notes', 'note_categories'];
    console.log('TABLES_HAS', noteTables.filter(t => names.has(t)).join(', ') || '(no expected notes tables found)');

    if (names.has('notes')) {
      const noteCounts = await all('select userId, count(*) as count from notes group by userId order by userId');
      console.log('NOTES');
      console.table(noteCounts);
    }
    if (names.has('user_notes')) {
      const noteCounts2 = await all('select userId, count(*) as count from user_notes group by userId order by userId');
      console.log('USER_NOTES');
      console.table(noteCounts2);
    }
  } catch (e) {
    console.error('DB_CHECK_ERROR', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
