# EVO Platform Long-Run Execution Contract

Status: historical V1/Supabase execution record as of 2026-08-28
(Asia/Dubai).
Active authority moved to `docs/EVO_LAUNCH_PLAN.md`, ADR 0022, parent issue
`#407`, and the latest append-only `docs/PLAN_CHANGES.md` entry.

This file remains in the repository because it records the reviewed
Supabase-native long-run sequence and its evidence. It is not the active
architecture or execution contract for new V2 implementation work. Any section
below that names Supabase as the target runtime, or that relaxes independent
review expectations from the new `launch-control` requirement, is historical
only unless a later owner decision explicitly reactivates it.

The active V2 sequence is product-first #424-#433. Full staff authentication,
multi-organization tenancy, public deployment, production monitoring/audit,
restore/rollback drills, managed acceptance, timed pilot, historical migration
and cutover are deferred before real use and are not active blockers.

Historical V1/Supabase baseline captured here: GitHub `origin/main` at
`cfc75ca29a66546886de320aa80c454d18104b92` on 2026-08-25.

Current execution checkpoint at the time of that baseline: U0/#377 through
U4/#381 were merged; Long-run 1 executed U5/#382 through U10/#387 sequentially
and stopped before U11/#388; no managed Supabase project, production
deployment, customer data, WAHA session, amoCRM record or WhatsApp message was
authorized by that contract. The bounded sanitized Gemini verification in
U9/#386 was the only permitted provider exercise under that historical line.
Historical Block-ID: `EVO-LONG-RUN-1-NET-NEW-PILOT-2026-08-25`.

### Historical pre-#376 checkpoint

The following chronology is retained as repository evidence. It is not the
active execution order and cannot override U0-U14.

Execution checkpoint: historical P1 containment, reusable greenfield P2A-P2H,
the greenfield/UI and business-workflow plan gates, P3A-P3C, BW1-BW7,
P2R0-P2R4 and P4A are merged; PR #118 merged the P4B docs-only plan, PR #128
merged the owner-authorized boundary correction that supersedes PR #119, and
PRs #129-#130 merged the local-validation prerequisite and repair. PRs #132,
#133, #137, #138 and #141 merged P5A-P5E; PR #142 merged bounded P4R1
read-only canonical amoCRM context; and PRs #144-#146 merged P5F1-P5F3.
PR #147 merged the reviewed P6A-P6D contract, and PRs #148, #149, #152 and
#153 sequentially merged P6A read-only attention, P6B durable Student Portal
notifications, P6C overdue-transition publication and P6D cross-domain Student
360 closure. PR #154 merged the P7 contract, PR #156 merged P7A safe
Admin-only audit search/export, PR #157 refreshed the accepted status and
OrbStack-only rule, PR #160 merged P7B private observability, PR #163 merged
the P7C authority contract plus managed project consolidation, PR #164 deferred
its recovery execution, PRs #165-#166 established the local knowledge lane and
deterministic Takeout preparation pipeline, PR #170 merged the real
lead-processing proof plan, and PR #171 merged Codex review plus Obsidian
publication. PR #169 merged the focused P7D accessibility contract, and PRs
#172-#174 hardened the local knowledge-ingestion path. Current `origin/main` is
`a8474eb57f94f952711e953be21b5e6041d2f36e`, migrations are contiguous
`001-072`, and exact-main push CI run `31820931774` is green for
Main CRM, EVO Inbox and EVO Lead Agent; Changed range is skipped on the push
event as expected. The owner deferred P7C managed recovery under
`docs/platform/p7c-managed-recovery-contract.md`; the next planning gate is P8A
under `docs/platform/p8-controlled-release-candidate.md`. The deferral does not
inherit PITR, non-empty Storage recovery or production migration proof from
earlier lanes.

P4B implementation is preserved, not merged, on remote branch
`izzhackt/evo-platform-p4b-mapping-approval` at
`e53ba94954f147b295f596421a255591fa343ce8`. Focused repository checks passed,
but its attempted full local Supabase gate failed closed in the real
Auth/PostgREST hook before Playwright; it is failed/non-evidence. The owner has
deferred broad P4/P4B writes and mapping activation. The merged P7 contract
keeps that checkpoint preserved after P4R1, P5 and P6 and decomposes P7 into
safe audit search/export, private observability, managed database plus separate
Storage recovery, and capacity/accessibility closure. P7A and P7B are complete;
P7C recovery and large P7D capacity stress are owner-deferred, while focused
P7D accessibility is next. Narrowed P8 and P10 follow. P9 remains removed, and
Lead Agent plus the legacy rollback path remain deployed/frozen. The exact
managed operations authorized for P7C are limited by
`docs/platform/p7c-managed-recovery-contract.md`; other credential, provider,
customer-data, staging or production actions remain unauthorized.

For Long-run 1, older references in this file to a scheduled Launch Auditor,
controller-only merge or mandatory GitHub `APPROVED` review are historical.
The owner-authorized merge protocol is exact-diff self-review with no known
blocker, all required exact-head GitHub CI, a final refresh/recheck that
`origin/main`, the PR base and head SHA still match the evidence, squash merge
protected by `--match-head-commit`, and exact-main push-CI verification before
the next block starts. An optional independent subagent review may add signal
but is not a merge gate.

## 1. Outcome and truth boundary

The target is one EVO internal platform with one login, one accepted staff UI,
one organization/role model and one end-to-end workflow:

- CRM, Inbox, Lead Agent, Admissions, Finance, Tasks, Documents and AI are
  internal modules, not separate products, entry points or data authorities;
- Supabase is permanent and canonical for client, lead, stage, responsible
  staff, next action, deadline, Student Case, documents, applications, visa,
  payment control, tasks, communication workflow and audit;
- Supabase Auth owns staff identity; private Storage owns accepted private
  objects; RLS and server authorization enforce organization and object scope;
- local/dev, staging and preview environments remain physically isolated from
  production, with no production-data copy by default;
- the pilot is net-new after an explicit cutoff or authorized small allowlist.
  Existing active/history legacy records remain excluded or read-only before
  pilot. SQLite runtime restoration,
  dual-read, dual-write, write-through, fallback repositories, parallel UI and
  compatibility layers are prohibited;
- amoCRM is a temporary read/import adapter. It is not
  canonical for EVO identity, stage, ownership or workflow, and stage one
  performs no amoCRM write;
- WAHA is a private transport adapter. Provider IDs and ACK evidence remain
  distinct from canonical EVO records; WAHA owns no workflow, policy, memory or
  audit;
- AI creates advisory summaries, classifications, next-action suggestions,
  drafts and gap/deadline signals only. A human accepts, edits or rejects every
  suggestion; AI cannot send or mutate consequential state;
- the first pilot roles are Sales Manager, Admissions Manager backed by the
  existing admissions role, and Director/Admin. Sensitive actions remain
  explicit permissions;
- the normal handoff requires confirmed contract plus first mandatory payment,
  then creates/updates one Student Case, assigns Admissions ownership and
  creates starter work. Override requires a reason and immutable audit;
- first live acceptance is receive-only: real inbound WhatsApp and permitted
  external reads, but no outbound WhatsApp and no amoCRM write;
- pilot operational writes remain only in EVO/Supabase; broad active migration
  and historical/archive work require separate post-pilot approval.

The accepted frontend remains the sole staff UI contract and must not gain a
parallel or fallback Inbox UI. Student Profile document extraction/autofill
remains outside this repository under ADR 0017, while ordinary admissions
documents remain inside EVO. No repository result may be called managed,
provider, deployment, backup, rollback or pilot proof without the corresponding
real evidence.

## 2. Historical verified baseline before #376

This section records prior exact evidence only. It is not a current production
snapshot and was not re-verified for U0.

As of the version date:

- GitHub `main` is
  `a8474eb57f94f952711e953be21b5e6041d2f36e`; PR #128 supersedes PR #119 as
  current product authority after corrective PRs #125-#127, PRs #129-#130
  merged the bounded local-validation repair, PRs #132/#133/#137/#138/#141 and
  #144-#146 merged P5A-P5F3, and PR #142 merged bounded P4R1 read-only canonical
  amoCRM context. PRs #148/#149/#152/#153 completed P6A-P6D through migration
  070, PR #154 merged the P7 contract, PR #156 completed P7A as migration 071,
  PR #157 refreshed the accepted status plus OrbStack-only rule, and PR #160
  completed P7B as migration 072, and PR #163 merged the managed P7C authority
  contract plus the `evo-platform-prod` organization/name consolidation, PR
  #169 merged focused P7D and PRs #170-#174 merged the current lead/knowledge
  planning and hardening changes;
- exact-main push CI run `31820931774` is green for Main CRM, EVO Inbox and EVO
  Lead Agent; Changed range is skipped on the push event as expected;
