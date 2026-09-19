import XCTest

/// PORT-9a decoder/contract fixtures. Sources of truth:
/// - own_student_application_v1 row shape — the web decoder's exact key set
///   (src/lib/v3/student-application-source.ts:22) and its cross-field
///   invariants (:25-38);
/// - draft key set — DRAFT_KEYS (src/lib/student-application-contract.ts:52);
/// - registration statuses — StudentSignupState vocabulary
///   (src/lib/student-signup-actions.ts:15) + created;
/// - invite acceptance — the PORT-9a handler's response contract
///   (src/lib/server/student-portal-intake-route-handlers.ts).
final class ApplicationIntakeDecodingTests: XCTestCase {
    private func validDraftJSON(english: String = #"{"mode":"self","level":"intermediate"}"#) -> String {
        """
        {
          "schemaVersion": 1,
          "requestId": "3f6a1e9c-2b3d-4c5e-8f90-123456789abc",
          "firstName": "Айдана",
          "lastName": "Осмонова",
          "phone": "+996 555 112233",
          "destinationCountries": ["CN", "MY"],
          "intakeSeason": "autumn",
          "intakeYear": 2027,
          "educationLevel": "high_school",
          "averageGrade": 4.5,
          "gradeScale": "5",
          "studyFields": ["Инженерия"],
          "studyLevels": ["bachelor"],
          "nationality": "KG",
          "english": \(english),
          "tuitionBudget": "5000_10000",
          "fundingSource": "family",
          "consent": true,
          "consentVersion": "2026-09-18"
        }
        """
    }

    func testDecodesPendingApplicationRow() throws {
        // Pending ⟺ decided_at null and no case link
        // (student-application-source.ts:37-38).
        let fixture = """
        {
          "id": "10000000-0000-4000-8000-000000000001",
          "status": "pending",
          "revision": 1,
          "email": "aidana@example.com",
          "questionnaire": \(validDraftJSON()),
          "submitted_at": "2026-09-20T09:00:00+00:00",
          "decided_at": null,
          "decision_reason": null,
          "student_case_id": null,
          "admissions_direction": null,
          "canonical_lead_id": null
        }
        """
        let application = try StudentApplication.decodeValidated(from: Data(fixture.utf8))
        XCTAssertEqual(application.status, .pending)
        XCTAssertEqual(application.revision, 1)
        XCTAssertEqual(application.questionnaire.firstName, "Айдана")
        XCTAssertEqual(application.questionnaire.english, .selfAssessed(level: "intermediate"))
        XCTAssertNil(application.decisionReason)
    }

    func testDecodesRejectedApplicationWithReasonAndExamEnglish() throws {
        let fixture = """
        {
          "id": "10000000-0000-4000-8000-000000000001",
          "status": "rejected",
          "revision": 2,
          "email": "aidana@example.com",
          "questionnaire": \(validDraftJSON(english: #"{"mode":"exam","exam":"ielts","score":6.5}"#)),
          "submitted_at": "2026-09-20T09:00:00+00:00",
          "decided_at": "2026-09-21T09:00:00+00:00",
          "decision_reason": "Уточните средний балл",
          "student_case_id": null,
          "admissions_direction": null,
          "canonical_lead_id": "20000000-0000-4000-8000-000000000002"
        }
        """
        let application = try StudentApplication.decodeValidated(from: Data(fixture.utf8))
        XCTAssertEqual(application.status, .rejected)
        XCTAssertEqual(application.decisionReason, "Уточните средний балл")
        XCTAssertEqual(application.questionnaire.english, .exam(exam: "ielts", score: 6.5))
    }

    func testApprovedRequiresCaseLink() throws {
        // (status == approved) ⟺ (student_case_id != null)
        // (student-application-source.ts:37).
        let fixture = """
        {
          "id": "10000000-0000-4000-8000-000000000001",
          "status": "approved",
          "revision": 1,
          "email": "aidana@example.com",
          "questionnaire": \(validDraftJSON()),
          "submitted_at": "2026-09-20T09:00:00+00:00",
          "decided_at": "2026-09-21T09:00:00+00:00",
          "decision_reason": null,
          "student_case_id": null,
          "admissions_direction": null,
          "canonical_lead_id": null
        }
        """
        XCTAssertThrowsError(try StudentApplication.decodeValidated(from: Data(fixture.utf8)))
    }

    func testNullRowDecodesToNil() throws {
        // own_student_application_v1 returns JSON null without an application
        // (student-application-source.ts:55-58).
        XCTAssertNil(try StudentApplication.decodeOptionalValidated(from: Data("null".utf8)))
    }

    func testDraftRoundTripKeepsTheContractKeySet() throws {
        // DRAFT_KEYS (contract:52): exactly these 19 keys, sorted.
        let draft = try JSONDecoder().decode(
            StudentApplicationDraft.self, from: Data(validDraftJSON().utf8)
        )
        let encoded = try JSONEncoder().encode(draft)
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        XCTAssertEqual(object.keys.sorted(), [
            "averageGrade", "consent", "consentVersion", "destinationCountries",
            "educationLevel", "english", "firstName", "fundingSource", "gradeScale",
            "intakeSeason", "intakeYear", "lastName", "nationality", "phone",
            "requestId", "schemaVersion", "studyFields", "studyLevels", "tuitionBudget",
        ])
        let english = try XCTUnwrap(object["english"] as? [String: Any])
        XCTAssertEqual(english.keys.sorted(), ["level", "mode"])
        // Whole numbers encode without a fraction (web JSON.stringify parity).
        let reencoded = String(decoding: encoded, as: UTF8.self)
        XCTAssertTrue(reencoded.contains("\"intakeYear\":2027"))
        XCTAssertTrue(reencoded.contains("4.5"))
    }

