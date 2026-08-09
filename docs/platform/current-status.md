# Текущий статус EVO Platform

- Owner: технический ответственный EVO Admissions
- Snapshot date: 2026-08-09
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
- Current merged checkpoint: `18e0e0855fda31cba1fa837d81b3a75cedd585e9`
- Active plan block:
  `EVO-DIRECT-MERGE-GOVERNANCE-2026-08-09`
- Target decision: `docs/adr/0014-unified-evo-platform-target-architecture.md`
- Supabase boundary: `docs/adr/0015-establish-canonical-supabase-schema-and-migration-boundary.md`
- Active greenfield/UI boundary:
  `docs/adr/0016-greenfield-platform-ui-and-data-boundary.md`
- Active Student Profile automation boundary:
  `docs/adr/0017-separate-student-profile-document-automation-from-evo-platform.md`
- Retained Lead Agent/legacy-path boundary:
  `docs/adr/0018-defer-amocrm-and-retain-lead-agent.md`
- Active autonomy and read-mostly amoCRM boundary:
  `docs/adr/0019-gate-autonomous-inbound-replies-and-resume-read-only-amocrm.md`
- Evidence rule: code/configuration is not real-provider proof

## Короткий вывод

Target unified EVO Platform принят как implementation contract, но ещё не
является production reality. Текущий repository baseline сохраняет root CRM,
EVO Inbox и EVO Lead Agent как отдельные контуры. Платформа теперь описана как
greenfield Supabase-native path без legacy SQLite import/auth migration,
dual-read или dual-write, а accepted Claude Design root frontend остаётся sole
UI. Полный реальный путь WhatsApp → read-mostly amoCRM → Platform → Gemini
proposal → deterministic gate → manual или bounded autonomous reply → ACK →
Realtime/audit ни разу не доказан end-to-end, поэтому Platform нельзя называть
production-complete.

P1 остаётся историческим legacy containment. P2A-P2H, greenfield/UI boundary,
BW0, P3A-P3C, BW1-BW7, P2R0-P2R4 и P4A merged; PR #118 merged the P4B plan.
PR #119 остаётся immutable history, но его in-repository Student Profile
document reading/extraction/autofill/export scope superseded решением owner-а:
эта автоматизация принадлежит отдельной системе вне `evo_AI_CRM`. PRs
#125-#127 отменили зависимые PRs #124, #122 и #120, PR #128 controller-merged
корректную продуктовую границу, а PRs #129-#130 merged local-validation plan и
repair. PR #131 merged P4 deferral/Lead Agent retention authority, PR #132
merged receive-only P5A ingress, а PR #133 merged P5B receive/project.
Текущий main — `18e0e0855fda31cba1fa837d81b3a75cedd585e9`, exact-main CI
`31323907123` зелёный, migrations contiguous `001-060`.

P4B implementation сохранён на remote branch
`izzhackt/evo-platform-p4b-mapping-approval` at
`e53ba94954f147b295f596421a255591fa343ce8`; implementation PR отсутствует.
Focused checks прошли, но full local Supabase gate failed closed в real
Auth/PostgREST hook до Playwright. Это failed/non-evidence; cleanup verification
показал 0 exact Platform resources/process/lock. ADR 0019 возобновляет только
bounded read-mostly amoCRM adapter; P4B writes, full mapping approval и cutover
остаются gated. P9 removed; Lead Agent, legacy webhook/session и rollback path
остаются deployed/frozen. Staging, real providers, managed apply и customer
delivery остаются blocked до отдельной авторизации и доказательств. Former P2I
restore duties остаются в P7.