- the preserved P4B branch passed focused tests, unit tests, lint, Next typegen,
  TypeScript and a production build. Its later full local Supabase run failed
  closed in the real Auth/PostgREST hook before Playwright; the run is not P4B
  acceptance evidence. Read-only cleanup verification found zero exact
  `evo-platform-local` container, volume, network, process or lock;
- the root application still uses SQLite and its own authentication model;
- root `/whatsapp` still uses local `wa_*` shadow tables, now with the
  provider-free P1D object-scope containment merged;
- EVO Inbox still owns a separate Supabase model and its `evo-inbox` WAHA path;
- EVO Lead Agent is deployed but frozen: worker, auto-reply and outbound are
  disabled, while amoCRM readiness is false;
- production CRM/Lead Agent run revision `564332b4`; Inbox runs `a09a72fc`;
- `crm.evoadmissions.com` and `inbox.evoadmissions.com` have no DNS answers;
  the fallback CRM URL responds;
- WAHA session endpoints are private and returned `401` without a key during
  the read-only snapshot, so current session states were not re-proved;
- no full WhatsApp → amoCRM → Platform → AI decision → governed send/handoff → ACK → audit
  path has ever been proved.

These facts describe the present system. P1 work remains historical legacy
containment, not the future Platform data plane. Target-architecture documents
do not silently change production.

## 2A. Current planning priority

1. U0/#377 through U3/#380 are complete on merged reviewed PRs.
2. Complete U4/#381 from current `main`: canonical Sales qualification,
   eligible owner assignment, paired next action/deadline and truthful
   connected/unconnected queue filters with durable audit.
3. Prove U4 through disposable-local Supabase/PostgreSQL/Auth/PostgREST/browser
   acceptance, exact-head review and required CI, then stop before U5/#382.
4. Execute U5-U14 strictly in dependency order. A stale draft contributes only
   the value assigned by the crosswalk and is rebuilt from then-current `main`.
5. Keep outbound WhatsApp and amoCRM writes disabled. No U4 action may touch
   production, providers, DNS/TLS, WAHA sessions or customer data.

No mock, SQLite shim, hardcoded provider mapping, fake success or silent
fallback may replace real evidence. Missing provider or managed-environment
authority is a blocker at the applicable later slice, not a reason to weaken
the contract.

## 3. Non-negotiable business contract

### 3.1 Roles, ownership and handoff

- First-pilot roles are `sales`, the existing canonical admissions role
  presented as Admissions Manager, and `admin` presented as Director/Admin.
  Payment and contract confirmation are explicit permissions. Finance is a
  module used only through those permissions, not a fourth pilot role. Student
  Portal follows in a later approved milestone. There is no separate `visa`
  role; `/visa` remains a module.
- Admin is a permission bundle for individually identified authorized staff.
  Shared credentials are forbidden. Only Admin invites or blocks staff and
  assigns or reassigns a Curator.
- Curator reassignment requires a reason, before/after values and audit.
- One assigned Curator owns the whole student case: documents, multiple
  university applications, visa, tasks and communications.
- Sales owns pre-handoff work until EVO records both a confirmed contract and
  the first mandatory payment. The audited handoff creates or updates one
  Student Case, assigns Admissions ownership and creates starter work. A
  Director/Admin override requires a reason, actor, timestamp and immutable
  audit event. Conversation history and provenance remain unified.
- Student Portal is a later milestone and is not a first-pilot gate.
- Curator/Admin may close or reopen a student case only with a reason and audit.

### 3.2 Operational policies

- Finance v1 is a manual operational source inside EVO Platform. Only a staff
  actor with the explicit payment-confirmation permission may confirm payment
  or refund with evidence and audit. Excel/1C import is a future integration,
  not a placeholder connector.
- Notifications v1 are durable in-app records with persisted self-read state.
  The receive-only stage creates, claims, routes and dispatches no WhatsApp
  notification. Any later external delivery requires a separate owner-approved
  write-stage contract. Broadcasts and mass sends are out of scope.
- Documents are private PDF/JPG/PNG, at most 25 MB, versioned and protected by
  integrity/malware policy, review/rework history and audited access. No
  irreversible auto-delete is allowed before Legal/Data Owner sets retention.
- One student may have multiple simultaneous university applications.
- Visa states include `not_required`, `not_started`, `docs`, `appointment`,
  `submitted`, `approved`, `rejected` and `closed`. Curator owns the case;
  external outcomes require evidence.
- EVO guarantees only its own contracted services and obligations. Copy and AI
  knowledge must not guarantee admission, scholarship, visa or any external
  authority decision.

### 3.3 Communications and AI

- Draft language follows the last customer message when it is confidently RU
  or EN. Otherwise the system requires manual language selection or handoff.
  Kyrgyz customer-draft generation is not an approved first-release contract.
- Gemini uses approved, versioned knowledge and Platform-owned memory only and
  emits a structured advisory proposal; it never receives a WAHA send or state-
  mutation capability. A human must accept, edit or reject every proposal.
- The first live stage has no outbound WhatsApp, manual or autonomous. Any later
  external-write stage requires a separate owner decision and real rollback.
- Media-only inbound is persisted and shown to the operator; until an approved
  media-understanding path exists it creates a human handoff and is never
  terminally consumed merely because text is absent.
- Unknown send outcomes are never automatically retried.
- The new platform must absorb phone normalization, WAHA HMAC and idempotency,
  raw-event persistence, buffering/jobs, temporary amoCRM read/import,
  handoff, retry/dead-letter and reconciliation. Legacy auto-reply code and the
  superseded ADR 0019 autonomous lane must not be copied into active v1 work.

### 3.4 Business workflow contract

Source boundary:

- Discovery input is the Ultimate EVO Google Doc and its accessible subtabs:
  <https://docs.google.com/document/d/1-ZrRawX2gdCmwz-vq8vYEBXnzSDVC-10wUeCuPhwlaA/edit>.
  It was reviewed read-only on 2026-07-30. GitHub remains runtime and
  implementation authority.
- Linked Drive/Sheets/PDF/Notion resources are source-aware import inputs, not
  Platform databases or public runtime dependencies. Source URL, source
  version/revision when available, review status, reviewer role and reviewed-at
  timestamp must be preserved. Customer rows, student folder names and
  sensitive documents must not enter Git, fixtures or logs.
- The linked China checklist is a 21-page operational source. It may seed a
  draft country overlay only with owner-review metadata and must not be
  represented as current legal, university or consular authority.
- The linked university Notion catalog requires AbdyldaYT workspace sign-in.
  University import is blocked until authorized access and verified records
  exist. Colleges has no confirmed source data and remains empty.

Confirmed requirements:

- OP is the sales lifecycle governed by canonical EVO/Supabase records.
  Temporary amoCRM imports may map external stages with provenance. Active
  candidate stages are
  `new`, `contacting`, `qualified`, `meeting_scheduled`, `meeting_completed`,
  `potential` and `contract_signed`. `no_answer` and
  `meeting_not_attended` are active follow-up outcomes, not terminal lifecycle
  states. Event/collaboration labels are sources or deal types. Closure uses
  explicit won/lost state plus a reason; legacy columns are imported with
  provenance and are not copied blindly into Platform enums.
- A confirmed contract plus first mandatory payment creates the audited
  OP-to-OZO handoff. The handoff
  records approved commercial fields, unresolved questions, promises already
  made, next step, due date and responsible role. Contract confirmation is not
  inferred from chat text.
- OZO uses one common admissions lifecycle:
  `intake`, `profile_and_route`, `documents`, `applications`, `decisions`,
  `visa_and_predeparture`, `arrival_and_adaptation`, `completed` or `closed`.
  University applications, document slots, visa, finance, housing, insurance
  and travel keep their own statuses; country-specific amoCRM columns do not
  become separate hardcoded applications.
- China, Italy, Czech/Poland, UAE/Turkey and Malaysia are versioned country
  overlays of requirements, templates, rules and checklist items. Each overlay
  records source provenance and approval state and can be retired without
  rewriting historical student cases.
- Student Profile has a country-neutral minimum core: preferred/legal display
  names where required, contact and communication language, date of birth only
  where required, citizenship/residency, current education, target
  country/level/program/intake, academic/language summary, budget band,
  decision participants, consent and next step. Sensitive identifiers or files
  are collected only when a versioned requirement needs them and through the
  private document path.
- Document requirements create case-specific checklist slots with owner, due
  date, status, correction reason and evidence. A checklist item never proves a
  document valid merely because a file exists.
- Contract templates use only approved, typed fields. Generated contracts and
  post-contract reports are versioned drafts until authorized staff approval;
  generation and approval are audited.
- Q&A is a versioned decision backlog with question, answer, owner role,
  status, source/evidence, affected requirement and effective version.
  Unanswered questions remain visibly unresolved and cannot be converted into
  silent defaults.
- Lead Manager system prompt, business context and country knowledge are
  separately versioned and approved. AI produces RU/EN drafts only; Kyrgyz or
  uncertain language requires manual language selection. Staff review/edit is
  mandatory; first-stage acceptance sends no WhatsApp message.
