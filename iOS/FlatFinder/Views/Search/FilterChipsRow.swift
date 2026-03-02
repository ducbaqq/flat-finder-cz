import SwiftUI

struct FilterChipsRow: View {
    @Environment(FilterState.self) private var filterState

    var body: some View {
        let activeFilters = filterState.activeFilters
        if !activeFilters.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(activeFilters.enumerated()), id: \.offset) { _, filter in
                        ChipView(label: filter.label, onRemove: {
                            withAnimation(.spring(duration: 0.2)) {
                                filter.clear()
                            }
                            HapticManager.selection()
                        })
                    }

                    if activeFilters.count > 1 {
                        Button {
                            withAnimation(.spring(duration: 0.2)) {
                                filterState.reset()
                            }
                            HapticManager.impact(.light)
                        } label: {
                            Text("Vymazat vše")
                                .font(.caption)
                                .foregroundStyle(Theme.primaryTeal)
                        }
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}
