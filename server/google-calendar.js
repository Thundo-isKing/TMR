/**
 * Google Calendar Integration Module
 * Handles bi-directional sync between TMR and Google Calendar
 * - Syncs Google Calendar reminders to TMR (TMR-heavy approach)
 * - Syncs TMR events to Google Calendar
 * - Maintains mapping between event IDs
 */

const { google } = require('googleapis');
const { OAuth2 } = google.auth;

class GoogleCalendarManager {
  constructor(clientId, clientSecret, redirectUri, db) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.db = db;
    this.oauth2Client = new OAuth2(clientId, clientSecret, redirectUri);
  }

  /**
   * Get OAuth 2.0 authorization URL for user
   */
  getAuthUrl(state) {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      state: state
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      return tokens;
    } catch (err) {
      console.error('[GoogleCalendar] Failed to exchange code for tokens:', err);
      throw err;
    }
  }

  /**
   * Save tokens to database
   */
  saveTokens(userId, tokens, cb) {
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresAt = tokens.expiry_date;

    this.db.saveGoogleCalendarToken(userId, accessToken, refreshToken, expiresAt, (err) => {
      if (cb) cb(err);
    });
  }

  /**
   * Get valid tokens for user (refresh if needed)
   */
  async getValidTokens(userId) {
    return new Promise((resolve, reject) => {
      this.db.getGoogleCalendarToken(userId, async (err, row) => {
        if (err || !row) {
          reject(new Error('No Google Calendar tokens found for user'));
          return;
        }

        try {
          this.oauth2Client.setCredentials({
            access_token: row.accessToken,
            refresh_token: row.refreshToken,
            expiry_date: row.expiresAt
          });

          // Check if token is expired and refresh if needed
          if (row.expiresAt && row.expiresAt < Date.now()) {
            console.log('[GoogleCalendar] Token expired, refreshing...');
            const { credentials } = await this.oauth2Client.refreshAccessToken();
            
            // Save new tokens
            this.db.saveGoogleCalendarToken(userId, credentials.access_token, credentials.refresh_token, credentials.expiry_date, (err) => {
              if (err) console.warn('[GoogleCalendar] Failed to save refreshed tokens:', err);
            });
            
            this.oauth2Client.setCredentials(credentials);
            resolve(credentials);
          } else {
            resolve({
              access_token: row.accessToken,
              refresh_token: row.refreshToken,
              expiry_date: row.expiresAt
            });
          }
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * Get the primary calendar ID for the user
   */
  async getPrimaryCalendarId(userId) {
    try {
      await this.getValidTokens(userId);
      const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
      const result = await calendar.calendarList.list();
      
      if (result.data.items && result.data.items.length > 0) {
        const primaryCal = result.data.items.find(cal => cal.primary) || result.data.items[0];
        return primaryCal.id;
      }
      throw new Error('No calendars found');
    } catch (err) {
      console.error('[GoogleCalendar] Failed to get primary calendar:', err);
      throw err;
    }
  }

  /**
   * Fetch events from Google Calendar (all calendars)
   */
  async fetchGoogleCalendarEvents(userId, timeMin, timeMax) {
    try {
      await this.getValidTokens(userId);
      const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

      // Get all calendars
      const calendarList = await calendar.calendarList.list();
      const calendars = calendarList.data.items || [];
      
      console.log('[GoogleCalendar] Found', calendars.length, 'calendars to sync from');
      
      let allEvents = [];
      
      // Fetch events from each calendar
      for (const cal of calendars) {
        try {
          console.log('[GoogleCalendar] Fetching from calendar:', cal.summary);
          const result = await calendar.events.list({
            calendarId: cal.id,
            timeMin: timeMin,
            timeMax: timeMax,
            maxResults: 1000,
            singleEvents: true,
            orderBy: 'startTime'
          });
          
          const events = result.data.items || [];
          console.log('[GoogleCalendar]', cal.summary, 'has', events.length, 'events');
          allEvents = allEvents.concat(events);
        } catch (err) {
          console.warn('[GoogleCalendar] Failed to fetch from calendar', cal.summary, ':', err.message);
        }
      }
      
      return allEvents;
    } catch (err) {
      console.error('[GoogleCalendar] Failed to fetch events:', err);
      throw err;
    }
  }

  /**
   * Create event in Google Calendar
   */
  async createGoogleCalendarEvent(userId, tmrEvent) {
    try {
      await this.getValidTokens(userId);
      const calendarId = await this.getPrimaryCalendarId(userId);
      const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

      // Convert TMR event to Google Calendar format
      const gcEvent = {
        summary: tmrEvent.title,
        description: tmrEvent.notes || '',
        start: {
          dateTime: this.tmrEventToDateTime(tmrEvent.date, tmrEvent.time),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        end: {
          dateTime: this.addHours(this.tmrEventToDateTime(tmrEvent.date, tmrEvent.time), 1),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        colorId: this.mapColorToGoogleColorId(tmrEvent.color || '#0089f1')
      };

      // If TMR event has reminders, add them (don't force Google Calendar reminders from TMR)
      // We only sync Google Calendar reminders TO TMR, not vice versa

      const result = await calendar.events.insert({
        calendarId: calendarId,
        requestBody: gcEvent
      });

      return result.data;
    } catch (err) {
      console.error('[GoogleCalendar] Failed to create event:', err);
      throw err;
    }
  }

  /**
   * Update event in Google Calendar
   */
  async updateGoogleCalendarEvent(userId, googleEventId, tmrEvent) {
    try {
      await this.getValidTokens(userId);
      const calendarId = await this.getPrimaryCalendarId(userId);
      const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

      const gcEvent = {
        summary: tmrEvent.title,
        description: tmrEvent.notes || '',
        start: {
          dateTime: this.tmrEventToDateTime(tmrEvent.date, tmrEvent.time),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        end: {
          dateTime: this.addHours(this.tmrEventToDateTime(tmrEvent.date, tmrEvent.time), 1),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      };

      const result = await calendar.events.update({
        calendarId: calendarId,
        eventId: googleEventId,
        requestBody: gcEvent
      });

      return result.data;
    } catch (err) {
      console.error('[GoogleCalendar] Failed to update event:', err);
      throw err;
    }
  }

  /**
   * Delete event from Google Calendar
   */
  async deleteGoogleCalendarEvent(userId, googleEventId) {
    try {
      await this.getValidTokens(userId);
      const calendarId = await this.getPrimaryCalendarId(userId);
      const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

      await calendar.events.delete({
        calendarId: calendarId,
        eventId: googleEventId
      });

      return true;
    } catch (err) {
      console.error('[GoogleCalendar] Failed to delete event:', err);
      throw err;
    }
  }

  /**
   * Sync reminders from Google Calendar event to TMR
   * Returns array of reminder objects for TMR
   */
  extractRemindersFromGoogleEvent(googleEvent) {
    const reminders = [];
    
    if (googleEvent.reminders && googleEvent.reminders.overrides) {
      googleEvent.reminders.overrides.forEach(reminder => {
        if (reminder.method === 'notification' || reminder.method === 'alert') {
          // Convert minutes before to timestamp
          const eventStart = new Date(googleEvent.start.dateTime || googleEvent.start.date);
          const reminderTime = eventStart.getTime() - (reminder.minutes * 60 * 1000);
          
          reminders.push({
            type: 'minutes',
            minutes: reminder.minutes,
            timestamp: reminderTime
          });
        }
      });
    }
    
    return reminders;
  }

  /**
   * Convert TMR event date/time to ISO string
   */
  tmrEventToDateTime(dateStr, timeStr) {
    // dateStr: YYYY-MM-DD, timeStr: HH:MM
    if (!dateStr) throw new Error('Date is required');
    
    const [year, month, day] = dateStr.split('-');
    const [hours = '09', minutes = '00'] = (timeStr || '09:00').split(':');
    
    return `${year}-${month}-${day}T${hours}:${minutes}:00`;
  }

  /**
   * Add hours to an ISO datetime string
   */
  addHours(dateTimeStr, hours) {
    const date = new Date(dateTimeStr);
    date.setHours(date.getHours() + hours);
    return date.toISOString().split('.')[0];
  }

  /**
   * Map hex color to Google Calendar color ID
   */
  mapColorToGoogleColorId(hexColor) {
    // Google Calendar color IDs: 1-11
    // Map common colors
    const colorMap = {
      '#0089f1': '8',  // Blue
      '#ff6b6b': '11', // Red
      '#51cf66': '2',  // Green
      '#ffd43b': '5',  // Yellow
      '#9775fa': '3',  // Grape
      '#ff922b': '6',  // Tangerine
      '#00d084': '10', // Sage
      '#ff6b9d': '4'   // Flamingo
    };
    
    return colorMap[hexColor] || '8'; // Default to blue
  }

  /**
   * Map Google Calendar color ID to hex color
   */
  mapGoogleColorIdToHex(colorId) {
    // Google Calendar color ID to hex mapping
    const colorMap = {
      '1': '#a4bdfc',   // Peacock
      '2': '#7ae7bf',   // Sage
      '3': '#dbadff',   // Grape
      '4': '#ff887c',   // Flamingo
      '5': '#fbd75b',   // Banana
      '6': '#ffb878',   // Tangerine
      '7': '#46d6db',   // Blueberry
      '8': '#0b8043',   // Basil
      '9': '#d50000',   // Tomato
      '10': '#f691b2',  // Flamingo (alt)
      '11': '#ff6e6e'   // Cranberry
    };
    
    return colorMap[colorId] || '#0089f1'; // Default to blue
  }

  /**
   * Convert Google Calendar event to TMR format
   */
  googleEventToTmrEvent(googleEvent, color = null) {
    const startDateTime = new Date(googleEvent.start.dateTime || googleEvent.start.date);
    const date = startDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
    const time = startDateTime.toISOString().split('T')[1].substring(0, 5); // HH:MM

    // Use Google Calendar's color if available, otherwise use provided color or default
    let eventColor = color;
    if (googleEvent.colorId) {
      eventColor = this.mapGoogleColorIdToHex(googleEvent.colorId);
    }
    if (!eventColor) {
      eventColor = '#0089f1'; // Default blue
    }

    return {
      title: googleEvent.summary || 'Untitled',
      date: date,
      time: time,
      notes: googleEvent.description || '',
      color: eventColor,
      googleEventId: googleEvent.id // Store for reference
    };
  }

  /**
   * Search for an existing Google Calendar event by title and date
   * Used to prevent duplicates during sync
   */
  async searchExistingEvent(userId, title, date, time) {
    try {
      await this.getValidTokens(userId);
      const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
      
      // Get all calendars (primary + secondary + holidays)
      const calendarList = await calendar.calendarList.list({ maxResults: 100 });
      const calendars = calendarList.data.items || [];
      
      // Normalize time format for comparison
      const parseTime = (timeStr) => {
        if (!timeStr) return null;
        const [h, m] = timeStr.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        return { h, m };
      };
      
      const normalizedSearchTime = parseTime(time);
      
      // Search for events on the specified date with the given title
      const [year, month, day] = date.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0).toISOString();
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59).toISOString();
      
      // Search across all calendars
      for (const cal of calendars) {
        try {
          const result = await calendar.events.list({
            calendarId: cal.id,
            timeMin: startOfDay,
            timeMax: endOfDay,
            maxResults: 250,
            singleEvents: true
          });
          
          const events = result.data.items || [];
          
          // Find exact match by title and optionally time
          for (const e of events) {
            // Must match title exactly (case-insensitive)
            if (e.summary && e.summary.toLowerCase() === title.toLowerCase()) {
              
              // If time is provided, also check time match
              if (normalizedSearchTime && e.start && e.start.dateTime) {
                try {
                  const gcEventTime = new Date(e.start.dateTime);
                  const gcH = gcEventTime.getHours();
                  const gcM = gcEventTime.getMinutes();
                  
                  // Must match time exactly
                  if (gcH === normalizedSearchTime.h && gcM === normalizedSearchTime.m) {
                    console.log('[GoogleCalendar] Found existing event in', cal.summary, ':', e.id, '(title + time match)');
                    return e;
                  }
                } catch (timeErr) {
                  console.debug('[GoogleCalendar] Error parsing event time:', timeErr.message);
                }
              } else if (!normalizedSearchTime) {
                // No time provided, accept match with just title and date
                console.log('[GoogleCalendar] Found existing event in', cal.summary, ':', e.id, '(title + date match, no time specified)');
                return e;
              }
            }
          }
        } catch (err) {
          console.warn('[GoogleCalendar] Error searching calendar', cal.summary, ':', err.message);
        }
      }
      
      return null;
    } catch (err) {
      console.error('[GoogleCalendar] Search error:', err);
      return null;
    }
  }
}

module.exports = GoogleCalendarManager;
