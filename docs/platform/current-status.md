# Текущий статус EVO Platform

- Owner: технический ответственный EVO Admissions
- Snapshot date: 2026-07-28
- Initial P0 baseline: `a16cd3fb591128b6d28f7f46c432169a0ff28753`
- P2A starting checkpoint: `1b2ee797a01bbf60d4bc75cabae72c0c6dc0c9d5`
- P2B starting checkpoint: `8ad755b5039390f418dbe12924a806f069f93b53`
- Target decision: `docs/adr/0014-unified-evo-platform-target-architecture.md`
- Supabase boundary: `docs/adr/0015-establish-canonical-supabase-schema-and-migration-boundary.md`
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
| P0/P1/P2 contract | P0, P1A–P1D и P2 decomposition merged в PR #75–#81 | это не provider/cutover proof |
| P2A repository baseline | PR #82 controller-merged как `8ad755b5039390f418dbe12924a806f069f93b53`; root `supabase/` — единственный migration source; 001–039 перенесены byte-identically, checksum manifest и local reset проверяют history | exact-main push CI `30362128826` зелёный; managed Supabase не связан |
| P2B schema/grants | migration 040 создаёт только `platform`/`platform_private`, закрывает browser secret grants и переводит активные AI/API-key consumers на account-scoped backend stores | доказан repository/disposable PostgreSQL/local PostgREST; remote migration не применялась |
| Root CRM | использует SQLite, собственную auth-модель и локальные WhatsApp shadow tables; P1D добавил object-scope containment | не Supabase target и не unified history |
| EVO Inbox | имеет отдельный Supabase model и конфигурацию session `evo-inbox` | наличие кода не доказывает текущую production session |
| EVO Lead Agent | остаётся в repository и production Compose path | его нельзя удалять до cutover и 72-hour soak |
| amoCRM | интеграционный код хранит external IDs и mapping paths | реальные account mappings и readiness требуют provider proof |
| WAHA | текущая конфигурация содержит legacy `crm_primary` и Inbox `evo-inbox` paths | target — одна `evo-inbox`, но session mutation не выполнена и не разрешена |
| Public edge | EVO-owned target использует `evo-edge-caddy` и `evo_public_web` | production network/revision проверяется отдельно |
| Target frontend | уже служит UI contract | UI не доказывает backend, auth, RLS или providers |

Подробные local-only доказательства P2A:
[`p2a-supabase-repository-baseline.md`](p2a-supabase-repository-baseline.md).
Доказательства P2B:
[`p2b-schema-grant-containment.md`](p2b-schema-grant-containment.md).

## Принятый target, ещё не cut over

- один unified backend поглощает EVO Inbox и полезную безопасную логику Lead
  Agent;
- amoCRM остаётся source of truth для contact, lead, responsible sales manager и
  sales stage;
- один dedicated production Supabase project хранит собственные Platform data,
  а dev/staging/preview изолированы;
- root `supabase/` — единственный repository migration source; P2A сохраняет
  001–039 byte-for-byte, а P2B добавляет forward-only migration 040;
- `public` остаётся legacy Inbox compatibility, `platform` — exposed RLS
  schema, `platform_private` — backend-only вне Data API;
- legacy Inbox roles/signup не создают Platform business authority;
- одна private production WAHA session `evo-inbox` и один webhook owner;
- роли v1: Admin, Sales, Curator, Finance и target machine role `student`
  (user-facing Client/Student); текущий root `client` ждёт explicit P3 mapping;
  отдельной Visa role нет, module `/visa` остаётся;
- все exposed tables защищены RLS, private Storage — object policies и audited
  downloads;
- AI только создаёт RU/EN draft, staff review/edit/manual-send обязателен;
- unknown delivery никогда не retry-ится автоматически;
- legacy Lead Agent удаляется только после реального cutover и минимум 72
  фактических часов стабильного трафика.

## Локальные P2 доказательства после P2B, которых пока нет

- explicit schema grants и полный five-role/cross-org/two-student RLS denial
  matrix для будущих Platform domain tables;
- real local Supabase Queues/PGMQ retry/dedupe behavior;
- real local private Storage API/policy behavior;
- isolated database restore и отдельный Storage-object restore;
- proof, что ни один browser bundle не содержит service-role/provider secret.

## Внешние и release доказательства, которых пока нет

- linked managed Supabase project, remote migration-ledger parity, branch
  isolation, production plan/PITR и managed restore;
- read-only SQLite inventory, deterministic migration dry-run и staging import;
- подтверждённые account-specific amoCRM pipeline/status/user/custom-field
  mappings;
- sanitized test lead и dedicated test WhatsApp number/QR owner;
- реальный signed WAHA webhook с raw-persist-before-process, amo resolve/link,
  draft, operator manual send и ACK/unknown reconciliation;
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

После merge P2B следующий gate — P2C: создать Platform organizations,
identity links, business roles/scopes и append-only audit, затем доказать
полный cross-role/cross-org denial matrix. P2C–P2I идут строго
последовательно. Каждый slice требует отдельный PR, независимый SHA-bound
review и точные tests. Production cutover остаётся отдельным авторизованным
событием.

Перед любым production claim нужно обновить этот snapshot реальной проверкой
exact deployed revision, private network, provider readiness и full E2E.
