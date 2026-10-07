# Включение «ИИ-агента» на hermes (P1)

Контракт: [план «ИИ-агент»](../EVO_AI_AGENT_PLAN_2026-10-06.md) §4.2, §4.6–§4.8,
[ADR 0032](../adr/0032-run-the-ai-agent-as-a-private-evo-service.md). Этот документ
описывает шаги; он сам ничего не разрешает. Каждое действие на production — пароль
роли, файл секретов, переменные GitHub, выпуск — делается по отдельному разрешению
владельца на это действие.

## Что уже есть в коде

- `docker-compose.prod.yml`: службы `ai-agent-api` (alias `evo-ai-agent`, порт 8080,
  0,5 CPU, 512 MiB) и `ai-agent-worker` (1 CPU, 1,5 GiB, 256 процессов) под профилем
  `ai-agent`. Обе только в своей сети `evo_crm_ai` (bridge проекта `evo-crm`, с
  выходом в интернет к Gemini и Supabase), без опубликованных портов и томов,
  `read_only`, uid 10001, все capabilities сброшены, `no-new-privileges`,
  `stop_grace_period: 30s`. В `evo_crm_private`, где WAHA и ClamAV, агента нет
  (lead-agent в production сейчас не развёрнут). Пока агент включён, controller добавляет в `evo_crm_ai` и приложение
  (alias `evo-crm-app`); выпуск без агента эту сеть не создаёт и приложение в неё
  не включает. Образ — только `ghcr.io/izzhackt/evo-ai-agent@<digest>`. Секреты — из
  `/opt/evo-crm/.env.ai-agent` в формате `raw`: значение берётся буквально, `$`,
  кавычки и `#` ничего не подставляют; список имён — `deploy/env.ai-agent.example`.
- **Docker Compose не ниже 2.30 — для каждого выпуска.** Длинная форма `env_file`
  с `format: raw` появилась в Compose 2.30.0, а Compose проверяет весь файл, включая
  службы выключенного профиля; более старый Compose отклонил бы и выпуск без агента.
  `preflight` и `deploy` controller до блокировки и любых изменений читают
  `docker compose version --short` и останавливаются с `compose_version_unsupported`
  (ниже 2.30) или `compose_version_unreadable` (команда не сработала или вывод не
  `X.Y.Z`). Откат эту проверку не проходит, чтобы его ничто не блокировало. На hermes
  06.10.2026 ведущий агент прочитал Docker Compose v5.1.2 — требование выполнено;
  после обновления Docker на hermes перечитать.
- Release controller и workflow включают агента в выпуск, только если переменная
  GitHub `EVO_AI_AGENT_ENABLED` равна ровно `true`. Пустая или `false` — выпуск
  такой же, как до агента: тот же compose-рендер (app, clamav, waha), те же вызовы
  Docker, тот же формат `state.json`. Любое другое значение останавливает выпуск.
- При `true` controller до любого изменения проверяет digest
  (`^sha256:[0-9a-f]{64}$`), файл `.env.ai-agent` (обычный файл, режим 0600, каждая
  строка — `ИМЯ=значение` без `export`, без кавычек и без пробелов по краям значения;
  непустые `EVO_AI_AGENT_GEMINI_API_KEY`, `EVO_AI_AGENT_DATABASE_URL`,
  `EVO_AI_AGENT_INTERNAL_SECRET`; значения не печатаются и никуда не копируются),
  сеть по compose (агент только в `evo_crm_ai`, в ней только агент и приложение),
  ещё 2 GiB доступной памяти, пока агент не запущен (всего 6 GiB), и сам образ:
  скачивает его по digest,
  сверяет linux/amd64, `org.opencontainers.image.source` и revision. Потом после
  приложения поднимает обе службы, ждёт `healthy` и проверяет изнутри контейнера
  `GET /v1/ready` (БД под ролью `evo_ai_agent` и очередь; без Gemini).
- Digest записывается в `state.json` выпуска (`aiAgent.image`, а также прежний
  образ агента или его отсутствие) и в запись приёмки. Следующий выпуск сверяет
  работающего агента с принятой записью: ручная подмена — `runtime_ai_agent_image_drift`.

## Шаги владельца (один раз)

1. **Токен GHCR только на чтение.** Токен с одним правом `read:packages` на пакет
   `izzhackt/evo-ai-agent`. На hermes под root: `docker login ghcr.io -u izzhackt
   --password-stdin` (значение — со стандартного ввода, не в аргументах и не в
   истории). Копия — в SOPS-архиве «Секреты и доступы ЭВО».
