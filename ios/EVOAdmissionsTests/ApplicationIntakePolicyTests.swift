import XCTest

/// PORT-9a policy units — each mirrors a cited web behaviour:
/// - draft validation parity — validateStudentApplicationDraft
///   (src/lib/student-application-contract.ts:55-84), rule for rule;
/// - step gating order — ApplicationWizard.tsx:135-149;
/// - router decision table — docs/PLAN_CHANGES.md PORT-9a решение 3 and
///   resumeStudentApplication (student-signup-runtime.ts:40-61);
/// - invite link parsing — decodeStudentInviteCallbackQuery
///   (student-invite-callback-contract.ts:75-90);
/// - name prefill — invitedNamePrefill (src/app/apply/page.tsx:18-25).
final class ApplicationIntakePolicyTests: XCTestCase {
    private func validDraft() -> StudentApplicationDraft {
        StudentApplicationDraft(
            schemaVersion: 1,
            requestId: "3f6a1e9c-2b3d-4c5e-8f90-123456789abc",
            firstName: "Айдана",
            lastName: "Осмонова",
            phone: "+996 555 112233",
            destinationCountries: ["CN", "MY"],
            intakeSeason: "autumn",
            intakeYear: 2027,
            educationLevel: "high_school",
            averageGrade: 4.5,
            gradeScale: "5",
            studyFields: ["Инженерия"],
            studyLevels: ["bachelor"],
            nationality: "KG",
            english: .selfAssessed(level: "intermediate"),
            tuitionBudget: "5000_10000",
            fundingSource: "family",
            consent: true,
            consentVersion: "2026-09-18"
        )
    }

    // MARK: - Draft validation parity (contract:55-84)

    func testValidDraftPasses() {
        XCTAssertTrue(ApplicationDraftValidator.isValid(validDraft()))
    }

    func testEveryContractRuleRejects() {
        var cases: [(String, (inout StudentApplicationDraft) -> Void)] = []
        cases.append(("schemaVersion", { $0.schemaVersion = 2 }))                        // contract:57
        cases.append(("requestId not uuid", { $0.requestId = "not-a-uuid" }))            // contract:57
        cases.append(("empty firstName", { $0.firstName = "" }))                         // contract:58
        cases.append(("untrimmed lastName", { $0.lastName = " Осмонова" }))              // contract:58 (text trim)
        cases.append(("firstName over 60", { $0.firstName = String(repeating: "а", count: 61) }))
        cases.append(("control char", { $0.firstName = "Ай\u{0007}дана" }))              // contract:44
        cases.append(("phone shape", { $0.phone = "call me" }))                          // contract:59
        cases.append(("phone under 7 digits", { $0.phone = "+996 55" }))                 // contract:59
        cases.append(("phone over 15 digits", { $0.phone = "+9965551122334455" }))       // contract:59
        cases.append(("empty countries", { $0.destinationCountries = [] }))              // contract:60
        cases.append(("unknown country", { $0.destinationCountries = ["US"] }))          // contract:60
        cases.append(("duplicate countries", { $0.destinationCountries = ["CN", "CN"] })) // contract:50
        cases.append(("season", { $0.intakeSeason = "fall" }))                           // contract:61
        cases.append(("year below 2026", { $0.intakeYear = 2025 }))                      // contract:62
        cases.append(("year above 2036", { $0.intakeYear = 2037 }))                      // contract:62
        cases.append(("education level", { $0.educationLevel = "kindergarten" }))        // contract:63
        cases.append(("grade scale", { $0.gradeScale = "12" }))                          // contract:64
        cases.append(("grade above scale", { $0.averageGrade = 5.5 }))                   // contract:65
        cases.append(("negative grade", { $0.averageGrade = -1 }))                       // contract:65
        cases.append(("empty fields", { $0.studyFields = [] }))                          // contract:66
        cases.append(("field over 100", { $0.studyFields = [String(repeating: "н", count: 101)] }))
        cases.append(("over 10 fields", { $0.studyFields = (0..<11).map { "Направление \($0)" } }))
        cases.append(("study level", { $0.studyLevels = ["postdoc"] }))                  // contract:67
        cases.append(("nationality", { $0.nationality = "XX" }))                         // contract:68
        cases.append(("budget", { $0.tuitionBudget = "free" }))                          // contract:69
        cases.append(("funding", { $0.fundingSource = "sponsor" }))                      // contract:70
        cases.append(("no consent", { $0.consent = false }))                             // contract:71
        cases.append(("stale consent version", { $0.consentVersion = "2025-01-01" }))    // contract:71
        cases.append(("english level", { $0.english = .selfAssessed(level: "native") })) // contract:75
        cases.append(("unknown exam", { $0.english = .exam(exam: "cae", score: 100) }))  // contract:78
        cases.append(("score above max", { $0.english = .exam(exam: "ielts", score: 9.5) }))  // contract:81
        cases.append(("score below min", { $0.english = .exam(exam: "pte", score: 9) }))      // contract:81
        cases.append(("score off step", { $0.english = .exam(exam: "duolingo", score: 92) })) // contract:81
        for (name, mutate) in cases {
            var draft = validDraft()
            mutate(&draft)
            XCTAssertFalse(ApplicationDraftValidator.isValid(draft), name)
        }
    }

