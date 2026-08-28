#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
project_name="evo-database-foundation-$RANDOM-$$"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-database-foundation.XXXXXX")"
env_file="$tmp_dir/postgres.env"
app_log="$tmp_dir/app.log"
verification_log="$tmp_dir/verification.log"
broken_log="$tmp_dir/broken-migration.log"
app_pid=""
compose_args=()

fail() {
  echo "$1" >&2
  exit 1
}

free_port() {
  "$node_bin" --input-type=module <<'EOF'
import { createServer } from "node:net";
const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") process.exit(1);
  console.log(address.port);
  server.close();
});
EOF
}

cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
  fi
  if (( ${#compose_args[@]} > 0 )); then
    docker compose "${compose_args[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ -d "$tmp_dir" && "$tmp_dir" == "${TMPDIR:-/tmp}/evo-database-foundation."* ]]; then
    rm -R -- "$tmp_dir"
  fi
}
trap cleanup EXIT

if [[ "$($node_bin --version)" != v22.* ]]; then
  fail "The database foundation gate requires Node 22.x"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  [[ "$(orb status)" == "Running" ]] || fail "OrbStack must be Running"
  [[ "$(docker context show)" == "orbstack" ]] || fail "Docker context must be exactly orbstack"
fi

postgres_port="${EVO_DATABASE_POSTGRES_PORT:-$(free_port)}"
app_port="${EVO_DATABASE_APP_PORT:-$(free_port)}"
postgres_user="evo_foundation"
postgres_database="evo_foundation"
broken_database="evo_foundation_broken"
postgres_password="$(openssl rand -hex 24)"
database_url="postgresql://${postgres_user}:${postgres_password}@127.0.0.1:${postgres_port}/${postgres_database}"
broken_database_url="postgresql://${postgres_user}:${postgres_password}@127.0.0.1:${postgres_port}/${broken_database}"

compose_args=(
  --project-name "$project_name"
  --env-file "$env_file"
  --file "$repo_root/docker-compose.local.yml"
)

cat >"$env_file" <<EOF
POSTGRES_USER=$postgres_user
POSTGRES_PASSWORD=$postgres_password
POSTGRES_DB=$postgres_database
POSTGRES_PORT=$postgres_port
EOF
chmod 600 "$env_file"

docker compose "${compose_args[@]}" up --detach postgres >/dev/null
container_id="$(docker compose "${compose_args[@]}" ps --quiet postgres)"
[[ -n "$container_id" ]] || fail "The private PostgreSQL container did not start"

health_deadline=$((SECONDS + 120))
status=""
while (( SECONDS < health_deadline )); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
if [[ "$status" != "healthy" ]]; then
  docker logs --tail 120 "$container_id" >&2 || true
  fail "The private PostgreSQL container did not become healthy"
fi

start_app() {
  local app_database_url="$1"
  : >"$app_log"
  DATABASE_URL="$app_database_url" \
    AUTH_SECRET="database-foundation-browser-only" \
    "$node_bin" node_modules/next/dist/bin/next dev \
      --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
  app_pid=$!

  local deadline=$((SECONDS + 120))
  local code=""
  while (( SECONDS < deadline )); do
    if ! kill -0 "$app_pid" >/dev/null 2>&1; then
      sed -n '1,200p' "$app_log" >&2
      fail "The application exited before browser validation"
    fi
    code="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${app_port}/api/health" || true)"
    [[ "$code" == "200" ]] && return
    sleep 2
  done
  sed -n '1,200p' "$app_log" >&2
  fail "The application did not become reachable"
}

stop_app() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
    app_pid=""
  fi
}

browser_assert() {
  local expected_status="$1"
  local expected_code="${2:-}"
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
    EVO_EXPECT_STATUS="$expected_status" \
    EVO_EXPECT_DATABASE_CODE="$expected_code" \
    "$node_bin" node_modules/@playwright/test/cli.js test \
      --config=playwright.database.config.ts
}

expect_verify_failure() {
  local label="$1"
  if DATABASE_URL="$database_url" "$node_bin" scripts/verify-drizzle-history.mjs >"$verification_log" 2>&1; then
    fail "Database history verification unexpectedly passed: $label"
  fi
  if grep -F "$postgres_password" "$verification_log" >/dev/null; then
    fail "Database history verification leaked the database secret: $label"
  fi
}

