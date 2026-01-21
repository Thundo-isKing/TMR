import Foundation
import Security

/// Minimal Keychain helper for storing the device token on iOS.
///
/// Use a stable `service` and `account` so the value can be retrieved across launches.
enum DeviceTokenKeychain {
    private static let service = "TMR"
    private static let account = "deviceToken"

    static func save(_ token: String) throws {
        let data = Data(token.utf8)

        // Delete any existing token first (simplest, avoids update edge cases).
        try? delete()

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "DeviceTokenKeychain", code: Int(status), userInfo: [
                NSLocalizedDescriptionKey: "Keychain save failed: \(status)"
            ])
        }
    }

    static func load() throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw NSError(domain: "DeviceTokenKeychain", code: Int(status), userInfo: [
                NSLocalizedDescriptionKey: "Keychain load failed: \(status)"
            ])
        }

        guard let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status == errSecItemNotFound { return }
        guard status == errSecSuccess else {
            throw NSError(domain: "DeviceTokenKeychain", code: Int(status), userInfo: [
                NSLocalizedDescriptionKey: "Keychain delete failed: \(status)"
            ])
        }
    }
}
