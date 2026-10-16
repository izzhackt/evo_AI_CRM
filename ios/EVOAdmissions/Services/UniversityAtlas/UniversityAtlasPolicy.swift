import Foundation

/// Правила экранов «страна → город → вуз» поверх индекса 283, без UI и сети
/// (те же правила, что у веба, план 7.3): поиск по названию на клиенте,
/// города страны в порядке выдачи, «Другие вузы страны», ближайший набор.
enum UniversityAtlasPolicy {
    // MARK: - Поиск

    /// Граница запроса та же, что у веб-поиска каталога (100 знаков).
    static let queryLimit = 100

    /// Нормализация для поиска, шаг в шаг как `normalizeUniversitySearch` веба
    /// (`src/lib/portal/university-search.ts`): NFKD, без знаков диакритики,
    /// нижний регистр, отдельные буквы без диакритики по правилам веба
    /// (`ı→i`, `ł→l`, `ø`/`œ→o`, `ß→ss`), типографские апострофы как
    /// обычный, всё кроме букв, цифр, апострофа и `&` как пробел. Так
    /// «sabanci» находит «Sabancı», «itu» находит «İTÜ», «bogazici» находит
    /// «Boğaziçi», «xi'an» находит «Xi’an».
    static func normalize(_ value: String) -> String {
        var scalars = String.UnicodeScalarView()
        for scalar in value.decomposedStringWithCompatibilityMapping.unicodeScalars where !isMark(scalar) {
            scalars.append(scalar)
        }
        var result = ""
        var pendingSpace = false
        for character in String(scalars).lowercased().unicodeScalars {
            let replacement: String
            switch character {
            case "ı": replacement = "i"
            case "ł": replacement = "l"
            case "ø", "œ": replacement = "o"
            case "ß": replacement = "ss"
            case "’", "‘", "ʼ", "`", "´": replacement = "'"
            default: replacement = String(character)
            }
            for kept in replacement.unicodeScalars {
                if isWordScalar(kept) {
                    if pendingSpace, !result.isEmpty { result.append(" ") }
                    pendingSpace = false
                    result.unicodeScalars.append(kept)
                } else {
                    pendingSpace = true
                }
            }
        }
        return result
    }

    /// `\p{M}`: знаки, которые снимает веб.
    private static func isMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }

    /// `[\p{L}\p{N}'&]`: что веб оставляет в нормализованной строке.
    private static func isWordScalar(_ scalar: Unicode.Scalar) -> Bool {
        if scalar == "'" || scalar == "&" { return true }
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }

    /// Вузы всех шести стран, в названии которых есть каждое слово запроса
    /// (то же правило, что `searchUniversities` веба). Пустой запрос не ищет
    /// (на экране остаются страны). Порядок индекса сохраняется, поэтому
    /// выдача на iPhone и на вебе одна и та же.
    static func search(_ query: String, in universities: [UniversityIndexEntry]) -> [UniversityIndexEntry] {
        let words = normalize(String(query.prefix(queryLimit))).split(separator: " ").map(String.init)
        guard !words.isEmpty else { return [] }
        return universities.filter { university in
            let name = normalize(university.name)
            return words.allSatisfy { name.contains($0) }
        }
    }

    // MARK: - Группы

    /// Города страны: больше вузов выше, затем по названию на языке
    /// интерфейса (`countryCities` веба). Сервер отдаёт порядок по названию
    /// RU, поэтому в кыргызском интерфейсе порядок пересчитывается здесь.
    static func cities(of country: String, in index: UniversityIndex, kyrgyz: Bool = false) -> [AtlasCity] {
        let locale = Locale(identifier: kyrgyz ? "ky" : "ru")
        return index.cities.filter { $0.country == country }.enumerated().sorted { left, right in
            let a = left.element, b = right.element
            let countA = a.universityCount ?? 0, countB = b.universityCount ?? 0
            if countA != countB { return countA > countB }
            let order = a.name.text(kyrgyz: kyrgyz).compare(b.name.text(kyrgyz: kyrgyz), locale: locale)
            if order != .orderedSame { return order == .orderedAscending }
            return left.offset < right.offset
        }.map(\.element)
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
