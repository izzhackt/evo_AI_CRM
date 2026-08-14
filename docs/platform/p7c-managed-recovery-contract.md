# P7C managed recovery and Supabase consolidation contract

Status: docs-only authority gate; implementation and destructive retirement are
not yet authorized by merge

Version date: 2026-08-14 (Asia/Bishkek)

Plan Block-ID: `EVO-P7C-MANAGED-RECOVERY-2026-08-14`

Issue: #162

## Verified baseline

- GitHub `main` is `a6077ad6b7642deceead31dd11ed463548216d58`.
- Exact-main push CI run `31753423736` passed Main CRM, EVO Inbox and EVO Lead
  Agent; Changed range was skipped on the push event as expected.
- Repository migrations are contiguous through `072`.
- The owner authorized the live organization consolidation on 2026-08-14.
- The managed production project keeps reference
  `iosckaqtovbbnssqcpde`, PostgreSQL 17 and Singapore region
  `ap-southeast-1`; only its owning organization and display name changed.
- The project is now named `evo-platform-prod` inside the existing Pro
  organization `Isko's org`. The dashboard reports it healthy and shows a
  physical scheduled database backup.
- After the transfer and rename, the live `evo-inbox-app-1` container remained
  healthy and its internal `/api/health` endpoint returned HTTP `200` with the
  expected `evo-inbox-companion` liveness response.
- The managed production database reports application migration `039` as its
  latest applied migration. Repository migrations `040-072` are not proven in
  that managed database and must not be inferred as deployed.
- Storage currently contains bucket metadata but zero object bytes. An empty
  Storage inventory is real evidence of emptiness, not evidence that non-empty
  object recovery works.
- The legacy managed project `inbox-prod` remains healthy and active. The
  dashboard recorded 5,582 requests in the preceding 24 hours, two monthly
  active users in the current cycle, and a recent physical backup. A separate
  live application still references it, so deletion is blocked.

The precise credential inventory and infrastructure exposure findings remain
private operational evidence. They must not be copied into this public
repository, PR text or GitHub issues.

## Outcome

P7C produces one canonical managed EVO production project and independently
verified recovery evidence without treating a provider backup badge as a
successful restore. It retires `inbox-prod` only after its consumer and required
data have moved, real traffic has stopped, rollback remains possible and the
owner confirms the exact permanent deletion at action time.

The intended steady state is:

- `evo-platform-prod`: canonical managed production project;
- one temporary `evo-platform-recovery-<date>` project only while a restore
  drill is running;
- no active `inbox-prod` project after verified cutover and deletion;
- database backups and Storage-object backups treated as separate systems.

## Non-negotiable boundaries

- Use real managed Supabase services, the real owned source and real encrypted
  backup artifacts. Do not substitute local stacks, mocks, fake projects or
  synthetic records for managed recovery evidence.
- Do not print, commit, upload to GitHub or retain outside approved secret
  storage any database password, Management token, API key, customer row,
  Storage object, dump, session or provider credential.
- Database exports and Storage bytes must be encrypted before durable local or
  offsite persistence. Temporary directories are mode `0700`; files are mode
  `0600`; cleanup is exact-target only.
- Never restore into `evo-platform-prod`, `inbox-prod` or another existing
  project. The destination must be newly created, distinctly named, owned and
  empty before the drill.
- A database backup does not contain Storage object bytes. Database and Storage
  recovery have separate manifests, commands, durations, results and failure
  states.
- No direct SQL writes to Supabase-managed `auth` or `storage` tables. Storage
  bytes move only through supported Storage or S3 APIs.
- Do not enable PITR, custom domains, IPv4, larger compute or another paid
  add-on without a separate cost decision.
- Do not delete or pause a production project merely to reduce cost. Retirement
  requires the gates below and fresh action-time owner confirmation.

## Cost contract

The existing Pro organization fee is `$25/month` and includes `$10/month` of
compute credit. Every active Nano or Micro project is billed at approximately
`$0.01344/hour`, or about `$10/month`; paused projects do not incur compute.

Expected states:

| State | Active projects | Expected monthly total |
| --- | ---: | ---: |
| Before consolidation | `inbox-prod` only in Pro | about `$25` |
| Current transition | `inbox-prod` + `evo-platform-prod` | about `$35` |
| Temporary restore drill | both above + one recovery project | about `$45` while all three run |
| Final steady state | `evo-platform-prod` only | about `$25` |

The transfer occurred four days before the billing-cycle end. The dashboard
showed a projected current-cycle total of `$26.36`; project changes may take up
to one hour to settle. A 24-hour Micro recovery project adds approximately
`$0.32` of compute. The implementation must stop if the provider presents a
new organization subscription, an add-on, a compute size above Micro or an
estimated charge outside this contract.

Spend Cap remains enabled. Compute charges are not protected by Spend Cap, so
project lifetime must still be bounded and recorded.

## Block P7C1 - immutable source inventory and encrypted exports

1. Revalidate source project identity, organization, region, PostgreSQL major,
   health, latest applied migration, database size, Auth-user count, bucket
   inventory, object count and current backup list without reading customer row
   contents into logs.
2. Produce a real PostgreSQL 17 logical export using an official supported
   source connection. Record tool versions, start/end times and an encrypted
   artifact SHA-256. Keep roles, schema and data evidence distinct where the
   Supabase workflow requires it.
3. Export a separate Storage inventory through the supported API with explicit
   pagination. For zero objects, record a canonical empty manifest. Do not add a
   test object merely to make the proof non-empty.
