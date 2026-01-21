import SwiftUI
import EventKit

/// Lets the user choose which Apple calendar the agent writes new events into.
/// Saves selection via `AppleCalendarSelectionStore`.
struct AppleCalendarPickerView: View {
    @Environment(\.dismiss) private var dismiss

    private let eventStore = EKEventStore()

    @State private var calendars: [EKCalendar] = []
    @State private var selectedId: String? = AppleCalendarSelectionStore.load()
    @State private var statusText: String = ""

    var body: some View {
        NavigationView {
            List {
                Section {
                    Button {
                        AppleCalendarSelectionStore.save(nil)
                        selectedId = nil
                        dismiss()
                    } label: {
                        HStack {
                            Text("Use Default Calendar")
                            Spacer()
                            if selectedId == nil {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }

                Section(header: Text("Writable Calendars")) {
                    ForEach(calendars, id: \.calendarIdentifier) { cal in
                        Button {
                            AppleCalendarSelectionStore.save(cal.calendarIdentifier)
                            selectedId = cal.calendarIdentifier
                            dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(cal.title)
                                    Text(cal.source.title)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                if selectedId == cal.calendarIdentifier {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }

                if !statusText.isEmpty {
                    Section {
                        Text(statusText)
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Calendar")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task {
                await loadCalendars()
            }
        }
    }

    private func loadCalendars() async {
        do {
            try await requestAccessIfNeeded()
            let all = eventStore.calendars(for: .event)
            // Only show calendars we can actually write into.
            calendars = all.filter { $0.allowsContentModifications }
            statusText = calendars.isEmpty ? "No writable calendars found." : ""
        } catch {
            statusText = "Calendar access error: \(error)"
        }
    }

    private func requestAccessIfNeeded() async throws {
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
}
