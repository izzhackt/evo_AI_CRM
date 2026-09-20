import Foundation

/// PORT-9a: pure policies of the анкета path — the wizard's step gating, the
/// router's access decisions, invite-link parsing and the invited-name
/// prefill. Every rule mirrors a cited web behaviour; no SwiftUI, no SDK.

/// The nine wizard steps, in the web wizard's order
/// (`src/components/student-application/ApplicationWizard.tsx:22` STEP_KEYS).
enum ApplicationWizardStep: Int, CaseIterable, Equatable {
    case countries, intake, education, fields, levels
    case nationality, english, budget, account
}

/// The editable wizard values — the Swift shape of the web WizardState
/// (ApplicationWizard.tsx:23-28). Strings stay raw user input; the draft is
/// assembled by `draft(requestId:)` exactly like `questionnaire()`
/// (ApplicationWizard.tsx:47-53).
struct ApplicationWizardValues: Equatable, Codable {
    var firstName = ""
    var lastName = ""
    var phone = ""
    var destinationCountries: [String] = []
    var intakeSeason = ""
    var intakeYear = ""
    var educationLevel = ""
    var averageGrade = ""
    var gradeScale = "5"
    var studyFields: [String] = []
    var studyLevels: [String] = []
    var nationality = ""
    var englishMode = ""
    var englishExam = "ielts"
    var englishScore = ""
    var englishLevel = ""
    var tuitionBudget = ""
    var fundingSource = ""
    var consent = false

    init() {}

    /// Prefill from an existing draft (edit/resubmit and metadata resume) —
    /// the web initialState (ApplicationWizard.tsx:33-45).
    init(draft: StudentApplicationDraft) {
        firstName = draft.firstName
        lastName = draft.lastName
        phone = draft.phone
        destinationCountries = draft.destinationCountries
        intakeSeason = draft.intakeSeason
        intakeYear = String(draft.intakeYear)
        educationLevel = draft.educationLevel
        averageGrade = draft.averageGrade.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(draft.averageGrade))
            : String(draft.averageGrade)
        gradeScale = draft.gradeScale
        studyFields = draft.studyFields
        studyLevels = draft.studyLevels
        nationality = draft.nationality
        switch draft.english {
        case let .exam(exam, score):
            englishMode = "exam"
            englishExam = exam
            englishScore = score.truncatingRemainder(dividingBy: 1) == 0
                ? String(Int(score))
                : String(score)
        case let .selfAssessed(level):
            englishMode = "self"
            englishLevel = level
        }
        tuitionBudget = draft.tuitionBudget
        fundingSource = draft.fundingSource
        consent = false // consent is re-confirmed on every submission (web parity)
    }

    /// The web's number parsing (`Number(...)`) is decimal-point only.
    static func number(_ raw: String) -> Double? {
        Double(raw.trimmingCharacters(in: .whitespaces))
    }

    /// questionnaire() parity (ApplicationWizard.tsx:47-53): trim contacts,
    /// coerce numbers, assemble the english variant and pin consentVersion.
    func draft(requestId: String) -> StudentApplicationDraft {
        StudentApplicationDraft(
            schemaVersion: 1,
            requestId: requestId,
            firstName: firstName.trimmingCharacters(in: .whitespacesAndNewlines),
            lastName: lastName.trimmingCharacters(in: .whitespacesAndNewlines),
            phone: phone.trimmingCharacters(in: .whitespacesAndNewlines),
            destinationCountries: destinationCountries,
            intakeSeason: intakeSeason,
            intakeYear: Int(intakeYear) ?? 0,
            educationLevel: educationLevel,
            averageGrade: Self.number(averageGrade) ?? .nan,
            gradeScale: gradeScale,
            studyFields: studyFields,
            studyLevels: studyLevels,
            nationality: nationality,
            english: englishMode == "exam"
                ? .exam(exam: englishExam, score: Self.number(englishScore) ?? .nan)
                : .selfAssessed(level: englishLevel),
            tuitionBudget: tuitionBudget,
            fundingSource: fundingSource,
            consent: consent,
            consentVersion: ApplicationContract.consentVersion
        )
    }
}

enum ApplicationWizardPolicy {
    /// Multi-select ceilings (ApplicationWizard.tsx:128-133).
    static func selectionLimit(for key: ApplicationWizardStep) -> Int {
        switch key {
        case .fields: return 10
        case .levels: return 6
        default: return 15
        }
    }

    /// Step gate parity (ApplicationWizard.tsx:135-149): the returned value
    /// is the LOCALIZATION KEY of the same validation message the web shows,
    /// nil when the step passes. The account step re-runs the full contract
    /// validator, like the web's step-8 `validateStudentApplicationDraft`.
    static func validationKey(
        step: ApplicationWizardStep,
        values: ApplicationWizardValues,
        requestId: String
    ) -> String? {
        switch step {
        case .countries:
            return values.destinationCountries.isEmpty ? "apply_validation_countries" : nil
        case .intake:
            return values.intakeSeason.isEmpty || values.intakeYear.isEmpty
                ? "apply_validation_intake" : nil
        case .education:
            return values.educationLevel.isEmpty || values.averageGrade.isEmpty
                ? "apply_validation_education" : nil
        case .fields:
            return values.studyFields.isEmpty ? "apply_validation_fields" : nil
        case .levels:
            return values.studyLevels.isEmpty ? "apply_validation_levels" : nil
        case .nationality:
            return ApplicationContract.nationalities.contains(values.nationality)
                ? nil : "apply_validation_nationality"
        case .english:
            if values.englishMode == "exam" {
                return values.englishScore.isEmpty ? "apply_validation_english_score" : nil
            }
            return values.englishMode == "self" && !values.englishLevel.isEmpty
                ? nil : "apply_validation_english"
        case .budget:
            return values.tuitionBudget.isEmpty || values.fundingSource.isEmpty
                ? "apply_validation_budget" : nil
        case .account:
            return ApplicationDraftValidator.isValid(values.draft(requestId: requestId))
                ? nil : "apply_validation_review"
        }
    }

