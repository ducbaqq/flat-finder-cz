import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            SearchTab()
                .tabItem {
                    Label("Hledat", systemImage: "magnifyingglass")
                }

            WatchdogTab()
                .tabItem {
                    Label("Hlídací pes", systemImage: "bell.badge")
                }

            StatsTab()
                .tabItem {
                    Label("Statistiky", systemImage: "chart.bar")
                }
        }
        .tint(Theme.primaryTeal)
    }
}
