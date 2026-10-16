import Foundation

/// Strict Codable mirrors of the CSCA learning RPCs (migrations 285 and 286,
/// contract `docs/portal/csca-contract.md`). The web cabinet and the iPhone
/// read the same JSON; these types follow the contract field by field:
///
/// - every field the contract always sends is required, including the
///   nullable ones (`decodeNullable` fails when the key itself is missing);
/// - closed value sets (`state`, `kind`, `completion`, `status`) are enums,
///   so an unknown value fails the decode instead of rendering a guess;
/// - the item projection has a closed key set (contract §5): an extra key,
///   for example a leaked answer key, fails the decode;
/// - an unknown theory block kind is skipped silently (contract §13).
///
/// Privacy: answers, verdicts and results never go into logs or error text.

// MARK: - Decoding helpers

struct CSCAAnyKey: CodingKey {
    let stringValue: String
    let intValue: Int?
    init(_ string: String) { stringValue = string; intValue = nil }
    init?(stringValue: String) { self.init(stringValue) }
    init?(intValue: Int) { stringValue = String(intValue); self.intValue = intValue }
}

extension KeyedDecodingContainer {
    /// A key the contract always sends, whose value may be JSON `null`.
    func decodeNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else {
            throw DecodingError.keyNotFound(key, .init(
                codingPath: codingPath,
                debugDescription: "Contract key is always present (nullable)"
            ))
        }
        return try decodeIfPresent(type, forKey: key)
    }
}

enum CSCAStrict {
    /// Fails unless the object has exactly `allowed` keys (optional keys may
    /// be absent; nothing outside the set may appear).
    static func requireKeys(
        _ decoder: Decoder,
        required: Set<String>,
        optional: Set<String> = []
    ) throws {
        let container = try decoder.container(keyedBy: CSCAAnyKey.self)
        let present = Set(container.allKeys.map(\.stringValue))
        let missing = required.subtracting(present)
        let extra = present.subtracting(required).subtracting(optional)
        guard missing.isEmpty, extra.isEmpty else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Closed key set violated: missing \(missing.sorted()), extra \(extra.sorted())"
            ))
        }
    }
}

/// One decoder for every CSCA payload, used by the service and the tests.
enum CSCADecoder {
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try JSONDecoder().decode(type, from: data)
    }
}

// MARK: - Shared value sets

enum CSCATopicState: String, Decodable, CaseIterable {
    case notStarted = "not_started"
    case fewData = "few_data"
    case gap
    case shaky
    case confident
}

enum CSCALessonKind: String, Decodable {
    case lesson
    case practice
}

enum CSCATestKind: String, Decodable {
    case diagnostic
    case mock
}

enum CSCACompletion: String, Decodable {
    case submitted
    case timeout
}

enum CSCAAttemptStatus: String, Decodable {
    case draft
    case completed
}

// MARK: - Content metadata

struct CSCAModuleMetadata: Decodable {
    let titleRu: String
    let titleKy: String
    let levelNoteRu: String
    let levelNoteKy: String
    let syllabusEdition: String
    let syllabusUrl: String
    let sections: [CSCASyllabusSection]

    enum CodingKeys: String, CodingKey {
        case titleRu = "title_ru", titleKy = "title_ky"
        case levelNoteRu = "level_note_ru", levelNoteKy = "level_note_ky"
        case syllabusEdition = "syllabus_edition", syllabusUrl = "syllabus_url"
        case sections
    }
}

struct CSCASyllabusSection: Decodable, Identifiable {
    let section: Int
    let titleRu: String
    let titleKy: String
    let titleEn: String
    let mockItemsEstimate: Int
    let points: [CSCASyllabusPoint]

    var id: Int { section }

    enum CodingKeys: String, CodingKey {
        case section, points
        case titleRu = "title_ru", titleKy = "title_ky", titleEn = "title_en"
        case mockItemsEstimate = "mock_items_estimate"
    }
}

struct CSCASyllabusPoint: Decodable {
    let point: String
    let labelRu: String
    let labelKy: String
    let labelEn: String

    enum CodingKeys: String, CodingKey {
        case point
        case labelRu = "label_ru", labelKy = "label_ky", labelEn = "label_en"
    }
}

struct CSCATopicMetadata: Decodable {
    let titleRu: String
    let titleKy: String
    let titleEn: String
    let section: Int
    let syllabusPoint: String
    let syllabusFit: String
    let mockItemsEstimate: Int
    let likelyGap: Bool
    let prerequisites: [String]
    let lessonsPlanned: Int

    enum CodingKeys: String, CodingKey {
        case titleRu = "title_ru", titleKy = "title_ky", titleEn = "title_en"
        case section, prerequisites
        case syllabusPoint = "syllabus_point", syllabusFit = "syllabus_fit"
        case mockItemsEstimate = "mock_items_estimate", likelyGap = "likely_gap"
        case lessonsPlanned = "lessons_planned"
    }
}

struct CSCALessonMetadata: Decodable {
    let titleRu: String
    let titleKy: String
    let titleEn: String
    let goalRu: String
    let goalKy: String
    let topicKey: String
    let kind: CSCALessonKind
    let estMinutes: Int
    let syllabusPoint: String

