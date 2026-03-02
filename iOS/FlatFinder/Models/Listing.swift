import Foundation

struct Listing: Codable, Identifiable, Hashable {
    let id: Int
    let externalId: String?
    let source: String
    let propertyType: String
    let transactionType: String
    let title: String?
    let description: String?
    let price: Double?
    let currency: String?
    let priceNote: String?
    let address: String?
    let city: String?
    let district: String?
    let region: String?
    let latitude: Double?
    let longitude: Double?
    let sizeM2: Double?
    let layout: String?
    let floor: Int?
    let totalFloors: Int?
    let condition: String?
    let construction: String?
    let ownership: String?
    let furnishing: String?
    let energyRating: String?
    let amenities: [String]?
    let imageUrls: [String]?
    let thumbnailUrl: String?
    let sourceUrl: String?
    let listedAt: String?
    let scrapedAt: String?
    let createdAt: String?
    let isActive: Int?
    let deactivatedAt: String?

    // MARK: - Computed

    var formattedPrice: String {
        guard let price else { return "Cena na vyžádání" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = " "
        formatter.maximumFractionDigits = 0
        let formatted = formatter.string(from: NSNumber(value: price)) ?? "\(Int(price))"
        let suffix = transactionType == "rent" ? " Kč/měs." : " Kč"
        return formatted + suffix
    }

    var relativeTime: String {
        guard let listedAt else { return "" }
        let formats = [
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm:ssZ",
            "yyyy-MM-dd"
        ]
        var date: Date?
        for fmt in formats {
            let df = DateFormatter()
            df.dateFormat = fmt
            df.locale = Locale(identifier: "en_US_POSIX")
            if let d = df.date(from: listedAt) {
                date = d
                break
            }
        }
        guard let date else { return "" }
        let interval = Date().timeIntervalSince(date)
        let minutes = Int(interval / 60)
        if minutes < 1 { return "právě teď" }
        if minutes < 60 { return "před \(minutes) min" }
        let hours = minutes / 60
        if hours < 24 { return "před \(hours) hod" }
        let days = hours / 24
        if days < 30 { return "před \(days) dny" }
        let months = days / 30
        return "před \(months) měs."
    }

    var transactionLabel: String {
        switch transactionType {
        case "rent": return "Pronájem"
        case "sale": return "Prodej"
        case "auction": return "Aukce"
        default: return transactionType.capitalized
        }
    }

    var propertyTypeLabel: String {
        switch propertyType {
        case "flat": return "Byt"
        case "house": return "Dům"
        case "land": return "Pozemek"
        case "commercial": return "Komerční"
        case "garage": return "Garáž"
        default: return propertyType.capitalized
        }
    }

    var hasLocation: Bool {
        latitude != nil && longitude != nil
    }

    // MARK: - Source URL (matches frontend buildSourceUrl logic)

    private static let srealityTransCZ = ["sale": "prodej", "rent": "pronajem", "auction": "drazby"]
    private static let srealityPropCZ = ["flat": "byt", "house": "dum", "land": "pozemek", "commercial": "komercni", "garage": "garaz"]

    var buildSourceUrl: String? {
        switch source.lowercased() {
        case "sreality":
            let hashId = (externalId ?? "").replacingOccurrences(of: "sreality_", with: "")
            guard !hashId.isEmpty else { return sourceUrl }
            let trans = Self.srealityTransCZ[transactionType] ?? transactionType
            let prop = Self.srealityPropCZ[propertyType] ?? propertyType
            let slug = (propertyType == "flat" && layout != nil) ? layout! : "x"
            return "https://www.sreality.cz/detail/\(trans)/\(prop)/\(slug)/x/\(hashId)"
        case "ulovdomov":
            let offerId = (externalId ?? "").replacingOccurrences(of: "ulovdomov_", with: "")
            guard !offerId.isEmpty else { return sourceUrl }
            return "https://www.ulovdomov.cz/inzerat/x/\(offerId)"
        case "bezrealitky":
            if let url = sourceUrl, url.contains("/nemovitosti-byty-domy/") {
                return url
            }
            let advertId = (externalId ?? "").replacingOccurrences(of: "bezrealitky_", with: "")
            guard !advertId.isEmpty else { return sourceUrl }
            return "https://www.bezrealitky.cz/nemovitosti-byty-domy/\(advertId)"
        default:
            return sourceUrl
        }
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Listing, rhs: Listing) -> Bool {
        lhs.id == rhs.id
    }
}
