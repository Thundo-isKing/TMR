# Changelog

## 2026-01-05

### Fixed
- Multi-user data isolation: todos/themes now reliably stay with the correct account (session-gated client init + scoped storage).
- Theme/accent/background flash on navigation/refresh: added a pre-paint boot theme snapshot so pages render with the saved look immediately.
- TMR accent “flash blue” regression: startup code no longer forces the default accent when a saved accent exists.
- Google Calendar cross-account leakage: removed client-driven user identity and rely on server session cookie for auth/scoping.
- NotesHQ/Docs theme loading inconsistency: aligned theme/session flow so accent/background load correctly.
- Proxy/rate-limit misconfiguration: enabled `trust proxy` to prevent forwarded-IP validation errors.
- Server dependency conflicts: de-duped dependencies and resolved version mismatch in `server/package.json`.

### Notes
- These fixes correspond to the two commits pushed on 2026-01-05: `d01e16e` and `772d247`.
