# Текущий статус EVO Platform

- Owner: технический ответственный EVO Admissions
- Snapshot date: 2026-07-28
- Repository baseline: `a16cd3fb591128b6d28f7f46c432169a0ff28753`
- Target decision: `docs/adr/0014-unified-evo-platform-target-architecture.md`
- Evidence rule: code/configuration is not real-provider proof

## Короткий вывод

Target unified EVO Platform принят как implementation contract, но ещё не
является production reality. Текущий repository baseline сохраняет root CRM,
EVO Inbox и EVO Lead Agent как отдельные контуры. Полный реальный путь
WhatsApp → amoCRM → Platform → AI draft → manual send → ACK → audit ни разу не
доказан end-to-end, поэтому platform нельзя называть production-complete.

## Что подтверждено из репозитория

| Область | Подтверждённый факт | Граница утверждения |
|---|---|---|
| Root CRM | использует SQLite, собственную auth-модель и локальные WhatsApp shadow tables | не Supabase target |
| EVO Inbox | имеет отдельный Supabase model и конфигурацию session `evo-inbox` | наличие кода не доказывает текущую production session |
| EVO Lead Agent | остаётся в repository и production Compose path | его нельзя удалять до cutover и 72-hour soak |
| amoCRM | интеграционный код хранит external IDs и mapping paths | реальные account mappings и readiness требуют provider proof |
| WAHA | текущая конфигурация содержит legacy `crm_primary` и Inbox `evo-inbox` paths | target — одна `evo-inbox`, но session mutation не выполнена и не разрешена |
| Public edge | EVO-owned target использует `evo-edge-caddy` и `evo_public_web` | production network/revision проверяется отдельно |
| Target frontend | уже служит UI contract | UI не доказывает backend, auth, RLS или providers |

## Принятый target, ещё не cut over

- один unified backend поглощает EVO Inbox и полезную безопасную логику Lead
  Agent;
- amoCRM остаётся source of truth для contact, lead, responsible sales manager и
  sales stage;
- один dedicated production Supabase project хранит собственные Platform data,
  а dev/staging/preview изолированы;
- одна private production WAHA session `evo-inbox` и один webhook owner;
- роли v1: Admin, Sales, Curator, Finance, Client/Student; отдельной Visa role
  нет, module `/visa` остаётся;
- все exposed tables защищены RLS, private Storage — object policies и audited
  downloads;
- AI только создаёт RU/EN draft, staff review/edit/manual-send обязателен;
- unknown delivery никогда не retry-ится автоматически;
- legacy Lead Agent удаляется только после реального cutover и минимум 72
  фактических часов стабильного трафика.

## Реальные доказательства, которых пока нет

- dedicated production Supabase project, clean migrations и полный RLS denial
  matrix;
- isolated DB restore и отдельный Storage restore;
- read-only SQLite inventory, deterministic migration dry-run и staging import;
- подтверждённые account-specific amoCRM pipeline/status/user/custom-field
  mappings;
- sanitized test lead и dedicated test WhatsApp number/QR owner;
- реальный signed WAHA webhook с raw-persist-before-process, amo resolve/link,
  draft, operator manual send и ACK/unknown reconciliation;
- proof, что ни один browser bundle не содержит service-role/provider secret;
- production-like capacity test и утверждённые SLO/RPO/RTO;
- cutover/rollback rehearsal, release window и отдельная production
  authorization;
- 72-hour traffic soak с zero unexplained loss/duplicates.

## Открытые release decisions

1. Точные amoCRM account/pipeline/status/custom-field/user mappings.
2. Supabase region, plan, PITR и cost.
3. Capacity, SLO, RPO и RTO.
4. Retention, privacy, DPA и legal deletion period.
5. AI provider и data-handling policy.
6. Dedicated sanitized test sender number, `evo-inbox` production QR/session
   recovery owner и controlled test-send authority.
7. Release window, freeze и rollback authority.

Ни одно из этих решений нельзя подменять fake connector, mock provider success
или «configured = working».

## Запрещённые действия в текущем run

- production deployment или migration;
- DNS change;
- WAHA QR/session/webhook mutation;
- live customer WhatsApp send;
- создание или изменение реальных amoCRM contacts/leads;
- включение auto-reply, outbound automation, broadcast или mass send;
- отключение или удаление production service, EVO Lead Agent или legacy path.

Для этих действий текущий результат может подготовить code, runbook и evidence
gate, но не выполнять mutation.

## Следующий безопасный gate

После merge документационного P0 можно последовательно реализовывать
fail-closed code slices. Каждый slice требует отдельный PR, независимый
SHA-bound review и точные tests. Production cutover остаётся отдельным
авторизованным событием.

Перед любым production claim нужно обновить этот snapshot реальной проверкой
exact deployed revision, private network, provider readiness и full E2E.
