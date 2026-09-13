#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Bounded SQL-only proof. Reuse the existing pinned Supabase PostgreSQL
# foundation; do not start Auth, a browser, a scanner, or any provider.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
node_bin="${EVO_NODE_BIN:-node}"
[[ "$#" -eq 0 ]] || { echo 'This proof accepts no arguments' >&2; exit 1; }
[[ "$("$node_bin" --version)" == v22.* ]] || { echo 'Node 22 is required' >&2; exit 1; }
if [[ "$(uname -s)" == Darwin ]]; then
  [[ "$(orb status)" == Running && "$(docker context show)" == orbstack ]] || {
    echo 'Document requirement SQL proof requires running OrbStack context' >&2; exit 1;
  }
fi

postgres_image="$(bash scripts/resolve-postgres-test-image.sh)"
container_name="evo-document-requirement-proof-${RANDOM}-$$"
test_database='evo_document_requirement_proof'
proof_log="$(mktemp -t evo-document-requirement-proof.XXXXXX)"
container_created=0
deadline_runner="$repo_root/scripts/run-command-with-deadline.mjs"
cleanup() {
  local status="$?"
  if [[ "$container_created" == 1 ]]; then
    if ! "$node_bin" "$deadline_runner" 30000 docker rm --force --volumes "$container_name" >/dev/null 2>&1; then
      echo "Owned proof container cleanup failed: $container_name" >&2
      status=1
    fi
  fi
  rm -f -- "$proof_log"
  exit "$status"
}
trap cleanup EXIT
if docker container inspect "$container_name" >/dev/null 2>&1; then
  echo 'Refusing an existing proof container name' >&2; exit 1
fi
"$node_bin" "$deadline_runner" 120000 docker run --detach --name "$container_name" \
  --network none --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,source=$repo_root,target=/workspace,readonly" "$postgres_image" >/dev/null
container_created=1
echo "DOCUMENT_REQUIREMENT_PROOF_CONTAINER $container_name"
ready=0
for attempt in {1..120}; do
  if "$node_bin" "$deadline_runner" 10000 docker exec "$container_name" \
    pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Disposable PostgreSQL did not start' >&2; exit 1; }
docker inspect --format 'DOCUMENT_REQUIREMENT_PROOF_IMAGE {{.Image}}' "$container_name"

run_sql() {
  "$node_bin" "$deadline_runner" 60000 docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" "$@"
}
docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -c "CREATE DATABASE $test_database TEMPLATE template0;" >"$proof_log" 2>&1
docker exec --env PGPASSWORD=postgres "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "$test_database" \
  -c 'GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;' >>"$proof_log" 2>&1
run_sql -f /workspace/supabase/tests/bootstrap_supabase.sql >>"$proof_log" 2>&1
migration_count=0
while IFS= read -r migration; do
  if ! run_sql -f "/workspace/$migration" >>"$proof_log" 2>&1; then
    echo "Foundation migration failed: $(basename "$migration")" >&2
    tail -20 "$proof_log" >&2
    exit 1
  fi
  migration_count=$((migration_count + 1))
done < <(rg --files supabase/migrations | LC_ALL=C sort)
echo "DOCUMENT_REQUIREMENT_PROOF_MIGRATIONS $migration_count"
# SQL exercises authenticated public RPCs and rolls back its synthetic fixtures.
# Any assertion/error remains a nonzero exit; no synthetic success receipt.
run_sql -f /workspace/supabase/tests/platform_document_requirement_admin_positive.sql
echo 'DOCUMENT_REQUIREMENT_ADMIN_POSTGRES_VERIFIED'
