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

## Trusted managed-Supabase source export

The #551 restore accepts only artifacts produced by the reviewed read-only
export command. The command verifies the exact project through the Management
API, requires a fresh completed provider backup, verifies both runtime API keys
against that same project, allowlists its existing session-pooler identity, and
then captures database/Auth and Storage as two separate sources. It does not
link or modify the project.

Prerequisites:

- OrbStack reports `Running` and `docker context show` is exactly `orbstack`;
- the repository-pinned Supabase CLI is installed from the lockfile. Its
  Supabase filter contract is retained, but its PostgreSQL 17.6 dump image is
  rejected because it predates the client fixes in PostgreSQL 17.11;
- a trusted `pg_dump` and `pg_dumpall` pair passes the published security floor
  (18.6, 17.11, 16.15, 15.19 or 14.24, or a later minor in the same supported
  branch). The exporter records their exact accepted version and refuses an
  unpatched or mismatched pair before any managed-Supabase read;
- the reviewed public Supabase Root 2021 CA at
  `scripts/support/supabase-prod-ca-2021.crt` remains byte-identical to its
  pinned SHA-256 and X.509 fingerprint and is inside its validity period. The
  exporter records both identifiers in the signed receipt and uses this exact
  file for `verify-full`; it never relies on an ambient user CA file;
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
  `EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY` and
  `EVO_PLATFORM_SUPABASE_SECRET_KEY` are injected into the exporter process,
  never written to arguments, output or Git. The Management token is available
  only to the exporter process, the publishable/secret keys are sent only to
  their allowlisted HTTPS project origin, and only the patched PostgreSQL dump
  process tree receives the database password through its environment;
- an existing absolute mode-`0700` output directory outside the repository;
- an age recipient, an existing mode-`0600` SSH signing key, and an
  operator-held trusted public key stored outside both the repository and the
  backup output.

Run from an exact clean reviewed commit:

```bash
npm run backup:v3:managed -- \
  --project-ref '<exact-20-character-project-ref>' \
  --output-root '<absolute-private-output-root>' \
  --age-recipient '<age-recipient>' \
  --signing-key '<absolute-private-ssh-key>' \
  --trusted-public-key '<absolute-operator-held-public-key>'
```

The command produces individually age-encrypted roles, schema, data and exact
`supabase_migrations` dumps, plus an encrypted Storage manifest/archive. It
uses the reviewed Supabase CLI 2.116.0 schema/data/role filtering
transformations except for the obsolete step that comments out PostgreSQL
restricted-mode guards. The patched local PostgreSQL clients' active
`\restrict`/`\unrestrict` pair remains in every SQL artifact. The project's
allowlisted session pooler is used over verified TLS; the command does not
substitute a second schema authority.
Every external command runs in its own process group, and cleanup begins only
after that complete process tree has drained.
The signing public key and fingerprint are pinned during local preflight; a
later coordinated replacement of both key paths cannot change the receipt's
trust root.
After the clean-commit check, the CA and all three dump-filter scripts are
compared byte-for-byte with their blobs at the recorded Git HEAD, copied into
the private runtime directory, and executed only from that snapshot. Their
SHA-256 values are bound into the signed receipt, so later worktree edits cannot
change an in-progress export.
The stability digest validates the exact active-guard envelope for roles,
schema, data, history-schema and history-data, normalizes only each paired
63-byte random guard token, and hashes every other byte.
The command double-inventories Storage and hashes every downloaded payload.
`receipt.json`
contains only aggregate counts, timestamps, tool/repository bindings,
ciphertext hashes and the authenticated provider-backup receipt; its detached
SSH signature is verified before the partial directory is atomically renamed.
The public key is not copied into the bundle; later verification must use the
same independently retained trusted key and compare its fingerprint with the
signed receipt.
Customer rows, staff email/phone values, Storage paths and keys remain only in
encrypted artifacts. After an error or `SIGINT`/`SIGTERM`, cleanup is attempted
only after the complete child process tree drains. If draining or safe cleanup
cannot be proved, the command fails clearly and retains the marked private
directory for exact-target retry or quarantine instead of risking an unsafe
deletion; non-exiting child tools are forcibly killed after a bounded grace
period.

This export is a restore input, not recovery-readiness evidence by itself. The
existing application-facing recovery result remains `u11-recovery-result`; it
may become ready only after a separate isolated restore proves database/Auth,
role-specific RLS/browser behavior, Storage bytes and malware scanning.

## Isolated managed-Supabase recovery consumer

The consumer accepts exactly one completed, signed exporter directory. It
does not accept loose dumps, a replacement manifest, a database URL or an
unsigned migration ledger, and it never contacts the managed project. Before
decrypting anything it verifies the detached signature with the separately
retained public key, validates every ciphertext digest and binds the source
project, Supabase organization, platform organization, physical provider
backup, export commit, source migration tree and integrated main-equivalent
commit. The target is independently bound to the exact clean checkout, target
migration tree, immutable Git archive and locally built `linux/amd64`
production image.

Use the repository scripts from an exact clean reviewed commit. Supply every
identifier through the child process or literal operator input without
printing it or saving it in Git. Sales and Admissions IDs are optional only so
the rehearsal can produce an honest diagnostic; their absence can never pass
the acceptance gate.

