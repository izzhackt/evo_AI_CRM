# B3f / 228 — сохранить файл, явно отправить документ, получить решение

Precode от 2026-09-21, source `28613990d3b3ba3b66053571cc3c6e8391cc35e7`
после #988. Основание — §11.6–11.9
[принятого плана](../EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md).
Root зарезервировал228 и принял направление; этот контракт требует независимого
source review до кода. Runtime принадлежит очереди A227→ROOT990→ROOT991;
228 apply, Auth/Storage/browser/server и native acceptance здесь не разрешаются.

## Один законченный результат

Внутри конкретной подготовки214 студент сохраняет файл, затем явно отправляет
один выбранный документ EVO. Сотрудник проверяет именно отправленную версию;
студент видит решение и может сохранить исправление, не потеряв прежнюю отправку.
Другие недостающие обязательные документы не блокируют отправку этого документа.
Выбор программы по-прежнему сразу открывает подготовку, без новых условий оплаты,
договора или повторного одобрения. Полный комплект/его итоговое решение — B3g.

## Почему нужны отдельные программные состояния

- `055:178–226` публикует upload в общий slot.current и status=submitted;
  его replay также объявляет submitted. `128:278`, `116:382` и `055:178`
  блокируют замену approved на трёх разных стадиях.
- `043:3419–3455` проверяет только global current submitted и меняет общий
  slot.status. В актуальном пути068 оборачивает этот review уведомлением.
- `128:903,1032` ограничивает Student download текущей версией и при grant,
  и при consume. Draft и старая отправленная версия требуют отдельного допуска.
- `226:219–237,398–451` читает global material/review. Изменение общего статуса
  ради A изменило бы представление B. `146/169` — approved ZIP для партнёра,
  а не отправка Student→EVO; их guards остаются прежними.

Здесь и ниже номера обозначают файлы `supabase/migrations/NNN_*.sql`.
Сохраняем canonical slot/version/Storage object и общий scanner/transport.
**Новая программная загрузка не двигает legacy current, не меняет slot.status
и не создаёт legacy document_review.** Нового значения в общем enum нет.

## Хранение: четыре узких private companion

Все новые таблицы в `platform_private`: RLS без прямого client DML, tenant/case
composite FKs, guarded append-only записи. Auth/profile/membership разрешает
сервер; клиент не передаёт доверенный actor. Старые строки не backfill-ить.

| Таблица | Неизменяемая связь и назначение |
| --- | --- |
| `application_document_upload_contexts` | org/case/application/binding214/revision226/item/slot, upload request, uploader, exact intent, admitted_at. Admission не означает сохранённый файл. |
| `application_document_submissions` | те же identities + exact canonical version + origin upload-context либо явно выбранная existing-version, actor, submitted_at, intent/receipt. Unique org/application/revision/item/version исключает одинаковую повторную отправку. |
| `application_document_submission_reviews` | exact submission, reviewer, decision из существующего review enum, reason, reviewed_at, intent/receipt. Correction/rejected требуют замечание. Решение не меняет общий slot и не принимает B. |
| `application_document_download_contexts` | связь существующего grant с app/item и exact upload/submission/version. Consume повторно разрешает тот же контекст; строка purpose не является authority. |

У существующей upload reservation — один nullable immutable FK
`application_upload_context_id`; NULL сохраняет legacy. Version/binding/scan/
finalization остаются в существующих таблицах, без второго binary ledger или
копирования объекта. Новый finalization receipt явно имеет
`publishedToLegacySlot:false`; сохранённый version_no не означает global current.
Последний сохранённый draft вычисляется из finalized контекстов данного item
по `(finalized_at,id)`, а не по глобальному current. Failed admission не скрывает
последний сохранённый файл. Состояние submission выводится из его решений.

226 создаёт новые item IDs при каждом сохранении, в том числе для неизменённого
требования. Поэтому текущий item содержит отдельно своё состояние и последнее
историческое свидетельство по сервером проверенной цепочке `predecessor_item_id`.
Каждое звено должно принадлежать тому же org/case/application и предыдущей
revision; совпадения label/requirementKey или переданного клиентом UUID недостаточно.
История возвращает исходные revision/item, definition/material snapshot, exact
version, отправку и решение. При изменении определения либо material связь
остаётся видимой как история; старое решение не становится приёмкой нового item.
Даже неизменённая successor definition не создаёт отправку автоматически:
показываем «Проверен по предыдущим требованиям» с точной прежней версией, а
текущую отправку создаём только по явному действию. Для нового submit повторно
проверяем текущий mapped slot и допустимость явно выбранной версии.

