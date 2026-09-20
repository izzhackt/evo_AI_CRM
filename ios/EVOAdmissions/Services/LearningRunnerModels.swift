import Foundation

/// Codable mirrors of the learning WRITE/review contracts in
/// `supabase/migrations/198_platform_learning_engine.sql` — the runner slice
/// on top of the read models in `LearningModels.swift`:
/// - answer payloads accepted by `grade_learning_answer` (198:610-695)
/// - save receipt of `save_learning_answer_v1` (198:819-825)
/// - verdicts (198:634-693) and explains (`learning_exercise_explain`,
///   198:566-605) — served ONLY for answered exercises
/// - review items of `learning_review_v1` (198:992-1000) and the stateless
///   `learning_review_check_v1` response (198:1027-1031).
///
/// Privacy (198 header, plan §6/§8.5): answers, verdicts and results never go
/// into logs or error messages. Answer KEYS never reach the client: the
/// public projection (198:519-561) carries no `answer_index`/`accepted`/pair
/// mapping, and explains arrive only inside receipts for answered exercises.

// MARK: - Answer payloads (`grade_learning_answer`, 198:610-695)

/// The exact JSONB object shapes the server grades — one single-key object
/// per type (each branch asserts `count(jsonb_object_keys) = 1`):
/// - choice: `{"selected": "<optionId>"}` (198:624-635)
/// - matching: `{"matches": [servedRightIndex…]}` — one 0-based index into
///   the SERVED `rights` order per left, a permutation (198:636-659)
/// - short_answer: `{"text": "…"}`, ≤300 chars (198:660-672)
/// - reading: `{"selected": {"<questionId>": "<optionId>"}}` covering every
///   question (198:673-694)
///
/// The same shapes come back inside the attempt payload's stored `answer`
/// (198:810-814), so this type is Codable both ways. Equatable so the
/// idempotent-retry policy can assert "same request_id ⇒ same payload"
/// (input_hash rule, 198:763-776).
enum LearningAnswer: Codable, Equatable {
    case choice(selected: String)
    case matching(matches: [Int])
    case shortAnswer(text: String)
    case reading(selected: [String: String])

    private enum CodingKeys: String, CodingKey {
        case selected
        case matches
        case text
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let matches = try container.decodeIfPresent([Int].self, forKey: .matches) {
            self = .matching(matches: matches)
        } else if let text = try container.decodeIfPresent(String.self, forKey: .text) {
            self = .shortAnswer(text: text)
        } else if let selected = try? container.decode(String.self, forKey: .selected) {
            self = .choice(selected: selected)
        } else {
            self = .reading(selected: try container.decode([String: String].self, forKey: .selected))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .choice(let selected):
            try container.encode(selected, forKey: .selected)
        case .matching(let matches):
            try container.encode(matches, forKey: .matches)
        case .shortAnswer(let text):
            try container.encode(text, forKey: .text)
        case .reading(let selected):
            try container.encode(selected, forKey: .selected)
        }
    }
}

// MARK: - Verdicts (198:634-693)

/// `verdict` object of the grade: always `{correct}», plus per type
/// - matching: `perPair` [Bool] in LEFT order, `correctCount`, `total`
///   (198:655-659)
/// - reading: `perQuestion` {questionId: Bool} (198:692-693).
struct LearningVerdict: Decodable {
    let correct: Bool
    let perPair: [Bool]?
    let correctCount: Int?
    let total: Int?
    let perQuestion: [String: Bool]?
}

// MARK: - Explains (`learning_exercise_explain`, 198:566-605)

/// Per-option explain row (198:572-577): RU/KY pair is mandatory for every
/// option by the content validator (198:175-176).
struct LearningOptionExplain: Decodable, Identifiable {
    let id: String
    let explainRu: String
    let explainKy: String
}

/// Matching pair in the ORIGINAL (correct) order (198:579-584).
struct LearningMatchingPairExplain: Decodable {
    let leftEn: String
    let rightRu: String
    let rightKy: String
}

/// Reading per-question explain (198:592-603).
struct LearningReadingQuestionExplain: Decodable, Identifiable {
    let id: String
    let correctOptionId: String
    let options: [LearningOptionExplain]
}

/// One flat mirror of the four per-type explain shapes:
/// - choice: `correctOptionId` + `options` (198:569-577)
/// - matching: `pairs` + `explainRu/Ky` (198:578-586)
/// - short_answer: `answer` (first accepted variant) + `explainRu/Ky`
///   (198:587-590)
/// - reading: `questions` (198:591-604).
struct LearningExplain: Decodable {
    let correctOptionId: String?
    let options: [LearningOptionExplain]?
    let pairs: [LearningMatchingPairExplain]?
    let explainRu: String?
    let explainKy: String?
    let answer: String?
    let questions: [LearningReadingQuestionExplain]?
}

// MARK: - Stored answers inside the attempt payload (198:708-714, 810-814)

