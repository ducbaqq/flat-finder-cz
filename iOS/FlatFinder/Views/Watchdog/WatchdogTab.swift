import SwiftUI

struct WatchdogTab: View {
    @Environment(FilterState.self) private var filterState
    @State private var viewModel = WatchdogViewModel()
    @State private var showCreateSheet = false
    @State private var emailSubmitted = false

    var body: some View {
        NavigationStack {
            Group {
                if !emailSubmitted && viewModel.email.isEmpty {
                    emailEntryView
                } else {
                    watchdogListView
                }
            }
            .navigationTitle("Hlídací pes")
            .toolbar {
                if emailSubmitted || !viewModel.email.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            HapticManager.impact(.light)
                            showCreateSheet = true
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .foregroundStyle(Theme.primaryTeal)
                        }
                    }
                }
            }
            .sheet(isPresented: $showCreateSheet) {
                CreateWatchdogSheet(viewModel: viewModel)
            }
        }
    }

    private var emailEntryView: some View {
        VStack(spacing: 20) {
            Image(systemName: "bell.badge")
                .font(.system(size: 60))
                .foregroundStyle(Theme.primaryTeal)

            Text("Hlídací pes")
                .font(.title2)
                .fontWeight(.bold)

            Text("Zadejte svůj e-mail pro správu hlídacích psů. Budeme vás informovat o nových nabídkách.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            VStack(spacing: 12) {
                TextField("vas@email.cz", text: $viewModel.email)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, 32)

                Button {
                    emailSubmitted = true
                    viewModel.fetchWatchdogs()
                    HapticManager.impact(.medium)
                } label: {
                    Text("Pokračovat")
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.primaryTeal)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD))
                }
                .padding(.horizontal, 32)
                .disabled(viewModel.email.isEmpty || !viewModel.email.contains("@"))
            }
        }
    }

    private var watchdogListView: some View {
        Group {
            if viewModel.isLoading {
                ProgressView()
            } else if viewModel.watchdogs.isEmpty {
                ContentUnavailableView {
                    Label("Žádní hlídací psi", systemImage: "bell.slash")
                } description: {
                    Text("Vytvořte hlídacího psa a budeme vás informovat o nových nabídkách.")
                } actions: {
                    Button("Vytvořit hlídacího psa") {
                        showCreateSheet = true
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.primaryTeal)
                }
            } else {
                List {
                    ForEach(viewModel.watchdogs) { watchdog in
                        WatchdogCard(watchdog: watchdog, viewModel: viewModel)
                    }
                    .onDelete { indexSet in
                        for index in indexSet {
                            viewModel.delete(watchdog: viewModel.watchdogs[index])
                        }
                    }
                }
                .refreshable {
                    viewModel.fetchWatchdogs()
                }
            }
        }
        .onAppear {
            if !viewModel.email.isEmpty {
                emailSubmitted = true
                viewModel.fetchWatchdogs()
            }
        }
    }
}
