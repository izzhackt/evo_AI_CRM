# Подготовка к CSCA: контракт RPC и контента (миграции 285, 286)

Статус: S5.1 ядро, 16.10.2026. Источник решений: план
`docs/EVO_STUDENT_APP_V2_PLAN_2026-10-16.md` §9 и запись `docs/PLAN_CHANGES.md`
«2026-10-16 · Подготовка к CSCA, S5.1 ядро». SQL:
`supabase/migrations/285_platform_csca_learning_engine.sql` (движок),
`supabase/migrations/286_platform_csca_math_part1.sql` (контент, генерируется из
`docs/design/portal/content/csca`). Веб (`/portal/csca/*`) и iPhone читают одни и
те же RPC и получают один и тот же JSON; этот документ обязателен для обоих
отрисовщиков.

## 1. Общие правила

- Все RPC в схеме `platform`: `client.schema("platform").rpc(name, args)` на вебе,
  `.schema("platform").rpc(...)` в supabase-swift. Вызывать может только вошедший
  ученик с `portal.read.self` (тот же guard, что у «Английского», без привязки к
  делу). Сотрудники (Admin, Sales, Curator), чужой ученик, `anon` и
  `service_role` получают `42501`. Исключение: `staff_learning_item_reports_v1`
  только для Admin.
- Трек `p_track` для CSCA: `csca-math` (сейчас), позже `csca-physics`,
  `csca-chemistry`. Неизвестный трек: `22023`. Трек без опубликованного
  контента отдаёт пустые списки, а не ошибку.
- Все ответы JSON-объекты, ключи в camelCase. Поля метаданных контента
  (`metadata`, блоки теории) приходят в snake_case, как в источнике.
- Время: все `…At` в ISO 8601 с часовым поясом, все `…On` и `today` это даты
  Бишкека (UTC+6). Серия дней и сроки повторения считаются по Бишкеку.
- Записи идемпотентны по `p_request_id` (UUID, новый на каждое действие
  пользователя, тот же при повторе после сетевой ошибки). Повтор с тем же
  `p_request_id` и теми же аргументами возвращает ту же квитанцию; с другими
  аргументами `22023`.
- Прогресс, попытки и ответы видит только сам ученик; в журнал действий CRM
  ничего не пишется.
- Итог теста в интерфейсе называется «оценка EVO по нашим заданиям». Никогда
  не «балл CSCA», не шкала 0..100, не перцентиль, не «проходной балл», не
  пороги вида «80+». Никаких обещаний по конкретной сессии.

### 1.1. Ошибки

| SQLSTATE (`error.code`) | `error.message` | Когда | Что делает клиент |
|---|---|---|---|
| `42501` | `Learning is unavailable` | не ученик, нет доступа, чужая попытка, задание не из своего банка повторения | экран «Нет доступа», без повторов |
| `22023` | `Invalid learning track` / `Invalid learning request` / `Invalid item answer` / `Invalid learning test state` / `Invalid learning report` | неверные аргументы | баг клиента, не показывать пользователю как его ошибку |
| `22023` | `Learning request was already used` | тот же `p_request_id` с другими аргументами | новый `p_request_id` |
| `22023` | `Learning exercise is already answered` | второй ответ на упражнение урока (ответ финален) | перечитать урок |
| `22023` | `learning_test_deadline_passed` | сохранение теста позже `deadlineAt + 15 с` | вызвать `complete_learning_test_v1` или перечитать попытку |
| `22023` | `learning_test_completed` | сохранение уже завершённого теста | перечитать попытку, показать итог |
| `22023` | `learning_test_early_finish_forbidden` | завершение пробного теста до срока | не показывать кнопку «Завершить» у `mock` |
| `22023` | `learning_review_not_due` | ответ на задание повторения, срок которого не наступил | перечитать `learning_review_v2` |
| `22023` | `learning_report_limit` | больше 20 сообщений об ошибке за сутки | «Попробуйте завтра» |
| `22023` | `Invalid learning session` | неизвестная сессия в `set_learning_target_session_v1` | баг клиента |
| `40001` | `Learning attempt changed` | `p_expected_revision` устарел | перечитать и повторить |

## 2. Список RPC