- Finance remains the already-approved obligations/payments/refunds evidence
  surface. Empty Accounting/Bema input does not authorize a general ledger,
  tax or bookkeeping subsystem.

Reversible assumptions pending owner evidence:

- Empty OP real-flow slots #1-#4 are represented by the normalized v1 sales
  lifecycle above, not by invented employee-specific automation.
- Empty OZO real-flow slots #1-#5 are represented by the common admissions
  lifecycle and country overlays above.
- Country overlay changes affect new checklist instantiation by default;
  existing cases retain their applied version unless an authorized, audited
  rebase is requested.
- A source import begins as reviewable staging with validation errors and
  provenance; it never writes directly into approved catalog/knowledge or
  student cases.

## 4. Target technical contract

### 4.1 Supabase and Next.js

- Root `supabase/` is the sole repository migration authority, with
  `supabase/config.toml`, clean reset/diff/pull discipline and one ordered
  history. P2A moves the current Inbox migrations 001–039 there byte-for-byte,
  records their checksums and creates no migration 040.
- Merged migrations are immutable. At the historical P2A checkpoint, P2B began
  with the then-next available number `040`; current history is `001-071`, and
  every later block must recheck the next-free ordinal immediately before use.
  A later defect receives a new forward migration and never rewrites merged
  history.
- Historical `public` Inbox objects remain immutable migration/archive inputs
  until an authorized forward retirement. No active behavior or compatibility
  path may depend on them. `platform` is the Data
  API/browser-exposed schema and receives explicit least-privilege grants plus
  RLS on every table. `platform_private` is backend-only and is never exposed
  through the Data API.
- The canonical Data API exposes only approved schemas, never
  `platform_private`. Browser roles receive no direct access to
  `platform_private` or `pgmq_public`; queue operations use narrowly granted
  service-only paths with negative tests.
- Legacy Inbox roles `owner`, `admin`, `agent` and `viewer` are not mapped
  implicitly to pilot roles. U10 may record one explicitly approved pilot
  case's bounded identity/context import with provenance, but it must not add
  a live migration/synchronization path. Legacy signup must not create new
  Platform authority or a compatibility bridge.
- Every exposed table has RLS. Browser code receives only the publishable key;
  secret/service-role credentials stay server-side.
- Custom JWT claims provide coarse role; organization, case, conversation and
  object scope are enforced in RLS and server authorization.
- Storage is private and accessed through authenticated/signed downloads or a
  server stream. Application code never writes Storage schema tables directly.
- Realtime channels are private and use simple RLS.
- Durable retryable work uses Supabase Queues. Database Webhooks may push
  asynchronous events but do not replace a durable queue.
- Database-resident secrets use Vault. If the selected plan includes PITR, its
  configuration and restore proof are recorded. Storage objects always require
  a separate backup.
- Next.js 16 server auth uses `@supabase/ssr`, `proxy.ts`, async `cookies()` and
  server authorization through `getClaims()`. Code must not trust
  `getSession()` as authorization evidence.

Primary sources:

- <https://supabase.com/docs/guides/deployment/branching>
- <https://supabase.com/docs/guides/database/postgres/row-level-security>
- <https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac>
- <https://supabase.com/docs/guides/storage/security/access-control>
- <https://supabase.com/docs/guides/queues>
- <https://supabase.com/docs/guides/auth/server-side/creating-a-client>
- <https://supabase.com/docs/guides/database/webhooks>
- <https://supabase.com/docs/guides/database/vault>
- <https://supabase.com/docs/guides/platform/backups>

### 4.2 amoCRM/Kommo

- Account, pipeline, status, custom-field and user IDs are discovered,
  cached and versioned per account; none is a global constant.
- The temporary adapter performs bounded reads/imports with provenance. Stage
  one performs no create, update or delete and builds no permanent two-way sync.
- Imported webhook/read events are persisted quickly, processed idempotently
  and reconciled against the canonical EVO record without loop-producing
  provider writes.
- Kommo `conversation.id` and `message.id` are stored separately from WAHA
  session/message IDs and internal UUIDs.

Primary sources:

- <https://developers.kommo.com/docs/limitations>
- <https://developers.kommo.com/docs/webhooks-general>
- <https://developers.kommo.com/reference/leads-list>

### 4.3 WAHA

- One session represents one WhatsApp number/account.
- Webhooks verify raw-body HMAC, timestamp and `X-Webhook-Request-Id`, then
  persist the raw event before processing.
- Deduplication uses both request ID and business key
  `session + payload.id`.
- `message.any` reconciles messages sent through the API.
- `message.ack` preserves exact ERROR/PENDING/SERVER/DEVICE/READ/PLAYED evidence.
- U3/U12 first-stage acceptance receives and projects messages only. It does
  not call send, send-seen/read or session-mutation endpoints.
- An unknown send result remains unknown and is never automatically retried.

Primary sources:

- <https://waha.devlike.pro/docs/how-to/sessions/>
- <https://waha.devlike.pro/docs/how-to/events/>
- <https://waha.devlike.pro/docs/how-to/send-messages/>

## 5. Ordered implementation blocks

Only one active U-slice implementation PR may be open. Historical draft PRs
listed in the U0 crosswalk remain frozen and do not count as active execution.
Shared plan, schema, migration and deployment surfaces are sequential.

| Slice | Issue | Scope | Status |
| --- | --- | --- | --- |
| U0 | #377 | Authority docs and complete legacy crosswalk | Merged prerequisite |
| U1 | #378 | One login and three pilot roles | Merged prerequisite |
| U2 | #379 | Canonical Supabase client and lead | Merged prerequisite |
| U3 | #380 | Receive-only WhatsApp in unified Sales | Merged prerequisite |
| U4 | #381 | Sales qualification, owner and next action | Merged prerequisite |
| U5 | #382 | Contract and first-payment evidence | Merged prerequisite |
| U6 | #383 | Audited Sales-to-Admissions handoff | Merged prerequisite |
| U7 | #384 | Complete Admissions case | Current Long-run 1 slice; blocked only by merged U6 |
| U8 | #385 | Minimal payment control and finance stop-factor | Blocked by U5/U7 |
| U9 | #386 | One Gemini Flash assistant with human review | Blocked by U7 |
| U10 | #387 | Net-new pilot cohort and legacy isolation | Blocked by U8/U9 |
| U11 | #388 | Admin health, audit, backup and rollback | Blocked by U1-U10 |
| U12 | #389 | Real managed receive-only acceptance | Blocked by U10/U11 |
| U13 | #390 | Ten-workday, five-case pilot | Blocked by U12 |
| U14 | #391 | Historical closed-record migration/archive | Blocked by U13 |

### Historical P/BW block inventory

The table and detailed P/BW contracts below are immutable implementation
history. They are not a parallel backlog. Reuse is allowed only through the U0
crosswalk and the acceptance criteria of the assigned U-slice.

