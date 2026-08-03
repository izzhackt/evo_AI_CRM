# Текущий статус EVO Platform

- Owner: технический ответственный EVO Admissions
- Snapshot date: 2026-08-03
- Initial P0 baseline: `a16cd3fb591128b6d28f7f46c432169a0ff28753`
- P2A starting checkpoint: `1b2ee797a01bbf60d4bc75cabae72c0c6dc0c9d5`
- P2B starting checkpoint: `8ad755b5039390f418dbe12924a806f069f93b53`
- P2C starting checkpoint: `0d38a8bb36fa423de14467f798141fac199ab047`
- P2D starting checkpoint: `f9bda9cd0554d225211fb9e3d0b1969be262a838`
- P2E starting checkpoint: `a58e5fa5ca24be0d0a30374b6a6e1202c79b7604`
- P2F starting checkpoint: `aac1cba851e89070a7eb54baab4eddf921e3447c`
- P2G starting checkpoint: `8567455f281fa157fb088970db1c2a2397850843`
- P2H starting checkpoint: `23b2dc31ddc881ee46b08a3f4dc95e1395f326de`
- Greenfield/UI boundary checkpoint: `26115344909261a39bbe591f3b835cda4b7e5068`
- Current merged checkpoint: `db8f3c75c898d5b68b0080099583d4eeea9931d2`
- Active plan block: `EVO-P2R2-AUTH-LOCAL-READINESS-PLAN-2026-08-03`
- Target decision: `docs/adr/0014-unified-evo-platform-target-architecture.md`
- Supabase boundary: `docs/adr/0015-establish-canonical-supabase-schema-and-migration-boundary.md`
- Active greenfield/UI boundary:
  `docs/adr/0016-greenfield-platform-ui-and-data-boundary.md`
- Evidence rule: code/configuration is not real-provider proof

## Короткий вывод

Target unified EVO Platform принят как implementation contract, но ещё не
является production reality. Текущий repository baseline сохраняет root CRM,
EVO Inbox и EVO Lead Agent как отдельные контуры. Платформа теперь описана как
greenfield Supabase-native path без legacy SQLite import/auth migration,
dual-read или dual-write. Полный реальный путь WhatsApp → amoCRM → Platform →
AI draft → manual send → ACK → audit ни разу не доказан end-to-end, поэтому
platform нельзя называть production-complete.

P1 остаётся историческим legacy containment. P2A-P2H, greenfield/UI boundary,
BW0, P3A-P3C, BW1-BW4 и P2R0/P2R1 merged; PR #107 merged BW5 checkpoint.
Exact-main CI run `30782828561` зелёный на
`db8f3c75c898d5b68b0080099583d4eeea9931d2`. PR #108 был закрыт без merge
после controller `changes_requested`: repair не был заранее разрешён планом, а
fresh physical-worktree `test:supabase:local` завершился exit 1 после двух
reset attempts. P2R2 теперь единственный active docs-only gate; BW5 paused.
Former P2I restore duties остаются в P7 и не входят в P2R2/BW5.

## Что подтверждено из репозитория

