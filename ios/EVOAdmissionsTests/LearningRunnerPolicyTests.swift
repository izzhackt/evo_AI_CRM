import XCTest

/// Headless unit tests of the pure runner policies in
/// `LearningRunnerModels.swift` (pattern: ProfileLanguagePolicyTests) —
/// the retry/resume/matching rules the SwiftUI runner defers to.
final class LearningRunnerPolicyTests: XCTestCase {
    private let ids = [
        UUID(uuidString: "dd76de91-f1c5-52a5-8828-7dce1fe9c98c")!,
        UUID(uuidString: "07f3a07d-f993-5ded-8a0e-857ba655eaa8")!,
        UUID(uuidString: "9fec39a7-df20-5158-8ace-b520381045c2")!,
    ]

    // MARK: - Resume policy

    func testResumeOpensFirstUnansweredExercise() {
        XCTAssertEqual(
            LearningRunnerPolicy.firstUnansweredIndex(exerciseIds: ids, answered: []),
            0
        )
        XCTAssertEqual(
            LearningRunnerPolicy.firstUnansweredIndex(exerciseIds: ids, answered: [ids[0]]),
            1
        )
        // Дырка в середине: резюм — на первое НЕотвеченное, не на последнее.
        XCTAssertEqual(
            LearningRunnerPolicy.firstUnansweredIndex(exerciseIds: ids, answered: [ids[0], ids[2]]),
            1
        )
    }

    func testResumeLandsOnCompletionWhenAllAnswered() {
        XCTAssertEqual(
            LearningRunnerPolicy.firstUnansweredIndex(exerciseIds: ids, answered: Set(ids)),
            ids.count
        )
    }

    func testTheoryShowsOnlyForFreshAttempts() {
        // Веб: phase intro только при 0 ответов — резюмированный черновик
        // идёт сразу к упражнениям.
        XCTAssertTrue(LearningRunnerPolicy.showsTheoryFirst(answeredCount: 0))
        XCTAssertFalse(LearningRunnerPolicy.showsTheoryFirst(answeredCount: 1))
    }

    // MARK: - Write-failure classification and retry policy

    func testClassifiesSqlStatesLikeTheMigrationRaisesThem() {
        // 40001 — «Learning attempt changed» (198:794-796).
        XCTAssertEqual(
            LearningWriteFailureKind.classify(postgrestCode: "40001", isTransportError: false),
            .conflict
        )
        // 42501 — guard/unavailable (198:483, 793).
        XCTAssertEqual(
            LearningWriteFailureKind.classify(postgrestCode: "42501", isTransportError: false),
            .denied
        )
        // 22023 — invalid/already answered (198:747, 806, 833).
        XCTAssertEqual(
            LearningWriteFailureKind.classify(postgrestCode: "22023", isTransportError: false),
            .rejected
        )
        XCTAssertEqual(
            LearningWriteFailureKind.classify(postgrestCode: nil, isTransportError: true),
            .network
        )
    }

    func testOnlyNetworkFailuresReuseTheFrozenRequest() {
        // Правило input_hash (198:763-776): повтор безопасен только как
        // ТОЧНАЯ копия; conflict требует reload (ревизия стухла), denied и
        // rejected детерминированно упадут снова.
        XCTAssertTrue(PendingLearningWrite.isRetryable(after: .network))
        XCTAssertFalse(PendingLearningWrite.isRetryable(after: .conflict))
        XCTAssertFalse(PendingLearningWrite.isRetryable(after: .denied))
        XCTAssertFalse(PendingLearningWrite.isRetryable(after: .rejected))
    }

    // MARK: - Matching draft (permutation invariant, 198:644-645)

    func testMatchingDraftBuildsPayloadOnlyWhenComplete() {
        var draft = MatchingDraft(pairCount: 3)
        XCTAssertFalse(draft.isComplete)
        XCTAssertNil(draft.matchesPayload)

        draft.assign(rightIndex: 2, toLeft: 0)
        draft.assign(rightIndex: 0, toLeft: 1)
        XCTAssertNil(draft.matchesPayload)

        draft.assign(rightIndex: 1, toLeft: 2)
        XCTAssertTrue(draft.isComplete)
        XCTAssertEqual(draft.matchesPayload, [2, 0, 1])
    }

    func testMatchingDraftStealsARightFromItsPreviousLeft() {
        // Выбор уже занятого right переназначает его новому left — payload
        // остаётся перестановкой (сервер требует distinct, 198:644-645).
        var draft = MatchingDraft(pairCount: 2)
        draft.assign(rightIndex: 0, toLeft: 0)
        draft.assign(rightIndex: 0, toLeft: 1)
        XCTAssertNil(draft.assignments[0])
        XCTAssertEqual(draft.assignments[1], 0)
        XCTAssertFalse(draft.isComplete)
    }

