import CoreGraphics
import Foundation

// Обзор экзамена над разделом «CSCA» (решение владельца 17.10.2026, контракт
// docs/portal/csca-contract.md §19). Те же файлы, что читает веб
// (src/lib/portal/csca-overview.ts): src/content/csca/overview.json и
// манифест фото src/content/csca/photos.json, ресурсами bundle через
// project.yml, копий в Swift нет. Фото те же файлы WebP из
// src/content/csca/photos, их хеши сверяет тест.
//
// Разбор строгий и повторяет веб правило в правило и в том же порядке
// проверок, поэтому и текст ошибки тот же («csca overview.json: $.intro[0].ru:
// em or en dash»). Регулярные выражения следуют семантике JavaScript (как у
// «Пути поступления», `CountryTimelineRules`): `\s` и `trim()` с U+FEFF и
// U+000B, `$` только в конце строки. Файл с BOM или повтором ключа
// отклоняется до `JSONDecoder` (`TimelineRawJSON`). Паритет с вебом проверяет
// `CSCAOverviewTests` по фикстуре
// scripts/portal/write-csca-overview-ios-parity.mjs: те же решения на
// вариантах файлов и те же отпечатки разобранного обзора.

// MARK: - Модель

enum CSCAEvoStatus: String, CaseIterable, Sendable {
    case available, later, none
}

struct CSCAOverviewSubject: Equatable, Sendable {
    let key: String
    let nameEn: String
    let name: CSCABilingual?
    let language: CSCABilingual
    let minutes: Int
    let questions: Int
    let scoreMin: Int
    let scoreMax: Int
    let evo: CSCAEvoStatus
}

struct CSCAOverviewGroup: Equatable, Sendable {
    let key: String
    let nameEn: String
    let name: CSCABilingual
    let subjects: [CSCAOverviewSubject]
}

struct CSCAOverviewFeeRow: Equatable, Sendable {
    let key: String
    let label: CSCABilingual
    let minSubjects: Int
    let maxSubjects: Int?
    let fee: Int
}

struct CSCAOverviewFaqItem: Equatable, Sendable {
    /// Ответ ведёт к блоку сессий; без блока вместо ответа `withoutSessions`.
    struct Link: Equatable, Sendable {
        let label: CSCABilingual
        let withoutSessions: CSCABilingual
    }

    let id: String
    let question: CSCABilingual
    let answer: [CSCABilingual]
    let link: Link?
}

struct CSCAOverviewVerdict: Equatable, Sendable {
    let label: CSCABilingual
    let text: CSCABilingual
}

struct CSCAOverviewSource: Equatable, Sendable {
    let id: String
    let title: String
    let checkedOn: String
    let omitted: String?
}

struct CSCAOverview: Equatable, Sendable {
    struct Exam: Equatable, Sendable {
        let short: String
        let nameEn: String
        let subjectsTotal: Int
        let universitiesTotal: Int
    }

    struct Audience: Equatable, Sendable {
        let title: CSCABilingual
        let needed: CSCAOverviewVerdict
        let notNeeded: CSCAOverviewVerdict
    }

    /// Подписи столбцов таблицы предметов.
    struct Columns: Equatable, Sendable {
        let subject: CSCABilingual
        let language: CSCABilingual
        let duration: CSCABilingual
        let questions: CSCABilingual
        let scoreRange: CSCABilingual
        let evo: CSCABilingual
    }

    struct Subjects: Equatable, Sendable {
        let title: CSCABilingual
        let columns: Columns
        /// Шаблоны `{n} мин` и `от {min} до {max}`.
        let minutesFormat: CSCABilingual
        let scoreRangeFormat: CSCABilingual
        let evoStatus: [CSCAEvoStatus: CSCABilingual]
        let groups: [CSCAOverviewGroup]
    }

    struct Fees: Equatable, Sendable {
        let title: CSCABilingual
        let currency: String
        let subjectsColumn: CSCABilingual
        let feeColumn: CSCABilingual
        let rows: [CSCAOverviewFeeRow]
    }

    struct Faq: Equatable, Sendable {
        let title: CSCABilingual
        let items: [CSCAOverviewFaqItem]
    }

    let schemaVersion: Int
    let contentVersion: Int
    let confirmedOn: String
    let kyStatus: String
    let exam: Exam
    let summary: CSCABilingual
    let intro: [CSCABilingual]
    let audience: Audience
    let subjects: Subjects
    let fees: Fees
    let faq: Faq
    let heroPhoto: String
    let audiencePhoto: String
    let sources: [CSCAOverviewSource]
}

struct CSCAOverviewPhotoFile: Equatable, Sendable {
    enum Format: String, Sendable { case webp, jpeg }

    /// Путь манифеста `photos/<ключ>-<ширина>.<webp|jpg>`.
    let path: String
    let format: Format
    let width: Int
    let height: Int
    let bytes: Int
    let sha256: String

    /// Имя ресурса bundle: файлы лежат в корне bundle без папки `photos/`.
    var resourceName: String { String(path.dropFirst("photos/".count)) }
}

struct CSCAOverviewPhoto: Equatable, Sendable {
    let key: String
    let alt: CSCABilingual
    let author: String
    let authorUrl: String
    let sourceName: String
    let sourceUrl: String
    let sourceTitle: String
    let licence: String
    let licenceUrl: String
    let attributionRequired: Bool
    let uploadedOn: String
    let fetchedOn: String
    /// Точка кадра `x% y%`, как `object-position` веба.
    let objectPosition: String
    let files: [CSCAOverviewPhotoFile]
}