    func testExamEnglishEncodesExactVariantKeys() throws {
        // contract:78 — exam,mode,score; whole scores stay integers.
        let draft = try JSONDecoder().decode(
            StudentApplicationDraft.self,
            from: Data(validDraftJSON(english: #"{"mode":"exam","exam":"duolingo","score":120}"#).utf8)
        )
        let encoded = try JSONEncoder().encode(draft)
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        let english = try XCTUnwrap(object["english"] as? [String: Any])
        XCTAssertEqual(english.keys.sorted(), ["exam", "mode", "score"])
        XCTAssertTrue(String(decoding: try JSONEncoder().encode(draft), as: UTF8.self)
            .contains("\"score\":120"))
    }

    func testRegistrationOutcomeDecodesStatusVocabulary() {
        // The endpoint's {status} bodies (PLAN_CHANGES PORT-9a решение 2).
        for (raw, expected) in [
            ("created", StudentRegistrationOutcome.created),
            ("invalid", .invalid),
            ("password", .password),
            ("password_too_long", .passwordTooLong),
            ("conflict", .conflict),
            ("rate_limit", .rateLimit),
            ("unavailable", .unavailable),
        ] {
            XCTAssertEqual(
                StudentRegistrationOutcome.decode(from: Data(#"{"status":"\#(raw)"}"#.utf8)),
                expected, raw
            )
        }
        XCTAssertEqual(StudentRegistrationOutcome.decode(from: Data("{}".utf8)), .unavailable)
        XCTAssertEqual(
            StudentRegistrationOutcome.decode(from: Data(#"{"status":"surprise"}"#.utf8)),
            .unavailable
        )
    }

    func testInviteAcceptanceOutcomeMapsStatusCodes() {
        let accepted = #"{"status":"accepted","intakeFlow":"anketa_v1","accountPending":true,"displayName":"Айдана Осмонова"}"#
        guard case let .accepted(receipt) = InviteAcceptanceOutcome.from(
            statusCode: 200, body: Data(accepted.utf8)
        ) else { return XCTFail("expected accepted") }
        XCTAssertEqual(receipt.intakeFlow, "anketa_v1")
        XCTAssertTrue(receipt.accountPending)
        XCTAssertEqual(receipt.displayName, "Айдана Осмонова")

        // Legacy receipts pass through with their honest flow; displayName
        // may be null (store bounds it to 1...200 characters).
        let legacy = #"{"status":"accepted","intakeFlow":"legacy","accountPending":false,"displayName":null}"#
        guard case let .accepted(legacyReceipt) = InviteAcceptanceOutcome.from(
            statusCode: 200, body: Data(legacy.utf8)
        ) else { return XCTFail("expected accepted") }
        XCTAssertNil(legacyReceipt.displayName)

        XCTAssertEqual(
            InviteAcceptanceOutcome.from(statusCode: 401, body: Data(#"{"status":"authentication_required"}"#.utf8)),
            .authenticationRequired
        )
        XCTAssertEqual(
            InviteAcceptanceOutcome.from(statusCode: 409, body: Data(#"{"status":"mismatch"}"#.utf8)),
            .mismatch
        )
        XCTAssertEqual(
            InviteAcceptanceOutcome.from(statusCode: 503, body: Data(#"{"status":"unavailable"}"#.utf8)),
            .unavailable
        )
        // A 200 with an unusable body is not silently "accepted".
        XCTAssertEqual(
            InviteAcceptanceOutcome.from(statusCode: 200, body: Data("{}".utf8)),
            .unavailable
        )
    }

    func testIntakeTransferRequests() throws {
        let base = URL(string: "https://app.evoadmissions.com")!
        let draft = try JSONDecoder().decode(
            StudentApplicationDraft.self, from: Data(validDraftJSON().utf8)
        )
        let registration = try ApplicationIntakeTransfer.registrationRequest(
            baseURL: base,
            payload: StudentRegistrationPayload(
                questionnaire: draft, email: "user@example.com", password: String(repeating: "x", count: 12)
            )
        )
        XCTAssertEqual(registration.url?.absoluteString, "https://app.evoadmissions.com/api/portal/registration")
        XCTAssertEqual(registration.httpMethod, "POST")
        XCTAssertEqual(registration.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(registration.httpBody)
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        // The handler's exact-key contract (REGISTRATION_KEYS).
        XCTAssertEqual(object.keys.sorted(), ["email", "password", "questionnaire"])

        let acceptance = ApplicationIntakeTransfer.inviteAcceptanceRequest(
            baseURL: base, accessToken: "aaa.bbb.ccc"
        )
        XCTAssertEqual(acceptance.url?.absoluteString, "https://app.evoadmissions.com/api/portal/invite-acceptance")
        XCTAssertEqual(acceptance.httpMethod, "POST")
        XCTAssertEqual(acceptance.value(forHTTPHeaderField: "Authorization"), "Bearer aaa.bbb.ccc")
        XCTAssertNil(acceptance.httpBody)
    }
}
