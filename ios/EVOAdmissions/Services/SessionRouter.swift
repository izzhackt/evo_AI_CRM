import Foundation
import Supabase

/// Drives the app's top-level navigation from Supabase auth state plus the
/// authority/case RPCs, per docs/adr/0030-portal-iphone-swiftui-supabase-transport.md.
@MainActor
final class SessionRouter: ObservableObject {
    struct PortalSession {
        let authority: CurrentActorAuthority
        let portalCase: StudentPortalCase
        var accessTier: AccessTier { portalCase.accessTier }
    }

    enum State {
        case signedOut
        case authenticating
        /// A Supabase auth session exists; resolving
        /// `current_actor_authority` / `student_portal_cases` (spec: the
        /// "authorized" step) before routing further.
        case resolvingAccess
        case active(PortalSession)
        /// Authority absent, not a student, or case count isn't exactly one —
        /// the anketa/case-less flow on phone is a later slice.
        case accessPending
        case networkError(message: String)
    }

    @Published private(set) var state: State = .signedOut
    @Published var signInError: String?

    private let service: SupabaseService
    private var authListenerTask: Task<Void, Never>?

    init(service: SupabaseService = .shared) {
        self.service = service
        observeAuthChanges()
    }

    deinit {
        authListenerTask?.cancel()
    }

    private func observeAuthChanges() {
        authListenerTask = Task { [weak self] in
            guard let self else { return }
            for await (event, session) in service.client.auth.authStateChanges {
                if Task.isCancelled { return }
                await self.handle(event: event, session: session)
            }
        }
    }

    private func handle(event: AuthChangeEvent, session: Session?) async {
        switch event {
        case .initialSession, .signedIn, .tokenRefreshed:
            if session != nil {
                await resolveAccess()
            } else {
                state = .signedOut
            }
        case .signedOut:
            state = .signedOut
        case .passwordRecovery, .userUpdated, .userDeleted:
            break
        @unknown default:
            break
        }
    }

    func signIn(email: String, password: String) async {
        signInError = nil
        state = .authenticating
        do {
            try await service.signIn(email: email, password: password)
            // authStateChanges delivers .signedIn next and drives resolveAccess().
        } catch {
            signInError = error.localizedDescription
            state = .signedOut
        }
    }

    func retry() async {
        switch state {
        case .accessPending, .networkError:
            await resolveAccess()
        case .signedOut, .authenticating, .resolvingAccess, .active:
            break
        }
    }

    func signOut() async {
        try? await service.signOut()
        state = .signedOut
    }

    private func resolveAccess() async {
        state = .resolvingAccess
        do {
            guard
                let authority = try await service.currentActorAuthority(),
                authority.isStudent
            else {
                state = .accessPending
                return
            }
            let cases = try await service.studentPortalCases()
            guard cases.count == 1, let onlyCase = cases.first else {
                state = .accessPending
                return
            }
            state = .active(PortalSession(authority: authority, portalCase: onlyCase))
        } catch {
            if isTransportError(error) {
                state = .networkError(message: error.localizedDescription)
            } else {
                state = .accessPending
            }
        }
    }

    private func isTransportError(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut,
             .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
            return true
        default:
            return false
        }
    }
}
