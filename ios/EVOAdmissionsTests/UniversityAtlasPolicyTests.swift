import XCTest

/// Правила экранов «страна → город → вуз», адреса фото и копия индекса на
/// диске (университеты v2, план 7.3, 7.4, контракт 2.4, 2.5).
final class UniversityAtlasPolicyTests: XCTestCase {
    private var index: UniversityIndex!

    override func setUpWithError() throws {
        guard case .full(let decoded) = try UniversityIndexResponse.decode(AtlasFixtures.data(AtlasFixtures.index)) else {
            return XCTFail("Expected a full index")
        }
        index = decoded
    }

    // MARK: - Поиск

    func testSearchFindsByNameAcrossCountriesIgnoringCaseAndDiacritics() {
        let names = { (query: String) in UniversityAtlasPolicy.search(query, in: self.index.universities).map(\.name) }
        XCTAssertEqual(names("tongji"), ["Tongji University"])
        XCTAssertEqual(names("BOGAZICI"), ["Boğaziçi University"])
        XCTAssertEqual(Set(names("xian")), ["Xi’an International Studies University", "Xi’an Jiaotong-Liverpool University"])
        XCTAssertEqual(Set(names("xi'an")), Set(names("xian")))
        XCTAssertEqual(names("shanghai jiao"), ["Shanghai Jiao Tong University"])
        // Сначала названия, которые начинаются с запроса.
        let shanghai = names("shanghai")
        XCTAssertEqual(shanghai.prefix(3).allSatisfy { $0.hasPrefix("Shanghai") }, true)
        XCTAssertTrue(names("   ").isEmpty)
        XCTAssertTrue(names("Sorbonne").isEmpty)
    }

    // MARK: - Группы и подписи

    func testCitiesKeepServerOrderAndBelongToTheirCountry() {
        let cities = UniversityAtlasPolicy.cities(of: "CN", in: index)
        XCTAssertFalse(cities.isEmpty)
        XCTAssertTrue(cities.allSatisfy { $0.country == "CN" })
        let counts = cities.compactMap(\.universityCount)
        XCTAssertEqual(counts, counts.sorted(by: >))
        XCTAssertEqual(counts.reduce(0, +) + UniversityAtlasPolicy.otherUniversities(of: "CN", in: index).count,
                       index.countries[0].universityCount)
        XCTAssertTrue(UniversityAtlasPolicy.cities(of: "CZ", in: index).isEmpty)
    }

    func testPlaceLineAndCityName() throws {
        let tongji = try XCTUnwrap(index.universities.first { $0.name == "Tongji University" })
        XCTAssertEqual(UniversityAtlasPolicy.cityName(for: tongji, in: index, kyrgyz: false), "Шанхай")
        let detail = try DetailUnderTest.decode(AtlasFixtures.data(AtlasFixtures.tongji))
        XCTAssertEqual(UniversityAtlasPolicy.placeLine(country: detail.country, city: detail.city, kyrgyz: false), "Китай › Шанхай")
        XCTAssertEqual(UniversityAtlasPolicy.placeLine(country: detail.country, city: detail.city, kyrgyz: true), "Кытай › Шанхай")
    }

    func testPluralForms() {
        XCTAssertEqual([1, 21, 101].map { UniversityAtlasPolicy.pluralForm($0, kyrgyz: false) }, [.one, .one, .one])
        XCTAssertEqual([2, 3, 4, 22, 34].map { UniversityAtlasPolicy.pluralForm($0, kyrgyz: false) }, [.few, .few, .few, .few, .few])
        XCTAssertEqual([0, 5, 11, 12, 14, 20, 47].map { UniversityAtlasPolicy.pluralForm($0, kyrgyz: false) },
                       [.many, .many, .many, .many, .many, .many, .many])
        XCTAssertEqual(UniversityAtlasPolicy.pluralForm(3, kyrgyz: true), .many)
    }

    // MARK: - Ближайший набор

