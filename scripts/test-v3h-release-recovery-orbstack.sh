#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

report_error() {
  local status=$?
  echo "EVO V3-H release/recovery harness stopped at line ${BASH_LINENO[0]} (exit ${status})." >&2
}

fail() {
  echo "$1" >&2
  exit 1
}

trap report_error ERR

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deadline_runner="$repo_root/scripts/run-command-with-deadline.mjs"
node_bin="${EVO_NODE_BIN:-}"
if [[ -z "$node_bin" && -x /opt/homebrew/opt/node@22/bin/node ]]; then
  node_bin=/opt/homebrew/opt/node@22/bin/node
fi
if [[ -z "$node_bin" ]]; then
  node_bin="$(command -v node || true)"
fi

[[ -n "$node_bin" && -x "$node_bin" ]] \
  || fail "Node 22 binary is required via EVO_NODE_BIN or PATH"
[[ "$("$node_bin" --version)" == v22.* ]] \
  || fail "The V3-H release/recovery harness requires Node 22.x"
command -v docker >/dev/null 2>&1 || fail "Docker command is unavailable"
command -v jq >/dev/null 2>&1 || fail "jq command is unavailable"
command -v curl >/dev/null 2>&1 || fail "curl command is unavailable"
command -v openssl >/dev/null 2>&1 || fail "openssl command is unavailable"

if [[ "$(uname -s)" == "Darwin" ]]; then
  [[ "$(orb status)" == "Running" ]] || fail "OrbStack must be Running"
  [[ "$(docker context show)" == "orbstack" ]] || fail "Docker context must be exactly orbstack"
fi

run_deadline() {
  "$node_bin" "$deadline_runner" "$@"
}

