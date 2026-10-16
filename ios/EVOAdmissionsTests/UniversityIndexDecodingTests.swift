import XCTest

/// Строгий разбор `student_university_index_v1` (283, контракт 2.1) на
/// реальном ответе демо-стека и его точечных искажениях.
final class UniversityIndexDecodingTests: XCTestCase {
    private func full(_ data: Data) throws -> UniversityIndex {
        guard case .full(let index) = try UniversityIndexResponse.decode(data) else {
            XCTFail("Expected a full index")
            throw CocoaError(.coderInvalidValue)
        }
        return index
    }

    private func assertRejected(_ change: (inout [String: Any]) throws -> Void, file: StaticString = #filePath, line: UInt = #line) throws {
        let data = try AtlasFixtures.mutated(AtlasFixtures.index, change)
        XCTAssertThrowsError(try UniversityIndexResponse.decode(data), file: file, line: line)
    }

    func testDecodesRealDemoIndex() throws {
        let index = try full(AtlasFixtures.data(AtlasFixtures.index))
        XCTAssertTrue(index.version.hasPrefix("g1."))
        // Порядок продукта и фиксированные названия (283).
        XCTAssertEqual(index.countries.map(\.code), ["CN", "MY", "AE", "TR", "IT", "CZ"])
        XCTAssertEqual(index.countries.first?.name, LocalizedPair(ru: "Китай", ky: "Кытай"))
        XCTAssertTrue(index.countries.allSatisfy { $0.photo?.path.hasPrefix("geography/countries/") == true })
        XCTAssertEqual(index.cities.count, 19)
        XCTAssertEqual(index.universities.count, 29)
        // Сумма вузов по странам равна числу вузов (приёмка 7.6, п. 2).
        XCTAssertEqual(index.countries.map(\.universityCount).reduce(0, +), index.universities.count)
        XCTAssertEqual(index.countries.first { $0.code == "CZ" }?.universityCount, 0)
        let shanghai = try XCTUnwrap(index.cities.first { $0.key == "shanghai" })
        XCTAssertEqual(shanghai.country, "CN")
        XCTAssertEqual(shanghai.photo.sourceName, "Pexels")
        XCTAssertEqual(shanghai.fact.sourceUrl.scheme, "https")
        XCTAssertNotNil(shanghai.universityCount)
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

    func testRejectsUnknownKeysAtEveryLevel() throws {
        try assertRejected { $0["extra"] = true }
        try assertRejected { $0.update(["countries", 0]) { $0["extra"] = 1 } }
        try assertRejected { $0.update(["countries", 0, "photo"]) { $0["caption"] = "x" } }
        try assertRejected { $0.update(["cities", 0]) { $0["lat"] = 1.0 } }
        try assertRejected { $0.update(["cities", 0, "fact"]) { $0["title"] = "x" } }
        try assertRejected { $0.update(["cities", 0, "name"]) { $0["en"] = "x" } }
        try assertRejected { $0.update(["universities", 0]) { $0["nearestIntake"] = NSNull() } }
        try assertRejected { $0.update(["universities", 0, "intakes", 0]) { $0["status"] = "open" } }
    }

    func testRejectsAbsentKeyEvenWhereNullIsAllowed() throws {
        try assertRejected { $0.update(["universities", 0]) { $0.removeValue(forKey: "photoKey") } }
        try assertRejected { $0.update(["countries", 0]) { $0.removeValue(forKey: "summary") } }
        try assertRejected { $0.update(["universities", 0, "intakes", 0]) { $0.removeValue(forKey: "deadline") } }
    }

    func testAcceptsNullWhereTheContractAllowsIt() throws {
        let data = try AtlasFixtures.mutated(AtlasFixtures.index) {
            $0.update(["countries", 0]) { $0["photo"] = NSNull(); $0["summary"] = NSNull() }
            $0.update(["universities", 0]) { $0["photoKey"] = NSNull(); $0["cityLabel"] = NSNull() }
        }
        let index = try full(data)
        XCTAssertNil(index.countries[0].photo)
        XCTAssertNil(index.countries[0].summary)
        XCTAssertNil(index.universities[0].photoKey)
    }

    func testRejectsBrokenReferencesAndCounts() throws {
        // Вуз ссылается на город другой страны.
        try assertRejected { value in
            let foreign = (value["cities"] as! [[String: Any]]).first { $0["country"] as? String == "IT" }!["key"]!
            value.update(["universities", 0]) { $0["cityKey"] = foreign }
        }
        try assertRejected { $0.update(["universities", 0]) { $0["cityKey"] = "atlantis" } }
        try assertRejected { $0.update(["countries", 0]) { $0["universityCount"] = ($0["universityCount"] as! Int) + 1 } }
        try assertRejected { $0.update(["countries", 0]) { $0["cityCount"] = ($0["cityCount"] as! Int) - 1 } }
        try assertRejected { $0.update(["cities", 0]) { $0["universityCount"] = ($0["universityCount"] as! Int) + 1 } }
        // Два вуза с одним id.
        try assertRejected { value in
            let firstId = (value["universities"] as! [[String: Any]])[0]["id"]!
            value.update(["universities", 1]) { $0["id"] = firstId }
        }
    }

    func testRejectsValuesOutsideTheDomain() throws {
        try assertRejected { $0.update(["universities", 0]) { $0["levels"] = ["master", "bachelor"] } }
        try assertRejected { $0.update(["universities", 0]) { $0["levels"] = ["phd"] } }
        try assertRejected { $0.update(["universities", 0, "intakes", 0]) { $0["start"] = "2026-02-30" } }
        try assertRejected { $0.update(["cities", 0]) { $0["key"] = "Shanghai City" } }
        try assertRejected { $0.update(["cities", 0, "fact"]) { $0["sourceUrl"] = "http://example.org/fact" } }
        try assertRejected { $0.update(["cities", 0, "photo"]) { $0["path"] = "geography/cities/../../secret.jpg" } }
        try assertRejected { $0.update(["cities", 0]) { $0["photo"] = NSNull() } }
        try assertRejected { $0["version"] = "" }
    }

    /// Невидимые символы форматирования (Cf) база принимает:
    /// `catalog_text_ok(U&'Ино\00ADстранные', 300)` на демо-базе даёт `t`, и
    /// веб их тоже принимает. Один такой символ, вставленный из Word в
    /// редакторе CRM, не должен выключать весь каталог на iPhone.
    func testAcceptsFormatCharactersThatTheDatabaseAccepts() throws {
        let softHyphen = "Ино\u{00AD}странные студенты"
        let data = try AtlasFixtures.mutated(AtlasFixtures.index) { value in
            value.update(["cities", 0, "summary"]) { $0["ru"] = softHyphen }
            value.update(["universities", 0]) { $0["name"] = "Asia\u{200B}Pacific\u{200D}University\u{FEFF}" }
            value.update(["cities", 0, "fact"]) { $0["ky"] = "Факт\u{2060} бар" }
        }
        let index = try full(data)
        XCTAssertEqual(index.cities[0].summary.ru, softHyphen)
        XCTAssertEqual(index.universities[0].name, "Asia\u{200B}Pacific\u{200D}University\u{FEFF}")
    }

    /// Управляющие символы (те же, что отвергают `[[:cntrl:]]` и веб)
    /// остаются ошибкой.
    func testRejectsControlCharacters() throws {
        for character in ["\u{0000}", "\u{0007}", "\n", "\u{001F}", "\u{007F}"] {
            try assertRejected { $0.update(["cities", 0, "summary"]) { $0["ru"] = "Шанхай\(character)город" } }
            try assertRejected { $0.update(["universities", 0]) { $0["name"] = "Tongji\(character)University" } }
        }
    }

    /// Фото агентств не берём (план 4.4): ни адреса, ни имени EDUPRCHINA.
    func testRejectsAgencyPhotos() throws {
        try assertRejected { $0.update(["cities", 0, "photo"]) { $0["sourceUrl"] = "https://www.eduprchina.com/photo/1" } }
        try assertRejected { $0.update(["countries", 0, "photo"]) { $0["author"] = "EDUPRCHINA" } }
        try assertRejected { $0.update(["countries", 0, "photo"]) { $0["sourceName"] = "Flickr" } }
    }

    func testNotModifiedHasExactlyTwoKeys() throws {
        let extra = try JSONSerialization.data(withJSONObject: ["notModified": true, "version": "g1.x", "countries": []])
        XCTAssertThrowsError(try UniversityIndexResponse.decode(extra))
        let missing = try JSONSerialization.data(withJSONObject: ["notModified": true])
        XCTAssertThrowsError(try UniversityIndexResponse.decode(missing))
    }

    /// Вуз без опубликованного города допустим и попадает в «Другие вузы
    /// страны» (план 7.1: ни один вуз не пропадает).
    func testUniversityWithoutPublishedCityStaysInItsCountry() throws {
        var movedId = ""
        let data = try AtlasFixtures.mutated(AtlasFixtures.index) { value in
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
        let index = try full(data)
        let others = UniversityAtlasPolicy.otherUniversities(of: "CN", in: index)
        XCTAssertEqual(others.map(\.id.uuidString).map { $0.lowercased() }, [movedId])
        XCTAssertFalse(UniversityAtlasPolicy.universities(inCity: "shanghai", in: index).contains { $0.id.uuidString.lowercased() == movedId })
        XCTAssertEqual(UniversityAtlasPolicy.universities(of: "CN", in: index).count, index.countries[0].universityCount)
    }
}
