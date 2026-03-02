import SwiftUI
import Charts

struct BarChartView: View {
    let title: String
    let data: [(String, Int)]
    var labelMapper: ((String) -> String)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .padding(.horizontal)

            Chart(data, id: \.0) { key, value in
                BarMark(
                    x: .value("Počet", value),
                    y: .value("Typ", labelMapper?(key) ?? key)
                )
                .foregroundStyle(Theme.primaryTeal.gradient)
                .cornerRadius(4)
                .annotation(position: .trailing, spacing: 4) {
                    Text("\(value)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .chartYAxis {
                AxisMarks { _ in
                    AxisValueLabel()
                        .font(.caption)
                }
            }
            .chartXAxis(.hidden)
            .frame(height: CGFloat(max(data.count, 1)) * 40)
            .padding(.horizontal)
        }
        .padding(.vertical, 12)
        .cardStyle()
        .padding(.horizontal)
    }
}
