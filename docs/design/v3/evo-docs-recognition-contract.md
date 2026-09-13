# D3 — распознавание документов с проверкой человеком

Дата: 2026-09-14. Статус: объединённый D3-кандидат; не выпущен.
База D2 объединена в main; актуальное доказательство выпуска ведёт root в едином плане, не эта D3-ветка.
Исполнитель читает [единый план](evo-docs-unification-run-plan.md),
[D2](evo-docs-profile-fields-contract.md) и [ADR0028](../../adr/0028-unify-document-automation-inside-evo-platform.md).
Pure DTO/transport подготовлены в PR756/758; очередь162/PR760 reviewed APPROVED на `823ecb02`, не merged.
Интеграция163: HTTP/UI, fenced private-source loader и processing/cleanup orchestration реализованы и локально проверены.
Исправленный изолированный runtime входит из `32c6403`; его отдельные native-проверки
описаны в [доказательстве runtime](references/2026-09-14-document-source-native-amd64-proof.md).
Combined image/Auth/Storage/browser proof, итоговый CLI и paid-provider gates ещё не закрыты; dispatch не включён.
Интеграция `26dd7b78` независимо одобрена и сохранена в draft PR763 поверх PR760.
Reviewed acceptance `d4423d8d` объединён с runtime и текущими main/Admissions/package gates.
Этот combined candidate требует независимого review до сборки acceptance image и запуска стека.
Нижние датированные результаты относятся к отдельным срезам, не доказывают combined-приёмку.
Номера forward-миграций выделяет root после проверки актуального main; не резервировать самостоятельно.

## Результат и неизменные границы

### Уточнение перед реализацией очереди, 2026-09-13

При enqueue база знает версию, hash, MIME и размер оригинала, но число страниц
узнаётся только после ограниченного разбора точных байтов worker. Не принимать
page count от браузера и не запускать тяжёлый разбор внутри HTTP/SQL-транзакции.
Поэтому хранить две разные неизменные привязки:

- `request_fingerprint` фиксирует исходную команду, identity, exact-source metadata,
  profile revision и server-resolved config/policy без числа страниц. Он определяет
  replay исходного request_id; при повторе использовать сохранённый config snapshot,
  а не новую текущую модель или отредактированный профиль.
- `processing_fingerprint` использует полный canonical v1 contract из PR756,
  включая фактически проверенное число страниц. `source_pages` и этот fingerprint
  NULL только до успешного preflight; worker запечатывает их ровно один раз до
  upload intent. SHA/размер/MIME байтов должны совпасть с enqueue snapshot.

Это уточнение порядка получения доказательства, не ослабление idempotency или
разрешение повторного вызова. Не переписывать v1/golden vector. Общий D3 transport
также требует сохранённый countTokens receipt, связанный с exact model/body/config,
до generation intent. Неизвестный/слишком большой count не разрешает generation.

Root выделяет forward162 для закрытой очереди, attempts/provider files и
server-only configuration records. Конфигурация содержит только несекретные
model/project/policy/paid-eligibility references и бюджетные лимиты; API key
остаётся в серверных секретах. Публичный enqueue выбирает активную конфигурацию
на сервере, не принимает её или source metadata от пользователя. Отсутствующая
подтверждённая конфигурация означает `provider_not_configured`.
Никаких production seed/enable/apply в этой ветке; текущий выпуск bc0cde68 заморожен.
RPC/read adapter и локальная настоящая PostgreSQL-проверка — обязательная часть
среза; worker/Storage/UI, paid provider, разрешённый реальный файл и cleanup
остаются отдельными обязательными интеграционными gates, а не объявляются готовыми.
Локальное доказательство очереди: PostgreSQL001–162 PASS01a09baab06f746290e94bdef3340ffd,
88+12 Node PASS, TS/lint PASS. Синтетические provider/scanner-факты не доказывают реальную интеграцию.

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
- Для холодного открытия GET принимает вместо job_id ровно source_version_id и необязательный cursor:
  `{jobs:[safe job DTO],next_cursor:string|null}`, по10, порядок created_at/id; UI «Загрузить более ранние».
  История проверяет те же live read-права; read/reopen/poll не запускает платное действие.
- GET `scope=case` (+cursor) вместо job_id/source_version_id показывает ту же safe историю по всем
  версиям данного дела; это сохраняет доступ к неизвестному исходу/cleanup после замены версии.
  Выбор строго взаимоисключающий, права прежние, никаких путей/байтов/новых private полей.

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
  Revision — optimistic guard enqueue; повтор того же request_id сохраняет исходный payload/config/revision.
  Новый явно подтверждённый retry_of_job_id — отдельное платное действие над тем же exact source,
  с текущими revision/server config/budget; UI явно показывает это отличие. Ручная правка не повторяет AI.
  Внешний config.enabled выбирает конфигурацию только новых enqueue; не отменяет уже захваченные jobs.

