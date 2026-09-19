import XCTest

/// The bundled photo library is the SAME file the web portal renders
/// (`src/lib/university-photo-library.json`, wired into both bundles by
/// ios/project.yml) — these tests decode the real file, not a fixture.
final class UniversityPhotoLibraryTests: XCTestCase {
    private func loadLibrary() throws -> [String: UniversityPhoto] {
        let bundle = Bundle(for: UniversityPhotoLibraryTests.self)
        return try XCTUnwrap(
            UniversityPhotoLibrary.load(from: bundle),
            "university-photo-library.json must be bundled and decodable"
        )
    }

    func testEveryEntryCarriesUrlAndAttribution() throws {
        let library = try loadLibrary()
        XCTAssertGreaterThanOrEqual(library.count, 144)
        // Ровно два CC0-deed в библиотеке исторически записаны с http:// —
        // это реальные данные веба (src/lib/university-photo-library.json,
        // строки 144 и 756). Тест допускает именно эти два адреса, а не
        // любую http-схему, чтобы третья регрессия на http:// не прошла
        // незамеченной.
        let knownHttpLicenseUrl = "http://creativecommons.org/publicdomain/zero/1.0/deed.en"
        var httpLicenseUrlCount = 0
        for (key, photo) in library {
            XCTAssertTrue(photo.path.hasPrefix("https://"), "photo url for \(key)")
            XCTAssertFalse(photo.author.isEmpty, "author for \(key)")
            XCTAssertFalse(photo.caption.isEmpty, "caption for \(key)")
            XCTAssertFalse(photo.license.isEmpty, "license for \(key)")
            XCTAssertTrue(photo.sourceUrl.hasPrefix("https://"), "source for \(key)")
            if photo.licenseUrl == knownHttpLicenseUrl {
                httpLicenseUrlCount += 1
            } else {
                XCTAssertTrue(photo.licenseUrl.hasPrefix("https://"), "license url for \(key)")
            }
        }
        XCTAssertEqual(httpLicenseUrlCount, 2, "exactly two CC0-deed entries should use http://")
    }

    func testKnownKeyFromMigration148Resolves() throws {
        // 'sunway' is one of the four original keys in migration 148.
        let library = try loadLibrary()
        let sunway = try XCTUnwrap(library["sunway"])
        XCTAssertEqual(sunway.license, "CC BY-SA 4.0")
        XCTAssertEqual(sunway.author, "Cmglee")
    }

    func testUnknownKeyFallsBackHonestly() {
        XCTAssertNil(UniversityPhotoLibrary.photo(for: nil))
        // shared грузится из app-бандла; в hostless-тестах его нет — важно,
        // что отсутствие ресурса даёт nil, а не аварию или выдуманное фото.
        XCTAssertNil(UniversityPhotoLibrary.photo(for: "no-such-key-ever"))
    }
}
