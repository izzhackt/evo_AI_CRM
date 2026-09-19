import SwiftUI

struct NetworkErrorView: View {
    let message: String
    @ObservedObject var router: SessionRouter
    @State private var isRetrying = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40))
                .foregroundStyle(Color("AccentColor"))

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
        }
        .padding(32)
    }
}