cd "$repo_root"

"$node_bin" --conditions=react-server --experimental-strip-types --test \
  tests/database-config.test.mjs \
  tests/database-status-route.test.mjs

# Missing application configuration must block even though legacy env values
# are present. The exact browser route must not invoke those old paths.
EVO_DB_PATH="$tmp_dir/legacy.sqlite" \
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
  start_app ""
browser_assert 503 database_configuration_missing
stop_app

# A reachable but unmigrated real database is still blocked.
start_app "$database_url"
browser_assert 503 database_migration_required

DATABASE_URL="$database_url" "$node_bin" node_modules/drizzle-kit/bin.cjs check
expect_verify_failure "no applied migration journal"

# A syntactically broken migration must roll back rather than create a partial
# technical contract in a second disposable database.
docker exec "$container_id" psql --username "$postgres_user" --dbname postgres \
  --command "CREATE DATABASE ${broken_database};" >/dev/null
broken_migrations="$tmp_dir/broken-drizzle"
cp -R "$repo_root/drizzle" "$broken_migrations"
printf '\nTHIS IS DELIBERATELY INVALID SQL;\n' >>"$broken_migrations/0000_database_foundation.sql"
if BROKEN_DATABASE_URL="$broken_database_url" BROKEN_MIGRATIONS="$broken_migrations" \
  "$node_bin" --input-type=module >"$broken_log" 2>&1 <<'EOF'
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const client = postgres(process.env.BROKEN_DATABASE_URL, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: process.env.BROKEN_MIGRATIONS });
} finally {
  await client.end({ timeout: 5 });
}
EOF
then
  fail "A deliberately broken migration unexpectedly succeeded"
fi
if grep -F "$postgres_password" "$broken_log" >/dev/null; then
  fail "Broken migration output leaked the database secret"
fi
partial_contract="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$broken_database" --tuples-only --no-align --command "SELECT to_regclass('public.evo_database_contract');")"
[[ -z "$partial_contract" ]] || fail "The broken migration left a partial database contract"

# The real migration command must be idempotent and verify the stored journal
# after each run, not merely trust a zero Drizzle CLI exit code.
DATABASE_URL="$database_url" "$node_bin" scripts/migrate-drizzle.mjs
DATABASE_URL="$database_url" "$node_bin" scripts/migrate-drizzle.mjs
DATABASE_URL="$database_url" "$node_bin" scripts/verify-drizzle-history.mjs
browser_assert 200

# Runtime contract drift blocks the real browser path.
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE evo_database_contract SET version = 2 WHERE id = 1;" >/dev/null
browser_assert 503 database_contract_mismatch
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE evo_database_contract SET version = 1 WHERE id = 1;" >/dev/null
browser_assert 200

# Applied-history proof covers missing, extra, reordered and tampered rows.
original_hash="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 1;')"
original_created_at="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 1;')"
[[ "$original_hash" =~ ^[0-9a-f]{64}$ ]] || fail "Stored migration hash has an unexpected shape"
[[ "$original_created_at" =~ ^[0-9]+$ ]] || fail "Stored migration timestamp has an unexpected shape"

docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command 'DELETE FROM drizzle.__drizzle_migrations;' >/dev/null
expect_verify_failure "missing applied migration"
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${original_hash}', ${original_created_at});" >/dev/null

docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${original_hash}', $((original_created_at + 1)));" >/dev/null
expect_verify_failure "extra applied migration"
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $((original_created_at + 1));" >/dev/null

docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE drizzle.__drizzle_migrations SET created_at = $((original_created_at + 1));" >/dev/null
expect_verify_failure "reordered migration timestamp"
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE drizzle.__drizzle_migrations SET created_at = ${original_created_at};" >/dev/null

docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE drizzle.__drizzle_migrations SET hash = repeat('0', 64);" >/dev/null
expect_verify_failure "tampered migration hash"
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE drizzle.__drizzle_migrations SET hash = '${original_hash}';" >/dev/null
DATABASE_URL="$database_url" "$node_bin" scripts/verify-drizzle-history.mjs

echo "Real PostgreSQL, Drizzle, application and Chromium foundation proof passed."
