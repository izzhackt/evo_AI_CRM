import Foundation

/// Ответ `platform.student_university_detail_v1(p_institution_id)` (283,
/// контракт 2.2): страница вуза одним вызовом. `university` разбирается тем
/// же `UniversityCatalogItem`, что и прежние RPC каталога (контракт: «ровно
/// элемент items»). Подготовки обобщены параметром: приложение подставляет
/// `CatalogPreparation`, hostless-тесты собственную заглушку, и тестовой цели
/// не нужен весь слой подготовок.
struct UniversityDetailPayload<Preparation: Decodable>: Decodable {
    let university: UniversityCatalogItem
    let country: AtlasCountryRef
    /// null: у вуза нет опубликованного города.
    let city: AtlasCity?
    let favored: Bool
    let openConsultation: ConsultationReceipt?
    /// null: дело кабинета не читается (как `catch` на вебе).
    let preparations: UniversityDetailPreparations<Preparation>?
    /// null: опубликованных строк нет, блока «Стоимость» нет совсем.
    let costs: UniversityCosts?

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["university", "country", "city", "favored", "openConsultation", "preparations", "costs"])
        let universityValues = try values.nestedContainer(keyedBy: AtlasKey.self, forKey: AtlasKey("university"))
        try universityValues.requireExactKeys(["id", "version", "publishedAt", "content"])
        university = try values.required("university")
        country = try values.required("country")
        city = try values.nullable("city")
        favored = try values.required("favored")
        if let consultationValues = try? values.nestedContainer(keyedBy: AtlasKey.self, forKey: AtlasKey("openConsultation")) {
            try consultationValues.requireExactKeys(["requestId", "status", "institutionId", "institutionName", "note", "requestedAt", "handledAt"])
        }
        openConsultation = try values.nullable("openConsultation")
        preparations = try values.nullable("preparations")
        costs = try values.nullable("costs")

        guard university.content.country == country.code else {
            throw values.corrupted("country", "University country differs from the card")
        }
        if let city {
            guard city.universityCount == nil else { throw values.corrupted("city", "Detail city has no universityCount") }
            guard city.country == country.code else { throw values.corrupted("city", "City of another country") }
        }
        if let openConsultation, !openConsultation.isOpen {
            throw values.corrupted("openConsultation", "Only an open request is returned")
        }
    }

    static func decode(_ data: Data) throws -> UniversityDetailPayload {
        try JSONDecoder().decode(UniversityDetailPayload.self, from: data)
    }
}

/// Страна вуза с фиксированными названиями.
struct AtlasCountryRef: Decodable, Equatable {
    let code: String
    let name: LocalizedPair

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["code", "name"])
        code = try values.required("code")
        name = try values.required("name")
        guard AtlasValue.matches(code, "[A-Z]{2}") else { throw values.corrupted("code", "Invalid country code") }
    }
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

/// Опубликованная стоимость вуза: строки и последние курсы по их валютам.
struct UniversityCosts: Decodable, Equatable {
    let rows: [UniversityCostRow]
    let fxRates: [AtlasFxRate]

    init(rows: [UniversityCostRow], fxRates: [AtlasFxRate]) {
        self.rows = rows
        self.fxRates = fxRates
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["rows", "fxRates"])
        rows = try values.required("rows")
        fxRates = try values.required("fxRates")
        // costs != null означает «есть опубликованные строки»; пустой массив
        // это расхождение контракта, а не пустой блок.
        guard !rows.isEmpty else { throw values.corrupted("rows", "Costs without rows must be null") }
        guard Set(rows.map(\.id)).count == rows.count else { throw values.corrupted("rows", "Duplicate cost row") }
        let rateCurrencies = fxRates.map(\.currency)
        guard Set(rateCurrencies).count == rateCurrencies.count else { throw values.corrupted("fxRates", "One rate per currency") }
        let rowCurrencies = Set(rows.map(\.currency))
        guard Set(rateCurrencies).isSubset(of: rowCurrencies) else {
            throw values.corrupted("fxRates", "Rate for a currency without rows")
        }
        for row in rows {
            let hasRate = rateCurrencies.contains(row.currency)
            // Ориентир в USD сервер считает только по курсу и не для USD.
            if row.usdApproxMin != nil, row.currency == "USD" || !hasRate {
                throw values.corrupted("rows", "USD estimate without a rate")
            }
            if row.usdApproxMin == nil, row.currency != "USD", hasRate {
                throw values.corrupted("rows", "Missing USD estimate although a rate exists")
            }
        }
    }
}

enum UniversityCostKind: String, Decodable, CaseIterable {
    case tuition
    case accommodation
    case applicationFee = "application_fee"
    case insurance
    case other
}

enum UniversityCostPeriod: String, Decodable, CaseIterable {
    case year, semester, month, week, day, once, program
}

enum UniversityCostSourceKind: String, Decodable, CaseIterable {
    case official
    case agency
    case evoDocument = "evo_document"
}

/// Источник строки. Адрес есть только у официального: название и адрес
/// агентства студенту не отдаются (решение владельца 16.10.2026).
struct UniversityCostSource: Decodable, Equatable {
    let kind: UniversityCostSourceKind
    let url: URL?

