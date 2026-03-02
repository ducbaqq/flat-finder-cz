import SwiftUI

struct CreateWatchdogSheet: View {
    @Environment(FilterState.self) private var filterState
    @Environment(\.dismiss) private var dismiss
    @Bindable var viewModel: WatchdogViewModel
    @State private var label = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Název") {
                    TextField("Např. Praha pronájem bytů", text: $label)
                }

                Section("E-mail") {
                    Text(viewModel.email)
                        .foregroundStyle(.secondary)
                }

                Section("Aktivní filtry") {
                    let activeFilters = filterState.activeFilters
                    if activeFilters.isEmpty {
                        Text("Žádné filtry — budete dostávat všechny nabídky")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        FlowLayout(spacing: 6) {
                            ForEach(Array(activeFilters.enumerated()), id: \.offset) { _, filter in
                                ChipView(label: filter.label, isSelected: true)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Nový hlídací pes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Zrušit") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        viewModel.createWatchdog(
                            filters: filterState,
                            label: label.isEmpty ? "Hlídací pes" : label
                        )
                        dismiss()
                    } label: {
                        Text("Uložit")
                            .fontWeight(.semibold)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Theme.primaryTeal)
                            .clipShape(Capsule())
                    }
                }
            }
        }
    }
}