    enum CodingKeys: String, CodingKey {
        case titleRu = "title_ru", titleKy = "title_ky", titleEn = "title_en"
        case goalRu = "goal_ru", goalKy = "goal_ky"
        case topicKey = "topic_key", kind
        case estMinutes = "est_minutes", syllabusPoint = "syllabus_point"
    }
}

struct CSCATestMetadata: Decodable {
    let titleRu: String
    let titleKy: String
    let introRu: String
    let introKy: String

    enum CodingKeys: String, CodingKey {
        case titleRu = "title_ru", titleKy = "title_ky"
        case introRu = "intro_ru", introKy = "intro_ky"
    }
}

/// `result_snapshot` of a completed 198 lesson attempt.
struct CSCALessonResult: Decodable {
    let exercisesTotal: Int
    let correctCount: Int
    let correctShare: Double
    let wrongExerciseIds: [UUID]
    let completedAt: String
}

// MARK: - Home (`learning_track_home_v1`, contract §3)

struct CSCAHome: Decodable {
    let track: String
    let serverNow: String
    let today: String
    let modules: [CSCAModule]
    let topics: [CSCATopic]
    let lessons: [CSCALessonSummary]
    let tests: [CSCATestSummary]
    let review: CSCAReviewSummary
    let sessions: [CSCASession]
    let targetSessionKey: String?
    let nextStep: CSCANextStep?

    enum CodingKeys: String, CodingKey {
        case track, serverNow, today, modules, topics, lessons, tests, review, sessions
        case targetSessionKey, nextStep
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        track = try c.decode(String.self, forKey: .track)
        serverNow = try c.decode(String.self, forKey: .serverNow)
        today = try c.decode(String.self, forKey: .today)
        modules = try c.decode([CSCAModule].self, forKey: .modules)
        topics = try c.decode([CSCATopic].self, forKey: .topics)
        lessons = try c.decode([CSCALessonSummary].self, forKey: .lessons)
        tests = try c.decode([CSCATestSummary].self, forKey: .tests)
        review = try c.decode(CSCAReviewSummary.self, forKey: .review)
        sessions = try c.decode([CSCASession].self, forKey: .sessions)
        targetSessionKey = try c.decodeNullable(String.self, forKey: .targetSessionKey)
        nextStep = try c.decodeNullable(CSCANextStep.self, forKey: .nextStep)
    }

    func topic(forKey key: String) -> CSCATopic? {
        topics.first { $0.topicKey == key }
    }

    func lessons(forTopic key: String) -> [CSCALessonSummary] {
        lessons.filter { $0.metadata.topicKey == key }.sorted { $0.orderIndex < $1.orderIndex }
    }

    func lesson(id: UUID) -> CSCALessonSummary? {
        lessons.first { $0.lessonId == id }
    }

    func test(kind: CSCATestKind) -> CSCATestSummary? {
        tests.first { $0.kind == kind }
    }
}

struct CSCAModule: Decodable, Identifiable {
    let moduleId: UUID
    let moduleKey: String
    let version: String
    let metadata: CSCAModuleMetadata

    var id: UUID { moduleId }
}

struct CSCATopic: Decodable, Identifiable {
    let moduleId: UUID
    let topicKey: String
    let orderIndex: Int
    let metadata: CSCATopicMetadata
    let state: CSCATopicState
    let windowAnswers: Int
    let windowCorrect: Int
    let lessonCompleted: Bool
    let hasLessons: Bool

    var id: String { topicKey }
}

struct CSCALessonSummary: Decodable, Identifiable {
    let moduleId: UUID
    let lessonId: UUID
    let lessonKey: String
    let orderIndex: Int
    let metadata: CSCALessonMetadata
    let exercisesTotal: Int
    let completed: Bool
    let draftAttemptId: UUID?
    let lastResult: CSCALessonResult?

    var id: UUID { lessonId }

    enum CodingKeys: String, CodingKey {
        case moduleId, lessonId, lessonKey, orderIndex, metadata, exercisesTotal, completed
        case draftAttemptId, lastResult
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        moduleId = try c.decode(UUID.self, forKey: .moduleId)
        lessonId = try c.decode(UUID.self, forKey: .lessonId)
        lessonKey = try c.decode(String.self, forKey: .lessonKey)
        orderIndex = try c.decode(Int.self, forKey: .orderIndex)
        metadata = try c.decode(CSCALessonMetadata.self, forKey: .metadata)
        exercisesTotal = try c.decode(Int.self, forKey: .exercisesTotal)
        completed = try c.decode(Bool.self, forKey: .completed)
        draftAttemptId = try c.decodeNullable(UUID.self, forKey: .draftAttemptId)
        lastResult = try c.decodeNullable(CSCALessonResult.self, forKey: .lastResult)
    }
}

struct CSCATestSummary: Decodable, Identifiable {
    let moduleId: UUID
    let formId: UUID
    let formKey: String
    let kind: CSCATestKind
    let metadata: CSCATestMetadata
    let durationSeconds: Int
    let allowEarlyFinish: Bool
    let itemsTotal: Int
    let draft: CSCATestDraftRef?
    let lastResult: CSCATestLastResult?

