import XCTest

/// Ответ RPC выбора страны (миграция 284, контракт
/// docs/portal/country-timeline-contract.md §4): тот же строгий разбор, что
/// `parseStudentCountryChoice` веба, и повтор `p_request_id` после сбоя.
final class CountryChoiceTests: XCTestCase {
    private func parse(_ json: String) -> StudentCountryChoice? {
        StudentCountryChoice.parse(Data(json.utf8))
    }

    func testEverySourceTheServerReturns() {
        XCTAssertEqual(parse(#"{"country":"CN","source":"saved","savedAt":"2026-10-16T10:04:44.123456+00:00"}"#),
                       StudentCountryChoice(country: "CN", source: .saved, savedAt: "2026-10-16T10:04:44.123456+00:00"))
        XCTAssertEqual(parse(#"{"country":"UNDECIDED","source":"saved","savedAt":"2026-10-16T10:04:44Z"}"#)?.country, "UNDECIDED")
        XCTAssertEqual(parse(#"{"country":"IT","source":"application","savedAt":null}"#),
                       StudentCountryChoice(country: "IT", source: .application, savedAt: nil))
        XCTAssertEqual(parse(#"{"country":"MY","source":"case","savedAt":null}"#)?.source, .case)
        XCTAssertEqual(parse(#"{"country":null,"source":"none","savedAt":null}"#),
                       StudentCountryChoice(country: nil, source: .none, savedAt: nil))
        XCTAssertEqual(StudentCountryChoice.values, ["CN", "MY", "AE", "TR", "IT", "CZ", "UNDECIDED"])
        XCTAssertEqual(StudentCountryChoice.countryCodes, StudyCountries.codes)
    }

    func testAnyOtherShapeIsRejected() {
        let rejected = [
            #"null"#,
            #"[]"#,
            #""CN""#,
            #"{"country":"CN","source":"saved"}"#,
            #"{"country":"CN","source":"saved","savedAt":"2026-10-16T10:04:44Z","extra":1}"#,
            #"{"country":"cn","source":"saved","savedAt":"2026-10-16T10:04:44Z"}"#,
            #"{"country":"PL","source":"saved","savedAt":"2026-10-16T10:04:44Z"}"#,
            #"{"country":"undecided","source":"saved","savedAt":"2026-10-16T10:04:44Z"}"#,
            #"{"country":"CN","source":"saved","savedAt":null}"#,
            #"{"country":"CN","source":"saved","savedAt":"16.10.2026"}"#,
            #"{"country":"CN","source":"saved","savedAt":"2026-13-45T10:04:44Z"}"#,
            #"{"country":"UNDECIDED","source":"application","savedAt":null}"#,
            #"{"country":"CN","source":"application","savedAt":"2026-10-16T10:04:44Z"}"#,
            #"{"country":"CN","source":"none","savedAt":null}"#,
            #"{"country":null,"source":"case","savedAt":null}"#,
            #"{"country":"CN","source":"crm","savedAt":null}"#,
            #"{"country":1,"source":"case","savedAt":null}"#,
            // `$` JavaScript не пропускает перевод строки в конце (у ICU это `\z`).
            #"{"country":"CN","source":"saved","savedAt":"2026-10-16T10:04:44Z\n"}"#,
        ]
        for json in rejected { XCTAssertNil(parse(json), json) }
    }

    func testARetryAfterAFailureReusesTheRequestId() {
        let first = UUID()
        let second = UUID()
        var ids = [first, second]
        let makeId = { ids.removeFirst() }
        let attempt = CountryChoiceAttempt.next(for: "CN", after: nil, makeId: makeId)
        XCTAssertEqual(attempt, CountryChoiceAttempt(country: "CN", requestId: first))
        // Сетевой сбой: тот же выбор уходит с тем же id (сервер вернёт исходную квитанцию).
        XCTAssertEqual(CountryChoiceAttempt.next(for: "CN", after: attempt, makeId: makeId), attempt)
        // Другая страна это новое действие студента: новый id.
        XCTAssertEqual(CountryChoiceAttempt.next(for: "MY", after: attempt, makeId: makeId),
                       CountryChoiceAttempt(country: "MY", requestId: second))
    }
}
