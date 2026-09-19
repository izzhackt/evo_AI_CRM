import Foundation

/// Codable mirror of the consultation receipt in
/// `supabase/migrations/197_platform_portal_consultation_requests.sql`.
///
/// `platform_private.portal_consultation_receipt` (197:88-97) is the SINGLE
/// shape both `create_portal_consultation_request_v1` and
/// `own_portal_consultation_requests_v1` return:
/// `{ requestId, status, institutionId, institutionName, note, requestedAt,
///    handledAt }`. `status` is 'requested' | 'handled' (CHECK 197:42-43).
///
/// One-open semantics (197:146-152): while the student has an OPEN request,
/// a create with a NEW `request_id` returns the EXISTING open receipt instead
/// of inserting a second row — the client detects that by comparing the
/// receipt's `requestId` with the one it sent and says so honestly.
struct ConsultationReceipt: Decodable, Identifiable {
    let requestId: UUID
    let status: String
    let institutionId: UUID?
    let institutionName: String?
    let note: String?
    /// timestamptz rendered into JSONB; raw strings (see `PostgresTimestamp`).
    let requestedAt: String
    let handledAt: String?

    var id: UUID { requestId }
    var isOpen: Bool { status == "requested" }
}
