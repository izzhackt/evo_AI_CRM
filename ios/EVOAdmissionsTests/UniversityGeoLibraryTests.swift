import XCTest

/// The bundled geo library is the SAME file the web map renders
/// (`src/lib/university-geo-library.json`, wired into both bundles by
/// ios/project.yml) — these tests decode the real file, not a fixture.
final class UniversityGeoLibraryTests: XCTestCase {
    private func loadLibrary() throws -> [String: UniversityGeoEntry] {
        let bundle = Bundle(for: UniversityGeoLibraryTests.self)
        return try XCTUnwrap(
            UniversityGeoLibrary.load(from: bundle),
            "university-geo-library.json must be bundled and decodable"
        )
    }

    func testEveryEntryCarriesValidCoordinatesAndProvenance() throws {
        let library = try loadLibrary()
        // 126 записей на момент 9b (PORT-3a); рост допустим, усушка — нет.
        XCTAssertGreaterThanOrEqual(library.count, 126)
        for (key, entry) in library {
            XCTAssertTrue((-90.0...90.0).contains(entry.lat), "lat for \(key)")
            XCTAssertTrue((-180.0...180.0).contains(entry.lng), "lng for \(key)")
            // Провенанс: сущность Wikidata по https и дата сверки YYYY-MM-DD.
            XCTAssertTrue(entry.sourceUrl.hasPrefix("https://"), "source for \(key)")
            XCTAssertNotNil(
                entry.verifiedOn.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression),
                "verifiedOn for \(key)"
            )
        }
    }

    func testKnownKeyResolves() throws {
        // 'sunway' — один из четырёх исходных ключей миграции 148, есть и в
        // фото-, и в гео-библиотеке.
        let library = try loadLibrary()
        let sunway = try XCTUnwrap(library["sunway"])
        XCTAssertEqual(sunway.lat, 3.067, accuracy: 0.5)
        XCTAssertEqual(sunway.lng, 101.6, accuracy: 0.5)
    }

    func testUnknownKeyFallsBackHonestly() {
        XCTAssertNil(UniversityGeoLibrary.entry(for: nil))
        // shared грузится из app-бандла; в hostless-тестах его нет — важно,
        // что отсутствие ресурса даёт nil, а не аварию или выдуманную точку.
        XCTAssertNil(UniversityGeoLibrary.entry(for: "no-such-key-ever"))
    }
}
