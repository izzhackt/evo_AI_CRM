# CRM-30: сохранение независимых блоков карточки

Исходный main285e784e (#945), контрактdfb55be до кода, runtimeeb4502c.
Дата20.09.2026. Worktree `crm-grouped-card-saves`, Node22.23.1.

Текущее состояние: локальная213 исправлена до reviewed SHA7e7e1fe8; custom staff
проходит scoped authority и достигает field/revision validation. Два независимых
source/script review и10 actual Auth read/denials PASS, business hashes неизменны.
Положительные saves не выполнены. Первоначальные разделы ниже сохраняют
хронологию первоначального применения и обнаруженного блокера.

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