| RPC | Аргументы | Пишет | Что отдаёт |
|---|---|---|---|
| `learning_track_home_v1` | `p_track` | завершает просроченные тесты | главная трека, §3 |
| `learning_modules_v2` | `p_track` (`english` или CSCA) | нет | карта модулей трека, §4 |
| `learning_lesson_v2` | `p_lesson_id` | нет | урок с блоками, упражнениями и рисунками, §5 |
| `start_learning_lesson_v1`, `save_learning_answer_v1`, `complete_learning_lesson_v1` | как в 198 | да | запись урока и практики, §6 |
| `start_learning_test_v1` | `p_form_id`, `p_request_id` | да | попытка теста, §7 |
| `learning_test_attempt_v1` | `p_attempt_id` | завершает просроченные тесты | попытка теста, §7 |
| `save_learning_test_v1` | `p_attempt_id`, `p_expected_revision`, `p_answers`, `p_flags`, `p_item_seconds`, `p_request_id` | да | квитанция сохранения, §7.3 |
| `complete_learning_test_v1` | `p_attempt_id`, `p_expected_revision`, `p_request_id` | да | попытка с итогом и разбором, §7.4 |
| `learning_review_v2` | `p_track` | нет | задания к повторению сегодня, §8 |
| `record_learning_review_v1` | `p_track`, `p_item_key`, `p_answer`, `p_request_id` | да | вердикт, разбор, новый ящик, §8 |
| `learning_track_progress_v1` | `p_track` | завершает просроченные тесты | прогресс, §9 |
| `report_learning_item_v1` | `p_track`, `p_item_key`, `p_message`, `p_request_id` | да | квитанция, §10 |
| `staff_learning_item_reports_v1` | `p_track`, `p_limit` (1..200, по умолчанию 100) | нет | сообщения для Admin без автора, §10 |
| `set_learning_target_session_v1` | `p_track`, `p_session_key` (или `null`) | да | выбранная сессия, §11 |

Все функции, которые пишут или завершают просроченные тесты, VOLATILE:
supabase-js и supabase-swift вызывают их через POST (поведение `rpc()` по
умолчанию). Прежние RPC обучения (`learning_modules_v1`, `learning_lesson_v1`,
`learning_review_v1`, `learning_review_check_v1`) не меняют форму ответа;
`learning_modules_v1` отдаёт только английский, поэтому старые сборки iPhone
CSCA не видят.

## 3. `learning_track_home_v1(p_track)`

Один вызов на экран «Подготовка к CSCA». Сначала сервер завершает просроченные
тесты ученика (§7.5).

