# Поток B: портал, Docs и admissions — 20 сентября 2026

Исходная ревизия при создании плана: `3ac6f326c`. Владелец потока: B; координация main, схемы и выпусков — root. Каждый владелец может вести согласованные appendices в своём изолированном worktree; root координирует интеграцию всех сторон. Разрешённый scope: пункты 2, 13, 17–21, 23–28, 31–32; пункты 37–50 не запускаются. Текущие проверенные статусы ниже не означают завершение всего плана или production delivery.

## Уточнение актуальности — 22 сентября 2026, main ac165cf9

Текущие состояния см. в [ведомости1–36](EVO_ITEMS_1_36_STATUS_2026-09-21.md).
Следующий checkpoint редактора226 и прежние B-3/B-7 ниже сохраняют историю:
отдельный upload/submit и web/CRM комплект уже реализованы и локально приняты,
а два материала компании действительно скачаны. Не запускать их повторно по
старым формулировкам «следующий блок» или «download blocked». Native, остальные
согласованные материалы и production этим уточнением не объявляются готовыми.

## Текущий B checkpoint после редактора226

#988 MERGED `28613990d3b3ba3b66053571cc3c6e8391cc35e7`; actual local source
`6cdacc76`, reviewed integration `b884900a`, CI35562845122 green. Три Admin UI
save,14 ordinary reads и Student desktop/mobile выполнены в пределах
[квитанции](platform/b3e2-requirements-editor-qa.md). Полный RAW226/282 tables
release `bcb7ed6d` передан A227; это не production delivery или весьB-3.

Следующий B3f — один документ: сохранить → явно отправить → получить scoped
решение → исправить. Root резервирует228, [precode](platform/b3f-program-document-submission-contract.md)
принят независимым review на `b81c338c`. Web/iPhone/SQL исходники реализованы;
исправления независимого source review и exact-head интеграция продолжаются.
[Проверки и remaining QA](platform/b3f-program-document-submission-qa.md) отделяют
офлайн-доказательства от ещё не исполненных реальных сценариев. Отдельный полный
packageB3g, native UI и оставшийсяB-план не завершены. Root обновил очередь:
ROOT990 закрывает своё окно на227 → ROOT991 read-only UI → B228 → ROOT229.
B228 не применена; production authority отсутствует.

## Исторический checkpoint до #988 — 21 сентября 2026

Срез исходников: main `82260fdc2df3b6d370092633cf1ac1c350fe9af6` после #991.
Прежние принятые блоки сохраняются; #967, #975–#979 и #981–#986 — MERGED.
#987/#988/#991 также MERGED; #980/#990/#992/#993 остаются DRAFT на этом срезе.
MERGED означает исходники, LOCAL — ограниченную
фактическую проверку. Managed DB/production apply и release этим checkpoint не
подтверждаются. Весь объём 1–36 не завершён; 37–50 исключены. Исторические
квитанции ниже сохраняют свои ревизии и пределы проверки.

- **#966:** 219/220 и canonical-profile repair в main. Исходный 219
  `APPLIED_QA_FAILED` сохранён; forward220 прошёл function QA, ordinary Admin
  UI save четырёх существующих пустых полей и exact Auth replay. Это не
  положительная pinned219/nonemptyHTTPS UI-проверка.
- **#968:** очередь221 принята: 35 Auth reads и фактический UI1280/390/320,
  «Все»/filter/cursor/context/BackForward. Положительных данных других типов
  и pending decisions в этом наборе не было.
- **#969:** 222 требует причину изменения срока/приоритета у всех ролей.
  Локально пройдены отказы, replay/conflict/stale и четыре reasoned RPC;
  бизнес-поля восстановлены, version+4/audit+4 сохранены. UI доказал блокировку
  пустой причины; успешное UI-сохранение не заявляется. Issue687 остаётся открыт
  до отдельных managed/owner exit criteria.
- **Командный чат / пункт 15:** #970/#974 сохраняют удаление task actions и
  прежнее actual unsent Sales UI autosize/draft1280/390/320. Историческое
  ограничение reload320/root-width330 не закрыто этим checkpoint.
  #976/LOCAL223 добавил flat-history reader; #981 — план, #983/LOCAL225 —
  sparse seen без потери непрочитанных промежутков. Это реальные локальные
  Auth/RPC-проверки, не переключение UI на плоскую ленту. #986 — precode
  direct quotes; #987/LOCAL227 принят: четыре сообщения, две direct-quote связи,
  шесть эффектов, 43 отказа и три конфликта. Это Auth/RPC proof; переключение
  на единую ленту #992 — source-only, actual UI ещё не принят. Search/read/scroll
  и весь пункт15 не завершены; [227](qa/crm-team-chat-direct-quotes-227-2026-09-21.md).
  [223](qa/crm-team-chat-flat-reader-223-2026-09-21.md),
  [225](qa/crm-team-chat-sparse-seen-225-2026-09-21.md).
