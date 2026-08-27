# U11 Admin operations, staging isolation and recovery contract

Status: implementation contract for Issue #388
Date: 2026-08-27 (Asia/Dubai)
Parent: #376
Depends on: #387, completed through exact-main commit
`2ea92ac547d7f526f0e886a81f871936af456635`
Planning gate: PR #403, merged as
`ccbc115ca1ea334d8d6b45e009ee68562898c79c`; exact-main run
`33064118897` passed every job
Blocks: #389
Plan Block-ID: `EVO-LONG-RUN-1-U11-ADMIN-RECOVERY-2026-08-27`

## Outcome in plain language

An EVO Admin gets one private operations page that answers three questions:

1. Is the platform ready right now?
2. If it is not ready, what exact bounded blocker is responsible?
3. Has a backup actually been restored and checked, or does only a backup file
   exist?

The release controller also gains an isolated staging mode. It must stop before
an action if a staging path, Compose project, network, volume, hostname or
Supabase identity can resolve to production.

Repository and local tests may prove the implementation and the stop paths.
They cannot turn managed restore evidence green. `restore_database` and
`restore_storage` remain `missing` or `failed` until an owner-approved managed
staging source and disposable restore target have been exercised successfully.

## Frozen boundaries

- Production, DNS, provider settings, managed data and real staff accounts are
  unchanged by this implementation PR.
- U11 extends the existing `.github/workflows/evo-fast-release.yml` and
  `scripts/evo-fast-release.sh` release authority. It does not create a second
  deployment authority.
- The presentation-only fast lane remains app-only and must continue rejecting
  migration-bearing ranges.
- The controlled staging lane is non-production only until the later explicit
  production gate in the rollout plan.
- Staging uses its own server root, immutable release root, Compose project,
  private network, volumes, environment files, hostname, Auth tenant and
  Supabase credentials.
- Sharing `evo_public_web` for edge routing is allowed. Sharing a mutable
  database, private network, volume, Auth identity, WAHA session or provider
  credential is not.
- No blanket production-data copy is allowed. Only approved minimized test
  records may enter staging or a disposable recovery target.
- WhatsApp outbound, autonomous replies and amoCRM writes remain disabled.
- Secrets, HMAC values, provider payloads, raw SQL errors, document object keys
  and customer identifiers never enter the Admin page, result JSON, logs,
  GitHub comments or committed evidence.

## Public behavior seams

These are the user-visible seams that drive the tests.

### 1. Private Admin operations page

- The exact route is `/settings?tab=operations`.
- A verified active Admin may open it.
- Anonymous, inactive, non-Admin and foreign-organization actors fail closed
  through the existing Platform authentication and authorization path.
- Unknown query keys, duplicate `tab` values and unsupported tab values fail
  closed.
- The browser never calls the private HMAC readiness endpoint and never
  receives its secret.

### 2. Truthful readiness

- The page reuses the canonical `PlatformReadiness` model and its fixed alert
  codes; it does not invent a second health model.
- `blocked`, `missing`, `failed`, `stale`, disabled or unavailable inputs never
  render as healthy.
- Queue counts include their observation time and partial/saturated state.
- Safe aggregate platform counts are labelled as such. They are not described
  as tenant-specific when the underlying bounded RPC is platform-wide.
- Missing recovery evidence is shown separately even though the current
  canonical readiness model intentionally treats recovery evidence as an
  alert-only field.

### 3. Recovery evidence

- Database and Storage are independent recovery subjects.
- A successful database dump does not prove Storage-object recovery.
- A listed or hashed backup is not a successful restore.
- `ready` requires a restored non-production app plus successful login,
  same-organization access, cross-organization denial, private Storage access
  and the blocked-integration path remaining blocked.
- Any failed or incomplete verification produces a closed redacted result and
  keeps the corresponding recovery status non-ready.

## Server-side Admin projection

The operations page loads data on the server by reusing:

- `loadPlatformObservabilityConfig()`;
- `collectPlatformOperationalSignals()`;
- `composePlatformReadiness()`;
- bounded retained release/recovery evidence with a closed schema.

The page must not call `/api/readiness` from client code. That endpoint remains
private server-to-server HMAC infrastructure.

