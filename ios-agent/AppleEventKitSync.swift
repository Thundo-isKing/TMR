import Foundation
import EventKit

/// EventKit sync logic (MVP) for Apple Calendar <-> TMR server.
///
/// Notes:
/// - EventKit access is per-device; store auth + deviceToken on device.
/// - Deletion detection requires tracking previously seen eventIdentifiers.
final class AppleEventKitSync {
    private let eventStore = EKEventStore()
    private let client: AppleSyncClient

    init(client: AppleSyncClient) {
        self.client = client
    }

    func upsertApplePayload(_ events: [[String: Any]], sourceDevice: String) async throws {
        try await client.upsertAppleEvents(events, sourceDevice: sourceDevice)
    }

    func requestCalendarAccess() async throws {
        try await withCheckedThrowingContinuation { cont in
            eventStore.requestFullAccessToEvents { granted, err in
                if let err { return cont.resume(throwing: err) }
                if !granted {
                    return cont.resume(throwing: NSError(domain: "EventKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Calendar access not granted"]))
                }
                cont.resume()
            }
        }
    }

    /// Push Apple events to server for a time window.
    ///
    /// For MVP: fetch a date range and upsert each event.
    func pushAppleToServer(daysBack: Int = 30, daysForward: Int = 365, sourceDevice: String) async throws {
        let changes = collectAppleChanges(daysBack: daysBack, daysForward: daysForward, sinceMs: nil)
        try await client.upsertAppleEvents(changes.upserts, sourceDevice: sourceDevice)
    }

    /// Scans EventKit in a window and returns:
    /// - `upserts`: payload for events modified since `sinceMs` (if provided)
    /// - `seenExternalIds`: all event identifiers seen in the scan window (for deletion detection)
    func collectAppleChanges(daysBack: Int, daysForward: Int, sinceMs: Int64?) -> (upserts: [[String: Any]], seenExternalIds: Set<String>) {
        let cal = Calendar.current
        let now = Date()
        let start = cal.date(byAdding: .day, value: -daysBack, to: now) ?? now
        let end = cal.date(byAdding: .day, value: daysForward, to: now) ?? now

        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = eventStore.events(matching: predicate)

        var seen = Set<String>()
        var upserts: [[String: Any]] = []

        for ev in events {
            guard let externalId = ev.eventIdentifier else { continue }
            seen.insert(externalId)

            if let sinceMs {
                let modifiedMs: Int64 = ev.lastModifiedDate.map { Int64($0.timeIntervalSince1970 * 1000.0) } ?? 0

                // If EventKit can't provide a modified time, include it (safe, just more chatty).
                if modifiedMs > 0, modifiedMs <= sinceMs {
                    continue
                }
            }

            upserts.append(Self.ekEventToUpsertPayload(ev))
        }

        return (upserts, seen)
    }

    /// Pull server-side changes since `sinceMs` and apply to EventKit (non-recurring MVP).
    ///
    /// Conflict policy (last-write-wins):
    /// - Compare server `updatedAt` to Apple `lastModifiedDate` (externalUpdatedAt).
    /// - If Apple is newer, push Apple -> server instead of overwriting.
    /// - Deletes win.
    func applyServerChangesToAppleCalendar(
        sinceMs: Int64,
        targetCalendarIdentifier: String? = nil,
        sourceDevice: String
    ) async throws {
        let serverEvents = try await client.fetchServerChanges(since: sinceMs, includeDeleted: true)

        let targetCalendar: EKCalendar? = {
            if let id = targetCalendarIdentifier {
                return eventStore.calendar(withIdentifier: id)
            }
            return eventStore.defaultCalendarForNewEvents
        }()

        var appleToServerUpserts: [[String: Any]] = []

        for e in serverEvents {
            let serverId = (e["id"] as? NSNumber)?.int64Value ?? Int64((e["id"] as? Int) ?? 0)
            if serverId == 0 { continue }

            let title = (e["title"] as? String) ?? ""
            let dateStr = (e["date"] as? String) ?? ""
            let startTime = e["startTime"] as? String
            let endTime = e["endTime"] as? String
            let notes = (e["description"] as? String) ?? (e["notes"] as? String) ?? ""

            let provider = (e["provider"] as? String) ?? ""
            let externalId = e["externalId"] as? String
            let externalCalendarId = e["externalCalendarId"] as? String

            let deletedAt = (e["deletedAt"] as? NSNumber)?.int64Value ?? Int64((e["deletedAt"] as? Int) ?? 0)
            let serverUpdatedAt = (e["updatedAt"] as? NSNumber)?.int64Value ?? Int64((e["updatedAt"] as? Int) ?? 0)

            // Deletions win.
            if deletedAt > 0 {
                if let externalId, let ek = eventStore.event(withIdentifier: externalId) {
                    try eventStore.remove(ek, span: .thisEvent, commit: true)
                }
                continue
            }

            // If linked, try to update existing EKEvent.
            if provider == "apple", let externalId {
                if let ek = eventStore.event(withIdentifier: externalId) {
                    let appleUpdatedAt: Int64 = ek.lastModifiedDate.map { Int64($0.timeIntervalSince1970 * 1000.0) } ?? 0

                    if appleUpdatedAt > 0, appleUpdatedAt > serverUpdatedAt {
                        // Apple newer -> push Apple -> server (do not overwrite Apple).
                        let up = Self.ekEventToUpsertPayload(ek)
                        appleToServerUpserts.append(up)
                        continue
                    }

                    // Server wins -> apply server fields to Apple.
                    ek.title = title
                    ek.notes = notes
                    try Self.applyServerDateAndTimes(to: ek, dateStr: dateStr, startTime: startTime, endTime: endTime)
                    try eventStore.save(ek, span: .thisEvent, commit: true)
                    continue
                }
                // Linked but missing locally -> fall through to create.
            }

            // Not linked (or missing local event): create a new EKEvent.
            guard let cal = targetCalendar else { continue }
            let newEk = EKEvent(eventStore: eventStore)
            newEk.calendar = cal
            newEk.title = title
            newEk.notes = notes
            try Self.applyServerDateAndTimes(to: newEk, dateStr: dateStr, startTime: startTime, endTime: endTime)
            try eventStore.save(newEk, span: .thisEvent, commit: true)

            // Link back to server by updating the server event row.
            if let newExternalId = newEk.eventIdentifier {
                let externalUpdatedAt = newEk.lastModifiedDate.map { Int64($0.timeIntervalSince1970 * 1000.0) }
                var updated: [String: Any] = e
                updated["provider"] = "apple"
                updated["externalId"] = newExternalId
                updated["externalCalendarId"] = externalCalendarId ?? cal.calendarIdentifier
                updated["syncState"] = "linked"
                updated["lastSyncedAt"] = Int64(Date().timeIntervalSince1970 * 1000.0)
                updated["externalUpdatedAt"] = externalUpdatedAt
                updated["sourceDevice"] = sourceDevice

                try await client.updateServerEvent(eventId: serverId, event: updated)
            }
        }

        // If we detected Apple-newer conflicts, push them now.
        if !appleToServerUpserts.isEmpty {
            try await client.upsertAppleEvents(appleToServerUpserts, sourceDevice: sourceDevice)
        }
    }

    // MARK: - Helpers

    private static func formatDateYYYYMMDD(_ date: Date) -> String {
        let cal = Calendar.current
        let comps = cal.dateComponents([.year, .month, .day], from: date)
        let y = comps.year ?? 1970
        let m = comps.month ?? 1
        let d = comps.day ?? 1
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    private static func formatTimes(_ event: EKEvent) -> (startTime: String?, endTime: String?) {
        if event.isAllDay { return (nil, nil) }

        func hhmm(_ date: Date) -> String {
            let cal = Calendar.current
            let comps = cal.dateComponents([.hour, .minute], from: date)
            let h = comps.hour ?? 0
            let m = comps.minute ?? 0
            return String(format: "%02d:%02d", h, m)
        }

        return (hhmm(event.startDate), hhmm(event.endDate))
    }

    private static func parseDate(_ yyyyMmDd: String) -> Date? {
        let parts = yyyyMmDd.split(separator: "-")
        guard parts.count == 3,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        var comps = DateComponents()
        comps.year = y
        comps.month = m
        comps.day = d
        comps.hour = 0
        comps.minute = 0
        return Calendar.current.date(from: comps)
    }

    private static func parseTime(_ hhmm: String) -> (h: Int, m: Int)? {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return (h, m)
    }

    private static func applyServerDateAndTimes(to event: EKEvent, dateStr: String, startTime: String?, endTime: String?) throws {
        guard let baseDate = parseDate(dateStr) else { return }
        if let startTime, let st = parseTime(startTime) {
            var comps = Calendar.current.dateComponents([.year, .month, .day], from: baseDate)
            comps.hour = st.h
            comps.minute = st.m
            event.startDate = Calendar.current.date(from: comps) ?? baseDate
            event.isAllDay = false
        } else {
            event.startDate = baseDate
            event.isAllDay = true
        }

        if let endTime, let et = parseTime(endTime) {
            var comps = Calendar.current.dateComponents([.year, .month, .day], from: baseDate)
            comps.hour = et.h
            comps.minute = et.m
            event.endDate = Calendar.current.date(from: comps) ?? baseDate
        } else {
            // Default duration for timed events; all-day endDate is next midnight.
            if event.isAllDay {
                event.endDate = Calendar.current.date(byAdding: .day, value: 1, to: baseDate) ?? baseDate
            } else {
                event.endDate = Calendar.current.date(byAdding: .minute, value: 30, to: event.startDate) ?? event.startDate
            }
        }
    }

    private static func ekEventToUpsertPayload(_ ev: EKEvent) -> [String: Any] {
        let externalId = ev.eventIdentifier ?? ""
        let title = ev.title ?? ""
        let dateStr = formatDateYYYYMMDD(ev.startDate)
        let times = formatTimes(ev)
        let externalUpdatedAt: Int64? = ev.lastModifiedDate.map { Int64($0.timeIntervalSince1970 * 1000.0) }

        var obj: [String: Any] = [
            "externalId": externalId,
            "externalCalendarId": ev.calendar.calendarIdentifier,
            "title": title,
            "date": dateStr
        ]
        if let start = times.startTime { obj["startTime"] = start }
        if let end = times.endTime { obj["endTime"] = end }
        if let externalUpdatedAt { obj["externalUpdatedAt"] = externalUpdatedAt }
        if let notes = ev.notes, !notes.isEmpty { obj["notes"] = notes }
        return obj
    }
}
