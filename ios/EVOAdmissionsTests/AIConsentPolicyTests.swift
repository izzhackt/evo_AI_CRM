import XCTest

/// Согласие на ИИ-помощников (контракт 25.10.2026): разбор ответов обеих RPC,
/// имена параметров записи, правила показа и повтора. Фикстуры написаны по
/// форме ответа контракта `{status, policyVersion, decidedAt,
/// currentPolicyVersion}`; сети нет.
final class AIConsentPolicyTests: XCTestCase {
    private let current = "2026-10-25"

    private func decode(_ json: String) throws -> AIConsent {
        try JSONDecoder().decode(AIConsent.self, from: Data(json.utf8))
    }

    private func consent(
        _ status: AIConsentStatus?,
        version: String? = "2026-10-25",
        decidedAt: String? = "2026-10-25T09:30:00.123456+00:00",
        currentVersion: String = "2026-10-25"
    ) -> AIConsent {
        AIConsent(status: status, policyVersion: status == nil ? nil : version,
                  decidedAt: status == nil ? nil : decidedAt, currentPolicyVersion: currentVersion)
    }

    // MARK: Разбор ответа

    func testDecodesNotAsked() throws {
        let value = try decode("""
        {"status": null, "policyVersion": null, "decidedAt": null, "currentPolicyVersion": "2026-10-25"}
        """)
        XCTAssertNil(value.status)
        XCTAssertNil(value.policyVersion)
        XCTAssertNil(value.decidedAt)
        XCTAssertEqual(value.currentPolicyVersion, "2026-10-25")
    }

    func testDecodesGranted() throws {
        let value = try decode("""
        {"status": "granted", "policyVersion": "2026-10-25",
         "decidedAt": "2026-10-25T09:30:00.123456+00:00", "currentPolicyVersion": "2026-10-25"}
        """)
        XCTAssertEqual(value.status, .granted)
        XCTAssertEqual(value.policyVersion, "2026-10-25")
        XCTAssertNotNil(PostgresTimestamp.date(from: value.decidedAt ?? ""))
    }

    func testDecodesDeclinedAndIgnoresExtraKeys() throws {
        let value = try decode("""
        {"status": "declined", "policyVersion": "2026-10-25", "decidedAt": "2026-10-25T09:30:00Z",
         "currentPolicyVersion": "2026-10-25", "future": 1}
        """)
        XCTAssertEqual(value.status, .declined)
    }

    func testRejectsUnknownStatusInsteadOfGuessing() {
        XCTAssertThrowsError(try decode("""
        {"status": "maybe", "policyVersion": "2026-10-25", "decidedAt": null, "currentPolicyVersion": "2026-10-25"}
        """))
    }

    func testRequiresCurrentPolicyVersion() {
        XCTAssertThrowsError(try decode("""
        {"status": null, "policyVersion": null, "decidedAt": null}
        """))
    }

    // MARK: Параметры записи

    func testSetParamsUseTheContractNamesAndValues() throws {
        let id = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        let params = AIConsentPolicy.params(for: .granted, requestId: id)
        let data = try JSONEncoder().encode(params)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        XCTAssertEqual(Set(object.keys), ["p_status", "p_policy_version", "p_source", "p_request_id"])
        XCTAssertEqual(object["p_status"], "granted")
        XCTAssertEqual(object["p_policy_version"], "2026-10-25")
        XCTAssertEqual(object["p_source"], "ios")
        XCTAssertEqual(object["p_request_id"]?.lowercased(), id.uuidString.lowercased())
        XCTAssertEqual(AIConsentPolicy.params(for: .declined, requestId: id).p_status, "declined")
    }

    func testPolicyVersionIsTheContractConstant() {
        XCTAssertEqual(AIConsentPolicy.policyVersion, "2026-10-25")
        XCTAssertEqual(AIConsentPolicy.source, "ios")
    }

    // MARK: Что видит студент

    func testCardAsksUntilDecidedOnCurrentVersion() {
        XCTAssertTrue(AIConsentPolicy.needsDecision(consent(nil)))
        XCTAssertFalse(AIConsentPolicy.needsDecision(consent(.granted)))
        XCTAssertFalse(AIConsentPolicy.needsDecision(consent(.declined)))
        // Решение на прежний текст: спрашиваем снова.
        XCTAssertTrue(AIConsentPolicy.needsDecision(consent(.granted, version: "2026-01-01")))
        XCTAssertTrue(AIConsentPolicy.needsDecision(consent(.declined, version: "2026-01-01")))
        // Сервер обновил текст после решения.
        XCTAssertTrue(AIConsentPolicy.needsDecision(consent(.granted, currentVersion: "2026-12-01")))
    }

