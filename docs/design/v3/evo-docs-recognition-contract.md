# D3 — распознавание документов с проверкой человеком

Дата: 2026-09-13. Статус: подготовленный контракт, реализация D3 не начата.
База: D2/PR752 merged `fd5b6a08` = reviewed tree `daf5b5ac`; fast PASS, итоговый выпуск ещё не подтверждён.
Исполнитель читает [единый план](evo-docs-unification-run-plan.md),
[D2](evo-docs-profile-fields-contract.md) и [ADR0028](../../adr/0028-unify-document-automation-inside-evo-platform.md).
Все новые пути, RPC, таблицы и лимиты ниже — проектируемый интерфейс D3.
Номера forward-миграций выделяет root после проверки актуального main; не резервировать самостоятельно.

## Результат и неизменные границы

Сотрудник выбирает версию документа дела → «Извлечь поля» → видит ход задания →
проверяет предложения рядом с оригиналом в существующей «Анкете».
Повторное чтение/открытие страницы ничего не запускает. Оригинал не изменяется.
Используются одна Supabase identity, дело, private Storage и реестр 61 поля/6 групп D2.
Не добавлять второй Auth/SQLite/Express, отдельного студента, массовое распознавание,
автоотправку, DOCX/video ingress, Student-private тесты или доступ AI ко всей базе.

## Точки реализации

| Граница | Задача следующего исполнителя |
|---|---|
| [Реестр полей](../../../src/lib/student-profile-fields.ts) и [D2 DTO/RPC](../../../src/lib/platform-student-profile-fields.ts) | Использовать те же ключи, code-point limits и review commands; не создавать вторые текущие значения. |
| [Private Storage handler](../../../src/lib/server/platform-document-storage-route-handlers.ts) | Выделить ограниченное чтение точных байтов: version/slot/case, clean scan, MIME/magic/size/SHA-256. Не выдавать Gemini пользовательский signed URL. |
| Новый `src/lib/platform-document-recognition.ts` | Строгие request/job/result DTO, фиксированные коды, пользовательские RPC через текущую сессию. |
| Новые `src/lib/server/{document-recognition-route-handler,document-recognition-worker,gemini-document-recognition}.ts` | HTTP-граничные проверки; claim/side-effect/outcome; отдельный узкий Files + REST generateContent adapter. |
| Новый `scripts/run-document-recognition-worker.ts` | Ограниченный `--once` tick управляемого private worker того же приложения/image; не fire-and-forget внутри HTTP-запроса. |

Перенести паттерны ledger/lease из [045](../../../supabase/migrations/045_platform_durable_work_queues.sql),
но не помещать извлечение в существующий `ai_draft_generate` с его retry-семантикой.
Для первого среза job-таблица сама служит очередью PostgreSQL; нового брокера не требуется.
Из исходного EVO Docs `server/extractor.ts` брать prompt/нормализацию, не in-memory queue,
не молчаливый `.catch()` удаления и не неограниченные массивы результата.

## Полномочия и HTTP

- Предлагается новая запись permission catalogue `document.extract`: resource `student_case`,
  scopes `own/department/direction/record/organization`. Она сама не выдаёт назначений staff;
  System Admin использует существующий evaluator, не проверку имени роли.
- Enqueue, перед upload/generate и публикацией: активные identity/org/membership, exact-case
  `case.read.full`, `profile.read.full`, `profile.manage`, `document.read.full`,
  `document.download`, `document.extract`; точная версия того же дела и существующий профиль.
  Не создавать профиль скрыто. Student и Admin preview не запускают обработку.
- Job-read требует текущих case/profile/document read-прав; предложения читает существующий D2 snapshot.
  Служебный ключ не заменяет actor/case/job-проверку. Отзыв прав блокирует публикацию;
  cleanup остаётся разрешённым worker, чтобы файл не оставался у провайдера.
- `POST /api/v3/student-cases/[studentCaseId]/document-recognition-jobs`:
  ровно `{source_version_id:UUID, expected_profile_revision:int, request_id:UUID, retry_of_job_id:UUID|null}`.
  Org/profile/slot/путь/модель/hash выбирает сервер. Ответ `202 {job_id,state,replayed}`;
  повтор известного запроса возвращает тот же job, не запускает worker второй раз.