```jsonc
{
  "track": "csca-math",
  "serverNow": "2026-10-16T10:36:49.712211+00:00",
  "today": "2026-10-16",
  "modules": [{
    "moduleId": "a7bd0cdc-929a-50b1-8cdc-ed3374d8c730",
    "moduleKey": "csca-math",
    "version": "1.0.0",
    "metadata": {
      "title_ru": "Математика", "title_ky": "Математика",
      "level_note_ru": "Задания на английском, как на экзамене. …", "level_note_ky": "…",
      "syllabus_edition": "2025",
      "syllabus_url": "https://csca.cn/about/testprep",
      "sections": [{
        "section": 1, "title_ru": "Множества и неравенства", "title_ky": "…", "title_en": "Sets and Inequalities",
        "mock_items_estimate": 7,
        "points": [{ "point": "1.1", "label_ru": "…", "label_ky": "…", "label_en": "Sets" }]
      }]
    }
  }],
  "topics": [{
    "moduleId": "a7bd0cdc-…", "topicKey": "m2-exp-log", "orderIndex": 10,
    "metadata": {
      "title_ru": "Показательная и логарифмическая функции", "title_ky": "…", "title_en": "…",
      "section": 2, "syllabus_point": "2.2", "syllabus_fit": "explicit",
      "mock_items_estimate": 3, "likely_gap": false, "prerequisites": ["m2-func-basics"], "lessons_planned": 2
    },
    "state": "shaky",            // not_started | few_data | gap | shaky | confident (§12)
    "windowAnswers": 4, "windowCorrect": 3,
    "lessonCompleted": true,      // пройден хотя бы один урок темы (kind = lesson)
    "hasLessons": true            // в текущем выпуске у темы есть уроки
  }],
  "lessons": [{
    "moduleId": "a7bd0cdc-…", "lessonId": "6a568c67-44e7-56dd-8ba5-c1b77305daba",
    "lessonKey": "csca-math-m2-exp-log-l1", "orderIndex": 1,
    "metadata": {
      "title_ru": "…", "title_ky": "…", "title_en": "Exponential and logarithmic functions",
      "goal_ru": "…", "goal_ky": "…", "topic_key": "m2-exp-log",
      "kind": "lesson",           // lesson | practice
      "est_minutes": 15, "syllabus_point": "2.2"
    },
    "exercisesTotal": 4,
    "completed": false,           // по ключу урока: новый выпуск не обнуляет
    "draftAttemptId": null,
    "lastResult": null            // result_snapshot урока 198: exercisesTotal, correctCount, correctShare, …
  }],
  "tests": [{
    "moduleId": "a7bd0cdc-…", "formId": "1d2696aa-39b5-5b89-8f3e-e645a1b61dc2",
    "formKey": "csca-math-diagnostic-1",
    "kind": "diagnostic",          // diagnostic | mock (сначала diagnostic)
    "metadata": { "title_ru": "Диагностика", "title_ky": "Диагностика", "intro_ru": "3 задания, 4 минуты. …", "intro_ky": "…" },
    "durationSeconds": 240, "allowEarlyFinish": true, "itemsTotal": 3,
    "draft": null,                 // или { attemptId, revision, startedAt, deadlineAt, answeredCount }
    "lastResult": {                // последняя завершённая попытка этой формы (по form_key) или null
      "attemptId": "3220b018-…", "completedAt": "2026-10-16T10:36:49.73102+00:00",
      "completion": "submitted", "itemsTotal": 3, "answeredCount": 2, "correctCount": 1, "correctShare": 0.3333
    }
  }],
  "review": { "dueCount": 0, "activeCount": 2, "nextDueOn": "2026-10-17" },
  "sessions": [{                   // официальный календарь, только сессии, которые ещё не закончились
    "sessionKey": "2026-12", "examFrom": "2026-12-19", "examTo": "2026-12-20",
    "registrationOpensAt": null, "registrationClosesAt": null,   // null: csca.cn окно ещё не опубликовал
    "sourceUrl": "https://csca.cn/about/examintro", "verifiedOn": "2026-10-16"
  }],
  "targetSessionKey": "2026-12",   // или null
  "nextStep": { "kind": "lesson", "lessonId": "22f0395c-…", "lessonKey": "csca-math-m2-exp-log-p1",
    "lessonKind": "practice", "topicKey": "m2-exp-log", "topicState": "gap" }
}
```

`nextStep` один из: `{"kind": "test", "formId", "formKey"}` (диагностика ещё
не пройдена), `{"kind": "lesson", …}` (как выше), `{"kind": "review"}` (есть
задания к повторению), `null`. Правило выбора в §12.

Окно регистрации показывается как факт с датой проверки и ссылкой на
`sourceUrl`; приложение не напоминает о конкретной сессии и ничего не обещает.

## 4. `learning_modules_v2(p_track)`

Форма `learning_modules_v1` плюс поле `track` у ответа и у каждого модуля:
`{"track", "modules": [{"moduleId", "moduleKey", "version", "track", "metadata",
"lessonsTotal", "lessonsCompleted", "lessons": [{"lessonId", "lessonKey",
"orderIndex", "metadata", "exercisesTotal", "completed", "draftAttemptId",
"lastResult"}]}]}`. `p_track` принимает и `english`.

## 5. `learning_lesson_v2(p_lesson_id)`

