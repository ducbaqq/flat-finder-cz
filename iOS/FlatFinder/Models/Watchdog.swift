import Foundation

struct Watchdog: Codable, Identifiable {
    let id: Int
    let email: String
    let filters: [String: String]?
    let label: String?
    var active: Bool
    let createdAt: String?
    let lastNotifiedAt: String?

    var filterSummary: String {
        guard let filters, !filters.isEmpty else { return "Všechny nabídky" }
        var parts: [String] = []
        if let t = filters["transaction_type"] {
            parts.append(t == "rent" ? "Pronájem" : "Prodej")
        }
        if let p = filters["property_type"] {
            switch p {
            case "flat": parts.append("byt")
            case "house": parts.append("dům")
            case "land": parts.append("pozemek")
            default: parts.append(p)
            }
        }
        if let l = filters["location"], !l.isEmpty {
            parts.append(l)
        }
        if let pm = filters["price_max"] {
            parts.append("do \(pm) Kč")
        }
        return parts.isEmpty ? "Vlastní filtry" : parts.joined(separator: " · ")
    }
}
