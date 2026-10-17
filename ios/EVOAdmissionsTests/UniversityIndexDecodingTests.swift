import XCTest

/// Журнал разбора для тестов: разбор синхронный, поэтому простой массив.
final class CatalogIssueLog: @unchecked Sendable {
    private(set) var issues: [CatalogParseIssue] = []

    var report: CatalogParseReporter {
        { [self] issue in issues.append(issue) }
    }
}

/// Разбор `student_university_index_v1` по частям (283, контракт 2.1 и 2.2a)
/// на реальном ответе демо-стека и его точечных искажениях. Те же случаи, что
/// `tests/portal-university-index.test.mjs` веба: весь индекс отвергается
/// только при неверной обёртке, остальное деградирует по одному с записью в
/// журнал.
final class UniversityIndexDecodingTests: XCTestCase {
    private func full(_ data: Data, log: CatalogIssueLog = CatalogIssueLog()) throws -> UniversityIndex {
        guard case .full(let index) = try UniversityIndexResponse.decode(data, report: log.report) else {
            XCTFail("Expected a full index")
            throw CocoaError(.coderInvalidValue)
        }
        return index
    }

    private func parsed(_ change: (inout [String: Any]) throws -> Void) throws -> (UniversityIndex, [CatalogParseIssue]) {
        let log = CatalogIssueLog()
        let index = try full(AtlasFixtures.mutated(AtlasFixtures.index, change), log: log)
        return (index, log.issues)
    }

    private func raw() throws -> [String: Any] { try AtlasFixtures.object(AtlasFixtures.index) }

    private func universityIds(inCity key: String) throws -> [String] {
        (try raw()["universities"] as! [[String: Any]]).filter { $0["cityKey"] as? String == key }.map { $0["id"] as! String }
    }

    private func universityId(_ position: Int) throws -> String {
        (try raw()["universities"] as! [[String: Any]])[position]["id"] as! String
    }

    /// Каждый вуз виден ровно в одном месте, счётчики сходятся (приёмка 7.6.2).
    private func assertConsistent(_ index: UniversityIndex, _ label: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(index.countries.map(\.universityCount).reduce(0, +), index.universities.count, label, file: file, line: line)
        XCTAssertEqual(Set(index.universities.map(\.id)).count, index.universities.count, label, file: file, line: line)
        for city in index.cities {
            XCTAssertEqual(index.universities.filter { $0.cityKey == city.key }.count, city.universityCount, label, file: file, line: line)
            XCTAssertGreaterThan(city.universityCount ?? 0, 0, label, file: file, line: line)
        }
        for country in index.countries {
            XCTAssertEqual(index.cities.filter { $0.country == country.code }.count, country.cityCount, label, file: file, line: line)
        }
        for university in index.universities {
            if let key = university.cityKey {
                XCTAssertEqual(index.cities.first { $0.key == key }?.country, university.country, label, file: file, line: line)
            }
        }
    }

    func testDecodesRealDemoIndex() throws {
        let log = CatalogIssueLog()
        let index = try full(AtlasFixtures.data(AtlasFixtures.index), log: log)
        // Целый индекс журнала не пишет.
        XCTAssertEqual(log.issues, [])
        XCTAssertTrue(index.version.hasPrefix("g1."))
        // Порядок продукта и фиксированные названия (283).
        XCTAssertEqual(index.countries.map(\.code), ["CN", "MY", "AE", "TR", "IT", "CZ"])
        XCTAssertEqual(index.countries.first?.name, LocalizedPair(ru: "Китай", ky: "Кытай"))
        XCTAssertTrue(index.countries.allSatisfy { $0.photo?.path.hasPrefix("geography/countries/") == true })
        XCTAssertEqual(index.cities.count, 19)
        XCTAssertEqual(index.universities.count, 29)
        assertConsistent(index, "demo")
        XCTAssertEqual(index.countries.first { $0.code == "CZ" }?.universityCount, 0)
        let shanghai = try XCTUnwrap(index.cities.first { $0.key == "shanghai" })
        XCTAssertEqual(shanghai.country, "CN")
        XCTAssertEqual(shanghai.photo.sourceName, "Pexels")
        XCTAssertEqual(shanghai.fact.sourceUrl.scheme, "https")
        XCTAssertEqual(shanghai.universityCount, 6)
        let apu = try XCTUnwrap(index.universities.first { $0.photoKey == "apu" })
        XCTAssertEqual(apu.cityKey, "kuala-lumpur")
        XCTAssertEqual(apu.levels, ["foundation", "bachelor", "master"])
        XCTAssertTrue(apu.hasCosts)
    }

