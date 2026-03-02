import Foundation

struct ListingsResponse: Codable {
    let listings: [Listing]
    let total: Int
    let page: Int
    let perPage: Int
    let totalPages: Int
}

struct MarkersResponse: Codable {
    let markers: [MarkerCluster]
    let total: Int
}

struct WatchdogsResponse: Codable {
    let watchdogs: [Watchdog]
    let total: Int
}
