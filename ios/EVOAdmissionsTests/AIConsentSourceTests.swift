import XCTest

/// Имена RPC согласия на ИИ-помощников закреплены по исходнику.
/// `SupabaseService+AIConsent.swift` подключён только к приложению, не к
/// тестовой цели (ему нужен Supabase SDK), поэтому опечатка в имени функции
/// иначе всплыла бы лишь при запуске с настоящей сессией. Тест читает файл
/// по `#filePath`, как `FillContrastSourceTests`; имена параметров проверяет
/// `AIConsentPolicyTests`.
final class AIConsentSourceTests: XCTestCase {
    private func serviceSource() throws -> String {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("EVOAdmissions/Services/SupabaseService+AIConsent.swift")
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// Строки кода без комментариев: имя в поясняющем `///` не считается вызовом.
    private func codeLines() throws -> [String] {
        try serviceSource()
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.hasPrefix("//") }
    }

    func testReadCallsTheContractFunction() throws {
        XCTAssertTrue(try codeLines().contains(#".rpc("portal_ai_consent_get_v1")"#))
    }

    func testWriteCallsTheContractFunctionWithTheParams() throws {
        XCTAssertTrue(try codeLines().contains(#".rpc("portal_ai_consent_set_v1", params: params)"#))
    }

    func testNoOtherRPCNameIsCalled() throws {
        let rpcCalls = try codeLines().filter { $0.contains(".rpc(") }
        XCTAssertEqual(rpcCalls.count, 2, "в файле ровно два вызова RPC: чтение и запись")
    }

    func testLiveModelIsWiredToTheTwoCalls() throws {
        let code = try codeLines().joined(separator: "\n")
        XCTAssertTrue(code.contains("load: { try await SupabaseService.shared.aiConsent() }"))
        XCTAssertTrue(code.contains("save: { try await SupabaseService.shared.setAIConsent($0) }"))
    }

    // MARK: Экраны показывают согласие только студенту с делом EVO

    /// Экраны лежат вне тестовой цели (SwiftUI и Supabase SDK), поэтому
    /// проводку проверяет исходник: забыть уровень на одном из входов нельзя.
    private func source(_ relativePath: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent(relativePath)
        return try String(contentsOf: url, encoding: .utf8)
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.hasPrefix("//") }
            .joined(separator: "\n")
    }

    func testBothSectionsGateThemselvesByTier() throws {
        let views = try source("EVOAdmissions/Views/AIConsentViews.swift")
        XCTAssertTrue(views.contains("let tier: AccessTier"))
        XCTAssertEqual(views.components(separatedBy: "AIConsentPolicy.isOffered(to: tier)").count - 1, 2,
                       "карточка и строка настроек сами проверяют уровень доступа")
    }

    func testScreensPassTheSessionTierAndReadOnlyWhenOffered() throws {
        let home = try source("EVOAdmissions/Views/HomeView.swift")
        let profile = try source("EVOAdmissions/Views/ProfileView.swift")
        XCTAssertTrue(home.contains("AIConsentCardSection(model: aiConsent, tier: session.accessTier)"))
        XCTAssertTrue(profile.contains("AIConsentSettingsSection(model: aiConsent, tier: session.accessTier)"))
        for screen in [home, profile] {
            XCTAssertTrue(screen.contains("aiConsent.load(offeredTo: session.accessTier)"))
            XCTAssertFalse(screen.contains("aiConsent.load()"), "чтение без проверки уровня недопустимо")
        }
    }
}