P5A и P5B merged, но ingress/worker disabled by default. PR #133 был принят как
receive/project implementation, не AI/send implementation; full local
Supabase/browser gate и exact-main CI зелёные, но real WAHA/provider proof и
production enablement отсутствуют. Следующий bounded P5 block — available
history reconciliation.

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
| P2R2/P2R3 repair | PR #109 merged the bounded repair contract; PR #112 controller-merged the exact issued-token check, live-authority response-writable stale-session clearing and symlink-safe bounded local reset | independent exact-head local Supabase proof passed 55 migrations and 25/25 browser tests; exact-main CI `30883272841` is green; no managed Supabase/provider/production claim |
| BW5 catalog boundary | PR #113 controller-merged migration 056, catalog repositories/actions and the accepted `/applications` route for reviewed source → staging → validation → Admin approval/rejection, approved catalog reads and catalog-backed application creation | independent exact-head review, controller gates and exact-main CI `30894448943` passed; managed Supabase and real source providers remain blocked |
| BW6 contract/report | PR #114 controller-merged migration 057, contract repository/actions and the existing Student 360 route for typed approved-field contract drafts plus audited post-contract checklist/report | independent exact-SHA review, controller gates and exact-main CI `30918820654` passed; this is not a signed legal contract, PDF/DOCX/e-sign, provider, managed Supabase or production proof |
| BW7 integration proof | PR #116 connected Student 360 assignment state and proved one synthetic case across Sales draft → Admin assignment/portal activation → Curator checklist/report → Student Portal → limited Sales summary | independent review/controller gates, real disposable local Supabase/Auth/RLS browser gate 28/28 and exact-main CI `30934111632` passed; persistent staging/provider/production proof remains absent |
| P4A amoCRM mapping discovery | PR #117 merged migration 058 with immutable sanitized account-specific snapshots, service-only ingest, live-authority Admin reads and a GET-only bounded server adapter | independent exact-head review, controller full local Supabase RC=0 with 58 migrations and 28/28 browser scenarios, and exact-main CI `30958119076` passed; real amoCRM account proof remains blocked |
| P4B mapping selection/approval | PR #118 merged the plan; implementation checkpoint `e53ba94954f147b295f596421a255591fa343ce8` is preserved remotely with focused checks passed and no PR | full mapping/write scope remains gated; ADR 0019 separately resumes only read-mostly access; failed Auth/PostgREST gate is non-evidence and there is no provider proof |
| PR #128 boundary correction | Student Profile document reading, extraction, autofill and form export moved to a separate system outside this repository; ordinary Platform document lifecycle remains | merged docs-only authority correction; no automatic data exchange, runtime dependency, provider call, customer-data action or production mutation |
| P2R4 local validation repair | PRs #129-#130 merged the bounded plan and two-file fail-closed harness repair | exact-main CI `31038964366` green; later P4B gate failure is scoped to that branch/run and does not reopen P2R4 or prove providers |
| P4 deferral/retention authority | PR #131 merged ADR 0018 and docs-only execution-order correction | ADR 0019 now supersedes only full P4 deferral and draft-only P5 wording; Lead Agent/legacy freeze remains |
| P5A receive-only WAHA ingress | PR #132 merged signed HMAC/timestamp validation, raw-persist-before-process and pointer-only inbound work with migration 059 | P5A merge-baseline CI `31145596058` was green; current exact-main CI is tracked above; flags remain disabled by default and no real WAHA/Supabase/provider proof exists |
| P5B receive/project | PR #133 merged as `18e0e0855fda31cba1fa837d81b3a75cedd585e9`; migration 060 and the private worker project verified inbound work into the accepted root UI data path | full local Supabase/browser gate and exact-main CI `31323907123` passed; flags remain off and there is no AI send, live WAHA or production proof |
| Root CRM | использует SQLite, собственную auth-модель и локальные WhatsApp shadow tables; P1D добавил object-scope containment | не Supabase target и не unified history |
| EVO Inbox | имеет отдельный Supabase model и конфигурацию session `evo-inbox` | наличие кода не доказывает текущую production session |
| EVO Lead Agent | остаётся в repository и production Compose path, deployed/frozen вместе с legacy webhook/session и rollback path | P9 removed; deactivation, retirement и deletion запрещены в текущем scope |
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
BW5 merged contract and evidence ledger:
[`bw5-catalog-import-boundary.md`](bw5-catalog-import-boundary.md).
BW6 merged contract and evidence ledger:
[`bw6-contract-draft-report.md`](bw6-contract-draft-report.md).
BW7 merged integration evidence ledger:
[`bw7-latest-main-integration-proof.md`](bw7-latest-main-integration-proof.md).
P4A merged boundary and evidence ledger:
[`p4a-amocrm-mapping-discovery.md`](p4a-amocrm-mapping-discovery.md).
P4B docs-only selection/approval contract:
[`p4b-amocrm-mapping-selection-approval.md`](p4b-amocrm-mapping-selection-approval.md).

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
  для private document Storage authorization, merged greenfield/auth and
  workflow blocks — migrations 047–054, merged P2R1 lock-order repair —
  migration 055, merged BW5 catalog boundary — migration 056, merged BW6
  contract/report boundary — migration 057; BW7 не добавляет migration и
  соединяет принятые RPC/RLS contracts с существующим frontend; merged P4A
  добавляет только forward migration 058 для private sanitized mapping
  discovery versions; PR #118's P4B plan, merged PR #128 boundary correction и
  PRs #129-#131 не добавляют migration; merged P5A добавляет migration 059;
  merged P5B добавляет migration 060; следующий migration-кандидат обязан
  подтвердить свободный номер 061 перед использованием;
- `public` остаётся legacy Inbox compatibility, `platform` — exposed RLS
  schema, `platform_private` — backend-only вне Data API;
