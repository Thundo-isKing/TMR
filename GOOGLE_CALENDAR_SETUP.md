# Google Calendar Integration - Implementation Guide

## Overview
Full bi-directional synchronization between TMR and Google Calendar with the following features:

1. **Cross Synchronization**: Events sync both ways (TMR ↔ Google Calendar)
2. **TMR-Heavy Reminders**: Google Calendar reminders sync to TMR, but TMR reminders don't force Google Calendar notifications
3. **Manual + Automatic Sync**: Button for manual sync + automatic hourly sync

## Setup Instructions

### 1. Get Google Calendar OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Google Calendar API**
4. Create OAuth 2.0 credentials:
   - Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client IDs**
   - Application type: **Desktop application**
   - Download JSON credentials
5. Copy the credentials:
   - `client_id` → `GOOGLE_CLIENT_ID` in .env
   - `client_secret` → `GOOGLE_CLIENT_SECRET` in .env

### 2. Update .env File

```env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3002/auth/google/callback
```

### 3. Install Dependencies

```bash
cd server
npm install
```

This adds:
- `googleapis`: Google Calendar API client
- `google-auth-library`: OAuth 2.0 authentication

### 4. Database Changes

New tables created automatically:
- `google_calendar_tokens`: Stores user OAuth tokens (refresh tokens for persistent access)
- `event_sync_mapping`: Maps TMR event IDs to Google Calendar event IDs
- `sync_log`: Tracks sync operations for debugging

## Frontend Implementation

### UI Elements Added

1. **Google Calendar Connection Button** (🔗 Google Calendar)
   - Shows when not connected
   - Initiates OAuth flow in popup window
   - Auto-detects successful authentication

2. **Sync Button** (🔄 Sync)
   - Shows only when connected to Google Calendar
   - Manual trigger for immediate sync
   - Disabled during sync operation

### Features

**Manual Sync** (`/sync/google-calendar`):
- Push all TMR events to Google Calendar
- Create new events or update existing ones
- Track which events came from where via event mapping

**Fetch Google Calendar Events** (`/sync/google-calendar/fetch`):
- Fetches all Google Calendar events for next 90 days
- Extracts reminders from Google Calendar (for TMR-heavy approach)
- Merges with existing TMR events (avoids duplicates)

**Auto Sync**:
- Runs every 60 minutes automatically
- Only syncs if user is connected to Google Calendar
- Background operation (doesn't block UI)

## API Endpoints

### OAuth Flow

**GET** `/auth/google?userId=<user_id>`
- Returns OAuth authorization URL
- Response: `{ authUrl: "https://accounts.google.com/..." }`

**GET** `/auth/google/callback?code=<code>&state=<state>`
- Callback endpoint after user authorizes
- Exchanges code for tokens
- Saves tokens to database
- Redirects to `/TMR.html?gcal_auth=success`

**GET** `/auth/google/status?userId=<user_id>`
- Check if user has valid Google Calendar connection
- Response: `{ connected: true/false }`

### Sync Operations

**POST** `/sync/google-calendar`
```json
{
  "userId": "user_id",
  "events": [
    {
      "id": "evt_...",
      "title": "Event Title",
      "date": "2025-01-15",
      "time": "14:00",
      "notes": "Description",
      "color": "#0089f1"
    }
  ]
}
```
Response: `{ ok: true, synced: 5, results: [...] }`

**GET** `/sync/google-calendar/fetch?userId=<user_id>&days=90`
- Fetch events from Google Calendar for next N days
- Response: `{ ok: true, events: [...], count: 5 }`

## Event Model

### TMR Event Format
```javascript
{
  id: "evt_...",
  title: "Event Title",
  date: "2025-01-15",        // YYYY-MM-DD
  time: "14:00",             // HH:MM
  notes: "Description",
  color: "#0089f1",
  googleEventId: "abc123...", // Mapped to Google Calendar
  syncedFromGoogle: true,    // Flag for synced events
  googleReminders: [         // TMR-heavy: reminders from Google
    { type: "minutes", minutes: 30, timestamp: 1234567890 }
  ]
}
```

### Google Calendar Reminder Extraction
When events are fetched from Google Calendar:
1. Google Calendar's native reminders are extracted
2. Converted to TMR reminder objects
3. Stored in `googleReminders` array
4. Used to create TMR reminders for the user

**Important**: TMR reminders don't push back to Google Calendar (TMR-heavy approach)

## Color Mapping

TMR colors map to Google Calendar color IDs:

| TMR Color | Google ID | Name |
|-----------|-----------|------|
| #0089f1 | 8 | Blue |
| #ff6b6b | 11 | Red |
| #51cf66 | 2 | Green |
| #ffd43b | 5 | Yellow |
| #9775fa | 3 | Grape |
| #ff922b | 6 | Tangerine |
| #00d084 | 10 | Sage |
| #ff6b9d | 4 | Flamingo |

## Token Refresh

Tokens are automatically refreshed when:
1. Token expiry date is reached
2. New tokens are saved to database
3. User doesn't need to re-authenticate

## Error Handling

Common issues and solutions:

**"Google Calendar not configured"**
- Missing `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` in .env

**"Authentication failed"**
- Ensure Google OAuth consent screen is configured
- Check redirect URI matches in Google Cloud Console

**"Failed to fetch events"**
- May need to wait for token refresh
- Check token has Calendar API scope

## Security Notes

1. OAuth tokens are stored in SQLite database
2. Refresh tokens are stored (never expires like access tokens)
3. In production: Use encrypted database and HTTPS only
4. Never commit `.env` file with real credentials

## Future Enhancements

1. **Two-way reminder sync**: Allow TMR reminders to set Google Calendar notifications
2. **Conflict resolution**: Handle when same event edited in both apps
3. **Selective sync**: Allow user to choose which calendars to sync
4. **Selective event sync**: Sync only certain event types/tags
5. **Webhook-based sync**: Real-time sync instead of polling

## Testing Checklist

- [ ] Install packages: `npm install`
- [ ] Add Google OAuth credentials to .env
- [ ] Start server: `npm start`
- [ ] Load TMR.html
- [ ] Click "🔗 Google Calendar" button
- [ ] Complete OAuth flow in popup
- [ ] Verify button changes to "🔄 Sync"
- [ ] Create event in Google Calendar
- [ ] Click "🔄 Sync" button
- [ ] Verify event appears in TMR
- [ ] Create event in TMR
- [ ] Click "🔄 Sync"
- [ ] Verify event appears in Google Calendar
- [ ] Wait 1 hour and verify auto-sync runs

