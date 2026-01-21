# Apple Calendar Sync (Foundation)

TMR’s Apple Calendar integration is **not** implemented by logging into iCloud from the server.
Apple Calendar data lives on Apple devices and is accessed via **EventKit** (iOS/macOS).

The intended architecture is:

- **Server (TMR)** stores events plus cross-provider mapping fields.
- **iOS agent app** (future) uses EventKit to read/write Apple Calendar.
- The iOS agent talks to TMR via HTTPS endpoints under `/sync/apple/*`.

This document defines the event mapping fields and the initial server endpoints so the native agent has a stable contract.

## Why an iOS agent is required

Apple does not provide a supported “server-side EventKit” API. EventKit is an on-device framework.
So any Apple Calendar sync must run on iOS/macOS.

## Event identity + mapping fields

The TMR event table now supports these optional fields:

- `provider`: String. Example: `"apple"`, `"google"`, `"manual"`.
- `externalId`: String. Provider event identity.
  - For EventKit, the most stable choice is **`calendarItemIdentifier`**.
- `externalCalendarId`: String. Provider calendar identity (e.g., an EKCalendar identifier).
- `syncState`: String. Suggested values:
  - `linked` (normal), `pending`, `conflict`, `deleted` (tombstone), `ignored`.
- `lastSyncedAt`: Epoch ms. When this record was last reconciled with the provider.
- `sourceDevice`: String. Identifier of the device/agent that performed the sync.

### Notes about recurring events (future)

Recurring events need an additional *instance identity* (occurrence). EventKit has recurrence + occurrences, and provider IDs can behave differently.
For now, the server stores a single `externalId` and treats each record as a single event.
When we implement recurrence, we’ll likely add:

- `externalInstanceId` (or similar): provider-specific occurrence identifier
- and/or `recurrenceRule`/`rrule` fields

## Sync semantics (baseline)

- **Do not overwrite mapping fields with nulls.**
  - Server-side updates preserve existing mapping fields when clients omit them.
- **Only the sync agent should set/modify mapping fields** in the normal flow.
  - Web UI can edit title/time/etc without destroying mapping.

## Initial server endpoints

These endpoints are present as the initial foundation.

## Authentication

For now, the server supports:

- **Cookie auth** (web app): `tmr_session` cookie
- **Bearer auth** (native agent): `Authorization: Bearer <tmr_session>`
- **Device auth** (recommended for native agents): `Authorization: Device <deviceToken>`

To bootstrap a native agent during development, you can retrieve the current session token:

- `GET /auth/token` (requires cookie auth) → returns the token and expiry

To register a long-lived device token (recommended for the iOS agent):

- `POST /sync/devices/register` (requires cookie or bearer auth)
  - Body: `{ "label": "my-iphone" }` (optional)
  - Returns: `{ deviceToken, device: { id, deviceId } }`
  - Use it on-device as: `Authorization: Device <deviceToken>`

### GET `/sync/apple/status`

Returns a small capability payload.

### GET `/sync/apple/events/changes?since=<ms>`

Returns Apple-linked events updated since the given epoch-ms timestamp.

### GET `/sync/events/changes?since=<ms>`

Returns *all* events updated since the given epoch-ms timestamp (provider-agnostic). This is intended for the iOS agent to pull server-side changes (e.g. events created/edited in the web app) and mirror them into Apple Calendar.

### POST `/sync/apple/events/upsert`

Upserts Apple-sourced events into TMR.

Request body:

```json
{
  "sourceDevice": "ios-iphone15",
  "events": [
    {
      "externalId": "<EventKit calendarItemIdentifier>",
      "externalCalendarId": "<EKCalendar identifier>",
      "title": "Meeting",
      "date": "2026-01-19",
      "startTime": "09:00",
      "endTime": "10:00",
      "description": "Optional notes",
      "syncState": "linked",
      "lastSyncedAt": 1768880522609
    }
  ]
}
```

Rules:

- Required per event: `externalId`, `title`, `date`.
- `provider` is forced to `"apple"` by the server.
- Events are matched by `(userId, provider, externalId)`.

## Next steps

- Build the on-device iOS agent (EventKit) scaffold lives in `ios-agent/`.

- Decide a long-term auth mechanism for the iOS agent (device registration + revocation) beyond reusing the session token.
- Add conflict policy: decide whether `updatedAt` (server) or provider timestamps win.
- Add delete propagation (tombstones) and recurrence handling.