- **Договор и оплата / пункт 12:** #971/#973 объединили договорный workflow
  с alias, независимыми правами и девятью actions; прежний actual read-only
  UI1280/390/320 сохранён. Историческое assertion-падение исправлено #977,
  scoped92/92 PASS зафиксирован в B3d QA; старые неуспешные результаты сохранены.
  #984 MERGED `684f7f31`: local ordinary Admin создал один QA-транш1,00 KGS и
  оплату0,50; тот же Student увидел остаток0,50 и частичную оплату. Final
  `a2df3c2f`, independent review `a0747bd3`, release `cce0f273` приняты.
  Фактическая форма имела09:40; ночные границы покрывают отдельные pure tests.
  Contract-only/populated artifacts, refunds, receipt upload, mixed-currency,
  весь пункт12 и managed delivery остаются вне этой приёмки.
  [Квитанция](qa/payment-calendar-date-2026-09-21.md).

#964/B218 сохраняет13 фаз обычного Auth и59 Swift decode. #967 MERGED:
actual first-selection214→218 на `284eeb31` сразу открыл подготовку, переиспользовал
два starter slots и сохранил reopen/Docs/back. After-selection `55de9560`,
journey `eaae467b`, final readback `dc816076` и release `337b730f` сохранены.
Отдельный Chrome390 dark проход на `12a6951b` закрыл прежний recapture:
visual APPROVED, release `81ba8b8e`; старые неудачные captures и CI timeout
`35547698931` остаются историей. Native UI, light/320 и полный finish не приняты.
LOCAL211: четыре технические публикации, восемь requests и пять stable IDs,
receipt `44c0f7`; факты/порядок/прежние IDs сохранены, managed publication не заявлена.
[UI-квитанция](platform/b3d-program-preparation-ui-qa.md).

#979 задаёт полный requirements-контракт; #982/LOCAL224 принял v2 readers:
12 ordinary Auth reads, фактические TS/Swift decoders и CRM/Student desktop390
на существующем starter, release `a6e53f58`. Это не positive full requirements.
#988/LOCAL226 принят: обычный Admin сохранил три immutable revisions,
существующий Student получил обновлённые требования. Replay проверен в rollback
probe; stale/rebase/unknown/concurrency и native UI не приняты этой серией.
[226](platform/b3e2-requirements-editor-qa.md). #993/228 — DRAFT/source-only:
CI guard исправляется, actual apply/QA не приняты. Upload отдельно от submit,
versioned packages/review и полный web/iPhone путь остаются открытыми.
[224](platform/b3e1-requirements-v2-read-qa.md).

#991/CRM-02c принят: actual source `26c8b4c2`, final `13d375a4`, merge `82260fdc`.
Пять существующих строк и ссылки сохранены; desktop1440/mobile390/320,
browser AX и поиск→preview→возврат проверены. CI35567157624; full283/Storage
неизменны, собственные Auth sessions восстановлены. Summary400px, VoiceOver,
остальные требования7 и production не покрыты.
#990 — DRAFT: три попытки завершились без receipt/business/Storage effects.
Последний blocker — service SELECT42501, ошибочно показанный как404; dependency229
имеет исправленный source `8bcd` (ещё не main), actual ждёт B228. Успешные
receipt upload/download и полный пункт12 не приняты.

Root27/28: #978 — MERGED inactive primitives; #980 — DRAFT с локальным
web/API/Mailpit confirmation/resend/denial/replay и восстановленной Auth-конфигурацией.
Native UI, настоящая24h expiry и owned Invite negative не подтверждены;
production activation/delivery не заявляется. По28 существующий receiving mailbox
не удалось открыть: нет его активной сессии (receipt `3cf7297d`), новых писем0.
Нужны receiving delivery/reply и точные два разрешённых реальных получателя;
политика подтверждения уже принята и не переоткрывается. SOPS archival не подтверждён.

