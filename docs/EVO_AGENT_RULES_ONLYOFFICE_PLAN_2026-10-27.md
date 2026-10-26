# EVO — «Правила агента» как документ Word: ONLYOFFICE Docs на hermes (план, 27.10.2026)

**Статус: план до кода, ревизия 1 от 27.10 по независимой критике (§19).** Это рабочий
контракт для срезов R0–R6 и необязательного R7 (§15): что строим, где это живёт, по
каким правилам и как принимаем. Запись о плане в `docs/PLAN_CHANGES.md` и строку в
`docs/EVO_LAUNCH_PLAN.md` добавляет общая запись 27.10 (одна на все планы этого дня);
этот файл их не правит. До слияния план проходит независимое review по точному head.

Факты проверены только чтением:

- код `origin/main` `cd611c536` (production, ledger миграций 322). Открыт PR #1306:
  вкладка «Инструкция» становится «Правила агента», вкладка по умолчанию — «Чат».
  Ключ вкладки в адресе остаётся `instructions`: запись PR #1306 в
  `docs/PLAN_CHANGES.md` и `AI_AGENT_TABS` в `src/lib/v3/ai-agents-view.ts:44-51`.
  План строится поверх #1306 и после его слияния;
- сервер `hermes-vps` 26.10, только чтение: 4 vCPU, 16 ГБ (около 9 ГБ доступно),
  **swap нет**, свободно 97 ГБ. Публичный edge — `evo-edge-caddy` в сети
  `evo_public_web`;
- исследование 26.10 (рабочий файл `research-doc-editor.json` вне Git, вариант 4 и
  поправки к нему) и официальная документация ONLYOFFICE, прочитанная 27.10 (§18);
- исходники образа ONLYOFFICE, прочитанные 27.10 по ветке `master` (§18):
  `Docker-DocumentServer/run-document-server.sh` (`b8f5ba80bbaa`),
  `server/Common/config/default.json` (`6d033e7987da`),
  `document-server-package/.../documentserver-flush-cache.m4` (`ed465abdf602`).
  Номера строк ниже — по этим коммитам; на закреплённом теге образа они
  сверяются в R0.

На сервере, в DNS, в Claude и в базе ничего не менялось. Документы владельца и
картинки из них не открывались.

## 0. Чего этот план не разрешает

- Изменения на `hermes-vps` (swap, новый контейнер, новая сеть Docker, подключение
  edge к сети, правка edge Caddy, секреты в env), запись в DNS у Spaceship, выпуск
  приложения и применение миграции. Каждое такое действие — только после разрешения
  владельца в чате, в окне выпусков (§14.2).
- Изменение release controller (`scripts/evo-fast-release.sh`) иначе как отдельным
  срезом с тестами и независимым review по точному head (§5.2, §15).
- Загрузку в EVO китайского гайда с 18 картинками до ответа владельца (§16 п.3).
  До ответа грузится только очищенный владельцем `.docx` (§8.3).
- Передачу картинок из документов в Claude (описания через vision) без просмотра
  владельцем. По умолчанию картинки агенту не передаются (§8.3).
- Изменение порядка синхронизации с Claude, сети среды агентов, WAHA и lead-agent.
  WAHA и lead-agent остаются приватными, их сессии не трогаются.
- Изменение Arcadis/acadis и чужих проектов на сервере (SoodaCloser, OlympiadAI).
- Правку исходного кода ONLYOFFICE. Используется только официальный образ без
  изменений; настраивается он переменными окружения и файлами настроек (§11).

## 1. Цель и границы

**Цель.** Администратор открывает вкладку «Правила агента» и правит правила агента
как обычный документ Word прямо в CRM: заголовки, таблицы, списки, картинки, шрифты.
Документ `.docx` хранится в EVO с версиями. Из сохранённой версии EVO собирает текст,
показывает его перед отправкой, и по кнопке «Применить к агенту» этот текст уходит в
Claude обычной синхронизацией.

**Входит:**

1. ONLYOFFICE Docs Community Edition на `hermes-vps`: свой Compose-проект и контейнер,
   образ по digest, своя изолированная сеть, лимиты памяти и CPU, публичный путь
   через `evo-edge-caddy`.
2. Хранение `.docx` в закрытом bucket Supabase Storage: версии, восстановление,
   удаление версии безвозвратно.
3. Загрузка своего `.docx` и создание документа из текущих правил.
4. Маршруты CRM: конфигурация редактора, отдача файла редактору, callback сохранения
   с проверкой JWT, сверка сессий и «забытых» файлов ONLYOFFICE.
5. Конвертер `.docx` → текст для агента, решения по каждой картинке, предпросмотр,
   «Применить к агенту», синхронизация с Claude существующим путём.

**Не входит:**

- Совместная правка с не-администраторами и выдача `.docx` агенту как файла или
  Skill. Агент получает только текст (§8).
- Правка на телефоне. На узком экране вкладка показывает текст правил и строку
  «Откройте на компьютере» (§10).
- Автоописание картинок через Claude. Это необязательный срез R7 после решения
  владельца (§8.3).
- Правка других документов CRM (база знаний, документы студентов) в ONLYOFFICE.
  Сервис ставится под правила агентов; расширение — отдельным планом.

## 2. Решения владельца

Окончательные решения 26.10.2026:

| № | Решение | Откуда |
|---|---|---|
| 1 | Правила агента правятся как **настоящий Word в ONLYOFFICE** (ответ «Настоящий Word (ONLYOFFICE)»). Исследование советовало начать с загрузки `.docx` и страницы базы знаний; владелец выбрал ONLYOFFICE. Выбор не пересматривается | вопрос владельцу 26.10 |
| 2 | Вкладка «Инструкция» называется «Правила агента», вкладка по умолчанию — «Чат» | PR #1306 |
| 3 | Правят правила только администраторы (как сейчас) | бриф 26.10 |
| 4 | Картинки китайского гайда (18 шт.) могут содержать персональные данные: в ИИ без просмотра владельцем не отправляются | бриф 26.10 |

Открытые вопросы владельцу собраны в §16. Без ответов на п.1–2 из §16
инфраструктурные срезы не начинаются. R0 делается только по варианту публичного
пути, который выберет владелец (§16 п.1). Код и миграцию можно готовить и проверять
локально до ответов.

## 3. Исходное состояние (27.10)

### 3.1. Как устроены правила агента сейчас

- Вкладка — `InstructionsEditor` (`src/components/v3/ai-agents/InstructionsEditor.tsx`).
  Текстовое поле на 18 строк, `min-h-72` (`:80-90`). Сохранение — server action
  `saveAiAgentInstructionsAction` (`:46`, `:57`). «Сбросить на стандартную» — с
  подтверждением (`:102-114`). Не-администратор видит только текст (`:118-122`).
  Вызов из `AgentBody.tsx:177-190`.
- Сохранение: `src/lib/platform-ai-agents-actions.ts:211-233`. Пустой текст и текст,
  равный стандартному, означают «стандартные правила» (`:226-228`). Общий путь
  `applyUpdate` (`:142-189`): только `systemRole === "admin"` (`:148`), затем RPC
  `ai_agents_update_v1`. Ответ RPC несёт список `changed` (`:169`). Если изменилось
  поле из `SYNC_FIELDS` (`:58-60`, в том числе `instructionsOverride`) и агент уже
  есть в Claude, синхронизация запускается сама (`:173-188`).
- `instructionsOverride` в эту RPC приходит двумя путями: из
  `saveAiAgentInstructionsAction` (`:211-233`) и из общего `updateAiAgentAction`
  (`:191-209`, разбор патча `parsePatch`, поле — `:111-113`). Любое ограничение
  «правила ведутся в документе» должно действовать в базе, а не только в интерфейсе
  (§7.2).
- База: колонка `platform_private.ai_agents.instructions_override TEXT`
  (миграция 317, `:129`), ограничение до 60 000 знаков (`:162`). RPC
  `platform.ai_agents_update_v1` (`:916-1066`): только админ (`:925-928`), проверка
  версии `config_version`, разбор `instructionsOverride` и лимит 60 000 (`:976-990`),
  список `changed` (`:1022-1045`), ответ `{key, configVersion, changed}` (`:1064`).
  Миграции 318–322 эту функцию не меняли. Текст правил в журнал аудита не пишется
  (`:915`).
- Лимит в TypeScript: `AI_AGENT_LIMITS.instructionsMaxChars = 60_000`
  (`src/lib/ai-agents/contract.ts:203-204`).
- Что видит Claude: `system = buildAiAgentSystemPrompt(key, instructionsOverride)`
  (`src/lib/server/ai-agents/sync.ts:442`). Это общая преамбула (5 514 знаков,
  `src/content/ai-agents/_preamble.md`), разделитель `\n\n---\n\n` и правила
  (`src/content/ai-agents/index.ts:42-51`). Хеш конфигурации включает `system`
  (`src/lib/server/ai-agents/config-hash.ts:70-88`). Из-за этого любое изменение текста
  показывает плашку «Изменения не отправлены в Claude».
- Синхронизация: только админ вне просмотра роли (`sync.ts:313-314`). Без правил
  агент в Claude не создаётся (`sync.ts:355-357`). Панель — `SyncPanel.tsx:50-110`.
- Просмотр роли (`isStaffPreview`, `src/lib/platform-access.ts:36-38`) существует
  только в приложении. `platform_private.ai_staff_actor` в базе
  (`269_platform_ai_agent_rpc.sql:81-100`) такого понятия не знает. Поэтому отказ
  при просмотре роли проверяется только в коде приложения.
- Потолок API Claude Managed Agents для `system` — 100 000 знаков (исследование,
  Create Agent API). Лимит EVO 60 000 — собственный. Сейчас: преамбула 5 514 +
  разделитель 7 + до 60 000 = до 65 521, запас есть. Стандартные правила
  curator-cn — 25 986 знаков, curator-my — 24 336 (`src/content/ai-agents/*.md`).

### 3.2. Готовые части EVO, которые план использует

| Часть | Где | Для чего в плане |
|---|---|---|
| Закрытый bucket «только сервер» с RESTRICTIVE-политикой и проверкой дрейфа | миграция 271, `:37-60` | образец bucket правил (§7.1) |
| Проверка OOXML и запрет макросов (`vbaProject.bin`, `activeX/`) | `src/lib/server/ai-agent-files.ts:56`, `:78-99` | проверка загруженного и сохранённого `.docx` |
| Проверка картинок по сигнатуре байтов | ветка `image` в `checkAiUploadContent`, `ai-agent-files.ts:82-84` | маршрут картинок (§7.3) |
| Чтение тела запроса с потолком | `ai-agent-files.ts:118` (`readCappedBody`) | загрузка, callback |
| Конвейер загрузки: `sameOrigin` → право → multipart → лимит одновременных загрузок → проверка содержимого → ClamAV → Storage → RPC | `createAiDocumentUploadHandler`, `src/lib/server/ai-agent-knowledge-route-handlers.ts:297-320`, `receiveUpload` `:323`, ClamAV `:352`; лимит `AI_UPLOAD_CONCURRENCY` `:73` | загрузка `.docx` (§7.3): общие шаги выносятся, а не копируются |
| Проверка origin для POST | `sameOrigin`, `src/lib/server/ai-agent-route-handlers.ts:96` | все POST-маршруты браузера |
| Заголовки отдачи картинок | `IMAGE_HEADERS`, `ai-agent-knowledge-route-handlers.ts:76-83` | маршрут картинок (§7.3) |
| ClamAV | `src/lib/server/clamd-malware-scanner.ts`, сервис `clamav` (`docker-compose.prod.yml:64-89`) | проверка файла перед записью в Storage |
| Разбор ZIP с потолками | `parseStandardZip`, `src/lib/server/platform-company-file-storage-route-handlers.ts:256` (до 2 048 записей, сумма до 100 МБ, `:37-38`) | защита от zip-бомб до разбора |
| Чтение и сборка `.docx` без новых зависимостей: `pizzip` 3.2.0, `@xmldom/xmldom` 0.9.12 | `package.json:92`, `:98`; `src/lib/server/university-form-docx.ts:5-6`, `src/lib/server/document-package.ts:3` | конвертер (§8) и стартовый `.docx` (§7.7) |
| Безопасный Markdown | `src/components/v3/ai-agents/Markdown.tsx` | предпросмотр «Что получит агент» |
| Список разрешённых маршрутов: всё, чего нет в списке, — 404 | `src/lib/platform-route-contract.ts:148-185` (`PLATFORM_PRIVATE_API_ALLOWLIST`), `:306-310`, `:352-389` | новые маршруты (§7.3) |
| Внутренние маршруты `/api/internal/*`: снаружи edge отвечает 404 | `Caddyfile.evo-edge:37-38`; пример — `src/app/api/internal/ai-agent/send/route.ts` | файл и callback для ONLYOFFICE |
| Функция выключена, пока секрета нет | `src/lib/server/ai-agent-internal-auth.ts:27-41`; `OPTIONAL_RUNTIME_NAMES` и `OPTIONAL_SECRET_NAMES` в `scripts/evo-app-env-contract.mjs:55`, `:65` | `EVO_ONLYOFFICE_*` необязательны |
| Своя сеть службы и подключение CRM к ней через release controller | ИИ-агент: сеть `evo_crm_ai` (`docker-compose.prod.yml:118-126`, `:218-222`), override `AI_AGENT_APP_NETWORK_OVERRIDE` и проверка сетей (`scripts/evo-fast-release.sh:36-44`, `verify_networks` `:601-636`, откат `:2015-2019`) | сеть `evo_docs` (§5.2) |
| Безопасная замена функции базы | проверка `md5(prosrc)` прежнего тела (`319_platform_ai_agents_hardening.sql:56-73`), итоговая проверка определителя, прав и числа функций (`322_platform_ai_agents_daily_spend.sql:96-125`) | замена `ai_agents_update_v1` (§7.2) |