    var id: UUID { formId }

    enum CodingKeys: String, CodingKey {
        case moduleId, formId, formKey, kind, metadata, durationSeconds, allowEarlyFinish
        case itemsTotal, draft, lastResult
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        moduleId = try c.decode(UUID.self, forKey: .moduleId)
        formId = try c.decode(UUID.self, forKey: .formId)
        formKey = try c.decode(String.self, forKey: .formKey)
        kind = try c.decode(CSCATestKind.self, forKey: .kind)
        metadata = try c.decode(CSCATestMetadata.self, forKey: .metadata)
        durationSeconds = try c.decode(Int.self, forKey: .durationSeconds)
        allowEarlyFinish = try c.decode(Bool.self, forKey: .allowEarlyFinish)
        itemsTotal = try c.decode(Int.self, forKey: .itemsTotal)
        draft = try c.decodeNullable(CSCATestDraftRef.self, forKey: .draft)
        lastResult = try c.decodeNullable(CSCATestLastResult.self, forKey: .lastResult)
    }
}

struct CSCATestDraftRef: Decodable {
    let attemptId: UUID
    let revision: Int64
    let startedAt: String
    let deadlineAt: String
    let answeredCount: Int
}

struct CSCATestLastResult: Decodable {
    let attemptId: UUID
    let completedAt: String
    let completion: CSCACompletion
    let itemsTotal: Int
    let answeredCount: Int
    let correctCount: Int
    let correctShare: Double
}

struct CSCAReviewSummary: Decodable {
    let dueCount: Int
    let activeCount: Int
    let nextDueOn: String?

    enum CodingKeys: String, CodingKey { case dueCount, activeCount, nextDueOn }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dueCount = try c.decode(Int.self, forKey: .dueCount)
        activeCount = try c.decode(Int.self, forKey: .activeCount)
        nextDueOn = try c.decodeNullable(String.self, forKey: .nextDueOn)
    }
}

/// Official session calendar row (contract §3). Registration window values
/// are null while csca.cn has not published them.
struct CSCASession: Decodable, Identifiable {
    let sessionKey: String
    let examFrom: String
    let examTo: String
    let registrationOpensAt: String?
    let registrationClosesAt: String?
    let sourceUrl: String
    let verifiedOn: String

    var id: String { sessionKey }

    enum CodingKeys: String, CodingKey {
        case sessionKey, examFrom, examTo, registrationOpensAt, registrationClosesAt
        case sourceUrl, verifiedOn
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionKey = try c.decode(String.self, forKey: .sessionKey)
        examFrom = try c.decode(String.self, forKey: .examFrom)
        examTo = try c.decode(String.self, forKey: .examTo)
        registrationOpensAt = try c.decodeNullable(String.self, forKey: .registrationOpensAt)
        registrationClosesAt = try c.decodeNullable(String.self, forKey: .registrationClosesAt)
        sourceUrl = try c.decode(String.self, forKey: .sourceUrl)
        verifiedOn = try c.decode(String.self, forKey: .verifiedOn)
    }
}

/// `nextStep` (contract §3, §12): test, lesson, review or null.
enum CSCANextStep: Decodable, Equatable {
    case test(formId: UUID, formKey: String)
    case lesson(lessonId: UUID, lessonKey: String, lessonKind: CSCALessonKind, topicKey: String, topicState: CSCATopicState)
    case review

    private enum CodingKeys: String, CodingKey {
        case kind, formId, formKey, lessonId, lessonKey, lessonKind, topicKey, topicState
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "test":
            try CSCAStrict.requireKeys(decoder, required: ["kind", "formId", "formKey"])
            self = .test(
                formId: try c.decode(UUID.self, forKey: .formId),
                formKey: try c.decode(String.self, forKey: .formKey)
            )
        case "lesson":
            try CSCAStrict.requireKeys(
                decoder,
                required: ["kind", "lessonId", "lessonKey", "lessonKind", "topicKey", "topicState"]
            )
            self = .lesson(
                lessonId: try c.decode(UUID.self, forKey: .lessonId),
                lessonKey: try c.decode(String.self, forKey: .lessonKey),
                lessonKind: try c.decode(CSCALessonKind.self, forKey: .lessonKind),
                topicKey: try c.decode(String.self, forKey: .topicKey),
                topicState: try c.decode(CSCATopicState.self, forKey: .topicState)
            )
        case "review":
            try CSCAStrict.requireKeys(decoder, required: ["kind"])
            self = .review
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "Unknown nextStep kind"
            )
        }
    }
}

// MARK: - Items (contract §5) and explains (§6)

struct CSCAOption: Decodable, Identifiable, Equatable {
    let id: String
    let label: String

    init(from decoder: Decoder) throws {
        try CSCAStrict.requireKeys(decoder, required: ["id", "label"])
        let c = try decoder.container(keyedBy: CSCAAnyKey.self)
        id = try c.decode(String.self, forKey: CSCAAnyKey("id"))
        label = try c.decode(String.self, forKey: CSCAAnyKey("label"))
        guard CSCAItem.optionIds.contains(id) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Option id outside a..d"))
        }
    }
}

