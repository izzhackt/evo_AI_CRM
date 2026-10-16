import Foundation

// «Путь поступления» на «Главной» (S4, план docs/EVO_STUDENT_APP_V2_PLAN_2026-10-16.md
// §8). Те же семь файлов, что читает веб (`src/content/timelines/*.json`,
// ресурсы bundle через project.yml, копий в Swift нет), и тот же выбор, что
// `selectCountryTimeline` в src/lib/portal/country-timeline.ts (контракт
// docs/portal/country-timeline-contract.md §2 и §3).
//
// Разбор строгий, как у веба: закрытый набор ключей, словари значений,
// правила текста. Регулярные выражения повторяют семантику JavaScript, а не
// ICU: `\s` и `trim()` с U+FEFF и U+000B, `$` только в конце строки (`\z`),
// `\b` по ASCII. Файл с повтором ключа или BOM отклоняется до `JSONDecoder`:
// при повторе `JSONDecoder` взял бы первое значение, а `JSON.parse` веба
// берёт последнее (review #1208 M1). Файл, который не прошёл разбор, не
// показывается: вместо страны студент видит общий маршрут, а «Главная» не
// падает. Паритет с вебом проверяет `CountryTimelineTests` по отпечаткам
// выдачи, которые считает scripts/portal/write-country-timeline-ios-parity.mjs.

// MARK: - Файл контента

struct TimelineL10n: Equatable, Sendable {
    let ru: String
    let ky: String

    func pick(kyrgyz: Bool) -> String { kyrgyz ? ky : ru }
}

/// Текст студенту. `undated` есть ровно у текстов с годом: вариант без даты
/// после `validUntil` или `hidden` (поле или пункт скрывается).
struct TimelineText: Equatable, Sendable {
    enum Undated: Equatable, Sendable {
        case absent
        case hidden
        case text(TimelineL10n)
    }

    let ru: String
    let ky: String
    let undated: Undated
}

enum TimelineStatus: String, Sendable { case draft, ownerReview = "owner_review", approved }
enum TimelineWho: String, Sendable, CaseIterable { case student, evo, university, embassy }
enum TimelineItemStatus: String, Sendable { case confirmed, verify }
enum TimelineIntakeModel: String, Sendable { case annual, rolling, none }
enum TimelineTimingBasis: String, Sendable { case ownerGuide = "owner_guide", official, evoInternal = "evo_internal", estimate }
enum TimelineSourceKind: String, Sendable {
    case ownerGuide = "owner_guide", evoInternal = "evo_internal", official, university, secondary
}
enum TimelineOffsetUnit: String, Sendable { case week, month }

struct TimelineOffset: Equatable, Sendable {
    let value: Int
    let unit: TimelineOffsetUnit
}

struct TimelineTiming: Equatable, Sendable {
    let from: TimelineOffset
    let to: TimelineOffset
    let label: TimelineText
    let basis: TimelineTimingBasis
}

struct TimelineItem: Equatable, Sendable {
    let id: String
    let who: TimelineWho
    let status: TimelineItemStatus
    let text: TimelineText
    let note: TimelineText?
    let appliesTo: TimelineText?
    let sources: [String]
}

struct TimelineLink: Equatable, Sendable {
    let id: String
    let label: TimelineL10n
    let url: String
    let appModule: String?
}

struct TimelineStep: Equatable, Sendable {
    let id: String
    let order: Int
    let stageKeys: [String]
    let title: TimelineText
    let summary: TimelineText
    let timing: TimelineTiming?
    let checklist: [TimelineItem]
    let note: TimelineText?
    let doneWhen: TimelineText
    let links: [TimelineLink]?
    let sources: [String]
}

struct TimelineSource: Equatable, Sendable {
    let id: String
    let kind: TimelineSourceKind
    let title: String
    let url: String?
    let checkedOn: String
}

struct CountryTimelineFile: Equatable, Sendable {
    struct Intake: Equatable, Sendable {
        let model: TimelineIntakeModel
        let reference: String?
        let label: TimelineText
        let note: TimelineText?
    }

    struct Disclaimers: Equatable, Sendable {
        let timing: TimelineL10n
        let documents: TimelineL10n
        let decisions: TimelineL10n
    }

    let schemaVersion: Int
    let contentVersion: Int
    let country: String
    let name: TimelineL10n
    let status: TimelineStatus
    let updatedOn: String
    let validUntil: String
    let kyStatus: String
    let intake: Intake
    let disclaimers: Disclaimers
    let steps: [TimelineStep]
    let sources: [TimelineSource]
}

/// Ошибка разбора с путём поля, как у веба (`timeline cn: $.steps[2].id: …`).
struct TimelineContentError: Error, Equatable, CustomStringConvertible {
    let file: String
    let path: String
    let reason: String

    var description: String { "timeline \(file): \(path): \(reason)" }
}

// MARK: - Правила (те же, что у веба)

enum CountryTimelineRules {
    /// «Пока не решил» в RPC выбора страны (284) и здесь.
    static let undecided = "UNDECIDED"
    static let stageKeys = ["intake", "profile_and_route", "documents", "applications", "decisions",
                            "visa_and_predeparture", "arrival_and_adaptation"]
    static let appModules = ["csca"]