```jsonc
{
  "module": { "moduleId": "a7bd0cdc-…", "moduleKey": "csca-math", "version": "1.0.0", "track": "csca-math", "metadata": { … } },
  "topic": { "topicKey": "m2-exp-log", "orderIndex": 10, "metadata": { … } },   // null у английского
  "lesson": {
    "lessonId": "6a568c67-…", "lessonKey": "csca-math-m2-exp-log-l1", "orderIndex": 1,
    "metadata": { "kind": "lesson", … },
    "theory": [ { "kind": "idea", "ru": "…", "ky": "…" }, … ],   // блоки §13; у practice пусто
    "exercises": [{
      "exerciseId": "7b0e4dda-5cdb-5a7f-870c-74e3f9655d33",
      "exerciseKey": "csca-math-exp-log-001",
      "orderIndex": 1,
      "type": "item",
      "itemKey": "csca-math-exp-log-001",
      "topicKey": "m2-exp-log", "syllabusPoint": "2.2",
      "difficulty": 1,              // 1..3
      "estSeconds": 45,
      "figureKey": "item-exp-graph", // только если у задания есть рисунок
      "stemEn": "Find the value of $\\log_2 8 + \\log_2 4$.",
      "options": [ { "id": "a", "label": "$6$" }, { "id": "b", "label": "$5$" }, { "id": "c", "label": "$\\log_2 12$" }, { "id": "d", "label": "$32$" } ]
    }]
  },
  "figures": {                       // только рисунки этого урока и его заданий
    "exp-base": { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" …</svg>", "viewBox": "0 0 400 300",
      "altRu": "…", "altKy": "…", "altEn": "…", "sha256": "8758f1ad…" }
  },
  "draft": null,                     // learning_attempt_payload 198 или null
  "latestCompleted": null
}
```

Ключ ответа, разборы и решение до ответа не приходят никогда. Набор ключей
проекции задания закрытый (выше); новый ключ появится только с новой версией
RPC.

## 6. Урок и практика: запись через RPC 198

Без изменений формы: `start_learning_lesson_v1(p_lesson_id, p_request_id)`,
`save_learning_answer_v1(p_attempt_id, p_expected_revision, p_exercise_id,
p_answer, p_request_id)`, `complete_learning_lesson_v1(p_attempt_id,
p_expected_revision, p_request_id)`. Для упражнения `item` ответ ровно
`{"selected": "a"}` (`a`..`d`). Ответ финален: показать вердикт и разбор сразу.

```jsonc
// save_learning_answer_v1 для item
{
  "attemptId": "b9818834-…", "revision": 2, "exerciseId": "7b0e4dda-…",
  "correct": false, "verdict": { "correct": false },
  "explain": {
    "correctOptionId": "b",
    "options": [ { "id": "a", "explainRu": "Неверно: …", "explainKy": "Туура эмес: …" }, … ],  // все 4 варианта
    "solutionRu": ["$2^3 = 8$, значит $\\log_2 8 = 3$.", …],
    "solutionKy": ["…", …],                                   // столько же шагов, сколько RU
    "terms": [ { "en": "logarithm", "ru": "логарифм", "ky": "логарифм" }, … ]
  },
  "answeredCount": 1, "exercisesTotal": 4
}
```

Каждый ответ на задание CSCA попадает в журнал ответов; неверный кладёт задание
в банк повторения (ящик 1, срок завтра по Бишкеку). «Урок пройден» = отвечено
каждое упражнение (правило 198).

Разбор показывается по шагам: «Следующий шаг» открывает следующую строку
`solutionRu`/`solutionKy`, «Показать решение» открывает всё сразу.

## 7. Тест на время

### 7.1. Старт и чтение

`start_learning_test_v1(p_form_id, p_request_id)` создаёт черновик или
возвращает уже открытый для этой формы. `learning_test_attempt_v1(p_attempt_id)`
отдаёт ту же форму ответа. Повтор старта с тем же `p_request_id` возвращает
ту же попытку со свежим `serverNow`.

```jsonc
{
  "attemptId": "3220b018-35f1-4940-8c37-b4a7042665b9",
  "formId": "1d2696aa-…", "formKey": "csca-math-diagnostic-1",
  "kind": "diagnostic", "track": "csca-math",
  "metadata": { "title_ru": "Диагностика", "title_ky": "…", "intro_ru": "…", "intro_ky": "…" },
  "durationSeconds": 240, "allowEarlyFinish": true, "graceSeconds": 15,
  "status": "draft",                 // draft | completed
  "revision": 1,
  "startedAt": "2026-10-16T10:36:49.71152+00:00",
  "deadlineAt": "2026-10-16T10:40:49.71152+00:00",
  "serverNow": "2026-10-16T10:36:49.712211+00:00",
  "itemsTotal": 3, "answeredCount": 0,
  "answers": {},                     // { itemKey: "a".."d" }
  "flags": [],                       // [itemKey] «Вернуться позже»
  "itemSeconds": {},                 // { itemKey: секунды }, подсказка темпа
  "items": [ /* проекции заданий, как в §5, без exerciseId/exerciseKey/orderIndex/type, в порядке формы */ ],
  "figures": {},                     // рисунки заданий формы, как в §5
  "completion": null, "completedAt": null,
  "result": null,                    // после завершения §7.4
  "review": null                     // после завершения §7.4
}
```