    func testDecodesRealNotModifiedWithTheSameVersion() throws {
        let index = try full(AtlasFixtures.data(AtlasFixtures.index))
        let response = try UniversityIndexResponse.decode(AtlasFixtures.data(AtlasFixtures.notModified))
        XCTAssertEqual(response, .notModified(version: index.version))
    }

    func testRefusesOnlyABrokenEnvelope() throws {
        let broken: [(String, (inout [String: Any]) -> Void)] = [
            ("extra key", { $0["extra"] = 1 }),
            ("countries reversed", { $0["countries"] = Array(($0["countries"] as! [Any]).reversed()) }),
            ("five countries", { $0["countries"] = Array(($0["countries"] as! [Any]).dropLast()) }),
            ("a country outside the list", { $0.update(["countries", 0]) { $0["code"] = "PL" } }),
            ("a null country", { var list = $0["countries"] as! [Any]; list[2] = NSNull(); $0["countries"] = list }),
            ("version with a line feed", { $0["version"] = "g1.\n" }),
            ("empty version", { $0["version"] = "" }),
            ("cities not an array", { $0["cities"] = [String: Any]() }),
            ("universities null", { $0["universities"] = NSNull() }),
            ("notModified as a string", { $0["notModified"] = "false" }),
            ("notModified missing", { $0.removeValue(forKey: "notModified") }),
        ]
        for (label, change) in broken {
            let data = try AtlasFixtures.mutated(AtlasFixtures.index, change)
            XCTAssertThrowsError(try UniversityIndexResponse.decode(data), label)
        }
        let extra = try JSONSerialization.data(withJSONObject: ["notModified": true, "version": "g1.x", "countries": []])
        XCTAssertThrowsError(try UniversityIndexResponse.decode(extra))
        let missing = try JSONSerialization.data(withJSONObject: ["notModified": true])
        XCTAssertThrowsError(try UniversityIndexResponse.decode(missing))
    }

    // Review раунда 3 (F12 веба): одна неверная карточка больше не делает
    // весь каталог «не удалось загрузить».

    func testServerCountsAreRecountedAndLogged() throws {
        var (index, issues) = try parsed { $0.update(["countries", 0]) { $0["universityCount"] = 5 } }
        XCTAssertEqual(index.countries[0].universityCount, 20)
        XCTAssertEqual(issues, [CatalogParseIssue(.country, "CN", "count")])

        (index, issues) = try parsed { $0.update(["countries", 1]) { $0["cityCount"] = 2 } }
        XCTAssertEqual(index.countries[1].cityCount, 3)
        XCTAssertEqual(issues, [CatalogParseIssue(.country, "MY", "count")])

        (index, issues) = try parsed { $0.update(["cities", 0]) { $0["universityCount"] = 3 } }
        XCTAssertEqual(index.cities.first { $0.key == "shanghai" }?.universityCount, 6)
        XCTAssertEqual(issues, [CatalogParseIssue(.city, "shanghai", "count")])
        assertConsistent(index, "counts")
    }