/// Public item projection. Answer key, explains and solution never come
/// with it; the key set is closed (contract §5).
struct CSCAItem: Decodable, Identifiable {
    static let optionIds = ["a", "b", "c", "d"]
    /// Keys of the projection inside a test form or review entry.
    static let projectionKeys: Set<String> = [
        "itemKey", "topicKey", "syllabusPoint", "difficulty", "estSeconds", "stemEn", "options",
    ]

    let itemKey: String
    let topicKey: String
    let syllabusPoint: String
    let difficulty: Int
    let estSeconds: Int
    let figureKey: String?
    let stemEn: String
    let options: [CSCAOption]

    var id: String { itemKey }

    private enum CodingKeys: String, CodingKey {
        case itemKey, topicKey, syllabusPoint, difficulty, estSeconds, figureKey, stemEn, options
    }

    init(from decoder: Decoder) throws {
        try self.init(from: decoder, extraKeys: [])
    }

    /// `extraKeys`: the lesson exercise wrapper keys that sit beside the
    /// projection in the same object (contract §5).
    init(from decoder: Decoder, extraKeys: Set<String>) throws {
        try CSCAStrict.requireKeys(
            decoder,
            required: Self.projectionKeys.union(extraKeys),
            optional: ["figureKey"]
        )
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemKey = try c.decode(String.self, forKey: .itemKey)
        topicKey = try c.decode(String.self, forKey: .topicKey)
        syllabusPoint = try c.decode(String.self, forKey: .syllabusPoint)
        difficulty = try c.decode(Int.self, forKey: .difficulty)
        estSeconds = try c.decode(Int.self, forKey: .estSeconds)
        figureKey = try c.decodeIfPresent(String.self, forKey: .figureKey)
        stemEn = try c.decode(String.self, forKey: .stemEn)
        options = try c.decode([CSCAOption].self, forKey: .options)
        guard (1...3).contains(difficulty), options.map(\.id) == Self.optionIds else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Item needs difficulty 1..3 and options a, b, c, d in order"
            ))
        }
    }
}

/// One exercise of a CSCA lesson: the 198 wrapper plus the item projection
/// in the same flat object.
struct CSCALessonExercise: Decodable, Identifiable {
    let exerciseId: UUID
    let exerciseKey: String
    let orderIndex: Int
    let item: CSCAItem

    var id: UUID { exerciseId }

    private enum CodingKeys: String, CodingKey { case exerciseId, exerciseKey, orderIndex, type }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(String.self, forKey: .type) == "item" else {
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: c, debugDescription: "CSCA lessons contain only item exercises"
            )
        }
        exerciseId = try c.decode(UUID.self, forKey: .exerciseId)
        exerciseKey = try c.decode(String.self, forKey: .exerciseKey)
        orderIndex = try c.decode(Int.self, forKey: .orderIndex)
        item = try CSCAItem(from: decoder, extraKeys: ["exerciseId", "exerciseKey", "orderIndex", "type"])
    }
}

struct CSCAOptionExplain: Decodable, Identifiable {
    let id: String
    let explainRu: String
    let explainKy: String
}

struct CSCATerm: Decodable, Hashable {
    let en: String
    let ru: String
    let ky: String
}

/// Item explain (contract §6): every option explained, solution steps in RU
/// and KY of equal length, glossary terms.
struct CSCAItemExplain: Decodable {
    let correctOptionId: String
    let options: [CSCAOptionExplain]
    let solutionRu: [String]
    let solutionKy: [String]
    let terms: [CSCATerm]

    private enum CodingKeys: String, CodingKey { case correctOptionId, options, solutionRu, solutionKy, terms }

    init(from decoder: Decoder) throws {
        try CSCAStrict.requireKeys(decoder, required: ["correctOptionId", "options", "solutionRu", "solutionKy", "terms"])
        let c = try decoder.container(keyedBy: CodingKeys.self)
        correctOptionId = try c.decode(String.self, forKey: .correctOptionId)
        options = try c.decode([CSCAOptionExplain].self, forKey: .options)
        solutionRu = try c.decode([String].self, forKey: .solutionRu)
        solutionKy = try c.decode([String].self, forKey: .solutionKy)
        terms = try c.decode([CSCATerm].self, forKey: .terms)
        guard CSCAItem.optionIds.contains(correctOptionId), solutionRu.count == solutionKy.count else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Explain needs a..d key and RU/KY solutions of equal length"
            ))
        }
    }

    func explain(for optionId: String) -> CSCAOptionExplain? {
        options.first { $0.id == optionId }
    }
}

struct CSCAVerdict: Decodable {
    let correct: Bool
}

/// The only answer shape for an item: `{"selected": "a"}` (contract §6, §8).
struct CSCAItemAnswer: Codable, Equatable {
    let selected: String
}

// MARK: - Figures (contract §15)

struct CSCAFigure: Decodable {
    let svg: String
    let viewBox: String
    let altRu: String
    let altKy: String
    let altEn: String
    let sha256: String
}

// MARK: - Theory blocks (contract §13)

struct CSCABilingual: Decodable, Hashable {
    let ru: String
    let ky: String
}

