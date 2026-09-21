# Полоса A: CRM сотрудников и техническая основа

Дата: 20 сентября 2026. База: `3ac6f326c`. Исполнитель A работает отдельно от
полосы B; общий main, миграции и release координирует root. Это план выполнения,
не утверждение готовности. Пункты 37–50 не запускаются.

## Текущий checkpoint — 21 сентября 2026

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

## Первый срез A-1 — пункты 4 и 34

PR #847 меняет AnyIO lockfile; текущий classifier считает его unknown и блокирует
Fast checks. Добавить узкую классификацию только `evo-lead-agent/pyproject.toml`
и `evo-lead-agent/uv.lock`, самостоятельную locked-install проверку и реальный
локальный HTTP smoke приложения на Python 3.13. Проверять health, request-id,
ошибку неизвестного route и frozen webhook через HTTPX/AnyIO/Uvicorn/FastAPI.
Worker выключен, dotenv запрещён, SQLite временная, starter knowledge выключена;
никаких provider calls или клиентских записей. Не открывать весь Python source
как автоматически проверенный scope. Unknown/mixed/rename остаются fail-closed.
Изменение CI отдельно от dependency PR; #847 проверяется дополнительно на своём
lockfile. Без merge/deploy до координации и независимого exact-head review.

Официальный контракт uv: `sync --locked` отклоняет устаревший lockfile вместо
перезаписи; https://docs.astral.sh/uv/concepts/projects/sync/ (проверено 20.09).

A-1 принят в main через #938 (`7b0cfc7e`) после независимого exact-head review
и GitHub CI. Локальные результаты и ограничения — в
[квитанции](qa/lead-agent-dependency-ci-2026-09-20.md).

Следом принят #847 (`d2452b68`): AnyIO 4.14.2, locked install, pip check и
настоящий изолированный HTTP smoke прошли локально и в новой обязательной
CI-проверке; независимое review одобрено. GitHub отметил alerts 15/16/17
как `fixed` 20.09.2026 в 16:40:17Z. Это обновление исходников, не сервера.

Пункт 3 / #905 принят в main (`b38c6f16`): три изменённых тестовых файла
прошли 50/50 проверок на HEAD `6d4c0210`, scoped ESLint, CI и независимое
review одобрены. Это unit/source/harness-проверки; полного Node suite и
живого бизнес-пути в этом срезе не запускали. Старые 2179 не новое доказательство.

## Очередь независимых срезов

