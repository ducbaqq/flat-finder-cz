import Foundation

struct MarkerCluster: Codable, Identifiable {
    let lat: Double
    let lng: Double
    let count: Int
    let listings: [MarkerListing]

    var id: String { "\(lat),\(lng)" }

    var isSingle: Bool { count == 1 }
}

struct MarkerListing: Codable, Identifiable {
    let id: Int
    let title: String?
    let price: Double?
    let thumbnailUrl: String?
    let propertyType: String?
    let transactionType: String?
    let layout: String?
    let sizeM2: Double?
    let city: String?
    let lat: Double?
    let lng: Double?

    var formattedPrice: String {
        guard let price else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = " "
        formatter.maximumFractionDigits = 0
        let formatted = formatter.string(from: NSNumber(value: price)) ?? "\(Int(price))"
        return formatted + " Kč"
    }

    var shortPrice: String {
        guard let price else { return "—" }
        if price >= 1_000_000 {
            let m = price / 1_000_000
            return String(format: "%.1fM", m)
        } else if price >= 1_000 {
            let k = price / 1_000
            return String(format: "%.0fk", k)
        }
        return "\(Int(price))"
    }
}