    func testUniversityLinkedToACityOfAnotherCountryMovesToOtherUniversities() throws {
        let apu = try universityId(0)
        let (index, issues) = try parsed { $0.update(["universities", 0]) { $0["cityKey"] = "shanghai" } }
        let moved = try XCTUnwrap(index.universities.first { $0.id.uuidString.lowercased() == apu })
        XCTAssertNil(moved.cityKey)
        XCTAssertEqual(UniversityAtlasPolicy.otherUniversities(of: "MY", in: index).map(\.id), [moved.id])
        // Куала-Лумпур без вузов пропадает, у Малайзии два города.
        XCTAssertFalse(index.cities.contains { $0.key == "kuala-lumpur" })
        XCTAssertEqual(index.countries[1].cityCount, 2)
        XCTAssertEqual(issues, [
            CatalogParseIssue(.university, apu, "city"),
            CatalogParseIssue(.city, "kuala-lumpur", "empty"),
            CatalogParseIssue(.country, "MY", "count"),
        ])
        assertConsistent(index, "foreign city")
    }

    func testBrokenUniversityIsSkippedAlone() throws {
        let apu = try universityId(0)
        let bilkent = try universityId(1)
        var (index, issues) = try parsed { value in
            value.update(["universities", 1]) { $0["id"] = apu }
        }
        XCTAssertEqual(index.universities.count, 28)
        XCTAssertFalse(index.cities.contains { $0.key == "ankara" })
        XCTAssertEqual(issues, [
            CatalogParseIssue(.university, apu, "duplicate"),
            CatalogParseIssue(.city, "ankara", "empty"),
            CatalogParseIssue(.country, "TR", "count"),
        ])
        assertConsistent(index, "duplicate")

        (index, issues) = try parsed { $0.update(["universities", 1]) { $0["country"] = "PL" } }
        XCTAssertFalse(index.universities.contains { $0.id.uuidString.lowercased() == bilkent })
        XCTAssertEqual(issues, [
            CatalogParseIssue(.university, bilkent, "country"),
            CatalogParseIssue(.city, "ankara", "empty"),
            CatalogParseIssue(.country, "TR", "count"),
        ])
        assertConsistent(index, "country outside the list")

        // Управляющий знак в названии: вуза нет, остальной каталог есть.
        (index, issues) = try parsed { $0.update(["universities", 1]) { $0["name"] = "Bilkent\nUniversity" } }
        XCTAssertEqual(index.universities.count, 28)
        XCTAssertEqual(issues.first, CatalogParseIssue(.university, bilkent, "name"))
        assertConsistent(index, "control character in a name")
    }

