# Переключение рабочей CRM на self-hosted Supabase

Составлено: 2026-10-20. Статус: **выполнено 2026-10-20** (окно 00:35:03–00:47:26 UTC,
выпуск `v3-r39349222695-a1-c200eef9`, образ `evo-crm:c200eef97c0842f2a942d65bf4433f1c7ec03fcd`;
итог и часы — запись `docs/PLAN_CHANGES.md` от 20.10.2026 «Рабочая CRM переключена…»). Документ
по-прежнему ничего не разрешает: каждый шаг, который меняет production (сервер, GitHub-переменные,
выпуск, схему, DNS), выполняется только по команде владельца в чате и в его границах. Репозиторий
публичный: здесь нет паролей, ключей, JWT, значений `.env`, персональных данных.

Метки: **[live]** — прочитано или проверено на сервере 20.10; **[repo]** — из файлов репозитория;
**[запись]** — со слов записей `docs/PLAN_CHANGES.md`; **[не проверено]** — так и написано, фактом не
считать.

Решения владельца 20.10, которые этот порядок соблюдает: self-hosted становится рабочей базой; все данные
переезжают на сервер, кроме тяжёлой базы знаний (её файлы, около 8,7 ГиБ, скопированы 19.10 и при
переключении заново не копируются, догоняется только дельта); облачный проект не удаляется и не
меняется; резервные копии и их проверка в этот документ не входят — владелец скажет, когда.

Все скрипты ниже лежат в [`deploy/selfhosted-cutover/`](../../deploy/selfhosted-cutover/) одним плоским
каталогом (скрипты Mac находят SQL-файлы рядом с собой). На сервере они разложены так: `restore/` =
`/opt/evo-supabase/restore/` (`cutover-restore.sh`, `rehearsal-checks.sh`, `post-restore.sql`,
`policies.sql`, `acl-snapshot.sql`, `counts.sql`, `rowhash.sql`, `storage-copy-run.sh`,
`storage-copy.cjs`) и `ops/` = `/opt/evo-supabase/ops/` (`edge-maint.sh`, `env-switch.sh`,
`set-smtp-pass.sh`, `waha-vault-transfer.mjs`); файлы Mac запускаются из любого каталога, дампы кладутся в
`$WORK_ROOT` (по умолчанию `$TMPDIR/evo-cutover`, режим 0700, не в репозиторий). Чистый том
`restore/pgdata.clean` в Git не лежит (см. шаг 3).

## 1. Что меняется при переключении: только настройки

Кода менять не нужно. Режим выбирает переменная GitHub, адрес и ключи лежат в env.

| Где | Что | До | После (20.10) |
|---|---|---|---|
| GitHub, переменная `EVO_SUPABASE_TARGET` | какая база за выпуском и ledger | не задана = `cloud` | `selfhosted` |
| GitHub, переменная `EVO_SUPABASE_PROJECT_REF` | адрес облака | `iosckaqtovbbnssqcpde` | не менялась: нужна режиму `cloud` и откату |
| `/opt/evo-crm/.env.production` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EVO_PLATFORM_SUPABASE_SECRET_KEY` | облако | `https://supabase.evoadmissions.com`, `sb_publishable_…`, `sb_secret_…` self-hosted |
| `/opt/evo-crm/.env.ai-agent` | `EVO_AI_AGENT_DATABASE_URL` | Supavisor облака | Supavisor self-hosted (`evo_ai_agent.evo@evo-supabase-pooler:6543`, `sslmode=disable`) |
| Supabase Vault (self-hosted) | ключ WAHA | пусто | записан `waha-vault-transfer.mjs` |
| Auth self-hosted (`/opt/evo-supabase/.env`) | хук входа, SMTP, Site URL, редиректы, шаблоны | хук, Site URL, редиректы, шаблоны — 19–20.10; **SMTP — не готов** | как в облаке, кроме `SMTP_PASS` (пусто: нет ключа Resend) |
| `ios/Release.xcconfig` (локальный, вне Git) | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | облако | **не менялся** (шаг 12) |

Что делает `EVO_SUPABASE_TARGET` [repo]:

| Узел | `cloud` (по умолчанию) | `selfhosted` |
|---|---|---|
| `evo-fast-release.yml`: проверка ledger (три шага) | Management API (`SUPABASE_ACCESS_TOKEN`) | SSH тем же доступом, что выпуск: `docker exec -i evo-supabase-db psql … select version from supabase_migrations.schema_migrations` |
| `evo-schema-ledger.yml`, `check` и `apply` | Management API, `supabase db push --linked` | `scripts/selfhosted-schema-ledger.mjs`: SSH (только с `main`), сухой прогон, затем недостающие файлы по порядку; файл без `begin/commit` и его строка ledger — одна транзакция, у файла со своими `begin/commit` строка ledger вставляется сразу после его `commit` |
| Проверка env (`scripts/evo-app-env-contract.mjs`) | `NEXT_PUBLIC_SUPABASE_URL` ровно `https://<ref>.supabase.co` | ровно `https://supabase.evoadmissions.com`, без шаблонов |
| Проверка ключей перед выпуском | `GET <origin>/auth/v1/settings` и `/auth/v1/admin/users?page=1&per_page=1` | те же запросы на `https://supabase.evoadmissions.com` |
| Манифест образа и контроллер | `supabaseProjectRef` = 20 символов | `supabaseProjectRef` = слово `selfhosted` |

Значение, отличное от `cloud` и `selfhosted`, останавливает выпуск и ledger до любых действий. Недоступный
self-hosted в режиме `selfhosted` останавливает выпуск; запасного перехода на облако нет. Порт базы наружу
не открывается: ssh выполняет фиксированную команду внутри `evo-supabase-db`. Ключ выпуска в
`/root/.ssh/authorized_keys` помечен `restrict`; `docker exec -i` без `-t` ему не мешает — проверено
[live] 20.10 живым `EVO schema ledger check` и чтением ledger в выпуске.

## 2. Предусловия (до окна)

