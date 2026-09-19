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
}
