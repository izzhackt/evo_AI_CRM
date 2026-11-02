# Общий веб-edge EVO

Здесь лежит конфигурация общего входного прокси `evo-edge-caddy` (Caddy в сети
`evo_public_web`). Он принимает трафик на 80/443 и раздаёт маршруты CRM, приложения
и сайта.

- `Caddyfile.evo-edge`, `docker-compose.edge.yml` и `website-intake-header.caddy.example`
  перенесены сюда 2026-11-02 из `agent-lead2-inbox/deploy/` (старый EVO Inbox удалён из репозитория).
- Работающий сервер использует копию, установленную из снимка релиза. Изменение этих
  файлов в репозитории ничего не меняет на сервере, пока не выполнен отдельный
  запуск обслуживания edge (`deploy/selfhosted-cutover/edge-maint.sh`).
