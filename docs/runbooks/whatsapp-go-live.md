# WhatsApp go-live: прямой приём WAHA → CRM (`crm_primary`)

Обновлено: 2026-10-05. Статус: **процедура, не выполнялась.** Документ ничего не
разрешает: каждый шаг, меняющий production (VPS, GitHub-переменные, schema,
release, WAHA), выполняется только после явного «давай» владельца в чате и
только в его границах. Решение 03.10 «окей отмена, пока подождем потом сделаем»
действует, пока владелец не заменит его новым.

Код приёма — draft PR [#1137](https://github.com/izzhackt/evo_AI_CRM/pull/1137)
(не менять отсюда). Код записи ключа WAHA в Vault — этот PR:
`scripts/waha-runtime-binding.mjs` (см. [§ Скрипт](#скрипт-vault-binding)).

Метки доказательств: **[doc]** — документация WAHA (URL рядом);
**[src]** — исходники WAHA на теге 2026.9.2 (и 2026.7.1), прочитаны 2026-10-05,
не запускались; **[repo]** — этот репозиторий, `origin/main` `01247bc8b`, либо
#1137 на head `9f19a85a9`; **[live ✗]** — не проверялось на реальных WAHA и
WhatsApp; **[??]** — не проверено нигде. Всё, что отмечено только [live ✗] или
[??], на go-live проверяется глазами, а не принимается на веру.

## Схема и имена

```
телефон отдела продаж ── WhatsApp ── WAHA (GOWS, сессия crm_primary)
                                        │ webhook, HMAC sha512, message.any + session.status
                                        ▼
                         http://evo-crm-app:3000/api/v2/whatsapp/inbound   (приватная сеть evo_crm_private)
CRM (ручной ответ, проба статуса) ──► http://evo-crm-waha:3000   ключ WAHA берётся из Supabase Vault
```

| Что | Значение | Основание |
|---|---|---|
| Контейнеры | compose-проект `evo-crm`: `evo-crm-app-1` (alias `evo-crm-app:3000`), WAHA (service `waha`, alias `evo-crm-waha:3000`, портов на хосте нет) | [repo] `docker-compose.prod.yml` |
| Сессия | только `crm_primary` (иное запрещено CHECK-ами и триггерами БД) | [repo] миграция 102 |
| Ключ WAHA для CRM | Vault-binding: RPC `platform.provision_manual_send_waha_runtime(p_organization_id uuid, p_waha_api_key text, p_request_id uuid)` и `platform.manual_send_waha_runtime_configuration(p_organization_id uuid)`; сейчас в production 0 bindings | [repo] миграции 080/081/102; сигнатуры сверены на схеме 001–258 |
| Подпись webhook | HMAC-SHA512 по сырому телу; заголовки `X-Webhook-Hmac`, `X-Webhook-Hmac-Algorithm: sha512`; секрет 32–128 байт | [doc] https://waha.devlike.pro/docs/how-to/events/ ; [repo] `platform-waha-webhook.ts` (`MAX_WEBHOOK_SECRET_BYTES=128`), env-контракт (≥ 32) |
| Env приложения (#1137) | `EVO_PLATFORM_WAHA_INGRESS_ENABLED` (маршрут отвечает 503, пока не ровно `1`), `EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET`, `EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID` | [repo] #1137 |
| Файл env WAHA | `/opt/evo-crm/.env.waha` (рядом `.env.production`) | [repo] `deploy/README.md` |

## Порядок фаз и почему так

| Фаза | Что | Ключевое |
|---|---|---|
| 1 | Условия | «давай», проверка телефона владельцем, окно, свободный release |
| A | Разведка read-only | ничего не меняет |
| B | Шаг 0: пустая строка в `.env.production` | **до** merge #1137, иначе release падает на env-контракте |
| C | merge, ledger 259, release №1 (ingress 0) | кладёт в образ #1137 и скрипт; WhatsApp ещё не подключён |
| D | Пересоздание WAHA: GOWS 2026.9.2 | новый ключ, медиа выключены, ничего не стартует само |
| E | Сессия `crm_primary` (STOPPED) + webhook + ignore | **до** pairing |
| F | Vault-binding через скрипт | ручные ответы и проба статуса |
| G | release №2: ingress=1 + HMAC + intake-владелец | **до** pairing (см. ниже) |
| H | Pairing кодом по номеру (ветка passkey) | |
| I | Приёмка | сообщение владельца → ответ из CRM |

**Отступление от черновика чек-листа.** Release с `INGRESS=1` стоит *до*
pairing, а не после. Причина: WAHA повторяет webhook по умолчанию 15 раз с
задержкой 2 с и считает ошибкой любой не-2xx ответ [src]
`src/modules/waha-webhook/WebhookPlugin.sender.ts` (`DEFAULT_RETRY_ATTEMPTS=15`,
`retryCondition: () => true`), то есть ~30 с. Пока маршрут отвечает 503
(ingress 0), входящие и `session.status` за время release пропали бы. Без
привязанного номера принимать нечего, поэтому включить приём заранее безопасно.

---

## 1. Условия (все обязательны)

1. Явное «давай» владельца на этот go-live в чате. Для фаз D–I владелец рядом:
   pairing идёт в реальном времени.
2. #1137 переоснован на текущий `main`, на его точном head есть независимый
   review и исправления по реальным формам GOWS (см. § Допущения #1137).
   Этот PR уже влит в `main` **до release №1**: скрипт входит в образ.
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
   репозитория. Секреты (ключ WAHA, HMAC, коды pairing) не печатать, не
   вставлять в чат/тикеты/PR, не писать в файлы репозитория; в ssh-сессии
   `set +o history; umask 077`, без `set -x`.

Вспомогательные функции (вставить в ssh-сессию один раз; секреты не попадают
в argv, заголовок ключа лежит на tmpfs с правами 0600 и удаляется):

```bash
R=/opt/evo-crm; APP=evo-crm-app-1
waha_cid() { docker ps -q --filter label=com.docker.compose.project=evo-crm --filter label=com.docker.compose.service=waha; }
set_env_value() {  # NEWVAL=… set_env_value FILE NAME — строка NAME= должна быть ровно одна
  local f=$1 n=$2 tmp; tmp=$(mktemp) || return 1
  NAME="$n" awk 'BEGIN{FS=OFS="="} $1==ENVIRON["NAME"]{hit++; print ENVIRON["NAME"] "=" ENVIRON["NEWVAL"]; next} {print} END{if(hit!=1)exit 3}' "$f" > "$tmp" \
    && cat "$tmp" > "$f"; local rc=$?; rm -f "$tmp"; return $rc
}
waha_open() {      # нужны WAHA_KEY и WAHA_BASE
  local old; old=$(umask); umask 077
  WAHA_HDR=$(mktemp /dev/shm/wahahdr.XXXXXX 2>/dev/null || mktemp) || { umask "$old"; return 1; }
  umask "$old"; printf 'X-Api-Key: %s\n' "$WAHA_KEY" > "$WAHA_HDR"
}
waha_close() { [ -z "${WAHA_HDR:-}" ] || rm -f -- "$WAHA_HDR"; unset WAHA_HDR; }
waha()      { curl -sS -m 30 -X "$1" -H @"$WAHA_HDR" -H 'Accept: application/json' -w '\n[http %{http_code}]\n' "$WAHA_BASE$2"; }
waha_json() { curl -sS -m 30 -X "$1" -H @"$WAHA_HDR" -H 'Accept: application/json' -H 'Content-Type: application/json' --data-binary @- -w '\n[http %{http_code}]\n' "$WAHA_BASE$2"; }
```

(`set_env_value`, `waha_open/waha`/`waha_json` проверены локально против
синтетического сервера: ключ не попадает в argv, тело идёт через stdin, файл
заголовка удаляется; на WAHA не запускались.)

---

## A. Разведка read-only

```bash
WAHA_C=$(waha_cid); [ "$(printf '%s' "$WAHA_C" | wc -w)" = 1 ] || echo "СТОП: ожидался один контейнер waha"
docker inspect -f '{{.Name}} image={{.Config.Image}} health={{.State.Health.Status}} restarts={{.RestartCount}} mem={{.HostConfig.Memory}} ports={{json .HostConfig.PortBindings}}' "$WAHA_C" "$APP"
gh variable get EVO_WAHA_IMAGE_DIGEST --repo izzhackt/evo_AI_CRM        # должен совпасть с digest в image=…@sha256:…
free -k | awk '/^Mem:/{print "available_kb="$7}'; df -k /var/lib/docker | tail -1
VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/.sessions"}}{{.Name}}{{end}}{{end}}' "$WAHA_C")
docker run --rm --pull never --entrypoint sh -v "$VOL":/s:ro "$(docker inspect -f '{{.Image}}' "$WAHA_C")" -c 'ls -la /s; du -sk /s/* 2>/dev/null'
```

Ожидаемо: WAHA и app `healthy`, `restarts=0`, `ports=null` или `{}`;
`mem=2147483648` (compose уже задаёт `mem_limit: 2048m`, `cpus 2.00`, `pids 512`
[repo]). Содержимое каталогов сессий **не читать**, только имена и размеры.
Любое отклонение (нездоров, restarts>0, digest ≠ переменной) — стоп.

## B. Шаг 0 — пустая строка в `.env.production` (до merge)

Release-контроллер сверяет **каждое** имя из `deploy/env.production.example`
c файлом на сервере; в #1137 добавлено имя
`EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID`. Его отсутствие даёт отказ
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

Проверка контрактом #1137 без сети (публичные файлы с вашей машины, на exact head PR):

```bash
# локально:
git show <HEAD_SHA_1137>:scripts/evo-app-env-contract.mjs | ssh hermes-vps 'install -d -m 700 /root/evo-golive && cat > /root/evo-golive/evo-app-env-contract.mjs'
git show <HEAD_SHA_1137>:deploy/env.production.example   | ssh hermes-vps 'cat > /root/evo-golive/env.production.example'
REF=$(gh variable get EVO_SUPABASE_PROJECT_REF --repo izzhackt/evo_AI_CRM)
# на VPS (без --verify-supabase-keys: сеть и ключи не трогаются):
node /root/evo-golive/evo-app-env-contract.mjs --example /root/evo-golive/env.production.example --env /opt/evo-crm/.env.production --supabase-project-ref "$REF"
```

Ожидается `ok: true`, код выхода 0. Правка `.env.production` вступает в силу
только через release (контроллер запечатывает snapshot). Env запущенного
контейнера и snapshot-файлы не править: контроллер сверяет revision и image id
рантайма со snapshot (`runtime_environment_identity_drift`).

## C. merge #1137, ledger 259, release №1 (ingress 0)

1. Убедиться: #1137 на актуальном `main`, CI зелёный, этот PR влит.
   Merge (с разрешения владельца, не во время чужого release).
2. Миграция 259 **до** release (release-ворота требуют ledger 001–259):
   ```bash
   gh workflow run evo-schema-ledger.yml --repo izzhackt/evo_AI_CRM -f mode=check   # читает ledger; ждём хвост 259
   # прочитать результат; только после этого:
   gh workflow run evo-schema-ledger.yml --repo izzhackt/evo_AI_CRM -f mode=apply   # затем снова mode=check: 001–259 без дыр
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

## D. Пересоздание WAHA: GOWS, образ 2026.9.2

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
sha256sum "/root/evo-backups/waha-sessions-$TS.tgz"; ls -l "/root/evo-backups/waha-sessions-$TS.tgz"
```
(`tar` в образе WAHA — Debian-база **[??]**; если нет — `docker run … busybox tar`.)
Снимок содержит токены входа: права 0600, каталог 0700, не копировать с сервера.

**D3. Новый ключ API и `.env.waha`.** Plain-ключ существует только в памяти
этой shell-сессии (и потом в Vault); на диск не писать. WAHA хранит только
хэш: `WAHA_API_KEY=sha512:{SHA512_HEX_HASH}`, клиент шлёт plain в `X-Api-Key`
— [doc] https://waha.devlike.pro/docs/how-to/security/#api-security .
```bash
KEY=$(openssl rand -hex 32)
HASH=$(printf '%s' "$KEY" | sha512sum | awk '{print $1}')
f=$R/.env.waha; NEWVAL="sha512:$HASH" set_env_value "$f" WAHA_API_KEY
for kv in WHATSAPP_DEFAULT_ENGINE=GOWS \
          WAHA_API_DOWNLOAD_MEDIA=false WAHA_EVENTS_DOWNLOAD_MEDIA=false WHATSAPP_DOWNLOAD_MEDIA=false \
          WAHA_WORKER_RESTART_SESSIONS=false; do
  n=${kv%%=*}; v=${kv#*=}
  if grep -q "^$n=" "$f"; then NEWVAL=$v set_env_value "$f" "$n"; else printf '%s=%s\n' "$n" "$v" >> "$f"; fi
done
sed -E 's/=.*/=<…>/' "$f"        # проверить набор имён, значения маскированы
```
Что и почему:

- `WHATSAPP_DEFAULT_ENGINE=GOWS` — [doc] https://waha.devlike.pro/docs/engines/gows/ ;
  движок общий для контейнера [src].
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
  `assignedWorker`, иначе она тоже поднимется).
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

**D5. Проверка** (все пункты, пока не выполнены — переменную GitHub не менять):
```bash
WAHA_C=$(waha_cid); until [ "$(docker inspect -f '{{.State.Health.Status}}' "$WAHA_C")" = healthy ]; do sleep 5; done
docker inspect -f 'image={{.Config.Image}} restarts={{.RestartCount}} mem={{.HostConfig.Memory}} ports={{json .HostConfig.PortBindings}}' "$WAHA_C"
docker exec "$WAHA_C" printenv WHATSAPP_DEFAULT_ENGINE
docker inspect -f '{{json .NetworkSettings.Networks}}' "$WAHA_C" | grep -o '"evo_[a-z_]*"' | sort -u    # только evo_crm_private
```
Нужно: `image=devlikeapro/waha@$NEW`, `restarts=0`, `mem=2147483648`, портов нет,
движок `GOWS`, одна приватная сеть. Затем доступ с ключом и список сессий:
```bash
WAHA_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "evo_crm_private").IPAddress}}' "$WAHA_C")
WAHA_KEY=$KEY; WAHA_BASE=http://$WAHA_IP:3000; waha_open     # не export: переменные нужны только функциям этой shell
waha GET '/api/sessions?all=true' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s.split("\n[http")[0]);for(const x of a)console.log(x.name,x.status,"assigned="+JSON.stringify(x.assignedWorker))})'
```
Все сессии должны быть `STOPPED` (ничего не стартовало само). Лог на сообщения
об ошибках старта: `docker logs --since 10m "$WAHA_C" 2>&1 | grep -iE 'error|fail' | cut -c1-160 | head` (в
лог могут попасть номера — не копировать).

**D6. Digest в GitHub в ногу.** Release-контроллер сверяет `.Config.Image` WAHA
с `repository@${EVO_WAHA_IMAGE_DIGEST}`; расхождение — `runtime_waha_image_drift`,
а `RestartCount>0` — `runtime_service_unhealthy` [repo] `evo-fast-release.sh`.
Только теперь, до любого следующего release:
```bash
gh variable set EVO_WAHA_IMAGE_DIGEST --repo izzhackt/evo_AI_CRM --body "$NEW"
gh variable get EVO_WAHA_IMAGE_DIGEST --repo izzhackt/evo_AI_CRM        # = $NEW
```
Если D5 не прошёл — откат WAHA (§ Откат) **до** любых действий с переменной.

## E. Сессия `crm_primary`: ignore и webhook — до pairing

Три вещи должны быть заданы в конфигурации ещё до pairing: `config.ignore`
(иначе группы/статусы/каналы попадают в хранилище и в webhook), webhook и HMAC.
Источники: [doc] https://waha.devlike.pro/docs/how-to/sessions/#ignore (поля
`status`, `groups`, `channels`, `broadcast`; «хранилище не сохраняет сообщения»
для GOWS/NOWEB; отправка не ограничивается), https://waha.devlike.pro/docs/how-to/events/#hmac-authentication ,
https://waha.devlike.pro/docs/how-to/events/#retries .

```bash
HMAC=$(openssl rand -hex 32)       # 64 hex-символа; только в памяти shell и затем в .env.production (фаза G)
waha GET /api/sessions/crm_primary | tail -1       # [http 200] — сессия уже есть → PUT; [http 404] — POST
BODY_CONFIG=$(HMAC=$HMAC jq -n '{ignore:{status:true,groups:true,channels:true,broadcast:true},
  webhooks:[{url:"http://evo-crm-app:3000/api/v2/whatsapp/inbound",events:["message.any","session.status"],
             hmac:{key:env.HMAC},retries:{policy:"exponential",delaySeconds:2,attempts:10}}]}')
# 404 → создать СТОПНУТОЙ (start:false):
printf '%s' "$BODY_CONFIG" | jq '{name:"crm_primary",start:false,config:.}' | waha_json POST /api/sessions
# 200 → заменить конфигурацию (остановленная сессия остаётся остановленной) [src] SessionService.updateSession:
printf '%s' "$BODY_CONFIG" | jq '{config:.}' | waha_json PUT /api/sessions/crm_primary
```
`retries` — решение этой процедуры (экспоненциально, 10 попыток), не рекомендация
WAHA; в примере документации `constant/2/15`. Проверка без вывода секретов:
```bash
waha GET /api/sessions/crm_primary | sed '$d' | jq '{status, ignore:.config.ignore, events:.config.webhooks[0].events, url:.config.webhooks[0].url, has_hmac:(.config.webhooks[0].hmac.key!=null), device_name_unset:(.config.client.deviceName==null)}'
[ "$(waha GET /api/sessions/crm_primary | sed '$d' | jq -r '.config.webhooks[0].hmac.key' | sha256sum)" = "$(printf '%s\n' "$HMAC" | sha256sum)" ] && echo hmac_matches
```
Нужно: `status=STOPPED`, все четыре `ignore` = `true`, события ровно
`message.any`, `session.status`, `has_hmac=true`, `hmac_matches`. Подписка на
`message.ack` сознательно нет: CRM гасит ACK своих API-отправок только после
привязки id (#1137), точное сопоставление читается позже.

## F. Vault-binding (скрипт в контейнере app)

Скрипт читает ключ **только** из stdin (`--key-stdin`) или env
`EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY`, никогда из argv; ничего секретного не
печатает (JSON с булевыми значениями, enum и `binding_version`, без хэша ключа);
принимает только сессию `crm_primary` и URL `http://evo-crm-waha:3000`;
использует `NEXT_PUBLIC_SUPABASE_URL`, `EVO_PLATFORM_SUPABASE_SECRET_KEY`,
`EVO_PLATFORM_ORGANIZATION_ID` из окружения контейнера. Перед записью он
спрашивает WAHA (`GET /api/sessions/crm_primary`, чтение), принимает ли тот
ключ, и не пишет в Vault ключ, который WAHA отверг.

```bash
S="docker exec -i evo-crm-app-1 node scripts/waha-runtime-binding.mjs"
printf '%s' "$KEY" | $S provision --key-stdin --dry-run     # план: {"action":"would_create",…}; запись не выполняется
printf '%s' "$KEY" | $S provision --key-stdin               # {"action":"created","ready":true,"binding_version":1,…}
printf '%s' "$KEY" | $S check --verify-key --key-stdin      # ready:true, key_matches_stored_binding:true, waha_key_accepted:true
printf '%s' "$KEY" | $S provision --key-stdin               # повтор: {"action":"unchanged"} — идемпотентно
```
Коды выхода: 0 — ок, 1 — ошибка (на stderr одна строка
`{"ok":false,"error_code":"…"}`), 2 — неверные аргументы, 3 — `check` видит
binding не готовым. `waha_session_status` на этом этапе — `STOPPED`: это ожидаемо.
Ротация: новый ключ → новый хэш в `.env.waha` → recreate WAHA (фаза D4–D5) →
тот же `provision` (`action: rotated`, версия +1). Это единственный
поддерживаемый путь записи ключа; plain-ключ нигде больше не хранится.

## G. Release №2 — приём включён (до pairing)

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
(Запросы выполнены на пустой схеме 001–258, синтаксис и колонки верны; данные
production не читались.) Если `false` — **стоп**: без допустимого владельца
проекция отвечает ошибкой на каждое сообщение [repo] env-контракт #1137. Условия
взяты из миграции 082 и 077; не пересверялись с миграциями после 258 **[??]**.

**G2. Править `.env.production`** (резервная копия из фазы B уже есть; свежая — `cp -p` ещё раз):
```bash
read -rs INTAKE; echo          # вставить UUID из G1 (ввод не отображается)
f=$R/.env.production
NEWVAL=1       set_env_value "$f" EVO_PLATFORM_WAHA_INGRESS_ENABLED
NEWVAL=$HMAC   set_env_value "$f" EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET
NEWVAL=$INTAKE set_env_value "$f" EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID
awk -F= '$1=="EVO_PLATFORM_WAHA_INGRESS_ENABLED"{print $1"="$2} $1=="EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET"||$1=="EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID"{print $1" длина="length($2)}' "$f"
node /root/evo-golive/evo-app-env-contract.mjs --example <env.production.example на SHA main> --env "$f" --supabase-project-ref "$REF"   # ok:true
```
Контракт с `INGRESS=1` требует секрет ≥ 32 символов и UUID не нулевой.

**G3. Release №2** — как C3 (arm → CI на точный SHA `main` → дождаться → disarm).
Миграций нет, код прежний. Перед запуском: WAHA `healthy`, `restarts=0`
(иначе release остановится).

**G4. Проверка:** «Настройки → Интеграции» больше не пишет «приём выключен»;
статус сессии честно показывает остановленную (WAHA ещё не стартовала).

## H. Pairing кодом по номеру

Владелец у телефона. Номер набирается владельцем в терминал без вывода и без
записи в историю (`read -rs SALES_MSISDN`, только цифры в международном
формате); в репозиторий/чат не попадает. Источник: [doc]
https://waha.devlike.pro/docs/how-to/sessions/ (Get pairing code,
`POST /api/{session}/auth/request-code`, тело `{"phoneNumber":"…"}`).

1. Запустить сессию и дождаться `SCAN_QR_CODE`:
   ```bash
   waha POST /api/sessions/crm_primary/start | tail -1
   for i in $(seq 1 30); do st=$(waha GET /api/sessions/crm_primary | sed '$d' | jq -r .status); [ "$st" = SCAN_QR_CODE ] && break; sleep 2; done; echo "status=$st"
   waha GET /api/sessions/crm_primary | sed '$d' | jq '{status, engine:.engine.engine}'     # engine = "GOWS"
   ```
2. Запросить код и показать его **только владельцу на экране оператора**
   (одноразовый, живёт ограниченное время, срок в документации не указан **[??]**; не писать в лог/чат):
   ```bash
   printf '{"phoneNumber":"%s"}' "$SALES_MSISDN" | waha_json POST /api/crm_primary/auth/request-code | sed '$d' | jq -r .code
   ```
3. Владелец вводит код в WhatsApp: «Связанные устройства → Привязать
   устройство → по номеру телефона» (**[??]** названия пунктов — по актуальной
   справке WhatsApp). Ожидаемый ход статусов: `SCAN_QR_CODE` → … → `WORKING`
   [doc sessions, Session Status].
4. Проверить без вывода персональных данных:
   ```bash
   waha GET /api/sessions/crm_primary | sed '$d' | jq '{status, engine:.engine.engine}'     # WORKING / GOWS
   waha GET /api/sessions/crm_primary/me | sed '$d' | jq 'has("id")'                        # true (сам номер не печатать)
   ```
   Первая попытка кода не удалась — нормальный случай, [doc]: «код работает не
   всегда», резервный путь — QR (`GET /api/crm_primary/auth/qr`), который
   владелец сканирует; для QR на экране оператора нужен приватный канал
   (ssh-туннель) — **[live ✗]**.

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
(`POST /api/sessions/crm_primary/stop`), не `logout`, и вернуться к паре позже.
Эта ветка **[live ✗]** целиком.

Если сессия ушла в `FAILED`: `POST /api/sessions/crm_primary/restart`, затем
заново пп. 1–3. `logout` — только с отдельного разрешения владельца: он
удаляет устройство из «Связанных устройств» [doc sessions, Logout].

## I. Приёмка

Критерии — реальные сообщения реальных людей; зелёный `/api/health` не доказывает приём.

1. **Статус.** «Настройки → Интеграции» — «подключён» (проба
   `GET /api/sessions/crm_primary` ключом из Vault даёт `WORKING` [repo] #1137).
2. **Входящее.** Владелец пишет с личного номера на номер отдела продаж:
   «тест-1». В течение минуты сообщение видно в разделе WhatsApp CRM, создан
   клиент и лид (триггер на подтверждённом входящем) **[live ✗]**.
3. **Ответ из CRM.** Сотрудник с правом отправки (admin или admissions) отвечает
   из CRM «тест-ответ-1»; сообщение приходит владельцу. Галочки доставки в CRM
   не ждать: `message.ack` не подписан.
4. **Нет дублей.** Агрегатные запросы (только счётчики, без текстов) в SQL Editor:
   ```sql
   SELECT event_type, verification_status, count(*) AS events
   FROM platform_private.provider_webhook_events
   WHERE provider = 'waha' AND waha_session_name = 'crm_primary' AND received_at > now() - interval '1 hour'
   GROUP BY 1, 2 ORDER BY 1, 2;      -- ожидаются только verified; rejected/stale/missing — разобраться до продолжения
   SELECT m.direction, m.message_identity_source, count(*) AS messages, count(*) - count(DISTINCT m.id) AS duplicate_ids
   FROM platform.communication_messages AS m
   WHERE m.waha_session_name = 'crm_primary' AND m.created_at > now() - interval '1 hour'
   GROUP BY 1, 2 ORDER BY 1, 2;      -- 1 входящее и 1 исходящее на каждое сообщение теста
   SELECT waha_session_name, raw_message_id, count(*) AS bindings
   FROM platform_private.waha_message_bindings
   WHERE waha_session_name = 'crm_primary' GROUP BY 1, 2 HAVING count(*) > 1;   -- 0 строк
   ```
   Исходящее из CRM не должно появиться второй раз как «отправлено с телефона»:
   эхо `source: api` проекцией игнорируется [repo] #1137.
5. **Отправка с самого телефона.** Владелец пишет клиенту (или тому же
   собеседнику) с телефона продаж: сообщение появляется в CRM как исходящее.
   Здесь больше всего риска: в GOWS `from` — это чат в обе стороны, а `to` для
   личных чатов `null` [src] `session.gows.core.ts` (`from: info.Chat, to: info.IsGroup ? info.Sender : null`).
   Если не появилось — это дефект разбора #1137, не повод выключать приём.
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

Из описания PR (head `9f19a85a9`) — названия полей и списки зависят от движка
и не проверены на живом потоке GOWS: телефон-альтернатива LID
(`_data.Info.SenderAlt` / `RecipientAlt`, NOWEB `_data.key.remoteJidAlt`);
имя профиля (`_data.Info.PushName`, `_data.notifyName`, `_data.pushName`); какие
`_data.type` — служебные уведомления (список взят из WEBJS); разбор исходящего
с телефона (`fromMe`, `source: app`) при `to = null`; лимит тела 64 KiB.
Исправления по этим пунктам ведутся отдельно в #1137.

## Откат и остановка

| Ситуация | Действие |
|---|---|
| Срочно остановить приём, не теряя привязку | `waha POST /api/sessions/crm_primary/stop` (сессия остаётся привязанной; снимает «назначение» воркера [src]). **Не** `logout`. Позже — `…/start`. |
| Выключить приём в CRM | release с `EVO_PLATFORM_WAHA_INGRESS_ENABLED=0` (правка `.env.production` → arm → CI → disarm, как C3). Маршрут снова отвечает 503; события WAHA при этом повторяются ограниченное число раз и могут пропасть — сначала остановить сессию. |
| Откат WAHA на прежний образ | старый digest `sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c` ([repo] `docs/platform/p8d4-current-main-staff-pilot.md`) + прежний движок WEBJS: восстановить `.env.waha` из `/root/evo-config-backups/…`, **оставив новую строку `WAHA_API_KEY=sha512:…`** (иначе ключ в Vault перестанет подходить), убрать `WHATSAPP_DEFAULT_ENGINE=GOWS`, `compose up --force-recreate waha` как D4 со старым digest, вернуть `EVO_WAHA_IMAGE_DIGEST`. Том не откатывать, если он цел; снимок — на случай порчи. **Привязка не восстанавливается:** вход GOWS и вход WEBJS независимы, считать, что нужен новый pairing **[live ✗]**. |
| Ключ WAHA скомпрометирован | ротация: D3 (новый ключ/хэш) → D4–D5 → фаза F `provision` (`rotated`). |
| Pairing не удался | `stop`, не `logout`; повтор в другое окно. `FAILED` → `restart`. |
| WAHA с `RestartCount>0` перед release | release откажется; `compose up --force-recreate waha` (D4) даёт `restarts=0`, сессия сохраняется в томе. |

## Чего НЕ делать

- Не вызывать `logout`, не сбрасывать QR/сессию без отдельного разрешения владельца.
- Не включать автоответы, рассылки, Gemini-подсказки/ассистента, любые исходящие по расписанию.
- Не импортировать историю чатов: это отдельный будущий шаг (миграция и импортёр, owner-решение). История, которую GOWS получает при pairing, остаётся в хранилище WAHA, в CRM не попадает **[live ✗]**.
- Не публиковать порт WAHA, панель или Swagger; не переводить WAHA и lead-agent из приватной сети.
- Не включать `EVO_PLATFORM_WAHA_INGRESS_ENABLED=1` без HMAC-секрета, intake-владельца и проверки G1.
- Не править `.env.production` и env контейнеров мимо release; не менять compose (`compose_drift`).
- Не трогать Arcadis/acadis и чужие сессии: `china_curator` не стартовать и не останавливать без решения владельца.
- Не записывать в репозиторий, PR, чат и логи: ключ WAHA, HMAC, коды pairing, номера, JID, тексты сообщений, реальные UUID.

## Скрипт Vault-binding

`scripts/waha-runtime-binding.mjs` (в образе: `/app/scripts/waha-runtime-binding.mjs`,
владелец `nextjs`, права `0555`; только `node:`-встроенные модули). Режимы:
`check` (чтение), `check --verify-key`, `provision [--dry-run]`;
`--check`/`--provision` — синонимы; `--session crm_primary` и
`--base-url http://evo-crm-waha:3000` принимаются только с этими значениями.
Любой иной токен в argv — ошибка `usage` без эха.

Проверено: 30 юнит-тестов на мок-Supabase и мок-WAHA (`npm run test:waha-runtime-binding`);
реальная цепочка локально (`npm run test:waha-runtime-binding:postgres`: одноразовый
Supabase Postgres со всеми миграциями 001–258, настоящий PostgREST и Vault, реальный
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
