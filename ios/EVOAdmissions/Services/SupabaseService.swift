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
}

private struct AssessmentWriteParams: Encodable, Sendable {
    let p_attempt_id: UUID
    let p_expected_revision: Int64
    let p_answers: [String: String]
    let p_request_id: UUID
}
