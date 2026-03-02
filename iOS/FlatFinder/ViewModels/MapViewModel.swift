import Foundation
import MapKit
import SwiftUI

@Observable
final class MapViewModel {
    var markers: [MarkerCluster] = []
    var isLoading = false
    var error: String?
    var cameraPosition: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 49.8, longitude: 15.5),
            span: MKCoordinateSpan(latitudeDelta: 4.0, longitudeDelta: 4.0)
        )
    )

    private var fetchTask: Task<Void, Never>?
    private var currentZoom: Int = 7

    func zoomFromSpan(_ span: MKCoordinateSpan) -> Int {
        let zoom = Int(log2(360.0 / max(span.latitudeDelta, 0.001)))
        return max(3, min(18, zoom))
    }

    func fetchMarkers(filters: FilterState, zoom: Int? = nil) {
        let z = zoom ?? currentZoom
        fetchTask?.cancel()
        fetchTask = Task { @MainActor in
            isLoading = true
            do {
                let response = try await APIClient.shared.fetchMarkers(
                    queryItems: filters.toQueryItems(),
                    zoom: z
                )
                markers = response.markers
            } catch is CancellationError {
                return
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    func debouncedFetchMarkers(filters: FilterState, zoom: Int) {
        currentZoom = zoom
        fetchTask?.cancel()
        fetchTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            isLoading = true
            do {
                let response = try await APIClient.shared.fetchMarkers(
                    queryItems: filters.toQueryItems(),
                    zoom: zoom
                )
                markers = response.markers
            } catch is CancellationError {
                return
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}
