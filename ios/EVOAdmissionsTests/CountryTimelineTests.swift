import CryptoKit
import XCTest

/// «Путь поступления» (S4, план §8; контракт docs/portal/country-timeline-contract.md).
/// Тесты читают настоящие файлы bundle (те же семь, что у веба) и сравнивают
/// выдачу Swift с выдачей веба по отпечаткам из
/// scripts/portal/write-country-timeline-ios-parity.mjs.
final class CountryTimelineTests: XCTestCase {
    private static let bundle = Bundle(for: CountryTimelineTests.self)
    private static let library = CountryTimelineLibrary.load(from: bundle)
    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    private static let choices = StudentCountryChoice.countryCodes + [CountryTimelineRules.undecided]
    private static let before = "2026-10-16"
    private static let after = "2027-11-01"

    private func rawFile(_ key: String) throws -> Data {
        try XCTUnwrap(Self.bundle.url(forResource: key, withExtension: "json").flatMap { try? Data(contentsOf: $0) },
                      "\(key).json is missing from the test bundle")
    }

    private func parse(_ key: String, _ data: Data) throws -> CountryTimelineFile {
        try CountryTimelineParser(key: key, countryName: { StudyCountries.name(for: $0, kyrgyz: $1) }).parse(data)
    }

    // MARK: Файлы

    func testEveryBundledFileParsesStrictly() throws {
        XCTAssertEqual(Self.library.failures, [:])
        XCTAssertEqual(CountryTimelineKeys.countries, ["cn", "my", "ae", "tr", "it", "cz"])
        XCTAssertEqual(Set(Self.library.files.keys), Set(CountryTimelineKeys.all))
        let expected: [String: (TimelineStatus, Int)] = [
            "cn": (.approved, 8), "my": (.approved, 7), "ae": (.ownerReview, 6), "tr": (.ownerReview, 6),
            "it": (.ownerReview, 8), "cz": (.ownerReview, 6), "undecided": (.approved, 7),
        ]
        for (key, (status, steps)) in expected {
            let file = try XCTUnwrap(Self.library.files[key], key)
            XCTAssertEqual(file.status, status, key)
            XCTAssertEqual(file.steps.count, steps, key)
            XCTAssertEqual(file.country, key == "undecided" ? "UNDECIDED" : key.uppercased())
            XCTAssertGreaterThanOrEqual(file.contentVersion, 1)
            if key != "undecided" {
                XCTAssertEqual(file.name.ru, StudyCountries.name(for: file.country, kyrgyz: false))
                XCTAssertEqual(file.name.ky, StudyCountries.name(for: file.country, kyrgyz: true))
            }
        }
    }

    /// Bundle содержит ровно файлы репозитория (src/content/timelines), не копии.
    func testBundledFilesAreTheRepositoryFiles() throws {
        for key in CountryTimelineKeys.all {
            let repo = try Data(contentsOf: Self.repoRoot.appendingPathComponent("src/content/timelines/\(key).json"))
            XCTAssertEqual(try rawFile(key), repo, "\(key).json in the bundle differs from the repository file")
        }
    }

    // MARK: Паритет с вебом

    private struct ParityFixture: Decodable {
        struct File: Decodable {
            let contentVersion: Int
            let validUntil: String
            let sha256: String
        }

        struct Case: Decodable {
            let choice: String
            let locale: String
            let today: String
            let modules: [String: String]?
            let kind: String
            let file: String
            let datesHidden: Bool
            let steps: Int
            let items: Int
            let sha256: String
        }

        let files: [String: File]
        let cases: [Case]
    }

    private static func hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Тот же порядок полей, что `canonicalTimelineView` в
    /// scripts/portal/write-country-timeline-ios-parity.mjs.
    static func canonical(_ view: CountryTimelineView) -> String {
        let null = "\u{0}"
        func n(_ value: String?) -> String { value ?? null }
        func flag(_ value: Bool) -> String { value ? "1" : "0" }
        var fields = [view.choice, view.kind.rawValue, n(view.countryCode), n(view.countryName), view.file,
                      String(view.contentVersion), flag(view.datesHidden), view.intakeLabel, n(view.intakeNote),
                      String(view.steps.count)]
        for step in view.steps {
            fields += [step.id, String(step.order), step.stageKeys.joined(separator: ","), step.title, step.summary,
                       n(step.timing), n(step.note), step.doneWhen, String(step.items.count)]
            for item in step.items {
                fields += [item.id, item.who.rawValue, item.whoLabel, item.text, n(item.note), n(item.appliesTo)]
            }
            fields.append(String(step.links.count))
            for link in step.links { fields += [link.id, link.label, link.href, flag(link.external)] }
        }
        fields += view.disclaimers
        fields.append(flag(view.kyNeedsProofreading))
        return fields.joined(separator: "\u{1F}")
    }