    func testExamStepBoundariesMirrorTheWebRanges() {
        // presentation.ts:47-53 / contract:77-81.
        var draft = validDraft()
        draft.english = .exam(exam: "ielts", score: 6.5)
        XCTAssertTrue(ApplicationDraftValidator.isValid(draft))
        draft.english = .exam(exam: "duolingo", score: 120)
        XCTAssertTrue(ApplicationDraftValidator.isValid(draft))
        draft.english = .exam(exam: "toefl", score: 1)
        XCTAssertTrue(ApplicationDraftValidator.isValid(draft))
    }

    // MARK: - Step gating (ApplicationWizard.tsx:135-149)

    func testStepValidationKeysFollowTheWebOrder() {
        let values = ApplicationWizardValues()
        let requestId = "3f6a1e9c-2b3d-4c5e-8f90-123456789abc"
        let expected: [(ApplicationWizardStep, String)] = [
            (.countries, "apply_validation_countries"),
            (.intake, "apply_validation_intake"),
            (.education, "apply_validation_education"),
            (.fields, "apply_validation_fields"),
            (.levels, "apply_validation_levels"),
            (.nationality, "apply_validation_nationality"),
            (.english, "apply_validation_english"),
            (.budget, "apply_validation_budget"),
            (.account, "apply_validation_review"),
        ]
        for (step, key) in expected {
            XCTAssertEqual(
                ApplicationWizardPolicy.validationKey(step: step, values: values, requestId: requestId),
                key, String(describing: step)
            )
        }
        // Exam mode without a score shows the score-specific message
        // (web validation.englishScore).
        var exam = values
        exam.englishMode = "exam"
        XCTAssertEqual(
            ApplicationWizardPolicy.validationKey(step: .english, values: exam, requestId: requestId),
            "apply_validation_english_score"
        )
    }

    func testCompleteValuesPassEveryStepAndAssembleTheDraft() {
        var values = ApplicationWizardValues(draft: validDraft())
        values.consent = true // re-confirmed per submission
        let requestId = "9f6a1e9c-2b3d-4c5e-8f90-123456789abc"
        for step in ApplicationWizardStep.allCases {
            XCTAssertNil(
                ApplicationWizardPolicy.validationKey(step: step, values: values, requestId: requestId),
                String(describing: step)
            )
        }
        let draft = values.draft(requestId: requestId)
        XCTAssertEqual(draft.requestId, requestId)
        XCTAssertTrue(ApplicationDraftValidator.isValid(draft))
        // Contacts are trimmed exactly like questionnaire()
        // (ApplicationWizard.tsx:49).
        values.firstName = " Айдана "
        XCTAssertEqual(values.draft(requestId: requestId).firstName, "Айдана")
    }

