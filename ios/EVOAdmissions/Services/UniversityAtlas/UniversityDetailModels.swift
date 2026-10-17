import Foundation

/// Ответ `platform.student_university_detail_v1(p_institution_id)` (283,
/// контракт 2.2, 2.2a): страница вуза одним вызовом. Обёртка, `university`
/// (тот же `UniversityCatalogItem`, что у прежних RPC каталога: «ровно
/// элемент items»), страна, избранное, консультация и подготовки строгие:
/// отклонение даёт ошибку и экран «не удалось загрузить». Название страны,
/// город и стоимость деградируют по одному, как `parseStudentUniversityDetail`
/// веба: неверный город даёт страницу без города, неверная строка стоимости
/// или курс опускаются, строка без своего курса теряет ориентир в USD, без
/// строк блока «Стоимость» нет. Подготовки обобщены параметром: приложение
/// подставляет `CatalogPreparation`, hostless-тесты собственную заглушку.
struct UniversityDetailPayload<Preparation: Decodable> {
    let university: UniversityCatalogItem
    let country: AtlasCountryRef
    /// null: у вуза нет опубликованного города или карточка города не
    /// прошла разбор.
    let city: AtlasCity?
    let favored: Bool
    let openConsultation: ConsultationReceipt?
    /// null: дело кабинета не читается (как `catch` на вебе).
    let preparations: UniversityDetailPreparations<Preparation>?
    /// null: опубликованных строк нет (или ни одна не прошла разбор), блока
    /// «Стоимость» нет совсем.
    let costs: UniversityCosts?

    /// - Parameter expectedId: вуз, который открыли: ответ о другом вузе
    ///   считается сбоем, а не подменой.
    static func decode(
        _ data: Data,
        expectedId: UUID? = nil,
        report: CatalogParseReporter = CatalogParseLog.ignore,
        countryCodes: [String] = StudyCountries.codes
    ) throws -> UniversityDetailPayload {
        let raw = try JSONDecoder().decode(Raw.self, from: data)
        if let expectedId, raw.university.id != expectedId { throw UniversityCatalogDecodingError.envelope }
        guard let countryRow = raw.country.object, let code = countryRow["code"]?.string,
              code == raw.university.content.country, countryCodes.contains(code) else {
            throw UniversityCatalogDecodingError.envelope
        }
        var countryName = AtlasParse.exact(countryRow, ["code", "name"]) ? AtlasParse.localized(countryRow["name"], max: 100) : nil
        if countryName == nil {
            report(CatalogParseIssue(.country, code, "name"))
            countryName = AtlasParse.fallbackCountryName(code)
        }
        var city: AtlasCity?
        if raw.city != .null {
            switch AtlasParse.city(raw.city, withCount: false, countryCodes: countryCodes) {
            case .bad(let reason):
                report(CatalogParseIssue(.city, AtlasParse.cityKey(raw.city), reason))
            case .ok(let parsed) where parsed.country != code:
                report(CatalogParseIssue(.city, parsed.key, "country"))
            case .ok(let parsed):
                city = parsed
            }
        }
        return UniversityDetailPayload(
            university: raw.university,
            country: AtlasCountryRef(code: code, name: countryName!),
            city: city,
            favored: raw.favored,
            openConsultation: raw.openConsultation,
            preparations: raw.preparations,
            costs: UniversityCostsParser.parse(raw.costs, report: report)
        )
    }

    /// Строгая часть ответа; каталожные части приходят как `AtlasJSON`.
    private struct Raw: Decodable {
        let university: UniversityCatalogItem
        let country: AtlasJSON
        let city: AtlasJSON
        let favored: Bool
        let openConsultation: ConsultationReceipt?
        let preparations: UniversityDetailPreparations<Preparation>?
        let costs: AtlasJSON

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: AtlasKey.self)
            try values.requireExactKeys(["university", "country", "city", "favored", "openConsultation", "preparations", "costs"])
            let universityValues = try values.nestedContainer(keyedBy: AtlasKey.self, forKey: AtlasKey("university"))
            try universityValues.requireExactKeys(["id", "version", "publishedAt", "content"])
            university = try values.required("university")
            country = try values.required("country")
            city = try values.required("city")
            favored = try values.required("favored")
            if let consultationValues = try? values.nestedContainer(keyedBy: AtlasKey.self, forKey: AtlasKey("openConsultation")) {
                try consultationValues.requireExactKeys(["requestId", "status", "institutionId", "institutionName", "note", "requestedAt", "handledAt"])
            }
            openConsultation = try values.nullable("openConsultation")
            preparations = try values.nullable("preparations")
            costs = try values.required("costs")
            if let openConsultation, !openConsultation.isOpen {
                throw values.corrupted("openConsultation", "Only an open request is returned")
            }
        }
    }
}

/// Страна вуза с фиксированными названиями.
struct AtlasCountryRef: Equatable {
    let code: String
    let name: LocalizedPair
}

struct UniversityDetailPreparations<Preparation: Decodable>: Decodable {
    let studentCaseId: UUID
    let items: [Preparation]

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["studentCaseId", "items"])
        studentCaseId = try values.required("studentCaseId")
        items = try values.required("items")
    }
}