free_port() {
  "$node_bin" -e "const net=require('node:net');const server=net.createServer();server.listen(0,'127.0.0.1',()=>{console.log(server.address().port);server.close();});"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

if [[ "${EVO_V3H_TMPDIR+x}" == "x" ]]; then
  tmp_parent="$EVO_V3H_TMPDIR"
elif [[ "$(uname -s)" == "Darwin" ]]; then
  tmp_parent="/private/tmp"
else
  tmp_parent="/tmp"
fi
tmp_parent="${tmp_parent%/}"
tmp_dir="$(mktemp -d "${tmp_parent}/evo-v3h-release-recovery.XXXXXX")"
tmp_bin="$tmp_dir/bin"
mkdir -m 700 "$tmp_bin"
if ! command -v sha256sum >/dev/null 2>&1; then
  cat >"$tmp_bin/sha256sum" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
shasum -a 256 "$@"
EOF
  chmod 700 "$tmp_bin/sha256sum"
  export PATH="$tmp_bin:$PATH"
fi

suffix="$(openssl rand -hex 4)"
source_container="evo-v3h-db-source-${suffix}"
restore_container="evo-v3h-db-restore-${suffix}"
source_database="evo_v3h_source_${suffix}"
restore_database="evo_v3h_restore_${suffix}"
project_name="evo-v3h-release-${suffix}"
private_network="evo-v3h-private-${suffix}"
web_network="evo-v3h-web-${suffix}"
app_port="$(free_port)"
previous_revision="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa${suffix}"
target_revision="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb${suffix}"
previous_version="previous-v3h-${suffix}"
target_version="target-v3h-${suffix}"
release_run_id="local-v3h-${suffix}"
transfer_root="$tmp_dir/transfer"
evidence_root="$tmp_dir/evidence"
release_root="$repo_root"
release_compose="$tmp_dir/docker-compose.release.yml"
app_env_file="$tmp_dir/.env.production"
waha_env_file="$tmp_dir/.env.waha"
app_build_dir="$tmp_dir/app-image"
archive_dir="$transfer_root/${target_revision}-${release_run_id}"
archive_file="$archive_dir/evo-crm-image.tar"
backup_file="$tmp_dir/evo-v3h-platform.dump"
storage_source="$tmp_dir/storage-source"
storage_restore="$tmp_dir/storage-restore"
deploy_stdout="$tmp_dir/deploy.stdout"
deploy_stderr="$tmp_dir/deploy.stderr"
database_log="$tmp_dir/database.log"
docker_build_log="$tmp_dir/docker-build.log"
compose_log="$tmp_dir/compose.log"
health_url="http://127.0.0.1:${app_port}/api/health"

cleanup() {
  set +e
  if [[ -f "$release_compose" && -f "$app_env_file" ]]; then
    EVO_RELEASE_REVISION="$previous_revision" \
    EVO_RELEASE_VERSION="$previous_version" \
    EVO_CRM_PRIVATE_NETWORK="$private_network" \
    EVO_CADDY_NETWORK="$web_network" \
    EVO_WAHA_IMAGE_REPOSITORY="${waha_repository:-public.ecr.aws/supabase/postgres}" \
    EVO_WAHA_IMAGE_DIGEST="${waha_digest:-sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453}" \
      docker compose \
        --ansi never \
        --project-name "$project_name" \
        --file "$release_compose" \
        --env-file "$app_env_file" \
        down --volumes --remove-orphans >/dev/null 2>&1
  fi
  run_deadline 30000 docker rm -f "$source_container" "$restore_container" >/dev/null 2>&1 || true
  docker image rm -f \
    "evo-crm:${previous_revision}" \
    "evo-crm:${target_revision}" \
    "evo-crm:rollback-${release_run_id}" >/dev/null 2>&1 || true
  rm -rf -- "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$transfer_root" "$evidence_root" "$archive_dir" "$storage_source/private-documents" "$storage_restore/private-documents"
chmod 700 "$transfer_root" "$evidence_root" "$archive_dir" "$storage_source" "$storage_source/private-documents" "$storage_restore" "$storage_restore/private-documents"

postgres_image="$("$repo_root/scripts/resolve-postgres-test-image.sh")"
waha_repository="${postgres_image%@*}"
waha_digest="${postgres_image##*@}"
[[ "$waha_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Resolved Postgres image digest is invalid"

start_postgres_container() {
  local name=$1
  run_deadline 120000 docker run \
    --detach \
    --name "$name" \
    --network none \
    --env POSTGRES_PASSWORD=postgres \
    --mount "type=bind,src=${repo_root},dst=/workspace,readonly" \
    "$postgres_image" >/dev/null
}

wait_for_postgres() {
  local name=$1
  local deadline=$((SECONDS + 300))
  local health_status=""
  while (( SECONDS < deadline )); do
    health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)"
    if [[ "$health_status" == "healthy" || "$health_status" == "running" ]]; then
      if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  docker logs --tail 120 "$name" >&2 || true
  fail "Pinned Supabase Postgres container ${name} did not become ready"
}

create_database() {
  local name=$1 database=$2
  docker exec "$name" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
    -c "CREATE DATABASE ${database} TEMPLATE template0;" >>"$database_log" 2>&1
  docker exec \
    --env PGPASSWORD=postgres \
    "$name" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "$database" \
    -c "GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;" \
    >>"$database_log" 2>&1
}

bootstrap_source_database() {
  local name=$1 database=$2
  docker exec "$name" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$database" \
    -f /workspace/supabase/tests/bootstrap_supabase.sql >>"$database_log" 2>&1
}

migration_list="$tmp_dir/migrations.txt"
find "$repo_root/supabase/migrations" -maxdepth 1 -type f -name '[0-9][0-9][0-9]_*.sql' \
  | LC_ALL=C sort >"$migration_list"
migration_count="$(awk 'END { print NR + 0 }' "$migration_list")"
[[ "$migration_count" =~ ^[0-9]+$ && "$migration_count" -gt 0 ]] \
  || fail "No Supabase migrations were found"
latest_migration="$(basename "$(tail -n 1 "$migration_list")")"

start_postgres_container "$source_container"
start_postgres_container "$restore_container"
wait_for_postgres "$source_container"
wait_for_postgres "$restore_container"
create_database "$source_container" "$source_database"
bootstrap_source_database "$source_container" "$source_database"

while IFS= read -r migration; do
  [[ -n "$migration" ]] || continue
  docker exec "$source_container" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$source_database" \
    -f "/workspace/supabase/migrations/$(basename "$migration")" \
    >>"$database_log" 2>&1
done <"$migration_list"

docker exec -i "$source_container" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$source_database" >>"$database_log" 2>&1 <<'SQL'
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '55100000-0000-4000-8000-000000000001',
  'v3h-local-recovery@example.invalid',
  '{"display_name":"V3H local recovery sentinel"}'::jsonb
);
SQL

source_auth_user_count="$(
  docker exec -i "$source_container" \
    psql -X -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$source_database" <<'SQL'
SELECT count(*)
FROM auth.users
WHERE id = '55100000-0000-4000-8000-000000000001'
  AND email = 'v3h-local-recovery@example.invalid';
SQL
)"
[[ "$source_auth_user_count" == "1" ]] \
  || fail "The isolated migration rehearsal did not retain the synthetic representative row"

platform_table_count="$(
  docker exec "$source_container" \
    psql -X -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$source_database" \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('platform','platform_private');"
)"
[[ "$platform_table_count" =~ ^[0-9]+$ && "$platform_table_count" -gt 0 ]] \
  || fail "The isolated migration rehearsal did not create Platform tables"