/// Ошибка разбора с путём поля, тем же текстом, что у веба
/// (`csca overview.json: $.intro[0].ru: em or en dash`).
struct CSCAOverviewError: Error, Equatable, CustomStringConvertible {
    let file: String
    let path: String
    let reason: String

    var description: String { "csca \(file): \(path): \(reason)" }
}

// MARK: - Правила текста (те же, что у веба)

enum CSCAOverviewRules {
    private static let space = "[\(CountryTimelineRules.jsSpaceClass)]"

    static let statuses = CSCAEvoStatus.allCases.map(\.rawValue)
    /// `CSCA_OVERVIEW_FORBIDDEN` веба с исходником JavaScript для текста
    /// ошибки («forbidden wording /гарант/iu»).
    static let forbidden: [(source: String, regex: NSRegularExpression)] = [
        ("/гарант/iu", pattern("гарант", caseInsensitive: true)),
        ("/кепилд/iu", pattern("кепилд", caseInsensitive: true)),
        (#"/100\s*%/u"#, pattern("100\(space)*%")),
        (#"/точно\s+(?:сда|пост|получ)/iu"#, pattern("точно\(space)+(?:сда|пост|получ)", caseInsensitive: true)),
        ("/сөзсүз/iu", pattern("сөзсүз", caseInsensitive: true)),
        ("/партн[её]р/iu", pattern("партн[её]р", caseInsensitive: true)),
        (#"/official\s+partner/iu"#, pattern("official\(space)+partner", caseInsensitive: true)),
        (#"/официальн\p{L}*\s+партн/iu"#, pattern(#"официальн\p{L}*"# + "\(space)+партн", caseInsensitive: true)),
        (#"/проходн\p{L}*\s+балл/iu"#, pattern(#"проходн\p{L}*"# + "\(space)+балл", caseInsensitive: true)),
        ("/перцентил/iu", pattern("перцентил", caseInsensitive: true)),
    ]
    static let key = pattern(#"^[a-z][a-z0-9-]{0,39}\z"#)
    static let sha256 = pattern(#"^[0-9a-f]{64}\z"#)
    /// Файлы фото рядом с манифестом: `photos/<ключ>-<ширина>.<webp|jpg>`.
    static let photoPath = pattern(#"^photos/([a-z][a-z0-9-]*)-([0-9]{3,4})\.(webp|jpg)\z"#)
    static let objectPosition = pattern(#"^[0-9]{1,3}% [0-9]{1,3}%\z"#)
    static let slot = pattern(#"\{([a-z]+)\}"#)

    static func pattern(_ source: String, caseInsensitive: Bool = false) -> NSRegularExpression {
        CountryTimelineRules.pattern(source, caseInsensitive: caseInsensitive)
    }

    static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        CountryTimelineRules.matches(regex, text)
    }

    /// Число отдельно, не часть другого числа: `(?<!\d)306(?!\d)`.
    static func mentions(_ number: Int, in text: String) -> Bool {
        matches(pattern("(?<![0-9])\(number)(?![0-9])"), text)
    }

    /// Имена слотов `{…}` по порядку появления.
    static func slots(in text: String) -> [String] {
        slot.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            Range(match.range(at: 1), in: text).map { String(text[$0]) }
        }
    }
}

// MARK: - Строгий разбор

/// Порт `parseCscaOverviewPhotos` и `parseCscaOverview` веба.
struct CSCAOverviewParser {
    static let overviewFile = "overview.json"
    static let photosFile = "photos.json"

    let file: String

    // MARK: Манифест фото

    static func photos(_ data: Data) throws -> [CSCAOverviewPhoto] {
        let parser = CSCAOverviewParser(file: photosFile)
        return try parser.photos(try parser.json(data))
    }

    static func overview(_ data: Data, photoKeys: Set<String>) throws -> CSCAOverview {
        let parser = CSCAOverviewParser(file: overviewFile)
        return try parser.overview(try parser.json(data), photoKeys: photoKeys)
    }

    func json(_ data: Data) throws -> TimelineJSON {
        if let problem = TimelineRawJSON.problem(in: data) { try fail("$", problem) }
        do { return try JSONDecoder().decode(TimelineJSON.self, from: data) } catch { try fail("$", "not JSON") }
    }

    func photos(_ value: TimelineJSON) throws -> [CSCAOverviewPhoto] {
        let root = try record(value, "$", ["schemaVersion", "rules", "photos"])
        if !isOne(root["schemaVersion"]) { try fail("$.schemaVersion", "not 1") }
        _ = try plain(root["rules"], "$.rules")
        var photos: [CSCAOverviewPhoto] = []
        for (index, entry) in try list(root["photos"], "$.photos", 1, 12).enumerated() {
            let path = "$.photos[\(index)]"
            let row = try record(entry, path, [
                "key", "alt", "author", "authorUrl", "sourceName", "sourceUrl", "sourceTitle", "licence", "licenceUrl",
                "attributionRequired", "uploadedOn", "fetchedOn", "licenceCheck", "visualCheck", "people", "locationEvidence",
                "objectPosition", "original", "files",
            ])
            let photoKey = try key(row["key"], "\(path).key")
            if row["sourceName"] != .string("Pexels") { try fail("\(path).sourceName", "only Pexels photos are cleared for this set") }
            guard case .bool(let attributionRequired) = row["attributionRequired"] else {
                try fail("\(path).attributionRequired", "not a boolean")
            }
            for field in ["licenceCheck", "visualCheck", "people", "locationEvidence", "author", "sourceTitle", "licence"] {
                _ = try plain(row[field], "\(path).\(field)")
            }
            guard case .string(let objectPosition) = row["objectPosition"],
                  CSCAOverviewRules.matches(CSCAOverviewRules.objectPosition, objectPosition) else {
                try fail("\(path).objectPosition", "not an x% y% position")
            }
            let original = try record(row["original"], "\(path).original", ["width", "height", "bytes", "sha256", "downloadUrl"])
            _ = try int(original["width"], "\(path).original.width", 1600, 20000)
            _ = try int(original["height"], "\(path).original.height", 1000, 20000)
            _ = try int(original["bytes"], "\(path).original.bytes", 1, 100_000_000)
            if !isSha256(original["sha256"]) { try fail("\(path).original.sha256", "not a sha256") }
            _ = try https(original["downloadUrl"], "\(path).original.downloadUrl")
            var files: [CSCAOverviewPhotoFile] = []
            for (fileIndex, file) in try list(row["files"], "\(path).files", 2, 8).enumerated() {
                let filePath = "\(path).files[\(fileIndex)]"
                let fileRow = try record(file, filePath, ["path", "format", "width", "height", "bytes", "sha256"])
                guard case .string(let name) = fileRow["path"], let parts = photoPathParts(name), parts.key == photoKey else {
                    try fail("\(filePath).path", "not photos/<key>-<width>.<webp|jpg>")
                }
                let format: CSCAOverviewPhotoFile.Format = parts.extension == "jpg" ? .jpeg : .webp
                if fileRow["format"] != .string(format.rawValue) { try fail("\(filePath).format", "does not match the extension") }
                let width = try int(fileRow["width"], "\(filePath).width", 120, 2400)
                if String(width) != parts.width { try fail("\(filePath).width", "does not match the file name") }
                let height = try int(fileRow["height"], "\(filePath).height", 60, 2400)
                guard isSha256(fileRow["sha256"]), case .string(let sha) = fileRow["sha256"] else {
                    try fail("\(filePath).sha256", "not a sha256")
                }
                files.append(CSCAOverviewPhotoFile(
                    path: name, format: format, width: width, height: height,
                    bytes: try int(fileRow["bytes"], "\(filePath).bytes", 1, 400_000), sha256: sha
                ))
            }
            try unique(files.map(\.path), "\(path).files")
            if !files.contains(where: { $0.format == .jpeg }) { try fail("\(path).files", "needs a JPEG fallback") }
            if !files.contains(where: { $0.format == .webp }) { try fail("\(path).files", "needs a WebP source") }
            let alt = try l10n(row["alt"], "\(path).alt")
            let authorUrl = try https(row["authorUrl"], "\(path).authorUrl")
            let sourceUrl = try https(row["sourceUrl"], "\(path).sourceUrl")
            let licenceUrl = try https(row["licenceUrl"], "\(path).licenceUrl")
            let uploadedOn = try isoDate(row["uploadedOn"], "\(path).uploadedOn")
            let fetchedOn = try isoDate(row["fetchedOn"], "\(path).fetchedOn")
            photos.append(CSCAOverviewPhoto(
                key: photoKey, alt: alt, author: try string(row["author"]), authorUrl: authorUrl, sourceName: "Pexels",
                sourceUrl: sourceUrl, sourceTitle: try string(row["sourceTitle"]), licence: try string(row["licence"]),
                licenceUrl: licenceUrl, attributionRequired: attributionRequired, uploadedOn: uploadedOn, fetchedOn: fetchedOn,
                objectPosition: objectPosition, files: files
            ))
        }
        try unique(photos.map(\.key), "$.photos")
        return photos
    }

    // MARK: Обзор

    func overview(_ value: TimelineJSON, photoKeys: Set<String>) throws -> CSCAOverview {
        let root = try record(value, "$", [
            "schemaVersion", "contentVersion", "confirmedOn", "kyStatus", "exam", "summary", "intro", "audience",
            "subjects", "fees", "faq", "photos", "sources",
        ])
        if !isOne(root["schemaVersion"]) { try fail("$.schemaVersion", "not 1") }
        guard case .string(let kyStatus) = root["kyStatus"], ["needs_native_proofreading", "proofread"].contains(kyStatus) else {
            try fail("$.kyStatus", "unknown")
        }

        let examRow = try record(root["exam"], "$.exam", ["short", "nameEn", "subjectsTotal", "universitiesTotal"])
        if examRow["short"] != .string("CSCA") { try fail("$.exam.short", "not CSCA") }
        let exam = CSCAOverview.Exam(
            short: "CSCA",
            nameEn: try plain(examRow["nameEn"], "$.exam.nameEn"),
            subjectsTotal: try int(examRow["subjectsTotal"], "$.exam.subjectsTotal", 1, 20),
            universitiesTotal: try int(examRow["universitiesTotal"], "$.exam.universitiesTotal", 1, 5000)
        )

        let audienceRow = try record(root["audience"], "$.audience", ["title", "needed", "notNeeded"])
        func verdict(_ entry: TimelineJSON?, _ path: String) throws -> CSCAOverviewVerdict {
            let row = try record(entry, path, ["label", "text"])
            return CSCAOverviewVerdict(label: try l10n(row["label"], "\(path).label"), text: try l10n(row["text"], "\(path).text"))
        }
        let audience = CSCAOverview.Audience(
            title: try l10n(audienceRow["title"], "$.audience.title"),
            needed: try verdict(audienceRow["needed"], "$.audience.needed"),
            notNeeded: try verdict(audienceRow["notNeeded"], "$.audience.notNeeded")
        )

        let subjectsRow = try record(root["subjects"], "$.subjects", ["title", "columns", "formats", "evoStatus", "groups"])
        let columnNames = ["subject", "language", "duration", "questions", "scoreRange", "evo"]
        let columnsRow = try record(subjectsRow["columns"], "$.subjects.columns", columnNames)
        var columnValues: [String: CSCABilingual] = [:]
        for name in columnNames { columnValues[name] = try l10n(columnsRow[name], "$.subjects.columns.\(name)") }
        let columns = CSCAOverview.Columns(
            subject: columnValues["subject"]!, language: columnValues["language"]!, duration: columnValues["duration"]!,
            questions: columnValues["questions"]!, scoreRange: columnValues["scoreRange"]!, evo: columnValues["evo"]!
        )
        let formatsRow = try record(subjectsRow["formats"], "$.subjects.formats", ["minutes", "scoreRange"])
        let statusRow = try record(subjectsRow["evoStatus"], "$.subjects.evoStatus", CSCAOverviewRules.statuses)
        var groups: [CSCAOverviewGroup] = []
        for (index, entry) in try list(subjectsRow["groups"], "$.subjects.groups", 1, 6).enumerated() {
            let path = "$.subjects.groups[\(index)]"
            let row = try record(entry, path, ["key", "nameEn", "name", "subjects"])
            let groupKey = try key(row["key"], "\(path).key")
            let nameEn = try plain(row["nameEn"], "\(path).nameEn")
            let name = try l10n(row["name"], "\(path).name")
            var subjects: [CSCAOverviewSubject] = []
            for (itemIndex, item) in try list(row["subjects"], "\(path).subjects", 1, 10).enumerated() {
                subjects.append(try subject(item, "\(path).subjects[\(itemIndex)]"))
            }
            groups.append(CSCAOverviewGroup(key: groupKey, nameEn: nameEn, name: name, subjects: subjects))
        }
        try unique(groups.map(\.key), "$.subjects.groups")
        let allSubjects = groups.flatMap(\.subjects)
        try unique(allSubjects.map(\.key), "$.subjects.groups[].subjects")
        if allSubjects.count != exam.subjectsTotal { try fail("$.exam.subjectsTotal", "does not match the subjects table") }

        let feesRow = try record(root["fees"], "$.fees", ["title", "currency", "columns", "rows"])
        if feesRow["currency"] != .string("CNY") { try fail("$.fees.currency", "not CNY") }
        let feeColumns = try record(feesRow["columns"], "$.fees.columns", ["subjects", "fee"])
        var feeRows: [CSCAOverviewFeeRow] = []
        for (index, entry) in try list(feesRow["rows"], "$.fees.rows", 1, 6).enumerated() {
            let path = "$.fees.rows[\(index)]"
            let row = try record(entry, path, ["key", "label", "minSubjects", "maxSubjects", "fee"])
            let minSubjects = try int(row["minSubjects"], "\(path).minSubjects", 1, 20)
            let maxSubjects = row["maxSubjects"] == .null ? nil : try int(row["maxSubjects"], "\(path).maxSubjects", minSubjects, 20)
            feeRows.append(CSCAOverviewFeeRow(
                key: try key(row["key"], "\(path).key"),
                label: try l10n(row["label"], "\(path).label"),
                minSubjects: minSubjects,
                maxSubjects: maxSubjects,
                fee: try int(row["fee"], "\(path).fee", 1, 100_000)
            ))
        }
        try unique(feeRows.map(\.key), "$.fees.rows")
        // Строки покрывают 1..∞ предметов подряд, последняя открыта сверху.
        for (index, row) in feeRows.enumerated() {
            let expectedMin: Int? = index == 0 ? 1 : feeRows[index - 1].maxSubjects.map { $0 + 1 }
            if row.minSubjects != expectedMin { try fail("$.fees.rows[\(index)].minSubjects", "rows must cover 1.. subjects without gaps") }
            if (row.maxSubjects == nil) != (index == feeRows.count - 1) { try fail("$.fees.rows[\(index)].maxSubjects", "only the last row is open") }
            if row.minSubjects > exam.subjectsTotal { try fail("$.fees.rows[\(index)]", "more subjects than the exam has") }
            if !CSCAOverviewRules.mentions(row.minSubjects, in: row.label.ru) { try fail("$.fees.rows[\(index)].label", "label does not name its count") }
        }

        let faqRow = try record(root["faq"], "$.faq", ["title", "items"])
        var faqItems: [CSCAOverviewFaqItem] = []
        for (index, entry) in try list(faqRow["items"], "$.faq.items", 1, 12).enumerated() {
            let path = "$.faq.items[\(index)]"
            let row = try record(entry, path, ["id", "question", "answer", "link"])
            let question = try l10n(row["question"], "\(path).question")
            // `endsWith("?")` JavaScript: последняя кодовая точка, не графема.
            if question.ru.unicodeScalars.last != "?" || question.ky.unicodeScalars.last != "?" {
                try fail("\(path).question", "a question ends with ?")
            }
            var link: CSCAOverviewFaqItem.Link?
            if row["link"] != .null {
                let linkRow = try record(row["link"], "\(path).link", ["target", "label", "withoutSessions"])
                if linkRow["target"] != .string("sessions") { try fail("\(path).link.target", "only the sessions block is a target") }
                link = CSCAOverviewFaqItem.Link(
                    label: try l10n(linkRow["label"], "\(path).link.label"),
                    withoutSessions: try l10n(linkRow["withoutSessions"], "\(path).link.withoutSessions")
                )
            }
            let id = try key(row["id"], "\(path).id")
            var answer: [CSCABilingual] = []
            for (partIndex, part) in try list(row["answer"], "\(path).answer", 1, 4).enumerated() {
                answer.append(try l10n(part, "\(path).answer[\(partIndex)]"))
            }
            faqItems.append(CSCAOverviewFaqItem(id: id, question: question, answer: answer, link: link))
        }
        try unique(faqItems.map(\.id), "$.faq.items")

        let photosRow = try record(root["photos"], "$.photos", ["hero", "audience"])
        var photoSlots: [String: String] = [:]
        for slot in ["hero", "audience"] {
            guard case .string(let photoKey) = photosRow[slot], photoKeys.contains(photoKey) else {
                try fail("$.photos.\(slot)", "not a photo of the manifest")
            }
            photoSlots[slot] = photoKey
        }

        var sources: [CSCAOverviewSource] = []
        for (index, entry) in try list(root["sources"], "$.sources", 1, 8).enumerated() {
            let path = "$.sources[\(index)]"
            let row = try record(entry, path, ["id", "kind", "title", "checkedOn"], ["omitted"])
            if row["kind"] != .string("owner") { try fail("\(path).kind", "only owner-confirmed facts are in the overview") }
            sources.append(CSCAOverviewSource(
                id: try plain(row["id"], "\(path).id"),
                title: try plain(row["title"], "\(path).title"),
                checkedOn: try isoDate(row["checkedOn"], "\(path).checkedOn"),
                omitted: try row["omitted"].map { try plain($0, "\(path).omitted") }
            ))
        }

        // Порядок вычисления полей объекта у веба: сначала версия и дата,
        // затем сводка, вводные абзацы, заголовки и шаблоны.
        let contentVersion = try int(root["contentVersion"], "$.contentVersion", 1, 10_000)
        let confirmedOn = try isoDate(root["confirmedOn"], "$.confirmedOn")
        let summary = try l10n(root["summary"], "$.summary")
        var intro: [CSCABilingual] = []
        for (index, entry) in try list(root["intro"], "$.intro", 1, 4).enumerated() {
            intro.append(try l10n(entry, "$.intro[\(index)]"))
        }
        let subjectsTitle = try l10n(subjectsRow["title"], "$.subjects.title")
        let minutesFormat = try template(formatsRow["minutes"], "$.subjects.formats.minutes", ["n"])
        let scoreRangeFormat = try template(formatsRow["scoreRange"], "$.subjects.formats.scoreRange", ["max", "min"])
        var evoStatus: [CSCAEvoStatus: CSCABilingual] = [:]
        for status in CSCAEvoStatus.allCases {
            evoStatus[status] = try l10n(statusRow[status.rawValue], "$.subjects.evoStatus.\(status.rawValue)")
        }
        let feesTitle = try l10n(feesRow["title"], "$.fees.title")
        let subjectsColumn = try l10n(feeColumns["subjects"], "$.fees.columns.subjects")
        let feeColumn = try l10n(feeColumns["fee"], "$.fees.columns.fee")
        let faqTitle = try l10n(faqRow["title"], "$.faq.title")

        // Сводка и «Кому нужен» повторяют цифры таблиц, а не придумывают свои.
        try mentions(summary, "$.summary", [exam.universitiesTotal, exam.subjectsTotal] + feeRows.map(\.fee))
        try mentions(audience.needed.text, "$.audience.needed.text", [exam.universitiesTotal])

        return CSCAOverview(
            schemaVersion: 1, contentVersion: contentVersion, confirmedOn: confirmedOn, kyStatus: kyStatus, exam: exam,
            summary: summary, intro: intro, audience: audience,
            subjects: CSCAOverview.Subjects(
                title: subjectsTitle, columns: columns, minutesFormat: minutesFormat, scoreRangeFormat: scoreRangeFormat,
                evoStatus: evoStatus, groups: groups
            ),
            fees: CSCAOverview.Fees(title: feesTitle, currency: "CNY", subjectsColumn: subjectsColumn, feeColumn: feeColumn, rows: feeRows),
            faq: CSCAOverview.Faq(title: faqTitle, items: faqItems),
            heroPhoto: photoSlots["hero"]!, audiencePhoto: photoSlots["audience"]!, sources: sources
        )
    }

    private func subject(_ value: TimelineJSON?, _ path: String) throws -> CSCAOverviewSubject {
        let row = try record(value, path, ["key", "nameEn", "name", "language", "minutes", "questions", "scoreMin", "scoreMax", "evo"])
        let scoreMin = try int(row["scoreMin"], "\(path).scoreMin", 0, 1000)
        let scoreMax = try int(row["scoreMax"], "\(path).scoreMax", 1, 1000)
        if scoreMax <= scoreMin { try fail(path, "score range is empty") }
        let nameEn = try plain(row["nameEn"], "\(path).nameEn")
        if CountryTimelineRules.matches(CountryTimelineRules.cyrillic, nameEn) { try fail("\(path).nameEn", "not an English name") }
        guard case .string(let rawStatus) = row["evo"], let evo = CSCAEvoStatus(rawValue: rawStatus) else {
            try fail("\(path).evo", "not one of \(CSCAOverviewRules.statuses.joined(separator: ", "))")
        }
        return CSCAOverviewSubject(
            key: try key(row["key"], "\(path).key"),
            nameEn: nameEn,
            name: row["name"] == .null ? nil : try l10n(row["name"], "\(path).name"),
            language: try l10n(row["language"], "\(path).language"),
            minutes: try int(row["minutes"], "\(path).minutes", 1, 600),
            questions: try int(row["questions"], "\(path).questions", 1, 1000),
            scoreMin: scoreMin,
            scoreMax: scoreMax,
            evo: evo
        )
    }

    private func mentions(_ text: CSCABilingual, _ path: String, _ numbers: [Int]) throws {
        for (locale, value) in [("ru", text.ru), ("ky", text.ky)] {
            for number in numbers where !CSCAOverviewRules.mentions(number, in: value) {
                try fail("\(path).\(locale)", "does not say \(number)")
            }
        }
    }

    // MARK: Помощники разбора (повторяют веб)

    private func fail(_ path: String, _ reason: String) throws -> Never {
        throw CSCAOverviewError(file: file, path: path, reason: reason)
    }

    private func record(_ value: TimelineJSON?, _ path: String, _ required: [String], _ optional: [String] = []) throws -> [String: TimelineJSON] {
        guard case .object(let row) = value else { try fail(path, "not an object") }
        for key in required where row[key] == nil { try fail(path, "missing \(key)") }
        for key in row.keys.sorted() where !required.contains(key) && !optional.contains(key) { try fail(path, "unknown key \(key)") }
        return row
    }

    private func list(_ value: TimelineJSON?, _ path: String, _ min: Int, _ max: Int) throws -> [TimelineJSON] {
        guard case .array(let entries) = value, entries.count >= min, entries.count <= max else {
            try fail(path, "needs \(min)..\(max) entries")
        }
        return entries
    }

    /// `Number.isSafeInteger` и диапазон: `1.0` в JSON для JavaScript целое.
    private func int(_ value: TimelineJSON?, _ path: String, _ min: Int, _ max: Int) throws -> Int {
        var number: Int?
        switch value {
        case .int(let whole): number = whole
        case .number(let double) where double.rounded() == double && abs(double) <= 9_007_199_254_740_991: number = Int(double)
        default: number = nil
        }
        guard let number, number >= min, number <= max else { try fail(path, "not an integer \(min)..\(max)") }
        return number
    }

    /// `value === 1` JavaScript: и `1`, и `1.0`.
    private func isOne(_ value: TimelineJSON?) -> Bool {
        value == .int(1) || value == .number(1)
    }

    private func isSha256(_ value: TimelineJSON?) -> Bool {
        guard case .string(let text) = value else { return false }
        return CSCAOverviewRules.matches(CSCAOverviewRules.sha256, text)
    }

    private func string(_ value: TimelineJSON?) throws -> String {
        guard case .string(let text) = value else { try fail("$", "not a string") }
        return text
    }

    private func isoDate(_ value: TimelineJSON?, _ path: String) throws -> String {
        guard case .string(let raw) = value, CountryTimelineRules.isCalendarDate(raw) else { try fail(path, "not a YYYY-MM-DD date") }
        return raw
    }

    private func key(_ value: TimelineJSON?, _ path: String) throws -> String {
        guard case .string(let raw) = value, CSCAOverviewRules.matches(CSCAOverviewRules.key, raw) else { try fail(path, "not a key") }
        return raw
    }

    private func https(_ value: TimelineJSON?, _ path: String) throws -> String {
        guard case .string(let raw) = value, CSCAOverviewRules.matches(CountryTimelineRules.httpsURL, raw) else {
            try fail(path, "not an https URL")
        }
        return raw
    }

    private func photoPathParts(_ name: String) -> (key: String, width: String, extension: String)? {
        let regex = CSCAOverviewRules.photoPath
        guard let match = regex.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)),
              let key = Range(match.range(at: 1), in: name), let width = Range(match.range(at: 2), in: name),
              let ext = Range(match.range(at: 3), in: name) else { return nil }
        return (String(name[key]), String(name[width]), String(name[ext]))
    }

    /// Обычная строка без тире и лишних пробелов (метаданные, английские названия).
    private func plain(_ value: TimelineJSON?, _ path: String) throws -> String {
        guard case .string(let text) = value, !text.isEmpty,
              text == text.trimmingCharacters(in: CountryTimelineRules.jsWhitespace),
              !CountryTimelineRules.matches(CountryTimelineRules.doubleSpace, text) else {
            try fail(path, "empty or untrimmed text")
        }
        if CountryTimelineRules.matches(CountryTimelineRules.dashes, text) { try fail(path, "em or en dash") }
        return text
    }

    /// Строка, которую видит студент: все правила текста.
    private func studentString(_ value: TimelineJSON?, _ path: String) throws -> String {
        let text = try plain(value, path)
        if CountryTimelineRules.matches(CountryTimelineRules.digitGroupSpace, text) { try fail(path, "digit groups need U+00A0 or U+202F") }
        if CountryTimelineRules.hasAbsoluteDate(text) { try fail(path, "a date in student text") }
        for match in CountryTimelineRules.letters.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let range = Range(match.range, in: text) else { continue }
            let word = String(text[range])
            if CountryTimelineRules.matches(CountryTimelineRules.latin, word), CountryTimelineRules.matches(CountryTimelineRules.cyrillic, word),
               !CountryTimelineRules.matches(CountryTimelineRules.latinWithSuffix, word) {
                try fail(path, "mixed script word \(word)")
            }
        }
        for (source, regex) in CSCAOverviewRules.forbidden where CSCAOverviewRules.matches(regex, text) {
            try fail(path, "forbidden wording \(source)")
        }
        return text
    }

    private func l10n(_ value: TimelineJSON?, _ path: String) throws -> CSCABilingual {
        let row = try record(value, path, ["ru", "ky"])
        return CSCABilingual(ru: try studentString(row["ru"], "\(path).ru"), ky: try studentString(row["ky"], "\(path).ky"))
    }

    private func template(_ value: TimelineJSON?, _ path: String, _ slots: [String]) throws -> CSCABilingual {
        let text = try l10n(value, path)
        for (locale, value) in [("ru", text.ru), ("ky", text.ky)] where CSCAOverviewRules.slots(in: value).sorted() != slots.sorted() {
            try fail("\(path).\(locale)", "needs exactly the slots \(slots.joined(separator: ", "))")
        }
        return text
    }

    private func unique(_ values: [String], _ path: String) throws {
        if Set(values).count != values.count { try fail(path, "duplicate key") }
    }
}

// MARK: - Файлы bundle

/// Класс-метка: bundle, в который собран этот файл (приложение или
/// hostless unit-тесты), и в котором лежат файлы обзора.
private final class CSCAOverviewBundleToken {}

struct CSCAOverviewContent: Sendable {
    let overview: CSCAOverview
    let photos: [CSCAOverviewPhoto]

    var hero: CSCAOverviewPhoto? { photo(overview.heroPhoto) }
    var audience: CSCAOverviewPhoto? { photo(overview.audiencePhoto) }

    func photo(_ key: String) -> CSCAOverviewPhoto? { photos.first { $0.key == key } }

    /// Файлы bundle приложения; разбор один раз. Неверный файл не
    /// показывается (обзора нет, раздел работает), тест ловит это раньше.
    static let bundled = load(from: Bundle(for: CSCAOverviewBundleToken.self))

    static func load(from bundle: Bundle) -> Result<CSCAOverviewContent, CSCAOverviewError> {
        let read = { (name: String) in bundle.url(forResource: name, withExtension: "json").flatMap { try? Data(contentsOf: $0) } }
        return load(overview: read("overview"), photos: read("photos"))
    }

    static func load(overview: Data?, photos: Data?) -> Result<CSCAOverviewContent, CSCAOverviewError> {
        do {
            guard let photos else { throw CSCAOverviewError(file: CSCAOverviewParser.photosFile, path: "$", reason: "missing from the bundle") }
            guard let overview else { throw CSCAOverviewError(file: CSCAOverviewParser.overviewFile, path: "$", reason: "missing from the bundle") }
            let parsedPhotos = try CSCAOverviewParser.photos(photos)
            let parsed = try CSCAOverviewParser.overview(overview, photoKeys: Set(parsedPhotos.map(\.key)))
            return .success(CSCAOverviewContent(overview: parsed, photos: parsedPhotos))
        } catch let error as CSCAOverviewError {
            return .failure(error)
        } catch {
            return .failure(CSCAOverviewError(file: CSCAOverviewParser.overviewFile, path: "$", reason: String(describing: error)))
        }
    }
}

// MARK: - Подписи (те же, что `cscaMinutesLabel`, `cscaGroupFacts` веба)

struct CSCASubjectFact: Equatable, Sendable {
    let key: String
    let label: String
    let value: String
}

extension CSCAOverview {
    /// Четыре факта предмета по порядку столбцов таблицы.
    static let subjectFactKeys = ["language", "duration", "questions", "scoreRange"]

    static func fill(_ text: String, _ slots: [String: String]) -> String {
        let range = NSRange(text.startIndex..., in: text)
        var out = text
        for match in CSCAOverviewRules.slot.matches(in: text, range: range).reversed() {
            guard let whole = Range(match.range, in: out), let nameRange = Range(match.range(at: 1), in: text),
                  let value = slots[String(text[nameRange])] else { continue }
            out.replaceSubrange(whole, with: value)
        }
        return out
    }

    func minutesLabel(_ minutes: Int, kyrgyz: Bool) -> String {
        Self.fill(kyrgyz ? subjects.minutesFormat.ky : subjects.minutesFormat.ru, ["n": String(minutes)])
    }

    func scoreRangeLabel(_ subject: CSCAOverviewSubject, kyrgyz: Bool) -> String {
        Self.fill(kyrgyz ? subjects.scoreRangeFormat.ky : subjects.scoreRangeFormat.ru,
                  ["min": String(subject.scoreMin), "max": String(subject.scoreMax)])
    }

    func subjectFacts(_ subject: CSCAOverviewSubject, kyrgyz: Bool) -> [CSCASubjectFact] {
        let columns = subjects.columns
        func pick(_ pair: CSCABilingual) -> String { kyrgyz ? pair.ky : pair.ru }
        return [
            CSCASubjectFact(key: "language", label: pick(columns.language), value: pick(subject.language)),
            CSCASubjectFact(key: "duration", label: pick(columns.duration), value: minutesLabel(subject.minutes, kyrgyz: kyrgyz)),
            CSCASubjectFact(key: "questions", label: pick(columns.questions), value: String(subject.questions)),
            CSCASubjectFact(key: "scoreRange", label: pick(columns.scoreRange), value: scoreRangeLabel(subject, kyrgyz: kyrgyz)),
        ]
    }

    /// Узкая таблица (review веба раунда 1, F3): факт, одинаковый у всех
    /// предметов группы, один раз над её списком; у предмета только отличия.
    func groupFacts(_ group: CSCAOverviewGroup, kyrgyz: Bool) -> (shared: [CSCASubjectFact], bySubject: [String: [CSCASubjectFact]]) {
        let facts = group.subjects.map { subjectFacts($0, kyrgyz: kyrgyz) }
        guard let first = facts.first else { return ([], [:]) }
        let sharedKeys = Set(Self.subjectFactKeys.indices.filter { index in
            facts.allSatisfy { $0[index].value == first[index].value }
        }.map { Self.subjectFactKeys[$0] })
        var bySubject: [String: [CSCASubjectFact]] = [:]
        for (index, subject) in group.subjects.enumerated() {
            bySubject[subject.key] = facts[index].filter { !sharedKeys.contains($0.key) }
        }
        return (first.filter { sharedKeys.contains($0.key) }, bySubject)
    }
}

// MARK: - Фото

extension CSCAOverviewPhoto {
    /// WebP по возрастанию ширины. iPhone читает WebP (ImageIO, iOS 14+),
    /// JPEG манифеста нужен только браузерам без WebP и в bundle не входит.
    var webpFiles: [CSCAOverviewPhotoFile] {
        files.filter { $0.format == .webp }.sorted { $0.width < $1.width }
    }

    /// Самый узкий WebP не уже кадра в пикселях (2x и 3x), иначе самый
    /// широкий: как `srcset` веба.
    func file(forPixelWidth pixels: CGFloat) -> CSCAOverviewPhotoFile? {
        let sources = webpFiles
        return sources.first { CGFloat($0.width) >= pixels } ?? sources.last
    }

    /// Точка кадра из `x% y%` долями 0...1.
    var focus: CGPoint {
        let parts = objectPosition.split(separator: " ").compactMap { Double($0.dropLast()) }
        guard parts.count == 2 else { return CGPoint(x: 0.5, y: 0.5) }
        return CGPoint(x: min(max(parts[0] / 100, 0), 1), y: min(max(parts[1] / 100, 0), 1))
    }

    /// Часть снимка для кадра с соотношением `aspect` (ширина к высоте),
    /// как `object-fit: cover` с `object-position` веба.
    static func crop(imageSize: CGSize, aspect: CGFloat, focus: CGPoint) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, aspect > 0 else { return CGRect(origin: .zero, size: imageSize) }
        if imageSize.width / imageSize.height > aspect {
            let width = (imageSize.height * aspect).rounded()
            return CGRect(x: ((imageSize.width - width) * focus.x).rounded(), y: 0, width: width, height: imageSize.height)
        }
        let height = (imageSize.width / aspect).rounded()
        return CGRect(x: 0, y: ((imageSize.height - height) * focus.y).rounded(), width: imageSize.width, height: height)
    }
}

// MARK: - Новичок и вернувшийся (контракт §19)

/// Выбор зрителя «обзор открыт или свёрнут»: на вебе cookie
/// `csca_overview`, на iPhone тот же ключ в UserDefaults этого устройства.
enum CSCAOverviewChoice: String, Sendable {
    case open, closed

    static let defaultsKey = "csca_overview"

    /// Только точные `open` и `closed`; всё остальное значит «выбора нет».
    static func parse(_ value: String?) -> CSCAOverviewChoice? {
        switch value {
        case "open": return .open
        case "closed": return .closed
        default: return nil
        }
    }

    /// Без выбора новичок видит обзор открытым, тот, кто уже занимается,
    /// свёрнутым; выбор всегда сильнее.
    static func isOpen(_ choice: CSCAOverviewChoice?, started: Bool) -> Bool {
        guard let choice else { return !started }
        return choice == .open
    }
}

extension CSCAHome {
    /// Начал ли студент заниматься: есть ответ, урок, тест или банк ошибок
    /// (`cscaHasStarted` веба).
    var hasStarted: Bool {
        topics.contains { $0.windowAnswers > 0 || $0.lessonCompleted }
            || lessons.contains { $0.completed || $0.draftAttemptId != nil }
            || tests.contains { $0.draft != nil || $0.lastResult != nil }
            || review.activeCount > 0
    }
}