    private func date(_ value: String) -> Date {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: value + "T12:00:00Z")!
    }

    func testNearestIntakePrefersAFutureDeadline() {
        let intakes = [
            UniversityIndexIntake(deadline: "2026-09-01", start: "2026-12-01", startMonth: nil),
            UniversityIndexIntake(deadline: "2027-03-31", start: "2027-09-01", startMonth: "2027-09"),
            UniversityIndexIntake(deadline: "2027-01-15", start: nil, startMonth: "2027-02"),
        ]
        let nearest = UniversityAtlasPolicy.nearestIntake(intakes, now: date("2026-10-16"))
        XCTAssertEqual(nearest?.kind, .deadline)
        XCTAssertEqual(nearest?.value, "2027-01-15")
    }

    func testNearestIntakeFallsBackToStartDayOrMonth() {
        let intakes = [
            UniversityIndexIntake(deadline: nil, start: "2026-11-24", startMonth: "2026-11"),
            UniversityIndexIntake(deadline: nil, start: nil, startMonth: "2026-10"),
            UniversityIndexIntake(deadline: "2026-01-01", start: "2026-02-01", startMonth: nil),
        ]
        let nearest = UniversityAtlasPolicy.nearestIntake(intakes, now: date("2026-10-16"))
        XCTAssertEqual(nearest?.kind, .startMonth)
        XCTAssertEqual(nearest?.value, "2026-10")
        let later = UniversityAtlasPolicy.nearestIntake(intakes, now: date("2026-11-02"))
        XCTAssertEqual(later?.kind, .start)
        XCTAssertEqual(later?.value, "2026-11-24")
        XCTAssertNil(UniversityAtlasPolicy.nearestIntake(intakes, now: date("2027-01-01")))
    }

    // MARK: - Карта

    func testMapPinsOnlyForVerifiedCoordinates() throws {
        let universities = UniversityAtlasPolicy.universities(of: "MY", in: index)
        let apu = try XCTUnwrap(universities.first { $0.photoKey == "apu" })
        let geo = ["apu": UniversityGeoEntry(lat: 3.05, lng: 101.7, sourceUrl: "https://www.wikidata.org/wiki/Q1", verifiedOn: "2026-10-01")]
        let selection = UniversityAtlasPolicy.mapPins(for: universities, geo: geo) { _ in "Куала-Лумпур" }
        XCTAssertEqual(selection.pins.map(\.id), [apu.id])
        XCTAssertEqual(selection.pins.first?.city, "Куала-Лумпур")
        XCTAssertEqual(selection.missing, universities.count - 1)
    }

    // MARK: - Адреса фото

    private let base = URL(string: "http://127.0.0.1:45421/")!

    func testGeographyPhotoTriesTheSizedVariantThenTheOriginal() throws {
        let photo = try XCTUnwrap(index.countries[0].photo)
        let source = AtlasPhotoURL.geography(photo, base: base, width: 640)
        XCTAssertEqual(source.candidates.map(\.url.absoluteString), [
            "http://127.0.0.1:45421/storage/v1/render/image/public/portal-university-photos/\(photo.path)?width=640&quality=70",
            "http://127.0.0.1:45421/storage/v1/object/public/portal-university-photos/\(photo.path)",
        ])
        XCTAssertEqual(source.candidates.map(\.sized), [true, false])
    }

    func testObjectPathsCannotEscapeTheBucket() {
        XCTAssertNil(AtlasPhotoURL.original(base: base, path: "../secret.jpg"))
        XCTAssertNil(AtlasPhotoURL.original(base: base, path: "geography/cities/../x.jpg"))
        XCTAssertNil(AtlasPhotoURL.sized(base: base, path: "Geography/X.jpg", width: 640))
        XCTAssertNil(AtlasPhotoURL.sized(base: base, path: "a.jpg?width=1", width: 640))
        XCTAssertNotNil(AtlasPhotoURL.original(base: base, path: "tongji-university.jpg"))
    }

    func testWidthSteps() {
        XCTAssertEqual(AtlasPhotoURL.widthStep(points: 175, scale: 3), 640)
        XCTAssertEqual(AtlasPhotoURL.widthStep(points: 64, scale: 3), 320)
        XCTAssertEqual(AtlasPhotoURL.widthStep(points: 370, scale: 3), 1280)
        XCTAssertEqual(AtlasPhotoURL.widthStep(points: 2000, scale: 3), 2048)
    }

    /// Фото вуза: управляемая копия, если перенос проверен (то же правило,
    /// что `resolveUniversityPhotoUrl` веба), иначе прямая ссылка
    /// библиотеки; неизвестный ключ: фото нет.
    func testUniversityPhotoUsesTheManagedCopyOnlyWhenMigrated() throws {
        let library = UniversityPhotoLibrary.load(from: Bundle(for: Self.self)) ?? [:]
        let key = try XCTUnwrap(library.keys.sorted().first)
        let hotlink = try XCTUnwrap(library[key]?.path)
        let migrated = [key: UniversityPhotoManifestEntry(status: "verified", migrated: true, objectPath: "\(key).jpg")]
        let managed = AtlasPhotoURL.university(photoKey: key, library: library, manifest: migrated, base: base, width: 800)
        XCTAssertEqual(managed.candidates.map(\.url.absoluteString), [
            "http://127.0.0.1:45421/storage/v1/render/image/public/portal-university-photos/\(key).jpg?width=800&quality=70",
            "http://127.0.0.1:45421/storage/v1/object/public/portal-university-photos/\(key).jpg",
            hotlink,
        ])

        let pending = [key: UniversityPhotoManifestEntry(status: "verified", migrated: false, objectPath: "\(key).jpg")]
        XCTAssertEqual(AtlasPhotoURL.university(photoKey: key, library: library, manifest: pending, base: base, width: 800)
            .candidates.map(\.url.absoluteString), [hotlink])
        let foreign = [key: UniversityPhotoManifestEntry(status: "verified", migrated: true, objectPath: "other-key.jpg")]
        XCTAssertEqual(AtlasPhotoURL.university(photoKey: key, library: library, manifest: foreign, base: base, width: 800)
            .candidates.count, 1)
        XCTAssertTrue(AtlasPhotoURL.university(photoKey: "unknown-key", library: library, manifest: migrated, base: base, width: 800)
            .candidates.isEmpty)
        XCTAssertTrue(AtlasPhotoURL.university(photoKey: nil, library: library, manifest: migrated, base: base, width: 800)
            .candidates.isEmpty)
    }

    // MARK: - Копия индекса на диске

    func testDiskCacheKeepsTheExactBodyPerOrganization() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("atlas-cache-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = UniversityIndexDiskCache(directory: directory)
        let organization = UUID()
        let other = UUID()
        XCTAssertNil(cache.read(organizationId: organization))

        try cache.write(AtlasFixtures.data(AtlasFixtures.index), organizationId: organization)
        XCTAssertEqual(cache.read(organizationId: organization), index)
        XCTAssertNil(cache.read(organizationId: other))

        // notModified не перезаписывает копию.
        try cache.write(AtlasFixtures.data(AtlasFixtures.notModified), organizationId: organization)
        XCTAssertEqual(cache.read(organizationId: organization)?.version, index.version)

        // Повреждённая копия удаляется и не показывается.
        try Data("{\"notModified\":false}".utf8).write(to: cache.fileURL(organizationId: organization))
        XCTAssertNil(cache.read(organizationId: organization))
        XCTAssertFalse(FileManager.default.fileExists(atPath: cache.fileURL(organizationId: organization).path))
    }
}
