import SwiftUI

/// Minimal setup UI:
/// - paste server URL
/// - paste device token
/// - save to UserDefaults + Keychain
/// - optionally validate by calling `/sync/apple/status`
struct DeviceTokenSetupView: View {
    @State private var serverURL: String = ServerConfigStore.loadBaseURL(defaultValue: "https://")
    @State private var deviceToken: String = (try? DeviceTokenKeychain.load()) ?? ""

    @State private var statusText: String = ""
    @State private var isBusy: Bool = false

    let onConfigured: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("TMR Sync Setup").font(.title2)

            Text("Server URL")
                .font(.headline)
            TextField("https://example.com", text: $serverURL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)

            Text("Device Token")
                .font(.headline)
            TextEditor(text: $deviceToken)
                .frame(minHeight: 80)
                .font(.system(.body, design: .monospaced))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.3)))

            HStack(spacing: 10) {
                Button(isBusy ? "Working…" : "Save") {
                    save()
                }
                .disabled(isBusy)

                Button(isBusy ? "Working…" : "Save + Validate") {
                    Task { await saveAndValidate() }
                }
                .disabled(isBusy)
            }

            if !statusText.isEmpty {
                Text(statusText)
                    .font(.footnote)
                    .foregroundColor(statusText.lowercased().contains("ok") ? .green : .secondary)
            }

            Spacer()
        }
        .padding()
    }

    private func save() {
        ServerConfigStore.saveBaseURL(serverURL)
        do {
            try DeviceTokenKeychain.save(deviceToken.trimmingCharacters(in: .whitespacesAndNewlines))
            statusText = "Saved"
            onConfigured()
        } catch {
            statusText = "Save failed: \(error)"
        }
    }

    private func saveAndValidate() async {
        isBusy = true
        defer { isBusy = false }

        save()

        guard let baseURL = ServerConfigStore.parsedBaseURL() else {
            statusText = "Invalid server URL"
            return
        }
        let token = (try? DeviceTokenKeychain.load()) ?? ""
        if token.isEmpty {
            statusText = "Missing device token"
            return
        }

        do {
            let client = AppleSyncClient(config: .init(baseURL: baseURL, deviceToken: token))
            _ = try await client.fetchAppleStatus()
            statusText = "OK: device token authorized"
            onConfigured()
        } catch {
            statusText = "Validate failed: \(error)"
        }
    }
}