| Пункты | Срез и приёмка | Зависимость / граница |
|---|---|---|
| 3 | #905 MERGED; три тестовых файла сверены, 50/50 scoped checks | Старый отчёт 2179 не новый прогон; business acceptance не заявляется |
| 1 | #935 и #960 MERGED: Sales Manager, seller, месяц по sale date и исправление pending-case handoff; LOCAL208/215 acceptance | Production отдельно; previous-seller non-null и concurrency не объявляются проверенными |
| 6, 10 | #943/#945/#953/#959 MERGED: текущая воронка, подтверждённый handoff, owner-filter, stage tabs и mobile320/390 | Реальные перемещения стадий этим UI-срезом не исполнялись; delivery отдельно |
| 7 | #956/#958/#962 MERGED: preview/edit/back, filter/reset/годовой месяц, серверный literal search до count/totals/page; LOCAL216 Auth/UI320/390 | Phone/contract positive, >50 и salesOther не доказаны; direction facet, плотность отчёта и mobile-record остаются; [search receipt](qa/crm-sales-search-2026-09-21.md) |
| 8 | #968 MERGED: LOCAL221, 35 Auth reads, actualUI1280/390/320, полный «Все», filter/cursor/context/BackForward | Основной queue-срез принят; positive другие типы/pending отсутствовали, managed отдельно |
| 9 | #952 MERGED `f97122e8`: Inbox empty/filter/channel states; actual local read/UI desktop/390px | История выбранного диалога и provider/error-path приёмка этим срезом не доказаны; [квитанция](qa/crm-inbox-states-2026-09-21.md) |
| 11 | #955 MERGED `fe26526c`: поиск Student messages с loading, отдельными empty/error/retry и защитой от устаревшего ответа; actual local read/UI desktop/390px | Очереди остаются у A; диалог не открывали, сообщений и mark-read не отправляли; [квитанция](qa/case-chat-search-2026-09-21.md) |
| 12 | #933/#971/#973/#984 MERGED: договорный workflow и local DATE fix; actual Admin QA-транш1,00KGS/оплата0,50 → own Student остаток0,50 | Ограниченный путь принят; contract-only/populated artifacts, refunds/receipt/mixed-currency, весь12 и managed отдельно |
| 30 | #948 MERGED: LOCAL213 actual UPDATE двух UI-блоков, sibling draft, replay/conflict/stale и restore26 полей; B sale INSERT отдельно | Не browser-proof всех групп; handoff correction215 вошла #960; managed/release не выполнены |
| 14 | Staff-каталог: поиск, фильтры, дедлайны, управление | Program IDs/schema принадлежат B |
| 15 | #970/#974 autosize/task removal; #976 LOCAL223 flat reader и #983 LOCAL225 sparse seen; #981/#986 plans MERGED | #987/LOCAL227 direct quotes принят; #992 flat UI/search/read/scroll ещё не приняты; старые сообщения/seen сохраняются |
| 16 | #954/#963 MERGED: explicit case choice и личный case/staff reader; LOCAL217 Auth/target/denials и UI320/390/desktop | Положительные dated/staff и >100 UI overflow отсутствуют; commands/concurrent reassignment не исполнены; [receipt](qa/personal-calendar-2026-09-21.md) |
| 22 | #961 MERGED: keyboard skip-navigation slice | Остальной shell/типографика открыты; не полная a11y-приёмка |
| 29 | #966 MERGED: failed219 сохранён; forward220 function QA, actual Admin UI четырёх пустых полей и exact Auth replay PASS | Pinned219/nonemptyHTTPS UI positive отсутствует; managed отдельно |
| 33 | #969 MERGED: LOCAL222 требует причину срока/приоритета у всех ролей; RPC denials/replay/conflict/stale, reasoned updates и restore пройдены | UI доказал отказ без причины; positive UI save не заявляется, #687 открыт до managed/owner exit criteria |
| 35 | Завершён в исходниках: #947/#949 prerequisites, #950 MERGED `3ddb6f41`, #42 CLOSED; пять checks и 842/842 legacy tests, независимый semantic review | Только форматирование legacy Inbox; без revival/deploy/provider proof; [квитанция](qa/inbox-format-baseline-2026-09-21.md) |
| 5, 36 | Текущая docs-сверка — main684f7f31 после #984; source/local proof/drafts отражены раздельно | Отдельный delivery packet открыт; source merge ≠ managed delivery, остатки1–36 сохраняются |

Каждый срез: живой source → минимальный diff → точечная реальная проверка →
отдельный PR → независимое exact-head review. Не запускать общий финальный E2E,
контентную волну или App Store. Сохранять историю, tenant/Student boundaries,
пользовательский checkout и работу B. Миграции только после выделения номера root.

## Историческая очередь после #943 (до текущего checkpoint)

212/CRM-05 принят через #945. Текущий блок A — пункт30 / открытый #948:
целевая локальная приёмка завершена, остаются финальный exact-head review/CI и merge.
Исходная причина этого блока:
Root подтвердил на main1795bf23: LeadCardFieldsForm обновляет revision, но hidden
sibling values остаются из старого SSR; action отправляет все26 полей, SQL181
заменяет fields целиком. #852 сохраняет несохранённые sibling drafts, но не
доказывает защиту от этого overwrite. Следующий срез требует отдельного контракта
server-authoritative partial update/replay до кода и отдельно разрешённого
existing QA write-пути. CRM-02b следует за сохранностью данных, не перед ней.