    func testResubmitPrefillKeepsAnswersAndRequiresFreshConsent() {
        // /apply?edit=1 loads the rejected questionnaire and a NEW requestId;
        // consent is re-confirmed (initialState, ApplicationWizard.tsx:33-45).
        let values = ApplicationWizardValues(draft: validDraft())
        XCTAssertEqual(values.intakeYear, "2027")
        XCTAssertEqual(values.averageGrade, "4.5")
        XCTAssertEqual(values.englishMode, "self")
        XCTAssertFalse(values.consent)
    }

    func testSelectionLimitsMirrorTheWeb() {
        // ApplicationWizard.tsx:130 — 10 fields, 6 levels, 15 otherwise.
        XCTAssertEqual(ApplicationWizardPolicy.selectionLimit(for: .fields), 10)
        XCTAssertEqual(ApplicationWizardPolicy.selectionLimit(for: .levels), 6)
        XCTAssertEqual(ApplicationWizardPolicy.selectionLimit(for: .countries), 15)
    }

    func testFinalStepCredentialGates() {
        XCTAssertTrue(ApplicationWizardPolicy.isValidEmail("User@Example.com "))
        XCTAssertFalse(ApplicationWizardPolicy.isValidEmail("not-an-email"))
        XCTAssertFalse(ApplicationWizardPolicy.isValidEmail("a@b"))
        // ≥12 chars (web minLength) and the bcrypt 72-byte bound
        // (student-public-registration.ts:15-18).
        XCTAssertEqual(ApplicationWizardPolicy.passwordIssueKey("short"), "apply_server_password")
        XCTAssertNil(ApplicationWizardPolicy.passwordIssueKey(String(repeating: "x", count: 12)))
        XCTAssertEqual(
            ApplicationWizardPolicy.passwordIssueKey(String(repeating: "п", count: 40)),
            "apply_server_password_too_long"
        )
    }

    func testRegistrationOutcomeMessagesMatchTheWebMapping() {
        // ApplicationWizard.tsx:168-173.
        XCTAssertNil(ApplicationWizardPolicy.registrationErrorKey(.created))
        XCTAssertEqual(ApplicationWizardPolicy.registrationErrorKey(.password), "apply_server_password")
        XCTAssertEqual(ApplicationWizardPolicy.registrationErrorKey(.passwordTooLong), "apply_server_password_too_long")
        XCTAssertEqual(ApplicationWizardPolicy.registrationErrorKey(.rateLimit), "apply_server_rate_limit")
        XCTAssertEqual(ApplicationWizardPolicy.registrationErrorKey(.conflict), "apply_server_conflict")
        XCTAssertEqual(ApplicationWizardPolicy.registrationErrorKey(.invalid), "apply_server_invalid")
        XCTAssertEqual(ApplicationWizardPolicy.registrationErrorKey(.unavailable), "apply_server_unavailable")
    }

    // MARK: - Router decisions (PLAN_CHANGES PORT-9a решение 3)

    func testAuthorityRouteTable() {
        // staff → accessPending; student 1 case → active; student 0 cases →
        // анкетный маршрут (invited pre-activation, 193(d)); student 2+ →
        // accessPending; no authority → анкетный маршрут.
        XCTAssertEqual(ApplicationAccessPolicy.authorityRoute(isStudent: false, caseCount: 0), .accessPending)
        XCTAssertEqual(ApplicationAccessPolicy.authorityRoute(isStudent: true, caseCount: 1), .active)
        XCTAssertEqual(ApplicationAccessPolicy.authorityRoute(isStudent: true, caseCount: 0), .applicationFlow)
        XCTAssertEqual(ApplicationAccessPolicy.authorityRoute(isStudent: true, caseCount: 2), .accessPending)
        XCTAssertEqual(ApplicationAccessPolicy.authorityRoute(isStudent: nil, caseCount: 0), .applicationFlow)
    }

