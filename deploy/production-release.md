# EVO Production Release Runbook

This is the source of truth for releasing EVO CRM, the CRM lead-agent, EVO
Inbox, both private WAHA services, and the shared EVO edge on `hermes-vps`.
Use it only after the release PR is reviewed, merged to `main`, and all required
CI checks pass.

The central rule is simple: build and run one exact Git commit from a clean,
detached release worktree. The existing `/opt/evo-crm` and `/opt/evo-inbox`
checkouts remain untouched because they contain server-local files that are not
release source.

Official behavior used by this runbook:

- Docker Compose supports variable interpolation and multiple `--env-file`
  inputs, with later files taking precedence:
  <https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/>.
- Compose can join a service to an existing external public network and a
  project-owned private network:
  <https://docs.docker.com/reference/compose-file/networks/>.
- Dockerfile `LABEL` records OCI source, revision, and version metadata on the
  built image: <https://docs.docker.com/reference/dockerfile/#label>.
- Caddy provides configuration validation and graceful reload commands:
  <https://caddyserver.com/docs/command-line>.

## Safety boundaries

- Run commands as `root` on `hermes-vps` during a declared maintenance window.
- Replace every value shown inside angle brackets before running a command.
- `EVO_RELEASE_REVISION` must be the full 40-character SHA currently at
  `origin/main`, not a branch name, abbreviated SHA, or local commit.
- Never print, copy into the release tree, commit, or attach real environment
  files to release evidence.
- Keep `/opt/evo-crm/.env*` and the current historical
  `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env*` files in their existing
  locations. Compose receives their absolute paths. The clean release uses the
  renamed `agent-lead2-inbox/` source directory, but this release does not move
  live secret files.
- Do not reset, clean, pull into, or delete `/opt/evo-crm` or `/opt/evo-inbox`.
  In particular, preserve `/opt/evo-crm/evo-lead-agent.git-backup-*`.
- Do not stop or remove Acadis services, containers, volumes, or `acadis_*`
  networks. If a non-EVO proxy owns ports `80` or `443`, stop this run and plan
  that ownership change separately.
- Do not run `docker compose down`, `docker system prune`, or
  `docker volume prune` during this release.
- Canonical DNS and provider readiness are separate gates. A healthy fallback
  URL does not prove canonical DNS, WhatsApp, amoCRM, Gemini, or outbound
  messaging.

## 1. Set the non-secret release inputs

Open one root shell and keep it for the whole release:

```bash
ssh hermes-vps
sudo -i

export EVO_RELEASE_REVISION='<full-40-character-main-sha>'
export EVO_RELEASE_VERSION='<release-name-for-example-2026-07-23.1>'
export EVO_IMAGE_SOURCE='https://github.com/izzhackt/evo_AI_CRM'
export EVO_RELEASE_REPO="/opt/evo-releases/${EVO_RELEASE_REVISION}/repo"
export EVO_RELEASE_EVIDENCE="/opt/evo-release-evidence/${EVO_RELEASE_REVISION}/${EVO_RELEASE_VERSION}"

export EVO_CRM_APP_ENV_FILE='/opt/evo-crm/.env.production'
export EVO_CRM_WAHA_ENV_FILE='/opt/evo-crm/.env.waha'
export EVO_CRM_LEAD_AGENT_ENV_FILE='/opt/evo-crm/.env.lead-agent'
export EVO_INBOX_APP_ENV_FILE='/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.production'
export EVO_INBOX_WAHA_ENV_FILE='/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha'

export EVO_CADDY_NETWORK='evo_public_web'
export EVO_WAHA_IMAGE_REPOSITORY='devlikeapro/waha'
export EVO_WAHA_IMAGE_DIGEST='sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c'
export EVO_CADDY_IMAGE_REPOSITORY='caddy'
export EVO_CADDY_IMAGE_DIGEST='sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794'
```

Those third-party digests are the images observed during the production
reconciliation. They prevent an unrelated upstream `latest` update from
entering this release. Changing either digest is a separate reviewed upgrade.

Validate the inputs without displaying secret values:

```bash
set -Eeuo pipefail
[[ "$EVO_RELEASE_REVISION" =~ ^[0-9a-f]{40}$ ]]
[[ "$EVO_RELEASE_VERSION" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$ ]]
test "$EVO_CADDY_NETWORK" = 'evo_public_web'

for secret_file in \
  "$EVO_CRM_APP_ENV_FILE" \
  "$EVO_CRM_WAHA_ENV_FILE" \
  "$EVO_CRM_LEAD_AGENT_ENV_FILE" \
  "$EVO_INBOX_APP_ENV_FILE" \
  "$EVO_INBOX_WAHA_ENV_FILE"
do
  test -s "$secret_file"
  stat -c '%a %U:%G %n' "$secret_file"
  test "$(stat -c '%a' "$secret_file")" = 600
  test "$(stat -c '%U:%G' "$secret_file")" = 'root:root'
done
```

`stat` shows only ownership, permissions, and paths. It does not display file
contents. Stop if a file is missing, empty, or readable by users who should not
have production access.

## 2. Create the clean detached release worktree

Fetch through the existing Git repository, but do not change its branch or
working tree:

```bash
git -C /opt/evo-crm fetch origin main
test "$(git -C /opt/evo-crm rev-parse 'origin/main^{commit}')" = \
  "$EVO_RELEASE_REVISION"

install -d -m 0755 "/opt/evo-releases/${EVO_RELEASE_REVISION}"
test ! -e "$EVO_RELEASE_EVIDENCE"
install -d -m 0700 "$EVO_RELEASE_EVIDENCE"

if test -e "$EVO_RELEASE_REPO"
then
  test "$(git -C "$EVO_RELEASE_REPO" rev-parse HEAD)" = \
    "$EVO_RELEASE_REVISION"
else
  git -C /opt/evo-crm worktree add --detach \
    "$EVO_RELEASE_REPO" "$EVO_RELEASE_REVISION"
fi

test "$(git -C "$EVO_RELEASE_REPO" rev-parse HEAD)" = \
  "$EVO_RELEASE_REVISION"
git -C "$EVO_RELEASE_REPO" status --porcelain=v1 --untracked-files=all \
  >"$EVO_RELEASE_EVIDENCE/release-worktree-status.txt"
test ! -s "$EVO_RELEASE_EVIDENCE/release-worktree-status.txt"
git -C "$EVO_RELEASE_REPO" show --no-patch --format=fuller HEAD \
  >"$EVO_RELEASE_EVIDENCE/release-commit.txt"
```

An empty `release-worktree-status.txt` is required. The worktree is detached on
purpose: no server branch can silently move after validation.

Record the old checkouts without changing them:

```bash
git -C /opt/evo-crm status --short \
  >"$EVO_RELEASE_EVIDENCE/prior-evo-crm-status.txt"
git -C /opt/evo-inbox status --short \
  >"$EVO_RELEASE_EVIDENCE/prior-evo-inbox-status.txt"
git -C /opt/evo-crm rev-parse HEAD \
  >"$EVO_RELEASE_EVIDENCE/prior-evo-crm-head.txt"
git -C /opt/evo-inbox rev-parse HEAD \
  >"$EVO_RELEASE_EVIDENCE/prior-evo-inbox-head.txt"
```

## 3. Observe the live boundary before changing it

These commands produce non-secret release evidence:

```bash
docker version --format 'server={{.Server.Version}}' \
  >"$EVO_RELEASE_EVIDENCE/docker-version.txt"
docker compose version \
  >"$EVO_RELEASE_EVIDENCE/docker-compose-version.txt"
docker ps --format \
  'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' \
  >"$EVO_RELEASE_EVIDENCE/prior-containers.txt"
docker network ls \
  >"$EVO_RELEASE_EVIDENCE/prior-networks.txt"
ss -ltnp '( sport = :80 or sport = :443 )' \
  >"$EVO_RELEASE_EVIDENCE/prior-edge-listeners.txt"
```

Confirm the public listener owner before continuing:

```bash
docker ps --filter publish=80 --filter publish=443 \
  --format '{{.Names}}\t{{.Ports}}'
```

Continue only when `evo-edge-caddy` is the intended owner. Do not automatically
stop another project to free the ports.

Resolve the live containers and require every expected boundary:

```bash
CRM_APP_ID="$(docker compose -p evo-crm \
  -f /opt/evo-crm/docker-compose.prod.yml ps -q app)"
CRM_WAHA_ID="$(docker compose -p evo-crm \
  -f /opt/evo-crm/docker-compose.prod.yml ps -q waha)"
CRM_LEAD_ID="$(docker compose -p evo-crm \
  -f /opt/evo-crm/docker-compose.prod.yml ps -q lead-agent)"
INBOX_APP_ID="$(docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f /opt/evo-inbox/agent-lead2-crmwhatsapp/deploy/docker-compose.inbox.prod.yml \
  ps -q app)"
INBOX_WAHA_ID="$(docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f /opt/evo-inbox/agent-lead2-crmwhatsapp/deploy/docker-compose.inbox.prod.yml \
  ps -q waha)"
CADDY_ID="$(docker ps -q --filter 'name=^/evo-edge-caddy$')"

for container_id in \
  "$CRM_APP_ID" "$CRM_WAHA_ID" "$CRM_LEAD_ID" \
  "$INBOX_APP_ID" "$INBOX_WAHA_ID" "$CADDY_ID"
do
  test -n "$container_id"
  test "$(docker inspect -f '{{.State.Running}}' "$container_id")" = true
done
```

Capture only selected inspect fields. A full `docker inspect` contains
environment values and must not be written to ordinary evidence:

```bash
record_container() {
  evidence_name="$1"
  container_id="$2"
  {
    docker inspect -f \
      'name={{.Name}} image_ref={{.Config.Image}} image_id={{.Image}}' \
      "$container_id"
    docker inspect -f \
      'config_hash={{index .Config.Labels "com.docker.compose.config-hash"}}' \
      "$container_id"
    docker inspect -f \
      '{{range .Mounts}}mount={{.Name}}:{{.Destination}} {{end}}' \
      "$container_id"
    docker inspect -f \
      '{{range $name, $_ := .NetworkSettings.Networks}}network={{$name}} {{end}}' \
      "$container_id"
  } >"$EVO_RELEASE_EVIDENCE/${evidence_name}.txt"
}

record_container prior-crm-app "$CRM_APP_ID"
record_container prior-crm-waha "$CRM_WAHA_ID"
record_container prior-crm-lead-agent "$CRM_LEAD_ID"
record_container prior-inbox-app "$INBOX_APP_ID"
record_container prior-inbox-waha "$INBOX_WAHA_ID"
record_container prior-edge-caddy "$CADDY_ID"
```

## 4. Protect the exact rollback images and configurations

Tag the image IDs already running. These private local tags keep the rollback
images addressable even if another tag changes:

```bash
ROLLBACK_TAG="before-${EVO_RELEASE_VERSION}"

PRIOR_CRM_APP_IMAGE="$(docker inspect -f '{{.Image}}' "$CRM_APP_ID")"
PRIOR_CRM_WAHA_IMAGE="$(docker inspect -f '{{.Image}}' "$CRM_WAHA_ID")"
PRIOR_CRM_LEAD_IMAGE="$(docker inspect -f '{{.Image}}' "$CRM_LEAD_ID")"
PRIOR_INBOX_APP_IMAGE="$(docker inspect -f '{{.Image}}' "$INBOX_APP_ID")"
PRIOR_INBOX_WAHA_IMAGE="$(docker inspect -f '{{.Image}}' "$INBOX_WAHA_ID")"
PRIOR_CADDY_IMAGE="$(docker inspect -f '{{.Image}}' "$CADDY_ID")"

docker image tag "$PRIOR_CRM_APP_IMAGE" \
  "evo-rollback-crm-app:${ROLLBACK_TAG}"
docker image tag "$PRIOR_CRM_WAHA_IMAGE" \
  "evo-rollback-crm-waha:${ROLLBACK_TAG}"
docker image tag "$PRIOR_CRM_LEAD_IMAGE" \
  "evo-rollback-crm-lead-agent:${ROLLBACK_TAG}"
docker image tag "$PRIOR_INBOX_APP_IMAGE" \
  "evo-rollback-inbox-app:${ROLLBACK_TAG}"
docker image tag "$PRIOR_INBOX_WAHA_IMAGE" \
  "evo-rollback-inbox-waha:${ROLLBACK_TAG}"
docker image tag "$PRIOR_CADDY_IMAGE" \
  "evo-rollback-edge-caddy:${ROLLBACK_TAG}"

printf '%s\n' \
  "ROLLBACK_TAG=${ROLLBACK_TAG}" \
  "PRIOR_CRM_APP_IMAGE=${PRIOR_CRM_APP_IMAGE}" \
  "PRIOR_CRM_WAHA_IMAGE=${PRIOR_CRM_WAHA_IMAGE}" \
  "PRIOR_CRM_LEAD_IMAGE=${PRIOR_CRM_LEAD_IMAGE}" \
  "PRIOR_INBOX_APP_IMAGE=${PRIOR_INBOX_APP_IMAGE}" \
  "PRIOR_INBOX_WAHA_IMAGE=${PRIOR_INBOX_WAHA_IMAGE}" \
  "PRIOR_CADDY_IMAGE=${PRIOR_CADDY_IMAGE}" \
  >"$EVO_RELEASE_EVIDENCE/rollback-images.env"
chmod 0600 "$EVO_RELEASE_EVIDENCE/rollback-images.env"
```

