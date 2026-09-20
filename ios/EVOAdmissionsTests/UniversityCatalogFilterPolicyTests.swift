import XCTest

/// Паритет построения RPC-параметров каталога с веб-обёрткой `args`
/// (src/lib/v3/university-source.ts:15):
/// `p_query: filters.query || null, p_country: filters.country || null,
///  p_level: filters.level || null` — пустое значение веб передаёт как NULL,
/// iOS выражает это `nil`. Границы значений — серверная валидация веба
/// (src/lib/platform-university-catalog.ts:95): запрос ≤100 символов,
/// страна из списка UNIVERSITY_COUNTRIES, уровень из UNIVERSITY_LEVELS.
final class UniversityCatalogFilterPolicyTests: XCTestCase {

    // MARK: - p_query

    func testEmptyQueryBecomesNil() {
        // Веб: `filters.query || null` (university-source.ts:15).
        XCTAssertNil(UniversityCatalogFilterPolicy.queryParameter(UniversityCatalogFilters()))
    }

    func testNonEmptyQueryPassesThroughUnchanged() {
        let filters = UniversityCatalogFilters(query: "Sunway  ")
        // Веб не triм'ит запрос — передаём как есть.
        XCTAssertEqual(UniversityCatalogFilterPolicy.queryParameter(filters), "Sunway  ")
    }

    func testQueryClampedToWebLimitOf100() {
        // Веб-инпут: maxLength={100} (Catalog.tsx:98); сервер отвергает
        // более длинный (`text(query, 100, true)`,
        // platform-university-catalog.ts:95).
        let long = String(repeating: "а", count: 150)
        let clamped = UniversityCatalogFilterPolicy.queryParameter(
            UniversityCatalogFilters(query: long)
        )
        XCTAssertEqual(clamped?.count, 100)
    }

    // MARK: - p_country

    func testEmptyCountryBecomesNil() {
        XCTAssertNil(UniversityCatalogFilterPolicy.countryParameter(UniversityCatalogFilters()))
    }

    func testDomainCountryPasses() {
        let filters = UniversityCatalogFilters(country: "MY")
        XCTAssertEqual(UniversityCatalogFilterPolicy.countryParameter(filters), "MY")
    }

    func testNonDomainCountryBecomesNil() {
        // Веб-страница на недоменную страну отвечает 404
        // (platform-university-catalog.ts:95) — iOS не отправляет её вовсе.
        XCTAssertNil(UniversityCatalogFilterPolicy.countryParameter(
            UniversityCatalogFilters(country: "XX")
        ))
        XCTAssertNil(UniversityCatalogFilterPolicy.countryParameter(
            UniversityCatalogFilters(country: "my")
        ))
    }

    func testCountryListMirrorsWebDomainList() {
        // UNIVERSITY_COUNTRIES (platform-university-catalog.ts:7): 249 кодов,
        // без дублей, все — две заглавные латинские буквы.
        let countries = UniversityCatalogFilterPolicy.countries
        XCTAssertEqual(countries.count, 249)
        XCTAssertEqual(Set(countries).count, 249)
        for code in countries {
            XCTAssertTrue(
                code.count == 2 && code.allSatisfy { $0.isUppercase && $0.isLetter },
                "invalid code \(code)"
            )
        }
        // Выборочные якоря доменного списка.
        XCTAssertEqual(countries.first, "AD")
        XCTAssertEqual(countries.last, "ZW")
        XCTAssertTrue(countries.contains("KG"))
        XCTAssertTrue(countries.contains("CN"))
        XCTAssertTrue(countries.contains("MY"))
    }

    // MARK: - p_level

    func testEmptyLevelBecomesNil() {
        XCTAssertNil(UniversityCatalogFilterPolicy.levelParameter(UniversityCatalogFilters()))
    }

    func testDomainLevelPasses() {
        let filters = UniversityCatalogFilters(level: "bachelor")
        XCTAssertEqual(UniversityCatalogFilterPolicy.levelParameter(filters), "bachelor")
    }

    func testNonDomainLevelBecomesNil() {
        XCTAssertNil(UniversityCatalogFilterPolicy.levelParameter(
            UniversityCatalogFilters(level: "phd")
        ))
    }

    func testLevelsMirrorWebScale() {
        // UNIVERSITY_LEVELS (platform-university-catalog.ts:3) — тот же
        // состав и порядок шкалы.
        XCTAssertEqual(
            UniversityCatalogFilterPolicy.levels,
            ["language", "foundation", "diploma", "bachelor", "master", "doctorate"]
        )
    }

    // MARK: - Активность фильтров

    func testIsActiveReflectsAnyNonEmptyField() {
        XCTAssertFalse(UniversityCatalogFilters().isActive)
        XCTAssertTrue(UniversityCatalogFilters(query: "a").isActive)
        XCTAssertTrue(UniversityCatalogFilters(country: "MY").isActive)
        XCTAssertTrue(UniversityCatalogFilters(level: "master").isActive)
    }
}
