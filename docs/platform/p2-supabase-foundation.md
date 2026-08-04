# P2 canonical Supabase foundation

- Status: implementation contract; no production application
- Date: 2026-08-04
- Block family: P2A–P2H and P2R0–P2R3 merged reusable foundation; P2R3
  implementation merged in PR #112
- Parent contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- Architecture: ADR 0014/0015, with greenfield/UI conflicts superseded by ADR
  0016
- Current checkpoint: `121db548b252eff9e4b79f62297aa27fe39e5c40`

## Purpose and truth boundary

P2 creates the reusable repository and database foundation for one greenfield
EVO Platform data model. It does not migrate root SQLite data or auth, import
legacy accounts, prove live amoCRM/WAHA/AI, apply a production migration, or
cut over the existing Inbox and Lead Agent.

The accepted frontend remains the sole UI contract. Passing P2 proves local
migration reproducibility, database authorization and the scoped local
Supabase service contracts described below. It does not make the Platform
production-complete, and it does not authorize a parallel UI or a legacy
bridge.

## Canonical schemas

| Schema | P2 responsibility | Exposure |
| --- | --- | --- |
| `public` | Preserve legacy Inbox objects from 001–039 until later controlled cutover | Temporary Data API compatibility only; RLS and proven consumer inventory required |
| `platform` | New Platform organizations, identity links, admissions operations, communications and audited state | Data API exposed; explicit grants; RLS on every table |
| `platform_private` | Backend-only helpers, internal processing and references to secrets stored through supported facilities | Not exposed; no browser grants |
| `auth` | Supabase Auth provider schema | Provider-owned |
| `storage` | Supabase Storage metadata | Provider-owned; application code never writes its tables directly |
| `vault` | Database-resident secret facility where selected | Provider-owned; no real secret migration in P2 |
| `pgmq` / `pgmq_public` | Queue internals/API supplied by Supabase Queues | Provider-owned; no browser access; narrow service-only wrappers if needed |

During coexistence, Data API configuration may include `public` and
`platform`. It must exclude `platform_private`. `anon` and `authenticated`
receive no access to `platform_private` or `pgmq_public`.

## Migration authority and immutable history

1. Before P2A, the only migration history is the contiguous Inbox 001–039
   chain under `agent-lead2-inbox/supabase/migrations/`.
2. P2A moves those files byte-for-byte to root `supabase/migrations/` and
   records SHA-256 checksums. It does not create 040.
3. Root `supabase/config.toml`, the pinned project-local CLI and root test
   harness become the only supported migration entry point.
4. The old companion path becomes a pointer, not a second migration source.
5. After merge, migration files are immutable. Corrections use the next free
   number.
6. P2B begins with the next free number after verified local and, when
   authorized, remote ledgers. The expected number is 040.
7. P2 migrations are additive: no legacy table rename/drop, root-auth cutover,
   real-secret copy, legacy-bucket flip or destructive production operation.

Dependency flow:

```text
001–039 legacy history
        |
        v
P2A canonical root source
        |
        v
P2B namespace/grant containment
        |
        v
P2C identity/RBAC/audit
        |
        v
P2D cases/admissions/visa/tasks
        |
        v
P2E documents metadata/finance/notifications
        |
        v
P2F communications/provider/AI data contracts
        |
        v
P2G Queues/outbox/reconciliation
        |
        v
P2H private Storage
        |
        v
P3 thin messaging slice
        |
        v
Later reliability lane restore evidence
```

This dependency flow records the original foundation sequence. P3A-P3C,
BW1-BW7 and P2R0-P2R3 are merged. PR #109 merged the P2R2 plan, plan PR #111
and implementation PR #112 merged the P2R3 repair, and PR #113 then merged BW5.
P2R3 did not reopen the historical schema sequence or take P7 restore ownership.

## Sequential blocks

### P2A — canonical repository baseline

Owns:

- root `supabase/config.toml`;
- root `supabase/migrations/001_…039_…`;
- checksum manifest and immutable-history check;
- relocated SQL authorization tests and disposable harness;
- pinned root devDependency/lockfile for the Supabase CLI;
- path updates in CI, scripts and documentation;
- a pointer README at the old companion migration path.

Exit:

- every moved file is byte-identical and checksum-identical;
- project-local CLI performs a clean local reset without seed/customer data;
- local migration list is contiguous and ends at 039;
- legacy schema, policy, grant and function inventories match the pre-move
  baseline;
