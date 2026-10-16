import Foundation

/// Строгий разбор ответов университетов v2 (миграция 283,
/// docs/catalog/geography-costs-contract.md). Как строгий парсер веба:
/// набор ключей каждого объекта закрыт (лишний или пропущенный ключ это
/// ошибка), ключ со значением null обязан присутствовать, значения
/// проверяются по домену контракта. Новая форма ответа приходит только новой
/// функцией с суффиксом версии (план 4.1), поэтому неизвестный ключ означает
/// расхождение контракта, а не «новые данные, которые можно не показать».
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

    /// Текст для людей: непустой после обрезки, без управляющих символов.
    /// Управляющие здесь ровно те, что отвергает веб (`/[\u0000-\u001f\u007f]/`)
    /// и CHECK `catalog_text_ok` (`[[:cntrl:]]`): U+0000…U+001F и U+007F.
    /// Невидимые символы форматирования (мягкий перенос U+00AD, U+200B,
    /// U+200D, U+FEFF) база и веб принимают, поэтому и здесь они не ошибка:
    /// иначе один такой символ, вставленный из Word, выключил бы весь
    /// каталог на iPhone, а веб продолжал бы работать.
    static func isText(_ value: String, max: Int) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && value.count <= max && !hasControlCharacter(value)
    }

    static func hasControlCharacter(_ value: String) -> Bool {
        value.unicodeScalars.contains { $0.value < 0x20 || $0.value == 0x7F }
    }

    /// Публичный адрес https с хостом (как `university_public_url` в SQL).
    static func httpsURL(_ value: String) -> URL? {
        guard let url = URL(string: value), url.scheme == "https", let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    /// Календарная дата `YYYY-MM-DD`, которая действительно существует.
    static func isDay(_ value: String) -> Bool {
        guard matches(value, "[0-9]{4}-[0-9]{2}-[0-9]{2}") else { return false }
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
struct LocalizedPair: Decodable, Equatable, Hashable {
    let ru: String
    let ky: String

    func text(kyrgyz: Bool) -> String { kyrgyz ? ky : ru }

    init(ru: String, ky: String) {
        self.ru = ru
        self.ky = ky
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["ru", "ky"])
        try self.init(values: values, max: 1000)
    }

    /// Разбор пары из контейнера, где кроме `ru` и `ky` есть и другие ключи
    /// (факт города). Набор ключей проверяет вызывающий.
    init(values: KeyedDecodingContainer<AtlasKey>, max: Int) throws {
        ru = try values.required("ru")
        ky = try values.required("ky")
        guard AtlasValue.isText(ru, max: max) else { throw values.corrupted("ru", "Empty or invalid text") }
        guard AtlasValue.isText(ky, max: max) else { throw values.corrupted("ky", "Empty or invalid text") }
    }
}

/// Фото страны или города (`photo jsonb`, 283): путь объекта в публичном
/// бакете `portal-university-photos`, размер и атрибуция. Источник только
/// Unsplash, Pexels или Wikimedia Commons.
struct AtlasPhoto: Decodable, Equatable, Hashable {
    let path: String
    let width: Int
    let height: Int
    let author: String
    let authorUrl: URL?
    let sourceName: String
    let sourceUrl: URL
    let license: String
    let licenseUrl: URL?

    static let sources: Set<String> = ["Unsplash", "Pexels", "Wikimedia Commons"]

    var aspectRatio: CGFloat { CGFloat(width) / CGFloat(height) }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["path", "width", "height", "author", "authorUrl", "sourceName", "sourceUrl", "license", "licenseUrl"])
        path = try values.required("path")
        width = try values.required("width")
        height = try values.required("height")
        author = try values.required("author")
        let rawAuthorUrl: String? = try values.nullable("authorUrl")
        sourceName = try values.required("sourceName")
        let rawSourceUrl: String = try values.required("sourceUrl")
        license = try values.required("license")
        let rawLicenseUrl: String? = try values.nullable("licenseUrl")

        guard AtlasValue.matches(path, "geography/(countries|cities)/[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{12}\\.(jpg|png|webp|avif)") else {
            throw values.corrupted("path", "Photo path outside the geography bucket layout")
        }
        guard (1...99_999).contains(width), (1...99_999).contains(height) else {
            throw values.corrupted("width", "Photo size out of range")
        }
        guard AtlasValue.isText(author, max: 200) else { throw values.corrupted("author", "Empty author") }
        guard AtlasValue.isText(license, max: 120) else { throw values.corrupted("license", "Empty license") }
        guard Self.sources.contains(sourceName) else { throw values.corrupted("sourceName", "Photo source not allowed") }
        guard let source = AtlasValue.httpsURL(rawSourceUrl) else { throw values.corrupted("sourceUrl", "Source must be https") }
        sourceUrl = source
        if let rawAuthorUrl {
            guard let url = AtlasValue.httpsURL(rawAuthorUrl) else { throw values.corrupted("authorUrl", "Author URL must be https") }
            authorUrl = url
        } else {
            authorUrl = nil
        }
        if let rawLicenseUrl {
            guard let url = AtlasValue.httpsURL(rawLicenseUrl) else { throw values.corrupted("licenseUrl", "License URL must be https") }
            licenseUrl = url
        } else {
            licenseUrl = nil
        }
        if AtlasValue.mentionsAgency([path, author, rawAuthorUrl, sourceName, rawSourceUrl, license, rawLicenseUrl]) {
            throw values.corrupted("sourceUrl", "Agency photos are not allowed")
        }
    }
}
