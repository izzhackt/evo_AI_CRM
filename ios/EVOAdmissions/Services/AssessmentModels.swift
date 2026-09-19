import Foundation

/// Codable mirrors of the private-assessment RPC contracts in
/// `supabase/migrations/135_platform_student_assessments.sql`. Timestamps stay
/// raw strings (see `PostgresTimestamp`); learning content (questions,
/// metadata texts) is versioned RU content by contract (`locale = 'ru'`).
///
/// Privacy rule (plan §6 «Тесты»): answers and results never go into logs,
/// analytics or error messages — these types are display-only.

enum AssessmentInstrument {
    static let english = "english36"
    static let orvis = "orvis92"
}

/// `platform.student_assessments_v1()` → `{ instruments, attempts }`.
struct AssessmentCatalog: Decodable {
    let instruments: [AssessmentInstrumentSummary]
    let attempts: [AssessmentAttemptSummary]
}

struct AssessmentInstrumentSummary: Decodable, Identifiable {
    let instrumentKey: String
    let versionId: UUID
    let version: String
    let locale: String
    let metadata: AssessmentMetadata
    let questionCount: Int
    let draftAttemptId: UUID?
    let latestCompletedAttemptId: UUID?

    var id: String { instrumentKey }
}

struct AssessmentAttemptSummary: Decodable, Identifiable {
    let attemptId: UUID
    let instrumentKey: String
    let version: String
    let status: String
    let revision: Int64
    let answeredCount: Int
    let questionCount: Int
    let createdAt: String
    let updatedAt: String
    let completedAt: String?

    var id: UUID { attemptId }
    var isDraft: Bool { status == "draft" }
}

/// Versioned instrument metadata. Field set mirrors the seeded content
/// (`src/lib/student-assessment-contract.ts` `AssessmentMetadata`); every
/// field except `title` is optional so a future content version cannot brick
/// decoding of the whole catalogue.
struct AssessmentMetadata: Decodable {
    let title: String?
    let description: String?
    let instructions: [String]?
    let limitations: [String]?
    let bands: [AssessmentBand]?
    let recommendations: [String: String]?
    let scales: [AssessmentScaleMeta]?
    let professions: [AssessmentProfession]?
    let professionAttribution: String?
}

struct AssessmentBand: Decodable {
    let id: String
    let label: String
}

struct AssessmentScaleMeta: Decodable {
    let id: String
    let label: String
    let description: String
}

struct AssessmentProfession: Decodable, Identifiable {
    let id: String
    let title: String
    let summary: String
    let scaleIds: [String]?
    let tasks: [String]?
    let skills: [String]?
    let studyDirections: [String]?
    let tryActivity: String?
    let careerPath: [String]?
    let editorialNote: String?
    let source: AssessmentProfessionSource?
}

struct AssessmentProfessionSource: Decodable {
    let url: String
    let occupationId: String
    let version: String
    let retrievedOn: String
    let license: String
    let licenseUrl: String
}

/// Public question projection
/// (`platform_private.student_assessment_public_questions`, migration 135):
/// `jsonb_strip_nulls` removes `topic`/`passage` when absent.
struct AssessmentQuestion: Decodable, Identifiable {
    let id: String
    let prompt: String
    let topic: String?
    let passage: String?
    let options: [AssessmentOption]
}

struct AssessmentOption: Decodable, Identifiable {
    let id: String
    let label: String
}

/// `platform_private.student_assessment_attempt_payload` — returned by
/// `student_assessment_attempt_v1` and every start/save/complete receipt.
struct AssessmentAttempt: Decodable {
    let attemptId: UUID
    let instrumentKey: String
    let versionId: UUID
    let version: String
    let locale: String
    let status: String
    let revision: Int64
    let metadata: AssessmentMetadata
    let questions: [AssessmentQuestion]
    let answers: [String: String]
    let result: AssessmentResult?
    let createdAt: String
    let updatedAt: String
    let completedAt: String?

    var isDraft: Bool { status == "draft" }
    var isCompleted: Bool { status == "completed" }
}

/// `platform_private.grade_student_assessment` snapshot (migration 135).
/// No CEFR anywhere by contract: `band` is basic|developing|strong.
struct AssessmentResult: Decodable {
    let instrumentKey: String
    let version: String
    let answeredCount: Int
    let questionCount: Int
    let completedAt: String
    let english: EnglishAssessmentResult?
    let orvis: OrvisAssessmentResult?
}

struct EnglishAssessmentResult: Decodable {
    let correctCount: Int
    let totalCount: Int
    let band: String?
    let topics: [EnglishTopicResult]
    let feedback: [EnglishFeedbackItem]
}

struct EnglishTopicResult: Decodable {
    let topic: String
    let correctCount: Int
    let totalCount: Int
}

struct EnglishFeedbackItem: Decodable {
    let questionId: String
    let selectedOptionId: String?
    let correctOptionId: String
    let correct: Bool
    let explanation: String
    let topic: String
}

struct OrvisAssessmentResult: Decodable {
    let scales: [OrvisScaleResult]
    let topScales: [String]
}

struct OrvisScaleResult: Decodable {
    let scale: String
    let rawSum: Double
    let itemCount: Int
    let mean: Double
}
