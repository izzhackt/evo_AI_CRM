import SwiftUI

struct RootView: View {
    @StateObject private var router = SessionRouter()

    var body: some View {
        Group {
            switch router.state {
            case .signedOut, .authenticating:
                SignInView(router: router)
            case .resolvingAccess:
                ProgressView()
                    .controlSize(.large)
            case .active(let session):
                TabShell(session: session)
            case .accessPending:
                AccessPendingView(router: router)
            case .networkError(let message):
                NetworkErrorView(message: message, router: router)
            }
        }
    }
}
