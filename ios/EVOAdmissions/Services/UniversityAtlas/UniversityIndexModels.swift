import Foundation

/// Ответ `platform.student_university_index_v1(p_known_version)` (283,
/// контракт 2.1): весь каталог шести стран организации одной выдачей или
/// `notModified`, если известная версия совпала.
enum UniversityIndexResponse: Equatable {
    case notModified(version: String)
    case full(UniversityIndex)

    var version: String {
        switch self {
        case .notModified(let version): return version
        case .full(let index): return index.version
        }
    }
}

/// Ответ нельзя показать: неверная обёртка (контракт 2.2a). Экран честно
/// говорит «не удалось загрузить» или оставляет прежнюю копию.
enum UniversityCatalogDecodingError: Error, Equatable {
    case envelope
}

extension UniversityIndexResponse {
    /// Разбор тела ответа RPC по частям (`UniversityIndexParser`). Ошибка
    /// обёртки не превращается в пустой каталог: вызывающий показывает сбой
    /// или оставляет прежнюю копию.
    static func decode(_ data: Data, report: CatalogParseReporter = CatalogParseLog.ignore) throws -> UniversityIndexResponse {
        let json = try JSONDecoder().decode(AtlasJSON.self, from: data)
        guard let parsed = UniversityIndexParser.parse(json, report: report) else { throw UniversityCatalogDecodingError.envelope }
        return parsed
    }
}

struct UniversityIndex: Equatable {
    let version: String
    let countries: [AtlasCountry]
    let cities: [AtlasCity]
    let universities: [UniversityIndexEntry]

    /// Версия непрозрачна (сейчас `g1.` + md5), сравнивается только на
    /// равенство; правило текста каталога до 100 знаков, как у веба.
    static func isVersion(_ value: String) -> Bool {
        CatalogText.text(value, max: 100)
    }
}

/// Карточка страны. Название фиксированное (283, как
/// `src/lib/study-countries.json`); фото и текст null, пока карточку не
/// заполнили или если они не прошли разбор.
struct AtlasCountry: Equatable, Identifiable, Hashable {
    let code: String
    let name: LocalizedPair
    let photo: AtlasPhoto?
    let summary: LocalizedPair?
    let universityCount: Int
    let cityCount: Int

    var id: String { code }
}

/// Факт города: RU и KY, адрес источника и дата проверки.
struct AtlasCityFact: Equatable, Hashable {
    let text: LocalizedPair
    let sourceUrl: URL
    let verifiedOn: String
}

/// Опубликованный город. В индексе у карточки `universityCount` (разбор
/// считает его по вузам выдачи), на странице вуза его нет (nil).
struct AtlasCity: Equatable, Identifiable, Hashable {
    let key: String
    let country: String
    let name: LocalizedPair
    let photo: AtlasPhoto
    let summary: LocalizedPair
    let fact: AtlasCityFact
    let universityCount: Int?

    var id: String { key }

    func counted(_ value: Int) -> AtlasCity {
        AtlasCity(key: key, country: country, name: name, photo: photo, summary: summary, fact: fact, universityCount: value)
    }
}

/// Дата набора: срок подачи, начало, месяц начала; каждое может быть null.
struct UniversityIndexIntake: Equatable, Hashable {
    let deadline: String?
    let start: String?
    let startMonth: String?
}

/// Краткая карточка вуза в индексе.
struct UniversityIndexEntry: Equatable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let country: String
    /// null: у вуза нет опубликованного города, он в «Других вузах страны».
    let cityKey: String?
    /// Исходная строка `content.city` карточки вуза.
    let cityLabel: String?
    /// Уровни в порядке продукта, без повторов и неизвестных.
    let levels: [String]
    /// Ключ библиотеки фото этой сборки или null.
    let photoKey: String?
    let intakes: [UniversityIndexIntake]
    let hasCosts: Bool

    func withoutCity() -> UniversityIndexEntry {
        UniversityIndexEntry(id: id, name: name, country: country, cityKey: nil, cityLabel: cityLabel, levels: levels,
                             photoKey: photoKey, intakes: intakes, hasCosts: hasCosts)
    }
}

/// Разбор `student_university_index_v1`, как `parseStudentUniversityIndexResponse`
/// веба. Отказ всего индекса (nil) только при неверной обёртке: ключи
/// ответа, версия, шесть стран в порядке продукта. Неверный город, вуз или
/// поле страны отбрасываются по одному (`report`), счётчики считаются по
/// тому, что осталось (приёмка 7.6.2).
enum UniversityIndexParser {
    typealias Row = AtlasParse.Row

