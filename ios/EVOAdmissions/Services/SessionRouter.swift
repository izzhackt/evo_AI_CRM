import Foundation
import Supabase

/// Drives the app's top-level navigation from Supabase auth state plus the
/// authority/case RPCs, per docs/adr/0030-portal-iphone-swiftui-supabase-transport.md.
///
/// PORT-9a replaces the former case-less accessPending routing with honest
/// анкета states (docs/PLAN_CHANGES.md PORT-9a, решение 3): a signed-in user
/// without portal authority is routed by their own application —
/// no application → wizard, pending/rejected/approved-but-not-active →
/// status screen; a valid user_metadata draft is submitted first (the same
/// resume the web performs after account creation).
@MainActor
final class SessionRouter: ObservableObject {
    struct PortalSession {
        let authority: CurrentActorAuthority
        let portalCase: StudentPortalCase
        var accessTier: AccessTier { portalCase.accessTier }
    }

    /// What the анкета wizard opens with (web ApplicationWizard props).
    struct ApplicationEntry: Equatable {
        var signedInEmail: String? = nil
        /// Prefill draft: the rejected application's questionnaire on
        /// resubmit, or the invalid-free metadata draft is submitted instead
        /// of prefilled (resume), so this stays nil for new applications.
        var draft: StudentApplicationDraft? = nil
        /// 0 for a first application; the rejected revision on resubmit
        /// (apply/page.tsx:48).
        var expectedRevision: Int64 = 0
        /// PORT-1b-parity invited-name prefill (apply/page.tsx:52-63).
        var namePrefill: ApplicationNamePrefill? = nil
    }

    struct ApplicationNamePrefill: Equatable {
        let firstName: String
        let lastName: String
    }

    enum State {
        case signedOut
        case authenticating
        /// A Supabase auth session exists; resolving
        /// `current_actor_authority` / `student_portal_cases` (spec: the
        /// "authorized" step) before routing further.
        case resolvingAccess
        case active(PortalSession)
        /// Signed in, no application yet — the анкета wizard entry.
        case needsApplication(ApplicationEntry)
        /// Signed in with an application: pending, rejected (with resubmit)
        /// or approved while authority is still propagating.
        case applicationStatus(StudentApplication)
        /// Staff/non-student authority, multi-case account, unconfirmed
        /// email or a staff-provisioned marker — this app has no surface for
        /// these; the web остаётся их местом.
        case accessPending
        case networkError(message: String)
    }

