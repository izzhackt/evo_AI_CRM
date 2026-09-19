import Foundation

/// Codable mirrors of the favourites RPC contracts in
/// `supabase/migrations/195_platform_university_favorites.sql`.
///
/// `student_university_catalog_by_ids_v1` (195:159-166) returns the exact
/// row shape of the catalogue page — `{ items: [...], nextOffset: null }` —
/// so the client reuses `UniversityCatalogPage` for it; no extra type here.

/// `platform.set_university_favorite_v1` receipt (195:92-94):
/// `jsonb_build_object('institutionId', …, 'favored', …, 'favoritesCount', …)`.
/// The receipt carries the FACTUAL state after the idempotent write, which is
/// what the optimistic UI reconciles against.
struct FavoriteReceipt: Decodable {
    let institutionId: UUID
    let favored: Bool
    let favoritesCount: Int
}

/// One row of `platform.student_university_favorites_v1` (195:107-109):
/// `jsonb_build_object('institutionId', f.institution_id, 'createdAt',
/// f.created_at)`, newest first. `createdAt` is a timestamptz rendered into
/// JSONB — kept raw, parsed for display by `PostgresTimestamp`.
struct UniversityFavorite: Decodable, Identifiable {
    let institutionId: UUID
    let createdAt: String

    var id: UUID { institutionId }
}
