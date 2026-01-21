import Foundation

/// Stores which Apple calendar to write new events into (by calendarIdentifier).
///
/// If nil/empty, the agent uses `defaultCalendarForNewEvents`.
enum AppleCalendarSelectionStore {
    private static let key = "tmr.apple.targetCalendarIdentifier"

    static func load() -> String? {
        let s = UserDefaults.standard.string(forKey: key)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? nil : s
    }

    static func save(_ identifier: String?) {
        let v = (identifier ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if v.isEmpty {
            UserDefaults.standard.removeObject(forKey: key)
        } else {
            UserDefaults.standard.set(v, forKey: key)
        }
    }

    static func reset() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