### 3.3. Сервер, сети и edge

- `hermes-vps`: 4 vCPU, 16 ГБ, swap нет, `ufw` выключен, поэтому любой опубликованный
  порт виден снаружи (`docs/runbooks/infrastructure-map.md:72-73`). Самые крупные по
  памяти контейнеры (исследование 26.10): `sales-assistant-reranker` 2,27 ГиБ,
  `clamav` 1,03 ГиБ.
- Self-hosted Supabase стоит с `cpu_shares 256` и `oom_score_adj 500`. При нехватке
  памяти ядро первым убьёт рабочую базу (`infrastructure-map.md:181-186`).
- Ночная чистка удаляет образы без контейнеров (`infrastructure-map.md:76`, `:82-83`).
  Остановленный через `down` стек к утру теряет образ.
- Резервных копий self-hosted Supabase нет по решению владельца 20.10
  (`infrastructure-map.md:165`).
- DNS: записи `@`, `app`, `crm`, `www`, `supabase` указывают на сервер. Wildcard-записи
  нет (`infrastructure-map.md:43-56`), поэтому новый поддомен — это новая A-запись.
- **Сеть `evo_public_web` общая для чужих проектов.** В ней, кроме CRM и edge,
  сайт `evo-website-web`, `olympiadai-lms`, `soodacloser-landing`,
  `sales-assistant-api` (`infrastructure-map.md:85-93`, `:118-130`) и шлюз рабочей
  базы `evo-supabase-gw:8000` (`:175`). Снаружи у шлюза открыты только четыре
  семейства путей (`Caddyfile.evo-edge:230-237`), а изнутри сети — все.
  `sales-assistant-api` доверяет заголовкам прокси из этой сети
  (`Caddyfile.evo-edge:243-245`). Поэтому служба, которая по чужой команде делает
  HTTP-запросы, в эту сеть не ставится (§5.2).
- Edge: блок `crm.evoadmissions.com, app.evoadmissions.com` ведёт на
  `evo-crm-app:3000` (`Caddyfile.evo-edge:108-118`). На все ответы ставятся
  `X-Frame-Options "DENY"` (`:50`) и `Content-Security-Policy-Report-Only` с
  `frame-ancestors 'none'` (`:45`). Правка — на месте, с резервной копией,
  `caddy validate` и `caddy reload`. Контейнер не пересоздаётся и не
  перезапускается, новые тома и env к нему не добавляются
  (`infrastructure-map.md:107-116`; `agent-lead2-inbox/deploy/docker-compose.edge.yml`,
  комментарий к томам). Compose-проект edge `evo-edge` подключён к одной сети `web`
  (`evo_public_web`).
- Журналы edge: глобальный журнал заменяет `apikey`, `access_token`, `token`,
  `token_hash` (`Caddyfile.evo-edge:17-33`). Журнал доступа `(evo_app)` заменяет
  только `token_hash` (`:56-66`).
- Cookie сессии сотрудника — host-only на `crm.` (`deploy/README.md:34`). При этом они
  **читаются JavaScript**: `@supabase/ssr` 0.12.0 по умолчанию ставит
  `httpOnly: false` (`DEFAULT_COOKIE_OPTIONS`), а `src/lib/supabase/server.ts:15-38`
  этого не переопределяет. Любой чужой скрипт на origin `crm.` получает сессию (§6).
- Выпуск CRM — только через CI, вручную на сервере не выкатывать
  (`infrastructure-map.md:150`). Env приложения — неизменяемый снимок на каждое
  поколение выпуска (`deploy/fast-app-release.md:308-320`). Значит, сменить
  `EVO_ONLYOFFICE_*` можно только новым выпуском, а не перезапуском.
- Release controller проверяет, что сети каждого контейнера CRM ровно такие, как в
  отрисованном compose (`scripts/evo-fast-release.sh:601-636`). Ручной
  `docker network connect` для контейнера CRM сломает следующий выпуск
  (`runtime_network_contract_invalid`).

### 3.4. Что делает образ ONLYOFFICE при каждом старте

По `run-document-server.sh` и `default.json` (§18):

| Что | Где | Следствие для плана |
|---|---|---|
| `PLUGINS_ENABLED` по умолчанию `true`; при старте `documentserver-pluginsmanager --update=plugin-list-default.json` качает плагины из интернета | `:19`, `:818` | выключить (§5.1) |
| Админ-панель запускается по умолчанию, выключается `ADMINPANEL_ENABLED=false` | `:772-775` | выключить |
| Стартовая страница включена по умолчанию (`WELCOME_PAGE_ENABLED`) | `:59`, `:633` | выключить |
| Журнал доступа внутреннего nginx включён (`NGINX_ACCESS_LOG=true`): адреса файлов с подписями | `:38`, `:674-677` | выключить |
| `ALLOW_PRIVATE_IP_ADDRESS=true` включает `request-filtering-agent.allowPrivateIPAddress` **для всего сервера**: и для скачивания файла, и для картинок по URL, и для HTML из буфера обмена. Исключения «только для подписанных запросов» нет | `:56`, `:539-543`; `default.json:472-474` | блокер ревизии: §5.2 |
| ИИ-функции включены: `aiSettings.enable: true`, `allowBrowserProxy: true`; настройки ИИ живут в `runtime.json` | `default.json:12-22`; `run-document-server.sh:142-144` | выключить и проверить в R0 (§5.1) |
| `documentserver-flush-cache` при каждом старте пересобирает `api.js` из `api.js.tpl` и подставляет `{{HASH_POSTFIX}}` = md5 от даты с точностью до минуты | `:838`; `documentserver-flush-cache.m4` | хеш `api.js` меняется при каждом перезапуске: SRI невозможен (§6.1) |
| Генерация шрифтов при старте (`GENERATE_FONTS=true`) — пик CPU | `:849-852` | замер в R0, `cpu_shares` (§5.1) |
| Ожидание ответа на callback — 10 минут | `default.json:337-340` (`callbackRequestTimeout`) | разбор успевает до ответа (§7.6) |
| Повтор callback — 3 раза, только при HTTP `429,500-599` | `default.json:545-553` | временный сбой → HTTP 500, не `{"error":1}` (§7.6) |
| Не принятый хранилищем файл уходит в «забытые» (`forgottenfiles`) | `default.json:344-345` | сверка `getForgottenList` (§7.6) |
| Данные редактора — в памяти (`editorDataStorage: editorDataMemory`); кэш файлов живёт 24 ч (`expire.files 86400`) | `default.json:349`, `:456` | перезапуск посреди правки — проба R0; политика хранения (§7.1) |
| Исходящие JWT ONLYOFFICE живут 5 минут, допуск по часам 60 с | `default.json:499-505`, `:511-513` | проверка JWT (§7.5) |

## 4. Архитектура

```
Браузер администратора: crm.evoadmissions.com/v3/ai-agents/<key>?tab=instructions
 │ 1. «Открыть редактор» → CRM (POST): сессия правки + конфиг редактора, подписанный JWT (15 мин)
 │ 2. CRM показывает <iframe src="https://docs.evoadmissions.com/evo-editor.html">
 │    и передаёт конфиг через postMessage (строгий origin). api.js в страницу CRM не грузится
 ▼
docs.evoadmissions.com (evo-edge-caddy) ──► evo-docs-onlyoffice:80        [сеть evo_docs, internal]
evo-docs-onlyoffice
 ├─3. GET  http://evo-crm-app:3000/api/internal/onlyoffice/file/<токен>      (JWT download)
 └─4. POST http://evo-crm-app:3000/api/internal/onlyoffice/callback/<сессия> (JWT callback: 1/2/3/4/6/7)
evo-crm-app (подключена к evo_docs через release controller)
 ├─5. статусы 2/3/6/7: GET url из callback, переписанный на http://evo-docs-onlyoffice/…
 │    → ClamAV → проверка OOXML → Storage (версия или карантин) → конвертер → строка версии
 ├─6. сверка: CommandService info / getForgottenList / getForgotten (JWT) по внутреннему адресу
 └─7. «Применить к агенту» (админ) → база сама собирает текст версии → instructions_override,
      config_version+1, changed → 8. обычная синхронизация с Claude (sync.ts:442)
```

Главное свойство: **ONLYOFFICE лежит — агент работает.** Claude получает текст, а
текст хранится в `instructions_override`. Редактор нужен только чтобы этот текст менять.

## 5. Развёртывание ONLYOFFICE на `hermes-vps`

### 5.1. Compose-проект

Новые файлы в репозитории:

- `deploy/onlyoffice/docker-compose.onlyoffice.yml`;
- `deploy/onlyoffice/env.onlyoffice.example` — только имена и заглушки;
- `deploy/onlyoffice/evo-editor.html` и `evo-editor.js` — исходник обёртки iframe
  (§6.1). Edge отдаёт их копию из своего Caddyfile; тест сверяет копию с файлом;
- `deploy/onlyoffice/README.md` — runbook: установка, сеть, обновление образа, смена
  секрета, остановка, откат, очистка кэша, проверки.

Образец отдельного compose-проекта со своим жизненным циклом —
`agent-lead2-inbox/deploy/docker-compose.edge.yml` (проект `evo-edge`). На сервере:
каталог `/opt/evo-docs`, проект `evo-docs`, контейнер `evo-docs-onlyoffice`. Выпуск
CRM его не пересоздаёт.

| Параметр | Значение | Почему |
|---|---|---|
| Образ | `onlyoffice/documentserver@sha256:<digest>`, метка `com.evo.image.provenance: "official-third-party-digest"` | как `clamav` (`docker-compose.prod.yml:66-68`). Последняя стабильная 10.0.x на день R1; tag и digest — в runbook. `latest` не использовать |
| Порты | **не публикуются** (`expose: 80` только в сеть) | `ufw` выключен: опубликованный порт был бы виден снаружи |
| Сеть | только `evo_docs` (§5.2), alias `evo-docs-onlyoffice` | не `evo_public_web` и не `evo_crm_private` |
| CPU | `cpus: "1.50"`, `cpu_shares: 128` | у служб Supabase `cpu_shares 256` (`infrastructure-map.md:181-182`): редактор должен весить меньше рабочей базы, через которую идёт телефония. Официальный минимум — 2 ядра; насколько медленнее открытие и сохранение на 1,5, замеряет R0 |
| Память | `mem_limit: 4096m` на старт; после замера в R0 — не меньше 2× пика и не меньше 3072m | официальный минимум — 4 ГБ RAM |
| Swap контейнера | `memswap_limit: 5120m`, если владелец разрешит swap на хосте (§5.4) | — |
| OOM | `oom_score_adj: 800` | при нехватке памяти ядро первым убьёт редактор, а не Supabase (500) и не CRM. Гибель редактора — штатный случай: §7.6 описывает, как правки не теряются |
| `pids_limit` | 512 | как WAHA |
| Журнал Docker | `json-file`, 10 МБ × 5 | как во всех EVO-службах |
| Тома | `evo_docs_data:/var/lib/onlyoffice` (кэш, «забытые»), `evo_docs_logs:/var/log/onlyoffice` | официальная страница установки (§18). Внутренняя PostgreSQL образа лежит в `/var/lib/postgresql` вне томов: переживают ли несохранённые изменения `restart` и пересоздание, проверяет R0; при нужде добавляется том `evo_docs_db:/var/lib/postgresql` |
| `security_opt` | `no-new-privileges:true` (в R0 проверить, что не мешает) | — |
| healthcheck | `curl -fsS http://127.0.0.1/healthcheck` раз в 30 с, `start_period: 180s` | есть ли `curl` в образе, проверить в R0 |
| `restart` | `unless-stopped` | — |

Переменные окружения (`/opt/evo-docs/.env.onlyoffice`, `chmod 600`, вне Git; имена
сверены с официальной страницей установки и `run-document-server.sh`, §18):

| Имя | Значение | Зачем |
|---|---|---|
| `JWT_ENABLED` | `true` (по умолчанию тоже) | все запросы подписаны |
| `JWT_SECRET` | случайные ≥ 32 байта | без него образ генерирует новый секрет при каждом старте (`:47-49`), и интеграция ломается |
| `JWT_HEADER` | `Authorization` (по умолчанию) | — |
| `ALLOW_PRIVATE_IP_ADDRESS` | `true` **только в варианте сети С1** (§5.2); в С2 — `false` | редактору нужно скачать файл с `evo-crm-app:3000`. Разрешение действует на весь сервер (§3.4), поэтому безопасно только в сети, где кроме CRM и edge ничего нет |
| `ALLOW_META_IP_ADDRESS` | `false` (по умолчанию) | адреса метаданных облака закрыты |
| `WOPI_ENABLED` | `false` (по умолчанию) | WOPI не нужен |
| `PLUGINS_ENABLED` | `false` | плагины не качаются и не запускаются (§3.4) |
| `ADMINPANEL_ENABLED` | `false` | админ-панель не нужна |
| `WELCOME_PAGE_ENABLED` | `false` | стартовая страница не нужна |
| `EXAMPLE_ENABLED` | не задаётся (по умолчанию `false`, `:776`) | тестовый пример не запускается |
| `NGINX_ACCESS_LOG` | `false` | внутренний nginx не пишет адреса файлов и подписи |
| `DS_LOG_LEVEL` | `WARN` | в журналах редактора меньше адресов (`:546`) |
| `SECURE_LINK_SECRET` | случайные ≥ 32 байта, только в этом файле | по умолчанию случайный при каждом старте, и ссылки на сохранённый файл из уже отправленного callback умирают после перезапуска. Постоянный секрет убирает этот случай потери правки (§7.6) |

