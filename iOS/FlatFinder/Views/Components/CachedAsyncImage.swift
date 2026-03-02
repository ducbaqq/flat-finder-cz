import SwiftUI

struct CachedAsyncImage: View {
    let url: String?
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?
    @State private var isLoading = true
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity.animation(.easeIn(duration: 0.2)))
            } else if failed {
                Image(systemName: "photo")
                    .foregroundStyle(.secondary)
                    .font(.title2)
            } else {
                Rectangle()
                    .fill(Color(UIColor.systemGray5))
                    .overlay {
                        ProgressView()
                    }
            }
        }
        .task(id: url) {
            await loadImage()
        }
    }

    private func loadImage() async {
        guard let url, !url.isEmpty else {
            failed = true
            isLoading = false
            return
        }
        do {
            let loaded = try await ImageCache.shared.image(for: url)
            withAnimation {
                self.image = loaded
            }
            isLoading = false
        } catch {
            failed = true
            isLoading = false
        }
    }
}