| Область | Подтверждённый факт | Граница утверждения |
|---|---|---|
| P0/P1/P2 contract | P0, P1A–P1D, P2 decomposition и P2A–P2H merged в PR #75–#82, #85–#90 и #92 | это не provider/cutover proof |
| P2A repository baseline | PR #82 controller-merged как `8ad755b5039390f418dbe12924a806f069f93b53`; root `supabase/` — единственный migration source; 001–039 перенесены byte-identically, checksum manifest и local reset проверяют history | exact-main push CI `30362128826` зелёный; managed Supabase не связан |
| P2B schema/grants | PR #85 controller-merged как `0d38a8bb36fa423de14467f798141fac199ab047`; migration 040 создаёт только `platform`/`platform_private`, закрывает browser secret grants и переводит активные AI/API-key consumers на account-scoped backend stores | exact-main push CI [run 30387286021](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30387286021) зелёный; доказан repository/disposable PostgreSQL/local PostgREST, remote migration не применялась |
| P2C identity/RBAC | PR #86 controller-merged как `f9bda9cd0554d225211fb9e3d0b1969be262a838`; migration 041 добавляет organizations, Auth-linked profiles, ровно пять Platform roles, live versioned authorization, record scopes, append-only audit и узкие audited RPC | exact-main push CI [run 30392676403](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30392676403) зелёный; managed/production migration не выполнялась |
| P2D admissions/RLS | PR #87 controller-merged как `a58e5fa5ca24be0d0a30374b6a6e1202c79b7604`; pinned migration 042 добавляет десять FORCE-RLS admissions tables, immutable v2 bundles, pending case, Admin assignment/handoff, scope rotation, multi-application, visa/task state, safe Sales/Student projections и replay-safe audited RPC | exact-main push CI [run 30397295986](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30397295986) зелёный; clean disposable PostgreSQL 001–042 и local Auth/PostgREST matrix доказаны, но real amoCRM mapping, managed/production migration и Portal cutover не доказаны |
| P2E documents/finance/notifications | PR #88 controller-merged как `aac1cba851e89070a7eb54baab4eddf921e3447c`; migration 043 добавляет 16 FORCE-RLS relations, 18 exact-signature RPC/projections, metadata-only document workflow, manual evidence-backed finance, singular-recipient notification intent и immutable v3 bundles | post-merge exact-main CI [30402311903](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30402311903) зелёный; binary Storage/scanner, Queue/provider delivery, managed apply и production не доказаны |
| P2F communications/provider/AI | PR #89 controller-merged как `8567455f281fa157fb088970db1c2a2397850843`; pinned migration 044 содержит 10 exposed + 2 private tables и 19 functions для unified history/provider evidence/draft-only AI/manual authorization | post-merge exact-main CI [30407638837](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30407638837) зелёный для Main CRM, EVO Inbox и EVO Lead Agent; Queue/Storage, live-provider/delivery, managed apply и production не доказаны |
| P2G durable work | PR #90 controller-merged как `a9bd811eda00d39a09997647fa8c2f98e87a1c3d`; frozen migration `045_platform_durable_work_queues.sql`: 3,425 lines, 91,620 bytes, SHA-256 `a657c32c3dadec369b54157914a229b112c58beb395ee4a2ae99025d804723a2`; 5 private + 2 FORCE-RLS Admin-review tables, 16 functions, two fixed pointer-only PGMQ queues | disposable Supabase PG17 log `f4efe1bc…`, local CLI reset `1575a5e8…`, independent SHA-bound review и exact-head PR CI зелёные; post-merge Main CRM дважды был остановлен до tests внешним ECR rate limit, поэтому текущий remediation добавляет immutable official-mirror fallback; no provider/managed/production proof |
| P2H private documents | PR #92 controller-merged как `b10d72863230aba646bcc8f2acafdc76c27b3fe1`; migration 046 — 79,701 bytes, SHA-256 `0bfcbd0f478b4714e347dced2f8220be3c9d28a65807e5485aef1c474983b58f`; private `platform-documents`, reservation/finalization, one-time audited download grants and exact denial matrices | real disposable local Auth/PostgREST/Storage/PGMQ proved; exact-main CI `30490070719` green; managed/production Supabase, malware provider and DB plus Storage restore remain unproved |
| Greenfield/UI boundary | PR #93 controller-merged как `26115344909261a39bbe591f3b835cda4b7e5068`; root frontend из PR #64/#71/#72 — sole UI, Platform Supabase-native без SQLite/root-auth import, dual-read/write или automatic legacy import | exact-main CI green; это plan boundary, не runtime/provider proof |
| BW0/P3/BW1-BW4 | PR #94 merged workflow plan; PRs #95-#97 merged Supabase-native auth, conversation and guarded manual-send seams; PRs #100-#103 merged provenance, OP/OZO, Student Profile/checklists and prompt/decision lifecycle | local repository/RLS/browser evidence only; no live amoCRM/WAHA/AI/ACK or production proof |
| P2R0/P2R1 | PR #104 merged the bounded docs-only remediation contract; PR #105 merged scoped deadlines, exact disposable cleanup, local Auth readiness, PGMQ test leases and forward document lock order as migration 055 | exact-main CI `30763498291` is green; managed Supabase, restore, providers and production remain excluded |
| P2R2 plan gate | PR #108 exact head `f719b749…` was closed without merge after controller comment `5166574008`; focused 19/19 and exact-head CI passed, but plan order and fresh real reset proof failed | active docs-only amendment authorizes only issued-token `getClaims` plus live authority, symlink-safe deadline execution and reproducible exact-project reset/cleanup; no migration/provider/production claim |
| Root CRM | использует SQLite, собственную auth-модель и локальные WhatsApp shadow tables; P1D добавил object-scope containment | не Supabase target и не unified history |
| EVO Inbox | имеет отдельный Supabase model и конфигурацию session `evo-inbox` | наличие кода не доказывает текущую production session |
| EVO Lead Agent | остаётся в repository и production Compose path | его нельзя удалять до bounded cutover evidence and rollback gate |
| amoCRM | интеграционный код хранит external IDs и mapping paths | реальные account mappings и readiness требуют provider proof |
| WAHA | текущая конфигурация содержит legacy `crm_primary` и Inbox `evo-inbox` paths | target — одна `evo-inbox`, но session mutation не выполнена и не разрешена |
| Public edge | EVO-owned target использует `evo-edge-caddy` и `evo_public_web` | production network/revision проверяется отдельно |
| Target frontend | PRs #64/#71/#72 — sole product UI contract; P3A-P3C wired its bounded messaging path to greenfield Supabase auth/repositories/actions | local wiring does not prove live providers, managed Supabase or production readiness |

