import UIKit

actor ImageCache {
    static let shared = ImageCache()

    private let cache = NSCache<NSString, UIImage>()
    private var inFlight: [String: Task<UIImage, Error>] = [:]

    private init() {
        cache.countLimit = 200
        cache.totalCostLimit = 100 * 1024 * 1024 // 100MB
    }

    func image(for urlString: String) async throws -> UIImage {
        let key = urlString as NSString

        if let cached = cache.object(forKey: key) {
            return cached
        }

        if let existing = inFlight[urlString] {
            return try await existing.value
        }

        let task = Task<UIImage, Error> {
            guard let url = URL(string: urlString) else {
                throw URLError(.badURL)
            }
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let image = UIImage(data: data) else {
                throw URLError(.cannotDecodeContentData)
            }
            cache.setObject(image, forKey: key, cost: data.count)
            return image
        }

        inFlight[urlString] = task
        defer { inFlight[urlString] = nil }
        return try await task.value
    }
}
