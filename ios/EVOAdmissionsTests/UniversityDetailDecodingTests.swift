import XCTest

/// Разбор `student_university_detail_v1` (283, контракт 2.2 и 2.2a) на
/// реальных ответах демо-стека. Обёртка, карточка вуза, страна, избранное,
/// консультация и подготовки строгие; название страны, город, строки
/// стоимости и курсы деградируют по одному, как `parseStudentUniversityDetail`
/// веба.
final class UniversityDetailDecodingTests: XCTestCase {
    private let tongjiId = UUID(uuidString: "d446890e-85b6-4230-b1fc-8c2558fb2051")!

    private func decode(_ data: Data, log: CatalogIssueLog = CatalogIssueLog()) throws -> DetailUnderTest {
        try DetailUnderTest.decode(data, report: log.report)
    }

    private func parsed(_ name: String = AtlasFixtures.tongji, _ change: (inout [String: Any]) throws -> Void) throws -> (DetailUnderTest, [CatalogParseIssue]) {
        let log = CatalogIssueLog()
        let detail = try DetailUnderTest.decode(AtlasFixtures.mutated(name, change), expectedId: nil, report: log.report)
        return (detail, log.issues)
    }

    private func assertRefused(_ name: String = AtlasFixtures.tongji, _ change: (inout [String: Any]) throws -> Void,
                               file: StaticString = #filePath, line: UInt = #line) throws {
        let data = try AtlasFixtures.mutated(name, change)
        XCTAssertThrowsError(try decode(data), file: file, line: line)
    }

    private func rowIds(_ name: String = AtlasFixtures.tongji) throws -> [String] {
        let costs = try AtlasFixtures.object(name)["costs"] as! [String: Any]
        return (costs["rows"] as! [[String: Any]]).map { $0["id"] as! String }
    }

    private func changeRow(_ position: Int, _ change: @escaping (inout [String: Any]) -> Void) -> (inout [String: Any]) -> Void {
        { value in
            var costs = value["costs"] as! [String: Any]
            var rows = costs["rows"] as! [[String: Any]]
            change(&rows[position])
            costs["rows"] = rows
            value["costs"] = costs
        }
    }

    func testDecodesRealDetailWithOfficialAndAgencyRows() throws {
        let log = CatalogIssueLog()
        let detail = try decode(AtlasFixtures.data(AtlasFixtures.tongji), log: log)
        XCTAssertEqual(log.issues, [])
        XCTAssertEqual(detail.university.id, tongjiId)
        XCTAssertEqual(detail.university.content.name, "Tongji University")
        XCTAssertEqual(detail.country.code, "CN")
        XCTAssertEqual(detail.country.name.ru, "Китай")
        XCTAssertEqual(detail.city?.key, "shanghai")
        XCTAssertNil(detail.city?.universityCount)
        XCTAssertTrue(detail.favored)
        XCTAssertNotNil(detail.preparations)
        XCTAssertEqual(detail.preparations?.items.count, 0)
        let costs = try XCTUnwrap(detail.costs)
        XCTAssertEqual(costs.rows.count, 11)
        XCTAssertEqual(Set(costs.rows.map(\.source.kind)), [.official, .agency])
        // Адреса и названия агентства студенту не приходят.
        XCTAssertTrue(costs.rows.filter { $0.source.kind == .agency }.allSatisfy { $0.source.url == nil })
        XCTAssertTrue(costs.rows.filter { $0.source.kind == .official }.allSatisfy { $0.source.url?.scheme == "https" })
        XCTAssertEqual(costs.fxRates.map(\.currency), ["CNY"])
        XCTAssertEqual(costs.fxRates.first?.asOf, "2026-10-15")
        XCTAssertTrue(costs.rows.allSatisfy { $0.currency == "CNY" && $0.exponent == 2 && $0.usdApproxMin != nil })
    }