/// Опубликованная стоимость вуза: строки и курсы по их валютам.
struct UniversityCosts: Equatable {
    let rows: [UniversityCostRow]
    let fxRates: [AtlasFxRate]
}

/// Блок «Стоимость», как `costs` веба: неверная строка или курс опускаются
/// по одному; строка без своего курса теряет ориентир в USD (сумма без
/// названного курса не показывается); не осталось строк: блока нет.
enum UniversityCostsParser {
    static func parse(_ value: AtlasJSON, report: CatalogParseReporter) -> UniversityCosts? {
        if value == .null { return nil }
        guard let row = value.object, AtlasParse.exact(row, ["rows", "fxRates"]),
              let rowValues = row["rows"]?.array, let rateValues = row["fxRates"]?.array else {
            report(CatalogParseIssue(.costs, nil, "shape"))
            return nil
        }
        var rows: [UniversityCostRow] = []
        var ids = Set<UUID>()
        for entry in rowValues.prefix(500) {
            switch costRow(entry) {
            case .bad(let reason):
                report(CatalogParseIssue(.cost, AtlasParse.uuid(entry.object?["id"]), reason))
            case .ok(let parsed):
                if ids.contains(parsed.id) {
                    report(CatalogParseIssue(.cost, AtlasParse.uuid(entry.object?["id"]), "duplicate"))
                    continue
                }
                ids.insert(parsed.id)
                rows.append(parsed)
            }
        }
        if rowValues.count > 500 { report(CatalogParseIssue(.costs, nil, "rows")) }
        var rates: [AtlasFxRate] = []
        for entry in rateValues.prefix(50) {
            let parsed = fxRate(entry)
            let currency = entry.object?["currency"]?.string.map { String($0.prefix(3)) }
            guard let parsed, !rates.contains(where: { $0.currency == parsed.currency }) else {
                report(CatalogParseIssue(.fxRate, currency, parsed == nil ? "invalid" : "duplicate"))
                continue
            }
            rates.append(parsed)
        }
        let rated = Set(rates.map(\.currency))
        let shown = rows.map { row -> UniversityCostRow in
            if row.usdApproxMin == nil || rated.contains(row.currency) { return row }
            report(CatalogParseIssue(.cost, row.key, "rate"))
            return row.withoutUsd()
        }
        if shown.isEmpty {
            report(CatalogParseIssue(.costs, nil, "empty"))
            return nil
        }
        return UniversityCosts(rows: shown, fxRates: rates)
    }

    static let rowKeys = ["id", "kind", "period", "studyLevel", "programId", "teachingLanguage", "currency", "exponent",
                          "amountMinMinor", "amountMaxMinor", "usdApproxMin", "usdApproxMax", "academicYear", "note", "source", "verifiedOn"]

    private static func amount(_ value: AtlasJSON?) -> Int64? {
        guard let integer = value?.safeInteger, integer >= 0 else { return nil }
        return integer
    }

    /// `null` или неотрицательное целое; nil во внешнем Optional: неверно.
    private static func optionalAmount(_ value: AtlasJSON?) -> Int64?? {
        if value == .null { return .some(nil) }
        guard let amount = amount(value) else { return nil }
        return .some(amount)
    }

    /// `null` или строка по шаблону; nil во внешнем Optional: неверно.
    private static func optionalText(_ value: AtlasJSON?, _ valid: (String) -> Bool) -> String?? {
        if value == .null { return .some(nil) }
        guard let raw = value?.string, valid(raw) else { return nil }
        return .some(raw)
    }

