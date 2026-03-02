import SwiftUI

struct AmenityChipsView: View {
    let amenities: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Vybavení")
                .font(.headline)

            FlowLayout(spacing: 6) {
                ForEach(amenities, id: \.self) { amenity in
                    HStack(spacing: 4) {
                        Image(systemName: amenityIcon(amenity))
                            .font(.caption2)
                        Text(amenity)
                            .font(.caption)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.chipBackground)
                    .clipShape(Capsule())
                }
            }
        }
    }

    private func amenityIcon(_ amenity: String) -> String {
        let lower = amenity.lowercased()
        if lower.contains("balkon") || lower.contains("terasa") { return "sun.max" }
        if lower.contains("výtah") { return "arrow.up.arrow.down" }
        if lower.contains("sklep") { return "archivebox" }
        if lower.contains("parkování") || lower.contains("garáž") { return "car" }
        if lower.contains("zahrad") { return "leaf" }
        if lower.contains("internet") { return "wifi" }
        if lower.contains("myčk") { return "dishwasher" }
        if lower.contains("pračk") { return "washer" }
        return "checkmark.circle"
    }
}
