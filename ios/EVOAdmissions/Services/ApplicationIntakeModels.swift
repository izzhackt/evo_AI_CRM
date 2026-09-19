import Foundation

/// PORT-9a: the анкета contract, mirrored rule-for-rule from the web wizard's
/// single validator (`src/lib/student-application-contract.ts`). The canonical
/// VALUES stay the web contract's — enum raw values, RU study-field texts and
/// the consent version are byte-identical, KY/RU is display-only (PORT-8c
/// discipline). Line references below cite student-application-contract.ts.
enum ApplicationContract {
    /// contract:1 — user_metadata key holding the draft between account
    /// creation and the first successful submit.
    static let metadataKey = "student_application_draft"
    /// contract:3
    static let consentVersion = "2026-09-18"
    /// contract:4
    static let destinationCountries = [
        "CN", "MY", "DE", "FR", "ES", "IT", "NL", "PL",
        "HU", "AT", "CZ", "GB", "CY", "TR", "AE",
    ]
    /// contract:5
    static let intakeSeasons = ["spring", "summer", "autumn", "winter", "undecided"]
    /// contract:6
    static let educationLevels = [
        "secondary", "high_school", "foundation", "diploma",
        "bachelor", "master", "phd",
    ]
    /// contract:7
    static let studyLevels = ["foundation", "bachelor", "master", "phd", "diploma", "language"]
    /// contract:8
    static let gradeScales = ["100", "5", "4", "10", "20"]
    /// contract:9
    static let tuitionBudgets = [
        "under_5000", "5000_10000", "10000_20000",
        "20000_30000", "over_30000", "undecided",
    ]
    /// contract:10
    static let fundingSources = ["family", "savings", "scholarship", "loan", "employer", "undecided"]
    /// contract:13 — self-assessment levels.
    static let englishLevels = ["beginner", "intermediate", "advanced", "fluent"]
    /// student-application-presentation.ts:47-53 — exam keys and bounds; the
    /// same ranges gate scores in the contract validator (contract:77-81).
    static let englishExams: [(key: String, min: Double, max: Double, step: Double)] = [
        ("ielts", 0, 9, 0.5),
        ("toefl", 1, 6, 0.5),
        ("toefl_120", 0, 120, 1),
        ("pte", 10, 90, 1),
        ("duolingo", 10, 160, 5),
    ]
    /// student-application-presentation.ts:41-45 — the RU canonical study
    /// fields (values in the questionnaire stay RU; KY labels display-only).
    static let studyFieldOptions = [
        "Бизнес и менеджмент", "Информатика и IT", "Инженерия", "Медицина и здоровье",
        "Экономика и финансы", "Право", "Дизайн и искусство", "Социальные науки",
        "Естественные науки", "Образование", "Туризм и гостиничное дело", "Языки и гуманитарные науки",
    ]
    /// contract:2 — the full nationality list (ISO codes).
    static let nationalities = "AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW"
        .split(separator: " ").map(String.init)

    static func englishExam(for key: String) -> (key: String, min: Double, max: Double, step: Double)? {
        englishExams.first { $0.key == key }
    }
}

/// The draft the web wizard submits (contract:14-21). Encodes to EXACTLY the
/// 19-key JSON object the contract validator requires (DRAFT_KEYS,
/// contract:52) — no optionals, no extra keys.
struct StudentApplicationDraft: Codable, Equatable, Sendable {
    enum English: Codable, Equatable, Sendable {
        case exam(exam: String, score: Double)
        case selfAssessed(level: String)

