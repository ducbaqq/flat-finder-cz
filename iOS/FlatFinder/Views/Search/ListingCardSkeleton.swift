import SwiftUI

struct ListingCardSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: Theme.radiusSM)
                .fill(Color(UIColor.systemGray5))
                .frame(width: 110, height: 90)
                .shimmer()

            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(UIColor.systemGray5))
                    .frame(height: 14)
                    .shimmer()

                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(UIColor.systemGray5))
                    .frame(width: 100, height: 14)
                    .shimmer()

                HStack(spacing: 6) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color(UIColor.systemGray5))
                            .frame(width: 50, height: 20)
                            .shimmer()
                    }
                }
            }
        }
        .padding(10)
        .cardStyle()
    }
}