    func testSelectionMatchesTheWebSelection() throws {
        let url = try XCTUnwrap(Self.bundle.url(forResource: "country-timeline-parity", withExtension: "json"))
        let fixture = try JSONDecoder().decode(ParityFixture.self, from: Data(contentsOf: url))
        // Фикстура привязана к байтам файлов: любая правка контента без
        // перезапуска скрипта видна здесь и в node-тесте (`--check`).
        XCTAssertEqual(Set(fixture.files.keys), Set(CountryTimelineKeys.all))
        for (key, file) in fixture.files {
            XCTAssertEqual(Self.hex(try rawFile(key)), file.sha256,
                           "\(key).json changed: run scripts/portal/write-country-timeline-ios-parity.mjs")
            XCTAssertEqual(Self.library.files[key]?.contentVersion, file.contentVersion, key)
            XCTAssertEqual(Self.library.files[key]?.validUntil, file.validUntil, key)
        }
        // 7 выборов × RU/KY × (до validUntil, сам validUntil, день после) + Китай с модулем CSCA.
        XCTAssertEqual(fixture.cases.count, 44)
        XCTAssertTrue(fixture.cases.contains { $0.today == "2027-10-31" && $0.file == "cn" && !$0.datesHidden })
        for entry in fixture.cases {
            let label = "\(entry.choice) \(entry.locale) \(entry.today) \(entry.modules ?? [:])"
            let view = try XCTUnwrap(Self.library.select(choice: entry.choice, kyrgyz: entry.locale == "ky",
                                                         today: entry.today, modules: entry.modules ?? [:]), label)
            XCTAssertEqual(view.kind.rawValue, entry.kind, label)
            XCTAssertEqual(view.file, entry.file, label)
            XCTAssertEqual(view.datesHidden, entry.datesHidden, label)
            XCTAssertEqual(view.steps.count, entry.steps, label)
            XCTAssertEqual(view.steps.reduce(0) { $0 + $1.items.count }, entry.items, label)
            XCTAssertEqual(Self.hex(Data(Self.canonical(view).utf8)), entry.sha256, "\(label): iPhone shows something other than the web")
        }
    }

    // MARK: Правила выбора

    private func allViews() -> [(label: String, view: CountryTimelineView)] {
        Self.choices.flatMap { choice in
            [false, true].flatMap { kyrgyz in
                [Self.before, Self.after].compactMap { today in
                    Self.library.select(choice: choice, kyrgyz: kyrgyz, today: today).map { ("\(choice) \(kyrgyz) \(today)", $0) }
                }
            }
        }
    }

    private func strings(_ view: CountryTimelineView) -> [String] {
        var all = [view.countryName ?? "", view.intakeLabel, view.intakeNote ?? ""] + view.disclaimers
        for step in view.steps {
            all += [step.title, step.summary, step.timing ?? "", step.note ?? "", step.doneWhen] + step.links.map(\.label)
            for item in step.items { all += [item.whoLabel, item.text, item.note ?? "", item.appliesTo ?? ""] }
        }
        return all.filter { !$0.isEmpty }
    }

    func testUnknownChoiceShowsTheCountryPicker() {
        for choice in [nil, "", "undecided", "cn", "PL", "Китай", " CN"] as [String?] {
            XCTAssertNil(Self.library.select(choice: choice, kyrgyz: false, today: Self.before), String(describing: choice))
        }
        XCTAssertNil(Self.library.select(choice: "CN", kyrgyz: false, today: "16.10.2026"))
    }

