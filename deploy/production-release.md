# EVO production-successor exact-SHA release runbook

Status: #551 target V3 release contract. The checked-in automation remains
unarmed while #551 implements and proves this contract; #552 owns production
configuration and activation. This runbook replaces the
former five-container V1 runbook, retained only at
[`docs/archive/v1/production-release.md`](../docs/archive/v1/production-release.md).
Nothing here authorizes a VPS or provider mutation by itself.

## 1. Release invariant

One release candidate contains:

- one clean checkout at the exact current `origin/main` commit;
- one linux/amd64 `evo-crm:<full-sha>` image built from that checkout;
- one official linux/amd64 ClamAV image pinned to
  `clamav/clamav@sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9`;
- one immutable WAHA image digest;
- exactly three Compose services, `app`, private `clamav` and private `waha`;
- one previously approved managed Supabase project whose migration ledger
  matches root `supabase/`.

The candidate must not start, require, inspect, or fall back to a companion
Inbox, Lead Agent, manual-send worker, SQLite database, Drizzle repository, V1
sender/webhook, or second UI.

The first V3 cutover may start from a genuinely absent `app` or from the one
running frozen V1 app recorded by #552. A present app is eligible only when its
exact image ID and OCI source/revision/version labels match either that approved
V1 inventory or an accepted V3 release record; every unknown or ambiguous app
stops the release. Private `waha`, `crm_primary` and all named volumes remain
present and untouched. The candidate replaces the single app in place and never
runs V1 and V3 concurrently. The exact V1 app remains a bounded rollback input
only while the first V3 candidate remains pending; the named acceptance step
during #552 makes that wrapper non-executable. V1 is never a permanent fallback.

### Automatic entry and schema boundary

After #552 explicitly arms the fail-closed circuit breaker, a trusted successful
same-repository push run of `EVO platform CI` for exact current `main` starts the
app-only release automatically. There is no staging environment, manual
workflow button or GitHub Environment reviewer pause. All runs use the constant
`evo-production-release` concurrency group and never overlap.

The workflow has two fresh-runner trust domains. A secretless `build` job with
explicit `contents: read` and no production Environment, secret, cache, SSH or
Supabase access validates admission, performs a credentials-disabled exact-main
checkout and builds the image. It uploads one immutable run/SHA-qualified
artifact containing only the image archive and a closed manifest; the numeric
artifact ID, GitHub SHA-256 digest, archive hash, image ID/config digest and OCI
labels bind it to the workflow run, attempt and source SHA.

A separate fresh privileged `deploy` job receives no build workspace/cache. Its
first secretless step independently validates success, `push`, `main`, exact
repository/current-main SHA, the workflow-dispatch-time arm snapshot and
original actor ID before any production secret, SSH or Supabase access. It
downloads only the exact same-run numeric
artifact ID, requires the downloaded GitHub digest and every sealed manifest/
archive/image field to match, and never executes an artifact-supplied script or
Compose file. A second credentials-disabled checkout supplies the release code.
Only after these checks may later steps receive individually scoped production
secrets. Authorization requires byte-for-byte equality between the original
`github.actor_id` and canonical repository variable
`EVO_PRODUCTION_RELEASE_ACTOR_ID`; missing, empty, malformed or unequal values
fail closed, and `github.triggering_actor` cannot elevate authorization. The
complete guard, artifact and variable contract is in
[`deploy/fast-app-release.md`](fast-app-release.md).

Immediately before the first SSH, transfer or production mutation, the deploy
job freshly fetches `origin/main`, re-reads the raw arm and actor-ID variable,
and repeats the exact actor comparison, repository/event/branch/SHA,
successful-CI, artifact ID/GitHub digest/manifest and migration-ledger gates. A
newer main commit, disabled arm, missing/malformed/mismatched actor ID, artifact
drift or ledger drift stops before server contact. The server preflight
independently binds the requested SHA, image labels, artifact digests and
transferred manifest before container mutation.

