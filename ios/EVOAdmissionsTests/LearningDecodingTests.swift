import XCTest

/// Decoder tests against fixtures hand-written from the SQL return shapes of
/// `supabase/migrations/198_platform_learning_engine.sql` (READ surface), with
/// content values shaped like the real v1 seed of migration 199:
/// - `learning_modules_v1` — 198:885-921 (module rows with lesson summaries;
///   metadata validated by 198:202-203 module / 198:215-216 lesson)
/// - `result_snapshot` — 198:845-850 `{exercisesTotal, correctCount,
///   correctShare, wrongExerciseIds, completedAt}`
/// - `learning_lesson_v1` — 198:945-958 `{module, lesson, draft,
///   latestCompleted}`; theory blocks per validator 198:221-234
/// - `learning_exercise_public` — 198:519-561 (allowlist projection; answer
///   keys and explains NEVER appear)
/// - attempt payload — 198:701-722 (the `answers` map decodes through the
///   runner-slice types; see LearningRunnerDecodingTests for its shapes).
final class LearningDecodingTests: XCTestCase {
    func testDecodesModuleMapWithProgress() throws {
        // Module/lesson keys and titles mirror the 199 seed
        // (199:23-24 module en-m1-start, 199:26-27 lesson en-m1-l01).
        let fixture = """
        {
          "modules": [
            {
              "moduleId": "de7d4fe3-38b1-5971-858e-b03f71f9f2b2",
              "moduleKey": "en-m1-start",
              "version": "1.0.0",
              "metadata": {
                "title_ru": "Английский. Модуль 1 — старт",
                "title_ky": "Англис тили. 1-модуль — старт",
                "level_note_ru": "Для тех, кто начинает с нуля.",
                "level_note_ky": "Нөлдөн баштагандар үчүн."
              },
              "lessonsTotal": 12,
              "lessonsCompleted": 1,
              "lessons": [
                {
                  "lessonId": "87c8be87-fcc1-5480-8de4-1b5731a87de0",
                  "lessonKey": "en-m1-l01",
                  "orderIndex": 1,
                  "metadata": {
                    "title_ru": "Приветствие и знакомство",
                    "title_ky": "Саламдашуу жана таанышуу",
                    "goal_ru": "Поздороваться по-английски.",
                    "goal_ky": "Англисче саламдашасың."
                  },
                  "exercisesTotal": 8,
                  "completed": true,
                  "draftAttemptId": null,
                  "lastResult": {
                    "exercisesTotal": 8,
                    "correctCount": 6,
                    "correctShare": 0.75,
                    "wrongExerciseIds": [
                      "dd76de91-f1c5-52a5-8828-7dce1fe9c98c",
                      "07f3a07d-f993-5ded-8a0e-857ba655eaa8"
                    ],
                    "completedAt": "2026-09-18T15:04:05.123456+00:00"
                  }
                },
                {
                  "lessonId": "030eb00c-c994-5867-831d-b92931fdc2af",
                  "lessonKey": "en-m1-l02",
                  "orderIndex": 2,
                  "metadata": {
                    "title_ru": "Алфавит, звуки и spelling имени",
                    "title_ky": "Алфавит, тыбыштар жана атты тамгалап айтуу",
                    "goal_ru": "Называть буквы алфавита.",
                    "goal_ky": "Алфавиттин тамгаларын атайсың."
                  },
                  "exercisesTotal": 8,
                  "completed": false,
                  "draftAttemptId": "5c3a7d18-9e2f-4b6a-8d01-234567890abc",
                  "lastResult": null
                }
              ]
            }
          ]
        }
        """
        let response = try JSONDecoder().decode(
            LearningModulesResponse.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(response.modules.count, 1)
        let module = response.modules[0]
        XCTAssertEqual(module.moduleKey, "en-m1-start")
        XCTAssertEqual(module.metadata.titleKy, "Англис тили. 1-модуль — старт")
        XCTAssertEqual(module.lessonsTotal, 12)
        XCTAssertEqual(module.lessonsCompleted, 1)

        let completed = module.lessons[0]
        XCTAssertTrue(completed.completed)
        XCTAssertNil(completed.draftAttemptId)
        XCTAssertEqual(completed.lastResult?.correctCount, 6)
        XCTAssertEqual(completed.lastResult?.correctShare ?? 0, 0.75, accuracy: 0.0001)
        XCTAssertEqual(completed.lastResult?.wrongExerciseIds.count, 2)

        let draft = module.lessons[1]
        XCTAssertFalse(draft.completed)
        XCTAssertEqual(
            draft.draftAttemptId,
            UUID(uuidString: "5c3a7d18-9e2f-4b6a-8d01-234567890abc")
        )
        XCTAssertNil(draft.lastResult)
    }

    func testDecodesEmptyModules() throws {
        // 198:885/918: COALESCE(…, '[]') — no published content is an empty
        // array, and the screen shows its honest empty state.
        let response = try JSONDecoder().decode(
            LearningModulesResponse.self,
            from: Data(#"{"modules": []}"#.utf8)
        )
        XCTAssertTrue(response.modules.isEmpty)
    }

    func testDecodesLessonWithAllExerciseTypesAndAttempts() throws {
        // learning_lesson_v1 (198:945-958). Exercises follow the public
        // projection 198:519-561 for each of the 4 types (CHECK 198:58-59);
        // values mirror the 199 seed of lesson en-m1-l01 (199:29-45).
        let fixture = """
        {
          "module": {
            "moduleId": "de7d4fe3-38b1-5971-858e-b03f71f9f2b2",
            "moduleKey": "en-m1-start",
            "version": "1.0.0",
            "metadata": {
              "title_ru": "Английский. Модуль 1 — старт",
              "title_ky": "Англис тили. 1-модуль — старт",
              "level_note_ru": "Для тех, кто начинает с нуля.",
              "level_note_ky": "Нөлдөн баштагандар үчүн."
            }
          },
          "lesson": {
            "lessonId": "87c8be87-fcc1-5480-8de4-1b5731a87de0",
            "lessonKey": "en-m1-l01",
            "orderIndex": 1,
            "metadata": {
              "title_ru": "Приветствие и знакомство",
              "title_ky": "Саламдашуу жана таанышуу",
              "goal_ru": "Поздороваться по-английски.",
              "goal_ky": "Англисче саламдашасың."
            },
            "theory": [
              {
                "text_ru": "Hello — приветствие на любое время суток.",
                "text_ky": "Hello — каалаган убакта айтылуучу саламдашуу.",
                "examples": [
                  { "en": "Hello!", "ru": "Здравствуйте!", "ky": "Саламатсызбы!" },
                  { "en": "Good morning!", "ru": "Доброе утро!", "ky": "Кутман таң!" }
                ]
              }
            ],
            "exercises": [
              {
                "exerciseId": "dd76de91-f1c5-52a5-8828-7dce1fe9c98c",
                "exerciseKey": "en-m1-l01-e01",
                "orderIndex": 1,
                "type": "choice",
                "promptRu": "Выберите приветствие на любое время суток.",
                "promptKy": "Каалаган убакка туура келген саламдашууну тандаңыз.",
                "options": [
                  { "id": "a", "label": "Good morning" },
                  { "id": "b", "label": "Hello" }
                ]
              },
              {
                "exerciseId": "018fed91-abcf-53f6-86aa-f32c455ace26",
                "exerciseKey": "en-m1-l01-e03",
                "orderIndex": 3,
                "type": "choice",
                "promptRu": "Что означает фраза Nice to meet you?",
                "promptKy": "Nice to meet you эмнени билдирет?",
                "options": [
                  { "id": "a", "labelRu": "Приятно познакомиться", "labelKy": "Таанышканыма кубанычтамын" },
                  { "id": "b", "labelRu": "Как дела?", "labelKy": "Кандайсың?" }
                ]
              },
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
                ]
              },
              {
                "exerciseId": "9fec39a7-df20-5158-8ace-b520381045c2",
                "exerciseKey": "en-m1-l01-e06",
                "orderIndex": 6,
                "type": "short_answer",
                "promptRu": "Напишите по-английски: «Меня зовут Айдана».",
                "promptKy": "Англисче жазыңыз: «Менин атым Айдана»."
              },
              {
                "exerciseId": "4a1a1c2e-8b3d-4f5a-9c6d-7e8f90a1b2c3",
                "exerciseKey": "en-m1-l01-e09",
                "orderIndex": 9,
                "type": "reading",
                "sourceLesson": 1,
                "passageEn": "Hi! My name is Aidana. Nice to meet you.",
                "questions": [
                  {
                    "id": "q1",
                    "promptEn": "What is the girl's name?",
                    "options": [
                      { "id": "a", "label": "Aidana" },
                      { "id": "b", "label": "Nurlan" }
                    ]
                  }
                ]
              }
            ]
          },
          "draft": {
            "attemptId": "5c3a7d18-9e2f-4b6a-8d01-234567890abc",
            "lessonId": "87c8be87-fcc1-5480-8de4-1b5731a87de0",
            "status": "draft",
            "revision": 3,
            "answers": {
              "dd76de91-f1c5-52a5-8828-7dce1fe9c98c": {
                "answer": { "selected": "b" },
                "correct": true,
                "verdict": { "correct": true },
                "answeredAt": "2026-09-19T10:00:00+00:00",
                "explain": {
                  "correctOptionId": "b",
                  "options": [
                    { "id": "a", "explainRu": "Неверно.", "explainKy": "Туура эмес." },
                    { "id": "b", "explainRu": "Верно.", "explainKy": "Туура." }
                  ]
                }
              }
            },
            "answeredCount": 1,
            "exercisesTotal": 5,
            "result": null,
            "createdAt": "2026-09-19T09:58:00+00:00",
            "updatedAt": "2026-09-19T10:00:00+00:00",
            "completedAt": null
          },
          "latestCompleted": {
            "attemptId": "d15c1c4a-7b8e-4f90-a1b2-c3d4e5f60718",
            "lessonId": "87c8be87-fcc1-5480-8de4-1b5731a87de0",
            "status": "completed",
            "revision": 7,
            "answers": {},
            "answeredCount": 5,
            "exercisesTotal": 5,
            "result": {
              "exercisesTotal": 5,
              "correctCount": 4,
              "correctShare": 0.8,
              "wrongExerciseIds": ["07f3a07d-f993-5ded-8a0e-857ba655eaa8"],
              "completedAt": "2026-09-18T15:04:05+00:00"
            },
            "createdAt": "2026-09-18T14:00:00+00:00",
            "updatedAt": "2026-09-18T15:04:05+00:00",
            "completedAt": "2026-09-18T15:04:05+00:00"
          }
        }
        """
        let response = try JSONDecoder().decode(
            LearningLessonResponse.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(response.module.moduleKey, "en-m1-start")
        XCTAssertEqual(response.lesson.theory.count, 1)
        XCTAssertEqual(response.lesson.theory[0].examples.count, 2)
        XCTAssertEqual(response.lesson.theory[0].examples[0].en, "Hello!")

        let exercises = response.lesson.exercises
        XCTAssertEqual(exercises.count, 5)

        // choice, английские варианты через label (198:533-537).
        XCTAssertEqual(exercises[0].type, "choice")
        XCTAssertEqual(exercises[0].options?.count, 2)
        XCTAssertEqual(exercises[0].options?[1].label, "Hello")
        XCTAssertNil(exercises[0].options?[1].labelRu)
        XCTAssertNil(exercises[0].promptEn)

        // choice, RU/KY-пары вариантов.
        XCTAssertEqual(exercises[1].options?[0].labelRu, "Приятно познакомиться")
        XCTAssertEqual(exercises[1].options?[0].labelKy, "Таанышканыма кубанычтамын")
        XCTAssertNil(exercises[1].options?[0].label)

        // matching: lefts в исходном порядке, rights — в выданном
        // (hash-shuffled) порядке 198:544-547; соответствий здесь НЕТ.
        XCTAssertEqual(exercises[2].type, "matching")
        XCTAssertEqual(exercises[2].lefts?.count, 3)
        XCTAssertEqual(exercises[2].rights?.count, 3)
        XCTAssertEqual(exercises[2].instructionRu, "Соедините фразу с переводом.")

        // short_answer: без extras (198:548) — и, главное, без ключей ответа.
        XCTAssertEqual(exercises[3].type, "short_answer")
        XCTAssertNil(exercises[3].options)
        XCTAssertNil(exercises[3].passageEn)

        // reading: passage + вопросы с вариантами.
        XCTAssertEqual(exercises[4].type, "reading")
        XCTAssertEqual(exercises[4].sourceLesson, 1)
        XCTAssertEqual(exercises[4].questions?.count, 1)
        XCTAssertEqual(exercises[4].questions?[0].promptEn, "What is the girl's name?")

        // Попытки: черновик без result, завершённая с result_snapshot.
        XCTAssertEqual(response.draft?.status, "draft")
        XCTAssertEqual(response.draft?.revision, 3)
        XCTAssertEqual(response.draft?.answeredCount, 1)
        XCTAssertNil(response.draft?.result)
        XCTAssertEqual(response.latestCompleted?.status, "completed")
        XCTAssertEqual(response.latestCompleted?.result?.correctCount, 4)
        XCTAssertEqual(response.latestCompleted?.result?.wrongExerciseIds.count, 1)
    }

    func testDecodesLessonWithoutAttempts() throws {
        // draft/latestCompleted — NULL, когда попыток нет (198:954-957).
        let fixture = """
        {
          "module": {
            "moduleId": "de7d4fe3-38b1-5971-858e-b03f71f9f2b2",
            "moduleKey": "en-m1-start",
            "version": "1.0.0",
            "metadata": {
              "title_ru": "Английский. Модуль 1 — старт",
              "title_ky": "Англис тили. 1-модуль — старт",
              "level_note_ru": "Для тех, кто начинает с нуля.",
              "level_note_ky": "Нөлдөн баштагандар үчүн."
            }
          },
          "lesson": {
            "lessonId": "030eb00c-c994-5867-831d-b92931fdc2af",
            "lessonKey": "en-m1-l02",
            "orderIndex": 2,
            "metadata": {
              "title_ru": "Алфавит, звуки и spelling имени",
              "title_ky": "Алфавит, тыбыштар жана атты тамгалап айтуу",
              "goal_ru": "Называть буквы алфавита.",
              "goal_ky": "Алфавиттин тамгаларын атайсың."
            },
            "theory": [
              {
                "text_ru": "В английском алфавите 26 букв.",
                "text_ky": "Англис алфавитинде 26 тамга бар.",
                "examples": [
                  { "en": "A, B, C", "ru": "эй, би, си", "ky": "эй, би, си" }
                ]
              }
            ],
            "exercises": []
          },
          "draft": null,
          "latestCompleted": null
        }
        """
        let response = try JSONDecoder().decode(
            LearningLessonResponse.self,
            from: Data(fixture.utf8)
        )
        XCTAssertNil(response.draft)
        XCTAssertNil(response.latestCompleted)
        XCTAssertTrue(response.lesson.exercises.isEmpty)
    }
}