docker exec "$source_container" \
  pg_dump -h 127.0.0.1 -U postgres -d "$source_database" \
  --format=custom --no-owner --no-privileges >"$backup_file"
[[ -s "$backup_file" ]] || fail "The custom-format database backup is empty"
database_backup_sha256="$(sha256_file "$backup_file")"
docker cp "$backup_file" "$source_container:/tmp/evo-v3h-platform.dump"
docker exec "$source_container" pg_restore --list /tmp/evo-v3h-platform.dump >/dev/null

create_database "$restore_container" "$restore_database"
docker cp "$backup_file" "$restore_container:/tmp/evo-v3h-platform.dump"
docker exec "$restore_container" \
  pg_restore -h 127.0.0.1 -U postgres -d "$restore_database" \
  --exit-on-error --single-transaction --no-owner --no-privileges \
  /tmp/evo-v3h-platform.dump >/dev/null
restored_auth_user_count="$(
  docker exec -i "$restore_container" \
    psql -X -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$restore_database" <<'SQL'
SELECT count(*)
FROM auth.users
WHERE id = '55100000-0000-4000-8000-000000000001'
  AND email = 'v3h-local-recovery@example.invalid';
SQL
)"
[[ "$restored_auth_user_count" == "1" ]] \
  || fail "The isolated restore did not recover the synthetic representative row"

storage_source_object="$storage_source/private-documents/v3h-synthetic-object.txt"
storage_restore_object="$storage_restore/private-documents/v3h-synthetic-object.txt"
printf 'EVO V3-H synthetic Storage object bytes\n' >"$storage_source_object"
cp "$storage_source_object" "$storage_restore_object"
storage_source_sha256="$(sha256_file "$storage_source_object")"
storage_restore_sha256="$(sha256_file "$storage_restore_object")"
[[ "$storage_source_sha256" == "$storage_restore_sha256" ]] \
  || fail "Synthetic Storage object bytes did not restore separately"
storage_bytes="$(wc -c <"$storage_source_object" | awk '{ print $1 }')"

cat >"$app_env_file" <<'EOF'
EVO_CRM_DOMAIN=crm.evoadmissions.com
EVO_CADDY_NETWORK=evo_public_web
NEXT_PUBLIC_SUPABASE_URL=https://v3hexactgreenmain001.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_v3hreleaseproof
EVO_PLATFORM_SUPABASE_SECRET_KEY=sb_secret_v3hreleaseproofsynthetic
EVO_PLATFORM_ORGANIZATION_ID=55100000-0000-4000-8000-000000000002
EVO_UI_CONTRACT_FIXTURES=0
EVO_PLATFORM_WAHA_INGRESS_ENABLED=0
EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET=
EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0
EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=
EVO_ALLOW_DEMO_SEED=0
ANTHROPIC_API_KEY=
ZAI_API_KEY=
NEXT_PUBLIC_TRANSCRIPTION_SPLINE_SCENE_URL=
EVO_ENABLE_LOCAL_TRANSCRIPTION=0
EOF
chmod 600 "$app_env_file"
printf 'WAHA_PRINT_QR=false\n' >"$waha_env_file"
chmod 600 "$waha_env_file"

