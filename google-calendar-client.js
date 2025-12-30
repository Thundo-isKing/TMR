/**
 * Google Calendar Client Integration
 * Handles OAuth flow and bi-directional sync between TMR and Google Calendar
 */

(function() {
  const GCAL_STATUS_KEY = 'tmr_gcal_status';
  const DEVICE_ID_KEY = 'tmr_device_id';
  const GCAL_USER_ID_KEY = 'tmr_gcal_user_id';

  // Helper: serverFetch with fallbacks
  async function serverFetch(path, opts = {}) {
    try {
      if (location.hostname.includes('ngrok')) {
        const url = location.origin + path;
        try {
          const res = await fetch(url, opts);
          if (res.ok) return res;
        } catch (e) {
          console.debug('[GoogleCalendar] ngrok fetch failed', e);
        }
      }
      try {
        const res = await fetch(path, opts);
        if (res.ok) return res;
      } catch (e) { /* try fallback */ }
      const url = 'http://localhost:3002' + path;
      const res = await fetch(url, opts);
      return res;
    } catch (e) {
      console.warn('[GoogleCalendar] all fetch attempts failed', e);
      throw e;
    }
  }

  // Get or create device ID
  function getDeviceId() {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  }

  // Get Google Calendar user ID
  function getGoogleCalendarUserId() {
    return localStorage.getItem(GCAL_USER_ID_KEY) || getDeviceId();
  }

  // Set Google Calendar user ID
  function setGoogleCalendarUserId(userId) {
    localStorage.setItem(GCAL_USER_ID_KEY, userId);
  }

  // Check if connected to Google Calendar
  async function checkGoogleCalendarStatus() {
    try {
      const userId = getGoogleCalendarUserId();
      const res = await serverFetch(`/auth/google/status?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      
      localStorage.setItem(GCAL_STATUS_KEY, data.connected ? 'connected' : 'disconnected');
      
      // Update button visibility
      updateGoogleCalendarButtons(data.connected);
      
      return data.connected;
    } catch (err) {
      console.error('[GoogleCalendar] Status check failed:', err);
      updateGoogleCalendarButtons(false);
      return false;
    }
  }

  // Update button visibility based on connection status
  function updateGoogleCalendarButtons(connected) {
    const authBtn = document.getElementById('gcal-auth-btn');
    const syncBtn = document.getElementById('gcal-sync-btn');
    const logoutBtn = document.getElementById('gcal-logout-btn');
    const mobileAuthBtn = document.getElementById('mobile-gcal-auth-btn');
    const mobileSyncBtn = document.getElementById('mobile-gcal-sync-btn');
    const mobileLogoutBtn = document.getElementById('mobile-gcal-logout-btn');
    
    if (authBtn) {
      authBtn.style.display = connected ? 'none' : 'block';
    }
    if (syncBtn) {
      syncBtn.style.display = connected ? 'block' : 'none';
    }
    if (logoutBtn) {
      logoutBtn.style.display = connected ? 'block' : 'none';
    }
    if (mobileAuthBtn) {
      mobileAuthBtn.style.display = connected ? 'none' : 'block';
    }
    if (mobileSyncBtn) {
      mobileSyncBtn.style.display = connected ? 'block' : 'none';
    }
    if (mobileLogoutBtn) {
      mobileLogoutBtn.style.display = connected ? 'block' : 'none';
    }
    
    // Dispatch event for other listeners
    try {
      window.dispatchEvent(new CustomEvent('gcal:status-changed', { detail: { connected } }));
    } catch (e) { }
  }

  // Get OAuth authorization URL
  async function initiateGoogleAuth() {
    try {
      const userId = getGoogleCalendarUserId();
      const res = await serverFetch(`/auth/google?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      
      if (!res.ok) {
        console.error('[GoogleCalendar] Server error:', data);
        showNotification(`Failed to connect: ${data.error || 'Unknown error'}`, 'error');
        return;
      }
      
      if (data.authUrl) {
        // Open OAuth window
        const width = 500;
        const height = 600;
        const left = (window.innerWidth - width) / 2;
        const top = (window.innerHeight - height) / 2;
        
        const authWindow = window.open(
          data.authUrl,
          'GoogleCalendarAuth',
          `width=${width},height=${height},left=${left},top=${top}`
        );
        
        // Check for successful callback (poll every second for up to 60 seconds)
        let checks = 0;
        const checkInterval = setInterval(async () => {
          checks++;
          
          if (authWindow.closed || checks > 60) {
            clearInterval(checkInterval);
            if (checks <= 60) {
              // Check status if window closed (could be success)
              setTimeout(() => {
                checkGoogleCalendarStatus();
              }, 1000);
            }
            return;
          }
          
          try {
            const connected = await checkGoogleCalendarStatus();
            if (connected) {
              clearInterval(checkInterval);
              authWindow.close();
              showNotification('✓ Google Calendar connected!', 'success');
            }
          } catch (err) {
            console.debug('[GoogleCalendar] Status check during auth:', err);
          }
        }, 1000);
      } else {
        showNotification('Failed to get authorization URL', 'error');
      }
    } catch (err) {
      console.error('[GoogleCalendar] Auth initiation failed:', err);
      showNotification('Failed to connect to Google Calendar: ' + err.message, 'error');
    }
  }

  // Manual sync: push TMR events to Google Calendar and fetch new ones
  async function syncWithGoogleCalendar() {
    try {
      const syncBtn = document.getElementById('gcal-sync-btn');
      const mobileSyncBtn = document.getElementById('mobile-gcal-sync-btn');
      
      if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.classList.add('gcal-syncing');
      }
      if (mobileSyncBtn) {
        mobileSyncBtn.disabled = true;
        mobileSyncBtn.classList.add('gcal-syncing');
      }
      
      const userId = getGoogleCalendarUserId();
      
      // Get all TMR events
      const allEvents = JSON.parse(localStorage.getItem('tmr_events') || '[]');
      
      // Get last sync timestamp
      const lastSyncTime = parseInt(localStorage.getItem('last_gcal_sync') || '0');
      
      // Filter events: only sync new events or recently modified ones
      const eventsToSync = allEvents.filter(event => {
        // If event has no googleEventId, it's new and should be synced
        if (!event.googleEventId) return true;
        
        // If event was modified after last sync, it should be synced
        const eventModified = parseInt(event.lastModified || event.modifiedAt || 0);
        if (eventModified > lastSyncTime) return true;
        
        // Otherwise, skip (already synced and not modified)
        return false;
      });
      
      console.log('[GoogleCalendar] Starting manual sync - Total events:', allEvents.length, 'Events to sync:', eventsToSync.length);
      
      // Only push if there are events to sync
      let pushData = null;
      if (eventsToSync.length > 0) {
        // Push TMR events to Google Calendar
        const pushRes = await serverFetch('/sync/google-calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, events: eventsToSync })
        });
        
        pushData = await pushRes.json();
        console.log('[GoogleCalendar] Push sync result:', pushData);
        
        // Update TMR events with googleEventIds from the response
        if (pushData.results) {
          const updatedEvents = JSON.parse(localStorage.getItem('tmr_events') || '[]');
          for (const result of pushData.results) {
            if ((result.action === 'created' || result.action === 'linked') && result.googleId) {
              const tmrEventIdx = updatedEvents.findIndex(e => e.id === result.tmrId);
              if (tmrEventIdx >= 0) {
                updatedEvents[tmrEventIdx].googleEventId = result.googleId;
                console.log('[GoogleCalendar] Updated TMR event with googleEventId:', result.tmrId, '->', result.googleId);
              }
            }
          }
          localStorage.setItem('tmr_events', JSON.stringify(updatedEvents));
        }
      } else {
        console.log('[GoogleCalendar] No new or modified events to sync');
      }
      
      // Fetch Google Calendar events (last month + next year)
      const fetchRes = await serverFetch(`/sync/google-calendar/fetch?userId=${encodeURIComponent(userId)}&daysBack=30&daysForward=365`);
      const fetchData = await fetchRes.json();
      
      if (fetchData.ok && fetchData.events) {
        console.log('[GoogleCalendar] Fetched', fetchData.events.length, 'events from Google Calendar');
        
        // Merge with existing TMR events (Google Calendar events take precedence for updates)
        const existingEvents = JSON.parse(localStorage.getItem('tmr_events') || '[]');
        const googleEventIds = new Set(fetchData.events.map(e => e.googleEventId));
        
        // Remove events that were deleted from Google Calendar
        const filteredEvents = existingEvents.filter(e => {
          // Keep events without googleEventId (local-only events)
          if (!e.googleEventId) return true;
          // Keep events that still exist in Google Calendar
          if (googleEventIds.has(e.googleEventId)) return true;
          // Remove events that were deleted from Google Calendar
          console.log('[GoogleCalendar] Removing event that was deleted from Google Calendar:', e.title, 'googleEventId:', e.googleEventId);
          return false;
        });
        
        // Now merge the fetched Google Calendar events
        for (const gcEvent of fetchData.events) {
          // Check if event already exists by googleEventId first (most reliable)
          let existingIdx = filteredEvents.findIndex(e => e.googleEventId === gcEvent.googleEventId);
          
          // If not found by googleEventId, try matching title + date + time (for events synced before mapping)
          if (existingIdx < 0) {
            existingIdx = filteredEvents.findIndex(e => 
              e.title === gcEvent.title && e.date === gcEvent.date && e.time === gcEvent.time
            );
          }
          
          if (existingIdx >= 0) {
            // Event already exists, update it with Google Calendar data (preserve googleEventId)
            const existingEvent = filteredEvents[existingIdx];
            existingEvent.googleEventId = gcEvent.googleEventId;
            existingEvent.color = gcEvent.color; // Update color from Google Calendar
            // Preserve notes if Google Calendar event has no description
            if (gcEvent.notes) {
              existingEvent.notes = gcEvent.notes;
            }
            // Add Google reminders if present
            if (gcEvent.googleReminders && gcEvent.googleReminders.length > 0) {
              existingEvent.googleReminders = gcEvent.googleReminders;
            }
            console.log('[GoogleCalendar] Updated existing event:', existingEvent.title, 'with googleEventId:', gcEvent.googleEventId);
          } else {
            // New event from Google Calendar
            const newEvent = {
              id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
              title: gcEvent.title,
              date: gcEvent.date,
              time: gcEvent.time,
              notes: gcEvent.notes,
              color: gcEvent.color,
              googleEventId: gcEvent.googleEventId,
              syncedFromGoogle: true
            };
            
            // If Google Calendar event has reminders, add them as TMR reminders
            if (gcEvent.googleReminders && gcEvent.googleReminders.length > 0) {
              newEvent.googleReminders = gcEvent.googleReminders;
            }
            
            filteredEvents.push(newEvent);
            console.log('[GoogleCalendar] Added new event from Google Calendar:', newEvent.title);
          }
        }
        
        localStorage.setItem('tmr_events', JSON.stringify(filteredEvents));
        
        // Save sync timestamp
        localStorage.setItem('last_gcal_sync', Date.now().toString());
        
        // Trigger calendar re-render
        try {
          window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { synced: true } }));
        } catch (e) { }
        
        const syncedCount = pushData ? (pushData.syncedCount || 0) : 0;
        const fetchedCount = fetchData.events.length || 0;
        showNotification(`✓ Synced ${syncedCount} new/modified events, fetched ${fetchedCount} from Google Calendar`, 'success');
      }
    } catch (err) {
      console.error('[GoogleCalendar] Sync failed:', err);
      showNotification('Sync failed: ' + err.message, 'error');
    } finally {
      const syncBtn = document.getElementById('gcal-sync-btn');
      const mobileSyncBtn = document.getElementById('mobile-gcal-sync-btn');
      
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.classList.remove('gcal-syncing');
      }
      if (mobileSyncBtn) {
        mobileSyncBtn.disabled = false;
        mobileSyncBtn.classList.remove('gcal-syncing');
      }
    }
  }

  // Show notification to user
  function showNotification(message, type = 'info') {
    console.log('[GoogleCalendar]', type.toUpperCase(), message);
    
    // Try to show browser notification if available
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Google Calendar', { body: message });
    }
    
    // Also show in-page notification (you can enhance this)
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'error' ? '#ff6b6b' : type === 'success' ? '#51cf66' : '#0089f1'};
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 10000;
      font-size: 14px;
      max-width: 400px;
      animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // Add animation styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  // Logout and disconnect from Google Calendar
  async function logoutGoogleCalendar() {
    try {
      const userId = getGoogleCalendarUserId();
      
      if (!userId) {
        showNotification('No user connected', 'error');
        return;
      }
      
      // Ask user to confirm before clearing calendar
      const shouldClear = confirm(
        'Disconnect from Google Calendar?\n\n' +
        '• Your Google Calendar will be disconnected\n' +
        '• Local events will be cleared\n' +
        '• You can export your calendar before disconnecting\n\n' +
        'Click OK to continue, or Cancel to go back.'
      );
      
      if (!shouldClear) return;
      
      // Show logout loading state
      const logoutBtn = document.getElementById('gcal-logout-btn');
      const mobileLogoutBtn = document.getElementById('mobile-gcal-logout-btn');
      if (logoutBtn) logoutBtn.disabled = true;
      if (mobileLogoutBtn) mobileLogoutBtn.disabled = true;
      
      // Call server to revoke tokens
      let res;
      try {
        res = await serverFetch('/auth/google/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        });
      } catch (fetchErr) {
        console.error('[GoogleCalendar] Fetch error:', fetchErr);
        throw new Error('Failed to reach server: ' + fetchErr.message);
      }
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Server returned status ' + res.status);
      }
      
      const data = await res.json();
      console.log('[GoogleCalendar] Logout response:', data);
      
      // Clear local state
      localStorage.removeItem(GCAL_USER_ID_KEY);
      localStorage.removeItem(GCAL_STATUS_KEY);
      localStorage.removeItem('tmr_events'); // Clear local calendar
      
      // Reset UI
      updateGoogleCalendarButtons(false);
      
      showNotification('✓ Disconnected from Google Calendar', 'success');
      
      // Reload page to reset state
      setTimeout(() => {
        location.reload();
      }, 500);
      
    } catch (err) {
      console.error('[GoogleCalendar] Logout failed:', err);
      showNotification('Logout failed: ' + err.message, 'error');
      const logoutBtn = document.getElementById('gcal-logout-btn');
      const mobileLogoutBtn = document.getElementById('mobile-gcal-logout-btn');
      if (logoutBtn) logoutBtn.disabled = false;
      if (mobileLogoutBtn) mobileLogoutBtn.disabled = false;
    }
  }

  // Set up hourly auto-sync
  function setupAutoSync() {
    // First check connection status
    checkGoogleCalendarStatus();
    
    // Auto-sync every 10 minutes if connected
    setInterval(async () => {
      try {
        const connected = await checkGoogleCalendarStatus();
        if (connected) {
          console.log('[GoogleCalendar] Running auto-sync');
          await syncWithGoogleCalendar();
        }
      } catch (err) {
        console.debug('[GoogleCalendar] Auto-sync error:', err);
      }
    }, 10 * 60 * 1000); // 10 minutes
  }

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const authBtn = document.getElementById('gcal-auth-btn');
    const syncBtn = document.getElementById('gcal-sync-btn');
    const logoutBtn = document.getElementById('gcal-logout-btn');
    const mobileAuthBtn = document.getElementById('mobile-gcal-auth-btn');
    const mobileSyncBtn = document.getElementById('mobile-gcal-sync-btn');
    const mobileLogoutBtn = document.getElementById('mobile-gcal-logout-btn');
    const mobileMenuBtn = document.getElementById('mobile-gcal-menu-btn');
    const gcalModalBackdrop = document.getElementById('gcal-mobile-modal-backdrop');
    const gcalModalClose = document.getElementById('gcal-mobile-modal-close');
    
    if (authBtn) {
      authBtn.addEventListener('click', initiateGoogleAuth);
    }
    
    if (syncBtn) {
      syncBtn.addEventListener('click', syncWithGoogleCalendar);
    }
    
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logoutGoogleCalendar);
    }
    
    if (mobileAuthBtn) {
      mobileAuthBtn.addEventListener('click', initiateGoogleAuth);
    }
    
    if (mobileSyncBtn) {
      mobileSyncBtn.addEventListener('click', syncWithGoogleCalendar);
    }
    
    if (mobileLogoutBtn) {
      mobileLogoutBtn.addEventListener('click', logoutGoogleCalendar);
    }
    
    // Mobile menu button opens Google Calendar modal
    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', async () => {
        if (gcalModalBackdrop) {
          // Make sure buttons are updated before showing modal
          const connected = await checkGoogleCalendarStatus();
          updateGoogleCalendarButtons(connected);
          gcalModalBackdrop.style.display = 'flex';
        }
      });
    }
    
    // Close button for Google Calendar modal
    if (gcalModalClose) {
      gcalModalClose.addEventListener('click', () => {
        if (gcalModalBackdrop) {
          gcalModalBackdrop.style.display = 'none';
        }
      });
    }
    
    // Close modal when clicking outside
    if (gcalModalBackdrop) {
      gcalModalBackdrop.addEventListener('click', (e) => {
        if (e.target === gcalModalBackdrop) {
          gcalModalBackdrop.style.display = 'none';
        }
      });
    }
    
    // Check for OAuth callback
    const params = new URLSearchParams(location.search);
    if (params.get('gcal_auth') === 'success') {
      const userId = params.get('userId');
      if (userId) {
        setGoogleCalendarUserId(userId);
      }
      // Remove from URL
      window.history.replaceState({}, document.title, location.pathname);
      
      showNotification('✓ Google Calendar authenticated!', 'success');
      checkGoogleCalendarStatus();
    }
    
    // Set up auto-sync and check status
    setupAutoSync();
  });

  // Export for external use
  window.GoogleCalendarClient = {
    checkStatus: checkGoogleCalendarStatus,
    initiateAuth: initiateGoogleAuth,
    manualSync: syncWithGoogleCalendar,
    logout: logoutGoogleCalendar,
    getDeviceId: getDeviceId,
    getGoogleCalendarUserId: getGoogleCalendarUserId,
    setGoogleCalendarUserId: setGoogleCalendarUserId
  };
})();