- `GET` того же пути с `job_id=UUID`: `200 {job_id,source_version_id,state,cleanup_state,
  proposal_count,failure_code,updated_at}`; no-store, без provider URI/ключа/raw response.
  Фиксированные ошибки: `400 invalid_request`, `401/403 unavailable`, `409 profile_changed|request_conflict|equivalent_job_active`,
  `422 document_not_eligible|profile_not_started`, `429 budget_exhausted`, `503 provider_not_configured`.
  Неизвестный исход enqueue сверяется тем же request_id; новый ID автоматически не генерируется.

## Постоянные данные и RPC

Новые закрытые таблицы `platform_private.document_recognition_{jobs,attempts,provider_files}`:

- `jobs`: UUID, org/case/profile/slot/version composite identity, source SHA-256/bytes/MIME/pages,
  actor auth/membership IDs, request_id, fingerprint, retry_of_job_id, profile_revision_at_enqueue,
  registry/schema/prompt/config versions, configured model, state, timestamps, reserved cost.
  UNIQUE(org,request_id); partial UNIQUE активной exact-source+model/policy комбинации исключает второй платный job.
- `attempts`: UUID/job, ordinal, worker_id, claim_token, lease_until, stage, durable intent timestamps,
  response_id/actual model version/usage, bounded validated result + SHA-256, fixed failure code/outcome.
  Одна generation attempt на job; повтор после неизвестного исхода — отдельный явно подтверждённый job.
- `provider_files`: attempt FK, заранее выбранный уникальный resource name, provider project/config ID,
  ожидаемые hash/size/MIME, observed state/expiry, cleanup state/token/lease, check/delete timestamps и fixed outcome.
  Никаких имён клиентов в provider name/displayName; секреты не копировать в таблицы или аудит.
- Fingerprint: все exact-source IDs и hash/bytes/MIME, actor, purpose, registry/schema/prompt/config/model,
  режим извлечения, expected_profile_revision и retry_of_job_id; другой fingerprint того же request_id → conflict.
  Revision — optimistic guard enqueue; retry сохраняет исходный payload. Ручная правка профиля не повторяет AI.

Пользовательские `platform.enqueue_document_recognition(...)` и
`platform.staff_document_recognition_job(case_id,job_id)` принимают текущую сессию.
Service-only RPC: `claim_document_recognition(worker_id)`, `renew_document_recognition_lease(attempt_id,claim_token)`,
`advance_document_recognition(attempt_id,claim_token,expected_stage,next_stage,metadata)`,
`record_document_recognition_result(attempt_id,claim_token,result,response_id,model_version,usage)`,
`publish_document_recognition_proposals(attempt_id,claim_token)`,
`finish_document_recognition(attempt_id,claim_token,outcome,failure_code)`,
`claim_document_recognition_cleanup(worker_id)` и
`record_document_recognition_cleanup(attempt_id,cleanup_token,resource_name,outcome,checked_at)`.
Metadata/result строго типизированы; переходы whitelist, произвольное состояние записать нельзя.
Сохранять общий lock order organization → job/attempt → identity → case/profile;
никаких сетевых вызовов внутри транзакции. Claim: `FOR UPDATE SKIP LOCKED`, fencing token,
lease 90 s, heartbeat 15 s. Истёкшая lease разрешает reconcile, не повтор уже начатого вызова.

## Состояния, восстановление и очистка

`queued → preflight → uploading → file_processing → generating → result_saved → review_ready`.
Иные исходы: `failed`, `upload_unknown`, `generation_unknown`, `publication_blocked`, `cancelled`.
`cleanup_state`: `not_uploaded|pending|deleting|confirmed_absent|unknown`; независим от результата AI.

1. Перед upload сохранить `files/evo-<32hex attempt ID>` и metadata; перед generate — intent.
   Каждое действие допускается только условным переходом при действующей lease.
2. Потерянный upload-ответ: bounded GET именно записанного имени, сверка hash/size/MIME;
   только подтверждённый ACTIVE позволяет перейти из `upload_unknown` к `file_processing` и продолжить.
   Не повторять upload по одному 404 и не удалять чужие файлы по совпадению hash/displayName.
3. После durable `generate_started_at` timeout/disconnect/restart → `generation_unknown`, без автоматического
   платного retry. Abort клиента не отменяет серверную обработку/расход; exactly-once не обещать.
4. Валидированный ответ сначала сохраняется в attempts. Публикация proposals повторяется локально
   идемпотентно без Gemini. Потеря ответа до durable save остаётся неизвестным исходом.
