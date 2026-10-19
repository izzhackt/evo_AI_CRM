# Переключение рабочей CRM на self-hosted Supabase

Составлено: 2026-10-20. Статус: **подготовка кода и CI слита (#1272, `0d633845`)
и выпущена в режиме `cloud`; само переключение не выполнялось.** Документ
ничего не разрешает: каждый шаг, который меняет
production (сервер, GitHub-переменные, выпуск, схему, DNS), выполняется только
по команде владельца в чате и в его границах. Репозиторий публичный: здесь нет
паролей, ключей, JWT, значений `.env`, персональных данных.

Метки: **[live]** — прочитано с сервера 20.10 без записи; **[repo]** — из
файлов репозитория; **[запись]** — со слов записей `docs/PLAN_CHANGES.md`;
**[не проверено]** — так и написано, фактом не считать.

Решения владельца 20.10, которые этот порядок соблюдает: self-hosted становится
рабочей базой; все данные переезжают на сервер, кроме тяжёлой базы знаний (её
файлы, около 8,7 ГиБ, уже скопированы 19.10 и при переключении заново не
копируются, догоняются только новые объекты); окно ночью по Бишкеку, о нём
объявляют заранее; облачный проект не удаляется. Резервные копии и их проверка
в этот документ не входят — владелец скажет, когда.

## 1. Что меняется при переключении: только настройки

Кода менять не нужно. Режим выбирает переменная GitHub, адрес и ключи лежат в
env.

| Где | Что | Сейчас | После |
|---|---|---|---|
| GitHub, переменная `EVO_SUPABASE_TARGET` | какая база за выпуском и ledger | не задана = `cloud` | `selfhosted` |
| GitHub, переменная `EVO_SUPABASE_PROJECT_REF` | адрес облака | `iosckaqtovbbnssqcpde` | не менять: нужна режиму `cloud` и откату |
| `/opt/evo-crm/.env.production` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EVO_PLATFORM_SUPABASE_SECRET_KEY` | облако | `https://supabase.evoadmissions.com` и ключи self-hosted |
| `/opt/evo-crm/.env.ai-agent` | `EVO_AI_AGENT_DATABASE_URL` | Supavisor облака | Supavisor self-hosted (шаг 10) |
| Supabase Vault (self-hosted) | ключ WAHA | пусто | запись через `waha-runtime-binding.mjs` (шаг 9) |
| Auth self-hosted (`/opt/evo-supabase/.env`) | хук входа, SMTP, Site URL, список редиректов, шаблоны | частично (шаг 6) | как в облаке |
| `ios/Release.xcconfig` (локальный, вне Git) | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | облако | self-hosted (шаг 12) |

Что делает `EVO_SUPABASE_TARGET` ([repo], запись PLAN_CHANGES 20.10):

| Узел | `cloud` (по умолчанию) | `selfhosted` |
|---|---|---|
| `evo-fast-release.yml`: проверка ledger (три шага) | Management API (`SUPABASE_ACCESS_TOKEN`) | SSH тем же доступом, что выпуск (`EVO_DEPLOY_*`): `docker exec evo-supabase-db psql … select version from supabase_migrations.schema_migrations` |
| `evo-schema-ledger.yml`, `check` и `apply` | Management API, `supabase db push --linked` | `scripts/selfhosted-schema-ledger.mjs`: SSH (только с ветки `main`), сухой прогон, затем недостающие файлы по порядку; файл без собственных `begin/commit` и его строка ledger — одна транзакция, у файла со своими `begin/commit` (252 из 310) его транзакция заканчивается его `commit`, строка ledger вставляется сразу следом — как `supabase db push` |
| Проверка env (`scripts/evo-app-env-contract.mjs`) | `NEXT_PUBLIC_SUPABASE_URL` ровно `https://<ref>.supabase.co` | ровно `https://supabase.evoadmissions.com`, без шаблонов |
| Проверка ключей перед выпуском | `GET <origin>/auth/v1/settings` и `/auth/v1/admin/users?page=1&per_page=1` | те же запросы на `https://supabase.evoadmissions.com` |
| Манифест образа и контроллер | `supabaseProjectRef` = 20 символов | `supabaseProjectRef` = слово `selfhosted` |

Значение, отличное от `cloud` и `selfhosted`, останавливает выпуск и ledger до
любых действий. Недоступный self-hosted в режиме `selfhosted` останавливает
выпуск; запасного перехода на облако нет. Порт базы наружу не открывается и не
пробрасывается: ssh выполняет фиксированную команду внутри контейнера
`evo-supabase-db` [repo]. Ключ выпуска в `/root/.ssh/authorized_keys` помечен
`restrict` (без проброса портов, агента и pty) [live 20.10]; команды `docker exec -i`
без `-t` этому не мешают. Живым прогоном этим ключом `docker exec` в
`evo-supabase-db` ещё не выполнялся — [не проверено].

## 2. Предусловия (до окна)

1. Подготовка слита в `main` и выпущена в режиме `cloud` (поведение не менялось).
   Режим `cloud` остаётся рабочим до самого шага 8.
2. Репетиция на копии (`/opt/evo-crm-selfhost`, `127.0.0.1:25480`, внешние отправки
   выключены [запись]): шаги 2–8 пройдены на копии, а не впервые в окно. На
   репетиции записать в этот документ точные команды дампа (шаг 2) и поправить
   пункты, которые разошлись с действительностью.
3. Ключи self-hosted проверены на копии. Имена в `/opt/evo-supabase/.env`
   [live]: `SUPABASE_PUBLISHABLE_KEY` и `SUPABASE_SECRET_KEY` (вид `sb_publishable_…`
   и `sb_secret_…`), `ANON_KEY` и `SERVICE_ROLE_KEY` (старый JWT). Значения в чат
   и в Git не попадают, лежат в SOPS «Секреты и доступы ЭВО». Проверка: publishable
   на `GET /auth/v1/settings` → 200; secret на `GET /auth/v1/admin/users?page=1&per_page=1`
   → 200; secret на RPC PostgREST → 200. Для JWT-формы первые два запроса прошли
   20.10 [live]; для `sb_secret_` и для RPC — [не проверено]. Выбрать форму,
   которая проходит все три. Контрольные запросы на шлюзе (20.10 [live]): заведомо
   неверный ключ и запрос без ключа к `/auth/v1/settings` → 401, anon-ключ на
   `/auth/v1/admin/users` → 403: проверка ключей выпуска что-то доказывает, потому
   что чужой ключ шлюз не пропускает. Повторить их для выбранной формы ключей.
4. Текущий `/opt/evo-crm/.env.production` скопирован как
   `/opt/evo-crm/.env.production.pre-selfhosted` (0600) — это точка отката env.
5. Проверено, что сервер видит публичный адрес: `curl -s -o /dev/null -w
   '%{http_code}' https://supabase.evoadmissions.com/auth/v1/health -H 'apikey: …'`
   → 200 [live 20.10 для `/auth/v1/settings`]. Проверка ключей контроллера идёт с
   сервера по этому адресу.
6. Нет идущих прогонов `EVO fast app release`, `EVO_PRODUCTION_RELEASE_ARMED=false`.
7. Окно объявлено заранее; ночь по Бишкеку.
8. Домен: автопродление `evoadmissions.com` включено, срок 2027-01-24, способа
   оплаты на аккаунте нет (`infrastructure-map.md`, раздел 1) — не относится к окну,
   но `supabase.evoadmissions.com` живёт на этом домене.

## 3. Порядок окна

Время идёт с шага 1 (заморозка) до шага 8 (выпуск принят). Шаги 2–7
выполняются, пока приложение остановлено.

### Шаг 1. Заморозка записи

Режима обслуживания в приложении нет [repo]; запись останавливается остановкой
приложения:

```bash
ssh hermes-vps 'docker stop evo-crm-app-1'
# при включённом ИИ-агенте: остановить и его работники, чтобы они не писали в облако
ssh hermes-vps 'docker stop evo-crm-ai-agent-api-1 evo-crm-ai-agent-worker-1'
```

Что происходит за время простоя:

- `https://crm.evoadmissions.com` и `https://app.evoadmissions.com` отвечают 502.
- Заявки с сайта (`POST /api/website-leads`) не принимаются. После окна сверить
  счёт по `docs/runbooks/website-intake-health.md`; что делает сайт при отказе
  приёмника, из репозитория CRM не видно — [не проверено].
- WAHA (`evo-crm-waha-1`) не останавливать: сессия `crm_primary` должна остаться
  `WORKING`. Входящие в окно WAHA отдаёт вебхуком в остановленное приложение;
  пропущенное догоняется импортом истории
  (`docs/runbooks/whatsapp-history-import.md`) — [не проверено], сколько WAHA
  держит неудачные вебхуки.
- Звонки (ВАТС) в окне не попадут в CRM: окно выбирать вне рабочих часов.

Момент остановки записать: он нужен для сверки (шаг 2) и отката (шаг 13).

### Шаг 2. Свежий дамп облака

Нужны пять файлов в `/opt/evo-supabase/restore/` (так было 19.10 [live]):

| Файл | Что внутри |
|---|---|
| `roles.sql` | собственные роли и настройки ролей (`evo_ai_agent`, `statement_timeout` у `anon`, `authenticated`, `authenticator`) |
| `schema.sql` | схема (около 7,5 МБ) |
| `data.clean.sql` | данные |
| `history_schema.sql` | схема `supabase_migrations.schema_migrations` (version, statements, name, created_by, idempotency_key, rollback) |
| `history_data.sql` | строки истории миграций (ledger) |

Команды, которыми снят дамп 19.10, в репозитории не записаны, а на сервере лежат
только результаты [live]; поэтому порядок такой: на репетиции снять дамп тем же
способом (по документации Supabase CLI: `supabase db dump --linked` с
`--role-only`, схема, `--data-only --use-copy`, отдельно `--schema
supabase_migrations`), сравнить первые строки каждого файла и размеры с файлами
19.10, привести этот абзац к фактическим командам. Пароль облачной базы вводит
владелец в своей оболочке, в файлы и журналы он не попадает.

Дамп снимают после остановки приложения (шаг 1), чтобы он был последним. Данные
Storage (`storage.buckets`, `storage.objects`) идут в `data.clean.sql` — файлы
переносятся отдельно (шаг 5).

### Шаг 3. Восстановление в self-hosted

Порядок, отработанный 19.10 (`restore-clean.sh` и `restore-run.sh` в
`/opt/evo-supabase/restore/` [live]):

1. Остановить `db` и вернуть том к снимку пустого стека
   (`restore/pgdata.clean`), поднять `db`. `restore-clean.sh <метка>` делает это
   целиком: сброс, затем одна транзакция `roles.sql` → `schema.sql` → создание
   очередей `pgmq` → данные с `session_replication_role = replica`, затем история
   миграций отдельным проходом.
2. Результат смотреть по `logs/<метка>/*.err` (число `ERROR`); при любой ошибке в
   основном проходе остановиться и не продолжать на неполной базе.
3. `restore-run.sh <метка>` — тот же порядок по этапам без одной транзакции
   (диагностика).

Снимка `pgdata.clean` в каталоге `restore/` сейчас нет [live]: перед репетицией
проверить, откуда брать чистое состояние (новая инициализация стека или
повторный снимок), и записать это здесь.

После восстановления перезапустить службы стека, чтобы они перечитали базу
(PostgREST — схему, Supavisor — пул): `cd /opt/evo-supabase && docker compose
restart` (не `down`; [не проверено], что 19.10 это делалось именно так).
Проверка ledger: `select count(*), min(version), max(version) from
supabase_migrations.schema_migrations;` должно дать полный ряд `001…N` по
текущему `main` (на 19.10: 309 строк `001–309`; в облаке к тому дню уже была `310`).

Файлы дампа с данными (`data.clean.sql`, `history_data.sql`) содержат
персональные данные клиентов: хранить только в `/opt/evo-supabase/restore`
(root, 0600) и удалить после приёмки переключения, когда откат уже не нужен.

### Шаг 4. Ручные шаги после восстановления

Это то, что дамп схем не переносит или переносит неполно. Состояние копии на
20.10 [live] — в правой колонке; на свежем восстановлении сверить каждую строку.

| Что | Проверка | Как на копии 20.10 |
|---|---|---|
| Триггер `on_auth_user_created` на `auth.users` → `handle_new_user` | `select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;` | есть |
| 17 политик на `storage.objects` (13) и `realtime.messages` (4) | `select count(*) from pg_policies where schemaname in ('storage','realtime');` = 17 | 17; текст — `restore/policies.sql` |
| Публикация `supabase_realtime` на 6 таблиц (`public.conversations`, `flow_runs`, `member_presence`, `message_reactions`, `messages`, `notifications`) | `select tablename from pg_publication_tables where pubname = 'supabase_realtime';` | 6 |
| Очереди `pgmq`: `platform_work_v1`, `platform_dead_letter_v1`, `ai_agent_work_v1`, `ai_agent_dead_letter_v1` | `select queue_name from pgmq.meta;` | 4 |
| Роль `evo_ai_agent`: `LOGIN`, пароль, лимит 10 соединений | `select rolcanlogin, rolpassword is not null from pg_authid where rolname = 'evo_ai_agent';` | есть, пароль задан (значение вне Git) |
| Права в схеме `public` (колонковые `GRANT UPDATE` на `accounts`, `notifications`, `profiles` для `authenticated` и прочее) | сверка с облаком; источник — `restore/acl_fix.sql`, `acl_fix2.sql` | файлы есть; состояние прав на копии не сверялось |
| Хук входа `platform_private.custom_access_token_hook` | функция есть; **включение в Auth self-hosted не настроено** (в `/opt/evo-supabase/.env` нет `GOTRUE_HOOK_*`) [live] | см. шаг 6 |
| Расширения: `pg_net`, `pgcrypto`, `pgmq`, `supabase_vault`, `uuid-ossp`, `vector` | `select extname from pg_extension;` | есть |

Если триггер, политики, публикация или права отсутствуют — применить из файлов
`restore/` и записать расхождение в этот документ.

### Шаг 5. Файлы Storage (дельта)

Файлы лежат на диске сервера в том же устройстве, что и метаданные. Порядок:
сначала метаданные (`storage.buckets`, `storage.objects`) — они уже восстановлены
на шаге 3, — затем догнать недостающие файлы скриптом
`/opt/evo-supabase/restore/storage-copy-run.sh` [live]:

```bash
ssh hermes-vps 'cd /opt/evo-supabase/restore && ./storage-copy-run.sh dryrun'   # только сверка
ssh hermes-vps 'cd /opt/evo-supabase/restore && ./storage-copy-run.sh copy'
ssh hermes-vps 'cat /opt/evo-supabase/restore/storage-copy.progress.json'
```

Скрипт читает облако только на чтение, ключ облака берёт в процессе из
`/opt/evo-crm/.env.production` (поэтому **до** шага 8 файл ещё облачный), кладёт
каждый объект в раскладку файлового бэкенда так, что восстановленные строки
`storage.objects` остаются верными, существующие файлы пропускает (19.10: 1884
скопировано, 5997 пропущено, 0 ошибок, 9,4 ГБ за 491 с). Для одной корзины:
`ONLY_BUCKET=<имя>`; параллелизм `CONCURRENCY` (до 8). Останавливается при
`MemAvailable` ниже 4 ГиБ или свободном диске ниже 60 ГБ. Итог — в
`storage-copy.summary.json`: `failed` = 0 и `done` = `total`. Тяжёлую базу знаний
заново не копируют: её объекты уже на месте и пропускаются.

### Шаг 6. Настройки Auth self-hosted

Через `/opt/evo-supabase/.env` и перезапуск только службы `auth`
(`docker compose up -d --no-deps auth` из `/opt/evo-supabase`; не `down`).
Значения брать из облака (панель Supabase, Auth) и `supabase/config.toml` [repo]:

| Настройка | Значение |
|---|---|
| Хук входа | `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`, `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/platform_private/custom_access_token_hook` (как `[auth.hook.custom_access_token]` в `config.toml`); он добавляет claims `platform_role` и `platform_access_version`, по которым прокси отличает сотрудника |
| Регистрация | выключена (`DISABLE_SIGNUP=true`), автоподтверждение выключено (`ENABLE_EMAIL_AUTOCONFIRM=false`) |
| `SITE_URL` | `https://crm.evoadmissions.com` |
| Список редиректов | ровно `https://crm.evoadmissions.com/auth/staff`, `https://app.evoadmissions.com/auth/callback`, `https://app.evoadmissions.com/auth/signup-confirmation` |
| SMTP | Resend: `smtp.resend.com:465`, пользователь `resend`, отправитель `evo@evoadmissions.com`, имя `EVO Admissions`, лимит 100 писем в час (`docs/runbooks/resend-auth-email.md`); ключ Resend — из SOPS, не в чат |
| Шаблоны | Invite, Recovery, Confirm signup — русские, как в облаке (`supabase/templates/`, `docs/runbooks/team-workspace-activation.md`); ссылка сохраняет `RedirectTo` |
| Длина OTP | 8 знаков (`MAILER_OTP_LENGTH=8`; в env CRM `EVO_STUDENT_SIGNUP_OTP_LENGTH=8`) |
| `JWT_EXPIRY` | 3600 |
| `API_EXTERNAL_URL` | `https://supabase.evoadmissions.com/auth/v1` (уже так; путь `/auth/v1` в значении нужен) [live] |

Сессии: подпись JWT self-hosted другая, чем у облака, поэтому все прежние
сессии (сотрудники, кабинет студентов, iPhone) станут недействительными, вход
заново. Cookie прежнего проекта `sb-iosckaqtovbbnssqcpde-auth-token` остаётся в
браузерах; прокси должен увидеть его как недействительную сессию и отправить на вход
[не проверено]. Пароли сохраняются: хэши переехали в `auth.users` с дампом.

### Шаг 7. Ledger self-hosted

Чтение ledger можно проверить сразу после шага 3, на сервере

```bash
ssh hermes-vps "docker exec evo-supabase-db psql -U postgres -d postgres -X -A -t -c 'select count(*), max(version) from supabase_migrations.schema_migrations'"
```

Недостающий хвост (если дамп снят раньше последней миграции `main`) применяется
workflow `EVO schema ledger` в режиме `apply` после установки
`EVO_SUPABASE_TARGET=selfhosted` — сначала `check`, затем `apply`:

```bash
gh variable set EVO_SUPABASE_TARGET --body selfhosted -R izzhackt/evo_AI_CRM
gh workflow run "EVO schema ledger" -f mode=check -R izzhackt/evo_AI_CRM
gh workflow run "EVO schema ledger" -f mode=apply -R izzhackt/evo_AI_CRM
```

`apply` печатает «dry-run», список к применению, каждую применённую миграцию и
итоговый ряд. Доступ к серверу в режиме `selfhosted` workflow даёт только при
запуске с ветки `main` (защита от ошибочного запуска, не от правки самого workflow). Текст ошибок psql в журнал Actions не попадает (журнал публичный):
только код SQLSTATE и номер строки. Если миграция не применилась, остановиться,
повторить файл на сервере вручную с полным сообщением:

```bash
ssh hermes-vps 'docker exec -i evo-supabase-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 --single-transaction' < supabase/migrations/NNN_name.sql
```

(это для диагностики; в ledger запись при этом не вносится). Применение по SSH на
живой базе self-hosted ещё не выполнялось — на проверенной временной базе
Postgres 17 файл с `begin/commit`, файл без транзакции, файл без завершающей
строки и падение посреди файла вели себя ожидаемо [запись 20.10], но не на
`evo-supabase-db`.

Переменная `EVO_SUPABASE_TARGET=selfhosted` остаётся выставленной и для выпуска
(шаг 8): она влияет только на ledger и на проверки выпуска. Выпуск при ней и
облачном `.env.production` отказывает (`public_supabase_project_mismatch`), а не
работает с неверной базой.

### Шаг 8. Смена env рабочей CRM и выпуск

1. Править `/opt/evo-crm/.env.production` (копия — предусловие 4): заменить
   ровно три значения (`NEXT_PUBLIC_SUPABASE_URL=https://supabase.evoadmissions.com`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EVO_PLATFORM_SUPABASE_SECRET_KEY`).
   Формат строк `NAME=value`, без кавычек и `export` (контроллер отказывает).
   Режим файла 0600. Остальные значения (организация
   `EVO_PLATFORM_ORGANIZATION_ID`, секреты вебхуков) переехали с данными и не
   меняются.
2. Переменная `EVO_SUPABASE_TARGET=selfhosted` (шаг 7) — убедиться, что стоит.
3. Выпуск текущего `main` по контракту выпуска (`deploy/fast-app-release.md`):
   флаг `EVO_PRODUCTION_RELEASE_ARMED` = `false` и нет идущих прогонов → arm →
   запуск `EVO platform CI` с `proof_revision` → при 403 на допуске `gh run rerun`
   того же прогона → `EVO fast app release` → **обязательно disarm** → health 200.
   Контроллер до запуска проверяет env (`public_supabase_project_mismatch`, если
   в файле остался облачный адрес), ключи (два запроса к
   `supabase.evoadmissions.com`) и ledger (по SSH); любое расхождение — отказ до
   замены контейнера. Если приёмка (`browser smoke`) не проходит, контроллер
   возвращает прежний контейнер с прежним env-снимком: облачным.
4. Остановленные в шаге 1 контейнеры ИИ-агента запускать только после шага 10.

Пока образ не выпущен заново, запускать старый контейнер `evo-crm-app-1` с новым
env нельзя: образ собран с прежней идентичностью и не проходит приёмку.

### Шаг 9. Vault (ключ WAHA)

Vault self-hosted пуст [запись]. Ключ WAHA кладётся в Vault тем же скриптом, что
в облаке (`docs/runbooks/whatsapp-go-live.md`, § F), но **после** шага 8, потому
что скрипт читает `NEXT_PUBLIC_SUPABASE_URL` из env контейнера app:

```bash
S="docker exec -i evo-crm-app-1 node scripts/waha-runtime-binding.mjs"
printf '%s' "$KEY" | $S provision --key-stdin --dry-run
printf '%s' "$KEY" | $S provision --key-stdin
$S check --verify-key
```

Plain-ключ WAHA берётся из SOPS, в журнал и файлы не пишется; в `.env.waha`
остаётся только хэш. Скрипт принимает ровно `https://supabase.evoadmissions.com`
[repo]. Пока Vault пуст, ручные ответы из CRM и проба статуса WAHA не работают —
это проверка 8 шага 11.

### Шаг 10. ИИ-агент

`EVO_AI_AGENT_ENABLED=true` в переменных GitHub [live]. Агент ходит в базу
напрямую ролью `evo_ai_agent` через Supavisor (режим транзакций):
`EVO_AI_AGENT_DATABASE_URL` в `/opt/evo-crm/.env.ai-agent`. После переключения он
должен указывать на Supavisor self-hosted (`127.0.0.1:25433` на хосте [live]; имя
пользователя вида `evo_ai_agent.<tenant>`, тенант Supavisor — из
`/opt/evo-supabase/.env`). Контейнеры агента живут в своей сети `evo_crm_ai`, до
`127.0.0.1` хоста они не дотянутся: как подключить сеть к Supavisor — **[не
проверено]**, решается на репетиции (не открывая порт базы наружу). До этого
агент остаётся остановленным; CRM без агента работает (флаг `…AUTOSEND` в `0`).

### Шаг 11. Проверки после выпуска

Делает оператор; агентам входить в production-интерфейс нельзя.

1. `curl -s -o /dev/null -w '%{http_code}' https://crm.evoadmissions.com/api/health`
   → 200 и `https://app.evoadmissions.com/login` → 200.
2. Вход сотрудника и студента (владелец или QA-аккаунт владельца). Автоматическая
   часть уже в выпуске: «Authenticated read-only case and Student portal smoke»
   входит админом и студентом и открывает дело.
3. Realtime: открыть командный чат и чат дела в двух окнах, отправить сообщение —
   приходит без перезагрузки (проверка `phx_join` через публичный адрес
   [не проверено] до этого шага).
4. Storage: загрузка документа меньше 6 МиБ (прямая) и **больше 6 МиБ** (TUS,
   `/storage/v1/upload/resumable` на том же origin, ответ `Location` должен быть
   на `https://supabase.evoadmissions.com`) [не проверено], скачивание, фото
   вуза, страны, города по адресам `https://supabase.evoadmissions.com/storage/v1/…`.
5. Письма Auth: сброс пароля на тестовый адрес владельца (через Resend), ссылка
   открывает `https://crm.evoadmissions.com/auth/staff` [не проверено: SMTP
   self-hosted выключен].
6. Хук входа: после входа в токене есть claim `platform_role` (иначе сотрудник не
   узнаётся прокси).
7. Ledger: `EVO schema ledger` в режиме `check` — «недостающие» и «лишние» пусты.
8. WhatsApp: `docker exec evo-crm-app-1 node scripts/waha-runtime-binding.mjs check
   --verify-key`; входящее и исходящее сообщение; сессия `crm_primary` `WORKING`.
9. Заявка с сайта (тестовая заявка владельца) и счёт по `website-intake-health.md`.
10. Телефония: входящий звонок попадает в карточку, `docs/runbooks/telephony-go-live.md`.
11. Журнал приложения: ни одной строки с `supabase.co` (`docker logs --since 30m
    evo-crm-app-1 2>&1 | grep -c 'supabase\.co'` = 0).
12. Скорость: `scripts/timing-report.mjs` по `evo_timing` за час работы, сравнить с
    замерами копии; тяжёлые экраны («WhatsApp», воронка) открываются 10 из 10.

Для выпуска «приёмка» — это пп. 1–2 плюс шаги контроллера; остальное фиксирует
оператор в `docs/EVO_LAUNCH_PLAN.md`.

### Шаг 12. iPhone

Приложение к облаку не привязано: `ios/scripts/write-release-config.sh` и
`check-release-config.sh` принимают любой `https://` адрес (проверено 20.10 на
временном файле). Сборка с новым адресом — одна запись конфигурации:

```bash
SUPABASE_URL=https://supabase.evoadmissions.com \
SUPABASE_PUBLISHABLE_KEY=<publishable-ключ self-hosted> \
DEVELOPMENT_TEAM=<Team ID> \
ios/scripts/write-release-config.sh
```

Дальше обычный архив (`ios/README.md`, «Выпуск в App Store»). Текущие сборки
(TestFlight и любые другие) продолжают ходить в облако, где после переключения
ничего не обновляется: сотрудникам и студентам нужна сборка с новым адресом, и
выпускается она сразу после шага 11. `Release.xcconfig` вне Git, текущий файл не
менять до переключения. Вход заново.

### Шаг 13. Откат

Откат возможен без потери данных только пока в self-hosted не появились новые
записи пользователей. **Точка невозврата — приём первого запроса на запись
после запуска приложения на self-hosted** (сотрудник сохранил, студент
загрузил, пришло сообщение WhatsApp). После неё возврат на облако теряет всё,
что записано за это время; обратного переноса из self-hosted в облако в этом
документе нет.

До точки невозврата:

1. `gh variable set EVO_SUPABASE_TARGET --body cloud -R izzhackt/evo_AI_CRM`
   (или `gh variable delete EVO_SUPABASE_TARGET`).
2. Вернуть env: `cp -p /opt/evo-crm/.env.production.pre-selfhosted
   /opt/evo-crm/.env.production` (0600).
3. Выпуск того же `main` в режиме `cloud` (шаг 8.3) — приложение возвращается на
   облако; либо автоматический откат контроллера при провале приёмки (он
   возвращает прежний контейнер и прежний env-снимок).
4. Ключ WAHA в Vault облака на месте (self-hosted Vault облако не трогает).
5. Запустить остановленных (ИИ-агент) с прежним `EVO_AI_AGENT_DATABASE_URL`.
6. Сессии, выданные self-hosted, перестанут быть действительны: вход заново.

После точки невозврата откат — это решение владельца: потеря записей окна против
времени простоя; данные self-hosted при этом не стираются, их можно перенести в
облако отдельной работой.

## 4. После переключения

- Задача на удаление облачного пути: #1271 (срок — 14 дней после приёмки).
- Новый ADR вместо ADR 0024 (следующий номер на 20.10 — 0034), правка пунктов
  `AGENTS.md` про проект `iosckaqtovbbnssqcpde`, `deploy/*.md`.
- Старые JWT-ключи облачного проекта отключить после проверки, что ими никто не
  пользуется (`infrastructure-map.md`, раздел 7). Облачный проект не удалять
  (решение владельца).
- Фильтр `apikey` в журнале edge-Caddy: до того как приложения начнут ходить на
  `supabase.evoadmissions.com` с service-ключом, добавить в общий журнал edge
  фильтр, стирающий заголовок `apikey` и параметр `apikey` в адресе (запись
  PLAN_CHANGES 19.10): иначе при недоступном шлюзе ключ может попасть в журнал
  контейнера `evo-edge-caddy`. Сейчас **не сделано**.
- `docs/runbooks/infrastructure-map.md`: раздел 4 («База и файлы») и раздел 5
  («резерв») обновить по факту.

## 5. Что не проверено на 20.10

- Применение миграций по SSH на живой базе `evo-supabase-db` (только на временной
  Postgres 17 и юнит-тестами).
- Ключи формы `sb_secret_` через шлюз self-hosted для RPC PostgREST.
- Realtime до подписки на канал, вход пользователя, письма Auth и OAuth через
  `supabase.evoadmissions.com`.
- Загрузка документа больше 6 МиБ (TUS) через публичный адрес.
- Подключение контейнеров ИИ-агента к Supavisor self-hosted.
- Источник чистого тома `pgdata.clean` и точные команды дампа 19.10.
- Поведение вебхуков WAHA и заявок сайта, пока приложение остановлено.
- Отказ приёмки контроллера на реальном выпуске в режиме `selfhosted` (юнит-тесты
  и тесты workflow проходят; живого прогона не было).

Источники: `docs/PLAN_CHANGES.md` (записи 19–20.10), `docs/runbooks/infrastructure-map.md`,
`docs/runbooks/whatsapp-go-live.md`, `docs/runbooks/resend-auth-email.md`,
`supabase/config.toml`, `deploy/fast-app-release.md`, чтение сервера 20.10
(только чтение: файлы `/opt/evo-supabase/restore`, состояние базы self-hosted,
имена переменных).