- browser/service boundary tests remain green;
- no migration 040 exists and no remote project is linked or mutated.

Rollback: repository-only revert of the path move before any remote apply.

### P2B — namespaces, grants and verified legacy containment

Begins at the next verified free migration number, expected 040.

Owns:

- `platform` and `platform_private` creation;
- explicit schema/table/function/default grants;
- no browser access to `platform_private` or `pgmq_public`;
- no Platform membership side effect from legacy signup;
- verified containment of legacy secret-bearing projections and direct
  browser secret writes while preserving current Inbox server paths.

Verified legacy findings to handle precisely:

- `whatsapp_config.access_token`, `ai_configs.api_key` and
  `webhook_endpoints.secret` are browser-readable ciphertext/secret-bearing
  columns through full-row SELECT policies; this is not proof of plaintext
  credential exposure.
- `api_keys.key_hash` is an unnecessary sensitive projection, not a plaintext
  API key.
- `integration_secrets.encrypted_value` is not browser-readable, but
  authenticated Admin direct INSERT/UPDATE/DELETE conflicts with the target
  backend-only secret path.
- migration 038 already closes meaningful tenancy/function/provider-field
  surfaces and is supplemented, not rewritten.
- `avatars` and `flow-media` remain public compatibility surfaces;
  `chat-media` is already private after 039. P2B does not flip those buckets.

Exit:

- current Inbox consumers are inventoried before any revoke;
- safe projections or server-only paths replace proven browser exposure;
- `anon`/`authenticated` negative grants are executed against a real
  disposable local Supabase/PostgreSQL stack;
- legacy Inbox behavior covered by the current test contract remains green.

Rollback after apply: reviewed forward migration. Browser-visible secret grants
are not restored automatically.

### P2C — identity, RBAC and base audit

Owns:

- organizations;
- Platform profiles linked to Supabase Auth identities;
- organization memberships;
- the five business roles `admin`, `sales`, `curator`, `finance`, `student`;
- versioned permissions, membership roles and record scopes;
- base append-style audit context.

`student` is the target machine identifier for the user-facing Client/Student
class. P2 does not map legacy `owner/admin/agent/viewer` roles or the current
root `client` identifier. Legacy account signup does not confer Platform
membership. P3 creates greenfield Supabase-native identities and imports or
maps no legacy root account without a later explicit scoped decision.

The detailed P2C enforcement and evidence contract is
`docs/platform/p2c-identity-rbac-audit.md`. Coarse role/version claims are
issued by a custom access-token hook, but every RLS decision also checks the
live profile, organization, membership, published permission bundle and current
access version. Administrative mutations additionally require a live
organization scope. P2C removes broad future-object `service_role` defaults;
backend capabilities receive only reviewed signature-specific grants.

Exit:

- positive Admin/Sales/Curator/Finance/Student matrix;
- cross-role and cross-organization denials;
- inactive/blocked membership denial;
- browser mutation of role, organization or audit identity is denied;
- service paths are narrow and audited.

### P2D — cases, assignments, applications, visa and tasks

Owns:

- pending/active/closed student cases;
- Admin-only Curator assignment/reassignment with reason and before/after
  audit;
- Sales-to-Curator handoff state;
- multiple concurrent university applications;
- Curator-owned visa states and evidence links;
- tasks and lifecycle events;
- reasoned case close/reopen.

The detailed P2D enforcement and evidence contract is
`docs/platform/p2d-admissions-rls.md`. Migration 042 adds ten FORCE-RLS domain
tables, immutable v2 role bundles, rotating student-case scopes, replay-safe
operation RPCs and fixed post-handoff Sales/activated Student projections.
Base-table RLS remains a staff-full boundary; reduced audiences do not receive
base-table grants as a substitute for column security.

Pending creation is a narrow service-only ingest operation backed by explicit
signed-contract evidence. It does not discover or invent the account-specific
amoCRM contract mapping. Initial Admin assignment activates handoff and Portal
state; reassignment rotates scope without reviving the previous Curator.
Application and visa states that represent external decisions require evidence.

Exit:

- two-organization/two-student isolation;
- Sales pre-contract and Curator post-handoff scope;
- former Sales safe-summary boundary;
- Admin-only assignment/reassignment;
- invalid lifecycle transition and missing-reason denials;
- same-request replay and mismatched-replay denials;
- no direct `service_role` domain-table DML.

### P2E — document metadata, finance and notifications