/// Table cell: `{"tex"}` formula or `{"ru","ky"}` text.
enum CSCATableCell: Decodable {
    case tex(String)
    case text(CSCABilingual)

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CSCAAnyKey.self)
        if c.contains(CSCAAnyKey("tex")) {
            try CSCAStrict.requireKeys(decoder, required: ["tex"])
            self = .tex(try c.decode(String.self, forKey: CSCAAnyKey("tex")))
        } else {
            try CSCAStrict.requireKeys(decoder, required: ["ru", "ky"])
            self = .text(try CSCABilingual(from: decoder))
        }
    }
}

enum CSCATheoryBlock: Decodable {
    case idea(CSCABilingual)
    case formula(tex: [String], note: CSCABilingual)
    case figure(figureKey: String, caption: CSCABilingual)
    case table(caption: CSCABilingual, header: [CSCATableCell], rows: [[CSCATableCell]])
    case example(title: CSCABilingual, stemEn: String, steps: [CSCABilingual], answer: CSCABilingual)
    case pitfalls([CSCABilingual])
    case tip(tip: String, text: CSCABilingual)
    case terms([CSCATerm])
    case interactive(widget: String, figureKey: String, caption: CSCABilingual)
    /// A future block kind: renderers skip it (contract §13).
    case unknown(String)

    private enum CodingKeys: String, CodingKey {
        case kind, ru, ky, tex
        case noteRu = "note_ru", noteKy = "note_ky"
        case figureKey = "figure_key", captionRu = "caption_ru", captionKy = "caption_ky"
        case header, rows
        case titleRu = "title_ru", titleKy = "title_ky", stemEn = "stem_en", steps
        case answerRu = "answer_ru", answerKy = "answer_ky"
        case items, tip, terms, widget, params
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        func pair(_ ru: CodingKeys, _ ky: CodingKeys) throws -> CSCABilingual {
            CSCABilingual(ru: try c.decode(String.self, forKey: ru), ky: try c.decode(String.self, forKey: ky))
        }
        func keys(_ set: Set<String>) throws {
            try CSCAStrict.requireKeys(decoder, required: set.union(["kind"]))
        }
        switch kind {
        case "idea":
            try keys(["ru", "ky"])
            self = .idea(try pair(.ru, .ky))
        case "formula":
            try keys(["tex", "note_ru", "note_ky"])
            let tex = try c.decode([String].self, forKey: .tex)
            guard (1...6).contains(tex.count) else {
                throw DecodingError.dataCorruptedError(forKey: .tex, in: c, debugDescription: "1..6 formula lines")
            }
            self = .formula(tex: tex, note: try pair(.noteRu, .noteKy))
        case "figure":
            try keys(["figure_key", "caption_ru", "caption_ky"])
            self = .figure(figureKey: try c.decode(String.self, forKey: .figureKey), caption: try pair(.captionRu, .captionKy))
        case "table":
            try keys(["caption_ru", "caption_ky", "header", "rows"])
            let header = try c.decode([CSCATableCell].self, forKey: .header)
            let rows = try c.decode([[CSCATableCell]].self, forKey: .rows)
            guard (2...6).contains(header.count), (1...20).contains(rows.count),
                  rows.allSatisfy({ $0.count == header.count }) else {
                throw DecodingError.dataCorruptedError(forKey: .rows, in: c, debugDescription: "Table shape")
            }
            self = .table(caption: try pair(.captionRu, .captionKy), header: header, rows: rows)
        case "example":
            try keys(["title_ru", "title_ky", "stem_en", "steps", "answer_ru", "answer_ky"])
            self = .example(
                title: try pair(.titleRu, .titleKy),
                stemEn: try c.decode(String.self, forKey: .stemEn),
                steps: try c.decode([CSCABilingual].self, forKey: .steps),
                answer: try pair(.answerRu, .answerKy)
            )
        case "pitfalls":
            try keys(["items"])
            self = .pitfalls(try c.decode([CSCABilingual].self, forKey: .items))
        case "tip":
            try keys(["tip", "ru", "ky"])
            self = .tip(tip: try c.decode(String.self, forKey: .tip), text: try pair(.ru, .ky))
        case "terms":
            try keys(["terms"])
            self = .terms(try c.decode([CSCATerm].self, forKey: .terms))
        case "interactive":
            try keys(["widget", "params", "figure_key", "caption_ru", "caption_ky"])
            self = .interactive(
                widget: try c.decode(String.self, forKey: .widget),
                figureKey: try c.decode(String.self, forKey: .figureKey),
                caption: try pair(.captionRu, .captionKy)
            )
        default:
            self = .unknown(kind)
        }
    }

    var isRenderable: Bool {
        if case .unknown = self { return false }
        return true
    }
}

// MARK: - Lesson (`learning_lesson_v2`, contract §5)

struct CSCALessonModuleRef: Decodable {
    let moduleId: UUID
    let moduleKey: String
    let version: String
    let track: String
    let metadata: CSCAModuleMetadata
}

struct CSCATopicRef: Decodable {
    let topicKey: String
    let orderIndex: Int
    let metadata: CSCATopicMetadata
}

