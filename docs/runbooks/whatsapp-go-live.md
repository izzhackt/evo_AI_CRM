# WhatsApp go-live: прямой приём WAHA → CRM (`crm_primary`)

Обновлено: 2026-10-06. Статус: **фазы B–G выполнены 2026-10-06 (с отступлением
в C5, см. ниже); фаза H (pairing) выполнена 2026-10-06 — сессия `crm_primary`
в `WORKING` с 07:41:06Z; с этого дня через путь идут сообщения реальных
клиентов; протокол приёмки по пп. 1–8 фазы I отдельно не фиксировался.** Факты
после привязки — в абзаце «Дополнение 2026-10-06» ниже; текст между ними
описывает состояние до привязки и не переписывается.
Состояние до привязки на 2026-10-06 по сообщению оркестратора (этим документом
из production не перепроверялось: доступа к нему нет; подробная квитанция —
`docs/EVO_LAUNCH_PLAN.md`, раздел «go-live WhatsApp продаж (всё, кроме
привязки телефона)»): миграции 259–262 применены, ledger production 001–262;
выпуски №1 (приём выключен) и №2 (приём включён) приняты; WAHA работает на GOWS
2026.9.2, сессия `crm_primary` создана в состоянии STOPPED и не привязана к
номеру; Vault-binding v1 готов. Документ ничего не разрешает: каждый шаг,
меняющий production (VPS, GitHub-переменные, schema, release, WAHA), выполняется
только после явного «давай» владельца в чате и только в его границах. Решение
03.10 «окей отмена, пока подождем потом сделаем» заменено решением 06.10: «ок давай
делаем / пока привязку чуть позже сделаем, остальное все сделай». Привязку
(фаза H) владелец отложил; H и I выполняются только после его нового «давай»
(владелец рядом, pairing идёт в реальном времени).

**Дополнение 2026-10-06 (после привязки).** По сообщению оркестратора и
read-only проверкам (только счётчики и окна прогонов, без текстов и номеров):

- Привязка: сессия `crm_primary` (GOWS) перешла в `WORKING` **2026-10-06
  07:41:06Z**. Тайминг кода и QR, с которым столкнулись, — в § H.
- Помощник привязки 06.10 выполнялся **внутри контейнера app**: ключ WAHA он
  читал из Vault-binding и не печатал. `/tmp` контейнера стирается каждым
  release, поэтому такой помощник (и любые файлы в `/tmp`) после выпуска
  нужно класть заново.
- Импорт истории (`docs/runbooks/whatsapp-history-import.md`): прогон
  `c1831744…` — пилот на 6 чатах, окно 7 дней; прогон `59f9f226…` — 50 самых
  свежих чатов, окно 31 день. У обоих `window_to` = `2026-10-06T07:41:06Z`
  (момент `WORKING`), сверено read-only по
  `platform_private.waha_history_reconciliation_runs`.
- После привязки в `communication_messages` идут входящие
  `private_waha_binding` и отправленные с телефона `private_waha_phone_binding`;
  повторных `raw_message_id` в `waha_message_bindings` для `crm_primary` — 0
  (read-only счётчики 06.10).
- `WAHA_WORKER_RESTART_SESSIONS` по-прежнему `false`; возврат в `true`
  запланирован отдельным шагом (отдельное «давай» владельца).