### 7.2. Часы

Клиент считает поправку `offset = serverNow - времяКлиентаПриПолученииОтвета` и
показывает «Осталось mm:ss» до `deadlineAt` по своим часам с этой поправкой.
Срок держит сервер: клиентский таймер только отображение.

### 7.3. `save_learning_test_v1`

Заменяет состояние целиком: `p_answers` (объект `{itemKey: "a".."d"}`, только
задания формы), `p_flags` (массив ключей без повторов), `p_item_seconds`
(`{itemKey: 0..3600}`), не больше 32 КБ вместе. Принимается до
`deadlineAt + 15 с`. Сохранять пачкой раз в 10 с, при переходе между
заданиями не чаще раза в 2 с и при уходе в фон; запросы последовательно, с
актуальной `revision`.

```json
{
  "attemptId": "3220b018-…", "status": "draft", "revision": 2, "answeredCount": 2,
  "savedAt": "2026-10-16T10:36:49.721995+00:00",
  "deadlineAt": "2026-10-16T10:40:49.71152+00:00",
  "serverNow": "2026-10-16T10:36:49.721995+00:00"
}
```

Ответ ничего не говорит о правильности. `40001` при устаревшей `revision`,
`learning_test_deadline_passed` после срока.

### 7.4. `complete_learning_test_v1`

- Диагностика (`allowEarlyFinish = true`) завершается в любой момент:
  `completion = "submitted"`; после `deadlineAt` будет `"timeout"`.
- Пробный тест (`kind = "mock"`, `allowEarlyFinish = false`) до `deadlineAt`
  отвечает `learning_test_early_finish_forbidden`. Кнопки «Завершить» у него
  нет; когда время вышло, клиент сам вызывает завершение, `completion =
  "timeout"`.
- До `deadlineAt + 15 с` нужна актуальная `p_expected_revision`, позже
  оценивается то, что сохранено.
- Завершение идемпотентно: повтор и новый запрос на завершённую попытку
  отдают тот же итог.

После завершения в ответе появляются `result` и `review`:

```jsonc
"result": {
  "itemsTotal": 3, "answeredCount": 2, "correctCount": 1, "unansweredCount": 1, "correctShare": 0.3333,
  "byTopic": [ { "topicKey": "m2-exp-log", "total": 1, "answered": 1, "correct": 0 }, … ],
  "bySection": [ { "section": 2, "total": 2, "answered": 2, "correct": 1 }, … ],
  "pace": { "answeredWithTime": 2, "avgSeconds": 52, "budgetSeconds": 75 },
  "perItem": { "csca-math-exp-log-007": { "selected": "a", "correct": false }, "csca-math-line-circle-007": { "selected": null, "correct": false } },
  "wrongItemKeys": ["csca-math-exp-log-007"],
  "unansweredItemKeys": ["csca-math-line-circle-007"],
  "completion": "submitted",
  "completedAt": "2026-10-16T10:36:49.73102+00:00"
},
"review": [{
  "itemKey": "csca-math-exp-log-007", "selected": "a", "correct": false, "seconds": 41, "flagged": false,
  "explain": { "correctOptionId": "d", "options": [ … ], "solutionRu": [ … ], "solutionKy": [ … ], "terms": [ … ] }
}]
```

Подпись итога: «Это оценка EVO по нашим заданиям, а не балл CSCA» (KY: «Бул
биздин тапшырмалар боюнча EVO берген баа, CSCA баллы эмес»). Темп сравнивается
с 75 с на задание. Неверные ответы уходят в банк повторения; неотвеченные нет.

### 7.5. Автозавершение

Черновик, у которого прошло `deadlineAt + 15 с`, сервер завершает сам при
первом чтении (`learning_track_home_v1`, `learning_test_attempt_v1`,
`learning_track_progress_v1`, `start_learning_test_v1`): `completion =
"timeout"`, оценивается сохранённое до срока. Крона нет. Если ученик ушёл и
вернулся, главная покажет итог в `lastResult`, а не черновик.

