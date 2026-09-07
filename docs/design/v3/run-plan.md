# Единый план прогона — 06–07.09

**Это рабочий план текущего прогона и одновременно документ передачи.** Если
исполнитель сменился (лимиты, обрыв сессии, другой агент — Codex, Sol, Astra,
кто угодно), новый исполнитель продолжает ровно отсюда. Статусы обновляются в
этом файле в той же пачке, что и код.

После остановки Fable заказчик вернул исполнение Codex решением 06.09:
«окей работай как он выполни план». Codex продолжает тот же прогон с той же
дисциплиной: не останавливаться до реального блокера. Условия заказчика — в
`product.md` (пополняется немедленно при каждом его слове). Порядок более
высокого уровня — корневой `AGENTS.md`, `docs/EVO_LAUNCH_PLAN.md`, ADR 0027 и
последний блок `docs/PLAN_CHANGES.md` (append-only; актуальная передача и
порядок записаны блоком
`EVO-V3-RUN-ORDER-PORTAL-REUSE-CORRECTION-2026-09-06`).

## Как продолжать этот прогон (для холодного исполнителя)

Прочитать в этом порядке: `AGENTS.md` → хвост `docs/PLAN_CHANGES.md` (2–3
блока) → `docs/design/v3/product.md` → этот файл → `CLAUDE.md` (правила мира
V3) → `docs/design/v3/frontend-rules.md`.

**Цикл на каждую пачку работы** (правило заказчика от 05.09, не обсуждается):

1. Правки. Экраны — по правилам мира (токены, цвет только в пилюлях и рёбрах
   `.v3-edge-*`, только русский, сырые ключи никогда, числа только настоящие,
   словари только в `src/lib/v3/wording.ts`).
2. `npm run typecheck` и `npx eslint`.
3. `npm run build > /tmp/b.log 2>&1` (никогда не через `| head` — SIGPIPE
   убивает сборку на середине, это уже случалось).
4. `npm run test:unit` + задетые целевые сьюты.
5. Полный местный контур: `EVO_NODE_BIN=/opt/homebrew/opt/node@22/bin/node
   bash scripts/test-postgres-v2-foundation.sh` — реальный Postgres, Supabase
   Auth/RLS, приложение, Chromium, гейт V3 (axe, один h1, без бокового
   скролла, мишени ≥24px; десктоп, 393px и принудительная тёмная).
6. **Состязательная проверка**: отдельный агент/сессия с чистым контекстом и
   целью «сломать пачку» (не «посмотреть»); находки чинятся до пуша; один
   подтверждающий раунд после починки. На этапе C так поймано 25 дефектов.
