import Foundation
import Supabase

/// Thin wrapper around the shared `SupabaseClient` for the `platform` schema.
///
/// Session persistence (verified against supabase-swift 2.55.2 source, not
/// assumed): `SupabaseClientOptions.AuthOptions.storage` defaults to
/// `AuthClient.Configuration.defaultLocalStorage`
/// (Sources/Auth/Storage/AuthLocalStorage.swift), which on Apple platforms is
/// `KeychainLocalStorage()` — the file's own doc comment calls it "the default
/// local storage used by the library". `KeychainLocalStorage` stores session
/// bytes under the Keychain service `"supabase.gotrue.swift"`
/// (Sources/Auth/Storage/KeychainLocalStorage.swift). This service passes no
/// custom `auth.storage`, so a signed-in session is written to the Keychain
/// and survives relaunches without any code here.
final class SupabaseService {
    static let shared = SupabaseService()

    let client: SupabaseClient

    private init() {
        client = SupabaseClient(
            supabaseURL: AppConfig.supabaseURL,
            supabaseKey: AppConfig.supabasePublishableKey,
            options: SupabaseClientOptions(
                db: .init(schema: "platform")
            )
        )
    }

    @discardableResult
    func signIn(email: String, password: String) async throws -> Session {
        try await client.auth.signIn(email: email, password: password)
    }

    func signOut() async throws {
        try await client.auth.signOut()
    }

    /// `platform.current_actor_authority()` — 0 or 1 row for the signed-in
    /// user. `nil` means no resolvable authority for this account.
    func currentActorAuthority() async throws -> CurrentActorAuthority? {
        let rows: [CurrentActorAuthority] = try await client
            .rpc("current_actor_authority")
            .execute()
            .value
        return rows.first
    }

    /// `platform.student_portal_cases()` — every case row this student may
    /// read. v1 supports exactly the single-case shape.
    func studentPortalCases() async throws -> [StudentPortalCase] {
        try await client
            .rpc("student_portal_cases")
            .execute()
            .value
    }

    /// `platform.student_university_catalog(p_query:p_country:p_level:p_offset:)`
    /// — one page (30 items) of the published catalogue, plus `nextOffset`.
    /// Parameter NAMES are exactly the web wrapper's `args`
    /// (src/lib/v3/university-source.ts:15); the web's `|| null` empties are
    /// expressed by omitting the parameter (the function declares DEFAULT
    /// NULL — the single-card read below already relies on that).
    func studentUniversityCatalog(
        filters: UniversityCatalogFilters = UniversityCatalogFilters(),
        offset: Int = 0
    ) async throws -> UniversityCatalogPage {
        struct Params: Encodable, Sendable {
            let p_query: String?
            let p_country: String?
            let p_level: String?
            let p_offset: Int
        }
        return try await client
            .rpc(
                "student_university_catalog",
                params: Params(
                    p_query: UniversityCatalogFilterPolicy.queryParameter(filters),
                    p_country: UniversityCatalogFilterPolicy.countryParameter(filters),
                    p_level: UniversityCatalogFilterPolicy.levelParameter(filters),
                    p_offset: offset
                )
            )
            .execute()
            .value
    }

    /// Single published card via `p_institution_id`
    /// (supabase/migrations/148: the filter narrows the same page helper to
    /// one institution). `nil` when the institution has no published card.
    func studentUniversityCard(institutionId: UUID) async throws -> UniversityCatalogItem? {
        struct Params: Encodable, Sendable {
            let p_institution_id: UUID
            let p_offset: Int
        }
        let page: UniversityCatalogPage = try await client
            .rpc(
                "student_university_catalog",
                params: Params(p_institution_id: institutionId, p_offset: 0)
            )
            .execute()
            .value
        return page.items.first
    }

    // MARK: - Private assessments (supabase/migrations/135)

    /// `platform.student_assessments_v1()` — instruments plus the caller's
    /// own attempt history. Owner-private by contract.
    func studentAssessments() async throws -> AssessmentCatalog {
        try await client
            .rpc("student_assessments_v1")
            .execute()
            .value
    }

