import SwiftUI

// MARK: - View Modifiers

struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Theme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD))
            .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 2)
    }
}

struct GlassMaterial: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD))
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardStyle())
    }

    func glassMaterial() -> some View {
        modifier(GlassMaterial())
    }
}

// MARK: - Number Formatting

extension Double {
    var formattedCZK: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = " "
        formatter.maximumFractionDigits = 0
        return (formatter.string(from: NSNumber(value: self)) ?? "\(Int(self))") + " Kč"
    }

    var formattedArea: String {
        if self == floor(self) {
            return "\(Int(self)) m²"
        }
        return String(format: "%.1f m²", self)
    }
}
