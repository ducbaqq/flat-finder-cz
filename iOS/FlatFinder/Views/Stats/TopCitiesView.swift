import SwiftUI

struct TopCitiesView: View {
    let cities: [String: Int]

    private var sorted: [(String, Int)] {
        cities.map { ($0.key, $0.value) }.sorted { $0.1 > $1.1 }
    }

    private var maxValue: Int {
        sorted.first?.1 ?? 1
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Top města")
                .font(.headline)
                .padding(.horizontal)

            ForEach(Array(sorted.enumerated()), id: \.offset) { index, item in
                HStack(spacing: 10) {
                    Text("\(index + 1)")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundStyle(.secondary)
                        .frame(width: 20)

                    Text(item.0)
                        .font(.subheadline)
                        .frame(width: 80, alignment: .leading)

                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Theme.primaryTeal.opacity(0.7))
                            .frame(width: geo.size.width * CGFloat(item.1) / CGFloat(maxValue))
                    }
                    .frame(height: 20)

                    Text("\(item.1)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 40, alignment: .trailing)
                }
                .padding(.horizontal)
            }
        }
        .padding(.vertical, 12)
        .cardStyle()
        .padding(.horizontal)
    }
}