The detailed merged contract is
`docs/platform/p2e-documents-finance-notifications.md`. Migration 043 follows
the immutable 042 boundary and its exact API/grant inventory, disposable
PostgreSQL matrix and real local Supabase boundary evidence are recorded there.
PR #88 is controller-merged as
`aac1cba851e89070a7eb54baab4eddf921e3447c`; post-merge exact-main CI
[run 30402311903](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30402311903)
is green. This closes the repository P2E gate, not binary Storage, Queue,
provider or production proof.

Owns:

- metadata-only document checklist/version/validation/review/rework history,
  with evidence-backed integrity/malware state and no binary-upload claim;
- full document workflow for Admin/current Curator, a fixed pre-handoff Sales
  checklist and a fixed Student self-history projection; Finance receives no
  sensitive document access;
- manual EVO service-fee and third-party-cost obligations, strict
  payment/refund evidence and Finance/Admin-only confirmation;
- computed overdue state plus reduced Sales/Curator/Student projections that
  expose no internal finance evidence and never infer state from amoCRM stage;
- durable singular Student-recipient in-app state and individual WhatsApp
  intent with Student-only consent/dedupe, but no Queue, provider or delivery
  claim;
- immutable v3 role bundles that extend rather than mutate the v2 authority
  introduced by migration 042.

Exit:

- Curator/Admin document workflow and cross-student denial;
- fixed, non-sensitive Sales and Student document projections;
- Finance/Admin-only confirmation and evidence requirement;
- strict amount/refund arithmetic and Student-safe computed overdue projection;
- singular Student-recipient consent/dedupe, staff denial and replay behavior;
- no mass/broadcast notification representation;
- no claim that binary Storage/scanner works before P2H or that Queue/provider
  delivery works before P2G and later real-provider evidence.

### P2F — communications, providers and AI data contracts

The detailed merged repository contract is
`docs/platform/p2f-communications-contracts.md`. P2F starts from the merged P2E
checkpoint `aac1cba851e89070a7eb54baab4eddf921e3447c` and adds only the
forward migration 044 communications/data boundary. PR #89 was
controller-merged as `8567455f281fa157fb088970db1c2a2397850843`; the pinned
artifact is
`044_platform_communications_contracts.sql`: 6,881 lines, 194,076 bytes,
SHA-256
`8d52b476981faed4a42a9c13ff2813a718bde6ad4aea1b315c4d61be9fd1ebc8`.
Its exact inventory is ten exposed and two private tables plus 19 `platform`
functions; the detailed contract records their names and proof boundary.
Post-merge exact-main CI run
[30407638837](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30407638837)
passed Main CRM, EVO Inbox and EVO Lead Agent. This neither changes migrations
001–043 nor proves a provider call.

Owns:

- unified conversations, participants and messages;
- five-role queue ownership, handoff history and fixed safe projections;
- separate internal UUID, WAHA session/message IDs, Kommo
  conversation/message IDs and amoCRM lead/contact IDs;
- private raw webhook payload/evidence persisted before normalized processing,
  WAHA request/semantic-event deduplication and canonical reconciliation-effect
  deduplication without invented non-WAHA semantic keys;
- approved versioned knowledge and immutable RU/EN draft evidence;
- uncertain-language manual selection/handoff plus human
  review/edit/manual-send evidence.

Raw provider payload is backend-only and is not a transcript or browser
projection. P2F can represent normalized message/ACK/reconciliation state, but
that state is not proof that WAHA, Kommo, amoCRM or an AI provider was called.
An operator-approved manual-send record is not proof that a message was
enqueued, sent or delivered.

Exit:

- cross-student/cross-organization transcript denial;
- former Sales summary cannot reveal transcript or provider identifiers;
- raw/provider event writes and protected audit fields are server-only;
- uncertain-language draft state requires manual selection/handoff;
- no Kyrgyz customer draft, auto-reply, unattended outbound, broadcast or
  unknown-result automatic retry;
- no Queue/worker/outbox proof before P2G, no private Storage proof before P2H
  and no live-provider, managed-Supabase or production claim.

### P2G — durable work and reconciliation

The merged contract is
`docs/platform/p2g-durable-work-queues.md`. It starts from merged P2F
checkpoint `8567455f281fa157fb088970db1c2a2397850843` and adds only forward
migration `045_platform_durable_work_queues.sql`: 3,425 lines, 91,620 bytes,
SHA-256
`a657c32c3dadec369b54157914a229b112c58beb395ee4a2ae99025d804723a2`.
The exact inventory is five backend-only work tables, two FORCE-RLS Admin
review tables, ten enums and 16 functions.

