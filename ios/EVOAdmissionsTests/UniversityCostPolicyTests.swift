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
        // Виды в порядке продукта: обучение, общежитие, сбор.
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

    /// Пять значащих цифр, как `formatUnitsPerUsd` веба. Ожидаемые строки
    /// получены `Intl.NumberFormat("ru", { maximumSignificantDigits: 5 })`.
    func testRateShowsFiveSignificantDigitsLikeTheWeb() {
        XCTAssertEqual(UniversityCostPolicy.rate(6.6910242684, locale: ru), "6,691")
        XCTAssertEqual(UniversityCostPolicy.rate(49.4176481085, locale: ru), "49,418")
        XCTAssertEqual(UniversityCostPolicy.rate(3.6725, locale: ru), "3,6725")
        XCTAssertEqual(UniversityCostPolicy.rate(21.7282, locale: ru), "21,728")
        XCTAssertEqual(UniversityCostPolicy.rate(0.8922154, locale: ru), "0,89222")
        XCTAssertEqual(UniversityCostPolicy.rate(4, locale: ru), "4")
        XCTAssertEqual(digits(UniversityCostPolicy.rate(1234.5678, locale: ru)), "1234,6")
    }

    /// Учебные годы новые первыми, курс только валют строк и не USD, адреса
    /// только официальных строк (`summarizeCosts` веба).
    func testSummaryLikeTheWeb() throws {
        let data = try AtlasFixtures.mutated(AtlasFixtures.bilkent) { value in
            value.update(["costs", "rows", 1]) { $0["academicYear"] = "2025/26" }
            value.update(["costs", "rows", 2]) { $0["academicYear"] = "2027" }
        }
        let plan = try XCTUnwrap(UniversityCostPolicy.plan(DetailUnderTest.decode(data).costs))
        XCTAssertEqual(plan.academicYears, ["2027", "2026/27", "2025/26"])
        XCTAssertEqual(plan.rates.map(\.currency), ["TRY"])
    }

    /// Виды в порядке продукта, внутри вида строка без уровня первой, затем
    /// уровни, программа, язык, период и сумма (`groupCostRows` веба), даже
    /// если сервер отдал строки в другом порядке.
    func testRowsAreGroupedAndOrderedLikeTheWeb() throws {
        let data = try AtlasFixtures.mutated(AtlasFixtures.tongji) { value in
            var costs = value["costs"] as! [String: Any]
            costs["rows"] = Array((costs["rows"] as! [[String: Any]]).reversed())
            value["costs"] = costs
        }
        let shuffled = try XCTUnwrap(UniversityCostPolicy.plan(DetailUnderTest.decode(data).costs))
        let original = try XCTUnwrap(UniversityCostPolicy.plan(costs(AtlasFixtures.tongji)))
        XCTAssertEqual(shuffled.groups.map(\.kind), [.tuition, .applicationFee, .insurance])
        XCTAssertEqual(shuffled.groups[0].rows.map(\.studyLevel), [
            "language", "foundation", "foundation", "bachelor", "bachelor", "master", "master", "doctorate", "doctorate",
        ])
        XCTAssertEqual(shuffled.groups[0].rows.map(\.amountMinMinor), original.groups[0].rows.map(\.amountMinMinor))
    }

    private let texts = UniversityCostPolicy.Texts(
        level: { "level:\($0)" },
        language: { "lang:\($0)" },
        kind: { "kind:\($0.rawValue)" }
    )

    /// Подпись строки как `rowLabel` в `CostTable.tsx`: у обучения уровень
    /// (или программа) и язык, пояснение в уточнениях через « · »; у
    /// других видов первая часть пояснения это подпись.
    func testRowLabelsLikeTheWeb() throws {
        let tongji = try costs(AtlasFixtures.tongji)
        let bachelor = try XCTUnwrap(tongji.rows.first { $0.studyLevel == "bachelor" })
        XCTAssertEqual(UniversityCostPolicy.rowLabel(bachelor, programTitles: [:], kyrgyz: false, texts: texts),
                       .init(label: "level:bachelor", details: "Обучение на китайском языке · Сумма зависит от программы"))
        XCTAssertEqual(UniversityCostPolicy.rowLabel(bachelor, programTitles: [:], kyrgyz: true, texts: texts).details,
                       "Окутуу кытай тилинде · Сумма программага жараша")

        let bilkent = try costs(AtlasFixtures.bilkent)
        let room = try XCTUnwrap(bilkent.rows.first { $0.amountMaxMinor != nil && $0.kind == .accommodation })
        XCTAssertEqual(UniversityCostPolicy.rowLabel(room, programTitles: [:], kyrgyz: false, texts: texts),
                       .init(label: "Двухместная комната", details: "Цена зависит от типа комнаты и корпуса"))
        let single = try XCTUnwrap(bilkent.rows.first { $0.note?.ru == "Одноместная комната" })
        XCTAssertEqual(UniversityCostPolicy.rowLabel(single, programTitles: [:], kyrgyz: false, texts: texts),
                       .init(label: "Одноместная комната", details: nil))

        // Программа строки и язык обучения; строка без пояснения.
        let data = try AtlasFixtures.mutated(AtlasFixtures.bilkent) { value in
            value.update(["costs", "rows", 0]) {
                $0["programId"] = "computer-engineering"
                $0["teachingLanguage"] = "en"
            }
            value.update(["costs", "rows", 5]) { $0["note"] = NSNull() }
        }
        let mutated = try XCTUnwrap(DetailUnderTest.decode(data).costs)
        XCTAssertEqual(UniversityCostPolicy.rowLabel(mutated.rows[0], programTitles: ["computer-engineering": "Computer Engineering"],
                                                     kyrgyz: false, texts: texts),
                       .init(label: "Computer Engineering, lang:en", details: nil))
        XCTAssertEqual(UniversityCostPolicy.rowLabel(mutated.rows[0], programTitles: [:], kyrgyz: false, texts: texts).label,
                       "level:bachelor, lang:en")
        XCTAssertEqual(UniversityCostPolicy.rowLabel(mutated.rows[5], programTitles: [:], kyrgyz: false, texts: texts),
                       .init(label: "kind:application_fee", details: nil))
    }

    func testSplitNote() {
        XCTAssertEqual(UniversityCostPolicy.splitNote("Двухместная комната; Цена за одного человека"),
                       ["Двухместная комната", "Цена за одного человека"])
        XCTAssertEqual(UniversityCostPolicy.splitNote("Одно;;  два ;"), ["Одно", "два"])
    }

    /// «16 октября 2026 г.» с неразрывным пробелом перед «г.»; в конце
    /// предложения одна точка.
    func testDatesLikeTheWeb() {
        XCTAssertEqual(UniversityCostPolicy.dateLabel("2026-10-16", locale: ru), "16 октября 2026\u{00A0}г.")
        XCTAssertEqual(UniversityCostPolicy.sentenceEnd("проверено 16 октября 2026\u{00A0}г.."), "проверено 16 октября 2026\u{00A0}г.")
        XCTAssertEqual(UniversityCostPolicy.sentenceEnd("Источник: сайт."), "Источник: сайт.")
        XCTAssertEqual(UniversityCostPolicy.dateLabel("not-a-day", locale: ru), "not-a-day")
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
