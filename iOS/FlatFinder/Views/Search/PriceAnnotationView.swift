import SwiftUI

struct PriceAnnotationView: View {
    let price: String
    let source: String

    var body: some View {
        Circle()
            .fill(Theme.primaryTeal)
            .frame(width: 12, height: 12)
            .overlay(
                Circle()
                    .stroke(.white, lineWidth: 2)
            )
            .shadow(color: .black.opacity(0.3), radius: 3, x: 0, y: 2)
    }
}