Код приёма — [#1137](https://github.com/izzhackt/evo_AI_CRM/pull/1137), влит в
`main` коммитом `f3a60db90` (дерево совпадает с head `a57fb607d`, по которому
читался код для этого runbook). После него в `main` влиты
[#1139](https://github.com/izzhackt/evo_AI_CRM/pull/1139) (импорт истории
переписок, миграция 260, `e05c48442`; отдельный runbook
`docs/runbooks/whatsapp-history-import.md`, не часть go-live) и
[#1141](https://github.com/izzhackt/evo_AI_CRM/pull/1141) (отвечать из CRM могут
все сотрудники, миграция 261, `67ec56098`). Код записи ключа WAHA в Vault — этот
PR: `scripts/waha-runtime-binding.mjs` (см. [§ Скрипт](#скрипт-vault-binding)).

Для сессии `crm_primary` процедура **заменяет** указание «новую конфигурацию
WAHA направлять на приватный webhook lead-agent» из `AGENTS.md`
(§ «WhatsApp And Lead-Agent Boundary»): решение владельца — прямой приём
WAHA → CRM (`/api/v2/whatsapp/inbound`), lead-agent на этом пути не участвует.
Сам раздел `AGENTS.md` обновляется отдельным docs-PR после go-live, не здесь;
до тех пор webhook не «исправлять» под старый текст.

Метки доказательств: **[doc]** — документация WAHA (URL рядом);
**[src]** — исходники WAHA на теге 2026.9.2 (и 2026.7.1), прочитаны 2026-10-05,
не запускались; **[repo]** — этот репозиторий: код приёма (#1137) читался на head
`a57fb607d`, его дерево равно слитому `f3a60db90`; остальное — `origin/main`
`01247bc8b` на 2026-10-05; после слияния #1139/#1141 (`67ec56098`) перечитаны
только файлы, названные в § Фазы B–C и «Допущения #1137» (env-контракт,
`platform-waha-webhook.ts`, миграции 259–261); **[live ✗]** — не проверялось на реальных WAHA и
WhatsApp; **[??]** — не проверено нигде. Всё, что отмечено только [live ✗] или
[??], на go-live проверяется глазами, а не принимается на веру.

## Схема и имена

```
телефон отдела продаж ── WhatsApp ── WAHA (GOWS, сессия crm_primary)
                                        │ webhook, HMAC sha512, message.any + session.status
                                        ▼
                         http://evo-crm-app:3000/api/v2/whatsapp/inbound   (приватная сеть evo_crm_private; публично закрыт на edge — C5)
CRM (ручной ответ, проба статуса) ──► http://evo-crm-waha:3000   ключ WAHA берётся из Supabase Vault
```

| Что | Значение | Основание |
|---|---|---|
| Контейнеры | compose-проект `evo-crm`: `evo-crm-app-1` (alias `evo-crm-app:3000`), WAHA (service `waha`, alias `evo-crm-waha:3000`, портов на хосте нет) | [repo] `docker-compose.prod.yml` |
| Сессия | только `crm_primary` (иное запрещено CHECK-ами и триггерами БД) | [repo] миграция 102 |
| Ключ WAHA для CRM | Vault-binding: RPC `platform.provision_manual_send_waha_runtime(p_organization_id uuid, p_waha_api_key text, p_request_id uuid)` и `platform.manual_send_waha_runtime_configuration(p_organization_id uuid)`; Vault-binding v1 создан 2026-10-06 (фаза F), `check` → `ready` (по сообщению оркестратора); до этого в production было 0 bindings (на 2026-10-05) | [repo] миграции 080/081/102; сигнатуры сверены на схеме 001–258; миграции 259–261 эти функции не затрагивают (поиск по именам в 259–261 пуст) |
| Подпись webhook | HMAC-SHA512 по сырому телу; заголовки `X-Webhook-Hmac`, `X-Webhook-Hmac-Algorithm: sha512`; секрет 32–128 байт | [doc] https://waha.devlike.pro/docs/how-to/events/ ; [repo] `platform-waha-webhook.ts` (`MAX_WEBHOOK_SECRET_BYTES=128`), env-контракт (≥ 32) |
| Env приложения (#1137, в `main`) | `EVO_PLATFORM_WAHA_INGRESS_ENABLED` (маршрут отвечает 503, пока не ровно `1`), `EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET`, `EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID` | [repo] #1137 |
| Файл env WAHA | `/opt/evo-crm/.env.waha` (рядом `.env.production`) | [repo] `deploy/README.md` |

## Порядок фаз и почему так

| Фаза | Что | Ключевое |
|---|---|---|
| 1 | Условия | «давай», проверка телефона владельцем, окно, свободный release |
| A | Разведка read-only | ничего не меняет |
| B | Шаг 0: пустая строка в `.env.production` | #1137 уже в `main`: нужен **до любого следующего release** (в том числе не связанного с WhatsApp), иначе он падает на env-контракте |
| C | merge этого PR, ledger 259–261, release №1 (ingress 0) | кладёт в образ код #1137/#1139/#1141 и скрипт; WhatsApp ещё не подключён |
| C5 | Edge Caddy: публичный `/api/v2/whatsapp/inbound` → 404 | общий edge, отдельное «давай» владельца, **до** G |
| D | Пересоздание WAHA: GOWS 2026.9.2 | новый ключ, медиа выключены, ничего не стартует само |
| E | Сессия `crm_primary` (STOPPED) + webhook + ignore | **до** pairing |
| F | Vault-binding через скрипт | ручные ответы и проба статуса |
| G | release №2: ingress=1 + HMAC + intake-владелец | **до** pairing (см. ниже) |
| H | Pairing кодом по номеру (ветка passkey) | |
| I | Приёмка | сообщение владельца → ответ из CRM |

### Статус выполнения на 2026-10-06

По сообщению оркестратора; из production этим документом не перепроверялось.
Секреты, номера и идентификаторы людей в таблицу не попадают.

| Фаза | Статус | Факты |
|---|---|---|
| B | выполнена 2026-10-06 | бэкап `.env.production` `20261006T041641Z`, пустая строка intake добавлена, env-контракт валиден для #1137 и примеров `main` |
| C | выполнена 2026-10-06 | #1137 `f3a60db90`, #1139 `e05c48442`, #1141 `67ec56098`, #1138 `484247965`, #1149 `8424dc384` влиты; ledger 001–262 (259, 260 — run 37414042683; 261 — позднейший apply ~04:45 UTC; 262 — маркетинговая сессия, check 37418074480, apply 37418118435); release №1 (ingress 0): CI 37415480322, run 37415511885, `v3-r37415511885-a1-48424796`, `check` → `missing_binding` (ожидаемо) |
| C5 | выполнена **с отступлением** | репозиторный Caddyfile не применялся: в живом нет двух блоков хостов репозитория; в живом файле изменена только строка `@private` в `(evo_app)`; подробности — в C5; расхождение — решение владельца |
| D | выполнена 2026-10-06 (05:48–05:49 UTC) | одноразовый скрипт после независимого review (GO); образ `devlikeapro/waha:gows-2026.9.2` `sha256:1ae3c6a994ee…`, GOWS, `WAHA_PRINT_QR=false`, медиа выключены, `WAHA_WORKER_RESTART_SESSIONS=false`, лимит 2 GiB, `healthy`, `restarts=0`, тот же том, снимок тома `waha-sessions-20261006T054855Z.tgz`; `EVO_WAHA_IMAGE_DIGEST` обновлена |
| E | выполнена | `crm_primary` создана STOPPED; `ignore` = `status`, `groups`, `channels`, `broadcast`; webhook на `…/api/v2/whatsapp/inbound`, события `message.any` и `session.status`, HMAC, повторы `exponential`/2/10 |
| F | выполнена | Vault-binding v1, `ready`; plain-ключ только в Vault, в `.env.waha` — хэш |
| G (G1–G2) | выполнена | в `.env.production`: `INGRESS=1`, HMAC, intake-владелец (руководитель продаж); контракт валиден; бэкапы `env.waha.20261006T054855Z`, `env.production.20261006T054925Z` |
| G3–G4 | выполнены | release №2 (ingress 1): CI 37420526110, run 37420552232, `v3-r37420552232-a1-8424dc38`, arm выключен; production app = `main` = `8424dc38`; приватный `POST …/inbound` без подписи — 401, публичный — 404; `check` → `ready`; `/api/health` 200 на crm и app |
| H | выполнена 2026-10-06 | `WORKING` с 07:41:06Z (GOWS); помощник привязки — в контейнере app, ключ из Vault-binding не печатался; `WAHA_WORKER_RESTART_SESSIONS=false` (возврат в `true` — отдельным шагом); до этого владелец откладывал: «пока привязку чуть позже сделаем» |
| I | живой поток с 06.10 | сообщения реальных клиентов идут (входящие и отправленные с телефона); протокол пп. 1–8 отдельно не фиксировался |
| История | выполнена 2026-10-06 | прогоны `c1831744…` (пилот, 6 чатов, 7 дней) и `59f9f226…` (50 самых свежих чатов, 31 день), `window_to` = 07:41:06Z |

**Отступление от черновика чек-листа.** Release с `INGRESS=1` стоит *до*
pairing, а не после. Причина: WAHA считает ошибкой любой не-2xx ответ и
повторяет доставку ограниченное число раз [src]
`src/modules/waha-webhook/WebhookPlugin.sender.ts` (`retryCondition: () => true`).
Окно повторов зависит от политики: по умолчанию в WAHA — константа 2 с × 15 раз
(~30 с); **политика этой процедуры — фаза E** (`exponential`, `delaySeconds: 2`,
`attempts: 10`). В 2026.9.2 `exponentialDelay` считает `2^n × delay`, где n
начинается с 1 (axios-retry), то есть паузы 4, 8, 16 … 2048 с: **~68 минут** до
отказа от события, плюс до 20 % случайной добавки к каждой паузе (≈ 82 минуты
в худшем случае). Прочитано в исходниках, на живом WAHA не запускалось
**[live ✗]**. Пока маршрут отвечает 503 (ingress 0), входящие и `session.status`
за время release иначе терялись бы или приходили бы позже. Без привязанного
номера принимать нечего, поэтому включить приём заранее безопасно.

Следствие длинного окна: событие, получившее 503 (release, откат, выключенный
приём), WAHA доставит позже — через минуты, вне порядка с более новыми и,
если ответ 2xx потерялся по дороге, повторно. Приём (#1137) обязан быть
идемпотентным по идентификатору события/сообщения и терпимым к порядку; это
проверяется приёмкой (§ I, п. 4) и входит в «Допущения #1137».

---

## 1. Условия (все обязательны)

1. Явное «давай» владельца на этот go-live в чате. Для фаз D–I владелец рядом:
   pairing идёт в реальном времени. Правка общего edge (C5) — отдельное «давай»
   в окне: она затрагивает и чужие хосты в том же Caddy.
2. #1137 влит в `main` (`f3a60db90`); его допущения о реальных формах GOWS
   не проверены на живом потоке и проверяются приёмкой (§ Допущения #1137).
   Этот PR (#1138) влит в `main` **до release №1**: скрипт входит в образ.
3. Владелец проверил на телефоне отдела продаж (**[??]** — точные пункты меню и
   лимиты WhatsApp сверить в актуальной справке WhatsApp; здесь не проверялись):
   тип аккаунта (личный или Business); есть свободный слот «Связанные
   устройства»; включён ли passkey (если да — нужна ветка passkey фазы H и
   доступ владельца к своему аутентификатору); телефон с интернетом, ему не
   нужно спать/разряжаться во время pairing.
4. Окно: **не 02:30–03:00 UTC** (условие владельца/оркестратора; причина в
   репозитории не найдена, **[??]**). На VPS: `date -u; systemctl list-timers --all --no-pager | head -30`
   — любые таймеры в окне ±30 мин от работ учесть.
5. Release-линия свободна: `EVO_PRODUCTION_RELEASE_ARMED=false`, нет
   `pending-current.json`, `main` заморожен (слияние в `main` посреди
   выкатки его срывает), другие агенты не стартуют release.
6. Ресурсы VPS: доступной памяти ≥ 4 GiB (порог release-контроллера
   4 194 304 KiB), свободного диска ≥ 1 GiB плюс размер снимка тома WAHA.
7. Владелец ответил (**блокирующий вопрос перед фазой D**): используется ли
   сессия `china_curator` на этом же WAHA сегодня? Движок один на весь
   контейнер [src] `manager.core.ts`: `EngineClass` выбирается один раз из
   `WHATSAPP_DEFAULT_ENGINE`. Устройство GOWS регистрируется отдельно от
   входа WEBJS (по предварительному исследованию 03–05.10; на живой сессии не
   проверялось **[live ✗]**), поэтому `china_curator`, если она привязана,
   скорее всего тоже потребует нового pairing.
   Если она нужна — **стоп**, решение владельца (повторный pairing или второй
   контейнер WAHA отдельным PR).
8. Гигиена оператора: SSH `hermes-vps`, `gh` с правом менять переменные
   репозитория. Секреты (ключ WAHA, HMAC, пароли и ключи из `.env.waha`) не
   печатать, не вставлять в чат/тикеты/PR, не писать в файлы репозитория; в
   ssh-сессии `set +o history; umask 077`, без `set -x`. Единственное
   намеренное исключение — pairing-код фазы H (п. 2): он короткоживущий и
   одноразовый (нужен телефон владельца), его печатает один вызов ровно для
   того, чтобы оператор показал его владельцу; дальше экрана он не идёт (не
   копировать в чат, тикет, PR, файлы). Если фазу H ведёт агент через свой
   инструмент, код неизбежно окажется в его транскрипте — лучше, чтобы этот
   один шаг оператор выполнил в собственном терминале. Ответ WAHA по сессии
   (`POST/PUT /api/sessions…`, `…/start|stop|restart`, `GET /api/sessions/…`)
   содержит `config` вместе с HMAC-ключом webhook и сохранённые `me.id` (номер
   отдела продаж) и `pushName` (после первого pairing — и у **остановленной**
   сессии тоже, не только у работающей) — **WAHA не маскирует их**
   [src] `SessionRuntimeInfoPlugin.ts` (`config: session.sessionConfig`),
   `manager.core.ts` `getOfflineSessions` (для STOPPED возвращает сохранённые
   `config` и `me`). Поэтому хелперы ниже по умолчанию **отбрасывают тело
   ответа** и печатают только `[http NNN]`; читать можно лишь через явный
   `jq`-фильтр, выбирающий безопасные поля, — и для остановленных сессий тоже.
   Не вызывать `curl` к WAHA вручную и не убирать фильтр. Ключ в
   `docker exec -e` не передавать никогда: он попадёт в argv хоста,
   `docker inspect` и историю; только stdin.
   **Логи WAHA — тоже не безопасны.** При каждом старте (через ~4 с) WAHA
   печатает в stdout `WAHA_API_KEY`, `WAHA_DASHBOARD_USERNAME/PASSWORD`,
   `WHATSAPP_SWAGGER_USERNAME/PASSWORD` открытым текстом (блок «Generated
   credentials»), если значение не задано или «обычное» (пустое, `123`, `321`,
   `waha`, `admin`, 32 нуля или 32 единицы и т. п.) — это и есть случай цикла
   перезапусков [src]
   `src/core/auth/config.ts` `ReportGeneratedValue`. Кроме того, при
   `WAHA_PRINT_QR` не `false` в лог пишется сканируемый QR; `waha_logs_safe`
   его **не** скрывает (псевдографика проходит как есть) — единственная защита
   `WAHA_PRINT_QR=false` (ставит D3, проверяет D5). `docker logs` WAHA запускать
   **только** через `waha_logs_safe` (ниже: он маскирует ключи, пароли, токены и
   номера), никогда напрямую и никогда `docker compose logs waha` /
   `docker logs -f` без него.

Вспомогательные функции (вставить в ssh-сессию один раз; секреты не попадают
в argv, заголовок ключа лежит на tmpfs с правами 0600 и удаляется, тело ответа
WAHA не печатается без фильтра):

```bash
R=/opt/evo-crm; APP=evo-crm-app-1
waha_cid() { docker ps -q --filter label=com.docker.compose.project=evo-crm --filter label=com.docker.compose.service=waha; }
set_env_value() {  # NEWVAL=… set_env_value FILE NAME — строка NAME= должна быть ровно одна
  local f=$1 n=$2 tmp; tmp=$(mktemp) || return 1
  NAME="$n" awk 'BEGIN{FS=OFS="="} $1==ENVIRON["NAME"]{hit++; print ENVIRON["NAME"] "=" ENVIRON["NEWVAL"]; next} {print} END{if(hit!=1)exit 3}' "$f" > "$tmp" \
    && cat "$tmp" > "$f"; local rc=$?; rm -f "$tmp"; return $rc
}
env_put() {        # env_put FILE NAME VALUE — заменить единственную строку NAME= или добавить её, если нет
  if grep -q "^$2=" "$1"; then NEWVAL=$3 set_env_value "$1" "$2"
  else { [ -z "$(tail -c1 "$1")" ] || printf '\n' >> "$1"; } && printf '%s=%s\n' "$2" "$3" >> "$1"; fi
}
waha_open() {      # нужны WAHA_KEY и WAHA_BASE
  waha_close; local old; old=$(umask); umask 077
  WAHA_HDR=$(mktemp /dev/shm/wahahdr.XXXXXX 2>/dev/null || mktemp) || { umask "$old"; return 1; }
  umask "$old"; printf 'X-Api-Key: %s\n' "$WAHA_KEY" > "$WAHA_HDR"
}
waha_close() { [ -z "${WAHA_HDR:-}" ] || rm -f -- "$WAHA_HDR"; unset WAHA_HDR; }
trap waha_close EXIT HUP INT   # файл с plain-ключом исчезает при выходе из shell, обрыве ssh (HUP) и прерывании скрипта (INT)
_waha() {          # _waha METHOD PATH FILTER [curl-аргументы]: без FILTER печатает только «[http NNN]», тело выбрасывается
  local m=$1 p=$2 flt=$3 out code rc; shift 3
  [ -r "${WAHA_HDR:-}" ] || { printf '[нет заголовка с ключом: выполнить waha_open]\n' >&2; return 1; }
  out=$(mktemp /dev/shm/wahaout.XXXXXX 2>/dev/null || mktemp) || return 1
  code=$(curl -sS -m 30 -X "$m" -H @"$WAHA_HDR" -H 'Accept: application/json' "$@" -o "$out" -w '%{http_code}' "$WAHA_BASE$p"); rc=$?
  if [ "$rc" -ne 0 ]; then rm -f -- "$out"; printf '[curl exit %s]\n' "$rc" >&2; return 1; fi
  if [ -z "$flt" ]; then printf '[http %s]\n' "$code"; rc=0
  else case $code in
    2??) jq -r "$flt" < "$out" 2>/dev/null; rc=$?; [ "$rc" -eq 0 ] || printf '[фильтр jq не применился]\n' >&2;;   # ошибка jq цитирует кусок данных: stderr jq глушим
    *)   printf '[http %s]\n' "$code" >&2; rc=22;;
  esac; fi
  rm -f -- "$out"; return "$rc"
}
waha()      { _waha "$1" "$2" "${3:-}"; }                                                                  # waha METHOD PATH [JQ_FILTER]
waha_json() { _waha "$1" "$2" "${3:-}" -H 'Content-Type: application/json' --data-binary @-; }            # тело запроса из stdin
waha_logs_safe() { # stdin → stdout: скрыты значения WAHA_*/WHATSAPP_* (и в кавычках, с пробелами и \"), кавычные значения в «NAME (поле): '…'», на строках WHATSAPP_HOOK_, value: (и без кавычек, до , или }) и строка customHeaders с 11 следующими (всего 12), токены от 32 знаков, номера от 7 цифр; QR НЕ скрывается (WAHA_PRINT_QR=false)
  awk '/[Cc]ustom_?[Hh]eaders|CUSTOM_HEADERS/{n=12} n>0{gsub(/\047([^\047\\]|\\.)*\047/,"\047<скрыто>\047"); gsub(/"([^"\\]|\\.)*"/,"\"<скрыто>\""); n--} {print}' \
  | sed -E \
    -e "s/((WAHA|WHATSAPP)_[A-Z0-9_]+)=(\"([^\"\\\\]|\\\\.)*\"|'([^'\\\\]|\\\\.)*'|[^[:space:]]*)/\\1=<скрыто>/g" \
    -e "/(WAHA|WHATSAPP)_[A-Z0-9_]+ \\(/ s/'([^'\\\\]|\\\\.)*'/'<скрыто>'/g" \
    -e "/WHATSAPP_HOOK_/ s/'([^'\\\\]|\\\\.)*'/'<скрыто>'/g" \
    -e "/WHATSAPP_HOOK_/ s/\"([^\"\\\\]|\\\\.)*\"/\"<скрыто>\"/g" \
    -e "s/(value[\"']?[[:space:]]*:[[:space:]]*)(\"([^\"\\\\]|\\\\.)*\"|'([^'\\\\]|\\\\.)*'|[^,}]*)/\\1'<скрыто>'/g" \
    -e 's|[A-Za-z0-9_+=-]{32,}|<токен>|g' \
    -e 's/[0-9]{7,}/<n>/g' | cut -c1-160
}
```

(`waha_open`/`waha`/`waha_json` проверены локально против синтетического
сервера, в ответах которого были поддельные HMAC, номер и pushName: ни в stdout,
ни в stderr, ни в argv (во время зависшего запроса) их нет; тело запроса идёт
через stdin; при неверном ключе и при 404 печатается только `[http NNN]`;
ошибка `jq` не цитирует данные; файлы заголовка и ответа удаляются, права
заголовка 0600. На настоящем WAHA не запускались **[live ✗]**.)
Файл заголовка с plain-ключом удаляет `trap` на `EXIT`/`HUP`/`INT`: на
интерактивном `bash -i` в pty (macOS bash 3.2 и Debian bash 5.2, `/dev/shm`)
файл исчезает и при `exit`, и при внезапном закрытии терминала, как при обрыве
ssh. Ctrl-C на долгой команде (`sleep`, `curl`) сеанс не завершает и файл не
трогает, но Ctrl-C **на пустом приглашении или в `read -rs`** (ввод секрета)
запускает `trap` на `INT` и файл удаляет (проверено на тех же bash 3.2 и 5.2) —
это безопасное поведение (fail closed): после этого `waha` печатает «нет
заголовка с ключом», нужно снова `waha_open`. При `SIGKILL` или потере питания `trap` не срабатывает,
поэтому в новом сеансе первым делом `rm -f /dev/shm/wahahdr.* /dev/shm/wahaout.*`
(если параллельно не идёт другой сеанс оператора); если файл всё же удалён,
`waha` печатает «нет заголовка с ключом» — снова `waha_open`.
`waha_logs_safe` проверен на синтетическом блоке «Generated credentials» в
формате WAHA 2026.9.2 плюс строках с поддельными HMAC, номером и токеном, на
macOS (BSD sed/awk) и Debian (GNU sed 4.9, mawk 1.3.4): значения ключа, паролей и
логинов, токены от 32 знаков и номера из вывода исчезают, имена переменных остаются;
то же для строк `WHATSAPP_HOOK_*` (значения в одинарных и двойных кавычках),
`value: '…'`/`"value": "…"`/`value: без кавычек` и окно из 12 строк (строка с
`customHeaders` и 11 следующих; безобидные строки в этом окне тоже теряют кавычные
значения, дальше текст не трогается); значения с пробелами и экранированными
кавычками (`NAME="a b"`, `\"`) скрываются целиком.
QR фильтр не скрывает. На настоящем логе WAHA не запускался **[live ✗]**.

---

## A. Разведка read-only

```bash
for c in jq curl openssl sha512sum awk; do command -v "$c" >/dev/null || echo "СТОП: на VPS нет $c (ставить пакеты — только с ведома владельца)"; done
WAHA_C=$(waha_cid); [ "$(printf '%s' "$WAHA_C" | wc -w)" = 1 ] || echo "СТОП: ожидался один контейнер waha"
docker inspect -f '{{.Name}} image={{.Config.Image}} health={{.State.Health.Status}} restarts={{.RestartCount}} mem={{.HostConfig.Memory}} ports={{json .HostConfig.PortBindings}}' "$WAHA_C" "$APP"
free -k | awk '/^Mem:/{print "available_kb="$7}'; df -k /var/lib/docker | tail -1
VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/.sessions"}}{{.Name}}{{end}}{{end}}' "$WAHA_C")
docker run --rm --pull never --entrypoint sh -v "$VOL":/s:ro "$(docker inspect -f '{{.Image}}' "$WAHA_C")" -c 'ls -la /s; du -sk /s/* 2>/dev/null'
```

Имена переменных WAHA в `.env.waha`, от которых зависит go-live (значения не
печатаются: `sed` оставляет только имя):
```bash
FOUND=$(grep -E '^[[:space:]]*(export[[:space:]]+)?(WHATSAPP_RESTART_ALL_SESSIONS|WHATSAPP_START_SESSION|WAHA_WORKER_RESTART_SESSIONS|WHATSAPP_DEFAULT_ENGINE|WHATSAPP_API_KEY|WAHA_PRINT_QR|WHATSAPP_HOOK_[A-Z0-9_]+)[[:space:]]*[:=]' "$R/.env.waha" \
  | sed -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z0-9_]+).*/\2/')
echo "${FOUND:-нет ни одной}"
```
Из найденного **не должно быть** `WHATSAPP_RESTART_ALL_SESSIONS`,
`WHATSAPP_START_SESSION`, `WHATSAPP_API_KEY` и ни одного `WHATSAPP_HOOK_*`;
`WAHA_WORKER_RESTART_SESSIONS`, `WHATSAPP_DEFAULT_ENGINE` и `WAHA_PRINT_QR`
фаза D3 всё равно выставляет сама. Почему:
- `WHATSAPP_RESTART_ALL_SESSIONS` проверяется в WAHA *раньше*
  `WAHA_WORKER_RESTART_SESSIONS` и поднимает **все** сохранённые сессии;
  `WHATSAPP_START_SESSION` стартует перечисленные при каждом запуске
  контейнера [src] `manager.core.ts` (`restartSessions`, `startPredefinedSessions`),
  `config.service.ts`.
- `WHATSAPP_HOOK_URL`, `WHATSAPP_HOOK_EVENTS`, `WHATSAPP_HOOK_HMAC_KEY`,
  `WHATSAPP_HOOK_RETRIES_*`, `WHATSAPP_HOOK_CUSTOM_HEADERS` — **глобальный**
  webhook WAHA: в 2026.9.2 `WebhookPlugin.webhooks()` добавляет его к вебхукам
  **каждой** сессии, поэтому он получал бы все события `crm_primary` рядом с
  прямым приёмом фазы E. Он действует, когда заданы и URL, и события [src]
  `src/modules/waha-webhook/webhook.config.ts`, `WebhookPlugin.ts`. Такая
  строка могла остаться от выведенного из эксплуатации lead-agent
  (`/webhooks/waha`), который по правилам владельца не должен автоматически
  отвечать и запускать автоматику. PUT фазы E меняет только конфигурацию
  сессии, но не env, поэтому снять её можно только правкой `.env.waha`.
- `WHATSAPP_API_KEY` — устаревшее имя, **перекрывающее** `WAHA_API_KEY` [src]
  `src/core/auth/config.ts`: хэш из D3 был бы молча проигнорирован, D5 дал бы
  `[http 401]`.
- `WAHA_PRINT_QR` по умолчанию `true` [src] `EngineConfigService.ts`: без
  `false` сканируемый QR печатается в лог контейнера при `SCAN_QR_CODE`
  (`deploy/env.waha.example` задаёт `false`).

Если найдено что-то из `RESTART_ALL`/`START_SESSION`, `WHATSAPP_HOOK_*`,
`WHATSAPP_API_KEY` — **стоп**: фаза D3 не пойдёт (см. там), решение за
владельцем.

Параллельно с вашей машины (`gh` — там): `gh variable get EVO_WAHA_IMAGE_DIGEST --repo izzhackt/evo_AI_CRM`
должен совпасть с digest в `image=…@sha256:…`.

Ожидаемо: WAHA и app `healthy`, `restarts=0`, `ports=null` или `{}`;
`mem=2147483648` (compose уже задаёт `mem_limit: 2048m`, `cpus 2.00`, `pids 512`
[repo]). Содержимое каталогов сессий **не читать**, только имена и размеры.
Любое отклонение (нездоров, restarts>0, digest ≠ переменной) — стоп.

## B. Шаг 0 — пустая строка в `.env.production` (до любого следующего release)

**Статус: выполнена 2026-10-06** (бэкап `20261006T041641Z`, пустая строка
добавлена, контракт валиден для #1137 и примеров `main`; по сообщению
оркестратора). Блок ниже оставлен как процедура для повторения.

Release-контроллер сверяет **каждое** имя из `deploy/env.production.example`
c файлом на сервере; в #1137 добавлено имя
`EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID`, и теперь оно в `main`. Если
строки нет в `/opt/evo-crm/.env.production` (наличие на сервере здесь не
проверялось), любой release текущего `main` остановится: отсутствие даёт отказ
контроллера `app_env_contract_invalid` (внутри — `required_env_name_missing`)
[repo] `scripts/evo-app-env-contract.mjs`, `scripts/evo-fast-release.sh`.

```bash
B=/root/evo-config-backups; install -d -m 700 "$B"; TS=$(date -u +%Y%m%dT%H%M%SZ)
cp -p "$R/.env.production" "$B/env.production.$TS"; cp -p "$R/.env.waha" "$B/env.waha.$TS"; chmod 600 "$B"/*."$TS"
f=$R/.env.production
[ -z "$(tail -c1 "$f")" ] || printf '\n' >> "$f"            # завершающий перевод строки
grep -q '^EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID=' "$f" || printf 'EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID=\n' >> "$f"
grep -c '^EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID=' "$f"   # ровно 1
stat -c '%a %U:%G' "$f"                                          # права/владелец прежние (600 или 640)
```

Проверка контрактом #1137 без сети (публичные файлы с вашей машины, из `origin/main`; с момента слияния #1137 контракт и пример env в `main` не менялись):

```bash
# локально:
git show origin/main:scripts/evo-app-env-contract.mjs | ssh hermes-vps 'install -d -m 700 /root/evo-golive && cat > /root/evo-golive/evo-app-env-contract.mjs'
git show origin/main:deploy/env.production.example   | ssh hermes-vps 'cat > /root/evo-golive/env.production.example'
gh variable get EVO_SUPABASE_PROJECT_REF --repo izzhackt/evo_AI_CRM        # 20 символов, не секрет
# на VPS: REF=<это значение> (без --verify-supabase-keys: сеть и ключи не трогаются; пути абсолютные):
node /root/evo-golive/evo-app-env-contract.mjs --example /root/evo-golive/env.production.example --env /opt/evo-crm/.env.production --supabase-project-ref "$REF"
```

Ожидается `{"ok":true,"code":"valid"}`, код выхода 0 (без шага 0 —
`{"ok":false,"code":"app_env_contract_invalid"}`, код 1; пути только
абсолютные, права файла env 0600/0640). Проверено офлайн на синтетических
env-файлах с настоящим валидатором #1137: строки нет → отказ, пустая строка и
`INGRESS=0` → valid, `INGRESS=1` без секрета/intake или с секретом короче
32 → отказ, `INGRESS=1` с секретом 64 hex и UUID → valid. Правка `.env.production` вступает в силу
только через release (контроллер запечатывает snapshot). Env запущенного
контейнера и snapshot-файлы не править: контроллер сверяет revision и image id
рантайма со snapshot (`runtime_environment_identity_drift`).

## C. merge этого PR, ledger 259–261, release №1 (ingress 0)

**Статус: выполнена 2026-10-06** (по сообщению оркестратора). #1137, #1139,
#1141, #1138 влиты; ledger production 001–262 (262 — миграция заявок сайта,
#1149, применена маркетинговой сессией); release №1 с `INGRESS=0` принят
(`v3-r37415511885-a1-48424796`). Ниже — процедура для справки; пункты 2–3
относятся к состоянию 2026-10-06 утром и повторять их не нужно.

1. Убедиться: #1137, #1139, #1141 уже в `main`; CI зелёный; влить этот PR
   (с разрешения владельца, не во время чужого release).
2. Миграции 259–261 **до** release (release-ворота сверяют ledger с миграциями
   репозитория на SHA release: точное совпадение версий без дыр и лишних
   (на release №2, `main` = `8424dc38`, ledger 001–262 совпадал с репозиторием;
   позже #1142 добавил в `main` миграции 263–265 — применены ли они в production,
   здесь не проверялось: перед следующим release сверить ledger),
   [repo] `scripts/fast-release-ledger-gate.mjs`; несовпадение —
   `schema_ledger_mismatch`). Состояние по сообщению оркестратора на 2026-10-06
   (из production не перечитывалось): 259 и 260 применены 2026-10-06 через
   `evo-schema-ledger`, **261 ещё нет**. Выполнено позже в тот же день:
   261 применена более поздним apply (~04:45 UTC), 262 — маркетинговой сессией.
   Перед любым действием прочитать ledger самому:
   ```bash
   gh workflow run evo-schema-ledger.yml --repo izzhackt/evo_AI_CRM -f mode=check   # читает ledger; на утро 06.10 — хвост 260 (261 не применена); сейчас ожидается 262
   # прочитать результат; только после этого — применить недостающее (на утро 06.10 — 261):
   gh workflow run evo-schema-ledger.yml --repo izzhackt/evo_AI_CRM -f mode=apply   # затем снова mode=check: 001–261 без дыр
   ```
3. Release №1 — **с `EVO_PLATFORM_WAHA_INGRESS_ENABLED=0`** (как сейчас) и пустой
   строкой intake из фазы B. Порядок по [repo] `deploy/fast-app-release.md`:
   заморозить `main`; `gh variable set EVO_PRODUCTION_RELEASE_ARMED --repo izzhackt/evo_AI_CRM --body true`;
   `gh workflow run evo-platform-ci.yml --repo izzhackt/evo_AI_CRM --ref main -f proof_revision=<SHA main>`;
   дождаться «EVO fast app release»; затем **сразу**
   `gh variable set EVO_PRODUCTION_RELEASE_ARMED --repo izzhackt/evo_AI_CRM --body false`.
4. Проверка: образ `evo-crm-app-1` с revision = влитому SHA, `/api/health` 200,
   WAHA по-прежнему `healthy`/`restarts=0` (release его не трогает), в CRM
   «Настройки → Интеграции» написано «Приём сообщений выключен на сервере»
   [repo] #1137. Скрипт на месте и достаёт Supabase:
   ```bash
   docker exec evo-crm-app-1 node scripts/waha-runtime-binding.mjs check; echo "exit=$?"
   # ожидается: {"ok":true,"mode":"check","ready":false,"reason_code":"missing_binding",…}, exit=3
   ```

### C5. Edge Caddy: закрыть публичный маршрут приёма (до фазы G)

**Статус: выполнена 2026-10-06 с отступлением** (по сообщению оркестратора).
Живой Caddyfile отличался от `origin/main`: в репозитории два блока хостов
(`invite-bishkek.72.62.119.112.sslip.io`, `inbox.72.62.119.112.sslip.io`),
которых в живом файле нет. Поэтому репозиторный файл **не применялся**
(`c5_check` ниже требует разницы ровно в одну строку, а при ином различии —
«стоп, решение владельца»). Вместо этого в живом файле изменена только строка 8
— `@private` в `(evo_app)` получила `/api/v2/whatsapp/inbound
/api/v2/whatsapp/inbound/*`. Резервная копия
`/root/evo-config-backups/Caddyfile.evo-edge.20261006T045706Z`; `caddy validate`
OK; graceful `caddy reload`; контейнер не перезапускался (тот же id и время
старта). Смоук: изменились только две строки `POST …/inbound` (crm и app),
503 → 404; приватная проба из WAHA — 503 (тогда ingress был 0), после release
№2 — 401. **Открытый пункт для владельца:** расхождение живого Caddyfile и
репозитория (два блока хостов) не устранено; решает владелец, что считать
правдой. Следствие: файл в каталоге релиза, из которого смонтирован живой
Caddyfile, не равен репозиторному файлу своего коммита. Текст ниже — исходная
процедура; её п. 2 в этом окне остановился бы на расхождении, как задумано.

**Обновление 2026-10-06 (владелец: «они не нужны»).** Эти два блока хостов
(`invite-bishkek.72.62.119.112.sslip.io`, `inbox.72.62.119.112.sslip.io`)
удалены из репозиторного `Caddyfile.evo-edge` отдельным PR, на production
ничего не менялось и не перезагружалось. Файл репозитория после удаления всё
ещё не равен живому: в нём остаются `codex…` и `invite-bishkek-site…`, а блоки
`soodacloser.com` отличаются от живых (в живом файле лендинг и
`app.soodacloser.com`). Остальное расхождение остаётся открытым пунктом
владельца; п. 2 процедуры по-прежнему остановится на нём.

Зачем. Маршрут приёма `/api/v2/whatsapp/inbound` (#1137) без этого шага достижим
из интернета по `crm.evoadmissions.com`: Caddy пропускает для хоста тело до
105 MB (`request_body max_size 105MB`), `proxyClientMaxBodySize: "105mb"` в
`next.config.ts` заставляет Next буферизовать тело до такого размера, и только
потом срабатывает лимит обработчика (`MAX_BODY_BYTES = 256 * 1024` в
`src/lib/server/platform-waha-webhook.ts` (#1137, в `main`): тело читается потоком
и обрывается при превышении, подпись проверяется до разбора JSON) **[repo]**. WAHA ходит к приложению приватно
(`http://evo-crm-app:3000`), публичный путь не нужен. Правка в репозитории —
`agent-lead2-inbox/deploy/Caddyfile.evo-edge`: в `@private` сниппета `(evo_app)`
(его импортирует блок `crm.evoadmissions.com, app.evoadmissions.com`; там же
`respond @private 404`) добавлены `/api/v2/whatsapp/inbound` и
`/api/v2/whatsapp/inbound/*`. Устаревший хост `evo-crm.….sslip.io` мутации и так
не пропускает (405) **[repo]**. Локально проверено: `caddy validate` на
закреплённом образе (digest из `docs/archive/v1/production-release.md`,
Caddy v2.11.3; образ живого контейнера не сверялся) и `scripts/test-p7b-caddy-runtime.sh` (пути добавлены в список
запретных, 404) — на production не запускалось **[live ✗]**.

**Общий edge.** `evo-edge-caddy` обслуживает не только EVO: в том же Caddy
хосты `soodacloser.com`, `olympiadai…`, `invite-bishkek…`, `codex…`. Шаг делается
только по **отдельному явному «давай» владельца в окне**, меняется ровно одна
строка `@private`; чужие хосты не трогать. Запрещено: `compose up/down`,
`docker restart`, пересоздание контейнера (порты 80/443 общие; см. комментарий в
`docker-compose.edge.yml`) — только graceful `caddy reload` внутри работающего
контейнера (порядок как в `docs/design/v3/references/2026-09-16-website-edge.md`).
Не печатать адаптированный JSON Caddy и admin API: в нём header-ключ сайта.
Порядок: **после C4** (маршрут уже в образе и отвечает 503 — до правки это видно
снаружи) и **до G**.

Чтение 2026-10-05 (`docker inspect evo-edge-caddy`, только чтение): Caddyfile
смонтирован одним файлом, `ro`, из
`/opt/evo-releases/<sha>/repo/agent-lead2-inbox/deploy/Caddyfile.evo-edge`
(каталог релиза, не `/opt/evo-crm`). Одиночный bind-mount привязан к inode, поэтому
файл перезаписывается **на месте**: `cp` в существующий файл (GNU coreutils)
открывает его с усечением и пишет в тот же inode; `mv`/`cp --remove-destination`
дали бы новый inode, и контейнер остался бы на старом файле. Проверено на Linux
(coreutils 9.1, одиночный файл тома, смонтированный в соседний контейнер):
после `cp` inode прежний и контейнер видит новое содержимое, после `mv` inode
новый и контейнер видит старое. Усечение происходит при открытии, поэтому
источник проверяется на непустоту непосредственно перед записью (`c5_check`,
`[ -s ]`): `cat "$NEW" > "$LIVE"` при пустом или неустановленном `NEW`/`BK`
обнулил бы живой файл, и следующий перезапуск общего edge не поднялся бы
(воспроизведено на ревью). Запись меняет файл в каталоге релиза, и тот перестаёт
совпадать со своим коммитом; после слияния репозиторий уже содержит ту же строку.

1. С вашей машины (чекаут с влитым `main`) — хэш и копия на VPS:
   ```bash
   git show origin/main:agent-lead2-inbox/deploy/Caddyfile.evo-edge | shasum -a 256     # запомнить хэш → SHA ниже
   git show origin/main:agent-lead2-inbox/deploy/Caddyfile.evo-edge | ssh hermes-vps 'install -d -m 700 /root/evo-golive && cat > /root/evo-golive/Caddyfile.reviewed'
   ```
2. На VPS, только чтение: путь, хэши, разница с живым файлом. Здесь же
   определяется `c5_check` — проверка без записи, которую п. 4 вызывает заново
   непосредственно перед бэкапом и перед записью (в новой ssh-сессии п. 2
   выполнить снова и ввести `SHA`: без функции и без `SHA` п. 4 ничего не пишет):
   ```bash
   E=evo-edge-caddy; B=/root/evo-config-backups; NEW=/root/evo-golive/Caddyfile.reviewed
   SHA='<хэш из п. 1>'
   c5_check() {   # 0 — только если всё на месте и разница с живым файлом ровно одна строка: прежняя @private + два новых пути
     LIVE=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$E" 2>/dev/null)
     [[ ${SHA:-} =~ ^[0-9a-f]{64}$ ]] || { echo "СТОП: SHA не задан (64 hex-знака из п. 1)"; return 1; }
     [ -n "$LIVE" ] && [ -f "$LIVE" ] && [ -s "$LIVE" ] || { echo "СТОП: источник Caddyfile не найден или пуст"; return 1; }
     [ -s "${NEW:-}" ] && echo "$SHA  $NEW" | sha256sum -c - >/dev/null 2>&1 || { echo "СТОП: нет файла $NEW, он пуст или не совпал с SHA"; return 1; }
     [ "$(sha256sum "$LIVE" | cut -d' ' -f1)" = "$(docker exec "$E" sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)" ] \
       || { echo "СТОП: контейнер видит не тот файл, что $LIVE"; return 1; }
     DIFF=$(diff "$LIVE" "$NEW"); OLDL=$(printf '%s\n' "$DIFF" | sed -n 's/^< //p'); NEWL=$(printf '%s\n' "$DIFF" | sed -n 's/^> //p')
     [ "$(printf '%s\n' "$DIFF" | grep -c '^[<>]')" = 2 ] && printf '%s\n' "$OLDL" | grep -q '@private path ' \
       && [ "$NEWL" = "$OLDL /api/v2/whatsapp/inbound /api/v2/whatsapp/inbound/*" ] \
       || { echo "СТОП: разница с живым файлом — не ровно «прежняя строка @private + /api/v2/whatsapp/inbound и /inbound/*» — не перезаписывать; решение владельца (live ↔ репозиторий сверяются отдельно)"; return 1; }
   }
   c5_check && { echo "п. 2: OK, источник: $LIVE"; ls -li "$LIVE"; diff "$LIVE" "$NEW"
                 docker inspect -f 'id={{.Id}} restarts={{.RestartCount}} started={{.State.StartedAt}}' "$E"; }   # запомнить id/restarts/started
   ```
   Ожидается ровно одна пара строк `<`/`>`: `@private` в `(evo_app)`, причём новая
   строка равна прежней плюс ` /api/v2/whatsapp/inbound /api/v2/whatsapp/inbound/*`
   (любое другое изменение той же строки, например потерянный путь, тоже отказ).
   Любое другое различие — чужая правка в живом файле или расхождение с `main`:
   **стоп**.
3. Базовые коды до правки (запросы без тела и без данных; чужие хосты — только
   `GET /`):
   ```bash
   smoke() {
     for u in https://crm.evoadmissions.com/api/health https://app.evoadmissions.com/api/health https://evoadmissions.com/ https://soodacloser.com/; do
       printf 'GET %s %s\n' "$u" "$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$u" || echo curl-error)"; done
     for h in crm app; do u=https://$h.evoadmissions.com/api/v2/whatsapp/inbound
       printf 'POST %s %s\n' "$u" "$(curl -sS -m 15 -o /dev/null -w '%{http_code}' -X POST "$u" || echo curl-error)"; done
   }
   smoke | tee /root/evo-golive/edge-smoke.before     # ожидается: health 200, сайты как обычно, POST …/inbound = 503 (ingress 0)
   ```
4. Резервная копия, запись на месте, `validate`, `reload`. Каждый блок
   останавливается на первой неудаче и без `c5_check` (то есть без `SHA`, `NEW`,
   `LIVE`) ничего не пишет. Сначала бэкап — без бэкапа запись не начинается:
   ```bash
   BK=; WROTE=; VALIDATED=
   c5_check \
    && install -d -m 700 "$B" && BK=$B/Caddyfile.evo-edge.$(date -u +%Y%m%dT%H%M%SZ) \
    && cp -p "$LIVE" "$BK" && [ -s "$BK" ] && cmp -s "$LIVE" "$BK" && echo "бэкап: $BK" \
    || { BK=; echo "СТОП: проверка или бэкап не прошли — ничего не записано, дальше не идти"; }
   ```
   Запись. Непосредственно перед `cp` заново: `c5_check` (в том числе точная
   строка) и `cmp -s "$LIVE" "$BK"` — бэкап обязан быть байт-в-байт равен
   текущему живому файлу (устаревший или чужой `BK` от прерванного шага отвергается).
   `WROTE=1` ставится **до** `cp`: если `cp` оборвётся на середине (лимит размера
   файла, диск), живой файл уже усечён, и блок требует немедленного отката.
   `VALIDATED` получает значение (хэш файла) только после успешного `validate`.
   ```bash
   WROTE=; VALIDATED=
   [ -n "$BK" ] && [ -s "$BK" ] && c5_check && cmp -s "$LIVE" "$BK" \
    && WROTE=1 && cp "$NEW" "$LIVE" \
    && [ "$(sha256sum "$LIVE" | cut -d' ' -f1)" = "$SHA" ] \
    && [ "$(docker exec "$E" sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)" = "$SHA" ] \
    && docker exec "$E" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    && VALIDATED=$SHA && echo "validate: OK" \
    || { if [ -n "$WROTE" ]; then
           echo "СТОП: запись начата, но не завершена успешно или validate не прошёл (живой файл мог быть усечён) — reload НЕ выполнять; НЕМЕДЛЕННО откат п. 6 (BK=$BK). Причина validate: docker exec $E caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -n 5"
         else echo "СТОП: ничего не записано (нет бэкапа, бэкап не совпал с живым файлом или проверка не прошла)"; fi; }
   ```
   Только после `validate: OK` в этом же запуске — graceful reload (контейнер не
   перезапускается, открытые соединения завершаются). Блок сам отказывается, если
   `VALIDATED` не равен хэшу текущего файла в контейнере:
   ```bash
   [ -n "$WROTE" ] && [ -n "${VALIDATED:-}" ] && [ "$VALIDATED" = "$SHA" ] \
    && [ "$(docker exec "$E" sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)" = "$VALIDATED" ] \
    && docker exec "$E" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -n 3
   [ "${PIPESTATUS[0]}" = 0 ] || echo "СТОП: reload не выполнен (нет успешного validate на текущем файле в этом запуске) или не прошёл — прежний конфиг продолжает работать; при начатой записи — откат п. 6"
   docker inspect -f 'id={{.Id}} restarts={{.RestartCount}} started={{.State.StartedAt}}' "$E"   # те же id, restarts и started, что до правки
   ```
5. Проверка:
   ```bash
   smoke | tee /root/evo-golive/edge-smoke.after; diff /root/evo-golive/edge-smoke.before /root/evo-golive/edge-smoke.after
   # ожидается: различаются ровно две строки POST …/api/v2/whatsapp/inbound (crm и app): было 503, стало 404; остальные коды прежние
   docker exec "$(waha_cid)" node -e 'fetch("http://evo-crm-app:3000/api/v2/whatsapp/inbound",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(r=>console.log("[http "+r.status+"]"),e=>console.log("[fetch error "+String((e.cause&&e.cause.code)||e.name).slice(0,40)+"]"))'
   # приватный путь изнутри WAHA, без подписи и без данных: [http 503] пока ingress 0; [http 401] после фазы G
   ```
   Публичный `POST …/inbound` = 404, остальные маршруты CRM и чужие хосты — с
   прежними кодами, приватный путь изнутри WAHA отвечает (503/401, не 404 и не
   `fetch error`). Если `fetch error` — сеть/имя: проверить, что WAHA в
   `evo_crm_private`; на публичный edge это не влияет.
6. Откат (возвращает прежнее поведение; публичный маршрут снова открыт). Блок
   самодостаточен (новая ssh-сессия не мешает) и ничего не пишет, пока `BK` не
   указывает на непустой бэкап с хостом `crm.evoadmissions.com`; `smoke` и файл
   `edge-smoke.before` — из п. 3:
   ```bash
   E=evo-edge-caddy; B=/root/evo-config-backups
   LIVE=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$E" 2>/dev/null)
   [ -n "${BK:-}" ] || { echo "BK не задан; бэкапы (новые сверху):"; ls -1t "$B"/Caddyfile.evo-edge.* 2>/dev/null | head -5; echo "задать BK=<нужный файл> и повторить блок"; }
   [ -n "$LIVE" ] && [ -f "$LIVE" ] && [ -n "${BK:-}" ] && [ -s "$BK" ] && grep -q 'crm[.]evoadmissions[.]com' "$BK" \
    && cp "$BK" "$LIVE" && cmp -s "$BK" "$LIVE" && echo "файл восстановлен из $BK" \
    && docker exec "$E" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && echo "validate: OK" \
    || echo "СТОП: восстановление не выполнено или validate не прошёл — ничего больше не делать вслепую, сообщить владельцу (общий edge)"
   ```
   Затем reload (если п. 4 не дошёл до reload, работающий конфиг не менялся —
   достаточно восстановленного файла, но reload безвреден):
   ```bash
   docker exec "$E" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -n 3
   [ "${PIPESTATUS[0]}" = 0 ] || echo "СТОП: reload не прошёл — прежний конфиг продолжает работать"
   smoke | diff /root/evo-golive/edge-smoke.before -        # без различий
   ```
   Откат после фазы G снова открывает публичный приём: сразу решать — повторить
   правку или выключить ingress (см. «Откат»).

## D. Пересоздание WAHA: GOWS, образ 2026.9.2

**Статус: выполнена 2026-10-06 (05:48–05:49 UTC)** — фазы D–G2 одним
одноразовым скриптом, прошедшим независимый review (GO); по сообщению
оркестратора. Образ `devlikeapro/waha:gows-2026.9.2`
`sha256:1ae3c6a994ee97e5039bf41103193d7bf9175f1a31db73ba89bdeed6277901bc`
(прежний — `dc134637…`), движок GOWS, `WAHA_PRINT_QR=false`, скачивание медиа
выключено, `WAHA_WORKER_RESTART_SESSIONS=false`, лимит памяти 2 GiB, `healthy`,
`restarts=0`, тот же том сессий, снимок
`/root/evo-backups/waha-sessions-20261006T054855Z.tgz`; новый ключ API (хэш — в
`.env.waha`, plain — только в Vault-binding v1); `EVO_WAHA_IMAGE_DIGEST` в
GitHub обновлена. Память WAHA после — около 401 MiB (было около 0.9 GB и
росло, #1128). Ниже — процедура для справки и для отката.

Образ: Docker Hub `devlikeapro/waha:gows-2026.9.2` (вариант x86 без браузера;
формат тегов `{browser}[-cpu][-version]`) — [doc] https://waha.devlike.pro/docs/how-to/engines/#docker-images .
На 2026-10-05 Docker Hub (публичный список тегов) показывал для него
`sha256:1ae3c6a994ee97e5039bf41103193d7bf9175f1a31db73ba89bdeed6277901bc`
(тег выпущен 2026-10-02, `amd64`). Это справка: на go-live digest определяется
заново, а не копируется отсюда. Релиз: https://github.com/devlikeapro/waha/releases/tag/2026.9.2 .

**D1. Образ и digest.**
```bash
docker pull devlikeapro/waha:gows-2026.9.2
NEW=$(docker image inspect --format '{{index .RepoDigests 0}}' devlikeapro/waha:gows-2026.9.2 | sed 's/^.*@//')
printf '%s\n' "$NEW"      # sha256:<64 hex>; если не равен справочному выше — тег сдвинулся: стоп, спросить
```

**D2. Остановить WAHA, снять снимок тома** (ничего не удалять, `logout` не вызывать):
```bash
OLD_IMAGE=$(docker inspect -f '{{.Image}}' "$WAHA_C"); TS=$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 /root/evo-backups
docker stop -t 60 "$WAHA_C"
docker run --rm --pull never --entrypoint tar -v "$VOL":/s:ro -v /root/evo-backups:/b "$OLD_IMAGE" -czf "/b/waha-sessions-$TS.tgz" -C /s .
chmod 600 "/root/evo-backups/waha-sessions-$TS.tgz"       # tar в контейнере пишет под root с umask по умолчанию (0644)
sha256sum "/root/evo-backups/waha-sessions-$TS.tgz"; ls -l "/root/evo-backups/waha-sessions-$TS.tgz"     # ожидается -rw-------
```
(`tar` в образе WAHA — Debian-база **[??]**; если нет — `docker run … busybox tar`.)
Снимок содержит токены входа: права 0600 (выставляются явным `chmod`, не полагаясь
на каталог), каталог 0700, не копировать с сервера.

**D3. Новый ключ API и `.env.waha`.** Plain-ключ существует только в памяти
этой shell-сессии (и потом в Vault); на диск не писать. WAHA хранит только
хэш: `WAHA_API_KEY=sha512:{SHA512_HEX_HASH}`, клиент шлёт plain в `X-Api-Key`
— [doc] https://waha.devlike.pro/docs/how-to/security/#api-security .
Если в `.env.waha` есть `WHATSAPP_RESTART_ALL_SESSIONS`, `WHATSAPP_START_SESSION`
(при любом значении, включая `false` и пустое: не гадать), `WHATSAPP_API_KEY`
или любое `WHATSAPP_HOOK_*`, блок ничего не меняет и останавливается, печатая
только найденные **имена** (проверка фазы A, повторена здесь, потому что файл мог
измениться). Первые две: WAHA стартовала бы сессии на первой загрузке GOWS до
`ignore` и webhook. `WHATSAPP_API_KEY` перекрыл бы новый хэш. `WHATSAPP_HOOK_*` —
глобальный webhook, который WAHA добавляет к каждой сессии: он дублировал бы все
события `crm_primary` по адресу, который мог остаться от выведенного из
эксплуатации lead-agent. Снять эти строки — отдельное решение владельца
(резервная копия фазы B); после его подтверждения оператор убирает их (команда
ниже), не выводя значений, и повторяет D3 с начала:
```bash
f=$R/.env.waha
BAD='WHATSAPP_RESTART_ALL_SESSIONS|WHATSAPP_START_SESSION|WHATSAPP_API_KEY|WHATSAPP_HOOK_[A-Z0-9_]+'
if [ ! -f "$f" ]; then
  echo "СТОП: нет файла $f."
elif FOUND=$(grep -E "^[[:space:]]*(export[[:space:]]+)?($BAD)[[:space:]]*[:=]" "$f" \
     | sed -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z0-9_]+).*/\2/' | sort -u | tr '\n' ' '); [ -n "$FOUND" ]; then
  echo "СТОП: в .env.waha есть: $FOUND— не продолжать, спросить владельца (WHATSAPP_HOOK_* и WHATSAPP_API_KEY нужно убрать до D3)."
else
  KEY=$(openssl rand -hex 32) && HASH=$(printf '%s' "$KEY" | sha512sum | awk '{print $1}') \
    && env_put "$f" WAHA_API_KEY "sha512:$HASH" \
    && env_put "$f" WHATSAPP_DEFAULT_ENGINE GOWS \
    && env_put "$f" WAHA_PRINT_QR false \
    && env_put "$f" WAHA_API_DOWNLOAD_MEDIA false \
    && env_put "$f" WAHA_EVENTS_DOWNLOAD_MEDIA false \
    && env_put "$f" WHATSAPP_DOWNLOAD_MEDIA false \
    && env_put "$f" WAHA_WORKER_RESTART_SESSIONS false \
    && { grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$f" | sed -E 's/=.*/=<…>/'; } \
    || echo "СТОП: правка .env.waha не удалась (имя продублировано или файл недоступен). Не продолжать: восстановить файл из /root/evo-config-backups/env.waha.<метка> фазы B."
fi
```
Убрать строки, на удаление которых владелец дал согласие (значения не
печатаются, файл правится на месте, права сохраняются; в `RE` — только
разрешённые имена):
```bash
RE='WHATSAPP_HOOK_[A-Z0-9_]*'      # например, WHATSAPP_HOOK_[A-Z0-9_]*|WHATSAPP_API_KEY
t=$(mktemp) && awk -v re="^[ \t]*(export[ \t]+)?($RE)[ \t]*[:=]" '$0 !~ re' "$f" > "$t" && cat "$t" > "$f"; rm -f -- "$t"
```
(Вывод D3 — только имена переменных, значения замаскированы; комментарии не
печатаются. Охрана, правка и команда удаления прогнаны на синтетических
`.env.waha` (macOS и Debian: bash 5.2, GNU sed, mawk): `WHATSAPP_HOOK_*`,
`WHATSAPP_API_KEY`, пустой `WHATSAPP_START_SESSION`, `export`-строка с отступом —
СТОП с печатью только имён, файл не изменён; закомментированная строка
`# WHATSAPP_HOOK_URL=…` не мешает; `WAHA_PRINT_QR=true` становится `false`; права
файла сохраняются; несуществующий файл не создаётся. На настоящем файле не
запускались **[live ✗]**.)

**Хранение и потеря секретов.** Где живёт каждое значение: plain-ключ WAHA —
в памяти этой ssh-сессии и, пока открыт `waha_open`, в файле заголовка `0600`
на tmpfs `/dev/shm` (его удаляют `waha_close` и `trap`; жёсткий обрыв —
`SIGKILL`, потеря питания — оставляет файл до перезагрузки, а при наличии swap
его страницы могут уйти туда: поэтому в новом сеансе
`rm -f /dev/shm/wahahdr.* /dev/shm/wahaout.*`), затем в Vault (его туда кладёт
один `provision`); в `.env.waha` лежит лишь хэш; HMAC — в конфигурации сессии
WAHA (читается обратно) и затем в `.env.production`. В чат, логи, PR, Git, файлы репозитория и
заметки значения не попадают никогда. Резервная копия plain-ключа и HMAC
допустима **только** в существующем SOPS-процессе «Секреты и доступы ЭВО»
(`EVO_Знания`, как требует `AGENTS.md`): владелец сам вносит значения в
зашифрованный файл со своей машины; показать значение на экране для переноса
можно только в личном терминале владельца, не в сессии агента и не при записи
экрана. Агент значения не печатает и не архивирует.

Без архива потеря = **ротация**. Plain-ключ восстановить нельзя (на диске хэш),
оборванный ssh-сеанс теряет `KEY`: новый сеанс начинается с
`set +o history; umask 077` и повторной вставки хелперов, затем D3–D5 с новым
ключом (старый хэш просто заменяется), затем E (PUT) и F. Потерянный `HMAC` при
живом `KEY` не страшен: прочитать обратно без печати —
`HMAC=$(waha GET /api/sessions/crm_primary '.config.webhooks[0].hmac.key')`
(WAHA отдаёт его в открытом виде) — либо сгенерировать новый и выполнить E
заново (`PUT`), а затем G2.

Что и почему:

- `WHATSAPP_DEFAULT_ENGINE=GOWS` — [doc] https://waha.devlike.pro/docs/engines/gows/ ;
  движок общий для контейнера [src].
- `WAHA_PRINT_QR=false` — по умолчанию `true` [src] `EngineConfigService.ts`:
  при `SCAN_QR_CODE` WAHA рисует сканируемый QR в логе контейнера, и любой, кто
  читает `docker logs`, мог бы привязать устройство. Pairing в этом runbook
  идёт по коду (фаза H); QR — только по отдельному разрешению владельца.
- Медиа **выключены**: по умолчанию WAHA скачивает медиа. В 2026.9.2 есть
  `WAHA_API_DOWNLOAD_MEDIA`/`WAHA_EVENTS_DOWNLOAD_MEDIA` (и их `*_MIMETYPES`),
  `WHATSAPP_DOWNLOAD_MEDIA` — устаревший общий fallback; в 2026.7.x читается
  только он [src] `src/config.service.ts` обоих тегов; [doc]
  https://waha.devlike.pro/docs/how-to/config/ (раздел Media). Парсер bool
  принимает только true/false/1/0, иное — исключение при старте [src]
  `src/helpers.ts`. CRM хранит лишь текстовый маркер вложения (#1137).
- **`WAHA_GOWS_DEVICE_*` и `WAHA_CLIENT_DEVICE_NAME`/`WAHA_CLIENT_BROWSER_NAME`
  не задавать.** Первые — экспериментальные флаги глубины history sync, по
  умолчанию не заданы (решает WhatsApp); при кастомном имени устройства
  pairing по коду «likely to fail» — [doc]
  https://waha.devlike.pro/docs/engines/gows/ , https://waha.devlike.pro/docs/how-to/sessions/ .
- `WAHA_WORKER_RESTART_SESSIONS=false` (решение): по умолчанию `true`
  [doc config]; при старте контейнера WAHA поднимает все сессии, «назначенные»
  этому воркеру (назначаются при `start`, снимаются при `POST …/stop`)
  [src] `SessionService.ts`, `manager.core.ts`. Без этого флага первый старт
  под GOWS подхватил бы сессии прежней эпохи (`china_curator`, старый
  `crm_primary` со старой конфигурацией и без `ignore`) — до того как
  `ignore` задан. Цена: после перезапуска контейнера (reboot, OOM) сессия
  сама не поднимется: оператор делает `POST /api/sessions/crm_primary/start`,
  а CRM честно показывает остановленный статус. Вернуть `true` — отдельное
  решение владельца после приёмки (нужен ещё один recreate; перед этим
  `GET /api/sessions?all=true`: у `china_curator` не должно быть
  `assignedWorker`, иначе она тоже поднимется). Состояние на 2026-10-06:
  `false`; сессия `crm_primary` создана STOPPED, поэтому после любого
  перезапуска WAHA оператор сам запускает её (`POST /api/sessions/crm_primary/start`)
  — до приёмки и отдельного решения владельца.
- Оставить без изменений: `WAHA_API_KEY_EXCLUDE_PATH=ping`. В WAHA такого имени
  нет (настоящее — `WHATSAPP_API_KEY_EXCLUDE_PATH`), но `/ping` и так открыт
  без ключа [src] `app.module.core.ts`; здоровье контейнера от этого не
  зависит. Не «чинить» в рамках go-live.
- Лимиты (`mem_limit` и др.) не менять: они в запечатанном compose; GOWS не
  запускает Chromium [doc engines/gows]. Решение 02.10 по #1128 остаётся.

**D4. Пересоздать только WAHA** (app и clamav не затрагиваются):
```bash
REV=$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$APP")
VER=$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}'  "$APP")
CF=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$APP")
printf 'rev=%s ver=%s compose=%s\n' "$REV" "$VER" "$CF"      # 40 hex, версия, существующий абсолютный путь
EVO_RELEASE_REVISION=$REV EVO_RELEASE_VERSION=$VER EVO_WAHA_IMAGE_DIGEST=$NEW \
EVO_CRM_WAHA_ENV_FILE=$R/.env.waha EVO_CRM_APP_ENV_FILE=$R/.env.production \
docker compose --ansi never --project-name evo-crm --file "$CF" \
  up --detach --no-deps --no-build --pull never --force-recreate waha
```
(Форма повторяет `compose_with_app_env` release-контроллера; нужна, потому что
compose требует `EVO_RELEASE_*` для всего файла. Не запускалась **[live ✗]**.)

**D5. Проверка** (все пункты, пока не выполнены — переменную GitHub не менять).
Ожидание здоровья ограничено 3 минутами: неверное значение в `.env.waha`
(парсер bool WAHA бросает исключение при старте) даёт цикл перезапусков, и
бесконечное ожидание зависло бы без вывода.
```bash
WAHA_C=$(waha_cid); ok=0
for i in $(seq 1 36); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$WAHA_C")" = healthy ] && { ok=1; break; }; sleep 5; done
if [ "$ok" = 1 ]; then echo "WAHA healthy"
else echo "СТОП: WAHA не стала healthy за 3 минуты; дальше не идти, откат — § Откат (откат WAHA)"
     docker inspect -f 'status={{.State.Status}} restarts={{.RestartCount}}' "$WAHA_C"
     docker logs --tail 30 "$WAHA_C" 2>&1 | waha_logs_safe     # только так: при старте WAHA печатает пароли/ключ в лог, фильтр скрывает их
fi
```
Если вышло «СТОП», остальное в D5 не выполнять. Иначе:
```bash
docker inspect -f 'image={{.Config.Image}} restarts={{.RestartCount}} mem={{.HostConfig.Memory}} ports={{json .HostConfig.PortBindings}}' "$WAHA_C"
docker exec "$WAHA_C" printenv WHATSAPP_DEFAULT_ENGINE WAHA_PRINT_QR     # GOWS и false (значения не секретны)
D5_ENV=
NAMES=$( set -o pipefail; docker exec "$WAHA_C" printenv 2>/dev/null | sed 's/=.*//' ) || NAMES=     # только имена; сбой docker exec = пусто
if ! printf '%s\n' "$NAMES" | grep -qx 'WAHA_API_KEY'; then   # D3 всегда кладёт WAHA_API_KEY: нет его — env не прочитан
  echo "СТОП: env живого WAHA не прочитан (docker exec не удался или нет WAHA_API_KEY) — проверка НЕ пройдена"
else
  EXTRA=$(printf '%s\n' "$NAMES" | grep -xE 'WHATSAPP_HOOK_[A-Z0-9_]*|WHATSAPP_API_KEY|WHATSAPP_START_SESSION|WHATSAPP_RESTART_ALL_SESSIONS' | sort -u | tr '\n' ' ')
  if [ -n "$EXTRA" ]; then
    echo "СТОП: в живом env WAHA есть: $EXTRA— дальше (ключ, сессии) не идти; решение владельца: правка .env.waha (D3) и повтор D4 либо откат WAHA (§ Откат)"
  else D5_ENV=ok; echo "лишних имён нет"; fi
fi
docker inspect -f '{{json .NetworkSettings.Networks}}' "$WAHA_C" | grep -o '"evo_[a-z_]*"' | sort -u    # только evo_crm_private
```
Нужно: `image=devlikeapro/waha@$NEW`, `restarts=0`, `mem=2147483648`, портов нет,
движок `GOWS`, `WAHA_PRINT_QR=false`, «лишних имён нет» (`WHATSAPP_HOOK_*`,
`WHATSAPP_API_KEY`, автостарт не попали в живой env контейнера), одна приватная
сеть. Любое имя в «СТОП» (`WHATSAPP_HOOK_*`, `WHATSAPP_API_KEY`, автостарт) —
остановка: следующий блок не выполняется (он сам проверяет `D5_ENV=ok`). Затем
доступ с ключом и список сессий (только имя, статус, воркер; тело ответа целиком не печатается):
```bash
if [ "${D5_ENV:-}" != ok ]; then echo "СТОП: проверка живого env D5 не пройдена или не выполнялась — ключ не использовать"
else
  WAHA_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "evo_crm_private").IPAddress}}' "$WAHA_C")
  WAHA_KEY=$KEY; WAHA_BASE=http://$WAHA_IP:3000; waha_open     # не export: переменные нужны только функциям этой shell
  waha GET '/api/sessions?all=true' '.[] | "\(.name) \(.status) assigned=\(.assignedWorker | tojson)"'
fi
```
Все сессии должны быть `STOPPED` (ничего не стартовало само). Лог на сообщения
об ошибках старта: `docker logs --since 10m "$WAHA_C" 2>&1 | waha_logs_safe | grep -iE 'error|fail' | head`
(фильтр идёт **до** `grep`: значения `WAHA_*`/`WHATSAPP_*`, токены и номера
скрыты; имена и тексты в вывод всё равно могут попасть — не копировать).

**D6. Digest в GitHub в ногу.** Release-контроллер сверяет `.Config.Image` WAHA
с `repository@${EVO_WAHA_IMAGE_DIGEST}`; расхождение — `runtime_waha_image_drift`,
а `RestartCount>0` — `runtime_service_unhealthy` [repo] `evo-fast-release.sh`.
Только теперь, до любого следующего release (с вашей машины, подставив `NEW`
с VPS — это digest, не секрет):
```bash
gh variable set EVO_WAHA_IMAGE_DIGEST --repo izzhackt/evo_AI_CRM --body "$NEW"
gh variable get EVO_WAHA_IMAGE_DIGEST --repo izzhackt/evo_AI_CRM        # = $NEW
```
Если D5 не прошёл — откат WAHA (§ Откат) **до** любых действий с переменной.

## E. Сессия `crm_primary`: ignore и webhook — до pairing

**Статус: выполнена 2026-10-06** (в составе скрипта D–G2). Сессия создана в
состоянии STOPPED; `ignore` для `status`, `groups`, `channels`, `broadcast`;
webhook `http://evo-crm-app:3000/api/v2/whatsapp/inbound`, события `message.any`
и `session.status`, HMAC, повторы `exponential`/2/10.

Три вещи должны быть заданы в конфигурации ещё до pairing: `config.ignore`
(иначе группы/статусы/каналы попадают в хранилище и в webhook), webhook и HMAC.
Глобального webhook WAHA (`WHATSAPP_HOOK_*` в env) при этом быть не должно: он
добавляется к каждой сессии и получал бы те же события рядом с этим webhook;
фазы A, D3 и D5 это проверяют, а PUT ниже меняет только конфигурацию сессии.
Источники: [doc] https://waha.devlike.pro/docs/how-to/sessions/#ignore (поля
`status`, `groups`, `channels`, `broadcast`; «хранилище не сохраняет сообщения»
для GOWS/NOWEB; отправка не ограничивается), https://waha.devlike.pro/docs/how-to/events/#hmac-authentication ,
https://waha.devlike.pro/docs/how-to/events/#retries .

```bash
HMAC=$(openssl rand -hex 32)       # 64 hex-символа; только в памяти shell и затем в .env.production (фаза G)
BODY_CONFIG=$(HMAC=$HMAC jq -n '{ignore:{status:true,groups:true,channels:true,broadcast:true},
  webhooks:[{url:"http://evo-crm-app:3000/api/v2/whatsapp/inbound",events:["message.any","session.status"],
             hmac:{key:env.HMAC},retries:{policy:"exponential",delaySeconds:2,attempts:10}}]}')
CODE=$(waha GET /api/sessions/crm_primary | tail -1)       # «[http 200]» — сессия уже есть; «[http 404]» — нет
case "$CODE" in
  "[http 404]")   # создать СТОПНУТОЙ (start:false); ответ WAHA содержит config с HMAC и НЕ печатается — только статус
    printf '%s' "$BODY_CONFIG" | jq '{name:"crm_primary",start:false,config:.}' | waha_json POST /api/sessions ;;
  "[http 200]")   # заменить конфигурацию (остановленная сессия остаётся остановленной) [src] SessionService.updateSession
    printf '%s' "$BODY_CONFIG" | jq '{config:.}' | waha_json PUT /api/sessions/crm_primary ;;
  *) echo "СТОП: неожиданный ответ WAHA $CODE" ;;
esac                                                       # ожидается [http 2xx]
```
`retries` — решение этой процедуры (`exponential`, `delaySeconds` 2, 10
попыток), не рекомендация WAHA; в примере документации `constant/2/15`.
Реальное окно повторов этой политики — **~68 минут** (+ до 20 % случайной
добавки к паузам), а не секунды: расчёт и следствия — в «Порядок фаз и почему
так». Проверка без вывода секретов (ответ WAHA печатается только через фильтр):
```bash
waha GET /api/sessions/crm_primary '{status, ignore:.config.ignore, events:.config.webhooks[0].events, url:.config.webhooks[0].url, has_hmac:(.config.webhooks[0].hmac.key!=null), device_name_unset:(.config.client.deviceName==null)}'
[ "$(waha GET /api/sessions/crm_primary '.config.webhooks[0].hmac.key' | sha256sum)" = "$(printf '%s\n' "$HMAC" | sha256sum)" ] && echo hmac_matches || echo "СТОП: hmac не совпал"
```
Нужно: `status=STOPPED`, все четыре `ignore` = `true`, события ровно
`message.any`, `session.status`, `has_hmac=true`, `hmac_matches`. Подписка на
`message.ack` сознательно нет: CRM гасит ACK своих API-отправок только после
привязки id (#1137), точное сопоставление читается позже.

## F. Vault-binding (скрипт в контейнере app)

**Статус: выполнена 2026-10-06** (в составе скрипта D–G2): binding v1,
`check` → `ready`.

Скрипт читает ключ **только** из stdin (`--key-stdin`) или env
`EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY`, никогда из argv. На go-live — **только
stdin**; env-источник нужен для запуска не через `docker exec` (тесты), а
`docker exec -e EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY=…` запрещён: ключ попал бы
в argv хоста, в `docker inspect` и в историю shell. Скрипт ничего секретного не
печатает (JSON с булевыми значениями, enum и `binding_version`, без хэша ключа);
принимает только сессию `crm_primary` и URL `http://evo-crm-waha:3000`;
использует `NEXT_PUBLIC_SUPABASE_URL`, `EVO_PLATFORM_SUPABASE_SECRET_KEY`,
`EVO_PLATFORM_ORGANIZATION_ID` из окружения контейнера. Перед записью он
спрашивает WAHA (`GET /api/sessions/crm_primary`, чтение), принимает ли тот
ключ, и не пишет в Vault ключ, который WAHA отверг.

Шаги цепочкой: ошибка любого останавливает остальные.
```bash
S="docker exec -i evo-crm-app-1 node scripts/waha-runtime-binding.mjs"
printf '%s' "$KEY" | $S provision --key-stdin --dry-run \
  && printf '%s' "$KEY" | $S provision --key-stdin \
  && printf '%s' "$KEY" | $S check --verify-key --key-stdin \
  && printf '%s' "$KEY" | $S provision --key-stdin \
  || echo "СТОП: шаг не прошёл (код ошибки — выше, на stderr); дальше не идти"
# 1) dry-run: {"action":"would_create",…}, запись не выполняется
# 2) {"action":"created","ready":true,"binding_version":1,…}
# 3) ready:true, key_matches_stored_binding:true, waha_key_accepted:true
# 4) повтор: {"action":"unchanged"} — идемпотентно
```
Коды выхода: 0 — ок, 1 — ошибка (на stderr одна строка
`{"ok":false,"error_code":"…"}`), 2 — неверные аргументы, 3 — `check` видит
binding не готовым. `waha_session_status` на этом этапе — `STOPPED`, а
`waha_engine` — `UNKNOWN` (WAHA отдаёт движок только у запущенной сессии
[src] `fetchEngineInfo`): это ожидаемо.
Ротация: новый ключ → новый хэш в `.env.waha` → recreate WAHA (фаза D4–D5) →
тот же `provision` (`action: rotated`, версия +1). Это единственный
поддерживаемый путь записи ключа; plain-ключ нигде больше не хранится.

## G. Release №2 — приём включён (до pairing)

**Статус: выполнена 2026-10-06** (по сообщению оркестратора). G2 выполнен в
составе скрипта D–G2: `INGRESS=1`, HMAC и intake-владелец (руководитель продаж)
в `.env.production`, контракт валиден; бэкапы `env.waha.20261006T054855Z` и
`env.production.20261006T054925Z`. G3: CI 37420526110, release 37420552232,
`v3-r37420552232-a1-8424dc38`, arm выключен. G4: production app = `main` =
`8424dc38`, приватный `POST …/inbound` без подписи — 401, публичный — 404,
`check` → `ready`, `/api/health` 200 на crm и app. Допустимость
intake-владельца по SQL из G1 и вид страницы «Настройки → Интеграции» в
переданных фактах отдельно не названы.

**Условие:** C5 выполнен — публичный `POST https://crm.evoadmissions.com/api/v2/whatsapp/inbound`
отвечает 404. Иначе `INGRESS=1` откроет приём в интернет (см. C5).

**G1. Intake-владелец.** Нужен UUID membership «Руководитель продаж»; перед
использованием проверить допустимость (только чтение, Supabase SQL Editor).
Реальные UUID в репозиторий, чат и PR не записывать.
```sql
-- кандидаты (только идентификаторы):
SELECT m.id AS membership_id, m.status, m."current_role"
FROM platform.organization_memberships AS m
WHERE m.organization_id = '<ORGANIZATION_ID>' AND m.status = 'active' AND m."current_role" = 'sales'
ORDER BY m.id;
-- допустимость одного кандидата (зеркало миграции 082): должно вернуть true
SELECT EXISTS (
  SELECT 1
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile ON profile.id = membership.profile_id
  JOIN platform.organizations AS organization ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id AND bundle.role = membership."current_role" AND bundle.status = 'published'
  WHERE membership.organization_id = '<ORGANIZATION_ID>' AND membership.id = '<MEMBERSHIP_ID>'
    AND membership.status = 'active' AND membership."current_role" = 'sales'
    AND profile.status = 'active' AND organization.status = 'active'
    AND platform_private.membership_has_active_scope(membership.organization_id, membership.id, 'organization', membership.organization_id)
    AND (SELECT count(DISTINCT p.permission_key) = 2 FROM platform.role_bundle_permissions AS p
         WHERE p.bundle_id = bundle.id AND p.bundle_role = bundle.role
           AND p.permission_key IN ('organization.read', 'communication.read.full'))
) AS intake_owner_eligible;
```
(Запросы выполнены 2026-10-05 на пустой схеме 001–258, синтаксис и колонки верны; данные
production не читались.) Если `false` — **стоп**: без допустимого владельца
проекция отвечает ошибкой на каждое сообщение [repo] env-контракт #1137. Условия
взяты из миграции 082 и 077; не пересверялись с миграциями 259–261 **[??]** (функция `platform_private.staff_intake_owner_is_eligible` определена в миграции 156 и в 259–261 не переопределяется; запросы выше после них заново не выполнялись).

**G2. Править `.env.production`** (резервная копия из фазы B уже есть; свежая — `cp -p` ещё раз).
Шаги цепочкой: если имя не встречается ровно один раз, `set_env_value`
возвращает ошибку, и остальное не выполняется.
```bash
read -rs INTAKE; echo          # вставить UUID из G1 (ввод не отображается)
f=$R/.env.production
NEWVAL=1       set_env_value "$f" EVO_PLATFORM_WAHA_INGRESS_ENABLED \
 && NEWVAL=$HMAC   set_env_value "$f" EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET \
 && NEWVAL=$INTAKE set_env_value "$f" EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID \
 && awk -F= '$1=="EVO_PLATFORM_WAHA_INGRESS_ENABLED"{print $1"="$2} $1=="EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET"||$1=="EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID"{print $1" длина="length($2)}' "$f" \
 && node /root/evo-golive/evo-app-env-contract.mjs --example /root/evo-golive/env.production.example --env "$f" --supabase-project-ref "$REF" \
 || echo "СТОП: правка или контракт не прошли — release №2 не запускать; восстановить файл из /root/evo-config-backups/env.production.<метка> (фаза B)"
# ожидается {"ok":true,"code":"valid"}
```
Контракт с `INGRESS=1` требует секрет ≥ 32 символов и UUID не нулевой.

**G3. Release №2** — как C3 (arm → CI на точный SHA `main` → дождаться → disarm).
Миграций нет, код прежний. Перед запуском: WAHA `healthy`, `restarts=0`
(иначе release остановится).

**G4. Проверка:** «Настройки → Интеграции» больше не пишет «приём выключен»;
статус сессии честно показывает остановленную (WAHA ещё не стартовала).
Повторить пробы C5 п. 5: публичный `POST …/inbound` — 404, приватный изнутри WAHA — 401 (без подписи).
Запоздалые повторы WAHA (окно ~68 минут, § «Порядок фаз») возможны только у
уже привязанной сессии; до pairing их нет.

## H. Pairing кодом по номеру

**Статус: выполнена 2026-10-06** — `crm_primary` в `WORKING` с 07:41:06Z.
До этого владелец откладывал («пока привязку чуть позже сделаем»). Шаги ниже
нужны для повторной привязки (новый телефон, `logout`, смена движка) и
начинаются только по новому «давай» владельца, когда он у телефона.

**Тайминг кода и QR (наблюдалось 06.10).** Примерно через **160 с** после
первого `SCAN_QR_CODE` сессия уходит в `FAILED`, если телефон не привязался.
Поэтому:

- до `start` (п. 1) владелец уже держит телефон на экране «Связанные
  устройства → Привязать устройство → Привязать по номеру телефона»;
- код (п. 2) запрашивать **сразу** после `SCAN_QR_CODE` и ввести его на
  телефоне в течение ~2 минут; не успели и сессия в `FAILED` — `restart`
  (конец § H) и новый код;
- если на телефоне уже **4 из 4** связанных устройств, владелец сначала
  отвязывает одно на самом телефоне, иначе привязать ещё одно нельзя.

**Где выполнять.** 06.10 помощник привязки работал **внутри контейнера app**:
ключ WAHA он брал из Vault-binding (как `waha-runtime-binding.mjs`) и не
печатал. `/tmp` контейнера стирается каждым release: помощник, положенный туда
до выпуска, после выпуска нужно положить заново.

Владелец у телефона. Номер набирается владельцем в терминал без вывода и без
записи в историю (`read -rs SALES_MSISDN`, только цифры в международном
формате); в репозиторий/чат не попадает. Источник: [doc]
https://waha.devlike.pro/docs/how-to/sessions/ (Get pairing code,
`POST /api/{session}/auth/request-code`, тело `{"phoneNumber":"…"}`).

1. Запустить сессию и дождаться `SCAN_QR_CODE` (ответы WAHA печатаются только
   через фильтр: тело содержит `config` с HMAC, а у запущенной сессии — номер):
   ```bash
   waha POST /api/sessions/crm_primary/start                                 # [http 2xx]
   for i in $(seq 1 30); do st=$(waha GET /api/sessions/crm_primary '.status'); [ "$st" = SCAN_QR_CODE ] && break; sleep 2; done; echo "status=$st"
   waha GET /api/sessions/crm_primary '{status, engine:.engine.engine}'     # engine = "GOWS"
   ```
2. Запросить код и показать его **только владельцу на экране оператора** —
   это единственный сознательно печатаемый «секрет» (гигиена, п. 8):
   одноразовый, живёт ограниченное время (срок в документации не указан
   **[??]**), без телефона владельца бесполезен; копировать в лог, чат, тикет,
   PR не нужно (предпочтительно выполнить шаг в собственном терминале оператора):
   ```bash
   printf '{"phoneNumber":"%s"}' "$SALES_MSISDN" | waha_json POST /api/crm_primary/auth/request-code '.code'    # печатает только код
   ```
3. Владелец вводит код в WhatsApp: «Связанные устройства → Привязать
   устройство → по номеру телефона» (**[??]** названия пунктов — по актуальной
   справке WhatsApp). Ожидаемый ход статусов: `SCAN_QR_CODE` → … → `WORKING`
   [doc sessions, Session Status].
4. Проверить без вывода персональных данных:
   ```bash
   waha GET /api/sessions/crm_primary '{status, engine:.engine.engine}'     # WORKING / GOWS
   waha GET /api/sessions/crm_primary/me 'has("id")'                        # true (сам номер не печатать)
   ```
   Если код не подошёл: документация предупреждает, что pairing-код доступен
   не всегда, и советует держать QR как запасной путь (`GET /api/crm_primary/auth/qr`,
   владелец сканирует). **QR запрашивать только с отдельного подтверждения
   владельца в чате** (правило `AGENTS.md`: не вызывать QR/logout без отдельного
   разрешения; общее «давай» на go-live его не включает). Показать QR оператору
   можно только по приватному каналу (ssh-туннель) — **[live ✗]**.

**Ветка passkey** (если статус `PASSKEY_REQUIRED`/`PASSKEY_CONFIRMATION_REQUIRED`;
поддерживает только GOWS, появилось в 2026.7.1) — [doc]
https://waha.devlike.pro/docs/how-to/sessions/#passkey , https://waha.devlike.pro/blog/waha-passkey/ :
подпись passkey создаётся только аутентификатором владельца на origin
`https://web.whatsapp.com` — бэкенд, скрипт и CRM этого сделать не могут.
Через панель WAHA это делает расширение браузера (запасной путь — скрипт в
DevTools на web.whatsapp.com). Панель не публикуется: доступ только приватным
туннелем с машины владельца — `ssh -L 3000:<WAHA_IP>:3000 hermes-vps` и затем
`http://localhost:3000/dashboard` (логин/пароль — `WAHA_DASHBOARD_*` из
`.env.waha`; ключ API вводится в панели; ни то, ни другое не передавать в чат).
Вызов подписи живёт ограниченное время (в примере документации 60 000 мс);
при `PASSKEY_CONFIRMATION_REQUIRED` владелец сверяет код на экране телефона и
подтверждает. Если владелец не готов — **остановить** сессию
(`waha POST /api/sessions/crm_primary/stop`, печатает только статус), не `logout`,
и вернуться к паре позже.
Эта ветка **[live ✗]** целиком.

Если сессия ушла в `FAILED`: `waha POST /api/sessions/crm_primary/restart`
(печатает только статус; сырой ответ не смотреть), затем заново пп. 1–3. `logout` — только с отдельного разрешения владельца: он
удаляет устройство из «Связанных устройств» [doc sessions, Logout].

## I. Приёмка

**Статус: живой поток с 06.10** (после привязки 07:41:06Z): подписанные WAHA
сообщения реальных клиентов принимаются, импорт истории выполнен (прогоны
`c1831744…`, `59f9f226…`); протокол пп. 1–8 отдельно не фиксировался. Открыто:
отдельное решение о возврате `WAHA_WORKER_RESTART_SESSIONS=true` (сейчас
`false`). Критерии ниже — для повторной приёмки после повторной привязки или
смены движка.

Критерии — реальные сообщения реальных людей; зелёный `/api/health` не доказывает приём.

1. **Статус.** «Настройки → Интеграции» — «подключён» (проба
   `GET /api/sessions/crm_primary` ключом из Vault даёт `WORKING` [repo] #1137).
2. **Входящее.** Владелец пишет с личного номера на номер отдела продаж:
   «тест-1». В течение минуты сообщение видно в разделе WhatsApp CRM, создан
   клиент и лид (триггер на подтверждённом входящем) **[live ✗]**.
3. **Ответ из CRM.** Сотрудник, у которого в CRM есть право отправки WhatsApp, отвечает
   из CRM «тест-ответ-1»; сообщение приходит владельцу. Галочки доставки в CRM
   не ждать: `message.ack` не подписан.
4. **Нет дублей.** Агрегатные запросы (только счётчики, без текстов) в SQL Editor:
   ```sql
   SELECT event_type, verification_status, count(*) AS events
   FROM platform_private.provider_webhook_events
   WHERE provider = 'waha' AND waha_session_name = 'crm_primary' AND received_at > now() - interval '1 hour'
   GROUP BY 1, 2 ORDER BY 1, 2;      -- ожидаются только verified; rejected/stale/missing — разобраться до продолжения
   SELECT m.direction, m.message_identity_source, count(*) AS messages
   FROM platform.communication_messages AS m
   WHERE m.created_at > now() - interval '1 hour'
   GROUP BY 1, 2 ORDER BY 1, 2;      -- 1 входящее и 1 исходящее на каждое сообщение теста
   SELECT m.direction, m.message_identity_source, count(*) AS messages
   FROM platform_private.waha_message_bindings AS b
   JOIN platform.communication_messages AS m
     ON m.id = b.communication_message_id AND m.organization_id = b.organization_id
   WHERE b.waha_session_name = 'crm_primary' AND m.created_at > now() - interval '1 hour'
   GROUP BY 1, 2 ORDER BY 1, 2;      -- то же, но только сообщения с привязкой к crm_primary
   SELECT count(*) AS duplicate_raw_ids
   FROM (SELECT raw_message_id FROM platform_private.waha_message_bindings
         WHERE waha_session_name = 'crm_primary'
         GROUP BY raw_message_id HAVING count(*) > 1) AS d;   -- 0
   ```
   **Не фильтровать `communication_messages` по `waha_session_name`:** у строк
   прямого приёма (`private_waha_binding`, `private_waha_phone_binding`,
   `private_waha_history_binding`, `private_manual_send_binding`) это поле по
   CHECK `communication_messages_provider_identity_check` пустое (`NULL`),
   сессия хранится в приватной привязке (`waha_message_bindings`). Такой фильтр
   на живых данных 06.10 дал 0 строк при сотнях привязок. Ожидаемые источники:
   входящее — `private_waha_binding`, ответ из CRM — `private_manual_send_binding`,
   отправленное с телефона — `private_waha_phone_binding`. У импортированных из
   истории (`private_waha_history_binding`) `created_at` — время самого
   сообщения, поэтому в часовое окно они попадают только свежие.
   Исходящее из CRM не должно появиться второй раз как «отправлено с телефона»:
   эхо `source: api` проекцией игнорируется [repo] #1137.
5. **Отправка с самого телефона — в чат, у которого уже есть диалог в CRM**
   (например, тот же чат владельца после «тест-1» из п. 2). Владелец пишет с
   телефона продаж: сообщение появляется в этом диалоге как исходящее.
   Сообщение с телефона в чат **без** диалога по замыслу не создаёт ни диалог,
   ни клиента, ни лид: оно откладывается (deferred, миграция 259) и попадает в
   диалог, когда клиент сам напишет первым. Его отсутствие в CRM — не дефект.
   Здесь больше всего риска: в GOWS `from` — это чат в обе стороны, а `to` для
   личных чатов `null` [src] `session.gows.core.ts` (`from: info.Chat, to: info.IsGroup ? info.Sender : null`).
   Если в чате **с** диалогом не появилось — это дефект разбора #1137, не повод
   выключать приём.
6. **Игнор работает.** Сообщение в группе/статус не создаёт ни событий, ни
   диалогов (проверить счётчики п. 4 до и после) **[live ✗]**.
7. **Формы реальных GOWS-payload.** Снять формы **без значений** (пути ключей и
   типы JSON; цифры ≥ 6 в именах ключей маскируются) и сверить с допущениями ниже:
   ```sql
   WITH RECURSIVE walk(event_type, path, val) AS (
     SELECT e.event_type, ''::text, e.raw_payload
     FROM platform_private.provider_webhook_events AS e
     WHERE e.provider = 'waha' AND e.received_at > pg_catalog.now() - INTERVAL '24 hours'
     UNION ALL
     SELECT w.event_type, child.path, child.val
     FROM walk AS w
     CROSS JOIN LATERAL (
       SELECT w.path || CASE WHEN w.path = '' THEN '' ELSE '.' END || kv.key AS path, kv.value AS val
       FROM pg_catalog.jsonb_each(CASE WHEN pg_catalog.jsonb_typeof(w.val) = 'object' THEN w.val ELSE '{}'::jsonb END) AS kv
       UNION ALL
       SELECT w.path || '[]', el
       FROM pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(w.val) = 'array' THEN w.val ELSE '[]'::jsonb END) AS el
     ) AS child
   )
   SELECT event_type, pg_catalog.regexp_replace(path, '[0-9]{6,}(@[a-z.]+)?', '<masked>', 'g') AS key_path,
          pg_catalog.jsonb_typeof(val) AS json_type, pg_catalog.count(*) AS seen
   FROM walk WHERE path <> '' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
   ```
   (Проверен на реальной схеме и на синтетических данных: значения не выводит.)
   Результат (только пути/типы) — комментарием в #1137; тексты, номера, JID, push-имена не копировать.
8. **Итоговое состояние.** WAHA и app `healthy`, `restarts=0`, `ARMED=false`,
   `EVO_WAHA_IMAGE_DIGEST` = запущенному digest, `waha_close; unset KEY HMAC INTAKE WAHA_KEY SALES_MSISDN`.
   Запись о go-live (SHA, UTC, digest, результат пп. 1–6, без значений) —
   отдельным docs-PR.

### Допущения #1137, которые проверяет приёмка

Из описания и кода #1137 (в `main`, `f3a60db90`) — названия полей и списки зависят от движка
и не проверены на живом потоке GOWS: телефон-альтернатива LID
(`_data.Info.SenderAlt` / `RecipientAlt`, NOWEB `_data.key.remoteJidAlt`);
имя профиля (`_data.Info.PushName`, `_data.notifyName`, `_data.pushName`); какие
`_data.type` — служебные уведомления (список взят из WEBJS); разбор исходящего
с телефона (`fromMe`, `source: app`) при `to = null`; лимит тела 256 KiB (`MAX_BODY_BYTES`: поток обрывается при превышении,
подпись проверяется до разбора JSON — не 64 KiB из прежнего описания PR;
отказ 400 `invalid_message_body` для текста клиента длиннее 4000 знаков снят
2026-10-06: WAHA повторял такой вебхук и отбрасывал, сообщение терялось; теперь
текст сохраняется целиком, а GOWS кладёт его в событие трижды — `body`,
`_data.Message`, `_data.RawMessage`, — поэтому в 256 KiB помещается ~85 КиБ
текста, около 43 000 знаков кириллицей; больше — 413);
идемпотентность и терпимость к порядку при запоздалых повторах WAHA (окно
~68 минут для политики фазы E, § «Порядок фаз»).
Исправления по этим пунктам ведутся отдельно (новым PR в `main`), не в этом runbook.

## Откат и остановка

| Ситуация | Действие |
|---|---|
| Срочно остановить приём, не теряя привязку | `waha POST /api/sessions/crm_primary/stop` (хелпер печатает только `[http NNN]`; сессия остаётся привязанной; снимает «назначение» воркера [src]). **Не** `logout`. Позже — `…/start`. |
| Выключить приём в CRM | release с `EVO_PLATFORM_WAHA_INGRESS_ENABLED=0` (правка `.env.production` → arm → CI → disarm, как C3). Маршрут снова отвечает 503; WAHA повторяет такие события по политике фазы E (~68 минут, паузы растут) и доставит их позже, вне порядка, а после окна откажется от них — сначала остановить сессию. При последующем включении приёма запоздалые повторы идемпотентны только если #1137 такой, см. § «Допущения». |
| Откат WAHA на прежний образ | старый digest `sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c` ([repo] `docs/platform/p8d4-current-main-staff-pilot.md`) + прежний движок WEBJS: восстановить `.env.waha` из `/root/evo-config-backups/…`, **оставив новую строку `WAHA_API_KEY=sha512:…`** (иначе ключ в Vault перестанет подходить), убрать `WHATSAPP_DEFAULT_ENGINE=GOWS`, `compose up --force-recreate waha` как D4 со старым digest, вернуть `EVO_WAHA_IMAGE_DIGEST`. Том не откатывать, если он цел; снимок — на случай порчи. **Привязка не восстанавливается:** вход GOWS и вход WEBJS независимы, считать, что нужен новый pairing **[live ✗]**. |
| Откат правки edge (C5) | восстановить бэкап в тот же inode, `caddy validate`, `caddy reload` внутри `evo-edge-caddy` (C5 п. 6); без `compose up/down` и `docker restart`. Публичный маршрут снова открыт — при `INGRESS=1` сразу решить: повторить правку или выключить ingress. |
| Ключ WAHA скомпрометирован | ротация: D3 (новый ключ/хэш) → D4–D5 → фаза F `provision` (`rotated`). |
| Pairing не удался | `waha POST …/stop`, не `logout`; повтор в другое окно. `FAILED` → `waha POST …/restart`. |
| WAHA с `RestartCount>0` перед release | release откажется; `compose up --force-recreate waha` (D4) даёт `restarts=0`, сессия сохраняется в томе. |

## Чего НЕ делать

- Не вызывать `logout`, не запрашивать QR и не сбрасывать сессию без отдельного разрешения владельца в чате.
- Не передавать ключ WAHA через `docker exec -e` и argv; не печатать сырой ответ WAHA (в нём HMAC и номер): только хелперы с фильтром.
- Не включать автоответы, рассылки, Gemini-подсказки/ассистента, любые исходящие по расписанию. Черновики ИИ выключены; замечание ревью #1141: RLS черновиков ИИ открывает их любому сотруднику, которому открыт диалог продаж, — решить до включения ИИ.
- Не импортировать историю чатов в рамках go-live: это отдельный шаг (миграция 260 и загрузчик #1139 уже в `main`, порядок — `docs/runbooks/whatsapp-history-import.md`; по решению владельца пилот на нескольких чатах, затем все чаты, включая только из исходящих). Не выполнялся: нужна привязка (H) и приёмка (I). История, которую GOWS получает при pairing, остаётся в хранилище WAHA, в CRM не попадает **[live ✗]**.
- Не публиковать порт WAHA, панель или Swagger; не переводить WAHA и lead-agent из приватной сети.
- Не включать `INGRESS=1` до C5 (публичный `/api/v2/whatsapp/inbound` должен отвечать 404); не пересоздавать и не перезапускать `evo-edge-caddy` ради C5 — только `caddy reload`; не печатать адаптированный JSON Caddy.
- Не включать `EVO_PLATFORM_WAHA_INGRESS_ENABLED=1` без HMAC-секрета, intake-владельца и проверки G1.
- Не править `.env.production` и env контейнеров мимо release; не менять compose (`compose_drift`).
- Не трогать Arcadis/acadis и чужие сессии: `china_curator` не стартовать и не останавливать без решения владельца.
- Не записывать в репозиторий, PR, чат и логи: ключ WAHA, HMAC, пароли и ключи из `.env.waha`, номера, JID, тексты сообщений, реальные UUID. Pairing-код (фаза H, п. 2) показывается один раз владельцу на экране оператора и дальше не копируется.
- Не запускать `docker logs`/`docker compose logs` WAHA без `waha_logs_safe` (старт печатает ключ и пароли открытым текстом); не оставлять `WAHA_PRINT_QR` не равным `false`.
- Не оставлять в `.env.waha` `WHATSAPP_HOOK_*`, `WHATSAPP_API_KEY`, `WHATSAPP_START_SESSION`, `WHATSAPP_RESTART_ALL_SESSIONS` (D3 останавливается на них).

## Скрипт Vault-binding

`scripts/waha-runtime-binding.mjs` (в образе: `/app/scripts/waha-runtime-binding.mjs`,
владелец `nextjs`, права `0555`; только `node:`-встроенные модули). Режимы:
`check` (чтение), `check --verify-key`, `provision [--dry-run]`;
`--check`/`--provision` — синонимы; `--session crm_primary` и
`--base-url http://evo-crm-waha:3000` принимаются только с этими значениями.
Любой иной токен в argv — ошибка `usage` без эха.

Проверено: 30 юнит-тестов на мок-Supabase и мок-WAHA (`npm run test:waha-runtime-binding`);
реальная цепочка локально (`npm run test:waha-runtime-binding:postgres`: одноразовый
Supabase Postgres со всеми миграциями 001–258 (на 2026-10-05; 259–261 в этом прогоне не участвовали), настоящий PostgREST и Vault, реальный
CLI по HTTP — создание, dry-run, идемпотентность, ротация, ремонт, отказ при чужом JWT и
неизвестной организации; чтение тем же `resolve_manual_send_waha_runtime`, что у
приложения); запуск в закреплённом образе `node:22-bookworm-slim` (read-only rootfs,
пользователь 1001, без сети). Не проверялось: образ целиком (`docker build`),
настоящий Supabase production и настоящий WAHA.

## Источники

- WAHA: [sessions](https://waha.devlike.pro/docs/how-to/sessions/) ·
  [security](https://waha.devlike.pro/docs/how-to/security/) ·
  [config](https://waha.devlike.pro/docs/how-to/config/) ·
  [engines / images](https://waha.devlike.pro/docs/how-to/engines/) ·
  [GOWS](https://waha.devlike.pro/docs/engines/gows/) ·
  [events, webhooks, HMAC, retries](https://waha.devlike.pro/docs/how-to/events/) ·
  [dashboard](https://waha.devlike.pro/docs/how-to/dashboard/) ·
  [passkey](https://waha.devlike.pro/blog/waha-passkey/) ·
  [release 2026.9.2](https://github.com/devlikeapro/waha/releases/tag/2026.9.2) ·
  [tags](https://hub.docker.com/r/devlikeapro/waha/tags).
- Supabase Vault: https://supabase.com/docs/guides/database/vault ·
  Docker Compose `up`: https://docs.docker.com/reference/cli/docker/compose/up/ .
- Репозиторий: `deploy/fast-app-release.md`, `scripts/evo-fast-release.sh`,
  `scripts/evo-app-env-contract.mjs`, `docker-compose.prod.yml`,
  `deploy/env.waha.example`, миграции 080, 081, 082, 102.
