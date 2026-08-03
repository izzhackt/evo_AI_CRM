# EVO Platform Long-Run Execution Contract

Status: active repository implementation contract
Version date: 2026-08-04 (Asia/Almaty)
Initial kickoff baseline: GitHub `origin/main` at
`a16cd3fb591128b6d28f7f46c432169a0ff28753`
Authority: this plan, `docs/specs/EVO_PLATFORM_TZ.md`, the latest merged
`docs/PLAN_CHANGES.md`, and superseding ADRs including ADR 0016

Execution checkpoint: historical P1 containment, reusable greenfield P2A-P2H,
the greenfield/UI and business-workflow plan gates, P3A-P3C, BW1-BW4, P2R0 and
P2R1 are merged; PR #109 merged the P2R2 plan gate at `origin/main`
`30bcc956fbf1ac90e79c2a75c22748633e219d9d`. Exact-main CI run `30824043775`
is green for the applicable Main CRM, EVO Inbox and EVO Lead Agent jobs. PR
#110 at head `fd4428451793bdc59b3b183dcc9dde7518e80201` was closed without
merge after the independent controller found that stale authority redirected
without clearing the resident Supabase browser session and could not reproduce
the second physical-worktree local Supabase proof while the OrbStack endpoint
was unresponsive. P2R3 is therefore the active docs-only file-ownership and
validation repair gate; BW5 remains paused. Former P2I restore duties remain in
P7. This amendment changes no target architecture, acceptance outcome,
provider ownership, schema ownership or production authority.

## 1. Outcome and truth boundary

The target is one greenfield EVO Platform that preserves the accepted frontend
contract while consolidating only Platform-owned backend capabilities
deliberately and reversibly:

- amoCRM remains canonical for contact, lead, responsible sales manager and
  sales stage;
- one dedicated Supabase production project stores EVO-owned operational data;
- local/dev, persistent staging and preview branches/projects remain physically
  isolated from production, with no production-data copy by default;
- the Platform backend is greenfield and Supabase-native: no legacy SQLite
  data import, no legacy account import, no root-auth migration, and no
  dual-read or dual-write bridge;
- the current root CRM SQLite plane remains a separate legacy system; it is not
  imported, replaced or integrated without a later explicit scoped decision;
- EVO Inbox and EVO Lead Agent remain deployed messaging references until a
  bounded controlled provider cutover is explicitly authorized;
- only the necessary operator messaging capability from EVO Inbox is reused:
  conversation list/thread, necessary contact/student context, WAHA
  receive/send, ACK/delivery, AI draft, staff manual send, approved knowledge,
  audit, and minimal health/settings;
- Inbox CRM/dashboard/pipeline/deal/lead/broadcast/flow/campaign/unrelated
  analytics/settings surfaces are not part of the Platform thin slice;
- useful EVO Lead Agent capabilities move into one backend and one logical data
  model only through explicit adapters and repository/session seams;
- one private WAHA session/number, `evo-inbox`, and one EVO Platform webhook
  owner serve the final production path;
- staff and Student Portal use real server authorization, RLS, object scope and
  durable audit;
- AI creates reviewable RU/EN drafts only. A human edits and manually sends.

The accepted frontend is the sole product UI contract. It must be wired through
repository/session seams under the existing unified frontend shipped in PRs
#64, #71 and #72; it must not be replaced with a parallel UI or a fallback
Inbox UI. The platform must not be called production-complete until the
controlled provider path, bounded cutover evidence, reconciliation showing
zero unexplained loss or duplicates across the evidence window, health checks,
and rollback proof are real. No fixed-duration soak is required by contract.

## 2. Current verified baseline

As of the version date:

- GitHub `main` checkpoint for this amendment is
  `30bcc956fbf1ac90e79c2a75c22748633e219d9d`;
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
- no full WhatsApp → amoCRM → Platform → AI draft → manual send → ACK → audit
  path has ever been proved.