| Block | Scope | Exit evidence | Current execution status |
| --- | --- | --- | --- |
| P0 | Final plan, corrected TZ/DOCX, target ADR and architecture docs | Deterministic DOCX, every page inspected, independent review | Merged in PR #75 |
| P1 | Current-app role/RBAC/handoff correction | Positive/negative route, action and object-scope tests; explicit visa-user migration report | P1A-P1D merged in PRs #76-#80 |
| P2 | Reusable Supabase-native foundation | Canonical history, local RLS/queue/Storage evidence, private document contract | P2A-P2H merged; former P2I restore duties transferred to P7 |
| BW0 | Business-workflow plan amendment | Confirmed/assumed requirements, dependency/file ownership, acceptance and source boundaries; deterministic TZ/DOCX evidence | Merged in PR #94 |
| P3 | Thin Supabase-native messaging slice behind the accepted frontend | Supabase Auth/RBAC, repository seams, real local persistence, conversation list/thread, draft/manual-send state and focused UI E2E | P3A-P3C merged in PRs #95-#97; no live-provider claim |
| P2R0 | Local Supabase reliability plan amendment | Current checkpoint, bounded ownership, exact validation and rollback/provider boundary | Merged in PR #104 |
| P2R1 | Local Supabase proof reliability repair | Real clean local Auth/RLS/Storage/PGMQ gate, deterministic deadline/cleanup tests and forward-only document lock-order repair | Merged in PR #105; migration 055 is immutable history |
| P2R2 | Auth-token and local reset reproducibility repair | Explicit issued-token `getClaims()` plus live authority; symlink-safe deadline execution; reproducible exact-project reset and cleanup | Plan merged in PR #109; superseded implementation PR #110 closed without merge after controller findings |
| P2R3 | Stale-authority session clearing and exact local-proof ownership | Same-origin Route Handler clears rejected Supabase browser state; real connected-route regression; two physical-worktree local proofs | Plan PR #111 and implementation PR #112 merged; exact-main CI green |
| P2R4 | Local Supabase startup/readiness prerequisite | Two-file harness repair and exact-main CI; later run outcomes remain scoped to their exact branch | Merged in PRs #129-#130; no provider or production proof |
| P4/P4R | Canonical amoCRM integration | Preserve P4B activation/write checkpoint; prove bounded read-only contact/lead/responsible/stage/tasks/call-chat references through versioned mappings, reconciliation and fail-closed degradation | P4B writes/activation deferred; bounded read-only P4R1 merged in PR #142 |
| P5 | Narrow Inbox/WAHA/Lead Agent capability absorption and controlled proof | Real persist-before-process, queue/projection, available history/media, ACK, realtime, staff takeover and structured AI proposal with deterministic reply-only send gates; no legacy cutover | P5A-P5F3 merged in PRs #132, #133, #137, #138, #141 and #144-#146; synthetic local proof only, provider/production proof blocked |
| P6 | amoCRM-independent Admissions, Portal, Documents, Finance and Notifications | Two-student isolation E2E and staff-to-portal workflows that do not infer sales identity/stage/handoff | P6A-P6D merged in PRs #148, #149, #152 and #153; synthetic/local proof only |
| P7 | Security, reliability and operations | Safe audit search/export, private observability, deferred managed recovery/capacity, and focused automated plus human accessibility evidence | P7-PLAN, P7A, P7B and the focused P7D contract merged; P7C recovery and large capacity stress deferred; exact-candidate evidence remains in P8 |
| P8 | Narrowed controlled release-evidence gate | Prepare one immutable candidate, prove executable P5-P7 plus P4R reads, and record unavailable segments; no production action without approval | P8A contract tracked in #175; P8B-P8F follow only under `docs/platform/p8-controlled-release-candidate.md` |
| P9 | Removed from current execution scope | Lead Agent, legacy webhook/session and rollback path remain deployed/frozen; no retirement/deactivation PR | Removed by owner decision |
| P10 | Authorized-scope audit | Map P4R/P5-P8 scope to evidence, list P4B writes/activation deferred and Lead Agent retained, separate verified/blocked/deferred; no full-platform completion claim | Pending directly after P8 |

BW0, P3A-P3C, BW1-BW7, P2R0-P2R4, P4A and PR #128 are merged. PR #112
satisfied the stale-authority/local-proof gate, PR #113 merged BW5, PR #114
merged BW6, PR #116 merged BW7 and PR #117 merged P4A with green exact-main
CI. PR #118 merged the P4B plan; PRs #129-#130 merged P2R4. P4B work is
preserved at `e53ba94954f147b295f596421a255591fa343ce8`, but its full local gate
failed before Playwright and remains non-evidence. P4B mapping activation and
writes stay deferred; this amendment separately resumes only P4R read-mostly
context after the messaging foundation. P6 through P8 may proceed without P4B
only where they do not require canonical Sales ownership, stage mutation or
automatic handoff. P6 and P7A are now complete. Within that
independent-from-P4B scope, the authorized execution order is P7B, P7C, gated
P7D, narrowed P8 and then P10. The historical
BW dependency and exit-evidence contract below remains reference evidence, not
permission to substitute for either P4R proof or P4B:

| Block | Contract | Dependency and exit evidence |
| --- | --- | --- |
| BW1 | Workflow/domain contracts and source registry without PII | P3C merged; next-free forward migration only if schema is required; clean reset, RLS/grant tests, provenance/version tests |
| BW2 | OP/OZO repositories/actions behind existing Sales, Client and Application screens | BW1; amoCRM remains external sales authority; no localStorage/demo fallback; positive/negative authorization and audit E2E |
| BW3 | Manual operational Student Profile and country requirement/checklist workflow | BW2; private Storage foundation; minimization, version retention, cross-student denial and staff/portal E2E; no document-reading/autofill/export automation |
| BW4 | Approved knowledge, prompt lifecycle, decision backlog and handoff | BW3 and P3/P5 messaging seams as applicable; structured proposal, deterministic send/handoff proof, RU/EN and manual-language failure path |
| BW5 | University/college catalog and reviewable import boundary | BW4; source access required for real import; provenance, validation/rejection and no-direct-approval tests |
| BW6 | Contract draft generation and post-contract checklist/report | BW5; approved typed fields only; authorization, immutable version and audit proof |
| BW7 | Latest-main integration and end-to-end workflow proof | BW1-BW6; real local/staging Supabase path through the accepted frontend, no production/provider claim without real exercise |

### Historical P2R2/P2R3 repair contract and provider boundary

- Prior trigger: controller review of PR #108 at exact head
  `f719b749efaadaf02c6344c5d01cd4b6bbe3d79c` found that the repair was outside
  the active sequential plan and that a fresh physical-path local Supabase run
  exited non-zero after two migration/reset attempts. PR #108 was closed without
  merge; its branch is recovery evidence only. PR #109 then merged the bounded
  P2R2 plan gate.
- P2R3 trigger: controller review of PR #110 at exact head
  `fd4428451793bdc59b3b183dcc9dde7518e80201` found that
  `requirePlatformActor()` redirected invalid live authority to `/login` but
  did not clear the resident Supabase browser cookies. Next.js 16 permits cookie
  mutation only in a Server Function or Route Handler, so the original P2R2
  file list cannot honestly satisfy its already-approved stale-session
  acceptance. The same controller could not reproduce the required second
  physical-worktree local Supabase gate because the OrbStack Docker endpoint
  timed out. PR #110 was closed without merge; its branch remains a recovery
  point only.
- P2R3 may rebuild the original prerequisite server-auth and local-proof
  surfaces:
  `src/lib/actions.ts`, `src/lib/platform-auth.ts`,
  `scripts/run-command-with-deadline.mjs`,
  `scripts/test-supabase-auth-hook.mjs`,
  `scripts/test-supabase-local-reset.sh`, and their focused tests in
  `tests/platform-auth-config.test.mjs`,
  `tests/run-command-with-deadline.test.mjs`,
  `tests/supabase-auth-hook-harness.test.mjs` and
  `tests/supabase-local-reset-harness.test.mjs`.
- P2R3 additionally owns only the missing stale-session handoff surfaces:
  `src/lib/platform-guards.ts`, `src/proxy.ts`,
  `src/lib/supabase/auth-cookies.ts`, the new exact Route Handler
  `src/app/auth/platform-session/route.ts`, and the existing real local browser
  suite `tests/platform-auth/platform-auth.spec.ts`. No other application,
  migration, provider or workflow file enters this block.
- Login must require the just-issued Supabase access token, verify that exact
  token with `getClaims(accessToken)`, and then resolve the live fail-closed
  database authority bundle. `getSession()` remains untrusted for server
  authorization; self-registration and legacy/root-auth fallback remain
  forbidden.
- A protected connected Platform route that resolves invalid claims, blocked or
  inactive membership, stale access-version authority, or authority RPC failure
  must redirect to the exact same-origin Route Handler. The handler must resolve
  `getClaims()` plus live authority again using response-writable Supabase cookie
  methods: a recovered valid actor returns to the role home without logout;
  authority that remains invalid or unavailable attempts local Supabase sign-out
  and expires only this Platform project's auth-token cookie and chunks before
  redirecting to `/login` with a bounded error code. Query parameters are never
  authorization evidence. Legacy root-auth cookies remain untouched.
- A real disposable local browser regression must start authenticated, revoke
  or version-stale the actor's live authority, request a connected protected
  route, and prove the final login state contains no Platform Supabase auth
  cookie. It must also prove that directly requesting the handler does not clear
  a still-valid actor. Static source assertions alone do not satisfy this gate.
- Deadline execution must invoke the intended child and propagate its real exit
  status from both logical symlink and physical worktree paths. A wrapper that
  silently exits zero without running its child is a failed gate.
- The exact-project local path must complete migrations 001-055, Auth,
  PostgREST/RLS, accepted-frontend browser checks, private Storage and PGMQ with
  a real exit zero. Reset/start/restart waits remain bounded; retries are only
  for classified transient readiness failures; safe diagnostics must identify
  the failed phase without exposing local keys, cookies or payloads.
- Cleanup must prove zero resources and zero singleton lock for exact label
  `com.supabase.cli.project=evo-platform-local` while preserving every Inbox
  container and volume. Broad prune, Docker daemon restart and unrelated stack
  mutation are forbidden.
- Exit evidence requires focused regression tests, executor real local proof,
  a fresh independent physical-worktree reproduction, all four exact-head CI
  jobs, a new SHA-bound reviewer approval and controller merge. The executor
  and independent proof must each run from a fresh physical worktree with a
  responsive existing Docker endpoint; Docker daemon restart is not evidence
  remediation. P2R3 adds no
  migration and cannot claim managed Supabase, providers, production, restore
  or cutover proof; `real-provider-proof: not-required` remains the truthful
  provider boundary.

### P2R4 — merged local Supabase startup/readiness repair

