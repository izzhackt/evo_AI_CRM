import XCTest

/// Правила блока «Стоимость» (план 4.5, решения владельца 16.10.2026) на
/// реальных ответах демо-стека.
final class UniversityCostPolicyTests: XCTestCase {
    private let ru = Locale(identifier: "ru")

    private func costs(_ name: String) throws -> UniversityCosts {
        try XCTUnwrap(DetailUnderTest.decode(AtlasFixtures.data(name)).costs)
    }

    private func digits(_ value: String) -> String {
        value.filter { !$0.isWhitespace && $0 != "\u{00A0}" && $0 != "\u{202F}" }
    }

    func testNoPublishedRowsMeansNoBlock() {
        XCTAssertNil(UniversityCostPolicy.plan(nil))
    }

    func testPlanForUsdAndLiraRows() throws {
        let plan = try XCTUnwrap(UniversityCostPolicy.plan(costs(AtlasFixtures.bilkent)))
        // Виды подряд в порядке сервера: обучение, общежитие, сбор.
        XCTAssertEqual(plan.groups.map(\.kind), [.tuition, .accommodation, .applicationFee])
        XCTAssertEqual(plan.groups.map(\.rows.count), [1, 4, 1])
        // Хотя бы у одной строки есть ориентир: колонка USD есть.
        XCTAssertTrue(plan.showsUsd)
        // Год есть только у строки обучения; строки без года в перечне нет.
        XCTAssertEqual(plan.academicYears, ["2026/27"])
        XCTAssertEqual(plan.sourceKinds, [.official])
        XCTAssertEqual(plan.rates.map(\.currency), ["TRY"])
        XCTAssertEqual(plan.latestVerifiedOn, "2026-10-16")
        XCTAssertFalse(plan.officialSources.isEmpty)
        XCTAssertEqual(Set(plan.officialSources).count, plan.officialSources.count)
    }

    func testPlanForOfficialAndAgencyRowsWithoutYears() throws {
        let plan = try XCTUnwrap(UniversityCostPolicy.plan(costs(AtlasFixtures.tongji)))
        XCTAssertEqual(plan.groups.map(\.kind), [.tuition, .applicationFee, .insurance])
        XCTAssertTrue(plan.academicYears.isEmpty)
        // Оба вида источника называются; порядок постоянный.
        XCTAssertEqual(plan.sourceKinds, [.official, .agency])
        XCTAssertEqual(plan.rates.map(\.currency), ["CNY"])
    }

    func testUsdColumnHiddenWhenNoRowHasAnEstimate() throws {
        let data = try AtlasFixtures.mutated(AtlasFixtures.bilkent) { value in
            var costs = value["costs"] as! [String: Any]
            costs["rows"] = (costs["rows"] as! [[String: Any]]).filter { $0["currency"] as? String == "USD" }
            costs["fxRates"] = []
            value["costs"] = costs
        }
        let plan = try XCTUnwrap(UniversityCostPolicy.plan(DetailUnderTest.decode(data).costs))
        XCTAssertFalse(plan.showsUsd)
        XCTAssertTrue(plan.rates.isEmpty)
    }

    func testAmountsUseMinorUnitsAndTheInterfaceLocale() {
        XCTAssertEqual(digits(UniversityCostPolicy.amount(minor: 2_500_000, exponent: 2, locale: ru)), "25000")
        XCTAssertEqual(digits(UniversityCostPolicy.amount(minor: 123_450, exponent: 2, locale: ru)), "1234,50")
        XCTAssertEqual(digits(UniversityCostPolicy.amount(minor: 0, exponent: 2, locale: ru)), "0")
        XCTAssertEqual(digits(UniversityCostPolicy.amount(minor: 1500, exponent: 0, locale: ru)), "1500")
        XCTAssertEqual(digits(UniversityCostPolicy.amount(minor: 2_500_000, exponent: 2, locale: Locale(identifier: "en_US"))), "25,000")
        XCTAssertEqual(digits(UniversityCostPolicy.whole(3510, locale: ru)), "3510")
    }

    func testRateShowsUpToFourDecimals() {
        XCTAssertEqual(UniversityCostPolicy.rate(6.6910242684, locale: ru), "6,691")
        XCTAssertEqual(UniversityCostPolicy.rate(3.6725, locale: ru), "3,6725")
        XCTAssertEqual(digits(UniversityCostPolicy.rate(49.4176481085, locale: ru)), "49,4176")
    }

