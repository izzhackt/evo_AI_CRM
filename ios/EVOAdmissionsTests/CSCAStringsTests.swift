import XCTest

/// The compiled CSCA string table: every key in RU and KY, no long dashes,
/// and none of the forbidden claims (DESIGN §6.4, §6.5; contract §1).
final class CSCAStringsTests: XCTestCase {
    private func table(_ language: String) throws -> [String: String] {
        let bundle = Bundle(for: CSCAStringsTests.self)
        let path = try XCTUnwrap(bundle.path(forResource: "CSCA", ofType: "strings", inDirectory: nil, forLocalization: language))
        var values = try XCTUnwrap(NSDictionary(contentsOfFile: path) as? [String: String])
        // Plural strings compile into the stringsdict.
        if let dictPath = bundle.path(forResource: "CSCA", ofType: "stringsdict", inDirectory: nil, forLocalization: language),
           let plurals = NSDictionary(contentsOfFile: dictPath) as? [String: Any] {
            for (key, value) in plurals {
                // The plural rule dictionary; every form is checked, «other» first.
                let rules = ((value as? [String: Any])?.values.compactMap { $0 as? [String: Any] } ?? []).first ?? [:]
                let order = ["other", "one", "two", "few", "many", "zero"]
                let forms = order.compactMap { rules[$0] as? String }
                values[key] = forms.joined(separator: " | ")
            }
        }
        return values
    }

    func testEveryKeyHasRussianAndKyrgyz() throws {
        let ru = try table("ru")
        let ky = try table("ky")
        XCTAssertGreaterThan(ru.count, 150)
        XCTAssertEqual(Set(ru.keys), Set(ky.keys))
        for (key, value) in ru { XCTAssertFalse(value.isEmpty, key) }
        for (key, value) in ky { XCTAssertFalse(value.isEmpty, key) }
    }

    func testFormatArgumentsMatchBetweenLanguages() throws {
        let ru = try table("ru")
        let ky = try table("ky")
        let pattern = try NSRegularExpression(pattern: "%(?:\\d\\$)?(?:ld|lld|@|d)")
        func count(_ s: String) -> Int {
            let first = s.components(separatedBy: " | ").first ?? s
            return pattern.numberOfMatches(in: first, range: NSRange(first.startIndex..., in: first))
        }
        for (key, value) in ru {
            XCTAssertEqual(count(value), count(ky[key] ?? ""), key)
        }
    }

    func testNoDashesAndNoForbiddenClaims() throws {
        for language in ["ru", "ky"] {
            for (key, value) in try table(language) {
                XCTAssertFalse(value.contains("\u{2014}") || value.contains("\u{2013}"), "\(language) \(key)")
                let lower = value.lowercased()
                for banned in ["перцентил", "проходной балл", "80+", "официальный партнёр", "партнёр csca", "гарант"] {
                    XCTAssertFalse(lower.contains(banned), "\(language) \(key): \(banned)")
                }
                // «балл CSCA» only as the explicit negation of the disclaimer.
                if lower.contains("балл csca") {
                    XCTAssertTrue(lower.contains("не балл csca"), "\(language) \(key)")
                }
                if lower.contains("csca баллы") {
                    XCTAssertTrue(lower.contains("csca баллы эмес"), "\(language) \(key)")
                }
            }
        }
    }
}
