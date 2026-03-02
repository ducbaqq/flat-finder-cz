import SwiftUI

struct SourceBadge: View {
    let source: String

    var body: some View {
        Text(Theme.sourceDisplayName(for: source))
            .font(.caption2)
            .fontWeight(.semibold)
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Theme.sourceColor(for: source))
            .clipShape(Capsule())
    }
}