GitHub evaluates `${{ vars.* }}` before sending a job to its runner, so that
context is admission input, not a live pre-mutation re-read. The two fresh
guards use the Variables REST API with
`EVO_GITHUB_VARIABLES_READ_TOKEN`, a one-repository control-plane credential
with only `Variables: read`. This narrow exception is not a VPS, Supabase or
runtime secret: it is unavailable to `build`, initial deploy admission,
candidate code, artifacts, the host controller, VPS and evidence, and may be
referenced only by the final pre-SSH guard and the pre-acceptance recheck to GET
the exact arm and actor-ID variables. Any HTTP, schema or byte-comparison
failure stops. #552 owns installation, expiry/rotation and revocation of that
credential before arming the lane.

Supabase schema application remains a separate manual #552 action. The
automatic workflow checks the migration ledger read-only and stops on mismatch;
it never applies or rolls back schema. After a successful manual schema action,
the operator uses **Re-run all jobs** on the stopped release workflow run for
the same SHA. That rerun starts clean and repeats both trust gates, CI, arm,
ledger, original-actor authorization, checkout and build; it never resumes or
reuses the stopped run's artifacts or state. GitHub uses the privileges of the
actor who originally triggered the workflow, not the rerun initiator. An
original `github.actor_id` that does not exactly match the freshly read
canonical `EVO_PRODUCTION_RELEASE_ACTOR_ID`, a SHA that is no longer current
main, or any other guard failure cannot continue.

## 2. Stop conditions

Stop before any production command unless all of these are true:

1. the owner-authorized #552 activation is in force and
   `EVO_PRODUCTION_RELEASE_ARMED` is exactly `true`, and the original
   `github.actor_id` exactly matches the configured canonical
   `EVO_PRODUCTION_RELEASE_ACTOR_ID`;
2. the commit is the current `origin/main` and its required exact-head CI is
   green;
3. the checkout is clean and contains no untracked release input;
4. `/opt/evo-crm/.env.production` and `.env.waha` exist with protected
   permissions; under the host lock, the app source is copied without symlink
   following into one generation-owned mode-`0600` snapshot whose identity and
   digest remain stable, and that snapshot passes the offline contract plus
   bounded read-only key/project probes without printing values;
5. the intended managed Supabase project identity and migration ledger were
   verified read-only, and any required migration has its own approved gate;
6. the existing `crm_primary` WAHA session and volume ownership are understood;
7. separate recoverable pre-change database and private-Storage-byte artifacts
   are identified and their isolated restore/migration rehearsal has passed;
8. the real document scanner's clean/detected/unavailable/timeout/recovery gate
   has passed; and
9. the exact absent, approved-frozen-V1 or accepted-V3 pre-change app state and
   literal rollback command are recorded; and
10. #552's read-only staging inventory and exact retirement verification prove
    no remote staging route, container, Compose project, network, volume,
    executable root, GitHub `staging` Environment, exact managed Supabase
    staging branch/project ref, active `docs/runbooks/u11-staging-recovery.md`
    file or active link to it remains. Managed Supabase retirement requires the
    exact organization/ref, non-production identity, data/Auth/Storage inventory
    and recorded owner authorization; ambiguity keeps the arm disabled.

Missing Supabase, image, secret, network, volume, or provider state is a hard
failure. Do not substitute fixtures, SQLite, a frozen service, a second WAHA
session, a mutable tag, or an earlier checkout.

The controller also stops before mutation unless at least 4,194,304 KiB of
memory is available. A read-only Hermes observation on 2026-09-05 showed
16,376,008 KiB total and 5,187,392 KiB available; this is not reserved capacity
and must be rechecked immediately before #552 changes runtime state.

### One-time #552 preparation

Before the first successor release, install the exact reviewed #551 controller
while the frozen previous Compose and `.env.production` remain unchanged. If
the approved frozen-V1 rollback source requires the controller's
`seal-rollback-seed` operation, invoke it only after that installation with the
exact `EVO_SUPABASE_PROJECT_REF` and other documented non-secret values, then
verify its mode-`0600` state and retained-file hashes without rendering the
environment. Install the exact V3 Compose only after the seed succeeds. Routine
releases use their own credentials-disabled exact-main checkout and transferred
controller inputs, not this mutable host copy. Keep the release arm disabled
through all preparation and do not call providers or rescan `crm_primary`.

## 3. Pin and verify the candidate