    func testApplicationRouteMirrorsResumeSemantics() {
        // student-signup-runtime.ts:40-61: unverified/staff-provisioned →
        // never claims a draft; an existing application wins; a valid
        // metadata draft is submitted; otherwise the wizard.
        XCTAssertEqual(
            ApplicationAccessPolicy.applicationRoute(
                emailConfirmed: false, passwordProvisionedStaff: false,
                hasApplication: false, metadataDraftValid: true
            ),
            .accessPending
        )
        XCTAssertEqual(
            ApplicationAccessPolicy.applicationRoute(
                emailConfirmed: true, passwordProvisionedStaff: true,
                hasApplication: true, metadataDraftValid: false
            ),
            .accessPending
        )
        XCTAssertEqual(
            ApplicationAccessPolicy.applicationRoute(
                emailConfirmed: true, passwordProvisionedStaff: false,
                hasApplication: true, metadataDraftValid: true
            ),
            .status
        )
        XCTAssertEqual(
            ApplicationAccessPolicy.applicationRoute(
                emailConfirmed: true, passwordProvisionedStaff: false,
                hasApplication: false, metadataDraftValid: true
            ),
            .resumeSubmit
        )
        XCTAssertEqual(
            ApplicationAccessPolicy.applicationRoute(
                emailConfirmed: true, passwordProvisionedStaff: false,
                hasApplication: false, metadataDraftValid: false
            ),
            .wizard
        )
    }

    func testStaffMarkerRule() {
        // student-signup-runtime.ts:10-13 — non-empty string marker only.
        XCTAssertFalse(ApplicationAccessPolicy.isPasswordProvisionedStaff(marker: nil))
        XCTAssertFalse(ApplicationAccessPolicy.isPasswordProvisionedStaff(marker: ""))
        XCTAssertTrue(ApplicationAccessPolicy.isPasswordProvisionedStaff(marker: "req-1"))
    }

    // MARK: - Invite entry

    func testInviteLinkParsingMirrorsTheCallbackContract() {
        let token = String(repeating: "ab", count: 28) // 56 hex chars
        // Bare token.
        XCTAssertEqual(InviteLinkPolicy.tokenHash(fromPastedText: " \(token) "), token)
        // The emailed link (supabase/templates/invite.html:6).
        XCTAssertEqual(
            InviteLinkPolicy.tokenHash(
                fromPastedText: "https://app.evoadmissions.com/auth/callback?token_hash=\(token)&type=invite"
            ),
            token
        )
        // Contract violations (student-invite-callback-contract.ts:75-90):
        // wrong type, extra params, missing params, malformed hash.
        for raw in [
            "https://app.evoadmissions.com/auth/callback?token_hash=\(token)&type=recovery",
            "https://app.evoadmissions.com/auth/callback?token_hash=\(token)&type=invite&extra=1",
            "https://app.evoadmissions.com/auth/callback?token_hash=\(token)",
            "https://app.evoadmissions.com/auth/callback?token_hash=XYZ&type=invite",
            "not a link",
            String(repeating: "g", count: 56),
        ] {
            XCTAssertNil(InviteLinkPolicy.tokenHash(fromPastedText: raw), raw)
        }
    }

    func testInvitedNamePrefillSplitsLikeTheWeb() {
        // apply/page.tsx:18-25.
        let split = InviteLinkPolicy.namePrefill(displayName: "Айдана Осмонова кызы")
        XCTAssertEqual(split?.firstName, "Айдана")
        XCTAssertEqual(split?.lastName, "Осмонова кызы")
        XCTAssertNil(InviteLinkPolicy.namePrefill(displayName: "   "))
        XCTAssertNil(InviteLinkPolicy.namePrefill(displayName: nil))
        let long = InviteLinkPolicy.namePrefill(
            displayName: String(repeating: "а", count: 70) + " " + String(repeating: "б", count: 70)
        )
        XCTAssertEqual(long?.firstName.count, 60)
        XCTAssertEqual(long?.lastName.count, 60)
    }
}
