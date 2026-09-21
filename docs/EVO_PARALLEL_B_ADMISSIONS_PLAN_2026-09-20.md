# Поток B: портал, Docs и admissions — 20 сентября 2026

Исходная ревизия при создании плана: `3ac6f326c`. Владелец потока: B; координация main, схемы и выпусков — root. Каждый владелец может вести согласованные appendices в своём изолированном worktree; root координирует интеграцию всех сторон. Разрешённый scope: пункты 2, 13, 17–21, 23–28, 31–32; пункты 37–50 не запускаются. Текущие проверенные статусы ниже не означают завершение всего плана или production delivery.

## Текущий checkpoint — 21 сентября 2026

Срез исходников: main `925cf1996e0b2c08e968d513da149793f9c774be` после #973/#974.
#946, #948, #958, #959, #961, #960, #962, #963, #964, #966, #968, #969, #970
и #971–#974 — MERGED. MERGED означает исходники, LOCAL — ограниченные фактические
проверки. Новые managed DB/production apply и release этим checkpoint не
подтверждаются. Весь объём 1–36 не завершён; 37–50 исключены. Датированные
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
- **#970/#974:** из staff chat убраны автоматические task actions/enrichment;
  autosize MERGED через #974 (`6d01bc81`). Actual ordinary Sales UI доказал
  рост/сжатие, перенос при1280/390/320 и восстановление собственного черновика.
  После reload320 root-width330 остаётся явным ограничением; native IME Enter,
  nonce и populated/save не заявлены. Flat feed и цитаты не завершены: A223
  additive reader в реализации, pre-code `55109` reviewed; apply не выполнен.
- **#971/#973:** договорный workflow перенесён в «Договор и оплата» с alias,
  независимыми правами и сохранёнными девятью actions. #973 принят после
  independent review `09e3332d` и CI `35548203929` PASS. Actual ordinary Admin
  UI1280/390/320 и full281 parity пройдены без финансовых записей. Scoped92/93
  (после коррекции40/41) сохраняют одно прежнее assertion-падение, доказанное
  на exact main. Contract-only/populated templates, транши/возвраты/чеки,
  mixed-currency и реальные команды не доказаны; весь item12 остаётся открыт.

#964/B218: 13 фаз обычного Auth и 59 Swift decode PASS. Полные program requirements,
upload/save→submit→package/review остаются открытыми. B967 — DRAFT, frozen head
`284eeb31`, runtime `2516de2d`; CI `35547698931` сохраняет известное падение
Storage idle-window, не новый зелёный прогон. Чтение существующей подготовки в web
проверено; actual first-selection214→218 на `284eeb31` завершился положительно:
подготовка открылась сразу, два starter slots переиспользованы без insert,
неизвестный deadline не придуман; reopen/refresh/saved list сохранили прежний
GDUT, оба Docs anchors и возврат к карточке проверены. After-selection
`55de9560…` — PASS_EXPECTED_GRAPH (ожидаемые изменения восьми таблиц), journey
`eaae467b…`; финальные zero-effect readback/release и визуальная проверка ещё
в работе. Это один web-путь, не полный requirements/submit/review. Native UI
не проверен: Mac заблокирован. LOCAL211 завершён:
четыре технические публикации, восемь requests, пять stable IDs; final receipt
`44c0f7…`. Факты каталога/порядок/прежние IDs сохранены. Это не managed publication
или подтверждение всего admissions-пути.

KB31/32: metadata-сверка328 позиций и пакет двух ранее одобренных материалов
подготовлены; [квитанция подготовки](qa/knowledge-source-reconciliation-2026-09-21.md).
Canonical objects/dedup и записи ещё не подтверждены; массового approval,
AI-bundle publication и завершения всего31/32 нет.

#946 / LOCAL214: положительный обычный Auth-путь и реальные TS/Swift readers
проверены; это не новый web/iPhone UI-проход. Подготовка/привязка не означает
готовый requirements/upload/submit/review процесс. #948/LOCAL213 и
#960/LOCAL215 приняты отдельно; начальный #946 OPEN ниже — история.

## Порядок небольших блоков

1. **B-1 / пункт 26: выполнен, #937 MERGED `22404da8`.** Resolver принимает managed objectPath только по существующему контракту манифеста: `<photoKey>.(avif|gif|jpg|png|webp)`, ASCII lowercase, без сегментов, dot traversal, query, fragment и percent escapes. Невалидная запись сохраняет уже существующий library URL; неизвестный photoKey остаётся null. Атрибуция, фото, Storage и UI сохранены. Проверены положительные расширения, отрицательные пути/чужой ключ, вся действительная библиотека, read-only GET существующих managed URL и SHA-256. Это точечная защита, не заявление о live authenticated render.
2. **B-2 / пункт 2:** PR #929 смержен 20 сентября в17:46:11Z, `0aca60dd26c7d8cb72d3b3b75c53d957145e6ed0`. Прежний OPEN/MERGEABLE относился к началу плана. 207 уже применена в локальной проверке; текущий211 Student readback снова подтвердил сохранение первого появления в каталоге после обновления карточки. Это не новая managed/production квитанция.
3. **B-3 / пункты 13, 17–21:** общий контракт принят; #944 и #946 MERGED, identities/selection/preparation подтверждены в пределах своих receipts. B218 requirements/Docs association принята через #964; локальный пакет из 13 фаз завершён, TS/Swift decoding PASS. Submit/versioned packages/review и полный web/iPhone путь ещё не завершены; номера и QA-окна координирует root.
4. **B-4 / пункты 23–25:** карта покрываемых portal/iOS экранов по настоящим задачам; отдельный дефектный блок focus/ExplainPanel/localized title после проверки актуального кода. Desktop + 320/390px, RU/KY, light/dark, клавиатура; native Dynamic Type и back. Аудит не означает наличие багов. Общие CSS и переводные файлы согласовывать секциями до правки.
5. **B-5 / остаток 26: выполнен, #939 MERGED `87514d27`.** Audit metadata отделена от клиентских runtime-полей; single source of truth и генерация сохранены. Это не массовый перенос фотографий. Смежное исправление portal theme вошло через #941 `6ceccf83` и не означает завершения всех пунктов 23–25.
6. **B-6 / пункты 27–28:** выполнить уже принятое владельцем решение о Student email confirmation от2026-09-19 ([действующий контракт](EVO_LAUNCH_PLAN.md#auth-email--smtp-and-templates-saved-delivery-pending-2026-09-19)), сверив текущий `/apply` и прежний `email_confirm: true`. Не переоткрывать вопрос о самой политике. SMTP/шаблоны не доказывают ни реализацию этого пути, ни доставку. Конкретные Auth/provider writes и отправка одобренному получателю требуют своей authority; реальная Resend delivery пока не подтверждена этим потоком.
7. **B-7 / пункты 31–32:** root подготовил metadata-сверку328 позиций и provenance двух approved company files/snippets; canonical dedup/записи ещё не подтверждены ([квитанция](qa/knowledge-source-reconciliation-2026-09-21.md)). Перенос 6568 материалов уже выполнен; 2655 вопросов допуска не закрывать автоматически. Не извлекать чувствительные applicant originals, не читать trash, не публиковать конфликтные цены/гарантии/персональные данные.

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
