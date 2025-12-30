/**
 * Secure OAuth Session Store
 * Prevents CSRF attacks and manages OAuth state
 */

const crypto = require('crypto');

class SessionStore {
  constructor() {
    this.sessions = new Map(); // In production, use Redis
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
    console.log('[Session] Created:', sessionId, 'for user:', userId);
    
    return { sessionId, state };
  }

  // Validate and retrieve session
  validateSession(sessionId, state) {
    if (!sessionId || !state) return null;

    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn('[Session] Session not found:', sessionId);
      return null;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      console.warn('[Session] Session expired:', sessionId);
      return null;
    }

    if (session.state !== state) {
      console.error('[Session] State mismatch - CSRF detected:', sessionId);
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
  getAndDelete(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      console.log('[Session] Cleaned up:', sessionId);
    }
    return session;
  }

  // Cleanup expired sessions
  cleanup() {
    const now = Date.now();
    let count = 0;
    for (const [key, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(key);
        count++;
      }
    }
    if (count > 0) console.log('[Session] Cleanup - removed', count, 'expired sessions');
  }
}

module.exports = SessionStore;
