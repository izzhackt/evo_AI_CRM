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

    /// `platform.student_university_catalog(p_offset:)` — one page (30 items)
    /// of the published catalogue, plus `nextOffset` for pagination.
    func studentUniversityCatalog(offset: Int = 0) async throws -> UniversityCatalogPage {
        try await client
            .rpc("student_university_catalog", params: ["p_offset": offset])
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
