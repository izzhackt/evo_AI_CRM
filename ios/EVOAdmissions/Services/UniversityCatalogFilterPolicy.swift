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

    /// Полный ISO-список веб-фильтра стран — `UNIVERSITY_COUNTRIES`
    /// (src/lib/platform-university-catalog.ts:7), 249 кодов, той же строкой.
    static let countries: [String] = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
        .split(separator: " ")
        .map(String.init)

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

    /// `p_country`: только код из доменного списка — недоменное значение
    /// веб-страница отвергает целиком (`/^[A-Z]{2}$/` + список,
    /// platform-university-catalog.ts:95); iOS-пикер его не порождает,
    /// проверка защищает от рассинхронизации формы и домена.
    static func countryParameter(_ filters: UniversityCatalogFilters) -> String? {
        countries.contains(filters.country) ? filters.country : nil
    }

    /// `p_level`: только значение доменной шкалы (та же серверная граница).
    static func levelParameter(_ filters: UniversityCatalogFilters) -> String? {
        levels.contains(filters.level) ? filters.level : nil
    }
}
