import SwiftUI

struct StatsTab: View {
    @State private var viewModel = StatsViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.stats == nil {
                    ProgressView()
                } else if let error = viewModel.error, viewModel.stats == nil {
                    ContentUnavailableView {
                        Label("Chyba", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Zkusit znovu") {
                            viewModel.fetchStats()
                        }
                    }
                } else if let stats = viewModel.stats {
                    ScrollView {
                        VStack(spacing: 16) {
                            // Hero stat
                            HeroStatCard(
                                value: stats.total,
                                label: "aktivních nabídek",
                                icon: "house.fill"
                            )

                            // Source breakdown
                            SourceBreakdownView(bySource: stats.bySource, total: stats.total)

                            // By property type
                            BarChartView(
                                title: "Podle typu",
                                data: stats.byType.map { ($0.key, $0.value) }.sorted { $0.1 > $1.1 },
                                labelMapper: propertyTypeLabel
                            )

                            // By transaction type
                            BarChartView(
                                title: "Podle transakce",
                                data: stats.byTransaction.map { ($0.key, $0.value) }.sorted { $0.1 > $1.1 },
                                labelMapper: transactionLabel
                            )

                            // Top cities
                            TopCitiesView(cities: stats.byCity)

                            // Inactive stats
                            HStack {
                                statBadge(
                                    icon: "archivebox",
                                    label: "Celkem",
                                    value: "\(stats.totalAll)"
                                )
                                statBadge(
                                    icon: "eye.slash",
                                    label: "Neaktivní",
                                    value: "\(stats.inactive)"
                                )
                            }
                            .padding(.horizontal)
                        }
                        .padding(.vertical)
                    }
                    .refreshable {
                        viewModel.fetchStats()
                    }
                }
            }
            .navigationTitle("Statistiky")
            .task {
                viewModel.fetchStats()
            }
        }
    }

    private func statBadge(icon: String, label: String, value: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(Theme.primaryTeal)
            VStack(alignment: .leading) {
                Text(value)
                    .font(.headline)
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .cardStyle()
    }

    private func propertyTypeLabel(_ key: String) -> String {
        switch key {
        case "flat": return "Byty"
        case "house": return "Domy"
        case "land": return "Pozemky"
        case "commercial": return "Komerční"
        case "garage": return "Garáže"
        default: return key.capitalized
        }
    }

    private func transactionLabel(_ key: String) -> String {
        switch key {
        case "rent": return "Pronájem"
        case "sale": return "Prodej"
        case "auction": return "Aukce"
        default: return key.capitalized
        }
    }
}
