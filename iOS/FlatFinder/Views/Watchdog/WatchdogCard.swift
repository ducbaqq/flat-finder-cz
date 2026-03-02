import SwiftUI

struct WatchdogCard: View {
    let watchdog: Watchdog
    @Bindable var viewModel: WatchdogViewModel

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(watchdog.label ?? "Hlídací pes")
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text(watchdog.filterSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()

            Toggle("", isOn: Binding(
                get: { watchdog.active },
                set: { _ in
                    viewModel.toggle(watchdog: watchdog)
                    HapticManager.selection()
                }
            ))
            .tint(Theme.primaryTeal)
            .labelsHidden()
        }
        .padding(.vertical, 4)
    }
}