1. Подготовка кода слита и выпущена в режиме `cloud` (#1272, `0d633845`).
2. Два прогона репетиции на копии прошли (19–20.10) теми же скриптами, что и окно.
3. Ключи self-hosted проверены на копии [live 20.10]: `sb_publishable` на `/auth/v1/settings` — 200;
   `sb_secret` и JWT `SERVICE_ROLE_KEY` (одним `apikey` и парой `apikey`+`Bearer`) — 200 на
   `/auth/v1/admin/users`, чтение PostgREST (`public.profiles`), RPC `platform.read_amocrm_command_by_idempotency_key`
   и `/storage/v1/bucket`; неверный ключ и запрос без ключа — 401; `sb_publishable` и anon JWT на admin — 403,
   `sb_publishable` на RPC — 401; Realtime принимает все четыре ключа (101 и `phx_join` ok). В
   `.env.production` положены формы, какие были в облаке: `sb_publishable_…` и `sb_secret_…`; обе проходят
   регулярные выражения контракта env. Все эти проверки собраны в `rehearsal-checks.sh`.
4. `/opt/evo-crm/.env.production` скопирован как `.env.production.pre-selfhosted` (0600), так же
   `.env.ai-agent` → `.env.ai-agent.pre-selfhosted` — точки отката env.
5. Сервер видит публичный адрес: `curl … https://supabase.evoadmissions.com/auth/v1/settings -H 'apikey: …'`
   → 200.
6. Нет идущих прогонов (`gh run list --status in_progress`), `EVO_PRODUCTION_RELEASE_ARMED=false`, `main`
   не движется до конца выпуска.
7. Окно объявлено заранее; приложение в окне **не останавливается** (см. шаг 1).
8. В `/root/contract-check/` на сервере лежат `evo-app-env-contract.mjs` и `env.production.example` из
   текущего `main` (для `env-switch.sh`): `git show origin/main:scripts/evo-app-env-contract.mjs`,
   `git show origin/main:deploy/env.production.example`, режим 0600.
9. Домен: автопродление `evoadmissions.com` включено, срок 2027-01-24, способа оплаты на аккаунте нет
   (`infrastructure-map.md`, раздел 1) — к окну не относится, но `supabase.evoadmissions.com` живёт на нём.

## 3. Порядок окна

Нумерация шагов 20.10 приведена к порядку выполнения; прежние записи `docs/PLAN_CHANGES.md` ссылаются на
старую (1 заморозка, 2 дамп, 3 восстановление, 4 ручные шаги, 5 Storage, 6 Auth, 7 ledger, 8 env и выпуск,
9 Vault, 10 агент, 11 проверки, 12 iPhone, 13 откат; Vault оказался до правки env, а не после).

Часы 20.10: 12 мин 23 с от первой 503 до возврата; ориентир для следующего раза — 14–16 мин вместе с
запасом, объявлять 20–25 мин.

### До окна (без простоя)

1. **Предварительный дамп схемы** (Mac, ≈4 мин; схему не нужно снимать в простое):
   `deploy/selfhosted-cutover/cutover-dump-and-run.sh predump <ptag>` — роли, схема, схема ledger и
   отпечаток схемы облака (`schema-fingerprint.sql`: функции, отношения с колонками и правами,
   ограничения, индексы, политики, триггеры, версии ledger). Отпечаток считается до и после дампа.
   Токен CLI берётся из Keychain внутри процесса. Команды CLI (только чтение облака; CLI сам заводит
   временную login-роль, как 19.10): `supabase link --project-ref iosckaqtovbbnssqcpde`, затем
   `supabase db dump --linked -f roles.sql --role-only`, `-f history_schema.sql --schema supabase_migrations`,
   `-f schema.sql`, а в окне `-f data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes`
   и `-f history_data.sql --use-copy --data-only --schema supabase_migrations`. Снимать последовательно:
   параллельный запуск пяти дампов 20.10 оборвался без сообщения об ошибке.
2. **Файлы Storage**: `ssh hermes-vps 'cd /opt/evo-supabase/restore && ./storage-copy-run.sh copy'` (74 с
   даже без дельты: сверяются все 7881 объектов; ключ облака скрипт берёт из `.env.production`, поэтому
   **до** правки env). Итог — `storage-copy.summary.json`: `failed` = 0, `done` = `total`; контейнер
   `evo-storage-copy` затем `docker rm`.
3. **Копии env** (см. предусловие 4) и проверка предусловия 6.
4. Опционально, когда есть ключ Resend: `printf '%s' "$KEY" | ssh hermes-vps /opt/evo-supabase/ops/set-smtp-pass.sh`
   (ключ на stdin, пересоздаётся только `auth`; печатает только длину). 20.10 ключа в Keychain не было,
   `SMTP_PASS` пуст.

### Шаг 1. Заморозка записи

**Приложение и агент не останавливать.** Контроллер выпуска требует, чтобы текущие `evo-crm-app-1`,
`ai-agent-api`, `ai-agent-worker` были `healthy` с `RestartCount` 0: `docker stop` и `docker pause`
переводят `State.Health` в `unhealthy` [live 20.10, проверено на контейнерах стека], предпроверка
(`run_preflight_checks` → `verify_current_runtime`) падает с `runtime_service_unhealthy`; без контейнера
приложения при принятом указателе `current-v3-accepted.json` — `accepted_runtime_missing`; публичный
`/api/health` обязан отвечать 200 (`verify_external_health`) [repo]. Поэтому запись замораживают на edge:

```bash
ORIG=$(ssh hermes-vps 'docker inspect -f "{{.Id}}" evo-crm-app-1')
ssh hermes-vps '/opt/evo-supabase/ops/edge-maint.sh on'          # записать UTC начала окна
ssh hermes-vps "MAX_MIN=45 nohup /opt/evo-supabase/ops/edge-maint.sh watch $ORIG >/dev/null 2>&1 &"
```

`edge-maint.sh on` кладёт в живой `Caddyfile.evo-edge` на месте (тот же inode) 503 «идёт переход» для
`crm.`/`app.` (всё, кроме `/api/health`) и для `POST /api/website-leads`, проверяет в боевом контейнере
(`caddy validate`) и делает `caddy reload`; оригинал сохранён в `/root/Caddyfile.evo-edge.pre-maintenance`.
`watch` возвращает оригинал, как только контейнер `evo-crm-app-1` заменён выпуском (или через `MAX_MIN`);
вручную — `edge-maint.sh off`. Входящие WAHA→приложение идут по сети Docker мимо edge; WAHA не трогать.
Что происходит за время окна:

- `https://crm.evoadmissions.com` и `app.` отвечают 503 (кроме `/api/health`), заявки с сайта
  (`POST /api/website-leads`) тоже 503; у apex-сайта на edge нет журнала доступа, поэтому отказанные
  попытки посетителей сосчитать нельзя [live].
- Старый контейнер простаивает: 20.10 в окне он не принял ни одного запроса, кроме проб здоровья
  (журнал `previous-app.log`, который контроллер сохраняет в каталоге выпуска). Если в окне идёт живая
  работа, записи в облако после дампа возможны; проверка 13 шага 12 это выявляет.
- Звонки (ВАТС) в окно не попадут в CRM: окно выбирать вне рабочих часов.

### Шаг 2. Свежий дамп, загрузка, восстановление, сверка

```bash
deploy/selfhosted-cutover/cutover-dump-and-run.sh run <tag> --predump <ptag>
```

Сверяет отпечаток схемы облака с предварительным (иначе останавливается — тогда без `--predump`, полный
дамп добавляет ≈4 мин), снимает данные и ledger (≈1,5 мин), снимок прав облака (`acl-snapshot.sql` через
Management API), загружает файлы в `restore/runs/<tag>/` (0600), сверяет sha256 и стирает локальные файлы
с данными (`shred`), затем вызывает на сервере `restore/cutover-restore.sh <tag>` (≈2 мин). Скрипт
сервера (этапы пишутся в `restore/logs/<tag>/timing.tsv`):

1. предпроверки (файлы, снимок, место); 2. сброс: остановка служб, `volumes/db/data` ← `restore/pgdata.clean`;
3. одна транзакция `ON_ERROR_STOP`: `roles.sql` → `schema.sql` → `pgmq.create` для четырёх очередей →
`data.sql` (с `session_replication_role = replica`; в нём строки `pgmq.q_*`, `pgmq.a_*` и значения
сиквенсов `msg_id`) → `ALTER EXTENSION pgmq DROP TABLE` для восьми таблиц (по одной, списка синтаксис не
принимает) — в облаке таблицы не входят в расширение, члены только сиквенсы; 4. ledger; 5. после
восстановления: триггер `on_auth_user_created`, публикация `supabase_realtime` на шесть таблиц, 17
политик `storage`/`realtime` (`policies.sql`), пароль `evo_ai_agent` готовым SCRAM-verifier из `.env`,
права хука; 6. права: сверка со снимком облака и `REVOKE`/`GRANT` до 0 расхождений (до трёх проходов);
7. `ANALYZE`; 8. запуск `auth storage realtime rest supavisor meta studio imgproxy`; 9. проверки и
счётчики в `checks.txt`. Любая ошибка основного прохода — остановка до любых следующих действий; тогда
окно прерывают: `edge-maint.sh off`, остановить watcher (`pkill -f 'edge-maint.sh watch'`), env и
GitHub-переменные не менять.

Сверка (обязательна, облако заморожено, значения должны совпасть **точно**):

```bash
ssh hermes-vps '/opt/evo-supabase/restore/rehearsal-checks.sh'   # шлюз, ключи, Realtime, хук, пул агента, WAHA dry-run
deploy/selfhosted-cutover/cutover-compare.sh                     # счётчики 31 таблицы и md5 содержимого 19 таблиц, облако против self-hosted
```

20.10: восстановление — 112 с (сброс 6, транзакция 26, права 2, ANALYZE 3, запуск служб 73); расхождений
0. Права: схема дампа на self-hosted даёт лишние ≈500 строк прав (default privileges образа выдают
`anon`/`authenticated`/`service_role` на всё новое), их снимает сверка; файлы `acl_fix*.sql` 19.10 больше не
нужны. Файлы дампа с данными (`data.sql`, `history_data.sql`) содержат персональные данные: на сервере
только в `restore/runs/<tag>/` (root, 0600), на Mac только в `$WORK_ROOT`; **удалить после приёмки**
(`rm -rf restore/runs/<tag>`; скрипт Mac стирает свои копии сам).

### Шаг 3. Чистый том `pgdata.clean` (при потере — пересобрать)

Снимок собран 20.10 так: `docker compose stop` служб БД и `db`; `volumes/db/data` перенести в сторону;
создать пустой `volumes/db/data` (владелец `100:0`, режим 0700, как у прежнего); `docker compose start db`
(скрипты инициализации образа создают роли и схемы); `docker compose start auth storage realtime rest
supavisor` (их миграции и тенанты — Supavisor `evo`, Realtime `realtime-dev` — создаются сами из env и
`volumes/pooler/pooler.exs`; отдельного пользователя пула для агента не нужно: пул проверяет роль через
`pgbouncer.get_auth`); остановить службы и `db`; `cp -a volumes/db/data restore/pgdata.clean` (51 МБ). Права
файлов — штатные для PostgreSQL 17 (750/640). Старые `restore-clean.sh` и `restore-run.sh` 19.10 устарели
(ждут `data.clean.sql` и не делают шагов после восстановления) — не использовать.

### Шаг 4. Ручные шаги после восстановления (теперь внутри `cutover-restore.sh`)

| Что | Проверка | 20.10 |
|---|---|---|
| Триггер `on_auth_user_created` на `auth.users` → `handle_new_user` | `select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;` | есть |
| 17 политик на `storage.objects` (13) и `realtime.messages` (4) | `select count(*) from pg_policies where schemaname in ('storage','realtime');` = 17 | 17 |
| Публикация `supabase_realtime` на 6 таблиц (`public.conversations`, `flow_runs`, `member_presence`, `message_reactions`, `messages`, `notifications`) | `select tablename from pg_publication_tables where pubname = 'supabase_realtime';` | 6 |
| Очереди `pgmq`: `platform_work_v1`, `platform_dead_letter_v1`, `ai_agent_work_v1`, `ai_agent_dead_letter_v1` | `select queue_name from pgmq.meta;` | 4; сиквенсы `msg_id` 1466 и 484, как в облаке |
| Роль `evo_ai_agent`: `LOGIN`, пароль, лимит 10 соединений | `select rolcanlogin, rolconnlimit, rolpassword is not null from pg_authid where rolname = 'evo_ai_agent';` | есть |
| Права в схемах приложения | снимок прав облака против self-hosted, 2175 строк | 0 расхождений |
| Хук входа `platform_private.custom_access_token_hook` | `has_function_privilege('supabase_auth_admin', …, 'execute')`, вызов в откатываемой транзакции от роли `supabase_auth_admin` | claims `platform_role`, `platform_access_version`, `platform_membership_id`, `platform_organization_id` |
| Расширения | `select extname from pg_extension;` | `pg_net` (только self-hosted, не используется), `pg_stat_statements`, `pgcrypto`, `pgmq`, `plpgsql`, `supabase_vault`, `uuid-ossp`, `vector` |
| Default privileges | сверка с облаком | равны (лишь схема `supabase_functions` есть только у self-hosted) |

`supabase_realtime_messages_publication` на self-hosted появляется сама, когда Realtime принимает первое
соединение с базой (в облаке она на ежедневные секции `realtime.messages`).

### Шаг 5. Файлы Storage (дельта)

Метаданные (`storage.buckets`, `storage.objects`) восстановлены на шаге 2; файлы догоняются
`ssh hermes-vps 'cd /opt/evo-supabase/restore && ./storage-copy-run.sh copy'` (74 с; `dryrun` — 9 с, только
листинг). Скрипт читает облако только на чтение, кладёт объекты в раскладку файлового бэкенда так, что
строки `storage.objects` остаются верными, существующие файлы пропускает; останавливается при
`MemAvailable` ниже 4 ГиБ или свободном диске ниже 60 ГБ. Тяжёлая база знаний заново не копируется.
20.10: `skip` 7881, `failed` 0, `done` = `total` = 7881.

### Шаг 6. Настройки Auth self-hosted

Через `/opt/evo-supabase/.env` и `docker compose up -d --no-deps auth` из `/opt/evo-supabase` (не `down`).
Хук включён в `docker-compose.evo.yml`, значения как в облаке (сверено 20.10 с Management API):

| Настройка | Значение |
|---|---|
| Хук входа | `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`, `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/platform_private/custom_access_token_hook` |
| Регистрация | `DISABLE_SIGNUP=true`, автоподтверждение выключено |
| `SITE_URL` | `https://crm.evoadmissions.com` |
| Список редиректов | ровно `https://crm.evoadmissions.com/auth/staff`, `https://app.evoadmissions.com/auth/callback`, `https://app.evoadmissions.com/auth/signup-confirmation` |
| SMTP | Resend: `smtp.resend.com:465`, пользователь `resend`, отправитель `evo@evoadmissions.com`, имя `EVO Admissions`, лимит 100 писем в час; **`SMTP_PASS` пуст** до ключа Resend (`set-smtp-pass.sh`) |
| Шаблоны | Invite, Recovery, Confirm signup — русские (`mail-templates/`, `supabase/templates/`) |
| Длина OTP, срок | 8 знаков, `MAILER_OTP_EXP` 3600; `JWT_EXPIRY` 3600 |
| `API_EXTERNAL_URL` | `https://supabase.evoadmissions.com/auth/v1` |

Сессии: подпись JWT self-hosted другая, все прежние сессии недействительны, вход заново, пароли прежние
(хеши переехали с `auth.users`). Cookie прежнего проекта остаётся в браузерах; новый адрес даёт другое имя
cookie, поэтому прокси видит нового гостя и отправляет на вход. Письма, отправленные облаком раньше,
ведут на облачный адрес и больше не работают.

### Шаг 7. Ledger self-hosted

Чтение: `ssh hermes-vps "docker exec evo-supabase-db psql -U postgres -d postgres -X -A -t -c 'select count(*), min(version), max(version) from supabase_migrations.schema_migrations'"`
(20.10: 310, `001`, `310`, равно 310 файлам в `main`). Затем:

```bash
gh variable set EVO_SUPABASE_TARGET --body selfhosted -R izzhackt/evo_AI_CRM
gh workflow run "EVO schema ledger" -f mode=check --ref main -R izzhackt/evo_AI_CRM
```

`check` печатает локальные, применённые, недостающие и лишние версии; `apply` — только если «недостающие»
не пусты (сначала сухой прогон, ошибки psql в публичный журнал не попадают, только SQLSTATE и номер
строки); непустые «лишние» — остановка и разбор. 20.10: 310/310, пусто, `apply` не понадобился.
Переменная остаётся `selfhosted` и для выпуска: задаёт идентичность проекта (манифест образа,
контроллер, контракт env); выпуск при облачном `.env.production` отказывает (`public_supabase_project_mismatch`).

### Шаг 8. Vault (ключ WAHA) — до правки env

Vault пуст после каждого восстановления, а строка привязки из дампа приходит с `enabled=true` без секрета.
Скрипт читает ключ из Vault облака (в памяти, не печатает), сверяет sha512 с `.env.waha` и пишет в Vault
self-hosted; **работает только пока `.env.production` указывает на облако**:

```bash
ssh hermes-vps 'node /opt/evo-supabase/ops/waha-vault-transfer.mjs --apply --repair-dangling --enable'
```

20.10: `ready`, `vault_secret_decrypts`, `vault_sha512_matches_env_waha`, `vault_matches_stored_sha256` — true.
Пробный запуск (`--dry-run`) входит в `rehearsal-checks.sh`. Проверка после выпуска (ключ подаётся на
stdin; брать его из Vault self-hosted внутри конвейера, не печатать):

```bash
docker exec evo-supabase-db psql -U supabase_admin -d postgres -X -A -t -c \
  "select d.decrypted_secret from platform_private.manual_send_waha_runtime_bindings b join vault.decrypted_secrets d on d.id = b.api_key_secret_id limit 1" \
  | head -1 | docker exec -i evo-crm-app-1 node scripts/waha-runtime-binding.mjs check --verify-key --key-stdin
```

### Шаг 9. Env рабочей CRM

```bash
ssh hermes-vps '/opt/evo-supabase/ops/env-switch.sh apply'
```

Заменяет ровно три значения (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`EVO_PLATFORM_SUPABASE_SECRET_KEY`) значениями из `/opt/evo-supabase/.env`, сверяет, что список имён и
остальные строки не изменились, проверяет кандидат контрактом `evo-app-env-contract.mjs --supabase-project-ref
selfhosted --verify-supabase-keys` (проба ключей идёт на публичный адрес) и только потом атомарно ставит
файл (0600, `root:root`). Значения не печатаются; формат `NAME=value`, без кавычек и `export`.
`env-switch.sh check` собирает и проверяет кандидат, ничего не устанавливая.

### Шаг 10. Выпуск

Контракт — `deploy/fast-app-release.md`. Порядок по контракту, 20.10 без отличий:

```bash
gh variable set EVO_PRODUCTION_RELEASE_ARMED --body true -R izzhackt/evo_AI_CRM
gh workflow run evo-platform-ci.yml -f proof_revision=<точный SHA main> --ref main -R izzhackt/evo_AI_CRM
# при 403 на допуске — gh run rerun <тот же прогон CI>, новый CI не запускать
# EVO fast app release стартует сам (workflow_run); дожидаться success
gh variable set EVO_PRODUCTION_RELEASE_ARMED --body false -R izzhackt/evo_AI_CRM   # ВСЕГДА, и при неудаче
```

Контроллер до замены проверяет env (`public_supabase_project_mismatch`, если остался облачный адрес),
ключи (два запроса к `supabase.evoadmissions.com`) и ledger (по SSH); любое расхождение — отказ до замены
контейнера. Если приёмка не проходит, контроллер возвращает прежний контейнер (облачный) с прежним
env-снимком: тогда остановиться, переменную не менять, не запускать второй выпуск и сообщить. Замена
контейнера — на 5-й минуте прогона; `edge-maint.sh watch` сам снимает 503 сразу после неё. 20.10 прогон CI
`39349185164` (22 с), выпуск `39349222695` (6 мин 6 с), 403 не было.

### Шаг 11. ИИ-агент

Агент ходит в базу ролью `evo_ai_agent` через Supavisor (режим транзакций):
`postgresql://evo_ai_agent.<tenant>:<пароль>@evo-supabase-pooler:6543/postgres?sslmode=disable`; алиас
`evo-supabase-pooler` закреплён в `docker-compose.evo.yml` (сеть `evo_crm_ai`, порт базы наружу не
открывается); готовая строка лежит в `/opt/evo-supabase/ops/ai-agent-database-url.pending.env` (пароль равен
`EVO_AI_AGENT_PASSWORD` в `.env`, `cutover-restore.sh` ставит его роли каждый раз). **После приёмки
приложения** заменить одну строку `EVO_AI_AGENT_DATABASE_URL` в `.env.ai-agent` (0600, остальное не менять)
и пересоздать только пару агента командой из раздела «Агент перезапустился или нездоров» в
[`ai-agent-enable.md`](ai-agent-enable.md) (`docker compose … --profile ai-agent up --detach --no-deps
--no-build --pull never --force-recreate --wait ai-agent-api ai-agent-worker`; WAHA, ClamAV и приложение
не пересоздаются). Проверка: оба контейнера `healthy`, `/v1/ready` изнутри `ai-agent-api` — 200, в базе
self-hosted есть сессии `evo_ai_agent`. 20.10: выполнено, `EVO_AI_AGENT_AUTOSEND` остаётся `0`.

### Шаг 12. Проверки после выпуска

Делает оператор; агентам входить в production-интерфейс нельзя.

1. `curl -s -o /dev/null -w '%{http_code}' https://crm.evoadmissions.com/api/health` → 200 и
   `https://app.evoadmissions.com/login` → 200.
2. Вход сотрудника и студента: автоматически — «Authenticated read-only case and Student portal smoke» в
   выпуске (админ и студент, дело) [live 20.10: пройдено]; вручную — вход владельца теми же паролями.
3. Realtime: открыть командный чат и чат дела в двух окнах, отправить сообщение — приходит без
   перезагрузки [не проверено: проверен вход в публичные каналы].
4. Storage: загрузка документа меньше 6 МиБ (прямая) и **больше 6 МиБ** (TUS,
   `/storage/v1/upload/resumable`, `Location` на `https://supabase.evoadmissions.com`) [не проверено:
   `OPTIONS` отвечает 204], скачивание, фото вузов, стран, городов.
5. Письма Auth: сброс пароля на адрес владельца [не проверено: ключ Resend не поставлен].
6. Хук входа: после входа в токене есть claim `platform_role` (иначе сотрудник не узнаётся прокси) —
   косвенно подтверждено: страницы сотрудника `/v3/*` открылись в браузерной проверке выпуска.
7. Ledger: `EVO schema ledger check` — «недостающие» и «лишние» пусты [live 20.10, прогон `39350096802`].
8. WhatsApp: `waha-runtime-binding.mjs check --verify-key --key-stdin` (шаг 8) должен дать `ready`,
   `key_matches_stored_binding`, `waha_key_accepted` и `waha_session_status` = `WORKING`. **20.10 сессия
   `crm_primary` — `FAILED` и до окна** (последнее сообщение в CRM 12.10 09:44 UTC; WAHA «websocket not
   connected» раз в час с 08.10); окно её не трогало; починка — повторная привязка телефона владельцем.
9. Заявка с сайта и счёт по `website-intake-health.md`; входящий звонок, `telephony-go-live.md`.
10. Журнал приложения без `supabase.co`: `docker logs evo-crm-app-1 2>&1 | grep -c 'supabase\.co'` = 0 [live].
11. Журнал edge без ключей: `docker logs --since 40m evo-edge-caddy 2>&1 | grep -c -F -f <(printf '%s\n' "$KEY")`
    по каждому из четырёх ключей = 0 (фильтр журнала ошибок — коммит `28ea1c333`).
12. Скорость: строки `evo_timing` из `docker logs evo-crm-app-1` (в 20.10 `scripts/timing-report.mjs`
    при запуске с `--min-n=1` ничего не печатал — разобрать отдельно; сводку по классам можно получить
    коротким скриптом); тяжёлые экраны («WhatsApp», воронка) открываются 10 из 10.
13. Облако после дампа не менялось: хеши и счётчики облака (тот же `rowhash.sql`/`counts.sql` через
    Management API) сразу после дампа и после выпуска равны — иначе есть записи, которых нет в self-hosted.

### Шаг 13. iPhone

Приложение к облаку не привязано: `ios/scripts/write-release-config.sh` и `check-release-config.sh` принимают
любой `https://` адрес. Сборка с новым адресом — одна запись конфигурации:

```bash
SUPABASE_URL=https://supabase.evoadmissions.com \
SUPABASE_PUBLISHABLE_KEY=<publishable-ключ self-hosted> \
DEVELOPMENT_TEAM=<Team ID> \
ios/scripts/write-release-config.sh
```

Дальше обычный архив (`ios/README.md`). Текущие сборки (TestFlight и другие) продолжают ходить в облако, где
после переключения ничего не обновляется: сотрудникам и студентам нужна сборка с новым адресом. Текущий
`Release.xcconfig` вне Git не менять до решения владельца. Вход заново. **Не выполнено** на 20.10.

### Шаг 14. Откат

Откат без потери данных возможен только пока в self-hosted не появились новые записи пользователей.
**Точка невозврата — приём первого запроса на запись после запуска приложения на self-hosted**
(сотрудник сохранил, студент загрузил, пришло сообщение WhatsApp). После неё возврат на облако теряет всё,
что записано за это время; обратного переноса из self-hosted в облако нет. Проверка до решения:
сравнить счётчики/хеши self-hosted с последним дампом (`rowhash.sql`, `counts.sql`).

До точки невозврата:

1. `gh variable set EVO_SUPABASE_TARGET --body cloud -R izzhackt/evo_AI_CRM` (или `gh variable delete`).
2. Вернуть env: `cp -p /opt/evo-crm/.env.production.pre-selfhosted /opt/evo-crm/.env.production` (0600),
   `cp -p /opt/evo-crm/.env.ai-agent.pre-selfhosted /opt/evo-crm/.env.ai-agent`.
3. Выпуск того же `main` в режиме `cloud` (шаг 10) — приложение возвращается на облако; при провале
   приёмки контроллер сам возвращает прежний контейнер и env-снимок.
4. Пересоздать пару агента командой шага 11 (со старым URL).
5. Ключ WAHA в Vault облака на месте (self-hosted Vault облако не трогает).
6. Сессии, выданные self-hosted, перестанут быть действительны: вход заново.

После точки невозврата откат — решение владельца: потеря записей окна против времени простоя; данные
self-hosted не стираются, их можно перенести в облако отдельной работой.

## 4. После переключения

- Задача на удаление облачного пути: #1271 (срок — 14 дней после приёмки). Облачный проект не удалять.
- Новый ADR вместо ADR 0024 (следующий номер на 20.10 — 0034), правка пунктов `AGENTS.md` про проект
  `iosckaqtovbbnssqcpde`, `deploy/*.md`, `docs/runbooks/infrastructure-map.md` (разделы 4, 5, 7).
- Старые JWT-ключи облачного проекта отключить после проверки, что ими никто не пользуется
  (`infrastructure-map.md`, раздел 7).
- Фильтр `apikey` в журнале edge-Caddy **сделан 20.10** (глобальный журнал по умолчанию, коммит `28ea1c333`).
- Ключ Resend → `set-smtp-pass.sh`, затем проверка письма сброса пароля.
- Удалить данные окна (`restore/runs/<tag>` на сервере и `$WORK_ROOT/dump-*` на Mac); оставить
  `.env.production.pre-selfhosted`, `.env.ai-agent.pre-selfhosted` и `restore/pgdata.clean` до закрытия окна
  отката.
- Резервные копии self-hosted: по решению владельца пока не делаются (при будущем дампе учесть: таблицы
  `pgmq` не входят в расширение, их строки дамп `pg_dump` несёт; Vault дампом не переносится).

## 5. Что не проверено на 20.10

- Загрузка документа больше 6 МиБ (TUS) с настоящим `Location`.
- Подписка на приватный канал Realtime с токеном пользователя и обмен сообщением в двух окнах.
- Письма Auth через Resend (ключа нет); OAuth не используется.
- Приём заявок сайта и звонков ВАТС настоящими внешними запросами после выпуска.
- Откат (шаг 14) на живом выпуске и отказ приёмки контроллера в режиме `selfhosted`.
- Непустые очереди `pgmq` при переносе (очереди были пусты; архивные таблицы с тысячами строк перенесены и
  сверены по хешу).
- Повторный догон WhatsApp импортом истории (по описанию `whatsapp-history-import.md` `apply` идемпотентен;
  не запускался). Сессия WhatsApp `crm_primary` в состоянии `FAILED` с 12.10.

Источники: `docs/PLAN_CHANGES.md` (записи 19–20.10), `docs/runbooks/infrastructure-map.md`,
`docs/runbooks/whatsapp-go-live.md`, `docs/runbooks/resend-auth-email.md`, `docs/runbooks/ai-agent-enable.md`,
`supabase/config.toml`, `deploy/fast-app-release.md`, `scripts/evo-fast-release.sh`, чтение и проверки
сервера 19–20.10.
