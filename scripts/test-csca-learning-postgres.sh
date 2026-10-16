#!/usr/bin/env bash
# CSCA engine (285) and math content (286) on a disposable Supabase Postgres:
# the whole migration chain, a snapshot of the released v1 learning RPCs right
# before 285 (supabase/tests/platform_csca_learning_pre.sql), then the suite
# supabase/tests/platform_csca_learning.sql after 286, which requires the v1
# JSON to be byte-identical and proves the CSCA boundary. Matched by name, not
# number, so a renumbering at merge keeps the hooks. No network, nothing
# shared: the container is removed on exit.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
if [[ "$(uname -s)" == Darwin ]]; then
  [[ "$(orb status)" == Running && "$(docker context show)" == orbstack ]] || {
    echo 'CSCA SQL tests require running OrbStack context' >&2; exit 1;
  }
fi
postgres_image="$(bash scripts/resolve-postgres-test-image.sh)"
container_name="evo-csca-proof-${RANDOM}-$$"
database=evo_csca_proof
cleanup() { docker rm --force --volumes "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --detach --name "$container_name" --network none --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,source=$repo_root,target=/workspace,readonly" "$postgres_image" >/dev/null
ready=false
for attempt in {1..120}; do
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Disposable PostgreSQL did not start' >&2; exit 1; }
sleep 3

psql_run() {
  docker exec "$container_name" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$database" "$@"
}
docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -c "CREATE DATABASE $database TEMPLATE template0;" >/dev/null
docker exec --env PGPASSWORD=postgres "$container_name" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 \
  -U supabase_admin -d "$database" \
  -c 'GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;' >/dev/null 2>&1
psql_run -f /workspace/supabase/tests/bootstrap_supabase.sql >/dev/null

engine_seen=false
content_seen=false
while IFS= read -r migration; do
  name="$(basename "$migration")"
  if [[ "$name" == *_platform_csca_learning_engine.sql ]]; then
    psql_run -At -f /workspace/supabase/tests/platform_csca_learning_pre.sql | grep -F 'P285_V1_SNAPSHOT_RECORDED'
    engine_seen=true
  fi
  psql_run -f "/workspace/$migration" >/dev/null
  if [[ "$name" == *_platform_csca_math_part1.sql ]]; then
    content_seen=true
  fi
done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort)
[[ "$engine_seen" == true && "$content_seen" == true ]] || {
  echo 'CSCA engine or content migration not found' >&2; exit 1;
}

suite_log="$(psql_run -At -f /workspace/supabase/tests/platform_csca_learning.sql 2>&1)" || {
  printf '%s\n' "$suite_log" | grep -v '^$' | tail -20 >&2; exit 1;
}
printf '%s\n' "$suite_log" | grep -F 'P285_V1_SNAPSHOT_MATCHED'
printf '%s\n' "$suite_log" | grep -F 'P285_CSCA_LEARNING_SUITE_PASSED'
echo 'CSCA_LEARNING_POSTGRES_VERIFIED'