4. Produce a private encrypted legacy `inbox-prod` export before any consumer
   cutover or deletion work. The public report records only aggregate counts,
   artifact hashes, timestamps and pass/fail status.
5. Fail closed on any dump error, incomplete pagination, plaintext durable
   artifact, unexpected customer-data output, version mismatch or missing key.

## Block P7C2 - managed database restore drill

1. Create one empty managed project named
   `evo-platform-recovery-<YYYYMMDD>` in the same Pro organization and Singapore
   region, using Micro compute and no optional add-ons.
2. Capture the exact destination reference and prove it is not any protected
   production/legacy reference before restoring.
3. Fence outbound-capable extensions, scheduled jobs, webhooks, Realtime
   consumers and provider integrations before loading data. The destination may
   not contact WAHA, amoCRM, Gemini, email, telephony or customer endpoints.
4. Restore the encrypted real database export into the empty destination using
   PostgreSQL 17-compatible tools with fail-on-error and transactional behavior
   where supported.
5. Verify schema objects, migration history, Auth identity counts, RLS enablement
   and grants, safe aggregate row counts, required functions/triggers and
   application read paths. Never include customer values in evidence.
6. Measure recovery duration and observed data-loss window. Label the result as
   a point-in-time managed logical restore drill, not PITR evidence.
7. Preserve the recovery project until Storage validation and independent review
   finish. Deletion of the recovery project is a separate exact-target action.

## Block P7C3 - separate Storage recovery

1. Recreate only the required private bucket configuration through supported
   APIs; do not copy bucket metadata by writing SQL.
2. Copy every source object listed in the frozen source manifest, preserving the
   exact object path, content type and application metadata that the supported
   API exposes.
3. Download destination bytes and compare locally computed SHA-256 values and
   byte lengths with the source manifest. Do not rely on ETag or database
   metadata alone.
4. With the current real source inventory of zero objects, the valid result is
   an empty-manifest restore. Non-empty byte-restore evidence remains explicitly
   missing until real production objects exist; no synthetic substitute is
   allowed.
5. Verify anonymous and wrong-user access remains denied and the authorized
   application path behaves according to existing RLS/storage policies.

## Block P7C4 - Platform schema promotion

The production database currently ends at application migration `039`, while
the repository ends at `072`. This gap is not a reason to run all migrations
blindly.

1. Restore the current production export into the recovery project first.
2. Inventory the exact definitions and history around migrations `040-072`,
   identify collisions and classify each migration as already-equivalent,
   additive-compatible or blocking.
3. Run the exact promotion on the recovery project, then execute the repository
   PostgreSQL authorization, Supabase, application and browser gates against
   that managed recovery target without provider side effects.
4. Produce a reviewed forward migration and rollback/kill plan before touching
   production.
5. Production migration remains a later action-time approval. P7C planning and
   restore evidence do not themselves authorize it.

## Block P7C5 - retire `inbox-prod`

Deletion is blocked until all conditions are true:

1. Identify every live consumer, runtime secret location, callback, scheduled
   job and operator workflow that references the legacy project.
2. Decide whether each legacy table/object is required by the canonical Platform
   domain. Migrate required data through reviewed domain mappings; do not merge
   databases wholesale or silently discard incompatible records.
3. Cut the live consumer over to the reviewed canonical destination and verify
   its real production workflows, restart persistence and rollback.
4. Keep the legacy project available for rollback while monitoring at least 72
   consecutive hours. Its application/API/Auth/Realtime/Storage traffic must be
   zero except explicitly identified operator verification, and the former
   consumer must remain healthy on the new project.
5. Reconfirm an encrypted legacy database export, separate Storage manifest,
   recent provider physical backup and documented rollback point.
6. Present the exact project name/reference, observation evidence, recoverability
   evidence and projected bill to the owner. Obtain fresh confirmation
   immediately before permanent deletion.
7. Delete only `inbox-prod`. Verify the canonical application, organization
   project inventory, billing projection and backup schedule afterward.

No implementation or reviewer may waive these deletion gates to save `$10`.

## Evidence and acceptance

Each block has its own PR and exact-head review. Evidence must include:

- exact source/destination references stored privately and safe aliases in Git;
- tool versions, commands, exit codes, timestamps and bounded durations;
- encrypted artifact and manifest SHA-256 values;
- safe aggregate database/Auth/Storage counts before export and after restore;
- destination isolation and outbound-provider denial;
- independent database and Storage report statuses;
- production health and backup state after every provider mutation;
- actual and projected provider cost after transfer, drill creation and final
  retirement;
- explicit `blocked` status for non-empty Storage recovery, PITR, production
  migration or deletion whenever their prerequisites are absent.

P7C is complete only after the managed database restore and separate Storage
restore are independently reviewed, the canonical production migration decision
is resolved, and `inbox-prod` is either safely deleted or explicitly retained
with its owner, reason and cost recorded. A backup listing without a restore is
not completion.

## Official basis

- Supabase project transfers:
  <https://supabase.com/docs/guides/platform/project-transfer>
- Supabase backups:
  <https://supabase.com/docs/guides/platform/backups>
- Supabase restore to a new project:
  <https://supabase.com/docs/guides/platform/clone-project>
- Supabase logical backup and restore:
  <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- Supabase compute usage and pricing:
  <https://supabase.com/docs/guides/platform/manage-your-usage/compute>
- Supabase Storage S3 compatibility:
  <https://supabase.com/docs/guides/storage/s3/compatibility>
- PostgreSQL 17 `pg_dump` and `pg_restore`:
  <https://www.postgresql.org/docs/17/backup-dump.html>