    @Published private(set) var state: State = .signedOut
    @Published var signInError: String?
    /// The invite screens drive verifyOTP/password themselves; while they
    /// are on screen the router must not react to their auth events.
    var inviteFlowActive = false

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
        if inviteFlowActive { return }
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
        case .accessPending, .networkError, .needsApplication, .applicationStatus:
            await resolveAccess()
        case .signedOut, .authenticating, .resolvingAccess, .active:
            break
        }
    }

    /// «Обновить статус» / «Открыть кабинет» — the web's
    /// refreshStudentApplicationAction refreshes the session first
    /// (student-signup-actions.ts:95) so an approval becomes visible.
    func refreshApplicationStatus() async {
        try? await service.refreshSession()
        await resolveAccess()
    }

    /// «Исправить анкету» (ApplicationStatus.tsx:64, /apply?edit=1): the
    /// wizard reopens on the rejected questionnaire with its revision.
    func startResubmit(from application: StudentApplication) {
        guard application.status == .rejected else { return }
        state = .needsApplication(ApplicationEntry(
            signedInEmail: application.email,
            draft: application.questionnaire,
            expectedRevision: application.revision
        ))
    }

    /// The wizard's signed-in submit succeeded — show the fresh application.
    func applicationSubmitted(_ application: StudentApplication) {
        state = .applicationStatus(application)
    }

    /// The invite screens finished driving auth; resume honest routing.
    /// Without a session (the flow was cancelled before verifyOTP) the app
    /// stays signed out instead of probing RPCs.
    func inviteFlowFinished() async {
        inviteFlowActive = false
        if service.client.auth.currentSession == nil {
            state = .signedOut
            return
        }
        await resolveAccess()
    }

    func signOut() async {
        try? await service.signOut()
        state = .signedOut
    }

    private func resolveAccess() async {
        state = .resolvingAccess
        do {
            let authority = try await service.currentActorAuthority()
            var cases: [StudentPortalCase] = []
            if authority?.isStudent == true {
                cases = try await service.studentPortalCases()
            }
            switch ApplicationAccessPolicy.authorityRoute(
                isStudent: authority?.isStudent,
                caseCount: cases.count
            ) {
            case .active:
                guard let authority, cases.count == 1, let onlyCase = cases.first else {
                    state = .accessPending
                    return
                }
                state = .active(PortalSession(authority: authority, portalCase: onlyCase))
            case .accessPending:
                state = .accessPending
            case .applicationFlow:
                await resolveApplicationFlow()
            }
        } catch {
            if isTransportError(error) {
                state = .networkError(message: error.localizedDescription)
            } else {
                state = .accessPending
            }
        }
    }

    /// The анкетный маршрут (PLAN_CHANGES PORT-9a решение 3): identity gates,
    /// own application, metadata resume, wizard entry with invited prefill.
    private func resolveApplicationFlow() async {
        do {
            let identity = try await service.studentSessionIdentity()
            let application = try await service.ownStudentApplication()
            switch ApplicationAccessPolicy.applicationRoute(
                emailConfirmed: identity.emailConfirmed,
                passwordProvisionedStaff: ApplicationAccessPolicy.isPasswordProvisionedStaff(
                    marker: identity.staffProvisionMarker
                ),
                hasApplication: application != nil,
                metadataDraftValid: identity.metadataDraft != nil
            ) {
            case .accessPending:
                state = .accessPending
            case .status:
                guard let application else {
                    state = .accessPending
                    return
                }
                state = .applicationStatus(application)
            case .resumeSubmit:
                await resumeMetadataDraft(identity: identity)
            case .wizard:
                // Convenience prefill for an invited anketa_v1 user; a failed
                // or mismatched acceptance never blocks the wizard (the same
                // stance as the web's try/catch around the receipt read,
                // apply/page.tsx:52-62). For the receipt owner this also
                // heals an interrupted native invite flow: acceptance is
                // idempotent server-side.
                var prefill: ApplicationNamePrefill?
                if let outcome = try? await service.acceptStudentInvite(),
                   case let .accepted(receipt) = outcome,
                   receipt.intakeFlow == "anketa_v1",
                   receipt.accountPending,
                   let split = InviteLinkPolicy.namePrefill(displayName: receipt.displayName) {
                    prefill = ApplicationNamePrefill(
                        firstName: split.firstName,
                        lastName: split.lastName
                    )
                }
                state = .needsApplication(ApplicationEntry(
                    signedInEmail: identity.email,
                    namePrefill: prefill
                ))
            }
        } catch {
            if isTransportError(error) {
                state = .networkError(message: error.localizedDescription)
            } else {
                state = .accessPending
            }
        }
    }

    /// resumeStudentApplication parity (student-signup-runtime.ts:40-61):
    /// submit the metadata draft (idempotent by its requestId), then clear
    /// the metadata; the committed row wins even if cleanup fails.
    private func resumeMetadataDraft(identity: SupabaseService.StudentSessionIdentity) async {
        guard let draft = identity.metadataDraft else {
            state = .accessPending
            return
        }
        do {
            let application = try await service.submitStudentApplication(
                draft: draft,
                expectedRevision: 0
            )
            try? await service.clearStudentApplicationMetadataDraft()
            state = .applicationStatus(application)
        } catch {
            if isTransportError(error) {
                state = .networkError(message: error.localizedDescription)
                return
            }
            // A conflict means an application already exists (the web's
            // idempotency lesson): read it back and show the honest status.
            if let application = try? await service.ownStudentApplication() {
                try? await service.clearStudentApplicationMetadataDraft()
                state = .applicationStatus(application)
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
