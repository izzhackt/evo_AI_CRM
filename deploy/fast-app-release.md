# Automatic exact-main CRM app release

Status: #551 target contract. The lane remains disabled until its implementation
is independently reviewed, exact-head CI passes, the recovery and scanner gates
pass, and #552 configures the production boundary and explicitly arms it. This
document does not configure a secret, arm a release, deploy, apply schema, or
change provider, webhook, customer or production state.

The lane releases only the single V3 Next.js application. It never imports
knowledge, applies or rolls back a migration, changes provider settings,
restarts WAHA, or writes amoCRM/WhatsApp/customer data.

## Trigger and trust boundary

`EVO fast app release` runs after a completed `EVO platform CI` `workflow_run`,
not from `workflow_dispatch`, a GitHub Environment approval or a staging
environment. It has two separate jobs and trust domains; one job must never
combine build execution with production credentials or production access.

### Secretless build job

The `build` job runs on a fresh GitHub-hosted runner with explicit
`permissions: { contents: read }`, no `environment`, no job/container/service
credentials, no production secret references, no SSH material, no
`SUPABASE_ACCESS_TOKEN`, and no repository or dependency cache. Before checkout
or build, its secretless admission step requires all of the following:

1. `github.event.workflow_run.conclusion == 'success'`;
2. `github.event.workflow_run.event == 'push'`;
3. `github.event.workflow_run.head_branch == 'main'`;
4. the triggering head repository full name equals this repository exactly;
5. the 40-character `workflow_run.head_sha` equals freshly fetched current
   `origin/main`;
6. the job-dispatch snapshot of the raw value of
   `EVO_PRODUCTION_RELEASE_ARMED` is the exact lowercase
   literal `true`; and
7. the original workflow actor's `github.actor_id` exactly equals the
   job-dispatch snapshot of the raw GitHub repository variable
   `EVO_PRODUCTION_RELEASE_ACTOR_ID` configured in #552. The variable and
   context value are compared as strings without
   trimming or numeric conversion. `github.triggering_actor`, including a
   different rerun initiator, cannot supply or elevate that authorization.

Missing, empty, malformed or different values return a sanitized stopped
result. The build job never downloads or executes a PR/fork/upstream-CI
artifact, cache, workspace or checkout. After admission, it checks out the
verified `head_sha` afresh from this repository with persisted credentials
disabled and builds only from that clean tree. Production secrets and a
production Environment must be structurally absent from the complete job, not
merely unused by convention.

The build job writes one image archive and one closed-schema manifest containing
the exact repository, workflow run ID and attempt, source SHA, immutable release
ID, image ID/config digest, OCI source/revision/version labels, archive byte
count and archive SHA-256. It uploads them together once with an exact
run-and-SHA-qualified name through an immutable `upload-artifact` action pinned
to a reviewed full commit SHA. The job exposes the returned numeric artifact ID
and GitHub artifact SHA-256 digest as outputs. It cannot overwrite or append to
that artifact.

### Fresh privileged deploy job

The separate `deploy` job uses `needs: build`, a second fresh runner and its own
empty workspace. It declares only `actions: read` and `contents: read`, with all
other GitHub token permissions disabled. It has no production Environment and
receives no cache or workspace from `build`. Before any production secret is
referenced or expanded, before any SSH or Supabase access, and before any
executable from the candidate can run, a secretless deploy-admission step
independently repeats every event, repository, branch, current-main, CI, arm and
exact actor-ID guard above. It then downloads only the numeric artifact ID
produced by this same workflow run and attempt using a download action pinned to
a reviewed full commit SHA. A name-only/latest lookup is forbidden.

The deploy job requires the downloaded GitHub artifact digest to equal the
exact `upload-artifact` output and treats a download-action digest warning as a
hard failure. It independently parses the manifest as data, rejects extra or
missing fields, symlinks and path traversal, and byte-for-byte verifies the run
ID/attempt, repository, source SHA, release ID, archive size/SHA-256, image
ID/config digest and OCI labels. It never executes a script, Compose file or
other executable input from the artifact. Release scripts, controller and
Compose inputs come only from a second fresh credentials-disabled checkout of
the already revalidated exact current-main SHA. The image archive remains data
until all hashes and labels pass; after load, its actual identity must match the
sealed manifest before transfer.

Only after those secretless checks pass may later deploy steps reference the
named production secrets, each scoped to the minimum step that uses it.
The first secret-bearing operation is the least-privilege read-only Supabase
migration-ledger query; it occurs before any SSH. No secret is placed in a
job-level environment, artifact, output or evidence.