KB31/32: перенос6568 и maintenance уже выполнены. Metadata-сверка328 позиций
и bounded provenance не закрывают весь backlog. KB31-128 получил только связь
с ранее approved ядром (target `5f761bc3`, receipt `27e5896e`); новое FX-правило
не подтверждено, approval/status/client publication не менялись. По136 коммерческий
service scope и по123 применимость конфликтующих банковских сумм остаются открытыми.
#985 сохранил через actual local Admin UI два approved snippets и две TXT-версии
с ClamAV/Storage/parity; Student denials и contrast/toolbar1440/390/320 проверены.
Первый browser download — `ERR_BLOCKED_BY_CLIENT`, второй не запускался:
скачивание и весь32 не приняты. Массового approval/AI publication нет.
[Подготовка](qa/knowledge-source-reconciliation-2026-09-21.md),
[actual32](qa/knowledge-approved-materials-local-2026-09-21.md).

#946 / LOCAL214: положительный обычный Auth-путь и реальные TS/Swift readers
проверены; это не новый web/iPhone UI-проход. Подготовка/привязка не означает
готовый requirements/upload/submit/review процесс. #948/LOCAL213 и
#960/LOCAL215 приняты отдельно; начальный #946 OPEN ниже — история.

## Порядок небольших блоков

1. **B-1 / пункт 26: выполнен, #937 MERGED `22404da8`.** Resolver принимает managed objectPath только по существующему контракту манифеста: `<photoKey>.(avif|gif|jpg|png|webp)`, ASCII lowercase, без сегментов, dot traversal, query, fragment и percent escapes. Невалидная запись сохраняет уже существующий library URL; неизвестный photoKey остаётся null. Атрибуция, фото, Storage и UI сохранены. Проверены положительные расширения, отрицательные пути/чужой ключ, вся действительная библиотека, read-only GET существующих managed URL и SHA-256. Это точечная защита, не заявление о live authenticated render.
2. **B-2 / пункт 2:** PR #929 смержен 20 сентября в17:46:11Z, `0aca60dd26c7d8cb72d3b3b75c53d957145e6ed0`. Прежний OPEN/MERGEABLE относился к началу плана. 207 уже применена в локальной проверке; текущий211 Student readback снова подтвердил сохранение первого появления в каталоге после обновления карточки. Это не новая managed/production квитанция.
3. **B-3 / пункты 13, 17–21:** #944/#946/#964/#967 MERGED: identities/selection/preparation/association и один actual web214→218 путь приняты в пределах receipts. Chrome390 dark проверен отдельно. #979 — полный requirements-план, #982/LOCAL224 — v2 readers, реальные TS/Swift ответы и starter CRM/Student UI; #988/LOCAL226 редактор принят в пределах [QA](platform/b3e2-requirements-editor-qa.md). Полные требования, отдельные upload/submit, packages/review и native UI ещё не завершены.
4. **B-4 / пункты 23–25:** карта покрываемых portal/iOS экранов по настоящим задачам; отдельный дефектный блок focus/ExplainPanel/localized title после проверки актуального кода. Desktop + 320/390px, RU/KY, light/dark, клавиатура; native Dynamic Type и back. Аудит не означает наличие багов. Общие CSS и переводные файлы согласовывать секциями до правки.
5. **B-5 / остаток 26: выполнен, #939 MERGED `87514d27`.** Audit metadata отделена от клиентских runtime-полей; single source of truth и генерация сохранены. Это не массовый перенос фотографий. Смежное исправление portal theme вошло через #941 `6ceccf83` и не означает завершения всех пунктов 23–25.
6. **B-6 / пункты 27–28:** политика Student email confirmation уже принята; #978 inactive primitives MERGED, #980 coordinated flow DRAFT после actual local web/API/Mailpit и восстановления Auth. Native UI и перечисленные выше negative/expiry limits остаются. Receiving mailbox недоступен без его существующей сессии; проверка28 не отправляла новых писем. Exact real recipients/delivery/reply и SOPS archival не подтверждены. Local Mailpit не означает Resend delivery или production activation.
7. **B-7 / пункты 31–32:** #985 — actual local два approved snippets и две TXT-версии с сохранностью данных; browser download остаётся BLOCKED, весь32 не завершён. По31 выполнены metadata328 и отдельные provenance checks, включая128 без нового approval; backlog открыт. Исторические2655 — файловые позиции плана с reviewQuestion, не2655 новых фактов или обязательных решений директора. Перенос6568 уже выполнен; чувствительные originals/trash/конфликтные цены и гарантии не публикуются. [Квитанция](qa/knowledge-approved-materials-local-2026-09-21.md).

## Admissions: принятый контракт и исторические checkpoints

Следующие абзацы сохраняют состояние до merge #948/#946/#960; текущий итог — выше.

