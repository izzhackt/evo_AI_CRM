import Foundation
import Supabase

/// Университеты v2 (миграция 283, docs/catalog/geography-costs-contract.md).
/// RPC отдают тело как есть: строгий разбор делают `UniversityIndexResponse`
/// и `UniversityDetailPayload` (hostless-тесты на реальных ответах демо), а
/// индекс сохраняется на диск ровно тем телом, которое пришло.
extension SupabaseService {
    /// `platform.student_university_index_v1(p_known_version)`. Без
    /// известной версии параметр не передаётся (DEFAULT NULL).
    func studentUniversityIndexData(knownVersion: String?) async throws -> Data {
        struct Params: Encodable, Sendable {
            let p_known_version: String?
        }
        return try await client
            .rpc("student_university_index_v1", params: Params(p_known_version: knownVersion))
            .execute()
            .data
    }

    /// `platform.student_university_detail_v1(p_institution_id)`: карточка,
    /// страна, город, избранное, открытая консультация, подготовки и
    /// опубликованная стоимость с курсами.
    func studentUniversityDetailData(institutionId: UUID) async throws -> Data {
        struct Params: Encodable, Sendable {
            let p_institution_id: UUID
        }
        return try await client
            .rpc("student_university_detail_v1", params: Params(p_institution_id: institutionId))
            .execute()
            .data
    }
}

extension UniversityIndexStore {
    /// Хранилище индекса приложения: тело ответа читает `SupabaseService`,
    /// 42501 (студент больше не активен в организации) снимает копию.
    static let shared = UniversityIndexStore(
        isForbidden: { ($0 as? PostgrestError)?.code == "42501" },
        fetch: { try await SupabaseService.shared.studentUniversityIndexData(knownVersion: $0) }
    )
}

/// Страница вуза в приложении: подготовки в форме `CatalogPreparation`.
typealias UniversityDetail = UniversityDetailPayload<CatalogPreparation>

enum UniversityDetailFailure: Error, Equatable {
    /// 42501: вуз чужой, неизвестный, снят с публикации или страны вне
    /// списка; сервер эти случаи не различает (283, контракт 2.3).
    case unavailable
    case failed
}

extension UniversityDetailFailure {
    static func classify(_ error: Error) -> UniversityDetailFailure {
        if let postgrest = error as? PostgrestError, postgrest.code == "42501" { return .unavailable }
        return .failed
    }
}
