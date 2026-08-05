# EVO Launch Plan

Status: `/goal-evo-platform-p2r4-local-validation-prerequisite` is active.
Historical P1, reusable greenfield P2A-P2H, BW0, P3A-P3C, BW1-BW7,
P2R0-P2R3 and P4A are merged. PR #118 merged the P4B docs-only contract, and
PR #128 merged the owner-authorized correction that supersedes PR #119 and
keeps Student Profile document reading, extraction, autofill and form export
outside `evo_AI_CRM`. Current `origin/main` is
`bb9d766163267846f406dcc376e893bb2a914af4`, migrations are contiguous
`001-058`, and exact-main CI run `31012015566` is green for Main CRM, EVO Inbox
and EVO Lead Agent; Changed range is skipped on the push event as expected.
Fresh unchanged-main evidence shows that the repo-scoped
`npm run test:supabase:local` gate exits `1` after the bounded local
`supabase start` times out on OrbStack. Normal exact-project cleanup leaves no
Platform container, volume, network, lock or process and preserves the Inbox
resource set. This docs-only prerequisite authorizes a later two-file repair of
that local validation path before P4B. It authorizes no application code,
migration, provider action, customer-data action or production mutation.
Updated 2026-08-05 in the workspace timezone.

This document is the execution contract for launch-control work in this repo.
The current detailed contract is
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`. New implementation lanes are blocked
until their plan and `docs/PLAN_CHANGES.md` amendment is independently reviewed
and merged. If scope, architecture, API/schema, acceptance criteria, file
ownership or merge order changes, stop the affected code change and merge a
separate plan amendment first.

## Current Goal Slice

Active plan slice: `/goal-evo-platform-p2r4-local-validation-prerequisite`,
Block `EVO-P2R4-LOCAL-VALIDATION-PREREQUISITE-2026-08-05`. PR #128 is merged
and remains the active product-boundary authority. This new docs-only slice
changes execution order only: repair and re-prove the disposable local
Supabase validation gate before opening P4B implementation. The later repair
may edit only `scripts/test-supabase-local-reset.sh` and
`tests/supabase-local-reset-harness.test.mjs`. It must not restore PR #122 or
BW8, reserve migration `059`, change schema/API/domain/TZ, touch the frontend,
call providers or mutate staging/production.

### Goal

Build the unified EVO Platform in ordered, independently reviewed blocks while
preserving the accepted frontend contract and current production safety.
amoCRM remains canonical for contact, lead, responsible sales manager and
sales stage. One greenfield Supabase-native backend becomes the platform-owned
operational store, with physically isolated dev/staging/preview environments.
The existing unified frontend from PRs #64/#71/#72 is the sole product UI
contract and must be wired through repository/session seams, not replaced or
paralleled. AI remains draft-only with human manual send.

This amendment records the local-validation prerequisite. P4B remains the next
product lane only after the repair implementation is independently reviewed,
controller-merged and re-proved on exact main. This amendment changes no
application code, schema, provider ownership, production authority or restore
claim.

### Reconciled baseline

The first bullets below retain the P0 snapshot. The current sequential
checkpoint is:

- P0 plan/TZ/architecture merged in PR #75.
- P1A no-Visa-role migration merged in PR #76.
- P1B Admin-only Curator assignment/lifecycle merged in PR #77.
- P1C current-app object scope merged in PR #78.
- P1D current-root WhatsApp object-scope containment merged in PR #80.
- P2 Supabase-foundation decomposition merged in PR #81.
- P2A canonical migration authority merged in PR #82.
- P2B-P2H merged sequentially on `main`; this amendment recognizes them as
  reusable greenfield foundation rather than the active product slice.
- PR #93 merged the greenfield/UI boundary; PR #94 merged BW0; PRs #95-#97
  merged P3A-P3C; PRs #100-#103 merged BW1-BW4; PR #104 merged P2R0; PR #105
  merged P2R1; PR #107 merged the BW5 checkpoint amendment; PR #109 merged the
  P2R2 plan gate; PR #111 merged the P2R3 plan gate; PR #112 merged the P2R3
  repair; PR #113 merged BW5; PR #114 merged BW6; PR #116 merged BW7; PR #117
  merged P4A; and PR #118 merged the P4B plan at
  `10e5d85147ed6b87bfbd0281fc6ccce5464e8d3b`.
- PR #119 is immutable merged history but PR #128 supersedes it as current
  product authority. PRs #120, #122 and #124 were removed by reviewed revert
  PRs #127, #126 and #125. Current `origin/main` is
  `bb9d766163267846f406dcc376e893bb2a914af4`; exact-main CI
  `31012015566` is green, and migrations end at `058`.
- On that unchanged main, Node `22.23.1`, project-local Supabase CLI `2.110.0`
  and Docker context `orbstack` were used to run exactly
  `npm run test:supabase:local`. The bounded `supabase start` phase exited the
  gate with `RC=1`; cleanup then left zero exact `evo-platform-local`
  containers, volumes and networks, no singleton lock/process, and the Inbox
  resource set remained unchanged.
- P2R4 is therefore a required local-proof repair before P4B. It does not
  revive PR #122, BW8, migration `059` ownership or any removed scope.
- PR #108 exact head `f719b749efaadaf02c6344c5d01cd4b6bbe3d79c`
  is historical recovery evidence: it passed focused tests and CI but was
  closed without merge after controller
  comment `5166574008`: no prior plan authorization and no independently
  reproducible real local reset exit zero.
- PR #110 exact head `fd4428451793bdc59b3b183dcc9dde7518e80201`
  passed executor proof, exact-head CI and independent review but was closed
  without merge after controller comment `5171649961`: connected-route stale
  authority did not clear the resident Supabase browser cookie, and the
  controller's OrbStack endpoint did not permit the second physical-worktree
  local proof.
- Root `/whatsapp` remains a SQLite `wa_*` shadow surface with P1D
  authorization containment. It is not the unified communications backend;
  the greenfield application seam was established through P3C, while real
  provider completion remains P5.

- At the P0 snapshot, GitHub `main` and the clean P0 worktree resolved to
  `a16cd3fb`; the exact `EVO platform CI` run for that SHA was green and there
  were no open PRs.
- Production Inbox runs revision `a09a72fc`, release `2026-07-24.2`.
  Production CRM and Lead Agent run revision `564332b4`, release
  `2026-07-24.1`.
- The root app still uses SQLite/custom auth and local `wa_*` shadow tables;
  EVO Inbox still uses a separate Supabase model.
- The retained Lead Agent is frozen with worker, outbound, and automatic reply
  paths disabled; amoCRM readiness remains false.
- Read-only WAHA session queries returned `401` without a key, so current
  session state was not re-proved and no secret was read.
- No real WhatsApp/amoCRM end-to-end proof exists. Missing gates include exact
  amoCRM mappings/credentials, a dedicated sanitized test lead and number, QR
  owner, controlled-send authorization, release window, reconciliation window
  and rollback evidence.

### Immediate execution order

0. Merge this docs-only P2R4 prerequisite through exact-head independent
   review, all four exact-head CI jobs and the independent controller.
1. In a fresh worktree from the resulting main, change only
   `scripts/test-supabase-local-reset.sh` and
   `tests/supabase-local-reset-harness.test.mjs`. Use the supported local
   `supabase start --ignore-health-check` escape hatch only with an immediate,
   bounded, fail-closed readiness proof for Database, PostgREST, Auth, Storage,
   Kong and CLI status. Unknown failures remain fatal; do not use broad retry or
   cleanup.
2. Prove the repair twice: executor and independent controller each run the
   exact repo-scoped local gate from clean state with exit `0`; migrations
   `001-058`, Auth/RLS/Storage/PGMQ and accepted browser tests pass; exact
   Platform resources and lock are absent afterward; exact Inbox container,
   volume and network identities are unchanged.
3. Preserve migrations 001-058 and P4A discovery evidence as immutable
   history. After P2R4 merge, recheck fresh `origin/main` and open ownership
   before P4B selects any next-free migration; `059` is not reserved.
4. Implement only Admin-reviewed messaging mapping approval behind the accepted
   `/whatsapp` seam, with same-org live authority, append-only decisions,
   supersession/revocation audit and fail-closed no-approval behavior.
5. Keep identity/context sync, webhooks, outbox/jobs, reconciliation and
   canonical writes in later reviewed P4 slices. Defer real WAHA/AI/ACK proof
   to P5 and all production authority to release gates.

### Merged P2R3 acceptance record

- The server verifies the exact access token returned by successful Supabase
  login with `getClaims(accessToken)` before resolving the live database
  authority bundle. Missing/invalid claims, blocked membership or RPC failure
  fail closed and clear the Platform session.
- Protected connected routes hand invalid authority to the exact same-origin
  `src/app/auth/platform-session/route.ts`. That response-writable handler
  independently rechecks claims plus live authority, preserves a recovered
  valid actor, and otherwise expires only the Platform Supabase auth-token
  cookie/chunks before redirecting to a bounded login error. Query parameters
  are not authorization proof; legacy root-auth cookies remain untouched.
- Real local Playwright starts with an authenticated Platform session, makes
  the live authority revoked or version-stale, exercises the connected route,
  and proves the browser no longer holds the Platform auth cookie. A direct
  handler request with valid authority must preserve the session.
- `getSession()` is never a server authorization source; self-registration,
  legacy-account import and root-auth fallback stay disabled.
- The deadline runner executes its child and propagates the true exit code from
  both logical symlink and physical worktree paths.
- The normal real `npm run test:supabase:local` path exits zero after migrations
  001-055 and proves Auth/PostgREST/RLS/browser/Storage/PGMQ behavior. Retries
  remain bounded and transient-only; diagnostic output is redacted.
- Cleanup proves no exact-project lock, container, volume or network remains and
  preserves unrelated Inbox resources. Broad prune and daemon restart are
  forbidden.
- P2R3 owns only the original P2R2 auth/reset files plus
  `src/lib/platform-guards.ts`, `src/proxy.ts`,
  `src/lib/supabase/auth-cookies.ts`,
  `src/app/auth/platform-session/route.ts` and
  `tests/platform-auth/platform-auth.spec.ts`. It owns no migration, provider,
  production, restore or cutover behavior.
  Executor and independent physical-worktree evidence, exact-head CI and a new
  SHA-bound review are all required before controller merge.

### Business-workflow scope

- OP active stages: new, contacting, qualified, meeting scheduled, meeting
  completed, potential and contract signed. No-answer/no-show are follow-up
  outcomes; event/collaboration values are source/deal metadata; closure
  requires an explicit result and reason. amoCRM mappings remain
  account-specific and canonical.
- OZO uses one common admissions lifecycle with independent application,
  document, visa, finance, housing, insurance and travel statuses. China,
  Italy, Czech/Poland, UAE/Turkey and Malaysia are versioned overlays, not
  separate applications.
- Student Profile uses a minimized country-neutral core plus versioned
  country-specific requirements. Sensitive documents use the private document
  path only.
- Requirements/checklists, prompt/knowledge, Q&A decisions, catalogs/imports,
  document templates and generated contracts are versioned, source-aware and
  approval-gated. Generated contracts remain drafts until authorized staff
  approval.
- University import is blocked while the linked Notion workspace is
  inaccessible. Colleges and Accounting/Bema remain discovery gaps rather than
  invented modules.
- AI remains RU/EN draft-only with human review/edit/manual send. Kyrgyz or
  uncertain language requires manual language selection.
- Linked Google Docs/Sheets/Drive/PDF/Notion inputs are discovery/import
  sources, never the runtime database or a public dependency. No customer PII,
  folder names or documents may enter Git, fixtures or logs.

### Business-workflow acceptance

- BW1 proves versioned source/provenance and normalized domain contracts
  without PII.
- BW2 proves OP/OZO actions through real repositories, RLS, permissions and
  audit behind the existing frontend, with no localStorage or demo fallback.
- BW3 proves Student Profile and country checklists across staff and portal,
  including cross-student denial and historical overlay-version retention.
- BW4 proves approved prompt/knowledge and decision lifecycle, draft-only
  messaging, RU/EN and the manual-language failure path.
- BW5 performs no real catalog import until authorized source access exists;
  staging/validation/rejection must not auto-publish.
- BW6 proves typed approved-field contract generation, draft/approval
  separation, immutable versions and audit.
- BW7 proves the complete local/staging Supabase workflow through the accepted
  frontend. It does not imply production/provider readiness without real
  authorized service exercise.

### Merge-order boundary

BW0, P3A-P3C, BW1-BW7, P2R0-P2R3, P4A and the PR #128 boundary correction are
merged history. This P2R4 prerequisite is the only active docs-only block. Its
two-file implementation must merge and the real local gate must be re-proved
before P4B opens. P2R0-P2R4 do not transfer P7 restore ownership or authorize
production application. P3 owns common session/repository seams, P4 owns
amoCRM adapter behavior, P5 owns real WAHA/AI/ACK proof, and P7 owns
whole-foundation backup/restore and release reliability evidence.
Shared migrations are selected only after fetching current main and checking
open ownership; merged migrations are immutable.
- `crm.evoadmissions.com` and `inbox.evoadmissions.com` have no DNS answer.
  The fallback CRM URL responds.
- The original checkout's modified Malaysia knowledge-base document and
  untracked presentation archive are owner work outside this goal.

### Ordered platform blocks

P0–P10, their exact exit evidence, validation commands, protected operations,
remaining owner decisions and the independent-review/merge-controller protocol
are defined in `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`.

- P0: plan/TZ/DOCX/ADR and target architecture, docs-only.
- P1: current-app role/RBAC/handoff correction. P1A-P1D are merged.
- P2: unified Supabase foundation. P2A is merged; P2B–P2H are reusable
  foundation and former P2I restore duties move to a later reliability lane.
- P2R0/P2R1: merged docs-only reliability gate and bounded local Supabase
  proof-path/document lock-order repair in PRs #104/#105.
- P3: thin messaging slice behind the existing unified frontend; P3A-P3C are
  merged with local-only, no-provider evidence.
- P4: canonical amoCRM adapter.
- P5: unified Inbox/WAHA/Lead Agent capability absorption.
- P6: Admissions/Portal/Documents/Finance/Notifications.
- P7: security, reliability and operations.
- P8: release/cutover candidate and controlled provider gate.
- P9: bounded cutover reconciliation and rollback evidence, then a separate
  reviewed retirement PR.
- P10: requirement-to-evidence completion audit.

Only one implementation PR may be open. The executor never merges its own PR;
the independent merge-controller may merge only an approved exact head. No
production deployment, migration, DNS, WAHA session mutation, live customer
send, real amoCRM mutation or service deletion is authorized by this plan.

### Completed P1D contract: current-root WhatsApp object scope

P1D applies only to the root CRM's current SQLite/custom-auth `/whatsapp`
surface. It is authorization containment before P2-P5, not a substitute for the
unified Supabase/Inbox/WAHA target.

The merged implementation:

- scope list/detail/message reads in SQL to Admin, responsible Sales before
  handoff, assigned Curator after handoff, and a safe summary-only projection
  for the former responsible Sales user;
- deny Finance, Student, unrelated staff, broken links and unlinked rows for
  every non-Admin actor;
- grant lead-only Sales access only when both the conversation and the resolved
  lead have no case link; indirect lead-to-case and conflicting case links are
  Admin-only until reconciliation;
- keep post-handoff Sales away from transcript, phone/message previews,
  provider/amoCRM/WAHA identifiers, draft/reason metadata and send/read/draft
  actions;
- enforce the same object policy in direct routes, lead-page lookups, replayed
  Server Actions and `/api/ai/draft` before protected reads, mutation, AI or
  WhatsApp provider access;
- suppress WhatsApp-derived unread/count/recency/response aggregates at the
  shared query boundary for Sales, dashboard, calls and tasks whenever the
  actor lacks full conversation access;
- make manual conversation creation Admin-only until P4/P5 can prove canonical
  ownership during resolution/linking;
- preserve the accepted frontend structure while hiding inbox and shared
  TopBar controls that cannot succeed for the current actor.

P1D has no database migration and no real-provider proof requirement. It must
not change the WAHA session/webhook, Lead Agent, EVO Inbox Supabase model,
message transport, ACK/outbox/retry/reconciliation behavior, provider
configuration or production state. Full details and the actor matrix are in
`docs/platform/p1d-root-whatsapp-scope.md`.

### P2 plan amendment: canonical Supabase foundation

ADR 0014 remains the unified target decision. ADR 0015 refines its Supabase
implementation boundary:

- root `supabase/` becomes the sole migration authority in P2A;
- legacy migrations 001–039 move byte-for-byte with a checksum manifest and no
  migration 040 in P2A;
- `public` remains the legacy Inbox compatibility schema;
- `platform` is the new exposed schema with explicit grants and RLS on every
  table;
- `platform_private` is backend-only and absent from the Data API;
- browser roles have no `platform_private` or `pgmq_public` access;
- legacy Inbox `owner/admin/agent/viewer` roles never map implicitly to
  Platform `admin/sales/curator/finance/student`;
- target machine role `student` is displayed as Client/Student; the current
  root `client` identifier is not imported or mapped into Platform without a
  later explicit scoped decision;
- the legacy signup trigger may keep legacy Inbox behavior but grants no
  Platform membership.

P2 has the following strict dependency order:

1. P2A establishes the canonical root config/history/test harness without a
   new migration.
2. P2B begins at the next free migration number, expected 040, and establishes
   schemas/grants plus verified legacy secret-bearing-column containment while
   preserving current Inbox compatibility.
3. P2C adds Platform identity, RBAC and base audit.
4. P2D adds cases, assignments/handoff, applications, visa and tasks.
5. P2E adds document metadata, finance and durable notification state.
6. P2F adds communications/provider mappings, raw events, approved knowledge
   and draft-only AI records without a live-provider claim.
7. P2G proves retryable work through real local Supabase Queues/PGMQ, including
   idempotency, dead-letter and reconciliation.
8. P2H proves new private Platform buckets/policies through the real local
   Supabase Storage API.
9. P2R1 repaired only the already-merged local proof path and merged immutable
   migration `055_platform_document_finalization_lock_order.sql` in PR #105. It
   added no production apply, provider call, restore claim or product feature.
10. Former P2I whole-foundation reset/RLS/grant/secret and separate database/
    Storage restore duties are transferred to P7.

Merged migrations are immutable; defects use the next free forward migration.
P2 is additive and does not rename/drop legacy tables, cut root auth over,
copy real secrets, silently privatize legacy `avatars`/`flow-media`, or apply a
production migration. A handcrafted queue or Storage mock is not service
proof. Local service evidence does not prove remote migration-ledger parity,
managed branching, production configuration, paid-plan PITR or managed
restore; those remain blocked by region/plan, credentials and production
authority.

Detailed ownership, negative matrices, rollback and provider boundaries are in
`docs/platform/p2-supabase-foundation.md`.

P2R1 exits only when the real local `npm run test:supabase:local` path proves
admin-provisioned Auth/RLS, private Storage, PGMQ terminal semantics and exact
disposable-resource cleanup under Node 22.23.1. The document finalization lock
repair must be a next-free forward migration with concurrent finalization and
review regression evidence. Local proof is not managed Supabase, provider,
backup/restore or production proof.

### Historical pre-platform blocks

The following A–G record is retained as prior hardening history. It is not the
active merge order; P0–P10 above and the long-run plan now control new work.

Every block starts from refreshed GitHub `main`, has one coherent PR, real
validation, and a separate launch-control reviewer verdict of `approved`.
Shared migrations, deployment files, and plan files merge sequentially.

1. **A — critical authorization containment**
   - Prevent profile, account, membership, ownership, or role self-promotion.
     System-owned identity, membership, role, account, and provider/audit fields
     may change only through authorized server paths.
   - Inventory exposed Supabase tables, views, RPCs, grants, RLS/storage
     policies, and `SECURITY DEFINER` functions. Deny cross-account writes and
     remove unnecessary authenticated/anonymous grants.
   - Add disposable PostgreSQL role-policy tests using JWT claims for ordinary
     staff, privileged staff, and `service_role`, including negative
     insert/update/delete/RPC and cross-account cases. Table-owner execution
     does not prove RLS because owners normally bypass it.

2. **B — main CRM sensitive surfaces**
   - Authenticate and admin-gate Transcription Lab plus upload, job, SSE,
     detail, and improvement endpoints, or disable the complete production
     surface when no approved operator role can be proven.
   - Enforce server-side upload type/size/count limits, bounded processing, safe
     names, failure cleanup, retention/deletion, and non-sensitive audit output.
     Edge limits supplement but do not replace application validation.
   - Require production-safe secret encryption and fail closed when secure
     encryption configuration is unavailable.
   - Add negative permission tests for finance, documents, client/portal data,
     AI routes, and transcription routes.
   - Public registration versus invite-only access is an owner decision. Stop
     before changing `/register`, account creation, or invite policy without it.

3. **C — privacy and media truthfulness**
   - Keep customer documents/media in private storage with account-scoped RLS
     and short-lived authorized access. Never expose public bucket URLs or
     service-role keys. Audit upload, access grant, deletion, and retention
     without customer content.
   - Verify real WAHA media receive/send support. Disable unsupported media UI
     instead of storing or displaying simulated capability.
   - Define retention/deletion for CRM files, Inbox media, transcripts, AI
     drafts, outbound attempts/messages, ACK evidence, and logs. Preserve
     #47/#48's append-only delivery evidence; do not recreate or weaken it.

4. **D — Lead Agent minimal containment**
   - Prove whether the production Lead Agent is still an active inbound webhook
     owner. Keep outbound and automatic replies disabled.
   - If active, add bounded replay rejection, atomic crash-claim
     lease/recovery, idempotent amoCRM side effects, deterministic
     phone/contact/lead selection, and non-sensitive liveness/readiness output.
   - If unused or blocked by credentials, freeze it disabled and document the
     exact blocker instead of overbuilding a service planned for retirement.

5. **E — runtime and deployment hardening**
   - Build on PR #46 rather than repeating it. Verify third-party images by
     immutable digest and first-party images by Git revision/version labels.
   - Separate liveness from dependency/provider readiness. Validate private
     endpoints, Caddy routing, CSP/cache/security headers, application/edge
     request limits, resource limits, correlation IDs, actionable logs/alerts,
     and rollback evidence.
   - Use current official Docker, Caddy, Next.js, Supabase, WAHA, and amoCRM
     documentation. Validate real Compose/Caddy/runtime state without secrets or
     customer data. Canonical DNS remains an owner-controlled external action.

6. **F — backup and disaster recovery**
   - Inventory main CRM SQLite/files, managed Supabase database and Storage
     objects, retained Lead Agent SQLite/token state, encrypted settings, WAHA
     session/relink material, and release configuration.
   - Define owner-approved RPO/RTO per store. Supabase database backups do not
     include Storage objects, so their recovery procedures are separate.
   - Restore only into isolated disposable destinations, never production.
     Verify integrity, schema/version, application reads, protected-key
     decryption, and the documented WAHA relink procedure.

7. **G — final acceptance and completion audit**
   - Map every requirement to merged PRs, clean Git state, real test/runtime
     evidence, or an exact external blocker.
   - Prove role denials, restart persistence, duplicate/replay behavior,
     provider-outage handling, zero automatic customer reply, isolated restore,
     production image-to-Git mapping, and no open hardening PR.
   - Run a real WhatsApp/amoCRM path only with real credentials, an
     EVO-controlled sender/recipient, and explicit approval for the visible
     manual reply. Missing inputs are blockers; mocks do not satisfy this plan.

### Remaining internal closure lanes

These lanes close newly confirmed internal gaps before Block G can be
re-audited. Each lane starts from refreshed `main`, uses a coherent PR, passes
real validation, and receives a separate launch-control reviewer verdict.

1. **CI enforcement for PostgreSQL authorization**
   - Require the existing real-role harness
     `scripts/test-postgres-authorization.sh` through the
     repository-root `npm run test:security` gate in GitHub Actions.
   - Provision only safe ephemeral/disposable PostgreSQL for CI. Do not connect
     the harness to production or require committed/runtime secrets.
   - Prove the workflow actually executes ordinary-staff, privileged-staff, and
     `service_role` allow/deny cases, including forbidden writes, rather than
     accepting SQL text inspection as equivalent evidence.

2. **Non-disruptive CRM checkout and permission reconciliation**
   - Inventory `/opt/evo-crm` and preserve every dirty or untracked item in a
     recoverable, access-restricted archive before changing the operational
     checkout.
   - Reconcile `/opt/evo-crm` to the exact reviewed source corresponding to the
     currently deployed CRM/Lead Agent revision. Prove the resulting Git state
     and image-to-Git mapping without building, recreating, restarting, or
     otherwise changing running services.
   - Audit legacy environment/configuration file ownership and modes without
     printing values. Tighten permissions only when the target and runtime
     access requirements are proven and the change is non-disruptive; otherwise
     record the exact blocker.

3. **WAHA runtime-limit drift containment**
   - Record the live finding that WAHA has unset `Memory`, `NanoCpus`, and
     `PidsLimit` despite reviewed Compose limits.
   - Do not recreate, restart, relink, or mutate WAHA to apply those limits
     until a QR/relink and session-continuity procedure is ready and the owner
     explicitly approves the user-visible provider risk.
   - Until approval, treat the runtime drift as an explicit Block E/G blocker,
     preserve WAHA privacy, and make no claim that its Compose limits are active
     in the running container.

Owner/external gates remain unchanged: canonical DNS, public registration
policy, monitoring destination and responsible owner, retention schedule and
owner, CSP enforcement, RPO/RTO, provider acceptance inputs/approval, and the
deferred real Supabase database-plus-Storage backup and isolated restore
rehearsal. None may be inferred or marked complete from automated tests.

### Historical write boundaries and merge order

The ownership list below applied to the pre-platform A–G hardening program. It
does not authorize current P2 work; P2A–P2H, later reliability work and the
long-run contract control.

- Plan-only PR: `docs/EVO_LAUNCH_PLAN.md` and append-only
  `docs/PLAN_CHANGES.md`.
- A owns Inbox authorization migrations/helpers/policy tests and merges before
  any later Inbox schema work.
- B owns main CRM guards, transcription, secret handling, and sensitive-surface
  tests.
- C owns private media/storage policy, signed access, truthful media UI,
  retention/deletion, and audit events; it starts after A and B.
- D owns only `evo-lead-agent/**` plus directly required deployment/docs.
- E owns shared Dockerfiles, Compose, Caddy, observability, deployment
  scripts/runbooks, and release metadata.
- F owns backup/restore scripts and runbooks and follows E for shared files.
- G owns audit evidence and plan status. DNS/provider mutation is excluded
  unless separately authorized with required inputs.

### Required evidence

- Real disposable PostgreSQL role-policy execution, not SQL text matching.
- Focused negative tests plus full affected lint/type/test/build/audit gates.
- Real browser allow/deny checks for affected roles and surfaces.
- `git diff --check origin/main..BLOCK_SHA` and redacted secret scanning.
- Real production Compose/Caddy rendering without printing secret values.
- Restart/persistence and isolated restore evidence where applicable.
- Separate independent reviewer approval before each merge.

### Stop conditions

- Stop before changing registration/invite behavior without the owner's policy.
- Stop before DNS mutation without authoritative access and owner approval.
- Stop before real outbound WhatsApp without real credentials, a dedicated test
  sender/recipient, and explicit approval for that reply.
- Stop before destructive or production restore actions; rehearsals must be
  isolated.
- Stop Lead Agent expansion if active ownership cannot be proven.
- Stop if architecture, schema, acceptance, or merge-order changes lack an
  append-only `PLAN_CHANGES.md` entry.
- Never print, commit, or copy secrets or customer data into evidence.

## Historical Completed EVO Platform Frontend Slice

Historical slice: `/goal-evo-platform-frontend`.

This section records the then-current runtime and acceptance contract for the
completed frontend work. Its legacy `visa` role matrix is historical evidence
only and is superseded for all P1+ implementation by
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md` and `docs/specs/EVO_PLATFORM_TZ.md`.

This slice ran after its planning-only PR was independently reviewed and
merged. It did not close or weaken `/goal-evo-preplatform-hardening`; the
remaining owner/external gates in that goal stayed open.

### Goal

Turn the reviewed Claude Design handoff into the real, responsive and
accessible EVO Platform frontend inside the root Next.js CRM application.
The result should present one coherent staff workspace and student portal while
preserving the current system ownership boundaries:

- amoCRM remains authoritative for contact/lead identity, responsible manager
  and sales-pipeline stage;
- the root CRM remains the canonical host for staff operations and the student
  portal;
- EVO Inbox remains the current WhatsApp conversation runtime and Supabase
  owner until a later backend/data migration decision;
- AI customer replies remain draft-only and require a human to send;
- the retained Lead Agent remains frozen and backend-only.

One frontend does not imply one physical database or one runtime in this slice.
No schema merge, Supabase consolidation, Lead Agent deletion, live provider
mutation, production deployment or outbound WhatsApp test is authorized here.

### Reviewed design baseline

- Source bundle:
  `docs/design/evo-platform/prototype/`.
- Completion contract:
  `docs/design/evo-platform/COMPLETION_CHECKLIST.md`.
- Browser and static audit:
  `docs/design/evo-platform/AUDIT_2026-07-24.md`.
- The handoff covers the main information architecture, seven staff roles,
  Student Portal, design tokens and eight core flows.
- The handoff is not production code. Its known gaps include broken staff
  tablet/mobile layouts, a phone-shaped rather than native desktop Student
  Portal, incomplete navigable system states, CDN runtime dependencies,
  inaccessible clickable `div` controls and unlabelled/unmanaged overlays.

### Role mapping for this frontend slice

The prototype's seven staff personas are design viewpoints, not permission
records to add to production. This slice preserves the five existing staff
roles in `src/lib/domain.ts`:

| Prototype viewpoint | Existing application role in this slice |
|---|---|
| Руководство | `admin` dashboard/report viewpoint; no new role |
| Администратор | `admin` |
| Продажи | `sales` |
| Куратор | `curator` |
| Визовый специалист | `visa` |
| Финансы | `finance` |
| Оператор Inbox | existing `admin`/`sales`/`curator` WhatsApp access; no new role |

The student remains the existing `client` role. Role switching in the design
bundle is demonstration-only and must not be copied into the real application
as an authorization mechanism. Adding a distinct leadership or Inbox-operator
role requires a later role-policy amendment and server-side authorization
work. The completion checklist's permissions-matrix item means documenting and
testing the current five staff roles plus `client`, not silently expanding
them.

### Inbox data boundary for this frontend slice

The root `/whatsapp` route currently reads and writes the main CRM's local
`wa_*` shadow tables through existing CRM queries/actions. It does not read the
separate EVO Inbox Supabase project. Therefore:

- this slice may redesign `/whatsapp` over the existing root CRM read/action
  path and must label its source truthfully;
- it must preserve all current send/configuration guards and draft-only AI;
- it must not claim that the root view is connected to EVO Inbox Supabase;
- the shell may link to or report the separate EVO Inbox runtime status only
  when that status is available through an already-authorized read path;
- a real Supabase-to-root read bridge, shared Inbox API or data migration is a
  later backend/integration slice with its own authentication, ownership,
  privacy and failure-mode design.

“Unified Inbox” in this frontend slice means one consistent interaction design,
not a hidden cross-database integration.

### Architecture and implementation order

1. **Planning and evidence**
   - Commit the unmodified Claude Design source, completion checklist, browser
     evidence and gap audit.
   - Keep the prototype clearly labelled as reference-only.
2. **Frontend foundation**
   - Implement EVO brand tokens, real logo treatment, typography, primitives,
     semantic tables, tabs, dialogs, drawers, feedback and state components.
   - Keep data-reading pages as Server Components and isolate only interactive
     controls in focused Client Components.
   - Implement keyboard focus, reduced-motion handling and native semantic
     controls.
3. **Unified responsive shell**
   - Rebuild the root staff shell and topbar for desktop, tablet and urgent
     mobile work without replacing existing authentication or role checks.
   - Expose truthful amoCRM, WAHA and AI status labels without implying that a
     provider was exercised.
4. **Staff workspaces**
   - Recreate the reviewed dashboard, sales funnel/list, Lead 360, Student 360,
     applications, documents, visa, finance, tasks/calendar, calls/meetings,
     Inbox, notifications, reports and administration surfaces on existing
     root routes where possible.
   - Add only read-model/UI routes required for missing surfaces; do not change
     provider ownership or create a second source of truth.
   - Keep `/whatsapp` on the existing CRM `wa_*` read/action path and label the
     separate EVO Inbox bridge as deferred.
5. **Student Portal**
   - Rebuild `/portal` as a true mobile-first surface with an actual desktop
     layout, accessible document resubmission and the reviewed progress,
     applications, visa, payments, messages, team and security views.
6. **Validation and handoff**
   - Run lint, type/build, relevant unit/e2e suites and secret scanning.
   - Exercise the critical flows in a real browser at 1440x1024, 834x1194 and
     390x844, save screenshots and audit keyboard/focus behavior.
   - Keep provider-dependent flows labelled blocked or simulated unless real
     credentials and explicit mutation/send approval are separately supplied.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
  `docs/design/evo-platform/**`: contract, source handoff and audit evidence.
- `eslint.config.mjs`: ignore only the immutable, reference-only Claude Design
  export under `docs/design/evo-platform/prototype/**`; application source
  remains linted.
- `src/app/globals.css`, `src/app/layout.tsx`,
  `src/app/(staff)/**`, `src/app/login/**`, `src/app/portal/**`:
  responsive application surfaces.
- `src/components/**`, `src/lib/domain.ts`, `src/lib/i18n*.ts`:
  shared design system, navigation, truthful presentation models and copy.
- `src/lib/queries.ts`, `src/lib/actions.ts` only for presentation/read-model
  adaptation of existing root CRM data and existing guarded actions. No new
  cross-runtime provider write path is included.
- `tests/**`, `playwright.config.ts` only where required for frontend
  acceptance and regression coverage.

Database migrations, provider clients, webhook handlers, Compose/Caddy,
production secrets and deployments are outside this slice unless a later
append-only plan amendment explicitly adds them.

### Acceptance criteria

- Every applicable item in the completion checklist maps to a real application
  route, component state or explicitly recorded provider blocker.
- The permissions matrix covers the current `admin`, `sales`, `curator`,
  `visa`, `finance` and `client` roles; prototype-only leadership/Inbox
  personas do not become production roles in this slice.
- Staff views are usable without horizontal page overflow at 1440x1024 and
  834x1194; Inbox, tasks and notifications have an intentional 390x844 urgent
  mobile experience.
- Student Portal uses native mobile and desktop layouts rather than a device
  frame embedded in a marketing page.
- Navigation, cards, forms, tabs, tables, kanban, drawers and dialogs are
  keyboard-operable with visible focus and appropriate semantics.
- No frontend success state claims a real amoCRM, WAHA, Supabase, AI or
  telephony result unless that real service was exercised.
- Sales stages and operational student stages remain visibly distinct.
- AI drafts cannot auto-send and the manual-send boundary is explicit.
- The root application lint, build and affected automated/browser tests pass.

### Merge order and stop conditions

1. Planning/design-evidence PR, including the narrow lint ignore required to
   store the immutable design exporter source outside the runtime.
2. Design-system and responsive-shell PR.
3. Staff workspace PRs split by non-overlapping route ownership.
4. Student Portal PR.
5. Cross-flow browser acceptance and final integration PR.

Stop before changing backend ownership, merging databases, deleting a runtime,
changing role policy, deploying to production or sending a real message. Those
actions require a separate architecture amendment and, where applicable,
explicit owner approval and real provider inputs.

## Completed Main Production Consolidation Slice

Completed slice: `/goal-evo-main-production-consolidation`.

### Goal

Make GitHub `main` the reviewed source of truth for the complete EVO platform,
then deploy that exact release to `hermes-vps` and prove the real EVO Inbox
WhatsApp path without losing active server configuration or claiming provider
success that was not exercised.

Candidate ancestry at planning time is linear:

- `origin/main`: `c1a00b0a3013946a94677fc0f01838740217b622`
- integration candidate after PR #40:
  `8116aad7c6cc97c3de198e3de1c7cad020105416`
- distance: zero commits behind and 41 commits ahead of `main`

The candidate is not releasable as-is. Current audits find vulnerable runtime
dependencies, no effective repository-root GitHub Actions workflow, three
full-range whitespace failures, dirty production checkouts, missing canonical
DNS, and incomplete real-provider readiness.

### Ordered blocks

Each block requires its own branch, PR, real validation evidence, and
independent launch-control approval. Do not begin a later block before the prior
block is merged or explicitly abandoned.

1. **Security and repository gates**
   - Upgrade both Next.js applications to the current secure stable patch.
   - Remove the shadcn code-generation CLI from production dependencies; invoke
     it through the documented ephemeral package runner when future component
     generation is needed. Preserve the small runtime Tailwind extension
     currently imported from that package as a reviewed, tracked local
     stylesheet so removing the CLI does not alter the rendered UI.
   - Apply safe transitive dependency updates until
     `npm audit --audit-level=moderate` passes for both applications.
   - Fix the three existing `git diff --check` findings without unrelated
     formatting churn.
   - Add repository-root GitHub Actions coverage for the main CRM, EVO Inbox,
     and EVO Lead Agent. A workflow nested under an application directory is
     documentation only because GitHub discovers workflows from root
     `.github/workflows/`.
   - Open a dedicated issue for normalizing the pre-existing EVO Inbox formatter
     baseline without mixing hundreds of unrelated rewrites into this release.

2. **Frozen integration promotion**
   - Open an integration-to-`main` PR from one frozen, fully validated candidate
     SHA.
   - Preserve the 41-commit implementation history with a merge commit; do not
     squash the umbrella promotion.
   - Reconfirm `main` and the candidate SHA immediately before merge. Merge only
     the independently approved unchanged candidate.

3. **Production release reconciliation**
   - Do not deploy from either dirty production checkout.
   - Preserve the active Caddy additions currently routing
     `invite-bishkek.72.62.119.112.sslip.io` and
     `inbox.72.62.119.112.sslip.io` as a separately reviewed infrastructure
     change before replacing the server checkout.
   - Preserve the `/opt/evo-crm/evo-lead-agent.git-backup-*` material until the
     owner explicitly approves archival or removal.
   - Build release images from the merged `main` SHA and add OCI source,
     revision, and version labels so a running image can be mapped back to Git.
   - Back up persistent data and record current image digests before deployment.
   - Move EVO CRM services off `acadis_*` networks onto EVO-owned networks while
     preserving private WAHA access and existing volumes.
   - Validate Compose and Caddy before restart, deploy one service boundary at a
     time, and retain the previous image digests for rollback.

4. **Canonical domains**
   - Create `A` records for `crm.evoadmissions.com` and
     `inbox.evoadmissions.com` pointing to `72.62.119.112` only through the
     authoritative DNS provider.
   - Verify public resolution, valid TLS, the expected login redirect, and Caddy
     routing. If authoritative DNS access is unavailable, record that exact
     external blocker and keep the working sslip.io routes.

5. **Real production proof**
   - Use a dedicated EVO-controlled test WhatsApp sender and the connected
     `evo-inbox` WAHA session.
   - Confirm real Supabase, encrypted WAHA, amoCRM, Gemini, and knowledge-base
     configuration through authenticated production readiness checks.
   - Keep unattended auto-reply disabled.
   - Send one controlled inbound message, verify the persisted message and
     amoCRM contact/lead identity, generate one knowledge-grounded Gemini draft,
     have the operator inspect/edit it, and send one manual WAHA reply.
   - Verify delivery and confirm no additional automatic outbound message
     exists in WAHA, Supabase, or amoCRM.
   - Run the legacy receive-only Lead Agent proof separately only after
     `crm_primary` is relinked and its missing amoCRM OAuth configuration is
      supplied. Do not reuse EVO Inbox credentials or its WAHA session.

6. **Provider-proof audit hardening**
   - Before any real outbound proof, persist every generated AI draft with its
     account, conversation, requesting operator, provider, model, knowledge
     evidence, generated text, and timestamp. Return the draft to the composer
     only after that audit record exists.
   - Carry the generated draft identifier through the editable composer to the
     manual-send request. A manual message may omit that identifier when the
     operator wrote the reply without AI.
   - Require a client-generated UUID for every manual send. Persist the complete
     send intent, operator (`messages.sender_id`), optional AI draft reference,
     and a `sending` provider state before calling WAHA. Enforce a unique
     request identifier so concurrent or repeated requests cannot call WAHA
     twice.
   - Treat a lost/ambiguous WAHA response as an uncertain operation and never
     retry it automatically. WAHA documents `POST /api/sendText`, returned
     message identifiers, `message.ack` events, and message lookup by provider
     identifier, but it does not document a caller-supplied idempotency key:
     https://waha.devlike.pro/docs/how-to/send-messages/
     https://waha.devlike.pro/docs/how-to/events/
     https://waha.devlike.pro/docs/how-to/chats/
   - Subscribe the signed EVO Inbox webhook to `message.ack`, persist
     acknowledgement history idempotently, and advance message state
     monotonically. Add a secret-protected reconciliation path only for rows
     that have a stable WAHA message identifier; do not infer provider success
     by matching message text or timestamps.
   - Keep first-launch automatic reply disabled. This block may create local
     migrations, tests, and reviewed code, but it must not send a real WhatsApp
     message. Apply the migration to the intended Supabase project before
     deploying the corresponding application image.

### Named write boundaries

- Security/gates block: root and EVO Inbox package manifests/lockfiles, the
  EVO Inbox global-style import plus its local shadcn Tailwind extension, the
  three whitespace-only files, root `.github/workflows/`, and plan evidence.
- Promotion block: plan evidence and GitHub PR state only; no runtime feature
  changes.
- Production block: EVO-owned Dockerfiles, Compose/Caddy configuration,
  deployment scripts/runbooks, and release metadata. Provider data may change
  only during the explicitly controlled production proof.
- DNS changes are limited to the two canonical EVO `A` records.
- Provider-proof audit block: EVO Inbox Supabase migrations/schema contract,
  AI draft route/composer state, manual WAHA send service/route, signed WAHA
  acknowledgement handling, bounded reconciliation route, focused tests, and
  implementation/runbook evidence. No provider message or customer record is
  created during implementation validation.

### Required validation

Run under Node `22.23.1`:

```bash
# Main CRM
npm ci
npm run lint
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
npm run build
npm run scenarios
npm audit --audit-level=moderate

# EVO Inbox
cd agent-lead2-inbox
npm ci --include=dev
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate

# EVO Lead Agent
cd evo-lead-agent
uv sync --extra dev
uv run ruff check .
uv run pytest
```

Also require:

- `git diff --check origin/main..CANDIDATE_SHA`
- a redacted Git-history secret scan over the same range
- validated production Compose rendering with real server environment files,
  without printing secret values
- real browser checks of the CRM and Inbox login/operator surfaces
- the authenticated production readiness and provider proof described above

`npm run format:check` currently fails across hundreds of pre-existing EVO
Inbox files. It is not a release gate for this slice because fixing the whole
format baseline would mix unrelated source churn into the security block.
Changed files must still match the repository formatter, and a separate
format-baseline issue must remain visible.

### Rollback and stop conditions

- Stop before DNS mutation if authoritative provider access or the exact zone is
  unavailable.
- Stop before the real message proof if an EVO-controlled test number,
  authenticated Inbox operator, connected WAHA session, or real
  Supabase/amoCRM/Gemini configuration is unavailable.
- Stop deployment if backups, current image digests, Caddy validation, Compose
  validation, or a rollback image is missing.
- Stop if the active dirty Caddy routes cannot be preserved without ownership
  clarification.
- Stop if dependency audit, CI, full-range diff, independent review, or frozen
  candidate checks fail.
- Never print, commit, or copy secret values into logs or repository files.

## Most Recently Completed Goal Slice

Completed slice: `/goal-evo-knowledge-business-context`.

This slice turns the two owner-supplied country drafts into clean text that can
be pasted into EVO Inbox and consolidates the company's business model into one
team-facing context document. The user has explicitly approved the supplied
China and Malaysia content as trusted business input. This slice therefore
cleans and structures that content without external fact-checking or silent
changes to its substantive claims.

Named write set:

- `docs/EVO_LAUNCH_PLAN.md` and `docs/PLAN_CHANGES.md`: execution contract and
  append-only decision record for issue #36.
- `docs/business/knowledge-base/README.md`: upload workflow, document registry,
  ownership, review rules, and current EVO Inbox text-input limitation.
- `docs/business/knowledge-base/ready-to-upload/`: normalized China and Malaysia
  Markdown texts, each intended to be pasted as one separate knowledge document.
- `docs/business/evo-business-context.md`: company, customer, service,
  operating-model, system, data, AI, measurement, governance, and risk context.
- `docs/business/README.md`, `docs/README.md`, and `CONTEXT.md`: discoverability
  and canonical business vocabulary.

Deliverables:

- Preserve the supplied Downloads files byte-for-byte and create reviewed copies
  under stable ASCII filenames in the repository.
- Remove draft labels, warning markers, unresolved transcription notes, open
  questions, broken numbering, and repeated FAQ copies.
- Preserve the owner-approved country claims, prices, routes, service promises,
  office details, and process content while making cost categories and steps
  independently understandable to retrieval.
- Add instructions that keep the assistant inside the approved text, collect a
  minimal admissions profile, avoid requesting sensitive documents in ordinary
  chat, and hand case-specific or uncovered questions to an EVO manager.
- Explain the current upload path accurately: EVO Inbox accepts a title and
  pasted text, then chunks and embeds the saved content; this slice does not add
  binary Markdown-file upload behavior.
- Build the business context from supplied company documents, existing business
  docs, implemented CRM entities, EVO Inbox contracts, Lead Agent contracts,
  and the current data-ownership map. Unknown owners and KPIs remain explicit
  gaps rather than invented facts.
- Do not change runtime code, database schemas, provider settings, deployment,
  DNS, production data, or WhatsApp behavior.

Acceptance evidence:

- SHA-256 checks prove the two supplied source files are unchanged.
- Both upload texts have no `⚠️`, draft/open-question markers, placeholder
  instructions, duplicated FAQ section, secret, or real client personal data.
- A chunk preview using the application's 1,200-character boundary shows both
  documents split into bounded, readable retrieval units.
- Repository links resolve, `git diff --check` passes, and a diff scan finds no
  secrets, bank values, private legal identifiers, or copied customer records.
- Required repository validation passes, or an exact unrelated blocker is
  recorded.
- An independent launch-control reviewer approves the final diff before merge.

Implementation evidence recorded 2026-07-13:

- The supplied China and Malaysia source SHA-256 values still match the values
  recorded in the knowledge registry.
- The real EVO Inbox `chunkText` function produced 14 China chunks with a
  1,197-character maximum and 13 Malaysia chunks with a 1,185-character
  maximum. No chunk exceeded 1,200 characters, ended with an orphan heading, or
  split a handoff lead-in from its trigger list.
- Relative-link, draft-marker, secret/credential, and diff-whitespace checks
  passed with no finding.
- Root lint, Next route generation, TypeScript, production build, all 39
  repository scenarios, and `npm audit --audit-level=moderate` passed under
  Node 22.23.1. The scenario report generated by validation was restored and is
  not part of this slice.
- The two focused EVO Inbox chunk/retrieval test files passed all 16 tests.
- Independent reviewers approved the final China document, Malaysia document,
  business context, data ownership, upload mechanics, privacy controls, and
  named write-set compliance.

## Previous Goal Slice

Completed slice: `/goal-evo-platform-source-of-truth`.

Next major lanes require their own reviewed slice: integration into `main`,
then the real production proofs tracked by GitHub issues #5 and #20.

This slice makes the current repository understandable and usable as the EVO
Admissions Platform source of truth without moving runtime code or changing
production. It is documentation, governance, and controlled source-document
work.

Deliverables:

- Replace the generic root README with a team-facing platform entrypoint.
- Add a complete documentation index, platform/system map, data-ownership
  registry, current-status page, onboarding guide, and business knowledge map.
- Add an EVO company profile based only on supplied real company documents,
  with no bank account values, personal identity numbers, signatures, or home
  addresses copied into tracked Markdown.
- Store the supplied public brand book in a tracked company brand folder.
- Store supplied bank/legal originals in a local Git-ignored private folder
  with restrictive permissions and a tracked safe manifest/checksum registry.
- Add a branded team overview presentation and a concise demo/presenter script.
- Mark historical handoffs and copied issue plans as archived or superseded;
  keep GitHub Issues as the changing work-status authority.
- Correct the active deployment documentation where it still names the Acadis
  proxy instead of the EVO-owned edge boundary.
- Track the safe root `.env.example` while continuing to ignore real `.env*`
  files.
- Do not move `src/`, `agent-lead2-inbox/`, `evo-lead-agent/`, change
  APIs/data models, deploy, alter DNS, or exercise outbound WhatsApp.

Acceptance evidence:

- All four supplied PDFs are identified by page count and SHA-256 checksum;
  the 24-page brand book is tracked and visually reviewed.
- Private source PDFs are present locally, ignored by Git, and not present in
  the staged diff.
- The presentation renders without overflow, overlap, clipping, or unresolved
  placeholders and is visually reviewed slide by slide.
- Repository links and source-of-truth statements are internally consistent.
- `git diff --check`, a staged-diff secret/PII scan, root lint/typecheck/build,
  and an independent launch-control review pass before merge.

Historical implementation material below remains as prior-slice context until
the documentation archive pass is complete.

The EVO Inbox companion lane is specified in
`docs/EVO_INBOX_COMPANION_PRD.md`. It creates a WACRM-derived, fully redesigned
standalone companion app at `agent-lead2-inbox/`, hosted at
`inbox.evoadmissions.com`, using managed Supabase Cloud, WAHA session
`evo-inbox`, WACRM's own draft-only AI assistant, and amoCRM as the identity
source of truth.

Deliverables for the reliable amoCRM sync buffer slice:

- Inbound WAHA `message` webhooks must save the local Supabase contact,
  conversation, and message before attempting amoCRM identity sync.
- Missing amoCRM configuration or temporary amoCRM provider failure must not
  prevent the message from appearing in EVO Inbox.
- Conversations and messages must expose `crm_sync_status` as `pending`,
  `synced`, `not_configured`, or `blocked`, with a safe operator-visible error.
- WAHA must receive HTTP 200 after local save, including the CRM sync state, so
  a saved message is not retried as a failed webhook.
- Add a bounded internal retry endpoint protected by `AUTOMATION_CRON_SECRET`
  to process pending/not configured CRM sync rows and optionally blocked rows
  after operator repair.
- Settings, Inbox UI, public API serializers, readiness, deployment docs, and
  proof checklist must show the new local-save-first behavior truthfully.
- Add migration `036_reliable_amocrm_sync_buffer.sql`.
- Run targeted WAHA/amoCRM/readiness/schema tests plus `npm test`,
  `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`,
  and a PR diff secret scan.
- Commit only this slice with a Conventional Commit.
- Request independent launch-control code-reviewer approval before merge.

Out of scope for this slice:

- Creating the real amoCRM external integration or token in the owner's browser.
- Claiming live WhatsApp, amoCRM, Gemini, Supabase migration, or deployment
  success before the real production services are exercised.
- Auto-reply, broadcast, template, historical import, or `/opt/evo-crm` changes.

Previous Gemini/preflight slice deliverables:

- Update the lead-agent readiness/preflight path so receive-only rollout
  readiness is distinct from outbound WhatsApp readiness.
- Make missing WAHA, amoCRM, CRM sync, Gemini, and admin configuration report
  exact input names.
- Keep local smoke no-outbound and failing when outbound is enabled.
- Update production env examples and deployment docs with Gemini configuration
  and receive-only safety flags.
- For the EVO Inbox companion, add Gemini as an encrypted account-level AI
  provider with a repeatable VPS seed command; keep the assistant draft-only.
- Run lead-agent `uv run pytest` and `uv run ruff check .`.
- Run parent CRM validation because deployment docs and Compose are touched, or
  record the exact blocker.
- Commit only this slice with a Conventional Commit.
- Request independent code-reviewer approval before merge.

Out of scope for this slice:

- Executing the production receive-only proof from issue #5.
- Enabling outbound WhatsApp.
- Claiming live WAHA, amoCRM, Gemini, or CRM sync success without real
  credentials and real provider responses.
- Merging or transplanting the unrelated Kant/Bitrix workspace.
- Rebuilding the CRM UI, role model, student portal, or amoCRM architecture.

## Execution Rules

- Use the real repo stack and real execution paths.
- Do not claim integration success from mocks, fallback paths, demo modes, sample
  payloads, or synthetic data.
- If a real service or credential is unavailable, the lane must fail clearly and
  name the missing input.
- Prepared AI responses are allowed only for the first presentation because the
  user explicitly requested them. They must not be represented as live Anthropic
  integration success.
- Keep each future lane small enough for review and tied to one mergeable block.
- Every future implementation block needs independent code-reviewer approval
  before merge.

## Repository Snapshot

The current repo is a Next.js App Router application for an education CRM.
Primary stack observed in `package.json`:

- Next.js `16.2.9`
- React `19.2.4`
- TypeScript `^5`
- Tailwind CSS `^4`
- ESLint `^9` with `eslint-config-next`
- SQLite through `better-sqlite3`
- Anthropic TypeScript SDK `@anthropic-ai/sdk`

Important source areas:

- `src/app/`: App Router pages, layouts, and route handlers.
- `src/app/api/ai/*/route.ts`: AI draft and client summary endpoints.
- `src/app/api/webhooks/*/route.ts`: WhatsApp and telephony webhook endpoints.
- `src/lib/db.ts`: SQLite schema bootstrap, seed data, settings, password hash
  helpers, and database access.
- `src/lib/auth.ts`: HTTP-only cookie session handling.
- `src/lib/actions.ts`: Server Actions for auth, CRM operations, WhatsApp send,
  settings, and locale.
- `src/lib/ai.ts`: Anthropic client and prompt execution.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API send/receive integration.
- `src/lib/queries.ts`: read models for dashboard, CRM, WhatsApp, calls, and
  portal views.

## Research Summary

Research was checked on 2026-06-24 against current local and online sources:

- Local Next.js docs in `node_modules/next/dist/docs/` were inspected as required
  by `AGENTS.md`, including App Router route handlers, environment variables, and
  the production checklist.
- Context7 official Next.js docs for `/vercel/next.js/v16.2.9` confirm route
  handlers live under `app/**/route.ts`, supported HTTP methods are exported
  functions, `next build` is the production build gate, and `next typegen && tsc