    static func costRow(_ value: AtlasJSON) -> AtlasParsed<UniversityCostRow> {
        guard let row = value.object, AtlasParse.exact(row, rowKeys) else { return .bad("keys") }
        guard let key = AtlasParse.uuid(row["id"]), let id = UUID(uuidString: key) else { return .bad("id") }
        guard let kind = row["kind"]?.string.flatMap(UniversityCostKind.init(rawValue:)) else { return .bad("kind") }
        guard let period = row["period"]?.string.flatMap(UniversityCostPeriod.init(rawValue:)) else { return .bad("period") }
        guard let studyLevel = optionalText(row["studyLevel"], AtlasValue.levels.contains) else { return .bad("studyLevel") }
        guard let programId = optionalText(row["programId"], { AtlasValue.matches($0, "[a-z0-9][a-z0-9-]{0,63}") }) else { return .bad("programId") }
        guard let teachingLanguage = optionalText(row["teachingLanguage"], { AtlasValue.matches($0, "[a-z]{2}") }) else {
            return .bad("teachingLanguage")
        }
        guard let currency = row["currency"]?.string, AtlasValue.matches(currency, "[A-Z]{3}") else { return .bad("currency") }
        guard let exponent = row["exponent"]?.safeInteger, (0...4).contains(exponent) else { return .bad("exponent") }
        guard let amountMin = amount(row["amountMinMinor"]), let amountMax = optionalAmount(row["amountMaxMinor"]),
              amountMax.map({ $0 > amountMin }) ?? true else { return .bad("amount") }
        guard let usdMin = optionalAmount(row["usdApproxMin"]), let usdMax = optionalAmount(row["usdApproxMax"]),
              usdMax == nil || (amountMax != nil && usdMin != nil) else { return .bad("usd") }
        guard let academicYear = optionalText(row["academicYear"], UniversityCostRow.isAcademicYear) else { return .bad("academicYear") }
        var note: LocalizedPair?
        if row["note"] != .null {
            guard let parsed = AtlasParse.localized(row["note"], max: 300) else { return .bad("note") }
            note = parsed
        }
        guard let sourceRow = row["source"]?.object, AtlasParse.exact(sourceRow, ["kind", "url"]),
              let sourceKind = sourceRow["kind"]?.string.flatMap(UniversityCostSourceKind.init(rawValue:)) else { return .bad("source") }
        let source: UniversityCostSource
        switch sourceKind {
        case .official:
            guard let url = AtlasParse.link(sourceRow["url"]) else { return .bad("source") }
            source = UniversityCostSource(kind: .official, url: url)
        case .agency, .evoDocument:
            // Адрес и название агентства студенту не отдаются (решение
            // владельца 16.10.2026).
            guard sourceRow["url"] == .null else { return .bad("source") }
            source = UniversityCostSource(kind: sourceKind, url: nil)
        }
        guard let verifiedOn = row["verifiedOn"]?.string, AtlasValue.isDay(verifiedOn) else { return .bad("verifiedOn") }
        return .ok(UniversityCostRow(
            id: id, key: key, kind: kind, period: period, studyLevel: studyLevel, programId: programId,
            teachingLanguage: teachingLanguage, currency: currency, exponent: Int(exponent),
            amountMinMinor: amountMin, amountMaxMinor: amountMax, usdApproxMin: usdMin, usdApproxMax: usdMax,
            academicYear: academicYear, note: note, source: source, verifiedOn: verifiedOn
        ))
    }

    static func fxRate(_ value: AtlasJSON) -> AtlasFxRate? {
        guard let row = value.object, AtlasParse.exact(row, ["currency", "unitsPerUsd", "asOf", "sourceName"]),
              let currency = row["currency"]?.string, AtlasValue.matches(currency, "[A-Z]{3}"),
              let unitsPerUsd = row["unitsPerUsd"]?.number, unitsPerUsd > 0,
              let asOf = row["asOf"]?.string, AtlasValue.isDay(asOf),
              let sourceName = row["sourceName"]?.string, CatalogText.text(sourceName, max: 200) else { return nil }
        return AtlasFxRate(currency: currency, unitsPerUsd: unitsPerUsd, asOf: asOf, sourceName: sourceName)
    }
}

enum UniversityCostKind: String, CaseIterable {
    case tuition
    case accommodation
    case applicationFee = "application_fee"
    case insurance
    case other
}

enum UniversityCostPeriod: String, CaseIterable {
    case year, semester, month, week, day, once, program
}

enum UniversityCostSourceKind: String, CaseIterable {
    case official
    case agency
    case evoDocument = "evo_document"
}

/// Источник строки. Адрес есть только у официального: название и адрес
/// агентства студенту не отдаются (решение владельца 16.10.2026).
struct UniversityCostSource: Equatable {
    let kind: UniversityCostSourceKind
    let url: URL?
}

struct UniversityCostRow: Equatable, Identifiable {
    let id: UUID
    /// id строки так, как его прислал сервер (ключ строки журнала).
    let key: String
    let kind: UniversityCostKind
    let period: UniversityCostPeriod
    let studyLevel: String?
    let programId: String?
    let teachingLanguage: String?
    let currency: String
    let exponent: Int
    let amountMinMinor: Int64
    let amountMaxMinor: Int64?
    let usdApproxMin: Int64?
    let usdApproxMax: Int64?
    let academicYear: String?
    let note: LocalizedPair?
    let source: UniversityCostSource
    let verifiedOn: String

    func withoutUsd() -> UniversityCostRow {
        UniversityCostRow(id: id, key: key, kind: kind, period: period, studyLevel: studyLevel, programId: programId,
                          teachingLanguage: teachingLanguage, currency: currency, exponent: exponent,
                          amountMinMinor: amountMinMinor, amountMaxMinor: amountMaxMinor, usdApproxMin: nil, usdApproxMax: nil,
                          academicYear: academicYear, note: note, source: source, verifiedOn: verifiedOn)
    }

    /// `2026/27` или календарный год набора `2026`, шаблон веба
    /// (`/^20\d{2}(?:\/\d{2})?$/`); следующий год проверяет CHECK базы
    /// `catalog_academic_year_ok`.
    static func isAcademicYear(_ value: String) -> Bool {
        AtlasValue.matches(value, "20[0-9]{2}(/[0-9]{2})?")
    }
}

/// «1 USD = unitsPerUsd currency», источник и дата курса.
struct AtlasFxRate: Equatable {
    let currency: String
    let unitsPerUsd: Double
    let asOf: String
    let sourceName: String
}
