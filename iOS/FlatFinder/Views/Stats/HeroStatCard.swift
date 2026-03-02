import SwiftUI

struct HeroStatCard: View {
    let value: Int
    let label: String
    let icon: String

    @State private var displayValue: Int = 0

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 32))
                .foregroundStyle(Theme.primaryTeal)

            Text("\(displayValue)")
                .font(.system(size: 42, weight: .bold, design: .rounded))
                .contentTransition(.numericText())

            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .cardStyle()
        .padding(.horizontal)
        .onAppear {
            withAnimation(.easeOut(duration: 0.8)) {
                displayValue = value
            }
        }
        .onChange(of: value) { _, newValue in
            withAnimation(.easeOut(duration: 0.5)) {
                displayValue = newValue
            }
        }
    }
}
