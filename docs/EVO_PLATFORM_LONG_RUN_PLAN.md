# EVO Platform Long-Run Execution Contract

Status: active repository implementation contract
Version date: 2026-07-28 (Asia/Bishkek)
Initial kickoff baseline: GitHub `origin/main` at
`a16cd3fb591128b6d28f7f46c432169a0ff28753`
Authority: this plan, `docs/specs/EVO_PLATFORM_TZ.md`, the latest merged
`docs/PLAN_CHANGES.md`, and superseding ADRs

Execution checkpoint: P0, all P1 sub-blocks, the P2 Supabase-foundation
decomposition and P2A canonical migration authority are merged through PR
#82. GitHub `origin/main` is green at
`8ad755b5039390f418dbe12924a806f069f93b53`. The active change is this
docs-only P2 checkpoint-freshness amendment until it is merged. At that merge
commit, P2B becomes the active implementation block under the existing
contract and must be rebased, revalidated and independently reviewed; P2C-P2I
remain sequentially blocked behind their preceding P2 gate.

## 1. Outcome and truth boundary

The target is one EVO Platform that preserves the accepted frontend contract
while replacing the current split backend deliberately and reversibly:

- amoCRM remains canonical for contact, lead, responsible sales manager and
  sales stage;
- one dedicated Supabase production project stores EVO-owned operational data;
- local/dev, persistent staging and preview branches/projects remain physically
  isolated from production, with no production-data copy by default;
- EVO Inbox and useful EVO Lead Agent capabilities move into one backend and
  one logical data model;
- one private WAHA session/number, `evo-inbox`, and one EVO Platform webhook
  owner serve the final production path;
- staff and Student Portal use real server authorization, RLS, object scope and
  durable audit;
- AI creates reviewable RU/EN drafts only. A human edits and manually sends.

The accepted frontend is a UI contract, not evidence that Supabase, amoCRM,
WAHA, AI, Storage, notification delivery or production cutover works. The
platform must not be called production-complete until the controlled provider
path, cutover, rollback evidence and 72-hour soak are real.

## 2. Current verified baseline

As of the version date:

- GitHub `main` is green at `8ad755b5039390f418dbe12924a806f069f93b53`;
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

These facts describe the present system. Target-architecture documents do not
silently change production.

## 3. Non-negotiable business contract

### 3.1 Roles, ownership and handoff

- First-release authority classes are `admin`, `sales`, `curator`, `finance`
  and Client/Student. The target Platform machine role for the last class is
  `student`; the current root `client` role remains a legacy identifier until
  an explicit P3 identity mapping. There is no separate `visa` role; the
  `/visa` module and visa entities remain.
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
  001–039 until controlled P3/P5 cutover. `platform` is the new Data
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
| P2 | Unified Supabase foundation and reconciled migrations | Canonical history, clean local Supabase reset, RLS/secret negative matrix, separate isolated DB and Storage-object restore | P2A merged in PR #82; P2B becomes active when this checkpoint amendment merges |
| P3 | Root auth and operational SQLite migration path | Read-only inventory, deterministic mapping, dry-run reconciliation, staging comparison, rollback rehearsal | Pending |
| P4 | Canonical amoCRM adapter | Versioned discovery, read-only sync, webhook/outbox/reconciliation; live proof only with sanitized test lead | Pending |
| P5 | Unified Inbox/WAHA/Lead Agent capability absorption | Persist-before-process, dedupe, queue/history, manual-send and ACK evidence; no old cutover yet | Pending |
| P6 | Admissions, Portal, Documents, Finance, Notifications | Two-student isolation E2E and complete staff-to-portal workflows | Pending |
| P7 | Security, reliability and operations | Threat model, load evidence, backup plus Storage restore, RPO/RTO and rollback rehearsal, accessibility | Pending |
| P8 | Release/cutover candidate | Frozen snapshot/reconciliation/runbooks and real controlled end-to-end evidence; no production action in this run | Pending |
| P9 | 72-hour soak and separate Lead Agent retirement PR | At least 72 actual hours, zero unexplained loss/duplicate/drift and proven rollback | Time-gated |
| P10 | Completion audit | Every FR/NFR/SEC/ACC mapped to evidence, full CI/provider proof, no open implementation PR | Pending |

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
| P2I | Run whole-foundation evidence and repair only through the next free forward migration if needed | Clean reset, RLS/grant/secret inventory, browser secret scan, isolated DB restore and separate Storage-object restore |

P2 does not rename or drop legacy Inbox tables, cut root authentication over,
copy real secrets into Vault, change legacy public bucket behavior or apply any
production migration. New Platform tables are additive. P2B must verify actual
current Inbox consumers before revoking a legacy table grant. `avatars` and
`flow-media` remain explicit compatibility decisions; new private Platform
buckets are introduced only in P2H.

### P3 — root auth and operational migration

Inventory and back up SQLite read-only first. Produce deterministic UUID
mapping, counts, orphan and checksum reports, staging import and temporary
dual-read comparison. Do not create long-term dual-write. Merge cutover code
disabled/fail-closed; production cutover remains separately authorized.

### P4 — canonical amoCRM adapter

Discover and version account-specific mappings. Begin read-only; then add
persisted webhook intake, idempotency, asynchronous work, reconciliation,
conflicts and loop prevention. Guard canonical writes. A confirmed contract
mapping creates a pending case; Admin Curator assignment activates handoff and
Portal.

### P5 — unified communications

Unify Inbox history and role-scoped Sales/Curator queues, retaining distinct
internal, WAHA and Kommo identifiers. Implement one target webhook owner,
draft-only RU/EN AI and manual-send audit. Remove or disable broadcast, flow and
auto-reply surfaces. Do not switch the old webhook/session without controlled
proof and separate production authorization.

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

### P9 — soak and retirement

Observe real traffic for at least 72 actual hours with loss, duplicate, drift,
webhook, outbox, conflict, unknown-delivery and rollback monitoring. Only after
all evidence exists may a separate reviewed PR remove `evo-lead-agent/`,
Compose/env/volume references, the `crm_primary` legacy path/session, internal
sync route and obsolete secrets/runbooks. This block cannot be completed in a
single overnight run.

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
- no Lead Agent removal before the real 72-hour gate.

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
