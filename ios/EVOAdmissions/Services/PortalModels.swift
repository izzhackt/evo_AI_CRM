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

extension UniversityContent {
    private enum CodingKeys: String, CodingKey {
        case name, country, city, overview, websiteUrl, sourceUrl
        case verifiedOn, notes, photoKey, programs
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        name = try values.decode(String.self, forKey: .name)
        country = try values.decode(String.self, forKey: .country)
        city = try values.decodeIfPresent(String.self, forKey: .city)
        overview = try values.decode(String.self, forKey: .overview)
        websiteUrl = try values.decode(String.self, forKey: .websiteUrl)
        sourceUrl = try values.decode(String.self, forKey: .sourceUrl)
        verifiedOn = try values.decode(String.self, forKey: .verifiedOn)
        notes = try values.decode(String.self, forKey: .notes)
        photoKey = try values.decodeIfPresent(String.self, forKey: .photoKey)
        programs = try values.decode([UniversityProgram].self, forKey: .programs)

        var intakeIDs = Set<String>()
        for program in programs {
            for intake in program.intakes {
                if let id = intake.id, !intakeIDs.insert(id).inserted {
                    throw DecodingError.dataCorruptedError(
                        forKey: .programs,
                        in: values,
                        debugDescription: "Intake ids must be unique across the university publication."
                    )
                }
            }
        }
    }
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
    /// Missing only in legacy publications. Identified intakes retain this UUID
    /// across later immutable publications.
    let id: String?
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

extension UniversityIntake {
    /// Preserve existing constructions of legacy, unidentified intakes while
    /// retaining the synthesized memberwise initializer that accepts an ID.
    init(
        label: String,
        startDate: String?,
        startMonth: String?,
        applicationDeadline: String?,
        deadlineTime: String?,
        timezone: String?,
        status: String,
        note: String,
        sourceUrl: String,
        verifiedOn: String
    ) {
        self.init(
            id: nil,
            label: label,
            startDate: startDate,
            startMonth: startMonth,
            applicationDeadline: applicationDeadline,
            deadlineTime: deadlineTime,
            timezone: timezone,
            status: status,
            note: note,
            sourceUrl: sourceUrl,
            verifiedOn: verifiedOn
        )
    }

    private enum CodingKeys: String, CodingKey {
        case id, label, startDate, startMonth, applicationDeadline
        case deadlineTime, timezone, status, note, sourceUrl, verifiedOn
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        if values.contains(.id) {
            // decodeIfPresent would also accept null; only an absent legacy
            // key is optional. Match the shared TS/SQL canonical UUID rule.
            let value = try values.decode(String.self, forKey: .id)
            guard value.range(
                of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                options: .regularExpression
            ) == value.startIndex..<value.endIndex else {
                throw DecodingError.dataCorruptedError(
                    forKey: .id,
                    in: values,
                    debugDescription: "Intake id must be a canonical lowercase UUID."
                )
            }
            id = value
        } else {
            id = nil
        }
        label = try values.decode(String.self, forKey: .label)
        startDate = try values.decodeIfPresent(String.self, forKey: .startDate)
        startMonth = try values.decodeIfPresent(String.self, forKey: .startMonth)
        applicationDeadline = try values.decodeIfPresent(String.self, forKey: .applicationDeadline)
        deadlineTime = try values.decodeIfPresent(String.self, forKey: .deadlineTime)
        timezone = try values.decodeIfPresent(String.self, forKey: .timezone)
        status = try values.decode(String.self, forKey: .status)
        note = try values.decode(String.self, forKey: .note)
        sourceUrl = try values.decode(String.self, forKey: .sourceUrl)
        verifiedOn = try values.decode(String.self, forKey: .verifiedOn)
    }
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
    if intake.status == "closed" { return .closed }
    if intake.status == "needs_reconfirmation" { return .needsConfirmation }
    guard intake.status == "open" || intake.status == "announced" else { return .unclear }
    // A disputed/unknown deadline or absent timezone cannot become a definite
    // expiry by interpreting it as UTC. The selection command is authoritative.
    if intake.applicationDeadline != nil,
       intake.timezone.flatMap(TimeZone.init(identifier:)) == nil { return .needsConfirmation }
    let calendarFormatter = DateFormatter()
    calendarFormatter.locale = Locale(identifier: "en_US_POSIX")
    calendarFormatter.timeZone = intake.timezone.flatMap(TimeZone.init(identifier:))
    calendarFormatter.dateFormat = "yyyy-MM-dd"
    let day = calendarFormatter.string(from: now)
    calendarFormatter.dateFormat = "HH:mm"
    let minute = calendarFormatter.string(from: now)

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

/// Same nearest-intake rule as web portal/universities.ts: trusted statuses,
/// future deadline first, otherwise earliest start day/month, UTC comparison.
struct NearestUniversityIntake {
    enum Kind { case deadline, start, startMonth }
    let kind: Kind
    let value: String
}

func nearestUniversityIntake(_ content: UniversityContent, now: Date) -> NearestUniversityIntake? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    let today = formatter.string(from: now)
    let month = String(today.prefix(7))
    let intakes = content.programs.flatMap(\.intakes).filter { $0.status == "open" || $0.status == "announced" }
    if let deadline = intakes.compactMap(\.applicationDeadline).filter({ $0 >= today }).min() {
        return .init(kind: .deadline, value: deadline)
    }
    let start = intakes.compactMap(\.startDate).filter { $0 >= today }.min()
    let startMonth = intakes.filter { $0.startDate == nil }.compactMap(\.startMonth).filter { $0 >= month }.min()
    if let start, startMonth == nil || String(start.prefix(7)) <= startMonth! {
        return .init(kind: .start, value: start)
    }
    return startMonth.map { .init(kind: .startMonth, value: $0) }
}
