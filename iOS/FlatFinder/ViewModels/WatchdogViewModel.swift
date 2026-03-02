import Foundation
import SwiftUI

@Observable
final class WatchdogViewModel {
    var watchdogs: [Watchdog] = []
    var isLoading = false
    var error: String?
    var email: String {
        didSet { UserDefaults.standard.set(email, forKey: "watchdog_email") }
    }

    init() {
        self.email = UserDefaults.standard.string(forKey: "watchdog_email") ?? ""
    }

    func fetchWatchdogs() {
        guard !email.isEmpty else { return }
        isLoading = true
        error = nil

        Task { @MainActor in
            do {
                let response = try await APIClient.shared.fetchWatchdogs(email: email)
                watchdogs = response.watchdogs
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    func createWatchdog(filters: FilterState, label: String) {
        guard !email.isEmpty else { return }

        Task { @MainActor in
            do {
                let watchdog = try await APIClient.shared.createWatchdog(
                    email: email,
                    filters: filters.toFilterDict(),
                    label: label
                )
                watchdogs.insert(watchdog, at: 0)
                HapticManager.notification(.success)
            } catch {
                self.error = error.localizedDescription
                HapticManager.notification(.error)
            }
        }
    }

    func toggle(watchdog: Watchdog) {
        Task { @MainActor in
            // Optimistic update
            if let index = watchdogs.firstIndex(where: { $0.id == watchdog.id }) {
                watchdogs[index].active.toggle()
            }

            do {
                let response = try await APIClient.shared.toggleWatchdog(id: watchdog.id)
                if let index = watchdogs.firstIndex(where: { $0.id == watchdog.id }) {
                    watchdogs[index].active = response.active
                }
            } catch {
                // Revert
                if let index = watchdogs.firstIndex(where: { $0.id == watchdog.id }) {
                    watchdogs[index].active.toggle()
                }
                self.error = error.localizedDescription
            }
        }
    }

    func delete(watchdog: Watchdog) {
        Task { @MainActor in
            watchdogs.removeAll { $0.id == watchdog.id }

            do {
                try await APIClient.shared.deleteWatchdog(id: watchdog.id)
                HapticManager.notification(.success)
            } catch {
                self.error = error.localizedDescription
                fetchWatchdogs()
            }
        }
    }
}
