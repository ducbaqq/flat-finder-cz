import SwiftUI

struct ImageGalleryView: View {
    let urls: [String]
    @State private var currentPage = 0

    var body: some View {
        if urls.isEmpty {
            Rectangle()
                .fill(Color(UIColor.systemGray5))
                .overlay {
                    Image(systemName: "photo.on.rectangle")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                }
        } else {
            ZStack(alignment: .bottom) {
                TabView(selection: $currentPage) {
                    ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                        CachedAsyncImage(url: url, contentMode: .fill)
                            .clipped()
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                // Page dots
                if urls.count > 1 {
                    HStack(spacing: 6) {
                        ForEach(0..<urls.count, id: \.self) { index in
                            Circle()
                                .fill(index == currentPage ? Color.white : Color.white.opacity(0.5))
                                .frame(width: 6, height: 6)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial)
                    .clipShape(Capsule())
                    .padding(.bottom, 12)
                }
            }
        }
    }
}
