import SwiftUI

struct MarkerCalloutCard: View {
    let listing: MarkerListing
    var onDetail: () -> Void
    var onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Image with close button overlay
            ZStack(alignment: .topTrailing) {
                CachedAsyncImage(url: listing.thumbnailUrl)
                    .frame(height: 120)
                    .frame(maxWidth: .infinity)
                    .clipped()

                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.5))
                }
                .padding(8)
            }

            // Details
            VStack(alignment: .leading, spacing: 4) {
                Text(listing.title ?? "Nabídka")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)

                Text(priceText)
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundStyle(Theme.primaryTeal)

                detailLine

                Button(action: onDetail) {
                    HStack(spacing: 4) {
                        Text("Zobrazit detail")
                        Image(systemName: "arrow.right")
                    }
                    .font(.footnote)
                    .foregroundStyle(Theme.primaryTeal)
                }
                .padding(.top, 2)
            }
            .padding(12)
        }
        .frame(width: 260)
        .background(.ultraThickMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.08), radius: 6, x: 0, y: 4)
    }

    private var priceText: String {
        let base = listing.formattedPrice
        if listing.transactionType?.lowercased() == "rent" {
            return base + "/měs."
        }
        return base
    }

    @ViewBuilder
    private var detailLine: some View {
        let parts = [listing.city, listing.sizeM2.map { $0.formattedArea }]
            .compactMap { $0 }
        if !parts.isEmpty {
            Text(parts.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
