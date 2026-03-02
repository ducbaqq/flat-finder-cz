import SwiftUI

struct DetailGridView: View {
    let listing: Listing

    var body: some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible())
        ], spacing: 12) {
            if let layout = listing.layout {
                detailItem(icon: "square.grid.2x2", label: "Dispozice", value: layout)
            }
            if let size = listing.sizeM2 {
                detailItem(icon: "ruler", label: "Velikost", value: size.formattedArea)
            }
            if let floor = listing.floor {
                let floorsText = listing.totalFloors != nil ? "\(floor)/\(listing.totalFloors!)" : "\(floor)"
                detailItem(icon: "building.2", label: "Patro", value: floorsText)
            }
            if let condition = listing.condition {
                detailItem(icon: "wrench.and.screwdriver", label: "Stav", value: conditionLabel(condition))
            }
            if let construction = listing.construction {
                detailItem(icon: "building.columns", label: "Konstrukce", value: constructionLabel(construction))
            }
            if let ownership = listing.ownership {
                detailItem(icon: "doc.text", label: "Vlastnictví", value: ownershipLabel(ownership))
            }
            if let furnishing = listing.furnishing {
                detailItem(icon: "sofa", label: "Vybavení", value: furnishingLabel(furnishing))
            }
            if let energy = listing.energyRating {
                detailItem(icon: "bolt.circle", label: "Energie", value: energy)
            }
            detailItem(icon: "building.2.crop.circle", label: "Typ", value: listing.propertyTypeLabel)
        }
    }

    private func detailItem(icon: String, label: String, value: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(Theme.primaryTeal)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }

            Spacer()
        }
        .padding(10)
        .background(Theme.chipBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSM))
    }

    private func conditionLabel(_ value: String) -> String {
        switch value {
        case "new_build": return "Novostavba"
        case "good": return "Dobrý"
        case "before_renovation": return "Před rekonstrukcí"
        default: return value.capitalized
        }
    }

    private func constructionLabel(_ value: String) -> String {
        switch value {
        case "brick": return "Cihla"
        case "panel": return "Panel"
        default: return value.capitalized
        }
    }

    private func ownershipLabel(_ value: String) -> String {
        switch value {
        case "personal": return "Osobní"
        case "cooperative": return "Družstevní"
        case "state": return "Státní"
        default: return value.capitalized
        }
    }

    private func furnishingLabel(_ value: String) -> String {
        switch value {
        case "furnished": return "Vybavený"
        case "partially": return "Částečně"
        case "unfurnished": return "Nevybavený"
        default: return value.capitalized
        }
    }
}