5. DELETE собственного provider name и проверка GET/NOT_FOUND фиксируются отдельно.
   403/network error не означают удаление; после неоднозначного upload ранний 404 не доказывает
   окончательное отсутствие. До подтверждения завершения upload и удаления — cleanup `pending/unknown`.
   Cleanup GET/DELETE: максимум 5 автоматических попыток с backoff, затем `unknown` и явный reconcile оператора;
   генерация при этом не повторяется. Истечение 48 h — не доказательство немедленного удаления.
6. Сохранённые proposals уникальны по attempt+ordinal, связаны FK с exact source version и job.
   Публикация повышает одну aggregate revision и аудит, не пишет confirmed values/reviews D2.
   Подтверждённая пустота остаётся пустотой, конфликт решает человек; исходная версия не подменяется latest.

## Ограничения и транспорт Gemini

Стартовые верхние границы D3: PDF/JPEG/PNG ≤25 MiB, PDF ≤20 страниц, без скрытой обрезки;
число страниц определяет ограниченный серверный разбор, encrypted/unreadable PDF отклоняется.
≤61 кандидат, только registry keys, value по лимиту поля, snippet ≤240 code points,
page ∈1..фактическое число страниц либо NULL, confidence ∈0..1 либо NULL;
≤16 коротких warnings по 240 символов, validated JSON ≤256 KiB, output ≤6000 tokens.
Worker: одна активная генерация/org, две/project; generation timeout 90 s, processing poll ≤60 s.
В серверной конфигурации обязательны per-job и daily-org денежные бюджеты и версия pricing policy;
атомарно резервировать до вызова, неизвестный исход не освобождает резерв как «бесплатный».
Отсутствие модели/бюджета/paid-project подтверждения блокирует вызов. Только снижение лимитов без нового review.

Использовать серверный `EVO_PLATFORM_GEMINI_API_KEY`, отдельные D3 model/config version и явное включение.
Не менять существующий reply-flow/его `gemini-3.7-flash`. Stable-модель выбирать явно после проверки качества;
`latest` alias и молчаливый default запрещены. Текущий SDK `2.16.0` не типизирует новые generateContent
`store/responseFormat`; узкий REST adapter проверяет реальное wire body, не делает type-cast обход.
REST: `POST /v1beta/models/{model}:generateContent`, top-level `store:false`,
`generationConfig.responseFormat.text={mimeType:"application/json",schema}`; сервер повторно валидирует JSON.
Files SDK допускается с `config.name`; HTTP retries для upload/generate выключены (`attempts:1`).
Не копировать unsupported candidateCount/sampling-настройки в новую модель. Prompt считает документ данными,
не инструкциями; без tools/search/URL fetch, выдуманных фактов и автоматического подтверждения confidence.

## Минимальные gates и официальные основания

До кода root связывает контракт с PLAN_CHANGES и выделяет миграции после D2 integration.
Локально: реальные Auth/DB UI на изолированном синтетическом деле; очередь/restart до dispatch,
same-request outcome, сохранённая пустота/stale editor; transport-boundary тесты unknown без платных вызовов.
Реальная приёмка отдельно: выбранные разрешённые дело+файл, полномочие передать данные, paid project/billing,
явный запуск → actual response → ручная проверка → подтверждённый cleanup. Нет разрешённого файла — gate открыт.
Unpaid API запрещает sensitive/personal/confidential inputs; `store:false` не отменяет abuse/legal retention.
Только staff-интерфейс; условие провайдера об under-18 audience не расширяет доступ Student Portal.

- [Files.name, states, hash и GET/DELETE](https://ai.google.dev/api/files#File); [UploadFileConfig](https://googleapis.github.io/js-genai/release_docs/interfaces/types.UploadFileConfig.html).
- [Files retention](https://ai.google.dev/gemini-api/docs/files); [abort не отменяет service](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html#abortSignal); [retry defaults](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpRetryOptions.html).
- [REST store/responseFormat](https://ai.google.dev/api/generate-content); [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output); [model migration](https://ai.google.dev/gemini-api/docs/latest-model).
- [Paid/unpaid и использование данных](https://ai.google.dev/gemini-api/terms); [logging отдельно от retention](https://ai.google.dev/gemini-api/docs/logs-datasets). Проверено 2026-09-13; повторно сверить перед provider acceptance.
