# Единый план прогона — 06.09

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

**Волна D2 (UI поверх D1) — СЛЕДУЮЩАЯ.** До параллельного кода действует
следующий замороженный контракт:

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
- **Media, последним и без новой миграции:** пузыри используют уже выданные
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
  Cross-org, revoked, expired/consumed grant и quarantined/unavailable media
  закрываются fail-closed.

Номера зарезервированы жёстко: **122 Inbox**, **123 Profile/Pipeline**,
**124 Calendar**. Порядок интеграции: contract docs → Inbox 122 → snippets →
Profile/Pipeline 123 → Calendar 124 → Media. Параллельные исполнители не
редактируют `docs/**`, `src/lib/v3/wording.ts`,
`src/lib/fixed-role-policy.ts`, AppShell/route guards, общие test manifests или
чужой UI hotspot. Inbox владеет 122, communication/inbox read-моделью и queue
UI; snippets — новыми snippet/knowledge components; Profile/Pipeline — 123 и
своими source/components; Calendar — 124 и calendar source/components.
Composer wiring в `InboxProviderWorkflowControls.tsx`, mixed `/v3/knowledge`
route policy и общий wording сводит интеграционный владелец после merge нужной
пачки. Media стартует после Inbox/snippets и тогда получает явное владение
`Inbox.tsx`/Inbox hotspot.

Каждая пачка получает целевые Node/SQL/component tests, Node 22 typecheck,
полный ESLint, production build и риск-маршрутизированный foundation gate.
Миграции 122–124 дополнительно проходят полный
`scripts/test-postgres-authorization.sh`. После сведения всех пачек — полный
локальный контур desktop/393px/forced-dark и независимый adversarial review
точного cumulative diff. D2 не разрешает managed schema apply, provider calls
или production release.

### E · Портал студента — НЕ НАЧАТ (существующую authority переиспользовать)

Серверная машинерия ЖИВА и поддерживается (RPC `student_portal_*`, миграции
042/043/044/053/068/069, обновлялись 108/110; воркер просрочек
`/api/internal/platform-operations/portal-overdue` живой) — снесён только
старый read-only фронт (#627/#629). Строить:

1. Сначала read-only reuse-аудит. Уже существуют и не дублируются:
   опубликованные Student bundles, `portal.read.self`, `document.upload`,
   `document.download`, `student_portal_*`, own-case/activated-portal guards и
   приватный Storage/ClamAV-конвейер (042/046/108/110). Добавить только
   отсутствующий trusted-server invite/provisioning и replay-safe атомарную
   связку нового membership `student` с pending-делом перед установкой
   `portal_activated_at` (CHECK из 088 требует этот порядок). Admin invite —
   только server-side с secret/service key; ключ не попадает в браузер:
   [Supabase inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).
2. Фронт `/portal` (пять экранов, дружелюбно, по-русски, мир V3): «Моё
   поступление» (стадия, следующий шаг с датой, куратор), «Документы»
   (чеклист со статусами и причинами возврата + загрузка в свой слот),
   «Заявки и виза» (статусы, дедлайны, трек вех), «Платежи» (что и когда,
   остаток/просрочка), «Уведомления» (+прочитано). Отдельная ветка
   авторизации: студент НИКОГДА не резолвится в staff-актора; staff-фильтр
   `isDatabaseStaffRole` не ослаблять.
3. Контрактные тесты портала вернуть (были удалены с фронтом).
4. Data minimization старого контракта сохранить: без internal id,
   провайдеров, имён ревьюеров.

Решения по умолчанию (заказчик может поправить): вход — приглашение на почту
с установкой пароля; загрузка документов студентом в v1 — да; язык — русский.

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
