# EVO production-successor recovery contract

Status: active V3-H recovery boundary for one managed Supabase authority, one
Next.js application, and one private WAHA transport. This document does not
authorize a production restore, provider mutation, customer-data change, WAHA
logout/relink, or traffic cutover. The superseded SQLite/companion proposal is
retained only at
[`docs/archive/v1/disaster-recovery.md`](archive/v1/disaster-recovery.md).

Issue #551 has no staging environment. Repository proof is local and isolated;
managed-production backup identification, representative-data restore rehearsal
and any real production action remain separate #552 runtime-access work.

## Safety contract

- Rehearse only in a newly provisioned isolated destination with separate URLs,
  keys, networks, volumes and DNS. Never point a rehearsal at production.
- Every restore operation requires an explicit source, destination, timestamp,
  manifest, byte count, checksum and verification result.
- Evidence must not contain secrets, customer rows, object names, session
  identifiers, cookies, tokens, phone numbers or plaintext provider settings.
- A rehearsal never stops, writes, migrates, relinks or reconfigures a live
  service. A real incident requires an approved incident plan.
- Recovery must fail closed. SQLite, Drizzle, a V1 database, companion Inbox,
  Lead Agent, fixtures, dual-read/write, or a shadow runtime is never a recovery
  fallback for the successor.

## Authoritative stores

| Store | Successor authority | Recovery boundary |
| --- | --- | --- |
| CRM data, role mappings and audit events | managed Supabase Postgres/Auth/RLS | provider backup or an approved logical backup restored into an isolated managed-Supabase target; verify root migration compatibility and server-enforced access |
| Private documents | managed Supabase Storage | separate authenticated object export/inventory and isolated private-bucket restore; database backup alone is insufficient |
| WAHA session `crm_primary` | protected `evo_crm_waha_sessions` volume | preserve in place for app releases; use only a WAHA-supported, separately approved backup/relink procedure for disaster recovery |
| Runtime secrets and encrypted provider settings | protected server/provider secret stores | independently retained configuration restored without printing values, then verified through the real server-side reader |
| App generated output | `evo_crm_output` | non-authoritative; regenerate when possible and restore only if a named workflow requires it |
| Application image/config | exact release evidence | restore the recorded immutable image ID and checked-in exact-SHA Compose/configuration; never rebuild from a moving tag |

Supabase database backups and Storage object bytes are separate recovery
artifacts. A database-only restore must not be called a complete product
restore. Auth, RLS, Storage privacy, signed URLs and role behavior all require
isolated application/browser verification.

Supabase's database overview states that database backups do not include
Storage object bytes, and Supabase's S3 compatibility page states that Storage
bucket versioning is not enabled and deleted objects cannot be restored from
version history. Treat Storage object bytes as their own export, checksum,
restore and verification stream.

## Isolated rehearsal sequence

1. Record the exact repository commit, migration set, source backup identity,
   destination project identity, app image ID, WAHA digest and evidence root.
2. Prove the destination is isolated and empty; reject production identifiers,
   URLs, networks and volume names.
3. Restore Postgres/Auth according to the managed provider's supported process.
4. Reconcile root `supabase/` forward migrations without editing historical
   migrations or introducing another schema authority.
5. Restore private Storage separately and verify counts, sizes, checksums,
   bucket privacy and signed-access behavior without logging object names.
6. Start the exact app image against the isolated Supabase project. Use a fresh,
   private disposable WAHA instance only if transport verification is in the
   approved rehearsal; never copy or mount the live session volume.
7. Verify Supabase Auth, Admin/Sales/Admissions authorization, canonical CRM
   reads and writes, private document access, event-log continuity, health and
   fail-closed behavior in a real browser and database.
8. Record sanitized pass/fail results and timings. Destroy the isolated
   destination only under its explicit cleanup plan.

## #551 local release and recovery proof

Run the local proof only after the macOS container preflight passes:

```bash
orb status
docker context show
npm run test:v3h:recovery:orbstack
```

`scripts/test-v3h-release-recovery-orbstack.sh` is intentionally disposable
and provider-effect-free. It uses OrbStack, pinned Supabase Postgres, root
`supabase/migrations`, a synthetic Supabase Auth row and synthetic Storage
object bytes. It proves:

- root migrations apply to an isolated database with the real schema;
- a custom-format `pg_dump` archive is non-empty and listable;
- `pg_restore` restores the archive into another isolated database;
- the synthetic representative Auth row is present after restore;
- Storage object bytes are restored and checksum-verified separately from the
  database archive; and
- a failing candidate app release through `scripts/evo-fast-release.sh deploy`
  returns `status:"rolled_back"` and leaves the previous immutable app revision
  healthy.

The harness prints sanitized JSON only: no provider key, webhook owner,
customer row, object name, phone number, session payload or production URL is
evidence.

## Managed-production backup identification

Before #552 deploys or applies schema, identify the actual managed-production
pre-change backup or approved logical backup, its timestamp, source project
identity, restoration target, Storage export manifest and restore owner. This
must be read-only until the approved #552 production window. A green local
harness, green CI job or configured workflow is not managed-production backup
proof.

## WAHA boundary

Normal app rollback preserves `crm_primary`; it does not rescan a QR or move
session bytes. If the session volume itself is lost or unsupported for restore,
stop and use the separately authorized private relink procedure with the real
account owner. Never run two active webhook owners, reuse one session in two
WAHA instances, expose the dashboard publicly, or send a message merely to
prove recovery.

## Recovery objectives

RPO and RTO are operational/business decisions and remain unset until the
managed Supabase plan, Storage export mechanism, WAHA recovery support, staff
ownership and rehearsal timings are approved. Repository capability alone does
not establish a production recovery objective.

## Official references

- Supabase database backups: <https://supabase.com/docs/guides/platform/backups>
- Supabase database overview: <https://supabase.com/docs/guides/database/overview>
- Supabase backup and restore: <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- Supabase Storage downloads: <https://supabase.com/docs/guides/storage/management/download-objects>
- Supabase Storage S3 compatibility: <https://supabase.com/docs/guides/storage/s3/compatibility>
- Supabase database migrations: <https://supabase.com/docs/guides/deployment/database-migrations>
- PostgreSQL `pg_dump`: <https://www.postgresql.org/docs/current/app-pgdump.html>
- PostgreSQL `pg_restore`: <https://www.postgresql.org/docs/current/app-pgrestore.html>
- GitHub `workflow_run`: <https://docs.github.com/actions/using-workflows/events-that-trigger-workflows>
- GitHub Actions concurrency: <https://docs.github.com/actions/using-jobs/using-concurrency>
- Docker Compose `up`: <https://docs.docker.com/reference/cli/docker/compose/up/>
- WAHA sessions: <https://waha.devlike.pro/docs/how-to/sessions/>
- WAHA security: <https://waha.devlike.pro/docs/how-to/security/>
