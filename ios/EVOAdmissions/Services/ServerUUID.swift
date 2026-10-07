import Foundation

/// Разбор UUID из ответа сервера или из локального хранилища без падения.
///
/// Раньше экраны и декодеры писали `UUID(uuidString: raw)!`: строка с сервера,
/// не прошедшая разбор, роняла приложение. Здесь неверное значение даёт `nil`
/// для ссылки, которую тогда не показываем, или ошибку чтения в декодере.
enum ServerUUID {
    /// UUID в канонической записи 8-4-4-4-12; регистр не важен.
    static func parse(_ raw: String?) -> UUID? {
        guard let raw, raw.utf8.count == 36 else { return nil }
        return UUID(uuidString: raw)
    }

    /// Тот же разбор для декодеров: неверное значение становится ошибкой
    /// чтения, а не падением.
    static func require(_ raw: String, orThrow error: @autoclosure () -> Error) throws -> UUID {
        guard let value = parse(raw) else { throw error() }
        return value
    }
}
