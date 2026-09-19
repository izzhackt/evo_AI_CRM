import XCTest

/// Decoder tests against FIXED fixtures written by hand from the SQL return
/// shapes in supabase/migrations/135_platform_student_assessments.sql:
/// - `platform.student_assessments_v1()` (lines 288–317):
///   `{instruments:[…], attempts:[…]}`;
/// - `platform_private.student_assessment_attempt_payload` (lines 219–230),
///   returned by `student_assessment_attempt_v1` and every
///   start/save/complete receipt;
/// - `platform_private.student_assessment_public_questions` (lines 208–217):
///   `jsonb_strip_nulls` removes `topic`/`passage` when null;
/// - `platform_private.grade_student_assessment` (lines 250–286): the
///   `english`/`orvis` result snapshots (band basic|developing|strong, no
///   CEFR anywhere).
/// Values are synthetic; keys, nesting and null-ability follow the SQL.
final class AssessmentDecodingTests: XCTestCase {
    func testDecodesCatalog() throws {
        let fixture = """
        {
          "instruments": [
            {
              "instrumentKey": "english36",
              "versionId": "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2910",
              "version": "2026-06-v1",
              "locale": "ru",
              "metadata": {
                "title": "Английский: 36 заданий",
                "description": "Грамматика, слова в контексте и чтение.",
                "instructions": ["Отвечайте без словаря.", "Можно выбрать «Не знаю»."],
                "limitations": ["Это не сертификат уровня языка."],
                "bands": [
                  { "id": "basic", "label": "Базовая полоса" },
                  { "id": "developing", "label": "Развивающаяся полоса" },
                  { "id": "strong", "label": "Сильная полоса" }
                ],
                "recommendations": { "grammar": "Повторите времена." }
              },
              "questionCount": 36,
              "draftAttemptId": "a1b2c3d4-e5f6-4708-9a0b-c1d2e3f40516",
              "latestCompletedAttemptId": null
            },
            {
              "instrumentKey": "orvis92",
              "versionId": "0f1e2d3c-4b5a-4697-8879-a0b1c2d3e4f5",
              "version": "2026-06-v1",
              "locale": "ru",
              "metadata": {
                "title": "Карта интересов",
                "scales": [
                  { "id": "analysis", "label": "Анализ", "description": "Работа с данными и закономерностями." }
                ],
                "professionAttribution": "Адаптация EVO по O*NET®, CC BY 4.0."
              },
              "questionCount": 92,
              "draftAttemptId": null,
              "latestCompletedAttemptId": "b2c3d4e5-f6a7-4819-a0b1-c2d3e4f50617"
            }
          ],
          "attempts": [
            {
              "attemptId": "a1b2c3d4-e5f6-4708-9a0b-c1d2e3f40516",
              "instrumentKey": "english36",
              "version": "2026-06-v1",
              "status": "draft",
              "revision": 4,
              "answeredCount": 12,
              "questionCount": 36,
              "createdAt": "2026-09-18T09:00:00.5+00:00",
              "updatedAt": "2026-09-18T09:20:11.987654+00:00",
              "completedAt": null
            },
            {
              "attemptId": "b2c3d4e5-f6a7-4819-a0b1-c2d3e4f50617",
              "instrumentKey": "orvis92",
              "version": "2026-06-v1",
              "status": "completed",
              "revision": 9,
              "answeredCount": 92,
              "questionCount": 92,
              "createdAt": "2026-09-10T10:00:00+00:00",
              "updatedAt": "2026-09-10T11:00:00+00:00",
              "completedAt": "2026-09-10T11:00:00+00:00"
            }
          ]
        }
        """
        let catalog = try JSONDecoder().decode(
            AssessmentCatalog.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(catalog.instruments.count, 2)

        let english = catalog.instruments[0]
        XCTAssertEqual(english.instrumentKey, AssessmentInstrument.english)
        XCTAssertEqual(english.questionCount, 36)
        XCTAssertNotNil(english.draftAttemptId)
        XCTAssertNil(english.latestCompletedAttemptId)
        XCTAssertEqual(english.metadata.bands?.count, 3)
        XCTAssertEqual(english.metadata.bands?.first?.id, "basic")
        XCTAssertEqual(english.metadata.recommendations?["grammar"], "Повторите времена.")

        let orvis = catalog.instruments[1]
        XCTAssertNil(orvis.draftAttemptId)
        XCTAssertEqual(orvis.metadata.scales?.first?.id, "analysis")
        // Necessarily absent fields decode as nil, not as a failure.
        XCTAssertNil(orvis.metadata.instructions)

        XCTAssertEqual(catalog.attempts.count, 2)
        XCTAssertTrue(catalog.attempts[0].isDraft)
        XCTAssertEqual(catalog.attempts[0].revision, 4)
        XCTAssertNil(catalog.attempts[0].completedAt)
        XCTAssertFalse(catalog.attempts[1].isDraft)
    }

    func testDecodesDraftAttemptPayload() throws {
        let fixture = """
        {
          "attemptId": "a1b2c3d4-e5f6-4708-9a0b-c1d2e3f40516",
          "instrumentKey": "english36",
          "versionId": "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2910",
          "version": "2026-06-v1",
          "locale": "ru",
          "status": "draft",
          "revision": 4,
          "metadata": { "title": "Английский: 36 заданий" },
          "questions": [
            {
              "id": "q01",
              "prompt": "Choose the correct form: She ___ to school.",
              "topic": "grammar",
              "options": [
                { "id": "a", "label": "go" },
                { "id": "b", "label": "goes" },
                { "id": "unknown", "label": "Не знаю" }
              ]
            },
            {
              "id": "q02",
              "prompt": "What does the text say about the library?",
              "topic": "reading",
              "passage": "The library opens at nine and closes at five.",
              "options": [
                { "id": "a", "label": "It opens at nine." },
                { "id": "b", "label": "It never closes." },
                { "id": "unknown", "label": "Не знаю" }
              ]
            }
          ],
          "answers": { "q01": "b" },
          "result": null,
          "createdAt": "2026-09-18T09:00:00.5+00:00",
          "updatedAt": "2026-09-18T09:20:11.987654+00:00",
          "completedAt": null
        }
        """
        let attempt = try JSONDecoder().decode(
            AssessmentAttempt.self,
            from: Data(fixture.utf8)
        )
        XCTAssertTrue(attempt.isDraft)
        XCTAssertNil(attempt.result)
        XCTAssertEqual(attempt.questions.count, 2)
        // jsonb_strip_nulls: q01 carries no `passage` key at all.
        XCTAssertNil(attempt.questions[0].passage)
        XCTAssertEqual(attempt.questions[1].passage, "The library opens at nine and closes at five.")
        XCTAssertEqual(attempt.answers, ["q01": "b"])
        XCTAssertEqual(attempt.questions[0].options.count, 3)
        XCTAssertEqual(attempt.questions[0].options[2].id, "unknown")
    }

    func testDecodesCompletedEnglishResult() throws {
        // grade_student_assessment line 257 always echoes `p_version.metadata`
        // into the result; this fixture already carried it, but nothing
        // asserted on it before AssessmentResult gained a `metadata` field.
        let fixture = """
        {
          "attemptId": "c3d4e5f6-a7b8-4920-b1c2-d3e4f5061728",
          "instrumentKey": "english36",
          "versionId": "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2910",
          "version": "2026-06-v1",
          "locale": "ru",
          "status": "completed",
          "revision": 12,
          "metadata": {
            "title": "Английский: 36 заданий",
            "bands": [ { "id": "developing", "label": "Развивающаяся полоса" } ]
          },
          "questions": [
            {
              "id": "q01",
              "prompt": "Choose the correct form: She ___ to school.",
              "topic": "grammar",
              "options": [
                { "id": "a", "label": "go" },
                { "id": "b", "label": "goes" },
                { "id": "unknown", "label": "Не знаю" }
              ]
            }
          ],
          "answers": { "q01": "b" },
          "result": {
            "instrumentKey": "english36",
            "version": "2026-06-v1",
            "metadata": { "title": "Английский: 36 заданий" },
            "answeredCount": 36,
            "questionCount": 36,
            "completedAt": "2026-09-19T10:23:54.123456+00:00",
            "english": {
              "correctCount": 21,
              "totalCount": 36,
              "band": "developing",
              "topics": [
                { "topic": "grammar", "correctCount": 8, "totalCount": 14 },
                { "topic": "reading", "correctCount": 6, "totalCount": 10 },
                { "topic": "vocabulary", "correctCount": 7, "totalCount": 12 }
              ],
              "feedback": [
                {
                  "questionId": "q01",
                  "selectedOptionId": "b",
                  "correctOptionId": "b",
                  "correct": true,
                  "explanation": "Третье лицо единственного числа: goes.",
                  "topic": "grammar"
                }
              ]
            }
          },
          "createdAt": "2026-09-19T09:00:00+00:00",
          "updatedAt": "2026-09-19T10:23:54.123456+00:00",
          "completedAt": "2026-09-19T10:23:54.123456+00:00"
        }
        """
        let attempt = try JSONDecoder().decode(
            AssessmentAttempt.self,
            from: Data(fixture.utf8)
        )
        XCTAssertTrue(attempt.isCompleted)
        let result = try XCTUnwrap(attempt.result)
        let english = try XCTUnwrap(result.english)
        XCTAssertEqual(english.correctCount, 21)
        XCTAssertEqual(english.band, "developing")
        XCTAssertEqual(english.topics.count, 3)
        XCTAssertEqual(english.topics[0].topic, "grammar")
        XCTAssertEqual(english.feedback.first?.correct, true)
        XCTAssertNil(result.orvis)
        XCTAssertEqual(
            attempt.metadata.bands?.first(where: { $0.id == english.band })?.label,
            "Развивающаяся полоса"
        )
        XCTAssertEqual(result.metadata.title, "Английский: 36 заданий")
    }

    func testDecodesOrvisResultSnapshot() throws {
        // grade_student_assessment lines 276–285: mean = round(raw/count, 4).
        // Line 257: `result := jsonb_build_object(..., 'metadata', p_version.metadata, ...)`
        // — grading always echoes the instrument's own version metadata back
        // into the result snapshot, so the fixture carries it too (matching
        // the SQL contract, not just the narrower Swift model it once had).
        let fixture = """
        {
          "instrumentKey": "orvis92",
          "version": "2026-06-v1",
          "metadata": {
            "title": "Карта интересов",
            "scales": [
              { "id": "analysis", "label": "Анализ", "description": "Работа с данными и закономерностями." },
              { "id": "creativity", "label": "Креативность", "description": "Генерация новых идей и решений." }
            ],
            "professionAttribution": "Адаптация EVO по O*NET®, CC BY 4.0."
          },
          "answeredCount": 92,
          "questionCount": 92,
          "completedAt": "2026-09-10T11:00:00+00:00",
          "orvis": {
            "scales": [
              { "scale": "analysis", "rawSum": 42, "itemCount": 10, "mean": 4.2 },
              { "scale": "creativity", "rawSum": 49, "itemCount": 14, "mean": 3.5 }
            ],
            "topScales": ["analysis"]
          }
        }
        """
        let result = try JSONDecoder().decode(
            AssessmentResult.self,
            from: Data(fixture.utf8)
        )
        let orvis = try XCTUnwrap(result.orvis)
        XCTAssertEqual(orvis.scales.count, 2)
        XCTAssertEqual(orvis.scales[0].mean, 4.2, accuracy: 0.0001)
        XCTAssertEqual(orvis.topScales, ["analysis"])
        XCTAssertNil(result.english)
        XCTAssertEqual(result.metadata.title, "Карта интересов")
        XCTAssertEqual(result.metadata.scales?.count, 2)
    }
}

final class PostgresTimestampTests: XCTestCase {
    func testParsesMicrosecondFraction() throws {
        let date = try XCTUnwrap(
            PostgresTimestamp.date(from: "2026-09-19T10:23:54.123456+00:00")
        )
        XCTAssertEqual(
            date,
            ISO8601DateFormatter().date(from: "2026-09-19T10:23:54Z")
        )
    }

    func testParsesWithoutFractionAndWithZulu() {
        XCTAssertNotNil(PostgresTimestamp.date(from: "2026-09-19T10:23:54+00:00"))
        XCTAssertNotNil(PostgresTimestamp.date(from: "2026-09-19T10:23:54Z"))
        XCTAssertNotNil(PostgresTimestamp.date(from: "2026-09-18T09:00:00.5+00:00"))
    }

    func testRejectsGarbageInsteadOfFabricatingADate() {
        XCTAssertNil(PostgresTimestamp.date(from: "не дата"))
        XCTAssertNil(PostgresTimestamp.date(from: ""))
    }

    func testCatalogDateLabels() {
        XCTAssertNotNil(CatalogDate.dayLabel(from: "2026-09-01", locale: Locale(identifier: "ru")))
        XCTAssertNotNil(CatalogDate.monthLabel(from: "2027-01", locale: Locale(identifier: "ky")))
        XCTAssertNil(CatalogDate.dayLabel(from: "2026-13-40", locale: Locale(identifier: "ru")))
    }
}
