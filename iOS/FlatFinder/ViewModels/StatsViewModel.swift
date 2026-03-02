import Foundation

@Observable
final class StatsViewModel {
    var stats: StatsResponse?
    var isLoading = false
    var error: String?

    func fetchStats() {
        isLoading = true
        error = nil

        Task { @MainActor in
            do {
                stats = try await APIClient.shared.fetchStats()
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}