Подробные local-only доказательства P2A:
[`p2a-supabase-repository-baseline.md`](p2a-supabase-repository-baseline.md).
Доказательства P2B:
[`p2b-schema-grant-containment.md`](p2b-schema-grant-containment.md).
P2C evidence contract:
[`p2c-identity-rbac-audit.md`](p2c-identity-rbac-audit.md).
Текущий P2D evidence contract:
[`p2d-admissions-rls.md`](p2d-admissions-rls.md).
P2E merged contract and evidence ledger:
[`p2e-documents-finance-notifications.md`](p2e-documents-finance-notifications.md).
P2F merged communications contract:
[`p2f-communications-contracts.md`](p2f-communications-contracts.md).
P2G merged Queue contract:
[`p2g-durable-work-queues.md`](p2g-durable-work-queues.md).
P2H merged private-document contract:
[`p2h-private-document-storage.md`](p2h-private-document-storage.md).

## Принятый target, ещё не cut over

- один unified backend поглощает EVO Inbox и полезную безопасную логику Lead
  Agent;
- amoCRM остаётся source of truth для contact, lead, responsible sales manager и
  sales stage;
- один dedicated production Supabase project хранит собственные Platform data,
  а dev/staging/preview изолированы;
- root `supabase/` — единственный repository migration source; P2A сохраняет
  001–039 byte-for-byte, P2B добавляет migration 040, P2C — migration 041,
  merged P2D — pinned forward-only migration 042, merged P2E — migration 043,
  merged P2F — exact checksum-pinned migration 044 для
  communications/provider/AI database contracts, merged P2G — migration 045
  для real local PGMQ work/retry/reconciliation, merged P2H — migration 046
  для private document Storage authorization;
- `public` остаётся legacy Inbox compatibility, `platform` — exposed RLS
  schema, `platform_private` — backend-only вне Data API;
- legacy Inbox roles/signup не создают Platform business authority;
- одна private production WAHA session `evo-inbox` и один webhook owner;
- роли v1: Admin, Sales, Curator, Finance и target machine role `student`
  (user-facing Client/Student); текущий root `client` не импортируется и не
  маппится без отдельного будущего scoped decision;
  отдельной Visa role нет, module `/visa` остаётся;
- все exposed tables защищены RLS, private Storage — object policies и audited
  downloads;
- AI только создаёт RU/EN draft, staff review/edit/manual-send обязателен;
- unknown delivery никогда не retry-ится автоматически;
- legacy Lead Agent удаляется только отдельным reviewed PR после bounded
  controlled evidence window, zero unexplained loss/duplicates, health and
  rollback proof.

## Следующие доказательства, которых пока нет

- isolated database restore и отдельный Storage-object restore;
- proof, что ни один browser bundle не содержит service-role/provider secret.

## Внешние и release доказательства, которых пока нет

- linked managed Supabase project, remote migration-ledger parity, branch
  isolation, production plan/PITR и managed restore;
- подтверждённые account-specific amoCRM pipeline/status/user/custom-field
  mappings;
- sanitized test lead и dedicated test WhatsApp number/QR owner;
- реальный signed WAHA webhook с raw-persist-before-process, amo resolve/link,
  draft, operator manual send и ACK/unknown reconciliation;
- production-like capacity test и утверждённые SLO/RPO/RTO;
- cutover/rollback rehearsal, release window и отдельная production
  authorization;
- bounded reconciliation evidence window with zero unexplained loss/duplicates.

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

Текущий gate — docs-only P2R2 amendment. После его controller merge допускается
только bounded auth/local-readiness repair: exact issued-token
`getClaims(accessToken)`, live authority, symlink-safe deadline execution,
normal real local reset exit zero и exact cleanup с сохранением Inbox. После
controller-merged implementation и зелёного exact-main CI BW5 может занять
только проверенный next-free migration 056 и реализовать reviewable
university/college catalog boundary без fake records или прямой публикации из
staging. Реальный Notion source остаётся blocked без authorized AbdyldaYT
access; confirmed college dataset отсутствует. Реальный amoCRM adapter остаётся
P4, WAHA/AI/ACK proof — P5, а restore duties — P7.
Production cutover remains a separate authorized event with bounded
reconciliation/health/rollback evidence.

Перед любым production claim нужно обновить этот snapshot реальной проверкой
exact deployed revision, private network, provider readiness и full E2E.