2. **Роль БД.** После того как миграции агента (#1158) приняты в журнал production
   обычным порядком, в SQL editor: `ALTER ROLE evo_ai_agent WITH LOGIN PASSWORD
   '<новый пароль>' CONNECTION LIMIT 10;`. Пароль — только в `.env.ai-agent` и SOPS.
   Пароль только из hex-символов (`openssl rand -hex 32`): он стоит внутри
   `EVO_AI_AGENT_DATABASE_URL`, и `@`, `:`, `/`, `%`, `$` или кавычки ломают адрес.
3. **Файл секретов.** `install -m 600 -o root -g root /dev/null /opt/evo-crm/.env.ai-agent`,
   затем заполнить по `deploy/env.ai-agent.example`: ключ Gemini проекта EVO,
   `EVO_AI_AGENT_DATABASE_URL` (Supavisor, transaction mode, пользователь
   `evo_ai_agent.<project_ref>`), `EVO_AI_AGENT_INTERNAL_SECRET`
   (`openssl rand -hex 32`). Тот же `EVO_AI_AGENT_INTERNAL_SECRET` попадает в
   `.env.production`, когда в выпуске появятся маршруты CRM `/api/v3/ai-agent/*`.
   Формат строго `ИМЯ=значение`, по одной строке: без `export`, без кавычек вокруг
   значения и без пробелов по его краям. Compose читает файл буквально (`raw`), так
   что кавычки стали бы частью секрета; controller такой файл отклоняет
   (`ai_agent_env_format_invalid`), не показывая значений.
4. **Согласие на передачу текстов в Gemini** записывает admin в разделе «ИИ-агент»
   (RPC `platform.ai_agent_consent_record_v1`). Без него агент запускается, но
   ответов не даёт.

## Шаги оператора

1. Проверить готовность только чтением: журнал миграций production включает
   миграции агента; в `main` есть этот compose и controller; образ агента собран
   CI приватного репозитория на `main`, digest взят из сводки job `publish`.
2. На hermes (загрузка образа; работающие службы не меняются):
   `docker pull ghcr.io/izzhackt/evo-ai-agent@<digest>`, затем
   `docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels
   "org.opencontainers.image.revision"}}' ghcr.io/izzhackt/evo-ai-agent@<digest>` —
   `linux/amd64` и коммит `main` приватного репозитория.
3. Переменные (по разрешению владельца):
   `gh variable set EVO_AI_AGENT_IMAGE_DIGEST --repo izzhackt/evo_AI_CRM --body '<digest>'`,
   затем `gh variable set EVO_AI_AGENT_ENABLED --repo izzhackt/evo_AI_CRM --body true`.
4. Обычный выпуск: ручной запуск «EVO platform CI» на точном `main`. Агент
   поднимается после приложения; любой отказ — откат всего выпуска.
5. После выпуска (чтение): `EVO_RELEASE_PROJECT_NAME=evo-crm EVO_AI_AGENT_ENABLED=true
   /opt/evo-crm/release-evidence/<release-id>/controller/evo-fast-release.sh status`
   показывает `"aiAgent":"healthy"`. В фазе приёмки P1 отдельно: `/v1/status`
   из CRM (ключ принят, согласие записано) и один настоящий ответ на диалог
   QA-владельца через edge (SSE без буферизации, план §4.3).
   Там же, без изменений, — сетевая граница: агент не достаёт ни WAHA (3000), ни
   clamd (3310) даже по IP. Её держит правило Docker Engine для разных bridge-сетей
   (они общаются только через опубликованные порты,
   docs.docker.com/engine/network/drivers/bridge), а у WAHA и ClamAV портов нет. На
   локальном OrbStack это правило не действует, поэтому до этой проверки на hermes
   граница по IP не доказана. Lead-agent в production сейчас не развёрнут, проверять
   его нечего; если его развернут в `evo_crm_private`, добавить в проверку и его
   адрес с портом 8000.

   ```bash
   api=$(docker ps -q --filter label=com.docker.compose.project=evo-crm --filter label=com.docker.compose.service=ai-agent-api)
   for target in waha:3000 clamav:3310; do
     service=${target%:*} port=${target#*:}
     id=$(docker ps -q --filter label=com.docker.compose.project=evo-crm --filter label=com.docker.compose.service="$service")
     ip=''
     [ -z "$id" ] || ip=$(docker inspect --format '{{(index .NetworkSettings.Networks "evo_crm_private").IPAddress}}' "$id" 2>/dev/null)
     # An empty address would make connect_ex probe the agent's own loopback and look isolated.
     if [ -z "$api" ] || [ -z "$ip" ]; then echo "$service: not checked"; continue; fi
     docker exec "$api" python -c 'import socket, sys; s = socket.socket(); s.settimeout(3); sys.exit(0 if s.connect_ex((sys.argv[1], int(sys.argv[2]))) else 3)' "$ip" "$port"
     case $? in
       0) echo "$service: isolated" ;;
       3) echo "$service: REACHABLE" ;;
       *) echo "$service: not checked" ;;
     esac
   done
   ```

   Ожидается `waha: isolated` и `clamav: isolated`. `REACHABLE` — выключить агента
   (ниже) до разбора. `not checked` — граница не доказана: нет контейнера агента,
   службы или её адреса в `evo_crm_private`, либо проверка внутри агента не
   выполнилась; выяснить причину и повторить.
6. Новый образ агента: новый `EVO_AI_AGENT_IMAGE_DIGEST` и обычный выпуск.
   Ротация секретов: правка `.env.ai-agent` и обычный выпуск (compose пересоздаёт
   службы при смене окружения), старое значение отзывается.

## Агент перезапустился или нездоров

Пока агент включён, controller держит пару так же строго, как WAHA. Если у
`ai-agent-api` или `ai-agent-worker` `RestartCount` больше 0 или статус не
`healthy`, `status` и предпроверка **каждого** выпуска CRM, в том числе срочного
исправления, останавливаются с `runtime_service_unhealthy`. Выпуск ничего не
меняет, пока пара не исправлена.

1. Причина (чтение): `docker ps -a --filter label=com.docker.compose.project=evo-crm
   --filter label=com.docker.compose.service=ai-agent-worker` (и `ai-agent-api`),
   затем `docker logs --tail 200 <id>`.
2. Пересоздать пару на **принятом** digest (по разрешению владельца). Это не drift:
   digest тот же, что в записи приёмки, а пересоздание обнуляет `RestartCount`.

   ```bash
   evidence=/opt/evo-crm/release-evidence
   dir=$evidence/$(jq -r .releaseId "$evidence/current-v3-accepted.json")
   image=$(jq -r .aiAgent.image "$dir/v3-acceptance-record.json")
   waha_digest=$(sed -n "s/^export EVO_WAHA_IMAGE_DIGEST=//p" "$dir/rollback-command.sh")
   env EVO_RELEASE_REVISION="$(jq -r .revision "$dir/state.json")" \
     EVO_RELEASE_VERSION="$(jq -r .version "$dir/state.json")" \
     EVO_WAHA_IMAGE_DIGEST="$waha_digest" \
     EVO_CRM_APP_ENV_FILE="$dir/candidate-app.env" \
     EVO_CRM_WAHA_ENV_FILE=/opt/evo-crm/.env.waha \
     EVO_CRM_AI_AGENT_ENV_FILE=/opt/evo-crm/.env.ai-agent \
     EVO_AI_AGENT_IMAGE_DIGEST="${image#*@}" \
     docker compose --ansi never --project-name evo-crm \
       --file "$dir/docker-compose.candidate.yml" --env-file "$dir/candidate-app.env" \
       --profile ai-agent up --detach --no-deps --no-build --pull never \
       --force-recreate --wait --wait-timeout 300 ai-agent-api ai-agent-worker
   ```

   Команда трогает только две службы агента; приложение, ClamAV и WAHA не
   пересоздаются. Затем `status` (шаг 5 выше) должен показать `"aiAgent":"healthy"`.
3. Если пара снова падает, выключите агента (ниже, «Выключить агента») и сделайте
   выпуск без него: это снимает блокировку выпусков CRM.

## Откат

- **Автоматически.** Если не прошли приложение, агент, `/v1/ready`, внешний health
  или приёмка, controller возвращает прежнее приложение и прежний digest агента
  (из `state.json`; образ уже лежит на хосте и проверяется до любого изменения).
  Если агента до выпуска не было, обе службы удаляются, а приложение
  возвращается без сети `evo_crm_ai`. Override controller сам объявляет эту сеть,
  поэтому откат рендерится и со снимком compose, который старше неё; снимок
  прежнего выпуска проверяется таким рендером ещё до изменений.
- **Вручную.** Та же команда, что и для приложения:
  `sudo -- <evidence>/<release-id>/rollback-command.sh` (или `... pending-only`).
  Обёртка выпуска с агентом сама экспортирует `EVO_AI_AGENT_ENABLED`, digest и путь
  к `.env.ai-agent`; решение об агенте берётся из `state.json`.
- **Выключить агента.** Сначала `gh variable set EVO_AI_AGENT_ENABLED --repo
  izzhackt/evo_AI_CRM --body false`, затем на hermes удалить только контейнеры
  агента:

  ```bash
  for service in ai-agent-api ai-agent-worker; do
    id=$(docker ps -aq --filter label=com.docker.compose.project=evo-crm \
      --filter label=com.docker.compose.service="$service")
    [ -z "$id" ] || { docker stop --time 30 "$id" && docker rm "$id"; }
  done
  ```

  Выпуск с выключенным агентом не стартует, пока контейнеры агента существуют
  (`runtime_service_contract_invalid`). Данные агента в БД не трогаются.
  Приложение остаётся в сети `evo_crm_ai` до этого выпуска; выпуск без агента
  пересоздаёт его уже без неё (предпроверка это допускает). Пустую сеть затем можно
  удалить: `docker network rm evo_crm_ai`.
- **Откат через выключение.** Если откатить выпуск без агента к принятому выпуску
  с агентом, агент сам не вернётся, а следующий выпуск с `true` увидит расхождение с
  принятой записью. Перед повторным включением сделайте один обычный выпуск с
  выключенным агентом.
