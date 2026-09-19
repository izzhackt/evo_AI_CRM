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
                TabShell(session: session, router: router)
            case .needsApplication(let entry):
                // PORT-9a: signed-in без заявки — анкета (честная замена
                // прежнего безликого accessPending для этого случая).
                NavigationStack {
                    ApplicationWizardView(
                        router: router,
                        mode: .signedIn(
                            email: entry.signedInEmail ?? "",
                            expectedRevision: entry.expectedRevision
                        ),
                        draft: entry.draft,
                        namePrefill: entry.namePrefill
                    )
                    .navigationTitle("apply_wizard_title")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("apply_logout") {
                                Task { await router.signOut() }
                            }
                            .accessibilityLabel(Text("apply_logout"))
                        }
                    }
                }
                .id("\(entry.signedInEmail ?? "")#\(entry.expectedRevision)")
            case .applicationStatus(let application):
                ApplicationStatusView(router: router, application: application)
            case .accessPending:
                AccessPendingView(router: router)
            case .networkError(let message):
                NetworkErrorView(message: message, router: router)
            }
        }
    }
}
