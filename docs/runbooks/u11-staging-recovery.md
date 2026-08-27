# U11 isolated V1 staging and recovery runbook

Status: isolated managed staging is partially executed. The data-less backend,
first Admin, protected GitHub profile and app-only VPS runtime are live; the
canonical DNS/browser acceptance and managed Database plus Storage recovery
drill are not complete.

This runbook creates the test copy requested by the owner without replacing
the current production CRM. In plain language, staging is a separate room:
it has its own address, database identity, accounts, Docker names, disk volumes
and secrets. The old production room stays open and unchanged while the owner
tests Version 1.

## Current truth

- Production remains on the pre-V1 image
  `evo-crm:ee8a825ebc72f84449636e3feaefab7a330913d4`. It stayed healthy with
  restart count `0` while staging was created; no production container, data,
  secret or volume was replaced.
- `staging.crm.evoadmissions.com` is the reserved V1 test hostname, but it is
  still unresolved at the authoritative DNS provider. The technical fallback
  `staging-crm.72.62.119.112.sslip.io` routes to staging and has a valid
  Let's Encrypt certificate when verified at the VPS, but Fortinet interception
  blocks the current operator browser path. Do not call it owner browser proof.
- Supabase persistent Micro branch `evo-v1-staging` (project ref
  `brkihdobevpknkjvbuep`) is `ACTIVE_HEALTHY`, data-less relative to
  production, and has the contiguous repository ledger `001-092`. One approved
  email-confirmed Admin/organization/membership exists; a real password grant
  proved the expected Admin JWT claims. No production customer data or Storage
  object was copied.
- The `staging_profile_preflight` GitHub job validates the closed resource
  names plus the concrete protected app env identity and stops with
  `releaseStatus=blocked`; it intentionally cannot SSH, create a provider
  resource, migrate data, start containers or change DNS. Exact-main run
  `33084233185` passed this validation on 2026-08-27 and uploaded only the
  redacted result.
- `docker-compose.staging.yml` is isolated from the production Compose project.
  `/opt/evo-crm-staging` currently runs only `evo-crm-staging-app-1` at exact
  revision `6d2109b865da334bd41ad8c432147a2f7045937b`; staging WAHA, worker and
  Lead Agent are absent.
- `deploy/env.staging.example` contains placeholders only. The real mode-`0600`
  file exists only at `/opt/evo-crm-staging/.env.staging` and as the protected
  GitHub `staging` Environment secret; its values never belong in Git or logs.
- Database and Storage recovery remain non-ready until a real managed restore
  drill and restored-application checks succeed.

## Non-negotiable boundaries

1. Do not stop, replace, rebuild or reconfigure `/opt/evo-crm` while preparing
   or testing V1 staging.
2. Do not point staging at the production Supabase identity, secrets, Auth
   users, private network, volumes or WAHA session.
3. Do not use Supabase `--with-data` or otherwise copy production customer data
   into staging. Use approved synthetic/minimized test records only.
4. Keep WhatsApp outbound, autonomous replies and amoCRM writes disabled.
5. Do not create a paid Supabase branch/project, staff identity, DNS record or
   VPS deployment until the owner approves that exact external action.
6. A successful backup export or checksum is not recovery proof. Both the
   database and Storage objects must be restored to a disposable
   non-production destination and checked through the restored app.

## Repository-only validation

Run with the repository Node version before any provider or server action:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:u11
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run lint
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx --no-install tsc --noEmit
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build
```

Synthetic behavior belongs in `tests/app-env-contract.test.mjs` and
`tests/release-environment-profile.test.mjs`. The executable controlled
preflight deliberately does not accept friendly identity aliases: it requires
the exact private app env file that Compose will consume.

Before running the GitHub staging preflight, the protected `staging`
Environment must contain the secret `EVO_RELEASE_STAGING_APP_ENV` with the
complete `.env.staging` content and these non-secret variables:

- `EVO_RELEASE_SUPABASE_PROJECT_REF` — the approved 20-character staging
  project ref;
- `EVO_PRODUCTION_SUPABASE_PROJECT_REF` — the pinned current production ref
  `iosckaqtovbbnssqcpde`;
- `EVO_RELEASE_PLATFORM_ORGANIZATION_ID` — the approved staging tenant UUID;
- `EVO_RELEASE_SUPABASE_PUBLISHABLE_KEY_SHA256` and
  `EVO_RELEASE_SUPABASE_SECRET_KEY_SHA256` — fingerprints of the approved
  staging keys;
- `EVO_PRODUCTION_SUPABASE_PUBLISHABLE_KEY_SHA256` and
  `EVO_PRODUCTION_SUPABASE_SECRET_KEY_SHA256` — production collision
  fingerprints.

Register fingerprints through the approved secret-management process; do not
paste key values into shell history, issues, logs or documentation. The
workflow materializes the protected env secret at mode `0600`, validates it,
unsets the in-process secret variable, deletes the temporary file on exit and
uploads only the redacted result.

Expected safe result fields are `ok=true`, `effectsAllowed=false`,
`environment=staging`, `releaseStatus=blocked` and
`blocker=managed_staging_inputs_required`.

## External-action approval gate

Before provisioning, record the owner's approval for all of these exact
targets:

- the chosen data-less Supabase staging branch/project and expected billing;
- a short-lived disposable recovery destination and its deletion/retention
  decision;
- the protected GitHub `staging` Environment and its required reviewer;
- the VPS root `/opt/evo-crm-staging` and staging-owned Docker resources;
- the DNS record for `staging.crm.evoadmissions.com`;
- the exact approved EVO staff accounts allowed to sign in.

The owner recorded approval on 2026-08-27 for one isolated staging contour,
one first Admin identity and a target spend of at most USD 15 per month. That
approval covered the Supabase branch, protected GitHub staging Environment,
`/opt/evo-crm-staging` app-only runtime and staging hostname work recorded
above. It did not authorize a disposable recovery target, production
replacement, production data copy, WhatsApp send, amoCRM write or Version 2
cutover. Production still requires a second, later owner decision after the
feedback-and-fix round is accepted.

## Provision the isolated contour

The approved contour used this order. Reuse it for a later rebuild only after
reconfirming every external target and cost decision:

1. Create the protected GitHub `staging` Environment. Require the owner as a
   reviewer before any future effectful deployment job receives staging
   secrets. Store only non-secret hashed identity aliases in repository or
   environment variables used by collision checks.
2. Create the approved data-less Supabase staging branch/project. Apply the
   repository migration ledger from the first migration through the exact
   candidate tip. Do not import production data.
3. Configure the staging Auth Site URL and allowlisted redirect URLs for
   `https://staging.crm.evoadmissions.com`; keep public signup disabled and
   provision only approved test staff.
