import Foundation

/// Строгие части ответов университетов v2 (миграция 283,
/// docs/catalog/geography-costs-contract.md, 2.2a): обёртка страницы вуза,
/// карточка вуза, консультация и подготовки разбираются `Decodable` с
/// закрытым набором ключей (лишний или пропущенный ключ это ошибка, ключ со
/// значением null обязан присутствовать). Каталожные части (страны, города,
/// вузы индекса, стоимость) разбираются по одному в `AtlasCatalogParse.swift`.
struct AtlasKey: CodingKey, Hashable {
    let stringValue: String
    var intValue: Int? { nil }

    init(_ value: String) { stringValue = value }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

extension KeyedDecodingContainer where K == AtlasKey {
    /// Ровно эти ключи: ни лишних, ни пропущенных.
    func requireExactKeys(_ expected: Set<String>) throws {
        let present = Set(allKeys.map(\.stringValue))
        if present != expected {
            let extra = present.subtracting(expected).sorted()
            let missing = expected.subtracting(present).sorted()
            throw DecodingError.dataCorrupted(.init(
                codingPath: codingPath,
                debugDescription: "Unexpected key set (extra: \(extra), missing: \(missing))"
            ))
        }
    }

    func required<T: Decodable>(_ key: String, as type: T.Type = T.self) throws -> T {
        try decode(T.self, forKey: AtlasKey(key))
    }

    /// Ключ обязателен, значение может быть null.
    func nullable<T: Decodable>(_ key: String, as type: T.Type = T.self) throws -> T? {
        let codingKey = AtlasKey(key)
        guard contains(codingKey) else {
            throw DecodingError.keyNotFound(codingKey, .init(codingPath: codingPath, debugDescription: "Key must be present (null allowed)"))
        }
        return try decodeNil(forKey: codingKey) ? nil : decode(T.self, forKey: codingKey)
    }

    func corrupted(_ key: String, _ reason: String) -> DecodingError {
        DecodingError.dataCorruptedError(forKey: AtlasKey(key), in: self, debugDescription: reason)
    }
}

/// Проверки значений, общие для индекса и страницы вуза.
enum AtlasValue {
    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex
    }

    /// Название вуза и строка его города в индексе приходят из карточки вуза
    /// (148, `university_text`): разбор не строже базы, как `contentText`
    /// веба. Есть знак кроме пробела, не больше max кодовых точек, ни одного
    /// управляющего U+0000…U+001F и U+007F.
    static func contentText(_ value: String, max: Int) -> Bool {
        var count = 0
        var visible = false
        for scalar in value.unicodeScalars {
            if scalar.value < 0x20 || scalar.value == 0x7F { return false }
            if scalar != " " { visible = true }
            count += 1
            if count > max { return false }
        }
        return visible
    }

    /// Ссылка по правилу `catalog_url_ok`, которую можно открыть. С iOS 17
    /// `URL(string:)` сам кодирует кириллицу и типографские знаки пути.
    static func link(_ value: String) -> URL? {
        guard CatalogText.url(value), let url = URL(string: value), url.scheme == "https", url.host?.isEmpty == false else { return nil }
        return url
    }

    /// Календарная дата `YYYY-MM-DD`, которая действительно существует
    /// (`universityDate` веба: год больше нуля).
    static func isDay(_ value: String) -> Bool {
        guard matches(value, "[0-9]{4}-[0-9]{2}-[0-9]{2}"), let year = Int(value.prefix(4)), year > 0 else { return false }
        guard let date = dayFormatter.date(from: value) else { return false }
        return dayFormatter.string(from: date) == value
    }

    /// Один форматтер на процесс: индекс содержит сотни дат.
    /// `DateFormatter` потокобезопасен с iOS 7.
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func isMonth(_ value: String) -> Bool {
        matches(value, "[0-9]{4}-(0[1-9]|1[0-2])")
    }

    static let levels = ["language", "foundation", "diploma", "bachelor", "master", "doctorate"]

    /// Ни одного адреса или имени агентства EDUPRCHINA в данных фото
    /// (план 4.4, та же проверка, что CHECK `catalog_photo_valid`).
    static func mentionsAgency(_ values: [String?]) -> Bool {
        values.contains { $0?.lowercased().contains("eduprchina") == true }
    }
}

/// Пара RU и KY для текстов студенту.
struct LocalizedPair: Equatable, Hashable, Sendable {
    let ru: String
    let ky: String

    func text(kyrgyz: Bool) -> String { kyrgyz ? ky : ru }
}

/// Фото страны или города (`photo jsonb`, 283): путь объекта в публичном
/// бакете `portal-university-photos`, размер и атрибуция. Источник только
/// Unsplash, Pexels или Wikimedia Commons, хост адреса именно этого
/// источника (`CatalogText.photoSourceHosts`).
struct AtlasPhoto: Equatable, Hashable, Sendable {
    let path: String
    let width: Int
    let height: Int
    let author: String
    let authorUrl: URL?
    let sourceName: String
    let sourceUrl: URL
    let license: String
    let licenseUrl: URL?

    var aspectRatio: CGFloat { CGFloat(width) / CGFloat(height) }
}