## 8. Повторение с интервалами

`learning_review_v2(p_track)`: до 20 заданий своего банка со сроком сегодня
или раньше.

```jsonc
{
  "track": "csca-math", "today": "2026-10-16",
  "items": [{ "itemKey": "csca-math-exp-log-001", "box": 1, "dueOn": "2026-10-16", "lapses": 0,
    "item": { /* проекция задания, §5 */ } }],
  "figures": {},
  "dueCount": 1, "activeCount": 2, "nextDueOn": "2026-10-17"
}
```

`record_learning_review_v1(p_track, p_item_key, p_answer, p_request_id)`,
`p_answer = {"selected": "a"}`. Только задание своего банка (иначе `42501`) со
сроком не позже сегодня (иначе `learning_review_not_due`).

```json
{
  "itemKey": "csca-math-exp-log-001", "correct": true, "verdict": { "correct": true },
  "explain": { "correctOptionId": "b", "options": [], "solutionRu": [], "solutionKy": [], "terms": [] },
  "box": 2, "dueOn": "2026-10-19", "retired": false, "lapses": 0
}
```

Ящики: 1 → 1 день, 2 → 3 дня, 3 → 7 дней, 4 → 14 дней. Верно: ящик + 1 со
сроком по новому ящику; верно в ящике 4: задание выбывает (`retired = true`,
`dueOn = null`). Неверно: ящик 1 на завтра, `lapses + 1`.

## 9. `learning_track_progress_v1(p_track)`

```jsonc
{
  "track": "csca-math", "today": "2026-10-16",
  "coverage": { "topicsTotal": 28, "topicsWithCompletedLesson": 1 },
  "topics": [ { "topicKey": "m1-sets", "orderIndex": 1, "section": 1, "state": "not_started",
    "windowAnswers": 0, "windowCorrect": 0, "answersTotal": 0, "correctTotal": 0, "lessonCompleted": false } ],
  "tests": [ { "attemptId": "…", "formKey": "csca-math-diagnostic-1", "kind": "diagnostic", "completion": "submitted",
    "completedAt": "…", "itemsTotal": 3, "answeredCount": 2, "correctCount": 1, "correctShare": 0.3333, "avgSeconds": 52 } ],
  "pace": { "answeredWithTime": 2, "avgSeconds": 52, "budgetSeconds": 75 },
  "streak": { "current": 1, "best": 1, "lastActiveOn": "2026-10-16", "timeZone": "Asia/Bishkek" },
  "review": { "dueCount": 0, "activeCount": 2, "retiredCount": 0 }
}
```

`tests` до 20 последних, новые первыми. Серия: дни подряд по Бишкеку хотя бы с
одним завершённым уроком, тестом или ответом в повторении; серия жива, если
последний такой день сегодня или вчера.

## 10. «Сообщить об ошибке»

`report_learning_item_v1(p_track, p_item_key, p_message, p_request_id)`: текст
1..500 символов после обрезки пробелов, без управляющих символов (перевод
строки можно), не больше 20 сообщений за сутки. Ответ:
`{"reportId", "itemKey", "createdAt"}`.

`staff_learning_item_reports_v1(p_track, p_limit)` (только Admin):
`{"track", "reports": [{"reportId", "track", "itemKey", "topicKey",
"moduleVersion", "stemEn", "message", "createdAt"}]}`. Автора нет ни в одном
поле.

## 11. Целевая сессия

`set_learning_target_session_v1(p_track, p_session_key)`: `p_session_key` из
`sessions[].sessionKey` или `null` (сбросить). Ответ
`{"track", "targetSessionKey", "updatedAt"}`; главная отдаёт его в
`targetSessionKey`. Обратный отсчёт и три этапа (основа, слабые места и задания
на время, полные пробные тесты) считает клиент от `examFrom`.

## 12. Состояние темы и «Следующий шаг»

Окно: последние 6 проверенных ответов по теме из урока, практики, теста и
повторения.

| `state` | RU | KY | Условие |
|---|---|---|---|
| `not_started` | «Не начато» | «Башталган жок» | ответов нет и урок темы не открывали |
| `few_data` | «Мало данных» | «Маалымат аз» | меньше 3 ответов |
| `gap` | «Пробел» | «Боштук» | верных меньше 50 % |
| `shaky` | «Шатко» | «Туруксуз» | верных от 50 до 79 % |
| `confident` | «Уверенно» | «Ишенимдүү» | верных от 80 % |

