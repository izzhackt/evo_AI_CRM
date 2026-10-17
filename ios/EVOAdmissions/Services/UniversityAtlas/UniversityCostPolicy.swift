import Foundation

/// Что показать в блоке «Стоимость» (план 4.5, контракт 2.2, решения
/// владельца 16.10.2026). Те же правила, что `src/lib/portal/university-costs.ts`
/// и `CostTable.tsx` веба, чтобы один вуз на iPhone и на вебе показывал одно
/// и то же. Без UI и словарей: вью переводит виды, периоды и источники через
/// String Catalog.
///
/// Правила:
/// - нет опубликованных строк (`costs == nil`): блока нет совсем; фразы о
///   том, что стоимость уточнит кто-то другой, нет нигде;
/// - виды в порядке продукта, внутри вида строки по уровню, программе,
///   языку, периоду и сумме (`groupCostRows`);
/// - колонка «≈ USD» только если хотя бы у одной строки есть ориентир;
///   сумма уже округлена сервером;
/// - под строками: учебные годы (новые первыми), виды источников, самая
///   поздняя дата проверки, курс каждой валюты с источником и датой, затем
///   «Окончательную сумму указывает университет».
struct UniversityCostPlan: Equatable {
    struct Group: Equatable {
        let kind: UniversityCostKind
        let rows: [UniversityCostRow]
    }

    let groups: [Group]
    let showsUsd: Bool
    /// Учебные годы строк без повторов, новые первыми; пусто: части
    /// «Ориентир на» нет.
    let academicYears: [String]
    /// Виды источников в постоянном порядке: сайт университета, агентства,
    /// материалы EVO.
    let sourceKinds: [UniversityCostSourceKind]
    let latestVerifiedOn: String
    /// Курсы только валют, которые есть в строках (USD курса не имеет).
    let rates: [AtlasFxRate]
    /// Адреса официальных страниц стоимости без повторов, в порядке строк.
    let officialSources: [URL]
}

enum UniversityCostPolicy {
    /// nil: блока «Стоимость» нет.
    static func plan(_ costs: UniversityCosts?) -> UniversityCostPlan? {
        guard let costs, !costs.rows.isEmpty else { return nil }
        let groups = UniversityCostKind.allCases.compactMap { kind -> UniversityCostPlan.Group? in
            let rows = sortedRows(costs.rows.filter { $0.kind == kind })
            return rows.isEmpty ? nil : .init(kind: kind, rows: rows)
        }
        let years = Set(costs.rows.compactMap(\.academicYear)).sorted(by: >)
        let kinds = UniversityCostSourceKind.allCases.filter { kind in costs.rows.contains { $0.source.kind == kind } }
        var official: [URL] = []
        for row in costs.rows where row.source.kind == .official {
            if let url = row.source.url, !official.contains(url) { official.append(url) }
        }
        let currencies = Set(costs.rows.map(\.currency))
        return UniversityCostPlan(
            groups: groups,
            showsUsd: costs.rows.contains { $0.usdApproxMin != nil },
            academicYears: years,
            sourceKinds: kinds,
            latestVerifiedOn: costs.rows.map(\.verifiedOn).max() ?? "",
            rates: costs.fxRates.filter { currencies.contains($0.currency) && $0.currency != "USD" },
            officialSources: official
        )
    }

