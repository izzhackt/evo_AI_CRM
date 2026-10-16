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
        XCTAssertEqual(names("koc"), ["Koç University"])
        XCTAssertEqual(names("xi'an"), ["Xi’an International Studies University", "Xi’an Jiaotong-Liverpool University"])
        XCTAssertEqual(names("XI’AN"), names("xi'an"))
        XCTAssertEqual(names("shanghai jiao"), ["Shanghai Jiao Tong University"])
        XCTAssertEqual(names("shanghai university"), [
            "Shanghai International Studies University", "Shanghai Jiao Tong University", "Shanghai University",
        ])
        XCTAssertTrue(names("   ").isEmpty)
        XCTAssertTrue(names("Sorbonne").isEmpty)
    }

    /// Нормализация повторяет `normalizeUniversitySearch` веба. Ожидаемые
    /// строки получены вызовом веб-функции из ветки S3.3
    /// (`src/lib/portal/university-search.ts`) на названиях production
    /// (16.10.2026), а не написаны вручную.
    func testNormalizationMatchesTheWebOnProductionNames() {
        let web: [(String, String)] = [
            ("Sabancı University", "sabanci university"),
            ("İstanbul Aydın University", "istanbul aydin university"),
            ("İstanbul Teknik Üniversitesi (İTÜ)", "istanbul teknik universitesi itu"),
            ("Boğaziçi University", "bogazici university"),
            ("Bahçeşehir University", "bahcesehir university"),
            ("Koç University", "koc university"),
            ("Middle East Technical University (METU/ODTÜ)", "middle east technical university metu odtu"),
            ("Xi’an Jiaotong-Liverpool University", "xi'an jiaotong liverpool university"),
            ("Chang’an University", "chang'an university"),
            ("Ca’ Foscari University of Venice", "ca' foscari university of venice"),
            ("Taylor’s University", "taylor's university"),
            ("Università Cattolica del Sacro Cuore", "universita cattolica del sacro cuore"),
            ("Prague University of Economics and Business (VŠE)", "prague university of economics and business vse"),
            ("GBS (Global Banking School) \u{2014} Dubai Campus", "gbs global banking school dubai campus"),
            ("Łódź University of Technology", "lodz university of technology"),
            ("Ørsted Hall", "orsted hall"),
            ("Œuvre", "ouvre"),
            ("Straße", "strasse"),
            ("Xi´an", "xi an"),
            ("Mc‘Donald", "mc'donald"),
            ("AT&T  Institute", "at&t institute"),
            ("  \u{2014}Tsinghua!  ", "tsinghua"),
        ]
        for (input, expected) in web {
            XCTAssertEqual(UniversityAtlasPolicy.normalize(input), expected, input)
        }
    }

    /// Запросы обычной латиницей находят турецкие вузы production, порядок
    /// выдачи тот же, что у веба (порядок индекса).
    func testSearchFindsProductionTurkishNamesInIndexOrder() throws {
        let production = [
            "Sabancı University", "İstanbul Aydın University", "İstanbul Teknik Üniversitesi (İTÜ)",
            "Istanbul University", "Middle East Technical University (METU/ODTÜ)",
        ]
        let data = try AtlasFixtures.mutated(AtlasFixtures.index) { value in
            for (position, name) in production.enumerated() {
                value.update(["universities", position]) { $0["name"] = name }
            }
        }
        guard case .full(let renamed) = try UniversityIndexResponse.decode(data) else { return XCTFail("Expected a full index") }
        let names = { (query: String) in UniversityAtlasPolicy.search(query, in: renamed.universities).map(\.name) }
        XCTAssertEqual(names("sabanci"), ["Sabancı University"])
        XCTAssertEqual(names("Sabancı"), ["Sabancı University"])
        XCTAssertEqual(names("aydin"), ["İstanbul Aydın University"])
        XCTAssertEqual(names("odtu"), ["Middle East Technical University (METU/ODTÜ)"])
        XCTAssertTrue(names("itu").contains("İstanbul Teknik Üniversitesi (İTÜ)"))
        // Порядок индекса, без подъёма совпадений с начала названия.
        XCTAssertEqual(names("istanbul"), ["İstanbul Aydın University", "İstanbul Teknik Üniversitesi (İTÜ)", "Istanbul University"])
        XCTAssertEqual(names("university istanbul"), ["İstanbul Aydın University", "Istanbul University"])
        // Как на вебе: без апострофа «xian» не находит «Xi’an» (вопрос
        // владельцу: поменять правило на обеих платформах сразу).
        XCTAssertTrue(UniversityAtlasPolicy.search("xian", in: index.universities).isEmpty)
    }

    // MARK: - Группы и подписи

    /// Как `countryCities` веба: больше вузов выше, затем по названию на
    /// языке интерфейса. В кыргызском «Бээжин» стоит первым среди городов с
    /// одним вузом, в русском «Пекин» после «Нинбо».
    func testCityOrderFollowsTheInterfaceLanguage() {
        let ru = UniversityAtlasPolicy.cities(of: "CN", in: index, kyrgyz: false)
        let ky = UniversityAtlasPolicy.cities(of: "CN", in: index, kyrgyz: true)
        XCTAssertEqual(ru.map(\.key), index.cities.filter { $0.country == "CN" }.map(\.key))
        let single = { (cities: [AtlasCity]) in cities.filter { $0.universityCount == 1 }.map(\.key) }
        XCTAssertEqual(single(ru), ["nanjing", "ningbo", "beijing", "suzhou", "harbin", "chongqing"])
        XCTAssertEqual(single(ky), ["beijing", "nanjing", "ningbo", "suzhou", "harbin", "chongqing"])
        XCTAssertEqual(ky.prefix(1).map(\.key), ["shanghai"])
    }

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

    /// Фото вуза: только управляемая копия, если перенос проверен (то же
    /// правило, что `resolveManagedUniversityPhotoUrl` веба после его review
    /// раунда 1); без копии адресов нет, прямой ссылки библиотеки тоже нет
    /// (приёмка 7.6.5); неизвестный ключ: фото нет.
    func testUniversityPhotoUsesOnlyTheManagedCopy() throws {
        let library = UniversityPhotoLibrary.load(from: Bundle(for: Self.self)) ?? [:]
        let key = try XCTUnwrap(library.keys.sorted().first)
        let hotlink = try XCTUnwrap(library[key]?.path)
        let migrated = [key: UniversityPhotoManifestEntry(status: "verified", migrated: true, objectPath: "\(key).jpg")]
        let managed = AtlasPhotoURL.university(photoKey: key, library: library, manifest: migrated, base: base, width: 800)
        XCTAssertEqual(managed.candidates.map(\.url.absoluteString), [
            "http://127.0.0.1:45421/storage/v1/render/image/public/portal-university-photos/\(key).jpg?width=800&quality=70",
            "http://127.0.0.1:45421/storage/v1/object/public/portal-university-photos/\(key).jpg",
        ])
        XCTAssertFalse(managed.candidates.map(\.url.absoluteString).contains(hotlink))
        XCTAssertTrue(AtlasPhotoURL.hasUniversityPhoto(photoKey: key, library: library, manifest: migrated))

        // Не перенесено, отклонено, сбой переноса или чужой файл: фото нет.
        let rejected: [UniversityPhotoManifestEntry] = [
            .init(status: "verified", migrated: false, objectPath: "\(key).jpg"),
            .init(status: "ineligible", migrated: false, objectPath: nil),
            .init(status: "failed", migrated: false, objectPath: nil),
            .init(status: "verified", migrated: true, objectPath: "other-key.jpg"),
        ]
        for entry in rejected {
            let manifest = [key: entry]
            XCTAssertTrue(AtlasPhotoURL.university(photoKey: key, library: library, manifest: manifest, base: base, width: 800)
                .candidates.isEmpty, "\(entry)")
            XCTAssertFalse(AtlasPhotoURL.hasUniversityPhoto(photoKey: key, library: library, manifest: manifest))
        }
        XCTAssertTrue(AtlasPhotoURL.university(photoKey: key, library: library, manifest: [:], base: base, width: 800)
            .candidates.isEmpty)
        XCTAssertTrue(AtlasPhotoURL.university(photoKey: "unknown-key", library: library, manifest: migrated, base: base, width: 800)
            .candidates.isEmpty)
        XCTAssertTrue(AtlasPhotoURL.university(photoKey: nil, library: library, manifest: migrated, base: base, width: 800)
            .candidates.isEmpty)
    }

    /// Настоящие библиотека и манифест репозитория (тот же файл, что в
    /// сборке приложения) и все ключи фото живого индекса демо: ни один
    /// адрес фото вуза не ведёт мимо бакета, и фото есть ровно у
    /// перенесённых записей (review раунда 2, N2).
    func testNoUniversityPhotoLeavesTheBucketWithTheRealManifest() throws {
        let library = UniversityPhotoLibrary.load(from: Bundle(for: Self.self)) ?? [:]
        XCTAssertFalse(library.isEmpty)
        let url = iosRoot.deletingLastPathComponent().appendingPathComponent("scripts/portal/university-photos-manifest.json")
        guard let data = try? Data(contentsOf: url) else { throw XCTSkip("Manifest is not readable from this test host") }
        let manifest = try XCTUnwrap(UniversityPhotoManifest.decode(data))
        XCTAssertFalse(manifest.isEmpty)

        let bucketPrefixes = [
            "http://127.0.0.1:45421/storage/v1/object/public/portal-university-photos/",
            "http://127.0.0.1:45421/storage/v1/render/image/public/portal-university-photos/",
        ]
        let keys = Set(library.keys).union(index.universities.compactMap(\.photoKey))
        var shown = 0
        for key in keys.sorted() {
            let source = AtlasPhotoURL.university(photoKey: key, library: library, manifest: manifest, base: base, width: 640)
            for candidate in source.candidates {
                XCTAssertTrue(bucketPrefixes.contains { candidate.url.absoluteString.hasPrefix($0) }, "\(key): \(candidate.url)")
                XCTAssertNotEqual(candidate.url.absoluteString, library[key]?.path)
            }
            let entry = manifest[key]
            let migrated = entry?.status == "verified" && entry?.migrated == true && library[key] != nil
            XCTAssertEqual(!source.candidates.isEmpty, migrated, key)
            if migrated { shown += 1 }
        }
        XCTAssertGreaterThan(shown, 0)
    }

    /// Подпись «Фото: <вуз>, официальный сайт» только для точных строк
    /// лицензии официальных медиа (как `OFFICIAL_MEDIA_LICENSES` веба).
    func testOfficialMediaLicensesMatchTheWeb() throws {
        XCTAssertTrue(UniversityPhotoRights.isOfficialMedia(license: "Official-source embedding; no reuse license stated"))
        XCTAssertTrue(UniversityPhotoRights.isOfficialMedia(license: "All rights reserved; official-source embedding"))
        XCTAssertFalse(UniversityPhotoRights.isOfficialMedia(license: "CC BY-SA 4.0"))
        XCTAssertFalse(UniversityPhotoRights.isOfficialMedia(license: "official-source embedding"))
        let url = iosRoot.deletingLastPathComponent().appendingPathComponent("src/lib/university-photo-rights.ts")
        guard let web = try? String(contentsOf: url, encoding: .utf8) else { throw XCTSkip("Web source is not readable from this test host") }
        for license in UniversityPhotoRights.officialMediaLicenses {
            XCTAssertTrue(web.contains("\"\(license)\""), license)
        }
    }

    private var iosRoot: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    }

    private func appSource(_ path: String) throws -> String {
        let url = iosRoot.appendingPathComponent("EVOAdmissions/\(path)")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            throw XCTSkip("\(path) is not readable from this test host")
        }
        return text
    }

    // MARK: - Навигация

    /// Обязательный шаг слияния с #1172 (review раунда 2, N3): там строки
    /// «Избранного» становятся `NavigationLink(value: FavoriteUniversityRoute)`,
    /// а экран для этого значения регистрирует только
    /// `.portalRouteDestinations()`. Текстового конфликта нет, поэтому после
    /// слияния этот тест падает, пока вкладка «Университеты» не
    /// зарегистрирует те же экраны и не откроет «Избранное» значением
    /// `PortalRoute.favorites`. Ссылка по значению без экрана в стеке в
    /// SwiftUI не переходит.
    func testFavoritesRowsHaveADestinationInTheUniversitiesTab() throws {
        let favorites = try appSource("Views/FavoritesView.swift")
        let atlas = try appSource("Views/UniversityAtlasView.swift")
        let valueTypes = Set(favorites.matches(of: #/NavigationLink\(value:\s*([A-Z][A-Za-z]*)\(/#).map { String($0.output.1) })
        for type in valueTypes where !favorites.contains("navigationDestination(for: \(type).self") {
            XCTAssertTrue(
                atlas.contains(".portalRouteDestinations()"),
                "FavoritesView открывает вуз значением \(type), а UniversityAtlasView не регистрирует для него экран: добавьте .portalRouteDestinations() и NavigationLink(value: PortalRoute.favorites)"
            )
        }
        // Сейчас (до #1172) строки открывают вуз по `UUID`, и экран
        // регистрирует сам FavoritesView или корень вкладки.
        if favorites.contains("NavigationLink(value: item.id)") {
            XCTAssertTrue(
                favorites.contains("navigationDestination(for: UUID.self") || atlas.contains("navigationDestination(for: UUID.self"),
                "строки «Избранного» по UUID без экрана"
            )
        }
    }

    // MARK: - Экраны страны и города без индекса

    /// Экран страны или города, открытый со страницы вуза до загрузки
    /// индекса: скелет, сбой с повтором и «места нет» различаются (N1).
    func testPlaceStateSeparatesLoadingFailureAndMissing() throws {
        let code = try XCTUnwrap(index.countries.first?.code)
        let cityKey = try XCTUnwrap(index.cities.first?.key)
        for phase: UniversityIndexStore.Phase in [.idle, .loading] {
            guard case .loading = UniversityAtlasPolicy.countryState(code: code, index: nil, phase: phase) else {
                return XCTFail("\(phase): expected loading")
            }
            guard case .loading = UniversityAtlasPolicy.cityState(key: cityKey, index: nil, phase: phase) else {
                return XCTFail("\(phase): expected loading")
            }
        }
        for failure: UniversityIndexStore.Failure in [.connection, .unavailable] {
            guard case .failed(let shown) = UniversityAtlasPolicy.countryState(code: code, index: nil, phase: .failed(failure)) else {
                return XCTFail("expected failed")
            }
            XCTAssertEqual(shown, failure)
            guard case .failed = UniversityAtlasPolicy.cityState(key: cityKey, index: nil, phase: .failed(failure)) else {
                return XCTFail("expected failed")
            }
        }
        guard case .ready(_, let country) = UniversityAtlasPolicy.countryState(code: code, index: index, phase: .ready) else {
            return XCTFail("expected ready")
        }
        XCTAssertEqual(country.code, code)
        guard case .ready(_, let city) = UniversityAtlasPolicy.cityState(key: cityKey, index: index, phase: .ready) else {
            return XCTFail("expected ready")
        }
        XCTAssertEqual(city.key, cityKey)
        // Индекс есть (в том числе копия при неудачной сверке), а места нет.
        guard case .missing = UniversityAtlasPolicy.countryState(code: "FR", index: index, phase: .ready) else {
            return XCTFail("expected missing")
        }
        guard case .missing = UniversityAtlasPolicy.cityState(key: "paris", index: index, phase: .failed(.connection)) else {
            return XCTFail("expected missing")
        }
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
