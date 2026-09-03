# Fast CRM app release

This is the retained app-only update lane for the single EVO successor. It may
be activated only after the separately authorized production cutover has
established the root app plus private WAHA baseline. Issue #587 validates this
control without deploying it. The lane never imports knowledge, runs
migrations, changes provider settings, restarts WAHA, or writes
amoCRM/WhatsApp/customer data.

## What the button does

The `EVO fast app release` workflow accepts one exact current `main` commit.
Before requesting production approval, an unprivileged job validates exact-main
and green CI, builds the linux/amd64 image, checks its OCI labels and seals the
checksummed archive as a one-day workflow artifact. The protected GitHub
`production` Environment then:

1. rechecks that the approved commit still equals `origin/main`, still has the
   green root `Main CRM` check, and still matches the sealed archive;
2. asks the live CRM which exact commit is currently deployed and rejects every
   changed path outside the conservative presentation allowlist;
3. checks the production Supabase migration ledger read-only against the exact
   repository migration set;
4. transfers the already-sealed immutable archive over pinned SSH;
5. runs the short server preflight, including a read-only proof that the Compose
   project contains exactly healthy `app` and `waha` services, the private WAHA
   uses the configured immutable digest, and every declared app-image layer is
   present and readable; it then replaces only `app` and checks exact
   image/labels/health/restarts plus the configured external health URL;
6. automatically restores the previous app image if any deployment or health
   assertion fails.

Every early preflight, transfer or image-load stop is reduced to a closed safe
code in `result.json`; raw controller stderr is never uploaded as evidence.

No live `git pull`, VPS build, mutable image tag, broad Compose restart, runtime
host-key discovery, database rollback or volume rollback is used.

The control matches the current vendor contracts: GitHub Environment secrets
remain unavailable until required-reviewer approval, Docker Compose `--no-deps`
does not start linked services and `--wait` waits for running/healthy state, and
Supabase exposes applied migrations through the read-only Management API. See
[GitHub deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/), and
[Supabase list migration history](https://supabase.com/docs/reference/api/v1-list-migration-history).

## One-time GitHub Environment setup

Create a protected GitHub Environment named `production` with the owner as a
required reviewer. Store values only in the Environment, never in the repo.

Secrets:

- `EVO_DEPLOY_SSH_PRIVATE_KEY` — dedicated deploy key;
- `EVO_DEPLOY_KNOWN_HOSTS` — pre-verified Hermes host-key line;
- `SUPABASE_ACCESS_TOKEN` — read-only migration-ledger lookup credential.

Prefer a fine-grained Supabase token limited to `database_migrations_read`; the
workflow makes one authenticated `GET` and never submits migration SQL.

Variables:

- `EVO_DEPLOY_HOST`, `EVO_DEPLOY_PORT`, `EVO_DEPLOY_USER`;
- `EVO_RELEASE_ROOT`, `EVO_RELEASE_PROJECT_NAME`, `EVO_RELEASE_STAGING_ROOT`,
  `EVO_RELEASE_EVIDENCE_ROOT`;
- `EVO_RELEASE_EXTERNAL_HEALTH_URL`;
- `EVO_RELEASE_MIN_FREE_KB` — at least `1048576`;
- `EVO_WAHA_IMAGE_DIGEST` — the already-reviewed immutable WAHA digest needed
  to validate both the complete Compose render and current private WAHA
  service;
- `EVO_SUPABASE_PROJECT_REF`.

The deploy key must be restricted to the intended Hermes account. Adding that
key, installing `scripts/evo-fast-release.sh` at the configured release root,
and establishing the first compatible deployed baseline are production
mutations and require the separate production-cutover authorization in #552.

## Normal use

1. Merge a presentation-only PR and wait for exact-main CI to finish green.
2. Open Actions → `EVO fast app release` → Run workflow.
3. Paste the full SHA shown on `main`.
4. Approve the single protected `production` Environment gate.
5. Wait for the `deployed` result and the four sanitized evidence files.
6. Log in to CRM. The bottom of the staff navigation shows
   `release-version · short-sha`; authenticated staff can also request
   `/api/version`.

If the scope gate returns `controlled_release_required`, the change is not
eligible for the fast lane. Use launch-control; do not broaden the allowlist to
force it through.

## Rollback

The deploy command creates a private state record and a tag pointing to the
previous exact image before replacing `app`. A failed deployment invokes that
rollback in the same approved job. Manual rollback later is possible with
`scripts/evo-fast-release.sh rollback` and the retained `state.json`, but it is
a new production action and needs a new protected approval.
