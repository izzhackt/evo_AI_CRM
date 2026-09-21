# CRM UX и единое поступление — ведомость исполнения

Контракт: [план](EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md).
Начало: 2026-09-20, main `922483eb54c18a2da72bdd65fb503d728fa7af22`.
Статус: реализация начата; весь план не завершён. Здесь нет утверждения о
доставке в production без отдельной квитанции.

## Текущий checkpoint — 21 сентября 2026

Срез исходников: main `95cc9277db178e39466349a4ae9985f90887ad38` после #971.
#946, #948, #958, #959, #961, #960, #962, #963, #964, #966, #968, #969, #970
и #971 — MERGED. MERGED означает исходники, LOCAL — ограниченные фактические
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
- **#970:** из staff chat убраны автоматические task actions/enrichment.
  Local ordinary Sales UI проверен на существующих пустых каналах. A15b autosize
  находится в реализации после pre-code review; плоская хронология, цитаты,
  поиск/read/scroll — последующие согласованные срезы.
- **#971:** явные суммы и разделы договора/оплаты, сохранённые дополнительные
  операции и права. Local ordinary Admin UI1280/390/320 и parity пройдены без
  финансовых записей. Полный перенос договорного workflow и положительные
  транши/возвраты/чеки/mixed-currency/other-role UI ещё не завершены.

#964/B218: 13 фаз обычного Auth и 59 Swift decode PASS. Полные program requirements,
upload/save→submit→package/review остаются открытыми. B967 — DRAFT, head `8e8c81e1`,
runtime `2516de2d`: independent review, build и CI PASS, чтение существующей
подготовки в web проверено; первый новый выбор/init и native UI ещё pending.
Native UI ограничен заблокированным Mac. Локальное покрытие stable IDs через
существующий211 для четырёх карточек/пяти наборов: пакет и точные UI-intents
проверены, последовательная техническая публикация выполняется; результата
ещё нет в этом checkpoint. Факты каталога/порядок/прежние IDs сохраняются.
Это не managed publication или подтверждение всего admissions-пути.

## Блоки

