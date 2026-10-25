import XCTest

/// Тексты согласия на ИИ-помощников в каталоге `Localizable.xcstrings`:
/// русские строки слово в слово как в контракте владельца (25.10.2026), у
/// каждого ключа есть кыргызский вариант, формат даты одинаков в обоих
/// языках. Каталог читается из исходников по `#filePath`, как в
/// `LocalizationKeysTests`.
final class AIConsentStringsTests: XCTestCase {
    private struct Catalog: Decodable {
        struct Entry: Decodable {
            struct Localization: Decodable {
                struct Unit: Decodable { let value: String; let state: String }
                let stringUnit: Unit?
            }
            let localizations: [String: Localization]?
        }
        let strings: [String: Entry]
    }

    private func catalog() throws -> [String: Catalog.Entry] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("EVOAdmissions/Resources/Localizable.xcstrings")
        return try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: url)).strings
    }

    private func value(_ key: String, _ language: String, in strings: [String: Catalog.Entry]) -> String? {
        strings[key]?.localizations?[language]?.stringUnit?.value
    }

    /// Ключи, которые использует код (`AIConsentAction.labelKey`, состояния
    /// и литералы в `AIConsentViews.swift`).
    private var keys: [String] {
        AIConsentPolicy.cardActions.map(\.labelKey)
            + [AIConsentAction.revoke.labelKey]
            + [AIConsentPolicy.Display.granted, .declined, .notChosen].map(\.stateKey)
            + ["ai_consent_title", "ai_consent_body", "ai_consent_row_title", "ai_consent_state_dated",
               "ai_consent_error", "ai_consent_unavailable", "ai_consent_update_app"]
    }

    func testEveryKeyHasBothLanguages() throws {
        let strings = try catalog()
        for key in keys {
            for language in ["ru", "ky"] {
                let text = value(key, language, in: strings) ?? ""
                XCTAssertFalse(text.trimmingCharacters(in: .whitespaces).isEmpty, "\(key): нет \(language)")
                XCTAssertNotEqual(text, key, "\(key): \(language) равен ключу")
            }
        }
    }

    func testRussianCopyMatchesTheOwnersContract() throws {
        let strings = try catalog()
        let expected: [String: String] = [
            "ai_consent_title": "ИИ-помощники EVO",
            "ai_consent_body": "Сотрудникам EVO помогают ИИ-помощники: они читают вашу переписку с EVO и документы дела, чтобы готовить ответы и следить за сроками. Данные обрабатывают Anthropic (Claude, США) и Google (Gemini). Решения по делу принимают сотрудники EVO. Если не разрешите, помощники не будут читать ваши документы и переписку — работа с делом не изменится.",
            "ai_consent_allow": "Разрешить",
            "ai_consent_decline": "Не разрешать",
            "ai_consent_revoke": "Отозвать согласие",
            "ai_consent_row_title": "ИИ-помощники",
            "ai_consent_state_granted": "Разрешено",
            "ai_consent_state_declined": "Не разрешено",
            "ai_consent_state_unset": "Не выбрано",
        ]
        for (key, text) in expected {
            XCTAssertEqual(value(key, "ru", in: strings), text, key)
        }
    }

    func testKyrgyzBodyNamesBothProviders() throws {
        // Раскрытие должно называть обоих получателей данных на любом языке.
        let strings = try catalog()
        let body = try XCTUnwrap(value("ai_consent_body", "ky", in: strings))
        XCTAssertTrue(body.contains("Anthropic"))
        XCTAssertTrue(body.contains("Google"))
    }

    func testDateFormatKeepsBothArgumentsInBothLanguages() throws {
        let strings = try catalog()
        for language in ["ru", "ky"] {
            let format = try XCTUnwrap(value("ai_consent_state_dated", language, in: strings))
            XCTAssertEqual(String(format: format, "Разрешено", "25.10.2026"), "Разрешено · 25.10.2026", language)
        }
    }
}