P2R4 was a narrow repair block merged through PRs #129-#130; it did not revive
PR #122 or any reverted BW8 work. Its historical trigger was evidence from main
`bb9d766163267846f406dcc376e893bb2a914af4`: with Node `22.23.1`, the
project-local Supabase CLI `2.110.0` and Docker context `orbstack`, the exact
repo command `npm run test:supabase:local` exited `1` after the bounded
`supabase start` phase timed out. The normal cleanup completed with zero exact
`evo-platform-local` containers, volumes and networks, no singleton lock or
process, and no change to the Inbox resource set. This failure happened before
P4B work and means the required real local acceptance gate is not currently
reproducible from main.

P2R4 implementation ownership is limited to:

- `scripts/test-supabase-local-reset.sh`;
- `tests/supabase-local-reset-harness.test.mjs`.

The implementation contract is:

- keep all Supabase operations strictly local and exact-project scoped; never
  use `--linked`, `--project-ref`, `--db-url`, `stop --all`, broad prune, Docker
  daemon restart or unrelated-stack mutation;
- use the CLI-supported `supabase start --ignore-health-check` only as a startup
  escape hatch. Because that command may return success while a service is
  unhealthy, immediately require bounded, fail-closed readiness for Database,
  PostgREST, Auth, Storage, Kong and the CLI status before migrations, seeding
  or browser gates continue;
- preserve canonical immutable migrations `001-058` and the official local
  reset path. Migration list/order must equal the repository exactly; migration
  `059` is not reserved and no migration-repair ledger mutation is authorized
  by this block;
- keep the existing classified post-reset Storage/Kong recovery bounded to its
  exact known signature and exact local project. Unknown, unclassified or
  repeated failures fail immediately; no general retry policy is permitted;
- prove Auth, live RLS/record scope, private Storage, PGMQ and the accepted
  browser scenarios on the rebuilt local stack;
- capture exact Inbox container IDs, volume names and network IDs before the
  run and require the identical sets after cleanup. Also require zero exact
  Platform resources and zero singleton lock/process after every exit path.

P2R4 exits only when focused positive and negative harness tests pass and both
the executor and an independent controller run the exact repo-scoped local gate
from clean state with exit `0`, complete cleanup and unchanged Inbox identity.
The implementation PR also needs `git diff --check`, scoped secret scanning,
all four exact-head CI jobs, an exact-SHA independent review and controller
merge. Exact-main CI `31038964366` is green. This historical dependency is now
satisfied, but it does not authorize P4B: P4/P4B is separately owner-deferred
under ADR 0018, and its later failed branch run remains non-evidence.

P2R4 changes no application/frontend behavior, schema, API, domain/TZ/DOCX,
credential, provider, staging or production state. It provides local validation
evidence only; `real-provider-proof: not-required`.

### Merged BW5 contract and remaining provider boundary

- BW5 re-fetched `origin/main`, selected the next-free migration 056 and merged
  in PR #113. Migrations 055 and 056 are now immutable history; BW6 owns only
  the next-free migration 057 selected from main `1061bad8...`.
- BW5 may add only bounded, PII-free university/college source metadata,
  revision-pinned staging candidates, explicit validation, and audited Admin
  approval or rejection behind the accepted `/applications` frontend.
- Staging or validation must never directly publish approved catalog rows or
  mutate student applications. Approved catalog reads remain role- and
  organization-scoped, and catalog-backed application creation must preserve
  the existing student-case object-scope contract.
- Acceptance requires provenance stability, validation/rejection and
  no-direct-approval tests, positive and negative role/tenant/object-scope
  evidence, and rollback notes for an additive unapplied migration.
- The real Notion university source still requires authorized AbdyldaYT access,
  and no confirmed college dataset exists. BW5 must not invent records or claim
  real import, managed Supabase, amoCRM, WAHA, AI-provider, production, restore
  or cutover proof.
- P2R3 and BW5 are controller-merged with green exact-main CI. Any later BW5
  correction requires a new bounded block; subsequent work must not rewrite
  migration 056 or absorb the still-blocked real source import.

BW1-BW7 must not edit a migration number/schema file owned by another open PR.
Before every block, fetch `origin/main`, inspect open PRs and select the next
free migration only after dependency merge. P3 owns common Supabase
session/repository seams; P4 owns amoCRM adapter behavior; P5 owns real
WAHA/AI/ACK provider proof. Business workflow blocks consume those seams and
must not duplicate them.

### P0 — plan and target architecture

P0 is docs-only. It creates this contract, updates the launch plan and append-only
decision log, corrects the canonical TZ and deterministic DOCX, updates
`CONTEXT.md`, platform/design/business documents, and adds a superseding ADR
for companion-era ADRs 0002/0006/0008/0009. No code changes may begin before
P0 is independently reviewed and merged.

### P1 — role, scope and handoff correction

Remove the business `visa` role from domain, database, seeds, actions, queries,
i18n and tests while preserving visa routes/entities/icons. Existing visa users
must be reported and explicitly migrated to Curator; silent coercion is
forbidden. Replace broad client manager/curator mutation with an Admin-only
reasoned, before/after audited action. Enforce Sales-before-contract,
Curator-after-handoff, limited Sales summary and portal activation gating.

P1 is delivered as sequential sub-blocks:

| Sub-block | Contract | Status |
| --- | --- | --- |
| P1A | Remove the business `visa` role with explicit migration/reporting | Merged in PR #76 |
| P1B | Admin-only Curator assignment and audited case lifecycle/handoff | Merged in PR #77 |
| P1C | Current-app case/task object scope and post-handoff projections | Merged in PR #78 |
| P1D | Harden current-root WhatsApp conversation object scope | Merged in PR #80 |

#### P1D — current-root WhatsApp object scope

Block-ID: `EVO-P1D-ROOT-WHATSAPP-AUTH-2026-07-28`.

P1D is a temporary authorization-hardening block for the root CRM's existing
SQLite/custom-auth `/whatsapp` path and local `wa_*` shadow tables. It does not
make that path the target unified communications backend and does not prove a
live provider.

Conversation scope uses the existing links in this order:

1. When `wa_conversations.client_id` resolves, the student-case assignment and
   lifecycle govern only when `lead_id IS NULL`, or when a non-null `lead_id`
   resolves and its `leads.client_id` is null or points to the same case. A
   pending case belongs to its responsible Sales user. An active or closed case
   belongs to its assigned Curator, while the former responsible Sales user
   receives only the safe post-handoff summary.
2. Lead-only Sales access requires `wa_conversations.client_id IS NULL`, a
   resolved `lead_id`, and `leads.client_id IS NULL`.
3. If the lead already points to a case while the conversation does not, the
   direct and indirect case links conflict, a required link is broken, or an
   owner is missing, or a resolved case has an invalid lifecycle state, every
   non-Admin actor fails closed until reconciliation. The implementation does
   not guess or repair association data.
4. When direct and lead-derived case links are both present and consistent, the
   student-case/handoff rule takes precedence.

Because this temporary rule trusts the local shadow `leads.manager_id`, that
field is protected as authorization input in P1D. A Sales-created local lead
ignores any submitted `manager_id` and is assigned to the authenticated Sales
actor. A Sales profile update is allowed only for a lead already assigned to
that actor and preserves the existing `manager_id`, even when a forged value is
submitted. Only Admin may select or reassign the temporary local owner, and the
selected non-null owner must resolve to an active `sales` account. These local
controls do not claim or perform a canonical amoCRM `responsible_user_id`
write; P4 owns that adapter and reconciliation boundary.

| Actor and state | Queue/detail | Transcript and sensitive provider fields | Draft/send/read | Manual conversation create |
| --- | --- | --- | --- | --- |
| Admin | All conversations, full detail | Full current-root data | Allowed through existing manual/provider guards | Allowed |
| Responsible Sales, proven lead-only or directly linked pending case | Own queue and full detail | Full | Allowed through existing manual/provider guards | Denied in P1D |
| Same Sales after handoff | Safe summary only | No transcript, phone, message preview, amoCRM IDs, WAHA IDs, agent draft/reason fields or deep links | Denied | Denied |
| Assigned Curator, active/closed case | Assigned queue and full detail | Full current-root data; no unrelated Sales deep link | Allowed through existing manual/provider guards | Denied |
| Other Sales/Curator, Finance or Student | None | None | Denied | Denied |
| Unlinked, indirect-case, conflicting-link, broken-link or ownerless conversation | Admin only | Admin only | Admin only | Admin only |

The Sales post-handoff projection may contain only case ID, student display
name, target country/degree, case state, assigned Curator display name and
handoff timestamp. It must be selected as a safe SQL projection; restricted
conversation/message/provider fields must not be loaded and filtered later.
It returns at most one static row per case and may be ordered only by those
allowlisted case fields; conversation count, multiplicity and message recency
must not leak through duplicate rows or ordering.