        private enum CodingKeys: String, CodingKey { case mode, exam, score, level }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            switch try container.decode(String.self, forKey: .mode) {
            case "exam":
                self = .exam(
                    exam: try container.decode(String.self, forKey: .exam),
                    score: try container.decode(Double.self, forKey: .score)
                )
            case "self":
                self = .selfAssessed(level: try container.decode(String.self, forKey: .level))
            default:
                throw DecodingError.dataCorruptedError(
                    forKey: .mode, in: container, debugDescription: "unknown english mode"
                )
            }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case let .exam(exam, score):
                try container.encode("exam", forKey: .mode)
                try container.encode(exam, forKey: .exam)
                // The web sends integers as JSON numbers without a fraction;
                // encode whole scores the same way so shapes stay identical.
                if score.truncatingRemainder(dividingBy: 1) == 0 {
                    try container.encode(Int(score), forKey: .score)
                } else {
                    try container.encode(score, forKey: .score)
                }
            case let .selfAssessed(level):
                try container.encode("self", forKey: .mode)
                try container.encode(level, forKey: .level)
            }
        }
    }

    var schemaVersion: Int
    var requestId: String
    var firstName: String
    var lastName: String
    var phone: String
    var destinationCountries: [String]
    var intakeSeason: String
    var intakeYear: Int
    var educationLevel: String
    var averageGrade: Double
    var gradeScale: String
    var studyFields: [String]
    var studyLevels: [String]
    var nationality: String
    var english: English
    var tuitionBudget: String
    var fundingSource: String
    var consent: Bool
    var consentVersion: String

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(requestId, forKey: .requestId)
        try container.encode(firstName, forKey: .firstName)
        try container.encode(lastName, forKey: .lastName)
        try container.encode(phone, forKey: .phone)
        try container.encode(destinationCountries, forKey: .destinationCountries)
        try container.encode(intakeSeason, forKey: .intakeSeason)
        try container.encode(intakeYear, forKey: .intakeYear)
        try container.encode(educationLevel, forKey: .educationLevel)
        // Same rule as english.score: a whole grade goes out as an integer.
        if averageGrade.truncatingRemainder(dividingBy: 1) == 0 {
            try container.encode(Int(averageGrade), forKey: .averageGrade)
        } else {
            try container.encode(averageGrade, forKey: .averageGrade)
        }
        try container.encode(gradeScale, forKey: .gradeScale)
        try container.encode(studyFields, forKey: .studyFields)
        try container.encode(studyLevels, forKey: .studyLevels)
        try container.encode(nationality, forKey: .nationality)
        try container.encode(english, forKey: .english)
        try container.encode(tuitionBudget, forKey: .tuitionBudget)
        try container.encode(fundingSource, forKey: .fundingSource)
        try container.encode(consent, forKey: .consent)
        try container.encode(consentVersion, forKey: .consentVersion)
    }
}

/// Rule-for-rule mirror of `validateStudentApplicationDraft`
/// (contract:55-84). Every citation names the web line the rule comes from.
enum ApplicationDraftValidator {
    private static let uuidPattern =
        "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    private static let phonePattern = "^\\+?[0-9 ()-]{7,40}$"

    /// contract:43-45 — trimmed, non-empty, bounded, no C0/DEL controls.
    static func isBoundedText(_ value: String, max: Int) -> Bool {
        value == value.trimmingCharacters(in: .whitespacesAndNewlines)
            && !value.isEmpty
            && value.count <= max
            && value.unicodeScalars.allSatisfy { $0.value > 0x1f && $0.value != 0x7f }
    }

    /// contract:49-51 — non-empty bounded unique string set.
    private static func isStringSet(_ values: [String], max: Int, validate: (String) -> Bool) -> Bool {
        !values.isEmpty && values.count <= max && values.allSatisfy(validate)
            && Set(values).count == values.count
    }