Пользовательские `platform.enqueue_document_recognition(...)` и
`platform.staff_document_recognition_job(case_id,job_id)` принимают текущую сессию.
Service-only RPC в [162](../../../supabase/migrations/162_platform_document_recognition_queue.sql):
`claim_document_recognition`, `renew_document_recognition_lease`, `seal_document_recognition_preflight`,
`begin_document_recognition_upload`, `observe_document_recognition_file`,
`record_document_recognition_token_count`, `begin_document_recognition_generation`,
`record_document_recognition_result(attempt_id,claim_token,result_text,result_sha256,response_id,model_version,usage)`,
`publish_document_recognition_proposals(attempt_id,claim_token)`,
`finish_document_recognition(attempt_id,claim_token,failure_code)`,
`claim_document_recognition_cleanup(worker_id)` и
`begin_document_recognition_delete` и `record_document_recognition_cleanup(attempt_id,cleanup_token,observation)`.
Metadata/result строго типизированы; переходы whitelist, произвольное состояние записать нельзя.
Observation: ровно outcome/resource_name/state/sha256/bytes/mime_type; для unknown/not_found поля metadata NULL.
DELETE intent возвращает dispatch:false при replay; ack не равен confirmed_absent. SQL хранит только серверное имя.
Result хранится отдельно с hash точного нормализованного UTF-8 JSON, предложения связаны attempt+ordinal;
в том числе конфликтующие варианты одного поля сохраняются раздельно. Session adapter не создаёт request ID/профиль.
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
Shared `inspectDocumentSource` (root-owned `server/document-source-preflight.ts`) принимает только
bytes/MIME/expectedSha256 + AbortSignal; policyVersion `document-source-v1`, JPEG/PNG ≤20000 по каждой
стороне и ≤40MP. Credential-free/network-isolated процесс с жёсткими RAM/CPU/time/output bounds;
до его реального доказательства нет provider dispatch. Загрузка exact private binding после live
fenced source RPC: ≤15s, streamed ≤25MiB, exact length/SHA/magic; без redirects/decompression/путей от клиента.
Forward163 сохраняет `source_preflight_policy_version` один раз рядом с pages; seal принимает явный
`p_preflight_policy_version`, старый unpinned signature удалён. Upload/generate проверяют policy;
v1 fingerprint/golden не меняется. Cleanup получает фактические sealed source_pages, не подставную1.
Приватный claim также возвращает сохранённые provider_file_state/provider_observation_count:
после пятого ACTIVE worker использует точное прежнее подтверждение, не выполняет шестой observe.
≤61 кандидат, только registry keys, value по лимиту поля, snippet ≤240 code points,
page ∈1..фактическое число страниц либо NULL, confidence ∈0..1 либо NULL;
≤16 коротких warnings по 240 символов, validated JSON ≤256 KiB, output ≤6000 tokens.
Worker: одна активная генерация/org, две/project; generation timeout 90 s, processing poll ≤60 s.
В серверной конфигурации обязательны per-job и daily-org денежные бюджеты и версия pricing policy;
атомарно резервировать до вызова, неизвестный исход не освобождает резерв как «бесплатный».
При переносе до вызова через полночь UTC повторно проверить текущий дневной бюджет; retry unknown требует явный retry_of_job_id.
Отсутствие модели/бюджета/paid-project подтверждения блокирует вызов. Только снижение лимитов без нового review.

Использовать серверный `EVO_PLATFORM_GEMINI_API_KEY`, отдельные D3 model/config version и явное включение.
Не менять существующий reply-flow/его `gemini-3.7-flash`. Stable-модель выбирать явно после проверки качества;
`latest` alias и молчаливый default запрещены. Текущий SDK `2.16.0` не типизирует новые generateContent
`store/responseFormat`; узкий REST adapter проверяет реальное wire body, не делает type-cast обход.
REST: `POST /v1beta/models/{model}:generateContent`, top-level `store:false`,
`generationConfig.responseFormat.text={mimeType:"APPLICATION_JSON",schema}`; сервер повторно валидирует JSON.
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

## Локальное доказательство интеграции163

Реальная isolated PostgreSQL001–163: PASS `01a09bc51f5c7d309b46cbfc5a261667`; source access/replay,
пятый ACTIVE→lease restart, sealed policy/pages, truthful post-upload failure и case/source history.
Owned container удалён, absence `01a09bcd57d97ca180f6130e2373a218`; managed DB не изменялась.
Actual `npm run test:student-profile-fields`: 152 server/pure +18 component SSR PASS
`01a09bcc160f73e2a5f2182c02b4182d`; CI manifest6 PASS `01a09bcc13e075308704e104c8c15278`.
`next typegen` + whole-repo `tsc --noEmit --incremental false`: PASS `01a09bccc76978c18ca43875f3ecc259`.
Real loopback HTTP проверяет capped streaming/abort/expiry, но не настоящий Supabase Storage.
Injected Files/REST/RPC/inspector ответы — только unit-boundary proof, не real provider/parser evidence.
CLI не содержит mock/pass инспектора и ещё не добавлен: root-owned hard runtime обязателен до wiring/dispatch.

