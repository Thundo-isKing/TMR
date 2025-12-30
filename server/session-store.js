/**
 * Secure OAuth Session Store
 * Prevents CSRF attacks and manages OAuth state
 */

const crypto = require('crypto');

class SessionStore {
  constructor() {
    this.sessions = new Map(); // sessionId -> session
    this.stateMap = new Map(); // state -> sessionId (for OAuth callbacks)
    this.sessionTimeout = 10 * 60 * 1000; // 10 minutes
  }

  // Create a secure session
  createSession(userId) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const state = crypto.randomBytes(32).toString('hex');
    
    const session = {
      sessionId,
      userId,
      state,
      redirectUri: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionTimeout
    };

    this.sessions.set(sessionId, session);
    this.stateMap.set(state, sessionId); // Map state -> sessionId for OAuth callback lookup
    console.log('[Session] Created:', sessionId, 'for user:', userId, 'with state:', state.slice(0, 8) + '...');
    
    return { sessionId, state };
  }

  // Validate session from OAuth callback (lookup by state)
  validateSession(state, expectedState) {
    if (!state) return null;
    
    if (state !== expectedState) {
      console.error('[Session] State mismatch - CSRF detected');
      return null;
    }

    // Look up sessionId by state
    const sessionId = this.stateMap.get(state);
    if (!sessionId) {
      console.warn('[Session] No session found for state:', state.slice(0, 8) + '...');
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn('[Session] Session not found:', sessionId);
      return null;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      this.stateMap.delete(state);
      console.warn('[Session] Session expired:', sessionId);
      return null;
    }

    return session;
  }

  // Store redirect URI
  setRedirectUri(sessionId, redirectUri) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.redirectUri = redirectUri;
    }
  }

  // Get session and clean up
  getAndDelete(state) {
    const sessionId = this.stateMap.get(state);
    if (!sessionId) return null;
    
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.stateMap.delete(state);
      console.log('[Session] Cleaned up:', sessionId);
    }
    return session;
  }

  // Cleanup expired sessions
  cleanup() {
    const now = Date.now();
    let count = 0;
    const statesToDelete = [];
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
        statesToDelete.push(session.state);
        count++;
      }
    }
    
    statesToDelete.forEach(state => this.stateMap.delete(state));
    if (count > 0) console.log('[Session] Cleanup - removed', count, 'expired sessions');
  }
}

module.exports = SessionStore;
