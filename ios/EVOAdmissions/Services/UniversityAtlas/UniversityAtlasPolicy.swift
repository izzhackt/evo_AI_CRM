import Foundation

/// Правила экранов «страна → город → вуз» поверх индекса 283, без UI и сети
/// (те же правила, что у веба, план 7.3): поиск по названию на клиенте,
/// города страны в порядке выдачи, «Другие вузы страны», ближайший набор.
enum UniversityAtlasPolicy {
    // MARK: - Поиск

    /// Граница запроса та же, что у веб-поиска каталога (100 знаков).
    static let queryLimit = 100

    /// Нормализация для поиска: без регистра и диакритики, типографские
    /// апострофы как обычный, пробелы схлопнуты («Xi’an» находится по
    /// «xian» и «xi'an»).
    static func normalize(_ value: String) -> String {
        let folded = value.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let unified = folded
            .replacingOccurrences(of: "’", with: "'")
            .replacingOccurrences(of: "‘", with: "'")
            .replacingOccurrences(of: "`", with: "'")
        return unified.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private static func compact(_ value: String) -> String {
        value.filter { $0.isLetter || $0.isNumber }
    }

    /// Вузы всех шести стран, в названии которых есть каждое слово запроса.
    /// Пустой запрос не ищет (на экране остаются страны). Порядок: сначала
    /// названия, которые начинаются с запроса, затем остальные; внутри
    /// порядок индекса (по названию).
    static func search(_ query: String, in universities: [UniversityIndexEntry]) -> [UniversityIndexEntry] {
        let normalized = normalize(String(query.prefix(queryLimit)))
        let tokens = normalized.split(separator: " ").map(String.init).filter { !$0.isEmpty }
        guard !tokens.isEmpty else { return [] }
        let compactQuery = compact(normalized)
        var prefixed: [UniversityIndexEntry] = []
        var rest: [UniversityIndexEntry] = []
        for university in universities {
            let name = normalize(university.name)
            let compactName = compact(name)
            let matches = tokens.allSatisfy { name.contains($0) || compactName.contains(compact($0)) }
                || (!compactQuery.isEmpty && compactName.contains(compactQuery))
            guard matches else { continue }
            if name.hasPrefix(normalized) || compactName.hasPrefix(compactQuery) {
                prefixed.append(university)
            } else {
                rest.append(university)
            }
        }
        return prefixed + rest
    }

    // MARK: - Группы

    /// Города страны в порядке выдачи (страна, больше вузов, название RU).
    static func cities(of country: String, in index: UniversityIndex) -> [AtlasCity] {
        index.cities.filter { $0.country == country }
    }

    /// Вузы опубликованного города в порядке выдачи (по названию).
    static func universities(inCity key: String, in index: UniversityIndex) -> [UniversityIndexEntry] {
        index.universities.filter { $0.cityKey == key }
    }

    /// «Другие вузы страны»: вузы страны без опубликованного города. Ни один
    /// вуз шести стран не пропадает (план 7.1).
    static func otherUniversities(of country: String, in index: UniversityIndex) -> [UniversityIndexEntry] {
        index.universities.filter { $0.country == country && $0.cityKey == nil }
    }

    static func universities(of country: String, in index: UniversityIndex) -> [UniversityIndexEntry] {
        index.universities.filter { $0.country == country }
    }

    /// Подпись места вуза: название опубликованного города на языке
    /// интерфейса, иначе исходная строка карточки.
    static func cityName(for university: UniversityIndexEntry, in index: UniversityIndex, kyrgyz: Bool) -> String? {
        if let key = university.cityKey, let city = index.cities.first(where: { $0.key == key }) {
            return city.name.text(kyrgyz: kyrgyz)
        }
        guard let label = university.cityLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty else { return nil }
        return label
    }

    /// «Страна › Город» на странице вуза (план 7.3). Без опубликованного
    /// города: только страна.
    static func placeLine(country: AtlasCountryRef, city: AtlasCity?, kyrgyz: Bool) -> String {
        let countryName = country.name.text(kyrgyz: kyrgyz)
        guard let city else { return countryName }
        return "\(countryName) › \(city.name.text(kyrgyz: kyrgyz))"
    }

    // MARK: - Числительные

    /// Русская форма после числа: 1 университет, 3 университета,
    /// 5 университетов, 11 университетов; в кыргызском существительное после
    /// числа не меняется (одна форма).
    enum PluralForm: String { case one, few, many }

    static func pluralForm(_ count: Int, kyrgyz: Bool) -> PluralForm {
        if kyrgyz { return .many }
        let mod10 = abs(count) % 10
        let mod100 = abs(count) % 100
        if mod10 == 1, mod100 != 11 { return .one }
        if (2...4).contains(mod10), !(12...14).contains(mod100) { return .few }
        return .many
    }

    // MARK: - Ближайший набор

    /// То же правило, что `nearestUniversityIntake` (веб
    /// `src/lib/portal/universities.ts` и `PortalModels.swift`): ближайший
    /// будущий срок подачи, иначе ближайшее начало (день или месяц), сравнение
    /// по UTC. Индекс уже содержит только наборы `open` и `announced`.
    static func nearestIntake(_ intakes: [UniversityIndexIntake], now: Date) -> NearestUniversityIntake? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: now)
        let month = String(today.prefix(7))
        if let deadline = intakes.compactMap(\.deadline).filter({ $0 >= today }).min() {
            return .init(kind: .deadline, value: deadline)
        }
        let start = intakes.compactMap(\.start).filter { $0 >= today }.min()
        let startMonth = intakes.filter { $0.start == nil }.compactMap(\.startMonth).filter { $0 >= month }.min()
        if let start, startMonth == nil || String(start.prefix(7)) <= startMonth! {
            return .init(kind: .start, value: start)
        }
        return startMonth.map { .init(kind: .startMonth, value: $0) }
    }

    // MARK: - Карта

    /// Пины страны: только вузы с проверенной координатой гео-библиотеки по
    /// `photoKey` (то же правило, что карта 1.0); остальные в счётчике
    /// «без точки».
    static func mapPins(
        for universities: [UniversityIndexEntry],
        geo: [String: UniversityGeoEntry],
        cityName: (UniversityIndexEntry) -> String?
    ) -> (pins: [UniversityMapPin], missing: Int) {
        var pins: [UniversityMapPin] = []
        var missing = 0
        for university in universities {
            guard let key = university.photoKey, let entry = geo[key] else {
                missing += 1
                continue
            }
            pins.append(UniversityMapPin(
                id: university.id,
                name: university.name,
                country: university.country,
                city: cityName(university),
                lat: entry.lat,
                lng: entry.lng
            ))
        }
        return (pins, missing)
    }
}