    func testDecodesRealDetailWithUsdRowsAndMixedYears() throws {
        let detail = try decode(AtlasFixtures.data(AtlasFixtures.bilkent))
        XCTAssertEqual(detail.country.code, "TR")
        let costs = try XCTUnwrap(detail.costs)
        let usdRows = costs.rows.filter { $0.currency == "USD" }
        XCTAssertFalse(usdRows.isEmpty)
        // Строка в USD ориентира не имеет.
        XCTAssertTrue(usdRows.allSatisfy { $0.usdApproxMin == nil && $0.usdApproxMax == nil })
        XCTAssertTrue(costs.rows.filter { $0.currency == "TRY" }.allSatisfy { $0.usdApproxMin != nil })
        XCTAssertEqual(Set(costs.rows.map(\.academicYear)), ["2026/27", nil])
        XCTAssertEqual(costs.fxRates.map(\.currency), ["TRY"])
    }

    /// Нет опубликованных строк: `costs` null, блока нет (решение владельца
    /// 16.10.2026: нет данных, нет блока).
    func testNullCostsDecodeAndGiveNoCostBlock() throws {
        let (detail, issues) = try parsed { $0["costs"] = NSNull() }
        XCTAssertNil(detail.costs)
        XCTAssertNil(UniversityCostPolicy.plan(detail.costs))
        XCTAssertEqual(issues, [])
    }

    func testCityAndPreparationsMayBeNull() throws {
        let (detail, issues) = try parsed {
            $0["city"] = NSNull()
            $0["preparations"] = NSNull()
            $0["openConsultation"] = NSNull()
        }
        XCTAssertEqual(issues, [])
        XCTAssertNil(detail.city)
        XCTAssertNil(detail.preparations)
        XCTAssertNil(detail.openConsultation)
        XCTAssertEqual(UniversityAtlasPolicy.placeLine(country: detail.country, city: detail.city, kyrgyz: false), "Китай")
    }

    func testRefusesAnotherUniversityAndBrokenPersonalState() throws {
        let data = try AtlasFixtures.data(AtlasFixtures.tongji)
        XCTAssertNoThrow(try DetailUnderTest.decode(data, expectedId: tongjiId))
        XCTAssertThrowsError(try DetailUnderTest.decode(data, expectedId: UUID()))
        try assertRefused { $0["extra"] = true }
        try assertRefused { $0.removeValue(forKey: "costs") }
        try assertRefused { $0.removeValue(forKey: "city") }
        try assertRefused { $0["favored"] = "yes" }
        try assertRefused { $0["country"] = NSNull() }
        try assertRefused { $0.update(["country"]) { $0["code"] = "MY" } }
        try assertRefused { $0.update(["university"]) { $0["status"] = "published" } }
        try assertRefused { $0.update(["university"]) { $0["content"] = NSNull() } }
        try assertRefused { $0.update(["openConsultation"]) { $0["status"] = "handled" } }
        try assertRefused { $0.update(["openConsultation"]) { $0["channel"] = "app" } }
        try assertRefused { $0.update(["preparations"]) { $0.removeValue(forKey: "studentCaseId") } }
    }

    // Review раунда 3 (F12 веба), страница вуза: неверная строка стоимости
    // или курс опускаются по одному, неверный город даёт страницу без
    // города; агентский адрес студенту не доходит никогда.