These facts describe the present system. P1 work remains historical legacy
containment, not the future Platform data plane. Target-architecture documents
do not silently change production.

## 2A. Current planning priority

After this amendment merges, implementation priority is intentionally narrow:

1. BW5 owns the university/college catalog and reviewable import boundary; no
   real import occurs without authorized source access.
2. BW6-BW7 follow one independently reviewed PR at a time after BW5 merges.
3. P4/P5/P7 retain amoCRM, real WAHA/AI/ACK and restore/reliability ownership;
   provider and production claims remain evidence-gated.

This contract explicitly defers broad infra perfection, broad restore proof,
and broad backend parity work that do not change thin-slice product truth.

## 3. Non-negotiable business contract

### 3.1 Roles, ownership and handoff

- First-release authority classes are `admin`, `sales`, `curator`, `finance`
  and Client/Student. The target Platform machine role for the last class is
  `student`; the current root `client` role remains a legacy reference and is
  not imported or mapped without a later explicit scoped decision. There is no
  separate `visa` role; the `/visa` module and visa entities remain.
- Admin is a permission bundle for individually identified authorized staff.
  Shared credentials are forbidden. Only Admin invites or blocks staff and
  assigns or reassigns a Curator.
- Curator reassignment requires a reason, before/after values and audit.
- One assigned Curator owns the whole student case: documents, multiple
  university applications, visa, tasks and communications.
- Sales owns the queue and conversation until a signed-contract condition is
  confirmed through an account-specific amoCRM mapping. Curator owns them after
  handoff. The conversation and history remain unified; Sales then sees only an
  explicitly permitted non-sensitive summary.
- A contract event creates a pending student case. Student Portal activates
  only after that event and Admin Curator assignment.
- Curator/Admin may close or reopen a student case only with a reason and audit.

### 3.2 Operational policies

- Finance v1 is a manual operational source inside EVO Platform. Finance/Admin
  alone confirm payment or refund with evidence and audit. Excel/1C import is a
  future integration, not a placeholder connector.
- Notifications v1 are durable in-app records and individual WhatsApp
  notifications with consent and deduplication. Broadcasts and mass sends are
  out of scope.
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
- AI uses approved, versioned knowledge only and never sends automatically.
- Unknown send outcomes are never automatically retried.
- The new platform must absorb phone normalization, WAHA HMAC and idempotency,
  raw-event persistence, buffering/jobs, amoCRM resolution, notes/tasks
  mapping, handoff, retry/dead-letter and reconciliation. Active auto-reply
  logic must not be absorbed.

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

- OP is the sales lifecycle governed by amoCRM. Canonical active stages are
  `new`, `contacting`, `qualified`, `meeting_scheduled`, `meeting_completed`,
  `potential` and `contract_signed`. `no_answer` and
  `meeting_not_attended` are active follow-up outcomes, not terminal lifecycle
  states. Event/collaboration labels are sources or deal types. Closure uses
  explicit won/lost state plus a reason; legacy columns are mapped per account
  and are not copied blindly into Platform enums.
- A confirmed contract creates the audited OP-to-OZO handoff. The handoff
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
  uncertain language requires manual language selection. Staff review/edit and
  manual send remain mandatory.
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
- Merged migrations are immutable. P2B begins with the next available number,
  expected to be 040 after P2A verification; a later defect receives a new
  forward migration and never rewrites merged history.
- `public` remains the legacy Inbox compatibility schema for migrations
  001–039 until a separately authorized legacy Inbox retirement. P3 does not
  import or cut over that legacy data plane. `platform` is the new Data
  API/browser-exposed schema and receives explicit least-privilege grants plus
  RLS on every table. `platform_private` is backend-only and is never exposed
  through the Data API.
- During coexistence the Data API may expose `public` and `platform`, never
  `platform_private`. Browser roles receive no direct access to
  `platform_private` or `pgmq_public`; queue operations use narrowly granted
  service-only paths with negative tests.