    /// Неверный Шанхай: город пропускается, его шесть вузов в «Других вузах
    /// страны», счётчики Китая пересчитаны.
    func testBrokenCityMovesItsUniversitiesToOtherUniversities() throws {
        let shanghaiIds = try universityIds(inCity: "shanghai")
        XCTAssertEqual(shanghaiIds.count, 6)
        let cases: [(String, String, (inout [String: Any]) -> Void)] = [
            ("photo outside the bucket path", "photo", { $0.update(["cities", 0, "photo"]) { $0["path"] = "photos/shanghai.jpg" } }),
            ("photo from an agency host", "photo", { $0.update(["cities", 0, "photo"]) { $0["sourceUrl"] = "https://www.eduprchina.com/photo.jpg" } }),
            ("photo with an unknown source", "photo", { $0.update(["cities", 0, "photo"]) { $0["sourceName"] = "Agency" } }),
            ("source name of another host", "photo", { $0.update(["cities", 0, "photo"]) { $0["sourceName"] = "Unsplash" } }),
            ("author with a trailing no-break space (F12)", "photo", { $0.update(["cities", 0, "photo"]) { $0["author"] = "Diana\u{00A0}" } }),
            ("author with a zero-width space", "photo", { $0.update(["cities", 0, "photo"]) { $0["author"] = "Di\u{200B}ana" } }),
            ("extra photo key", "photo", { $0.update(["cities", 0, "photo"]) { $0["caption"] = "x" } }),
            ("fact over http", "fact", { $0.update(["cities", 0, "fact"]) { $0["sourceUrl"] = "http://example.org/fact" } }),
            ("fact with a line feed", "fact", { $0.update(["cities", 0, "fact"]) { $0["ky"] = "Факт\nбар" } }),
            ("summary null", "summary", { $0.update(["cities", 0]) { $0["summary"] = NSNull() } }),
            ("summary with a soft hyphen", "summary", { $0.update(["cities", 0, "summary"]) { $0["ru"] = "Ино\u{00AD}странные студенты" } }),
            ("name with a soft hyphen", "name", { $0.update(["cities", 0, "name"]) { $0["ru"] = "Шан\u{00AD}хай" } }),
            ("name in a third language", "name", { $0.update(["cities", 0, "name"]) { $0["en"] = "Shanghai" } }),
            ("extra city key", "keys", { $0.update(["cities", 0]) { $0["lat"] = 1.0 } }),
        ]
        for (label, reason, change) in cases {
            let (index, issues) = try parsed(change)
            XCTAssertFalse(index.cities.contains { $0.key == "shanghai" }, label)
            XCTAssertEqual(issues.first, CatalogParseIssue(.city, "shanghai", reason), label)
            XCTAssertEqual(Array(issues.dropFirst().prefix(6)), shanghaiIds.map { CatalogParseIssue(.university, $0, "city") }, label)
            XCTAssertEqual(issues.last, CatalogParseIssue(.country, "CN", "count"), label)
            XCTAssertEqual(UniversityAtlasPolicy.otherUniversities(of: "CN", in: index).map { $0.id.uuidString.lowercased() }, shanghaiIds, label)
            XCTAssertEqual(index.countries[0].universityCount, 20, label)
            XCTAssertEqual(index.countries[0].cityCount, 10, label)
            assertConsistent(index, label)
        }
        // Неверный ключ города: в журнале ключа нет.
        let (index, issues) = try parsed { $0.update(["cities", 0]) { $0["key"] = "Shanghai City" } }
        XCTAssertEqual(issues.first, CatalogParseIssue(.city, nil, "key"))
        assertConsistent(index, "invalid key")
    }

    func testUniversityFieldsDegradeOneByOne() throws {
        let apu = try universityId(0)
        var (index, issues) = try parsed { $0.update(["universities", 0, "intakes", 0]) { $0["start"] = "2026-02-30" } }
        XCTAssertEqual(index.universities[0].intakes, [])
        XCTAssertEqual(issues, [CatalogParseIssue(.university, apu, "intakes")])

        (index, issues) = try parsed { $0.update(["universities", 0]) { $0["levels"] = ["bachelor", "bachelor"] } }
        XCTAssertEqual(index.universities[0].levels, ["bachelor"])
        XCTAssertEqual(issues, [CatalogParseIssue(.university, apu, "levels")])

        (index, issues) = try parsed { $0.update(["universities", 0]) { $0["levels"] = ["phd", "master"] } }
        XCTAssertEqual(index.universities[0].levels, ["master"])
        XCTAssertEqual(issues, [CatalogParseIssue(.university, apu, "levels")])

        // Порядок уровней приводится к порядку продукта без записи, как на вебе.
        (index, issues) = try parsed { $0.update(["universities", 0]) { $0["levels"] = ["master", "bachelor"] } }
        XCTAssertEqual(index.universities[0].levels, ["bachelor", "master"])
        XCTAssertEqual(issues, [])

        (index, issues) = try parsed { $0.update(["universities", 0]) { $0["nearestIntake"] = NSNull() } }
        XCTAssertEqual(index.universities[0].cityKey, "kuala-lumpur")
        XCTAssertEqual(issues, [CatalogParseIssue(.university, apu, "keys")])

        (index, issues) = try parsed { $0.update(["universities", 0]) { $0["hasCosts"] = "yes" } }
        XCTAssertFalse(index.universities[0].hasCosts)
        XCTAssertEqual(issues, [CatalogParseIssue(.university, apu, "hasCosts")])

        // Ключ фото вне библиотеки этой сборки: «фото нет», без записи.
        (index, issues) = try parsed { $0.update(["universities", 0]) { $0["photoKey"] = "no-such-key-ever" } }
        XCTAssertNil(index.universities[0].photoKey)
        XCTAssertEqual(issues, [])

        // Название вуза по правилу карточки (148), не строже базы: знак
        // нулевой ширины его не убирает.
        (index, issues) = try parsed { $0.update(["universities", 0]) { $0["name"] = "Asia\u{200B}Pacific University" } }
        XCTAssertEqual(index.universities[0].name, "Asia\u{200B}Pacific University")
        XCTAssertEqual(issues, [])
    }