struct CSCALessonContent: Decodable {
    let lessonId: UUID
    let lessonKey: String
    let orderIndex: Int
    let metadata: CSCALessonMetadata
    let theory: [CSCATheoryBlock]
    let exercises: [CSCALessonExercise]
}

struct CSCALessonResponse: Decodable {
    let module: CSCALessonModuleRef
    let topic: CSCATopicRef?
    let lesson: CSCALessonContent
    let figures: [String: CSCAFigure]
    let draft: CSCALessonAttempt?
    let latestCompleted: CSCALessonAttempt?

    private enum CodingKeys: String, CodingKey { case module, topic, lesson, figures, draft, latestCompleted }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        module = try c.decode(CSCALessonModuleRef.self, forKey: .module)
        topic = try c.decodeNullable(CSCATopicRef.self, forKey: .topic)
        lesson = try c.decode(CSCALessonContent.self, forKey: .lesson)
        figures = try c.decode([String: CSCAFigure].self, forKey: .figures)
        draft = try c.decodeNullable(CSCALessonAttempt.self, forKey: .draft)
        latestCompleted = try c.decodeNullable(CSCALessonAttempt.self, forKey: .latestCompleted)
    }
}

/// One answered exercise inside a 198 attempt payload: stored answer,
/// verdict and the item explain (served only because it was answered).
struct CSCALessonAnswerRecord: Decodable {
    let answer: CSCAItemAnswer
    let correct: Bool
    let verdict: CSCAVerdict
    let answeredAt: String
    let explain: CSCAItemExplain
}

/// 198 attempt payload for a CSCA lesson (start, complete, draft, latest).
struct CSCALessonAttempt: Decodable {
    let attemptId: UUID
    let lessonId: UUID
    let status: CSCAAttemptStatus
    let revision: Int64
    let answers: [String: CSCALessonAnswerRecord]
    let answeredCount: Int
    let exercisesTotal: Int
    let result: CSCALessonResult?
    let createdAt: String
    let updatedAt: String
    let completedAt: String?

    private enum CodingKeys: String, CodingKey {
        case attemptId, lessonId, status, revision, answers, answeredCount, exercisesTotal
        case result, createdAt, updatedAt, completedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attemptId = try c.decode(UUID.self, forKey: .attemptId)
        lessonId = try c.decode(UUID.self, forKey: .lessonId)
        status = try c.decode(CSCAAttemptStatus.self, forKey: .status)
        revision = try c.decode(Int64.self, forKey: .revision)
        answers = try c.decode([String: CSCALessonAnswerRecord].self, forKey: .answers)
        answeredCount = try c.decode(Int.self, forKey: .answeredCount)
        exercisesTotal = try c.decode(Int.self, forKey: .exercisesTotal)
        result = try c.decodeNullable(CSCALessonResult.self, forKey: .result)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        updatedAt = try c.decode(String.self, forKey: .updatedAt)
        completedAt = try c.decodeNullable(String.self, forKey: .completedAt)
    }

    /// Answer records keyed by exercise id (keys arrive lowercased).
    var records: [UUID: CSCALessonAnswerRecord] {
        var out: [UUID: CSCALessonAnswerRecord] = [:]
        for (key, record) in answers {
            if let id = UUID(uuidString: key) { out[id] = record }
        }
        return out
    }
}

/// `save_learning_answer_v1` receipt for an item (contract §6).
struct CSCALessonSaveReceipt: Decodable {
    let attemptId: UUID
    let revision: Int64
    let exerciseId: UUID
    let correct: Bool
    let verdict: CSCAVerdict
    let explain: CSCAItemExplain
    let answeredCount: Int
    let exercisesTotal: Int
}

// MARK: - Timed test (contract §7)

struct CSCAPace: Decodable {
    let answeredWithTime: Int
    let avgSeconds: Int?
    let budgetSeconds: Int

    private enum CodingKeys: String, CodingKey { case answeredWithTime, avgSeconds, budgetSeconds }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        answeredWithTime = try c.decode(Int.self, forKey: .answeredWithTime)
        avgSeconds = try c.decodeNullable(Int.self, forKey: .avgSeconds)
        budgetSeconds = try c.decode(Int.self, forKey: .budgetSeconds)
    }
}

struct CSCAResultByTopic: Decodable, Identifiable {
    let topicKey: String
    let total: Int
    let answered: Int
    let correct: Int
    var id: String { topicKey }
}

struct CSCAResultBySection: Decodable, Identifiable {
    let section: Int
    let total: Int
    let answered: Int
    let correct: Int
    var id: Int { section }
}

struct CSCAResultPerItem: Decodable {
    let selected: String?
    let correct: Bool

    private enum CodingKeys: String, CodingKey { case selected, correct }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        selected = try c.decodeNullable(String.self, forKey: .selected)
        correct = try c.decode(Bool.self, forKey: .correct)
    }
}

struct CSCATestResult: Decodable {
    let itemsTotal: Int
    let answeredCount: Int
    let correctCount: Int
    let unansweredCount: Int
    let correctShare: Double
    let byTopic: [CSCAResultByTopic]
    let bySection: [CSCAResultBySection]
    let pace: CSCAPace
    let perItem: [String: CSCAResultPerItem]
    let wrongItemKeys: [String]
    let unansweredItemKeys: [String]
    let completion: CSCACompletion
    let completedAt: String
}

