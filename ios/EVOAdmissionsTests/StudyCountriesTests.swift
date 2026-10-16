import XCTest

/// Один список стран продукта (282): iPhone читает тот же файл, что веб и
/// CRM (`src/lib/study-countries.json`, ресурс bundle через project.yml).
final class StudyCountriesTests: XCTestCase {
    func testBundledLibraryIsTheProductList() throws {
        let library = try XCTUnwrap(
            StudyCountries.load(from: Bundle(for: StudyCountriesTests.self)),
            "study-countries.json is missing from the test bundle"
        )
        XCTAssertEqual(library.countries.map(\.code), ["CN", "MY", "AE", "TR", "IT", "CZ"])
        XCTAssertEqual(library.undecided.code, StudyCountries.undecidedCode)
        XCTAssertEqual(StudyCountries.library, library)
        XCTAssertEqual(StudyCountries.codes, library.countries.map(\.code))
        for country in library.countries {
            XCTAssertFalse(country.ru.isEmpty)
            XCTAssertFalse(country.ky.isEmpty)
        }
    }

    func testNamesFollowTheInterfaceLanguage() {
        XCTAssertEqual(StudyCountries.name(for: "CN", kyrgyz: false), "Китай")
        XCTAssertEqual(StudyCountries.name(for: "CN", kyrgyz: true), "Кытай")
        XCTAssertEqual(StudyCountries.name(for: "undecided", kyrgyz: false), "Пока не решил")
        XCTAssertNil(StudyCountries.name(for: "PL", kyrgyz: false))
        XCTAssertEqual(StudyCountries.options(kyrgyz: false).map(\.code), ["CN", "MY", "AE", "TR", "IT", "CZ"])
        XCTAssertEqual(StudyCountries.options(kyrgyz: false, undecided: true).last?.code, "undecided")
    }
}