Copy the prior Compose and edge definitions for audit evidence. The live
checkouts themselves stay in place and are used for configuration rollback:

```bash
install -d -m 0700 "$EVO_RELEASE_EVIDENCE/prior-config"
cp -p /opt/evo-crm/docker-compose.prod.yml \
  "$EVO_RELEASE_EVIDENCE/prior-config/crm-compose.yml"
cp -p \
  /opt/evo-inbox/agent-lead2-crmwhatsapp/deploy/docker-compose.inbox.prod.yml \
  "$EVO_RELEASE_EVIDENCE/prior-config/inbox-compose.yml"
cp -p /opt/evo-inbox/agent-lead2-crmwhatsapp/deploy/docker-compose.edge.yml \
  "$EVO_RELEASE_EVIDENCE/prior-config/edge-compose.yml"
cp -p /opt/evo-inbox/agent-lead2-crmwhatsapp/deploy/Caddyfile.evo-edge \
  "$EVO_RELEASE_EVIDENCE/prior-config/Caddyfile.evo-edge"
sha256sum "$EVO_RELEASE_EVIDENCE"/prior-config/* \
  >"$EVO_RELEASE_EVIDENCE/prior-config.sha256"
```

Create image-only overrides for exact rollback without putting secrets in them:

```bash
printf '%s\n' \
  'services:' \
  '  app:' \
  "    image: evo-rollback-crm-app:${ROLLBACK_TAG}" \
  '  waha:' \
  "    image: evo-rollback-crm-waha:${ROLLBACK_TAG}" \
  '  lead-agent:' \
  "    image: evo-rollback-crm-lead-agent:${ROLLBACK_TAG}" \
  >"$EVO_RELEASE_EVIDENCE/rollback-crm-images.yml"

printf '%s\n' \
  'services:' \
  '  app:' \
  "    image: evo-rollback-inbox-app:${ROLLBACK_TAG}" \
  '  waha:' \
  "    image: evo-rollback-inbox-waha:${ROLLBACK_TAG}" \
  >"$EVO_RELEASE_EVIDENCE/rollback-inbox-images.yml"

printf '%s\n' \
  'services:' \
  '  caddy:' \
  "    image: evo-rollback-edge-caddy:${ROLLBACK_TAG}" \
  >"$EVO_RELEASE_EVIDENCE/rollback-edge-image.yml"
chmod 0600 \
  "$EVO_RELEASE_EVIDENCE/rollback-crm-images.yml" \
  "$EVO_RELEASE_EVIDENCE/rollback-inbox-images.yml" \
  "$EVO_RELEASE_EVIDENCE/rollback-edge-image.yml"
```

Validate the preserved prior Caddyfile with the captured prior Caddy image:

```bash
docker run --rm --entrypoint caddy \
  -v "$EVO_RELEASE_EVIDENCE/prior-config/Caddyfile.evo-edge:/etc/caddy/Caddyfile:ro" \
  "evo-rollback-edge-caddy:${ROLLBACK_TAG}" \
  validate --config /etc/caddy/Caddyfile
```

## 5. Take logical and volume snapshots

First ask the running CRM to make its normal SQLite logical backup:

```bash
docker exec "$CRM_APP_ID" node scripts/backup-sqlite.mjs \
  >"$EVO_RELEASE_EVIDENCE/sqlite-logical-backup.txt"
```

The next block briefly pauses the applications that can write local state,
copies every stateful EVO volume through its mounted container path, and always
unpauses containers that this shell paused. It does not copy environment files.