**ИИ-функции редактора.** Плагины выключены, но `aiSettings.enable` и
`allowBrowserProxy` по умолчанию включены (`default.json:12-22`). R0 проверяет, что в
редакторе нет вкладки и пунктов ИИ. Если они есть — ИИ выключается файлом настроек
сервера (`aiSettings.enable = false`) без правки кода; способ и файл записываются в
runbook. Дополнительные слои: у редактора нет выхода в интернет (С1, §5.2), а CSP
хоста `docs.` ограничивает `connect-src` своим origin (§6.1). R0 снимает исходящий
трафик редактора и браузера (DNS и `tcpdump` при старте, открытии, правке,
сохранении): сторонних хостов быть не должно. Результат — в runbook.

### 5.2. Сеть редактора (выбирается в R0)

Редактор делает HTTP-запросы по адресам из документов (картинка по URL, вставка
HTML с картинками из буфера). Админ копирует текст с чужой страницы — и сервер
редактора делает GET к любому адресу, который видит. Поэтому сеть редактора
закрытая.

**С1 — изолированная сеть `evo_docs` (рекомендую, R0 начинается с неё).**

- Сеть `evo_docs`: `driver: bridge`, `internal: true` (без выхода наружу).
  Создаёт её проект `evo-docs`; для edge и CRM она внешняя.
- Участники только три: `evo-docs-onlyoffice`; `evo-edge-caddy` — через
  `docker network connect evo_docs evo-edge-caddy` без перезапуска edge (запись
  о сети добавляется и в `docker-compose.edge.yml` на случай будущего пересоздания);
  CRM под alias `evo-crm-app` — **через release controller**, как сеть ИИ-агента:
  override по образцу `AI_AGENT_APP_NETWORK_OVERRIDE`, учёт в `verify_networks`,
  переходный режим и отрисовка отката (`scripts/evo-fast-release.sh:36-44`,
  `:601-636`, `:2015-2019`), проверки в `scripts/validate-runtime-hardening.mjs`.
  Включается своей переменной выпуска по образцу `EVO_AI_AGENT_ENABLED`
  (`:30-31`, `:267-286`); без неё CRM к сети не подключается, а функция выключена.
- `ALLOW_PRIVATE_IP_ADDRESS=true` допустим только здесь. Что видит редактор:
  `evo-crm-app:3000` и порты edge. У CRM на `:3000` в обход edge доступны и пути,
  закрытые на edge (`/api/internal/*`, `/api/readiness`, `/metrics`); у каждого из них
  своя подпись или проверка. Шлюз базы, WAHA, clamd, сайт, SoodaCloser и OlympiadAI
  из `evo_docs` не видны, интернет тоже.
- Плюсы: файл и callback остаются на закрытых `/api/internal/*`; у редактора нет
  выхода наружу, поэтому плагины, ИИ-провайдеры и запросы к сторонним хостам
  невозможны даже при ошибке настройки.
- Цена: правка release controller (отдельный срез с тестами и review, §15).
  Проверка маршрута по умолчанию: у edge и CRM после подключения к `internal`-сети
  маршрут по умолчанию и выход наружу не меняются (`ip route` до и после, R0).

**С2 — запасной вариант, если С1 не работает в R0.**

- Редактор в своей сети только с edge, `ALLOW_PRIVATE_IP_ADDRESS=false`: фильтр
  отвергает любые приватные адреса.
- Файл и callback — публичные маршруты CRM с точными шаблонами
  (`/api/v3/ai-agent/rules/onlyoffice/file/{токен}`, `…/callback/{сессия}`), JWT
  плюс короткоживущий токен; редактор ходит к ним через публичный адрес сервера.
- CRM ходит к редактору (CommandService, сохранённый файл) через отдельный слушатель
  edge на непубликуемом порту `:8088` только для точных путей.
- Цена: маршруты файла и callback видны из интернета; у редактора есть выход наружу.

**Отрицательные пробы R0** (обе сети; в production — повтор на согласованном
документе, §14.2): в документ вставляется HTML `<img src="…">` и «Изображение по URL»
с адресами `http://evo-supabase-gw:8000/`, `http://sales-assistant-api:8781/`,
`http://evo-crm-waha:3000/`, `http://169.254.169.254/`, `http://evo-edge-caddy:2019/`
и `https://example.com/`. Каждая должна завершаться отказом **без исходящего
запроса** (по `tcpdump` в сети редактора). Отдельно записывается, что отвечают
`http://evo-crm-app:3000/api/readiness` и `/metrics` без подписи.

### 5.3. Память: бюджет

По снимку 26.10 доступно около 8 986 МиБ, swap 0. С лимитом 4 096 МиБ останется около
4,9 ГиБ на пики остальных служб. Сколько реально берёт однопроцессный ONLYOFFICE
9.4/10, никто не мерил (исследование, неизвестное № 6). Замер — обязательная часть R0:
`docker stats` в покое, при старте и генерации шрифтов, при открытом документе
китайского размера и при двух одновременных редакторах. Лимит выставляется по замеру.

### 5.4. Swap (нужно разрешение владельца: это изменение хоста)

Официальные требования — не меньше 4 ГБ swap. Предложение: файл подкачки 4 ГиБ на
хосте:

```
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/90-evo-swap.conf
```

Swap полезен всему серверу: сейчас при нехватке памяти первым гибнет Supabase
(§3.3). `swappiness 10` держит память в RAM, пока её хватает. Откат: `swapoff
/swapfile`, убрать строку из `/etc/fstab`, удалить файл. Если владелец swap не
разрешит, редактор всё равно ставится. Тогда защиты такие: `mem_limit`,
`oom_score_adj 800` и мониторинг. Риск записывается в runbook.

### 5.5. Секреты

- `JWT_SECRET` создаётся на сервере (`openssl rand -hex 32`) и сразу пишется в
  `/opt/evo-docs/.env.onlyoffice` и в ignored env CRM как `EVO_ONLYOFFICE_JWT_SECRET`
  (`/opt/evo-crm/.env.production`). `SECURE_LINK_SECRET` — только в
  `.env.onlyoffice`. Значения не печатаются, не попадают в Git и чат. Архивная копия
  хранится в SOPS-процессе «Секреты и доступы ЭВО».
- Новые необязательные имена CRM: `EVO_ONLYOFFICE_JWT_SECRET`,
  `EVO_ONLYOFFICE_PUBLIC_URL` (публичный адрес §6), `EVO_ONLYOFFICE_INTERNAL_URL`
  (`http://evo-docs-onlyoffice`), `EVO_ONLYOFFICE_CRM_BASE_URL` (в С1
  `http://evo-crm-app:3000`). В `scripts/evo-app-env-contract.mjs` секрет
  добавляется к необязательным (`OPTIONAL_RUNTIME_NAMES` и `OPTIONAL_SECRET_NAMES`,
  `:55`, `:65`). Там уже проверяются формат 32–256 знаков и то, что значение не
  совпадает ни с одним другим (`:387-403`). Адреса обязательны, когда секрет задан —
  по образцу `requireNonEmpty` (`:405-413`). Заглушки — в
  `deploy/env.production.example`. Без этих переменных вкладка работает как сегодня
  (текстовое поле), а кнопок документа нет.
- **Смена секрета** — только через выпуск: env CRM — неизменяемый снимок поколения
  выпуска (`deploy/fast-app-release.md:308-320`). Порядок в окне выпусков: проверка
  «нет открытых сессий правки» (§7.4) → новый секрет в оба файла → перезапуск
  `evo-docs-onlyoffice` → выпуск CRM. Между двумя шагами редактор недоступен, агент
  работает.

### 5.6. Обновление образа

Только по digest, в окне выпусков. Порядок: проверка «нет открытых сессий правки»
и пустого списка «забытых» (§7.6) → новый digest в runbook и compose →
`docker compose -p evo-docs pull` → `up -d` → healthcheck → пробы §14.2 (открыть,
поправить, сохранить; отрицательные пробы сети) → строка в runbook. Прежний digest
пишется для отката. `down` не использовать: ночная чистка удалит образ (§3.3).

## 6. Публичный путь к редактору

Браузеру администратора нужен iframe редактора. Есть два варианта, и разница между
ними — в безопасности, а не в работе. R0 делается только по варианту, который выберет
владелец (§16 п.1).

### 6.1. Вариант B: поддомен `https://docs.evoadmissions.com` (одна A-запись) — рекомендую

Отдельный origin: редактор не видит cookie и страницы CRM (cookie host-only на
`crm.`, `deploy/README.md:34`).

**Чужой JavaScript в страницу CRM не попадает.** Страница CRM не грузит `api.js`.
Она показывает только
`<iframe src="https://docs.evoadmissions.com/evo-editor.html" sandbox="…" referrerpolicy="no-referrer">`.
`evo-editor.html` — маленькая статичная обёртка: исходник в `deploy/onlyoffice/`
(§5.1), отдаёт её edge на хосте `docs.` прямо из Caddyfile (`respond` с heredoc;
edge — Caddy v2.11.3, `infrastructure-map.md:99`). Новые тома к edge не добавляются
(§3.3). Обёртка:

- грузит `api.js` со своего origin и создаёт `DocsAPI.DocEditor`;
- принимает подписанный конфиг через `postMessage` только если
  `event.origin === "https://crm.evoadmissions.com"` и `event.source === window.parent`;
- отвечает родителю (`ready`, `document-ready`, `refresh-needed`, `closed`,
  `error`) только с фиксированным `targetOrigin` `https://crm.evoadmissions.com`;
- на `events.onRequestRefreshFile` просит у CRM новый подписанный конфиг и вызывает
  `refreshFile` (§7.4).

CRM со своей стороны принимает сообщения только от origin
`EVO_ONLYOFFICE_PUBLIC_URL` и только от `iframe.contentWindow`. Так изоляция по origin
полная, и SRI не нужен. (SRI для `api.js` и невозможен: хеш файла меняется при
каждом старте контейнера, §3.4.) Минимальный набор флагов `sandbox` подбирается
в R0.

Нужно:

1. **Владелец** добавляет в Spaceship (Advanced DNS) запись `docs` A `72.62.119.112`,
   TTL 5 мин. Агент записи DNS не меняет.
2. Новый блок edge после появления записи (точный текст — в R1 по итогам R0):

```
docs.evoadmissions.com {
	import evo_canonical_api_paths
	header {
		-Server
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Content-Security-Policy "frame-ancestors 'self' https://crm.evoadmissions.com"
		Referrer-Policy "no-referrer"
	}
	@wrapper path /evo-editor.html /evo-editor.js
	handle @wrapper { … respond из heredoc, своя строгая CSP … }
	@editor path <список разрешённых путей из R0>
	handle @editor { reverse_proxy evo-docs-onlyoffice:80 }
	handle { respond 404 }
}
```

   `'self'` в `frame-ancestors` нужен: внутри обёртки редактор открывает свои
   вложенные iframe с того же origin. Полная CSP для путей редактора снимается в R0
   сначала в режиме Report-Only; цель — `connect-src` только свой origin и
   `wss://docs.evoadmissions.com`, чтобы браузер не мог отправить документ третьим
   сторонам. Журнала доступа у блока нет (как у `supabase.`); глобальный журнал
   получает `replace md5 REDACTED` и `replace expires REDACTED`. Сертификат Caddy
   выпустит сам после того, как DNS начнёт отвечать.
3. CSP CRM сейчас работает в режиме Report-Only (`:45`). В неё добавляется
   `frame-src 'self' https://docs.evoadmissions.com`, чтобы отчёты были чистыми и
   включение CSP не сломало редактор. `script-src` не меняется: скриптов с `docs.`
   в CRM нет. `X-Frame-Options "DENY"` у CRM остаётся: CRM — верхняя страница,
   её не встраивают.

### 6.2. Вариант A: путь `https://crm.evoadmissions.com/onlyoffice/` (без DNS)

Технически работает. ONLYOFFICE официально поддерживает «виртуальный путь» за
прокси: в заголовке `X-Forwarded-Host` передаётся хост вместе с путём (официальный
пример nginx `proxy-to-virtual-path.conf`, §18). Для Caddy, внутри блока
`crm.evoadmissions.com` (`Caddyfile.evo-edge:108`):

```
@onlyoffice_host_wrong {
	not host crm.evoadmissions.com
	path /onlyoffice /onlyoffice/*
}
respond @onlyoffice_host_wrong 404          # на app. (студенты) редактора нет
handle_path /onlyoffice/* {
	# только пути из списка R0, остальное 404
	reverse_proxy evo-docs-onlyoffice:80 {
		header_up X-Forwarded-Host {host}/onlyoffice
	}
}
```

