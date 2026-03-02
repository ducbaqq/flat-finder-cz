import SwiftUI

struct SearchBar: View {
    @Environment(FilterState.self) private var filterState
    @Binding var showFilters: Bool

    var body: some View {
        @Bindable var filters = filterState
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Město, adresa...", text: $filters.location)
                    .textFieldStyle(.plain)
                    .font(.subheadline)
                if !filterState.location.isEmpty {
                    Button {
                        filterState.location = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Theme.chipBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD))

            Button {
                HapticManager.impact(.light)
                showFilters = true
            } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "slider.horizontal.3")
                        .font(.title3)
                        .foregroundStyle(Theme.primaryTeal)
                        .frame(width: 44, height: 44)
                        .background(Theme.chipBackground)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD))

                    if filterState.activeFilterCount > 0 {
                        Text("\(filterState.activeFilterCount)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 18, height: 18)
                            .background(Theme.primaryTeal)
                            .clipShape(Circle())
                            .offset(x: 4, y: -4)
                    }
                }
            }
        }
    }
}