    /// `platform.student_assessment_attempt_v1(p_attempt_id)` — full payload
    /// of one own attempt (questions, answers, result snapshot).
    func studentAssessmentAttempt(id: UUID) async throws -> AssessmentAttempt {
        struct Params: Encodable, Sendable { let p_attempt_id: UUID }
        return try await client
            .rpc("student_assessment_attempt_v1", params: Params(p_attempt_id: id))
            .execute()
            .value
    }

    /// `platform.start_student_assessment_v1` — идемпотентно по
    /// `p_request_id`: повтор с тем же id возвращает тот же receipt, а не
    /// вторую попытку.
    func startAssessment(instrumentKey: String, requestId: UUID) async throws -> AssessmentAttempt {
        struct Params: Encodable, Sendable {
            let p_instrument_key: String
            let p_request_id: UUID
        }
        return try await client
            .rpc(
                "start_student_assessment_v1",
                params: Params(p_instrument_key: instrumentKey, p_request_id: requestId)
            )
            .execute()
            .value
    }

    /// `platform.save_student_assessment_answers_v1` — optimistic-lock save
    /// (`p_expected_revision`), idempotent per `p_request_id`.
    func saveAssessmentAnswers(
        attemptId: UUID,
        expectedRevision: Int64,
        answers: [String: String],
        requestId: UUID
    ) async throws -> AssessmentAttempt {
        try await client
            .rpc(
                "save_student_assessment_answers_v1",
                params: AssessmentWriteParams(
                    p_attempt_id: attemptId,
                    p_expected_revision: expectedRevision,
                    p_answers: answers,
                    p_request_id: requestId
                )
            )
            .execute()
            .value
    }

    /// `platform.complete_student_assessment_v1` — completes and grades the
    /// draft in one transaction; the result snapshot comes back inline.
    func completeAssessment(
        attemptId: UUID,
        expectedRevision: Int64,
        answers: [String: String],
        requestId: UUID
    ) async throws -> AssessmentAttempt {
        try await client
            .rpc(
                "complete_student_assessment_v1",
                params: AssessmentWriteParams(
                    p_attempt_id: attemptId,
                    p_expected_revision: expectedRevision,
                    p_answers: answers,
                    p_request_id: requestId
                )
            )
            .execute()
            .value
    }
    // MARK: - Catalog preparation (supabase/migrations/214)

    /// Student-only command. Keep the same frozen intent after an uncertain
    /// outcome. The receipt pins selection facts; read current status separately.
    func selectCatalogIntake(_ intent: CatalogPreparationIntent) async throws -> CatalogPreparationReceipt {
        do {
            let receipt: CatalogPreparationReceipt = try await client
                .rpc("student_select_catalog_intake_v1", params: intent)
                .execute()
                .value
            try receipt.validate(for: intent)
            return receipt
        } catch let error as PostgrestError {
            throw CatalogPreparationFailure.serverReason(code: error.code, message: error.message) ?? error
        }
    }

    /// Original selected snapshots with CURRENT application status/version.
    /// This independent reader does not depend on the finance/overview request.
    func studentCatalogPreparations(studentCaseId: UUID) async throws -> [CatalogPreparation] {
        struct Params: Encodable, Sendable { let p_student_case_id: UUID }
        do {
            let result: CatalogPreparationList = try await client
                .rpc("student_catalog_preparations_v1", params: Params(p_student_case_id: studentCaseId))
                .execute()
                .value
            try result.validate(studentCaseId: studentCaseId)
            return result.items
        } catch let error as PostgrestError {
            throw CatalogPreparationFailure.serverReason(code: error.code, message: error.message) ?? error
        }
    }

    // MARK: - Application requirements (supabase/migrations/218)