    init(kind: UniversityCostSourceKind, url: URL?) {
        self.kind = kind
        self.url = url
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["kind", "url"])
        kind = try values.required("kind")
        let raw: String? = try values.nullable("url")
        switch kind {
        case .official:
            guard let raw, let url = AtlasValue.httpsURL(raw) else {
                throw values.corrupted("url", "Official source needs an https URL")
            }
            self.url = url
        case .agency, .evoDocument:
            guard raw == nil else { throw values.corrupted("url", "Only an official source carries a URL") }
            self.url = nil
        }
    }
}

struct UniversityCostRow: Decodable, Equatable, Identifiable {
    let id: UUID
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

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["id", "kind", "period", "studyLevel", "programId", "teachingLanguage", "currency",
                                     "exponent", "amountMinMinor", "amountMaxMinor", "usdApproxMin", "usdApproxMax",
                                     "academicYear", "note", "source", "verifiedOn"])
        id = try values.required("id")
        kind = try values.required("kind")
        period = try values.required("period")
        studyLevel = try values.nullable("studyLevel")
        programId = try values.nullable("programId")
        teachingLanguage = try values.nullable("teachingLanguage")
        currency = try values.required("currency")
        exponent = try values.required("exponent")
        amountMinMinor = try values.required("amountMinMinor")
        amountMaxMinor = try values.nullable("amountMaxMinor")
        usdApproxMin = try values.nullable("usdApproxMin")
        usdApproxMax = try values.nullable("usdApproxMax")
        academicYear = try values.nullable("academicYear")
        note = try values.nullable("note")
        source = try values.required("source")
        verifiedOn = try values.required("verifiedOn")
        try validate(values)
    }

    private func validate(_ values: KeyedDecodingContainer<AtlasKey>) throws {
        if let studyLevel, !AtlasValue.levels.contains(studyLevel) { throw values.corrupted("studyLevel", "Unknown level") }
        if let programId, !AtlasValue.matches(programId, "[a-z0-9][a-z0-9-]{0,63}") { throw values.corrupted("programId", "Invalid program id") }
        if let teachingLanguage, !AtlasValue.matches(teachingLanguage, "[a-z]{2}") {
            throw values.corrupted("teachingLanguage", "Invalid language code")
        }
        guard AtlasValue.matches(currency, "[A-Z]{3}") else { throw values.corrupted("currency", "Invalid currency") }
        guard (0...3).contains(exponent) else { throw values.corrupted("exponent", "Invalid exponent") }
        guard amountMinMinor >= 0 else { throw values.corrupted("amountMinMinor", "Negative amount") }
        if let amountMaxMinor, amountMaxMinor <= amountMinMinor { throw values.corrupted("amountMaxMinor", "Max must exceed min") }
        if let usdApproxMin, usdApproxMin < 0 { throw values.corrupted("usdApproxMin", "Negative estimate") }
        if let usdApproxMax {
            guard amountMaxMinor != nil, let usdApproxMin, usdApproxMax >= usdApproxMin else {
                throw values.corrupted("usdApproxMax", "Estimate range without an amount range")
            }
        }
        if amountMaxMinor != nil, usdApproxMin != nil, usdApproxMax == nil {
            throw values.corrupted("usdApproxMax", "Range estimate needs both ends")
        }
        if let academicYear, !Self.isAcademicYear(academicYear) { throw values.corrupted("academicYear", "Invalid academic year") }
        guard AtlasValue.isDay(verifiedOn) else { throw values.corrupted("verifiedOn", "Invalid date") }
    }

    /// `2026/27` (следующий год) или календарный год набора `2026`, как
    /// `catalog_academic_year_ok` (283).
    static func isAcademicYear(_ value: String) -> Bool {
        if AtlasValue.matches(value, "20[0-9]{2}") { return true }
        guard AtlasValue.matches(value, "20[0-9]{2}/[0-9]{2}"),
              let start = Int(value.prefix(4)), let end = Int(value.suffix(2)) else { return false }
        return end == (start + 1) % 100
    }
}

/// «1 USD = unitsPerUsd currency», источник и дата курса.
struct AtlasFxRate: Decodable, Equatable {
    let currency: String
    let unitsPerUsd: Double
    let asOf: String
    let sourceName: String

    init(currency: String, unitsPerUsd: Double, asOf: String, sourceName: String) {
        self.currency = currency
        self.unitsPerUsd = unitsPerUsd
        self.asOf = asOf
        self.sourceName = sourceName
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: AtlasKey.self)
        try values.requireExactKeys(["currency", "unitsPerUsd", "asOf", "sourceName"])
        currency = try values.required("currency")
        unitsPerUsd = try values.required("unitsPerUsd")
        asOf = try values.required("asOf")
        sourceName = try values.required("sourceName")
        guard AtlasValue.matches(currency, "[A-Z]{3}"), currency != "USD" else { throw values.corrupted("currency", "Invalid rate currency") }
        guard unitsPerUsd.isFinite, unitsPerUsd > 0 else { throw values.corrupted("unitsPerUsd", "Rate must be positive") }
        guard AtlasValue.isDay(asOf) else { throw values.corrupted("asOf", "Invalid date") }
        guard AtlasValue.isText(sourceName, max: 200) else { throw values.corrupted("sourceName", "Empty rate source") }
    }
}
