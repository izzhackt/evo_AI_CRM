import Foundation

/// Выбор страны студента для «Пути поступления» (миграция 284, план §8.3):
/// ответ `platform.student_country_choice_v1()` и
/// `platform.set_student_country_choice_v1(p_country, p_request_id)`.
/// Разбор строгий, как `parseStudentCountryChoice` веба
/// (src/lib/portal/country-choice.ts): любое отклонение формы даёт nil, и
/// интерфейс показывает честную ошибку или карточку «Выберите страну», а не
/// выдуманную страну.
struct StudentCountryChoice: Equatable, Sendable {
    enum Source: String, Sendable {
        case saved
        case application
        case `case`
        case none
    }

    /// Код страны или `UNDECIDED`; nil только при `source == .none`.
    let country: String?
    let source: Source
    /// Время сохранения; только при `source == .saved`.
    let savedAt: String?

    /// Шесть кодов стран (study-countries.json) в порядке продукта.
    static let countryCodes = CountryTimelineKeys.countries.map { $0.uppercased() }
    /// Значения, которые принимает `set_student_country_choice_v1`.
    static let values = countryCodes + [CountryTimelineRules.undecided]

    private static let timestamp = CountryTimelineRules.pattern(
        #"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$"#
    )

    /// Тело ответа PostgREST (JSONB объекта) → выбор или nil.
    static func parse(_ data: Data) -> StudentCountryChoice? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return parse(object)
    }

    static func parse(_ row: [String: Any]) -> StudentCountryChoice? {
        guard row.keys.sorted() == ["country", "savedAt", "source"],
              let rawSource = row["source"] as? String, let source = Source(rawValue: rawSource) else { return nil }
        let country = row["country"]
        let savedAt = row["savedAt"]
        if source == .saved {
            guard let code = country as? String, values.contains(code),
                  let saved = savedAt as? String, CountryTimelineRules.matches(timestamp, saved),
                  PostgresTimestamp.date(from: saved) != nil else { return nil }
            return StudentCountryChoice(country: code, source: .saved, savedAt: saved)
        }
        guard savedAt is NSNull else { return nil }
        if source == .none {
            return country is NSNull ? StudentCountryChoice(country: nil, source: .none, savedAt: nil) : nil
        }
        // Вывод по умолчанию: только одна из шести стран, «Пока не решил» не выводится.
        guard let code = country as? String, countryCodes.contains(code) else { return nil }
        return StudentCountryChoice(country: code, source: source, savedAt: nil)
    }
}

/// Одна попытка сохранить выбор. Контракт 284: новый `p_request_id` на
/// каждое действие студента; после сбоя тот же выбор повторяется с тем же
/// id, чтобы сервер вернул исходную квитанцию, а не записал дважды.
struct CountryChoiceAttempt: Equatable, Sendable {
    let country: String
    let requestId: UUID

    /// Попытка для нажатия на `country`. `failed`: последняя неудачная
    /// попытка, если она была.
    static func next(for country: String, after failed: CountryChoiceAttempt?, makeId: () -> UUID = UUID.init) -> CountryChoiceAttempt {
        if let failed, failed.country == country { return failed }
        return CountryChoiceAttempt(country: country, requestId: makeId())
    }
}
