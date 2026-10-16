import Foundation

/// Один список стран продукта (решение владельца 16.10.2026): CN, MY, AE, TR,
/// IT, CZ в этом порядке и «Пока не решил» для форм, которым он нужен.
/// Тот же файл, что у веба и CRM (`src/lib/study-countries.json`, ресурс
/// bundle через project.yml, как фото- и гео-библиотеки); база держит те же
/// коды (`platform_private.study_country_codes()`, миграция 282). Копии
/// списка в Swift нет.
struct StudyCountry: Decodable, Equatable {
    let code: String
    let ru: String
    let ky: String
    let website: String

    /// Название на языке интерфейса: KY или RU (вызывающий знает язык,
    /// `AppLocale.isKyrgyz`; файл остаётся чистым для hostless-тестов).
    func name(kyrgyz: Bool) -> String { kyrgyz ? ky : ru }
}

struct StudyCountryLibrary: Decodable, Equatable {
    let countries: [StudyCountry]
    let undecided: StudyCountry
}

/// Класс-метка: bundle, в который собран этот файл (приложение или
/// hostless unit-тесты), и в котором лежит ресурс.
private final class StudyCountriesBundleToken {}

enum StudyCountries {
    static let library: StudyCountryLibrary? = load(from: Bundle(for: StudyCountriesBundleToken.self))

    static func load(from bundle: Bundle) -> StudyCountryLibrary? {
        guard
            let url = bundle.url(forResource: "study-countries", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let library = try? JSONDecoder().decode(StudyCountryLibrary.self, from: data),
            !library.countries.isEmpty
        else { return nil }
        return library
    }

    /// Коды стран в порядке продукта (без «Пока не решил»).
    static var codes: [String] { library?.countries.map(\.code) ?? [] }

    /// Значение «Пока не решил» в анкете. Это не страна.
    static let undecidedCode = "undecided"

    /// Название страны списка или «Пока не решил»; nil для прочих кодов.
    static func name(for code: String, kyrgyz: Bool) -> String? {
        guard let library else { return nil }
        if code == library.undecided.code { return library.undecided.name(kyrgyz: kyrgyz) }
        return library.countries.first { $0.code == code }?.name(kyrgyz: kyrgyz)
    }

    /// Варианты выбора в порядке продукта; «Пока не решил» последним, если
    /// форме он нужен (анкета).
    static func options(kyrgyz: Bool, undecided: Bool = false) -> [(code: String, label: String)] {
        guard let library else { return [] }
        let rows = undecided ? library.countries + [library.undecided] : library.countries
        return rows.map { (code: $0.code, label: $0.name(kyrgyz: kyrgyz)) }
    }
}
