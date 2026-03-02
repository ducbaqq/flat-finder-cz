import SwiftUI
import MapKit

struct SearchTab: View {
    @Environment(FilterState.self) private var filterState
    @State private var listingsVM = ListingsViewModel()
    @State private var mapVM = MapViewModel()
    @State private var showFilters = false
    @State private var selectedListing: Listing?
    @State private var sheetDetent: PresentationDetent = .medium

    var body: some View {
        NavigationStack {
            ZStack {
                MapView(viewModel: mapVM, onMarkerTap: { listing in
                    selectedListing = listing
                })
                .ignoresSafeArea(edges: .top)
            }
            .sheet(isPresented: .constant(true)) {
                BottomSheetContent(
                    listingsVM: listingsVM,
                    showFilters: $showFilters,
                    selectedListing: $selectedListing
                )
                .presentationDetents([.fraction(0.15), .medium, .large], selection: $sheetDetent)
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.15)))
                .interactiveDismissDisabled()
            }
            .navigationDestination(for: Listing.self) { listing in
                ListingDetailView(listing: listing)
            }
            .onChange(of: filterState.transactionType) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.propertyType) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.priceMin) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.priceMax) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.sizeMin) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.sizeMax) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.layout) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.source) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.location) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.sort) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.condition) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.construction) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.ownership) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.furnishing) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .onChange(of: filterState.energyRating) { _, _ in listingsVM.debouncedFetch(filters: filterState) }
            .task {
                listingsVM.fetchListings(filters: filterState)
                mapVM.fetchMarkers(filters: filterState)
            }
        }
    }
}