On the host and still before image load or application mutation, the controller
uses the candidate-sealed project ref and one protected application-environment
snapshot for bounded read-only credential probes. The publishable key must reach
that exact project's Auth settings endpoint and the server key must be accepted
by its Auth Admin read endpoint. Response bodies are discarded. A wrong key,
different project, arbitrary HTTPS origin, redirect, timeout or unavailable
verification stops. Manual rollback verifies the sealed snapshot digest but
does not repeat the online probes, so a Supabase outage cannot prevent exact app
restoration.

All production releases share the constant concurrency group
`evo-production-release` with `cancel-in-progress: false`. A queued stale SHA
must fail the current-main equality guard when it starts; releases never
overlap.

Neither admission result is sufficient for deployment because `main`, the arm
or the ledger can change during build and artifact transfer. After immutable-
artifact verification and the read-only ledger query, immediately before the
first SSH, transfer or production mutation, the deploy job performs a fresh
mutation guard: fetch `origin/main`, re-read the raw arm and
`EVO_PRODUCTION_RELEASE_ACTOR_ID`, revalidate the original successful CI run,
and repeat the event, repository, branch, SHA, exact actor-ID, artifact-ID/
digest/manifest and migration-ledger checks. The fetched current `origin/main`
must still equal the triggering `head_sha`. Any mismatch stops before contacting
the server. The server preflight then verifies that the transferred manifest,
image revision, digests and requested revision all equal that same release
state before it may replace a container.

GitHub interpolates `${{ vars.* }}` before a job is sent to its runner; those
values therefore cannot prove that a repository variable is still unchanged at
the later mutation boundary. The fresh pre-SSH guard and the separate
pre-acceptance guard GET both variables through the GitHub Variables REST API
using `EVO_GITHUB_VARIABLES_READ_TOKEN`. That credential is installed only on
this repository with `Variables: read`, is not a production runtime/access
credential, and is referenced only by those two exact steps. It is never
available to `build`, initial deploy admission, candidate code, artifacts,
checkout scripts, Supabase/VPS commands, the host controller or evidence. A
non-200 response, unexpected JSON shape, missing value or unequal raw value is a
sanitized hard stop. Prefer a dedicated GitHub App installation token; if #552
uses a fine-grained PAT, it must be one-repository/read-only, expire, rotate and
be revocable independently.