    static func parse(
        _ value: AtlasJSON,
        report: CatalogParseReporter,
        countryCodes: [String] = StudyCountries.codes,
        photoKeys: Set<String> = AtlasCatalogLibrary.photoKeys
    ) -> UniversityIndexResponse? {
        guard let row = value.object else { return nil }
        if row["notModified"] == .bool(true) {
            guard AtlasParse.exact(row, ["notModified", "version"]),
                  let version = row["version"]?.string, UniversityIndex.isVersion(version) else { return nil }
            return .notModified(version: version)
        }
        guard row["notModified"] == .bool(false),
              AtlasParse.exact(row, ["notModified", "version", "countries", "cities", "universities"]),
              let version = row["version"]?.string, UniversityIndex.isVersion(version),
              let countryValues = row["countries"]?.array, let cityValues = row["cities"]?.array,
              let universityValues = row["universities"]?.array,
              universityValues.count <= 5000, cityValues.count <= 1000,
              !countryCodes.isEmpty, countryValues.count == countryCodes.count else { return nil }

        // Страны всегда шесть и в порядке продукта (282).
        var countryRows: [Row] = []
        for (position, entry) in countryValues.enumerated() {
            guard let item = entry.object, item["code"] == .string(countryCodes[position]) else { return nil }
            countryRows.append(item)
        }

        var cities: [AtlasCity] = []
        var cityCountry: [String: String] = [:]
        for entry in cityValues {
            switch AtlasParse.city(entry, withCount: true, countryCodes: countryCodes) {
            case .bad(let reason):
                report(CatalogParseIssue(.city, AtlasParse.cityKey(entry), reason))
            case .ok(let city):
                if cityCountry[city.key] != nil {
                    report(CatalogParseIssue(.city, city.key, "duplicate"))
                    continue
                }
                cityCountry[city.key] = city.country
                cities.append(city)
            }
        }

        var universities: [UniversityIndexEntry] = []
        var ids = Set<UUID>()
        for entry in universityValues {
            switch university(entry, countryCodes: countryCodes, photoKeys: photoKeys, report: report) {
            case .bad(let reason):
                report(CatalogParseIssue(.university, AtlasParse.uuid(entry.object?["id"]), reason))
            case .ok(let parsed):
                let key = AtlasParse.uuid(entry.object?["id"])
                var item = parsed
                if ids.contains(item.id) {
                    report(CatalogParseIssue(.university, key, "duplicate"))
                    continue
                }
                // Город, которого нет в индексе или который другой страны:
                // вуз в «Другие вузы страны».
                if let cityKey = item.cityKey, cityCountry[cityKey] != item.country {
                    report(CatalogParseIssue(.university, key, "city"))
                    item = item.withoutCity()
                }
                ids.insert(item.id)
                universities.append(item)
            }
        }

        // Счётчики выдачи сходятся с её же списками: сумма вузов по странам
        // равна числу вузов, город считает свои вузы. Расхождение с числами
        // сервера только пишется в журнал.
        var perCity: [String: Int] = [:]
        var perCountry: [String: Int] = [:]
        for item in universities {
            if let cityKey = item.cityKey { perCity[cityKey, default: 0] += 1 }
            perCountry[item.country, default: 0] += 1
        }
        var indexCities: [AtlasCity] = []
        for city in cities {
            let own = perCity[city.key, default: 0]
            if own == 0 {
                report(CatalogParseIssue(.city, city.key, "empty"))
                continue
            }
            if city.universityCount != own { report(CatalogParseIssue(.city, city.key, "count")) }
            indexCities.append(city.counted(own))
        }
        let countries = countryRows.enumerated().map { position, item -> AtlasCountry in
            let code = countryCodes[position]
            let universityCount = perCountry[code, default: 0]
            let cityCount = indexCities.filter { $0.country == code }.count
            if AtlasParse.count(item["universityCount"]) != universityCount || AtlasParse.count(item["cityCount"]) != cityCount {
                report(CatalogParseIssue(.country, code, "count"))
            }
            return country(item, code: code, universityCount: universityCount, cityCount: cityCount, report: report)
        }
        return .full(UniversityIndex(version: version, countries: countries, cities: indexCities, universities: universities))
    }

    private static let countryKeys = ["code", "name", "photo", "summary", "universityCount", "cityCount"]