Обязательные правки `(evo_app)`: для `/onlyoffice/*` `X-Frame-Options "SAMEORIGIN"` и
действующий `Content-Security-Policy "frame-ancestors 'self'"`, для остальных путей
`DENY` остаётся; журнал доступа `(evo_app)` дополняется `replace token`,
`replace md5`, `replace expires` (сейчас там только `token_hash`, `:56-66`).
Порядок применения `header` проверяется по фактическим заголовкам (`curl -I`).

**Цена варианта A.** Весь редактор — мегабайты чужого JavaScript, шрифты и разбор
документа — работает на том же origin, что и CRM. Cookie сессии администратора
читаются из JavaScript (§3.3). Значит, любая XSS в ONLYOFFICE или документ с
вредоносным содержимым получают сессию администратора CRM со всеми данными
студентов. Обёртка iframe здесь не помогает: origin один. Меры: плагины, ИИ и
макросы выключены, открывают и загружают только админы. Остаточный риск принять
может только владелец, письменно.

### 6.3. Общее для обоих вариантов

- **Только разрешённые пути.** Наружу открываются только пути, которые браузер на
  самом деле запрашивает при открытии, правке, сохранении и переподключении. Список
  снимается в R0 по журналу прокси спайка и записывается в runbook; всё остальное —
  404. Вне списка заведомо остаются `/command*`, `/coauthoring/CommandService.ashx`,
  `/converter*`, `/ConvertService.ashx`, `/docbuilder*`, `/downloadfile*`
  (по трекеру Debian до 10.0 там была SSRF), `/admin*`, `/sdkjs-plugins*`, `/info*`,
  `/internal*`, `/example*`, `/welcome*`, `/healthcheck` и корень `/`. R0 проверяет,
  что версионные пути (`/<версия>/…`) не открывают служебные. CRM ходит к
  служебным только по внутреннему адресу.
- `document.permissions.download = false` и `print = false`: скачивает админ через
  CRM (§7.3), поэтому `/downloadfile*` браузеру не нужен. Если печать окажется
  нужна, это решение после R0.
- **Внутренние маршруты CRM** `/api/internal/onlyoffice/*` снаружи уже закрыты
  правилом `@private` (`Caddyfile.evo-edge:37-38`). Новая правка edge для них не нужна.
- В коде публичный адрес — одна переменная `EVO_ONLYOFFICE_PUBLIC_URL`. Переход
  A → B — смена переменной (выпуск) и блока edge.

**Рекомендация.** Вариант B. Если владелец не хочет менять DNS, ставим A. Тогда
владелец письменно принимает риск §6.2, и это записывается в `PLAN_CHANGES`.

## 7. Интеграция с EVO

### 7.1. Хранение `.docx` и политика хранения

Новый закрытый bucket `platform-ai-agent-rules`, по образцу миграции 271
(`:37-60`):

- `public = false`, `file_size_limit = 20971520` (20 МиБ), MIME только
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
- RESTRICTIVE-политика `ai_agent_rules_server_only` для `anon` и `authenticated`.
  Пишет и читает только сервер CRM ключом service role. Подписанных ссылок и
  публичных адресов нет, как у файлов агента (`ai-agent-files.ts:17-19`);
- версия: `{organization_id}/{agent_key}/{version_id}.docx`, запись без перезаписи
  (`upsert: false`);
- карантин: `{organization_id}/{agent_key}/quarantine/{session_id}/{sha256}.docx` —
  файл из редактора, который прошёл ClamAV, но не прошёл проверку OOXML (§7.6).
  Правка не теряется: админ скачивает его и видит причину.

**Политика хранения** (владелец подтверждает в §16 п.3):

- версии хранятся, пока админ не удалит их кнопкой «Удалить версию безвозвратно»
  (§7.2, §10). Применённую версию и базу открытой сессии удалить нельзя. Удаление:
  сначала объект в Storage, затем строка становится надгробием (sha256, кто, когда,
  причина; текста и файла нет), запись аудита. Повтор безопасен;
- кэш ONLYOFFICE живёт до 24 ч (`expire.files`, §3.4); «забытые» файлы CRM удаляет
  (`deleteForgotten`) сразу после сохранения их как версии (§7.6) и при удалении
  версии, если остались. Полная очистка редактора — пересоздание его томов в окне
  выпусков (runbook);
- решения по картинкам, хеш которых больше не встречается ни в одной живой версии,
  удаляются вместе с последней такой версией.

### 7.2. Модель данных (одна миграция)

Номер — следующий свободный после 322 (на 27.10 это 323; если раньше сольются другие
планы, номер сдвинется). Новые объекты, **две** новые колонки с безопасными
значениями по умолчанию и замена одной функции. Прежнее приложение новых объектов
не читает, а заменённая функция для него ведёт себя как раньше, пока
`rules_source = 'text'`. Откат приложения не требует отката базы.

1. `platform_private.ai_agent_rule_versions` — версии документа:
   `organization_id`, `id`, `agent_key`, `version_no` (по агенту, с 1), `source`
   (`upload` | `editor` | `restore` | `from_text`), `storage_path`, `file_sha256`,
   `byte_size`, `scan_proof` (доказательство ClamAV, как в 271),
   `created_by_membership_id`, `created_at`, `editor_session_id`, `base_version_id`,
   `restored_from_id`, `convert_status` (`pending` | `ready` | `too_long` |
   `tracked_changes` | `failed` | `rejected`), `reject_reason`, `flags TEXT[]`
   (подмножество `stale_base`, `saved_with_error`, `recovered_forgotten`,
   `author_unverified`), `compiled_text` (текст с метками картинок, до 500 000 знаков,
   чтобы показать превышение), `compiled_chars`, `images` (jsonb: номер, sha256,
   формат, размеры, байты), `converter_version`, `purged_at`, `purged_by`,
   `purge_reason`.
2. `platform_private.ai_agent_rule_images` — решение по картинке, ключ
   `(organization_id, sha256)`: `decision` (`pending` | `excluded` | `described`),
   `description` (до 2 000 знаков), `personal_data` (`unknown` | `yes` | `no`),
   `decided_by`, `decided_at`, `described_via` (`admin` | `claude`). Ключ — хеш
   картинки, поэтому решение переходит в следующие версии документа само.
   `personal_data = 'no'` может поставить только владелец (R7, §8.3); до R7 база
   это значение не принимает.
3. `platform_private.ai_agent_rule_sessions` — сессии правки: `id`, `agent_key`,
   `document_key` (уникальный), `base_version_id`, `opened_by`, `opened_at`,
   `last_callback_at`, `last_status`, `users_seen` (jsonb), `last_info_at`,
   `closed_at`, `close_reason` (`saved` | `no_changes` | `reconciled` | `dropped`),
   `file_token_sha256`, `file_token_expires_at`, `file_token_uses`, `error`.
4. `platform_private.ai_agents`: колонки `rules_source TEXT NOT NULL DEFAULT 'text'
   CHECK (rules_source IN ('text','document'))` и `rules_version_id UUID`
   (применённая версия).
5. Внутренняя функция `platform_private.ai_agent_rules_render(p_version_id)` —
   единственное место, где метки картинок заменяются по решениям (§8.3). Ею
   пользуются и предпросмотр, и «Применить».
6. **`CREATE OR REPLACE FUNCTION platform.ai_agents_update_v1`** — та же функция из
   317 (`:916-1066`) с одним новым правилом: если в патче есть
   `instructionsOverride`, а у агента `rules_source = 'document'`, — отказ
   `ai_agent_rules_in_document` (ERRCODE `55000`). Так текст и документ не
   разъезжаются, какой бы server action ни вызвал RPC. До замены — проверка, что тело
   функции ровно то, что оставила 317 (`md5(prosrc)`, образец
   `319_platform_ai_agents_hardening.sql:56-73`). После — проверка определителя,
   пустого `search_path`, прав и того, что функций `ai_agents_%_v1` по-прежнему 9
   (образец `322_platform_ai_agents_daily_spend.sql:96-125`). `mapAiAgentsDbError`
   (`src/lib/v3/ai-agents-view.ts:1083`) получает текст: «Правила ведутся в документе
   Word. Примените версию документа или переключитесь на ведение текстом».

RPC (все `SECURITY DEFINER`, `search_path = ''`):

| RPC | Кто | Что делает |
|---|---|---|
| `platform.ai_agent_rules_get_v1` | сотрудник с `ai.agent.use`; версии, картинки и сессии — только админу | состояние документа: версии, применённая, открытая сессия; для выбранной версии — итоговый текст из `ai_agent_rules_render`, его знаки и sha256 |
| `platform.ai_agent_rules_version_add_v1` | админ | версия из загрузки, восстановления или текущих правил; `scan_proof` обязателен |
| `platform.ai_agent_rules_apply_v1` | админ (как `317:925-928`) | атомарно: **сама собирает текст** версии через `ai_agent_rules_render` и сверяет его sha256 с `p_expected_text_sha256` из предпросмотра (расхождение — отказ `ai_agent_rules_preview_stale`); ≤ 60 000; версия `ready`; флаги версии — только с `p_confirm_flags`; `instructions_override`, `rules_version_id`, `rules_source='document'`, `config_version+1`; аудит `ai.agent.rules.apply` (id версии и sha256 применённого текста, без самого текста). Проверяет `expected_version`. Ответ — `{key, configVersion, changed}` той же формы, что у `ai_agents_update_v1` (`changed` = `['instructionsOverride']` или пусто, если текст тот же) |
| `platform.ai_agent_rules_source_set_v1` | админ | явная смена источника на `text`: `rules_source='text'`, `rules_version_id=NULL`; с `p_reset` ещё и `instructions_override=NULL` («Сбросить на стандартные» в режиме документа). Аудит. Ответ — `{key, configVersion, changed}` |
| `platform.ai_agent_rules_image_decide_v1` | админ; `personal_data='no'` — только владелец (R7) | решение и описание картинки, аудит |
| `platform.ai_agent_rules_version_purge_v1` | админ | надгробие версии (§7.1); отказ для применённой версии и базы открытой сессии; аудит `ai.agent.rules.version.purge` |
| `platform.ai_agent_rules_session_open_v1` | админ | создать или переиспользовать сессию; приложение передаёт sha256 нового токена файла |
| `platform.ai_agent_rules_file_token_consume_v1` | только `service_role` | проверить токен файла и учесть обращение |
| `platform.ai_agent_rules_callback_v1` | только `service_role` | записать статус сессии и, идемпотентно по `(сессия, sha256)`, новую версию с флагами |
| `platform.ai_agent_rules_session_reconcile_v1` | только `service_role` | закрыть сессию по итогам сверки с ONLYOFFICE (`reconciled`), записать `users_seen` |

Тесты прав — в наборе Postgres-авторизации (`scripts/test-postgres-authorization.sh`,
отдельный блок, как для 321 и 322): не-админ и `authenticated` к служебным RPC
получают отказ, `anon` к bucket — отказ, `ai_agents_update_v1` с
`instructionsOverride` при `rules_source='document'` — отказ, при `'text'` —
прежнее поведение, `apply_v1` с чужим `expected_text_sha256` — отказ, `purge_v1` для
применённой версии — отказ. Просмотр роли в базу не попадает (§3.1): его отказ
проверяют UI-тесты и тесты маршрутов (§14.1).

### 7.3. Маршруты CRM

Пространство имён — существующее `/api/v3/ai-agent/` (в единственном числе).
Каждый путь вносится в `src/lib/platform-route-contract.ts` точным шаблоном: браузерные
— в `isConnectedPlatformApi` (`:352-389`), внутренние — в
`isConnectedPlatformPrivateApi` (`:306-310`), как брокер Storage агента (`:157-158`).
Без записи `proxy.ts` отвечает 404. Шаблоны: ключ агента `[a-z][a-z0-9-]{1,31}`
(обработчик проверяет `isAiAgentKey`), UUID строчными, sha256 — `[0-9a-f]{64}`, токен —
43 знака base64url.