«Следующий шаг»: 1) диагностика, пока ни одна не завершена; 2) тема `gap`,
`few_data` или `not_started`, у которой есть уроки и пройдены предпосылки
(предпосылка без уроков или со статусом `shaky`/`confident` не мешает), с
наибольшим `mock_items_estimate`, при равенстве меньший `orderIndex`; внутри
темы первый непройденный урок, затем непройденная практика, затем практика
заново; 3) первая тема `shaky`; 4) `review`, если есть задания на сегодня.

## 13. Блоки теории

Каждый блок объект с `kind`; набор ключей закрытый. Тексты `ru`/`ky`
объясняют, `*_en` и `stem_en` на английском, как на экзамене.

| `kind` | Поля | Отрисовка |
|---|---|---|
| `idea` | `ru`, `ky` | абзац; английский термин в скобках |
| `formula` | `tex[]` (1..6), `note_ru`, `note_ky` | каждая строка `tex` отдельной формулой (display), затем пояснение |
| `figure` | `figure_key`, `caption_ru`, `caption_ky` | рисунок из `figures[figure_key]` рядом с идеей, подпись |
| `table` | `caption_ru`, `caption_ky`, `header[]` (2..6), `rows[][]` (1..20, ширина как у `header`) | ячейка `{"tex"}` формула, `{"ru","ky"}` текст |
| `example` | `title_ru`, `title_ky`, `stem_en`, `steps[{ru, ky}]`, `answer_ru`, `answer_ky` | разбор по шагам: «Следующий шаг», «Показать решение» |
| `pitfalls` | `items[{ru, ky}]` | список типичных ошибок |
| `tip` | `tip` (`no_calculator`), `ru`, `ky` | плашка «Без калькулятора» |
| `terms` | `terms[{en, ru, ky}]` (позже ещё `zh`, `pinyin`) | глоссарий урока |
| `interactive` | `widget`, `params`, `figure_key`, `caption_ru`, `caption_ky` | виджет из закрытого реестра (`number-line`, `graph-transform`, `unit-circle`, `secant-tangent`, `conic-sections`, `vectors`, `complex-plane`, `normal-distribution`); отрисовщик без виджета показывает `figure_key` |

Неизвестный `kind` отрисовщик пропускает молча (будущие версии), но текущий
контент таких не содержит.

## 14. Формулы: подмножество TeX

- Формулы только внутри `$…$` в любом текстовом поле и целиком в `tex[]`
  блока `formula` и ячейках `{"tex"}`. Знак `$` всегда разделитель; валюты в
  тексте нет. Число `$` в строке чётное.
- Разрешённые команды: `\frac \sqrt \log \ln \sin \cos \tan \lim \to \infty
  \in \mathbb \cdot \times \leq \geq \ne \pm \Rightarrow \Leftrightarrow \left
  \right \quad \Delta \parallel \perp \pi \alpha \beta \theta \mu \sigma
  \omega \varphi \approx \circ \ldots \cap \cup \subseteq \emptyset \notin`,
  экранирование `\{ \}`, символы `^ _ { } | '` и обычные цифры, латиница,
  `+ - = < > ( ) [ ] , . / !`. Пишем `\leq`, `\geq`, не `\le`, `\ge`. Нет
  `\text`, `\dfrac`, окружений `\begin`, цвета, кириллицы внутри формулы.
- Генератор проверяет каждый фрагмент белым списком и разбором KaTeX
  0.19.0 (`strict: "error"`); новые команды добавляются только вместе с
  проверкой в SwiftMath.
- Веб: KaTeX (MIT), `output: "htmlAndMathml"` (экранные читалки получают
  MathML), шрифты KaTeX из пакета, без CDN, только на маршрутах
  `/portal/csca`. Встроенная формула внутри текста, `tex[]` в режиме display.
- iPhone: SwiftMath (MIT) через `UIViewRepresentable`; строка режется по `$`,
  текст обычным `Text`, формулы отдельными метками; размер по Dynamic Type.
  VoiceOver: метка из TeX простыми правилами (`\frac{a}{b}` «a over b», `^2`
  «squared», `\log_a` «log base a»).