    /// Пробелы `\s` и `trim()` JavaScript: WhiteSpace и LineTerminator
    /// (U+0009..U+000D, U+0020, U+00A0, U+1680, U+2000..U+200A, U+2028,
    /// U+2029, U+202F, U+205F, U+3000, U+FEFF). У ICU `\s` нет U+000B и
    /// U+FEFF, у `.whitespacesAndNewlines` нет U+FEFF и есть U+0085.
    static let jsSpaceClass = #"\t\n\x{0B}\f\r\x{20}\x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}"#
    static let jsWhitespace: CharacterSet = {
        var set = CharacterSet(charactersIn: "\t\n\u{0B}\u{0C}\r \u{A0}\u{1680}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
        set.insert(charactersIn: Unicode.Scalar(0x2000)!...Unicode.Scalar(0x200A)!)
        return set
    }()
    private static let space = "[\(jsSpaceClass)]"

    /// Абсолютная дата: год 19xx/20xx или полная дата дд.мм.гггг.
    static let absoluteDate = pattern(#"(?<![0-9])(?:19|20)[0-9]{2}(?![0-9])|(?<![0-9])[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4}(?![0-9])"#)
    /// Обещания (план §8.1). В оговорке `decisions` есть только отрицание.
    static let forbiddenPromises: [NSRegularExpression] = [
        pattern("гарантир", caseInsensitive: true),
        pattern("100\(space)*%"),
        pattern("точно\(space)+получ", caseInsensitive: true),
        pattern("кепилд", caseInsensitive: true),
        pattern("сөзсүз\(space)+аласыз", caseInsensitive: true),
    ]
    /// Внутренние сведения, которых студент не видит.
    static let internalMarkers: [NSRegularExpression] = [
        pattern("ОЗО"),
        pattern(#"отдел\p{L}*"# + "\(space)+продаж", caseInsensitive: true),
        pattern("регламент", caseInsensitive: true),
        pattern("плейбук", caseInsensitive: true),
        pattern("скрипт", caseInsensitive: true),
        pattern("агентск", caseInsensitive: true),
        pattern("EDUPRCHINA", caseInsensitive: true),
        pattern("промокод|скидк", caseInsensitive: true),
        pattern("[^\(jsSpaceClass)@]+@[^\(jsSpaceClass)@]+\\.[^\(jsSpaceClass)@]+"),
        pattern("\\+[0-9][0-9\(jsSpaceClass)()-]{7,}"),
    ]
    /// `\b` JavaScript считает границу по ASCII, у ICU она юникодная.
    static let internalPaths = pattern(#"~/|Downloads|EVO_Знания|\.docx|\.pdf(?![A-Za-z0-9_])|supabase/admissions-content"#)
    /// Длинное и короткое тире, цифровое тире и знак минуса.
    static let dashes = pattern("[\u{2012}-\u{2015}\u{2212}]")
    static let doubleSpace = pattern("\(space){2,}")
    static let letters = pattern(#"\p{L}+"#)
    static let latin = pattern("[A-Za-z\u{00C0}-\u{024F}]")
    static let cyrillic = pattern("[\u{0400}-\u{04FF}]")
    /// Латинский термин с кыргызским окончанием («HSKга») допустим.
    // `$` у ICU совпадает и перед последним переводом строки; `$` JavaScript
    // без флага m только в самом конце, это `\z`.
    static let latinWithSuffix = pattern("^[A-Za-z\u{00C0}-\u{024F}]+[\u{0400}-\u{04FF}]+\\z")
    static let isoDate = pattern(#"^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\z"#)
    static let isoMonth = pattern(#"^[0-9]{4}-(0[1-9]|1[0-2])\z"#)
    static let sourceId = pattern(#"^[A-Z0-9][A-Z0-9-]{0,31}\z"#)
    static let linkId = pattern(#"^[a-z][a-z0-9-]{0,31}\z"#)
    static let httpsURL = pattern("^https://[^\(jsSpaceClass)]+\\z")

    static let disclaimerTiming = (ru: pattern("^Сроки ориентировочные"), ky: pattern("^Мөөнөттөр болжолдуу"))
    static let disclaimerDocuments = (ru: pattern("^Окончательный список документов зависит от "),
                                      ky: pattern("^Документтердин акыркы тизмеси "))
    /// `.` JavaScript не берёт только \n, \r, U+2028 и U+2029; у ICU список шире.
    static let disclaimerDecisions = (ru: pattern(#"^Решение о зачислении[^\n\r\x{2028}\x{2029}]*; EVO их не гарантирует\.\z"#),
                                      ky: pattern(#"; EVO буларга кепилдик бербейт\.\z"#))
    static let decisionsNegation = pattern(#"EVO их не гарантирует\.\z|EVO буларга кепилдик бербейт\.\z"#)

    static func pattern(_ source: String, caseInsensitive: Bool = false) -> NSRegularExpression {
        // Литералы выше проверены тестами; неверный шаблон это ошибка сборки
        // контента, а не данных студента.
        try! NSRegularExpression(pattern: source, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    static func hasAbsoluteDate(_ text: String) -> Bool { matches(absoluteDate, text) }

    /// Календарная дата `YYYY-MM-DD` (2026-02-30 не дата).
    static func isCalendarDate(_ value: String) -> Bool {
        guard matches(isoDate, value) else { return false }
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        return DateComponents(calendar: calendar, year: parts[0], month: parts[1], day: parts[2]).isValidDate
    }
}

// MARK: - Строгий разбор

/// Ключи файлов: шесть стран в порядке продукта (study-countries.json, как
/// `COUNTRY_TIMELINE_FILE_KEYS` веба) и общий маршрут.
enum CountryTimelineKeys {
    static let countries = StudyCountries.codes.map { $0.lowercased() }
    static let all = countries + ["undecided"]
}

/// Проверка сырого JSON до `JSONDecoder`: BOM в начале и повтор ключа в любом
/// объекте. `JSON.parse` веба не принимает BOM, а при повторе ключа берёт
/// последнее значение; `JSONDecoder` принимает BOM и берёт первое. Такой файл
/// iPhone не показывает (review #1208 M1), веб его не пропускает тестом
/// канонического вида (tests/portal-country-timeline-ios-parity.test.mjs).
enum TimelineRawJSON {
    /// Причина отказа или nil, если повторов нет. Синтаксис целиком
    /// проверяет `JSONDecoder` следом.
    static func problem(in data: Data) -> String? {
        let bytes = [UInt8](data)
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { return "byte order mark" }
        // Для объекта набор его ключей и «следующая строка это ключ»; для массива keys == nil.
        var stack: [(keys: Set<String>?, expectingKey: Bool)] = []
        var index = 0
        while index < bytes.count {
            switch bytes[index] {
            case UInt8(ascii: "{"):
                stack.append((keys: [], expectingKey: true))
            case UInt8(ascii: "["):
                stack.append((keys: nil, expectingKey: false))
            case UInt8(ascii: "}"), UInt8(ascii: "]"):
                if stack.popLast() == nil { return "not JSON" }
            case UInt8(ascii: ","):
                if let top = stack.indices.last, stack[top].keys != nil { stack[top].expectingKey = true }
            case UInt8(ascii: "\""):
                let start = index + 1
                var end = start
                var escaped = false
                while end < bytes.count, bytes[end] != UInt8(ascii: "\"") {
                    if bytes[end] == UInt8(ascii: "\\") { escaped = true; end += 1 }
                    end += 1
                }
                if end >= bytes.count { return "not JSON" }
                if let top = stack.indices.last, stack[top].keys != nil, stack[top].expectingKey {
                    let raw = Array(bytes[start..<end])
                    // Ключ с escape-последовательностью сравнивается раскрытым, как у JSON.parse.
                    let key = escaped
                        ? (try? JSONSerialization.jsonObject(with: Data([UInt8(ascii: "\"")] + raw + [UInt8(ascii: "\"")]),
                                                             options: .fragmentsAllowed)) as? String
                        : String(decoding: raw, as: UTF8.self)
                    guard let key else { return "not JSON" }
                    if stack[top].keys?.insert(key).inserted == false { return "repeated key \(key)" }
                    stack[top].expectingKey = false
                }
                index = end
            default:
                break
            }
            index += 1
        }
        return stack.isEmpty ? nil : "not JSON"
    }
}

private struct TimelineJSONKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(_ value: String) { stringValue = value }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

/// Значение JSON без потерь: различает отсутствие ключа, `null`, число и
/// булево (веб различает их так же). Только для разбора контента.
indirect enum TimelineJSON: Decodable, Hashable {
    case null
    case bool(Bool)
    case int(Int)
    case number(Double)
    case string(String)
    case array([TimelineJSON])
    case object([String: TimelineJSON])

    init(from decoder: Decoder) throws {
        if let object = try? decoder.container(keyedBy: TimelineJSONKey.self) {
            var values: [String: TimelineJSON] = [:]
            for key in object.allKeys { values[key.stringValue] = try object.decode(TimelineJSON.self, forKey: key) }
            self = .object(values)
            return
        }
        if var array = try? decoder.unkeyedContainer() {
            var values: [TimelineJSON] = []
            while !array.isAtEnd { values.append(try array.decode(TimelineJSON.self)) }
            self = .array(values)
            return
        }
        let single = try decoder.singleValueContainer()
        if single.decodeNil() { self = .null; return }
        if let value = try? single.decode(Bool.self) { self = .bool(value); return }
        if let value = try? single.decode(Int.self) { self = .int(value); return }
        if let value = try? single.decode(Double.self) { self = .number(value); return }
        self = .string(try single.decode(String.self))
    }
}

/// Порт `parseCountryTimelineFile` веба: любое отклонение бросает
/// `TimelineContentError` с путём поля.
struct CountryTimelineParser {
    let key: String
    /// Названия стран из `study-countries.json` (тот же bundle).
    let countryName: (_ code: String, _ kyrgyz: Bool) -> String?

    func parse(_ data: Data) throws -> CountryTimelineFile {
        if let problem = TimelineRawJSON.problem(in: data) { try fail("$", problem) }
        let json: TimelineJSON
        do { json = try JSONDecoder().decode(TimelineJSON.self, from: data) } catch { try fail("$", "not JSON") }
        return try parse(json)
    }

    func parse(_ value: TimelineJSON) throws -> CountryTimelineFile {
        if !CountryTimelineKeys.all.contains(key) { try fail("$", "unknown file key") }
        let general = key == "undecided"
        let root = try record(value, "$", ["schemaVersion", "contentVersion", "country", "name", "status", "updatedOn",
                                           "validUntil", "kyStatus", "intake", "disclaimers", "steps", "sources"])
        guard root["schemaVersion"] == .int(1) else { try fail("$.schemaVersion", "not 1") }
        guard case .int(let contentVersion) = root["contentVersion"], contentVersion >= 1 else {
            try fail("$.contentVersion", "not a positive integer")
        }
        let country = general ? CountryTimelineRules.undecided : key.uppercased()
        guard root["country"] == .string(country) else { try fail("$.country", "not \(country)") }
        let name = try l10n(root["name"], "$.name")
        if !general, name.ru != countryName(country, false) || name.ky != countryName(country, true) {
            try fail("$.name", "differs from src/lib/study-countries.json")
        }
        let status = try oneOf(root["status"], "$.status", TimelineStatus.self)
        if general && status != .approved { try fail("$.status", "the general route must be approved") }
        let updatedOn = try isoDate(root["updatedOn"], "$.updatedOn")
        let validUntil = try isoDate(root["validUntil"], "$.validUntil")
        if validUntil <= updatedOn { try fail("$.validUntil", "not after updatedOn") }
        let kyStatus = try string(root["kyStatus"], "$.kyStatus")
        if !["needs_native_proofreading", "proofread"].contains(kyStatus) {
            try fail("$.kyStatus", "not one of needs_native_proofreading, proofread")
        }

        let intakeRow = try record(root["intake"], "$.intake", ["model", "reference", "label"], ["note"])
        let model = try oneOf(intakeRow["model"], "$.intake.model", TimelineIntakeModel.self)
        if (model == .none) != general { try fail("$.intake.model", "only the general route has no dates") }
        var reference: String?
        if model == .annual {
            guard case .string(let month) = intakeRow["reference"], CountryTimelineRules.matches(CountryTimelineRules.isoMonth, month) else {
                try fail("$.intake.reference", "not YYYY-MM")
            }
            reference = month
        } else if intakeRow["reference"] != .null {
            try fail("$.intake.reference", "must be null")
        }
        let intake = CountryTimelineFile.Intake(
            model: model,
            reference: reference,
            label: try text(intakeRow["label"], "$.intake.label", hideable: false),
            note: try intakeRow["note"].map { try text($0, "$.intake.note", hideable: true) }
        )

        let disclaimerRow = try record(root["disclaimers"], "$.disclaimers", ["timing", "documents", "decisions"])
        let disclaimers = CountryTimelineFile.Disclaimers(
            timing: try l10n(disclaimerRow["timing"], "$.disclaimers.timing"),
            documents: try l10n(disclaimerRow["documents"], "$.disclaimers.documents"),
            decisions: try l10n(disclaimerRow["decisions"], "$.disclaimers.decisions", promisesChecked: true)
        )
        let markers: [(String, TimelineL10n, (ru: NSRegularExpression, ky: NSRegularExpression))] = [
            ("timing", disclaimers.timing, CountryTimelineRules.disclaimerTiming),
            ("documents", disclaimers.documents, CountryTimelineRules.disclaimerDocuments),
            ("decisions", disclaimers.decisions, CountryTimelineRules.disclaimerDecisions),
        ]
        for (part, value, marker) in markers {
            if !CountryTimelineRules.matches(marker.ru, value.ru) { try fail("$.disclaimers.\(part).ru", "not the required disclaimer") }
            if !CountryTimelineRules.matches(marker.ky, value.ky) { try fail("$.disclaimers.\(part).ky", "not the required disclaimer") }
        }
        // Оговорка о решениях содержит только отрицание; других обещаний в ней нет.
        for (lang, value) in [("ru", disclaimers.decisions.ru), ("ky", disclaimers.decisions.ky)] {
            let negation = CountryTimelineRules.decisionsNegation
            let rest = negation.stringByReplacingMatches(in: value, range: NSRange(value.startIndex..., in: value), withTemplate: "")
            if CountryTimelineRules.forbiddenPromises.contains(where: { CountryTimelineRules.matches($0, rest) }) {
                try fail("$.disclaimers.decisions.\(lang)", "promise outside the negation")
            }
        }

        guard case .array(let rawSources) = root["sources"], !rawSources.isEmpty else { try fail("$.sources", "not a non-empty array") }
        let sources = try rawSources.enumerated().map { index, raw -> TimelineSource in
            let path = "$.sources[\(index)]"
            let row = try record(raw, path, ["id", "kind", "title", "checkedOn"], ["url"])
            guard case .string(let id) = row["id"], CountryTimelineRules.matches(CountryTimelineRules.sourceId, id) else {
                try fail("\(path).id", "not a source id")
            }
            let kind = try oneOf(row["kind"], "\(path).kind", TimelineSourceKind.self)
            let internalSource = kind == .ownerGuide || kind == .evoInternal
            var url: String?
            if internalSource {
                if row["url"] != nil { try fail("\(path).url", "an internal source has no address in the file") }
            } else {
                guard case .string(let address) = row["url"], CountryTimelineRules.matches(CountryTimelineRules.httpsURL, address) else {
                    try fail("\(path).url", "an external source needs an https url")
                }
                url = address
            }
            return TimelineSource(id: id, kind: kind, title: try plain(row["title"], "\(path).title"), url: url,
                                  checkedOn: try isoDate(row["checkedOn"], "\(path).checkedOn"))
        }
        let knownSources = Set(sources.map(\.id))
        if knownSources.count != sources.count { try fail("$.sources", "duplicate source id") }
        var usedSources = Set<String>()

        guard case .array(let rawSteps) = root["steps"], (5...8).contains(rawSteps.count) else { try fail("$.steps", "needs 5 to 8 steps") }
        var itemIds = Set<String>()
        var steps: [TimelineStep] = []
        for (index, raw) in rawSteps.enumerated() {
            let path = "$.steps[\(index)]"
            let row = try record(raw, path, ["id", "order", "stageKeys", "title", "summary", "timing", "checklist", "doneWhen", "sources"],
                                 ["note", "links"])
            let order = index + 1
            guard row["order"] == .int(order) else { try fail("\(path).order", "not \(order)") }
            guard case .string(let stepId) = row["id"],
                  CountryTimelineRules.matches(CountryTimelineRules.pattern("^\(key)-\(order)-[a-z0-9]+(?:-[a-z0-9]+)*\\z"), stepId) else {
                try fail("\(path).id", "not <file>-<order>-<slug>")
            }
            guard case .array(let rawStages) = row["stageKeys"], !rawStages.isEmpty, Set(rawStages).count == rawStages.count else {
                try fail("\(path).stageKeys", "needs distinct stage keys")
            }
            let stageKeys = try rawStages.enumerated().map { n, stage -> String in
                guard case .string(let value) = stage, CountryTimelineRules.stageKeys.contains(value) else {
                    try fail("\(path).stageKeys[\(n)]", "not one of \(CountryTimelineRules.stageKeys.joined(separator: ", "))")
                }
                return value
            }
            var timing: TimelineTiming?
            if general {
                if row["timing"] != .null { try fail("\(path).timing", "the general route has no timing") }
            } else {
                let t = try record(row["timing"], "\(path).timing", ["from", "to", "label", "basis"])
                let from = try offset(t["from"], "\(path).timing.from")
                let to = try offset(t["to"], "\(path).timing.to")
                if from.unit != to.unit || from.value > to.value { try fail("\(path).timing", "from and to differ in unit or are reversed") }
                let basis = try oneOf(t["basis"], "\(path).timing.basis", TimelineTimingBasis.self)
                if status == .approved && basis == .estimate { try fail("\(path).timing.basis", "an approved timeline has no estimated timing") }
                timing = TimelineTiming(from: from, to: to, label: try text(t["label"], "\(path).timing.label", hideable: false), basis: basis)
            }
            guard case .array(let rawItems) = row["checklist"], !rawItems.isEmpty else { try fail("\(path).checklist", "needs at least one item") }
            let itemPattern = CountryTimelineRules.pattern("^\(key)-\(order)-[0-9]{2}\\z")
            var checklist: [TimelineItem] = []
            for (n, rawItem) in rawItems.enumerated() {
                let itemPath = "\(path).checklist[\(n)]"
                let item = try record(rawItem, itemPath, ["id", "who", "status", "text", "sources"], ["note", "appliesTo"])
                guard case .string(let itemId) = item["id"], CountryTimelineRules.matches(itemPattern, itemId), !itemIds.contains(itemId) else {
                    try fail("\(itemPath).id", "not a unique <file>-<order>-<NN>")
                }
                itemIds.insert(itemId)
                checklist.append(TimelineItem(
                    id: itemId,
                    who: try oneOf(item["who"], "\(itemPath).who", TimelineWho.self),
                    status: try oneOf(item["status"], "\(itemPath).status", TimelineItemStatus.self),
                    text: try text(item["text"], "\(itemPath).text", hideable: true),
                    note: try item["note"].map { try text($0, "\(itemPath).note", hideable: true) },
                    appliesTo: try item["appliesTo"].map { try text($0, "\(itemPath).appliesTo", hideable: false) },
                    sources: try sourceRefs(item["sources"], "\(itemPath).sources", known: knownSources, used: &usedSources)
                ))
            }
            // Шаг никогда не остаётся пустым: ни из-за `verify`, ни после validUntil.
            if !checklist.contains(where: { $0.status == .confirmed && $0.text.undated != .hidden }) {
                try fail("\(path).checklist", "needs a confirmed item that stays after validUntil")
            }
            var links: [TimelineLink]?
            if let rawLinks = row["links"] {
                guard case .array(let rawList) = rawLinks, !rawList.isEmpty else { try fail("\(path).links", "not a non-empty array") }
                links = try rawList.enumerated().map { n, rawLink -> TimelineLink in
                    let linkPath = "\(path).links[\(n)]"
                    let link = try record(rawLink, linkPath, ["id", "label", "url"], ["appModule"])
                    guard case .string(let linkId) = link["id"], CountryTimelineRules.matches(CountryTimelineRules.linkId, linkId) else {
                        try fail("\(linkPath).id", "not a link id")
                    }
                    guard case .string(let url) = link["url"], CountryTimelineRules.matches(CountryTimelineRules.httpsURL, url) else {
                        try fail("\(linkPath).url", "not an https url")
                    }
                    var appModule: String?
                    if let rawModule = link["appModule"] {
                        guard case .string(let module) = rawModule, CountryTimelineRules.appModules.contains(module) else {
                            try fail("\(linkPath).appModule", "not one of \(CountryTimelineRules.appModules.joined(separator: ", "))")
                        }
                        appModule = module
                    }
                    return TimelineLink(id: linkId, label: try l10n(link["label"], "\(linkPath).label"), url: url, appModule: appModule)
                }
                if let links, Set(links.map(\.id)).count != links.count { try fail("\(path).links", "duplicate link id") }
            }
            steps.append(TimelineStep(
                id: stepId, order: order, stageKeys: stageKeys,
                title: try text(row["title"], "\(path).title", hideable: false),
                summary: try text(row["summary"], "\(path).summary", hideable: false),
                timing: timing, checklist: checklist,
                note: try row["note"].map { try text($0, "\(path).note", hideable: true) },
                doneWhen: try text(row["doneWhen"], "\(path).doneWhen", hideable: false),
                links: links,
                sources: try sourceRefs(row["sources"], "\(path).sources", known: knownSources, used: &usedSources)
            ))
        }
        if Set(steps.map(\.id)).count != steps.count { try fail("$.steps", "duplicate step id") }
        for source in sources where !usedSources.contains(source.id) { try fail("$.sources", "unused source \(source.id)") }

        return CountryTimelineFile(schemaVersion: 1, contentVersion: contentVersion, country: country, name: name, status: status,
                                   updatedOn: updatedOn, validUntil: validUntil, kyStatus: kyStatus, intake: intake,
                                   disclaimers: disclaimers, steps: steps, sources: sources)
    }

    // MARK: Помощники разбора (повторяют веб)

    private func fail(_ path: String, _ reason: String) throws -> Never {
        throw TimelineContentError(file: key, path: path, reason: reason)
    }

    private func record(_ value: TimelineJSON?, _ path: String, _ required: [String], _ optional: [String] = []) throws -> [String: TimelineJSON] {
        guard case .object(let row) = value else { try fail(path, "not an object") }
        for key in required where row[key] == nil { try fail(path, "missing \(key)") }
        for key in row.keys.sorted() where !required.contains(key) && !optional.contains(key) { try fail(path, "unknown key \(key)") }
        return row
    }

    private func string(_ value: TimelineJSON?, _ path: String) throws -> String {
        guard case .string(let text) = value else { try fail(path, "not a string") }
        return text
    }

    private func oneOf<T: RawRepresentable>(_ value: TimelineJSON?, _ path: String, _ type: T.Type) throws -> T where T.RawValue == String {
        guard case .string(let raw) = value, let parsed = T(rawValue: raw) else { try fail(path, "not an allowed value") }
        return parsed
    }

    private func isoDate(_ value: TimelineJSON?, _ path: String) throws -> String {
        guard case .string(let raw) = value, CountryTimelineRules.isCalendarDate(raw) else { try fail(path, "not a YYYY-MM-DD date") }
        return raw
    }

    private func offset(_ value: TimelineJSON?, _ path: String) throws -> TimelineOffset {
        let row = try record(value, path, ["value", "unit"])
        guard case .int(let number) = row["value"], abs(number) <= 104 else { try fail("\(path).value", "not an integer offset") }
        return TimelineOffset(value: number, unit: try oneOf(row["unit"], "\(path).unit", TimelineOffsetUnit.self))
    }

    private func plain(_ value: TimelineJSON?, _ path: String) throws -> String {
        guard case .string(let text) = value, !text.isEmpty,
              text == text.trimmingCharacters(in: CountryTimelineRules.jsWhitespace),
              !CountryTimelineRules.matches(CountryTimelineRules.doubleSpace, text) else {
            try fail(path, "empty or untrimmed text")
        }
        if CountryTimelineRules.matches(CountryTimelineRules.dashes, text) { try fail(path, "em or en dash") }
        if CountryTimelineRules.matches(CountryTimelineRules.internalPaths, text) { try fail(path, "internal path") }
        return text
    }

    /// Строка, которую видит студент: все правила текста.
    private func studentString(_ value: TimelineJSON?, _ path: String, promisesChecked: Bool = false) throws -> String {
        let text = try plain(value, path)
        let range = NSRange(text.startIndex..., in: text)
        for match in CountryTimelineRules.letters.matches(in: text, range: range) {
            guard let wordRange = Range(match.range, in: text) else { continue }
            let word = String(text[wordRange])
            if CountryTimelineRules.matches(CountryTimelineRules.latin, word), CountryTimelineRules.matches(CountryTimelineRules.cyrillic, word),
               !CountryTimelineRules.matches(CountryTimelineRules.latinWithSuffix, word) {
                try fail(path, "mixed script word \(word)")
            }
        }
        if !promisesChecked, CountryTimelineRules.forbiddenPromises.contains(where: { CountryTimelineRules.matches($0, text) }) {
            try fail(path, "forbidden promise")
        }
        if CountryTimelineRules.internalMarkers.contains(where: { CountryTimelineRules.matches($0, text) }) {
            try fail(path, "internal detail")
        }
        return text
    }

    /// L10n без дат: название, оговорки, подписи ссылок.
    private func l10n(_ value: TimelineJSON?, _ path: String, promisesChecked: Bool = false) throws -> TimelineL10n {
        let row = try record(value, path, ["ru", "ky"])
        let ru = try studentString(row["ru"], "\(path).ru", promisesChecked: promisesChecked)
        let ky = try studentString(row["ky"], "\(path).ky", promisesChecked: promisesChecked)
        if CountryTimelineRules.hasAbsoluteDate(ru) || CountryTimelineRules.hasAbsoluteDate(ky) {
            try fail(path, "absolute date in an undated field")
        }
        return TimelineL10n(ru: ru, ky: ky)
    }

    /// Текст с возможной датой: есть год → обязателен `undated` (замена без
    /// даты или `null` там, где поле можно скрыть); нет года → `undated` запрещён.
    private func text(_ value: TimelineJSON?, _ path: String, hideable: Bool) throws -> TimelineText {
        let row = try record(value, path, ["ru", "ky"], ["undated"])
        let ru = try studentString(row["ru"], "\(path).ru")
        let ky = try studentString(row["ky"], "\(path).ky")
        let dated = CountryTimelineRules.hasAbsoluteDate(ru) || CountryTimelineRules.hasAbsoluteDate(ky)
        guard dated else {
            if row["undated"] != nil { try fail(path, "undated variant for a text without a date") }
            return TimelineText(ru: ru, ky: ky, undated: .absent)
        }
        guard let undated = row["undated"] else { try fail(path, "a text with a date needs an undated variant") }
        if undated == .null {
            if !hideable { try fail(path, "this field cannot be hidden after validUntil") }
            return TimelineText(ru: ru, ky: ky, undated: .hidden)
        }
        return TimelineText(ru: ru, ky: ky, undated: .text(try l10n(undated, "\(path).undated")))
    }

    private func sourceRefs(_ value: TimelineJSON?, _ path: String, known: Set<String>, used: inout Set<String>) throws -> [String] {
        guard case .array(let refs) = value, !refs.isEmpty else { try fail(path, "needs at least one source") }
        var ids: [String] = []
        for ref in refs {
            guard case .string(let id) = ref, known.contains(id) else { try fail(path, "unknown source \(ref)") }
            ids.append(id)
            used.insert(id)
        }
        if Set(ids).count != ids.count { try fail(path, "duplicate source") }
        return ids
    }
}

// MARK: - Что видит студент

/// Форма `CountryTimelineView` веба (контракт §3), уже на языке студента.
struct CountryTimelineView: Equatable, Sendable {
    enum Kind: String, Sendable { case country, general }

    struct Item: Identifiable, Equatable, Sendable {
        let id: String
        let who: TimelineWho
        let whoLabel: String
        let text: String
        let note: String?
        let appliesTo: String?
    }

    struct Link: Identifiable, Equatable, Sendable {
        let id: String
        let label: String
        let href: String
        let external: Bool
    }

    struct Step: Identifiable, Equatable, Sendable {
        let id: String
        let order: Int
        let stageKeys: [String]
        let title: String
        let summary: String
        let timing: String?
        let note: String?
        let doneWhen: String
        let items: [Item]
        let links: [Link]
    }

    let choice: String
    let kind: Kind
    let countryCode: String?
    let countryName: String?
    let file: String
    let contentVersion: Int
    let datesHidden: Bool
    let intakeLabel: String
    let intakeNote: String?
    let steps: [Step]
    /// Три оговорки по порядку: сроки, документы, решения.
    let disclaimers: [String]
    let kyNeedsProofreading: Bool
}

/// Класс-метка: bundle, в который собран этот файл (приложение или
/// hostless unit-тесты), и в котором лежат файлы контента.
private final class CountryTimelineBundleToken {}

struct CountryTimelineLibrary: Sendable {
    /// Разобранные файлы по ключу (`cn` … `cz`, `undecided`). Файла, который
    /// не прошёл разбор, здесь нет.
    let files: [String: CountryTimelineFile]
    /// Ошибки разбора по ключу файла (для тестов и журнала разработчика).
    let failures: [String: String]

    /// Подписи «кто делает» (контракт §3, п. 7; одинаковые на вебе и iPhone).
    static let whoLabels: [TimelineWho: TimelineL10n] = [
        .student: TimelineL10n(ru: "Студент", ky: "Студент"),
        .evo: TimelineL10n(ru: "EVO", ky: "EVO"),
        .university: TimelineL10n(ru: "Вуз", ky: "Университет"),
        .embassy: TimelineL10n(ru: "Посольство", ky: "Элчилик"),
    ]

    /// Файлы bundle приложения; читается один раз, вне главного потока.
    static let bundled = load(from: Bundle(for: CountryTimelineBundleToken.self))

    static func load(from bundle: Bundle) -> CountryTimelineLibrary {
        load { key in bundle.url(forResource: key, withExtension: "json").flatMap { try? Data(contentsOf: $0) } }
    }

    /// Тот же разбор для любого источника сырых файлов по ключу (тесты
    /// подменяют один файл и проверяют запасной путь).
    static func load(data source: (String) -> Data?) -> CountryTimelineLibrary {
        var files: [String: CountryTimelineFile] = [:]
        var failures: [String: String] = [:]
        let names: (String, Bool) -> String? = { code, kyrgyz in StudyCountries.name(for: code, kyrgyz: kyrgyz) }
        for key in CountryTimelineKeys.all {
            guard let data = source(key) else {
                failures[key] = "missing from the bundle"
                continue
            }
            do {
                files[key] = try CountryTimelineParser(key: key, countryName: names).parse(data)
            } catch {
                failures[key] = String(describing: error)
            }
        }
        return CountryTimelineLibrary(files: files, failures: failures)
    }

    /// Шесть кодов стран (study-countries.json) и `UNDECIDED`.
    static func isChoice(_ value: String?) -> Bool {
        guard let value else { return false }
        return value == CountryTimelineRules.undecided || CountryTimelineKeys.countries.map { $0.uppercased() }.contains(value)
    }

    /// Сегодняшняя дата студента (Бишкек) в виде YYYY-MM-DD, как
    /// `todayForTimeline()` веба.
    static func today(now: Date = Date(), timeZone: TimeZone? = TimeZone(identifier: "Asia/Bishkek")) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: now)
    }

    private struct HiddenRequiredText: Error {}

    /// Порт `selectCountryTimeline`: `approved` файл страны, иначе общий
    /// маршрут с названием страны; пункты `verify` скрыты; после validUntil
    /// тексты с годом заменены `undated` (`hidden` скрывает поле или пункт).
    /// Неизвестный выбор → nil (карточка «Выберите страну»). nil и для
    /// верного выбора, если общий маршрут не разобрался: это показывает
    /// честную ошибку, а не пустой путь.
    func select(choice: String?, kyrgyz: Bool, today: String, modules: [String: String] = [:]) -> CountryTimelineView? {
        guard let choice, Self.isChoice(choice), CountryTimelineRules.matches(CountryTimelineRules.isoDate, today) else { return nil }
        let countryCode = choice == CountryTimelineRules.undecided ? nil : choice
        let countryFile = countryCode.flatMap { files[$0.lowercased()] }
        let isCountry = countryFile?.status == .approved
        guard let timeline = isCountry ? countryFile : files["undecided"] else { return nil }
        let datesHidden = today > timeline.validUntil

        func show(_ value: TimelineText) -> String? {
            guard datesHidden else { return kyrgyz ? value.ky : value.ru }
            switch value.undated {
            case .absent: return kyrgyz ? value.ky : value.ru
            case .hidden: return nil
            case .text(let undated): return undated.pick(kyrgyz: kyrgyz)
            }
        }
        func required(_ value: TimelineText) throws -> String {
            guard let shown = show(value) else { throw HiddenRequiredText() }
            return shown
        }
        func optional(_ value: TimelineText?) -> String? { value.flatMap(show) }

        do {
            let steps = try timeline.steps.map { step -> CountryTimelineView.Step in
                CountryTimelineView.Step(
                    id: step.id, order: step.order, stageKeys: step.stageKeys,
                    title: try required(step.title),
                    summary: try required(step.summary),
                    timing: try step.timing.map { try required($0.label) },
                    note: optional(step.note),
                    doneWhen: try required(step.doneWhen),
                    items: try step.checklist
                        .filter { $0.status == .confirmed && show($0.text) != nil }
                        .map { item in
                            CountryTimelineView.Item(
                                id: item.id, who: item.who,
                                whoLabel: Self.whoLabels[item.who]?.pick(kyrgyz: kyrgyz) ?? item.who.rawValue,
                                text: try required(item.text),
                                note: optional(item.note),
                                appliesTo: try item.appliesTo.map { try required($0) }
                            )
                        },
                    links: (step.links ?? []).map { link in
                        let internalRoute = link.appModule.flatMap { modules[$0] }
                        return CountryTimelineView.Link(id: link.id, label: link.label.pick(kyrgyz: kyrgyz),
                                                        href: internalRoute ?? link.url, external: internalRoute == nil)
                    }
                )
            }
            return CountryTimelineView(
                choice: choice,
                kind: isCountry ? .country : .general,
                countryCode: countryCode,
                countryName: countryCode.flatMap { StudyCountries.name(for: $0, kyrgyz: kyrgyz) },
                file: isCountry ? (countryCode ?? "").lowercased() : "undecided",
                contentVersion: timeline.contentVersion,
                datesHidden: datesHidden,
                intakeLabel: try required(timeline.intake.label),
                intakeNote: optional(timeline.intake.note),
                steps: steps,
                disclaimers: [timeline.disclaimers.timing, timeline.disclaimers.documents, timeline.disclaimers.decisions]
                    .map { $0.pick(kyrgyz: kyrgyz) },
                kyNeedsProofreading: timeline.kyStatus != "proofread"
            )
        } catch {
            return nil
        }
    }
}
