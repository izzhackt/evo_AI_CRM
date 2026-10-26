import Foundation

/// Что сказать студенту, когда запрос не удался.
///
/// Раньше под заголовком «Не удалось загрузить…» выводился
/// `error.localizedDescription`: системная фраза на языке телефона, а не
/// приложения («Не удалось подключиться к серверу.» под киргизским
/// заголовком, английская на английском телефоне; проход «проще и
/// дружелюбнее» 2026-10-26). Теперь на экран попадает только строка каталога
/// RU и KY, выбранная по виду ошибки. Правило без SwiftUI и Supabase SDK,
/// поэтому его проверяют hostless-тесты (`ConnectionFailureTests`).
enum ConnectionFailure {
    /// Ответа сервера нет: обрыв, таймаут, нет сети. Повтор имеет смысл.
    static func isTransport(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut,
             .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
            return true
        default:
            return false
        }
    }

    /// Запрос заведомо не ушёл с телефона (нет сети, нет адреса, отказ в
    /// соединении), поэтому повторить его безопасно. Обрыв и таймаут сюда не
    /// входят: ответ мог быть потерян уже после того, как сервер выполнил
    /// запрос.
    static func neverReachedServer(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
            return true
        default:
            return false
        }
    }

    /// Ключ каталога для строки под заголовком «Не удалось загрузить…».
    static func hintKey(for error: Error) -> String {
        isTransport(error) ? "error_hint_offline" : "error_hint_retry"
    }

    /// Строка для экрана на языке приложения.
    static func hint(for error: Error) -> String {
        let key = hintKey(for: error)
        return Bundle.main.localizedString(forKey: key, value: key, table: nil)
    }
}
