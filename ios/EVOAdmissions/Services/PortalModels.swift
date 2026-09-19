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
/// (supabase/migrations/148_platform_university_catalog_publication.sql,
/// levels extended by 151_platform_university_catalog_completion.sql):
/// `{ items: [{ id, version, publishedAt, content }], nextOffset }`.
struct UniversityCatalogPage: Decodable {
    let items: [UniversityCatalogItem]
    let nextOffset: Int?
}

struct UniversityCatalogItem: Decodable, Identifiable {
    let id: UUID
    let version: Int64
    /// Postgres timestamptz rendered into JSONB; kept as the raw string —
    /// see `PostgresTimestamp` for display parsing.
    let publishedAt: String
    let content: UniversityContent
}

/// Full published card content validated by
/// `platform_private.valid_university_content` (148/150/151). All dates are
/// `YYYY-MM-DD` strings, `startMonth` is `YYYY-MM`, `deadlineTime` is `HH:mm`.
struct UniversityContent: Decodable {
    let name: String
    let country: String
    let city: String?
    let overview: String
    let websiteUrl: String
    let sourceUrl: String
    let verifiedOn: String
    let notes: String
    let photoKey: String?
    let programs: [UniversityProgram]
}

struct UniversityProgram: Decodable, Identifiable {
    let id: String
    let title: String
    /// 151: language|foundation|diploma|bachelor|master|doctorate.
    let level: String
    let duration: String?
    let language: String?
    let summary: String
    let sourceUrl: String
    let intakes: [UniversityIntake]
}

struct UniversityIntake: Decodable {
    let label: String
    let startDate: String?
    let startMonth: String?
    let applicationDeadline: String?
    let deadlineTime: String?
    let timezone: String?
    let status: String
    let note: String
    let sourceUrl: String
    let verifiedOn: String
}

/// Intake status for display. Same computation as the web portal's
/// `universityIntakeStatusKey` (src/lib/portal/universities.ts): a published
/// deadline that has passed in the intake's own timezone reads as closed even
/// when the source still says `open`.
enum UniversityIntakeDisplayStatus: String {
    case closed
    case needsConfirmation
    case open
    case announced
    case unclear
}

func universityIntakeDisplayStatus(
    _ intake: UniversityIntake,
    now: Date = Date()
) -> UniversityIntakeDisplayStatus {
    let calendarFormatter = DateFormatter()
    calendarFormatter.locale = Locale(identifier: "en_US_POSIX")
    calendarFormatter.timeZone = intake.timezone.flatMap(TimeZone.init(identifier:))
        ?? TimeZone(identifier: "UTC")
    calendarFormatter.dateFormat = "yyyy-MM-dd"
    let day = calendarFormatter.string(from: now)
    calendarFormatter.dateFormat = "HH:mm"
    let minute = calendarFormatter.string(from: now)

    if intake.status == "closed" {
        return .closed
    }
    if let deadline = intake.applicationDeadline {
        if deadline < day { return .closed }
        if deadline == day, let time = intake.deadlineTime, time < minute { return .closed }
    }
    switch intake.status {
    case "needs_reconfirmation": return .needsConfirmation
    case "open": return .open
    case "announced": return .announced
    default: return .unclear
    }
}