    /// Explicit Student command; a read never initializes requirements. Retain
    /// this exact intent after an uncertain response and read current state separately.
    func initializeApplicationRequirements(_ intent: ApplicationRequirementsIntent) async throws -> ApplicationRequirementsReceipt {
        do {
            let receipt: ApplicationRequirementsReceipt = try await client
                .rpc("student_initialize_application_requirements_v1", params: intent)
                .execute()
                .value
            try receipt.validate(for: intent)
            return receipt
        } catch let error as PostgrestError {
            throw ApplicationRequirementsFailure.serverReason(code: error.code, message: error.message) ?? error
        }
    }

    /// Current programme-scoped requirements; preserves uninitialized and
    /// needs_configuration instead of treating them as an empty ready checklist.
    func studentApplicationRequirements(studentCaseId: UUID, applicationId: UUID) async throws -> ApplicationRequirementsView {
        struct Params: Encodable, Sendable {
            let p_student_case_id: String
            let p_application_id: String
        }
        do {
            let result: ApplicationRequirementsView = try await client
                .rpc("student_application_requirements_v1", params: Params(
                    p_student_case_id: studentCaseId.uuidString.lowercased(),
                    p_application_id: applicationId.uuidString.lowercased()
                ))
                .execute()
                .value
            try result.validate(studentCaseId: studentCaseId, applicationId: applicationId)
            return result
        } catch let error as PostgrestError {
            throw ApplicationRequirementsFailure.serverReason(code: error.code, message: error.message) ?? error
        }
    }

    // MARK: - University favourites (supabase/migrations/195)

    /// `platform.set_university_favorite_v1(p_institution_id, p_favored)` —
    /// идемпотентная запись по построению (INSERT … ON CONFLICT DO NOTHING /
    /// DELETE, 195:74-83): повтор не меняет состояние и возвращает фактический
    /// receipt, поэтому request-ledger'а у этой RPC нет.
    func setUniversityFavorite(institutionId: UUID, favored: Bool) async throws -> FavoriteReceipt {
        struct Params: Encodable, Sendable {
            let p_institution_id: UUID
            let p_favored: Bool
        }
        return try await client
            .rpc(
                "set_university_favorite_v1",
                params: Params(p_institution_id: institutionId, p_favored: favored)
            )
            .execute()
            .value
    }

    /// `platform.student_university_favorites_v1()` — only the caller's own
    /// rows, newest first (195:98-114).
    func studentUniversityFavorites() async throws -> [UniversityFavorite] {
        try await client
            .rpc("student_university_favorites_v1")
            .execute()
            .value
    }

    /// `platform.student_university_catalog_by_ids_v1(p_institution_ids)` —
    /// batch card read, same row shape as the catalogue page (195:159-166).
    /// Ceiling is 30 ids per call (195:129); the caller chunks larger sets.
    func studentUniversityCatalogByIds(institutionIds: [UUID]) async throws -> UniversityCatalogPage {
        struct Params: Encodable, Sendable { let p_institution_ids: [UUID] }
        return try await client
            .rpc(
                "student_university_catalog_by_ids_v1",
                params: Params(p_institution_ids: institutionIds)
            )
            .execute()
            .value
    }

    // MARK: - Portal profile (supabase/migrations/196)

    /// `platform.get_own_portal_profile_v1()` (196:71-106).
    func getOwnPortalProfile() async throws -> PortalProfile {
        try await client
            .rpc("get_own_portal_profile_v1")
            .execute()
            .value
    }

    /// `platform.set_own_portal_language_v1(p_language)` — student-only write
    /// of the own profile row through the standard revision guard (196:111-154).
    func setOwnPortalLanguage(_ language: String) async throws -> PortalLanguageReceipt {
        struct Params: Encodable, Sendable { let p_language: String }
        return try await client
            .rpc("set_own_portal_language_v1", params: Params(p_language: language))
            .execute()
            .value
    }

    /// `platform.request_account_deletion_v1(p_request_id)` — идемпотентно по
    /// request_id, максимум один ОТКРЫТЫЙ запрос на участника (196:159-194).
    /// Ничего не удаляется этим вызовом — запрос уходит в staff-процесс.
    func requestAccountDeletion(requestId: UUID) async throws -> AccountDeletionReceipt {
        struct Params: Encodable, Sendable { let p_request_id: UUID }
        return try await client
            .rpc("request_account_deletion_v1", params: Params(p_request_id: requestId))
            .execute()
            .value
    }