The UI projection contains only:

- canonical component status and fixed alert/runbook codes;
- safe aggregate queue/media/autonomy counts;
- observation timestamps, ages and partial-data flags;
- closed recovery result codes and artifact SHA-256 presence;
- exact non-secret commit, image and environment aliases;
- explicit evidence absence or failure.

## Staging release authority

The existing controller gains a closed environment profile and a controlled
non-production mode. Before it reads credentials, migrates a database or
starts a container, preflight must verify at least:

- the candidate revision equals the reviewed exact-main revision;
- the required CI run is successful for that exact SHA;
- the image is immutable `linux/amd64` and carries the exact revision label;
- `environment=staging` and the protected GitHub Environment agree;
- server and immutable release roots are absolute approved staging roots;
- Compose project, private network, volumes and fixed container names are
  staging-owned;
- the public hostname is the exact staging hostname;
- the staging Supabase identity is present and differs from the recorded
  production identity;
- the observed managed migration ledger has no drift and the requested range
  is contiguous;
- rollback image, configuration and pre-migration recovery inputs exist;
- outbound provider kill switches are closed.

Any identity collision is a hard stop. The controller writes a redacted
machine-readable result but performs no partial deployment after a failed
preflight.

## Managed backup and restore sequence

The later real non-production drill uses one owner-approved managed staging
source and one empty disposable non-production destination:

1. Record safe aliases and prove neither identity is production.
2. Export roles, schema and data with the reviewed Supabase CLI path.
3. Preserve migration history explicitly.
4. Export Storage objects separately from database metadata.
5. Restore the database with transactional error-stop behavior.
6. Restore Storage objects and verify bounded object counts/hashes.
7. Start the restored staging app with its own Compose identity.
8. Verify Admin login, same-tenant read, cross-tenant denial, private Storage
   access and blocked external integrations.
9. Exercise application rollback, retain redacted evidence and clean up only
   the disposable target that was approved for this drill.

This sequence is implemented and tested locally first. Creating a managed
branch/project, incurring cost, copying any managed data or deleting a
disposable target still requires the exact owner-approved target and scope.

## Test-first acceptance

The implementation follows one vertical slice at a time:

1. route contract and authorization red tests, then the smallest operations
   page path;
2. readiness projection red tests, then safe canonical composition;
3. staging identity-collision red tests, then controller preflight;
4. recovery result-schema and failure-path red tests, then orchestration;
5. real local Supabase/Auth/RLS/Storage and OrbStack controller proof;
6. lint, typecheck, build, complete CI, independent launch-control review,
   protected merge and exact-main verification.

Required negative tests include:

- anonymous, sales, curator, inactive and cross-organization denial;
- unknown or duplicate settings query rejection;
- disabled/unavailable observability never appearing green;
- saturated counts visibly marked partial;
- secret-bearing field names and values absent from rendered HTML/evidence;
- staging root/project/network/volume/hostname/Supabase collisions rejected;
- migration-ledger drift and non-contiguous ranges rejected;
- missing database or Storage restore proof remaining non-ready;
- a blocked external integration remaining blocked after restore.

## Completion boundary

The repository PR may merge after its exact tests and independent review pass,
but Issue #388 stays open until the real owner-approved managed restore drill
and restored staging-app checks succeed. No repository test, local Supabase
reset, OrbStack rollback or backup-file hash substitutes for that real proof.

## Official implementation basis

- GitHub deployment Environments can scope secrets, protection rules and
  deployment concurrency:
  <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments>.
- Supabase recommends separate staging and production environments and migration
  promotion between them:
  <https://supabase.com/docs/guides/deployment/managing-environments>.
- A Supabase branch has distinct Database, Auth, Storage and API credentials
  and begins without production data:
  <https://supabase.com/docs/guides/deployment/branching>.
- Supabase's logical migration guide separates roles, schema and data, requires
  migration-history handling, and notes that Storage objects require a separate
  transfer:
  <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>.
- Docker Compose uses the project name as an isolation boundary; U11 adds
  explicit resource-name collision checks because the current Compose file
  also contains fixed names:
  <https://docs.docker.com/compose/how-tos/project-name/>.

