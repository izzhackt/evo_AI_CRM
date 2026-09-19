import Foundation

/// Codable mirrors of the learning READ contracts in
/// `supabase/migrations/198_platform_learning_engine.sql` (content seeded by
/// migration 199). This wave ships the read slice only — module map and
/// lesson-content view; the iOS lesson runner (start/save/complete writes)
/// is a separate later slice, so write receipts are not modelled here.
///
/// Privacy (198 header, plan §6/§8.5): learning progress is owner-private —
/// values from these types never go into logs or error messages.

// MARK: - Module map (`platform.learning_modules_v1`, 198:880-922)

/// Top-level shape: `jsonb_build_object('modules', …)` (198:921).
struct LearningModulesResponse: Decodable {
    let modules: [LearningModule]
}

/// One module row (198:885-918). `metadata` keys are validated to exactly
/// {title_ru, title_ky, level_note_ru, level_note_ky} (198:202-203).
struct LearningModule: Decodable, Identifiable {
    let moduleId: UUID
    let moduleKey: String
    let version: String
    let metadata: LearningModuleMetadata
    let lessonsTotal: Int
    let lessonsCompleted: Int
    let lessons: [LearningLessonSummary]

    var id: UUID { moduleId }
}

struct LearningModuleMetadata: Decodable {
    let titleRu: String
    let titleKy: String
    let levelNoteRu: String
    let levelNoteKy: String

    enum CodingKeys: String, CodingKey {
        case titleRu = "title_ru"
        case titleKy = "title_ky"
        case levelNoteRu = "level_note_ru"
        case levelNoteKy = "level_note_ky"
    }
}

/// One lesson row of the map (198:896-915). `metadata` keys are exactly
/// {title_ru, title_ky, goal_ru, goal_ky} (198:215-216). `draftAttemptId`
/// is the caller's own open draft, `lastResult` the `result_snapshot` of the
/// latest completed attempt — both null when absent.
struct LearningLessonSummary: Decodable, Identifiable {
    let lessonId: UUID
    let lessonKey: String
    let orderIndex: Int
    let metadata: LearningLessonMetadata
    let exercisesTotal: Int
    let completed: Bool
    let draftAttemptId: UUID?
    let lastResult: LearningLessonResult?

    var id: UUID { lessonId }
}

struct LearningLessonMetadata: Decodable {
    let titleRu: String
    let titleKy: String
    let goalRu: String
    let goalKy: String

    enum CodingKeys: String, CodingKey {
        case titleRu = "title_ru"
        case titleKy = "title_ky"
        case goalRu = "goal_ru"
        case goalKy = "goal_ky"
    }
}

/// `result_snapshot` written on complete (198:845-850):
/// `{exercisesTotal, correctCount, correctShare, wrongExerciseIds,
///   completedAt}`. `correctShare` is informational only — NOT a pass
/// threshold (198:830-831). `completedAt` stays a raw timestamptz string.
struct LearningLessonResult: Decodable {
    let exercisesTotal: Int
    let correctCount: Int
    let correctShare: Double
    let wrongExerciseIds: [UUID]
    let completedAt: String
}

// MARK: - Lesson content (`platform.learning_lesson_v1`, 198:925-959)

/// Top-level shape (198:945-958): `{module, lesson, draft, latestCompleted}`.
struct LearningLessonResponse: Decodable {
    let module: LearningLessonModuleRef
    let lesson: LearningLessonContent
    let draft: LearningAttemptSnapshot?
    let latestCompleted: LearningAttemptSnapshot?
}

/// `'module'` object (198:946-947) — the map row without progress fields.
struct LearningLessonModuleRef: Decodable {
    let moduleId: UUID
    let moduleKey: String
    let version: String
    let metadata: LearningModuleMetadata
}

/// `'lesson'` object (198:948-953): metadata + `theory` + public exercises.
struct LearningLessonContent: Decodable {
    let lessonId: UUID
    let lessonKey: String
    let orderIndex: Int
    let metadata: LearningLessonMetadata
    let theory: [LearningTheoryBlock]
    let exercises: [LearningExercisePublic]
}

/// One theory block (validator 198:221-234): exactly
/// `{text_ru, text_ky, examples}`, 1-8 examples of exactly `{en, ru, ky}`.
struct LearningTheoryBlock: Decodable {
    let textRu: String
    let textKy: String
    let examples: [LearningTheoryExample]

    enum CodingKeys: String, CodingKey {
        case textRu = "text_ru"
        case textKy = "text_ky"
        case examples
    }
}

struct LearningTheoryExample: Decodable {
    let en: String
    let ru: String
    let ky: String
}

/// Public exercise projection `platform_private.learning_exercise_public`
/// (198:519-561): allowlist-built, answer keys and explains are NEVER in it.
/// Base keys pass through `jsonb_strip_nulls`, so absent prompts/sourceLesson
/// simply do not appear; per-type extras follow the projection exactly:
/// - choice: `options` [{id, label | labelRu+labelKy}]
/// - matching: `instructionRu/Ky`, `lefts` [String], `rights`
///   [{rightRu, rightKy}] in the served (hash-shuffled) order (198:544-547)
/// - short_answer: no extras
/// - reading: `passageEn`, `questions` [{id, promptEn, options}]
struct LearningExercisePublic: Decodable, Identifiable {
    let exerciseId: UUID
    let exerciseKey: String
    let orderIndex: Int
    /// choice | matching | short_answer | reading (CHECK 198:58-59).
    let type: String
    let sourceLesson: Int?
    let promptEn: String?
    let promptRu: String?
    let promptKy: String?
    let options: [LearningChoiceOption]?
    let instructionRu: String?
    let instructionKy: String?
    let lefts: [String]?
    let rights: [LearningMatchingRight]?
    let passageEn: String?
    let questions: [LearningReadingQuestion]?

    var id: UUID { exerciseId }
}

/// Choice/reading option projection (198:533-537): `jsonb_strip_nulls` keeps
/// either `label` (English content, untranslated) or `labelRu`+`labelKy`.
struct LearningChoiceOption: Decodable, Identifiable {
    let id: String
    let label: String?
    let labelRu: String?
    let labelKy: String?
}

struct LearningMatchingRight: Decodable {
    let rightRu: String
    let rightKy: String
}

struct LearningReadingQuestion: Decodable, Identifiable {
    let id: String
    let promptEn: String
    let options: [LearningChoiceOption]
}

/// Own attempt payload `platform_private.learning_attempt_payload`
/// (198:701-722), decoded WITHOUT the `answers` object: the read slice only
/// surfaces progress facts; per-answer verdicts/explains belong to the
/// runner slice. `result` is null for drafts (table CHECK 198:96-98).
struct LearningAttemptSnapshot: Decodable {
    let attemptId: UUID
    let lessonId: UUID
    /// draft | completed (CHECK 198:86).
    let status: String
    let revision: Int64
    let answeredCount: Int
    let exercisesTotal: Int
    let result: LearningLessonResult?
    let createdAt: String
    let updatedAt: String
    let completedAt: String?
}
