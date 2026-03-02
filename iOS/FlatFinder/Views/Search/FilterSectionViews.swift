import SwiftUI

struct FilterPickerSection: View {
    let title: String
    let options: [(String, String)]
    @Binding var selection: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.semibold)

            Picker(title, selection: $selection) {
                ForEach(options, id: \.0) { value, label in
                    Text(label).tag(value)
                }
            }
            .pickerStyle(.segmented)
        }
    }
}

struct FilterRangeSection: View {
    let title: String
    let unit: String
    @Binding var minValue: String
    @Binding var maxValue: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.semibold)

            HStack(spacing: 12) {
                HStack {
                    TextField("Od", text: $minValue)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.plain)
                    Text(unit)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Theme.chipBackground)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSM))

                Text("–")
                    .foregroundStyle(.secondary)

                HStack {
                    TextField("Do", text: $maxValue)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.plain)
                    Text(unit)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Theme.chipBackground)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSM))
            }
        }
    }
}

struct FilterChipGridSection: View {
    let title: String
    let options: [String]
    @Binding var selection: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.semibold)

            FlowLayout(spacing: 6) {
                ForEach(options, id: \.self) { option in
                    ChipView(label: option, isSelected: selection.contains(option))
                        .onTapGesture {
                            HapticManager.selection()
                            if selection.contains(option) {
                                selection.remove(option)
                            } else {
                                selection.insert(option)
                            }
                        }
                }
            }
        }
    }
}

struct FilterLabeledChipGridSection: View {
    let title: String
    let options: [(String, String)]
    @Binding var selection: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.semibold)

            FlowLayout(spacing: 6) {
                ForEach(options, id: \.0) { value, label in
                    ChipView(label: label, isSelected: selection.contains(value))
                        .onTapGesture {
                            HapticManager.selection()
                            if selection.contains(value) {
                                selection.remove(value)
                            } else {
                                selection.insert(value)
                            }
                        }
                }
            }
        }
    }
}

// MARK: - FlowLayout

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (positions: [CGPoint], size: CGSize) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x)
        }

        return (positions, CGSize(width: maxX, height: y + rowHeight))
    }
}