    func testCountryFieldsDegradeOneByOne() throws {
        var (index, issues) = try parsed { $0.update(["countries", 0, "photo"]) { $0["author"] = " Diana" } }
        XCTAssertNil(index.countries[0].photo)
        XCTAssertEqual(issues, [CatalogParseIssue(.country, "CN", "photo")])

        // Имя агентства в данных фото (CHECK 283 `lower(photo::TEXT) !~ 'eduprchina'`).
        (index, issues) = try parsed { $0.update(["countries", 0, "photo"]) { $0["author"] = "EDUPRCHINA" } }
        XCTAssertNil(index.countries[0].photo)
        XCTAssertEqual(issues, [CatalogParseIssue(.country, "CN", "photo")])

        (index, issues) = try parsed { $0.update(["countries", 0]) { $0["name"] = ["ru": "", "ky": ""] } }
        XCTAssertEqual(index.countries[0].name, LocalizedPair(ru: "Китай", ky: "Кытай"))
        XCTAssertEqual(issues, [CatalogParseIssue(.country, "CN", "name")])

        (index, issues) = try parsed { $0.update(["countries", 0, "summary"]) { $0["ky"] = "Кытай\u{200F}" } }
        XCTAssertNil(index.countries[0].summary)
        XCTAssertEqual(issues, [CatalogParseIssue(.country, "CN", "summary")])

        (index, issues) = try parsed { $0.update(["countries", 0]) { $0["photo"] = NSNull(); $0["summary"] = NSNull() } }
        XCTAssertNil(index.countries[0].photo)
        XCTAssertNil(index.countries[0].summary)
        XCTAssertEqual(issues, [])
    }

    /// Вуз без опубликованного города допустим и попадает в «Другие вузы
    /// страны» (план 7.1: ни один вуз не пропадает).
    func testUniversityWithoutPublishedCityStaysInItsCountry() throws {
        var movedId = ""
        let (index, issues) = try parsed { value in
            var universities = value["universities"] as! [[String: Any]]
            let position = universities.firstIndex { $0["cityKey"] as? String == "shanghai" }!
            movedId = universities[position]["id"] as! String
            universities[position]["cityKey"] = NSNull()
            value["universities"] = universities
            var cities = value["cities"] as! [[String: Any]]
            let city = cities.firstIndex { $0["key"] as? String == "shanghai" }!
            cities[city]["universityCount"] = (cities[city]["universityCount"] as! Int) - 1
            value["cities"] = cities
        }
        XCTAssertEqual(issues, [])
        let others = UniversityAtlasPolicy.otherUniversities(of: "CN", in: index)
        XCTAssertEqual(others.map(\.id.uuidString).map { $0.lowercased() }, [movedId])
        XCTAssertFalse(UniversityAtlasPolicy.universities(inCity: "shanghai", in: index).contains { $0.id.uuidString.lowercased() == movedId })
        XCTAssertEqual(UniversityAtlasPolicy.universities(of: "CN", in: index).count, index.countries[0].universityCount)
        assertConsistent(index, "without city")
    }
}