| Маршрут | Кто вызывает | Проверки |
|---|---|---|
| `POST /api/v3/ai-agent/rules/{key}/editor` | браузер админа | `sameOrigin` (`ai-agent-route-handlers.ts:96`); сессия сотрудника, `systemRole === "admin"`, не `isStaffPreview`; затем `GET {EVO_ONLYOFFICE_INTERNAL_URL}/healthcheck` с тайм-аутом 2 с — нет ответа → «Редактор недоступен», сессия не создаётся. Ответ — конфиг редактора (§7.4). Тот же маршрут с `{refresh: true}` выдаёт новый конфиг для `refreshFile` |
| `POST /api/v3/ai-agent/rules/{key}/upload` | браузер админа | собирается из тех же частей, что `createAiDocumentUploadHandler` (§3.2): `sameOrigin`, право, multipart, лимит одновременных загрузок, `readCappedBody` 20 МиБ, `checkAiUploadContent` для docx, проверки загрузки §8.1, ClamAV → Storage → конвертер → `version_add_v1` (`upload`) |
| `GET /api/v3/ai-agent/rules/{key}/versions/{id}/file` | браузер админа | только админ; отдача из Storage потоком, `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin` |
| `GET /api/v3/ai-agent/rules/{key}/versions/{id}/images/{sha256}` | браузер админа | только админ. Картинка вынимается из `.docx` на лету и **отдаётся, только если это PNG, JPEG или GIF по сигнатуре байтов** (как ветка `image` в `checkAiUploadContent`, `ai-agent-files.ts:82-84`, плюс GIF). SVG, EMF, WMF и всё прочее не отдаются никогда: в интерфейсе «Формат не показывается — посмотрите в редакторе». Заголовки по образцу `IMAGE_HEADERS` (`ai-agent-knowledge-route-handlers.ts:76-83`): явный `Content-Type` по сигнатуре, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer` |
| `GET /api/internal/onlyoffice/file/{token}` | ONLYOFFICE | JWT (§7.5) с `operation = "download"` и `payload.url`, равным адресу запроса; токен короткоживущий: 10 мин и не больше 5 обращений (ONLYOFFICE может скачать файл повторно при переподключении) |
| `POST /api/internal/onlyoffice/callback/{session}` | ONLYOFFICE | JWT с `operation = "callback"`, `payload.key` = ключ сессии; тело до 64 КБ |

Действия на странице (server actions, как в `platform-ai-agents-actions.ts`):
«Применить к агенту», «Восстановить версию», «Удалить версию безвозвратно»,
решение по картинке, «Создать документ из текущих правил», «Вести правила
текстом», «Сбросить на стандартные» (в режиме документа — через `source_set_v1`),
«Завершить правку у всех» (§7.4). Все — админ вне просмотра роли.

### 7.4. Конфиг редактора и сессия

- `document.key` — `r-{agent_key}-{base_version_id без дефисов}-{8 случайных символов}`:
  до 128 знаков, только `0-9a-zA-Z-._=` (правило ONLYOFFICE, §18). Каждая новая
  сессия получает новый ключ. Если сессия по той же базовой версии ещё открыта,
  второй админ получает **тот же** ключ и правит вместе с первым.
- `document.url` — `EVO_ONLYOFFICE_CRM_BASE_URL` +
  `/api/internal/onlyoffice/file/<токен>`. Из браузера по нему не достучаться.
- `editorConfig.callbackUrl` — `EVO_ONLYOFFICE_CRM_BASE_URL` +
  `/api/internal/onlyoffice/callback/<id сессии>`.
- `editorConfig.user` — `{ id: membership_id, name: имя сотрудника }`; `lang: "ru"`,
  `mode: "edit"`, `type: "desktop"`.
- `editorConfig.customization`: `forcesave: true` (кнопка «Сохранить» шлёт статус 6),
  `plugins: false`, `macros: false`, `macrosMode: "disable"`, `feedback: false`,
  `help: false`. Логотип ONLYOFFICE не убирается (§11). Серверные выключатели —
  §5.1; клиентские настройки — только второй слой.
- `document.permissions`: правка, комментарии и рецензирование включены, чат,
  скачивание и печать выключены (§6.3).
- `token` — JWT HS256 на весь конфиг, `exp` = 15 минут. Продлевать `exp` не нужно:
  когда редактор переподключается после обрыва или видит уже сохранённый ключ, он
  вызывает `events.onRequestRefreshFile`; обёртка просит у CRM новый подписанный
  конфиг (`POST …/editor` с `refresh`) и вызывает `refreshFile` (официальная страница
  events, §18). R0 проверяет долгую правку больше 15 минут с обрывом сети.

**Жизненный цикл сессии — по данным самого ONLYOFFICE, без таймеров.**

- Сессия открывается только по кнопке «Открыть редактор», а не при заходе на вкладку.
- Закрывается: по статусу 2 после сохранения (`saved`), по статусу 4
  (`no_changes`) или по сверке (`reconciled`).
- **Сверка.** Статус 1 приходит только при подключении и отключении пользователя,
  периодических callback нет (официальная страница callback handler, §18). Поэтому
  «тишина» ничего не значит. Перед любым действием, которому мешает открытая
  сессия («Загрузить», «Восстановить», новое «Открыть редактор» на другой базе), и
  при открытии вкладки админом CRM спрашивает внутренний CommandService
  (`POST {EVO_ONLYOFFICE_INTERNAL_URL}/command`, JWT) командой `info`. Есть
  пользователи — сессия открыта, действие заблокировано: «Документ открыт в
  редакторе у: <имена>». Документа с таким ключом нет — CRM проверяет «забытые»
  (§7.6) и только потом закрывает сессию (`reconciled`). Ответ на `info` приходит и в
  callback; маршрут принимает его как обычный статус. Формат ответа фиксирует R0.
- «Завершить правку у всех» (админ, с подтверждением) — команда `drop` для всех
  пользователей сессии. ONLYOFFICE сам сохраняет документ, и через ~10 с приходит
  статус 2. Нужна для зависших сессий и перед выпуском.
- В runbook выпуска CRM и обновления образа — шаг «нет открытых сессий правки»:
  выборка открытых сессий и `info` по каждой. Есть — подождать или «Завершить правку
  у всех».

### 7.5. JWT

Своя небольшая функция на `node:crypto` (HMAC-SHA256, сравнение `timingSafeEqual`),
новых зависимостей нет. Правила проверки:

- `alg` строго `HS256`, иначе отказ (никаких `none` и других алгоритмов);
- `exp`, `iat`, допуск по часам 60 с (как `verifyOptions` ONLYOFFICE,
  `default.json:511-513`);
- с версии 10.0 токены ONLYOFFICE несут `operation` (`"callback"`, `"download"`,
  официальная страница Token in header, §18). Маршрут принимает только свою операцию,
  поэтому токен скачивания нельзя выдать за callback;
- callback: токен в заголовке `Authorization: Bearer …`, `payload` = тело. Тело и
  `payload` должны совпадать по `key` и `status`;
- скачивание: `payload.url` равен адресу запроса;
- запросы CRM к CommandService подписываются тем же секретом.

Неверная подпись — ответ 403 и строка в журнале без токена. Версия не создаётся.

### 7.6. Callback и версии: правки не теряются

Статусы — по официальной странице callback handler (§18). `url` отредактированного
файла приходит при статусах 2, 3, 6 и 7.

| Статус | Что делает CRM |
|---|---|
| 1 — подключение или отключение | записывает `users_seen` и время |
| 2 — готов к сохранению (через 10 с после закрытия) | сохраняет файл (ниже), закрывает сессию (`saved`) |
| 3 — ошибка сохранения | **тоже скачивает `url`**: версия с флагом `saved_with_error`; сессия закрывается |
| 4 — закрыт без изменений | закрывает сессию (`no_changes`) |
| 6 — принудительное сохранение («Сохранить») | сохраняет файл, сессия остаётся открытой |
| 7 — ошибка принудительного сохранения | **тоже скачивает `url`**: версия с флагом `saved_with_error`; сессия остаётся открытой |

Порядок обработки статусов 2, 3, 6, 7:

1. `url` принимается, только если его начало — публичный или внутренний адрес
   ONLYOFFICE. Начало переписывается на `EVO_ONLYOFFICE_INTERNAL_URL`, и CRM
   скачивает файл изнутри. Любой другой адрес — отказ (защита от SSRF). Редиректы
   не выполняются, потолок 20 МиБ, тайм-аут 30 с.
2. SHA-256. Совпал с версией этой же сессии — повтор: ответ `{"error":0}`.
3. ClamAV. Найден вредоносный код — файл не хранится нигде, событие в аудит, ответ
   `{"error":0}`, вкладка показывает «Файл из редактора не прошёл проверку на
   вирусы». ClamAV недоступен — шаг 6.
4. Проверка OOXML и макросов, как у загрузки (`checkAiUploadContent`,
   `ai-agent-files.ts:78-99`). Не прошла — файл кладётся в карантин (§7.1), версия
   `rejected` с причиной (`reject_reason`), ответ `{"error":0}`. Админ видит причину и
   может скачать файл.
5. Объект в Storage (`upsert: false`), конвертер (§8; разбор ограничен 10 с, окно
   ответа ONLYOFFICE — 10 минут, §3.4), строка версии через
   `ai_agent_rules_callback_v1` (идемпотентно по `(сессия, sha256)`), и только потом
   ответ `{"error":0}`. Упал конвертер — версия всё равно сохраняется с
   `convert_status = 'failed'`.
6. **Временный сбой** (Storage, база, ClamAV, сеть) — ответ **HTTP 500**, без тела
   `{"error":1}`. ONLYOFFICE повторяет callback до 3 раз только при `429,500-599`
   (`default.json:545-553`). Ответ `{"error":1}` при HTTP 200 не повторяется, и файл
   сразу уходит в «забытые» (`default.json:344-345`), поэтому CRM его не отправляет.
   Строка в журнале CRM — без ссылки и токена.

**Поздний callback никогда не отвергается.** Callback по уже закрытой сессии
(например, после сверки) или по сессии, база которой уже не последняя версия,
сохраняется как обычная версия с `base_version_id` и флагом `stale_base`. Автор —
`users[0]` (последний редактор); если он больше не активный админ, флаг
`author_unverified`. Версию с флагами нельзя применить без явного подтверждения:
«Эта версия сохранена от старой версии 6 — сравните перед применением».

**Сверка «забытых» файлов.** Если CRM была недоступна дольше повторов (выпуск после
21:00, когда админ как раз может править), файл попадает в «забытые» ONLYOFFICE.
CRM при открытии вкладки админом и при сверке сессии (§7.4) вызывает
`getForgottenList`. Для ключа своей сессии — `getForgotten`, тот же порядок 1–5,
версия с флагом `recovered_forgotten`, затем `deleteForgotten`. Отдельный таймер в
первом выпуске не ставится: «забытые» лежат, пока их не удалят (проверить в R0).

Журнал истории ONLYOFFICE (`changesurl`, `history`) в первом выпуске не хранится.
История EVO — это список версий с автором, скачиванием и восстановлением.

**Пробы R0 на потерю правок:** `kill -9` редактора посреди правки и повторное
открытие; `docker restart` и пересоздание контейнера посреди правки (что осталось от
несохранённого); остановка CRM во время статуса 2 с замером повторов и попаданием в
«забытые»; ответ CRM 500 и ответ `{"error":1}`; правка одним админом дольше 40 минут
без статуса 1; поздний callback после ручного закрытия сессии.

### 7.7. Первый документ агента

- **«Загрузить .docx»** — для гайдов владельца. Диалог загрузки предупреждает:
  «Уберите из документа персональные данные клиентов: сканы документов, имена,
  номера». Технически распознать «китайский гайд с картинками» нельзя, поэтому
  запрет §0 — правило процесса: до ответа §16 п.3 грузится только очищенный
  владельцем `.docx`, и пробы §14.2 идут только на нём.
- **«Создать документ из текущих правил»** — стартовый `.docx` собирается в CRM на
  `pizzip` (уже в зависимостях, `document-package.ts:3`): заголовки Markdown → стили
  «Заголовок 1…6», остальное — абзацы, списки — абзацы с маркером, таблицы — текстом
  по строкам. Получается версия `from_text`; форматирование минимальное. Конвертация
  через `/converter` ONLYOFFICE не используется: ей понадобился бы ещё один
  внутренний маршрут исходника, а вход Markdown не проверен.

## 8. Из `.docx` в текст для Claude

### 8.1. Конвертер

Свой модуль `src/lib/server/ai-agent-rules-docx.ts` на `pizzip` и `@xmldom/xmldom`
(обе уже в зависимостях и уже читают `.docx` в CRM, §3.2). **Развилка в начале R4:**
за 2 часа свой конвертер и mammoth (BSD-2, совет исследования) сравниваются на
тестовых `.docx` из R0 по нумерации (`numbering.xml`), цепочкам стилей `basedOn`,
объединённым ячейкам (`vMerge`/`gridSpan`) и сноскам. Mammoth — только в том же
воркере, с санитайзером результата и тайм-аутом. Выбор записывается в
`PLAN_CHANGES`.

Выход — Markdown, который агент читает так же, как сегодняшние правила:

| В документе | В тексте агента |
|---|---|
| Заголовки (стиль с уровнем структуры, в том числе «Заголовок 1…» и цепочки `basedOn`) | `#`…`######` |
| Абзацы, жирный, курсив | текст, `**`, `*` |
| Списки (`w:numPr`, `numbering.xml`) | `-` / `1.` с отступом по уровню |
| Таблицы | таблицы GFM. Объединённые ячейки повторяются, вложенные таблицы — текстом |
| Ссылки | `[текст](url)` только для `http`, `https`, `mailto`; иначе только текст |
| Картинки (`w:drawing`, `v:imagedata`) | метка `[[evo-image:<первые 12 знаков sha256>]]`, дальше — по решению (§8.3). Свой текст пользователя вида `[[evo-image:` экранируется |
| Сноски | в конце, раздел «Примечания» |
| Непринятые исправления (`w:ins`, `w:del`) | версия получает `tracked_changes`, применить нельзя: «Примите или отклоните исправления в документе» |

**Не передаётся агенту никогда** (в интерфейсе — «Не передаются агенту: комментарии,
скрытый текст, колонтитулы, подписи к картинкам, коды полей»):

- комментарии, скрытый текст (`w:vanish`), колонтитулы;
- альтернативный текст и заголовок картинок (`wp:docPr@descr`, `@title`): там часто
  имена файлов, то есть персональные данные;
