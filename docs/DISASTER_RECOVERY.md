# EVO production-successor recovery contract

Status: active V3 recovery boundary for one managed Supabase authority, one
Next.js application, and one private WAHA transport. This document does not
authorize a production restore, provider mutation, customer-data change, WAHA
logout/relink, or traffic cutover. The superseded SQLite/companion proposal is
retained only at
[`docs/archive/v1/disaster-recovery.md`](archive/v1/disaster-recovery.md).

## Safety contract

- Rehearse only in a newly provisioned OrbStack destination bound to loopback,
  with separate identifiers, URLs, keys, networks and volumes and no public
  DNS. Never point a rehearsal at production or expose it beyond the host.
- Record canonical source and destination identities before reading an
  artifact. Their identifiers, database URLs, Storage endpoints, networks and
  volume names must compare unequal; a missing or equal value stops the run.
- Every restore operation requires an explicit source, destination, timestamp,
  manifest, byte count, checksum and verification result.
- Evidence must not contain secrets, customer rows, object names, session
  identifiers, cookies, tokens, phone numbers or plaintext provider settings.
- A rehearsal never stops, writes, migrates, relinks or reconfigures a live
  service. Use only the minimum named, authorized representative cohort for
  application-level assertions, and never broaden access merely to make the
  drill pass. A real incident requires an approved incident plan.
- Recovery must fail closed. SQLite, Drizzle, a V1 database, companion Inbox,
  Lead Agent, fixtures, dual-read/write, or a shadow runtime is never a disaster-
  recovery fallback for the successor. The only V1-app exception is #552's
  exact state-bound rollback to the real pre-change app while the first V3
  candidate remains pending; it never runs beside V3 and becomes non-executable
  after that candidate's acceptance.
- Every V3 release has an explicit pending record and its own immutable
  `v3-acceptance-record.json`, which is prepared evidence and never authority
  without the exact protected current-pointer reference. A failed candidate, an
  interruption before the current-pointer commit, or an unresolved pending
  candidate leaves the previous
  accepted V3 (or approved first-cutover absent/V1 state) authoritative and as
  the only rollback target. A running container is not acceptance. Interruption
  after the current-pointer commit preserves that exact candidate as accepted
  and permits only locked, byte-exact redundant-pending verification and cleanup.
- A crash after the prepared record write but before the current-pointer commit
  is resumed only by a locked, fully re-proved, byte-identical idempotent
  compare-and-swap from the same prior authority. A crash after pointer commit
  permits only exact triple verification and redundant-pending cleanup. Any
  mismatch or superseding release stops.
- A release wrapper may act only while the running image/revision is exactly the
  candidate it installed and no newer/superseding accepted/current/pending
  release exists. An absent-state wrapper cannot remove accepted V3, a V1
  wrapper cannot overwrite accepted V3, and an old V3 wrapper cannot overwrite
  a newer release.
- Each release/rollback generation uses one private mode-`0600` application-env
  snapshot captured under the host lock without symlink following. Its digest
  is part of protected state, all Compose operations use it, and a source-file
  swap after validation cannot change the deployment or rollback input. Manual
  rollback verifies the digest offline and never falls back to the mutable
  source path.

## Authoritative stores

| Store | Successor authority | Recovery boundary |
| --- | --- | --- |
| CRM data, role mappings and audit events | managed Supabase Postgres/Auth/RLS | one identified provider backup or approved logical backup, retained with identity, timestamp, size and checksum and restored only into the loopback OrbStack destination; verify root migration compatibility and server-enforced access |
| Private documents and WhatsApp media | managed Supabase Storage | one separate authenticated object-byte export with bucket/count/size/checksum manifest and isolated private-bucket restore; database backup metadata alone is insufficient |
| WAHA session `crm_primary` | protected `evo_crm_waha_sessions` volume | preserve in place for app releases; use only a WAHA-supported, separately approved backup/relink procedure for disaster recovery |
| Runtime secrets and encrypted provider settings | protected server/provider secret stores | independently retained configuration restored without printing values, then verified through the real server-side reader |
| App generated output | `evo_crm_output` | non-authoritative; regenerate when possible and restore only if a named workflow requires it |
| Application image/config | exact release evidence plus protected pending/current/per-release acceptance records | while a candidate is pending, restore only its exact recorded prior absent/V1/accepted-V3 state; after acceptance, an exact current V3 may restore only its prior accepted V3, never absence/V1 or a moving tag; every wrapper verifies the running candidate and refuses a superseding release |

