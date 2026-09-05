# Automatic exact-main CRM release

Status: active V3 application-release contract. The workflow is present but
inert while the repository variable
`EVO_AUTOMATED_PRODUCTION_RELEASE_ENABLED` is absent or not exactly `true`.
Issue #552 establishes the first protected runtime, seals the initial rollback
source, configures the names below, and flips that variable only immediately
before the authorized exact-main cutover commit.

This lane replaces the former manual fast-release button, protected GitHub
Environment approval, presentation-only scope allowlist, and staging release
path. It never applies Supabase migrations, changes provider settings, restarts
WAHA, transfers webhook ownership, or writes amoCRM, WhatsApp, or customer data.

## Automatic flow

`.github/workflows/evo-fast-release.yml` listens only for a completed
`EVO platform CI` workflow that originated from a `push` to `main`. It proceeds
only when that CI succeeded, the activation variable is exactly `true`, and the
CI head still equals the current `origin/main`.

One non-cancelling `evo-production-release` concurrency group serializes all
releases. The workflow then:

1. checks out the CI-approved SHA and revalidates the exact `Main CRM` check;
2. builds `evo-crm:<full-sha>` for linux/amd64, validates its OCI
   revision/version labels, and seals the image archive together with the exact
   release controller, environment validator and public environment contract as
   one short-lived checksummed artifact;
3. revalidates the artifact and current `main` in the release job;
4. validates the managed Supabase migration ledger read-only;
5. transfers the immutable image and exact checked-in controller bundle over
   pinned SSH, rejects symlinks or hash drift on the host, and never executes a
   mutable installed controller;
6. acquires the one host release lock and invokes that transferred controller
   for one preflight and app-only deploy; and
7. verifies exact image, labels, health, restart count, and the external health
   URL, or automatically restores the sealed previous app.

Preflight does not load the candidate image. It requires the exact Compose
hash, readable image archive layers, immutable WAHA digest, protected app env,
expected networks, capacity, and one valid rollback source. The current runtime
may be either healthy `app` plus healthy private `waha`, or healthy `waha` alone
with a valid sealed rollback seed. Any other service set fails closed.

After the candidate starts mutating the app, an exit/signal trap owns automatic
rollback until final verification succeeds. A later manual rollback is accepted
only when its state names the exact currently deployed target revision, so an
older state cannot overwrite a newer release. No live `git pull`, VPS build,
mutable image tag, broad Compose restart, database rollback, volume rollback,
host-key discovery, or V1 fallback is used. Raw controller stderr is not
uploaded; only the closed result document is retained as workflow evidence.

## Repository secrets and variables

These are repository Actions settings, not a GitHub Environment. Store no
values in Git or workflow logs.

Secrets:

- `EVO_DEPLOY_SSH_PRIVATE_KEY` — dedicated Hermes deploy key;
- `EVO_DEPLOY_KNOWN_HOSTS` — pre-verified Hermes host-key line;
- `SUPABASE_ACCESS_TOKEN` — token used only by the read-only migration-ledger
  request.

Variables:

- `EVO_AUTOMATED_PRODUCTION_RELEASE_ENABLED` — keep absent/`false` through
  #551; #552 sets exactly `true` only at the authorized cutover point;
- `EVO_DEPLOY_HOST`, `EVO_DEPLOY_PORT`, `EVO_DEPLOY_USER`;
- `EVO_RELEASE_ROOT` — `/opt/evo-crm`;
- `EVO_RELEASE_PROJECT_NAME` — `evo-crm`;
- `EVO_RELEASE_TRANSFER_ROOT` — private transient image-transfer directory;
- `EVO_RELEASE_EVIDENCE_ROOT` — private immutable release-evidence directory;
- `EVO_RELEASE_ROLLBACK_SEED` — absolute path ending in `/state.json` beneath
  the evidence root;
- `EVO_RELEASE_EXTERNAL_HEALTH_URL` — public HTTPS `/api/health` URL;
- `EVO_RELEASE_MIN_FREE_KB` — at least `1048576`;
- `EVO_WAHA_IMAGE_DIGEST` — reviewed immutable private-WAHA digest; and
- `EVO_SUPABASE_PROJECT_REF` — the one production project reference.