In Bash, set literal reviewed values; do not derive them from a dirty checkout:

```bash
export EVO_RELEASE_REVISION='<full-40-character-main-sha>'
export EVO_RELEASE_VERSION='<immutable-release-name>'
export EVO_WAHA_IMAGE_DIGEST='sha256:<64-lowercase-hex>'
export EVO_SUPABASE_PROJECT_REF='<20-character-project-ref>'
export EVO_CRM_APP_ENV_FILE='/opt/evo-crm/.env.production'
export EVO_CRM_WAHA_ENV_FILE='/opt/evo-crm/.env.waha'
[[ "$EVO_RELEASE_REVISION" =~ ^[0-9a-f]{40}$ ]]
[[ "$EVO_WAHA_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$EVO_RELEASE_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]
export EVO_RELEASE_REPO="/opt/evo-releases/$EVO_RELEASE_REVISION/repo"
```

From the clean detached release checkout:

```bash
cd "$EVO_RELEASE_REPO"
git fetch --prune origin main
test "$(git rev-parse HEAD)" = "$EVO_RELEASE_REVISION"
test "$(git rev-parse origin/main)" = "$EVO_RELEASE_REVISION"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Do not print or upload a fully rendered Compose configuration because it may
contain resolved secret values. Inventory only safe projections:

```bash
docker compose -p evo-crm -f docker-compose.prod.yml config --services
docker compose -p evo-crm -f docker-compose.prod.yml config --images
```

The service output must be exactly `app` and `waha`. The image output must bind
the app to the exact commit tag and WAHA to the reviewed digest.

The host controller, not this operator shell, creates the protected
generation-owned app-environment snapshot. Offline validation, the publishable
key Auth-settings probe and the server-key Auth Admin read probe all target that
same snapshot and exact Supabase origin. Every later Compose/rollback operation
uses only that path/hash; replacement of the source `.env.production` after the
copy cannot change the release input.

## 4. Build and inspect once

Build the first-party image from the exact checkout:

```bash
docker compose -p evo-crm -f docker-compose.prod.yml build app
```

Record the immutable image ID and verify both labels:

```bash
docker image inspect "evo-crm:$EVO_RELEASE_REVISION" \
  --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.version"}}'
```

The revision must equal `EVO_RELEASE_REVISION` and the version must equal
`EVO_RELEASE_VERSION`.

Run the focused successor contract and inventory tests once on the final head:

```bash
npm run test:p6d
```

The result must include the sanitized dependency/path inventory and scoped
legacy-reference inventory. It must not include environment values or secrets.

Then run exactly one real disposable Supabase + app/private-WAHA candidate
proof on OrbStack:

```bash
npm run test:p6d:orbstack
```

It must exercise the real Next.js image, real disposable Supabase/PostgreSQL
stack and WAHA process; verify Auth/database/browser behavior, health, private
network, resources and bounded logs; and confirm exactly two application
Compose services. It must not reuse or alter the production WAHA volume or call
a live provider.

## 5. Authorized deployment

Only after the stop conditions and #552 activation, transfer the already built
exact image and immutable WAHA digest to the private transient directory on the
target. Do not build from a live working tree or run a broad Compose project
from another checkout.

Before transfer, repeat the mutation guard above. Then inventory the live app
without changing it and record exactly one state:

- `previousAppPresent=false`, `previousAppGeneration=none`, with no app service
  or conflicting container name;
- `previousAppPresent=true`, `previousAppGeneration=v1`, matching #552's
  approved frozen V1 image ID, OCI source/revision/version labels and retained
  file hashes; or
- `previousAppPresent=true`, `previousAppGeneration=v3`, matching a previously
  accepted V3 release-evidence record.

Any other present app stops before replacement. For a permitted present app,
retain its exact image and hashed Compose/controller/protected configuration
before mutation. The privileged deploy job must invoke only the exact
transferred, checked-in controller's `deploy` operation. Under the host lock,
that controller creates the protected pending/rollback state and the
generation-owned mode-`0600` environment snapshot before it internally runs
the single-app Compose replacement with `--no-deps --no-build --pull never`.
There is no direct operator `docker compose up` entrypoint: every Compose and
rollback operation must consume only the sealed snapshot and protected state.
The replacement must not start a parallel V1 or V3 container.

The controller first provisions only the exact private digest-pinned `clamav`
service and waits for its health, then replaces `app`. It must not recreate or
restart `waha`, or operate the frozen
`evo-inbox` project, Lead Agent, manual worker, Caddy, Supabase, or any V1
container other than the single exact inventoried app being replaced. It must
preserve the named WAHA session volume and keep WAHA off public networks.

## 6. Verify the running boundary

Capture only sanitized evidence:

```bash
docker compose -p evo-crm -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" ps
docker inspect evo-crm-app-1 \
  --format '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{.State.Health.Status}} {{.RestartCount}}'
