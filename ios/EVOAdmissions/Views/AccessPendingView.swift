import SwiftUI

struct AccessPendingView: View {
    @ObservedObject var router: SessionRouter
    @State private var isRetrying = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "hourglass")
                // A11y (9b): системный текст-стиль вместо фиксированных 40pt
                // (Dynamic Type); сам символ — декорация рядом с заголовком.
                .font(.largeTitle)
                .imageScale(.large)
                .foregroundStyle(Color("AccentColor"))
                .accessibilityHidden(true)

            Text("access_pending_title")
                .font(.title3.bold())
                .multilineTextAlignment(.center)

            Text("access_pending_body")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button {
                Task {
                    isRetrying = true
                    await router.retry()
                    isRetrying = false
                }
            } label: {
                if isRetrying {
                    ProgressView()
                } else {
                    Text("retry_button")
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Color("AccentColor"))
            // A11y (9b): во время повтора label — ProgressView без текста.
            .accessibilityLabel(Text("retry_button"))

            Button("sign_out_button") {
                Task { await router.signOut() }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(32)
    }
}
