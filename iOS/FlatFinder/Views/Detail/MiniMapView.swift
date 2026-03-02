import SwiftUI
import MapKit

struct MiniMapView: View {
    let latitude: Double
    let longitude: Double
    var title: String?

    private var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var body: some View {
        Map(initialPosition: .region(
            MKCoordinateRegion(
                center: coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
            )
        )) {
            Marker(title ?? "Poloha", coordinate: coordinate)
                .tint(Theme.primaryTeal)
        }
        .mapStyle(.standard)
        .allowsHitTesting(false)
        .overlay(alignment: .bottomTrailing) {
            Button {
                let mapItem = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
                mapItem.name = title
                mapItem.openInMaps()
            } label: {
                Image(systemName: "arrow.up.right.square")
                    .font(.title3)
                    .foregroundStyle(.white)
                    .padding(8)
                    .background(Theme.primaryTeal)
                    .clipShape(Circle())
                    .shadow(radius: 4)
            }
            .padding(8)
        }
    }
}
