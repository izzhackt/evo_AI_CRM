import Foundation

/// Каталожные фильтры «поиск/страна/уровень» — те же значения и границы,
/// что у веб-каталога (PORT-3a). Пустая строка = «фильтр не задан», как
/// `EMPTY_UNIVERSITY_FILTERS` веба (src/lib/v3/university-source.ts:14).
struct UniversityCatalogFilters: Equatable {
    var query: String = ""
    var country: String = ""
    var level: String = ""

    var isActive: Bool { !query.isEmpty || !country.isEmpty || !level.isEmpty }
}

/// Чистая политика построения RPC-параметров: имена и семантика зеркалят
/// веб-обёртку `args` (src/lib/v3/university-source.ts:15) — `p_query`,
/// `p_country`, `p_level`; «пустое → NULL» веба (`filters.query || null`)
/// на iOS выражено `nil`, который вызов RPC не сериализует (функция
/// объявляет DEFAULT NULL — одиночная карточка уже полагается на пропуск
/// параметров).
enum UniversityCatalogFilterPolicy {
    /// Доменная шкала уровней — `UNIVERSITY_LEVELS`
    /// (src/lib/platform-university-catalog.ts:3), порядок сохранён.
    static let levels = ["language", "foundation", "diploma", "bachelor", "master", "doctorate"]

    /// Страны фильтра: единый список продукта (`study-countries.json`,
    /// тот же файл, что у веба; каталог студента и сервер отдают только их,
    /// миграция 282). Порядок продукта, не алфавит.
    static var countries: [String] { StudyCountries.codes }

    /// Веб ограничивает запрос 100 символами (`maxLength={100}`,
    /// Catalog.tsx:98; сервер отвергает более длинный —
    /// `text(query, 100, true)`, platform-university-catalog.ts:95).
    static func clampQuery(_ raw: String) -> String {
        String(raw.prefix(100))
    }

    /// `p_query`: пустая строка → nil (веб: `filters.query || null`).
    static func queryParameter(_ filters: UniversityCatalogFilters) -> String? {
        let query = clampQuery(filters.query)
        return query.isEmpty ? nil : query
    }

    /// `p_country`: только код единого списка; другую страну веб-страница
    /// отвергает целиком (404), сервер студенту её не отдаёт (282); iOS-пикер
    /// её не порождает, проверка защищает от рассинхронизации формы и домена.
    static func countryParameter(_ filters: UniversityCatalogFilters) -> String? {
        countries.contains(filters.country) ? filters.country : nil
    }

    /// `p_level`: только значение доменной шкалы (та же серверная граница).
    static func levelParameter(_ filters: UniversityCatalogFilters) -> String? {
        levels.contains(filters.level) ? filters.level : nil
    }
}
