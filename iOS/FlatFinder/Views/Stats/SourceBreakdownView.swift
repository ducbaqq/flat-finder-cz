import SwiftUI

struct SourceBreakdownView: View {
    let bySource: [String: Int]
    let total: Int

    var body: some View {
        HStack(spacing: 10) {
            sourceCard("sreality", count: bySource["sreality"] ?? 0)
            sourceCard("bezrealitky", count: bySource["bezrealitky"] ?? 0)
            sourceCard("ulovdomov", count: bySource["ulovdomov"] ?? 0)
        }
        .padding(.horizontal)
    }

    private func sourceCard(_ source: String, count: Int) -> some View {
        VStack(spacing: 6) {
            Text(Theme.sourceDisplayName(for: source))
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.sourceColor(for: source))

            Text("\(count)")
                .font(.title3)
                .fontWeight(.bold)

            if total > 0 {
                Text("\(Int(Double(count) / Double(total) * 100))%")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Theme.sourceColor(for: source).opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD))
    }
}
