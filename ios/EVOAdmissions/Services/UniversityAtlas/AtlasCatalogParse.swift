import Foundation
import os

/// Разбор ответов университетов v2 по частям (контракт 2.2a, review раунда 3,
/// F12), шаг в шаг как `src/lib/portal/university-index.ts` веба. Весь ответ
/// отвергается только при неверной обёртке; неверная карточка города, вуза,
/// поле страны, строка стоимости или курс отбрасываются или заменяются по
/// одному, и каждый такой случай пишется строкой журнала
/// `portal_university_catalog_item_degraded` (`CatalogParseLog`).

/// Значение JSON с точными типами: JSONDecoder не путает `true` с `1`, а
/// `1.5` с целым, поэтому разбор отличает их так же, как `typeof` веба.
enum AtlasJSON: Decodable, Hashable, Sendable {
    case null
    case bool(Bool)
    case integer(Int64)
    case double(Double)
    case string(String)
    case array([AtlasJSON])
    case object([String: AtlasJSON])

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() {
            self = .null
        } else if let bool = try? value.decode(Bool.self) {
            self = .bool(bool)
        } else if let integer = try? value.decode(Int64.self) {
            self = .integer(integer)
        } else if let double = try? value.decode(Double.self) {
            self = .double(double)
        } else if let string = try? value.decode(String.self) {
            self = .string(string)
        } else if let array = try? value.decode([AtlasJSON].self) {
            self = .array(array)
        } else {
            self = .object(try value.decode([String: AtlasJSON].self))
        }
    }

    var object: [String: AtlasJSON]? {
        if case .object(let value) = self { return value }
        return nil
    }

    var array: [AtlasJSON]? {
        if case .array(let value) = self { return value }
        return nil
    }

    var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var bool: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    /// `Number.isSafeInteger` веба: целое без потери точности (до 2^53 - 1).
    var safeInteger: Int64? {
        let limit: Int64 = 9_007_199_254_740_991
        switch self {
        case .integer(let value):
            return (-limit...limit).contains(value) ? value : nil
        case .double(let value):
            guard value.isFinite, value.rounded() == value, abs(value) <= Double(limit) else { return nil }
            return Int64(value)
        default:
            return nil
        }
    }

    /// Конечное число любого вида.
    var number: Double? {
        switch self {
        case .integer(let value): return Double(value)
        case .double(let value): return value.isFinite ? value : nil
        default: return nil
        }
    }
}

/// Значение или причина отказа (имя поля), как `Parsed` веба.
enum AtlasParsed<Value> {
    case ok(Value)
    case bad(String)
}

/// Что разборщик отбросил или заменил. Ключи только каталожные (код страны,
/// ключ города, id вуза или строки стоимости, валюта): личных данных нет.
struct CatalogParseIssue: Equatable, Sendable, CustomStringConvertible {
    enum Item: String, Sendable {
        case country, city, university, cost, costs
        case fxRate = "fx_rate"
    }

    let item: Item
    let key: String?
    let reason: String

    init(_ item: Item, _ key: String?, _ reason: String) {
        self.item = item
        self.key = key
        self.reason = reason
    }

    var description: String { "\(item.rawValue):\(key ?? "null"):\(reason)" }
}

typealias CatalogParseReporter = @Sendable (CatalogParseIssue) -> Void

/// Строка журнала на каждую отброшенную или заменённую часть ответа: та же
/// форма, что `logCatalogIssue` сервера веба. На iPhone сервера нет, строка
/// уходит в системный журнал устройства (`os.Logger`, категория
/// `university-catalog`).
enum CatalogParseLog {
    static let event = "portal_university_catalog_item_degraded"
    static let indexRpc = "student_university_index_v1"
    static let detailRpc = "student_university_detail_v1"

    static let ignore: CatalogParseReporter = { _ in }

    private static let logger = Logger(subsystem: "com.evoadmissions.app", category: "university-catalog")

    static func reporter(rpc: String) -> CatalogParseReporter {
        { issue in
            let text = line(rpc: rpc, issue: issue)
            logger.warning("\(text, privacy: .public)")
        }
    }

    /// `{"event":…,"rpc":…,"item":…,"key":…,"reason":…}` с ключами в этом
    /// порядке, как `JSON.stringify` веба.
    static func line(rpc: String, issue: CatalogParseIssue) -> String {
        func quoted(_ value: String) -> String {
            let data = (try? JSONSerialization.data(withJSONObject: [value], options: [.withoutEscapingSlashes])) ?? Data("[\"\"]".utf8)
            let array = String(decoding: data, as: UTF8.self)
            return String(array.dropFirst().dropLast())
        }
        let key = issue.key.map(quoted) ?? "null"
        return "{\"event\":\(quoted(event)),\"rpc\":\(quoted(rpc)),\"item\":\(quoted(issue.item.rawValue)),\"key\":\(key),\"reason\":\(quoted(issue.reason))}"
    }
}

/// Ключи библиотеки фото вузов этой сборки: ключ вне библиотеки разбор
/// заменяет на «фото нет», как `UNIVERSITY_PHOTOS` веба.
enum AtlasCatalogLibrary {
    private final class Token {}

    static let photoKeys: Set<String> = Set((UniversityPhotoLibrary.load(from: Bundle(for: Token.self)) ?? [:]).keys)
}

/// Общие разборщики частей (как функции `university-index.ts`).
enum AtlasParse {
    typealias Row = [String: AtlasJSON]

    static func exact(_ row: Row, _ keys: [String]) -> Bool {
        row.count == keys.count && keys.allSatisfy { row[$0] != nil }
    }

    /// `null` или ключа нет (`undefined` веба).
    static func isAbsent(_ value: AtlasJSON?) -> Bool {
        value == nil || value == .null
    }

