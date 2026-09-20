# CRM-30: сохранение независимых блоков карточки

Исходный main285e784e (#945), контрактdfb55be до кода, runtimeeb4502c.
Дата20.09.2026. Worktree `crm-grouped-card-saves`, Node22.23.1.

Текущее состояние на21.09.2026: положительный UI→Auth→local DB UPDATE, сохранение
соседнего draft, exact replay/conflict/stale и guarded restore пройдены. Отдельный
B packet подтвердил INSERT sale-группы; его последующий handoff встретил другой
дефект208/126 и откатился, исправление выделено B215. Все26 исходных A-полей и
financial snapshot восстановлены/сохранены; ровно4 новые receipts/audits остаются.
Детали и ограничения — в последнем разделе. Прежние HOLD/«не выполнено» ниже
сохраняют историю проверки и не описывают текущий статус. Managed/prod не трогали.

## Исправление

Три формы отправляли соседние значения из старого SSR с уже новой revision,
что позволяло заменить сохранённые данные. Четвёртая форма «Условия продажи»
отправляла12 полей вместо29, требуемых прежним action, и не доходила до RPC.

213 добавляет отдельный grouped writer с четырьмя exact-key группами9/6/5/6.
Новый action отправляет только выбранную группу. В БД сервер объединяет patch
с актуальной заблокированной строкой, проверяет revision, fresh actor/org/record
authority и сохраняет прежние receipt/audit shapes. Fingerprint использует
оригинальную команду до merge; replay не зависит от последующего состояния.
Уникальный receipt conflict откатывает всю команду. Старый v1 action byte-identical,
миграции001–212 не изменены. Shared client revision только растёт; drafts не remount.

## Выполнено до применения213

- `npm ci --ignore-scripts`, Next typegen, `tsc --noEmit`: PASS.
- ESLint только четырёх изменённых TS/TSX файлов: PASS.
- `tests/platform-sales-actions.test.mjs`:7/7 PASS (старые source guards).
- `V3 owns the only Sales decision, gate and handoff interface`:1/1 PASS;
  инвентарь формы обновлён на новый action.
- pglast:5 SQL statements и1 PL/pgSQL function parsed. Это syntax proof,
  не применение миграции и не выполнение RPC.
- `git diff --check`: PASS.
- В обычной существующей Sales-сессии на localhost33219 открыт прежний
  `Local QA sale current`, схема пока212. Профиль читает реальные local QA-данные.
  Проверены DOM names четырёх форм:13/10/9/10 =4 command fields +9/6/5/6 own fields;
  служебные `$ACTION_*` React не входят в этот подсчёт. Соседних business keys нет.
  Значения hidden inputs инструмент маскирует; значения group подтверждены
  исходным TSX, не выдаются за прочитанные из DOM. Ни одна форма не отправлена.
- Визуально просмотрены desktop и мобильная форма. У первого viewport resize
  фактическая ширина оказалась520, поэтому этот снимок не доказывает390.
  Отдельная подтверждённая эмуляция390: innerWidth=scrollWidth=390,
  четыре кнопки сохранения44px, горизонтального overflow страницы нет.
  Эмуляция сброшена. CSS, labels, расположение и состав видимых полей сохранены.

Локальные игнорируемые артефакты: `.next/crm-30-proof/form-shape.json`,
`desktop.png`, `mobile-390.png` (фактически520),
`mobile-390-confirmed.png`, `mobile-metrics.json`.

## Ещё не доказано

213 не применена. Положительный grouped RPC/UI save, sibling draft/persisted
preservation, replay/conflict/stale, denied actors на новом RPC и неизменность
финансового snapshot/case/docs ещё не выполнены. Два независимых exact-head
review и protected CI ожидаются; production/managed SQL не выполнялись.

Для конкретного QA разрешения подготовлен приватный пакет на один существующий
lead, два явных временных QA-текста в wishes/education и четыре successful saves
(включая восстановление прежних пустых значений через обычный API). Ожидаются
четыре append-only receipts/audit и revision+4; не удалять историю. Проверка
перед восстановлением должна исключить посторонние изменения. Новые сущности,
Auth/роли, продажи и финансовая форма этим пакетом не разрешаются.

После source review и согласованного окна A применяет213 перед214. Даже успешная
локальная QA-проверка является техническим доказательством, не клиентской приёмкой.

## Поправка после независимого review

Spec review ae8dd7a7: source APPROVED. Standards review обнаружило P2:
название группы читалось из raw FormData до распаковки React19 envelope;
outcome также должен брать исходные ID из декодированной формы. Добавлен
`decodeLeadSaleConditionsGroupForm`: перебирает четыре закрытые exact schemas,
затем читает discriminator и нормализует commandForm для всего нового action.
Старый v1 action и SQL213 остаются неизменными.

Шесть новых runtime parser-проверок: четыре direct формы; четыре React envelopes
с сохранением command IDs; duplicates; missing/sibling keys; mismatched/unknown
groups; mixed/incomplete envelopes. Все6 PASS, без RPC/Auth mocks. Scoped lint PASS.
Прямой tsc во время dev-сервера встретил повреждённый generated
`.next/dev/types/routes.d.ts`; после остановки своего33219 выполнен штатный
`npm run typecheck` с предусмотренной cleanup/typegen: PASS. Продуктовый source
ради этого не менялся. Positive save/apply по-прежнему pending, нужен delta review.

## Локальное применение и реальный authority blocker

Два независимых source delta review одобрилиd3cd90254b610910f5372dfbe175e443028bc1ee.
После отдельного решения root213 применена только в существующей локальной QA:
schema001–213, SHA7b507099bd5433a507457e17f19b86374c201ab32b7fad00f6cd4977ed0c6ee7.
Проверены прежние212 migration bytes и contiguous ledger. Counts/hashes leads,
cases, sales, handoffs, conditions/receipts, audit, document slots/versions/reviews,
applications и число Auth users не изменились. Private `local213-receipt.json`.

Подготовленный10-check script остановился на preflight: он ошибочно ожидал
literal `platform_role=sales`, тогда как настоящий существующий SalesManager
имеет `platform_role=NULL` и действующее `lead.sales.workflow.manage`.
Это не отказ Auth: обычный sign-in и authority/snapshot RPC успешны. Реальная
карточка разрешает редактирование по permission (`tabs.tsx:154`), а SQL213
копирует из181 literal `IN ('admin','sales')` и исключает custom role.
Отдельный заведомо неполный wishes patch подтверждённо вернул42501
`lead_sale_conditions_forbidden`, data=null. После него hashes тоже неизменны.
Это одна диагностическая denial-проверка, не10/10PASS и не proof успешного save.

Минимальный кандидат correction: два actor predicates заменить на
`IS DISTINCT FROM 'student'`, сохранив fresh organization/actor и точный
per-record `staff_can_access(...,'lead.sales.workflow.manage','lead',id)` перед
и после locks, включая replay. Это существующая scoped-staff модель156.
v1 остаётся историческим без изменения,208 уже permission-based и отдельно
проверяется B; не расширять этот срез на208.

213 ещё draft и не main/managed. Политика `docs/platform/p2-supabase-foundation.md`
правило5 запрещает изменение после merge; отдельная local candidate correction
процедура требует согласования root. Исходные applied hash/ledger/receipt не
изменялись. Кандидат пока private NOTAPPLIED, номер215 не занят. Owner-пакет
четырёх положительных технических saves остаётся HOLD.

## Correction candidate перед повторным независимым review

Контракт amendment d5216ab6 записан до code. Изменены ровно два actor predicates
213; SQL/PLpgSQL parse PASS (5 statements /1 function). Никакие UI/TS/старые
миграции не менялись; ранее полученное parser/lint/typecheck proof относится
к неизменному TypeScript d3cd9025. Установленная локальная213 пока old hash.

Root выбрал explicit one-time local candidate correction: full original
ledger/function/archive + original apply receipt сохраняются; guarded transaction
меняет только эту function body и statements одной ledger row213 с full-old-row
CAS. Все function attributes/ACL/owner/OID/signature и001–212 ledger неизменны,
214 отсутствует, protected business hashes равны. Local candidate file/config
выравниваются после COMMIT; original schemaExtensions apply запись сохранена,
correction добавляется отдельно. При любом неизвестном состоянии STOP; нет
reset/delete/reinsert, Auth/business/provider/managed writes.

Private review script `/private/tmp/evo-a213-correct-candidate.py`, SHA256
`bdc9fdd59ecb2f5042ba5eff696ab82f642d476bcd72214c00144eec39a84c1e`. `py_compile` PASS; execution ещё не выполнена.
`--prepare` читает только owned local/current GitHub, архивирует baseline и
точный transaction SQL; `--apply` требует exact reviewed source/script, проверяет
open draft/not-main и повторяет guards. Перед DDL нужны два независимых review
source и script/transaction. Исправлен local denial harness: custom staff
проверяется по настоящему Auth + staff_access_snapshot/permission, Student —
по прежнему отдельному identity path. Его read/denials ещё не выполнены.
Owner positive packet остаётся HOLD.

## Выполненная bounded local correction и10 проверок

Два независимых reviewers (pr935_spec, pr935_standards) одобрили exact source
`ae83aedd863ed70b08d4fe989a53bb69d5e3cc4e`, script
`bdc9fdd59ecb2f5042ba5eff696ab82f642d476bcd72214c00144eec39a84c1e` и prepared SQL
`435da496d7e65894bc00b2ab72687a1ec414d2fa307e40ebf46cc1efabbdcba4`.
После этого разрешённая correction выполнена один раз: PASS. Source/local file
и ledger213 statements соответствуют новому SHA
`7e7e1fe8148f3cba4705d30f9fae25e45fa6e3c7f92b43c065a13b6be01e3e4d`.
Весь pg_proc row изменился только в prosrc; ACL/owner/OID/signature/SECURITY
DEFINER/search_path и остальные attributes прежние. Ledger001–212 неизменен,
214 отсутствовала. Все11 перечисленных business table hashes/counts и число
Auth users совпали. Это проверка числа Auth users, не hash всего Auth content.

Original apply receipt и schemaExtensions entry остались с исходным hash7b507099;
отдельный candidateCorrections entry и create-only correction receipt содержат
старое/новое состояния, exact DDL и ledger delta. Body hashes:
old `e614a28cb70a638c7f928a68ea6d5dae270df48bff10c24441dc5e49782d4a86`,
new `621650c385121da6be4385cc5d273771213ef9e94a9b380103a85363f6b72c88`.
Private receipts в существующем owned QA root:
`a213-correction-prepared.json`, `a213-correction-transaction.json`,
`a213-correction-receipt.json`; initial `local213-receipt.json` не переписан.

Затем на том же reviewed source выполнен normal Auth harness:10/10 PASS:
1. Существующий custom SalesManager читает реальные revision/поля выбранного lead.
2. Anonymous writer denied42501.
3. Existing Student writer denied42501.
4. Existing Admissions без workflow permission denied42501.
5. Unknown group22023.
6. Missing own key22023.
7. Sibling extra key22023.
8. Null request ID22023.
9. Actual revision minus1 rejectedPT409.
10. Невалидный wishes year22023.

`a213-local-denials-receipt.json` фиксирует каждый ответ/data-null и before/after
business parity. Неполный patch теперь доходит до22023 вместо ошибочного42501,
а stale request — доPT409: выявленный literal-role blocker снят. Все проверки
использовали существующие inputs и обычный Auth, без новых entities/назначений.
Positive saves, sibling persistence после save, replay/conflict и restore всё ещё
не выполнены; отдельный owner packet остаётся HOLD. Нельзя считать10 denials
доказательством успешного сохранения или deployment.

После proof интегрированы main#950/#951 без конфликтов: diff ae83aedd→merge head
в src/supabase/tests пуст. Их changes относятся к отдельным Inbox/docs slices;
этот proof относится к неизменному runtime ae83aedd. Финальный docs/merge delta
review и protected CI проверяются на новом head отдельно.

## Положительная приёмка 21.09.2026 — INSERT и actual UI UPDATE

Окно A:20.09 21:27:02–21:32:57Z (21.09 Asia/Dubai), исходный UI/runtime
`52a00103449d703d2f675e98770a9fbb21e95075`, contract head
`ac83fc2cc803bc94ff3d14ea9ecec3846deaa612`; src/supabase/tests между ними
совпадали. Local schema001–214;213 SQL SHA
`7e7e1fe8148f3cba4705d30f9fae25e45fa6e3c7f92b43c065a13b6be01e3e4d`.
Root исправил прежнюю избыточную трактовку A4save HOLD на основании действующего
поручения продолжить план и необходимые обратимые local QA проверки. Это не новый
ответ владельца и не расширение на managed/customer/Auth/provider операции.
A начал запись только после B writer release и root GO; B одновременно read-only.

### Отдельный B INSERT proof

Владелец согласовал конкретный frozen B214 local QA packet в задаче B. Existing
Sales Auth, один существующий lead/case, literal9 полей sale, synthetic1KGS/0paid:
- INSERT revision0→1; одна receipt/audit, остальные17 полей равны defaults.
- Exact replay вернул исходную квитанцию без записи; тот же request с изменённой
  revision отвергнут22023; новый prepared request со старой revision — PT409.
- A readonly snapshots после каждого шага подтвердили business parity за пределами
  разрешённых conditions/receipt/audit. Initial before_owner capture оказался после
  уже выполненного B assignment и честно FAIL unexpected_lead_owner; он не используется
  как before proof. Conditions baseline получен после assignment, до INSERT.
- Следующий208 handoff вернул HTTP500/40001 portal_identity_conflict. Отдельные
  snapshots20 таблиц плюс scopes/access versions/functions/ledger доказали полный
  rollback этого вызова. Ранее выполненные assignment/conditions1 сохранены.
  Selection214 тогда не выполнялся. Этот дефект не объявляется исправленным213.

### Исходный A two-field / four-save packet

Fresh ordinary Sales Auth прочитал тот же Local QA sale current, все26 исходных
полей и linked financial DTO. Начальная revision3; wishes_countries и
education_english пустые. Перед первой UI отправкой введены оба временных текста.

1. Настоящая Chrome форма wishes отправила6 собственных ключей, expected_revision3,
   request `e2df7ae6-69ee-48ee-b336-a3bc0dbb67f8`. Видимое «Сохранено», revision4;
   education draft остался в DOM с точным введённым текстом. DB observer подтвердил
   изменение только wishes_countries и одну receipt/audit.
2. Без reload/remount education отправила5 собственных ключей, expected_revision4,
   request `47de7189-81de-4ad9-90b2-7daa55a081a6`. Видимое «Сохранено», revision5;
   оба значения сохранены, остальные24 исходных поля совпали. Это actual network
   multipart capture, а не предположение из исходного TSX или masked hidden inputs.
   Auxiliary notification POST не считается business save.
3. Ordinary Auth exact replay исходной wishes-команды при current revision5 вернул
   прежнюю полную receipt revision4. Изменённый intent с тем же ID —22023,
   новый frozen ID со старой revision —PT409. Readonly state после всех этих вызовов
   точно равен snapshot после education: лишних receipts/audits/изменений нет.
4. Guarded ordinary API restore сверил revision, точные наши markers, все прочие
   исходные поля и financial DTO; wishes5→6, education6→7. Оба исходных пустых
   значения восстановлены. Все26 полей равны baseline; новая UI reload показывает
   пустые Страны/Уровень английского. Собственные вкладка и dev-server закрыты.

Сохранены4 новых receipts и4 audit (итого7/7 с прежними3), revision3→7.
Все прежние history rows неизменны. Twenty-table observer сверил counts/hashes:
за пределами целевых conditions/receipt/audit business state полностью совпал,
other-row hashes этих трёх таблиц также совпали. Case/sales/documents/applications,
profiles/memberships/scopes/assignment+lifecycle events не изменились. Ledger и
число Auth users совпали; hash полного Auth content не проверялся. Обычный RPC
financial selected DTO также точно совпал с baseline. Новых entities/ролей/
финансовых записей, direct SQL business writes и удалений истории не было.

### Сохранённая ошибка проверочного скрипта

Первая попытка replay получила корректный22023 request_id_conflict, после чего
assert остановил script. Причина — private MIME parser декодировал русский текст
как ASCII с replacement characters, то есть отправил другой intent. Неизменный
failure не повторяли: исходные command/response/started artifacts сохранены,
UTF8 extraction исправлена в отдельном файле и сверена с exact UI capture/packet.
Затем исправленный exact replay прошёл; state observer подтвердил, что ошибочная
команда ничего не записала. Это ошибка инструмента проверки, не product regression
и не замена failure искусственным green. Две read-only parser попытки до corrected
artifact также завершались KeyError по имени discriminator, без RPC.

Private evidence в `/private/tmp/evo-database-foundation.WhSt8z` (0600, в Git не
копируются credentials, headers/cookies и полные local snapshots):

| Артефакт | SHA-256 |
| --- | --- |
| a213-ui-proof-complete.json | 629d7067730c288f36ba2dc053a19fa580a5a04e1d49510b505fabc1bf83b3e9 |
| a213-ui-observer-before_ui.json | b3fa0956b80d91eee1a6f289a13472e347620d69f43630fe840fcf1c7b452e66 |
| a213-ui-observer-after_restore_education.json | d4b8d47bb0b03a015fedd4f381ffd929108969d3b495695cf467161c6cd1130b |
| a213-ui-api-checks_utf8-result.json | 9665642177fc4039940d441426bf674eef69c207aea0d292f93fd497c68c7e86 |
| a213-ui-api-replay-response.json (первый FAIL) | 019487497cab7ff3151396bfb11ded3c3e0d1f45336cd48da6c65fdc4346a1a5 |
| a213-b214-observer-after_stale.json | 0f57bad2629b7aa9b473a5980369770940453d76f8a1bae8bd2ea86b90ea5bb4 |
| a-b214-observer-after_handoff.json | a1f26ab54cdc08a7fa1621ac9f0fb734caedb06074dd54c0c77c553c28903ea6 |

После проверки интегрирован main`3500fa8b` (merge`5e556b2d`). Все grouped-save
runtime files и SQL213 неизменны; чужие проверенные Inbox/filter/preview/chat/task
срезы сохранены. Конфликты только в трёх docs, обе shared appendices сохранены,
текущий статус CRM-30 обновлён. Старую визуальную390px проверку не выдаём за новую:
формы/CSS неизменны. Это ограниченная техническая local QA, не production release,
финальная E2E или подтверждение других групп conditions/UI sale через браузер.

На интегрированном source `5e556b2d`: штатный `npm run typecheck` PASS после
остановки собственного dev server; parser6 + прежние Sales action guards7 =13/13
PASS, отдельный целевой V3 Sales interface guard1/1 PASS. Diff scoped runtime
files/tests/SQL213 против ac83fc2c пуст, `git diff --check` PASS. Финальный
exact-head review и protected CI проверяются отдельно; эти локальные результаты
не заменяют их и не требуют повторения уже неизменного business QA packet.
