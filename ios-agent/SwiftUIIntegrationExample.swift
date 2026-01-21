import SwiftUI

/// Copy/paste example showing how to wire the sync runner into a SwiftUI app.
///
/// Notes:
/// - You still need `NSCalendarsUsageDescription` in Info.plist.
/// - `baseURL` should be your deployed server URL (https).
/// - `deviceToken` should be registered once via `/sync/devices/register` and stored in Keychain.
@main
struct TMRSyncExampleApp: App {
    @Environment(\.scenePhase) private var scenePhase

    // Keep these alive for the app lifetime.
    @StateObject private var appModel = AppModel()

    init() {
        // no-op: AppModel builds the runner from stored config
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appModel)
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                appModel.startIfConfigured()

            case .inactive, .background:
                appModel.stop()

            @unknown default:
                break
            }
        }
    }
}

final class AppModel: ObservableObject {
    @Published var isConfigured: Bool = false
    @Published var lastStatusText: String = ""
    @Published var lastErrorText: String = ""
    private var runner: AppleSyncRunner?

    func rebuildRunnerIfPossible() {
        guard let baseURL = ServerConfigStore.parsedBaseURL() else {
            isConfigured = false
            runner = nil
            return
        }
        let token = (try? DeviceTokenKeychain.load()) ?? ""
        guard !token.isEmpty else {
            isConfigured = false
            runner = nil
            return
        }

        let client = AppleSyncClient(config: .init(baseURL: baseURL, deviceToken: token))
        let sync = AppleEventKitSync(client: client)
        let r = AppleSyncRunner(sync: sync, sourceDevice: SourceDeviceStore.getOrCreate())
        r.onStatus = { [weak self] status in
            self?.lastErrorText = ""
            self?.lastStatusText = "Last sync: upserts=\(status.appleUpserts), deletes=\(status.appleDeletes), payload=\(status.applePayloadCount)"
        }
        r.onError = { [weak self] msg in
            self?.lastErrorText = "Sync error: \(msg)"
        }
        runner = r
        isConfigured = true
    }

    func startIfConfigured() {
        rebuildRunnerIfPossible()
        guard let runner, isConfigured else { return }
        Task { try? await runner.runOnce() }
        runner.startPeriodicSync(intervalSeconds: 300)
    }

    func stop() {
        runner?.stopPeriodicSync()
    }

    func runOnce() {
        rebuildRunnerIfPossible()
        guard let runner else { return }
        Task { try? await runner.runOnce() }
    }

    func resetSyncState() {
        runner?.resetSyncState()
    }
}

struct RootView: View {
    @EnvironmentObject var appModel: AppModel

    var body: some View {
        Group {
            if appModel.isConfigured {
                ContentView()
            } else {
                DeviceTokenSetupView {
                    appModel.rebuildRunnerIfPossible()
                }
            }
        }
        .onAppear {
            appModel.rebuildRunnerIfPossible()
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var appModel: AppModel
    @State private var showingCalendarPicker = false

    var body: some View {
        VStack(spacing: 12) {
            Text("TMR Apple Sync")
                .font(.title2)

            Button("Choose Calendar") {
                showingCalendarPicker = true
            }

            if let selected = AppleCalendarSelectionStore.load() {
                Text("Calendar: \(selected)")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            } else {
                Text("Calendar: default")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }

            Button("Sync Now") {
                appModel.runOnce()
            }

            Button("Reset Sync State") {
                appModel.resetSyncState()
            }

            if !appModel.lastErrorText.isEmpty {
                Text(appModel.lastErrorText)
                    .font(.footnote)
                    .foregroundColor(.red)
            } else if !appModel.lastStatusText.isEmpty {
                Text(appModel.lastStatusText)
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .sheet(isPresented: $showingCalendarPicker) {
            AppleCalendarPickerView()
        }
    }
}
