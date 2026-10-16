import XCTest

/// Strict decoders against REAL responses of the CSCA RPCs (migrations 285
/// and 286), captured on the local demo stack evo-video-demo from a
/// synthetic demo student (`Fixtures/CSCA/csca_*.json`; capture flow:
/// home, lessons, lesson start/save/complete, diagnostic and mock tests
/// including a real server-side timeout, review, progress, report, target
/// session).
final class CSCADecodingTests: XCTestCase {
    static func fixture(_ name: String) throws -> Data {
        let bundle = Bundle(for: CSCADecodingTests.self)
        guard let url = bundle.url(forResource: name, withExtension: "json") else {
            throw XCTSkip("missing fixture \(name)")
        }
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try CSCADecoder.decode(type, from: fixture(name))
    }

    /// Re-encodes a fixture after `edit`, to probe the strict rules.
    static func mutated<T: Decodable>(_ type: T.Type, _ name: String, _ edit: (inout [String: Any]) -> Void) throws -> T {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture(name)) as? [String: Any])
        edit(&object)
        return try CSCADecoder.decode(type, from: JSONSerialization.data(withJSONObject: object))
    }

    // MARK: Home

    func testHomeFreshStartsWithTheDiagnostic() throws {
        let home = try Self.decode(CSCAHome.self, "csca_home_fresh")
        XCTAssertEqual(home.track, "csca-math")
        XCTAssertEqual(home.topics.count, 28)
        XCTAssertEqual(home.lessons.count, 6)
        XCTAssertEqual(home.tests.map(\.kind), [.diagnostic, .mock])
        XCTAssertEqual(home.tests.first?.durationSeconds, 240)
        XCTAssertEqual(home.tests.first?.allowEarlyFinish, true)
        XCTAssertEqual(home.tests.last?.allowEarlyFinish, false)
        XCTAssertNil(home.targetSessionKey)
        XCTAssertNil(home.review.nextDueOn)
        guard case .test(let formId, let formKey) = home.nextStep else {
            return XCTFail("fresh student starts with the diagnostic")
        }
        XCTAssertEqual(formKey, "csca-math-diagnostic-1")
        XCTAssertEqual(home.test(kind: .diagnostic)?.formId, formId)
        XCTAssertTrue(home.topics.allSatisfy { $0.state == .notStarted })
        XCTAssertEqual(home.topics.filter(\.hasLessons).count, 3)
        XCTAssertEqual(home.modules.first?.metadata.sections.count, 4)
        XCTAssertEqual(home.sessions.count, 6)
        XCTAssertNil(home.sessions[1].registrationOpensAt)
    }

    func testHomeAfterPracticeHasLessonNextStepAndTarget() throws {
        let home = try Self.decode(CSCAHome.self, "csca_home_after")
        XCTAssertEqual(home.targetSessionKey, "2026-11")
        guard case .lesson(_, let key, let kind, let topic, let state) = home.nextStep else {
            return XCTFail("next step is a lesson after the diagnostic")
        }
        XCTAssertEqual(key, "csca-math-m2-exp-log-p1")
        XCTAssertEqual(kind, .practice)
        XCTAssertEqual(topic, "m2-exp-log")
        XCTAssertEqual(state, .gap)
        XCTAssertEqual(home.test(kind: .diagnostic)?.lastResult?.completion, .submitted)
        XCTAssertNotNil(home.test(kind: .mock)?.draft)
        XCTAssertEqual(home.review.nextDueOn, "2026-10-17")
        XCTAssertTrue(home.lessons(forTopic: "m2-exp-log").map(\.metadata.kind) == [.lesson, .practice])
    }

    func testHomeAfterMockTimeoutShowsResultNotDraft() throws {
        let home = try Self.decode(CSCAHome.self, "csca_home_after_mock")
        let mock = try XCTUnwrap(home.test(kind: .mock))
        XCTAssertNil(mock.draft, "an expired draft is finished by the server on read (contract §7.5)")
        XCTAssertEqual(mock.lastResult?.completion, .timeout)
    }

    func testHomeRequiresNullableKeys() throws {
        XCTAssertThrowsError(try Self.mutated(CSCAHome.self, "csca_home_fresh") { $0.removeValue(forKey: "nextStep") })
        XCTAssertThrowsError(try Self.mutated(CSCAHome.self, "csca_home_fresh") { $0.removeValue(forKey: "targetSessionKey") })
    }

    func testUnknownTopicStateFails() throws {
        XCTAssertThrowsError(try Self.mutated(CSCAHome.self, "csca_home_fresh") { object in
            var topics = object["topics"] as! [[String: Any]]
            topics[0]["state"] = "mastered"
            object["topics"] = topics
        })
    }

    // MARK: Lessons

    func testEveryLessonDecodesWithTypedTheory() throws {
        let names = [
            "csca_lesson_m2-exp-log-l1", "csca_lesson_m2-derivative-l1", "csca_lesson_m3-line-circle-l1",
            "csca_lesson_m2-exp-log-p1", "csca_lesson_m2-derivative-p1", "csca_lesson_m3-line-circle-p1",
        ]
        for name in names {
            let lesson = try Self.decode(CSCALessonResponse.self, name)
            XCTAssertEqual(lesson.module.track, "csca-math", name)
            XCTAssertNotNil(lesson.topic, name)
            XCTAssertFalse(lesson.lesson.exercises.isEmpty, name)
            if lesson.lesson.metadata.kind == .practice {
                XCTAssertTrue(lesson.lesson.theory.isEmpty, name)
            } else {
                XCTAssertTrue(lesson.lesson.theory.allSatisfy(\.isRenderable), name)
                XCTAssertGreaterThanOrEqual(lesson.lesson.theory.count, 10, name)
            }
            // Every figure the lesson needs came with it.
            for block in lesson.lesson.theory {
                if case .figure(let key, _) = block { XCTAssertNotNil(lesson.figures[key], "\(name) \(key)") }
            }
            for exercise in lesson.lesson.exercises {
                if let key = exercise.item.figureKey { XCTAssertNotNil(lesson.figures[key], "\(name) \(key)") }
            }
        }
    }

    func testLessonTheoryCoversEveryBlockKind() throws {
        var kinds = Set<String>()
        for name in ["csca_lesson_m2-exp-log-l1", "csca_lesson_m2-derivative-l1", "csca_lesson_m3-line-circle-l1"] {
            for block in try Self.decode(CSCALessonResponse.self, name).lesson.theory {
                switch block {
                case .idea: kinds.insert("idea")
                case .formula(let tex, _): kinds.insert("formula"); XCTAssertFalse(tex.isEmpty)
                case .figure: kinds.insert("figure")
                case .table(_, let header, let rows): kinds.insert("table"); XCTAssertTrue(rows.allSatisfy { $0.count == header.count })
                case .example(_, _, let steps, _): kinds.insert("example"); XCTAssertFalse(steps.isEmpty)
                case .pitfalls: kinds.insert("pitfalls")
                case .tip(let tip, _): kinds.insert("tip"); XCTAssertEqual(tip, "no_calculator")
                case .terms: kinds.insert("terms")
                case .interactive: kinds.insert("interactive")
                case .unknown: XCTFail("pilot has no unknown blocks")
                }
            }
        }
        XCTAssertEqual(kinds, ["idea", "formula", "figure", "table", "example", "pitfalls", "tip", "terms"])
    }

    func testUnknownTheoryBlockIsSkippedNotFatal() throws {
        let lesson = try Self.mutated(CSCALessonResponse.self, "csca_lesson_m2-exp-log-l1") { object in
            var content = object["lesson"] as! [String: Any]
            var theory = content["theory"] as! [Any]
            theory.append(["kind": "video", "url": "https://example.invalid"])
            content["theory"] = theory
            object["lesson"] = content
        }
        XCTAssertFalse(try XCTUnwrap(lesson.lesson.theory.last).isRenderable)
    }

    func testKnownTheoryBlockWithExtraKeyFails() throws {
        XCTAssertThrowsError(try Self.mutated(CSCALessonResponse.self, "csca_lesson_m2-exp-log-l1") { object in
            var content = object["lesson"] as! [String: Any]
            var theory = content["theory"] as! [[String: Any]]
            theory[0]["html"] = "<b>x</b>"
            content["theory"] = theory
            object["lesson"] = content
        })
    }

    /// The projection key set is closed (contract §5): a leaked key fails.
    func testItemProjectionWithAnswerKeyFails() throws {
        for leak in ["answerIndex", "explain", "solutionRu", "correctOptionId"] {
            XCTAssertThrowsError(try Self.mutated(CSCALessonResponse.self, "csca_lesson_m3-line-circle-l1") { object in
                var content = object["lesson"] as! [String: Any]
                var exercises = content["exercises"] as! [[String: Any]]
                exercises[0][leak] = 1
                content["exercises"] = exercises
                object["lesson"] = content
            }, leak)
        }
        XCTAssertThrowsError(try Self.mutated(CSCATestAttempt.self, "csca_test_start_mock") { object in
            var items = object["items"] as! [[String: Any]]
            items[0]["answerIndex"] = 2
            object["items"] = items
        })
    }

    func testLessonDraftCarriesExplainOnlyForAnswered() throws {
        let lesson = try Self.decode(CSCALessonResponse.self, "csca_lesson_with_draft")
        let draft = try XCTUnwrap(lesson.draft)
        XCTAssertEqual(draft.status, .draft)
        XCTAssertEqual(draft.answeredCount, 2)
        XCTAssertEqual(draft.records.count, 2)
        for record in draft.records.values {
            XCTAssertEqual(record.explain.options.map(\.id), ["a", "b", "c", "d"])
            XCTAssertEqual(record.explain.solutionRu.count, record.explain.solutionKy.count)
            XCTAssertEqual(record.correct, record.verdict.correct)
        }
    }

    func testLessonWritePathReceipts() throws {
        let start = try Self.decode(CSCALessonAttempt.self, "csca_lesson_start")
        XCTAssertEqual(start.status, .draft)
        XCTAssertTrue(start.answers.isEmpty)
        XCTAssertNil(start.result)
        for index in 1...4 {
            let receipt = try Self.decode(CSCALessonSaveReceipt.self, "csca_lesson_save_\(index)")
            XCTAssertEqual(receipt.attemptId, start.attemptId)
            XCTAssertEqual(receipt.answeredCount, index)
            XCTAssertEqual(receipt.correct, receipt.verdict.correct)
            XCTAssertTrue(CSCAItem.optionIds.contains(receipt.explain.correctOptionId))
            XCTAssertFalse(receipt.explain.terms.isEmpty)
        }
        let complete = try Self.decode(CSCALessonAttempt.self, "csca_lesson_complete")
        XCTAssertEqual(complete.status, .completed)
        XCTAssertEqual(complete.result?.exercisesTotal, 4)
        XCTAssertNotNil(complete.completedAt)
    }

    // MARK: Timed tests

    func testDiagnosticStartHasNoKeysAndServerClock() throws {
        let attempt = try Self.decode(CSCATestAttempt.self, "csca_test_start_diagnostic")
        XCTAssertEqual(attempt.status, .draft)
        XCTAssertNil(attempt.result)
        XCTAssertNil(attempt.review)
        XCTAssertEqual(attempt.graceSeconds, 15)
        XCTAssertEqual(attempt.items.count, attempt.itemsTotal)
        let started = try XCTUnwrap(CSCATime.date(from: attempt.startedAt))
        let deadline = try XCTUnwrap(CSCATime.date(from: attempt.deadlineAt))
        XCTAssertEqual(deadline.timeIntervalSince(started), TimeInterval(attempt.durationSeconds), accuracy: 0.001)
    }

    func testMockStartCarriesItsFigures() throws {
        let attempt = try Self.decode(CSCATestAttempt.self, "csca_test_start_mock")
        XCTAssertEqual(attempt.kind, .mock)
        XCTAssertFalse(attempt.allowEarlyFinish)
        let figureKeys = attempt.items.compactMap(\.figureKey)
        XCTAssertEqual(figureKeys.count, 3)
        for key in figureKeys { XCTAssertNotNil(attempt.figures[key]) }
    }

    func testSaveReceiptSaysNothingAboutCorrectness() throws {
        let receipt = try Self.decode(CSCATestSaveReceipt.self, "csca_test_save")
        XCTAssertEqual(receipt.revision, 2)
        XCTAssertEqual(receipt.answeredCount, 2)
        let keys = try XCTUnwrap(JSONSerialization.jsonObject(with: Self.fixture("csca_test_save")) as? [String: Any]).keys
        XCTAssertEqual(Set(keys), ["attemptId", "status", "revision", "answeredCount", "savedAt", "deadlineAt", "serverNow"])
    }

    func testCompletedDiagnosticHasResultAndReview() throws {
        let attempt = try Self.decode(CSCATestAttempt.self, "csca_test_complete_diagnostic")
        let result = try XCTUnwrap(attempt.result)
        XCTAssertEqual(result.completion, .submitted)
        XCTAssertEqual(result.itemsTotal, 3)
        XCTAssertEqual(result.answeredCount + result.unansweredCount, result.itemsTotal)
        XCTAssertEqual(result.pace.budgetSeconds, 75)
        XCTAssertEqual(result.unansweredItemKeys.count, 1)
        XCTAssertNil(result.perItem[result.unansweredItemKeys[0]]?.selected)
        let review = try XCTUnwrap(attempt.review)
        XCTAssertEqual(review.count, 3)
        XCTAssertTrue(review.contains { $0.flagged })
        XCTAssertNotNil(attempt.reviewEntry(for: result.unansweredItemKeys[0]))
    }

    func testMockFinishedByTheServerAsTimeout() throws {
        let attempt = try Self.decode(CSCATestAttempt.self, "csca_test_mock_timeout")
        XCTAssertEqual(attempt.status, .completed)
        XCTAssertEqual(attempt.completion, .timeout)
        XCTAssertEqual(attempt.result?.answeredCount, 2, "graded what was saved before the deadline")
    }

    func testReviewOnlyAfterCompletion() throws {
        XCTAssertThrowsError(try Self.mutated(CSCATestAttempt.self, "csca_test_complete_diagnostic") { object in
            object["status"] = "draft"
        })
        XCTAssertThrowsError(try Self.mutated(CSCATestAttempt.self, "csca_test_start_diagnostic") { object in
            object["review"] = [] as [Any]
        })
    }

    // MARK: Review, progress, report, target

    func testReviewResponses() throws {
        let empty = try Self.decode(CSCAReviewResponse.self, "csca_review_v2_not_due")
        XCTAssertTrue(empty.items.isEmpty)
        XCTAssertEqual(empty.nextDueOn, "2026-10-17")
        let due = try Self.decode(CSCAReviewResponse.self, "csca_review_v2_due")
        XCTAssertEqual(due.items.count, due.dueCount)
        XCTAssertTrue(due.items.allSatisfy { $0.box == 1 })
        for entry in due.items {
            if let key = entry.item.figureKey { XCTAssertNotNil(due.figures[key]) }
        }
        let wrong = try Self.decode(CSCAReviewReceipt.self, "csca_record_review_first")
        XCTAssertFalse(wrong.correct)
        XCTAssertEqual(wrong.box, 1)
        XCTAssertEqual(wrong.lapses, 1)
        let right = try Self.decode(CSCAReviewReceipt.self, "csca_record_review_correct")
        XCTAssertTrue(right.correct)
        XCTAssertEqual(right.box, 2)
        XCTAssertFalse(right.retired)
        XCTAssertEqual(CSCATime.daysBetween("2026-10-16", try XCTUnwrap(right.dueOn)), CSCAReviewBoxes.intervalDays(box: 2))
    }

    func testProgressAndStreak() throws {
        let progress = try Self.decode(CSCAProgress.self, "csca_progress_after_mock")
        XCTAssertEqual(progress.coverage.topicsTotal, 28)
        XCTAssertEqual(progress.coverage.topicsWithCompletedLesson, 1)
        XCTAssertEqual(progress.streak.timeZone, "Asia/Bishkek")
        XCTAssertGreaterThanOrEqual(progress.streak.current, 1)
        XCTAssertEqual(progress.tests.map(\.kind), [.mock, .diagnostic], "newest first")
        XCTAssertEqual(progress.tests.first?.completion, .timeout)
        XCTAssertEqual(progress.topics.count, 28)
    }

    func testReportAndTargetReceipts() throws {
        let report = try Self.decode(CSCAReportReceipt.self, "csca_report")
        XCTAssertFalse(report.itemKey.isEmpty)
        let target = try Self.decode(CSCATargetSessionReceipt.self, "csca_target_session")
        XCTAssertEqual(target.targetSessionKey, "2026-11")
    }

    func testModulesV2KeepsEnglishSeparate() throws {
        struct Modules: Decodable {
            struct Module: Decodable { let track: String; let moduleKey: String }
            let track: String
            let modules: [Module]
        }
        let csca = try Self.decode(Modules.self, "csca_modules_v2_csca")
        XCTAssertEqual(Set(csca.modules.map(\.track)), ["csca-math"])
        let english = try Self.decode(Modules.self, "csca_modules_v2_english")
        XCTAssertEqual(Set(english.modules.map(\.track)), ["english"])
    }
}
