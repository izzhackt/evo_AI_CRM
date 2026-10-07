import Foundation

/// Тексты входа и восстановления пароля по ответу Supabase Auth.
///
/// Без Supabase SDK: `SessionRouter` переводит ошибку SDK в `Failure`, а
/// правило проверяют hostless-тесты (`AuthMessagePolicyTests`). Раньше под
/// полями входа показывался `error.localizedDescription` SDK, то есть
/// английская фраза сервера вне каталога RU и KY (аудит UX/UI 2026-10).
enum AuthMessagePolicy {
    /// Что известно об ошибке: код GoTrue (`error_code`), HTTP-статус и
    /// признак сетевой ошибки (нет ответа сервера).
    struct Failure: Equatable {
        var errorCode: String?
        var httpStatus: Int?
        var isTransport = false
    }

    // MARK: - Вход

    static func signInMessageKey(_ failure: Failure) -> String {
        if failure.isTransport { return "sign_in_error_network" }
        if isRateLimited(failure) { return "sign_in_error_rate_limited" }
        switch failure.errorCode {
        case "invalid_credentials":
            return "sign_in_error_invalid_credentials"
        case "email_not_confirmed":
            return "sign_in_error_email_not_confirmed"
        case nil where failure.httpStatus == 400:
            // Старый GoTrue без error_code отвечает на неверный пароль 400.
            return "sign_in_error_invalid_credentials"
        default:
            return "sign_in_error_generic"
        }
    }

    // MARK: - Восстановление пароля (общий контракт веба и iPhone)

    enum RecoveryOutcome: Equatable {
        /// Один и тот же нейтральный ответ для любого адреса.
        case sent
        case rateLimited
        case invalidEmail
        case failed
    }

    /// `nil` означает успешный ответ сервера. Коды, которые зависят от того,
    /// есть ли такой аккаунт, тоже дают `.sent`: экран не должен выдавать,
    /// зарегистрирован ли адрес.
    static func recoveryOutcome(_ failure: Failure?) -> RecoveryOutcome {
        guard let failure else { return .sent }
        if failure.isTransport { return .failed }
        if isRateLimited(failure) { return .rateLimited }
        switch failure.errorCode {
        case "user_not_found", "email_not_confirmed", "user_banned":
            return .sent
        case "email_address_invalid", "validation_failed":
            return .invalidEmail
        default:
            return .failed
        }
    }

    static func recoveryMessageKey(_ outcome: RecoveryOutcome) -> String {
        switch outcome {
        case .sent: return "forgot_password_sent"
        case .rateLimited: return "forgot_password_rate_limited"
        case .invalidEmail: return "forgot_password_invalid_email"
        case .failed: return "forgot_password_failed"
        }
    }

    /// Ссылка из письма ведёт в веб-кабинет студента: `<origin>/auth/callback`.
    /// Путь базового адреса не учитывается, берётся только origin.
    static func recoveryRedirect(webBase: URL) -> URL? {
        guard let scheme = webBase.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = webBase.host, !host.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = webBase.port
        components.path = "/auth/callback"
        return components.url
    }

    static func normalizedEmail(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Грубая проверка формы адреса до запроса; точную проверку делает сервер.
    static func looksLikeEmail(_ raw: String) -> Bool {
        let email = normalizedEmail(raw)
        guard !email.contains(where: \.isWhitespace) else { return false }
        let parts = email.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let domain = parts[1]
        guard let dot = domain.lastIndex(of: "."), dot != domain.startIndex else { return false }
        return domain.index(after: dot) != domain.endIndex
    }

    private static func isRateLimited(_ failure: Failure) -> Bool {
        failure.httpStatus == 429
            || failure.errorCode == "over_email_send_rate_limit"
            || failure.errorCode == "over_request_rate_limit"
    }
}