    /// Final-step field gates the web enforces via required form controls
    /// before the action's own checks (student-signup-actions.ts:38-39 and
    /// student-public-registration.ts:13-18).
    static func isValidEmail(_ raw: String) -> Bool {
        let email = raw.trimmingCharacters(in: .whitespaces).lowercased()
        return email.count <= 254
            && email.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil
    }

    /// ≥12 characters (web minLength) and ≤72 UTF-8 bytes (bcrypt bound the
    /// server enforces; pre-checked here for an honest local error).
    static func passwordIssueKey(_ password: String) -> String? {
        if password.count < 12 { return "apply_server_password" }
        if password.utf8.count > 72 { return "apply_server_password_too_long" }
        return nil
    }

    /// Registration endpoint statuses → the SAME localized messages the web
    /// wizard maps (ApplicationWizard.tsx:168-173, ключи server.* словаря).
    static func registrationErrorKey(_ outcome: StudentRegistrationOutcome) -> String? {
        switch outcome {
        case .created: return nil
        case .invalid: return "apply_server_invalid"
        case .password: return "apply_server_password"
        case .passwordTooLong: return "apply_server_password_too_long"
        case .conflict: return "apply_server_conflict"
        case .rateLimit: return "apply_server_rate_limit"
        case .unavailable: return "apply_server_unavailable"
        }
    }
}

// MARK: - Router decisions

/// The honest replacement of the case-less accessPending routing
/// (docs/PLAN_CHANGES.md PORT-9a, решение 3).
enum ApplicationAccessPolicy {
    enum AuthorityRoute: Equatable {
        case active
        case accessPending
        case applicationFlow
    }

    /// isStudent == nil means `current_actor_authority` returned no row.
    /// - staff authority → accessPending (this app has no staff surface);
    /// - student with exactly one case → active (unchanged wave-2 rule);
    /// - student with zero cases → анкетный маршрут (invited membership is
    ///   bound before approval but not activated — migration 193(d));
    /// - student with 2+ cases → accessPending (multi-case v1 unsupported);
    /// - no authority at all → анкетный маршрут.
    static func authorityRoute(isStudent: Bool?, caseCount: Int) -> AuthorityRoute {
        guard let isStudent else { return .applicationFlow }
        guard isStudent else { return .accessPending }
        if caseCount == 1 { return .active }
        return caseCount == 0 ? .applicationFlow : .accessPending
    }

    enum ApplicationRoute: Equatable {
        case accessPending
        case status
        case resumeSubmit
        case wizard
    }

    /// resumeStudentApplication parity (student-signup-runtime.ts:40-61):
    /// only a confirmed non-staff-provisioned identity may claim its draft;
    /// an existing application wins; a valid metadata draft is submitted;
    /// otherwise the wizard opens.
    static func applicationRoute(
        emailConfirmed: Bool,
        passwordProvisionedStaff: Bool,
        hasApplication: Bool,
        metadataDraftValid: Bool
    ) -> ApplicationRoute {
        if !emailConfirmed || passwordProvisionedStaff { return .accessPending }
        if hasApplication { return .status }
        return metadataDraftValid ? .resumeSubmit : .wizard
    }

    /// The staff provisioner's protected marker
    /// (student-signup-runtime.ts:10-13).
    static func isPasswordProvisionedStaff(marker: String?) -> Bool {
        guard let marker else { return false }
        return !marker.isEmpty
    }
}

// MARK: - Invite entry

enum InviteLinkPolicy {
    private static let tokenHashPattern = "^[0-9a-f]{56}$"

    /// Mirror of decodeStudentInviteCallbackQuery
    /// (src/lib/student-invite-callback-contract.ts:75-90): the pasted text
    /// is either the bare 56-hex token hash, or the emailed callback link
    /// whose query carries EXACTLY token_hash + type=invite.
    static func tokenHash(fromPastedText raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.range(of: tokenHashPattern, options: .regularExpression) != nil {
            return text
        }
        guard let components = URLComponents(string: text),
              let items = components.queryItems,
              items.count == 2,
              items.contains(where: { $0.name == "type" && $0.value == "invite" }),
              let tokenItem = items.first(where: { $0.name == "token_hash" }),
              let token = tokenItem.value,
              token.range(of: tokenHashPattern, options: .regularExpression) != nil
        else { return nil }
        return token
    }

    /// invitedNamePrefill parity (src/app/apply/page.tsx:18-25): the receipt's
    /// display name splits on whitespace; first word → имя (≤60), remainder →
    /// фамилия (≤60); an empty name yields no prefill.
    static func namePrefill(displayName: String?) -> (firstName: String, lastName: String)? {
        let parts = (displayName ?? "")
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
        guard let first = parts.first, !first.isEmpty else { return nil }
        return (
            firstName: String(first.prefix(60)),
            lastName: String(parts.dropFirst().joined(separator: " ").prefix(60))
        )
    }
}