- коды полей (`w:instrText`, в том числе `INCLUDEPICTURE`, `INCLUDETEXT` с адресами) —
  передаётся только видимый результат поля;
- `w:altChunk` (вложенный HTML или документ).

**Проверки при загрузке** (сверх `checkAiUploadContent`): внешние связи
(`TargetMode="External"`) любого типа, кроме гиперссылок, `attachedTemplate`,
`altChunk` и OLE-вложения (`word/embeddings/*.bin`, их нет в `ACTIVE_PART`,
`ai-agent-files.ts:56`) — отказ с понятной причиной: «В документе есть внешние связи
или вложенные объекты: <что>. Сохраните документ без них». Файл из редактора по этим
правилам не отвергается (чтобы не терять правки): конвертер их просто не передаёт, а
сходить по ним редактор не может (С1 без выхода наружу).

**Лимиты, сведённые с существующей проверкой.** `matchesOoxmlPackage` читает
главную часть с потолком `MAX_REQUIRED_XML_BYTES = 4 MiB`
(`platform-company-file-storage-route-handlers.ts:39`, `:395-403`) и требует, чтобы
`Target` в `_rels/.rels` был ровно `word/document.xml` (`:526-528`). `parseStandardZip`
отвергает ZIP64-extra (`0x0001`, `:218-229`) и ряд флагов (`:300-306`). Поэтому лимит
`word/document.xml` в этом плане — **честные 4 МиБ**, а не 20 МБ. Проходит ли вывод
ONLYOFFICE (x2t) эти проверки, проверяет R0 (§14.2). Если нет — для этого пути
делается своя обёртка проверки с отдельным потолком и решением в `PLAN_CHANGES`;
общая функция не ослабляется.

**Изоляция разбора.** Разбор идёт в `worker_threads` с тайм-аутом 10 с и
`resourceLimits` (`maxOldGenerationSizeMb: 256`, `maxYoungGenerationSizeMb: 32`):
контейнер CRM ограничен 1,5 ГБ памяти и 1,5 CPU (`docker-compose.prod.yml:20-22`), а
DOM xmldom из нескольких мегабайт XML тяжёл. `worker_threads` в репозитории ещё не
используются, а сборка `output: "standalone"` (`next.config.ts:8`) кладёт в образ только
трассированные файлы. R4 проверяет, что файл воркера есть в `.next/standalone`
(при нужде — `outputFileTracingIncludes`, `next.config.ts:11-13`), и запускает
разбор в собранном образе, а не только в `next dev`. У результата — версия
конвертера (`converter_version`).

Сверка в R0: на двух тестовых `.docx` число знаков текста сравнивается с выгрузкой
ONLYOFFICE `docx → txt`. Расхождение больше 10 % — повод разобраться до выпуска.

### 8.2. Лимит

Итоговый текст (метки заменены по решениям) — не больше 60 000 знаков
(`contract.ts:204`, `317:162`, `317:981`). Иначе версия `too_long` с понятной строкой
«Текст для агента — 63 412 знаков из 60 000: сократите документ», и применить её
нельзя. Если реальный документ владельца не помещается, лимит поднимается отдельной
миграцией до 90 000. Потолок API — 100 000; минус преамбула 5 514 и разделитель 7
даёт до 94 479, 90 000 оставляет запас. Меняются ограничение
`ai_agents_instructions_check`, константа в `ai_agents_update_v1`, `apply_v1` и
`contract.ts`. Это решение владельца (§16), без нужды не делается.

### 8.3. Картинки

- По умолчанию решение `pending`, и это значит «агенту не передаётся»: метка
  удаляется, вокруг текст без изменений. Вкладка показывает «N картинок агенту не
  переданы», и применить версию можно.
- Админ видит каждую картинку PNG, JPEG или GIF (маршрут §7.3). Остальные форматы не
  показываются (§7.3), их можно посмотреть в редакторе. Решения:
  - «Не передавать» → `excluded`;
  - «Описать текстом» → `described`: админ пишет описание, и агент получает
    `[Картинка: <описание>]`;
  - флажок «На картинке есть персональные данные» (`personal_data = 'yes'`). С ним
    можно только «Не передавать».
- **Китайский гайд, 18 картинок** (страницы-образцы в приложении, при импорте 23.10
  сознательно не взяты). Загрузка гайда с картинками заблокирована правилом процесса,
  пока владелец не ответит на §16 п.3; по умолчанию грузится очищенный владельцем
  `.docx`. Если владелец разрешит загрузить оригинал, все картинки остаются `pending`
  до его просмотра. В Claude и в другие сервисы они не уходят. Если после загрузки
  выяснится, что ПД лишние, — «Удалить версию безвозвратно» и очистка кэша (§7.1).
- **R7, только после решения владельца:** кнопка «Предложить описание через Claude»
  есть только у картинки с отметкой «персональных данных нет»
  (`personal_data = 'no'`), а эту отметку ставит **только владелец** — его membership
  записывается в настройку организации миграцией R7, и `image_decide_v1` принимает
  `'no'` только от него. Один запрос к Claude vision; описание — черновик, админ его
  правит и сохраняет. По исследованию, 18 картинок китайского гайда — около 27 тыс.
  визуальных токенов, примерно $0,11 за вход на Opus 5.5 (выход не считался).

### 8.4. Предпросмотр и «Применить к агенту»

- Панель «Что получит агент»: итоговый текст из `ai_agent_rules_get_v1` (его собирает
  база, §7.2) через `Markdown.tsx`, счётчик знаков из 60 000, картинки с решениями,
  предупреждения (исправления, лимит, картинки без решения, флаги версии).
- «Применить к агенту» (только админ) отправляет id версии, ожидаемую
  `config_version` и sha256 текста, который админ видел. База собирает текст заново
  и при расхождении отказывает: «Пока вы смотрели, решение по картинке изменилось —
  проверьте текст ещё раз». Значит, в Claude уходит ровно то, что видел админ. Затем —
  обычная автосинхронизация (§9).
- Применение — **отдельная кнопка, а не каждое сохранение**: «Сохранить» в Word жмут
  часто, и агент не должен менять поведение на полуслове. Это предложение, владелец
  подтверждает его в §16.
- Пока `rules_source = 'document'`, текстовое поле прежней вкладки только для чтения:
  «Правила ведутся в документе». Это обеспечивает база (§7.2 п.6), интерфейс лишь
  показывает. «Вести правила текстом» и «Сбросить на стандартные» в этом режиме — явная
  смена источника через `source_set_v1` (с подтверждением и аудитом); чип состояния
  после неё честно показывает «Правила ведутся текстом».
- Не-администраторы, как и сейчас, видят применённый текст (`:118-122`), а не `.docx`.

## 9. Синхронизация с Claude

Без изменений в `sync.ts` и `config-hash.ts`. «Применить» и смена источника идут
через свои RPC (§7.2), а не через `applyUpdate`, но возвращают ту же форму
`{key, configVersion, changed}`. Хвост `applyUpdate` после RPC
(`platform-ai-agents-actions.ts:169-188`: разбор `changed`, `refresh`, решение о
синхронизации, `syncAiAgent`, тексты результата) выносится в общую функцию без
изменения поведения, и её вызывают `applyUpdate`, «Применить» и смена источника.
Когда в `changed` есть `instructionsOverride` и агент уже в Claude, синхронизация
идёт сама. Иначе остаётся плашка «Изменения не отправлены» и кнопка в `SyncPanel`
(`SyncPanel.tsx:101-103`). В Claude уходит только `system` = преамбула + текст
(`sync.ts:442`). Сам `.docx`, его картинки и адрес редактора Claude не получает. Сеть
среды агентов не меняется (`sync.ts:136`).

## 10. Интерфейс вкладки «Правила агента» (админ)

UI делается по `DESIGN.md` и проверяется `/impeccable`. Состав:

1. Шапка: «Правила агента» и чип состояния: «Документ Word · применена версия 7»,
   «Есть версия 8 — не применена», «Правила ведутся текстом».
2. Нет документа: «Загрузить .docx» (с предупреждением о ПД, §7.7), «Создать
   документ из текущих правил» и прежнее поле текста.
3. Есть документ: кнопка «Открыть редактор». Редактор (iframe обёртки, §6.1)
   открывается во всю ширину и высоту рабочей области; закрыть — «Закрыть
   редактор». Если редактор недоступен — «Редактор недоступен, правила агента
   работают как раньше». Сессия открыта у другого админа — «Документ открыт у: …» и
   «Завершить правку у всех».
4. «Что получит агент» (§8.4) и главная кнопка «Применить к агенту».
5. «Версии»: №, когда, кто, источник, знаков, картинки (переданы, не переданы, нет
   решения), состояние и флаги («сохранена от старой версии», «сохранена с ошибкой»,
   «восстановлена из забытых», «отклонена: причина»). Действия: «Скачать .docx»,
   «Восстановить», «Удалить безвозвратно» (с подтверждением; не для применённой).
6. Ниже, свёрнуто, как сейчас: «Общие правила EVO (всегда добавляются)» и стандартные
   правила (`InstructionsEditor.tsx:124-135`).
7. Узкий экран (телефон): только применённый текст правил и строка «Правьте документ
   на компьютере». Редактор на телефоне не открывается.

Компонент `src/components/v3/ai-agents/RulesDocumentEditor.tsx` только показывает
iframe и обменивается сообщениями с обёрткой (§6.1). `api.js` он не грузит, обёртка
`@onlyoffice/document-editor-react` не нужна. Публичный адрес передаётся с сервера
пропсом, а не через `NEXT_PUBLIC_*`.

## 11. Лицензия

- ONLYOFFICE Docs Community Edition — AGPL-3.0 с дополнительными условиями §7
  (сохранять логотип и атрибуцию, помечать изменённые версии). Права на товарный знак
  не передаются (исследование 26.10).
- EVO использует **официальный образ без изменений**, отдельной службой, через
  HTTP-API и загрузчик `api.js`, который отдаёт сам сервер редактора (в варианте B —
  внутри своей обёртки на `docs.`). Исходники ONLYOFFICE не копируются в бандл CRM.
  Настройка переменными окружения и файлом настроек (например, выключение ИИ, §5.1) —
  это конфигурация, а не изменение программы. Обёртка `evo-editor.html` — наш
  отдельный файл, отдаёт его edge, а не сервер редактора. Логотип не скрывать
  (`customization.logo` — только в Developer edition).
- Это не юридическое заключение. При сомнениях владелец спрашивает юриста. Репозиторий
  CRM публичный и без файла LICENSE (исследование), но варианту с отдельной службой
  это не мешает.
- Лимит подключений. У Community исторически было 20 одновременных подключений. По
  исследованию 26.10 его сняли в 9.4 от 20.05.2026 (коммит `c635713`,
  `LICENSE_CONNECTIONS_OS = 0x7fffffff`). Для EVO это неважно: правят 1–3 админа. В R0
  на закреплённой версии это проверяется по README образа.

## 12. Безопасность (свод)

