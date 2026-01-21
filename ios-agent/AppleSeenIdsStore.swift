import Foundation

/// Persists a snapshot of Apple EventKit event identifiers we've seen in a scan window.
///
/// Used to detect deletions (prevSeen - currentSeen).
enum AppleSeenIdsStore {
    private static let key = "tmr.apple.seenExternalIds.v1"

    static func load() -> Set<String> {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        if let arr = try? JSONSerialization.jsonObject(with: data) as? [String] {
            return Set(arr)
        }
        return []
    }

    static func save(_ set: Set<String>) {
        let arr = Array(set)
        if let data = try? JSONSerialization.data(withJSONObject: arr) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    static func reset() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