The workflow seals that project reference into the candidate metadata, uses it
for the read-only migration-ledger gate, passes the same value to the remote
controller, and requires `.env.production` to contain exactly
`NEXT_PUBLIC_SUPABASE_URL=https://<EVO_SUPABASE_PROJECT_REF>.supabase.co`.
A different project or an arbitrary HTTPS origin stops before the app changes.

The deploy key, variables, protected application environment and initial seed
are #552 prerequisites. The one-time seed command also uses the exact reviewed
controller installed during #552 preparation; routine automatic releases use
only the controller bundle sealed from their exact main SHA. Missing input makes
the workflow skip or stop; it never selects another host, project, database,
app, or session.

## Seal the one-time initial rollback source

The currently retained pre-V3 app image is not running. Before #552 installs
the V3 Compose/controller over the active paths, resolve and review the exact
retained image ID and execute the controller once with the production app still
absent and private WAHA healthy. Never use a tag as
`EVO_RELEASE_SEED_IMAGE`.

```bash
export EVO_RELEASE_ROOT='/opt/evo-crm'
export EVO_RELEASE_PROJECT_NAME='evo-crm'
export EVO_RELEASE_TRANSFER_ROOT='/opt/evo-crm/releases'
export EVO_RELEASE_EVIDENCE_ROOT='/opt/evo-crm/evidence'
export EVO_RELEASE_ROLLBACK_SEED='/opt/evo-crm/evidence/initial-v3-rollback/state.json'
export EVO_RELEASE_COMPOSE_FILE='/opt/evo-crm/docker-compose.prod.yml'
export EVO_RELEASE_ACTIVE_COMPOSE_FILE='/opt/evo-crm/docker-compose.prod.yml'
export EVO_RELEASE_APP_ENV_FILE='/opt/evo-crm/.env.production'
export EVO_RELEASE_EXTERNAL_HEALTH_URL='https://crm.evoadmissions.com/api/health'
export EVO_WAHA_IMAGE_DIGEST='sha256:<reviewed-64-hex-digest>'
export EVO_RELEASE_SEED_IMAGE='sha256:<reviewed-retained-image-id>'
/opt/evo-crm/scripts/evo-fast-release.sh seal-rollback-seed
```

The command refuses a running app, symlinked inputs, a non-exact image ID,
missing OCI labels, non-linux/amd64 image, invalid Compose, an output collision,
or a seed outside the evidence root. It stores mode-0600 state plus the previous
Compose file, binding the image/revision/version to SHA-256 hashes of that
Compose file and the unchanged app environment. It does not start an app,
change WAHA, or send traffic.

## Routine operation

After #552 activates the lane, there is no button or approval queue:

1. merge a reviewed PR;
2. wait for exact-main `EVO platform CI`;
3. the successful push event starts the serialized release automatically; and
4. inspect the sanitized release artifact and authenticated release version.

If a required secret, variable, migration-ledger credential, active Compose
hash, seed, current runtime, archive, capacity, network, or health proof is
missing, the release stops. Correct the named prerequisite; do not bypass it or
start a parallel runtime.

## Exact rollback command

Every deploy writes `<evidence-root>/<version>-<short-sha>-<run-id>/state.json`
and a private copy of the exact previous Compose file before replacing `app`.
Automatic rollback uses that state in the same release attempt. For a later
operator rollback, set the same non-secret controller variables, then run:

```bash
export EVO_RELEASE_ROLLBACK_STATE='/opt/evo-crm/evidence/<exact-release-directory>/state.json'
/opt/evo-crm/scripts/evo-fast-release.sh rollback
```

The rollback refuses state outside the evidence root, modified state/Compose,
changed app-env hash, a missing exact image, a state whose recorded target is
not the exact currently deployed revision, a busy host release lock, or an
unhealthy restored app. It uses the recorded previous Compose file and restores
only `app` with `--no-deps`; it does not restart WAHA or invoke a frozen V1
worker.

Official behavior references:

- [GitHub workflow events and concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Docker Compose `up --no-deps --wait`](https://docs.docker.com/reference/cli/docker/compose/up/)
- [Supabase migration history API](https://supabase.com/docs/reference/api/v1-list-migration-history)
