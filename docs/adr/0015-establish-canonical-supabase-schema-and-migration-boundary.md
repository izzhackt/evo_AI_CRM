# ADR 0015: Establish the canonical Supabase schema and migration boundary

- Status: Accepted foundation decision; identity-migration and P2I prerequisite
  details superseded by ADR 0016; not applied to production
- Date: 2026-07-28
- Decision owners: technical owner and Data/Privacy accountability role
- Refines: ADR 0014
- Superseded in conflict by: ADR 0016
- Execution contract: `docs/platform/p2-supabase-foundation.md`

## Context

ADR 0014 selects one logical EVO Platform data model and one dedicated
production Supabase project, while retaining isolated local, staging, preview
and production environments. The repository still has a contiguous companion
Inbox migration history, 001–039, under
`agent-lead2-inbox/supabase/migrations/`, no root `supabase/config.toml`, and a
legacy `public` identity/role model.

Starting new Platform migrations without first fixing one canonical history
would create competing migration authorities. Reusing legacy Inbox
`owner/admin/agent/viewer` roles or the current root `client` identifier as
Platform `admin/sales/curator/finance/student` would also grant ambiguous
authority.
Combining history reconciliation, schemas, all domain tables, Queues, Storage
and restore proof in one PR would be too broad to review and roll back safely.

## Decision

### Canonical repository history

P2A makes root `supabase/` the only migration authority. Existing migrations
001–039 move there byte-for-byte and are protected by a checksum manifest.
P2A adds the pinned project-local Supabase CLI, `supabase/config.toml` and the
relocated test harness, but creates no migration 040.

Merged migrations are immutable. P2B starts with the next verified free number,
expected to be 040. A later correction receives the next free forward
migration; merged history is never edited.

### Schema and API boundary

| Schema | Owner and purpose | Data API/browser boundary |
| --- | --- | --- |
| `public` | Legacy Inbox compatibility for migrations 001–039 until controlled P3/P5 cutover | Temporarily exposed only for proven legacy consumers; existing RLS remains mandatory |
| `platform` | New Platform identity, operational and audit-facing records | Exposed with explicit least-privilege grants and RLS on every table |
| `platform_private` | Backend-only helpers, secret references and internal processing functions | Not exposed through the Data API; no `anon` or `authenticated` access |
| `auth`, `storage`, `vault`, `pgmq`, `pgmq_public` | Provider-owned schemas | Not renamed or used as Platform domain namespaces |

During coexistence, the Data API may expose `public` and `platform`, never
`platform_private`. Browser roles receive no direct access to
`platform_private` or `pgmq_public`. If queue RPC exposure is required, it is a
narrow service-only wrapper with explicit negative tests for `anon` and
`authenticated`.

### Identity separation

Legacy Inbox roles `owner`, `admin`, `agent` and `viewer` do not map
implicitly to Platform roles. The legacy signup trigger may continue to create
legacy `public.accounts` and `public.profiles`, but it does not create a
Platform organization membership or business role. The target fifth machine
role is `student`, displayed to users as Client/Student. The current root
`client` role is not imported or mapped into Platform without a later explicit
scoped decision. Root-auth migration is not part of the greenfield Platform
path.

### Sequential implementation

P2A–P2H were delivered in the order defined by
`docs/platform/p2-supabase-foundation.md`; former P2I recovery duties moved to
P7 under ADR 0016. New tables are additive. P2 does not
rename or drop legacy tables, copy real secrets, change production, cut root
auth over, or silently flip legacy public buckets. New private Platform
document/media buckets arrive only in P2H.

## Consequences

- There is one reviewable migration chain rather than companion and Platform
  histories that can drift.
- Legacy Inbox compatibility remains explicit until later controlled cutover.
- Platform authorization is not inherited accidentally from a semantically
  different legacy role model.
- Local Supabase reset/RLS/Queues/Storage evidence is required where
  applicable, but it does not prove managed-project migration parity,
  production branch configuration, paid-plan PITR or managed restore.
- Database backup/restore and Storage-object backup/restore remain distinct
  evidence.
- After any new migration is applied, rollback is a separately reviewed
  forward migration. Restoring browser-visible secret grants is not an
  automatic rollback.

## Rejected alternatives

### Keep migrations under the companion directory

Rejected because it makes a temporary companion path the permanent authority
for all Platform domains and leaves root tooling ambiguous.

### Duplicate 001–039 under root

Rejected because two writable copies cannot remain provably identical.

### Put new Platform tables in `public` with a prefix

Rejected because it enlarges the legacy/default-grant surface and obscures the
cutover boundary.

### Use private base tables plus exposed views for every record

Rejected for this phase because it adds view-security complexity without
removing the need for RLS. A direct `platform` schema with simple policies is
easier to test fail-closed.

### Map legacy roles automatically

Rejected because the names and authority do not match the fixed business role
contract.

## Primary sources

- [Supabase local development and CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase branching](https://supabase.com/docs/guides/deployment/branching)
- [Supabase custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
