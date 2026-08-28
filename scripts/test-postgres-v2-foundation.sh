#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
project_name="evo-v2-foundation-$RANDOM-$$"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-v2-foundation.XXXXXX")"
env_file="$tmp_dir/postgres.env"
broken_history_root="$tmp_dir/drizzle-history-broken"
broken_migrate_root="$tmp_dir/drizzle-migrate-broken"
app_port="${EVO_V2_APP_PORT:-4310}"
postgres_port="${EVO_V2_POSTGRES_PORT:-55439}"
postgres_password="dev-only-$RANDOM-$$"
compose_args=(--project-name "$project_name" --env-file "$env_file" -f "$repo_root/docker-compose.local.yml")
app_pid=""

cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
  fi
  docker compose "${compose_args[@]}" down -v >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

if [[ "$(uname -s)" == "Darwin" ]]; then
  [[ "$(orb status)" == "Running" ]] || {
    echo "OrbStack must be Running before local EVO V2 database validation" >&2
    exit 1
  }
  [[ "$(docker context show)" == "orbstack" ]] || {
    echo "Docker context must be exactly orbstack for local EVO V2 validation" >&2
    exit 1
  }
fi

cat >"$env_file" <<EOF
EVO_POSTGRES_HOST=127.0.0.1
EVO_POSTGRES_PORT=$postgres_port
EVO_POSTGRES_DB=evo_v2
EVO_POSTGRES_USER=evo_v2
EVO_POSTGRES_PASSWORD=$postgres_password
EOF

docker compose "${compose_args[@]}" up -d postgres >/dev/null
container_id="$(docker compose "${compose_args[@]}" ps -q postgres)"
if [[ -z "$container_id" ]]; then
  echo "V2 local PostgreSQL container did not start" >&2
  exit 1
fi

health_deadline=$((SECONDS + 120))
while (( SECONDS < health_deadline )); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    break
  fi
  sleep 2
done
[[ "${status:-}" == "healthy" ]] || {
  docker logs --tail 120 "$container_id" >&2 || true
  echo "V2 local PostgreSQL health check did not become healthy" >&2
  exit 1
}

export EVO_POSTGRES_HOST=127.0.0.1
export EVO_POSTGRES_PORT="$postgres_port"
export EVO_POSTGRES_DB=evo_v2
export EVO_POSTGRES_USER=evo_v2
export EVO_POSTGRES_PASSWORD="$postgres_password"

"$node_bin" node_modules/drizzle-kit/bin.cjs check
"$node_bin" scripts/verify-drizzle-history.mjs
"$node_bin" node_modules/drizzle-kit/bin.cjs migrate

"$node_bin" --conditions=react-server --experimental-strip-types --input-type=module <<'EOF'
import {
  closeDatabaseConnections,
  probeDatabaseHealth,
} from "./src/lib/server/database.ts";

const result = await probeDatabaseHealth();
await closeDatabaseConnections();
if (!result.ok) {
  console.error(result.message);
  process.exit(1);
}
EOF

if env -u EVO_POSTGRES_PASSWORD "$node_bin" --conditions=react-server --experimental-strip-types --input-type=module <<'EOF'
import { readDatabaseConfig } from "./src/lib/server/database.ts";

readDatabaseConfig();
EOF
then
  echo "Missing EVO_POSTGRES_PASSWORD should fail closed" >&2
  exit 1
fi

cp -R "$repo_root/drizzle" "$broken_history_root"
cp -R "$repo_root/drizzle" "$broken_migrate_root"
rm -f "$broken_history_root"/meta/*_snapshot.json

if EVO_DRIZZLE_HISTORY_ROOT="$broken_history_root" "$node_bin" scripts/verify-drizzle-history.mjs >/dev/null 2>&1; then
  echo "Broken Drizzle history unexpectedly passed" >&2
  exit 1
fi

first_sql="$(find "$broken_migrate_root" -maxdepth 1 -name '*.sql' | head -n 1)"
if [[ -z "$first_sql" ]]; then
  echo "Broken migration root has no SQL file to mutate" >&2
  exit 1
fi
printf '\nTHIS IS NOT SQL;\n' >>"$first_sql"
tmp_config="$tmp_dir/drizzle.broken.config.ts"
cat >"$tmp_config" <<EOF
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  out: "${broken_migrate_root}",
  dbCredentials: {
    url: "postgresql://evo_v2:${postgres_password}@127.0.0.1:${postgres_port}/evo_v2_broken",
  },
});
EOF

docker exec "$container_id" psql -U evo_v2 -d postgres -c 'CREATE DATABASE evo_v2_broken;' >/dev/null
if "$node_bin" node_modules/drizzle-kit/bin.cjs migrate --config="$tmp_config" >/dev/null 2>&1; then
  echo "Broken migration SQL unexpectedly applied" >&2
  exit 1
fi

PATH="/Users/iskhak.tazhibaev/.hermes/node/bin:${PATH}" \
AUTH_SECRET=playwright-e2e-secret \
PORT="$app_port" \
HOSTNAME=127.0.0.1 \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:45421 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_placeholder \
npm run dev -- --hostname 127.0.0.1 --port "$app_port" >/tmp/evo-v2-foundation-app.log 2>&1 &
app_pid=$!

app_deadline=$((SECONDS + 120))
while (( SECONDS < app_deadline )); do
  status_code="$(curl -s -o /tmp/evo-v2-foundation-health.json -w '%{http_code}' "http://127.0.0.1:${app_port}/api/health" || true)"
  if [[ "$status_code" == "200" ]]; then
    break
  fi
  sleep 2
done
[[ "${status_code:-}" == "200" ]] || {
  cat /tmp/evo-v2-foundation-app.log >&2 || true
  cat /tmp/evo-v2-foundation-health.json >&2 || true
  echo "App health route did not become live against V2 Postgres" >&2
  exit 1
}

PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" npx playwright test tests/e2e/v2-postgres-health.spec.ts --project=desktop-chromium
