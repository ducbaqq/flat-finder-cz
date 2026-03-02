import Foundation
import SwiftUI

@Observable
final class FilterState {
    var transactionType: String = ""
    var propertyType: String = ""
    var priceMin: String = ""
    var priceMax: String = ""
    var sizeMin: String = ""
    var sizeMax: String = ""
    var layout: Set<String> = []
    var condition: Set<String> = []
    var construction: Set<String> = []
    var ownership: Set<String> = []
    var furnishing: Set<String> = []
    var energyRating: Set<String> = []
    var source: Set<String> = []
    var location: String = ""
    var sort: String = "newest"

    var activeFilterCount: Int {
        var count = 0
        if !transactionType.isEmpty { count += 1 }
        if !propertyType.isEmpty { count += 1 }
        if !priceMin.isEmpty { count += 1 }
        if !priceMax.isEmpty { count += 1 }
        if !sizeMin.isEmpty { count += 1 }
        if !sizeMax.isEmpty { count += 1 }
        if !layout.isEmpty { count += 1 }
        if !condition.isEmpty { count += 1 }
        if !construction.isEmpty { count += 1 }
        if !ownership.isEmpty { count += 1 }
        if !furnishing.isEmpty { count += 1 }
        if !energyRating.isEmpty { count += 1 }
        if !source.isEmpty { count += 1 }
        if !location.isEmpty { count += 1 }
        return count
    }

    func toQueryItems() -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if !transactionType.isEmpty {
            items.append(URLQueryItem(name: "transaction_type", value: transactionType))
        }
        if !propertyType.isEmpty {
            items.append(URLQueryItem(name: "property_type", value: propertyType))
        }
        if !priceMin.isEmpty {
            items.append(URLQueryItem(name: "price_min", value: priceMin))
        }
        if !priceMax.isEmpty {
            items.append(URLQueryItem(name: "price_max", value: priceMax))
        }
        if !sizeMin.isEmpty {
            items.append(URLQueryItem(name: "size_min", value: sizeMin))
        }
        if !sizeMax.isEmpty {
            items.append(URLQueryItem(name: "size_max", value: sizeMax))
        }
        if !layout.isEmpty {
            items.append(URLQueryItem(name: "layout", value: layout.joined(separator: ",")))
        }
        if !condition.isEmpty {
            items.append(URLQueryItem(name: "condition", value: condition.joined(separator: ",")))
        }
        if !construction.isEmpty {
            items.append(URLQueryItem(name: "construction", value: construction.joined(separator: ",")))
        }
        if !ownership.isEmpty {
            items.append(URLQueryItem(name: "ownership", value: ownership.joined(separator: ",")))
        }
        if !furnishing.isEmpty {
            items.append(URLQueryItem(name: "furnishing", value: furnishing.joined(separator: ",")))
        }
        if !energyRating.isEmpty {
            items.append(URLQueryItem(name: "energy_rating", value: energyRating.joined(separator: ",")))
        }
        if !source.isEmpty {
            items.append(URLQueryItem(name: "source", value: source.joined(separator: ",")))
        }
        if !location.isEmpty {
            items.append(URLQueryItem(name: "location", value: location))
        }
        if sort != "newest" {
            items.append(URLQueryItem(name: "sort", value: sort))
        }
        return items
    }

    func toFilterDict() -> [String: String] {
        var dict: [String: String] = [:]
        for item in toQueryItems() {
            if let value = item.value {
                dict[item.name] = value
            }
        }
        return dict
    }

    func reset() {
        transactionType = ""
        propertyType = ""
        priceMin = ""
        priceMax = ""
        sizeMin = ""
        sizeMax = ""
        layout = []
        condition = []
        construction = []
        ownership = []
        furnishing = []
        energyRating = []
        source = []
        location = ""
        sort = "newest"
    }

    var activeFilters: [(label: String, clear: () -> Void)] {
        var filters: [(label: String, clear: () -> Void)] = []
        if !transactionType.isEmpty {
            let label = transactionType == "rent" ? "Pronájem" : transactionType == "sale" ? "Prodej" : transactionType.capitalized
            filters.append((label, { self.transactionType = "" }))
        }
        if !propertyType.isEmpty {
            let label: String
            switch propertyType {
            case "flat": label = "Byt"
            case "house": label = "Dům"
            case "land": label = "Pozemek"
            case "commercial": label = "Komerční"
            case "garage": label = "Garáž"
            default: label = propertyType.capitalized
            }
            filters.append((label, { self.propertyType = "" }))
        }
        if !priceMin.isEmpty {
            filters.append(("Od \(priceMin) Kč", { self.priceMin = "" }))
        }
        if !priceMax.isEmpty {
            filters.append(("Do \(priceMax) Kč", { self.priceMax = "" }))
        }
        if !sizeMin.isEmpty {
            filters.append(("Od \(sizeMin) m²", { self.sizeMin = "" }))
        }
        if !sizeMax.isEmpty {
            filters.append(("Do \(sizeMax) m²", { self.sizeMax = "" }))
        }
        for l in layout.sorted() {
            filters.append((l, { self.layout.remove(l) }))
        }
        if !location.isEmpty {
            filters.append((location, { self.location = "" }))
        }
        for s in source.sorted() {
            filters.append((Theme.sourceDisplayName(for: s), { self.source.remove(s) }))
        }
        return filters
    }

    // MARK: - Options

    static let transactionTypes = [
        ("", "Vše"),
        ("rent", "Pronájem"),
        ("sale", "Prodej"),
    ]

    static let propertyTypes = [
        ("", "Vše"),
        ("flat", "Byt"),
        ("house", "Dům"),
        ("land", "Pozemek"),
        ("commercial", "Komerční"),
        ("garage", "Garáž"),
    ]

    static let layouts = [
        "1+kk", "1+1", "2+kk", "2+1", "3+kk", "3+1",
        "4+kk", "4+1", "5+kk", "5+1", "6+kk", "6+1",
        "garsoniera", "atypický"
    ]

    static let conditions = [
        ("new_build", "Novostavba"),
        ("good", "Dobrý stav"),
        ("before_renovation", "Před rekonstrukcí"),
    ]

    static let constructions = [
        ("brick", "Cihla"),
        ("panel", "Panel"),
    ]

    static let ownerships = [
        ("personal", "Osobní"),
        ("cooperative", "Družstevní"),
        ("state", "Státní"),
    ]

    static let furnishings = [
        ("furnished", "Vybavený"),
        ("partially", "Částečně"),
        ("unfurnished", "Nevybavený"),
    ]

    static let energyRatings = ["A", "B", "C", "D", "E", "F", "G"]

    static let sortOptions = [
        ("newest", "Nejnovější"),
        ("price_asc", "Cena ↑"),
        ("price_desc", "Cena ↓"),
        ("size_asc", "Velikost ↑"),
        ("size_desc", "Velikost ↓"),
    ]
}
