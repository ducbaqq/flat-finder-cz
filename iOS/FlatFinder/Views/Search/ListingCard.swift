import SwiftUI

struct ListingCard: View {
    let listing: Listing

    var body: some View {
        HStack(spacing: 12) {
            // Thumbnail
            CachedAsyncImage(url: listing.thumbnailUrl)
                .frame(width: 110, height: 90)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSM))
                .overlay(alignment: .topLeading) {
                    SourceBadge(source: listing.source)
                        .padding(4)
                }

            // Info
            VStack(alignment: .leading, spacing: 4) {
                Text(listing.title ?? "Nabídka")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                Text(listing.formattedPrice)
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundStyle(Theme.primaryTeal)

                HStack(spacing: 6) {
                    if let layout = listing.layout {
                        metaChip(layout)
                    }
                    if let size = listing.sizeM2 {
                        metaChip(size.formattedArea)
                    }
                    if let city = listing.city {
                        metaChip(city, icon: "mappin")
                    }
                }

                HStack {
                    if !listing.relativeTime.isEmpty {
                        Text(listing.relativeTime)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
            }
        }
        .padding(10)
        .cardStyle()
    }

    private func metaChip(_ text: String, icon: String? = nil) -> some View {
        HStack(spacing: 2) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 8))
            }
            Text(text)
                .font(.caption2)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Theme.chipBackground)
        .clipShape(Capsule())
        .foregroundStyle(.secondary)
    }
}