/// One entry of the payload's `answers` map, keyed by exercise id: the stored
/// `{answer, correct, verdict, answeredAt}` (198:810-814) merged with
/// `explain` from content (198:708-713) — served ONLY because the exercise
/// was answered.
struct LearningAnswerRecord: Decodable {
    let answer: LearningAnswer
    let correct: Bool
    let verdict: LearningVerdict
    /// timestamptz rendered into JSONB; raw string (see `PostgresTimestamp`).
    let answeredAt: String
    let explain: LearningExplain
}

// MARK: - Save receipt (`save_learning_answer_v1`, 198:819-825)

/// `{attemptId, revision, exerciseId, correct, verdict, explain,
///   answeredCount, exercisesTotal}` — the verdict AND the explain arrive in
/// the same response that confirmed the save; the runner renders both from
/// here, never from any client-side key.
struct LearningSaveReceipt: Decodable {
    let attemptId: UUID
    let revision: Int64
    let exerciseId: UUID
    let correct: Bool
    let verdict: LearningVerdict
    let explain: LearningExplain
    let answeredCount: Int
    let exercisesTotal: Int
}

// MARK: - Review (`learning_review_v1`, 198:965-1002)

/// One wrong-bank item (198:992-1000): the SAME public projection as the
/// lesson (`learning_exercise_public`) merged with the owning lesson's
/// `{lessonId, lessonKey, lessonOrderIndex}`. Newest wrong answers first,
/// cap 20 (198:986-991).
struct LearningReviewItem: Decodable, Identifiable {
    let exercise: LearningExercisePublic
    let lessonId: UUID
    let lessonKey: String
    let lessonOrderIndex: Int

    var id: UUID { exercise.exerciseId }

    private enum CodingKeys: String, CodingKey {
        case lessonId
        case lessonKey
        case lessonOrderIndex
    }

    init(from decoder: Decoder) throws {
        // The item is one flat object; the exercise fields live beside the
        // lesson refs, so the projection decodes from the same decoder.
        exercise = try LearningExercisePublic(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        lessonId = try container.decode(UUID.self, forKey: .lessonId)
        lessonKey = try container.decode(String.self, forKey: .lessonKey)
        lessonOrderIndex = try container.decode(Int.self, forKey: .lessonOrderIndex)
    }
}

/// Top-level shape `{items: […]}` (198:1001).
struct LearningReviewResponse: Decodable {
    let items: [LearningReviewItem]
}

/// `learning_review_check_v1` response (198:1027-1031): a stateless re-check
/// of an own wrong-bank exercise — nothing is written (198:1004-1006).
struct LearningReviewCheck: Decodable {
    let exerciseId: UUID
    let correct: Bool
    let verdict: LearningVerdict
    let explain: LearningExplain
}

// MARK: - Pure runner policies (unit-tested headlessly)

/// Failure classification shared by the lesson/review writers. Mirrors the
/// SQLSTATEs the 198 RPCs actually raise: 40001 «Learning attempt changed»
/// (198:794-796), 42501 guard/unavailable (198:483, 793), 22023 invalid or
/// already-answered input (198:747, 752, 773, 801, 806, 833).
enum LearningWriteFailureKind: Equatable {
    case network      // transport: repeating the SAME request is safe
    case conflict     // 40001: the draft changed elsewhere — explicit reload
    case denied       // 42501: learning is unavailable for this account
    case rejected     // 22023 and everything else: the request is not valid

    /// `postgrestCode` is `PostgrestError.code`; a nil code with a transport
    /// error is a network failure.
    static func classify(postgrestCode: String?, isTransportError: Bool) -> LearningWriteFailureKind {
        switch postgrestCode {
        case "40001": return .conflict
        case "42501": return .denied
        case .some: return .rejected
        case nil: return isTransportError ? .network : .network
        }
    }
}

/// One in-flight write, frozen for idempotent retry: the ledger replays the
/// original receipt ONLY for the same `(request_id, operation, input)` —
/// `input_hash` covers operation, lesson, attempt, expectedRevision,
/// exerciseId and the answer (198:763-776), so a retry MUST resend exactly
/// this snapshot, never a rebuilt one.
struct PendingLearningWrite: Equatable {
    enum Operation: Equatable {
        case start(lessonId: UUID)
        case save(exerciseId: UUID, answer: LearningAnswer)
        case complete
    }

    let requestId: UUID
    let operation: Operation
    let expectedRevision: Int64?

    /// Whether this frozen request may be retried as-is after a failure.
    /// Only transport failures are retryable: conflict needs a reload first
    /// (the expected revision is stale), denied/rejected will fail the same
    /// way again (198's validation is deterministic).
    static func isRetryable(after kind: LearningWriteFailureKind) -> Bool {
        kind == .network
    }
}

/// Where the runner opens (resume rule): the first unanswered exercise, in
/// `order_index` order; with every exercise answered the runner lands on the
/// completion step. Theory pages precede exercises only on a fresh attempt —
/// a resumed draft (answeredCount > 0) jumps straight to exercises, mirroring
/// the web runner's resume behaviour.
enum LearningRunnerPolicy {
    /// Index into the exercises array (== count when all are answered).
    static func firstUnansweredIndex(exerciseIds: [UUID], answered: Set<UUID>) -> Int {
        exerciseIds.firstIndex(where: { !answered.contains($0) }) ?? exerciseIds.count
    }

