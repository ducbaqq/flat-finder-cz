import Foundation

struct StatsResponse: Codable {
    let total: Int
    let totalAll: Int
    let inactive: Int
    let bySource: [String: Int]
    let byType: [String: Int]
    let byTransaction: [String: Int]
    let byCity: [String: Int]
}