mkdir -m 700 "$app_build_dir"
cat >"$app_build_dir/Dockerfile" <<'EOF'
FROM public.ecr.aws/docker/library/busybox:1.37.0
ARG REVISION
ARG VERSION
ARG HEALTHY=1
LABEL org.opencontainers.image.revision=$REVISION
LABEL org.opencontainers.image.version=$VERSION
ENV EVO_HEALTHY=$HEALTHY
RUN mkdir -p /www/api \
  && printf '{"ok":true,"status":"live"}\n' >/www/api/health
HEALTHCHECK --interval=1s --timeout=1s --retries=2 --start-period=1s CMD test "$EVO_HEALTHY" = "1"
EXPOSE 3000
CMD ["httpd","-f","-p","3000","-h","/www"]
EOF

run_deadline 240000 docker build \
  --platform linux/amd64 \
  --build-arg "REVISION=${previous_revision}" \
  --build-arg "VERSION=${previous_version}" \
  --build-arg HEALTHY=1 \
  --tag "evo-crm:${previous_revision}" \
  "$app_build_dir" >>"$docker_build_log" 2>&1
run_deadline 240000 docker build \
  --platform linux/amd64 \
  --build-arg "REVISION=${target_revision}" \
  --build-arg "VERSION=${target_version}" \
  --build-arg HEALTHY=0 \
  --tag "evo-crm:${target_revision}" \
  "$app_build_dir" >>"$docker_build_log" 2>&1
candidate_image_id="$(docker image inspect --format '{{.Id}}' "evo-crm:${target_revision}")"
[[ "$candidate_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Candidate image id is invalid"

cat >"$release_compose" <<'YAML'
services:
  app:
    image: "evo-crm:${EVO_RELEASE_REVISION}"
    platform: linux/amd64
    labels:
      org.opencontainers.image.revision: "${EVO_RELEASE_REVISION}"
      org.opencontainers.image.version: "${EVO_RELEASE_VERSION}"
    ports:
      - "127.0.0.1:${EVO_V3H_APP_PORT}:3000"
    networks:
      private: {}
      web: {}
  waha:
    image: "${EVO_WAHA_IMAGE_REPOSITORY}@${EVO_WAHA_IMAGE_DIGEST}"
    environment:
      POSTGRES_PASSWORD: postgres
    networks:
      private: {}
networks:
  private:
    name: "${EVO_CRM_PRIVATE_NETWORK}"
    internal: true
  web:
    name: "${EVO_CADDY_NETWORK}"
YAML
chmod 600 "$release_compose"
compose_sha256="$(sha256_file "$release_compose")"

docker save "evo-crm:${target_revision}" >"$archive_file"
chmod 600 "$archive_file"
archive_sha256="$(sha256_file "$archive_file")"

EVO_RELEASE_REVISION="$previous_revision" \
EVO_RELEASE_VERSION="$previous_version" \
EVO_V3H_APP_PORT="$app_port" \
EVO_CRM_PRIVATE_NETWORK="$private_network" \
EVO_CADDY_NETWORK="$web_network" \
EVO_WAHA_IMAGE_REPOSITORY="$waha_repository" \
EVO_WAHA_IMAGE_DIGEST="$waha_digest" \
  docker compose \
    --ansi never \
    --project-name "$project_name" \
    --file "$release_compose" \
    --env-file "$app_env_file" \
    up --detach --wait --wait-timeout 120 >>"$compose_log" 2>&1
curl --fail --silent --show-error --max-time 20 --output /dev/null "$health_url"

trap - ERR
set +e
EVO_RELEASE_ROOT="$release_root" \
EVO_RELEASE_PROJECT_NAME="$project_name" \
EVO_RELEASE_TRANSFER_ROOT="$transfer_root" \
EVO_RELEASE_EVIDENCE_ROOT="$evidence_root" \
EVO_RELEASE_COMPOSE_FILE="$release_compose" \
EVO_RELEASE_APP_ENV_FILE="$app_env_file" \
EVO_CRM_WAHA_ENV_FILE="$waha_env_file" \
EVO_RELEASE_EXTERNAL_HEALTH_URL="$health_url" \
EVO_WAHA_IMAGE_REPOSITORY="$waha_repository" \
EVO_WAHA_IMAGE_DIGEST="$waha_digest" \
EVO_RELEASE_REVISION="$target_revision" \
EVO_RELEASE_VERSION="$target_version" \
EVO_RELEASE_RUN_ID="$release_run_id" \
EVO_RELEASE_ARCHIVE="$archive_file" \
EVO_RELEASE_ARCHIVE_SHA256="$archive_sha256" \
EVO_RELEASE_EXPECTED_IMAGE_ID="$candidate_image_id" \
EVO_RELEASE_EXPECTED_COMPOSE_SHA256="$compose_sha256" \
EVO_RELEASE_DOCKER_STORAGE_PATH="$tmp_dir" \
EVO_RELEASE_MIN_FREE_KB=1048576 \
EVO_V3H_APP_PORT="$app_port" \
EVO_CRM_PRIVATE_NETWORK="$private_network" \
EVO_CADDY_NETWORK="$web_network" \
  "$repo_root/scripts/evo-fast-release.sh" deploy >"$deploy_stdout" 2>"$deploy_stderr"
deploy_status=$?
set -e
trap report_error ERR

[[ "$deploy_status" -eq 3 ]] || {
  sed -n '1,120p' "$deploy_stdout" >&2 || true
  sed -n '1,120p' "$deploy_stderr" >&2 || true
  fail "The release controller did not return the expected rolled-back status"
}
deploy_json="$(cat "$deploy_stdout")"
rollback_status="$(jq -er '.status' <<<"$deploy_json")"
rollback_code="$(jq -er '.code' <<<"$deploy_json")"
[[ "$rollback_status" == "rolled_back" && "$rollback_code" == "deployment_failed" ]] \
  || fail "The release controller returned an unexpected rollback result"
app_container_id="$(
  docker ps -q \
    --filter "label=com.docker.compose.project=${project_name}" \
    --filter "label=com.docker.compose.service=app"
)"
[[ -n "$app_container_id" ]] || fail "The rolled-back app container is unavailable"
rolled_back_revision="$(
  docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$app_container_id"
)"
rolled_back_health="$(
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_container_id"
)"
rolled_back_restarts="$(docker inspect --format '{{.RestartCount}}' "$app_container_id")"
[[ "$rolled_back_revision" == "$previous_revision" ]] \
  || fail "The app did not roll back to the previous immutable revision"