Supabase database backups and Storage object bytes are separate recovery
artifacts. A database-only restore must not be called a complete product
restore. Auth, RLS, Storage privacy, signed URLs and role behavior all require
isolated application/browser verification.

The obsolete deployment staging contour is not a recovery environment or
backup. #551 preserves its runbook only as non-executable history while removing
repository runtime references; #552's exact remote staging retirement must not
delete or reuse production Supabase, `evo-crm`, `crm_primary`, production volumes
or any recovery artifact. Catalog-import staging rows are business data inside
the canonical Supabase boundary and are unrelated to deployment staging.

## Recoverable pre-change set

Before #552 changes production, #551 must identify and verify both of these
recoverable paths without creating credentials or changing provider state:

1. **Database/Auth metadata:** the exact managed backup identity or an approved
   logical export, its creation time, Postgres image/version compatibility,
   encrypted protected location, byte count and SHA-256 checksum.
2. **Storage bytes:** a separate authenticated S3/Storage export of every
   in-scope private object, plus a protected manifest of bucket, object count,
   aggregate bytes and per-object checksums. Object names remain only in the
   protected manifest and never enter review or CI evidence.

If existing authorized access cannot retrieve either artifact, record the
missing credential/capability and stop. A provider's backup-list entry, a
database dump containing `storage.objects` metadata, or an empty/synthetic file
set cannot substitute for the corresponding recoverable artifact.

## Isolated rehearsal sequence

1. Record the exact repository commit, migration set, database-backup identity,
   Storage-export identity, source identity, destination identity, app image ID,
   WAHA digest and evidence root.
2. Require `orb status` to be `Running` and `docker context show` to be exactly
   `orbstack`. Prove the destination binds only to loopback and is empty; reject
   any production identifier, URL, network or volume name and reject every
   source/destination equality.
3. Restore Postgres/Auth according to the backup format's supported Supabase
   process. Treat restored content as production-sensitive even though the
   destination is local; access only the explicitly authorized minimum cohort
   for assertions and never emit row values.
4. Reconcile root `supabase/` forward migrations manually in the isolated copy,
   without editing historical migrations or introducing another schema
   authority. Automatic application release never applies schema.
5. Restore private Storage bytes separately through the supported Storage/S3
   API and verify counts, sizes, checksums, bucket privacy and signed-access
   behavior without logging object names.
6. Start the exact app image against the isolated Supabase project. Use a fresh,
   private disposable WAHA instance only if transport verification is in the
   approved rehearsal; never copy or mount the live session volume.
7. Verify Supabase Auth, Admin/Sales/Admissions authorization, canonical CRM
   reads and writes, private document access, event-log continuity, health and
   fail-closed behavior in a real browser and database.
8. Prove the configured real document scanner accepts a clean sample, rejects
   and quarantines a standard safe detection sample, denies finalization and
   download when unavailable, timed out or malformed, and resumes only after a
   successful rescan. `scanner_proof=false` is not sufficient.
9. Record sanitized pass/fail results and timings. Destroy only drill-owned
   resources under the explicit cleanup plan; retain the protected pre-change
   artifacts according to their recovery retention policy.

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

## Evidence boundary

The reviewable evidence records identifiers, hashes, counts, timings, outcomes
and exact tool versions only. It never contains database/Storage credentials,
connection strings, customer rows, object names, object bytes, session data,
cookies, provider payloads or rendered environments. A failed identity,
restore, migration, checksum, privacy, scanner or browser assertion names the
gate and stops; it does not fall back to fixtures or a historical runtime.

## Official references

- Supabase database backups: <https://supabase.com/docs/guides/platform/backups>
- Supabase backup and restore: <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- Supabase local downloaded-backup restore:
  <https://supabase.com/docs/guides/local-development/restoring-downloaded-backup>
- Supabase Storage downloads: <https://supabase.com/docs/guides/storage/management/download-objects>
- Supabase Storage S3 compatibility:
  <https://supabase.com/docs/guides/storage/s3/compatibility>
- PostgreSQL `pg_dump`: <https://www.postgresql.org/docs/current/app-pgdump.html>
- PostgreSQL `pg_restore`: <https://www.postgresql.org/docs/current/app-pgrestore.html>
- WAHA sessions: <https://waha.devlike.pro/docs/how-to/sessions/>
- WAHA security: <https://waha.devlike.pro/docs/how-to/security/>