    func testDisplayFollowsWhatTheHelpersActuallyDo() {
        XCTAssertEqual(AIConsentPolicy.display(consent(nil)), .notChosen)
        XCTAssertEqual(AIConsentPolicy.display(consent(.granted)), .granted)
        XCTAssertEqual(AIConsentPolicy.display(consent(.declined)), .declined)
        // Разрешение на прежний текст помощников не допускает.
        XCTAssertEqual(AIConsentPolicy.display(consent(.granted, version: "2026-01-01")), .notChosen)
        // Отказ они уважают при любой версии.
        XCTAssertEqual(AIConsentPolicy.display(consent(.declined, version: "2026-01-01")), .declined)
    }

    func testStateKeysAreTheThreeContractWords() {
        XCTAssertEqual(AIConsentPolicy.Display.granted.stateKey, "ai_consent_state_granted")
        XCTAssertEqual(AIConsentPolicy.Display.declined.stateKey, "ai_consent_state_declined")
        XCTAssertEqual(AIConsentPolicy.Display.notChosen.stateKey, "ai_consent_state_unset")
    }

    func testSettingsActionsPerState() {
        XCTAssertEqual(AIConsentPolicy.settingsActions(for: .granted), [.revoke])
        XCTAssertEqual(AIConsentPolicy.settingsActions(for: .declined), [.allow])
        XCTAssertEqual(AIConsentPolicy.settingsActions(for: .notChosen), [.allow, .decline])
        XCTAssertEqual(AIConsentPolicy.cardActions, [.allow, .decline])
    }

    func testActionsMapToTheTwoStoredAnswers() {
        XCTAssertEqual(AIConsentAction.allow.status, .granted)
        XCTAssertEqual(AIConsentAction.decline.status, .declined)
        XCTAssertEqual(AIConsentAction.revoke.status, .declined)
    }

    func testTextCurrentOnlyWhenServerVersionMatchesThisBuild() {
        XCTAssertTrue(AIConsentPolicy.isTextCurrent(consent(nil)))
        XCTAssertFalse(AIConsentPolicy.isTextCurrent(consent(nil, currentVersion: "2026-12-01")))
    }

    func testDateShownOnlyWithADecision() {
        // 09:30 UTC = 15:30 в Бишкеке, тот же день.
        XCTAssertEqual(AIConsentPolicy.dateLabel(consent(.granted)), "25.10.2026")
        // 20:00 UTC 24-го = 02:00 25-го по Бишкеку.
        XCTAssertEqual(
            AIConsentPolicy.dateLabel(consent(.declined, decidedAt: "2026-10-24T20:00:00+00:00")),
            "25.10.2026"
        )
        XCTAssertNil(AIConsentPolicy.dateLabel(consent(nil)))
        // «Не выбрано» без даты, даже если прежнее разрешение было.
        XCTAssertNil(AIConsentPolicy.dateLabel(consent(.granted, version: "2026-01-01")))
        XCTAssertNil(AIConsentPolicy.dateLabel(consent(.granted, decidedAt: "не дата")))
    }

    func testPrivacyLinkStaysTheRussianPolicyPage() {
        // Страницы политики на кыргызском на сайте нет (контракт: тогда RU).
        XCTAssertEqual(AppLinks.privacyPolicy.absoluteString, "https://evoadmissions.com/ru/privacy/")
    }

    // MARK: Повтор запроса

    func testSameChoiceKeepsRequestIdUntilServerAnswers() {
        var memo = AIConsentRequestMemo()
        var made = 0
        let make: () -> UUID = { made += 1; return UUID() }
        let first = memo.requestId(for: .granted, make: make)
        XCTAssertEqual(memo.requestId(for: .granted, make: make), first)
        XCTAssertEqual(made, 1)
        memo.settle()
        XCTAssertNotEqual(memo.requestId(for: .granted, make: make), first)
        XCTAssertEqual(made, 2)
    }

    func testOtherChoiceGetsItsOwnRequestId() {
        var memo = AIConsentRequestMemo()
        let granted = memo.requestId(for: .granted)
        let declined = memo.requestId(for: .declined)
        XCTAssertNotEqual(granted, declined)
        XCTAssertEqual(memo.requestId(for: .declined), declined)
    }
}