    /// Карточка страны: код и порядок обязательны (282), остальное деградирует.
    private static func country(_ item: Row, code: String, universityCount: Int, cityCount: Int, report: CatalogParseReporter) -> AtlasCountry {
        func note(_ reason: String) { report(CatalogParseIssue(.country, code, reason)) }
        if !AtlasParse.exact(item, countryKeys) { note("keys") }
        var name = AtlasParse.localized(item["name"], max: 100)
        if name == nil {
            note("name")
            name = AtlasParse.fallbackCountryName(code)
        }
        var photo: AtlasPhoto?
        if !AtlasParse.isAbsent(item["photo"]) {
            photo = AtlasParse.photo(item["photo"], scope: "countries")
            if photo == nil { note("photo") }
        }
        var summary: LocalizedPair?
        if !AtlasParse.isAbsent(item["summary"]) {
            summary = AtlasParse.localized(item["summary"], max: 300)
            if summary == nil { note("summary") }
        }
        return AtlasCountry(code: code, name: name!, photo: photo, summary: summary, universityCount: universityCount, cityCount: cityCount)
    }

    private static let universityKeys = ["id", "name", "country", "cityKey", "cityLabel", "levels", "photoKey", "intakes", "hasCosts"]

    /// Краткая карточка вуза. Без id, названия и страны вуза нет; остальное
    /// деградирует по полю: неверный набор дат даёт «даты уточняются»,
    /// неверный ключ города или подпись города уводят вуз в «Другие вузы
    /// страны».
    static func university(
        _ value: AtlasJSON,
        countryCodes: [String],
        photoKeys: Set<String>,
        report: CatalogParseReporter
    ) -> AtlasParsed<UniversityIndexEntry> {
        guard let row = value.object else { return .bad("shape") }
        guard let key = AtlasParse.uuid(row["id"]), let id = UUID(uuidString: key) else { return .bad("id") }
        guard let name = row["name"]?.string, AtlasValue.contentText(name, max: 300) else { return .bad("name") }
        guard let country = row["country"]?.string, countryCodes.contains(country) else { return .bad("country") }
        func note(_ reason: String) { report(CatalogParseIssue(.university, key, reason)) }
        if !AtlasParse.exact(row, universityKeys) { note("keys") }
        var cityKey: String?
        if !AtlasParse.isAbsent(row["cityKey"]) {
            if let raw = row["cityKey"]?.string, AtlasParse.isCityKey(raw) { cityKey = raw } else { note("cityKey") }
        }
        var cityLabel: String?
        if !AtlasParse.isAbsent(row["cityLabel"]) {
            if let raw = row["cityLabel"]?.string, AtlasValue.contentText(raw, max: 200) { cityLabel = raw } else { note("cityLabel") }
        }
        let rawLevels = row["levels"]?.array ?? []
        if row["levels"]?.array == nil
            || rawLevels.contains(where: { !($0.string.map(AtlasValue.levels.contains) ?? false) })
            || Set(rawLevels).count != rawLevels.count {
            note("levels")
        }
        var intakes: [UniversityIndexIntake] = []
        if let entries = row["intakes"]?.array, entries.count <= 400 {
            for entry in entries {
                guard let parsed = intake(entry) else {
                    // Один неверный срок: честное «даты уточняются», а не
                    // чужой срок.
                    note("intakes")
                    intakes = []
                    break
                }
                intakes.append(parsed)
            }
        } else {
            note("intakes")
        }
        if row["hasCosts"]?.bool == nil { note("hasCosts") }
        // Ключ фото, которого нет в библиотеке этой сборки: честная заглушка
        // «фото не добавлено», а не отказ всего каталога.
        let photoKey = row["photoKey"]?.string.flatMap { photoKeys.contains($0) ? $0 : nil }
        return .ok(UniversityIndexEntry(
            id: id,
            name: name,
            country: country,
            cityKey: cityKey,
            cityLabel: cityLabel,
            levels: AtlasValue.levels.filter { rawLevels.contains(.string($0)) },
            photoKey: photoKey,
            intakes: intakes,
            hasCosts: row["hasCosts"] == .bool(true)
        ))
    }

    static func intake(_ value: AtlasJSON) -> UniversityIndexIntake? {
        guard let row = value.object, AtlasParse.exact(row, ["deadline", "start", "startMonth"]) else { return nil }
        func day(_ key: String) -> (ok: Bool, value: String?) {
            if row[key] == .null { return (true, nil) }
            guard let raw = row[key]?.string, AtlasValue.isDay(raw) else { return (false, nil) }
            return (true, raw)
        }
        let deadline = day("deadline")
        let start = day("start")
        var startMonth: String?
        if row["startMonth"] != .null {
            guard let raw = row["startMonth"]?.string, AtlasValue.isMonth(raw) else { return nil }
            startMonth = raw
        }
        guard deadline.ok, start.ok else { return nil }
        return UniversityIndexIntake(deadline: deadline.value, start: start.value, startMonth: startMonth)
    }
}