struct CSCATestReviewEntry: Decodable, Identifiable {
    let itemKey: String
    let selected: String?
    let correct: Bool
    let seconds: Int?
    let flagged: Bool
    let explain: CSCAItemExplain

    var id: String { itemKey }

    private enum CodingKeys: String, CodingKey { case itemKey, selected, correct, seconds, flagged, explain }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemKey = try c.decode(String.self, forKey: .itemKey)
        selected = try c.decodeNullable(String.self, forKey: .selected)
        correct = try c.decode(Bool.self, forKey: .correct)
        seconds = try c.decodeNullable(Int.self, forKey: .seconds)
        flagged = try c.decode(Bool.self, forKey: .flagged)
        explain = try c.decode(CSCAItemExplain.self, forKey: .explain)
    }
}

struct CSCATestAttempt: Decodable {
    let attemptId: UUID
    let formId: UUID
    let formKey: String
    let kind: CSCATestKind
    let track: String
    let metadata: CSCATestMetadata
    let durationSeconds: Int
    let allowEarlyFinish: Bool
    let graceSeconds: Int
    let status: CSCAAttemptStatus
    let revision: Int64
    let startedAt: String
    let deadlineAt: String
    let serverNow: String
    let itemsTotal: Int
    let answeredCount: Int
    let answers: [String: String]
    let flags: [String]
    let itemSeconds: [String: Int]
    let items: [CSCAItem]
    let figures: [String: CSCAFigure]
    let completion: CSCACompletion?
    let completedAt: String?
    let result: CSCATestResult?
    let review: [CSCATestReviewEntry]?

    private enum CodingKeys: String, CodingKey {
        case attemptId, formId, formKey, kind, track, metadata, durationSeconds, allowEarlyFinish
        case graceSeconds, status, revision, startedAt, deadlineAt, serverNow, itemsTotal
        case answeredCount, answers, flags, itemSeconds, items, figures, completion, completedAt
        case result, review
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attemptId = try c.decode(UUID.self, forKey: .attemptId)
        formId = try c.decode(UUID.self, forKey: .formId)
        formKey = try c.decode(String.self, forKey: .formKey)
        kind = try c.decode(CSCATestKind.self, forKey: .kind)
        track = try c.decode(String.self, forKey: .track)
        metadata = try c.decode(CSCATestMetadata.self, forKey: .metadata)
        durationSeconds = try c.decode(Int.self, forKey: .durationSeconds)
        allowEarlyFinish = try c.decode(Bool.self, forKey: .allowEarlyFinish)
        graceSeconds = try c.decode(Int.self, forKey: .graceSeconds)
        status = try c.decode(CSCAAttemptStatus.self, forKey: .status)
        revision = try c.decode(Int64.self, forKey: .revision)
        startedAt = try c.decode(String.self, forKey: .startedAt)
        deadlineAt = try c.decode(String.self, forKey: .deadlineAt)
        serverNow = try c.decode(String.self, forKey: .serverNow)
        itemsTotal = try c.decode(Int.self, forKey: .itemsTotal)
        answeredCount = try c.decode(Int.self, forKey: .answeredCount)
        answers = try c.decode([String: String].self, forKey: .answers)
        flags = try c.decode([String].self, forKey: .flags)
        itemSeconds = try c.decode([String: Int].self, forKey: .itemSeconds)
        items = try c.decode([CSCAItem].self, forKey: .items)
        figures = try c.decode([String: CSCAFigure].self, forKey: .figures)
        completion = try c.decodeNullable(CSCACompletion.self, forKey: .completion)
        completedAt = try c.decodeNullable(String.self, forKey: .completedAt)
        result = try c.decodeNullable(CSCATestResult.self, forKey: .result)
        review = try c.decodeNullable([CSCATestReviewEntry].self, forKey: .review)
        // Review and keys only after finish (contract §7.4).
        guard (status == .completed) == (result != nil), (status == .completed) == (review != nil) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Result and review exist exactly for completed attempts"
            ))
        }
    }

    var isCompleted: Bool { status == .completed }

    func reviewEntry(for itemKey: String) -> CSCATestReviewEntry? {
        review?.first { $0.itemKey == itemKey }
    }
}

/// `save_learning_test_v1` receipt (contract §7.3): says nothing about
/// correctness.
struct CSCATestSaveReceipt: Decodable {
    let attemptId: UUID
    let status: CSCAAttemptStatus
    let revision: Int64
    let answeredCount: Int
    let savedAt: String
    let deadlineAt: String
    let serverNow: String
}

/// The state `save_learning_test_v1` replaces as a whole.
struct CSCATestSaveState: Equatable {
    var answers: [String: String]
    var flags: [String]
    var itemSeconds: [String: Int]
}

// MARK: - Spaced review (contract §8)

struct CSCAReviewEntry: Decodable, Identifiable {
    let itemKey: String
    let box: Int
    let dueOn: String
    let lapses: Int
    let item: CSCAItem

    var id: String { itemKey }
}