```bash
SNAPSHOT_ROOT="$EVO_RELEASE_EVIDENCE/volume-snapshot"
install -d -m 0700 \
  "$SNAPSHOT_ROOT/evo_crm_data" \
  "$SNAPSHOT_ROOT/evo_crm_backups" \
  "$SNAPSHOT_ROOT/evo_crm_output" \
  "$SNAPSHOT_ROOT/evo_crm_waha_sessions" \
  "$SNAPSHOT_ROOT/evo_crm_lead_agent_data" \
  "$SNAPSHOT_ROOT/evo_inbox_waha_sessions"

PAUSED_BY_RELEASE=()
unpause_release_containers() {
  for paused_id in "${PAUSED_BY_RELEASE[@]}"
  do
    docker unpause "$paused_id" >/dev/null 2>&1 || true
  done
}
trap unpause_release_containers EXIT INT TERM

for container_id in \
  "$CRM_APP_ID" "$CRM_WAHA_ID" "$CRM_LEAD_ID" \
  "$INBOX_APP_ID" "$INBOX_WAHA_ID"
do
  if test "$(docker inspect -f '{{.State.Paused}}' "$container_id")" = false
  then
    docker pause "$container_id" >/dev/null
    PAUSED_BY_RELEASE+=("$container_id")
  fi
done

docker cp "$CRM_APP_ID:/app/data/." \
  "$SNAPSHOT_ROOT/evo_crm_data/"
docker cp "$CRM_APP_ID:/app/backups/." \
  "$SNAPSHOT_ROOT/evo_crm_backups/"
docker cp "$CRM_APP_ID:/app/output/." \
  "$SNAPSHOT_ROOT/evo_crm_output/"
docker cp "$CRM_WAHA_ID:/app/.sessions/." \
  "$SNAPSHOT_ROOT/evo_crm_waha_sessions/"
docker cp "$CRM_LEAD_ID:/app/data/." \
  "$SNAPSHOT_ROOT/evo_crm_lead_agent_data/"
docker cp "$INBOX_WAHA_ID:/app/.sessions/." \
  "$SNAPSHOT_ROOT/evo_inbox_waha_sessions/"

unpause_release_containers
PAUSED_BY_RELEASE=()
trap - EXIT INT TERM
```

Caddy certificate/config storage is a separate consistency group. Pausing only
the edge keeps this public interruption as short as possible:

```bash
install -d -m 0700 \
  "$SNAPSHOT_ROOT/evo_edge_caddy_data" \
  "$SNAPSHOT_ROOT/evo_edge_caddy_config"

CADDY_WAS_PAUSED="$(docker inspect -f '{{.State.Paused}}' "$CADDY_ID")"
if test "$CADDY_WAS_PAUSED" = false
then
  docker pause "$CADDY_ID" >/dev/null
fi
trap 'if test "$CADDY_WAS_PAUSED" = false; then docker unpause "$CADDY_ID" >/dev/null 2>&1 || true; fi' EXIT INT TERM

docker cp "$CADDY_ID:/data/." \
  "$SNAPSHOT_ROOT/evo_edge_caddy_data/"
docker cp "$CADDY_ID:/config/." \
  "$SNAPSHOT_ROOT/evo_edge_caddy_config/"

if test "$CADDY_WAS_PAUSED" = false
then
  docker unpause "$CADDY_ID" >/dev/null
fi
trap - EXIT INT TERM
```

Hash and archive the copied snapshot. Treat it as sensitive because WAHA
session material and application data are included:

```bash
(
  cd "$SNAPSHOT_ROOT"
  find . -type f -print0 | sort -z | xargs -0 -r sha256sum
) >"$EVO_RELEASE_EVIDENCE/volume-snapshot.sha256"

tar -C "$EVO_RELEASE_EVIDENCE" -czf \
  "$EVO_RELEASE_EVIDENCE/volume-snapshot.tar.gz" volume-snapshot
chmod 0600 "$EVO_RELEASE_EVIDENCE/volume-snapshot.tar.gz"
sha256sum "$EVO_RELEASE_EVIDENCE/volume-snapshot.tar.gz" \
  >"$EVO_RELEASE_EVIDENCE/volume-snapshot.tar.gz.sha256"
```

Do not automatically restore these volumes during a code rollback. New
production writes may have occurred. A data restore is a separate destructive
incident action that requires stopping all writers and choosing an exact
recovery point.

## 6. Validate source, images, Compose, and Caddy

Pull only the reviewed immutable third-party references:

```bash
docker pull \
  "${EVO_WAHA_IMAGE_REPOSITORY}@${EVO_WAHA_IMAGE_DIGEST}"
docker pull \
  "${EVO_CADDY_IMAGE_REPOSITORY}@${EVO_CADDY_IMAGE_DIGEST}"

PINNED_WAHA_IMAGE="$(docker image inspect -f '{{.Id}}' \
  "${EVO_WAHA_IMAGE_REPOSITORY}@${EVO_WAHA_IMAGE_DIGEST}")"
PINNED_CADDY_IMAGE="$(docker image inspect -f '{{.Id}}' \
  "${EVO_CADDY_IMAGE_REPOSITORY}@${EVO_CADDY_IMAGE_DIGEST}")"
test "$PRIOR_CRM_WAHA_IMAGE" = "$PINNED_WAHA_IMAGE"
test "$PRIOR_INBOX_WAHA_IMAGE" = "$PINNED_WAHA_IMAGE"
test "$PRIOR_CADDY_IMAGE" = "$PINNED_CADDY_IMAGE"
```

These equality checks stop the release if a third-party image has drifted since
the production audit. Re-audit and review a new digest instead of silently
upgrading it.

Validate Compose without printing its rendered environment:

```bash
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" config --quiet
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  config --quiet
docker compose -p evo-edge \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.edge.yml" \
  config --quiet

docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" config --images \
  >"$EVO_RELEASE_EVIDENCE/candidate-crm-images.txt"
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  config --images \
  >"$EVO_RELEASE_EVIDENCE/candidate-inbox-images.txt"
docker compose -p evo-edge \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.edge.yml" \
  config --images \
  >"$EVO_RELEASE_EVIDENCE/candidate-edge-images.txt"
```

Validate the candidate Caddyfile before touching the live edge:

```bash
docker run --rm --entrypoint caddy \
  -v "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/Caddyfile.evo-edge:/etc/caddy/Caddyfile:ro" \
  "${EVO_CADDY_IMAGE_REPOSITORY}@${EVO_CADDY_IMAGE_DIGEST}" \
  validate --config /etc/caddy/Caddyfile
```

Build only the three first-party images:

```bash
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" \
  build app lead-agent
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  build app
```

Require the expected OCI source and full revision on every first-party image:

```bash
for image_name in \
  "evo-crm:${EVO_RELEASE_REVISION}" \
  "evo-lead-agent:${EVO_RELEASE_REVISION}" \
  "evo-inbox:${EVO_RELEASE_REVISION}"
do
  test "$(docker image inspect -f \
    '{{index .Config.Labels "org.opencontainers.image.source"}}' \
    "$image_name")" = "$EVO_IMAGE_SOURCE"
  test "$(docker image inspect -f \
    '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
    "$image_name")" = "$EVO_RELEASE_REVISION"
  test "$(docker image inspect -f \
    '{{index .Config.Labels "org.opencontainers.image.version"}}' \
    "$image_name")" = "$EVO_RELEASE_VERSION"
  docker image inspect -f \
    'image={{.Id}} source={{index .Config.Labels "org.opencontainers.image.source"}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} version={{index .Config.Labels "org.opencontainers.image.version"}}' \
    "$image_name"
done >"$EVO_RELEASE_EVIDENCE/candidate-first-party-images.txt"

docker image inspect -f 'image={{.Id}} digests={{json .RepoDigests}}' \
  "${EVO_WAHA_IMAGE_REPOSITORY}@${EVO_WAHA_IMAGE_DIGEST}" \
  >"$EVO_RELEASE_EVIDENCE/candidate-waha-image.txt"
docker image inspect -f 'image={{.Id}} digests={{json .RepoDigests}}' \
  "${EVO_CADDY_IMAGE_REPOSITORY}@${EVO_CADDY_IMAGE_DIGEST}" \
  >"$EVO_RELEASE_EVIDENCE/candidate-caddy-image.txt"

sha256sum \
  "$EVO_RELEASE_REPO/docker-compose.prod.yml" \
  "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.edge.yml" \
  "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/Caddyfile.evo-edge" \
  >"$EVO_RELEASE_EVIDENCE/candidate-config.sha256"
```

## 7. Add the live CRM containers to their private network

The old CRM containers must be able to communicate while Compose recreates one
service at a time. Require the EVO-owned public bridge, create the new
EVO-owned private bridge, and preconnect the three running CRM containers with
their stable aliases:

```bash
docker network inspect "$EVO_CADDY_NETWORK" >/dev/null
docker network inspect evo_crm_private >/dev/null 2>&1 \
  || docker network create evo_crm_private

connect_if_missing() {
  network_name="$1"
  network_alias="$2"
  container_id="$3"
  if ! docker inspect -f \
    '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
    "$container_id" | grep -qx "$network_name"
  then
    docker network connect --alias "$network_alias" \
      "$network_name" "$container_id"
  fi
}

connect_if_missing evo_crm_private evo-crm-app "$CRM_APP_ID"
connect_if_missing evo_crm_private evo-crm-waha "$CRM_WAHA_ID"
connect_if_missing evo_crm_private evo-lead-agent "$CRM_LEAD_ID"
connect_if_missing "$EVO_CADDY_NETWORK" evo-edge-caddy "$CADDY_ID"
connect_if_missing "$EVO_CADDY_NETWORK" evo-crm-app "$CRM_APP_ID"
connect_if_missing "$EVO_CADDY_NETWORK" evo-inbox-app "$INBOX_APP_ID"
```

The CRM Compose file deliberately declares `evo_crm_private` as external.
`external` means Docker, rather than Compose, owns this bridge lifecycle; it
does not publish the network or any service port. This lets the live containers
join the final private bridge before Compose replaces them.

The public preconnections ensure the live edge can resolve the replacement app
aliases before any app is recreated. Do not disconnect these containers from
an old network yet. The one-service recreation below replaces them with the
reviewed network configuration. Do not remove the old network afterward.

## 8. Deploy one service boundary at a time

Use `--no-deps` so Compose cannot recreate an adjacent service unexpectedly,
`--no-build` so it can only use images already inspected, and `--wait` so an
unhealthy boundary stops the sequence.

### 8.1 CRM WAHA

```bash
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 waha
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" ps waha
curl -fsS --max-time 20 -o /dev/null \
  https://evo-crm.72.62.119.112.sslip.io/login
```

A healthy WAHA process does not mean the `crm_primary` session is authenticated.
Session state must be checked separately without printing session credentials.

### 8.2 CRM lead-agent

```bash
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 lead-agent
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" ps lead-agent
curl -fsS --max-time 20 -o /dev/null \
  https://evo-crm.72.62.119.112.sslip.io/login
```

Container health proves only the process health endpoint. It does not prove
amoCRM, Gemini, WhatsApp session readiness, or outbound messaging.

### 8.3 CRM application

```bash
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 app
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" ps app
curl -fsS --max-time 20 -o /dev/null \
  https://evo-crm.72.62.119.112.sslip.io/login
```

Stop and roll back this boundary if either health or fallback HTTP fails.

### 8.4 EVO Inbox WAHA

```bash
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 waha
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  ps waha
curl -fsS --max-time 20 \
  https://evo-inbox.72.62.119.112.sslip.io/api/health
```

### 8.5 EVO Inbox application

```bash
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 app
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  ps app
curl -fsS --max-time 20 \
  https://evo-inbox.72.62.119.112.sslip.io/api/health
```

### 8.6 EVO edge

The candidate Caddyfile was already validated. Reconcile only the edge service:

```bash
docker compose -p evo-edge \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.edge.yml" \
  up -d --no-deps --no-build caddy
docker exec evo-edge-caddy \
  caddy validate --config /etc/caddy/Caddyfile
docker exec -w /etc/caddy evo-edge-caddy \
  caddy reload --config Caddyfile --adapter caddyfile
```

The reload is graceful. Confirm every edge route, including both preserved live
routes:

```bash
check_edge_url() {
  url="$1"
  status_code="$(curl -sS --max-time 20 -o /dev/null \
    -w '%{http_code}' "$url")"
  case "$status_code" in
    000|502|503|504)
      printf 'FAIL %s -> %s\n' "$url" "$status_code" >&2
      return 1
      ;;
    *)
      printf 'OK %s -> %s\n' "$url" "$status_code"
      ;;
  esac
}

check_edge_url 'https://evo-crm.72.62.119.112.sslip.io/login'
check_edge_url 'https://evo-inbox.72.62.119.112.sslip.io/api/health'
check_edge_url 'https://invite-bishkek.72.62.119.112.sslip.io/'
check_edge_url 'https://inbox.72.62.119.112.sslip.io/'
check_edge_url 'https://codex.72.62.119.112.sslip.io/'
```

## 9. Verify the final production boundary

Capture health and network evidence without full environment inspection:

```bash
docker compose -p evo-crm \
  -f "$EVO_RELEASE_REPO/docker-compose.prod.yml" ps \
  >"$EVO_RELEASE_EVIDENCE/final-crm-ps.txt"
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml" \
  ps >"$EVO_RELEASE_EVIDENCE/final-inbox-ps.txt"
docker compose -p evo-edge \
  -f "$EVO_RELEASE_REPO/agent-lead2-inbox/deploy/docker-compose.edge.yml" \
  ps >"$EVO_RELEASE_EVIDENCE/final-edge-ps.txt"

for container_name in \
  evo-crm-app-1 evo-crm-waha-1 evo-crm-lead-agent-1 \
  evo-inbox-app-1 evo-inbox-waha evo-edge-caddy
do
  docker inspect -f \
    'name={{.Name}} image={{.Image}} {{range $name, $_ := .NetworkSettings.Networks}}network={{$name}} {{end}}' \
    "$container_name"
done >"$EVO_RELEASE_EVIDENCE/final-images-networks.txt"

if grep -q 'network=acadis_' \
  "$EVO_RELEASE_EVIDENCE/final-images-networks.txt"
then
  printf '%s\n' 'FAIL: an EVO container still joins an acadis_* network' >&2
  exit 1
fi
```

Check canonical DNS separately. Absence is a recorded blocker, not a failed
fallback deployment and not permission to change DNS:

```bash
for canonical_host in crm.evoadmissions.com inbox.evoadmissions.com
do
  if getent ahostsv4 "$canonical_host" | awk '{print $1}' \
    | grep -qx '72.62.119.112'
  then
    if curl -fsS --max-time 20 -o /dev/null \
      "https://${canonical_host}/"
    then
      printf 'DNS_AND_HTTPS_OK %s\n' "$canonical_host"
    else
      printf 'HTTPS_BLOCKED %s resolves correctly but HTTPS failed\n' \
        "$canonical_host"
    fi
  else
    printf 'DNS_BLOCKED %s does not resolve to 72.62.119.112\n' \
      "$canonical_host"
  fi
done | tee "$EVO_RELEASE_EVIDENCE/canonical-dns-check.txt"
```

Only after all local service and fallback checks pass should a separate,
credentialed proof exercise real WAHA sessions, inbound messages, amoCRM,
Gemini draft generation, and any approved outbound action.

## 10. Exact code/config rollback

Rollback the failed boundary immediately; do not continue to later services.
The original checkouts were never changed, their Compose/Caddy definitions are
the prior live configuration, and the overrides select the captured image IDs
through protected local tags.

Load the non-secret rollback tag:

```bash
set -a
. "$EVO_RELEASE_EVIDENCE/rollback-images.env"
set +a
```

Rollback CRM services from the untouched prior checkout:

```bash
docker compose -p evo-crm \
  -f /opt/evo-crm/docker-compose.prod.yml \
  -f "$EVO_RELEASE_EVIDENCE/rollback-crm-images.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 app
docker compose -p evo-crm \
  -f /opt/evo-crm/docker-compose.prod.yml \
  -f "$EVO_RELEASE_EVIDENCE/rollback-crm-images.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 lead-agent
docker compose -p evo-crm \
  -f /opt/evo-crm/docker-compose.prod.yml \
  -f "$EVO_RELEASE_EVIDENCE/rollback-crm-images.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 waha
```

Rollback Inbox services from the untouched prior checkout:

```bash
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f /opt/evo-inbox/agent-lead2-crmwhatsapp/deploy/docker-compose.inbox.prod.yml \
  -f "$EVO_RELEASE_EVIDENCE/rollback-inbox-images.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 app
docker compose -p evo-inbox \
  --env-file "$EVO_INBOX_APP_ENV_FILE" \
  -f /opt/evo-inbox/agent-lead2-crmwhatsapp/deploy/docker-compose.inbox.prod.yml \
  -f "$EVO_RELEASE_EVIDENCE/rollback-inbox-images.yml" \
  up -d --no-deps --no-build --wait --wait-timeout 180 waha
```

Rollback the edge from the untouched prior Caddyfile, then validate and reload:

```bash
docker compose -p evo-edge \
  -f /opt/evo-inbox/agent-lead2-crmwhatsapp/deploy/docker-compose.edge.yml \
  -f "$EVO_RELEASE_EVIDENCE/rollback-edge-image.yml" \
  up -d --no-deps --no-build caddy
docker exec evo-edge-caddy \
  caddy validate --config /etc/caddy/Caddyfile
docker exec -w /etc/caddy evo-edge-caddy \
  caddy reload --config Caddyfile --adapter caddyfile
```

Repeat the fallback and preserved-route checks from section 8.6. Do not restore
volume snapshots merely because code was rolled back. Escalate separately if
data recovery is actually required.