```bash
npm run recovery:v3:managed:contract

npm run recovery:v3:managed:preflight -- \
  --backup-dir '<absolute-completed-export-directory>' \
  --trusted-public-key '<absolute-operator-held-public-key>' \
  --age-identity '<absolute-mode-0600-age-identity>' \
  --project-ref '<signed-project-ref>' \
  --supabase-organization-id '<signed-supabase-organization-id>' \
  --platform-organization-id '<restored-platform-organization-uuid>' \
  --source-repository-commit '<signed-export-commit>' \
  --source-migration-tree '<signed-source-migration-tree>' \
  --source-main-equivalent-commit '<integrated-equivalent-main-commit>' \
  --target-repository-commit '<exact-clean-target-commit>' \
  --target-migration-tree '<exact-target-migration-tree>' \
  --admin-user-id '<restored-admin-auth-user-uuid>' \
  --sales-user-id '<restored-sales-auth-user-uuid>' \
  --admissions-user-id '<restored-admissions-auth-user-uuid>' \
  --evidence-out '<absolute-private-preflight-evidence-path>'

npm run recovery:v3:managed:run -- \
  --backup-dir '<same-completed-export-directory>' \
  --trusted-public-key '<same-operator-held-public-key>' \
  --age-identity '<same-mode-0600-age-identity>' \
  --project-ref '<same-signed-project-ref>' \
  --supabase-organization-id '<same-signed-supabase-organization-id>' \
  --platform-organization-id '<same-restored-platform-organization-uuid>' \
  --source-repository-commit '<same-signed-export-commit>' \
  --source-migration-tree '<same-signed-source-migration-tree>' \
  --source-main-equivalent-commit '<same-integrated-equivalent-main-commit>' \
  --target-repository-commit '<exact-clean-target-commit>' \
  --target-migration-tree '<exact-target-migration-tree>' \
  --admin-user-id '<same-restored-admin-auth-user-uuid>' \
  --sales-user-id '<same-restored-sales-auth-user-uuid>' \
  --admissions-user-id '<same-restored-admissions-auth-user-uuid>' \
  --evidence-out '<absolute-private-run-evidence-path>'
```

The full run restores only into a disposable OrbStack Supabase contour with one
owned, egress-blocked, non-internal bridge and loopback-only app publication.
It applies only the
authenticated pending migration suffix, verifies exact source Storage bytes,
runs the exact production image through local TLS, blocks browser HTTP and
WebSocket egress, proves restored Auth/RLS/business outcomes, exercises the
real Company Files scanner path for clean, EICAR, unavailable and recovered
outcomes, and verifies fail-closed provider readiness without contacting a
provider. This result is only one half of the #551 scanner gate. The same exact
target commit must also pass `test:database:local`, which starts the pinned real
ClamAV image and drives both active Student 360 `/api/v2/document-slots/*` and
Company Files `/api/v3/company-files/*` ingress paths, plus `test:u7`, whose
focused scanner/client/route contracts cover timeout, malformed, duplicate,
missing, unknown and uncorrelated request IDs, scanner identity drift, and
zero persistence/download on failure. Record the matching exact-head CI run
with the result-v2 evidence; neither half alone closes #551.

Cleanup must drain every owned process and container before the private
runtime directory is removed; uncertainty is quarantined rather than deleted.
Only mode-`0600` redacted result-v2 evidence is retained outside the runtime
directory.

`status=passed` requires all three real restored staff identities and at least
one real source private-Storage object. Missing Sales/Admissions identities or
a signed zero-object Storage source returns a non-zero `status=not_ready` with
named blockers. The available Admin and deterministic PDF canary may still
prove safe behavior, but they never substitute fixtures for the missing
source evidence.

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
- Supabase Management API projects: <https://supabase.com/docs/reference/api/v1-list-all-projects>
- Supabase local downloaded-backup restore:
  <https://supabase.com/docs/guides/local-development/restoring-downloaded-backup>
- Supabase Storage downloads: <https://supabase.com/docs/guides/storage/management/download-objects>
- Supabase Storage S3 compatibility:
  <https://supabase.com/docs/guides/storage/s3/compatibility>
- PostgreSQL `pg_dump`: <https://www.postgresql.org/docs/current/app-pgdump.html>
- PostgreSQL `pg_restore`: <https://www.postgresql.org/docs/current/app-pgrestore.html>
- PostgreSQL CVE-2026-19385: <https://www.postgresql.org/support/security/CVE-2026-19385/>
- PostgreSQL CVE-2026-18408: <https://www.postgresql.org/support/security/CVE-2026-18408/>
- Supabase CLI 2.116.0 schema filter:
  <https://github.com/supabase/cli/blob/v2.116.0/apps/cli-go/pkg/migration/scripts/dump_schema.sh>
- Supabase CLI 2.116.0 data filter:
  <https://github.com/supabase/cli/blob/v2.116.0/apps/cli-go/pkg/migration/scripts/dump_data.sh>
- Supabase CLI 2.116.0 role filter:
  <https://github.com/supabase/cli/blob/v2.116.0/apps/cli-go/pkg/migration/scripts/dump_role.sh>
- Supabase database connection modes:
  <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Supabase PostgreSQL SSL verification and CA instructions:
  <https://supabase.com/docs/guides/platform/ssl-enforcement>
- ClamAV scanning and exit-status contract:
  <https://docs.clamav.net/manual/Usage/Scanning.html>
- ClamAV `clamd` protocol:
  <https://docs.clamav.net/manual/Usage/ClamdProtocol.html>
- ClamAV official container images:
  <https://docs.clamav.net/manual/Installing/Docker.html>
- WAHA sessions: <https://waha.devlike.pro/docs/how-to/sessions/>
- WAHA security: <https://waha.devlike.pro/docs/how-to/security/>
