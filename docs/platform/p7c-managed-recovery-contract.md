# P7C managed recovery and Supabase consolidation contract

Status: merged authority contract; recovery execution deferred by the owner on
2026-08-14 until functional Platform completion and concrete operation

Version date: 2026-08-14 (Asia/Bishkek)

Plan Block-ID: `EVO-P7C-MANAGED-RECOVERY-2026-08-14`

Issue: #162

## Superseding owner decision — 2026-08-14

- Do not migrate, pause, retire or delete `inbox-prod`. It belongs to a separate
  owned Inbox SaaS product and is not a legacy EVO Platform database.
- Defer creation of a recovery project and the managed database plus separate
  Storage restore drill until the EVO Platform is functionally complete and
  concretely operating.
- Keep the existing Supabase Pro scheduled database backups enabled. Their
  presence is protection, not proof that restoration works, and database
  backups still do not contain Storage object bytes.
- Do not mark P7C accepted, do not mark disaster recovery verified, and do not
  create temporary billed recovery infrastructure under this deferral.
- When the owner resumes P7C, refresh the source, destination, credential,
  Storage, cost and retention inventory before any recovery action.

This section supersedes every retirement or deletion statement about
`inbox-prod` below. The remaining recovery safety boundaries stay applicable
when P7C resumes.

## Verified baseline

- GitHub `main` is `e9443bd25be5a7aaebe6eea08f48f35e2965e617`.
- Exact-main push CI run `31795764829` passed Main CRM, EVO Inbox and EVO Lead
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
- The separate managed project `inbox-prod` remains healthy and active. The
  dashboard recorded 5,582 requests in the preceding 24 hours, two monthly
  active users in the current cycle, and a recent physical backup. A separate
  live Inbox SaaS application references it. It is intentionally retained and
  is not an EVO Platform recovery or retirement target.

The precise credential inventory and infrastructure exposure findings remain
private operational evidence. They must not be copied into this public
repository, PR text or GitHub issues.

## Outcome

When resumed, P7C produces independently verified recovery evidence for the
canonical managed EVO production project without treating a provider backup
badge as a successful restore. It does not migrate, pause, retire or delete the
separate Inbox SaaS project `inbox-prod`.

The intended steady state is:

- `evo-platform-prod`: canonical managed production project;
- one temporary `evo-platform-recovery-<date>` project only while a restore
  drill is running;
- `inbox-prod` retained as the separate Inbox SaaS managed project;
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
- Do not delete or pause either production project under P7C. `inbox-prod` is a
  separate product boundary, not a cost-reduction or retirement target.

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
| Retained steady state | `inbox-prod` + `evo-platform-prod` | about `$35` |

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
4. Do not access or export `inbox-prod`; it is outside the EVO Platform source
   and recovery boundary.
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

## Block P7C5 - preserve the Inbox SaaS boundary

1. Treat `inbox-prod` and its live consumers as a separate product boundary.
2. Do not read, migrate, cut over, pause or delete that project as part of P7C.
3. Do not claim its traffic, data, backup or cost as EVO Platform recovery
   evidence.
4. Any future Inbox SaaS migration or retirement requires a new owner decision
   and a separate plan outside this contract.

## Evidence and acceptance

Each block has its own PR and exact-head review. Evidence must include:

- exact source/destination references stored privately and safe aliases in Git;
- tool versions, commands, exit codes, timestamps and bounded durations;
- encrypted artifact and manifest SHA-256 values;
- safe aggregate database/Auth/Storage counts before export and after restore;
- destination isolation and outbound-provider denial;
- independent database and Storage report statuses;
- production health and backup state after every provider mutation;
- actual and projected provider cost after transfer and drill creation;
- explicit `blocked` status for non-empty Storage recovery, PITR, production
  migration whenever its prerequisites are absent.

P7C is complete only after the managed database restore and separate Storage
restore are independently reviewed and the canonical production migration
decision is resolved. `inbox-prod` remains outside P7C. A backup listing without
a restore is not completion.

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
