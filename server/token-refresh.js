/**
 * Google Token Refresh Manager
 * Automatically refreshes Google Calendar tokens before expiration
 */

class TokenRefreshManager {
  constructor(db, googleCalendarManager) {
    this.db = db;
    this.googleCalendarManager = googleCalendarManager;
    this.refreshIntervals = new Map();
  }

  // Start monitoring tokens for a user
  startTokenMonitoring(userId, expiresIn = 3600) {
    if (this.refreshIntervals.has(userId)) {
      clearInterval(this.refreshIntervals.get(userId));
      console.log('[TokenRefresh] Replaced existing monitor for:', userId);
    }

    // Refresh 10 minutes before expiration (more aggressive to avoid race conditions)
    const refreshTime = Math.max((expiresIn - 600) * 1000, 120000); // At least 2 minutes
    
    const interval = setInterval(() => {
      this.refreshUserToken(userId);
    }, refreshTime);

    this.refreshIntervals.set(userId, interval);
    console.log('[TokenRefresh] Monitoring started for user:', userId, '(expires in', Math.round(expiresIn / 60), 'minutes, refresh in', Math.round(refreshTime / 60000), 'minutes)');
  }

  // Refresh a specific user's token
  async refreshUserToken(userId) {
    try {
      console.log('[TokenRefresh] Attempting refresh for user:', userId);
      
      const token = await new Promise((resolve, reject) => {
        this.db.getGoogleCalendarToken(userId, (err, token) => {
          if (err) reject(err);
          else resolve(token);
        });
      });

      if (!token || !token.refresh_token) {
        console.warn('[TokenRefresh] No refresh token available for user:', userId);
        return;
      }

      const newTokens = await this.googleCalendarManager.refreshTokens(userId, token.refresh_token);
      
      await new Promise((resolve, reject) => {
        this.db.saveGoogleCalendarToken(userId, newTokens, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      console.log('[TokenRefresh] ✓ Token refreshed successfully for:', userId);
      
      // Restart monitoring with new expiry
      if (newTokens.expiry_date) {
        const expiresIn = Math.round((newTokens.expiry_date - Date.now()) / 1000);
        this.startTokenMonitoring(userId, expiresIn);
      } else {
        console.warn('[TokenRefresh] No expiry date in refreshed tokens for user:', userId);
      }
      
    } catch (err) {
      console.error('[TokenRefresh] ✗ Failed to refresh token for user:', userId, err.message);
      // Keep monitoring - will retry on next interval
      console.log('[TokenRefresh] Will retry refresh on next scheduled interval for:', userId);
    }
  }

  // Stop monitoring a user's tokens
  stopTokenMonitoring(userId) {
    if (this.refreshIntervals.has(userId)) {
      clearInterval(this.refreshIntervals.get(userId));
      this.refreshIntervals.delete(userId);
      console.log('[TokenRefresh] Monitoring stopped for user:', userId);
    }
  }
}

module.exports = TokenRefreshManager;