The list, direct detail route, message query, lead-page conversation lookup,
WhatsApp-derived shared lead/cockpit metrics used by Sales, dashboard, calls
and tasks, `sendWaMessageAction`,
`markConversationReadAction`, `createConversationAction`, and `/api/ai/draft`
must enforce the same actor/object policy. Recency, message-count, unread,
response-time and aggregate fields must not become a covert conversation-data
channel for summary-only or denied actors. Denials are generic and occur before
any message read, database mutation, AI call or WhatsApp provider call. UI
controls, including shared TopBar create shortcuts, that cannot succeed for the
current actor are not rendered. The same block hardens `addLeadAction`,
`updateLeadAction` and their manager selectors so caller-controlled local
ownership cannot manufacture conversation access. Server Actions and the AI
route re-authenticate and re-resolve the current object immediately before the
protected read or side-effect boundary; a stale page captured before handoff
cannot reuse prior authorization.

P1D acceptance requires positive and negative local integration tests that
exercise production code paths with synthetic data only and no
production/provider mutation. They cover Admin, responsible/unrelated Sales,
assigned/unassigned Curator, Finance and Student; pre/post-handoff transitions;
linked, broken-link and unlinked conversations; a valid direct case with a
non-null unresolved `lead_id`; proven lead-only rows; indirect lead-to-case
links; conflicting direct/lead case links; invalid case lifecycle state;
derived lead/dashboard metric suppression; Admin-only TopBar create controls;
shared-query non-read evidence;
direct routes; replayed Server Actions; forged Sales lead creation/update owner
values; an unrelated Sales takeover attempt; and AI denial before the provider
boundary. Denied actions must leave SQLite unchanged, while an allowed Sales
profile update must preserve its pre-existing owner. Authorized provider success
is outside this block and must not be mocked into a provider claim. P1D proves
authorization before invocation only; WAHA `WORKING` readiness, account-routing
fallback removal and delivery correctness remain P5 provider gates.

P1D changes no schema and performs no live send, provider mutation, WAHA
session/webhook change, Supabase bridge, unified history, ACK/outbox/retry,
reconciliation or Lead Agent absorption. Those remain P4/P5 work. Rollback is a
code-only revert. The detailed amendment is
`docs/platform/p1d-root-whatsapp-scope.md`.

### P2 — unified Supabase foundation

P2 is sequential and additive. Its detailed contract is
`docs/platform/p2-supabase-foundation.md`.

| Sub-block | Contract | Required exit |
| --- | --- | --- |
| P2A | Make root `supabase/` canonical; move 001–039 byte-identically; add pinned local CLI/config, checksum manifest and relocated tests; create no 040 | Clean local reset and migration list, byte/checksum identity, equivalent legacy schema/RLS inventory |
| P2B | Begin at the next free number (expected 040); establish `platform`/`platform_private`, explicit/default grants and verified legacy secret-bearing-column containment without flipping legacy buckets | Current Inbox compatibility, safe projections/server paths and browser negative-grant matrix |
| P2C | Add organizations, profiles, memberships, five business roles/scopes and base append-style audit | Admin/Sales/Curator/Finance/Student positive matrix and cross-role/cross-organization denials |
| P2D | Add cases, assignment/handoff history, applications, visa and tasks | Two-organization/two-student lifecycle and object-scope denials |
| P2E | Add document metadata/version/review, finance/evidence and durable notification state | Curator/Finance/Student negative matrix; no file-upload claim yet |
| P2F | Add conversations/messages, participants, distinct WAHA/Kommo/amo mappings, raw events, approved knowledge and draft-only AI records | Transcript/handoff isolation and append/server-write boundaries; no live-provider claim |
| P2G | Add real Supabase Queues/PGMQ, outbox, idempotency, dead-letter and reconciliation/conflict state | Local service retry/visibility/dedupe/concurrency evidence; unknown delivery never re-enqueued automatically |
| P2H | Add new private Platform document/media buckets and policies through the real local Supabase Storage API | MIME/25 MB and cross-student/cross-organization denial; audited authorized access |
| P2R1 | Repair the merged local proof path without widening product scope: bounded process-group deadlines, exact-label cleanup, transient-only Auth readiness, deterministic PGMQ leases, and a next-free forward migration for document finalization/review lock order | `npm run test:supabase:local` exits zero against real local services; exact-label resources and singleton lock are absent after cleanup; Inbox state is preserved; disposable PostgreSQL authorization, unit/security, lint, typecheck, build, scenarios, E2E/a11y and scoped secret checks pass |
| P2R4 | Repair only the current local startup/readiness harness after fresh unchanged-main OrbStack failure | Two independent clean `npm run test:supabase:local` exits `0`; exact migrations `001-058`, Auth/RLS/Storage/PGMQ/browser gates pass; exact Platform cleanup and Inbox identity preservation pass |
| P2I | Superseded in this lane; restore duties transfer to later reliability work | Later reliability work owns clean reset, RLS/grant/secret inventory, browser secret scan, isolated DB restore and separate Storage-object restore |

P2 does not rename or drop legacy Inbox tables, cut root authentication over,
copy real secrets into Vault, change legacy public bucket behavior or apply any
production migration. New Platform tables are additive. P2B must verify actual
current Inbox consumers before revoking a legacy table grant. `avatars` and
`flow-media` remain explicit compatibility decisions; new private Platform
buckets are introduced only in P2H.

### P3 — thin Supabase-native messaging slice

Keep the accepted root frontend from PRs #64, #71 and #72 and replace only its
legacy data/session seams for the bounded messaging path:

- use Supabase Auth through server-verified claims and five-role authorization;
- implement Supabase-native repositories/actions for `/login`, the staff shell,
  `/whatsapp` and `/whatsapp/[id]`;
- persist conversation/message/draft/manual-send/audit state in the greenfield
  Platform schemas;
- preserve the existing screen structure, design language, responsive behavior
  and accessibility contract;
- fail closed for missing membership, object scope or provider readiness.

P3 imports no legacy SQLite records or accounts, maps no legacy root identity,
and creates no dual-read or dual-write bridge. Existing non-messaging screens
remain the accepted future UI contract but must not present prototype state as
authoritative live data.

P3 is delivered sequentially to keep each PR reviewable:

| Sub-block | Contract | Required exit |
| --- | --- | --- |
| P3A | Supabase SSR/server session, verified claims, organization membership/RBAC, `/login` and staff-shell authorization behind the existing UI | Positive/negative login, expiry, blocked-user, role and cross-organization tests; no legacy-account import |
| P3B | Supabase conversation list/thread repositories and actions behind existing `/whatsapp` pages | Real local Supabase reads with two-organization/object-scope denials and browser E2E; synthetic records labelled non-provider evidence |
| P3C | Approved-knowledge selection, draft review/edit, manual-send authorization/outbox/audit and fail-closed integration health behind existing components | Local persistence/idempotency/audit E2E; no provider invocation or success claim when WAHA/AI is unconfigured |

P3A-P3C are merged in PRs #95-#97. Their evidence proves the local greenfield
session, repository and manual-send state seams only; it does not prove live
amoCRM, WAHA, delivery ACK or AI-provider behavior.

P3 proves the greenfield application seam and local product workflow. Real
amoCRM mapping is P4 evidence; real WAHA receive/send/ACK and AI-provider proof
are P5 evidence.

### P4 — canonical amoCRM adapter

P4A, merged in PR #117, discovers and versions sanitized account-specific
mapping evidence through a GET-only server adapter, service-only persistence
and live-authority Admin reads. Discovery versions remain immutable and have
no active flag.

The P4B plan merged in PR #118. Its current implementation checkpoint is safely
stored on remote branch `izzhackt/evo-platform-p4b-mapping-approval` at
`e53ba94954f147b295f596421a255591fa343ce8`; no P4B implementation PR exists.
Focused tests, unit tests, lint, Next typegen, TypeScript and production build
passed. The attempted full local Supabase gate failed closed in the real
Auth/PostgREST hook before Playwright, so it is failed/non-evidence and does not
prove mapping approval or a real amoCRM account.

P4B mapping activation and every amoCRM write remain deferred. The owner now
authorizes a separate bounded P4R read-mostly lane after the messaging
foundation: versioned account discovery/mappings may read contact, lead,
responsible manager, sales stage, tasks and call/chat-record references for
operator context. P4R must use provider-issued identifiers, account-specific
mappings, webhook/poll reconciliation and explicit stale/degraded state. It may
not create/update leads, tasks or stages, approve mappings silently, infer
contract handoff, or replace unavailable data with a mock, SQLite shim,
hardcoded mapping, fake provider or cached-success claim. Broader P4B resumes
only under a later owner decision, fresh-main gate and exact-head review.

### P5 — unified communications

