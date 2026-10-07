import XCTest

/// Аудит UX/UI 2026-10 (L10N-01): «Моё поступление» показывало
/// `prep_status_preparation` вместо «Подготовка». Тесты читают настоящий
/// каталог `Localizable.xcstrings` и исходники приложения (путь от этого
/// файла, `#filePath`), без копий и фикстур.
final class LocalizationKeysTests: XCTestCase {
    private static let iosRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    private static let appSources = iosRoot.appendingPathComponent("EVOAdmissions")

    private struct Catalog: Decodable {
        struct Entry: Decodable {
            struct Localization: Decodable {
                struct Unit: Decodable { let value: String }
                let stringUnit: Unit?
            }
            let localizations: [String: Localization]?
        }
        let strings: [String: Entry]
    }

    private func catalog() throws -> [String: Catalog.Entry] {
        let url = Self.appSources.appendingPathComponent("Resources/Localizable.xcstrings")
        return try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: url)).strings
    }

    private func assertTranslated(_ key: String, in strings: [String: Catalog.Entry],
                                  file: StaticString = #filePath, line: UInt = #line) {
        guard let entry = strings[key] else {
            XCTFail("ключа \(key) нет в каталоге", file: file, line: line)
            return
        }
        for language in ["ru", "ky"] {
            let value = entry.localizations?[language]?.stringUnit?.value ?? ""
            XCTAssertFalse(value.trimmingCharacters(in: .whitespaces).isEmpty,
                           "\(key): нет перевода \(language)", file: file, line: line)
            XCTAssertNotEqual(value, key, "\(key): перевод \(language) равен ключу", file: file, line: line)
        }
    }

    func testEveryServerStatusHasTranslatedLabel() throws {
        let strings = try catalog()
        CatalogPreparationApplicationStatus.allCases.forEach { assertTranslated($0.labelKey, in: strings) }
        ApplicationPackageReadyReason.allCases.forEach { assertTranslated($0.labelKey, in: strings) }
        ApplicationPackageDecision.allCases.forEach { assertTranslated($0.labelKey, in: strings) }
        ApplicationRequirementReviewDecision.allCases.forEach { assertTranslated($0.labelKey, in: strings) }
        ApplicationRequirementUnavailableReason.allCases.forEach { assertTranslated($0.labelKey, in: strings) }
        ApplicationDocumentUnavailableReason.allCases.forEach { assertTranslated($0.labelKey, in: strings) }
        StudentApplication.Status.allCases.forEach { assertTranslated($0.titleKey, in: strings) }
    }

    func testStatusKeysKeepTheirWireNames() {
        // Ключ строится из того же значения, что приходит с сервера, поэтому
        // перевод не теряется при добавлении нового статуса в каталог.
        XCTAssertEqual(CatalogPreparationApplicationStatus.underReview.labelKey, "prep_status_under_review")
        XCTAssertEqual(ApplicationPackageReadyReason.previousSubmissionChanged.labelKey,
                       "package_reason_previous_submission_changed")
        XCTAssertEqual(ApplicationRequirementReviewDecision.correctionRequired.labelKey,
                       "prep_review_correction_required")
        for status in CatalogPreparationApplicationStatus.allCases {
            XCTAssertEqual(status.labelKey, "prep_status_" + status.rawValue)
        }
        for reason in ApplicationRequirementUnavailableReason.allCases {
            XCTAssertEqual(reason.labelKey, "prep_file_" + reason.rawValue)
        }
        for reason in ApplicationDocumentUnavailableReason.allCases {
            XCTAssertEqual(reason.labelKey, "prep_file_" + reason.rawValue)
        }
    }

    private func swiftSources() throws -> [(name: String, text: String)] {
        let files = try XCTUnwrap(FileManager.default.enumerator(at: Self.appSources, includingPropertiesForKeys: nil))
        return try files.compactMap { $0 as? URL }
            .filter { $0.pathExtension == "swift" }
            .map { ($0.lastPathComponent, try String(contentsOf: $0, encoding: .utf8)) }
    }

    /// `LocalizedStringKey("…\(x)…")` ищет в каталоге ключ с `%@` и
    /// показывает сырой ключ. Ключ с переменной частью собирается как String.
    func testNoInterpolatedLocalizedStringKeyLiterals() throws {
        let pattern = try NSRegularExpression(pattern: #"LocalizedStringKey\("[^"\n]*\\\("#)
        var offenders: [String] = []
        for (name, text) in try swiftSources() {
            for (index, line) in text.components(separatedBy: "\n").enumerated() {
                if line.trimmingCharacters(in: .whitespaces).hasPrefix("//") { continue }
                let range = NSRange(line.startIndex..., in: line)
                if pattern.firstMatch(in: line, range: range) != nil { offenders.append("\(name):\(index + 1)") }
            }
        }
        XCTAssertEqual(offenders, [], "интерполяция внутри LocalizedStringKey")
    }

    /// Каждый литеральный ключ, переданный в Text, Button, Label и другие
    /// конструкторы SwiftUI, есть в каталоге с переводами RU и KY.
    func testEveryLiteralUIKeyIsTranslated() throws {
        let strings = try catalog()
        let pattern = try NSRegularExpression(pattern:
            #"(?:\b(?:Text|Button|Label|Section|NavigationLink|TextField|SecureField|Toggle|Link|ProgressView|LabeledContent|LocalizedStringKey|navigationTitle|accessibilityLabel|accessibilityHint)\(\s*|localized:\s*)"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)""#)
        var checked = Set<String>()
        for (_, text) in try swiftSources() {
            let range = NSRange(text.startIndex..., in: text)
            for match in pattern.matches(in: text, range: range) {
                guard let keyRange = Range(match.range(at: 1), in: text) else { continue }
                checked.insert(String(text[keyRange]))
            }
        }
        XCTAssertGreaterThan(checked.count, 300, "сканер ключей ничего не нашёл")
        for key in checked.sorted() { assertTranslated(key, in: strings) }
    }
}
