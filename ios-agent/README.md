# iOS Apple Calendar Sync Agent (EventKit)

This repo’s server is now ready for an on-device iOS agent that syncs Apple Calendar via EventKit.

## Why an iOS agent?
Apple Calendar/iCloud events are not accessible server-side. The agent runs on the user’s device, reads/writes via EventKit, and talks to the TMR server over HTTPS.

## Server endpoints you’ll use
- `POST /sync/devices/register` (one-time, returns `deviceToken`)
- `POST /sync/apple/events/upsert` (push Apple → server)
- `GET /sync/apple/events/changes?since=<ms>&includeDeleted=1` (pull Apple-linked server rows)
- `GET /sync/events/changes?since=<ms>&includeDeleted=1` (pull all server changes for bidirectional sync)

Auth for the agent:
- `Authorization: Device <deviceToken>`

## One-time setup (get a device token)
1) Start the server.
2) Log in via the web app (cookie auth).
3) Register the device token.

Example (Node script) — easiest:
- Run `node tools/apple_sync_smoke_test.js` and copy the printed `deviceToken` from the JSON (or call `/sync/devices/register` manually).

Or with `curl` (after you already have a session cookie in `cookie.txt`):
- `curl -s -b cookie.txt -H "Content-Type: application/json" -d '{"label":"my-iphone"}' http://localhost:3002/sync/devices/register`

Store `deviceToken` in the iOS Keychain.

In this repo there’s a minimal helper you can copy:
- `DeviceTokenKeychain.swift`

## Xcode project checklist
1) Create a new iOS app (SwiftUI is fine).
2) Add `NSCalendarsUsageDescription` to `Info.plist`.
3) Add capability/entitlement if needed (EventKit only requires the privacy string; background sync is optional).

## Mapping (EventKit → TMR)
Use these stable identifiers:
- `externalId`: `EKEvent.eventIdentifier`
- `externalCalendarId`: `EKEvent.calendar.calendarIdentifier`
- `externalUpdatedAt`: `event.lastModifiedDate` in epoch-ms (if available)

Fields:
- `title`: `event.title ?? ""`
- `date`: `YYYY-MM-DD` (local calendar)
- `startTime`/`endTime`: `HH:mm` (local time) for timed events
- all-day events: set `date`, omit times

Deletes:
- When an event disappears from the device (deleted in Apple Calendar), call `/sync/apple/events/upsert` with `{ deleted: true }` for that `externalId`.

## Suggested sync loop (MVP)
Run on app launch and on a timer / background fetch:
1) **Pull server changes** since `lastServerSyncAt` via `/sync/events/changes`.
2) Apply server changes into EventKit:
   - if server event has `provider === 'apple'` and `externalId` exists → update that EKEvent
   - if server event has no `provider` (or provider != 'apple') → create new EKEvent in a chosen calendar, then upsert back to server (to link it)
   - if server event `deletedAt > 0` → delete corresponding EKEvent
3) **Push Apple changes** to server:
   - scan a date window (e.g., 30 days back / 365 forward)
   - upsert only events whose `lastModifiedDate` is newer than the last successful Apple push (fallback: upsert all in-window)
   - detect deletions by comparing the last-seen `externalId` set to the current scan and send `{ deleted: true }`
4) Save `lastServerSyncAt` and `lastAppleSyncAt`.

## Code skeleton
See:
- `AppleSyncClient.swift`
- `AppleEventKitSync.swift`
- `AppleSyncRunner.swift`
- `DeviceTokenKeychain.swift`
- `ServerConfigStore.swift`
- `DeviceTokenSetupView.swift`
- `AppleCalendarSelectionStore.swift`
- `AppleCalendarPickerView.swift`
- `AppleSeenIdsStore.swift`
- `SwiftUIIntegrationExample.swift` (copy/paste wiring for a SwiftUI app)

Key entry points:
- `AppleEventKitSync.pushAppleToServer(...)`
- `AppleEventKitSync.applyServerChangesToAppleCalendar(...)`

Minimal runner wiring (copy into your app):

```swift
let baseURL = URL(string: "https://YOUR_SERVER")!
let deviceToken = try DeviceTokenKeychain.load() ?? "..." // fetch from Keychain (or set it once)

let client = AppleSyncClient(config: .init(baseURL: baseURL, deviceToken: deviceToken))
let sync = AppleEventKitSync(client: client)
let runner = AppleSyncRunner(sync: sync, sourceDevice: "my-iphone")

try await runner.runOnce()
```

Periodic sync while the app is active:

```swift
runner.startPeriodicSync(intervalSeconds: 300) // every 5 minutes
// runner.stopPeriodicSync()
```

SwiftUI lifecycle example (recommended starting point):
- `SwiftUIIntegrationExample.swift`

These files are meant to be copied into your Xcode project.
