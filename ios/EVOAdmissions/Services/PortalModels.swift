import Foundation

/// Mirrors the row shape of `platform.current_actor_authority()`
/// (supabase/migrations/155_platform_scoped_staff_roles.sql). Empty result
/// means no resolvable authority for the signed-in user.
struct CurrentActorAuthority: Decodable {
    let authUserId: UUID
    let profileId: UUID
    let membershipId: UUID
    let organizationId: UUID
    let displayName: String
    let platformRole: String
    let platformAccessVersion: Int64

    enum CodingKeys: String, CodingKey {
        case authUserId = "auth_user_id"
        case profileId = "profile_id"
        case membershipId = "membership_id"
        case organizationId = "organization_id"
        case displayName = "display_name"
        case platformRole = "platform_role"
        case platformAccessVersion = "platform_access_version"
    }

    var isStudent: Bool { platformRole == "student" }
}

/// Mirrors the row shape of `platform.student_portal_cases()`
/// (supabase/migrations/042_platform_student_admissions.sql).
struct StudentPortalCase: Decodable, Identifiable {
    let id: UUID
    let studentDisplayName: String
    let targetCountry: String?
    let targetDegree: String?
    let programDirection: String?
    let intake: String?
    let routeApprovalStatus: String?
    let operationalStage: String?
    let caseState: String
    let nextAction: String?
    let portalActivatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id = "case_id"
        case studentDisplayName = "student_display_name"
        case targetCountry = "target_country"
        case targetDegree = "target_degree"
        case programDirection = "program_direction"
        case intake
        case routeApprovalStatus = "route_approval_status"
        case operationalStage = "operational_stage"
        case caseState = "case_state"
        case nextAction = "next_action"
        case portalActivatedAt = "portal_activated_at"
    }

    /// PORT-1 access-tier split (docs/design/portal/port-0-contracts.md):
    /// `pending` reads as "approved", `active`/`closed` read as "assisted".
    var accessTier: AccessTier {
        caseState == "pending" ? .approved : .assisted
    }
}

enum AccessTier {
    case approved
    case assisted
}

/// Mirrors the JSONB shape returned by `platform.student_university_catalog()`
/// (supabase/migrations/148_platform_university_catalog_publication.sql):
/// `{ items: [{ id, version, publishedAt, content }], nextOffset }`.
struct UniversityCatalogPage: Decodable {
    let items: [UniversityCatalogItem]
    let nextOffset: Int?
}

struct UniversityCatalogItem: Decodable, Identifiable {
    let id: UUID
    let content: UniversityContent
}

struct UniversityContent: Decodable {
    let name: String
    let country: String
    let city: String?
}
