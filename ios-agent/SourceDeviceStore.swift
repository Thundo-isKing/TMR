import Foundation

/// Generates and persists a stable identifier for this device install.
///
/// This value is sent as `sourceDevice` so the server can attribute writes.
enum SourceDeviceStore {
    private static let key = "tmr.sourceDeviceId"

    static func getOrCreate() -> String {
        if let existing = UserDefaults.standard.string(forKey: key), !existing.isEmpty {
            return existing
        }
        let created = UUID().uuidString
        UserDefaults.standard.set(created, forKey: key)
        return created
    }

    static func reset() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
