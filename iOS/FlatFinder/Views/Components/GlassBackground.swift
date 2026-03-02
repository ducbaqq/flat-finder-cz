import SwiftUI

struct GlassBackgroundModifier: ViewModifier {
    var cornerRadius: CGFloat = Theme.radiusMD

    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
    }
}

extension View {
    func glassBackground(cornerRadius: CGFloat = Theme.radiusMD) -> some View {
        modifier(GlassBackgroundModifier(cornerRadius: cornerRadius))
    }
}