    // MARK: - Consultation requests (supabase/migrations/197)

    /// `platform.create_portal_consultation_request_v1` (197:108-160):
    /// идемпотентно по request_id; при уже ОТКРЫТОМ запросе возвращает его
    /// receipt (requestId будет отличаться от отправленного — «один открытый
    /// запрос» честно виден клиенту).
    func createConsultationRequest(
        requestId: UUID,
        institutionId: UUID?,
        note: String?
    ) async throws -> ConsultationReceipt {
        struct Params: Encodable, Sendable {
            let p_request_id: UUID
            let p_institution_id: UUID?
            let p_note: String?
        }
        return try await client
            .rpc(
                "create_portal_consultation_request_v1",
                params: Params(p_request_id: requestId, p_institution_id: institutionId, p_note: note)
            )
            .execute()
            .value
    }

    /// `platform.own_portal_consultation_requests_v1()` — only the caller's
    /// own requests, newest first, ceiling 20 (197:163-182).
    func ownConsultationRequests() async throws -> [ConsultationReceipt] {
        try await client
            .rpc("own_portal_consultation_requests_v1")
            .execute()
            .value
    }

    // MARK: - Learning READ (supabase/migrations/198, content 199)

    /// `platform.learning_modules_v1()` — module map with the caller's own
    /// progress (198:880-922).
    func learningModules() async throws -> LearningModulesResponse {
        try await client
            .rpc("learning_modules_v1")
            .execute()
            .value
    }

    /// `platform.learning_lesson_v1(p_lesson_id)` — safe lesson projection
    /// plus own draft/latest-completed attempts (198:925-959).
    func learningLesson(lessonId: UUID) async throws -> LearningLessonResponse {
        struct Params: Encodable, Sendable { let p_lesson_id: UUID }
        return try await client
            .rpc("learning_lesson_v1", params: Params(p_lesson_id: lessonId))
            .execute()
            .value
    }

    // MARK: - Learning runner (supabase/migrations/198, writes + review)

    /// `platform.start_learning_lesson_v1(p_lesson_id, p_request_id)`
    /// (198:862-865) — returns the attempt payload; идемпотентно по
    /// request_id, а существующий draft просто возвращается (198:777-788).
    func startLearningLesson(lessonId: UUID, requestId: UUID) async throws -> LearningAttemptSnapshot {
        struct Params: Encodable, Sendable {
            let p_lesson_id: UUID
            let p_request_id: UUID
        }
        return try await client
            .rpc(
                "start_learning_lesson_v1",
                params: Params(p_lesson_id: lessonId, p_request_id: requestId)
            )
            .execute()
            .value
    }

    /// `platform.save_learning_answer_v1` (198:866-870) — вердикт и разбор
    /// приходят В ОТВЕТЕ сохранения (receipt 198:819-825); повтор с тем же
    /// request_id и тем же payload возвращает исходный receipt (input_hash,
    /// 198:763-776), поэтому retry обязан слать ЗАМОРОЖЕННЫЙ снимок.
    func saveLearningAnswer(
        attemptId: UUID,
        expectedRevision: Int64,
        exerciseId: UUID,
        answer: LearningAnswer,
        requestId: UUID
    ) async throws -> LearningSaveReceipt {
        struct Params: Encodable, Sendable {
            let p_attempt_id: UUID
            let p_expected_revision: Int64
            let p_exercise_id: UUID
            let p_answer: LearningAnswer
            let p_request_id: UUID
        }
        return try await client
            .rpc(
                "save_learning_answer_v1",
                params: Params(
                    p_attempt_id: attemptId,
                    p_expected_revision: expectedRevision,
                    p_exercise_id: exerciseId,
                    p_answer: answer,
                    p_request_id: requestId
                )
            )
            .execute()
            .value
    }