    func testOnlyApprovedCountriesShowTheirOwnTimeline() throws {
        let china = try XCTUnwrap(Self.library.select(choice: "CN", kyrgyz: false, today: Self.before))
        XCTAssertEqual(china.kind, .country)
        XCTAssertEqual(china.file, "cn")
        XCTAssertEqual(china.countryName, "Китай")
        let malaysia = try XCTUnwrap(Self.library.select(choice: "MY", kyrgyz: true, today: Self.before))
        XCTAssertEqual(malaysia.kind, .country)
        XCTAssertEqual(malaysia.countryName, "Малайзия")
        for code in ["AE", "TR", "IT", "CZ"] {
            let view = try XCTUnwrap(Self.library.select(choice: code, kyrgyz: false, today: Self.before))
            XCTAssertEqual(view.kind, .general, code)
            XCTAssertEqual(view.file, "undecided", code)
            XCTAssertEqual(view.countryCode, code)
            XCTAssertEqual(view.countryName, StudyCountries.name(for: code, kyrgyz: false))
            XCTAssertTrue(view.steps.allSatisfy { $0.timing == nil }, "\(code): the general route has no dates")
        }
        XCTAssertEqual(Self.library.select(choice: "IT", kyrgyz: false, today: Self.before)?.countryName, "Италия")
        let undecided = try XCTUnwrap(Self.library.select(choice: "UNDECIDED", kyrgyz: false, today: Self.before))
        XCTAssertEqual(undecided.kind, .general)
        XCTAssertNil(undecided.countryCode)
        XCTAssertNil(undecided.countryName)
        XCTAssertEqual(undecided.steps.map(\.stageKeys), CountryTimelineRules.stageKeys.map { [$0] })
    }

    func testVerifyItemsAreNeverShown() throws {
        let verify = Set(Self.library.files.values.flatMap(\.steps).flatMap(\.checklist).filter { $0.status == .verify }.map(\.id))
        XCTAssertEqual(verify, ["my-6-01", "ae-2-01"])
        for (label, view) in allViews() {
            let shown = Set(view.steps.flatMap(\.items).map(\.id))
            XCTAssertTrue(shown.isDisjoint(with: verify), label)
        }
    }

    func testThreeDisclaimersInEveryView() {
        for (label, view) in allViews() {
            XCTAssertEqual(view.disclaimers.count, 3, label)
            let kyrgyz = label.contains("true")
            let markers = [CountryTimelineRules.disclaimerTiming, CountryTimelineRules.disclaimerDocuments, CountryTimelineRules.disclaimerDecisions]
            for (text, marker) in zip(view.disclaimers, markers) {
                XCTAssertTrue(CountryTimelineRules.matches(kyrgyz ? marker.ky : marker.ru, text), "\(label): \(text)")
            }
        }
    }

