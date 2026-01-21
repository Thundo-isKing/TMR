import Foundation

/// Minimal orchestration layer that runs the bidirectional sync loop.
///
/// Intended usage (in your iOS app):
/// - Construct `AppleSyncClient` with your saved device token.
/// - Construct `AppleEventKitSync(client:)`.
/// - Call `await runner.runOnce()` on app launch and/or on a timer.
final class AppleSyncRunner {
    struct SyncStatus {
        let startedAtMs: Int64
        let finishedAtMs: Int64
        let serverSinceMs: Int64
        let appleSinceMs: Int64?
        let appleUpserts: Int
        let appleDeletes: Int
        let applePayloadCount: Int
    }

    private let sync: AppleEventKitSync
    private let sourceDevice: String
    private let targetCalendarIdentifier: String?
    private let defaults: UserDefaults

    private var periodicTask: Task<Void, Never>?
    private var isRunningOnce = false

    private(set) var lastStatus: SyncStatus?
    private(set) var lastError: String?

    /// Optional callbacks for UI.
    var onStatus: ((SyncStatus) -> Void)?
    var onError: ((String) -> Void)?

    private let lastServerSyncKey = "tmr.lastServerSyncMs"
    private let lastApplePushKey = "tmr.lastApplePushMs"

    init(
        sync: AppleEventKitSync,
        sourceDevice: String,
        targetCalendarIdentifier: String? = nil,
        defaults: UserDefaults = .standard
    ) {
        self.sync = sync
        self.sourceDevice = sourceDevice
        self.targetCalendarIdentifier = targetCalendarIdentifier
        self.defaults = defaults
    }

    /// Runs one sync pass:
    /// 1) Pull server changes and apply into EventKit
    /// 2) Push Apple events back to server (range-based MVP)
    ///
    /// Notes:
    /// - This MVP push does a range scan (see `pushAppleToServer`). It is safe but can be chatty.
    /// - Conflict protection exists server-side and is mirrored on-device when applying server changes.
    func runOnce(daysBack: Int = 30, daysForward: Int = 365) async throws {
        // Prevent overlapping runs (e.g., app launch + timer firing).
        if isRunningOnce { return }
        isRunningOnce = true
        defer { isRunningOnce = false }

        lastError = nil
        let startedAtMs = Self.nowMs()

        try await sync.requestCalendarAccess()

        let nowMs = Self.nowMs()
        let sinceMs = readInt64(forKey: lastServerSyncKey) ?? (nowMs - 7 * 24 * 60 * 60 * 1000) // default: last 7 days

        let targetCalendarIdentifier = AppleCalendarSelectionStore.load() ?? self.targetCalendarIdentifier

        try await sync.applyServerChangesToAppleCalendar(
            sinceMs: sinceMs,
            targetCalendarIdentifier: targetCalendarIdentifier,
            sourceDevice: sourceDevice
        )

        // Incremental Apple -> server push + deletion detection.
        let lastApplePushMs = readInt64(forKey: lastApplePushKey)
        let appleScan = sync.collectAppleChanges(daysBack: daysBack, daysForward: daysForward, sinceMs: lastApplePushMs)

        let prevSeen = AppleSeenIdsStore.load()
        let deletions = prevSeen.subtracting(appleScan.seenExternalIds)

        var payload: [[String: Any]] = []
        if !deletions.isEmpty {
            payload.append(contentsOf: deletions.map { [
                "externalId": $0,
                "deleted": true,
                "lastSyncedAt": nowMs
            ] })
        }
        payload.append(contentsOf: appleScan.upserts)

        // If there's nothing to send, still advance the cursors (scan succeeded).
        if !payload.isEmpty {
            try await sync.upsertApplePayload(payload, sourceDevice: sourceDevice)
        }

        AppleSeenIdsStore.save(appleScan.seenExternalIds)
        defaults.set(NSNumber(value: nowMs), forKey: lastServerSyncKey)
        defaults.set(NSNumber(value: nowMs), forKey: lastApplePushKey)

        let finishedAtMs = Self.nowMs()
        let status = SyncStatus(
            startedAtMs: startedAtMs,
            finishedAtMs: finishedAtMs,
            serverSinceMs: sinceMs,
            appleSinceMs: lastApplePushMs,
            appleUpserts: appleScan.upserts.count,
            appleDeletes: deletions.count,
            applePayloadCount: payload.count
        )
        lastStatus = status
        DispatchQueue.main.async { [onStatus] in onStatus?(status) }
    }

    /// Starts a background Task that runs sync repeatedly until stopped.
    /// Call `stopPeriodicSync()` when the app goes inactive, or when you no longer want syncing.
    func startPeriodicSync(
        intervalSeconds: TimeInterval = 300,
        jitterSeconds: TimeInterval = 10,
        daysBack: Int = 30,
        daysForward: Int = 365
    ) {
        stopPeriodicSync()

        let intervalNs = UInt64(max(5, intervalSeconds) * 1_000_000_000)
        let jitterNs = UInt64(max(0, jitterSeconds) * 1_000_000_000)

        periodicTask = Task {
            while !Task.isCancelled {
                do {
                    try await runOnce(daysBack: daysBack, daysForward: daysForward)
                } catch {
                    // Best-effort: keep the loop alive.
                    // Your app can observe errors by wrapping this runner or adding a callback.
                    let msg = "\(error)"
                    self.lastError = msg
                    DispatchQueue.main.async { [onError] in onError?(msg) }
                    print("[AppleSyncRunner] sync error: \(error)")
                }

                // Add small jitter to avoid thundering herd if many devices sync on the same cadence.
                let extra = jitterNs > 0 ? UInt64.random(in: 0...jitterNs) : 0
                try? await Task.sleep(nanoseconds: intervalNs + extra)
            }
        }
    }

    func stopPeriodicSync() {
        periodicTask?.cancel()
        periodicTask = nil
    }

    func resetSyncState() {
        defaults.removeObject(forKey: lastServerSyncKey)
        defaults.removeObject(forKey: lastApplePushKey)
        AppleSeenIdsStore.reset()
    }

    private func readInt64(forKey key: String) -> Int64? {
        if let n = defaults.object(forKey: key) as? NSNumber { return n.int64Value }
        return nil
    }

    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000.0)
    }
}
