# EVO production-successor exact-SHA release runbook

Status: active V3 release contract. It replaces the former five-container V1
runbook, retained only at
[`docs/archive/v1/production-release.md`](../docs/archive/v1/production-release.md).
Nothing here authorizes a VPS or provider mutation by itself.

## 1. Release invariant

One release candidate contains:

- one clean checkout at the exact current `origin/main` commit;
- one linux/amd64 `evo-crm:<full-sha>` image built from that checkout;
- one immutable WAHA image digest;
- exactly two Compose services, `app` and private `waha`; and
- one previously approved managed Supabase project whose migration ledger
  matches root `supabase/`.

The candidate must not start, require, inspect, or fall back to a companion
Inbox, Lead Agent, manual-send worker, SQLite database, Drizzle repository, V1
sender/webhook, or second UI.

## 2. Stop conditions

Stop before any production command unless all of these are true:

1. the owner has authorized the named environment, exact commit, and operation;
2. the commit is the current `origin/main` and its required exact-head CI is
   green;
3. the checkout is clean and contains no untracked release input;
4. `/opt/evo-crm/.env.production` and `.env.waha` exist with protected
   permissions and pass their checked-in contracts without printing values;
5. the intended managed Supabase project identity and migration ledger were
   verified read-only, and any required migration has its own approved gate;
6. the existing `crm_primary` WAHA session and volume ownership are understood;
7. the current release, backup, and rollback evidence is sufficient for the
   separately approved change.

Missing Supabase, image, secret, network, volume, or provider state is a hard
failure. Do not substitute fixtures, SQLite, a frozen service, a second WAHA
session, a mutable tag, or an earlier checkout.

## 3. Pin and verify the candidate

In Bash, set literal reviewed values; do not derive them from a dirty checkout:

```bash
export EVO_RELEASE_REVISION='<full-40-character-main-sha>'
export EVO_RELEASE_VERSION='<immutable-release-name>'
export EVO_WAHA_IMAGE_DIGEST='sha256:<64-lowercase-hex>'
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

Only after the stop conditions and explicit production authorization, stage the
already built exact image and immutable WAHA digest on the target. Do not build
from a live working tree or run a broad Compose project from another checkout.

```bash
docker compose -p evo-crm -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" \
  up -d --no-build --wait --wait-timeout 180 app waha
```

This command must not operate the frozen `evo-inbox` project, Lead Agent,
manual worker, Caddy, Supabase, or any V1 container. It must preserve the named
WAHA session volume and keep WAHA off public networks.

## 6. Verify the running boundary

Capture only sanitized evidence:

```bash
docker compose -p evo-crm -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" ps
docker inspect evo-crm-app-1 \
  --format '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{.State.Health.Status}} {{.RestartCount}}'
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

## 7. Rollback boundary

Record the prior app image ID, prior Compose file hash, and current WAHA image
digest before deployment. An application rollback may restore only that exact
recorded app image and configuration. Do not rebuild a prior tag.

Never roll back a Supabase migration by restoring SQLite, starting a frozen
worker, or dual-writing. Database/schema recovery is forward-only unless the
separately authorized
[`docs/DISASTER_RECOVERY.md`](../docs/DISASTER_RECOVERY.md) plan says otherwise.
Do not replace, copy, log out, or relink `crm_primary` as part of an app
rollback.

If the successor cannot operate safely after app rollback, stop traffic under
the approved incident plan. Do not silently route to the V1 runtime.

## 8. Evidence and completion

Release evidence must bind to the exact commit and contain:

- exact-head CI conclusion and commit;
- safe Compose service/image inventory;
- app image ID and OCI revision/version labels;
- immutable WAHA digest;
- sanitized dependency and legacy-reference inventories;
- isolated runtime result;
- pre/post container IDs, health and restart counts for an authorized deploy;
- Supabase project identity/migration-ledger result without keys or row data;
- browser-smoke result without customer content; and
- explicit result code, operator, timestamps, and rollback outcome if used.

No evidence bundle may contain secrets, session bytes, phone numbers, customer
rows, provider payloads, cookies, or fully rendered runtime environments.
