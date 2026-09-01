# ADR 0024: Use managed Supabase for the EVO production successor

- Status: accepted
- Decision date: 2026-09-02 (Asia/Dubai)
- Decision owner: EVO product owner
- Execution parent: GitHub issue #543
- Ordered children: GitHub issues #544 through #553
- Supersedes: ADR 0022 as runtime/auth/file/production authority and the
  self-hosted-PostgreSQL parts of ADR 0023
- Retains: ADR 0023 human review, idempotency, provider-correlation and
  fail-closed behavior

## Context

The private V2 program proved the heavy CRM workflows and real provider paths,
but intentionally replaced Supabase with local PostgreSQL, a development gate
and local files. The owner now prefers the ready-made managed capabilities
already developed for V1 rather than operating equivalent production services
again. The existing Supabase foundation is materially richer than the local V2
contour: it includes canonical Platform schemas, Auth/RBAC, RLS, private
Storage, Realtime, queues, audit and a reviewed migration history.

## Decision

EVO will ship one production successor: the accepted V2 interface, CRM
workflows and provider safety semantics on the managed Supabase foundation
retained from V1. One dedicated EVO Supabase project owns canonical Postgres,
staff identity, private files and only the Realtime capabilities the product
uses. The existing production project is preferred when a read-only audit
proves its identity, migration state, data, access controls and recoverability.

Root `supabase/` becomes the sole target migration authority. V2-only business
gaps move into `platform` or `platform_private` through immutable forward
migrations; Drizzle `evo_*`, SQLite and application-local document bytes do not
become parallel production authorities. Supabase Auth replaces the development
gate, and private Supabase Storage replaces the local file path.

Reuse is capability-level, not wholesale legacy restoration. Keep the V2
human-reviewed Gemini, explicit WhatsApp send, ambiguity reconciliation and
idempotent amoCRM command behavior. Do not revive superseded autonomous/manual
workers, old provider adapters, duplicate repositories, parallel screens,
dual reads/writes or fallback paths.

## Consequences

- Product work already proved in V2 is retained while managed database, Auth,
  Storage, RLS and operational tooling do not need to be rebuilt.
- The current local worktree/runtime is not a production candidate until the
  Supabase schema, real staff, files, deployment and recovery paths are proved.
- Each replacement slice deletes its superseded active code and dependencies
  after real Supabase/application/browser proof.
- Production cutover follows a read-only inventory, forward-migration
  rehearsal, backup/restore proof and real staging acceptance. Historical V1
  and V2 decisions, migrations, runbooks and evidence remain available as
  rollback and audit inputs.

## Official sources verified 2026-09-02

- Supabase architecture and integrated services:
  <https://supabase.com/docs/guides/getting-started/architecture>
- Managed Postgres backups and point-in-time recovery:
  <https://supabase.com/docs/guides/database/overview>
- Auth architecture:
  <https://supabase.com/docs/guides/auth/architecture>
- Row Level Security:
  <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Storage access control:
  <https://supabase.com/docs/guides/storage/security/access-control>
- Database migrations:
  <https://supabase.com/docs/guides/deployment/database-migrations>