- Legacy Inbox roles `owner`, `admin`, `agent` and `viewer` are not mapped
  implicitly to Platform roles. The legacy signup trigger may continue to
  create legacy `public.accounts`/`public.profiles`, but it must not create a
  Platform organization membership or business role.
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
- Canonical writes use `pipeline_id`, `status_id`, `responsible_user_id` and
  `custom_fields_values`.
- Webhook events are persisted quickly, processed asynchronously and checked
  by periodic reconciliation with loop prevention.
- The adapter respects at most 7 requests/second/IP and normally no more than
  50 writes per batch.
- Kommo `conversation.id` and `message.id` are stored separately from WAHA
  session/message IDs and internal UUIDs.

Primary sources:

- <https://developers.kommo.com/docs/limitations>
- <https://developers.kommo.com/docs/webhooks-general>
- <https://developers.kommo.com/reference/receiving-chat-webhooks>
- <https://developers.kommo.com/reference/updating-single-lead>

### 4.3 WAHA

- One session represents one WhatsApp number/account.
- Webhooks verify raw-body HMAC, timestamp and `X-Webhook-Request-Id`, then
  persist the raw event before processing.
- Deduplication uses both request ID and business key
  `session + payload.id`.
- `message.any` reconciles messages sent through the API.
- `message.ack` preserves exact ERROR/PENDING/SERVER/DEVICE/READ/PLAYED evidence.
- The server sends `/api/sendSeen` before an approved reply and sends only when
  the session is WORKING.
- An unknown send result remains unknown and is never automatically retried.

Primary sources:

- <https://waha.devlike.pro/docs/how-to/sessions/>
- <https://waha.devlike.pro/docs/how-to/events/>
- <https://waha.devlike.pro/docs/how-to/send-messages/>

## 5. Ordered implementation blocks

Only one implementation PR may be open. Shared plan, schema, migration and
deployment surfaces are sequential.

| Block | Scope | Exit evidence | Current execution status |
| --- | --- | --- | --- |
| P0 | Final plan, corrected TZ/DOCX, target ADR and architecture docs | Deterministic DOCX, every page inspected, independent review | Merged in PR #75 |
| P1 | Current-app role/RBAC/handoff correction | Positive/negative route, action and object-scope tests; explicit visa-user migration report | P1A-P1D merged in PRs #76-#80 |
| P2 | Reusable Supabase-native foundation | Canonical history, local RLS/queue/Storage evidence, private document contract | P2A-P2H merged; former P2I restore duties transferred to P7 |
| BW0 | Business-workflow plan amendment | Confirmed/assumed requirements, dependency/file ownership, acceptance and source boundaries; deterministic TZ/DOCX evidence | Merged in PR #94 |
| P3 | Thin Supabase-native messaging slice behind the accepted frontend | Supabase Auth/RBAC, repository seams, real local persistence, conversation list/thread, draft/manual-send state and focused UI E2E | P3A-P3C merged in PRs #95-#97; no live-provider claim |
| P2R0 | Local Supabase reliability plan amendment | Current checkpoint, bounded ownership, exact validation and rollback/provider boundary | Merged in PR #104 |
| P2R1 | Local Supabase proof reliability repair | Real clean local Auth/RLS/Storage/PGMQ gate, deterministic deadline/cleanup tests and forward-only document lock-order repair | Merged in PR #105; migration 055 is immutable history |
| P2R2 | Auth-token and local reset reproducibility repair | Explicit issued-token `getClaims()` plus live authority; symlink-safe deadline execution; reproducible exact-project reset and cleanup | Plan merged in PR #109; implementation PR #110 closed without merge after controller findings |
| P2R3 | Stale-authority session clearing and exact local-proof ownership | Same-origin Route Handler clears rejected Supabase browser state; real connected-route regression; two physical-worktree local proofs | This docs-only amendment is active; implementation must be rebuilt after amendment merge |
| P4 | Messaging-scoped canonical amoCRM adapter | Versioned discovery, read-only identity/context sync, webhook/outbox/reconciliation; live proof only with a sanitized test lead | Pending |
| P5 | Narrow Inbox/WAHA/Lead Agent capability absorption and controlled proof | Persist-before-process, dedupe, queue/history, manual-send and ACK evidence; no legacy cutover yet | Pending |
| P6 | Admissions, Portal, Documents, Finance, Notifications | Two-student isolation E2E and complete staff-to-portal workflows | Pending |
| P7 | Security, reliability and operations | Threat model, load evidence, backup plus Storage restore, RPO/RTO and rollback rehearsal, accessibility | Pending |
| P8 | Release/cutover candidate | Frozen snapshot/reconciliation/runbooks and real controlled end-to-end evidence; no production action in this run | Pending |
| P9 | Bounded cutover evidence and separate Lead Agent retirement PR | Zero unexplained loss/duplicate/drift in the evidence window plus proven rollback and health | Evidence-gated |
| P10 | Completion audit | Every FR/NFR/SEC/ACC mapped to evidence, full CI/provider proof, no open implementation PR | Pending |

