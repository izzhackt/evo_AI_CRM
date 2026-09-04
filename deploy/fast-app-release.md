# Fast CRM app release

This is the app-only release lane for the single EVO V3 successor. It deploys
only after the `EVO platform CI` workflow completes successfully for a
successful `push` to `main`, and then rechecks that the workflow SHA still
equals current `origin/main` before building or deploying anything.

The lane never imports knowledge, applies schema, changes provider settings,
restarts WAHA broadly, changes webhooks, or writes amoCRM, WhatsApp or customer
data. Supabase schema apply remains a separate manual action for #552.

## What the workflow does

`EVO fast app release` is triggered by GitHub Actions `workflow_run`, not by a
manual dispatch button. It has one production concurrency group,
`evo-production-release`, with `cancel-in-progress: false`, so overlapping
production deploys cannot run.

The `prepare` job:

1. checks out `github.event.workflow_run.head_sha`;
2. requires the triggering run to be a successful push to `main`;
3. fetches `origin/main` and requires it to equal the same SHA;
4. calls `scripts/fast-release-ci-gate.mjs` for exact-SHA required-check proof;
5. builds one linux/amd64 `evo-crm:<full-sha>` image;
6. verifies image OS/architecture and OCI revision/version labels; and
7. seals the image as a checksummed immutable archive artifact.

The `release` job repeats the exact-main and exact-green checks, asks the live
CRM which exact commit is currently deployed, rejects controlled-release scope,
checks the managed Supabase migration ledger read-only, transfers the sealed
archive to `EVO_RELEASE_TRANSFER_ROOT`, and runs
`scripts/evo-fast-release.sh deploy` on Hermes.

The release controller verifies the app env contract, disk capacity, Compose
shape, current runtime, WAHA digest, archive hash, image layers, current
external health and candidate health. It replaces only Compose service `app`
with `--no-deps --no-build --pull never --wait`; `waha` is not recreated. If
candidate deploy or health verification fails, the controller restores the
recorded previous app image and emits `status:"rolled_back"`.

Every early preflight, transfer or image-load stop is reduced to a closed safe
code in `result.json`; raw controller stderr is never uploaded as evidence.

No live `git pull`, VPS build, mutable app tag, staging job, broad Compose
restart, runtime host-key discovery, database rollback or volume rollback is
used.

## GitHub Actions inputs

Store real values only in GitHub Actions secrets/variables or provider/server
secret stores, never in the repository.

Secrets:

- `EVO_DEPLOY_SSH_PRIVATE_KEY` - dedicated deploy key;
- `EVO_DEPLOY_KNOWN_HOSTS` - pre-verified Hermes host-key line;
- `SUPABASE_ACCESS_TOKEN` - migration-ledger lookup credential.

Variables:

- `EVO_DEPLOY_HOST`, `EVO_DEPLOY_PORT`, `EVO_DEPLOY_USER`;
- `EVO_RELEASE_ROOT`, `EVO_RELEASE_PROJECT_NAME`,
  `EVO_RELEASE_TRANSFER_ROOT`, `EVO_RELEASE_EVIDENCE_ROOT`;
- `EVO_RELEASE_EXTERNAL_HEALTH_URL`;
- `EVO_RELEASE_MIN_FREE_KB` - at least `1048576`;
- `EVO_WAHA_IMAGE_DIGEST` - the reviewed immutable WAHA digest;
- `EVO_SUPABASE_PROJECT_REF`.

Prefer a fine-grained Supabase token limited to migration-history reads. The
workflow makes authenticated read calls for the ledger gate and never submits
SQL. It must not run `supabase db push`, create Supabase branches, restore a
project, or mutate Storage.

Adding deploy keys, setting server secrets, installing the release controller
on Hermes, and establishing the first compatible production baseline are
production mutations and belong to the separately controlled #552 operation.

## Normal use

1. Merge the reviewed PR to `main`.
2. Wait for `EVO platform CI` to complete green for that exact commit.
3. Let `EVO fast app release` run from the `workflow_run` event.
4. Inspect the sanitized release evidence and the `deployed` or `rolled_back`
   result.
5. Log in to CRM. The staff navigation shows `release-version · short-sha`;
   authenticated staff can also request `/api/version`.

If the scope gate returns `controlled_release_required`, the change is not
eligible for this lane. Use launch-control; do not broaden the allowlist to
force it through.

## Rollback

The deploy command creates a private state record and a rollback tag pointing
to the previous exact app image before replacing `app`. A failed deployment
invokes that rollback in the same job.

Manual rollback later requires the retained private `state.json`:

```bash
export EVO_RELEASE_ROLLBACK_STATE='/opt/evo-crm/release-evidence/<release>/state.json'
scripts/evo-fast-release.sh rollback
```

That rollback restores only the recorded app image/configuration. It does not
change Supabase schema/data, Storage objects, WAHA session bytes, webhook
ownership, provider settings or customer traffic.

## Official references

- GitHub `workflow_run` events and conclusion gating:
  <https://docs.github.com/actions/using-workflows/events-that-trigger-workflows>
- GitHub branch filters for `workflow_run`:
  <https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#onworkflow_runbranchesbranches-ignore>
- GitHub concurrency groups:
  <https://docs.github.com/actions/using-jobs/using-concurrency>
- Docker Compose `up --no-deps --wait`:
  <https://docs.docker.com/reference/cli/docker/compose/up/>
- Docker image load:
  <https://docs.docker.com/reference/cli/docker/image/load/>
- Supabase migration history API:
  <https://supabase.com/docs/reference/api/v1-list-migration-history>