    /// `platform.complete_learning_lesson_v1` (198:871-875) — «урок пройден»
    /// = отвечено каждое упражнение (198:832-834); result_snapshot приходит
    /// в payload'е (198:845-852).
    func completeLearningLesson(
        attemptId: UUID,
        expectedRevision: Int64,
        requestId: UUID
    ) async throws -> LearningAttemptSnapshot {
        struct Params: Encodable, Sendable {
            let p_attempt_id: UUID
            let p_expected_revision: Int64
            let p_request_id: UUID
        }
        return try await client
            .rpc(
                "complete_learning_lesson_v1",
                params: Params(
                    p_attempt_id: attemptId,
                    p_expected_revision: expectedRevision,
                    p_request_id: requestId
                )
            )
            .execute()
            .value
    }

    /// `platform.learning_review_v1(p_module_id)` — банк ошибок модуля,
    /// cap 20, новые первыми (198:965-1002).
    func learningReview(moduleId: UUID) async throws -> LearningReviewResponse {
        struct Params: Encodable, Sendable { let p_module_id: UUID }
        return try await client
            .rpc("learning_review_v1", params: Params(p_module_id: moduleId))
            .execute()
            .value
    }

    /// `platform.learning_review_check_v1(p_exercise_id, p_answer)` —
    /// stateless-проверка упражнения СОБСТВЕННОГО банка ошибок; ничего не
    /// пишет (198:1004-1032), поэтому request-ledger'а у неё нет.
    func checkLearningReviewAnswer(
        exerciseId: UUID,
        answer: LearningAnswer
    ) async throws -> LearningReviewCheck {
        struct Params: Encodable, Sendable {
            let p_exercise_id: UUID
            let p_answer: LearningAnswer
        }
        return try await client
            .rpc(
                "learning_review_check_v1",
                params: Params(p_exercise_id: exerciseId, p_answer: answer)
            )
            .execute()
            .value
    }

    // MARK: - Case chat, student side (supabase/migrations/200)

    /// `platform.portal_case_chat_page_v1(p_before_sequence_id)`
    /// (200:137-210) — страница 30 сообщений СВОЕГО треда, before-курсор;
    /// параметры не адресуют кейс (гейт 192 сам находит единственный свой).
    func portalCaseChatPage(beforeSequenceId: Int64? = nil) async throws -> PortalCaseChatPage {
        struct Params: Encodable, Sendable { let p_before_sequence_id: Int64? }
        return try await client
            .rpc(
                "portal_case_chat_page_v1",
                params: Params(p_before_sequence_id: beforeSequenceId)
            )
            .execute()
            .value
    }

    /// `platform.portal_case_chat_post_v1(p_request_id, p_body)`
    /// (200:49-132) — идемпотентно по request_id: повтор той же пары
    /// (request_id, body) возвращает исходный receipt (fingerprint
    /// 200:80-90); другой body с тем же request_id — PT409.
    func postPortalCaseChatMessage(requestId: UUID, body: String) async throws -> PortalCaseChatPostReceipt {
        struct Params: Encodable, Sendable {
            let p_request_id: UUID
            let p_body: String
        }
        return try await client
            .rpc(
                "portal_case_chat_post_v1",
                params: Params(p_request_id: requestId, p_body: body)
            )
            .execute()
            .value
    }

    // MARK: - Accompaniment read models (PORT-5d parity, wave 8)

    /// `platform.student_portal_overview_v2()` (131:17-30) — single row (or
    /// none) with the student's next document action, the EVO task and the
    /// curator. Same reader the web overview uses.
    func studentPortalOverview() async throws -> StudentPortalOverviewRow? {
        let rows: [StudentPortalOverviewRow] = try await client
            .rpc("student_portal_overview_v2")
            .execute()
            .value
        return rows.first
    }

    /// `platform.student_portal_documents()` (128:675-694) — the checklist
    /// slots with each slot's LATEST version and review outcome.
    func studentPortalDocuments() async throws -> [StudentPortalDocumentRow] {
        try await client
            .rpc("student_portal_documents")
            .execute()
            .value
    }

