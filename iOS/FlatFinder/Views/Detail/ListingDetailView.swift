import SwiftUI

struct ListingDetailView: View {
    let listing: Listing
    @State private var detailVM = ListingDetailViewModel()
    @State private var showSafari = false
    @State private var descriptionExpanded = false

    private var detail: Listing { detailVM.listing ?? listing }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Image gallery
                ImageGalleryView(urls: detail.imageUrls ?? [])
                    .frame(height: 260)

                VStack(alignment: .leading, spacing: 12) {
                    // Source + transaction badge
                    HStack {
                        SourceBadge(source: detail.source)
                        Text(detail.transactionLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(detail.relativeTime)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    // Price
                    Text(detail.formattedPrice)
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundStyle(Theme.primaryTeal)

                    if let priceNote = detail.priceNote {
                        Text(priceNote)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Title
                    Text(detail.title ?? "Nabídka")
                        .font(.title3)
                        .fontWeight(.semibold)

                    // Address
                    if let address = detail.address {
                        HStack(spacing: 4) {
                            Image(systemName: "mappin.circle.fill")
                                .foregroundStyle(Theme.primaryTeal)
                            Text(address)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Divider()

                    // Detail grid
                    DetailGridView(listing: detail)

                    // Description
                    if let desc = detail.description, !desc.isEmpty {
                        Divider()
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Popis")
                                .font(.headline)
                            Text(desc)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(descriptionExpanded ? nil : 5)
                            if desc.count > 200 {
                                Button(descriptionExpanded ? "Méně" : "Více") {
                                    withAnimation { descriptionExpanded.toggle() }
                                }
                                .font(.subheadline)
                                .foregroundStyle(Theme.primaryTeal)
                            }
                        }
                    }

                    // Amenities
                    if let amenities = detail.amenities, !amenities.isEmpty {
                        Divider()
                        AmenityChipsView(amenities: amenities)
                    }

                    // Mini map
                    if detail.hasLocation {
                        Divider()
                        MiniMapView(
                            latitude: detail.latitude!,
                            longitude: detail.longitude!,
                            title: detail.address
                        )
                        .frame(height: 180)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD))
                    }

                    // Spacer for CTA
                    Spacer().frame(height: 80)
                }
                .padding(.horizontal)
            }
        }
        .ignoresSafeArea(edges: .top)
        .overlay(alignment: .bottom) {
            ctaButton
        }
        .sheet(isPresented: $showSafari) {
            if let urlString = detail.buildSourceUrl, let url = URL(string: urlString) {
                SafariView(url: url)
                    .ignoresSafeArea()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task {
            detailVM.fetchDetail(id: listing.id)
        }
    }

    private var ctaButton: some View {
        Button {
            HapticManager.impact(.medium)
            showSafari = true
        } label: {
            HStack {
                Image(systemName: "safari")
                Text("Zobrazit na \(Theme.sourceDisplayName(for: detail.source)).cz")
            }
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Theme.primaryTeal)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD))
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        .background(
            LinearGradient(
                colors: [Theme.cardBackground.opacity(0), Theme.cardBackground],
                startPoint: .top,
                endPoint: .center
            )
            .frame(height: 100)
            .allowsHitTesting(false)
        )
    }
}
