import Foundation

@Observable
final class ListingDetailViewModel {
    var listing: Listing?
    var isLoading = false
    var error: String?

    func fetchDetail(id: Int) {
        guard !isLoading else { return }
        isLoading = true
        error = nil

        Task { @MainActor in
            do {
                listing = try await APIClient.shared.fetchListing(id: id)
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}