    func testNoPromisesInternalDetailsOrDashesInAnyView() {
        for (label, view) in allViews() {
            for text in strings(view) {
                let withoutNegation = CountryTimelineRules.decisionsNegation.stringByReplacingMatches(
                    in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
                for regex in CountryTimelineRules.forbiddenPromises {
                    XCTAssertFalse(CountryTimelineRules.matches(regex, withoutNegation), "\(label): \(text)")
                }
                for regex in CountryTimelineRules.internalMarkers {
                    XCTAssertFalse(CountryTimelineRules.matches(regex, text), "\(label): \(text)")
                }
                XCTAssertFalse(CountryTimelineRules.matches(CountryTimelineRules.dashes, text), "\(label): \(text)")
            }
        }
    }

    /// Даты сессий CSCA живут только в модуле CSCA, не в шаге экзаменов.
    func testNoCSCASessionDatesInTheExamsStep() throws {
        let china = try XCTUnwrap(Self.library.select(choice: "CN", kyrgyz: false, today: Self.before))
        let exams = try XCTUnwrap(china.steps.first { $0.id == "cn-2-exams" })
        let dayMonth = CountryTimelineRules.pattern(
            #"[0-9]{1,2}(\s+и\s+[0-9]{1,2})?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)"#)
        for text in [exams.title, exams.summary] + exams.items.flatMap({ [$0.text, $0.note ?? ""] }) {
            XCTAssertFalse(CountryTimelineRules.matches(dayMonth, text), text)
        }
    }

    func testDatesDisappearAfterValidUntil() throws {
        let current = try XCTUnwrap(Self.library.select(choice: "CN", kyrgyz: false, today: Self.before))
        XCTAssertFalse(current.datesHidden)
        XCTAssertTrue(strings(current).contains(where: CountryTimelineRules.hasAbsoluteDate))
        XCTAssertEqual(Self.library.select(choice: "CN", kyrgyz: false, today: "2027-10-31")?.datesHidden, false)
        for (label, view) in allViews() where label.hasSuffix(Self.after) {
            XCTAssertTrue(view.datesHidden, label)
            XCTAssertTrue(view.steps.allSatisfy { !$0.items.isEmpty }, "\(label): a step lost all its items")
            for text in strings(view) { XCTAssertFalse(CountryTimelineRules.hasAbsoluteDate(text), "\(label): \(text)") }
        }
    }

    func testCSCALinkOpensTheModuleOrCscaCn() throws {
        let external = try XCTUnwrap(Self.library.select(choice: "CN", kyrgyz: false, today: Self.before))
        let exams = try XCTUnwrap(external.steps.first { $0.id == "cn-2-exams" })
        XCTAssertEqual(exams.links.map(\.href), ["https://csca.cn"])
        XCTAssertEqual(exams.links.map(\.external), [true])
        let internalView = try XCTUnwrap(Self.library.select(choice: "CN", kyrgyz: false, today: Self.before, modules: ["csca": "evo-app://csca"]))
        let module = try XCTUnwrap(internalView.steps.first { $0.id == "cn-2-exams" }?.links.first)
        XCTAssertEqual(module.href, "evo-app://csca")
        XCTAssertFalse(module.external)
    }

    func testWhoLabelsFollowTheLanguage() throws {
        let ru = try XCTUnwrap(Self.library.select(choice: "CN", kyrgyz: false, today: Self.before))
        let ky = try XCTUnwrap(Self.library.select(choice: "CN", kyrgyz: true, today: Self.before))
        XCTAssertEqual(Set(ru.steps.flatMap(\.items).map(\.whoLabel)).subtracting(["Студент", "EVO", "Вуз", "Посольство"]), [])
        XCTAssertEqual(Set(ky.steps.flatMap(\.items).map(\.whoLabel)).subtracting(["Студент", "EVO", "Университет", "Элчилик"]), [])
        XCTAssertNotEqual(ru.steps[0].title, ky.steps[0].title)
        XCTAssertTrue(ky.kyNeedsProofreading)
    }

    // MARK: Отказ и запасной путь

    func testABrokenCountryFileFallsBackToTheGeneralRoute() throws {
        var files = Self.library.files
        files["cn"] = nil
        let degraded = CountryTimelineLibrary(files: files, failures: ["cn": "test"])
        let view = try XCTUnwrap(degraded.select(choice: "CN", kyrgyz: false, today: Self.before))
        XCTAssertEqual(view.kind, .general)
        XCTAssertEqual(view.countryName, "Китай")
        files["undecided"] = nil
        XCTAssertNil(CountryTimelineLibrary(files: files, failures: [:]).select(choice: "IT", kyrgyz: false, today: Self.before))
    }

    private typealias Mutation = (inout [String: Any]) -> Void

    private func step(_ root: inout [String: Any], _ index: Int, _ change: (inout [String: Any]) -> Void) {
        var steps = root["steps"] as! [[String: Any]]
        change(&steps[index])
        root["steps"] = steps
    }

    private func item(_ root: inout [String: Any], _ stepIndex: Int, _ itemIndex: Int, _ change: @escaping (inout [String: Any]) -> Void) {
        step(&root, stepIndex) { step in
            var items = step["checklist"] as! [[String: Any]]
            change(&items[itemIndex])
            step["checklist"] = items
        }
    }

    func testParserRejectsBrokenContent() throws {
        let original = try XCTUnwrap(JSONSerialization.jsonObject(with: rawFile("cn")) as? [String: Any])
        let cases: [(String, Mutation)] = [
            ("unknown root key", { $0["extra"] = true }),
            ("missing disclaimers", { $0["disclaimers"] = nil }),
            ("wrong schema", { $0["schemaVersion"] = 2 }),
            ("country", { $0["country"] = "MY" }),
            ("name", { $0["name"] = ["ru": "КНР", "ky": "Кытай"] }),
            ("status", { $0["status"] = "published" }),
            ("validUntil", { $0["validUntil"] = "2026-02-30" }),
            ("disclaimer marker", { root in
                var d = root["disclaimers"] as! [String: Any]
                d["timing"] = ["ru": "Сроки точные.", "ky": "Мөөнөттөр болжолдуу."]
                root["disclaimers"] = d
            }),
            ("too few steps", { root in root["steps"] = Array((root["steps"] as! [[String: Any]]).prefix(4)) }),
            ("order", { root in self.step(&root, 1) { $0["order"] = 3 } }),
            ("stage", { root in self.step(&root, 0) { $0["stageKeys"] = ["sales"] } }),
            ("estimate in approved", { root in self.step(&root, 0) { step in
                var timing = step["timing"] as! [String: Any]
                timing["basis"] = "estimate"
                step["timing"] = timing
            } }),
            ("dash", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "Расскажите \u{2014} честно.", "ky": "Айтыңыз."] } }),
            ("promise", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "Мы гарантируем зачисление.", "ky": "Айтыңыз."] } }),
            ("internal", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "Пишите на curator@evo.kg.", "ky": "Айтыңыз."] } }),
            ("mixed script", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "Пишите в \u{0422}elegram.", "ky": "Айтыңыз."] } }),
            ("date without undated", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "До марта 2027 года.", "ky": "2027-жылдын мартына чейин."] } }),
            ("undated without date", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "Скоро.", "ky": "Жакында.", "undated": ["ru": "Скоро.", "ky": "Жакында."]] } }),
            ("unknown item key", { root in self.item(&root, 0, 0) { $0["review"] = "pending" } }),
            ("who", { root in self.item(&root, 0, 0) { $0["who"] = "curator" } }),
            ("item id", { root in self.item(&root, 0, 0) { $0["id"] = "cn-2-01" } }),
            ("only verify", { root in self.step(&root, 7) { step in
                step["checklist"] = (step["checklist"] as! [[String: Any]]).map { item in
                    var item = item
                    item["status"] = "verify"
                    return item
                }
            } }),
            ("unknown source", { root in self.item(&root, 0, 0) { $0["sources"] = ["NOPE"] } }),
            ("internal source address", { root in
                var sources = root["sources"] as! [[String: Any]]
                let index = sources.firstIndex { ["owner_guide", "evo_internal"].contains($0["kind"] as? String) }!
                sources[index]["url"] = "https://example.com/guide"
                root["sources"] = sources
            }),
            ("link module", { root in self.step(&root, 1) { step in
                var links = step["links"] as! [[String: Any]]
                links[0]["appModule"] = "ielts"
                step["links"] = links
            } }),
        ]
        XCTAssertNoThrow(try parse("cn", JSONSerialization.data(withJSONObject: original)))
        for (name, mutate) in cases {
            var broken = original
            mutate(&broken)
            let data = try JSONSerialization.data(withJSONObject: broken)
            XCTAssertThrowsError(try parse("cn", data), name) { error in
                XCTAssertTrue(error is TimelineContentError, "\(name): \(error)")
            }
        }
        XCTAssertThrowsError(try parse("pl", JSONSerialization.data(withJSONObject: original)))
        XCTAssertThrowsError(try parse("cn", Data("not json".utf8)))
    }

    // MARK: Сырой JSON (review #1208 M1, n2)

    private func text(_ key: String) throws -> String {
        try XCTUnwrap(String(data: rawFile(key), encoding: .utf8))
    }

    /// Повтор ключа: `JSONDecoder` взял бы первое значение, `JSON.parse` веба
    /// последнее. iPhone отклоняет файл, поэтому страна `owner_review` не
    /// показывается своим таймлайном ни при каком порядке повтора.
    func testARepeatedKeyRejectsTheFileAndOwnerReviewStaysOnTheGeneralRoute() throws {
        for key in ["it", "cz"] {
            let marker = "  \"status\": \"owner_review\",\n"
            let original = try text(key)
            XCTAssertTrue(original.contains(marker), key)
            for repeated in [original.replacingOccurrences(of: marker, with: "  \"status\": \"approved\",\n" + marker),
                             original.replacingOccurrences(of: marker, with: marker + "  \"status\": \"approved\",\n")] {
                let library = CountryTimelineLibrary.load { name in
                    name == key ? Data(repeated.utf8) : try? self.rawFile(name)
                }
                XCTAssertNil(library.files[key], key)
                XCTAssertEqual(library.failures[key], "timeline \(key): $: repeated key status", key)
                let view = try XCTUnwrap(library.select(choice: key.uppercased(), kyrgyz: false, today: Self.before), key)
                XCTAssertEqual(view.kind, .general, key)
                XCTAssertEqual(view.file, "undecided", key)
            }
        }
    }

    func testTheRawScanRejectsRepeatsAtAnyDepthAndAByteOrderMark() throws {
        XCTAssertNil(TimelineRawJSON.problem(in: try rawFile("cn")))
        let cases: [(String, String?)] = [
            (#"{"a":1,"b":2}"#, nil),
            // Те же ключи в соседних объектах и текст ключа внутри строки не повтор.
            (#"{"steps":[{"id":"x","order":1},{"id":"y","order":2}],"note":"\"id\": {\"id\":"}"#, nil),
            (#"{"a":{"b":1},"b":{"a":1}}"#, nil),
            (#"{"a":1,"a":2}"#, "repeated key a"),
            (#"{"a":[{"b":1,"c":{"d":1,"d":1}}]}"#, "repeated key d"),
            // Ключ с escape-последовательностью сравнивается раскрытым, как у JSON.parse.
            (#"{"status":"approved","status":"owner_review"}"#, "repeated key status"),
            (#"{"status":"approved","st\u0061tus":"owner_review"}"#, "repeated key status"),
            (#"{"a\"b":1,"a\u0022b":2}"#, "repeated key a\"b"),
            ("\u{FEFF}{\"a\":1}", "byte order mark"),
            (#"{"a":"unterminated}"#, "not JSON"),
            (#"{"a":1}}"#, "not JSON"),
        ]
        for (json, expected) in cases {
            XCTAssertEqual(TimelineRawJSON.problem(in: Data(json.utf8)), expected, json)
        }
        let bom = Data([0xEF, 0xBB, 0xBF]) + (try rawFile("cn"))
        XCTAssertThrowsError(try parse("cn", bom)) { error in
            XCTAssertEqual(error as? TimelineContentError, TimelineContentError(file: "cn", path: "$", reason: "byte order mark"))
        }
    }

    /// Те же решения, что у веба (tests/portal-country-timeline-ios-parity.test.mjs
    /// проверяет их на `parseCountryTimelineFile`): `$` только в конце строки,
    /// `trim()` и `\s` с U+FEFF и U+000B, `\b` по ASCII.
    func testTextRulesFollowJavaScriptSemantics() throws {
        let original = try XCTUnwrap(JSONSerialization.jsonObject(with: rawFile("cn")) as? [String: Any])
        let cases: [(String, Mutation)] = [
            ("step id with a final newline", { root in self.step(&root, 0) { $0["id"] = "cn-1-route\n" } }),
            ("item id with a final newline", { root in self.item(&root, 0, 0) { $0["id"] = "cn-1-01\n" } }),
            ("source url with a final newline", { root in
                var sources = root["sources"] as! [[String: Any]]
                let index = sources.firstIndex { $0["url"] != nil }!
                sources[index]["url"] = "\(sources[index]["url"]!)\n"
                root["sources"] = sources
            }),
            ("text ends with U+FEFF", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "Расскажите о себе.\u{FEFF}", "ky": "Айтыңыз."] } }),
            ("U+FEFF and a space", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "Расскажите\u{FEFF} о себе.", "ky": "Айтыңыз."] } }),
            ("vertical tab and a space", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "Расскажите\u{0B} о себе.", "ky": "Айтыңыз."] } }),
            (".pdf before a Cyrillic ending", { root in self.item(&root, 0, 0) { $0["text"] = ["ru": "Загрузите скан.pdfке.", "ky": "Айтыңыз."] } }),
        ]
        for (name, mutate) in cases {
            var broken = original
            mutate(&broken)
            XCTAssertThrowsError(try parse("cn", JSONSerialization.data(withJSONObject: broken)), name)
        }
        // U+0085 JavaScript пробелом не считает: такой текст веб принимает, iPhone тоже.
        var nel = original
        item(&nel, 0, 0) { $0["text"] = ["ru": "Расскажите о себе.\u{85}", "ky": "Айтыңыз."] }
        XCTAssertNoThrow(try parse("cn", JSONSerialization.data(withJSONObject: nel)))
    }

    /// Суммы не рвутся (review #1205 F1): между разрядами ровно U+00A0 или
    /// U+202F, как у веба (`DIGIT_GROUP_SPACE`, tests/portal-country-timeline.test.mjs
    /// и tests/portal-country-timeline-ios-parity.test.mjs решают те же случаи).
    func testDigitGroupsTakeOnlyTheTwoNoBreakSpaces() throws {
        let original = try XCTUnwrap(JSONSerialization.jsonObject(with: rawFile("cn")) as? [String: Any])
        func parsed(_ ru: String) -> Bool {
            var copy = original
            item(&copy, 0, 0) { $0["text"] = ["ru": ru, "ky": "Айтыңыз."] }
            return (try? parse("cn", JSONSerialization.data(withJSONObject: copy))) != nil
        }
        // Каждый пробел JavaScript (`\s`) между разрядами, кроме двух неразрывных, даёт отказ.
        var jsSpaces: [UInt32] = [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF]
        jsSpaces += Array(0x2000...0x200A)
        for value in jsSpaces {
            let scalar = try XCTUnwrap(Unicode.Scalar(value))
            XCTAssertTrue(CountryTimelineRules.jsWhitespace.contains(scalar), String(format: "U+%04X", value))
            let accepted = value == 0xA0 || value == 0x202F
            let text = "Сбор 2\(Character(scalar))500\u{00A0}долларов."
            XCTAssertEqual(CountryTimelineRules.matches(CountryTimelineRules.digitGroupSpace, text), !accepted, String(format: "U+%04X", value))
            XCTAssertEqual(parsed(text), accepted, String(format: "U+%04X", value))
        }
        // U+0085 JavaScript пробелом не считает: веб и iPhone такой разряд не отклоняют.
        XCTAssertFalse(CountryTimelineRules.matches(CountryTimelineRules.digitGroupSpace, "2\u{85}500"))
        XCTAssertTrue(parsed("Сбор 2500 долларов, 2 фото, 1 2345."))
        XCTAssertTrue(parsed("Сбор 2\u{202F}500\u{202F}долларов."))
        var title = original
        var sources = title["sources"] as! [[String: Any]]
        sources[0]["title"] = "Пошлина 3 000 крон"
        title["sources"] = sources
        XCTAssertThrowsError(try parse("cn", JSONSerialization.data(withJSONObject: title))) { error in
            XCTAssertEqual((error as? TimelineContentError)?.reason, "digit groups need U+00A0 or U+202F")
        }
        // Файлы bundle: суммы с неразрывным пробелом и на iPhone.
        let ru = try XCTUnwrap(Self.library.select(choice: "CN", kyrgyz: false, today: Self.before))
        let ky = try XCTUnwrap(Self.library.select(choice: "CN", kyrgyz: true, today: Self.before))
        XCTAssertTrue(try XCTUnwrap(ru.steps.flatMap(\.items).first { $0.id == "cn-3-08" }).text.contains("не меньше 2\u{00A0}500\u{00A0}долларов США"))
        XCTAssertTrue(try XCTUnwrap(ky.steps.flatMap(\.items).first { $0.id == "cn-3-08" }).text.contains("кеминде 2\u{00A0}500\u{00A0}АКШ доллары"))
        for (label, view) in allViews() {
            for text in strings(view) { XCTAssertFalse(CountryTimelineRules.matches(CountryTimelineRules.digitGroupSpace, text), "\(label): \(text)") }
        }
    }

    /// Общий маршрут после review #1205 (F3, F6): без раздела «Документы»
    /// уровня assisted и без «партнёра» в шаге 4.
    func testGeneralRouteNamesNoAssistedSectionAndNoPartner() throws {
        for kyrgyz in [false, true] {
            let view = try XCTUnwrap(Self.library.select(choice: "UNDECIDED", kyrgyz: kyrgyz, today: Self.before))
            XCTAssertEqual(view.steps[3].title, kyrgyz ? "Университеттерге арыз тапшыруу" : "Подача заявок в университеты")
            for text in strings(view) {
                for label in ["«Документы»", "«Документтер»", "«Сообщения»", "«Билдирүүлөр»", "«Оплата»", "«Төлөм»", "«Уведомления»", "«Билдирмелер»"] {
                    XCTAssertFalse(text.contains(label), text)
                }
                XCTAssertNil(text.range(of: "партн", options: .caseInsensitive), text)
            }
        }
    }

    func testTodayIsTheBishkekDate() {
        // 20:30 UTC 16.10 это уже 17.10 в Бишкеке (UTC+6).
        let evening = Date(timeIntervalSince1970: 1_792_182_600)
        XCTAssertEqual(CountryTimelineLibrary.today(now: evening), "2026-10-17")
        XCTAssertEqual(CountryTimelineLibrary.today(now: evening, timeZone: TimeZone(identifier: "UTC")), "2026-10-16")
    }
}
