import Foundation

/// Minimal HTTP client for the TMR Apple sync endpoints.
///
/// Use `Authorization: Device <deviceToken>` (recommended).
final class AppleSyncClient {
    struct Config {
        let baseURL: URL
        let deviceToken: String
    }

    private let config: Config
    private let session: URLSession

    init(config: Config, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    // MARK: - Public API

    func fetchAppleStatus() async throws -> [String: Any] {
        try await requestJSON(path: "/sync/apple/status", method: "GET", jsonBody: nil)
    }

    func upsertAppleEvents(_ events: [[String: Any]], sourceDevice: String) async throws {
        let body: [String: Any] = [
            "sourceDevice": sourceDevice,
            "events": events
        ]
        _ = try await requestJSON(path: "/sync/apple/events/upsert", method: "POST", jsonBody: body)
    }

    /// Update a server event by id (used to link a newly created EKEvent back to TMR).
    func updateServerEvent(eventId: Int64, event: [String: Any]) async throws {
        let body: [String: Any] = ["event": event]
        _ = try await requestJSON(path: "/events/\(eventId)", method: "PUT", jsonBody: body)
    }

    func fetchServerChanges(since: Int64, includeDeleted: Bool = true) async throws -> [[String: Any]] {
        var comps = URLComponents(url: config.baseURL.appendingPathComponent("/sync/events/changes"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "since", value: String(since)),
            URLQueryItem(name: "includeDeleted", value: includeDeleted ? "1" : "0")
        ]

        let data = try await requestRaw(url: comps.url!, method: "GET", jsonBody: nil)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (obj?["events"] as? [[String: Any]]) ?? []
    }

    func fetchAppleLinkedChanges(since: Int64, includeDeleted: Bool = true) async throws -> [[String: Any]] {
        var comps = URLComponents(url: config.baseURL.appendingPathComponent("/sync/apple/events/changes"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "since", value: String(since)),
            URLQueryItem(name: "includeDeleted", value: includeDeleted ? "1" : "0")
        ]

        let data = try await requestRaw(url: comps.url!, method: "GET", jsonBody: nil)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (obj?["events"] as? [[String: Any]]) ?? []
    }

    // MARK: - Internals

    private func requestJSON(path: String, method: String, jsonBody: [String: Any]?) async throws -> [String: Any] {
        let url = config.baseURL.appendingPathComponent(path)
        let data = try await requestRaw(url: url, method: method, jsonBody: jsonBody)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return obj ?? [:]
    }

    private func requestRaw(url: URL, method: String, jsonBody: [String: Any]?) async throws -> Data {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Device \(config.deviceToken)", forHTTPHeaderField: "Authorization")

        if let jsonBody {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: jsonBody)
        }

        let (data, resp) = try await session.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "AppleSyncClient", code: http.statusCode, userInfo: [
                NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(body)"
            ])
        }
        return data
    }
}
