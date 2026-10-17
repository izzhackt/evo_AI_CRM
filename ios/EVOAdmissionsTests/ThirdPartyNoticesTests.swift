import XCTest

/// Экран «Лицензии» (review #1215 App Store, M3) и ссылка на политику
/// конфиденциальности (B1). Тесты читают настоящий `Package.resolved`,
/// тексты в `Resources/Licenses` и документ App Store (путь от этого файла,
/// `#filePath`), а тексты через бандл берут тем же кодом, что приложение.
final class ThirdPartyNoticesTests: XCTestCase {
    private static let iosRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    private static let licensesDir = iosRoot.appendingPathComponent("EVOAdmissions/Resources/Licenses")

    private struct Resolved: Decodable {
        struct Pin: Decodable {
            struct State: Decodable { let version: String? }
            let identity: String
            let location: String
            let state: State
        }
        let pins: [Pin]
    }

    private func pins() throws -> [Resolved.Pin] {
        let url = Self.iosRoot.appendingPathComponent(
            "EVOAdmissions.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
        )
        return try JSONDecoder().decode(Resolved.self, from: Data(contentsOf: url)).pins
    }

    /// Каждый пин `Package.resolved` есть на экране с той же версией, лишних
    /// нет: смена версии или новая зависимость требует обновить уведомления.
    func testNoticesMatchEveryResolvedPackage() throws {
        let resolved = try pins()
        XCTAssertGreaterThanOrEqual(resolved.count, 8)
        let expected = Dictionary(uniqueKeysWithValues: resolved.map { ($0.identity, $0.state.version) })
        let shown = Dictionary(uniqueKeysWithValues: ThirdPartyNotices.packages.map { ($0.identity ?? "", $0.version) })
        XCTAssertEqual(shown, expected)
        for pin in resolved {
            let notice = try XCTUnwrap(ThirdPartyNotices.packages.first { $0.identity == pin.identity })
            let repo = pin.location.replacingOccurrences(of: ".git", with: "").lowercased()
            XCTAssertEqual(notice.url.lowercased(), repo, pin.identity)
        }
    }

    /// Тексты лежат в каталоге ресурсов: MIT с уведомлением об авторских
    /// правах, Apache 2.0 с полным текстом и NOTICE (раздел 4 a, d).
    func testEveryNoticeShipsItsLicenseTexts() throws {
        let all = ThirdPartyNotices.packages + ThirdPartyNotices.fonts
        var referenced = Set<String>()
        for notice in all {
            XCTAssertFalse(notice.files.isEmpty, notice.name)
            let texts = try notice.files.map { name -> String in
                referenced.insert(name + ".txt")
                return try String(contentsOf: Self.licensesDir.appendingPathComponent(name + ".txt"), encoding: .utf8)
            }
            let joined = texts.joined(separator: "\n")
            switch notice.license {
            case "MIT":
                XCTAssertTrue(joined.contains("Permission is hereby granted"), notice.name)
                XCTAssertTrue(joined.contains("Copyright (c)"), notice.name)
            case "Apache 2.0":
                XCTAssertTrue(texts.first?.contains("Apache License") == true, notice.name)
                XCTAssertTrue(texts.first?.contains("Version 2.0, January 2004") == true, notice.name)
                XCTAssertTrue(notice.files.contains { $0.hasPrefix("notice-") }, "\(notice.name): нет NOTICE")
            default:
                XCTAssertGreaterThan(joined.count, 500, notice.name)
            }
        }
        let onDisk = Set(try FileManager.default.contentsOfDirectory(atPath: Self.licensesDir.path))
        XCTAssertEqual(onDisk, referenced, "в Resources/Licenses файлы без строки на экране или наоборот")
        let swiftMath = try XCTUnwrap(ThirdPartyNotices.packages.first { $0.identity == "swiftmath" })
        XCTAssertEqual(swiftMath.files, ["license-swiftmath", "license-iosmath"], "уведомление iosMath (MathChat)")
    }

    /// Приложение читает тексты из бандла по тем же именам.
    func testNoticeTextLoadsFromTheBundle() throws {
        let bundle = Bundle(for: ThirdPartyNoticesTests.self)
        for notice in ThirdPartyNotices.packages + ThirdPartyNotices.fonts {
            let text = try XCTUnwrap(ThirdPartyNotices.text(of: notice, in: bundle), notice.name)
            XCTAssertFalse(text.isEmpty, notice.name)
        }
        let crypto = try XCTUnwrap(ThirdPartyNotices.packages.first { $0.identity == "swift-crypto" })
        let text = try XCTUnwrap(ThirdPartyNotices.text(of: crypto, in: bundle))
        XCTAssertTrue(text.contains("Apache License"))
        XCTAssertTrue(text.contains("The SwiftCrypto Project"))
    }

    /// Ссылка в приложении совпадает с полем «Privacy Policy URL» в App Store
    /// Connect (`listing-ru.md`), иначе проверяющий увидит две разные политики.
    func testPrivacyPolicyLinkMatchesTheStoreListing() throws {
        let listing = try String(
            contentsOf: Self.iosRoot.appendingPathComponent("docs/app-store/listing-ru.md"), encoding: .utf8
        )
        let row = try XCTUnwrap(listing.components(separatedBy: "\n").first { $0.hasPrefix("| Privacy Policy URL |") })
        let value = row.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.last
        XCTAssertEqual(value, AppLinks.privacyPolicy.absoluteString)
        XCTAssertEqual(AppLinks.privacyPolicy.scheme, "https")
        XCTAssertEqual(AppLinks.privacyPolicy.host, "evoadmissions.com")
    }
}
