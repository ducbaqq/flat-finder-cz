import SwiftUI

struct ClusterAnnotationView: View {
    let count: Int

    private var tier: (size: CGFloat, color: Color) {
        if count >= 50 {
            return (48, Theme.clusterLarge)
        } else if count >= 10 {
            return (42, Theme.clusterMedium)
        } else {
            return (36, Theme.clusterSmall)
        }
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(tier.color.opacity(0.2))
                .frame(width: tier.size + 8, height: tier.size + 8)

            Circle()
                .fill(tier.color)
                .frame(width: tier.size, height: tier.size)

            Text(count > 999 ? "\(count / 1000)k+" : "\(count)")
                .font(.system(size: count > 99 ? 10 : 12, weight: .bold))
                .foregroundStyle(.white)
        }
    }
}
