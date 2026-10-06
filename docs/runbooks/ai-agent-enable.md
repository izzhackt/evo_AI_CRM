# Включение «ИИ-агента» на hermes (P1)

Контракт: [план «ИИ-агент»](../EVO_AI_AGENT_PLAN_2026-10-06.md) §4.2, §4.6–§4.8,
[ADR 0032](../adr/0032-run-the-ai-agent-as-a-private-evo-service.md). Этот документ
описывает шаги; он сам ничего не разрешает. Каждое действие на production — пароль
роли, файл секретов, переменные GitHub, выпуск — делается по отдельному разрешению
владельца на это действие.

## Что уже есть в коде

- `docker-compose.prod.yml`: службы `ai-agent-api` (alias `evo-ai-agent`, порт 8080,
  0,5 CPU, 512 MiB) и `ai-agent-worker` (1 CPU, 1,5 GiB, 256 процессов) под профилем
  `ai-agent`. Обе только в `evo_crm_private`, без опубликованных портов и томов,
  `read_only`, uid 10001, все capabilities сброшены, `stop_grace_period: 30s`.
  Образ — только `ghcr.io/izzhackt/evo-ai-agent@<digest>`. Секреты — из
  `/opt/evo-crm/.env.ai-agent`; список имён — `deploy/env.ai-agent.example`.
- Release controller и workflow включают агента в выпуск, только если переменная
  GitHub `EVO_AI_AGENT_ENABLED` равна ровно `true`. Пустая или `false` — выпуск
  такой же, как до агента: тот же compose-рендер (app, clamav, waha), те же вызовы
  Docker, тот же формат `state.json`. Любое другое значение останавливает выпуск.
- При `true` controller до любого изменения проверяет digest
  (`^sha256:[0-9a-f]{64}$`), файл `.env.ai-agent` (обычный файл, режим 0600,
  непустые `EVO_AI_AGENT_GEMINI_API_KEY`, `EVO_AI_AGENT_DATABASE_URL`,
  `EVO_AI_AGENT_INTERNAL_SECRET`; значения не читаются и не печатаются), ещё
  2 GiB доступной памяти (всего 6 GiB) и сам образ: скачивает его по digest,
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
3. **Файл секретов.** `install -m 600 -o root -g root /dev/null /opt/evo-crm/.env.ai-agent`,
   затем заполнить по `deploy/env.ai-agent.example`: ключ Gemini проекта EVO,
   `EVO_AI_AGENT_DATABASE_URL` (Supavisor, transaction mode, пользователь
   `evo_ai_agent.<project_ref>`), `EVO_AI_AGENT_INTERNAL_SECRET`
   (`openssl rand -hex 32`). Тот же `EVO_AI_AGENT_INTERNAL_SECRET` попадает в
   `.env.production`, когда в выпуске появятся маршруты CRM `/api/v3/ai-agent/*`.
4. **Согласие на передачу текстов в Gemini** записывает admin в разделе «ИИ-агент»
   (RPC `platform.ai_agent_consent_record_v1`). Без него агент запускается, но
   ответов не даёт.

## Шаги оператора

1. Проверить готовность только чтением: журнал миграций production включает
   миграции агента; в `main` есть этот compose и controller; образ агента собран
   CI приватного репозитория на `main`, digest взят из сводки job `publish`.
2. На hermes (чтение): `docker pull ghcr.io/izzhackt/evo-ai-agent@<digest>`, затем
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
6. Новый образ агента: новый `EVO_AI_AGENT_IMAGE_DIGEST` и обычный выпуск.
   Ротация секретов: правка `.env.ai-agent` и обычный выпуск (compose пересоздаёт
   службы при смене окружения), старое значение отзывается.

## Откат

- **Автоматически.** Если не прошли приложение, агент, `/v1/ready`, внешний health
  или приёмка, controller возвращает прежнее приложение и прежний digest агента
  (из `state.json`; образ уже лежит на хосте). Если агента до выпуска не было,
  обе службы удаляются.
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
- **Откат через выключение.** Если откатить выпуск без агента к принятому выпуску
  с агентом, агент сам не вернётся, а следующий выпуск с `true` увидит расхождение с
  принятой записью. Перед повторным включением сделайте один обычный выпуск с
  выключенным агентом.
