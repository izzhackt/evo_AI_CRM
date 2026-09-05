# EVO V3 exact-main production release

Status: active production-successor contract. The automatic controller details,
settings and rollback command are in
[fast-app-release.md](fast-app-release.md). The former five-container V1
runbook remains historical-only at
[`docs/archive/v1/production-release.md`](../docs/archive/v1/production-release.md).

## Release invariant

One candidate consists of:

- the exact current `origin/main` SHA whose `EVO platform CI` push run passed;
- one immutable linux/amd64 `evo-crm:<full-sha>` image with matching OCI
  revision/version labels;
- one reviewed immutable WAHA image digest and the existing private
  `crm_primary` volume;
- exactly the root `app` and private `waha` Compose services;
- one managed Supabase project whose migration ledger exactly matches root
  `supabase/`; and
- a verified previous app image/Compose/env binding that can be restored
  automatically.

The candidate never starts or falls back to the companion Inbox, Lead Agent,
manual-send worker, SQLite, Drizzle, local staff gate, V1 sender/webhook,
parallel UI, or another Supabase project.

## Authorization and activation

The owner’s 2026-09-04 direction authorizes #552 to perform the one V3
production deployment and active-runtime retirement after #551 and every named
prerequisite pass. Do not add a second routine approval or GitHub Environment
reviewer. A missing prerequisite, ambiguous external state, failed recovery
proof, or commit mismatch still stops the release.

The repository variable `EVO_AUTOMATED_PRODUCTION_RELEASE_ENABLED` must remain
absent or not exactly `true` throughout #551. In #552, configure all release
settings, use the reviewed controller once to seal the initial rollback source,
install the reviewed Compose file, and then enable the variable immediately
before the authorized exact-main cutover commit. Thereafter each successful
push-main CI run enters the same serialized release lane automatically and
executes only the controller bundle sealed from that exact main SHA.

Provider calls, webhook ownership transfer, Supabase schema application,
customer writes and WAHA session mutation remain separate actions. The release
workflow does not perform them.

## Stop conditions

The controller must stop before replacing `app` unless all are true:

1. the triggering SHA is still exact current `origin/main` and its required
   `Main CRM` check is green;
2. the runner-built archive hash, image ID, linux/amd64 platform, OCI labels,
   exact controller/validator/environment-contract hashes and workflow SHA all
   match the same reviewed revision;
3. pinned SSH identity and known-host material are present;
4. `/opt/evo-crm/.env.production` and `.env.waha` are protected, and the
   application env points exactly to the candidate-sealed Supabase project ref
   and passes the checked-in runtime contract;
5. the managed Supabase project identity and migration ledger match without
   applying schema;
6. Compose contains exactly `app` and `waha`, WAHA uses the reviewed digest,
   and no forbidden network is attached;
7. current runtime is either healthy `app+waha`, or healthy `waha` alone
   plus the sealed initial rollback seed;
8. the exact prior image exists and its recorded Compose and app-env hashes
   still match;
9. the single host release lock is available and any requested manual rollback
   state names the exact currently deployed target revision; and
10. capacity and health inputs pass.

Missing state is a hard failure. Do not substitute a mutable tag, fixture,
SQLite, frozen service, second WAHA session, earlier checkout, or alternate
host/project.

## One-time #552 preparation

Before installing V3 over the active production paths:

1. resolve the retained old app by exact image ID and validate its OCI
   revision/version labels;
2. with the app absent and private WAHA healthy, execute
   `seal-rollback-seed` exactly as documented in
   [fast-app-release.md](fast-app-release.md);
3. confirm the mode-0600 state and previous Compose hashes without displaying
   `.env.production`;
4. install the exact reviewed #551 controller for the one-time seed command and
   the exact V3 Compose file; routine releases execute their own sealed
   controller bundle rather than this mutable host copy;
5. configure repository secrets/variables with activation still false;
6. prove DNS/TLS, recovery and schema prerequisites named by #552; and
7. set activation true only for the authorized exact-main cutover.

Do not scan a new WhatsApp QR code. Preserve the existing `crm_primary` volume
and do not call a provider in this preparation.

## Verification

The automatic lane captures sanitized evidence for exact CI, migration ledger,
candidate image/labels, result code, and rollback outcome. After the authorized
cutover, verify:

```bash
docker compose -p evo-crm -f /opt/evo-crm/docker-compose.prod.yml ps
docker inspect evo-crm-app-1 \
  --format '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.version"}} {{.State.Health.Status}} {{.RestartCount}}'
docker inspect evo-crm-waha-1 \
  --format '{{.Image}} {{.State.Health.Status}} {{.RestartCount}}'
```

Then perform the named staff browser smoke against Supabase Auth, one canonical
CRM read, same-organization access, cross-organization denial, and private
Storage. A healthy container is not proof of WhatsApp delivery, amoCRM or
Gemini; those remain separately controlled provider acceptance.

## Rollback

Before every app replacement the controller writes a state record containing
the exact prior image, revision, version, previous Compose hash, current app-env
hash and target revision. A failure, process exit or termination signal after
mutation automatically restores that exact image using the recorded previous
Compose file and `--no-deps` before the host lock is released.

For a later operator rollback:

```bash
export EVO_RELEASE_ROOT='/opt/evo-crm'
export EVO_RELEASE_PROJECT_NAME='evo-crm'
export EVO_RELEASE_TRANSFER_ROOT='/opt/evo-crm/releases'
export EVO_RELEASE_EVIDENCE_ROOT='/opt/evo-crm/evidence'
export EVO_RELEASE_COMPOSE_FILE='/opt/evo-crm/docker-compose.prod.yml'
export EVO_RELEASE_ACTIVE_COMPOSE_FILE='/opt/evo-crm/docker-compose.prod.yml'
export EVO_RELEASE_APP_ENV_FILE='/opt/evo-crm/.env.production'
export EVO_RELEASE_EXTERNAL_HEALTH_URL='https://crm.evoadmissions.com/api/health'
export EVO_WAHA_IMAGE_DIGEST='sha256:<reviewed-64-hex-digest>'
export EVO_RELEASE_ROLLBACK_STATE='/opt/evo-crm/evidence/<exact-release-directory>/state.json'
/opt/evo-crm/scripts/evo-fast-release.sh rollback
```

The command fails if state is outside the evidence root, hashes drift, the exact
image is absent, another release holds the host lock, the recorded target is not
the exact currently deployed revision, or the restored app is unhealthy. It
never restarts WAHA, reverts Supabase schema, starts V1, or changes provider
state.

Release evidence must never contain secret values, session bytes, phone
numbers, customer rows, provider payloads, cookies, or a fully rendered
environment.