--noEmit` is the documented route/type validation path.
- Context7 official Anthropic TypeScript SDK docs confirm server-side SDK usage
  through `client.messages.create`, API-key configuration, and message arrays as
  the real request path. Launch validation must use a real configured API key or
  explicitly report `not_configured`.
- Context7 `better-sqlite3` docs confirm direct database opening, prepared
  statements, PRAGMA usage, transactions, and WAL mode as normal production
  patterns for SQLite-backed Node.js apps.
- amoCRM's current developer docs describe `/api/v4/leads` as the deal endpoint
  with pipeline/status IDs, responsible user IDs, custom field values, and
  embedded contacts/companies; `/api/v4/contacts` carries contact custom field
  values; OAuth access and refresh tokens come from `POST /oauth2/access_token`.
- The existing README describes demo accounts, WhatsApp demo mode, IP telephony
  webhooks, client portal, multilingual UI, SQLite backup, and Anthropic-powered
  AI features. Those claims must be verified against the actual app before any
  production or sales-readiness claim.

Current risk surfaced by repo inspection:

- The repo has demo accounts and seeded demo data in `src/lib/db.ts`.
- `src/lib/auth.ts` has a development fallback `AUTH_SECRET`.
- `src/lib/whatsapp.ts` must not return a `demo` send status when WhatsApp
  credentials are missing; missing credentials must produce a visible failed
  send state rather than fake delivery success.
- README must not say missing WhatsApp keys use demo mode. Prepared AI text is
  acceptable only for explicitly labeled presentation behavior, not production
  launch or delivery success.
- AI routes depend on live Anthropic configuration and should fail as
  `not_configured` when no key exists.
- There is currently no explicit `typecheck` script and no test script in
  `package.json`.
- `npm audit --audit-level=moderate` currently fails on an existing PostCSS XSS
  advisory reached through Next.js. The suggested `npm audit fix --force` would
  install an incompatible Next.js downgrade, so this must be handled in a future
  security or dependency lane, not hidden inside this docs-only slice.
- `npm run build` passes after local dependency repair, but Next.js warns that it
  inferred the workspace root from `/Users/iskhak.tazhibaev/package-lock.json`
  because another lockfile exists above the repo. A future config lane should
  either set the documented Turbopack root or remove the stray parent lockfile.

## Acceptance Criteria

### This QA Launch Readiness Slice

- `docs/PLAN_CHANGES.md` has an append-only `/goal-qa-launch` entry before
  runtime or test coding because this lane changes active scope, acceptance
  criteria, file ownership, merge-order status, and validation evidence.
- `docs/QA_LAUNCH_REPORT.md` records the QA method, scored checklist, desktop
  and mobile screenshots paths, pass/fail evidence, changes made, validation
  output, stop reason, and named blockers.
- Browser QA starts from a fresh context with no saved login, cookies, or site
  data, then covers login and critical staff/client flows at 1440x900 and
  390x844 or comparable desktop/mobile sizes.
- The single checklist scores auth/role routing, staff CRM flow, student portal
  flow, integration truthfulness, AI/prepared boundary, i18n/language switching,
  responsive layout, security/secret handling, validation/build readiness, and
  presentation demo clarity.
- Any implementation change is limited to launch-blocking bug fixes, blocker or
  prepared/live copy clarity, validation/scenario coverage, QA report/runbook
  documentation, or small UI polish needed for critical flows.
- Missing WhatsApp, telephony, amoCRM, and Anthropic credentials are reported as
  explicit `not_configured` / `blocked` states or blockers, never as demo or
  hidden mock success.
- Existing staff CRM, student portal, amoCRM settings/status, WhatsApp,
  telephony, and AI boundaries continue to build and smoke successfully after
  the changes.
- Validation is run through the real repo commands for this slice:
  `node node_modules/eslint/bin/eslint.js .`,
  `node node_modules/next/dist/bin/next typegen`,
  `node node_modules/typescript/bin/tsc --noEmit`,
  `node node_modules/next/dist/bin/next build`, `npm run scenarios`, fresh
  browser QA rerun, and `npm audit --audit-level=moderate`.
- Pre-commit security audit is run with `npm audit --audit-level=moderate`; any
  existing advisory is documented rather than bypassed.
- The QA launch commit uses a Conventional Commit message.
- An independent code-reviewer reviews the QA launch diff and evidence against
  this goal before merge and returns `approved` or `changes_requested`.

### Launch Acceptance

The app is launch-ready only when all items below are true and evidenced:

- Auth: no production deployment uses default secrets, demo passwords, or
  unlabeled seeded demo accounts.
- Database: SQLite file path, WAL behavior, schema bootstrap, backup/restore, and
  seed policy are documented and verified on the real runtime target.
- CRM core: staff login, dashboard, sales pipeline, lead-to-client conversion,
  client profile, tasks, finance, reports, and client portal complete real flows
  against the real SQLite database.
- WhatsApp: Cloud API credentials and webhook verification are configured against
  Meta's real service, or the feature is visibly blocked. A `demo` status cannot
  be counted as send success.
- Telephony: webhook authentication and payload handling are validated against a
  real provider configuration or blocked with the missing provider named.
- AI: draft and summary endpoints run through the real Anthropic SDK with a real
  key, or return clear `not_configured`. Prepared responses may be used only in
  the first presentation and must be labeled as prepared content.
- Security: server inputs are schema-validated at API and Server Action
  boundaries, sensitive errors are not leaked, secrets are only environment or
  settings values, and role checks match the feature surface.
- UI: production-critical pages render without broken layout at desktop and
  mobile widths, with Russian/Kyrgyz/English locale switching preserved.
- Validation: lint, typecheck, build, and critical real E2E flows pass. Any
  unavailable credential or external system is a named blocker, not a fake pass.

## File Ownership

Planning and governance:

- `docs/EVO_LAUNCH_PLAN.md`: launch contract owner. Changes require a
  corresponding entry in `docs/PLAN_CHANGES.md` after this slice lands.
- `docs/PLAN_CHANGES.md`: append-only change log. Never rewrite prior entries.

Application architecture:

- `src/app/(staff)/**`: staff-facing CRM pages and navigation.
- `src/app/portal/**`: client portal experience.
- `src/app/login/**`, `src/app/register/**`, `src/app/page.tsx`: auth entry and
  role routing.
- `src/app/api/ai/**`: Anthropic-backed AI endpoints.
- `src/app/api/webhooks/**`: external webhook boundaries.
- `src/components/**`: shared UI and client components.
- `src/lib/db.ts`: schema, connection, seed, settings, password hashing.
- `src/lib/auth.ts`: session token signing and current user resolution.
- `src/lib/actions.ts`: Server Action mutations.
- `src/lib/queries.ts`: read models.
- `src/lib/ai.ts`: Anthropic client and AI generation contract.
- `src/lib/prepared-ai.ts`: deterministic prepared prompt library and response
  scenario generator for the first presentation.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API integration.
- `src/lib/i18n.ts`: locale keys and translations.
- `src/lib/domain.ts`: canonical CRM roles, route map, status values, domain
  entity types, and route access helpers.
- `src/lib/contracts/amo-crm.ts`: amoCRM adapter interface and sync DTOs.
- `src/lib/contracts/student-portal.ts`: client-visible portal contract.
- `src/lib/contracts/prepared-ai.ts`: prepared response boundary for the first
  presentation.
- `src/lib/contracts/index.ts`: public export surface for integration contracts.
- `package.json`, `eslint.config.mjs`, `tsconfig.json`, `next.config.ts`:
  validation and build configuration.

Future lanes must name their write set before coding. If a lane needs to edit
outside its named ownership area, update `docs/PLAN_CHANGES.md` first.

`/goal-evo-inbox-companion` planned write set:

- `docs/EVO_INBOX_COMPANION_PRD.md`: product contract and acceptance context.
- `docs/EVO_LAUNCH_PLAN.md`: lane status, phase plan, write sets, and
  validation gates.
- `docs/PLAN_CHANGES.md`: append-only decisions and scope changes.
- `CONTEXT.md` and `docs/adr/**`: domain language and architectural decisions.
- `agent-lead2-inbox/**`: WACRM-derived EVO Inbox app, Supabase
  migrations, WAHA transport, amoCRM resolver, AI draft surfaces, redesigned UI,
  tests, and MIT license notice.
- `docker-compose.prod.yml`, deployment docs, and Caddy deployment notes only
  when the deployable companion service is introduced.

`/goal-evo-inbox-companion` phase plan:

1. Source setup: create a clean implementation branch from the intended base,
   copy WACRM into `agent-lead2-inbox/`, preserve MIT license notice, and
   establish local install/build/test commands.
2. Product pruning: remove or hide Meta Cloud API, broadcasts, broad
   automations, flow-driven sending, and first-launch-disabled WACRM surfaces.
3. WAHA transport: replace Meta send/webhook/session assumptions with WAHA
   session `evo-inbox`, authenticated webhooks, idempotent inbound persistence,
   and manual outbound send.
4. Supabase foundation: configure managed Supabase, migrations, Auth, storage,
   RLS, service-role server paths, and companion shadow records.
5. amoCRM identity: resolve by phone, create missing contact/lead, store
   `amo_contact_id` and `amo_lead_id`, and block local-only lead presentation
   when amoCRM is unavailable.
6. AI draft and knowledge: keep WACRM's OpenAI/Anthropic draft assistant and
   knowledge base, default auto-reply off, and route manual sends through WAHA.
7. Full EVO Inbox redesign: redesign retained surfaces around admissions
   operators, integration status, lead profile, AI draft, knowledge base, and
   production readiness.
8. VPS deployment: add a separate `hermes-vps` service and Caddy route for
   `inbox.evoadmissions.com`; verify only with real DNS, Supabase, WAHA, amoCRM,
   and AI provider credentials.

`/goal-evo-inbox-companion` acceptance criteria:

- The companion app runs from `agent-lead2-inbox/` without depending on
  Meta Cloud API configuration.
- First launch supports one WAHA session named `evo-inbox`.
- Inbound WAHA messages are authenticated, idempotent, persisted in Supabase,
  and visible in the redesigned EVO Inbox.
- The app resolves or creates amoCRM identity before presenting a lead as real.
- Supabase stores shadow records and app data, not canonical CRM identity.
- AI draft works through the companion app's own assistant; auto-reply is off by
  default.
- An operator can send one manual WhatsApp reply through WAHA after reviewing
  the conversation and optional AI draft.
- Broadcasts, broad automations, flow-driven sending, and Meta templates are
  absent or disabled in first-launch UI and runtime paths.
- `inbox.evoadmissions.com` deployment is only claimed after a real
  `hermes-vps` deployment, Caddy routing, DNS, WAHA, Supabase, amoCRM, and AI
  provider check succeeds.

`/goal-qa-launch` named write set:

- `docs/EVO_LAUNCH_PLAN.md`: current-slice and acceptance update.
- `docs/PLAN_CHANGES.md`: append-only QA launch entry.
- `docs/QA_LAUNCH_REPORT.md`: QA checklist, screenshot paths, validation, stop
  reason, and blockers.
- `docs/SCENARIO_EVALUATION.md`: refreshed only by the required scenario runner
  as validation evidence.
- Runtime, scenario, or copy files only if the QA pass exposes a
  launch-blocking bug, fake-success claim, missing validation evidence, or small
  critical-flow UI issue inside this slice.

`/goal-lead-agent-webhook-ownership` named write set:

- `docs/EVO_LAUNCH_PLAN.md`: append this implementation block.
- `docs/PLAN_CHANGES.md`: append webhook ownership and source-of-truth decision.
- `AGENTS.md`, `deploy/README.md`, `docker-compose.prod.yml`,
  `deploy/env.lead-agent.example`, `.gitignore`, `.dockerignore`,
  `eslint.config.mjs`, `tsconfig.json`: deployment, repo-boundary, and
  validation configuration for the lead-agent sibling service.
- `src/lib/db.ts`, `src/lib/whatsapp.ts`, `src/lib/actions.ts`,
  `src/lib/queries.ts`, `src/lib/i18n-data.ts`,
  `src/app/(staff)/settings/page.tsx`,
  `src/app/(staff)/whatsapp/[id]/page.tsx`, `scripts/bootstrap-admin.mjs`: CRM
  schema, settings, read models, bootstrap schema, and operator-visible
  source-of-truth state.
- `src/app/api/internal/lead-agent/**`: private internal sync endpoint from the
  lead-agent service into EVO CRM.
- `evo-lead-agent/AGENTS.md`, `evo-lead-agent/README.md`,
  `evo-lead-agent/.env.example`, `evo-lead-agent/Dockerfile`,
  `evo-lead-agent/docker-compose.yml`, `evo-lead-agent/pyproject.toml`,
  `evo-lead-agent/uv.lock`, `evo-lead-agent/SECURITY.md`,
  `evo-lead-agent/functional-spec.md`, `evo-lead-agent/technical-spec.md`,
  `evo-lead-agent/implementation-plan.md`,
  `evo-lead-agent/token-cost-estimate.md`, `evo-lead-agent/research/README.md`,
  `evo-lead-agent/*context-report.md`,
  `evo-lead-agent/src/evo_lead_agent/**`, `evo-lead-agent/tests/**`:
  product rename, lead-agent runtime packaging, callback configuration, signed
  CRM sync client, service pipeline, and focused tests.

Acceptance criteria:

- WAHA webhook ownership moves to the lead-agent service. Production/session
  configuration should point WAHA at `http://evo-lead-agent:8000/webhooks/waha`
  on the private Docker network, not the public CRM route.
- The lead-agent resolves or creates amoCRM contact/lead first, then sends a
  signed internal sync payload to EVO CRM.
- EVO CRM persists remote amoCRM identifiers and lead-agent state on the local
  lead/conversation records without making local state the source of truth.
- EVO CRM keeps the staff WhatsApp inbox/operator UI usable by storing inbound
  and outbound message copies linked to the resolved amoCRM lead/contact.
- Both internal CRM sync and WAHA webhooks must be authenticated with shared
  secrets/HMAC-style verification; no public unauthenticated mutation endpoint
  is allowed.
- The first live receive-only test may enable autoreply only for Gemini draft
  review, but must keep outbound disabled until WAHA, amoCRM, CRM internal sync,
  and Gemini configuration are verified with real credentials and a later
  outbound send test is explicitly approved.
- The parent repo owns the EVO-specific `evo-lead-agent` source. Parent CRM
  validation must still avoid scanning lead-agent Python/runtime internals with
  Next.js tooling, and `evo-lead-agent/research/repos` stays untracked so
  unrelated reference snapshots do not become production source.

`/goal-gemini-receive-only-production-preflight` named write set:

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`, `deploy/README.md`,
  `deploy/env.lead-agent.example`, `docker-compose.prod.yml`: parent launch
  contract and production deployment readiness path.
- `evo-lead-agent/README.md`, `evo-lead-agent/.env.example`,
  `evo-lead-agent/PLAN_CHANGES.md`, `evo-lead-agent/implementation-plan.md`,
  `evo-lead-agent/technical-spec.md`,
  `evo-lead-agent/src/evo_lead_agent/readiness.py`,
  `evo-lead-agent/src/evo_lead_agent/preflight.py`,
  `evo-lead-agent/src/evo_lead_agent/cli.py`,
  `evo-lead-agent/tests/test_readiness.py`,
  `evo-lead-agent/tests/test_preflight.py`,
  `evo-lead-agent/tests/test_cli.py`: parent-tracked lead-agent receive-only readiness,
  preflight, local smoke, docs, and regression coverage.

Acceptance criteria:

- Env examples and deploy docs include Gemini configuration and receive-only
  safety flags.
- Readiness and preflight distinguish `receive_only_rollout` from
  `live_whatsapp_outbound`.
- Missing WAHA, amoCRM, CRM sync, Gemini, and admin configuration is reported
  by exact missing input name.
- Local smoke remains no-outbound and fails if outbound is enabled.
- `uv run pytest` and `uv run ruff check .` pass in `evo-lead-agent`.
- Parent CRM validation runs because deployment docs and Compose are touched.

## Merge Order

1. `plan-contract`: docs-only launch contract. Blocks implementation lanes.
2. `brand-research`: docs-only product/domain research for copy and education
   flow realism.
3. `architecture-contract`: role, route, entity, amoCRM adapter, student portal,
   and prepared AI contracts.
4. `crm-baseline`: separate runtime baseline commit required so later slices can
   build from a clean checkout without mixing baseline and prepared-AI review.
5. `prepared-ai-prompts`: user-requested first-presentation prepared response
   layer with explicit prepared/live boundaries.
6. `admissions-crm-core`: core staff CRM surfaces for Command Center,
   Admissions Pipeline, Student 360, tasks, documents, applications, and finance
   overview.
7. `student-portal`: first production-quality authenticated student portal over
   the stable student, application, document, payment, task, and update
   contracts.
8. `amocrm-integration`: runtime amoCRM settings/status/adapter foundation with
   truthful configured/not-configured/blocked behavior. Completed before
   `/goal-qa-launch`.
9. `/goal-qa-launch`: combined release/presentation QA readiness lane covering
   validation-baseline, production truthfulness, security/secret checks,
   CRM-core flow verification, real integration blocker recording,
   presentation-readiness evidence, release-readiness reporting, and clean-tree
   final audit without rebuilding feature architecture.
10. `/goal-lead-agent-webhook-ownership`: make the lead-agent service the
    private WAHA webhook owner, use amoCRM as source of truth, and sync local
    CRM shadow state for the operator UI.
11. `/goal-gemini-receive-only-rollout`: replace Anthropic drafting with
    Gemini 3.5 Flash draft review in the EVO lead-agent, then prove receive-only
    production WhatsApp rollout on `hermes-vps` with real WAHA, amoCRM, CRM sync,
    and Gemini credentials while outbound WhatsApp remains disabled.

Each lane must be merged or intentionally abandoned before the next lane starts.

## Required Validation Commands

Current baseline commands for this repo:

```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
npm run scenarios
npm audit --audit-level=moderate
```

Future implementation lanes should add real integration and E2E checks to this
list rather than replacing these gates.

## Dependency Audit Hardening And Frontend Merge Readiness

Active slice: `/goal-evo-dependency-hardening`.

This slice restores a truthful green dependency gate after two advisories were
published against the already-merged frontend dependency graph. It must merge
before the independent design-polish PR is rebased and merged.

### Scope

- Update the root CRM and `agent-lead2-inbox` PostCSS resolutions to a current
  patched release and regenerate both lockfiles under the repository Node 22
  runtime.
- Keep `npm audit --omit=dev --audit-level=moderate` blocking for both deployed
  Next.js applications.
- Add a repository-owned development-audit verifier that accepts only
  `GHSA-mh99-v99m-4gvg` and only the known ESLint/minimatch package chain.
- Give the temporary allowlist an explicit owner, reason, and review deadline.
- Keep every other direct or transitive advisory blocking, including any new
  advisory that appears after this plan is written.
- Do not use `npm audit fix --force`, unsupported transitive major overrides,
  broad `continue-on-error`, or an unbounded audit exception.

Named write set:

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`: launch contract and
  append-only decision record.
- `package.json`, `package-lock.json`,
  `agent-lead2-inbox/package.json`,
  `agent-lead2-inbox/package-lock.json`: patched PostCSS resolution and locked
  dependency graphs.
- `.github/workflows/evo-platform-ci.yml`: separate blocking production and
  constrained development audit gates.
- `scripts/check-npm-audit-allowlist.mjs`,
  `config/npm-audit-allowlist.json`: real npm audit execution and the
  time-bounded exception contract.

### Acceptance criteria

- Root CRM and EVO Inbox production audits return zero vulnerabilities.
- Full development audits may contain only the known
  `brace-expansion -> minimatch -> ESLint/Next lint plugins` chain recorded in
  the allowlist.
- The verifier fails closed on malformed npm output, an expired allowlist, an
  unknown advisory URL, or an unknown affected package.
- Root CRM and EVO Inbox install, lint, type-check, test and production build
  gates pass from their committed lockfiles.
- The hardening PR passes GitHub CI and receives an independent launch-control
  `approved` verdict before merge.
- After the hardening PR merges, PR #72 is rebased onto current `main`, reruns
  the complete CI workflow, receives an independent freshness/correctness
  confirmation, and only then merges.
- No deployment, provider mutation, production database change, live WhatsApp
  send, or amoCRM write occurs in this slice.

### Current primary sources

- npm audit supports separate omitted dependency classes and severity-based
  exit thresholds:
  <https://docs.npmjs.com/cli/v11/commands/npm-audit/>.
- `brace-expansion` advisory:
  <https://github.com/advisories/GHSA-mh99-v99m-4gvg>.
- PostCSS advisory:
  <https://github.com/advisories/GHSA-r28c-9q8g-f849>.

## EVO Platform Post-Design Review Polish Slice

Active slice: `/goal-evo-platform-design-polish`.

This slice applies the independent Claude Design review dated 2026-07-25 to
the already-merged unified frontend. It is a frontend refinement pass, not a
rebuild. The reviewed baseline is `origin/main` at
`3dd571bf302bd46dd020e029eb5ab40da5a1a277`.

### Product and technical boundaries

- amoCRM remains canonical for lead/contact identity and sales stage.
- AI customer replies remain draft-only and require explicit operator send.
- Provider status remains honest; no WAHA, amoCRM, AI, telephony, storage or
  payment connection may be presented as verified without a real exercise.
- Existing roles and server-side authorization are unchanged.
- This slice changes frontend presentation and frontend regression coverage
  only. It does not change database schemas, webhook/provider contracts,
  Compose/Caddy, secrets, deployment or production state.

### Public test seams

The agreed seams for test-first changes are browser-visible behavior and
accessible DOM on existing routes. Tests should assert what an operator or
student can see and operate at `1440x1024`, `834x1194` and, where applicable,
`390x844`; they should not assert private helper implementation.

- WhatsApp: bubble semantics by delivery state, honest context summary,
  compact mobile source disclosure, useful empty state and non-duplicated
  composer guidance.
- Staff navigation: distinct application/visa destinations, discoverable
  icon-rail labels on hover and keyboard focus, and no horizontal overflow.
- Dashboard: one attention heading and an action-first queue that handles
  zero-count/all-clear states.
- Student 360, permissions and portal: collapsed data-entry affordances,
  semantic permission indicators, useful desktop density and brand-consistent
  system copy.

### Implementation waves

1. **P1 isolated refinements:** F1 outgoing WhatsApp bubbles, F2 distinct visa
   icon and F4 useful Inbox empty state.
2. **P1 responsive navigation:** F3 tablet icon rail with durable
   hover/focus-visible labels and explicit active state.
3. **P2 dashboard and Inbox:** F5 duplicated dashboard eyebrow, F6 zero-first
   priority queue, F7 repeated unverified-sync values, F8 oversized mobile
   source banner and F10 duplicated composer label/placeholder.
4. **P2 structure and polish:** F9 Student 360 anchor/form density, F11
   permission glyphs, F12 portal desktop lower-zone utility and F13 system
   update emoji.

### Acceptance

- Three consecutive outgoing messages do not create a red wall; red is
  reserved for `failed`, and all supported delivery states retain their exact
  mapping.
- `/applications` and `/visa` are visually distinct at 834px, every icon-rail
  destination has an accessible label, and that label becomes visible on
  hover and keyboard focus.
- The no-selection Inbox state explains the next action and repeats that AI
  only creates a draft.
- Dashboard attention content leads with real actions; when every count is
  zero it shows the all-clear copy from the design review.
- At 390px at least two messages are visible without scrolling while provider
  source detail remains available.
- Student 360 keeps deep links and mutations available without showing all
  add forms by default.
- Portal desktop uses existing data to reduce the empty lower zone and does
  not invent a provider result.
- Lint, TypeScript, production build, scenarios, security checks, Playwright
  and automated accessibility checks pass under Node 22.
- Fresh screenshots cover affected routes at required viewports, including
  both light and dark WhatsApp message treatment where supported.
- An independent reviewer checks the final diff against this contract before
  the pull request is offered for merge.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
  `docs/design/evo-platform/COMPLETION_CHECKLIST.md` and frontend screenshot or
  audit evidence under `docs/design/evo-platform/**`.
- `src/app/globals.css`, affected routes under `src/app/(staff)/**` and
  `src/app/portal/**`.
- Shared presentation components under `src/components/**` and existing
  presentation/query copy under `src/lib/**` only when needed for F1-F13.
- Focused public-behavior regression coverage under `tests/**`.

## Stop Conditions

Stop and escalate when:

- Required real credentials, provider accounts, data, or deployment targets are
  missing.
- A lane would need hidden mocks, demo paths, or fake success to pass.
- Scope, architecture, acceptance criteria, file ownership, or merge order needs
  to change and `docs/PLAN_CHANGES.md` has not been updated first.
- Independent reviewer approval is unavailable and the user has not explicitly
  waived the launch-control gate.
- Validation fails for reasons outside the lane's scope and cannot be fixed
  without changing the contract.

## Historical Final EVO Platform Technical Specification Slice

Completed predecessor slice: `/goal-evo-platform-final-tz`.

This slice turns the completed frontend, the audited repository, the
owner-supplied OZO technical brief, current production boundaries, business
process documentation, ADRs and design evidence into the implementation
contract for the unified EVO Admissions platform. P0 now corrects its remaining
role, ownership, environment, retention and release-gate gaps. Repository
implementation starts only after P0 merges; production mutations still require
their own explicit authorization.

### Scope

- Produce one canonical Russian-language specification covering business
  outcomes, actors, roles, workflows, data ownership, integrations,
  non-functional requirements, migration, release gates and acceptance tests.
- Treat the owner-supplied OZO brief as contextual input, not as automatically
  correct architecture or product truth. Preserve useful process requirements,
  record corrections, and expose unresolved decisions explicitly.
- Keep amoCRM canonical for lead/contact identity, responsible manager and
  sales stage. Keep operational admissions stages separate from the sales
  pipeline.
- Define one dedicated Supabase production project for all EVO-owned platform
  data. Keep local/dev, persistent staging and preview branches/projects
  physically isolated with the same migrations and no production-data copy by
  default. Do not create separate production projects for Inbox and CRM.
- Define one WAHA/WhatsApp ingress, idempotent event handling, durable message
  history, draft-only AI, manual outbound confirmation and delivery/read audit.
- Specify how useful Lead Agent responsibilities move into the unified backend.
  Retirement is allowed only after a controlled real end-to-end proof,
  reconciliation, rollback window and owner approval.
- Reuse the accepted EVO frontend and brand evidence as the interaction
  contract. Figma or prototype files are supporting design evidence, not a
  substitute for this technical specification.
- Distinguish verified current behavior, target requirements, assumptions,
  external blockers and future options throughout the document.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`: launch contract and
  append-only decision record.
- `docs/specs/EVO_PLATFORM_TZ.md`: canonical reviewable specification source.
- `docs/specs/EVO_PLATFORM_TZ.docx`: editable owner-facing specification.
- `docs/specs/EVO_PLATFORM_TZ_VALIDATION.md`: reproducible validation and
  page-inspection ledger.
- `scripts/generate-evo-platform-tz.py`: deterministic DOCX builder.
- `scripts/verify-evo-platform-tz.py`,
  `scripts/requirements-evo-platform-tz.txt`: isolated dependency, real
  LibreOffice/Poppler render and accessibility/traceability verification
  contract.
- Existing brand and implementation screenshots under `docs/company/brand/**`
  and `docs/design/evo-platform/**` may be read and embedded; they are not
  modified by this slice.

### Acceptance criteria

- Every `FR`, `NFR`, `INT`, `DATA`, `SEC`, `ACC` and `DEC` ID is listed
  individually in a provenance matrix that points to repository evidence,
  official provider documentation, the OZO brief or an explicit owner
  decision. Every requirement also has an explicit priority and verification
  method.
- Data ownership and synchronization rules prevent two independently writable
  lead/contact/sales-stage sources of truth.
- Roles and permissions cover both server-side authorization and visible UI,
  including denial, audit and privileged-action rules.
- The migration plan keeps the current production path reversible and does not
  delete Lead Agent before the real WhatsApp-to-amoCRM-to-platform path is
  proven.
- The controlled acceptance journey is explicit:
  `WhatsApp -> amoCRM -> EVO Platform -> AI draft -> manual send ->
  delivery/read status -> audit history`.
- Unknown provider states, missing credentials and unverified integrations
  remain visibly blocked; no mock or configured flag is described as production
  proof.
- The DOCX uses the EVO brand, has a real heading hierarchy, marked table
  headers, meaningful image alt text and no secret or applicant personal data.
- A fresh Python environment installs the pinned DOCX dependency manifest, the
  repo-owned verifier builds the DOCX, renders it through real
  LibreOffice/Poppler, validates item-level traceability and writes structured
  accessibility evidence. The packaged document renderer is also used for the
  final owner-facing render.
- Every final page is visually inspected at original resolution and recorded in
  `docs/specs/EVO_PLATFORM_TZ_VALIDATION.md`; the automated accessibility audit
  has zero unresolved high, medium or low findings.
- All substantive owner-facing content comes from
  `docs/specs/EVO_PLATFORM_TZ.md`; the generator adds only presentation
  mechanics such as the branded cover, footer and Word TOC field.
- An independent reviewer checks the final specification against source
  evidence, architecture boundaries and acceptance criteria before merge.
- No production deployment, provider mutation, database migration, live
  WhatsApp send or amoCRM write occurs in this slice.
