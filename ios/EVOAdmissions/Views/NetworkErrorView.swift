import SwiftUI

struct NetworkErrorView: View {
    let message: String
    @ObservedObject var router: SessionRouter
    @State private var isRetrying = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                // A11y (9b): системный текст-стиль вместо фиксированных 40pt
                // (Dynamic Type); сам символ — декорация рядом с заголовком.
                .font(.largeTitle)
                .imageScale(.large)
                .foregroundStyle(Color("AccentColor"))
                .accessibilityHidden(true)

            Text("network_error_title")
                .font(.title3.bold())

            Text(message)
                .font(.footnote)
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
        }
        .padding(32)
    }
}