Absorb only the agent-facing messaging capability: available WhatsApp history,
conversation list/thread, necessary operator context, private media,
WAHA receive/send, ACK/delivery, approved-knowledge retrieval, Platform-owned
lead memory, true realtime, gated RU/EN AI qualification/replies, staff
takeover/manual send, audit and minimal messaging health/settings. Keep
distinct internal, WAHA and Kommo identifiers.
Role-scoped queues may use only Platform-owned authority that is valid without
amoCRM; P4R read context does not grant amo-derived Sales ownership or handoff,
which stay unavailable until separately approved P4B authority. Broadcasts,
flows, campaigns, standalone Inbox
CRM/dashboard/pipeline/deal/lead surfaces, unrelated analytics/settings, cold
outbound, autonomous follow-ups and re-engagement remain excluded. Do not
switch the old webhook/session or enable autonomous sending without controlled
proof and separate production authorization.

P5 is decomposed into small launch-control blocks. P5A and P5B are merged.
P5B was accepted under the following exact contract, which remains its runtime
boundary:

- private route `POST /api/internal/platform-messaging/waha/work`; it accepts
  no request body and is invoked only by a private scheduler;
- request headers are `X-Evo-Worker-Request-Id` (UUID),
  `X-Evo-Worker-Timestamp` (Unix milliseconds),
  `X-Evo-Worker-Hmac-Algorithm: sha256` and `X-Evo-Worker-Hmac`, the lowercase
  HMAC-SHA256 of `<request-id>.<timestamp>`;
- server-only configuration is disabled by default. The worker may claim only
  verified inbound `provider_webhook_process` work for the configured
  organization, exact `evo-inbox` session and `waha:evo-inbox` account;
- claim/project/finish RPCs are service-only, tenant/session/provenance bound,
  leased and bounded. An invalid repository result is never finished; its lease
  expires for safe retry. Exhausted work moves to explicit manual review/dead
  letter, never silent success;
- WAHA-only conversations use `sales_authority_source='platform_intake'`. This
  is intake-queue authorization, not canonical amoCRM Sales ownership;
- raw WAHA chat/message identifiers live only in private append-only bindings.
  Browser-visible rows expose no phone-bearing provider identifiers;
- valid media-only inbound remains pending/actionable and operator-visible. It
  must not be terminally finished because the text body is absent;
- this block makes no provider call, customer send, amoCRM write, production
  migration or legacy cutover. Its additive migration is rolled back by
  keeping flags off, reverting code and forward-fixing schema; no destructive
  down migration is allowed and the legacy path remains available.

P5C merged the available-history backfill/reconciliation lane. P5D merged only
private media archival and authorized display. P5E then merged ACK/session
projection and private Supabase Realtime invalidation so the accepted UI can
refetch durable provider state without the former polling loop. All three
accepted capabilities precede the AI reply lane.

The AI lane was the required block group after merged P4R1 and was implemented
as `EVO-P5F-AI-MEMORY-REPLY-LANE-2026-08-10`. P5F1-P5F3 are now merged; P6 is
the next active group.

#### P5F1 — Platform-owned memory and retrieval foundation

P5F1 SHALL add only the additive `065` foundation for staff-controlled
conversation-scoped memory, explicit facts, qualification state,
takeover/pause state, approved-knowledge chunks, retrieval audit, RLS and
pgvector. Supabase SHALL own this durable state; per-client filesystem agents
SHALL NOT be introduced, and Gemini state/cache SHALL NOT be a source of
truth. The embedding target SHALL be `gemini-embedding-2` at a fixed `1536`
dimensions. Provider ingestion remains disabled by default and provider proof
remains blocked until sanctioned credentials and test data exist. Any lexical-
only preview SHALL be explicit degraded staff preview only and SHALL NOT
authorize deterministic autonomous replies.

#### P5F2 — Gemini structured proposal adapter

P5F2 SHALL add only the Gemini proposal adapter. Gemini SHALL use stateless
Interactions with storage disabled (`store=false`) because official provider
retention is finite and Platform memory must stay durable and auditable inside
Supabase. The model SHALL be runtime-configured through an allowlist. The P5F-
specific initial sanctioned model SHALL be `gemini-3.5-flash`, the owner-named
MVP model. Google's current model catalog also lists `gemini-3.6-flash` as
stable, but the older generic target note does not authorize it for P5F without
a separate eval and plan update. The adapter SHALL use
bounded conversation context, bounded retrieval evidence, bounded read-only
amoCRM context and explicit token budgets, and SHALL return only JSON-schema
structured RU/EN qualification/reply proposals. Gemini SHALL NOT call WAHA,
SHALL NOT own transport retries and SHALL NOT imply send success.

#### P5F3 — deterministic autonomous reply gate

P5F3 SHALL add only deterministic send gating, durable send intents and the
bounded worker. Deterministic Platform policy SHALL be the only authority that
can create a WAHA `reply_to` send intent. It SHALL re-check mutable conditions
immediately before transport. The allowed send shape remains the same
conversation and exact inbound trigger, inside the rolling WhatsApp `<=24h`
service window, with consent/opt-out, approved citations/evidence, known
language, confidence/risk, business-hours, cooldown/rate, takeover/pause,
session health, idempotency and policy version all passing. The autonomous-
reply runtime enablement must be present and the emergency stop/kill switch
must not be engaged.
Media-only, unsupported or ambiguous input SHALL fail closed to human review.
No cold outbound, campaign/broadcast, autonomous follow-up/re-engagement,
out-of-window free-form send, direct model send or silent fallback is
authorized.

Default local business hours remain 09:00-21:00 Asia/Bishkek until an
organization-specific schedule is approved. Owner authority now allows
autonomous-reply code, but production enablement, live customer sends,
provider credentials and real provider proof remain separate blocked events.

### P6 — operations and portal

Deliver multiple applications, Curator-owned visa and reasoned case
close/reopen. Deliver versioned private documents, evidence-based manual
finance, clear overdue Portal actions and durable in-app notifications.
Individual WhatsApp notification delivery remains a separate post-P6 target.
P6 may prove direct Platform case workflows and object scope,
but it must not infer amoCRM contract stage, responsible Sales or canonical
handoff. Mapping activation, writes and automatic handoff remain deferred with
P4B; P4R may supply only verified read context.

P6 SHALL execute as four sequential gates:

1. `P6A` exposes read-only overdue and attention state in the accepted Student
   Portal from existing Platform-owned task, document and finance projections.
   It adds no durable notification row, scheduler or provider work and a page
   read never creates a notification.
2. `P6B` adds a versioned in-app-only durable Platform notification contract
   to the accepted Student Portal, adds self-only persisted read
   acknowledgement, uses reviewed negative document outcomes as the first
   idempotent producer and refreshes through private authorization-bound
   Realtime invalidation.
3. `P6C` adds disabled-by-default, idempotent overdue-transition publication
   from explicit Platform task/payment due data. It performs no read-time write
   and infers no deadline from amoCRM.
4. `P6D` closes P6 with one two-Student plus cross-organization browser path
   across multiple applications, visa, reasoned close/reopen, private document
   review, evidence-based manual finance, overdue Portal action and durable
   notification/read state.

Migration 043 remains immutable. Its `individual_whatsapp` intent is durable
state only: P6 does not claim, route or dispatch it and does not claim provider
delivery. Individual WhatsApp notification delivery remains a separate future
target; this amendment neither cancels nor activates it. The legacy SQLite
staff notification feed is not copied into the Platform model. Exact contracts
and acceptance criteria are in `docs/platform/p6-operations-portal.md`.

### P7 — security and reliability

P7A and P7B are complete. P7C recovery and large P7D capacity stress are
owner-deferred. Focused P7D accessibility now precedes P8 candidate proof. The detailed
authority, acceptance and stop conditions are append-only Block
`EVO-P7-SECURITY-RELIABILITY-PLAN-2026-08-13` in `docs/PLAN_CHANGES.md`, expanded
by `docs/platform/p7-security-reliability.md`, with P7B details in
`docs/platform/p7b-observability-contract.md`, and supported by
`docs/research/p7-official-evidence-2026-08-13.md`.

`P7-PLAN` merged in PR #154 and `P7A` merged in PR #156 as migration `071`.
P7A connects the accepted Platform Settings presentation to a safe
Supabase-native audit seam, revokes authenticated direct table reads of
`platform.audit_events` and replaces them with actor-derived Admin-only
search/export RPCs. Search is snapshot-bound and cursor-paginated; export is a
same-origin authenticated `POST`, replay-safe, bounded to an
explicit maximum 31-day/5,000-row window and audited by filters/count/hash only.
Raw before/after JSON, free-text reason, actor principal, provider payload,
object key, private topic and phone-bearing identifiers never enter RPC output,
DOM or CSV. CSV output is deterministic, private/no-store and formula-safe.
Legacy SQLite audit data is not a connected-runtime fallback.

`P7B` adds private structured observability and operational runbooks. Process
liveness stays dependency-free. Platform readiness, safe aggregate metrics,
alert evaluation and internal/Lead Agent admin surfaces remain private at the
edge and contain no tenant, customer, provider-payload, object-key or secret
labels. Local controlled failures prove safe `503` readiness, correlation,
severity/owner/runbook mapping and credential-header redaction. External
log-drain/pager delivery stays blocked until destination, plan/cost and owner
authority exist.

