import CryptoKit
import ImageIO
import XCTest

/// Обзор экзамена CSCA (контракт docs/portal/csca-contract.md §19). Тесты
/// читают настоящие файлы bundle (те же, что у веба: src/content/csca) и
/// сверяют порт iPhone с вебом по фикстуре
/// scripts/portal/write-csca-overview-ios-parity.mjs: те же решения на
/// вариантах файлов и те же отпечатки разобранного обзора.
final class CSCAOverviewTests: XCTestCase {
    private static let bundle = Bundle(for: CSCAOverviewTests.self)
    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    private func resource(_ name: String) throws -> Data {
        try XCTUnwrap(Self.bundle.url(forResource: name, withExtension: nil).flatMap { try? Data(contentsOf: $0) },
                      "\(name) is missing from the test bundle")
    }

    private func content() throws -> CSCAOverviewContent {
        try CSCAOverviewContent.load(from: Self.bundle).get()
    }

    private static func hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Файлы

    func testBundledOverviewParsesStrictly() throws {
        let content = try content()
        let o = content.overview
        XCTAssertEqual(o.schemaVersion, 1)
        XCTAssertEqual(o.kyStatus, "needs_native_proofreading")
        XCTAssertEqual(o.confirmedOn, "2026-10-17")
        XCTAssertEqual(o.exam.nameEn, "China Scholastic Competency Assessment")
        XCTAssertEqual(o.exam.universitiesTotal, 306)
        let rows = o.subjects.groups.flatMap { group in
            group.subjects.map { [group.nameEn, $0.nameEn, $0.language.ru, "\($0.minutes)", "\($0.questions)", "\($0.scoreMin)", "\($0.scoreMax)"] }
        }
        XCTAssertEqual(rows, [
            ["Professional Chinese", "Humanities", "Китайский", "90", "80", "0", "100"],
            ["Professional Chinese", "STEM", "Китайский", "90", "80", "0", "100"],
            ["Fundamental Subjects", "Mathematics", "Китайский или английский", "60", "48", "0", "100"],
            ["Fundamental Subjects", "Physics", "Китайский или английский", "60", "48", "0", "100"],
            ["Fundamental Subjects", "Chemistry", "Китайский или английский", "60", "48", "0", "100"],
        ])
        XCTAssertEqual(o.subjects.groups.flatMap { $0.subjects.map(\.evo) }, [.none, .none, .available, .later, .later])
        XCTAssertEqual(o.fees.rows.map(\.fee), [450, 700])
        XCTAssertEqual(o.fees.rows.map(\.maxSubjects), [1, nil])
        XCTAssertEqual(o.faq.items.map(\.id), ["who", "dates", "graduate"])
        XCTAssertEqual(o.faq.items.map { $0.link != nil }, [false, true, false])
        XCTAssertEqual(content.photos.map(\.key), ["campus-sichuan", "campus-xiamen"])
        XCTAssertEqual(content.hero?.key, "campus-sichuan")
        XCTAssertEqual(content.audience?.key, "campus-xiamen")
        XCTAssertEqual(o.minutesLabel(90, kyrgyz: false), "90 мин")
        XCTAssertEqual(o.minutesLabel(60, kyrgyz: true), "60 мүн")
        XCTAssertEqual(o.scoreRangeLabel(o.subjects.groups[0].subjects[0], kyrgyz: false), "от 0 до 100")
        XCTAssertEqual(o.scoreRangeLabel(o.subjects.groups[0].subjects[0], kyrgyz: true), "0дөн 100гө чейин")
        // The dates answer quotes the real heading of the iPhone sessions section.
        let dates = try XCTUnwrap(o.faq.items.first { $0.id == "dates" })
        XCTAssertTrue(dates.answer[0].ru.contains("«Сессии CSCA»"))
        XCTAssertTrue(dates.answer[0].ky.contains("«CSCA сессиялары»"))
    }

