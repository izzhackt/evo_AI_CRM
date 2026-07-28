# P2 canonical Supabase foundation

- Status: implementation contract; no production application
- Date: 2026-07-28
- Block family: P2A–P2I
- Parent contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- Architecture: ADR 0014, refined by ADR 0015
- Starting checkpoint: `d3edcda6649cb7b90b789c57c658ec1fc4a20618`

## Purpose and truth boundary

P2 creates the repository and database foundation for one EVO Platform data
model. It does not migrate root SQLite data or auth, prove live amoCRM/WAHA/AI,
apply a production migration, or cut over the existing Inbox and Lead Agent.

The accepted frontend remains the UI contract. Passing P2 proves local
migration reproducibility, database authorization and the scoped local
Supabase service contracts described below. It does not make the Platform
production-complete.

## Canonical schemas

| Schema | P2 responsibility | Exposure |
| --- | --- | --- |
| `public` | Preserve legacy Inbox objects from 001–039 until P3/P5 cutover | Temporary Data API compatibility only; RLS and proven consumer inventory required |
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
P2I whole-foundation and restore evidence
```

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
membership; root identity mapping remains P3.

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

Exit:

- two-organization/two-student isolation;
- Sales pre-contract and Curator post-handoff scope;
- former Sales safe-summary boundary;
- Admin-only assignment/reassignment;
- invalid lifecycle transition and missing-reason denials.

### P2E — document metadata, finance and notifications

Owns:

- document/version/review/rework metadata and integrity/malware state;
- evidence references without claiming file upload yet;
- obligations, payments and refunds with Finance/Admin confirmation;
- Student-safe overdue state without internal finance fields;
- durable in-app notification state and individual WhatsApp delivery intent
  with consent/dedupe fields.

Exit:

- Curator/Admin document workflow and cross-student denial;
- Finance/Admin-only confirmation and evidence requirement;
- Student-safe finance projection;
- no mass/broadcast notification representation;
- no claim that binary Storage upload works before P2H.

### P2F — communications, providers and AI data contracts

Owns:

- unified conversations, participants and messages;
- queue ownership and handoff-safe projections;
- separate internal UUID, WAHA session/message IDs, Kommo
  conversation/message IDs and amoCRM lead/contact IDs;
- raw webhook event records and provider reconciliation state;
- approved versioned knowledge and RU/EN draft records;
- human review/edit/manual-send audit fields.

Exit:

- cross-student/cross-organization transcript denial;
- former Sales summary cannot reveal transcript or provider identifiers;
- raw/provider event writes and protected audit fields are server-only;
- uncertain-language draft state requires manual selection/handoff;
- no auto-reply, unattended outbound, live-provider or delivery claim.

### P2G — durable work and reconciliation

Owns:

- real Supabase Queues/PGMQ queues;
- outbox/job attempt state;
- idempotency keys and uniqueness constraints;
- visibility timeout, retry budget, dead-letter state;
- reconciliation/conflict records and operator action;
- unknown-delivery terminal/manual-review behavior.

Exit:

- real local queue read/visibility/concurrency/retry tests;
- duplicate business keys do not produce duplicate effects;
- exhausted work reaches dead-letter evidence;
- unknown send result is never automatically re-enqueued or sent;
- browser roles cannot read or invoke queue internals.

PGMQ `read()` with a visibility timeout is the retryable consumption primitive.
At-most-once `pop()` is not used for durable retry work.

### P2H — private Platform Storage

Owns new private Platform buckets and policies through the real local Supabase
Storage API. Application SQL never writes `storage` tables directly.

Exit:

- only PDF/JPG/PNG up to 25 MB is accepted by the application contract;
- authenticated or signed/server-streamed access only;
- cross-organization and cross-student object denial;
- version/review object linkage and audited authorized download;
- separate backup inventory for Storage objects;
- legacy `avatars`/`flow-media` compatibility is unchanged.

### P2I — whole-foundation evidence

Owns no planned schema by default. If evidence finds a defect, the fix uses the
next free migration and receives a fresh exact-head review.

Exit:

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
| Storage | Real local Storage API/policy behavior and object restore | DB backup does not include Storage objects |
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