4. On `hermes-vps`, create `/opt/evo-crm-staging`, its immutable release and
   evidence roots, and the external private network
   `evo_crm_staging_private`. Create the evidence root for the application
   runtime as UID/GID `1001:1001` with mode `0700`; do not make the evidence
   file group- or world-readable. Do not join any `acadis_*` network.
5. Copy `deploy/env.staging.example` to the ignored server file
   `/opt/evo-crm-staging/.env.staging`, replace placeholders through the
   approved secret process, and keep the file mode `0600`. The committed
   template is deliberately non-deployable: the closed environment validator
   rejects blank runtime requirements, known placeholder literals, unsafe demo
   flags, a browser secret key and incomplete configuration for an enabled
   private feature. It also binds the concrete Supabase URL, publishable-key
   fingerprint, server-key fingerprint and tenant UUID to the protected
   staging identity and rejects the pinned production project.
6. Install the reviewed `scripts/evo-fast-release.sh` and its sibling
   `scripts/evo-app-env-contract.mjs` together. The existing effectful release
   preflight calls the validator without printing environment values and stops
   with `app_env_contract_invalid` or
   `controlled_staging_env_contract_invalid` until the real private file and
   approved identity fingerprints agree. Any future `deploy` invocation with
   `EVO_RELEASE_ENVIRONMENT=staging` runs this same gate before Docker can
   change state; the current staging GitHub job is still validation-only.
7. Validate `docker-compose.staging.yml` with the exact candidate revision and
   version. Its only shared resource may be the neutral `evo_public_web` edge
   network; every mutable name must remain staging-owned.
8. Build the candidate once, record its digest and revision label, and deploy
   that exact immutable image to staging. Do not rebuild it when the owner later
   accepts or rejects the candidate.
9. Add the staging edge route and DNS record only after the app is healthy on
   the private network. Confirm the production route still resolves to the
   unchanged production container before and after the addition.

## Owner test and fixing loop

Give the owner the staging URL and one approved Admin login. The owner checks
real workflows and reports bugs or disliked behavior. For every fixing round:

1. record the feedback as a bounded issue or checklist;
2. fix and test it in the repository;
3. pass exact-head review and CI;
4. deploy the new exact image only to staging;
5. repeat affected browser, tenant-isolation and recovery checks;
6. ask the owner to test again.

The candidate becomes accepted V1 only when the owner explicitly approves its
exact revision/image. Acceptance of staging still does not authorize replacing
production.

## Managed recovery drill

Use one approved staging source and one empty disposable non-production
destination. Prove their hashed identities are distinct from each other and
from production before credentials are read.

1. Export roles, schema and data from the staging source through the reviewed
   Supabase path and preserve the migration-history ledger.
2. Export private Storage objects separately. Database metadata alone does not
   contain the object bytes.
3. Restore the database with error-stop behavior, then restore Storage objects.
4. Start the restored application against the disposable destination.
5. Verify Admin login, same-organization access, cross-organization denial,
   private Storage access and the blocked external-integration path.
6. Prepare a closed input matching
   `docs/schemas/u11-recovery-result.schema.json`, then evaluate it without
   printing its contents:

```bash
node scripts/u11-recovery-evidence.mjs evaluate \
  --input /approved/private/input.json \
  --allowed-root /opt/evo-crm-staging/evidence \
  --output /opt/evo-crm-staging/evidence/u11-recovery-result.json \
  --owner-uid 1001 \
  --owner-gid 1001
```

The writer requires both ownership flags, validates them as closed numeric
UID/GID values, sets owner `1001:1001` on the open descriptor, and writes mode
`0600`. Run it through the approved privileged operator path so that ownership
can actually be assigned. If ownership or publication fails, the CLI prints
only its fixed failure message and the newly created partial output is removed
when it still refers to the same file; raw input and operating-system errors
are not printed. Archive an old result to an approved private evidence path
before a new drill; never delete or overwrite it silently. The mounted result
must stay owned by UID/GID `1001:1001` with mode `0600`, because the application
container runs as UID 1001 and mounts the evidence directory read-only.

The Admin operations page reads only the redacted result/status/age projection.
It never receives credentials, provider payloads, object paths or raw SQL
errors. `database` and `storage` become ready independently, but the recovery
section is fully ready only when both restores and every smoke check pass.

## Completion and rollback boundary

Issue #388 remains open until the real managed recovery drill and restored-app
checks are recorded. Local tests, OrbStack and a backup checksum cannot close
it.

After the owner accepts the exact V1 and separately authorizes production
replacement, take fresh production recovery inputs, retain the prior image and
configuration, and promote only the already accepted image. A changed commit,
digest or migration ledger returns the process to staging acceptance. The old
image/backups remain rollback inventory; the old live data is never deleted as
part of this cutover.
