import SwiftUI
import UIKit

extension Color {
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

enum Theme {
    // MARK: - Colors
    static let primaryTeal = Color(hex: 0x0D9488)
    static let srealityRed = Color(hex: 0xE53E3E)
    static let bezrealitkyBlue = Color(hex: 0x3182CE)
    static let ulovDomovOrange = Color(hex: 0xDD6B20)

    // Cluster tier colors (matching frontend markercluster)
    static let clusterSmall = Color(hex: 0x0D9488)   // teal, count < 10
    static let clusterMedium = Color(hex: 0xF59E0B)  // amber, count 10–49
    static let clusterLarge = Color(hex: 0xEF4444)    // red, count ≥ 50

    static var cardBackground: Color { Color(UIColor.systemBackground) }
    static var chipBackground: Color { Color(UIColor.secondarySystemBackground) }
    static var secondaryText: Color { Color(UIColor.secondaryLabel) }

    // MARK: - Spacing
    static let spacingXS: CGFloat = 4
    static let spacingSM: CGFloat = 8
    static let spacingMD: CGFloat = 12
    static let spacingLG: CGFloat = 16
    static let spacingXL: CGFloat = 24

    // MARK: - Radius
    static let radiusSM: CGFloat = 8
    static let radiusMD: CGFloat = 12
    static let radiusLG: CGFloat = 16
    static let radiusXL: CGFloat = 24

    // MARK: - Source Color
    static func sourceColor(for source: String) -> Color {
        switch source.lowercased() {
        case "sreality": return srealityRed
        case "bezrealitky": return bezrealitkyBlue
        case "ulovdomov": return ulovDomovOrange
        default: return primaryTeal
        }
    }

    static func sourceDisplayName(for source: String) -> String {
        switch source.lowercased() {
        case "sreality": return "Sreality"
        case "bezrealitky": return "Bezrealitky"
        case "ulovdomov": return "UlovDomov"
        default: return source.capitalized
        }
    }
}