    func testMatchingDraftClearAndBoundsAreSafe() {
        var draft = MatchingDraft(pairCount: 2)
        draft.assign(rightIndex: 1, toLeft: 0)
        draft.clear(leftIndex: 0)
        XCTAssertNil(draft.assignments[0])
        // Выход за границы игнорируется, а не падает.
        draft.assign(rightIndex: 5, toLeft: 0)
        draft.assign(rightIndex: 0, toLeft: 9)
        XCTAssertEqual(draft.assignments, [nil, nil])
    }

    // MARK: - Form gating (мирроринг exerciseValueToAnswer веба)

    private func exercise(_ json: String) throws -> LearningExercisePublic {
        try JSONDecoder().decode(LearningExercisePublic.self, from: Data(json.utf8))
    }

    func testShortAnswerFormTrimsAndCapsAt300() throws {
        let shortAnswer = try exercise("""
        {
          "exerciseId": "9fec39a7-df20-5158-8ace-b520381045c2",
          "exerciseKey": "en-m1-l01-e06",
          "orderIndex": 6,
          "type": "short_answer",
          "promptRu": "Напишите по-английски.",
          "promptKy": "Англисче жазыңыз."
        }
        """)
        var form = ExerciseFormValue(exercise: shortAnswer)
        XCTAssertNil(form.answer(for: shortAnswer))
        form.shortText = "   "
        XCTAssertNil(form.answer(for: shortAnswer))
        form.shortText = "  My name is Aidana.  "
        XCTAssertEqual(form.answer(for: shortAnswer), .shortAnswer(text: "My name is Aidana."))
        // 300 — серверная граница (198:661-665): длиннее не отправляем.
        form.shortText = String(repeating: "a", count: 301)
        XCTAssertNil(form.answer(for: shortAnswer))
    }

    func testReadingFormRequiresEveryQuestionAndDropsStrayKeys() throws {
        let reading = try exercise("""
        {
          "exerciseId": "4a1a1c2e-8b3d-4f5a-9c6d-7e8f90a1b2c3",
          "exerciseKey": "en-m1-l01-e09",
          "orderIndex": 9,
          "type": "reading",
          "passageEn": "Hi! My name is Aidana.",
          "questions": [
            { "id": "q1", "promptEn": "What is the girl's name?", "options": [ { "id": "a", "label": "Aidana" } ] },
            { "id": "q2", "promptEn": "Is she a student?", "options": [ { "id": "a", "label": "Yes" } ] }
          ]
        }
        """)
        var form = ExerciseFormValue(exercise: reading)
        form.readingSelections = ["q1": "a"]
        XCTAssertNil(form.answer(for: reading))
        // Ключ несуществующего вопроса не должен попасть в payload
        // (ровно один entry на вопрос, 198:674-681).
        form.readingSelections = ["q1": "a", "q2": "a", "stale": "x"]
        XCTAssertEqual(
            form.answer(for: reading),
            .reading(selected: ["q1": "a", "q2": "a"])
        )
    }

    // MARK: - Content-text fallbacks (мирроринг optionLabel/exercisePrompt)

    func testOptionLabelFallbackChain() throws {
        let english = LearningChoiceOption(id: "a", label: "Hello", labelRu: nil, labelKy: nil)
        XCTAssertEqual(LearningContentText.optionLabel(english, isKyrgyz: true), "Hello")

        let bilingual = LearningChoiceOption(
            id: "b", label: nil,
            labelRu: "Приятно познакомиться", labelKy: "Таанышканыма кубанычтамын"
        )
        XCTAssertEqual(
            LearningContentText.optionLabel(bilingual, isKyrgyz: false),
            "Приятно познакомиться"
        )
        XCTAssertEqual(
            LearningContentText.optionLabel(bilingual, isKyrgyz: true),
            "Таанышканыма кубанычтамын"
        )
    }

    func testPromptPrefersEnglishContent() throws {
        let withEnglish = try exercise("""
        {
          "exerciseId": "dd76de91-f1c5-52a5-8828-7dce1fe9c98c",
          "exerciseKey": "en-m1-l02-e01",
          "orderIndex": 1,
          "type": "choice",
          "promptEn": "Choose the correct letter.",
          "options": [ { "id": "a", "label": "A" } ]
        }
        """)
        // Английская формулировка — содержание обучения, не переводится.
        XCTAssertEqual(
            LearningContentText.prompt(for: withEnglish, isKyrgyz: true),
            "Choose the correct letter."
        )
    }
}