    /// Whether the runner shows the theory intro pages before exercises.
    static func showsTheoryFirst(answeredCount: Int) -> Bool {
        answeredCount == 0
    }
}

/// In-progress form state for one exercise and the pure builder of its wire
/// payload — the iOS mirror of the web's `exerciseValueToAnswer` /
/// `exerciseValueComplete` (src/components/portal/english/exercises.tsx):
/// `answer(for:)` returns nil until the form would pass the server's own
/// shape checks (198:624-694), which is exactly the submit-button gate.
struct ExerciseFormValue: Equatable {
    var choiceSelection: String?
    var matching: MatchingDraft
    var shortText: String
    var readingSelections: [String: String]

    init(exercise: LearningExercisePublic?) {
        choiceSelection = nil
        matching = MatchingDraft(pairCount: exercise?.lefts?.count ?? 0)
        shortText = ""
        readingSelections = [:]
    }

    func answer(for exercise: LearningExercisePublic) -> LearningAnswer? {
        switch exercise.type {
        case "choice":
            return choiceSelection.map { LearningAnswer.choice(selected: $0) }
        case "matching":
            return matching.matchesPayload.map { LearningAnswer.matching(matches: $0) }
        case "short_answer":
            let trimmed = shortText.trimmingCharacters(in: .whitespacesAndNewlines)
            // 1..300 chars: the server's own bound (198:661-665).
            guard !trimmed.isEmpty, trimmed.count <= 300 else { return nil }
            return .shortAnswer(text: trimmed)
        case "reading":
            guard let questions = exercise.questions, !questions.isEmpty else { return nil }
            var selected: [String: String] = [:]
            for question in questions {
                guard let optionId = readingSelections[question.id] else { return nil }
                selected[question.id] = optionId
            }
            // Exactly one entry per question (198:674-681) — stray keys from
            // stale form state never reach the payload.
            return .reading(selected: selected)
        default:
            return nil
        }
    }
}

/// Content-text fallback chains, mirroring the web's `optionLabel` /
/// `exercisePrompt` helpers (src/components/portal/english/exercises.tsx):
/// English content (`label`, `promptEn`, `passageEn`) is the learning
/// material itself and is never translated; RU/KY pairs follow the active
/// bundle language with RU as the last resort.
enum LearningContentText {
    static func optionLabel(_ option: LearningChoiceOption, isKyrgyz: Bool) -> String {
        option.label
            ?? (isKyrgyz ? option.labelKy : option.labelRu)
            ?? option.labelRu
            ?? option.id
    }

    static func prompt(for exercise: LearningExercisePublic, isKyrgyz: Bool) -> String? {
        exercise.promptEn
            ?? (isKyrgyz ? exercise.promptKy : exercise.promptRu)
            ?? exercise.promptRu
    }

    static func pick(ru: String?, ky: String?, isKyrgyz: Bool) -> String? {
        (isKyrgyz ? ky : ru) ?? ru
    }
}

/// Native matching draft: tap a left phrase, tap a right translation —
/// assignments build the `matches` payload (per LEFT index, the chosen
/// 0-based index into the SERVED rights order, 198:640-654). A right already
/// used by another left is re-assigned to the newly chosen left (the old
/// left becomes unassigned) so the payload stays a permutation, which is
/// exactly what the server validates (distinct count = pair count,
/// 198:644-645).
struct MatchingDraft: Equatable {
    let pairCount: Int
    /// `assignments[leftIndex]` = served right index, nil while unassigned.
    private(set) var assignments: [Int?]

    init(pairCount: Int) {
        self.pairCount = pairCount
        assignments = Array(repeating: nil, count: pairCount)
    }

    var isComplete: Bool {
        pairCount > 0 && assignments.allSatisfy { $0 != nil }
    }

    /// The `{"matches": …}` payload; nil until every left has a right.
    var matchesPayload: [Int]? {
        let chosen = assignments.compactMap { $0 }
        guard chosen.count == pairCount else { return nil }
        return chosen
    }

    mutating func assign(rightIndex: Int, toLeft leftIndex: Int) {
        guard (0..<pairCount).contains(leftIndex), (0..<pairCount).contains(rightIndex) else { return }
        if let previousOwner = assignments.firstIndex(of: rightIndex), previousOwner != leftIndex {
            assignments[previousOwner] = nil
        }
        assignments[leftIndex] = rightIndex
    }

    mutating func clear(leftIndex: Int) {
        guard (0..<pairCount).contains(leftIndex) else { return }
        assignments[leftIndex] = nil
    }
}
