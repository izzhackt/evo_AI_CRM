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

extension UniversityIndexResponse: Decodable {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        let notModified: Bool = try values.required("notModified")
        if notModified {
            try values.requireExactKeys(["notModified", "version"])
            let version: String = try values.required("version")
            guard UniversityIndex.isVersion(version) else { throw values.corrupted("version", "Invalid index version") }
            self = .notModified(version: version)
        } else {
            self = .full(try UniversityIndex(from: decoder))
        }
    }

    /// Разбор тела ответа RPC. Ошибка разбора не превращается в пустой
    /// каталог: вызывающий показывает сбой или оставляет прежнюю копию.
    static func decode(_ data: Data) throws -> UniversityIndexResponse {
        try JSONDecoder().decode(UniversityIndexResponse.self, from: data)
    }
}

struct UniversityIndex: Decodable, Equatable {
    let version: String
    let countries: [AtlasCountry]
    let cities: [AtlasCity]
    let universities: [UniversityIndexEntry]

    /// Версия непрозрачна (сейчас `g1.` + md5), сравнивается только на
    /// равенство; граница та же, что у входа RPC (до 100 знаков, без
    /// управляющих символов).
    static func isVersion(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 100
            && value.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) }
    }

    init(version: String, countries: [AtlasCountry], cities: [AtlasCity], universities: [UniversityIndexEntry]) {
        self.version = version
        self.countries = countries
        self.cities = cities
        self.universities = universities
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["notModified", "version", "countries", "cities", "universities"])
        guard try values.required("notModified", as: Bool.self) == false else {
            throw values.corrupted("notModified", "A full index must say notModified: false")
        }
        version = try values.required("version")
        countries = try values.required("countries")
        cities = try values.required("cities")
        universities = try values.required("universities")
        guard Self.isVersion(version) else { throw values.corrupted("version", "Invalid index version") }
        try validateReferences(values)
    }

    /// Ссылки и счётчики внутри выдачи согласованы: город указывает на
    /// страну выдачи, вуз на город своей страны, числа на карточках равны
    /// числу записей (контракт 2.1, «сумма по странам = число вузов»).
    private func validateReferences(_ values: KeyedDecodingContainer<AtlasKey>) throws {
        let codes = countries.map(\.code)
        guard Set(codes).count == codes.count, !codes.isEmpty else {
            throw values.corrupted("countries", "Country codes must be unique and present")
        }
        var cityCountry: [String: String] = [:]
        for city in cities {
            guard codes.contains(city.country) else { throw values.corrupted("cities", "City of an unknown country") }
            guard cityCountry.updateValue(city.country, forKey: city.key) == nil else {
                throw values.corrupted("cities", "Duplicate city key")
            }
        }
        var ids = Set<UUID>()
        var perCountry: [String: Int] = [:]
        var perCity: [String: Int] = [:]
        for university in universities {
            guard ids.insert(university.id).inserted else { throw values.corrupted("universities", "Duplicate university id") }
            guard codes.contains(university.country) else { throw values.corrupted("universities", "University of an unknown country") }
            if let key = university.cityKey {
                guard cityCountry[key] == university.country else {
                    throw values.corrupted("universities", "University city is unknown or in another country")
                }
                perCity[key, default: 0] += 1
            }
            perCountry[university.country, default: 0] += 1
        }
        for city in cities where perCity[city.key, default: 0] != city.universityCount {
            throw values.corrupted("cities", "City universityCount differs from its universities")
        }
        for country in countries {
            guard perCountry[country.code, default: 0] == country.universityCount else {
                throw values.corrupted("countries", "Country universityCount differs from its universities")
            }
            guard cities.filter({ $0.country == country.code }).count == country.cityCount else {
                throw values.corrupted("countries", "Country cityCount differs from its cities")
            }
        }
    }
}

/// Карточка страны. Названия фиксированные (283, как
/// `src/lib/study-countries.json`); фото и текст null, пока карточку не
/// заполнили.
struct AtlasCountry: Decodable, Equatable, Identifiable, Hashable {
    let code: String
    let name: LocalizedPair
    let photo: AtlasPhoto?
    let summary: LocalizedPair?
    let universityCount: Int
    let cityCount: Int

    var id: String { code }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["code", "name", "photo", "summary", "universityCount", "cityCount"])
        code = try values.required("code")
        name = try values.required("name")
        photo = try values.nullable("photo")
        summary = try values.nullable("summary")
        universityCount = try values.required("universityCount")
        cityCount = try values.required("cityCount")
        guard AtlasValue.matches(code, "[A-Z]{2}") else { throw values.corrupted("code", "Invalid country code") }
        guard universityCount >= 0, cityCount >= 0 else { throw values.corrupted("universityCount", "Negative count") }
    }
}