    /// `platform.student_portal_finance_v2()` (127:472-485, overdue
    /// NULL-safety 189:242-257) — obligations with honest 189 null
    /// semantics (due_at NULL = undated).
    func studentPortalFinance() async throws -> [StudentPortalPaymentRow] {
        try await client
            .rpc("student_portal_finance_v2")
            .execute()
            .value
    }

    /// `platform.student_portal_notifications_v2()` (153:97-106, cap 500).
    func studentPortalNotifications() async throws -> [StudentPortalNotificationRow] {
        try await client
            .rpc("student_portal_notifications_v2")
            .execute()
            .value
    }

    /// `platform.mark_own_student_portal_notification_read_v2` (153:210) —
    /// replay-safe by request_id (replay_audit 153:283-291 returns the
    /// original receipt). The id is DETERMINISTIC per (actor, notification)
    /// — `AdmissionNotificationPolicy.readRequestId`, the same UUIDv5 the
    /// web server action derives — so retries and mark-all partial-failure
    /// reruns never mint a second command.
    func markNotificationRead(notificationId: UUID, requestId: UUID) async throws -> NotificationReadReceipt {
        struct Params: Encodable, Sendable {
            let p_notification_id: UUID
            let p_request_id: UUID
        }
        return try await client
            .rpc(
                "mark_own_student_portal_notification_read_v2",
                params: Params(p_notification_id: notificationId, p_request_id: requestId)
            )
            .execute()
            .value
    }

    /// Access token of the CURRENT Supabase session, for the two bearer
    /// document route handlers (ADR 0030 §3). `auth.session` refreshes an
    /// expired session before returning it (supabase-swift semantics), so
    /// the token is fresh at call time.
    func currentAccessToken() async throws -> String {
        try await client.auth.session.accessToken
    }

    /// `platform.profession_cards_v1()` — compact grid rows (198:1038-1051).
    func professionCards() async throws -> ProfessionCardsResponse {
        try await client
            .rpc("profession_cards_v1")
            .execute()
            .value
    }

    /// `platform.profession_card_v1(p_card_id)` — full body (198:1053-1062).
    func professionCard(cardId: UUID) async throws -> ProfessionCardResponse {
        struct Params: Encodable, Sendable { let p_card_id: UUID }
        return try await client
            .rpc("profession_card_v1", params: Params(p_card_id: cardId))
            .execute()
            .value
    }
}

private struct AssessmentWriteParams: Encodable, Sendable {
    let p_attempt_id: UUID
    let p_expected_revision: Int64
    let p_answers: [String: String]
    let p_request_id: UUID
}

/// PORT-9a — анкета, статус заявки и инвайт. Signed-in reads/writes are the
/// SAME authenticated RPCs the web uses (GRANT 177:506-512, 180:353-361);
/// only account creation and receipt acceptance go through the two narrow
/// web route handlers (ADR 0030 «Решение» п. 3, docs/PLAN_CHANGES.md PORT-9a).
extension SupabaseService {
    /// What the анкета routing needs to know about the signed-in identity —
    /// the same facts resumeStudentApplication reads
    /// (src/lib/server/student-signup-runtime.ts:40-52).
    struct StudentSessionIdentity {
        let email: String?
        let emailConfirmed: Bool
        let staffProvisionMarker: String?
        /// The user_metadata draft, already contract-validated; nil when
        /// absent or invalid (metadata is a draft, never authority).
        let metadataDraft: StudentApplicationDraft?
    }

    func studentSessionIdentity() async throws -> StudentSessionIdentity {
        let user = try await client.auth.session.user
        var marker: String?
        if case .string(let value)? = user.appMetadata["evo_staff_password_request_id"] {
            marker = value
        }
        var draft: StudentApplicationDraft?
        if let raw = user.userMetadata[ApplicationContract.metadataKey],
           let data = try? JSONEncoder().encode(raw),
           let decoded = try? JSONDecoder().decode(StudentApplicationDraft.self, from: data),
           ApplicationDraftValidator.isValid(decoded) {
            draft = decoded
        }
        return StudentSessionIdentity(
            email: user.email,
            emailConfirmed: user.emailConfirmedAt != nil,
            staffProvisionMarker: marker,
            metadataDraft: draft
        )
    }