GitHub documents that `workflow_run` may access secrets and write tokens even
when the triggering workflow cannot, and warns that running untrusted code in
that context can expose those privileges. GitHub documents that a rerun keeps
the privileges of the actor who originally triggered the workflow, not those
of the actor who starts the rerun. GitHub also documents that a concurrency
group limits a workflow to one running execution. See
[workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs),
[workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data#validating-artifacts),
[artifact API identity](https://docs.github.com/en/rest/actions/artifacts#get-an-artifact),
[configuration variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables),
[Variables REST API](https://docs.github.com/en/rest/actions/variables),
[GitHub token guidance](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token),
and [concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).

## Arming and configuration ownership

`EVO_PRODUCTION_RELEASE_ARMED` is a repository-level circuit breaker. Missing,
empty, `false`, differently cased or unexpected values are disabled. #551
implements and tests the fail-closed check but does not create or change the
variable.

`EVO_PRODUCTION_RELEASE_ACTOR_ID` is a GitHub Actions repository variable and
the sole release-actor authorization source. Its raw value must match
`^[1-9][0-9]*$`: one canonical positive decimal GitHub account ID, with no
whitespace, sign or leading zero. The guard compares it byte-for-byte with the
original run's step-only `github.actor_id`; it does not authorize by login,
`github.triggering_actor`, repository write access alone, or any secret,
Environment, file or fallback value. Missing, empty, malformed or unequal
values fail before secrets/checkout and again before SSH or production
mutation.

#552, after schema, exact remote-staging retirement/re-inventory and every named
pre-cutover gate pass, configures the production secrets/variables, records the
intended actor ID without exposing secrets, and changes the arm to the exact
value `true`. Disarming the lane and removing or changing the actor-ID variable
are the first responses to an unsafe, ambiguous or revoked release contour.

There is no `production` Environment reviewer pause and no staging Environment,
hostname, Supabase project, Compose project, network or volume. Secret values
remain only in GitHub Actions secrets and protected server files, never in
repository variables, logs or evidence.

Required secrets when #552 configures the lane:

- `EVO_DEPLOY_SSH_PRIVATE_KEY` — dedicated restricted deploy key;
- `EVO_DEPLOY_KNOWN_HOSTS` — pre-verified Hermes host-key line;
- `SUPABASE_ACCESS_TOKEN` — least-privilege read-only migration-ledger lookup;
- `EVO_GITHUB_VARIABLES_READ_TOKEN` — one-repository control-plane credential
  limited to `Variables: read`, exposed only to the two fresh guards; and
- `EVO_PRODUCTION_SMOKE_ADMIN_EMAIL` and
  `EVO_PRODUCTION_SMOKE_ADMIN_PASSWORD` — dedicated Admin smoke identity used
  only to submit the Supabase Auth login form and then read `/v3/main` and
  `/api/version`. It may not submit a business form, click a business mutation
  control or exercise a provider.

Required non-secret variables:

- `EVO_PRODUCTION_RELEASE_ARMED`;
- `EVO_PRODUCTION_RELEASE_ACTOR_ID` — one canonical positive decimal GitHub
  account ID matching `^[1-9][0-9]*$`;
- `EVO_DEPLOY_HOST`, `EVO_DEPLOY_PORT`, `EVO_DEPLOY_USER`;
- `EVO_RELEASE_ROOT`, `EVO_RELEASE_PROJECT_NAME`,
  `EVO_RELEASE_TRANSFER_ROOT`, `EVO_RELEASE_EVIDENCE_ROOT`;
- `EVO_RELEASE_EXTERNAL_HEALTH_URL`;
- `EVO_RELEASE_MIN_FREE_KB` — at least `1048576`;
- `EVO_WAHA_IMAGE_DIGEST` — the reviewed immutable digest; and
- `EVO_SUPABASE_PROJECT_REF`.

The controller also enforces at least 4,194,304 KiB available memory by default
before mutation so the pinned scanner can start safely. A deployment-specific
`EVO_RELEASE_MIN_AVAILABLE_MEMORY_KB` may only raise that threshold; values
below 4,194,304 KiB are invalid. The observed Hermes capacity is not a
reservation and must be read again during #552 preflight.

`EVO_RELEASE_TRANSFER_ROOT` is a private transient archive-transfer directory,
not a staging environment. The #551 implementation removes the obsolete
`EVO_RELEASE_STAGING_ROOT` contract rather than preserving an alias.

### Protected application-environment snapshot

After acquiring the host lock, the controller opens the protected source
`.env.production` without following a symlink and copies it once into that
release generation's private mode-`0700` directory as a mode-`0600` immutable
snapshot. It records and rechecks the source file identity while copying,
hashes the snapshot, and runs the offline contract plus the online Supabase-key
probes against that snapshot only. Every later preflight, Compose render,
candidate start, automatic rollback and generated manual wrapper for that
generation uses the same snapshot path and hash. The mutable source path is not
reopened after snapshot creation. A symlink, inode/size/hash race, snapshot
permission error or digest mismatch stops before mutation. The secret-bearing
snapshot never enters the transferable artifact or reviewable evidence; only
its SHA-256 and protected path identity do.

## Release sequence

For the one guarded exact current-main SHA, the workflow:

1. the secretless job builds one fresh `linux/amd64` image, validates its exact
   revision/version labels and seals the immutable artifact/manifest identities;
2. the fresh deploy job repeats admission, verifies the exact same-run artifact
   without executing artifact-supplied code, and checks the managed Supabase
   migration ledger read-only;
3. after the pre-mutation guard, it transfers only the sealed image and exact
   checked-in release inputs over pinned SSH into the private transient
   directory;
4. under the host lock it creates and validates the generation-owned protected
   application-environment snapshot, then uses only that snapshot for every
   Compose operation;
5. the server preflight captures the prior accepted state, including exact
   scanner presence, and creates the exact pending-candidate/rollback state
   before mutation;
6. it provisions the official digest-pinned private `clamav` service and waits
   for health, then replaces only `app` with `--no-deps --no-build`; private
   `waha`, `crm_primary` and their named volumes remain untouched;
7. it records the installed candidate identity and verifies scanner image,
   privacy and health plus app image/config digest, OCI labels, health, restart
   count, external health and authenticated V3 browser proof;
8. only the named deploy-job acceptance step atomically promotes that exact
   candidate; and
9. any deployment or proof failure before the current-pointer commit invokes
   the same state-bound wrapper, while interruption before that commit leaves a
   blocking pending record and never implies acceptance. Interruption after the
   pointer commit preserves the exact candidate as accepted and permits only
   locked, byte-exact redundant-pending verification and cleanup.

No live `git pull`, VPS build, mutable image tag, broad Compose restart, host-key
discovery, database rollback, Storage rollback or volume rollback is used.
Schema apply remains a separate manual #552 action and is never part of this
workflow or controller.

### Continuation after a schema-ledger stop

`schema_ledger_mismatch` ends the release without transfer or production
mutation. After the separately authorized manual schema action succeeds, the
only continuation is **Re-run all jobs** for that completed `EVO fast app
release` workflow run. The rerun preserves the original successful
same-repository `push` event and exact `workflow_run.head_sha`, but starts the
release from the beginning: it repeats both trust guards, verifies the original
CI conclusion, freshly re-reads the canonical
`EVO_PRODUCTION_RELEASE_ACTOR_ID` and requires its exact string equality with
the original `github.actor_id`, performs a fresh clean checkout and image
build, re-reads the arm and migration ledger, and creates new release state.
Authorization never comes from the rerun initiator. It never resumes a stopped
shell, reuses its image/archive/state, uses `workflow_dispatch`, or creates a
no-op commit merely to retrigger deployment. If the event SHA is no longer
current `origin/main`, or any actor/arm/CI/ledger guard fails, the rerun stops.

## Acceptance and rollback contract

Every release inventories the live `app` and protected release ledger under one
exclusive server lock before mutation. Exactly one clean starting state is
permitted:

- **Genuinely absent:** `previousAppPresent=false` and
  `previousAppGeneration=none`; no `app`, conflicting container, accepted-V3
  pointer or pending-candidate pointer exists.
- **Approved frozen V1:** `previousAppPresent=true` and
  `previousAppGeneration=v1`; the exact image ID plus OCI source,
  40-character revision and version labels and retained Compose/controller/
  configuration hashes match the frozen V1 inventory approved by #552, and no
  V3 acceptance exists.
- **Accepted V3:** `previousAppPresent=true` and
  `previousAppGeneration=v3`; the running image/revision and retained-file
  hashes exactly match both `/opt/evo-crm/release-evidence/current-v3-accepted.json`
  and that release's immutable `v3-acceptance-record.json`, with no pending
  candidate.

An unresolved pending candidate is not a fourth deployable starting state. Its
exact wrapper must restore its recorded rollback target before another release.
Any app, accepted pointer or pending pointer with a missing, mutable, ambiguous,
unrecognized or mutually inconsistent identity is a hard stop.

Before provisioning the scanner or replacing `app`, the controller create-once writes the immutable
mode-`0600` release state and protected `pending-current.json`. They bind the
release ID, generation `v3`, source repository/SHA, workflow run ID/attempt,
artifact ID and GitHub digest, image ID/config digest/archive SHA-256/OCI
labels, intended
candidate identity, previous generation/release ID, exact prior scanner
presence/image and every retained-file hash.
Immediately after replacement and before health proof, the controller writes a
separate create-once `candidate-runtime.json` bound to the immutable state hash,
release/revision/image and observed candidate container ID. It never rewrites
state or pending in a two-file pseudo-transaction. Missing runtime proof blocks
acceptance, while an interruption before its creation can still roll back from
the intact state/pending pair. A conflicting runtime receipt triggers rollback
and cannot proceed to acceptance. The
previous absent/V1/accepted-V3 state remains the authoritative rollback target
while the candidate is pending. A failed or interrupted candidate never becomes
accepted merely because its container is running; if automatic rollback cannot
complete, the pending record remains and blocks further release or retirement.

### Acceptance transition for every V3 release

First cutover and every later V3 release use the same transition. Only the
step named **Accept exact V3 candidate** in the fresh privileged `deploy` job,
acting under the already verified original `github.actor_id`, may invoke the
checked-in controller's `accept-candidate` operation. It runs after all of these
proofs pass against the exact candidate: the digest-pinned private scanner is
healthy; running app image ID/config digest and OCI revision labels; container
health and restart-count policy; internal health;
public external health; and an authenticated read-only V3 browser smoke that
proves the V3 shell and canonical Supabase CRM view. Provider writes are not
part of acceptance.

Under the same server lock, `accept-candidate` re-verifies the complete pending
record, current running candidate, proof hashes, exact actor ID, current-main
SHA and absence of a newer/superseding release. It create-once writes and fsyncs
that release's deterministic mode-`0600`
`v3-acceptance-record.json`. The record identifies itself as prepared evidence
whose authority exists only when the protected current pointer names its exact
release ID and SHA-256. The controller then compare-and-swap replaces
`/opt/evo-crm/release-evidence/current-v3-accepted.json` from the recorded prior
authority to that exact candidate/record hash and removes
`pending-current.json`.

The current-pointer replacement is the sole acceptance commit point. If a
crash occurs after the prepared record is durable but before that replacement,
the prior pointer and pending candidate remain authoritative. A retry under the
same lock must rerun every acceptance proof, require the prepared record to be
byte-for-byte the deterministic expected payload, re-prove the prior pointer,
pending candidate and running container are unchanged, and only then resume the
same compare-and-swap; it never tries a second create-once write. A mismatch or
superseding release is a hard stop. If a crash occurs after the pointer commit
but before pending removal, the next invocation may only verify the exact
pointer/record/pending triple and clear that redundant pending pointer. Thus a
standalone prepared record is neither named nor interpreted as acceptance, and
both crash windows have one idempotent outcome. No human shell step, #552 setup
step, health-only result, timeout or partially written evidence can mark a
candidate accepted. The first successful pointer transition also makes
frozen-V1 runtime retirement eligible; later transitions advance authority only
from the exact previously accepted V3.

Every release writes a mode-`0600` `rollback-command.txt` containing one full
literal command and no secret values, and a mode-`0700` state-bound wrapper at
the exact path named by that command. The operator copies that line unchanged;
the template shape is:

```bash
sudo -- /opt/evo-crm/release-evidence/<release-id>/rollback-command.sh
```

The generated line replaces `<release-id>` with the exact release directory.
Inside that protected wrapper, not in the operator's shell, the generator seals
the exact non-secret project ref and calls the release-owned controller shape:

```bash
export EVO_SUPABASE_PROJECT_REF='<20-character-project-ref>'
/opt/evo-crm/release-evidence/<release-id>/controller/evo-fast-release.sh rollback
```

The generated wrapper replaces both placeholders and supplies its fixed
protected state/snapshot paths; this snippet is not a second operator entrypoint.
Every wrapper runs under the release lock and binds both sides of the
transition: release ID, candidate generation/source SHA, workflow run/attempt,
artifact ID/GitHub digest, candidate image ID/config digest/archive checksum/
OCI labels/installed container ID, and the exact prior generation, release,
image and retained-file hashes. Before acting it verifies its own checksum and
state, proves the currently running image ID and OCI revision are exactly the
candidate installed by this release, and checks both protected current-accepted
and pending pointers.

A pending-candidate wrapper may act only when `pending-current.json` identifies
that exact candidate and the accepted pointer still identifies its recorded
prior accepted V3 (or is absent for the approved absent/V1 first-cutover states).
An accepted-V3 wrapper may restore only its recorded prior accepted V3 and only
when `current-v3-accepted.json` still identifies that exact candidate; successful
rollback atomically moves the accepted pointer back to the prior release. Any
newer or superseding accepted/current/pending release, running candidate
mismatch, missing record, digest/hash mismatch or unknown generation refuses
without mutation.

An absent-state wrapper can remove only its still-pending candidate and can
never remove an accepted V3. A V1-mode wrapper can restore V1 only while its
first V3 candidate remains pending and can never overwrite an accepted V3.
Thus an old wrapper cannot overwrite a newer release. Wrappers accept no moving
tag, implicit current checkout, caller-supplied path or fallback. Automatic
rollback inside the failed release uses the same wrapper and state. Rollback
restores the sealed prior scanner-presence state: it removes the candidate
scanner when none existed, or restores only the exact pinned prior scanner. No
rollback may stop/recreate WAHA, log out/relink `crm_primary`, or change/delete
the WAHA session volume.

## Evidence

Reviewable evidence contains only the exact source SHA, triggering CI run and
conclusion, build/deploy job separation, arm/actor results, artifact ID/GitHub
digest/closed-manifest and archive/image/config/label checks, safe Compose and
scanner image/privacy/health inventory, Supabase project-ref and ledger result,
pre-change app generation,
pending/current/per-release acceptance-record hashes, named acceptance-step and
health/browser results, rollback outcome and the sanitized literal rollback
command.
It never contains secret values, rendered environments, customer rows, object
names, provider payloads, cookies, session identifiers or WAHA session bytes.

Docker Compose `--no-deps` does not start dependencies and `--wait` waits for
running/healthy state. Supabase exposes migration history through a read-only
Management API. See [Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/)
and [Supabase list migration history](https://supabase.com/docs/reference/api/v1-list-migration-history).