- legacy Inbox roles/signup не создают Platform business authority;
- одна private production WAHA session `evo-inbox` и один webhook owner;
- WAHA остаётся private transport; Supabase owns durable queues, proposal/gate
  evidence, lead memory, approved pgvector retrieval, ACK/session reconciliation,
  private Realtime and audit;
- bounded read-mostly amoCRM adapter читает canonical contact, lead,
  responsible Sales и stage плюс task/call/chat-record references; writes,
  inferred mapping, hardcoded IDs и silent fallback запрещены;
- роли v1: Admin, Sales, Curator, Finance и target machine role `student`
  (user-facing Client/Student); текущий root `client` не импортируется и не
  маппится без отдельного будущего scoped decision;
  отдельной Visa role нет, module `/visa` остаётся;
- все exposed tables защищены RLS, private Storage — object policies и audited
  downloads;
- Gemini создаёт structured qualification/reply proposal. Deterministic EVO
  gates may queue only an inbound-triggered reply inside the rolling 24-hour
  service window; cold outbound, broadcast, campaign, autonomous follow-up/
  re-engagement и out-of-window free-form запрещены;
- staff outbound/takeover immediately pauses autonomy; only authorized staff
  may resume. Opt-out, outside `Asia/Bishkek 09:00-21:00` until organization
  configuration, unsupported language/content, media-only, low confidence,
  missing approved knowledge, complaint, payment/refund, legal/privacy,
  guarantee risk, unhealthy WAHA or unknown provider outcome fail closed to
  human review;
- valid media-only inbound сохраняется и становится operator-visible before
  human handoff; missing text не является terminal success;
- unknown delivery никогда не retry-ится автоматически;
- P9 и retirement/removal Lead Agent исключены из текущего execution scope:
  legacy Lead Agent, webhook/session и rollback path остаются deployed/frozen;
  их deactivation, retirement или deletion требуют нового owner decision и
  отдельного plan amendment.

## Следующие доказательства, которых пока нет

- isolated database restore и отдельный Storage-object restore;
- release-artifact browser-secret scan and production runtime-config
  attestation; текущий BW5 local `.next/static` name scan и scoped Gitleaks diff
  scan зелёные, но это не release/production proof.

## Внешние и release доказательства, которых пока нет

- linked managed Supabase project, remote migration-ledger parity, branch
  isolation, production plan/PITR и managed restore;
- подтверждённые account-specific amoCRM pipeline/status/user/custom-field
  mappings;
- sanitized test lead и dedicated test WhatsApp number/QR owner;
- реальный signed WAHA webhook с raw-persist-before-process, operator-visible
  text/media projection, read-mostly amo resolve/link, Gemini structured
  proposal, deterministic gate, forced-human cases, one authorized bounded
  autonomous reply, staff pause/resume и ACK/session/unknown reconciliation;
- private Supabase Realtime visibility in the accepted root UI without direct
  browser-to-WAHA access;
- production-like capacity test и утверждённые SLO/RPO/RTO;
- cutover/rollback rehearsal, release window и отдельная production
  authorization;
- bounded reconciliation evidence window with zero unexplained loss/duplicates.

## Открытые release decisions

1. Точные amoCRM account/pipeline/status/custom-field/user mappings.
2. Supabase region, plan, PITR и cost.
3. Capacity, SLO, RPO и RTO.
4. Retention, privacy, DPA и legal deletion period.
5. Exact Gemini model/version, credentials, retention and data-handling policy.
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
- включение P5A/P5B/autonomous-send runtime flags или scheduler;
- cold outbound, broadcast, campaign, autonomous follow-up/re-engagement,
  out-of-window free-form или model-direct WAHA send;
- отключение или удаление production service, EVO Lead Agent или legacy path.

Для этих действий текущий результат может подготовить code, runbook и evidence
gate, но не выполнять mutation.

## Следующий безопасный gate

Текущий gate — docs-only
`EVO-DIRECT-MERGE-GOVERNANCE-2026-08-09`: fresh independent read-only
exact-head review, все required exact-head CI jobs, затем direct executor merge
того же SHA и green exact-main push CI. Scheduled Launch Auditor и отдельный
merge-controller больше не используются; full Codex Security workflow не
требуется. Focused authorization/RLS/security tests, secret/PII scan и
dependency audit остаются обязательными по изменённой области.

Следующий implementation gate — P5 available-history reconciliation за
accepted root UI, затем private media, ACK/session и Realtime. Autonomous
inbound-reply PR допускается только после этих принятых blocks. Он обязан
использовать Gemini proposal, deterministic queue/worker gates, bounded
read-mostly amoCRM, durable pause/resume и disabled-by-default flags. Real
provider E2E и production enablement остаются separate authorized events. Lead
Agent остаётся retained/frozen.

Перед любым production claim нужно обновить этот snapshot реальной проверкой
exact deployed revision, private network, provider readiness и full E2E.