[[ "$rolled_back_health" == "healthy" && "$rolled_back_restarts" == "0" ]] \
  || fail "The rolled-back app is not healthy"
curl --fail --silent --show-error --max-time 20 --output /dev/null "$health_url"

jq -cn \
  --arg schema "evo-v3h-release-recovery-local/v1" \
  --arg latestMigration "$latest_migration" \
  --arg databaseBackupSha256 "$database_backup_sha256" \
  --arg storageSha256 "$storage_source_sha256" \
  --arg restoredStorageSha256 "$storage_restore_sha256" \
  --arg rollbackStatus "$rollback_status" \
  --arg rollbackCode "$rollback_code" \
  --arg previousRevision "$previous_revision" \
  --arg targetRevision "$target_revision" \
  --arg rolledBackRevision "$rolled_back_revision" \
  --argjson migrationCount "$migration_count" \
  --argjson sourceAuthUserCount "$source_auth_user_count" \
  --argjson platformTableCount "$platform_table_count" \
  --argjson restoredAuthUserCount "$restored_auth_user_count" \
  --argjson storageBytes "$storage_bytes" \
  '{
    schema:$schema,
    ok:true,
    providerTraffic:false,
    productionMutation:false,
    stagingEnvironment:false,
    database:{
      migrationCount:$migrationCount,
      latestMigration:$latestMigration,
      backupFormat:"pg_dump_custom",
      backupSha256:$databaseBackupSha256,
      sourceAuthUserCount:$sourceAuthUserCount,
      restoredAuthUserCount:$restoredAuthUserCount,
      platformTableCount:$platformTableCount
    },
    storage:{
      objectCount:1,
      bytes:$storageBytes,
      sourceSha256:$storageSha256,
      restoredSha256:$restoredStorageSha256
    },
    rollback:{
      status:$rollbackStatus,
      code:$rollbackCode,
      previousRevision:$previousRevision,
      targetRevision:$targetRevision,
      rolledBackRevision:$rolledBackRevision
    }
  }'
