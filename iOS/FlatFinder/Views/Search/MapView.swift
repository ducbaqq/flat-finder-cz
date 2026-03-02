import SwiftUI
import MapKit

struct MapView: View {
    @Bindable var viewModel: MapViewModel
    @Environment(FilterState.self) private var filterState
    var onMarkerTap: ((Listing) -> Void)?

    @State private var selectedMarker: MarkerCluster?

    var body: some View {
        Map(position: $viewModel.cameraPosition) {
            ForEach(viewModel.markers) { cluster in
                if cluster.isSingle, let listing = cluster.listings.first {
                    Annotation("", coordinate: CLLocationCoordinate2D(latitude: cluster.lat, longitude: cluster.lng)) {
                        PriceAnnotationView(
                            price: listing.shortPrice,
                            source: listing.propertyType ?? ""
                        )
                        .onTapGesture {
                            HapticManager.selection()
                            selectedMarker = cluster
                        }
                    }
                } else {
                    Annotation("", coordinate: CLLocationCoordinate2D(latitude: cluster.lat, longitude: cluster.lng)) {
                        ClusterAnnotationView(count: cluster.count)
                            .onTapGesture {
                                HapticManager.selection()
                                zoomToCluster(cluster)
                            }
                    }
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .onMapCameraChange(frequency: .onEnd) { context in
            let zoom = viewModel.zoomFromSpan(context.region.span)
            viewModel.debouncedFetchMarkers(filters: filterState, zoom: zoom)
        }
        .overlay(alignment: .bottom) {
            if let cluster = selectedMarker, let listing = cluster.listings.first {
                MarkerCalloutCard(
                    listing: listing,
                    onDetail: {
                        selectedMarker = nil
                        navigateToDetail(listing)
                    },
                    onDismiss: {
                        selectedMarker = nil
                    }
                )
                .padding(.horizontal)
                .padding(.bottom, 60)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: selectedMarker?.id)
    }

    private func zoomToCluster(_ cluster: MarkerCluster) {
        // Calculate bounds from cluster listings, or use current span / 2
        let listings = cluster.listings
        if listings.count > 1,
           let minLat = listings.compactMap(\.lat).min(),
           let maxLat = listings.compactMap(\.lat).max(),
           let minLng = listings.compactMap(\.lng).min(),
           let maxLng = listings.compactMap(\.lng).max() {
            let latDelta = max((maxLat - minLat) * 1.3, 0.005)
            let lngDelta = max((maxLng - minLng) * 1.3, 0.005)
            withAnimation(.spring(duration: 0.3)) {
                viewModel.cameraPosition = .region(
                    MKCoordinateRegion(
                        center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2),
                        span: MKCoordinateSpan(latitudeDelta: latDelta, longitudeDelta: lngDelta)
                    )
                )
            }
        } else {
            // Fallback: zoom into cluster center
            withAnimation(.spring(duration: 0.3)) {
                viewModel.cameraPosition = .region(
                    MKCoordinateRegion(
                        center: CLLocationCoordinate2D(latitude: cluster.lat, longitude: cluster.lng),
                        span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
                    )
                )
            }
        }
    }

    private func navigateToDetail(_ markerListing: MarkerListing) {
        let listing = Listing(
            id: markerListing.id,
            externalId: nil,
            source: markerListing.propertyType ?? "unknown",
            propertyType: markerListing.propertyType ?? "flat",
            transactionType: markerListing.transactionType ?? "rent",
            title: markerListing.title,
            description: nil,
            price: markerListing.price,
            currency: "CZK",
            priceNote: nil,
            address: nil,
            city: markerListing.city,
            district: nil,
            region: nil,
            latitude: markerListing.lat,
            longitude: markerListing.lng,
            sizeM2: markerListing.sizeM2,
            layout: markerListing.layout,
            floor: nil,
            totalFloors: nil,
            condition: nil,
            construction: nil,
            ownership: nil,
            furnishing: nil,
            energyRating: nil,
            amenities: nil,
            imageUrls: nil,
            thumbnailUrl: markerListing.thumbnailUrl,
            sourceUrl: nil,
            listedAt: nil,
            scrapedAt: nil,
            createdAt: nil,
            isActive: nil,
            deactivatedAt: nil
        )
        onMarkerTap?(listing)
    }
}