На checkpoint PR944 B3a реализована и MERGED (`1e03c6be`): совместимые TS/SQL/Swift readers, устойчивые
intake IDs и защищённая техническая публикация. На существующем локальном
Guangdong v1→v2 добавлен ровно1 ID; actual Admin UI stage/review/publish,
same-request RPC replay и Student RPC/UI readback пройдены. [Квитанция и
ограничения](qa/b3-intake-identities-2026-09-20.md). Shared B-3 контракт уже
принят. Selection/preparation реализованы в открытом #946, source-reviewed head
`93466099`. 214 применена в собственном локальном QA-контуре; 11/11 ordinary
Auth read/denial checks пройдены, 12 business hashes/counts и Auth count
сохранены, bindings остаются 0. Положительный Student-путь ещё не выполнен.
213 уже скорректирована локально, но её полный cross-group/UI acceptance
остаётся открытым в #948.

Владелец ответил «ок» на подготовленный локальный B214 QA-сценарий в задаче B;
root принял это разрешение в контексте показанного пакета. Повторное разрешение
на тот же пакет не требуется. До запуска root/A фиксируют общий порядок:
проверить literal conditions save и parity до sale/handoff, затем выполнить
остальной согласованный сценарий. Локальная проверка B может предшествовать
merge #948; интеграция #946 в main остаётся после #948. Один save пустой строки
не заменяет A-проверку UPDATE и сохранности непустых соседних блоков.

Следующие ещё не реализованные блоки: (1) требования программы/набора и связи
общих документов; (2) отдельные upload, submit и версионированный package/review;
(3) полный одинаковый путь CRM/web/iPhone. Новых обязательных продуктовых
решений для этой последовательности read-only анализ не обнаружил.
Исходные предложения ниже должны уточняться перед соответствующим срезом,
а не подменять принятые решения или считаться готовыми функциями.

- Assisted Student выбирает конкретные university/program/intake по стабильным ID из модели, введённой #944. Сервер заново проверяет student/case ownership, case lifecycle и опубликованную версию каталога. Не создавать другое дело и не ждать staff approve для подготовки.
- Подготовка ограничена шестью странами по ответу владельца: CN, MY, AE, TR, IT, CZ. Более широкий опубликованный каталог не расширяет этот допуск автоматически.
- Идемпотентный выбор создаёт либо возвращает подготовку внутри существующего дела. Закрытое дело не становится writable из-за accessTier. Снятая программа, изменённый набор и просроченный intake возвращают явное состояние.
- Требования и срок принадлежат конкретной программе/набору и версии. Initial Photo/Passport — стартовый набор подготовки; это не глобальная замена полных чеклистов. Требования с ошибкой не показываются как пустые.
- Upload сохраняет общий Storage/document resource отдельно от submit; web и iPhone ссылаются на тот же файл без копирования. Повторное использование документа сохраняет ownership и актуальную версию.
- Submission — отдельный версионированный ресурс со снимком requirements, intake/deadline и document versions. Submit идемпотентно ставит конкретную версию в CRM review queue; review хранит замечания по этой версии; исправление создаёт следующий пакет и не переписывает принятое решение.
- ZIP guard approved reviews сохраняется. Внутреннее «отправлено на проверку» не означает внешнюю подачу в университет. CRM, web и iPhone читают одинаковые состояния и события.
- До миграции согласовать с root допустимые case states, уникальность повторного выбора и intake identity/backfill. Чужое дело, stale versions, concurrent submit/review и replay являются прямыми рисками для целевых проверок.

## Проверка и границы

Каждый кодовый блок: отдельный diff, прямые проверки изменённой функции, точная ревизия, независимое exact-head review и PR. Root координирует merge. Этот план сам по себе не разрешает production release, shared QA/Auth/DB/Storage mutations и provider actions. Отдельное разрешение владельца на конкретный B214 local QA packet зафиксировано выше и не расширяется на другие записи. Проверка публичного GET не подтверждает авторизованный Student UI; тесты на синтетических входах — только регрессия чистой функции.

Связанные контракты: `EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md`, `EVO_CRM_UX_AND_ADMISSIONS_EXECUTION_2026-09-20.md`, `EVO_UX_REFINEMENT_PLAN_2026-09-20.md`, `design/ux-refinement/{case,university,requests}.md`, `EVO_ASTRA_CONTINUATION_PLAN_2026-09-20.md`, `EVO_PORTAL_HANDOVER_2026-09-20.md`, `EVO_PORTAL_FINAL_LEDGER_2026-09-20.md`, `EVO_CRM_KNOWLEDGE_BASE_EXECUTION_2026-09-20.md`. Более новые проверенные receipts имеют приоритет над историческими статусами.