/// Факт города: RU и KY, адрес источника и дата проверки.
struct AtlasCityFact: Decodable, Equatable, Hashable {
    let text: LocalizedPair
    let sourceUrl: URL
    let verifiedOn: String

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["ru", "ky", "sourceUrl", "verifiedOn"])
        text = try LocalizedPair(values: values, max: 200)
        let rawSource: String = try values.required("sourceUrl")
        verifiedOn = try values.required("verifiedOn")
        guard let url = AtlasValue.httpsURL(rawSource) else { throw values.corrupted("sourceUrl", "Fact source must be https") }
        guard AtlasValue.isDay(verifiedOn) else { throw values.corrupted("verifiedOn", "Invalid date") }
        sourceUrl = url
    }
}

/// Опубликованный город. В индексе к карточке добавлено `universityCount`,
/// на странице вуза его нет; набор ключей проверяется по месту разбора.
/// Опубликованная карточка всегда полная (CHECK в 283): фото, текст, факт.
struct AtlasCity: Decodable, Equatable, Identifiable, Hashable {
    let key: String
    let country: String
    let name: LocalizedPair
    let photo: AtlasPhoto
    let summary: LocalizedPair
    let fact: AtlasCityFact
    /// nil только у города со страницы вуза.
    let universityCount: Int?

    var id: String { key }

    private static let cardKeys: Set<String> = ["key", "country", "name", "photo", "summary", "fact"]

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        let present = Set(values.allKeys.map(\.stringValue))
        if present.contains("universityCount") {
            try values.requireExactKeys(Self.cardKeys.union(["universityCount"]))
            let count: Int = try values.required("universityCount")
            guard count >= 1 else { throw values.corrupted("universityCount", "A listed city has universities") }
            universityCount = count
        } else {
            try values.requireExactKeys(Self.cardKeys)
            universityCount = nil
        }
        key = try values.required("key")
        country = try values.required("country")
        name = try values.required("name")
        photo = try values.required("photo")
        summary = try values.required("summary")
        fact = try values.required("fact")
        guard key.count >= 2, key.count <= 64, AtlasValue.matches(key, "[a-z0-9]+(-[a-z0-9]+)*") else {
            throw values.corrupted("key", "Invalid city key")
        }
        guard AtlasValue.matches(country, "[A-Z]{2}") else { throw values.corrupted("country", "Invalid country code") }
        guard photo.path.hasPrefix("geography/cities/") else { throw values.corrupted("photo", "City photo outside cities/") }
    }
}

/// Дата набора: срок подачи, начало, месяц начала; каждое может быть null.
struct UniversityIndexIntake: Decodable, Equatable, Hashable {
    let deadline: String?
    let start: String?
    let startMonth: String?

    init(deadline: String?, start: String?, startMonth: String?) {
        self.deadline = deadline
        self.start = start
        self.startMonth = startMonth
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["deadline", "start", "startMonth"])
        deadline = try values.nullable("deadline")
        start = try values.nullable("start")
        startMonth = try values.nullable("startMonth")
        if let deadline, !AtlasValue.isDay(deadline) { throw values.corrupted("deadline", "Invalid date") }
        if let start, !AtlasValue.isDay(start) { throw values.corrupted("start", "Invalid date") }
        if let startMonth, !AtlasValue.isMonth(startMonth) { throw values.corrupted("startMonth", "Invalid month") }
    }
}

/// Краткая карточка вуза в индексе.
struct UniversityIndexEntry: Decodable, Equatable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let country: String
    /// null: у вуза нет опубликованного города, он в «Других вузах страны».
    let cityKey: String?
    /// Исходная строка `content.city` карточки вуза.
    let cityLabel: String?
    let levels: [String]
    let photoKey: String?
    let intakes: [UniversityIndexIntake]
    let hasCosts: Bool

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["id", "name", "country", "cityKey", "cityLabel", "levels", "photoKey", "intakes", "hasCosts"])
        id = try values.required("id")
        name = try values.required("name")
        country = try values.required("country")
        cityKey = try values.nullable("cityKey")
        cityLabel = try values.nullable("cityLabel")
        levels = try values.required("levels")
        photoKey = try values.nullable("photoKey")
        intakes = try values.required("intakes")
        hasCosts = try values.required("hasCosts")
        guard AtlasValue.isText(name, max: 300) else { throw values.corrupted("name", "Empty name") }
        guard AtlasValue.matches(country, "[A-Z]{2}") else { throw values.corrupted("country", "Invalid country code") }
        // Порядок продукта и без повторов: language … doctorate.
        let positions = levels.compactMap { AtlasValue.levels.firstIndex(of: $0) }
        guard positions.count == levels.count, positions == positions.sorted(), Set(positions).count == positions.count else {
            throw values.corrupted("levels", "Levels outside the domain or out of order")
        }
    }
}
