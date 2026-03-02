import SwiftUI

struct BottomSheetContent: View {
    @Environment(FilterState.self) private var filterState
    @Bindable var listingsVM: ListingsViewModel
    @Binding var showFilters: Bool
    @Binding var selectedListing: Listing?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                SearchBar(showFilters: $showFilters)
                    .padding(.horizontal)
                    .padding(.top, 8)

                // Filter chips
                FilterChipsRow()
                    .padding(.vertical, 6)

                // Count
                HStack {
                    Text("\(listingsVM.totalCount) nabídek")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    sortMenu
                }
                .padding(.horizontal)
                .padding(.bottom, 6)

                Divider()

                // Listing list
                if listingsVM.isLoading {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(0..<5, id: \.self) { _ in
                                ListingCardSkeleton()
                            }
                        }
                        .padding(.horizontal)
                        .padding(.top, 8)
                    }
                } else if let error = listingsVM.error {
                    ContentUnavailableView {
                        Label("Chyba", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Zkusit znovu") {
                            listingsVM.fetchListings(filters: filterState)
                        }
                    }
                } else if listingsVM.listings.isEmpty {
                    ContentUnavailableView {
                        Label("Žádné výsledky", systemImage: "magnifyingglass")
                    } description: {
                        Text("Zkuste změnit filtry")
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(listingsVM.listings) { listing in
                                NavigationLink(value: listing) {
                                    ListingCard(listing: listing)
                                }
                                .buttonStyle(.plain)
                                .onAppear {
                                    if listing == listingsVM.listings.last {
                                        listingsVM.loadMore(filters: filterState)
                                    }
                                }
                            }

                            if listingsVM.isLoadingMore {
                                ProgressView()
                                    .padding()
                            }
                        }
                        .padding(.horizontal)
                        .padding(.top, 8)
                    }
                    .refreshable {
                        listingsVM.fetchListings(filters: filterState)
                    }
                }
            }
            .navigationDestination(for: Listing.self) { listing in
                ListingDetailView(listing: listing)
            }
            .sheet(isPresented: $showFilters) {
                FilterSheet(listingsVM: listingsVM)
            }
        }
    }

    private var sortMenu: some View {
        Menu {
            ForEach(FilterState.sortOptions, id: \.0) { value, label in
                Button {
                    filterState.sort = value
                    HapticManager.selection()
                } label: {
                    HStack {
                        Text(label)
                        if filterState.sort == value {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "arrow.up.arrow.down")
                Text(FilterState.sortOptions.first(where: { $0.0 == filterState.sort })?.1 ?? "Řadit")
            }
            .font(.caption)
            .foregroundStyle(Theme.primaryTeal)
        }
    }
}
