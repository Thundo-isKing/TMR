const backend = String(process.env.TMR_DB_BACKEND || '').trim().toLowerCase();
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

// Default behavior:
// - If DATABASE_URL is set, prefer Postgres unless explicitly forced to sqlite.
// - Otherwise use SQLite.
const usePostgres = backend === 'postgres' || (backend !== 'sqlite' && hasDatabaseUrl);

// eslint-disable-next-line import/no-dynamic-require
const impl = usePostgres ? require('./db-postgres') : require('./db-sqlite');

// Non-sensitive metadata for debugging (do not include secrets).
try {
	impl.__tmrBackend = usePostgres ? 'postgres' : 'sqlite';
} catch (_) {}

module.exports = impl;