    func testRateSourceShortNames() {
        XCTAssertEqual(UniversityCostPolicy.rateSource("European Central Bank, euro foreign exchange reference rates"), .europeanCentralBank)
        XCTAssertEqual(UniversityCostPolicy.rateSource("Central Bank of the UAE: dirham fixed peg"), .centralBankUAE)
        XCTAssertEqual(UniversityCostPolicy.rateSource("Национальный банк"), .verbatim("Национальный банк"))
    }

    // MARK: - Исходный код и словари

    private var iosRoot: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    }

    private func catalog() throws -> [String: Any] {
        let url = iosRoot.appendingPathComponent("EVOAdmissions/Resources/Localizable.xcstrings")
        guard let data = try? Data(contentsOf: url) else {
            throw XCTSkip("String Catalog is not readable from this test host")
        }
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap(root["strings"] as? [String: Any])
    }

    private func appSources() throws -> [(URL, String)] {
        let directory = iosRoot.appendingPathComponent("EVOAdmissions")
        guard let enumerator = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil) else {
            throw XCTSkip("App sources are not readable from this test host")
        }
        var files: [(URL, String)] = []
        for case let url as URL in enumerator where url.pathExtension == "swift" {
            files.append((url, try String(contentsOf: url, encoding: .utf8)))
        }
        XCTAssertFalse(files.isEmpty)
        return files
    }

    /// Фразы о том, что стоимость уточнит куратор, нет ни в словаре, ни в
    /// коде приложения (план 4.5, приёмка 7.6, п. 4). Фраза собирается из
    /// частей, чтобы поиск по репозиторию не находил сам тест.
    func testCuratorCostPhraseIsAbsentFromCatalogAndSources() throws {
        let phrase = ["стоимость", "уточняет", "куратор"].joined(separator: " ")
        _ = try catalog()
        let catalogText = try String(contentsOf: iosRoot.appendingPathComponent("EVOAdmissions/Resources/Localizable.xcstrings"), encoding: .utf8)
        XCTAssertFalse(catalogText.lowercased().contains(phrase))
        for (url, text) in try appSources() {
            XCTAssertFalse(text.lowercased().contains(phrase), url.lastPathComponent)
        }
    }

    /// Файлы экранов университетов v2.
    private static let atlasViews: Set<String> = [
        "AtlasComponents.swift", "UniversityAtlasView.swift", "CountryAtlasView.swift",
        "CityAtlasView.swift", "CountryAtlasMap.swift", "UniversityCostSection.swift",
    ]

    /// Каждый ключ `catalog_…` экранов v2 есть в словаре на русском и
    /// кыргызском; основа числительного имеет все три формы.
    func testCatalogKeysHaveRussianAndKyrgyz() throws {
        let strings = try catalog()
        var used = Set<String>()
        let views = try appSources().filter { Self.atlasViews.contains($0.0.lastPathComponent) }
        XCTAssertEqual(views.count, Self.atlasViews.count)
        for (_, text) in views {
            let pattern = try NSRegularExpression(pattern: "\"(catalog_[a-z0-9_]+)\"")
            for match in pattern.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                if let range = Range(match.range(at: 1), in: text) { used.insert(String(text[range])) }
            }
        }
        XCTAssertFalse(used.isEmpty)
        for key in used.sorted() {
            let keys = strings[key] == nil && key.hasPrefix("catalog_count_")
                ? ["\(key)_one", "\(key)_few", "\(key)_many"]
                : [key]
            for key in keys {
                let entry = try XCTUnwrap(strings[key] as? [String: Any], "Missing \(key)")
                let localizations = try XCTUnwrap(entry["localizations"] as? [String: Any], key)
                for language in ["ru", "ky"] {
                    let unit = (localizations[language] as? [String: Any])?["stringUnit"] as? [String: Any]
                    let value = try XCTUnwrap(unit?["value"] as? String, "\(key) has no \(language)")
                    XCTAssertFalse(value.isEmpty, "\(key) \(language)")
                    // Правило текстов EVO: без длинного и среднего тире.
                    XCTAssertFalse(value.contains("\u{2014}") || value.contains("\u{2013}"), "\(key) \(language)")
                }
            }
        }
    }
}