`P7C` follows `docs/platform/p7c-managed-recovery-contract.md`. It uses the
real managed `evo-platform-prod` source and a newly created, empty, explicitly
owned managed recovery project. Database and Storage recovery remain separate:
encrypted database artifacts and safe manifests are restored into the exact
recovery destination, while Storage bytes use supported Storage APIs and never
direct Storage catalog writes. The current production Storage inventory is
empty, so an empty-manifest check is valid but non-empty byte-restore proof
remains missing and no fake object is created. The production migration gap
When P7C resumes, `039 -> 072` is first analyzed and exercised on the recovery
target before any production schema promotion. Measured recovery
duration/data-loss window are observations, not approved RPO/RTO or PITR
evidence. The separate `inbox-prod` project belongs to Inbox SaaS and is not a
P7C migration, recovery or retirement target.

`P7D` follows `docs/platform/p7d-focused-accessibility-contract.md`. The owner
deferred the large k6 profile and temporary managed load target; capacity and
DEC-010 remain unproved. The exact real release candidate must run the retained
automated accessibility gate and then receive the focused owner-led keyboard,
focus, zoom, dialog, VoiceOver and mobile review. Neither automation nor the
focused review claims formal WCAG conformance.

P7 has completed only the exact managed project transfer and rename defined by
`docs/platform/p7c-managed-recovery-contract.md`. The owner has deferred the
temporary recovery project and encrypted recovery drill; no billed recovery
infrastructure is currently authorized, and `inbox-prod` is outside the EVO
Platform boundary. P7 authorizes no public
metrics/readiness, provider call, customer-data publication, live send, amoCRM
write, retention deletion, in-place production restore or premature service
retirement. DEC-009, DEC-010, DEC-012 and DEC-017 remain open until the managed
drill supplies their required evidence. P8 may prepare the candidate after the
focused P7D contract merges, but release remains blocked until focused
accessibility completes and every unavailable managed, provider and production
segment is explicitly recorded as blocked/deferred.

### P8 — controlled release gate

The exact executable contract is
`docs/platform/p8-controlled-release-candidate.md`, tracked by issue #175.
P8 is split into P8A contract/baseline, P8B deterministic manifest, P8C
non-mutating environment reconciliation, P8D approval-gated disabled
deployment, P8E exact-candidate accessibility and P8F real-service accounting.
No earlier P8 wording authorizes production mutation.

Prepare reconciliation, snapshot, freeze and rollback artifacts for the real
executable P5-P7 and bounded P4R scope. Where credentials and authority exist,
the narrowed messaging path is:

`WhatsApp receive/history/media → Platform persistence → identity/context read → structured AI proposal → deterministic auto-send or durable human handoff → delivery/read/unknown → audit`.

P4R may prove only real read context. It must not imply mapping activation,
amoCRM writes or automatic contract handoff. Missing credentials, sanitized
test identity/number, QR owner, production authorization or release window are
`BLOCKED`, never mocked. Autonomous send requires separate explicit production
enablement after the real receive-to-ACK path and rollback are proved.

### P9 — removed from current execution scope

No soak or Lead Agent retirement/removal work is authorized. EVO Lead Agent,
the legacy webhook/session path and rollback path remain deployed and frozen.
They must not be deactivated, retired or deleted. P10 follows P8 directly; the
P9 label remains only for historical traceability.

### P10 — authorized-scope audit

Re-read this plan, the decision log and TZ. Map the authorized P5-P8 scope to
exact tests, runtime evidence or an honest blocker. Run the applicable CI,
restore, security and accessibility gates. Explicitly list P4R read evidence,
P4B activation/writes as deferred, Lead Agent as retained and provider/
production gates as blocked or deferred.
Report verified, blocked and deferred work separately and never claim that the
original full Platform target is complete.

## 6. Launch-control protocol

For each block:

1. refresh clean `origin/main`;
2. use branch `izzhackt/evo-platform-<block>`;
3. record architecture/scope/API/schema/acceptance changes in a separate
   plan-amendment PR before implementation;
4. keep the diff coherent and use Conventional Commits;
5. run changed-scope checks and the applicable full gate;
6. open one PR whose body includes:
   - unique `Block-ID`;
   - this plan path and exact plan file SHA-256;
   - exact `docs/PLAN_CHANGES.md` SHA-256;
   - acceptance criteria;
   - commands and exact results;
   - `real-provider-proof: proved|not-required|blocked`;
   - blockers and rollback/migration note;
7. assign an independent read-only reviewer that checks freshness before
   correctness and posts a head-SHA-bound `launch-control-review` comment with
   Block-ID, reviewed head SHA, plan SHA, decision-log SHA, verdict,
   commands/results and provider boundary;
8. if the head changes, repeat validation and review for the new SHA;
9. after a fresh independent read-only exact-head approval and all required
   exact-head CI jobs pass, refresh `origin/main` and the PR base, confirm the
   reviewed base/main and reviewed head SHA still match the evidence, then merge
   that same SHA directly using a head-matching merge command; otherwise rerun
   the review/CI cycle on the refreshed state. GitHub exact-main push CI must
   pass before the next implementation PR opens.

The owner removed the scheduled Launch Auditor and separate merge-controller
from the active workflow. Do not wait for or recreate either automation.
Self-review and a green CI badge alone remain insufficient: the independent
reviewer is still a separate mandatory gate, and any head change invalidates
both its verdict and the previous exact-head CI evidence.

## 7. Validation baseline

Use Node 22.23.1 and project-local package managers.

The full Codex Security workflow is not a required gate for this run. Focused
authorization/RLS/security tests, scoped secret/PII scans, dependency audits and
the independent exact-head review remain required in proportion to the changed
boundary.

### Root application

```bash
git diff --check
npm ci
npm run test:security
npm run test:unit
npm run lint
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
npm run build
npm run scenarios
npm audit --omit=dev --audit-level=moderate
node scripts/check-npm-audit-allowlist.mjs
npm run test:e2e
```

The development-audit command may use only the already approved, documented
allowlist. Full Playwright includes affected flows and accessibility.

### EVO Inbox

```bash
npm ci --include=dev
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=moderate
node ../scripts/check-npm-audit-allowlist.mjs
```

### EVO Lead Agent while retained

```bash
uv sync --locked --extra dev
uv run ruff check .
uv run pytest
```

### Supabase and documents

- clean migration reset and disposable PostgreSQL/RLS tests;
- P2A byte/checksum proof for the immutable 001–039 history;
- real local Supabase Queues and Storage API evidence where those services are
  in scope; handcrafted mocks do not prove their contracts;
- migration-specific negative and rollback checks;
- isolated database and separate Storage backup/restore when touched;
- deterministic DOCX build, verifier, real render and inspection of every page.

Local Supabase proof is required for P2. It does not prove a linked managed
project, remote migration-ledger parity, production branch configuration, paid
plan/PITR availability or managed restore. Those claims remain blocked until
the region/plan, credentials and separate production authority exist.

For every PR, verify GitHub `EVO platform CI` jobs `Changed range`, `Main CRM`,
`EVO Inbox` and `EVO Lead Agent` for the exact head SHA. CI does not replace
full local Playwright or live provider proof.

## 8. Fail-closed invariants

- no outbound WhatsApp in the first live stage, whether manual, automatic,
  broadcast, follow-up, re-engagement or reply;
- no autonomous operational state change; AI remains advisory and human-reviewed;
- no direct model-to-WAHA capability and no model-controlled retry;
- no automatic retry of an unknown delivery outcome;
- no public WAHA/Lead Agent port and no new `acadis_*` dependency;
- no service-role or provider secret in browser, Git or logs;
- no fake provider success or configured-equals-working claim;
- no migration without source archive/checksum, provenance, reconciliation,
  rejection reporting, retry rules, backup and rollback;
- no production deployment, migration, DNS, WAHA session mutation, live
  customer send, real amoCRM record mutation or service deletion in this run;
- no Lead Agent deactivation, retirement or removal in the current authorized
  scope; keep the legacy webhook/session and rollback path deployed/frozen.

## 9. Remaining owner decisions

The implementation may advance safely around these items, but the affected
gates remain blocked until resolved:

1. exact authority and provenance for any exceptional one-time pilot-case
   identity/context import in U10;
2. Supabase region, plan, PITR availability and cost owner;
3. capacity profile, SLO, RPO and RTO;
4. retention, privacy notice, residency, DPA and legal deletion policy;
5. Gemini project/tier, DPA/terms and allowed-data policy before any real
   customer data is used in advisory, human-reviewed U9 behavior;
6. dedicated sanitized inbound test sender, `evo-inbox` production
   QR/session-recovery owner and receive-only U12 authority;
7. release window, freeze rules and rollback authority.

Role owners are recorded as accountable job functions. Personal names are not
a prerequisite for repository implementation.
