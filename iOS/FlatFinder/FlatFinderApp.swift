import SwiftUI

@main
struct FlatFinderApp: App {
    @State private var filterState = FilterState()

    var body: some Scene {
        WindowGroup {
            MainTabView()
                .environment(filterState)
        }
    }
}