| Риск | Мера |
|---|---|
| SSRF из редактора: картинка по URL или HTML из буфера заставляет сервер редактора ходить по внутренним адресам | редактор не в `evo_public_web`. С1: изолированная `internal`-сеть `evo_docs`, в ней только редактор, edge и CRM; `ALLOW_PRIVATE_IP_ADDRESS=true` только там; выхода наружу нет. С2: `ALLOW_PRIVATE_IP_ADDRESS=false`. Отрицательные пробы в R0 и в production (§5.2) |
| Редактор отправляет документ третьим сторонам (плагины, ИИ, загрузка плагинов при старте) | `PLUGINS_ENABLED=false`, ИИ выключен и проверен в R0, у редактора нет выхода наружу (С1), CSP `connect-src` на `docs.`, снятие исходящего трафика в R0 (§5.1) |
| Чужой JavaScript на origin CRM | вариант B: страница CRM показывает только iframe обёртки на `docs.`, `api.js` в CRM не грузится, обмен через `postMessage` со строгим `origin` и `targetOrigin` (§6.1). Вариант A — письменное принятие риска владельцем |
| Хранимая XSS через картинки из `.docx` | маршрут картинок отдаёт только PNG, JPEG, GIF по сигнатуре; SVG, EMF, WMF — никогда; `nosniff`, `default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin` (§7.3) |
| Чужой открывает или скачивает документ | `.docx` только в server-only bucket. Нет подписанных и публичных ссылок. Скачивание — маршрут админа с `no-store`. Файл редактору — внутренний адрес, короткоживущий токен и JWT |
| Подделка callback или файла | JWT HS256 с проверкой `operation`, `key`, `url`. Внутренние маршруты снаружи закрыты (`Caddyfile.evo-edge:37`) и внесены в список маршрутов точными шаблонами |
| SSRF через `url` в callback | только адреса ONLYOFFICE, переписывание на внутренний адрес, без редиректов, потолок и тайм-аут |
| Потеря правок | состояние сессии — по `info` ONLYOFFICE, без таймеров; поздний callback сохраняется с флагом; статусы 3 и 7 тоже сохраняются; временный сбой — HTTP 500 для повтора; сверка «забытых»; карантин вместо отказа; «нет открытых сессий» перед выпуском (§7.4, §7.6) |
| Текст и документ разъезжаются | `ai_agents_update_v1` отказывает в правке текста при `rules_source='document'`; сброс — явная смена источника; «Применить» сверяет sha256 текста из предпросмотра (§7.2) |
| Макросы и активное содержимое | `macros=false`, `macrosMode="disable"`, `plugins=false`. Загрузка отвергает `vbaProject.bin`, `activeX/`, OLE-вложения, внешние связи кроме ссылок, `attachedTemplate`, `altChunk` (§8.1) |
| Zip-бомба, тяжёлый документ | потолки ZIP, главная часть ≤ 4 МиБ, воркер с тайм-аутом и `resourceLimits`, 20 МиБ на файл |
| Вредоносный файл | ClamAV до записи в Storage, как в 271; положительный файл не хранится нигде |
| Персональные данные | загрузка оригинала китайского гайда — только после ответа §16 п.3; картинки по умолчанию не передаются; подписи к картинкам и коды полей не передаются; «Удалить версию безвозвратно», политика хранения кэша и «забытых» (§7.1); Claude vision — только R7 и только по отметке владельца |
| Iframe | `frame-ancestors 'self' https://crm.evoadmissions.com` на `docs.` (B) или `'self'` для `/onlyoffice/*` (A). Для прочих путей CRM `X-Frame-Options DENY` остаётся |
| Служебные пути редактора | наружу — только список путей, снятый в R0; всё прочее 404, в том числе `/downloadfile*`, `/admin*`, `/sdkjs-plugins*`, `/command*` (§6.3) |
| Утечка секрета и токенов в журналах | секреты только в двух env-файлах `chmod 600` и в SOPS. CRM не пишет токены и ссылки. У редактора `NGINX_ACCESS_LOG=false` и `DS_LOG_LEVEL=WARN`; R0 ищет в его журналах `md5=`, `expires=`, `token`. Edge: у `docs.` журнала доступа нет, глобальный фильтр дополнен `md5` и `expires`; в варианте A фильтр `(evo_app)` дополнен `token`, `md5`, `expires` (§6) |
| Права | всё, что пишет, — только `systemRole === "admin"`. Просмотр роли отсекает приложение (server actions, маршруты, `sync.ts:313`), база проверяет админа. Служебные RPC — только `service_role` |
| Аудит | загрузка, сохранение (автор из callback), применение (id версии и sha256 текста), смена источника, восстановление, удаление версии, решение по картинке. Тексты правил в аудит не пишутся, как в `317:915` |
| Память и CPU сервера | `mem_limit`, `oom_score_adj 800`, `cpu_shares 128`, `cpus 1.5`, swap (§5.4), замер в R0 |

## 13. Резервные копии и откат

**Данные.** Версии `.docx` лежат в self-hosted Storage, а у него резервных копий нет
(решение владельца 20.10, `infrastructure-map.md:165`). Что защищает сейчас:
применённый текст есть ещё в `instructions_override` и в версиях агента у Claude.
Пока владелец не включил резервные копии, после крупных правок стоит «Скачать .docx»
и держать копию у себя. Включить bucket `platform-ai-agent-rules` в будущие резервные
копии — вопрос владельцу (§16).

**Откат по уровням:**

1. **Содержание.** «Восстановить» версию N (новая версия из старого файла) →
   «Применить» → синхронизация. Или «Сбросить на стандартные»: агент вернётся к
   правилам из репозитория.
2. **Быстрый выключатель.** `docker compose -p evo-docs stop` (не `down`, §3.3).
   Маршрут `…/editor` проверяет healthcheck редактора перед выдачей конфига (§7.3),
   поэтому вкладка сразу говорит «Редактор недоступен», а агент работает на
   последнем применённом тексте. Перезапуск CRM не нужен.
3. **Функция целиком.** Выпуск CRM без `EVO_ONLYOFFICE_*` и без переменной сети
   `evo_docs` — только через CI в окне выпусков (env — неизменяемый снимок выпуска,
   §3.3). Вкладка вернётся к текстовому полю. Если `rules_source='document'`,
   правка текста по-прежнему отклоняется базой: сначала «Вести правила текстом».
4. **Приложение.** Обычный откат выпуска (`deploy/fast-app-release.md`). Миграция
   аддитивная, заменённая `ai_agents_update_v1` при `rules_source='text'` ведёт себя
   как прежняя; откатывать базу не нужно.
5. **Сервис и edge.** Остановка `evo-docs-onlyoffice`; возврат прежнего Caddyfile из
   резервной копии: `caddy validate`, затем `caddy reload` по порядку
   `infrastructure-map.md:107-116`; `docker network disconnect evo_docs evo-edge-caddy`.
   Плохой образ — прежний digest из runbook.
6. **Swap.** `swapoff`, убрать строку из `fstab`, удалить файл.

## 14. Проверка

### 14.1. Автоматические проверки (по изменённому)

- Конвертер: фикстуры `.docx` собираются в тесте из XML (без данных владельца):
  заголовки и цепочки стилей, списки с `numbering.xml`, таблица с объединёнными
  ячейками, ссылки, сноски, картинка с alt-текстом (alt не передан), поле
  `INCLUDEPICTURE` (код не передан), `altChunk`, комментарий, исправления, скрытый
  текст, текст `[[evo-image:` (экранирован), zip-бомба, макрос, внешняя связь, OLE.
- Воркер: тайм-аут и превышение `resourceLimits` дают `failed`, а не падение CRM.
- Маршрут картинок: PNG, JPEG, GIF отдаются с нужными заголовками; **SVG со
  `<script>` внутри `.docx` не отдаётся**; EMF и файл с чужим расширением — тоже.
- JWT: верный токен, чужой секрет, `alg: none`, просроченный, чужая `operation`,
  несовпадение `key` и `url`.
- Callback: матрица статусов 1/2/3/4/6/7 (для 3 и 7 файл сохраняется), повтор
  (идемпотентность), чужой адрес `url`, не-админ в `users` (`author_unverified`),
  поздний callback после закрытия (`stale_base`), временный сбой → HTTP 500,
  провал OOXML → карантин и `{"error":0}`, ClamAV-положительный файл не хранится.
- Сверка: `info` с пользователями и без, `getForgottenList` с файлом своей сессии.
- Список маршрутов: новые пути проходят, соседние и неточные — 404; POST без
  `sameOrigin` — 403.
- Postgres-авторизация новых RPC, bucket и заменённой `ai_agents_update_v1` (§7.2).
- UI-тест вкладки в наборе `ai-agents-ui`: админ, не-админ, просмотр роли (только
  чтение), без env, режим документа (поле только для чтения), узкий экран.
- Release controller (для С1): тесты рядом с проверками сети ИИ-агента — сеть
  `evo_docs` у CRM только при включённой переменной, переходный режим, откат.
- Обёртка: копия в Caddyfile равна `deploy/onlyoffice/evo-editor.*`; сообщения с
  чужого origin игнорируются.
- `tsc`, `eslint`, `git diff --check`. Полный набор не гоняется (правило быстрой
  проверки, AGENTS.md).

### 14.2. Настоящий путь

**R0, спайк до кода, не на production.** Закреплённый образ локально в Docker, прокси
Caddy только для варианта, который выбрал владелец (§16 п.1), сеть С1. Проверяется и
записывается с числами:

- память и CPU: в покое, при старте с генерацией шрифтов, при открытом документе, при
  двух редакторах; время открытия и сохранения при `cpus 1.5`;
- сеть: С1 работает (`internal: true`); у edge и CRM маршрут по умолчанию не изменился;
  отрицательные пробы SSRF (§5.2) — отказ без исходящего запроса; если С1 не работает —
  те же пробы для С2;
- выключатели: нет вкладки ИИ, плагинов, админ-панели, стартовой страницы; снятие
  трафика редактора и браузера — сторонних хостов нет; журналы редактора без
  `md5=`, `expires=`, токенов;
- список путей, которые нужны браузеру (из журнала прокси), и CSP Report-Only для
  `docs.`; `sandbox` iframe; обмен `postMessage`; `refreshFile` после обрыва и после
  15 минут;
- JWT и `operation`; формат ответа `info` и его callback; `drop`;
- **проверка OOXML на выводе ONLYOFFICE:** файлы, сохранённые по статусам 6 и 2, а
  также экспорт из Word и Google Docs, прогоняются через `checkAiUploadContent`
  (ZIP64, флаги, `Target` в `_rels/.rels`, размер главной части);
- пробы на потерю правок (§7.6);
- конвертер на 1–2 `.docx` владельца **без клиентских данных** (§16), сверка с
  `docx → txt`.

Итог R0 — запись с числами. По ней выставляются лимиты, выбирается С1 или С2 и
фиксируется список путей.

**Production, после разрешений §16, в окне выпусков.** Пока подключена АТС, выпуск
приложения — после 21:00 по Бишкеку или в воскресенье
(`docs/PLAN_CHANGES.md:61798`). Порядок:

1. Swap (если разрешён): `free -m` показывает swap.
2. Проект `evo-docs`: сеть `evo_docs` создана, `evo-docs-onlyoffice` поднят,
   healthcheck зелёный, `docker stats` в покое записан.
3. `docker network connect evo_docs evo-edge-caddy`; `ip route` edge до и после
   совпадает; публичные сайты отвечают как раньше.
4. Миграция, затем readback: bucket закрыт, политики на месте, тело
   `ai_agents_update_v1` — новое, число функций прежнее.
5. Edge: резервная копия → запись на месте → `validate` → `reload`. Публичные пробы:
   - редактор и обёртка открываются на нужном адресе, а на `app.` дают 404 (A);
   - пути вне списка — 404, в том числе `/command`, `/downloadfile`, `/admin`;
   - `X-Frame-Options` и CSP ровно как в §6;
   - `/api/internal/onlyoffice/*` снаружи — 404;
   - прежние проверки `crm.`, `app.`, сайта и `supabase.` не изменились.
6. Выпуск CRM с `EVO_ONLYOFFICE_*` и переменной сети `evo_docs`; сети контейнера CRM
   совпали с отрисованными (`verify_networks`).
7. Проба админом (владелец или назначенный админ) на очищенном согласованном `.docx`:
   - загрузить, открыть, поправить, «Сохранить»;
   - появилась версия, SHA-256 в Storage совпадает с записью;
   - текст в предпросмотре; сравнение с текущими правилами — только разница в
     оформлении;
   - закрыть, через ~10 с сессия закрыта.
   «Применить» — только на агенте и документе, которые назовёт владелец. После
   применения `SyncPanel` показывает новую версию агента в Claude. Откат пробы —
   «Восстановить» или «Сбросить на стандартные».
8. Отрицательные пробы:
   - не-админ не открывает редактор;
   - просмотр роли — только чтение;
   - callback с неверной подписью — 403 и нет версии;
   - в пробном документе картинка по адресам `http://evo-supabase-gw:8000/` и
     `http://sales-assistant-api:8781/` — отказ;
   - остановка `evo-docs-onlyoffice` → «Редактор недоступен», агент отвечает;
     запуск обратно.
9. `docker stats` и `free -m` во время правки записаны.

Это техническое доказательство. Приёмка владельцем — его собственная правка
настоящих правил.

### 14.3. Критерии приёмки

1. Админ правит `.docx` в CRM. После «Сохранить» или закрытия появляется новая версия
   с автором. Сбой CRM во время сохранения не теряет правку (версия появляется после
   повтора или из «забытых»).
2. Текст «Что получит агент» совпадает с тем, что после «Применить» уходит в Claude
   (sha256 в аудите равен sha256 предпросмотра, хеш конфигурации совпал, плашки «не
   отправлено» нет).
3. Картинки без решения агенту не переданы; это видно в предпросмотре.
4. Документ и картинки снаружи недоступны: нет публичных ссылок, пути вне списка —
   404; SSRF-пробы отказаны.
5. Если остановить `evo-docs-onlyoffice`, агенты работают, а вкладка по проверке
   healthcheck честно говорит «Редактор недоступен».
6. Пик памяти редактора записан и не выше лимита. Не было OOM-событий у Supabase и CRM.
7. Пока правила ведутся в документе, правка текста через любой server action
   отклоняется базой.

## 15. Срезы и трудоёмкость

| Срез | Что | Оценка (дни агента) |
|---|---|---|
| R0 | Спайк §14.2 по выбранному владельцем варианту публичного пути: образ, сеть С1 (С2 — только если С1 не работает), SSRF-пробы, выключатели и трафик, память, OOXML на выводе ONLYOFFICE, потеря правок, конвертер на тестовых `.docx`; запись чисел | 1–1,5 |
| R1 | Инфраструктура: compose, сеть, env-пример, runbook, обёртка и блок edge, инструкция по swap; **отдельным PR** — сеть `evo_docs` в release controller с тестами и review. На сервер — только после разрешения | 1–1,5 |
| R2 | Миграция: bucket, 3 таблицы, 2 колонки, функция сборки текста, 10 RPC, замена `ai_agents_update_v1` с проверками, тесты Postgres-авторизации | 1,5 |
| R3 | Сервер CRM: JWT, маршруты и список маршрутов, конфиг и сессия, сверка `info` и «забытых», callback с карантином и поздними версиями, загрузка, скачивание, картинки, применение, удаление версии, стартовый `.docx` | 2–2,5 |
| R4 | Конвертер `.docx` → текст и картинки (развилка с mammoth), воркер, проверка в standalone-образе, тесты | 1,5–2 |
| R5 | Интерфейс вкладки, `/impeccable`, UI-тест | 1–1,5 |
| R6 | Ревью по точному head, правки, выпуск, проверка на настоящем пути | 1 |
| **Итого** | | **9–11,5** |
| R7 (по решению владельца) | «Предложить описание через Claude» для картинок с отметкой владельца | 0,5 |