| Блок плана | Реализация / проверка | Merge / production |
|---|---|---|
| Этап 0: контракт, worktree, координация | Изолированный worktree; исходный план сохранён без изменений; launch/decisions обновлены | MERGED #931, `8ef2aef01` |
| CRM-06: загрузка admissions board | Продолжен #913: unset GET args, сброс видимых фильтров, retry/Students; реальные чтения и desktop/390px UI пройдены, см. квитанцию ниже | MERGED #913, `fc13ed96d`; production не обновлён |
| CRM-08: правильный куратор, портал-доступ | Источник куратора и роли исправлены (#932); единый portal-access блок реализован, см. CRM-08b | MERGED #932, `819cd17d9`; #934, `dc3c246d4`; production не обновлён |
| CRM-02: права, продавец, дата/месяц, поиск/финансы/UX | #935/#956/#958: права и preview/edit/filter/reset/back; #960: pending-case handoff; #962: literal search до count/totals/page, LOCAL216 Auth/UI320/390 | MERGED; phone/contract positive, >50 и salesOther остаются недоказанными; direction facet/layout ещё открыты; [search receipt](qa/crm-sales-search-2026-09-21.md); production отдельно |
| CRM-09: стоимость → договор → платежи | #933 и #971: доступ к стоимости после handoff, понятные суммы/разделы и сохранённые дополнительные операции; actual Admin read-only UI1280/390/320 | MERGED; полный перенос договорных команд ещё открыт, managed отдельно |
| CRM-03: заявки, источники и пагинация | #968: LOCAL221, 35 Auth reads и actual UI1280/390/320, server filter/cursor/return/history | MERGED; другие источники/pending positive отсутствовали, managed отдельно |
| CRM-01: текущие количества в воронке продаж | Обычные Auth/RPC/UI на прежних локальных QA-входах проверены; [квитанция](qa/crm-01-current-funnel-2026-09-20.md) | MERGED #943 `1795bf23`; SQL210 применена только локально, production не изменён этим блоком |
| CRM-05: операционная воронка | Подтверждённый handoff, owner-filter и mobile stage tabs проверены локально на320/390 и desktop | MERGED #945/#953/#959; реальные stage mutations не выполнялись этим UI-срезом |
| CRM-04/07: inbox и сообщения | Inbox empty/filter/channel states и поиск Student messages с loading/empty/error/retry защищены от устаревшего ответа; actual local read/UI desktop/390px проверены. Очереди и остальные сценарии остаются | MERGED #952 `f97122e8`, #955 `fe26526c`; [Inbox](qa/crm-inbox-states-2026-09-21.md), [messages](qa/case-chat-search-2026-09-21.md); без send/mark-read/provider actions |
| Сохранение отдельных блоков карточки / пункт 30 | LOCAL213: actual UPDATE двух блоков, sibling draft, replay/conflict/stale и restore26 полей; B sale INSERT отдельно | MERGED #948; не UI-приёмка всех групп, managed/production delivery отдельно |
| CRM-10: EVO Docs и университеты | B218 общие требования/файлы MERGED #964, 13 фаз Auth; B967 новый UI DRAFT с review/build и ограниченным web-read proof | Полные requirements, upload/submit/versioned packages/review не завершены; native UI pending |
| Командный чат | #970 убрал task actions/enrichment; A15b autosize в реализации после pre-code review | Частично MERGED; flat chronology/quotes/search/read/scroll остаются |
| Личный календарь | #954 explicit case choice; #963 личные case/staff задачи, exact count/keyset и own target; LOCAL217 Auth/denials + UI320/390/desktop | MERGED #963 `401069a4`; dated/staff positive, >100 UI и concurrent reassignment не доказаны; [receipt](qa/personal-calendar-2026-09-21.md) |
| §11: общие программы, требования, версии, пакеты и review | #944 stable intake IDs; #946 selection/preparation. LOCAL214 positive ordinary Auth + TS/Swift read/decode; нового web/iPhone UI proof нет. B218 requirements association принята через #964 | MERGED #944/#946; #964 MERGED, локальный Auth-пакет завершён; дальнейшие packages/review и managed delivery не приняты |
| Web и iPhone полного нового admissions-пути | Общие214 readers проверены, полный новый UI-путь ожидает следующих операций | Не завершён; не расширять TS/Swift evidence до browser/device acceptance |
| CRM shell / пункт 22 | #961 keyboard skip-navigation MERGED | Узкий срез, остальная оболочка и полная a11y-приёмка открыты |
| Legacy optional application fields / пункт 29 | Root219 applied / function QA failed; forward repair220 на review; 222 pre-code отдельно | Нет suitable pinned QA positive; не завершено |
| Точечная приёмка §13, итоговый аудит scope | Ожидает реализации блоков | — |

## Решения владельца и границы

- Решено владельцем: подготовка открывается сразу после выбора программы, без отдельного одобрения сотрудником.
- Решено владельцем: сохранить нынешнюю компоновку сводки и списка студентов.
- Исключение служебной продажи требует доказанного ID и назначения; исторические
  записи не удалять и не выбирать по похожему имени.
- Production-миграции, записи и release требуют отдельной действующей authority.
- Конкретный B214 local QA packet разрешён владельцем ответом «ок» в задаче B.
  Выполненный literal save группы sale дал INSERT/replay/conflict/stale proof;
  отдельный A213 UPDATE/cross-group/UI пакет затем принят в #948. Это разные
  доказательства; разрешение того пакета не расширяет текущие QA-полномочия.
- #929 / migration 207 — соседний блок, не доказательство готовности этого плана.
- Общие final E2E, массовая контентная волна и App Store (37–50) исключены.
  Содержательная KB-очередь31–32 остаётся в принятом объёме; перенос не повторять.

## Метод проверки

Реальные изменённые пути с существующей авторизацией и минимальными нужными
проверками. Чтение текущих данных разрешено; не создавать продажи, клиентские
сообщения и документы ради проверки без авторизованного QA-сценария. Не заменять
отсутствующую runtime-проверку mock-данными или зелёным source-тестом.
Каждый блок фиксирует точную ревизию, результат, ограничения, review и доставку.

## CRM-06 — локальная квитанция 2026-09-20

- База после согласования: main `8ef2aef0114c81248421efe355dbae19d276d025`.
  Существующий #913 обновлён без дублирования RPC-исправления.
- На baseline под текущей реальной Admin-сессией `/v3/admissions-pipeline`
  воспроизведена ошибка чтения. С исправлением против того же managed Supabase:
  2 существующих тестовых дела без фильтра; 1 при выборе назначенного куратора;
  сброс возвращает 2 и надпись «Все кураторы». Обе вкладки загружаются;
  в визовой вкладке текущие количества нулевые, а не ошибка.
- Desktop и 390×844: поля, вкладки и карточки доступны, на узком экране работает
  существующий выбор этапа. Размер подписи фильтров поднят до штатного text-xs.
  Локальные скриншоты в ignored `.next/crm-ux-proof/`; клиентские данные не
  публикуются как Git-артефакты.
- 17 focused pipeline source-contract tests, scoped ESLint и diff check passed.
  Impeccable detect: код 0, замечаний не выдал. Это дополнение к реальному UI,
  а не замена проверки HTTP. Новая recovery-кнопка проверена по коду; новая
  ошибка сервиса специально не фабриковалась, runtime retry ещё не заявлен.
- Назначения, перемещения, сообщения и документы не изменялись. Deployment и
  проверки production этой версии ещё не выполнены.

Проверенные исходники (SHA-256):
- `src/lib/platform-admissions-pipeline.ts`: `adb9b82e29dd67ec0792ce8b21470b2a84834a3c8611d6d7b905e33830e92ec7`
- `src/app/(v3)/v3/admissions-pipeline/page.tsx`: `89ad3552202feea0486d6041f78d9435adc2a2226c8e519b234674e7b6293d73`
- `src/components/v3/AdmissionsPipelineBoard.tsx`: `cf446c54e2732c787e5540f7958dd7679f4e02c82aae79b5faf3756c8845bf32`

## CRM-08a — текущий куратор, 2026-09-20

На существующем тестовом handoff-деле baseline показывал в шапке sales owner,
отличавшегося от назначенного куратора в воронке. После исправления `/profile?case=`
показывает именно текущего куратора. `/profile?id=` для связанного лида сохраняет
отдельного sales owner с подписью «Менеджер продаж», а в кратком обзоре показывает
текущего «Куратора». Изменение относится к full-case adapter; lead-only owner
и назначения не менялись. Никаких данных для проверки не создавали и не изменяли.

Проверено на реальном локальном Next.js против managed Supabase под текущей
Admin-сессией. Scoped ESLint и `git diff --check` пройдены. Подписи проверены
в desktop UI; нет нового layout. Изолированные unit-mocks не использовались.
Имя/UUID клиента и содержимое карточки не публикуются как proof в репозитории.

Owner decisions §14 записаны в этом же срезе: немедленная подготовка программы;
существующее расположение сводки студентов. Обе зависимости закрыты.

SHA-256 исходников:
- `src/lib/v3/profile-source.ts`: `cd96470fa9d85f0744c23a23b799440b13dd36a28474be73cd913e1528b9d648`
- `src/components/v3/profile/tabs.tsx`: `88d90f29e89b25704866a102cd978408f25c4d797098928e55dea581f93b1f62`

## CRM-09a — доступ к условиям продажи после handoff, 2026-09-20

На существующем тестовом деле локальное приложение с реальной Admin-сессией и
managed Supabase подтвердило baseline: ссылка «Стоимость не указана» открывала
обзор без редактора. Теперь переход из «Денег» ведёт к `#sale-conditions`,
показывает тот же revisioned редактор и ссылку на существующую запись продажи.

При открытии обнаружен реальный decoder-сбой пустого года поступления: SQL 184
возвращает null. Исправлено точное соответствие null пустому полю; после этого
карточка и редактор успешно открываются. Сохранение условий/платежей не выполняли,
данные не создавали. Это проверка чтения и навигации, а не приёмка финансовых writes.

Desktop и 390×844 осмотрены через Impeccable. Исправлен обнаруженный дефект формы:
у валют появились различимые подписи, ширина вмещает «Не указана», поля выровнены.
Скриншоты остаются локально в ignored `.next/crm-ux-proof/`; персональные данные
и UUID в репозиторий не публикуются. Detector отмечает только прежний, не изменённый
в этом срезе `border-s-2` финансового стопа.

Scoped ESLint, `git diff --check` и 45 существующих source-contract проверок
`v3-case-agreement` / `platform-sales-actions` пройдены. Они не заменяют живой
путь выше. RPC, RLS, optimistic revision и idempotency не менялись. Preview и
актёр без `lead.sales.workflow.manage` получают read-only форму. Эта UI-ветка
проверена по коду; авторизация отдельной Sales-сессией не заявляется.

SHA-256 изменённых runtime-файлов:
- `src/lib/v3/profile-source.ts`: `6ab8e074736eee5c391dcbe738fc976b26632bd64800a5d0b92efd9cbc737b67`
- `src/lib/lead-sale-conditions-contract.ts`: `288bd34fa168792b437cf32a6d1c1a0e36003992acabdd7332d7283f3c656b6e`
- `src/components/v3/profile/Profile.tsx`: `08a734b60be900668a97ed32482cd0bd918d3f6688feaeb8163e1b65adedbe0f`
- `src/components/v3/profile/tabs.tsx`: `0a4b7959fbe151812c095bf80a6eefc097b95062815d8fa5e6bf48a72fdf5fd4`
- `src/components/v3/profile/CaseAgreementBlock.tsx`: `191248d3fb71d0e455562eb031cbea280be1bf02b0ca372fea87b9bcfbc40fe7`
- `src/components/v3/profile/LeadSaleConditions.tsx`: `4775a02e3c4435a13219f6cafce70f26372fa554a7fd5994786209ee4001ba3c`

## CRM-08b — единый блок доступа, 2026-09-20

На том же существующем тестовом деле реальный локальный Next.js / managed
Supabase / Admin проверен через оба входа: `/profile?id=` и `/profile?case=`.
В обзоре ровно один раздел «Доступ к порталу», ноль кнопок «Подготовить кабинет»
для уже созданного дела и один набор существующих invite controls. «Открыть дело»
ведёт в анкету именно связанного дела. Desktop и 390×844 осмотрены; снимки только
в ignored `.next/crm-ux-proof/portal-access-*.png`, без публикации личных данных.

Приглашения, повторные приглашения, решения по заявкам и Auth не изменяли:
этот runtime receipt подтверждает чтение/компоновку/навигацию. Все mutation forms,
request IDs, поля, state machine и прежний gate Admin / Sales cabinet_pending
сохранены; их provider-выполнение в этом срезе не заявляется.

TypeScript, scoped ESLint и diff check прошли. 11 provisioning contract-проверок
прошли с обязательным для server-only `--conditions=react-server`; 7 профильных
проверок прошли. Первый запуск provisioning без этого флага завершился ошибкой
окружения, затем команда исправлена. Один существующий source assertion обновлён
под имя вынесенных Controls, без изменения проверяемого gate. Detector новых
компонентов чист; прежний `border-s-2` стопа в tabs остаётся вне этого среза.

SHA-256 runtime-файлов:
- `src/components/v3/profile/Profile.tsx`: `56da8b7885aca3c2b6e1caa84e729e3860fd495cbb52c0b7fe1bbd21cf15bcc1`
- `src/components/v3/profile/tabs.tsx`: `cf5cbe894c01855bcd9db90ab91c2a9163713a382d560f5c73803da1a39606e9`
- `src/components/v3/profile/StudentPortalAccessCard.tsx`: `fbd292ca3eeeff6c4c239c890a17f06fd6e2c63b560b1e67cf968ce7e90b6193`


## CRM-02a — полномочия и факт продажи, 2026-09-20

Реализован серверный Sales Manager gate без автоматического Admin-исключения;
привязка использует UUID проверенной текущей роли и закрытый workflow_key.
Guard охватывает создание через отчёт, исторические исправления/архив и старую
автоматическую запись при handoff. Импорт и планы отдела сохраняют свои права.
Месяц новых продаж и продавец берутся из одной серверной функции карточки;
исторические строки не пересчитываются. Роль, назначения и условия продажи
в managed Supabase не менялись.

Проверено:
- TypeScript, scoped ESLint, diff check; 6 существующих sales contract-проверок.
  Прежнее source-ожидание report_month в payload обновлено под новый контракт.
- 208 применилась в отдельной локальной БД `evo_crm_sales_contract_20260920`
  на schema-only копии. Тела трёх заменяемых функций копии сравнены с managed
  Supabase read-only; совпали. Копия не содержит пользователей/продаж.
- SQL catalog/ACL и настоящие вызовы RPC без сессии: отказ 42501. Проверка
  не создаёт выдуманных акторов или бизнес-строк. В исходной schema-only копии
  отсутствовали schema USAGE grants; для rehearsal восстановлены только
  существующие usage platform/private/auth для authenticated. Первый restore
  от postgres не смог сменить owner на supabase_admin; собственная пустая БД
  пересоздана и окончательный restore/apply выполнены её supabase_admin.
- Реальный локальный Next.js / текущая Admin-сессия / managed Supabase: отчёт
  продолжает читать существующие записи, отсутствие нового access RPC честно
  показывает ошибку проверки и скрывает запись. Desktop и 390×844 осмотрены.
  Снимки локальные ignored, без публикации персональных данных. Detector чист.

На момент ранней schema-only проверки не было подтверждено (закрыто локальной приёмкой ниже): новый разрешённый RPC
под Sales Manager; отрицательные проходы Sales и Admin без роли; сохранение и
повтор запроса, прошлый/следующий месяц, подтверждённый другой продавец,
оба пути handoff, историческое исправление с причиной, быстрая смена человека
в реальной форме. Тогда UI формы и успеха ещё не был осмотрен на фактически созданной
QA-продаже; теперь desktop/390 px проверены. Миграция 208 не применена в managed Supabase; server release не делали.
Технические проверки выше не обозначают приёмку этих бизнес-сценариев.

Первое независимое review `70cec4d4` вернуло changes_requested: отзыв роли
мог завершиться между проверкой и получением ожидаемой строки. Исправлено
блокировкой организации до авторизации на write-entry; повторный полный apply
208 к своей schema-only БД и ACL/no-session/lock-order checks прошли.
Конкурентная бизнес-проверка затем пройдена в реальном локальном Auth-контуре;
имитация акторов не выполнялась. Файлы окончательной проверки имеют суффикс `-final.txt`.

CRM-02a, обновление полосы A 20.09.2026: #935 синхронизирован с main
`6edf93d4`; разрешён только конфликт журнала планов, runtime и SQL прежние.
Свежие scoped ESLint и 6/6 sales Node-проверок прошли. Managed ledger
прочитан заново: 001–206, без пропусков; 207/208 отсутствуют. Обычный вход
существующего QA Student подтвердил основную EVO-организацию, не отдельный
sales QA tenant. [Конкретный пакет применения и QA](qa/migrations-207-208-qa-packet-2026-09-20.md)
подготовлен; общей DB/Auth/business-write authority пока нет. Draft сохранён до итогового exact-head review/CI; managed business acceptance
и server release не выполнялись.

Read-only impact preflight подтвердил deployed frontend `b7598a1c`: его формы
ещё разрешают cost-only ввод, сохраняют прежний фильтр и permission-only controls.
С SQL 208 это даёт отказ/скрытую в другом месяце строку; совпадение RPC signatures
не устраняет UX-разрыв. Из двух текущих manage identities только одна проходит
будущий manager gate. Поэтому standalone shared 208 ради QA не предлагается:
схема ждёт согласованного frontend+SQL выпуска. Отдельная техническая premerge-проверка выполнена в одноразовом локальном
Auth/DB/API-контуре; результаты приведены ниже.


## CRM-02a — настоящая локальная приёмка завершена

[Квитанция с привязкой к runtime и хэшами снимков](qa/crm-02a-local-real-acceptance-2026-09-20.md)
фиксирует отдельный контур `evo-local-0fd3559d0240c989`, schema 001–208.
Обычные Auth logins, Admin bootstrap, роли и приглашения через реальную форму
и local Mailpit, RPC создания лидов/условий, browser Save и readback пройдены.
Миграция 207 присутствует только в disposable stack, не в diff #935.

Проверены все три месяца, владелец лида вместо нажавшего менеджера, отсутствие
дубликата при replay, обязательная дата, нормальный старый handoff, исправление
с приватной причиной и версией, быстрый выбор человека, переход в дело и 390 px.
Sales/Admin без manager role, Admissions и anonymous не могут записывать.
Два настоящих конкурентных RPC наблюдались ожидающими блокировки организации:
отзыв роли завершился первым, ожидающее сохранение получило 42501, версия и
содержимое не изменились. После проверок временные назначения сняты, baseline
менеджера восстановлен. Общий audit намеренно не раскрывает свободный текст
причины; причина проверена в приватной истории через owned-local READ ONLY.

Финальное source/local review и CI выполняются отдельно. Shared 208 и frontend
в production не выпущены. Обнаруженный B дефект public approval → own-case scope
ведётся отдельно как 209; эти CRM-проверки выполнены до его применения.