7. PR в `main` → squash-merge. Пуш в main сам по себе ничего не выкатывает
   (автоматического CI на push нет с #644; релиз — отдельный ручной прогон).
8. Обновить этот файл и, если заказчик что-то говорил, `product.md`.

Изменения схемы: только НОВЫЕ миграции `supabase/migrations/NNN_*.sql`
(слитые неизменяемы); проверка — `bash scripts/test-postgres-authorization.sh`
(одноразовый docker-Postgres, применяет все миграции и гоняет все
`supabase/tests`); применение к managed-проду — руками через workflow
**EVO schema ledger** (mode=check → mode=apply), см. этап B.

## Что уже сделал Codex до передачи (принято, не переделывать)

- V3 слита в `main`, V1/V2/портал-фронт снесены (#594–#600); один мир данных:
  managed Supabase `iosckaqtovbbnssqcpde` (ap-southeast-1), SQLite/Drizzle
  удалены из рантайма; доменная логика разрезана по файлам `platform-*`.
- Проводка всех семи экранов V3 настоящими server actions (optimistic
  versions + requestId всюду).
- Релизный конвейер: ручной полный прогон «EVO platform CI» (workflow_dispatch
  с proof_revision = SHA замороженного main) → при успехе автоматический
  «EVO fast app release»: immutable-образ, SSH-выкат на Hermes, Playwright-смок,
  атомарная приёмка, авто-откат. Взводится переменной
  `EVO_PRODUCTION_RELEASE_ARMED=true` (сейчас false, прод отвечает 502).
- amoCRM: исходящая ручная команда синка (8 операций), доказана на живом
  аккаунте 03.09 (8/8), выключена флагами. Входящего потока и фонового синка
  НЕТ — это отдельная работа, если заказчик захочет.

## Этапы прогона

**Актуальный порядок:** D1 → D2 → E → F (только код репозитория) → заморозить
`main` → B/#552 → #553 (включая удаление remote refs) → G после отдельных
входных данных заказчика. #551 уже закрыта. Этот порядок уточняет прежнюю
формулировку «#551–#553, затем продуктовые этапы»: первый боевой релиз должен
включать завершённый продукт, а не промежуточную сборку.

### A · Документы и приём — СДЕЛАНО (PR #655)

Слова заказчика 05–06.09 в `product.md`; блок передачи в `PLAN_CHANGES.md`;
сверка реестра с main; roadmap и needs-and-architecture перенесены с ветки.

### B · Прод живой — ЧАСТИЧНО: два пункта за заказчиком

Готово: workflow **EVO schema ledger** (PR #656) — ручная сверка и применение
миграций к managed-проду тем же секретом `SUPABASE_ACCESS_TOKEN`, что у
релизного гейта; леджер прода сверен — **116/116, расхождений нет**; репо-vars
полные (actor id 72846050 = заказчик; отсутствующая `EVO_RELEASE_ROLLBACK_SEED`
и есть контрактное «пусто» для первого выката).

Осталось, В ЭТОМ ПОРЯДКЕ:

1. **[заказчик]** Секрет `EVO_GITHUB_VARIABLES_READ_TOKEN`: fine-grained PAT
   (github.com → Settings → Developer settings → Fine-grained tokens), доступ
   только к `izzhackt/evo_AI_CRM`, permission **Variables: Read-only**, срок
   по вкусу; положить: `gh secret set EVO_GITHUB_VARIABLES_READ_TOKEN`.
   Без него релизный workflow валится на живых гардах (fail-closed).
2. **[заказчик]** Смок-учётка Admin (секреты
   `EVO_PRODUCTION_SMOKE_ADMIN_EMAIL/PASSWORD`). Платформа
   ОДНООРГАНИЗАЦИОННАЯ: вторую организацию bootstrap не даёт, добавить
   участника может только живая admin-сессия (`provision_pilot_staff_member`
   гранта service_role не имеет — проверено на проде). Заказчик либо даёт
   готовую выделенную admin-пару, либо логинится своей и по инструкции
   исполнителя провижинит `evo-release-smoke@evoadmissions.com` (auth-юзер уже
   создан, id `0d7a3ea5-9098-405b-9c59-4af90c09acf1`, пароль у исполнителя,
   членства нет).
3. После D, E и репозиторной части F заморозить финальный `main`; применить
   накопленные миграции (117+) —
   `EVO schema ledger` mode=check, затем mode=apply, затем снова check.
4. Провести read-only preflight и поставить
   `gh variable set EVO_PRODUCTION_RELEASE_ARMED --body true` **до** полного
   CI: автоматический `workflow_run` проверяет флаг уже при старте.
5. Один ручной полный прогон «EVO platform CI» на замороженном финальном main
   (input proof_revision = его полный SHA; диспатчить от аккаунта заказчика —
   gh CLI здесь действует его токеном, actor-гард сойдётся).
6. Дождаться автоматического релиза: образ → Hermes → смок на
   https://evo-crm.72.62.119.112.sslip.io → приёмка. Проверить логин и
   `/api/health` снаружи; записать в `deploy/` фактическую команду отката
   (`rollback-command.sh` поколения).

По остатку #551 записано решение (`PLAN_CHANGES.md`, блок передачи): control
plane не пуст — есть organization, подтверждённые Admin identity/membership,
published role bundles, knowledge account и bootstrap audit; отдельно создан
Auth user `evo-release-smoke@evoadmissions.com` без membership. Customer plane
пуст: нет клиентских lead/case/document rows и нет приватных Storage
objects/bytes. Подписанное exact empty-source evidence (#653) достаточно
именно для отсутствующих Storage bytes первого выката. Полная репетиция
восстановления обязательна перед первым релизом после появления настоящих
данных.

### C · Честные числа и криты реестра — СДЕЛАНО (PR #657)

Дашборд не выдаёт страницу за тотал («50+», null-счёты по неполной странице,
просрочка по суткам организации); календарь не падает при >100 задач и
показывает обрыв фактом с датой; воронка: поиск и фильтры
(q/stage/due/assignment/owner + производная «Переданы»), своя прокрутка
колонок, свёртка «Переданы», предел чтения без падения; входящие: «Ждёт
ответа» от первого неотвеченного (нижняя граница «N+» на обрыве страницы);
журнал: страницы за 60, переводы 154 слов, снят лгущий фильтр по актору,
протухший курсор снимается редиректом; «Student 360» → «Студенты» везде;
словари сведены в `wording.ts`; плашки и альфа-границы приведены к правилам
мира. Два раунда состязательной проверки (22 + 3 находки, закрыты).

### D · Пять потребностей заказчика — В РАБОТЕ

**Волна D1 (схема+бэкенд, миграции 117–121) — СДЕЛАНА (PR #660,
`main` `77462ba023531df81339fc00296e2681fec783a1`).** Пять вертикалей,
каждая: идемпотентность по request_id, optimistic versions, compose-аудит,
REVOKE/GRANT, RLS через RPC-гарды; новые привилегированные тела живут в
существующих неэкспонированных схемах `private`/`platform_private`, а
`platform` оставляет только `SECURITY INVOKER` entrypoint +
SQL-тесты в `supabase/tests` + контракт в `src/lib` + server actions +
node-тесты + прогон `scripts/test-postgres-authorization.sh`:

- **117 case_notes** — заметки к лиду и делу: append-only таблица, create/list
  RPC, все три роли своей организации; `src/lib/platform-case-notes.ts` +
  actions.
- **118 география заявки** — country (ISO alpha-2) + degree (тем же типом, что
  `student_cases.target_degree`) на `university_applications`; расширение
  create/details-RPC (паттерн DROP+CREATE из 112); поля в формах
  ProfileAdmissionsWorkspace; словарь ступеней/стран в `wording.ts`.
- **119 расширения очередей** — staff_communication_page: +
  last_message_direction/last_message_at + p_query (поиск);
  staff_sales_lead_page: + stage_entered_at (из sales_stage_entries, 111);
  staff_case_task_queue: + keyset-курсор + p_due_from/p_due_to. Read-модели
  `platform-communications/sales/admissions-workspace` расширены обратно
  совместимо; пины exact-record-ключей в тестах обновлены.
- **120 reply_snippets** — шаблоны ответов: таблица (audience
  sales/admissions/all, optimistic version, archive), list/create/update/
  archive RPC; `src/lib/platform-reply-snippets.ts` + actions.
- **121 мост вложений** — «медиа сообщения WhatsApp → версия документа дела»:
  переиспользует конвейер 062/108/113/115/116 (upload reservation → finalize
  → ClamAV), серверное копирование между приватными бакетами service-клиентом,
  без публичных URL и байтов через браузер; связь медиа ↔ дело проверяется
  через диалог (105/106).

**Durable checkpoint и cold-resume:** D1 уже в `origin/main`; удалённую ветку
PR #660 после merge удалили штатно. Проверенный code checkpoint до финального
handover — `a01567043fc7cac488b2cc655e205742392fe85f`, итоговый squash в `main` —
`77462ba023531df81339fc00296e2681fec783a1`. Не восстанавливать D1 из старой
ветки или worktree. Новый исполнитель сначала подтверждает `origin/main` и
наличие всех пяти неизменяемых миграций:

```bash
git fetch origin --prune
git rev-parse origin/main
git ls-tree -r --name-only origin/main -- supabase/migrations \
  | rg '/(117|118|119|120|121)_'
gh pr view 660 --repo izzhackt/evo_AI_CRM --json state,mergedAt,mergeCommit
```

Ожидаемый результат: PR `MERGED`, merge commit `77462ba0`, миграции 117–121
есть. Затем продолжать только с D2. Любое расхождение — stop-and-investigate,
а не повторная реализация D1.

**Фактический статус D1 на code checkpoint `a0156704`:**

- **117 принято:** append-only lead/case notes, точная subject-authority,
  replay-safe create, keyset list и реальные dblink-race. Unicode считается
  теми же code points и с тем же edge-whitespace, что PostgreSQL; Sales держит
  порядок блокировок lead → actor/org, Admissions — actor/org → case. Note и
  Curator assignment теперь входят через единый organization-scoped
  transaction advisory domain до request/actor/case locks. Assignment после
  ожидания повторно проверяет JWT access version, published bundle,
  `case.curator.assign` и свежий organization scope под membership/profile/org
  locks. Реальные workflow-vs-note, current/target Curator-vs-assignment,
  membership revocation и Admin scope-revocation races зелёные; stale Admin
  получает `42501` без изменения дела, assignment event или audit.
- **118 принято:** точный список стран CN/MY/AE/TR/IT/CZ и ступень заявки
  проведены через migration, RPC,
  серверные actions, формы и словарь; primary-switch держит один primary под
  детерминированной блокировкой, replay привязан к exact request. Targeted SQL,
  Node и независимые review зелёные.
- **119 принято:** communication search/direction, Sales stage-entry evidence и
  Admissions task keyset/date bounds интегрированы. Повреждённый или
  неподтверждённый workflow ledger закрывает всю видимую очередь. Полный
  foundation выявил старые synthetic fixtures с версиями 7/11/21 без receipt;
  production-валидатор не ослаблялся — provisioner теперь завершает их через
  канонический `mutate_sales_lead_workflow` и сразу проверяет реальный read RPC.
- **120 принято:** reply snippets с exact audience, optimistic version,
  archive, receipt causality и role/capability guards. SQL и TypeScript имеют
  одну trim/Unicode/C1-control границу, поэтому прямой RPC не может отравить
  последующее чтение списка.
- **121 принято:** actor-bound intent → одноразовый media grant → version-bound
  reservation → private Storage copy/TUS → download/hash/ClamAV → finalize.
  Stale slot, expired reservation, replay с иными входами, revoked actor,
  foreign tenant/object и lost-response recovery покрыты реальными SQL/Node
  регрессиями. Последний недублирующий security-test из PR #663 перенесён в
  #660; #663 закрыт без отдельного merge.

**Общий gate D1 на 07.09:** `npm run test:d1` — 89/89; `npm run test:unit` —
PASS (96 уникальных Node-файлов, 162 теста); полный
`scripts/test-postgres-authorization.sh` — PASS на точном финальном diff; Node
22 typecheck, полный ESLint и production build — PASS. Свежий
`scripts/test-postgres-v2-foundation.sh` прошёл реальный локальный Postgres,
Supabase Auth/RLS, private Storage, provider workflows и Chromium: активные
staff-auth E2E 15/15, V3 gate зелёный на desktop, 393 px и forced-dark.
Финальный cumulative adversarial review exact diff
`80ba267ddad2186ce682da0e3cf84e88c5a8d0af2ad0a001f8da45d918989d85` —
`APPROVED`; он отдельно подтвердил Curator deadlock, exposed
invoker/non-exposed definer boundary и stale-Admin revocation race.
Подтверждённых замечаний не осталось. Финальный head PR
`1f57ef9158ce2456380c40def83aaff275e117f4` прошёл exact-head GitHub CI;
PR #660 затем squash-merged в `main` как `77462ba0`. Managed Supabase и
production этой волной не менялись.

Проверка актуальной официальной документации 06–07.09: новый
`SECURITY DEFINER` нельзя оставлять в exposed schema `platform`. D1 переносит
привилегированные тела в существующую неэкспонированную `private`; exposed RPC
становятся `SECURITY INVOKER`. У definer-helper обязательны пустой
`search_path`, полная квалификация объектов и атомарные `REVOKE`/точечные
`GRANT`; всё дополнительно проверяется cross-role/cross-org adversarial
тестами. Для Storage сохраняется продуктовый предел 25 MiB: до 6 MB допустим
standard upload, а диапазон свыше 6 MB D1 переводит на TUS resumable upload с
повторным download/hash/ClamAV proof до finalize. Источники:
[Database Functions](https://supabase.com/docs/guides/database/functions),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Standard Uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads),
[Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads),
[Next.js Data Security](https://nextjs.org/docs/app/guides/data-security),
[PostgreSQL advisory locks](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS).

**Волна D2 (UI поверх D1) — ГОТОВА К MERGE В PR #673.** Зафиксированная
последовательность уже находится в `origin/main`:

- контракт D2 — PR #664, `ca71dbc5`;
- exact-case поправка контракта Media — PR #665, `234f390b`;
- Inbox / migration 122 — PR #667, `11778fce`;
- reply snippets — PR #668, `a305152a`;
- snippets-to-Inbox integration — PR #671, `42b53f8f`;
- Profile/Pipeline / migration 123 — PR #670, `d005cfe5`;
- Calendar / migration 124 — PR #666, `cb8ee183`;
- Media route, attach boundary и corrective migration 125 — PR #672,
  `a6ecd2af`.

Closure-пачка опубликована как PR #673 из ветки
`izzhackt/v3-d2-final-integration`, созданной от точного `a6ecd2af`.
Проверенный функциональный head — `e935103a`: Media UI в Inbox, регистрация
всех новых D2 Node/SQL тестов в канонических harness, browser proof и две
исправленные только реальным браузером ошибки — недопустимый object export из
`"use server"` и точное различение отсутствующего private Storage object
(`unavailable`) от настоящего отказа полномочий (`forbidden`).

Локальное доказательство `e935103a`: canonical Node plan — 106 уникальных
файлов и 168/168 тестов; focused P4 + D2 Media Chromium — 2/2; полный
изолированный Postgres/Supabase Auth/RLS/private Storage/Chromium foundation —
PASS; desktop, 393 px и forced-dark V3 gate — PASS; production build и полный
ESLint — PASS; независимое adversarial review — APPROVED. Отдельный SQL
authorization harness был зелёным до последней runtime/test-only поправки;
после него не менялись migration/SQL/harness-файлы, поэтому дублирующий полный
локальный rerun не требовался. Защищённые GitHub checks обязаны пройти на
актуальном `headRefOid` PR #673. До его match-head squash-merge D2 не называть
сделанной; после merge сразу отметить `СДЕЛАНО` в следующей плановой пачке и
перейти к E0/PR #669.

Холодный исполнитель сначала проверяет состояние, а не повторяет уже слитые
пачки:

```bash
git fetch origin --prune
git rev-parse origin/main
git ls-tree -r --name-only origin/main -- supabase/migrations \
  | rg '/(122|123|124|125)_'
gh pr list --repo izzhackt/evo_AI_CRM \
  --head izzhackt/v3-d2-final-integration \
  --json number,state,headRefOid,mergeCommit,url
```

Если closure-PR ещё открыт, продолжать только его exact head. Если он слит,
миграции 122–125 есть в `origin/main`, канонические Node manifests проходят
validate-only, cumulative gates и review совпадают с зафиксированным head — D2
не переделывать, отметить `СДЕЛАНО` и перейти к E. Любое расхождение —
stop-and-investigate.

Замороженный продуктовый контракт D2:

- **Inbox, миграция 122:** сервер вычисляет `waiting_since` как время первого
  входящего сообщения в непрерывном входящем хвосте после последнего
  исходящего; если исходящих ещё не было — время первого входящего в диалоге.
  Значение существует только когда последнее сообщение входящее. Равные
  timestamps разрешаются тем же порядком `(created_at, id)`, что и каноническая
  лента. `?waiting=1` фильтрует на сервере именно `waiting_since IS NOT NULL`.
  Поиск — только сохранённые `subject`, имя и телефон канонического клиента;
  provider payload и текст сообщений в поиск не входят. UI показывает
  «Ждёт ответа с …» от `waiting_since`, не от последнего сообщения. URL
  принимает скалярный `q` и только exact `waiting=1`; оба параметра сохраняются
  в ссылках очереди, выбора диалога и пагинации сообщений. Фильтрация идёт до
  `LIMIT`; RPC получает backward-compatible `p_waiting_only BOOLEAN DEFAULT
  FALSE`, а `FALSE` сохраняет прежний состав строк, порядок, cursor semantics и
  значения всех прежних колонок; return shape честно расширяется только
  `waiting_since`. Даже при фильтре порядок/cursor остаются каноническими
  `sort_at DESC, conversation_id DESC`, не «самый долгий первым». 122 синхронно
  обновляет page и snapshot shapes.
- **Шаблоны, без миграции:** пикер вставляет выбранный body в `message_text`,
  в позицию курсора/вместо выделения, не стирает остальной набранный текст и не
  отправляет автоматически. `/v3/knowledge` становится смешанным экраном:
  документы требуют `documents.read`, чтение шаблонов — `messaging.read`, CRUD
  — `messaging.send`. Sales видит шаблоны, но никогда не получает
  `documents.read` и не вызывает document readers. В Admin preview
  presentation role управляет route/read dispatch, вкладками и видимыми
  controls выбранной роли; actions по-прежнему авторизуются неизменяемым
  реальным `authorityRole` Admin на сервере — preview не создаёт поддельного
  downgraded actor. Adapter дополнительно фильтрует аудитории: Sales preview —
  `sales` + `all`, Admissions — `admissions` + `all`, Admin — все три.
- **Заметки и воронка, миграция 123:** профиль Sales читает/создаёт заметки
  только с subject `lead_id`; профиль Admissions — только с subject
  `student_case_id`. Карточка лида использует тот же exact `lead_id`; данные
  разных subjects не склеиваются. Заметки остаются append-only с настоящими
  автором/временем. Первый экран — до 50 записей в каноническом keyset-порядке;
  при `hasNext` обязательно есть рабочее «Ранее», поэтому хвост не скрывается.
  Для списка лидов `staff_sales_lead_page` одним RPC отдаёт exact
  id/body/author/created_at только последней доступной lead-note, без N+1.
  Возраст стадии считается от `stage_entered_at`; для производной колонки
  `handed_off` он не показывается.
- **Календарь, миграция 124:** клиент дочитывает весь выбранный диапазон через
  keyset/date contract 119; предупреждение об обрыве снимается лишь после
  доказанного исчерпания cursor. Date predicates 119 исключают `NULL`, поэтому
  124 добавляет отдельную bounded keyset-проекцию только для undated, повторяя
  порядок/cursor 119 `(sort_at, case_task_id) ASC` с каноническим undated
  sentinel; UI показывает её группой «Без срока», полный исторический scan
  запрещён.
  Дедлайны — отдельные read-only calendar events с discriminator
  `application_deadline`, а не редактируемые задачи: они не получают
  TaskControls и ведут в Admissions-вкладку exact дела. Проекция отдаёт только
  application id, case id/display name, university/program, status и deadline.
  Они берутся только из
  `university_deadline_on`: не выводить его из intake, названия, вех или задач.
  Учитываются только доступные текущему actor дела `state='active'` и статусы
  заявки `preparation`, `ready`, `submitted`, `under_review`, `offer`.
  Проекция событий идёт keyset-порядком
  `(university_deadline_on, application_id)` и дочитывается полностью только в
  выбранном bounded диапазоне. Отдельная one-row aggregate projection находит
  глобальный ближайший дедлайн по всем доступным активным заявкам независимо от
  calendar view. Date-only дедлайн не сдвигается через UTC; границы дня,
  «сегодня» и «N дней» считаются в `Asia/Bishkek`. Метрика живёт на фактической
  стартовой странице Admissions `/v3/calendar`, а не на закрытом для роли
  `/v3/main`: прошедший срок — «Просрочено N дн», сегодняшний — «Сегодня»,
  будущий — «До дедлайна N дн».
- **Media, последним; corrective-миграция 125 обязательна:** пузыри используют уже выданные
  read-моделью media facts. Просмотр/скачивание идёт через server-only
  `grant_communication_media_download` → одноразовый
  `consume_communication_media_download_grant` → signed URL не дольше 60
  секунд. Бакет остаётся private; public URL и service key запрещены, сырые
  bucket/object coordinates не возвращаются в application JSON — браузер
  получает только server-authorized redirect с `Cache-Control: no-store` на
  короткий signed URL. Preview/download требует `messaging.read`. «В дело
  студента» дополнительно требует `documents.write`, exact `student_case_id`
  диалога и явный выбор из доступных для записи слотов того же дела; Sales
  кнопку не видит. Путь переиспользует 121, браузер не переносит source bytes.
  Проверка только в UI/Server Action недостаточна: публичный authenticated RPC
  из 121 допускает независимые более широкие совпадения через canonical lead и
  canonical client. Поэтому
  125 сужает DB-boundary до exact non-null
  `communication_conversation.student_case_id = p_student_case_id`; прямой RPC
  не может обойти этот инвариант. 125 не меняет grant/consume, Storage или
  read-модель и применяется только после 122–124.
  Cross-org, revoked, expired/consumed grant и quarantined/unavailable media
  закрываются fail-closed.

Номера зарезервированы жёстко: **122 Inbox**, **123 Profile/Pipeline**,
**124 Calendar**, **125 Media exact-case corrective**. Порядок интеграции:
contract docs → Inbox 122 → snippets → Profile/Pipeline 123 → Calendar 124 →
Media 125. Параллельные исполнители не
редактируют `docs/**`, `src/lib/v3/wording.ts`,
`src/lib/fixed-role-policy.ts`, AppShell/route guards, общие test manifests или
чужой UI hotspot. Inbox владеет 122, communication/inbox read-моделью и queue
UI; snippets — новыми snippet/knowledge components; Profile/Pipeline — 123 и
своими source/components; Calendar — 124 и calendar source/components.
Composer wiring в `InboxProviderWorkflowControls.tsx`, mixed `/v3/knowledge`
route policy и общий wording сводит интеграционный владелец после merge нужной
пачки. Media стартует после Inbox/snippets и тогда получает явное владение
`Inbox.tsx`/Inbox hotspot.

Каждая leaf-пачка получает целевые Node/SQL/component tests, применимые
protected checks, independent exact-head review и match-head merge. Зависимая
ветка освежается ровно один раз; при patch-equivalent base-only refresh
неизменившееся доказательство переиспользуется. Полный
`scripts/test-postgres-authorization.sh` и полный локальный контур
Postgres/Auth/RLS/private Storage/Chromium (desktop, 393 px, forced-dark)
запускаются один раз на собранном exact D2 head после регистрации всех новых
Node tests и SQL hooks 123–125. Затем выполняется независимый adversarial
review точного cumulative diff. Любая последующая функциональная или harness
правка инвалидирует затронутое exact-head доказательство и требует одного
replacement run. D2 не разрешает managed schema apply, provider calls или
production release.

### E · Портал студента — НЕ НАЧАТ (cold handover E0; reuse, не rebuild)

**Статус на exact `origin/main` `234f390b2bd19525a60d4d4988b56cb1bfd0ef7d`:**
Stage E не начат; E0 — только этот документационный контракт. Миграций
126/127, portal routes, student resolver, callback и trusted-server invite в
репозитории ещё нет. Не выдавать E0 или существующие SQL-функции за работающий
фронт, отправленное приглашение либо production proof.

#### Уже существующая authority — не дублировать

- Миграции 042/043/044/053/068/069 и их актуализации 108/110 уже дают
  опубликованный Student bundle, `portal.read.self`, `profile.read.self`,
  `document.read.self`, `document.upload`, `document.download`,
  `finance.read.self`, `notification.read.self`, `communication.read.self`,
  `student_portal_*`, own-membership + exact-case + activated-portal guards и
  worker `/api/internal/platform-operations/portal-overdue`.
- Миграции 046/108/115/116 и текущие server handlers уже задают единственный
  private Storage/hash/ClamAV/finalize/download-grant pipeline. E не создаёт
  второй bucket, public URL, локальное хранение, service-key upload из браузера
  или обход scanner.
- Нормальное дело после завершённого U6 (088) имеет форму `state='active'`,
  `current_curator_membership_id IS NOT NULL`, `handoff_at IS NOT NULL`,
  `closed_at IS NULL`; `student_membership_id` и `portal_activated_at` до E
  могут быть `NULL`. Отдельно поддерживается историческая pre-handoff форма:
  `state='pending'`, `current_curator_membership_id IS NULL`, `handoff_at IS
  NULL`, `portal_activated_at IS NULL`, `closed_at IS NULL`. Для неё
  provisioning сначала привязывает Student и оба scope, оставляя портал
  неактивным, а затем существующий `assign_student_case_curator` с явно
  выбранным active Curator ротирует case scope, переводит дело в `active`,
  ставит `handoff_at` и активирует портал. Это не новый U6 и не разрешение
  придумать куратора. Closed, cross-org и любая третья/противоречивая форма
  fail closed и не переоткрывается.

#### Migration 126 — только provisioning, scope и receipt state machine

126 идёт строго после D2 migration 125 и не содержит read-моделей. Она
добавляет private receipt/intent и Admin-only prepare/record/finalize RPC для
trusted-server coordinator. Финальная DB-транзакция композиционно использует
существующие primitives, а не переписывает RBAC:

1. `platform.provision_member(..., 'student', ...)` создаёт/проверяет ровно
   один active Student membership для уже существующего `auth.users.id` и
   опубликованного Student bundle. Затем обязательно вызывается
   `platform.assign_organization_scope`: migration 083
   `current_actor_authority()` требует и `organization.read`, и active
   organization scope также для роли Student. После этого
   `platform_private.append_scope_event` выдаёт второй, более узкий active
   `record_scopes(scope_kind='student_case', scope_key=<exact case_id>)` из
   `student_cases.current_scope_id/current_scope_version`. Organization scope
   нужен только для actor bootstrap и не заменяет exact-case scope/RLS.
2. В той же транзакции после read-only Admin preflight функция **сначала**
   вызывает migration 117
   `platform_private.lock_student_case_note_assignment_domain(organization_id)`,
   и только затем берёт receipt/request и participant row locks. После domain
   lock она заново проверяет Admin JWT/access-version/bundle/permission/scope,
   затем блокирует exact case, membership и profile; проверяет organization,
   одну из двух разрешённых case-форм, active
   Student role/bundle и отсутствие чужой привязки; добавляет organization и
   exact-case scope; записывает `student_cases.student_membership_id`; и
   безусловно вызывает `platform_private.bump_access_version(profile_id)`
   **после** scope/bind (помимо bump внутри organization-scope primitive).
   Для normal U6 только после этого выставляется `portal_activated_at`. Для
   legacy pending портал остаётся `NULL`, пока вложенный вызов существующего
   `platform.assign_student_case_curator` с validated Curator не ротирует
   scope, не выдаст новую exact-case grant Student/Curator, не bump-нет их
   access versions и не запишет `active`/`handoff_at`/`portal_activated_at`.
   Все шаги finalizer находятся в одной транзакции; ошибка Curator assignment
   откатывает membership/scopes/bind целиком.
3. Один `request_id` + неизменяемый fingerprint
   `(organization_id, student_case_id, normalized_email, display_name,
   case_shape, legacy_curator_membership_id)` даёт точный replay ранее
   сохранённого результата. `case_shape` — только `normal_u6` или
   `legacy_pending`; Curator равен `NULL` для normal U6 и exact selected active
   Curator для legacy. Поэтому replay не может молча поменять Curator. Тот же
   `request_id` с иным
   fingerprint — `request_replay_conflict`. Новый request для уже reserved,
   bound или active case — `portal_case_already_reserved`/
   `portal_case_already_bound`; он не отправляет второе письмо. Уже-bound case
   может продолжить **только тот же receipt**, только с тем же
   `auth_user_id`/Student membership и только пока `portal_activated_at IS
   NULL`; любая иная привязка — конфликт. Успешный replay не создаёт новые
   membership/scope/audit rows и не повышает `access_version` повторно.
4. Каждый вложенный auditable primitive получает deterministic child request
   ID от корневого receipt request (отдельные стабильные suffix для membership,
   organization scope, legacy curator и final audit); один UUID нельзя
   повторно использовать для разных `audit_events.action`. Cross-org auth
   profile/membership, inactive profile/membership, non-Student role, closed
   case и foreign scope всегда отказ. Для legacy pending prepare до invite
   требует exact выбранный active Curator; отсутствующий/foreign/inactive
   Curator — отказ. Два request на один case
   или normalized email сериализуются row/advisory locks + unique constraints:
   первый durable reservation выигрывает, второй получает deterministic
   conflict **до** Auth invite. Гонка finalize с curator assignment/close/
   rebind повторно читает locked current case/scope: normal-U6 reassign до
   finalizer означает grant на уже новый scope, reassign после finalizer сам
   переносит Student grant; legacy curator step выполняется только после bind.
   Ноль затронутых строк — rollback, не partial success.

Supabase Auth нельзя включить в PostgreSQL-транзакцию. Поэтому coordinator
выполняет строго `prepare receipt -> inviteUserByEmail -> record Auth result ->
finalize authority` и сохраняет состояния `prepared`, `invite_succeeded`,
`authority_activated`, `invite_failed`, `invite_outcome_unknown`. Legacy
pending не может завершиться состоянием success, пока тот же finalizer не
завершил Curator assignment и Portal activation:

- secret/service key существует только в trusted server client с отключённым
  browser session persistence; email и provider payload не логируются и не
  попадают в public tables/JSON;
- definite invite failure оставляет case без membership/activation; тот же
  request можно повторить только из `invite_failed` после operator-visible
  причины без provider body;
- invite success + finalize failure оставляет приглашённого Auth user без
  Portal authority; retry того же request использует сохранённый exact
  `auth_user_id` и **не** отправляет письмо повторно;
- timeout/lost response — `invite_outcome_unknown`: никакого blind retry,
  удаления Auth user или создания второго identity. Оператор сначала
  сверяет managed Auth по exact normalized email, затем либо записывает
  найденный `auth_user_id` и продолжает тот же receipt, либо явно переводит
  его в retryable `invite_failed` с audit reason;
- если `record Auth result` недоступен после реального provider success,
  результат честно остаётся unknown и требует той же reconciliation. Ни один
  ответ coordinator не называет invite успешным, пока durable receipt не
  содержит `auth_user_id`; ни один не называет портал активным до успешного
  finalize.

Admin invite использует
[trusted-server `inviteUserByEmail`](https://supabase.com/docs/guides/auth/users)
и его [JS reference](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).

#### Migration 127 — только additive student read models

127 идёт после 126. Существующие `student_portal_*` signatures, RLS, grants и
document pipeline не ломаются и не заменяются broad table reads. Новые
student-self RPC добавляют только недостающие UI facts:

- overview: текущая стадия/следующий шаг, `next_action_due_at` или
  Bishkek-date `next_action_due_on`, и `curator_display_name` из active
  `current_curator_membership_id`;
- applications: institution/program/status, `is_primary`,
  `university_deadline_on`, а отдельная student-safe timeline — только
  previous/new status + occurred-at; visa даёт такой же status timeline;
- finance: label/category, amount, paid, refunded, **outstanding** minor units,
  currency, due-at, derived status, overdue и next action;
- documents/notifications продолжают текущие 108 contracts; в браузер не
  уходят organization/profile/membership/scope/audit IDs, evidence/provider
  refs, storage coordinates, reviewer/actor identity или internal notes.
  Необходимые opaque case/slot/version/application keys используются только
  как authorization-bound action handles и никогда не показываются как текст.

Каждая projection повторяет `platform_can_read_student_portal_case`, exact
Student membership, active portal, permission и exact case relation. Timeline
не возвращает `evidence_reference`, note или actor. Пустые факты остаются
`NULL`/пустым списком; UI не придумывает даты, суммы, куратора или вехи.

#### Auth, callback, routes и документы

Staff и Student — две непересекающиеся authorization ветки:

- существующий `resolvePlatformActor`/`requirePlatformStaffActor` остаётся
  staff-only; `isDatabaseStaffRole` по-прежнему допускает только
  Admin/Sales/Curator и никогда не расширяется до Student;
- новый `resolveStudentPortalActor` принимает только verified Supabase
  session + active Student profile/membership/bundle + exact active/closed
  own case + organization scope + `portal_activated_at` + exact case scope.
  Portal routes никогда
  не вызывают staff resolver/AppShell/preview, staff routes — student resolver;
- shared login может аутентифицировать email/password, но root dispatcher
  маршрутизирует результат отдельных resolvers: staff в свой `/v3/*` home,
  Student в `/portal`; no-membership/invalid/mixed authority очищает session и
  возвращает `/login?error=account-not-ready`, не staff pending UI;
- единственный invite callback — `GET /auth/callback`. Invite email template
  строит ссылку только как `{{ .RedirectTo }}?token_hash={{ .TokenHash
  }}&type=invite`; route принимает ровно один `token_hash` и точное
  `type=invite`, выполняет server-side `verifyOtp`, удаляет token из следующего
  URL, затем вызывает только Student resolver. Нет `code`, `next`, arbitrary
  redirect, wildcard или client-side token handling. Ошибка/неполная authority
  очищает session и возвращает bounded login error; успешная invite-сессия
  переходит на auth-only `/auth/set-password`. Эта route не является экраном
  портала: её session-bound Server Action вызывает `auth.updateUser`, а после
  подтверждённого password update повторно проверяет Student resolver и
  redirect-ит на `/portal`. Callback/set-password имеют `Cache-Control:
  no-store`; пароль, token hash и Auth response никогда не логируются.

**Target E3 Auth configuration (ещё не current proof):** managed Site URL
должен стать ровно `https://evo-crm.72.62.119.112.sslip.io`, а production
redirect allowlist — ровно
`https://evo-crm.72.62.119.112.sslip.io/auth/callback`. Сейчас managed settings
не проверены, а exact-main `supabase/config.toml` всё ещё содержит старый
`additional_redirect_urls = ["https://127.0.0.1:3000"]`; E3 обязан заменить
его, а не описать как уже готовый. Local target: Site URL
`http://127.0.0.1:3000` и единственный callback
`http://127.0.0.1:3000/auth/callback`. Preview wildcard и `localhost` alias не
добавлять. `redirectTo` должен быть exact callback:
[Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
Managed и local invite templates обязаны иметь одинаковый server-side
token-hash contract:
[Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates).

Ровно пять portal routes, в отдельном Student layout, по-русски и в мире V3:

1. `/portal` — «Моё поступление»: стадия, следующий шаг с датой, куратор.
2. `/portal/documents` — чеклист, статусы/причины возврата, upload в свой slot.
3. `/portal/applications` — заявки + виза, дедлайны и безопасный трек статусов.
4. `/portal/payments` — обязательства, paid/outstanding/overdue без выдумки.
5. `/portal/notifications` — safe notifications и replay-safe «прочитано».

Private student-document routes ровно `POST
/api/portal/document-slots/[documentSlotId]/versions` и `GET
/api/portal/document-versions/[versionId]/download`. Оба используют только
Student resolver и existing preflight/reserve/hash/ClamAV/finalize либо
grant/consume/signed-URL primitives. Upload требует own exact case + current
slot + `document.upload`, лимит/mime/signature/version/replay guards; download
требует own exact case + finalized clean version + `document.download`,
возвращает server-authorized 302 на signed URL не дольше 60 секунд с
`Cache-Control: no-store`. Bucket/object/service key никогда не попадают в
browser JSON; scanner failure/quarantine/mismatch/expired or consumed grant —
fail closed. Сохранить существующий 25 MiB product limit и established
standard/resumable boundary:
[standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads),
[resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).

#### Жёсткий порядок пакетов E0–E5 и acceptance

1. **E0 contract (этот docs-only PR):** только `docs/PLAN_CHANGES.md` и этот
   файл; `git diff --check`, Node 22.23.1 runtime, PR-classifier/release-contract
   tests, independent adversarial docs review. Никакой migration/code/runtime
   claim.
2. **E1 authority (126):** receipt + prepare/record/finalize RPC, mandatory
   organization + exact-case grants, bind/bump/activate, normal-U6 и legacy
   pending+Curator paths, SQL inventory/RLS/replay/cross-org/closed/
   already-bound/race tests. Все provisioning/legacy curator paths обязаны
   брать migration 117 organization advisory domain до request/row locks;
   concurrency regressions включают direct Curator assignment против finalize.
   Тест обязан доказать, что Student без organization
   scope не проходит `current_actor_authority()`, а legacy pending остаётся
   portal-inactive до `assign_student_case_curator`. Обязательны concurrent
   two-request tests и полный `scripts/test-postgres-authorization.sh` на
   OrbStack.
3. **E2 read models (127):** только additive projections выше, SQL
   column/grant/RLS/data-minimization tests и `src/lib/v3` Student adapters с
   strict decoders. Сначала E1 merge, затем refresh exact `main`; полный
   migration boundary gate.
4. **E3 auth + trusted coordinator:** separate Student resolver/guard, exact
   callback/config allowlist, server-only Auth client, Admin invite action/UI и
   receipt reconciliation. Node tests обязаны доказать definite failure,
   success+finalize failure, lost response, same-request replay, changed-input
   conflict, exact invite token-hash verification и auth-only password setup,
   no arbitrary redirect/blind resend/secret-browser leakage и staff/Student
   mutual rejection.
5. **E4 portal surface:** отдельный Student layout и ровно пять routes на E2
   adapters; Russian wording, empty/error/loading states, no fabricated facts,
   desktop/393px/forced-dark/a11y tests. Staff/Admin preview не открывает portal,
   Student не открывает `/v3/*`.
6. **E5 documents + cumulative closure:** две private document routes, upload/
   download UI, existing scanner pipeline tests, own-case/cross-case/cross-org/
   revoked/quarantine/replay/expired-grant matrix; восстановленные portal
   contract/E2E tests для всех пяти routes, callback и mark-read. Затем Node
   22 typecheck, full ESLint, production build, целевые Node suites, полный
   local Postgres/Auth/RLS/Storage/Chromium contour и independent exact-head
   adversarial review с re-review подтверждённых fixes.

Каждый пакет — отдельный scoped PR после предыдущего merge; migrations 126/127
не перенумеровывать и не принимать до 125 на `main`. Рутинные PR не запускают
полный release-candidate `EVO platform CI`; он выполняется один раз только на
замороженном exact-current-`main` согласно общему release contract.

#### Live blockers и граница доказательства

Repo/local acceptance доказывает только код, SQL, local Supabase/Auth email
sandbox, RLS/Storage/scanner и browser behavior. Оно **не** доказывает managed
schema apply, production Auth URL settings, SMTP delivery, реальное письмо,
принятие invite владельцем email, live Student login или production portal.

До live invite нужны: read-only подтверждение exact managed project; merged
125–127 и schema-ledger apply; owner-approved real case/student recipient;
owner-selected transactional sender/from-domain; custom SMTP credentials в
Supabase Dashboard (не Git), проверенные SPF/DKIM/DMARC, invite template,
delivery/rate limits и exact Site URL/redirect allowlist. Email-provider link
tracking отключён, чтобы не переписывать одноразовый invite URL. Default
Supabase SMTP не является production proof и ограничивает получателей/доставку:
[Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). Сам E0 и пакеты
E1–E5 не разрешают managed apply, SMTP/DNS mutation, live invite/provider call,
production deployment, amoCRM/WhatsApp write или release arming.

### F · Чистка кода репозитория — НЕ НАЧАТА (после D и E)

1. Мёртвые модули с их тестами и строками package.json: platform-bw4-workflow
   (1389 строк), platform-pilot-cohort, platform-ai-memory (+repository),
   platform-case-assignment, supabase/browser.ts.
2. transcription-lab целиком (mlx-whisper — Apple-Silicon-only, в
   linux-контейнере прода неработоспособен): src/app/transcription-lab,
   api/transcription/**, components/transcription/**, lib/transcription/**,
   lib/guards.ts, scripts/transcribe_mlx_chunks.py + зависимость three;
   перевесить tests/request-limits с маршрута transcription.
3. Только русский: словари en/ky из i18n-data.ts, LangSwitcher,
   locale-actions; getLocale → 'ru' (механизм getT оставить — им пользуется
   V3); решить судьбу ThemeToggle и тёмной темы на /login.
4. `drizzle/` (SQLite-остаток, «delete this fucking shit») — с правкой
   охраняющего теста p6c (строки ~211–218) и HISTORICAL_ROOTS/forbidden-regex
   в scripts. `agent-lead2-inbox/` и `evo-lead-agent/` НЕ трогать: там живой
   edge-Caddyfile и осознанно сохранённая граница.
5. Remote refs и комментарии здесь не удалять. Ветку
   `izzhackt/v3-h-managed-recovery-current-main` и прочие `izzhackt/*`
   инвентаризировать на уникальные commits/смысловые довески, но удалять только
   в #553 после exact-live аудита. `claude/v3-frontend` держать до конца
   прогона.
6. После каждого шага: build + целевые сьюты (списки тестов в package.json
   пофайловые и ломаются при удалении файла).

### G · amoCRM — ЖДЁТ ЗАКАЗЧИКА (код готов)

Ответ на «its done, just turned off right?»: частично да — исходящая ручная
команда построена и доказана (8/8 на живом аккаунте), выключена флагами;
входящего amoCRM→EVO и фонового синка нет. Сабдомен подтверждён:
`evoadmissions.amocrm.ru`. Оба старых токена на VPS мертвы (401, проверено
06.09). Нужно от заказчика: долгоживущий токен приватной интеграции; 8
маршрутных значений (pipeline_id, status_id, responsible_user_id, tag_name ×
Sales/Admissions — id из /api/v4/leads/pipelines и /api/v4/users);
подтверждение записи в боевой аккаунт; ручная кнопка достаточна или нужен
фоновый/двусторонний синк (второе — отдельная большая работа). Включение:
env-флаги `EVO_V2_AMOCRM_WRITES_ENABLED=1`, `EVO_V2_AMOCRM_PROVIDER_AUTHORIZED=1`,
`EVO_V2_AMOCRM_BASE_URL`, токен-файл 0600 по `EVO_V2_AMOCRM_TOKEN_FILE` + 8
значений; проверка — `scripts/verify-connected-amocrm-validation.sh`.

## Сводка «нужно от заказчика» (спрашивается разом, работу не блокирует)

1. Fine-grained GitHub PAT «Variables: Read-only» → секрет
   `EVO_GITHUB_VARIABLES_READ_TOKEN` (этап B).
2. Смок-Admin: готовая пара в секреты ИЛИ одна admin-сессия для провижининга
   (этап B).
3. amoCRM: токен + 8 маршрутных значений + подтверждение + ответ про фоновый
   синк (этап G).
4. В9 (календарь: день открывается на текущем часе) — сделано по умолчанию,
   можно поправить одним словом.