    /// Bundle содержит ровно файлы репозитория (src/content/csca), не копии.
    func testBundledFilesAreTheRepositoryFiles() throws {
        let csca = Self.repoRoot.appendingPathComponent("src/content/csca")
        for name in ["overview.json", "photos.json"] {
            XCTAssertEqual(try resource(name), try Data(contentsOf: csca.appendingPathComponent(name)), name)
        }
        for file in try content().photos.flatMap(\.webpFiles) {
            XCTAssertEqual(try resource(file.resourceName), try Data(contentsOf: csca.appendingPathComponent(file.path)), file.path)
        }
    }

    /// Каждый WebP манифеста есть в bundle с хешем, размером и пикселями
    /// манифеста; JPEG (только для браузеров) в bundle не входит.
    func testBundledPhotosMatchTheLicenceManifest() throws {
        var total = 0
        for photo in try content().photos {
            XCTAssertEqual(photo.sourceName, "Pexels")
            XCTAssertEqual(photo.licenceUrl, "https://www.pexels.com/license/")
            XCTAssertFalse(photo.webpFiles.isEmpty, photo.key)
            for file in photo.webpFiles {
                let data = try resource(file.resourceName)
                total += data.count
                XCTAssertEqual(data.count, file.bytes, file.path)
                XCTAssertEqual(Self.hex(data), file.sha256, file.path)
                let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil), file.path)
                let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil), "\(file.path) does not decode")
                XCTAssertEqual([image.width, image.height], [file.width, file.height], file.path)
            }
            for file in photo.files where file.format == .jpeg {
                XCTAssertNil(Self.bundle.url(forResource: file.resourceName, withExtension: nil), "\(file.path) is web only")
            }
        }
        XCTAssertLessThan(total, 400_000, "\(total) bytes of photos in the app")
    }

    // MARK: Паритет с вебом

    private struct Fixture: Decodable {
        struct File: Decodable { let sha256: String }
        struct Overview: Decodable { let contentVersion: Int; let sha256: String }
        struct Photos: Decodable { let keys: [String]; let sha256: String }
        struct View: Decodable { let `case`: String; let locale: String; let sha256: String }
        struct Choice: Decodable { let parse: [[TimelineJSON]]; let open: [[TimelineJSON]] }
        struct Vector: Decodable { let id: String; let file: String; let ops: [TimelineJSON]; let expect: String }

        let files: [String: File]
        let overview: Overview
        let photos: Photos
        let views: [View]
        let choice: Choice
        let vectors: [Vector]
    }

    private func fixture() throws -> Fixture {
        try JSONDecoder().decode(Fixture.self, from: resource("csca-overview-parity.json"))
    }

    private static func fingerprint(_ fields: [String?]) -> String {
        hex(Data(fields.map { $0 ?? "\u{0}" }.joined(separator: "\u{1F}").utf8))
    }

    /// Тот же порядок полей, что `canonicalOverview` в
    /// scripts/portal/write-csca-overview-ios-parity.mjs.
    static func canonical(_ o: CSCAOverview) -> [String?] {
        func pair(_ text: CSCABilingual) -> [String?] { [text.ru, text.ky] }
        let columns = o.subjects.columns
        var fields: [String?] = ["\(o.schemaVersion)", "\(o.contentVersion)", o.confirmedOn, o.kyStatus,
                                 o.exam.short, o.exam.nameEn, "\(o.exam.subjectsTotal)", "\(o.exam.universitiesTotal)"]
        fields += pair(o.summary) + ["\(o.intro.count)"] + o.intro.flatMap(pair)
        fields += pair(o.audience.title) + pair(o.audience.needed.label) + pair(o.audience.needed.text)
        fields += pair(o.audience.notNeeded.label) + pair(o.audience.notNeeded.text)
        fields += pair(o.subjects.title)
        fields += [columns.subject, columns.language, columns.duration, columns.questions, columns.scoreRange, columns.evo].flatMap(pair)
        fields += pair(o.subjects.minutesFormat) + pair(o.subjects.scoreRangeFormat)
        fields += CSCAEvoStatus.allCases.flatMap { pair(o.subjects.evoStatus[$0] ?? CSCABilingual(ru: "", ky: "")) }
        fields.append("\(o.subjects.groups.count)")
        for group in o.subjects.groups {
            fields += [group.key, group.nameEn] + pair(group.name) + ["\(group.subjects.count)"]
            for subject in group.subjects {
                fields += [subject.key, subject.nameEn] + (subject.name.map(pair) ?? [nil, nil]) + pair(subject.language)
                fields += ["\(subject.minutes)", "\(subject.questions)", "\(subject.scoreMin)", "\(subject.scoreMax)", subject.evo.rawValue]
            }
        }
        fields += pair(o.fees.title) + [o.fees.currency] + pair(o.fees.subjectsColumn) + pair(o.fees.feeColumn) + ["\(o.fees.rows.count)"]
        for row in o.fees.rows {
            fields += [row.key] + pair(row.label) + ["\(row.minSubjects)", row.maxSubjects.map { "\($0)" }, "\(row.fee)"]
        }
        fields += pair(o.faq.title) + ["\(o.faq.items.count)"]
        for item in o.faq.items {
            fields += [item.id] + pair(item.question) + ["\(item.answer.count)"] + item.answer.flatMap(pair)
            fields += item.link.map { ["sessions"] + pair($0.label) + pair($0.withoutSessions) } ?? [nil]
        }
        fields += [o.heroPhoto, o.audiencePhoto, "\(o.sources.count)"]
        for source in o.sources { fields += [source.id, "owner", source.title, source.checkedOn, source.omitted] }
        return fields
    }

    static func canonical(_ photos: [CSCAOverviewPhoto]) -> [String?] {
        var fields: [String?] = ["\(photos.count)"]
        for photo in photos {
            fields += [photo.key, photo.alt.ru, photo.alt.ky, photo.author, photo.authorUrl, photo.sourceName, photo.sourceUrl,
                       photo.sourceTitle, photo.licence, photo.licenceUrl, photo.attributionRequired ? "1" : "0", photo.uploadedOn,
                       photo.fetchedOn, photo.objectPosition, "\(photo.files.count)"]
            for file in photo.files {
                fields += [file.path, file.format.rawValue, "\(file.width)", "\(file.height)", "\(file.bytes)", file.sha256]
            }
        }
        return fields
    }

    /// `canonicalSubjectView`: общие факты группы и факты каждого предмета.
    static func canonical(_ o: CSCAOverview, groups: [CSCAOverviewGroup], kyrgyz: Bool) -> [String?] {
        func facts(_ list: [CSCASubjectFact]) -> [String?] { ["\(list.count)"] + list.flatMap { [$0.key, $0.label, $0.value] } }
        var fields: [String?] = [CSCAOverview.subjectFactKeys.joined(separator: ",")]
        for group in groups {
            let grouped = o.groupFacts(group, kyrgyz: kyrgyz)
            fields += [group.key] + facts(grouped.shared)
            for subject in group.subjects {
                fields += [subject.key] + facts(o.subjectFacts(subject, kyrgyz: kyrgyz)) + facts(grouped.bySubject[subject.key] ?? [])
            }
        }
        return fields
    }

    /// Группа с разным временем у предметов (`mixedGroup` скрипта).
    static func mixedGroup(_ o: CSCAOverview) -> CSCAOverviewGroup {
        let group = o.subjects.groups[0]
        let second = group.subjects[1]
        let changed = CSCAOverviewSubject(key: second.key, nameEn: second.nameEn, name: second.name, language: second.language,
                                          minutes: 75, questions: second.questions, scoreMin: second.scoreMin,
                                          scoreMax: second.scoreMax, evo: second.evo)
        return CSCAOverviewGroup(key: group.key, nameEn: group.nameEn, name: group.name, subjects: [group.subjects[0], changed])
    }

    func testParsedOverviewMatchesTheWebParser() throws {
        let fixture = try fixture()
        // Фикстура привязана к байтам файлов: правка контента без перезапуска
        // скрипта видна здесь и в node-тесте (`--check`).
        XCTAssertEqual(Set(fixture.files.keys), ["overview.json", "photos.json"])
        for (name, file) in fixture.files {
            XCTAssertEqual(Self.hex(try resource(name)), file.sha256, "\(name) changed: run scripts/portal/write-csca-overview-ios-parity.mjs")
        }
        let content = try content()
        XCTAssertEqual(content.overview.contentVersion, fixture.overview.contentVersion)
        XCTAssertEqual(Self.fingerprint(Self.canonical(content.overview)), fixture.overview.sha256, "the iPhone reads another overview")
        XCTAssertEqual(content.photos.map(\.key), fixture.photos.keys)
        XCTAssertEqual(Self.fingerprint(Self.canonical(content.photos)), fixture.photos.sha256, "the iPhone reads another manifest")
        XCTAssertEqual(fixture.views.count, 4)
        for view in fixture.views {
            let groups = view.case == "mixed" ? [Self.mixedGroup(content.overview)] : content.overview.subjects.groups
            XCTAssertEqual(Self.fingerprint(Self.canonical(content.overview, groups: groups, kyrgyz: view.locale == "ky")), view.sha256,
                           "\(view.case) \(view.locale): the iPhone labels the subjects otherwise")
        }
    }

    func testNarrowSubjectsShowSharedFactsOnceAndKeepDifferences() throws {
        let o = try content().overview
        for kyrgyz in [false, true] {
            for group in o.subjects.groups {
                let facts = o.groupFacts(group, kyrgyz: kyrgyz)
                XCTAssertEqual(facts.shared.map(\.key), CSCAOverview.subjectFactKeys, group.key)
                for subject in group.subjects { XCTAssertEqual(facts.bySubject[subject.key], [], subject.key) }
            }
        }
        let mixed = o.groupFacts(Self.mixedGroup(o), kyrgyz: false)
        XCTAssertEqual(mixed.shared.map(\.key), ["language", "questions", "scoreRange"])
        XCTAssertEqual(mixed.bySubject["stem"]?.map(\.value), ["75 мин"])
    }

    /// Каждый вариант файла: то же решение, что у веба, тем же текстом ошибки.
    func testEveryFileVariantGetsTheWebDecision() throws {
        let fixture = try fixture()
        XCTAssertGreaterThan(fixture.vectors.count, 70)
        let decoder = JSONDecoder()
        let rawOverview = try decoder.decode(TimelineJSON.self, from: resource("overview.json"))
        let rawPhotos = try decoder.decode(TimelineJSON.self, from: resource("photos.json"))
        let keys = Set(try CSCAOverviewParser(file: CSCAOverviewParser.photosFile).photos(rawPhotos).map(\.key))
        for vector in fixture.vectors {
            let decision: String
            do {
                if vector.file == "photos" {
                    _ = try CSCAOverviewParser(file: CSCAOverviewParser.photosFile).photos(try Self.apply(vector.ops, to: rawPhotos))
                } else {
                    _ = try CSCAOverviewParser(file: CSCAOverviewParser.overviewFile).overview(try Self.apply(vector.ops, to: rawOverview), photoKeys: keys)
                }
                decision = "accept"
            } catch let error as CSCAOverviewError {
                decision = error.description
            }
            XCTAssertEqual(decision, vector.expect, "\(vector.file): \(vector.id)")
        }
    }

    func testRawFileProblemsAreRefusedBeforeDecoding() throws {
        let original = try resource("overview.json")
        XCTAssertThrowsError(try CSCAOverviewParser.overview(Data([0xEF, 0xBB, 0xBF]) + original, photoKeys: [])) { error in
            XCTAssertEqual((error as? CSCAOverviewError)?.description, "csca overview.json: $: byte order mark")
        }
        let repeated = try XCTUnwrap(String(data: original, encoding: .utf8))
            .replacingOccurrences(of: "\"kyStatus\": \"needs_native_proofreading\",",
                                  with: "\"kyStatus\": \"proofread\",\n  \"kyStatus\": \"needs_native_proofreading\",")
        XCTAssertThrowsError(try CSCAOverviewParser.overview(Data(repeated.utf8), photoKeys: [])) { error in
            XCTAssertEqual((error as? CSCAOverviewError)?.description, "csca overview.json: $: repeated key kyStatus")
        }
        if case .success = CSCAOverviewContent.load(overview: original, photos: nil) { XCTFail("a missing manifest shows no overview") }
    }

    // MARK: Правки фикстуры

    private struct OpError: Error {}

    static func apply(_ ops: [TimelineJSON], to root: TimelineJSON) throws -> TimelineJSON {
        var result = root
        for op in ops {
            guard case .object(let fields) = op, case .string(let kind) = fields["op"], case .array(let path) = fields["path"] else { throw OpError() }
            switch kind {
            case "set": result = try replacing(result, at: path[...], with: fields["value"] ?? .null)
            case "delete": result = try replacing(result, at: path[...], with: nil)
            case "copy":
                guard case .array(let from) = fields["from"] else { throw OpError() }
                result = try replacing(result, at: path[...], with: try value(in: result, at: from))
            default: throw OpError()
            }
        }
        return result
    }

    private static func value(in node: TimelineJSON, at path: [TimelineJSON]) throws -> TimelineJSON {
        try path.reduce(node) { current, step in
            switch (current, step) {
            case (.object(let fields), .string(let key)):
                guard let next = fields[key] else { throw OpError() }
                return next
            case (.array(let items), .int(let index)) where items.indices.contains(index): return items[index]
            default: throw OpError()
            }
        }
    }

    /// Новое значение по пути; nil удаляет ключ или элемент, индекс, равный
    /// длине массива, добавляет в конец (как `applyOps` скрипта).
    private static func replacing(_ node: TimelineJSON, at path: ArraySlice<TimelineJSON>, with value: TimelineJSON?) throws -> TimelineJSON {
        guard let step = path.first else { throw OpError() }
        let rest = path.dropFirst()
        switch (node, step) {
        case (.object(var fields), .string(let key)):
            if rest.isEmpty {
                fields[key] = value
            } else {
                guard let child = fields[key] else { throw OpError() }
                fields[key] = try replacing(child, at: rest, with: value)
            }
            return .object(fields)
        case (.array(var items), .int(let index)):
            if rest.isEmpty {
                if let value {
                    if index == items.count { items.append(value) } else if items.indices.contains(index) { items[index] = value } else { throw OpError() }
                } else if items.indices.contains(index) {
                    items.remove(at: index)
                } else {
                    throw OpError()
                }
            } else {
                guard items.indices.contains(index) else { throw OpError() }
                items[index] = try replacing(items[index], at: rest, with: value)
            }
            return .array(items)
        default:
            throw OpError()
        }
    }

    // MARK: Новичок и вернувшийся

    func testOpenOrCollapsedFollowsTheWebRule() throws {
        let fixture = try fixture()
        for entry in fixture.choice.parse {
            guard entry.count == 2 else { return XCTFail("parse case") }
            let input: String? = { if case .string(let text) = entry[0] { return text }; return nil }()
            let expected: String? = { if case .string(let text) = entry[1] { return text }; return nil }()
            XCTAssertEqual(CSCAOverviewChoice.parse(input)?.rawValue, expected, "\(String(describing: input))")
        }
        XCTAssertEqual(fixture.choice.open.count, 6)
        for entry in fixture.choice.open {
            guard entry.count == 3, case .bool(let started) = entry[1], case .bool(let open) = entry[2] else { return XCTFail("open case") }
            let choice: CSCAOverviewChoice? = { if case .string(let text) = entry[0] { return CSCAOverviewChoice.parse(text) }; return nil }()
            XCTAssertEqual(CSCAOverviewChoice.isOpen(choice, started: started), open, "\(String(describing: choice)) started \(started)")
        }
        XCTAssertEqual(CSCAOverviewChoice.defaultsKey, "csca_overview")
    }

    /// Те же признаки, что `cscaHasStarted` веба, на настоящих ответах 285.
    func testStudentHasStartedOnlyAfterAnyActivity() throws {
        let fresh = try CSCADecodingTests.decode(CSCAHome.self, "csca_home_fresh")
        XCTAssertFalse(fresh.hasStarted)
        XCTAssertTrue(try CSCADecodingTests.decode(CSCAHome.self, "csca_home_after").hasStarted)
        let reviewOnly = try CSCADecodingTests.mutated(CSCAHome.self, "csca_home_fresh") { home in
            home["review"] = ["dueCount": 0, "activeCount": 1, "nextDueOn": "2026-10-18"]
        }
        XCTAssertTrue(reviewOnly.hasStarted)
    }

    // MARK: Фото

    func testPhotoFileFollowsTheScreenScaleLikeSrcset() throws {
        let content = try content()
        let hero = try XCTUnwrap(content.hero)
        let audience = try XCTUnwrap(content.audience)
        XCTAssertEqual(hero.webpFiles.map(\.width), [240, 720, 1280])
        // 375 pt: кадр 343 pt; 2x 686 px, 3x 1029 px. 402 pt: 370 pt, 3x 1110 px.
        XCTAssertEqual(hero.file(forPixelWidth: 343 * 2)?.width, 720)
        XCTAssertEqual(hero.file(forPixelWidth: 343 * 3)?.width, 1280)
        XCTAssertEqual(hero.file(forPixelWidth: 370 * 3)?.width, 1280)
        XCTAssertEqual(hero.file(forPixelWidth: 4000)?.width, 1280)
        // Миниатюра 56 pt: 240 у героя даже на 3x.
        XCTAssertEqual(hero.file(forPixelWidth: 56 * 3)?.width, 240)
        XCTAssertEqual(audience.file(forPixelWidth: 56 * 3)?.width, 720)
        XCTAssertEqual(hero.focus, CGPoint(x: 0.5, y: 0.55))
        XCTAssertEqual(audience.focus, CGPoint(x: 0.45, y: 0.4))
        // object-fit: cover с object-position: лишнее срезается по точке кадра.
        let wide = CSCAOverviewPhoto.crop(imageSize: CGSize(width: 1280, height: 851), aspect: 16 / 9, focus: audience.focus)
        XCTAssertEqual(wide, CGRect(x: 0, y: 52, width: 1280, height: 720))
        let square = CSCAOverviewPhoto.crop(imageSize: CGSize(width: 240, height: 161), aspect: 1, focus: hero.focus)
        XCTAssertEqual(square, CGRect(x: 40, y: 0, width: 161, height: 161))
        XCTAssertEqual(CSCAOverviewPhoto.crop(imageSize: CGSize(width: 1280, height: 854), aspect: 3 / 2, focus: hero.focus).height, 853)
    }

    // MARK: Окно регистрации (веб: tests/portal-csca-overview.test.mjs)

    private func session(closes: String?, opens: String? = "2026-10-15T15:00:00+08:00") throws -> CSCASession {
        let json: [String: Any] = [
            "sessionKey": "2026-11", "examFrom": "2026-11-14", "examTo": "2026-11-15",
            "registrationOpensAt": opens as Any? ?? NSNull(), "registrationClosesAt": closes as Any? ?? NSNull(),
            "sourceUrl": "https://csca.cn/about/examintro", "verifiedOn": "2026-10-16",
        ]
        return try JSONDecoder().decode(CSCASession.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testRegistrationWindowSaysWhenItClosesUpToSixtyDays() throws {
        let now = "2026-10-17T06:00:00+00:00"
        let today = "2026-10-17"
        let open = try session(closes: "2026-10-21T23:59:00+08:00")
        XCTAssertEqual(CSCASessionRegistration.state(for: open, serverNow: now, today: today), .open(closesAt: "2026-10-21T23:59:00+08:00", daysLeft: 4))
        XCTAssertEqual(CSCASessionRegistration.state(for: open, serverNow: now, today: today).closesSoon, 4)
        let far = CSCASessionRegistration.state(for: try session(closes: "2027-01-30T23:59:00+08:00"), serverNow: now, today: today)
        guard case .open = far else { return XCTFail("far window is open") }
        XCTAssertNil(far.closesSoon, "more than 60 days: the date alone")
        let sixty = CSCASessionRegistration.state(for: try session(closes: "2026-12-16T12:00:00+06:00"), serverNow: now, today: today)
        XCTAssertEqual(sixty.closesSoon, 60)
        let upcoming = try session(closes: "2026-12-01T23:59:00+08:00", opens: "2026-11-20T15:00:00+08:00")
        XCTAssertEqual(CSCASessionRegistration.state(for: upcoming, serverNow: now, today: today), .upcoming(opensAt: "2026-11-20T15:00:00+08:00"))
        let closed = try session(closes: "2026-10-16T23:59:00+08:00")
        XCTAssertEqual(CSCASessionRegistration.state(for: closed, serverNow: now, today: today), .closed(closesAt: "2026-10-16T23:59:00+08:00"))
        XCTAssertEqual(CSCASessionRegistration.state(for: try session(closes: nil, opens: nil), serverNow: now, today: today), .pending)
        // Closing day itself, Bishkek time: «закрывается сегодня».
        let lastDay = CSCASessionRegistration.state(for: open, serverNow: "2026-10-21T15:00:00+00:00", today: "2026-10-21")
        XCTAssertEqual(lastDay.closesSoon, 0)
        // An unreadable clock is never «open», as NaN on the web.
        guard case .closed = CSCASessionRegistration.state(for: open, serverNow: "not a time", today: today) else {
            return XCTFail("unreadable serverNow")
        }
        // The real home response (285): the November window closes in 5 days.
        let home = try CSCADecodingTests.decode(CSCAHome.self, "csca_home_fresh")
        let november = try XCTUnwrap(home.sessions.first)
        XCTAssertEqual(CSCASessionRegistration.state(for: november, serverNow: home.serverNow, today: home.today).closesSoon, 5)
    }

    func testClosesInStringsHaveTheWebPluralForms() throws {
        func format(_ language: String, _ key: String, _ count: Int) throws -> String {
            let path = try XCTUnwrap(Self.bundle.path(forResource: language, ofType: "lproj"))
            let localized = try XCTUnwrap(Bundle(path: path)).localizedString(forKey: key, value: nil, table: "CSCA")
            return String(format: localized, locale: Locale(identifier: language), count)
        }
        XCTAssertEqual(try [1, 2, 5, 21, 4].map { try format("ru", "csca_closes_in", $0) }, [
            "закрывается через 1 день", "закрывается через 2 дня", "закрывается через 5 дней",
            "закрывается через 21 день", "закрывается через 4 дня",
        ])
        XCTAssertEqual(try format("ky", "csca_closes_in", 4), "4 күндөн кийин жабылат")
        let path = try XCTUnwrap(Self.bundle.path(forResource: "ru", ofType: "lproj"))
        let ru = try XCTUnwrap(Bundle(path: path))
        XCTAssertEqual(ru.localizedString(forKey: "csca_closes_today", value: nil, table: "CSCA"), "закрывается сегодня")
        XCTAssertEqual(ru.localizedString(forKey: "csca_overview_toggle", value: nil, table: "CSCA"), "Об экзамене")
    }
}
