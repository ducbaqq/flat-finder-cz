import SwiftUI

struct FilterSheet: View {
    @Environment(FilterState.self) private var filterState
    @Environment(\.dismiss) private var dismiss
    @Bindable var listingsVM: ListingsViewModel

    var body: some View {
        @Bindable var filters = filterState
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Transaction type
                    FilterPickerSection(
                        title: "Typ transakce",
                        options: FilterState.transactionTypes,
                        selection: $filters.transactionType
                    )

                    // Property type
                    FilterPickerSection(
                        title: "Typ nemovitosti",
                        options: FilterState.propertyTypes,
                        selection: $filters.propertyType
                    )

                    // Price range
                    FilterRangeSection(
                        title: "Cena",
                        unit: "Kč",
                        minValue: $filters.priceMin,
                        maxValue: $filters.priceMax
                    )

                    // Size range
                    FilterRangeSection(
                        title: "Velikost",
                        unit: "m²",
                        minValue: $filters.sizeMin,
                        maxValue: $filters.sizeMax
                    )

                    // Layout
                    FilterChipGridSection(
                        title: "Dispozice",
                        options: FilterState.layouts,
                        selection: $filters.layout
                    )

                    Divider()

                    // Advanced filters
                    DisclosureGroup("Pokročilé filtry") {
                        VStack(spacing: 16) {
                            FilterLabeledChipGridSection(
                                title: "Stav",
                                options: FilterState.conditions,
                                selection: $filters.condition
                            )

                            FilterLabeledChipGridSection(
                                title: "Konstrukce",
                                options: FilterState.constructions,
                                selection: $filters.construction
                            )

                            FilterLabeledChipGridSection(
                                title: "Vlastnictví",
                                options: FilterState.ownerships,
                                selection: $filters.ownership
                            )

                            FilterLabeledChipGridSection(
                                title: "Vybavení",
                                options: FilterState.furnishings,
                                selection: $filters.furnishing
                            )

                            FilterChipGridSection(
                                title: "Energetická třída",
                                options: FilterState.energyRatings,
                                selection: $filters.energyRating
                            )

                            FilterLabeledChipGridSection(
                                title: "Zdroj",
                                options: [
                                    ("sreality", "Sreality"),
                                    ("bezrealitky", "Bezrealitky"),
                                    ("ulovdomov", "UlovDomov"),
                                ],
                                selection: $filters.source
                            )
                        }
                        .padding(.top, 8)
                    }
                    .tint(Theme.primaryTeal)
                }
                .padding()
            }
            .navigationTitle("Filtry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vymazat") {
                        withAnimation {
                            filterState.reset()
                        }
                        HapticManager.impact(.light)
                    }
                    .foregroundStyle(Theme.primaryTeal)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Text("Zobrazit \(listingsVM.totalCount) nabídek")
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
        .presentationDetents([.large])
    }
}
