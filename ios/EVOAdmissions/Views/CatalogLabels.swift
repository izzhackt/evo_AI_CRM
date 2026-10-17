import SwiftUI

// Общие подписи каталога: язык интерфейса, страна, уровень программы и
// место вуза. Их читают и экраны университетов v2, и «Избранное», и
// прежний список; вынесены из `UniversitiesView.swift`, чтобы прежний
// список можно было удалить отдельным PR (ревью S3.4, m6).

/// UI language of the bundle actually being displayed (ru or ky). Used for
/// data-driven labels (country names, dates) so they match the interface
/// language instead of an English device locale.
enum AppLocale {
    static var current: Locale {
        Locale(identifier: Bundle.main.preferredLocalizations.first ?? "ru")
    }

    /// Отображается ли сейчас кыргызская локализация bundle'а. Управляет
    /// выбором RU/KY-полей ДВУЯЗЫЧНОГО контента (обучение, профессии), где
    /// перевод приходит данными, а не через String Catalog.
    static var isKyrgyz: Bool {
        Bundle.main.preferredLocalizations.first == "ky"
    }

    /// Пара RU/KY контентных строк → строка активного языка интерфейса.
    static func pick(ru: String, ky: String) -> String {
        isKyrgyz ? ky : ru
    }
}

/// Название страны на языке интерфейса: страны единого списка и «Пока не
/// решил» по `study-countries.json` (как веб), прочие коды (избранное и
/// история прежних стран) по ICU, затем сам код.
func studyCountryLabel(_ code: String) -> String {
    StudyCountries.name(for: code, kyrgyz: AppLocale.isKyrgyz)
        ?? AppLocale.current.localizedString(forRegionCode: code)
        ?? code
}

/// Локализованная подпись уровня программы (151). Общая для карточки вуза и
/// таблицы сравнения избранного.
func universityLevelLabel(_ level: String) -> String {
    let key: String.LocalizationValue
    switch level {
    case "language": key = "university_level_language"
    case "foundation": key = "university_level_foundation"
    case "diploma": key = "university_level_diploma"
    case "bachelor": key = "university_level_bachelor"
    case "master": key = "university_level_master"
    case "doctorate": key = "university_level_doctorate"
    default: return level
    }
    return String(localized: key)
}

/// «Город, Страна» — country name localized to the interface language.
func universityPlaceLine(_ content: UniversityContent) -> String {
    let country = studyCountryLabel(content.country)
    if let city = content.city, !city.isEmpty {
        return "\(city), \(country)"
    }
    return country
}