Для дальнейших пунктов: #687 уже не включает повторное удаление portal-v1
(оно сделано152); остаётся Admin deadline/priority reason exception с сохранением
11-arg API/coverage locks. #42 — только formatting legacy Inbox. В29 проверить
legacy CN/MY schema137 против четырёх новых snake_case partner fields184, не
ослабляя общий validator. #777/#693 не закрывать по одному техническому deployment:
исторические owner-acceptance исключения остаются. Это выравнивание очереди,
не реализация перечисленных срезов и не разрешение на managed/prod mutations.

### CRM-05 / 212 — локальные доказательства, PR #945

Runtime55581820 независимо одобрен дважды; после интеграции944 UI проверен
на91e30f51. Полная квитанция: `docs/qa/crm-05-operational-handoff-2026-09-20.md`.
Это подготовленный к финальному review срез, не production release. Следующий
пункт30 остаётся первым после merge212. Миграция213 зарезервирована root для A;
B3b получил214, main/local порядок212→213→214.

Находка 212: «Сбросить всё» снимало owner из URL и результата, но select
показывал старый option до reload. Исправлена отдельным #953 `498c99bf`;
реальные reset/search/history и mobile-проверки описаны в
[квитанции](qa/pipeline-owner-filter-reset-2026-09-21.md). Это не завершает
остальную мобильную композицию воронки.

### CRM-30 / 213 — grouped save подготовлен

#945 merged285e784e; следующим реализован пункт30 в isolated
`crm-grouped-card-saves`, contractdfb55be → runtimeeb4502c. Четыре формы
сохраняют только свои9/6/5/6 ключей, сервер берёт соседние значения из текущей
строки; исправлены stale sibling overwrite и финансовая форма12-vs29 keys.
Старые v1/reader/финансовые snapshots сохранены, shared revision монотонна.
См. `docs/qa/crm-30-grouped-card-saves-2026-09-20.md` для реального объёма proof.
TypeScript/lint/source guards/syntax и read-only UI пройдены. Применение213,
положительная QA-запись и final review/CI ещё не завершены. Порядок213→214.
Пункт35/#42 теперь выполняет root, A не дублирует этот срез.

После двух source approvals d3cd9025 local213 применена без business deltas.
Реальная проверка остановлена: custom SalesManager имеет workflow permission,
но старый literal-role predicate213 отказывает42501 при editable UI. Это
блокирует завершение30. Готовится узкая correction только213; старые receipts
и ledger сохранены, положительные QA writes пока не разрешены/не выполнены.

После contract amendmentd5216ab6 и двух независимых approvals exactae83aedd
bounded local candidate correction выполнена: новый213SHA7e7e1fe8, прежние
function ACL/OID/attributes и ledger001–212 сохранены. Original apply history
остаётся, correction записана отдельно. Actual ordinary Auth read/denials10/10
PASS с unchanged business hashes/Auth users count. Literal-role blocker снят.
Positive save/sibling persistence/replay/restore остаются owner-gated HOLD;
пункт30 не завершён и release не заявляется. См. обновлённый CRM-30 QA receipt.

### CRM-30 / 213 — положительная локальная приёмка завершена 21.09

Предыдущие HOLD и отсутствие положительных saves выше — исторические состояния.
Root ac83fc2c исправил избыточную трактовку полномочий A; после завершения окна B
выполнен исходный пакет двух полей/четырёх saves, без нового решения владельца.
Runtime52a00103, local schema001–214. Реальные UI wishes3→4 / education4→5
сохранили соседний несохранённый draft и остальные24 поля. Ordinary Auth exact
replay, conflict и stale прошли; guarded restore5→6→7 вернул все26 исходных полей.
Финансовый snapshot и остальные20-table snapshots без побочных изменений;
ровно4 append-only receipts/audits сохранены. UI reload подтвердил восстановление.
B packet отдельно доказал sale-group INSERT0→1 и replay/conflict/stale; его
handoff208 встретил identity guard126 и полностью откатился. Исправление этой
отдельной зависимости выделено B215. Оно не отменяет acceptance grouped save213.
Подробности, включая сохранённый parser failure, — в CRM-30 QA receipt.
Merge948 ожидает final exact-head review/protected CI;946 следует после948.
Managed DB и production release не выполнялись.