Owns:

- real Supabase Queues/PGMQ queues;
- outbox/job attempt state;
- idempotency keys and uniqueness constraints;
- visibility timeout, retry budget, dead-letter state;
- reconciliation/conflict records and operator action;
- unknown-delivery terminal/manual-review behavior.

The two fixed PGMQ queues carry only `{v, work_item_id, kind}`. Browser roles
and `service_role` have no direct `pgmq`/`pgmq_public` access; backend workers
use only hard-coded reviewed RPCs. Manual-send work has exactly one attempt.
Both an explicit unknown provider result and a worker lease that expires before
recording a result archive the active message and open reconciliation/Admin
review without retry or DLQ.

Exit:

- real local queue read/visibility/concurrency/retry tests;
- duplicate business keys do not produce duplicate effects;
- exhausted work reaches dead-letter evidence;
- unknown send result is never automatically re-enqueued or sent;
- browser roles cannot read or invoke queue internals.

PGMQ `read()` with a visibility timeout is the retryable consumption primitive.
At-most-once `pop()` is not used for durable retry work.

The disposable Supabase PostgreSQL 17 gate and project-local Supabase CLI reset
both apply all 45 contiguous migrations and exercise real PGMQ concurrency,
rollback, visibility expiry/read count, same-message `set_vt()` retry, archive,
dead-letter, dedupe and terminal unknown/crash behavior. These are local Queue
proofs, not WAHA/amoCRM/AI provider, managed Supabase or production proofs.

### P2H — private Platform Storage

PR #92 merged migration 046 and the detailed contract in
`docs/platform/p2h-private-document-storage.md`. It owns new private Platform
buckets and policies through the real local Supabase Storage API. Application
SQL never writes `storage` tables directly.

Exit:

- only PDF/JPG/PNG up to 25 MB is accepted by the application contract;
- authenticated or signed/server-streamed access only;
- cross-organization and cross-student object denial;
- version/review object linkage and audited authorized download;
- separate backup inventory for Storage objects;
- legacy `avatars`/`flow-media` compatibility is unchanged.

### P2R0/P2R1 — local proof reliability remediation

P2R0 merged as the docs-only launch-control gate in PR #104. P2R1 merged as the
single bounded implementation block in PR #105, including immutable migration
`055_platform_document_finalization_lock_order.sql`.

P2R1 owns only:

- process-group deadlines that terminate timed-out local validation children;
- cleanup by the exact `com.supabase.cli.project=evo-platform-local` label,
  with no broad Docker prune and an explicit zero-resource postcondition;
- a GET-only local Auth admin readiness probe that retries only network and
  transient 502/503/504 responses before synthetic test-user creation;
- deterministic PGMQ test leases: normal finish paths retain a safe lease,
  while explicit crash/expiry probes remain short;
- a next-free forward migration that makes document finalization and review
  acquire organization and document locks in one compatible order.

Exit requires the real local `npm run test:supabase:local` path under Node
22.23.1, clean Auth/RLS/Storage/PGMQ evidence, exact-label resource and
singleton-lock cleanup, preserved Inbox containers/volumes, disposable
PostgreSQL authorization tests, unit/security/lint/typecheck/build/scenario/
E2E/accessibility checks and a scoped secret scan. A previous migration is
never edited.

This block does not prove or authorize managed Supabase, malware scanning,
database or Storage restore, production apply, provider behavior, customer
traffic or cutover. Whole-foundation restore evidence remains P7 work.

### P2R2/P2R3 — issued-token, stale-session and local reset repair

Controller review of PR #108 required a prior plan gate and rejected its claimed
real local PASS after a fresh physical-worktree run exited non-zero following
two bounded reset attempts. PR #108 was closed without merge; PR #109 then
merged the bounded P2R2 plan. Controller review of PR #110 found that its
protected-route invalid-authority path redirected without clearing the resident
Supabase browser cookie and could not reproduce the independent local gate while
its OrbStack endpoint was unresponsive. PR #110 was also closed without merge.
Plan PR #111 and implementation PR #112 subsequently merged P2R3 with green
exact-main CI `30883272841`. The merged repair preserved the P2R2 scope and
owned only:

- explicit verification of the access token returned by successful login using
  `getClaims(accessToken)` before the live `platform.current_actor_authority`
  RPC; `getSession()` is not trusted for server authorization;