    /// `universityUuid` веба: строка UUID версий от 1 до 8 в любом регистре, как
    /// пришла.
    static func uuid(_ value: AtlasJSON?) -> String? {
        guard let raw = value?.string,
              AtlasValue.matches(raw, "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"),
              UUID(uuidString: raw) != nil else { return nil }
        return raw
    }

    static func count(_ value: AtlasJSON?) -> Int? {
        guard let integer = value?.safeInteger, integer >= 0, integer <= Int64(Int.max) else { return nil }
        return Int(integer)
    }

    /// Ссылка, которую можно открыть: правило `catalog_url_ok` и `URL`.
    static func link(_ value: AtlasJSON?) -> URL? {
        guard let raw = value?.string else { return nil }
        return AtlasValue.link(raw)
    }

    static func localized(_ value: AtlasJSON?, max: Int) -> LocalizedPair? {
        guard let row = value?.object, exact(row, ["ru", "ky"]),
              let ru = row["ru"]?.string, let ky = row["ky"]?.string,
              CatalogText.text(ru, max: max), CatalogText.text(ky, max: max) else { return nil }
        return LocalizedPair(ru: ru, ky: ky)
    }

    static let photoKeys = ["path", "width", "height", "author", "authorUrl", "sourceName", "sourceUrl", "license", "licenseUrl"]

    /// Фото страны (`countries`) или города (`cities`).
    static func photo(_ value: AtlasJSON?, scope: String) -> AtlasPhoto? {
        guard let row = value?.object, exact(row, photoKeys),
              let path = row["path"]?.string,
              AtlasValue.matches(path, "geography/\(scope)/[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{12}\\.(jpg|png|webp|avif)"),
              let width = count(row["width"]), (1...99_999).contains(width),
              let height = count(row["height"]), (1...99_999).contains(height),
              let author = row["author"]?.string, CatalogText.text(author, max: 200),
              let sourceName = row["sourceName"]?.string,
              let rawSourceUrl = row["sourceUrl"]?.string, let sourceUrl = AtlasValue.link(rawSourceUrl),
              CatalogText.photoSourceMatches(sourceName: sourceName, sourceUrl: rawSourceUrl),
              let license = row["license"]?.string, CatalogText.text(license, max: 120) else { return nil }
        var authorUrl: URL?
        if row["authorUrl"] != .null {
            guard let url = link(row["authorUrl"]) else { return nil }
            authorUrl = url
        }
        var licenseUrl: URL?
        if row["licenseUrl"] != .null {
            guard let url = link(row["licenseUrl"]) else { return nil }
            licenseUrl = url
        }
        // Ни адреса, ни имени EDUPRCHINA в данных фото (план 4.4, как
        // `lower(photo::TEXT) !~ 'eduprchina'` в CHECK 283).
        let texts = [path, author, row["authorUrl"]?.string, sourceName, rawSourceUrl, license, row["licenseUrl"]?.string]
        if AtlasValue.mentionsAgency(texts) { return nil }
        return AtlasPhoto(path: path, width: width, height: height, author: author, authorUrl: authorUrl,
                          sourceName: sourceName, sourceUrl: sourceUrl, license: license, licenseUrl: licenseUrl)
    }

    static func fact(_ value: AtlasJSON?) -> AtlasCityFact? {
        guard let row = value?.object, exact(row, ["ru", "ky", "sourceUrl", "verifiedOn"]),
              let ru = row["ru"]?.string, let ky = row["ky"]?.string,
              CatalogText.text(ru, max: 200), CatalogText.text(ky, max: 200),
              let sourceUrl = link(row["sourceUrl"]),
              let verifiedOn = row["verifiedOn"]?.string, AtlasValue.isDay(verifiedOn) else { return nil }
        return AtlasCityFact(text: LocalizedPair(ru: ru, ky: ky), sourceUrl: sourceUrl, verifiedOn: verifiedOn)
    }

    /// `CITY_KEY` веба: от 2 до 64 знаков `a-z0-9-`, без дефиса по краям.
    static func isCityKey(_ value: String) -> Bool {
        AtlasValue.matches(value, "[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])")
    }

    static func cityKey(_ value: AtlasJSON?) -> String? {
        guard let key = value?.object?["key"]?.string, isCityKey(key) else { return nil }
        return key
    }

    /// Карточка города. В индексе у неё ещё `universityCount` (его разбор
    /// пересчитывает), на странице вуза его нет.
    static func city(_ value: AtlasJSON?, withCount: Bool, countryCodes: [String]) -> AtlasParsed<AtlasCity> {
        let keys = ["key", "country", "name", "photo", "summary", "fact"] + (withCount ? ["universityCount"] : [])
        guard let row = value?.object, exact(row, keys) else { return .bad("keys") }
        guard let key = row["key"]?.string, isCityKey(key) else { return .bad("key") }
        guard let country = row["country"]?.string, countryCodes.contains(country) else { return .bad("country") }
        guard let name = localized(row["name"], max: 100) else { return .bad("name") }
        guard let photo = photo(row["photo"], scope: "cities") else { return .bad("photo") }
        guard let summary = localized(row["summary"], max: 300) else { return .bad("summary") }
        guard let fact = fact(row["fact"]) else { return .bad("fact") }
        return .ok(AtlasCity(
            key: key, country: country, name: name, photo: photo, summary: summary, fact: fact,
            universityCount: withCount ? count(row["universityCount"]) : nil
        ))
    }

    /// Название страны из `study-countries.json`, если название ответа
    /// неверно.
    static func fallbackCountryName(_ code: String) -> LocalizedPair {
        LocalizedPair(
            ru: StudyCountries.name(for: code, kyrgyz: false) ?? code,
            ky: StudyCountries.name(for: code, kyrgyz: true) ?? code
        )
    }
}
