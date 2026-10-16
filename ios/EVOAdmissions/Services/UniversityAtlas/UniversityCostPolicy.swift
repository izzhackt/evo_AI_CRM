import Foundation

/// Что показать в блоке «Стоимость» (план 4.5, контракт 2.2, решения
/// владельца 16.10.2026). Без UI и словарей: вью переводит виды, периоды и
/// источники через String Catalog.
///
/// Правила:
/// - нет опубликованных строк (`costs == nil`): блока нет совсем; фразы о
///   том, что стоимость уточнит кто-то другой, нет нигде;
/// - колонка «≈ USD» только если хотя бы у одной строки есть ориентир;
///   сумма уже округлена сервером;
/// - строка под таблицей: учебные годы строк (строка без года в ней не
///   участвует), виды источников, самая поздняя дата проверки, курс каждой
///   валюты с источником и датой, затем «Окончательную сумму указывает
///   университет».
struct UniversityCostPlan: Equatable {
    struct Group: Equatable {
        let kind: UniversityCostKind
        let rows: [UniversityCostRow]
    }

    let groups: [Group]
    let showsUsd: Bool
    /// Разные годы строк в порядке появления, без повторов.
    let academicYears: [String]
    /// Виды источников в постоянном порядке: сайт университета, агентства,
    /// материалы EVO.
    let sourceKinds: [UniversityCostSourceKind]
    let latestVerifiedOn: String
    /// Курсы только валют, которые есть в строках (USD курса не имеет).
    let rates: [AtlasFxRate]
    /// Адреса официальных страниц стоимости без повторов.
    let officialSources: [URL]
}

enum UniversityCostPolicy {
    /// nil: блока «Стоимость» нет.
    static func plan(_ costs: UniversityCosts?) -> UniversityCostPlan? {
        guard let costs, !costs.rows.isEmpty else { return nil }
        var groups: [UniversityCostPlan.Group] = []
        for row in costs.rows {
            if let last = groups.last, last.kind == row.kind {
                groups[groups.count - 1] = .init(kind: last.kind, rows: last.rows + [row])
            } else {
                groups.append(.init(kind: row.kind, rows: [row]))
            }
        }
        var years: [String] = []
        for year in costs.rows.compactMap(\.academicYear) where !years.contains(year) {
            years.append(year)
        }
        let kinds = UniversityCostSourceKind.allCases.filter { kind in costs.rows.contains { $0.source.kind == kind } }
        var official: [URL] = []
        for url in costs.rows.compactMap(\.source.url) where !official.contains(url) {
            official.append(url)
        }
        let currencies = Set(costs.rows.map(\.currency))
        return UniversityCostPlan(
            groups: groups,
            showsUsd: costs.rows.contains { $0.usdApproxMin != nil },
            academicYears: years,
            sourceKinds: kinds,
            latestVerifiedOn: costs.rows.map(\.verifiedOn).max() ?? "",
            rates: costs.fxRates.filter { currencies.contains($0.currency) },
            officialSources: official
        )
    }

    // MARK: - Числа

    /// Сумма в единицах валюты: минорные единицы / 10^exponent, разряды по
    /// языку интерфейса, дробная часть только если она не нулевая.
    static func amount(minor: Int64, exponent: Int, locale: Locale) -> String {
        let divisor = (0..<max(0, exponent)).reduce(Int64(1)) { value, _ in value * 10 }
        let value = Decimal(minor) / Decimal(divisor)
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = minor % divisor == 0 ? 0 : exponent
        formatter.maximumFractionDigits = exponent
        return formatter.string(from: value as NSDecimalNumber) ?? "\(value)"
    }

    /// Целые USD ориентира (сервер уже округлил до 10).
    static func whole(_ value: Int64, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Курс «1 USD = x»: до четырёх знаков после запятой, без хвостовых нулей.
    static func rate(_ value: Double, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 4
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Короткая подпись источника курса для студента. Admin записывает
    /// полное английское название (сид 16.10.2026: ЕЦБ и ЦБ ОАЭ); другое
    /// название показывается как записано.
    enum RateSource: Equatable {
        case europeanCentralBank
        case centralBankUAE
        case verbatim(String)
    }

    static func rateSource(_ name: String) -> RateSource {
        if name.hasPrefix("European Central Bank") { return .europeanCentralBank }
        if name.hasPrefix("Central Bank of the UAE") { return .centralBankUAE }
        return .verbatim(name)
    }
}