docker inspect evo-crm-clamav-1 \
  --format '{{.Image}} {{.State.Health.Status}} {{.RestartCount}} {{json .HostConfig.PortBindings}}'
docker inspect evo-crm-waha-1 \
  --format '{{.Image}} {{.State.Health.Status}} {{.RestartCount}}'
docker exec evo-crm-app-1 node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
docker exec evo-crm-waha-1 node -e \
  "fetch('http://127.0.0.1:3000/ping').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
```

Then perform the approved staff browser smoke against Supabase Auth and one
read-only canonical CRM view. A healthy container alone is not proof of Auth,
Postgres, Storage, WhatsApp delivery, amoCRM, Gemini, or customer workflow.
Provider writes require their own explicit acceptance step.

Every V3 release remains a pending candidate until the exact step named
**Accept exact V3 candidate** in the same privileged `deploy` job succeeds.
That step runs only after the running image/config digest and OCI revision,
container health/restart policy, internal health, public external health and
authenticated read-only V3 browser smoke all bind to the candidate. Acting
under the verified original `github.actor_id`, it invokes only the checked-in
controller's `accept-candidate` operation. Under the release lock, the
controller re-verifies the pending record, current candidate, proof hashes,
current-main SHA and absence of a superseding release. It create-once writes
and fsyncs the deterministic immutable `v3-acceptance-record.json`, explicitly
marked as prepared evidence whose authority requires the protected current
pointer to name its exact release/hash. It then compare-and-swap advances
`current-v3-accepted.json` from the recorded prior authority and removes
`pending-current.json`. The atomic pointer replacement is the sole acceptance
commit point; the prior state is authoritative before it and the candidate
after it.

If interruption occurs after the prepared record is durable but before the
pointer commit, a locked retry reruns every acceptance proof, requires that
record to be byte-for-byte the deterministic expected payload, re-proves the
same prior/current/pending/running identities, and resumes only the same pointer
compare-and-swap without a second create-once write. If interruption occurs
after the pointer commit but before pending removal, only locked verification
of the exact pointer/record/pending triple and cleanup of that redundant pending
pointer are allowed. Any mismatch or superseding release stops, and a standalone
prepared record never grants or claims authority.

Failure, timeout or interruption before the current-pointer commit does not
write acceptance. The exact previous absent/V1/accepted-V3 state remains
authoritative and is the only rollback target; an unresolved protected pending
record blocks another release so a running-but-unaccepted app is never mistaken
for current accepted authority. Interruption after the pointer commit does not
undo acceptance: that exact candidate is authoritative, and only the locked,
byte-exact redundant-pending verification and cleanup described above may run.

## 7. Rollback boundary

Record whether the app existed, the current WAHA image digest, and the exact
Compose, controller and protected-configuration paths and SHA-256 hashes before
deployment.

Before scanner provisioning or app replacement, create-once write an immutable mode-`0600` release state and
`pending-current.json`. Bind release ID, generation, repository/source SHA,
workflow run/attempt, artifact ID/GitHub digest, candidate image/config/archive
digests and OCI labels, and the exact prior generation/release/image, scanner
presence/image plus every
retained Compose/controller/protected-config hash. After replacement and before
health proof, create-once write a separate `candidate-runtime.json` that binds
the immutable state hash and observed candidate container ID. Never rewrite
state and pending sequentially. Missing runtime proof blocks acceptance but not
rollback from the intact state/pending pair; any conflicting pointer or receipt
stops.

For a genuinely absent installation, a still-pending candidate may roll back by
removing only that candidate and restoring app absence. Once it is accepted, an
absent-state wrapper must never remove it.

For the first replacement of the approved frozen V1 app, the still-pending
candidate may restore only the exact inventoried V1 inputs and may never run
beside V3. Once the V3 candidate is accepted, that V1 wrapper refuses and the
superseded runtime may be retired; the retained V1 record remains historical
evidence only.

For later releases, a pending candidate restores its exact prior accepted V3.
An accepted current V3 may roll back only to its exact prior accepted V3 and
must atomically move `current-v3-accepted.json` back after the restore succeeds.
No mode rebuilds a prior tag or substitutes current files. Rollback restores
only the sealed prior scanner-presence state, removing the candidate scanner
when the baseline had none. No mode may stop or recreate WAHA, log out or relink
`crm_primary`, or change/delete its session volume.

Never roll back a Supabase migration by restoring SQLite, starting a frozen
worker, or dual-writing. Database/schema recovery is forward-only unless the
separately authorized
[`docs/DISASTER_RECOVERY.md`](../docs/DISASTER_RECOVERY.md) plan says otherwise.
Do not replace, copy, log out, or relink `crm_primary` as part of an app
rollback.

If the successor cannot operate safely after an allowed app rollback, stop
traffic under the approved incident plan. After recorded V3 acceptance, never
route to or reactivate the V1 runtime.

Every release evidence directory contains a mode-`0600`
`rollback-command.txt` with one complete literal, non-secret command and a
mode-`0700` state-bound wrapper at the named path. Copy the generated line
unchanged; its documented template is:

```bash
sudo -- /opt/evo-crm/release-evidence/<release-id>/rollback-command.sh
```

The generated command contains the exact release directory, not the placeholder.
Inside the protected wrapper, rather than in the operator's shell, the generator
seals the project ref and invokes its release-owned controller with this shape:

```bash
export EVO_SUPABASE_PROJECT_REF='<20-character-project-ref>'
/opt/evo-crm/release-evidence/<release-id>/controller/evo-fast-release.sh rollback
```

The generated wrapper replaces the placeholders and supplies fixed protected
state/snapshot paths; this is not a second operator entrypoint.
Under the release lock, every wrapper verifies its own checksum and binds the
release/generation/source SHA, workflow run/attempt, artifact/GitHub/archive/
image/config digests, OCI labels, installed candidate container and prior
target. It refuses unless the currently running image ID and OCI revision are
exactly the candidate installed by that release. It also refuses when protected
accepted/pending pointers name a newer or superseding release, when the running
app has changed, or when any record/hash is missing or inconsistent. An absent-
state wrapper cannot remove accepted V3, a V1 wrapper cannot overwrite accepted
V3, and an old wrapper cannot overwrite a newer release. Automatic rollback
uses that same wrapper and state.

The wrapper verifies the sealed generation-owned application-environment
snapshot hash but does not call Supabase key endpoints, so a Supabase outage
cannot block restoration of the exact prior app. It never falls back to or
reopens the mutable source `.env.production` path.

## 8. Evidence and completion

Release evidence must bind to the exact commit and contain:

- exact-head CI conclusion and commit;
- safe Compose service/image inventory;
- app image ID and OCI revision/version labels;
- immutable WAHA digest;
- sanitized dependency and legacy-reference inventories;
- isolated runtime result;
- pre/post container IDs, health and restart counts for an authorized deploy;
- the pre-change app generation and, when present, its exact image labels plus
  retained image/Compose/controller/config hashes;
- the exact pending and current/per-release V3 acceptance-record states and
  hashes, including the named acceptance step and verified original actor ID;
- Supabase project identity/migration-ledger result without keys or row data;
- separate database-backup and Storage-byte-export identities plus isolated
  restore/migration/scanner outcomes without customer or object content;
- browser-smoke result without customer content; and
- explicit result code, operator, timestamps, sanitized literal rollback
  command, and rollback outcome if used.

No evidence bundle may contain secrets, session bytes, phone numbers, customer
rows, provider payloads, cookies, or fully rendered runtime environments.