- fail-closed logout/session clearing when the issued token, live membership or
  authority bundle cannot be verified;
- one exact same-origin response-writable Route Handler reached from the
  connected-route guard; it independently rechecks claims/live authority,
  preserves a recovered valid actor, and otherwise expires only the Platform
  Supabase auth-token cookie/chunks before a bounded login redirect;
- a real disposable browser regression that starts authenticated, makes live
  authority revoked or version-stale, exercises a protected connected route and
  proves the Platform auth cookie is absent while unrelated cookies remain;
- a local Auth smoke that performs the real `supabase-js` claims verification
  before browser fixture handoff;
- symlink-safe direct execution and exit propagation in the deadline runner;
- bounded reset/start/restart readiness with transient-only retry, safe phase
  diagnostics and no credential-bearing output;
- exact-label cleanup with zero lock/container/volume/network residuals and
  preserved Inbox resources.

Authorized implementation surfaces are limited to the auth actions/resolver,
the deadline/Auth/reset scripts and their focused regression harnesses, plus
the exact guard/proxy/auth-cookie/Route Handler/browser-test surfaces named in
the parent long-run plan. P2R3 adds no migration and does not change RLS,
Storage, queue, provider or production contracts.

Its exit evidence included focused tests plus a real
`npm run test:supabase:local` exit zero from the executor and a fresh independent
physical worktree, all four exact-head CI jobs, SHA-bound independent review and
controller merge. The continuing boundary remains fail-closed: a silent
deadline-wrapper no-op, a non-zero reset, residual exact-project resources or a
managed/provider claim is not valid evidence.

### Former P2I — whole-foundation evidence
Moved to the later reliability lane. Former P2I duties remain required work,
but they do not block the first thin messaging slice behind the existing
frontend.

The later reliability lane still owns:

- clean local reset from 001 through the final P2 migration;
- full RLS/policy/grant/function inventory;
- five-role, cross-organization and two-student denial suites;
- browser bundle and repository secret/path scan;
- isolated database backup/restore with counts/checksums;
- separate Storage-object backup/restore with object hashes;
- migration immutability and local/staging parity report;
- all repository CI gates and independent review.

## Minimum negative matrix

| Actor | Must be denied |
| --- | --- |
| Anonymous | Every Platform business record and all private Storage objects |
| Student A | Student B/other-organization case, messages, documents, finance details and notifications |
| Sales | Post-handoff transcript/documents/visa/finance internals and any unrelated lead/case |
| Curator | Unassigned student and Finance confirmation |
| Finance | Transcript, document content, Curator assignment and operational mutation outside finance |
| Admin from organization A | Every organization B record unless a separately defined platform-superadmin contract exists |
| Any browser actor | `platform_private`, queue internals, provider/service secrets, audit identity and system reconciliation writes |

## Evidence and provider boundary

| Claim | P2 evidence | Boundary |
| --- | --- | --- |
| Migration reproducibility | Project-local CLI, clean local reset and checksum ledger | Does not prove remote managed ledger |
| RLS/grants | Executed disposable PostgreSQL/local Supabase positive and negative tests | SQL text matching alone is insufficient |
| Queues | Real local Supabase Queues/PGMQ service contract | Handcrafted queue mock is insufficient; no production traffic |
| Storage | Real local Storage API/policy behavior and redacted object inventory | DB backup does not include Storage objects; isolated object restore remains P7 work |
| Branch isolation | Official contract plus local configuration | Managed preview/staging behavior remains unproved without linked projects |
| PITR | Runbook placeholder only | Region/plan/cost decision and managed restore are blocked |
| Provider integrations | Data contracts only | No live amoCRM, WAHA, AI or customer-message proof |

Schema/RLS blocks use `real-provider-proof: not-required`. P2G/P2H require real
local Supabase services, but that still does not prove managed production.

## Prohibited in P2

- production deployment or migration;
- remote project link/apply without a separately authorized environment gate;
- real customer/production data in local or preview environments;
- browser service-role/provider secrets;
- root auth or SQLite cutover;
- live WAHA/amoCRM/AI call or message send;
- auto-reply, unattended outbound, broadcast or automatic retry of unknown;
- legacy table drop/rename or silent bucket-privacy change;
- Lead Agent/session/webhook retirement.

## Primary sources

- [Supabase local development](https://supabase.com/docs/guides/local-development)
- [Supabase branching](https://supabase.com/docs/guides/deployment/branching)
- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase custom claims and RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