BW0, P3A-P3C, BW1-BW4 and P2R0/P2R1 are merged. PR #107 merged the BW5
checkpoint, but BW5 implementation is paused while P2R3 completes the
prerequisite P2R2 auth/local-proof outcome. BW5 resumes only after the P2R3
amendment and rebuilt implementation are independently reviewed,
controller-merged and green on exact-main CI:

| Block | Contract | Dependency and exit evidence |
| --- | --- | --- |
| BW1 | Workflow/domain contracts and source registry without PII | P3C merged; next-free forward migration only if schema is required; clean reset, RLS/grant tests, provenance/version tests |
| BW2 | OP/OZO repositories/actions behind existing Sales, Client and Application screens | BW1; amoCRM remains external sales authority; no localStorage/demo fallback; positive/negative authorization and audit E2E |
| BW3 | Student Profile and country requirement/checklist workflow | BW2; private Storage foundation; minimization, version retention, cross-student denial and staff/portal E2E |
| BW4 | Approved knowledge, prompt lifecycle, decision backlog and handoff | BW3 and P3/P5 messaging seams as applicable; draft-only/manual-send proof, RU/EN and manual-language failure path |
| BW5 | University/college catalog and reviewable import boundary | BW4; source access required for real import; provenance, validation/rejection and no-direct-approval tests |
| BW6 | Contract draft generation and post-contract checklist/report | BW5; approved typed fields only; authorization, immutable version and audit proof |
| BW7 | Latest-main integration and end-to-end workflow proof | BW1-BW6; real local/staging Supabase path through the accepted frontend, no production/provider claim without real exercise |

### Active P2R3 contract and provider boundary

- Prior trigger: controller review of PR #108 at exact head
  `f719b749efaadaf02c6344c5d01cd4b6bbe3d79c` found that the repair was outside
  the active sequential plan and that a fresh physical-path local Supabase run
  exited non-zero after two migration/reset attempts. PR #108 was closed without
  merge; its branch is recovery evidence only. PR #109 then merged the bounded
  P2R2 plan gate.
- Current trigger: controller review of PR #110 at exact head
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

### Paused BW5 contract and provider boundary

- BW5 must re-fetch `origin/main` and inspect open migration ownership before
  claiming the next free forward migration. At checkpoint `db8f3c75...`,
  migration `055_platform_document_finalization_lock_order.sql` is immutable;
  the expected BW5 candidate is 056.
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
- No BW5 implementation PR may reopen until P2R3 is controller-merged and its
  exact-main push CI is green. The preserved BW5 commits remain recovery points,
  not current-main evidence.

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

Discover and version account-specific mappings. Begin with the contact/lead,
responsible Sales and stage context needed by the messaging thread; then add
persisted webhook intake, idempotency, asynchronous work, reconciliation,
conflicts and loop prevention. Guard canonical writes. A confirmed contract
mapping creates a pending case; Admin Curator assignment activates handoff and
Portal. Without credentials and a sanitized test lead, only disabled,
fail-closed adapter slices may merge and no live-provider claim is allowed.