    func testBrokenCostRowIsOmittedAlone() throws {
        let ids = try rowIds()
        let cases: [(String, Int, String, (inout [String: Any]) -> Void)] = [
            ("an agency row with an address", 1, "source", { $0["source"] = ["kind": "agency", "url": "https://www.eduprchina.com/fees"] }),
            ("an official row without an address", 0, "source", { $0["source"] = ["kind": "official", "url": NSNull()] }),
            ("an official row over http", 0, "source", { $0["source"] = ["kind": "official", "url": "http://www.tongji.edu.cn/fees"] }),
            ("an unknown source kind", 0, "source", { $0["source"] = ["kind": "partner", "url": NSNull()] }),
            ("an agency name on a row", 0, "keys", { $0["sourceName"] = "EDUPRCHINA" }),
            ("a missing key", 0, "keys", { $0.removeValue(forKey: "programId") }),
            ("a maximum not above the minimum", 2, "amount", { $0["amountMaxMinor"] = $0["amountMinMinor"] }),
            ("a fractional amount", 0, "amount", { $0["amountMinMinor"] = 1.5 }),
            ("a negative amount", 0, "amount", { $0["amountMinMinor"] = -1 }),
            ("a lower-case currency", 0, "currency", { $0["currency"] = "cny" }),
            ("an unknown period", 0, "period", { $0["period"] = "decade" }),
            ("an unknown kind", 0, "kind", { $0["kind"] = "visa" }),
            ("an unknown level", 0, "studyLevel", { $0["studyLevel"] = "phd" }),
            ("an exponent out of range", 0, "exponent", { $0["exponent"] = 5 }),
            ("a USD range without an amount range", 0, "usd", { $0["usdApproxMax"] = 3000 }),
            ("a malformed academic year", 0, "academicYear", { $0["academicYear"] = "2026-27" }),
            ("a note with a trailing no-break space", 1, "note", { value in
                var note = value["note"] as! [String: Any]
                note["ru"] = "Двухместная комната\u{00A0}"
                value["note"] = note
            }),
            ("a note in one language", 0, "note", { $0["note"] = ["ru": "Только RU"] }),
            ("a date in another format", 0, "verifiedOn", { $0["verifiedOn"] = "16.10.2026" }),
        ]
        for (label, position, reason, change) in cases {
            let (detail, issues) = try parsed(AtlasFixtures.tongji, changeRow(position, change))
            XCTAssertEqual(detail.university.id, tongjiId, label)
            let rows = try XCTUnwrap(detail.costs?.rows, label)
            XCTAssertEqual(rows.map(\.key), ids.enumerated().filter { $0.offset != position }.map(\.element), label)
            XCTAssertEqual(issues, [CatalogParseIssue(.cost, ids[position], reason)], label)
            XCTAssertFalse(rows.contains { $0.source.url?.absoluteString.lowercased().contains("eduprchina") == true }, label)
        }
    }

    func testCostBlockDisappearsOnlyWithoutRows() throws {
        let ids = try rowIds()
        var (detail, issues) = try parsed { $0.update(["costs"]) { $0["rows"] = [Any]() } }
        XCTAssertNil(detail.costs)
        XCTAssertEqual(issues, [CatalogParseIssue(.costs, nil, "empty")])

        (detail, issues) = try parsed { value in
            value.update(["costs"]) { costs in
                costs["rows"] = (costs["rows"] as! [[String: Any]]).map { row in
                    var row = row
                    row["currency"] = "x"
                    return row
                }
            }
        }
        XCTAssertNil(detail.costs)
        XCTAssertEqual(issues, ids.map { CatalogParseIssue(.cost, $0, "currency") } + [CatalogParseIssue(.costs, nil, "empty")])

        (detail, issues) = try parsed { $0["costs"] = "x" }
        XCTAssertNil(detail.costs)
        XCTAssertEqual(issues, [CatalogParseIssue(.costs, nil, "shape")])

        (detail, issues) = try parsed { $0.update(["costs"]) { $0["currency"] = "CNY" } }
        XCTAssertNil(detail.costs)
        XCTAssertEqual(issues, [CatalogParseIssue(.costs, nil, "shape")])

        (detail, issues) = try parsed { value in
            value.update(["costs"]) { costs in
                var rows = costs["rows"] as! [[String: Any]]
                rows.append(rows[0])
                costs["rows"] = rows
            }
        }
        XCTAssertEqual(detail.costs?.rows.count, 11)
        XCTAssertEqual(issues, [CatalogParseIssue(.cost, ids[0], "duplicate")])
    }

