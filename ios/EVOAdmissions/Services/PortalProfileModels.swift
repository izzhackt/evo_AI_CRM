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

/// `platform.request_account_deletion_v2` receipt and
/// `platform.own_account_deletion_request_v1` (migration 279):
/// `{'requestId', 'status', 'requestedAt', 'dueAt'}`. `status` is
/// 'requested' (196's 'acknowledged' is reported as 'requested') or
/// 'processing'; a completed request is never returned, the account is gone.
/// `dueAt` is the request + 30 days (owner decision 07.10.2026).
struct OwnAccountDeletion: Decodable, Equatable {
    let requestId: UUID
    let status: String
    let requestedAt: String
    let dueAt: String

    var isProcessing: Bool { status == "processing" }
}

/// Dates of the deletion screen: «06.11.2026» in the organization's
/// timezone (Asia/Bishkek), the same numeric form the web cabinet shows.
enum AccountDeletionPolicy {
    static func dayLabel(from raw: String) -> String? {
        guard let date = PostgresTimestamp.date(from: raw) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.timeZone = TimeZone(identifier: "Asia/Bishkek")
        formatter.dateFormat = "dd.MM.yyyy"
        return formatter.string(from: date)
    }
}

/// Pure predicate for ProfileView's "save language" button visibility.
///
/// The baseline MUST be the LAST-SAVED language (the most recent server
/// receipt), never the value loaded once at app launch — comparing against
/// launch-time data means that after a successful save, switching the
/// picker back to the original language reads as "already saved" and hides
/// the button until the app restarts. `ProfileViewModel` keeps
/// `lastSavedLanguage` updated on both `load()` and a successful
/// `saveLanguage()` and calls through this policy so the rule lives in one
/// place and is testable without a network round trip.
enum ProfileLanguagePolicy {
    static func showsSaveButton(
        hasProfile: Bool,
        selectedLanguage: String,
        lastSavedLanguage: String,
        isSaving: Bool
    ) -> Bool {
        hasProfile && (selectedLanguage != lastSavedLanguage || isSaving)
    }
}