struct CSCAReviewResponse: Decodable {
    let track: String
    let today: String
    let items: [CSCAReviewEntry]
    let figures: [String: CSCAFigure]
    let dueCount: Int
    let activeCount: Int
    let nextDueOn: String?

    private enum CodingKeys: String, CodingKey { case track, today, items, figures, dueCount, activeCount, nextDueOn }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        track = try c.decode(String.self, forKey: .track)
        today = try c.decode(String.self, forKey: .today)
        items = try c.decode([CSCAReviewEntry].self, forKey: .items)
        figures = try c.decode([String: CSCAFigure].self, forKey: .figures)
        dueCount = try c.decode(Int.self, forKey: .dueCount)
        activeCount = try c.decode(Int.self, forKey: .activeCount)
        nextDueOn = try c.decodeNullable(String.self, forKey: .nextDueOn)
    }
}

struct CSCAReviewReceipt: Decodable {
    let itemKey: String
    let correct: Bool
    let verdict: CSCAVerdict
    let explain: CSCAItemExplain
    let box: Int
    let dueOn: String?
    let retired: Bool
    let lapses: Int

    private enum CodingKeys: String, CodingKey { case itemKey, correct, verdict, explain, box, dueOn, retired, lapses }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemKey = try c.decode(String.self, forKey: .itemKey)
        correct = try c.decode(Bool.self, forKey: .correct)
        verdict = try c.decode(CSCAVerdict.self, forKey: .verdict)
        explain = try c.decode(CSCAItemExplain.self, forKey: .explain)
        box = try c.decode(Int.self, forKey: .box)
        dueOn = try c.decodeNullable(String.self, forKey: .dueOn)
        retired = try c.decode(Bool.self, forKey: .retired)
        lapses = try c.decode(Int.self, forKey: .lapses)
        guard (1...4).contains(box), retired == (dueOn == nil) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Box 1..4; retired has no due date"))
        }
    }
}

// MARK: - Progress (contract §9)

struct CSCAProgressTopic: Decodable, Identifiable {
    let topicKey: String
    let orderIndex: Int
    let section: Int
    let state: CSCATopicState
    let windowAnswers: Int
    let windowCorrect: Int
    let answersTotal: Int
    let correctTotal: Int
    let lessonCompleted: Bool

    var id: String { topicKey }
}

struct CSCAProgressTest: Decodable, Identifiable {
    let attemptId: UUID
    let formKey: String
    let kind: CSCATestKind
    let completion: CSCACompletion
    let completedAt: String
    let itemsTotal: Int
    let answeredCount: Int
    let correctCount: Int
    let correctShare: Double
    let avgSeconds: Int?

    var id: UUID { attemptId }

    private enum CodingKeys: String, CodingKey {
        case attemptId, formKey, kind, completion, completedAt, itemsTotal, answeredCount
        case correctCount, correctShare, avgSeconds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attemptId = try c.decode(UUID.self, forKey: .attemptId)
        formKey = try c.decode(String.self, forKey: .formKey)
        kind = try c.decode(CSCATestKind.self, forKey: .kind)
        completion = try c.decode(CSCACompletion.self, forKey: .completion)
        completedAt = try c.decode(String.self, forKey: .completedAt)
        itemsTotal = try c.decode(Int.self, forKey: .itemsTotal)
        answeredCount = try c.decode(Int.self, forKey: .answeredCount)
        correctCount = try c.decode(Int.self, forKey: .correctCount)
        correctShare = try c.decode(Double.self, forKey: .correctShare)
        avgSeconds = try c.decodeNullable(Int.self, forKey: .avgSeconds)
    }
}

struct CSCAStreak: Decodable {
    let current: Int
    let best: Int
    let lastActiveOn: String?
    let timeZone: String

    private enum CodingKeys: String, CodingKey { case current, best, lastActiveOn, timeZone }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        current = try c.decode(Int.self, forKey: .current)
        best = try c.decode(Int.self, forKey: .best)
        lastActiveOn = try c.decodeNullable(String.self, forKey: .lastActiveOn)
        timeZone = try c.decode(String.self, forKey: .timeZone)
    }
}

struct CSCACoverage: Decodable {
    let topicsTotal: Int
    let topicsWithCompletedLesson: Int
}

struct CSCAProgressReview: Decodable {
    let dueCount: Int
    let activeCount: Int
    let retiredCount: Int
}

struct CSCAProgress: Decodable {
    let track: String
    let today: String
    let coverage: CSCACoverage
    let topics: [CSCAProgressTopic]
    let tests: [CSCAProgressTest]
    let pace: CSCAPace
    let streak: CSCAStreak
    let review: CSCAProgressReview
}

// MARK: - Report and target session (contract §10, §11)

struct CSCAReportReceipt: Decodable {
    let reportId: UUID
    let itemKey: String
    let createdAt: String
}

struct CSCATargetSessionReceipt: Decodable {
    let track: String
    let targetSessionKey: String?
    let updatedAt: String

    private enum CodingKeys: String, CodingKey { case track, targetSessionKey, updatedAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        track = try c.decode(String.self, forKey: .track)
        targetSessionKey = try c.decodeNullable(String.self, forKey: .targetSessionKey)
        updatedAt = try c.decode(String.self, forKey: .updatedAt)
    }
}