### P5 — unified communications

Absorb only the agent-facing messaging capability: conversation list/thread,
necessary operator context, WAHA receive/send, ACK/delivery, approved-knowledge
retrieval, draft-only RU/EN AI, human review/edit/manual send, audit and minimal
messaging health/settings. Keep distinct internal, WAHA and Kommo identifiers
and role-scoped Sales/Curator queues. Broadcasts, flows, campaigns, standalone
Inbox CRM/dashboard/pipeline/deal/lead surfaces, unrelated analytics/settings
and auto-reply remain excluded. Do not switch the old webhook/session without
controlled proof and separate production authorization.

### P6 — operations and portal

Deliver multiple applications, Curator-owned visa and reasoned case
close/reopen. Deliver versioned private documents, evidence-based manual
finance, clear overdue Portal actions and durable in-app/individual WhatsApp
notifications.

### P7 — security and reliability

Complete threat model, secret/redaction and private-network checks, structured
observability and audit export. Use live-observed dashboard values only as a
capacity baseline, never as exact company-wide truth. Prove production-like
load, database and separate Storage restore, rollback and accessibility.

### P8 — controlled release gate

Prepare reconciliation, snapshot, freeze and rollback artifacts. The required
real path is:

`WhatsApp receive → amoCRM resolve/link → Platform → AI draft → operator review/edit/manual send → delivery/read/unknown → audit`.

Missing credentials, test number, QR owner, dedicated test lead, production
authorization or release window are `BLOCKED`, never mocked.

### P9 — bounded cutover evidence and retirement

Across the explicitly approved controlled evidence window, reconcile every
receive/send/ACK outcome and prove zero unexplained loss or duplicates, healthy
webhook/outbox processing and a working rollback. Only after that evidence and
separate production authority exist may a separate reviewed PR remove
`evo-lead-agent/`, Compose/env/volume references, the `crm_primary` legacy
path/session, internal sync route and obsolete secrets/runbooks. Elapsed time
alone is neither required proof nor sufficient proof.

### P10 — completion audit

Re-read this plan, the decision log and TZ. Map every requirement to exact
tests, runtime evidence or an honest blocker. Run full CI, restore, security and
accessibility gates. Report verified, blocked and deferred work separately.

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
9. the executor never merges its own PR. The independent merge-controller may
   merge only an approved exact head; then GitHub `main` CI must pass before the
   next implementation PR opens.

Self-review and a green CI badge alone are insufficient.

## 7. Validation baseline

Use Node 22.23.1 and project-local package managers.

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

- no auto-reply or unattended outbound;
- no automatic retry of an unknown delivery outcome;
- no public WAHA/Lead Agent port and no new `acadis_*` dependency;
- no service-role or provider secret in browser, Git or logs;
- no fake provider success or configured-equals-working claim;
- no irreversible migration without expand/contract, backup and rollback;
- no production deployment, migration, DNS, WAHA session mutation, live
  customer send, real amoCRM record mutation or service deletion in this run;
- no Lead Agent removal before bounded cutover evidence, health and rollback gates.

## 9. Remaining owner decisions

The implementation may advance safely around these items, but the affected
gates remain blocked until resolved:

1. exact amoCRM account/pipeline/status/custom-field/user mappings;
2. Supabase region, plan, PITR availability and cost owner;
3. capacity profile, SLO, RPO and RTO;
4. retention, privacy notice, residency, DPA and legal deletion policy;
5. AI provider/model and allowed-data policy;
6. dedicated sanitized test sender number, `evo-inbox` production
   QR/session-recovery owner and controlled test-send authority;
7. release window, freeze rules and rollback authority.

Role owners are recorded as accountable job functions. Personal names are not
a prerequisite for repository implementation.