## 15. Рисунки: профиль SVG

- Элементы только `svg title rect line circle path polygon text tspan`.
  Атрибуты: `xmlns viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points
  dx dy transform fill stroke stroke-width stroke-dasharray stroke-linecap
  stroke-linejoin opacity fill-opacity stroke-opacity font-family font-size
  font-style font-weight text-anchor dominant-baseline`, значения в двойных
  кавычках.
- Нет `style`, `script`, `foreignObject`, `image`, ссылок (`href`), `url(`,
  `data:`, обработчиков `on*`, DTD и инструкций (`<!`, `<?`); сущности только
  `&amp; &lt; &gt; &quot; &apos;` и числовые. До 24 КБ, один корень `<svg>`,
  `viewBox="0 0 W H"`, W 360..450, H 100..600.
- Цвета (`fill`, `stroke` и любой `#rrggbb`) только из палитры, плюс
  `fill="none"`. Шрифт текста не меньше 12 единиц (11 только у tspan
  индексов и степеней), переменные курсивом, минус в видимом тексте U+2212.
- Контрольная сумма: `sha256` = SHA-256 строки `svg` в UTF-8 (база проверяет
  при вставке; клиент может кэшировать по ней).
- Тёмная тема: отрисовщик заменяет шесть цветов один к одному, одинаково на
  вебе и iPhone:

| Роль | Светлая (в данных) | Тёмная |
|---|---|---|
| paper | `#ffffff` | `#1e1c19` |
| ink | `#191714` | `#f2efe9` |
| muted | `#6b6660` | `#a39d94` |
| grid | `#e4dfd7` | `#2c2925` |
| accent | `#d70217` | `#ff4a57` |
| ok | `#177245` | `#4cc38a` |

- Веб: `<img src="data:image/svg+xml,…" alt="…">` (скрипты в таком контексте
  не выполняются), `alt` из `altRu`/`altKy` по языку интерфейса.
- iPhone: `WKWebView` без JavaScript, `nonPersistent` хранилище,
  `loadHTMLString` с CSP `default-src 'none'; img-src data:`, прозрачный фон,
  без касаний, высота по `viewBox`, `accessibilityLabel` из alt. Запасной путь
  после спайка: PDF рисунка от генератора и отрисовка `CGPDFDocument`.
- У заданий на рисунке (`figureKey`) alt содержит всё, что нужно для ответа.

## 16. Контент и версии

- Источник: `docs/design/portal/content/csca/` (JSON и SVG в Git), генератор
  `scripts/portal/generate-csca-content-seed.mjs` (`--check`, `--write`),
  миграция контента только INSERT. Правка опубликованного = новая версия
  модуля и новая миграция.
- Выпуск = строка модуля трека (`moduleKey`, `version`); темы, рисунки,
  задания, уроки, формы привязаны к нему. Ключи тем, заданий, уроков и форм
  стабильны между выпусками; прогресс, журнал, повторение и «пройдено» идут
  по ключам.
- Все задания свои (`provenance = evo_authored`), условия на английском, 4
  варианта, один верный, разбор каждого варианта на RU и KY, без калькулятора.
  Пулы `lesson`, `practice`, `diagnostic`, `mock` не пересекаются.
- Кыргызский текст ждёт вычитки носителем (`ky_review: pending` в источнике).

## 17. Веб-отрисовщик

Экраны `/portal/csca/*` (S5.1, тот же PR): парсеры и помощники
`src/lib/portal/csca.ts` (строгая форма ответа, разрезка `$`, замена палитры,
часы теста), транспорт `csca-source.ts`, действия `csca-actions.ts`,
компоненты `src/components/portal/csca/*`, стили
`src/app/(portal)/portal/csca/csca.css`, KaTeX и его стили только в layout
раздела. Один вызов чтения на экран; записи по §6..§11 с request_id клиента;
после записи маршрут не перечитывается. Тест словаря и парсеров:
`tests/portal-csca.test.mjs`.

## 18. Чего здесь нет

Экранов iPhone, виджетов `interactive` (веб рисует их `figure_key`),
отрисовки SwiftMath (спайк iPhone), полной диагностики на 24 задания и
пробного теста на 24 задания (следующий выпуск контента), показа прогресса
куратору (решение владельца), карточки CSCA на «Главной».
