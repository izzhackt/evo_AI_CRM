import XCTest

/// Decoder/encoder tests for the runner slice of
/// `supabase/migrations/198_platform_learning_engine.sql`, against fixtures
/// hand-written from the SQL return shapes (content values in the style of
/// the 199 seed):
/// - save receipt — 198:819-825 `{attemptId, revision, exerciseId, correct,
///   verdict, explain, answeredCount, exercisesTotal}`
/// - verdicts — choice 198:634-635, matching 198:655-659 (perPair в порядке
///   lefts), short 198:671-672, reading 198:692-693 (perQuestion by id)
/// - explains — choice 198:569-577, matching 198:578-586 (пары в ИСХОДНОМ
///   порядке), short 198:587-590 (`answer` = accepted->0), reading 198:591-604
/// - attempt payload `answers` — stored `{answer, correct, verdict,
///   answeredAt}` (198:810-814) merged with `explain` (198:708-713)
/// - review — items 198:992-1000, check 198:1027-1031
/// - outgoing answer payloads — the exact single-key objects the grader
///   validates: choice 198:625-633, matching 198:638-648, short 198:661-665,
///   reading 198:674-681.
final class LearningRunnerDecodingTests: XCTestCase {
    func testDecodesChoiceSaveReceipt() throws {
        let fixture = """
        {
          "attemptId": "5c3a7d18-9e2f-4b6a-8d01-234567890abc",
          "revision": 2,
          "exerciseId": "dd76de91-f1c5-52a5-8828-7dce1fe9c98c",
          "correct": false,
          "verdict": { "correct": false },
          "explain": {
            "correctOptionId": "b",
            "options": [
              { "id": "a", "explainRu": "Good morning — только утро.", "explainKy": "Good morning — эртең менен гана." },
              { "id": "b", "explainRu": "Hello подходит в любое время.", "explainKy": "Hello каалаган убакта айтылат." }
            ]
          },
          "answeredCount": 1,
          "exercisesTotal": 8
        }
        """
        let receipt = try JSONDecoder().decode(
            LearningSaveReceipt.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(receipt.revision, 2)
        XCTAssertFalse(receipt.correct)
        XCTAssertFalse(receipt.verdict.correct)
        XCTAssertNil(receipt.verdict.perPair)
        XCTAssertEqual(receipt.explain.correctOptionId, "b")
        XCTAssertEqual(receipt.explain.options?.count, 2)
        XCTAssertEqual(receipt.explain.options?[1].explainKy, "Hello каалаган убакта айтылат.")
        XCTAssertEqual(receipt.answeredCount, 1)
        XCTAssertEqual(receipt.exercisesTotal, 8)
    }

    func testDecodesMatchingSaveReceipt() throws {
        // perPair — в порядке lefts (198:650-654), пары разбора — в исходном
        // (правильном) порядке (198:578-586).
        let fixture = """
        {
          "attemptId": "5c3a7d18-9e2f-4b6a-8d01-234567890abc",
          "revision": 3,
          "exerciseId": "07f3a07d-f993-5ded-8a0e-857ba655eaa8",
          "correct": false,
          "verdict": {
            "correct": false,
            "perPair": [true, false, false],
            "correctCount": 1,
            "total": 3
          },
          "explain": {
            "pairs": [
              { "leftEn": "Hello", "rightRu": "Здравствуйте", "rightKy": "Саламатсызбы" },
              { "leftEn": "Good morning", "rightRu": "Доброе утро", "rightKy": "Кутман таң" },
              { "leftEn": "Good night", "rightRu": "Спокойной ночи", "rightKy": "Жакшы жат" }
            ],
            "explainRu": "Сопоставьте приветствия со временем суток.",
            "explainKy": "Саламдашууларды убакытка дал келтириңиз."
          },
          "answeredCount": 4,
          "exercisesTotal": 8
        }
        """
        let receipt = try JSONDecoder().decode(
            LearningSaveReceipt.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(receipt.verdict.perPair, [true, false, false])
        XCTAssertEqual(receipt.verdict.correctCount, 1)
        XCTAssertEqual(receipt.verdict.total, 3)
        XCTAssertEqual(receipt.explain.pairs?.count, 3)
        XCTAssertEqual(receipt.explain.pairs?[0].leftEn, "Hello")
        XCTAssertEqual(receipt.explain.explainRu, "Сопоставьте приветствия со временем суток.")
    }

    func testDecodesShortAnswerSaveReceipt() throws {
        // `answer` — ПЕРВЫЙ принятый вариант (accepted->0, 198:587-590);
        // сами принятые варианты клиенту не выдаются никогда.
        let fixture = """
        {
          "attemptId": "5c3a7d18-9e2f-4b6a-8d01-234567890abc",
          "revision": 4,
          "exerciseId": "9fec39a7-df20-5158-8ace-b520381045c2",
          "correct": true,
          "verdict": { "correct": true },
          "explain": {
            "answer": "My name is Aidana.",
            "explainRu": "Представление: My name is + имя.",
            "explainKy": "Таанышуу: My name is + аты."
          },
          "answeredCount": 5,
          "exercisesTotal": 8
        }
        """
        let receipt = try JSONDecoder().decode(
            LearningSaveReceipt.self,
            from: Data(fixture.utf8)
        )
        XCTAssertTrue(receipt.correct)
        XCTAssertEqual(receipt.explain.answer, "My name is Aidana.")
        XCTAssertNil(receipt.explain.correctOptionId)
        XCTAssertNil(receipt.explain.pairs)
    }

    func testDecodesReadingSaveReceipt() throws {
        // perQuestion — карта по id вопроса (198:685-693).
        let fixture = """
        {
          "attemptId": "5c3a7d18-9e2f-4b6a-8d01-234567890abc",
          "revision": 5,
          "exerciseId": "4a1a1c2e-8b3d-4f5a-9c6d-7e8f90a1b2c3",
          "correct": false,
          "verdict": {
            "correct": false,
            "perQuestion": { "q1": true, "q2": false }
          },
          "explain": {
            "questions": [
              {
                "id": "q1",
                "correctOptionId": "a",
                "options": [
                  { "id": "a", "explainRu": "Имя названо в первой фразе.", "explainKy": "Аты биринчи сүйлөмдө айтылган." },
                  { "id": "b", "explainRu": "Нурлан в тексте не упоминается.", "explainKy": "Нурлан текстте айтылган эмес." }
                ]
              },
              {
                "id": "q2",
                "correctOptionId": "b",
                "options": [
                  { "id": "a", "explainRu": "Неверно.", "explainKy": "Туура эмес." },
                  { "id": "b", "explainRu": "Верно.", "explainKy": "Туура." }
                ]
              }
            ]
          },
          "answeredCount": 8,
          "exercisesTotal": 8
        }
        """
        let receipt = try JSONDecoder().decode(
            LearningSaveReceipt.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(receipt.verdict.perQuestion?["q1"], true)
        XCTAssertEqual(receipt.verdict.perQuestion?["q2"], false)
        XCTAssertEqual(receipt.explain.questions?.count, 2)
        XCTAssertEqual(receipt.explain.questions?[1].correctOptionId, "b")
    }

    func testDecodesAttemptPayloadWithAllStoredAnswerShapes() throws {
        // attempt payload (198:701-722): stored `{answer, correct, verdict,
        // answeredAt}` (198:810-814) + merged `explain` (198:708-713) —
        // все четыре формы сохранённого ответа декодируются.
        let fixture = """
        {
          "attemptId": "5c3a7d18-9e2f-4b6a-8d01-234567890abc",
          "lessonId": "87c8be87-fcc1-5480-8de4-1b5731a87de0",
          "status": "draft",
          "revision": 5,
          "answers": {
            "dd76de91-f1c5-52a5-8828-7dce1fe9c98c": {
              "answer": { "selected": "b" },
              "correct": true,
              "verdict": { "correct": true },
              "answeredAt": "2026-09-19T10:00:00+00:00",
              "explain": { "correctOptionId": "b", "options": [] }
            },
            "07f3a07d-f993-5ded-8a0e-857ba655eaa8": {
              "answer": { "matches": [2, 0, 1] },
              "correct": false,
              "verdict": { "correct": false, "perPair": [false, true, true], "correctCount": 2, "total": 3 },
              "answeredAt": "2026-09-19T10:01:00+00:00",
              "explain": { "pairs": [], "explainRu": "Разбор.", "explainKy": "Талдоо." }
            },
            "9fec39a7-df20-5158-8ace-b520381045c2": {
              "answer": { "text": "my name is aidana" },
              "correct": true,
              "verdict": { "correct": true },
              "answeredAt": "2026-09-19T10:02:00+00:00",
              "explain": { "answer": "My name is Aidana.", "explainRu": "Разбор.", "explainKy": "Талдоо." }
            },
            "4a1a1c2e-8b3d-4f5a-9c6d-7e8f90a1b2c3": {
              "answer": { "selected": { "q1": "a", "q2": "b" } },
              "correct": true,
              "verdict": { "correct": true, "perQuestion": { "q1": true, "q2": true } },
              "answeredAt": "2026-09-19T10:03:00+00:00",
              "explain": { "questions": [] }
            }
          },
          "answeredCount": 4,
          "exercisesTotal": 8,
          "result": null,
          "createdAt": "2026-09-19T09:58:00+00:00",
          "updatedAt": "2026-09-19T10:03:00+00:00",
          "completedAt": null
        }
        """
        let payload = try JSONDecoder().decode(
            LearningAttemptSnapshot.self,
            from: Data(fixture.utf8)
        )
        XCTAssertTrue(payload.isDraft)
        XCTAssertEqual(payload.answers.count, 4)

        let choice = payload.record(for: UUID(uuidString: "dd76de91-f1c5-52a5-8828-7dce1fe9c98c")!)
        XCTAssertEqual(choice?.answer, .choice(selected: "b"))

        let matching = payload.record(for: UUID(uuidString: "07f3a07d-f993-5ded-8a0e-857ba655eaa8")!)
        XCTAssertEqual(matching?.answer, .matching(matches: [2, 0, 1]))
        XCTAssertEqual(matching?.verdict.perPair, [false, true, true])

        let short = payload.record(for: UUID(uuidString: "9fec39a7-df20-5158-8ace-b520381045c2")!)
        XCTAssertEqual(short?.answer, .shortAnswer(text: "my name is aidana"))

        let reading = payload.record(for: UUID(uuidString: "4a1a1c2e-8b3d-4f5a-9c6d-7e8f90a1b2c3")!)
        XCTAssertEqual(reading?.answer, .reading(selected: ["q1": "a", "q2": "b"]))
    }

    func testEncodesAnswerPayloadsExactly() throws {
        // Исходящие payload'ы — ровно одноключевые объекты грейдера:
        // choice 198:625-633, matching 198:638-648, short 198:661-665,
        // reading 198:674-681. Лишний ключ — 22023 на сервере.
        func jsonObject(_ answer: LearningAnswer) throws -> NSDictionary {
            let data = try JSONEncoder().encode(answer)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
        }
        XCTAssertEqual(
            try jsonObject(.choice(selected: "b")),
            ["selected": "b"]
        )
        XCTAssertEqual(
            try jsonObject(.matching(matches: [2, 0, 1])),
            ["matches": [2, 0, 1]]
        )
        XCTAssertEqual(
            try jsonObject(.shortAnswer(text: "My name is Aidana.")),
            ["text": "My name is Aidana."]
        )
        XCTAssertEqual(
            try jsonObject(.reading(selected: ["q1": "a"])),
            ["selected": ["q1": "a"]]
        )
    }

    func testDecodesReviewItemsAndCheck() throws {
        // learning_review_v1 (198:992-1001): проекция упражнения ПЛЮС
        // {lessonId, lessonKey, lessonOrderIndex} в одном плоском объекте.
        let itemsFixture = """
        {
          "items": [
            {
              "exerciseId": "07f3a07d-f993-5ded-8a0e-857ba655eaa8",
              "exerciseKey": "en-m1-l01-e04",
              "orderIndex": 4,
              "type": "matching",
              "instructionRu": "Соедините фразу с переводом.",
              "instructionKy": "Фразаны котормосу менен дал келтириңиз.",
              "lefts": ["Hello", "Good morning", "Good night"],
              "rights": [
                { "rightRu": "Спокойной ночи", "rightKy": "Жакшы жат" },
                { "rightRu": "Здравствуйте", "rightKy": "Саламатсызбы" },
                { "rightRu": "Доброе утро", "rightKy": "Кутман таң" }
              ],
              "lessonId": "87c8be87-fcc1-5480-8de4-1b5731a87de0",
              "lessonKey": "en-m1-l01",
              "lessonOrderIndex": 1
            }
          ]
        }
        """
        let review = try JSONDecoder().decode(
            LearningReviewResponse.self,
            from: Data(itemsFixture.utf8)
        )
        XCTAssertEqual(review.items.count, 1)
        XCTAssertEqual(review.items[0].exercise.type, "matching")
        XCTAssertEqual(review.items[0].exercise.lefts?.count, 3)
        XCTAssertEqual(review.items[0].lessonKey, "en-m1-l01")
        XCTAssertEqual(review.items[0].lessonOrderIndex, 1)

        // learning_review_check_v1 (198:1027-1031) — stateless-проверка.
        let checkFixture = """
        {
          "exerciseId": "07f3a07d-f993-5ded-8a0e-857ba655eaa8",
          "correct": true,
          "verdict": { "correct": true, "perPair": [true, true, true], "correctCount": 3, "total": 3 },
          "explain": {
            "pairs": [
              { "leftEn": "Hello", "rightRu": "Здравствуйте", "rightKy": "Саламатсызбы" }
            ],
            "explainRu": "Разбор.",
            "explainKy": "Талдоо."
          }
        }
        """
        let check = try JSONDecoder().decode(
            LearningReviewCheck.self,
            from: Data(checkFixture.utf8)
        )
        XCTAssertTrue(check.correct)
        XCTAssertEqual(check.verdict.correctCount, 3)
        XCTAssertEqual(check.explain.pairs?.count, 1)
    }

    func testDecodesEmptyReview() throws {
        // 198:992-997: COALESCE(…, '[]') — пустой банк ошибок это [].
        let review = try JSONDecoder().decode(
            LearningReviewResponse.self,
            from: Data(#"{"items": []}"#.utf8)
        )
        XCTAssertTrue(review.items.isEmpty)
    }
}