## Следующая ограниченная техническая приёмка — до provider gate

От reviewed `26dd7b78` готовится отдельный foundation mode: настоящий локальный
Admin/Auth → canonical Sales→Admissions fixture → UI-профиль и пустое подтверждение →
UI checklist/upload публичного EVO logo через настоящий ClamAV/private Storage →
явное UI enqueue → session replay/read/cold reopen без второго задания.
Все данные изолированные и синтетические; fixture config явно технический, без
API key и без утверждения paid-project eligibility. Он не разрешает provider dispatch.

Source-preflight gate требует immutable combined D3 + independently reviewed
Linux-runtime image: точные source-loader/seal bytes `26dd7b78` и реальные runtime
artifact bytes должны входить в один проверенный образ. Runtime-only image, macOS
parser, диагностическая подмена, mock inspector и fake verified result не подходят.
До проверки образа команда останавливается до запуска стека. После согласованного
запуска exact private bytes читаются через действующий grant, проходят настоящий
изолированный inspector, pages/policy/fingerprint запечатываются и job завершается
до upload; факт отсутствия upload/generation/provider-file подтверждает отдельный gate.

Это доказательство локальных UI/Auth/Storage/preflight связей, не полного worker
или paid-провайдера. Actual generation/result → human review → provider cleanup
остаются обязательной отдельной приёмкой на разрешённых деле/файле и paid project.

### Подготовка и запуск после разрешения root

1. Исправления hard runtime и отдельные native-проверки описаны в
   [runtime evidence](references/2026-09-14-document-source-native-amd64-proof.md).
   В combined tree сохранены точные runtime bytes `32c6403` и D3 bytes `d4423d8d`.
   До сборки image и запуска стека требуется независимое одобрение этого объединения.
2. В одном clean checkout объединить reviewed D3 + fixed runtime + этот harness.
   Обычный `Dockerfile` собирает production image с exact `EVO_IMAGE_REVISION`.
   Затем отдельный `scripts/Dockerfile.document-recognition-acceptance` получает
   `EVO_D3_COMBINED_IMAGE_REF` (разрешаемое имя/тег или repository digest),
   `EVO_D3_COMBINED_IMAGE` (его фактический local `sha256:<image ID>`) и
   `EVO_D3_ACCEPTANCE_REVISION` (тот же commit). Reference и image ID не взаимозаменяемы;
   см. [Docker FROM](https://docs.docker.com/reference/dockerfile/#from) и
   [image identity](https://docs.docker.com/reference/cli/docker/image/pull/).
3. Запуск: `EVO_D3_COMBINED_IMAGE` и `EVO_D3_ACCEPTANCE_IMAGE` задаются точными local
   image ID, `EVO_NODE_BIN` указывает Node22; выполнить
   `bash scripts/test-postgres-v2-foundation.sh --document-recognition-only`.
   Gate до stack creation сравнивает native architecture, revision, точные TS bytes
   из clean Git commit и фактические launcher/inspect/dependency-tree/Node hashes
   обоих образов. TS-модули исполняются только в acceptance target: это **не**
   проверка отсутствующего production CLI bundle. Production image не получает test entrypoint.
4. Браузер сохраняет только `predispatch-pending.json` и предварительный marker
   `DOCUMENT_RECOGNITION_PREDISPATCH_RECORDED`. После успешного сценария D3 EXIT
   подтверждает удаление собственных процессов, ClamAV container/volume и Supabase
   project (containers/networks/volumes), затем пишет `acceptance.json` с
   `cleanupVerified: true` и единственный полный marker
   `DOCUMENT_RECOGNITION_PREDISPATCH_VERIFIED`. Закрытый receipt/screenshot находится
   в `output/document-recognition/<SHA>/foundation-*`. Любой stop/rm/readback failure
   возвращает nonzero без final receipt/marker; pending evidence и оставшийся
   owned workdir сохраняются. D2 и остальные режимы не меняются.
   Нет marker или неудачна очистка — gate не закрыт. Внутри read/replay не создают
   второго задания; terminal cancelled, released reservation и отсутствие
   upload/generation/provider files/proposals читаются из реальной локальной БД.

Подготовка проверена только как код: focused27 PASS, actual npm script162+18 PASS,
TypeScript/lint/syntax PASS. Стек, acceptance image и внешний провайдер не запускались.
