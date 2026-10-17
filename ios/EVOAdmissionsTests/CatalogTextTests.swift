import XCTest

/// Одно правило текста и ссылок каталога 283 для базы, веба и iPhone
/// (контракт 2.2a, review раунда 3, F2 и F12). Векторы
/// `tests/fixtures/catalog-text-vectors.json` лежат в bundle тестов тем же
/// файлом, что проверяют SQL-набор 283 и `tests/catalog-text.test.mjs`.
final class CatalogTextTests: XCTestCase {
    private struct Vectors: Decodable {
        struct Text: Decodable { let `case`: String; let value: String; let max: Int; let ok: Bool }
        struct Link: Decodable { let `case`: String; let value: String; let ok: Bool }
        struct Agency: Decodable { let `case`: String; let value: String; let agency: Bool }
        let schema: String
        let text: [Text]
        let url: [Link]
        let agency: [Agency]
    }

    private func vectors() throws -> Vectors {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "catalog-text-vectors", withExtension: "json"),
                                "Shared vectors are missing from the test bundle")
        let vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        XCTAssertEqual(vectors.schema, "evo-catalog-text-vectors/v1")
        return vectors
    }

    func testSharedVectorsCoverTheRiskyClasses() throws {
        let vectors = try vectors()
        for sample in ["\u{00A0}", "\u{00AD}", "\u{200B}", "\u{200D}", "\u{FEFF}", "\n", "\u{2028}", "\u{3000}"] {
            XCTAssertTrue(vectors.text.contains { $0.value.unicodeScalars.contains(sample.unicodeScalars.first!) }, sample.debugDescription)
        }
        XCTAssertTrue(vectors.text.contains { $0.ok } && vectors.text.contains { !$0.ok })
        XCTAssertTrue(vectors.url.contains { $0.ok } && vectors.url.contains { !$0.ok })
        XCTAssertTrue(vectors.agency.contains { $0.agency } && vectors.agency.contains { !$0.agency })
    }

    func testTextRuleAcceptsAndRejectsExactlyTheSharedVectors() throws {
        let wrong = try vectors().text.filter { CatalogText.text($0.value, max: $0.max) != $0.ok }.map(\.case)
        XCTAssertEqual(wrong, [])
        // Только в Swift: U+0000 (в тексте Postgres его нет).
        XCTAssertFalse(CatalogText.text("Шан\u{0000}хай", max: 100))
        // Длина в кодовых точках, а не в графемах Swift: «é» из двух знаков
        // это два знака, как `char_length`.
        XCTAssertFalse(CatalogText.text("e\u{0301}", max: 1))
    }

    func testUrlAndAgencyRulesAgreeWithTheSharedVectors() throws {
        let vectors = try vectors()
        XCTAssertEqual(vectors.url.filter { CatalogText.url($0.value) != $0.ok }.map(\.case), [])
        XCTAssertEqual(vectors.agency.filter { CatalogText.agencyUrl($0.value) != $0.agency }.map(\.case), [])
        // Каждую принятую ссылку iPhone может открыть (кириллица и
        // типографский апостроф кодируются `URL` сам).
        for entry in vectors.url where entry.ok {
            XCTAssertNotNil(AtlasValue.link(entry.value), entry.case)
        }
        for entry in vectors.url where !entry.ok {
            XCTAssertNil(AtlasValue.link(entry.value), entry.case)
        }
    }

    func testPhotoSourceHostsBelongToTheNamedSource() {
        XCTAssertTrue(CatalogText.photoSourceMatches(sourceName: "Pexels", sourceUrl: "https://www.pexels.com/photo/1/"))
        XCTAssertTrue(CatalogText.photoSourceMatches(sourceName: "Wikimedia Commons", sourceUrl: "https://upload.wikimedia.org/x.jpg"))
        XCTAssertTrue(CatalogText.photoSourceMatches(sourceName: "Unsplash", sourceUrl: "https://UNSPLASH.com/photos/x"))
        XCTAssertFalse(CatalogText.photoSourceMatches(sourceName: "Unsplash", sourceUrl: "https://www.pexels.com/photo/1/"))
        XCTAssertFalse(CatalogText.photoSourceMatches(sourceName: "Pexels", sourceUrl: "https://pexels.com.evil.example/photo"))
        XCTAssertFalse(CatalogText.photoSourceMatches(sourceName: "Flickr", sourceUrl: "https://www.flickr.com/photos/x"))
        XCTAssertFalse(CatalogText.photoSourceMatches(sourceName: "Pexels", sourceUrl: "https://www.eduprchina.com/photo.jpg"))
    }

    /// Строки классов знаков, список агентств и пары источников фото те же
    /// символы, что в `src/lib/catalog-text.ts` (а тот тест веба сверяет их
    /// с миграцией 283).
    func testConstantsAreSpelledLikeTheWebModule() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("src/lib/catalog-text.ts")
        guard let web = try? String(contentsOf: url, encoding: .utf8) else { throw XCTSkip("catalog-text.ts is not readable from this test host") }
        func literal(_ name: String) throws -> String {
            let match = try XCTUnwrap(web.firstMatch(of: try Regex("export const \(name) =\\s*\"([^\"]*)\"")), name)
            return String(try XCTUnwrap(match.output[1].substring)).replacingOccurrences(of: "\\\\", with: "\\")
        }
        XCTAssertEqual(try literal("CATALOG_TEXT_FORBIDDEN_SQL"), CatalogText.forbiddenClass)
        XCTAssertEqual(try literal("CATALOG_EDGE_SPACE_SQL"), CatalogText.edgeSpaceClass)
        XCTAssertEqual(try literal("CATALOG_ASTRAL_SQL"), CatalogText.astralClass)
        let agencyBlock = try XCTUnwrap(web.firstMatch(of: #/CATALOG_AGENCY_DOMAINS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/#)).output.1
        let domains = agencyBlock.matches(of: #/"([^"]+)"/#).map { String($0.output.1) }
        XCTAssertEqual(domains, CatalogText.agencyDomains)
        for (name, hosts) in CatalogText.photoSourceHosts {
            for host in hosts { XCTAssertTrue(web.contains("\"\(host)\""), "\(name): \(host)") }
            XCTAssertTrue(web.contains(name), name)
        }
    }

    func testCharacterClassParser() {
        XCTAssertEqual(CatalogText.ranges("\\u0020\\u00A0\\u2000-\\u200A"), [0x20...0x20, 0xA0...0xA0, 0x2000...0x200A])
        XCTAssertEqual(CatalogText.ranges(CatalogText.astralClass), [0x10000...0x10FFFF])
    }

    /// Строка журнала той же формы, что `logCatalogIssue` сервера веба.
    func testDegradeLogLineHasTheWebShape() {
        XCTAssertEqual(
            CatalogParseLog.line(rpc: CatalogParseLog.indexRpc, issue: CatalogParseIssue(.city, "shanghai", "photo")),
            #"{"event":"portal_university_catalog_item_degraded","rpc":"student_university_index_v1","item":"city","key":"shanghai","reason":"photo"}"#
        )
        XCTAssertEqual(
            CatalogParseLog.line(rpc: CatalogParseLog.detailRpc, issue: CatalogParseIssue(.fxRate, nil, "invalid")),
            #"{"event":"portal_university_catalog_item_degraded","rpc":"student_university_detail_v1","item":"fx_rate","key":null,"reason":"invalid"}"#
        )
    }
}
