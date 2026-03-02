import Foundation

actor APIClient {
    static let shared = APIClient()

    #if DEBUG
    private static let defaultBaseURL = "http://192.168.178.23:4000"
    #else
    private static let defaultBaseURL = "http://localhost:4000"
    #endif

    private let baseURL: String
    private let session: URLSession
    private let decoder: JSONDecoder

    init(baseURL: String = APIClient.defaultBaseURL) {
        self.baseURL = baseURL
        self.session = URLSession.shared
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder = decoder
    }

    // MARK: - Listings

    func fetchListings(queryItems: [URLQueryItem] = [], page: Int = 1, perPage: Int = 20) async throws -> ListingsResponse {
        var items = queryItems
        items.append(URLQueryItem(name: "page", value: "\(page)"))
        items.append(URLQueryItem(name: "per_page", value: "\(perPage)"))
        return try await get("/api/listings", queryItems: items)
    }

    func fetchListing(id: Int) async throws -> Listing {
        return try await get("/api/listings/\(id)")
    }

    // MARK: - Markers

    func fetchMarkers(queryItems: [URLQueryItem] = [], zoom: Int = 7) async throws -> MarkersResponse {
        var items = queryItems
        items.append(URLQueryItem(name: "zoom", value: "\(zoom)"))
        return try await get("/api/markers", queryItems: items)
    }

    // MARK: - Stats

    func fetchStats() async throws -> StatsResponse {
        return try await get("/api/stats")
    }

    // MARK: - Watchdogs

    func fetchWatchdogs(email: String) async throws -> WatchdogsResponse {
        let items = [URLQueryItem(name: "email", value: email)]
        return try await get("/api/watchdogs", queryItems: items)
    }

    func createWatchdog(email: String, filters: [String: String], label: String) async throws -> Watchdog {
        let body: [String: Any] = [
            "email": email,
            "filters": filters,
            "label": label
        ]
        return try await post("/api/watchdogs", body: body)
    }

    func toggleWatchdog(id: Int) async throws -> WatchdogToggleResponse {
        return try await patch("/api/watchdogs/\(id)/toggle")
    }

    func deleteWatchdog(id: Int) async throws {
        let _: DeleteResponse = try await delete("/api/watchdogs/\(id)")
    }

    // MARK: - Private

    private func get<T: Decodable>(_ path: String, queryItems: [URLQueryItem] = []) async throws -> T {
        var components = URLComponents(string: baseURL + path)!
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw APIError.invalidURL
        }
        let (data, response) = try await session.data(from: url)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        let url = URL(string: baseURL + path)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func patch<T: Decodable>(_ path: String) async throws -> T {
        let url = URL(string: baseURL + path)!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func delete<T: Decodable>(_ path: String) async throws -> T {
        let url = URL(string: baseURL + path)!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func validateResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw APIError.httpError(http.statusCode)
        }
    }
}

struct WatchdogToggleResponse: Codable {
    let id: Int
    let active: Bool
}

private struct DeleteResponse: Codable {
    let deleted: Bool
}

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .invalidResponse: return "Invalid response"
        case .httpError(let code): return "HTTP error \(code)"
        case .decodingError(let error): return "Decoding error: \(error.localizedDescription)"
        }
    }
}