    static func isValidUuid(_ value: String) -> Bool {
        value.range(of: uuidPattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// contract:59 — the phone shape plus the 7...15 digit corridor.
    static func isValidPhone(_ value: String) -> Bool {
        guard isBoundedText(value, max: 40),
              value.range(of: phonePattern, options: .regularExpression) != nil
        else { return false }
        let digits = value.filter(\.isNumber).count
        return digits >= 7 && digits <= 15
    }

    static func isValid(_ draft: StudentApplicationDraft) -> Bool {
        guard draft.schemaVersion == 1,                                       // contract:57
              isValidUuid(draft.requestId),                                   // contract:57
              isBoundedText(draft.firstName, max: 60),                        // contract:58
              isBoundedText(draft.lastName, max: 60),                         // contract:58
              isValidPhone(draft.phone),                                      // contract:59
              isStringSet(draft.destinationCountries, max: 15, validate: {    // contract:60
                  ApplicationContract.destinationCountries.contains($0)
              }),
              ApplicationContract.intakeSeasons.contains(draft.intakeSeason), // contract:61
              (2026...2036).contains(draft.intakeYear),                       // contract:62
              ApplicationContract.educationLevels.contains(draft.educationLevel), // contract:63
              ApplicationContract.gradeScales.contains(draft.gradeScale),     // contract:64
              draft.averageGrade.isFinite,                                    // contract:65
              draft.averageGrade >= 0,
              draft.averageGrade <= (Double(draft.gradeScale) ?? 0),
              isStringSet(draft.studyFields, max: 10, validate: {             // contract:66
                  isBoundedText($0, max: 100)
              }),
              isStringSet(draft.studyLevels, max: 6, validate: {              // contract:67
                  ApplicationContract.studyLevels.contains($0)
              }),
              ApplicationContract.nationalities.contains(draft.nationality),  // contract:68
              ApplicationContract.tuitionBudgets.contains(draft.tuitionBudget),   // contract:69
              ApplicationContract.fundingSources.contains(draft.fundingSource),   // contract:70
              draft.consent,                                                  // contract:71
              draft.consentVersion == ApplicationContract.consentVersion      // contract:71
        else { return false }
        switch draft.english {
        case let .selfAssessed(level):                                        // contract:74-75
            return ApplicationContract.englishLevels.contains(level)
        case let .exam(exam, score):                                          // contract:76-81
            guard let bounds = ApplicationContract.englishExam(for: exam),
                  score.isFinite, score >= bounds.min, score <= bounds.max
            else { return false }
            let ratio = score / bounds.step
            return ratio == ratio.rounded()
        }
    }
}

/// One row of `platform.own_student_application_v1` — the same JSON shape the
/// web decoder pins (`src/lib/v3/student-application-source.ts:22`, exact key
/// set `admissions_direction,canonical_lead_id,decided_at,decision_reason,
/// email,id,questionnaire,revision,status,student_case_id,submitted_at`).
struct StudentApplication: Codable, Equatable, Sendable {
    enum Status: String, Codable, Sendable { case pending, approved, rejected }

    let id: UUID
    let status: Status
    let revision: Int64
    let email: String
    let questionnaire: StudentApplicationDraft
    let submittedAt: String
    let decidedAt: String?
    let decisionReason: String?
    let studentCaseId: UUID?
    let admissionsDirection: String?
    let canonicalLeadId: UUID?

    enum CodingKeys: String, CodingKey {
        case id, status, revision, email, questionnaire
        case submittedAt = "submitted_at"
        case decidedAt = "decided_at"
        case decisionReason = "decision_reason"
        case studentCaseId = "student_case_id"
        case admissionsDirection = "admissions_direction"
        case canonicalLeadId = "canonical_lead_id"
    }

    /// The web decoder's cross-field invariants
    /// (student-application-source.ts:25-38): revision ≥ 1, a valid
    /// questionnaire, approved ⟺ case link, pending ⟺ undecided.
    var isContractValid: Bool {
        revision >= 1
            && ApplicationDraftValidator.isValid(questionnaire)
            && email.contains("@") && email.count <= 320
            && (status == .approved) == (studentCaseId != nil)
            && (status == .pending) == (decidedAt == nil)
            && (decisionReason?.count ?? 0) <= 1000
    }

    static func decodeValidated(from data: Data) throws -> StudentApplication {
        let application = try JSONDecoder().decode(StudentApplication.self, from: data)
        guard application.isContractValid else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: [], debugDescription: "student application contract violation"
            ))
        }
        return application
    }

    /// `own_student_application_v1` returns JSON `null` when the caller has
    /// no application (student-application-source.ts:55-58).
    static func decodeOptionalValidated(from data: Data) throws -> StudentApplication? {
        let trimmed = String(decoding: data, as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "null" { return nil }
        return try decodeValidated(from: data)
    }
}

// MARK: - Intake endpoint payloads (PORT-9a route handlers)

/// Body of POST /api/portal/registration — the exact key triple the handler
/// admits (student-portal-intake-route-handlers.ts, REGISTRATION_KEYS).
struct StudentRegistrationPayload: Encodable, Equatable, Sendable {
    let questionnaire: StudentApplicationDraft
    let email: String
    let password: String
}

/// `{status}` answers of the registration endpoint — the same vocabulary as
/// the web wizard's StudentSignupState (student-signup-actions.ts:15), plus
/// `created`. Unknown strings and undecodable bodies read as `unavailable`.
enum StudentRegistrationOutcome: String, Equatable, Sendable {
    case created
    case invalid
    case password
    case passwordTooLong = "password_too_long"
    case conflict
    case rateLimit = "rate_limit"
    case unavailable

    static func decode(from data: Data) -> StudentRegistrationOutcome {
        struct Body: Decodable { let status: String }
        guard let body = try? JSONDecoder().decode(Body.self, from: data),
              let outcome = StudentRegistrationOutcome(rawValue: body.status)
        else { return .unavailable }
        return outcome
    }
}

/// Success body of POST /api/portal/invite-acceptance.
struct InviteAcceptanceReceipt: Decodable, Equatable, Sendable {
    let status: String
    let intakeFlow: String
    let accountPending: Bool
    let displayName: String?
}

enum InviteAcceptanceOutcome: Equatable, Sendable {
    /// 200 — the receipt is accepted (idempotent server-side).
    case accepted(InviteAcceptanceReceipt)
    /// 401 — the bearer credential was rejected.
    case authenticationRequired
    /// 409 — no receipt matches this identity (an ordinary account).
    case mismatch
    /// Everything else, including undecodable success bodies.
    case unavailable

    static func from(statusCode: Int, body: Data) -> InviteAcceptanceOutcome {
        switch statusCode {
        case 200:
            guard let receipt = try? JSONDecoder().decode(InviteAcceptanceReceipt.self, from: body),
                  receipt.status == "accepted"
            else { return .unavailable }
            return .accepted(receipt)
        case 401: return .authenticationRequired
        case 409: return .mismatch
        default: return .unavailable
        }
    }
}