    /// Порядок строк внутри вида, как `groupCostRows` веба: строка без
    /// уровня первой, затем уровни в порядке продукта, программа, язык,
    /// период, меньшая сумма; при равенстве порядок сервера.
    static func sortedRows(_ rows: [UniversityCostRow]) -> [UniversityCostRow] {
        func level(_ row: UniversityCostRow) -> Int {
            guard let value = row.studyLevel else { return -1 }
            return AtlasValue.levels.firstIndex(of: value) ?? -1
        }
        func period(_ row: UniversityCostRow) -> Int {
            UniversityCostPeriod.allCases.firstIndex(of: row.period) ?? 0
        }
        return rows.enumerated().sorted { left, right in
            let a = left.element, b = right.element
            if level(a) != level(b) { return level(a) < level(b) }
            if (a.programId ?? "") != (b.programId ?? "") { return (a.programId ?? "") < (b.programId ?? "") }
            if (a.teachingLanguage ?? "") != (b.teachingLanguage ?? "") { return (a.teachingLanguage ?? "") < (b.teachingLanguage ?? "") }
            if period(a) != period(b) { return period(a) < period(b) }
            if a.amountMinMinor != b.amountMinMinor { return a.amountMinMinor < b.amountMinMinor }
            return left.offset < right.offset
        }.map(\.element)
    }

    // MARK: - Подпись строки

    /// Подпись строки и уточнения, как `rowLabel` в `CostTable.tsx`.
    struct RowLabel: Equatable {
        let label: String
        let details: String?
    }

    /// Словарь подписей: вью берёт его из String Catalog, тесты подставляют
    /// свой.
    struct Texts {
        let level: (String) -> String
        let language: (String) -> String
        let kind: (UniversityCostKind) -> String
    }

    /// Обучение: программа строки, иначе уровень, иначе «Обучение»; язык
    /// через запятую («Бакалавриат, на английском»); пояснение целиком в
    /// уточнениях. Остальные виды: первая часть пояснения это подпись
    /// («Двухместная комната»), остальные части уточнения; без пояснения
    /// подпись это вид.
    static func rowLabel(
        _ row: UniversityCostRow,
        programTitles: [String: String],
        kyrgyz: Bool,
        texts: Texts
    ) -> RowLabel {
        let note = row.note.map { splitNote($0.text(kyrgyz: kyrgyz)) } ?? []
        if row.kind == .tuition {
            let base = row.programId.flatMap { programTitles[$0] }
                ?? row.studyLevel.map(texts.level)
                ?? texts.kind(.tuition)
            let label = row.teachingLanguage.map { "\(base), \(texts.language($0))" } ?? base
            return RowLabel(label: label, details: note.isEmpty ? nil : note.joined(separator: " · "))
        }
        guard let first = note.first else { return RowLabel(label: texts.kind(row.kind), details: nil) }
        let rest = note.dropFirst()
        return RowLabel(label: first, details: rest.isEmpty ? nil : rest.joined(separator: " · "))
    }

    /// «Двухместная комната; Цена за одного человека» → две части
    /// (`splitCostNote` веба).
    static func splitNote(_ note: String) -> [String] {
        note.components(separatedBy: ";")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    // MARK: - Числа и даты

    /// Неразрывный пробел: сумма и валюта, «г.» и год не разрываются.
    static let nbsp = "\u{00A0}"

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

    /// Курс «1 USD = x»: до пяти значащих цифр, как `formatUnitsPerUsd`
    /// веба («6,691», «49,418», «3,6725», «0,89222»).
    static func rate(_ value: Double, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.usesSignificantDigits = true
        formatter.minimumSignificantDigits = 1
        formatter.maximumSignificantDigits = 5
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Дата «16 октября 2026 г.», как `universityDateLabel` веба; «г.» не
    /// уходит на новую строку.
    static func dateLabel(_ raw: String, locale: Locale) -> String {
        guard let label = CatalogDate.dayLabel(from: raw, locale: locale) else { return raw }
        guard label.hasSuffix("г."), let space = label.dropLast(2).last, space.isWhitespace else { return label }
        return String(label.dropLast(3)) + nbsp + "г."
    }

    /// Дата с «г.» в конце предложения не даёт двух точек.
    static func sentenceEnd(_ value: String) -> String {
        value.hasSuffix("..") ? String(value.dropLast()) : value
    }

    /// Короткая подпись источника курса для студента (`fxSourceLabel` веба).
    /// Admin записывает полное английское название (сид 16.10.2026: ЕЦБ и ЦБ
    /// ОАЭ); другое название показывается как записано.
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
