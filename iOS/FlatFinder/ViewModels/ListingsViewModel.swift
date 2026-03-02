import Foundation
import SwiftUI

@Observable
final class ListingsViewModel {
    var listings: [Listing] = []
    var isLoading = false
    var isLoadingMore = false
    var error: String?
    var totalCount = 0

    private var currentPage = 1
    private var totalPages = 1
    private var fetchTask: Task<Void, Never>?

    var hasMore: Bool { currentPage < totalPages }

    func fetchListings(filters: FilterState, reset: Bool = true) {
        fetchTask?.cancel()
        fetchTask = Task { @MainActor in
            if reset {
                currentPage = 1
                isLoading = true
                error = nil
            } else {
                isLoadingMore = true
            }

            do {
                let response = try await APIClient.shared.fetchListings(
                    queryItems: filters.toQueryItems(),
                    page: currentPage
                )
                if reset {
                    listings = response.listings
                } else {
                    listings.append(contentsOf: response.listings)
                }
                totalCount = response.total
                totalPages = response.totalPages
            } catch is CancellationError {
                return
            } catch {
                self.error = error.localizedDescription
            }

            isLoading = false
            isLoadingMore = false
        }
    }

    func loadMore(filters: FilterState) {
        guard hasMore, !isLoadingMore, !isLoading else { return }
        currentPage += 1
        fetchListings(filters: filters, reset: false)
    }

    func debouncedFetch(filters: FilterState) {
        fetchTask?.cancel()
        fetchTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            currentPage = 1
            isLoading = true
            error = nil

            do {
                let response = try await APIClient.shared.fetchListings(
                    queryItems: filters.toQueryItems(),
                    page: 1
                )
                listings = response.listings
                totalCount = response.total
                totalPages = response.totalPages
            } catch is CancellationError {
                return
            } catch {
                self.error = error.localizedDescription
            }

            isLoading = false
        }
    }
}