    /// `platform.own_student_application_v1` (177:303-310, body patched by
    /// 193) — the caller's own application or JSON null.
    func ownStudentApplication() async throws -> StudentApplication? {
        let response = try await client.rpc("own_student_application_v1").execute()
        return try StudentApplication.decodeOptionalValidated(from: response.data)
    }

    /// `platform.submit_student_application_v1(p_request_id, p_questionnaire,
    /// p_expected_revision)` — идемпотентно по requestId анкеты, оптимистичная
    /// ревизия как на вебе (student-application-source.ts:60-65).
    func submitStudentApplication(
        draft: StudentApplicationDraft,
        expectedRevision: Int64
    ) async throws -> StudentApplication {
        struct Params: Encodable, Sendable {
            let p_request_id: String
            let p_questionnaire: StudentApplicationDraft
            let p_expected_revision: Int64
        }
        let response = try await client
            .rpc(
                "submit_student_application_v1",
                params: Params(
                    p_request_id: draft.requestId,
                    p_questionnaire: draft,
                    p_expected_revision: expectedRevision
                )
            )
            .execute()
        return try StudentApplication.decodeValidated(from: response.data)
    }

    /// The committed application wins; the metadata draft is then only a
    /// leftover. Mirrors the web's post-submit cleanup
    /// (student-signup-runtime.ts:55-59) — best-effort at call sites.
    func clearStudentApplicationMetadataDraft() async throws {
        try await client.auth.update(
            user: UserAttributes(data: [ApplicationContract.metadataKey: .null])
        )
    }

    /// The same Supabase Auth call the web callback runtime issues
    /// (student-invite-callback-runtime.ts:27-30); establishes a session.
    func verifyStudentInviteToken(tokenHash: String) async throws {
        _ = try await client.auth.verifyOTP(tokenHash: tokenHash, type: .invite)
    }

    /// The same operation as the web set-password action
    /// (student-portal-auth-actions.ts:128) on the user's own session.
    func updateOwnPassword(_ password: String) async throws {
        _ = try await client.auth.update(user: UserAttributes(password: password))
    }

    /// refreshStudentApplicationAction's session refresh
    /// (student-signup-actions.ts:95) before re-resolving access.
    func refreshSession() async throws {
        _ = try await client.auth.refreshSession()
    }

    /// POST {web}/api/portal/registration — the account-creation step of the
    /// анкета (anonymous; the handler wraps createPublicStudentAccount).
    func registerStudentAccount(
        draft: StudentApplicationDraft,
        email: String,
        password: String
    ) async throws -> StudentRegistrationOutcome {
        let request = try ApplicationIntakeTransfer.registrationRequest(
            baseURL: AppConfig.portalWebBaseURL,
            payload: StudentRegistrationPayload(
                questionnaire: draft, email: email, password: password
            )
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return .createUnknown }
        return StudentRegistrationOutcome.decode(from: data, statusCode: http.statusCode)
    }

    func resendStudentRegistration(capability: String) async throws -> StudentRegistrationOutcome {
        let request = try ApplicationIntakeTransfer.registrationResendRequest(
            baseURL: AppConfig.portalWebBaseURL, capability: capability)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return .unavailable }
        return StudentRegistrationOutcome.decode(from: data, statusCode: http.statusCode, resend: true)
    }

    /// POST {web}/api/portal/invite-acceptance — bearer; marks the caller's
    /// own invite receipt accepted (idempotent) and returns its facts.
    func acceptStudentInvite() async throws -> InviteAcceptanceOutcome {
        let token = try await currentAccessToken()
        let request = ApplicationIntakeTransfer.inviteAcceptanceRequest(
            baseURL: AppConfig.portalWebBaseURL,
            accessToken: token
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return .unavailable }
        return InviteAcceptanceOutcome.from(statusCode: http.statusCode, body: data)
    }
}