Исторический файл доступен по его исходному контексту с актуальными правами,
даже если новый item привязан к другому material. Последний draft текущего item
и исторический draft не смешиваются. Удалённое из текущих требований не пропадает:
программная история без item-фильтра перечисляет также прежние требования;
история текущего item охватывает только его доказанную predecessor-цепочку.
Обе формы используют одну scoped keyset pagination, без загрузки всего архива.

## RPC и границы совместимости

Названия ниже — контракт228. Публичные функции в `platform`, внутренние helpers
в `platform_private`; service-only функции не доступны anon/authenticated.

| RPC | Вход и результат |
| --- | --- |
| `student_application_documents_v1`, `staff_application_documents_v1` | `(case,application)` → protocol1, текущая requirements revision, item states, eligibility. Staff требует scoped document.read.full; Student — действующее сопровождение и собственное дело. |
| `admit_application_document_upload_v1` | `(case,application,revision,item,request)` → immutable context. Роль определяется обычным Auth; staff требует document.upload. Существующие rate/scan leases сохраняются. |
| `reserve_application_document_upload_after_ingress_scan_v1` | service-only: context + exact scanned metadata/proof; создаёт canonical version/reservation, повторно проверяя текущего uploader/context. |
| `finalize_application_document_upload_with_scan_v1` | service-only: context/reservation + exact stored scan proof; seal exact object без вызова055 publication. Не держать DB transaction во время HTTP/ClamAV. |
| `submit_application_document_v1` | `(case,application,revision,item,selection,expectedPreviousSubmissionId,request)` → immutable receipt с exact version. Current revision/mapping и technical availability обязательны. |
| `review_application_document_submission_v1` | `(submission,expectedPreviousReviewId,decision,reason,request)` → scoped review receipt; document.review и актуальный case scope. Допускает старую отправленную версию после нового upload. |
| `grant_application_document_download_v1`, `consume_application_document_download_v1` | обычный Auth grant и service consume; exact upload/submission/version, повторная авторизация и проверка object/clean/integrity на обеих стадиях. Existing one-use grants/expiry сохраняются. |
| `application_document_history_v1` | scoped `(case,application,item?,cursor,limit)`; item задан — его доказанная predecessor-цепочка, item отсутствует — вся программная история, включая удалённые требования. Keyset `(created_at,id)`, default20/max50; точные origin revision/item/definition/material и nextCursor. |
| `staff_application_document_submission_queue_v1` | scoped keyset очередь actual submissions с открытой проверкой, student/program/item/deadline; default20/max50. Разрешённые нераспределённые дела остаются видны, auto-assignment нет. |

Selection — закрытый union `{kind:program_upload,uploadContextId,documentVersionId}`
либо `{kind:existing_version,documentVersionId}`. Existing version разрешается
только через server-resolved same-case/mapped-slot доступный origin: legacy
опубликованная версия либо разрешённый contextual finalized upload/submission.
Нельзя угадать чужой version UUID и получить его файл. Выбор источника явный;
A/B могут ссылаться на одни байты, но получают независимые отправки и решения.
Прежнее file approval — отдельное свидетельство, не программная приёмка B.

**Узкое исключение на legacy-входах обязательно согласовать при review228:**
до terminal/replay в старом admission/reserve/finalize отвергать request или
reservation с B3f context. Это не изменение поведения прежних NULL-context
вызовов/receipts и не ослабление055/043/128; оно запрещает ошибочно опубликовать
новый draft через старый entrypoint. Нельзя ограничиться HTTP guard: проверка
должна работать на authoritative SQL-входе. Исторические миграции не редактировать.

Old **public** program requirements readers v1/v2 на application с любым B3f
upload-context либо submission возвращают явный PT409 update-required. Guard
находится только в публичных reader entrypoints, после проверки доступа; общий
`application_requirements_v2_view` не получает этот запрет. Его внутренняя
definition/legacy-material projection остаётся доступна authorized226 editor
context, свежим save и pending recovery даже после failed admission или submit.
Редактор226 показывает требования и прежние общие материалы, а не выдаёт их
global status за программную отправку/решение. Его текущий закрытый DTO сохраняется;
program review принадлежит новому reader. Не посылать новые keys/enum в старые
reader DTO. Исторический218 initialization replay и226 exact-save replay
сохраняют свои authorized immutable receipts. Legacy/manual/visa Docs продолжают
свою current/status ветку. Новые web/Swift подготовки используют новый reader;
нельзя включить новый upload без доступных submit/read/download действий.

## Переходы и неизменность намерения

