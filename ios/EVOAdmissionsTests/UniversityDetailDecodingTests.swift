import XCTest

/// Строгий разбор `student_university_detail_v1` (283, контракт 2.2) на
/// реальных ответах демо-стека.
final class UniversityDetailDecodingTests: XCTestCase {
    private func decode(_ data: Data) throws -> DetailUnderTest {
        try DetailUnderTest.decode(data)
    }

    private func assertRejected(_ name: String = AtlasFixtures.tongji, _ change: (inout [String: Any]) throws -> Void,
                                file: StaticString = #filePath, line: UInt = #line) throws {
        let data = try AtlasFixtures.mutated(name, change)
        XCTAssertThrowsError(try decode(data), file: file, line: line)
    }

    private func costRows(_ value: [String: Any]) -> [[String: Any]] {
        (value["costs"] as! [String: Any])["rows"] as! [[String: Any]]
    }

    private func setCostRows(_ value: inout [String: Any], _ rows: [[String: Any]]) {
        var costs = value["costs"] as! [String: Any]
        costs["rows"] = rows
        value["costs"] = costs
    }

    func testDecodesRealDetailWithOfficialAndAgencyRows() throws {
        let detail = try decode(AtlasFixtures.data(AtlasFixtures.tongji))
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
        let detail = try decode(AtlasFixtures.mutated(AtlasFixtures.tongji) { $0["costs"] = NSNull() })
        XCTAssertNil(detail.costs)
        XCTAssertNil(UniversityCostPolicy.plan(detail.costs))
    }

    func testCityAndPreparationsMayBeNull() throws {
        let detail = try decode(AtlasFixtures.mutated(AtlasFixtures.tongji) {
            $0["city"] = NSNull()
            $0["preparations"] = NSNull()
            $0["openConsultation"] = NSNull()
        })
        XCTAssertNil(detail.city)
        XCTAssertNil(detail.preparations)
        XCTAssertNil(detail.openConsultation)
        XCTAssertEqual(UniversityAtlasPolicy.placeLine(country: detail.country, city: detail.city, kyrgyz: false), "Китай")
    }

    func testRejectsContractDrift() throws {
        try assertRejected { $0["extra"] = true }
        try assertRejected { $0.removeValue(forKey: "costs") }
        try assertRejected { $0.update(["university"]) { $0["status"] = "published" } }
        try assertRejected { $0.update(["country"]) { $0["photo"] = NSNull() } }
        try assertRejected { $0.update(["city"]) { $0["universityCount"] = 3 } }
        try assertRejected { $0.update(["openConsultation"]) { $0["status"] = "handled" } }
        try assertRejected { $0.update(["openConsultation"]) { $0["channel"] = "app" } }
        try assertRejected { $0.update(["preparations"]) { $0.removeValue(forKey: "studentCaseId") } }
        try assertRejected { $0.update(["costs"]) { $0["currency"] = "CNY" } }
    }

    func testRejectsCityOrCardOfAnotherCountry() throws {
        try assertRejected { $0.update(["city"]) { $0["country"] = "MY" } }
        try assertRejected { $0.update(["country"]) { $0["code"] = "MY" } }
    }

    /// `costs` не null означает «есть строки»; пустой массив это ошибка.
    func testRejectsEmptyCostRows() throws {
        try assertRejected { value in self.setCostRows(&value, []) }
    }

    func testRejectsAgencyRowsWithAnAddressAndOfficialRowsWithout() throws {
        try assertRejected { value in
            var rows = self.costRows(value)
            let agency = rows.firstIndex { ($0["source"] as! [String: Any])["kind"] as? String == "agency" }!
            rows[agency]["source"] = ["kind": "agency", "url": "https://www.eduprchina.com/fees"]
            self.setCostRows(&value, rows)
        }
        try assertRejected { value in
            var rows = self.costRows(value)
            let official = rows.firstIndex { ($0["source"] as! [String: Any])["kind"] as? String == "official" }!
            rows[official]["source"] = ["kind": "official", "url": NSNull()]
            self.setCostRows(&value, rows)
        }
        try assertRejected { value in
            var rows = self.costRows(value)
            rows[0]["source"] = ["kind": "partner", "url": NSNull()]
            self.setCostRows(&value, rows)
        }
    }

    func testRejectsRowValuesOutsideTheDomain() throws {
        let changes: [(inout [String: Any]) -> Void] = [
            { $0["kind"] = "visa" },
            { $0["period"] = "quarter" },
            { $0["studyLevel"] = "phd" },
            { $0["currency"] = "yuan" },
            { $0["exponent"] = 5 },
            { $0["amountMinMinor"] = -1 },
            { $0["amountMaxMinor"] = $0["amountMinMinor"] },
            { $0["academicYear"] = "2026/28" },
            { $0["verifiedOn"] = "16.10.2026" },
            { $0["note"] = ["ru": "Только RU"] },
            { $0["comment"] = "x" },
            { $0.removeValue(forKey: "programId") },
        ]
        for change in changes {
            try assertRejected { value in
                var rows = self.costRows(value)
                change(&rows[0])
                self.setCostRows(&value, rows)
            }
        }
    }

    /// Ориентир в USD только по курсу и не у строки в USD.
    func testRejectsInconsistentUsdEstimates() throws {
        try assertRejected(AtlasFixtures.bilkent) { value in
            var rows = self.costRows(value)
            let usd = rows.firstIndex { $0["currency"] as? String == "USD" }!
            rows[usd]["usdApproxMin"] = 100
            self.setCostRows(&value, rows)
        }
        try assertRejected(AtlasFixtures.bilkent) { value in
            var rows = self.costRows(value)
            let lira = rows.firstIndex { $0["currency"] as? String == "TRY" }!
            rows[lira]["usdApproxMin"] = NSNull()
            self.setCostRows(&value, rows)
        }
        // Курс валюты без строк.
        try assertRejected { $0.update(["costs"]) { costs in
            var rates = costs["fxRates"] as! [[String: Any]]
            rates.append(["currency": "EUR", "unitsPerUsd": 0.9, "asOf": "2026-10-15", "sourceName": "ECB"])
            costs["fxRates"] = rates
        } }
        try assertRejected { $0.update(["costs"]) { costs in
            var rates = costs["fxRates"] as! [[String: Any]]
            rates[0]["unitsPerUsd"] = 0
            costs["fxRates"] = rates
        } }
    }

    func testAcademicYearRule() {
        XCTAssertTrue(UniversityCostRow.isAcademicYear("2026/27"))
        XCTAssertTrue(UniversityCostRow.isAcademicYear("2099/00"))
        XCTAssertTrue(UniversityCostRow.isAcademicYear("2026"))
        XCTAssertFalse(UniversityCostRow.isAcademicYear("2026/28"))
        XCTAssertFalse(UniversityCostRow.isAcademicYear("26/27"))
        XCTAssertFalse(UniversityCostRow.isAcademicYear("2026-27"))
    }
}