    /// Без названного курса суммы в USD нет: строка остаётся, ориентир снят.
    func testBrokenRateRemovesOnlyTheUsdEstimate() throws {
        let ids = try rowIds()
        var (detail, issues) = try parsed { $0.update(["costs"]) { costs in
            var rates = costs["fxRates"] as! [[String: Any]]
            rates[0]["unitsPerUsd"] = 0
            costs["fxRates"] = rates
        } }
        let costs = try XCTUnwrap(detail.costs)
        XCTAssertEqual(costs.fxRates, [])
        XCTAssertEqual(costs.rows.count, 11)
        XCTAssertTrue(costs.rows.allSatisfy { $0.usdApproxMin == nil && $0.usdApproxMax == nil })
        XCTAssertEqual(issues, [CatalogParseIssue(.fxRate, "CNY", "invalid")] + ids.map { CatalogParseIssue(.cost, $0, "rate") })
        XCTAssertEqual(UniversityCostPolicy.plan(costs)?.showsUsd, false)

        (detail, issues) = try parsed { $0.update(["costs"]) { costs in
            var rates = costs["fxRates"] as! [[String: Any]]
            rates.append(rates[0])
            costs["fxRates"] = rates
        } }
        XCTAssertEqual(detail.costs?.fxRates.count, 1)
        XCTAssertEqual(issues, [CatalogParseIssue(.fxRate, "CNY", "duplicate")])

        // Строка в USD с ориентиром: курса USD нет, ориентир снят.
        let bilkent = try rowIds(AtlasFixtures.bilkent)
        (detail, issues) = try parsed(AtlasFixtures.bilkent, changeRow(0) { $0["usdApproxMin"] = 100 })
        XCTAssertNil(detail.costs?.rows.first?.usdApproxMin)
        XCTAssertEqual(issues, [CatalogParseIssue(.cost, bilkent[0], "rate")])

        // Курс валюты без строк не показывается, но и не ломает блок.
        (detail, issues) = try parsed { $0.update(["costs"]) { costs in
            var rates = costs["fxRates"] as! [[String: Any]]
            rates.append(["currency": "EUR", "unitsPerUsd": 0.9, "asOf": "2026-10-15", "sourceName": "European Central Bank"])
            costs["fxRates"] = rates
        } }
        XCTAssertEqual(issues, [])
        XCTAssertEqual(UniversityCostPolicy.plan(detail.costs)?.rates.map(\.currency), ["CNY"])
    }

    func testBrokenCityOrCountryNameDegradesAlone() throws {
        var (detail, issues) = try parsed { $0.update(["city"]) { $0["country"] = "MY" } }
        XCTAssertNil(detail.city)
        XCTAssertEqual(issues, [CatalogParseIssue(.city, "shanghai", "country")])
        XCTAssertEqual(UniversityAtlasPolicy.placeLine(country: detail.country, city: detail.city, kyrgyz: false), "Китай")

        (detail, issues) = try parsed { $0.update(["city", "photo"]) { $0["author"] = "Di\u{200B}ana" } }
        XCTAssertNil(detail.city)
        XCTAssertEqual(issues, [CatalogParseIssue(.city, "shanghai", "photo")])

        (detail, issues) = try parsed { $0.update(["city"]) { $0["universityCount"] = 3 } }
        XCTAssertNil(detail.city)
        XCTAssertEqual(issues, [CatalogParseIssue(.city, "shanghai", "keys")])

        (detail, issues) = try parsed { $0.update(["country"]) { $0["name"] = NSNull() } }
        XCTAssertEqual(detail.country, AtlasCountryRef(code: "CN", name: LocalizedPair(ru: "Китай", ky: "Кытай")))
        XCTAssertEqual(issues, [CatalogParseIssue(.country, "CN", "name")])
        XCTAssertEqual(detail.costs?.rows.count, 11)

        (detail, issues) = try parsed { $0.update(["country"]) { $0["photo"] = NSNull() } }
        XCTAssertEqual(detail.country.name.ru, "Китай")
        XCTAssertEqual(issues, [CatalogParseIssue(.country, "CN", "name")])
    }

    /// Шаблон веба `/^20\d{2}(?:\/\d{2})?$/`; следующий год проверяет база.
    func testAcademicYearRule() {
        XCTAssertTrue(UniversityCostRow.isAcademicYear("2026/27"))
        XCTAssertTrue(UniversityCostRow.isAcademicYear("2099/00"))
        XCTAssertTrue(UniversityCostRow.isAcademicYear("2026"))
        XCTAssertFalse(UniversityCostRow.isAcademicYear("26/27"))
        XCTAssertFalse(UniversityCostRow.isAcademicYear("2026-27"))
        XCTAssertFalse(UniversityCostRow.isAcademicYear("2026/2"))
        XCTAssertFalse(UniversityCostRow.isAcademicYear("1999"))
    }
}