| Действие | Фактический результат |
| --- | --- |
| Admission/scan/upload не завершены | Нет uploaded и нет новой работы review; ошибка/прогресс по настоящему этапу |
| Contextual finalize | Saved draft exact version, техническая доступность отдельно; legacy approved/current прежние |
| Explicit submit | Новая immutable отправка по одному item, её время и точная версия; application.status не меняется |
| Review | approved/correction_required/rejected только этой отправки; замечание ведёт в нужную программу/item |
| Replacement | Новый saved draft рядом с прежней отправкой/решением; прошлый approved не исчезает |
| Resubmit | После явного выбора и проверки текущих требований новая отправка новой версии; прежний snapshot не меняется |

Согласованный порядок locks: request → actor/org/membership → case → application
→ sorted slots → exact versions → reservation/context/submission; authority
повторно проверяется после locks. Для version_no использовать общий slot lock и
MAX+1 allocator, чтобы legacy и contextual upload не столкнулись.

Полный normalized intent и requestUUID сохраняются до отправки. Равенство exact,
не JSON containment. Same request возвращает старый receipt после актуальной
проверки доступа; другой intent конфликтует. При другом UUID для уже существующей
identical submission вернуть её с `reused:true`, записав exact alias intent/receipt
в существующий audit; новая submission не создаётся. Старый unknown result не
разрешает подставить latest version или новый UUID. Browser pending разделён по
org/member/case/application/item/operation; account switch скрывает чужой pending.

Смена требований после admission: reserve требует ещё актуальный item; если байты
уже сохранены, finalize может завершить только тот исторический context при
сохраняющихся правах/slot/object. Он не переносит и не отправляет файл по новой
revision. Новый submit требует явной текущей mapping/selection. Revocation,
удалённый slot, отсутствующий/грязный объект — отказ, а не fallback-success.

## DTO и интерфейс: Impeccable Operate

Один строгий TS/Swift contract: protocol1, target/current revision, items с
requirement identity, legacy material evidence, saved draft, active submission
с exact version/review, history cursor, availability reasons и canUpload/canSubmit.
Версия содержит id/positive decimal versionNo/safe filename/finalizedAt;
submission — id/revision/item/version/submittedAt; review — id/decision/reason/
reviewedAt. Storage paths, tokens, internal actor IDs и scanner secrets не выдаются.
Отсутствующие/повреждённые поля — явная ошибка, не успешный пустой список.

В существующем экране программы: требование → сохранённый файл → отдельное
«Отправить на проверку» → отправленная версия/время/решение. При новом draft рядом
с approved показывать оба факта. «Сохранён, ещё не отправлен» не является новой
очередью работы; scan/техническая ошибка объясняет недоступность submit. Для
исправления видны конкретное замечание и «Загрузить исправленный файл».
В CRM использовать привычную форму review, передавая submission-specific action,
и отдельный вклад/фильтр отправок в существующем admissions-пространстве; общий
Docs inventory не фильтровать до submissions. Уведомления связывать с submission
и exact item, используя существующее notification plumbing, без task на каждый файл.

EVO/Атлас/Golos, текущие controls и RU/KY сохраняются; desktop/mobile компоновка
без нового дизайна. Не повторять Impeccable context/detector; craft-floor перед
UI edits, максимум две batched visual rounds в выделенном runtime окне.

## Владение и доказательство

SQL owner: только новая228 и её scoped tests. Shared TS/server owner: contextual
upload/download adapters, codecs/actions/pending; существующий transport не
дублировать. Web/CRM owner: program documents/review/queue и документные секции
i18n. Swift owner: shared wire, transfer и program document UI. Общие файлы и
секции назначаются одному владельцу до параллельных правок.

После exact precode review: scoped parse/codec/idempotency checks, TS/Swift build
по доступности; затем отдельный reviewed local packet. Реальное доказательство:
A/B isolation; draft не в review; approved-current replacement; exact submit/replay/
duplicate/conflict; review/download V1 после V2; grant→revocation/dirty-object
consume denial; requirements-change race; unchanged legacy/manual/visa/replay и
ZIP guard; web/iPhone changed-path parity. Native build не native UI acceptance.
Отдельная проверка revision: сохранить/проверить документ, через authorized226
изменить другое требование и обновить программу. Старая exact версия/отправка/
решение остаются видимы и доступны, новая отправка сама не появляется; editor
read/save и recovery продолжают работать. Изменённое/удалённое требование остаётся
в программной истории со своим прежним определением.
Здесь ни один из этих новых сценариев ещё не исполнен. Production/providers,
полный пакетB3g, широкий финальный E2E/content/App Store остаются вне блока.

Архитектурные основания проверены21.09.2026:
[PostgreSQL17 locks](https://www.postgresql.org/docs/17/explicit-locking.html) —
единый порядок и границы transaction;
[Supabase Storage access](https://supabase.com/docs/guides/storage/security/access-control) —
service key обходит Storage RLS, поэтому контекст повторно проверяется сервером.
