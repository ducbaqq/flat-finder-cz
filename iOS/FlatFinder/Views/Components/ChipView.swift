import SwiftUI

struct ChipView: View {
    let label: String
    var icon: String?
    var isSelected: Bool = false
    var onRemove: (() -> Void)?

    var body: some View {
        HStack(spacing: 4) {
            if let icon {
                Image(systemName: icon)
                    .font(.caption2)
            }
            Text(label)
                .font(.caption)
                .lineLimit(1)
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .foregroundStyle(isSelected ? .white : .primary)
        .background(isSelected ? Theme.primaryTeal : Theme.chipBackground)
        .clipShape(Capsule())
    }
}
