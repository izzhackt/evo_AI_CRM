import Foundation

/// Codable mirrors of the portal-profile RPC contracts in
/// `supabase/migrations/196_platform_portal_profile_language.sql`.

/// `platform.get_own_portal_profile_v1` (196:99-105):
/// `jsonb_build_object('displayName', …, 'email', …, 'portalLanguage',
/// COALESCE(language,'ru'), 'caseState', …, 'deletionRequestedAt', …)`.
/// `caseState` is null for a student without a resolvable own case;
/// `deletionRequestedAt` is null when no OPEN deletion request exists — the
/// non-null value is what lets the "request sent" state survive relaunches
/// and appear on a second device.
struct PortalProfile: Decodable {
    let displayName: String
    let email: String?
    /// 'ru' | 'ky' by the CHECK constraint (196:32-33).
    let portalLanguage: String
    let caseState: String?
    /// timestamptz rendered into JSONB; raw string (see `PostgresTimestamp`).
    let deletionRequestedAt: String?

    var hasOpenDeletionRequest: Bool { deletionRequestedAt != nil }
}

/// `platform.set_own_portal_language_v1` receipt (196:153):
/// `jsonb_build_object('portalLanguage', p_language)`.
struct PortalLanguageReceipt: Decodable {
    let portalLanguage: String
}

/// `platform.request_account_deletion_v1` receipt (196:189-193):
/// `jsonb_build_object('requestId', …, 'status', …, 'requestedAt', …)`.
/// `status` is 'requested' | 'acknowledged' (CHECK, 196:40-41). Nothing is
/// deleted by this call — it opens a request for the staff process.
struct AccountDeletionReceipt: Decodable {
    let requestId: UUID
    let status: String
    let requestedAt: String
}
