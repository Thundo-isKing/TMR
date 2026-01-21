import Foundation

/// Stores the server base URL in UserDefaults so you don't have to hardcode it.
enum ServerConfigStore {
    private static let key = "tmr.serverBaseURL"

    static func loadBaseURL(defaultValue: String = "") -> String {
        (UserDefaults.standard.string(forKey: key) ?? defaultValue).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func saveBaseURL(_ value: String) {
        UserDefaults.standard.set(value.trimmingCharacters(in: .whitespacesAndNewlines), forKey: key)
    }

    static func parsedBaseURL() -> URL? {
        let str = loadBaseURL()
        guard !str.isEmpty else { return nil }
        return URL(string: str)
    }
}