Исследование оценивало ONLYOFFICE в 4–6 дней, первая редакция этого плана — в
6,5–8. Рост — из ревизии: изолированная сеть и правка release controller, обёртка
iframe, сверка сессий, «забытых» и поздних callback, карантин, удаление версий,
защита текста в базе. Если нужно быстрее, интерфейс версий урезается до «список,
скачать, восстановить, удалить» без флагов в таблице (−0,5). Календарно добавьте
ожидание ответов §16 и окна выпусков.

## 16. Что нужно от владельца

1. **Публичный путь.** Поддомен `docs.evoadmissions.com` (рекомендую: одна A-запись
   `docs → 72.62.119.112` в Spaceship, ставите вы) или путь
   `crm.evoadmissions.com/onlyoffice/` без DNS. Во втором случае редактор работает на
   одном origin с CRM, а cookie сессии читаются из JavaScript (§6.2). Нужно ваше
   письменное согласие с этим риском. Спайк R0 делается только по выбранному варианту.
2. **Разрешение на изменения `hermes-vps`:** swap-файл 4 ГБ; новый проект `evo-docs`
   с лимитом до 4 ГБ памяти; новая изолированная сеть `evo_docs` и подключение к ней
   edge (без перезапуска); правка edge Caddy; новые секреты в двух env-файлах;
   подключение CRM к `evo_docs` через выпуск (правка release controller).
3. **18 картинок китайского гайда.** Что на них. Можно ли хранить `.docx` с ними
   целиком в EVO, или сначала их убрать или замазать (по умолчанию — грузим только
   очищенный вами файл). Устраивает ли политика хранения §7.1 (версии — пока админ не
   удалит; кэш редактора — до 24 ч). Какие картинки описать для агента. Разрешаете ли
   описания через Claude vision (R7) — тогда отметку «ПД нет» ставите только вы.
4. **Применение.** Отдельная кнопка «Применить к агенту» (рекомендую) или применение
   при каждом сохранении.
5. **Исходные документы.** Актуальные `.docx` по агентам: Китай и Малайзия от 23.10
   или новее. Ещё 1–2 `.docx` без клиентских данных для спайка R0. Для остальных
   агентов — создать документ из текущего текста?
6. **Лимит 60 000 знаков.** Оставить, а если документ не поместится — поднять до
   90 000?
7. **Резервные копии.** Версии `.docx` лежат в self-hosted Storage без резервных
   копий (ваше решение 20.10). Принимаете или включаем этот bucket в копии?
8. **Шрифты.** Ставим только свободные шрифты. Calibri и Times New Roman заменятся
   совместимыми по метрике, вёрстка может чуть сдвинуться. Устраивает?

## 17. Риски и неизвестные

- Реальное потребление памяти и CPU ONLYOFFICE 10 при `cpus 1.5` не замерено (R0).
  Если пик близок к 4 ГБ, а swap не разрешён, сервер становится теснее для всех служб.
- Работает ли ONLYOFFICE в `internal`-сети без выхода наружу и не меняет ли
  подключение к ней маршрут по умолчанию у edge и CRM (R0). Запасной вариант — С2.
- Проходит ли вывод ONLYOFFICE проверку OOXML EVO (R0). Если нет — своя обёртка
  проверки для этого пути (§8.1).
- Что остаётся от несохранённых правок после `kill -9`, `restart` и пересоздания
  редактора (R0). Возможно, понадобится том `/var/lib/postgresql`.
- Как выключается ИИ в 10.0, если вкладка видна при `PLUGINS_ENABLED=false` (R0).
- Виртуальный путь (A) подтверждён официальным примером для nginx, но для Caddy и
  10.0 не проверен (R0, только если владелец выберет A).
- Качество конвертера на реальных документах (сложные таблицы, текстовые блоки,
  SmartArt) не проверено. SmartArt и надписи в фигурах могут потеряться — это
  показывает сверка с `docx → txt` в R0.
- Правка release controller затрагивает проверку сетей всех выпусков (§5.2); ошибка
  в ней останавливает выпуски. Поэтому отдельный PR, тесты и review.
- Обновления ONLYOFFICE выходят часто, у каждого — своё окно и проверка (§5.6).

## 18. Источники

Код (`origin/main` `cd611c536`):
- `src/components/v3/ai-agents/InstructionsEditor.tsx`, `AgentBody.tsx`, `SyncPanel.tsx`
- `src/lib/platform-ai-agents-actions.ts`
- `src/lib/v3/ai-agents-view.ts`
- `src/lib/server/ai-agents/sync.ts`, `config-hash.ts`
- `src/content/ai-agents/index.ts`
- `src/lib/ai-agents/contract.ts`
- `src/lib/platform-access.ts`
- `src/lib/platform-route-contract.ts`, `src/proxy.ts`
- `supabase/migrations/269_platform_ai_agent_rpc.sql`, `271_platform_ai_agent_files.sql`,
  `317_platform_ai_agents_managed.sql`, `319_platform_ai_agents_hardening.sql`,
  `322_platform_ai_agents_daily_spend.sql`
- `src/lib/server/ai-agent-files.ts`, `ai-agent-route-handlers.ts`,
  `ai-agent-knowledge-route-handlers.ts`, `clamd-malware-scanner.ts`,
  `platform-company-file-storage-route-handlers.ts`, `ai-agent-internal-auth.ts`,
  `document-package.ts`, `university-form-docx.ts`
- `src/lib/supabase/server.ts`
- `scripts/evo-app-env-contract.mjs`, `scripts/evo-fast-release.sh`,
  `scripts/validate-runtime-hardening.mjs`
- `docker-compose.prod.yml`, `next.config.ts`, `package.json`
- `agent-lead2-inbox/deploy/Caddyfile.evo-edge`, `agent-lead2-inbox/deploy/docker-compose.edge.yml`
- `deploy/README.md`, `deploy/fast-app-release.md`
- `docs/runbooks/infrastructure-map.md`
- `docs/PLAN_CHANGES.md`
- `docs/adr/0035-run-ai-agents-on-claude-managed-agents.md`

Исходники образа ONLYOFFICE, прочитаны 27.10.2026 (ветка `master`; на закреплённом
теге сверяются в R0):
- `https://github.com/ONLYOFFICE/Docker-DocumentServer/blob/master/run-document-server.sh`
  (`b8f5ba80bbaa`, 17.09.2026): `PLUGINS_ENABLED` `:19`, `NGINX_ACCESS_LOG` `:38`,
  `ALLOW_PRIVATE_IP_ADDRESS` `:56`, `:539-543`, `WELCOME_PAGE_ENABLED` `:59`,
  `runtime.json` `:142-144`, `ADMINPANEL_ENABLED` `:772-775`, плагины `:818`,
  `documentserver-flush-cache` `:838`, шрифты `:849-852`;
- `https://github.com/ONLYOFFICE/server/blob/master/Common/config/default.json`
  (`6d033e7987da`, 05.09.2026): `aiSettings` `:12-22`, `callbackRequestTimeout`
  `:337-340`, `forgottenfiles` `:344-345`, `editorDataStorage` `:349`, `expire.files`
  `:456`, `request-filtering-agent` `:472-474`, `outbox` `:499-505`,
  `callbackBackoffOptions` `:545-553`;
- `https://github.com/ONLYOFFICE/document-server-package/blob/master/common/documentserver/bin/documentserver-flush-cache.m4`
  (`ed465abdf602`): пересборка `api.js` и `{{HASH_POSTFIX}}`.

Документация ONLYOFFICE, прочитана 27.10.2026:
- установка Docker (Docs 10.0: требования, переменные `JWT_*`,
  `ALLOW_PRIVATE_IP_ADDRESS`, `SECURE_LINK_SECRET`, тома) —
  https://helpcenter.onlyoffice.com/docs/installation/docs-community-install-docker.aspx;
- callback handler (статусы, `url` при 2/3/6/7, статус 1 только при подключении и
  отключении, `{"error":0}`, статус 2 через 10 с) —
  https://api.onlyoffice.com/docs/docs-api/usage-api/callback-handler/;
- CommandService (`info`, `drop`, `getForgotten`, `getForgottenList`,
  `deleteForgotten`; путь `/command` с 8.2) —
  https://api.onlyoffice.com/docs/docs-api/additional-api/command-service/;
- события редактора (`onRequestRefreshFile` → `refreshFile`, `onRequestClose`) —
  https://api.onlyoffice.com/docs/docs-api/usage-api/config/events/;
- подпись запросов и `operation` с 10.0 —
  https://api.onlyoffice.com/docs/docs-api/additional-api/signature/request/token-in-header/;
- `document.key` (128 знаков, набор символов, новый ключ после сохранения) —
  https://api.onlyoffice.com/docs/docs-api/usage-api/config/document/;
- `customization` (`forcesave`, `macros`, `macrosMode`, `plugins`, `logo` только
  Developer) —
  https://api.onlyoffice.com/docs/docs-api/usage-api/config/editor/customization/customization-standard-branding/;
- конвертация (`docx → txt` для сверки в R0) —
  https://api.onlyoffice.com/docs/docs-api/additional-api/conversion-api/request/ и
  …/conversion-tables/;
- прокси на виртуальный путь —
  https://helpcenter.onlyoffice.com/installation/docs-community-proxy.aspx и
  https://github.com/ONLYOFFICE/document-server-proxy/blob/master/nginx/proxy-to-virtual-path.conf.

Исследование 26.10: `research-doc-editor.json` (вне Git). Варианты 1–8, поправки
по ONLYOFFICE 9.4/10.0, лимит `system` 100 000, картинки китайского гайда, снимок
сервера, совет по mammoth с санитайзером и тайм-аутом.

## 19. Ревизия по критике

Ревизия 1 от 27.10 применяет все замечания независимой критики уровня blocker и
major и почти все minor.

**Применено полностью:**

- blocker «SSRF из ONLYOFFICE в `evo_public_web`» — §3.3, §3.4, §5.1, §5.2, §12,
  §14.2: своя `internal`-сеть `evo_docs` (С1), запасной С2, отрицательные пробы.
  Неверная фраза «чужой адрес подсунуть нельзя: конфиг подписан JWT» убрана;
- major «`api.js` в origin CRM и SRI» — §6.1, §10, §12: только iframe обёртки на
  `docs.`, `postMessage` со строгим origin, SRI убран;
- major «потеря правок» — §7.4, §7.6: сверка по `info`, поздние callback с флагами,
  статусы 3 и 7, HTTP 500 вместо `{"error":1}`, «забытые», шаг runbook, пробы R0;
- major «синхронность текста и документа» — §7.2 п.6, §8.4, §9: замена
  `ai_agents_update_v1` с проверками, `changed` у новых RPC, явная смена источника;
- major «XSS через маршрут картинок» — §7.3, §14.1;
- major «плагины и ИИ» — §3.4, §5.1, §6.1, §12 (дополнительно найдена
  админ-панель, которая стартует по умолчанию: `ADMINPANEL_ENABLED=false`);
- major «проверка OOXML на выводе ONLYOFFICE» — §8.1, §7.6 (карантин), §14.2;
- major «удаление ПД» — §0, §7.1, §7.7, §8.3, §10;
- minor про сборку текста в «Применить», CPU, откат и смену секрета, защиты
  маршрутов, просмотр роли в базе, детали edge и журналов, несостыковки, стартовый
  `.docx`, телефон, оценку.

**Применено частично или с уточнением:**

- «Внешние связи и `attachedTemplate` отвергаются или вырезаются» (minor про
  конвертер). При загрузке отвергаются. Файл, сохранённый редактором, не
  отвергается и не переписывается: отказ терял бы правку, а переписывание
  чужого `.docx` — лишний риск порчи. Конвертер их не передаёт, а ходить по ним
  редактору некуда (С1). §8.1.
- «Флаг в БД как быстрый выключатель» (minor про откат). Отдельного флага не будет:
  остановка контейнера плюс проверка healthcheck в маршруте `…/editor` дают тот же
  результат без новой таблицы, интерфейса и аудита для редкого действия. §13.
- «Сверка `getForgottenList` при открытии вкладки или по таймеру». Только при
  открытии вкладки админом и перед действиями, которым мешает сессия; таймер не
  ставится, пока R0 не покажет, что «забытые» удаляются сами. §7.6.
- «Загрузка гайда с картинками заблокирована». Технически отличить этот документ
  нельзя, поэтому запрет — правило процесса (§0) плюс предупреждение в диалоге
  загрузки и удаление версии как страховка. §7.7.
- «Спайк только по варианту владельца». Применено к публичному пути (A или B).
  Сеть С1/С2 по блокеру выбирается в R0: С2 проверяется, только если С1 не работает.
- «mammoth для R4». Не выбран заранее: развилка на 2 часа в начале R4 на тестовых
  документах, выбор записывается в `PLAN_CHANGES`. §8.1.

**Отклонено:** нет.
