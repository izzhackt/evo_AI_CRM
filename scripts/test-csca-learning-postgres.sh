#!/usr/bin/env bash
# CSCA engine (285) and math content (286, 1.0.0; part 2, 1.1.0) on a
# disposable Supabase Postgres:
#   1. the whole migration chain except part 2, with a snapshot of the released
#      v1 learning RPCs right before 285
#      (supabase/tests/platform_csca_learning_pre.sql), then the suite
#      supabase/tests/platform_csca_learning.sql, which requires the v1 JSON to
#      be byte-identical and proves the CSCA boundary on release 1.0.0;
#   2. the forward upgrade: a Student with committed progress on 1.0.0
#      (supabase/tests/platform_csca_math_part2_pre.sql), the part 2 content
#      migration (release 1.1.0, applied by the unchanged engine), then
#      supabase/tests/platform_csca_math_part2.sql: the release carries 1.0.0
#      unchanged, progress goes by key, the 24 item diagnostic and the 48 item
#      mock run end to end;
#   3. the session calendar refresh (*_platform_csca_sessions_refresh.sql, in the
#      chain of step 1): supabase/tests/platform_csca_sessions_refresh.sql proves
#      the newest row of each session, the published window, the real Student
#      home RPC and immutability; a second run of the migration must be refused.
# Matched by name, not number, so a renumbering at merge keeps the hooks. No
# network, nothing shared: the container is removed on exit.
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
part2_migration=""
while IFS= read -r migration; do
  name="$(basename "$migration")"
  if [[ "$name" == *_platform_csca_math_part2.sql ]]; then
    # Applied later, on top of release 1.0.0 with a Student's progress.
    part2_migration="$migration"
    continue
  fi
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
[[ -n "$part2_migration" ]] || { echo 'CSCA math part 2 migration not found' >&2; exit 1; }

suite_log="$(psql_run -At -f /workspace/supabase/tests/platform_csca_learning.sql 2>&1)" || {
  printf '%s\n' "$suite_log" | grep -v '^$' | tail -20 >&2; exit 1;
}
printf '%s\n' "$suite_log" | grep -F 'P285_V1_SNAPSHOT_MATCHED'
printf '%s\n' "$suite_log" | grep -F 'P285_CSCA_LEARNING_SUITE_PASSED'

# Forward upgrade: progress on 1.0.0, then release 1.1.0, then the part 2 suite.
psql_run -At -f /workspace/supabase/tests/platform_csca_math_part2_pre.sql | grep -F 'CSCA_MATH_PART2_FIXTURE_RECORDED'
seed_log="$(psql_run -At -f "/workspace/$part2_migration" 2>&1)" || {
  printf '%s\n' "$seed_log" | grep -v '^$' | tail -20 >&2; exit 1;
}
printf '%s\n' "$seed_log" | grep -F 'CSCA_MATH_PART2_CONTENT_SEED_START'
printf '%s\n' "$seed_log" | grep -F 'CSCA_MATH_PART2_CONTENT_SEED_ASSERTED'
part2_log="$(psql_run -At -f /workspace/supabase/tests/platform_csca_math_part2.sql 2>&1)" || {
  printf '%s\n' "$part2_log" | grep -v '^$' | tail -20 >&2; exit 1;
}
printf '%s\n' "$part2_log" | grep -F 'CSCA_MATH_PART2_SUITE_PASSED'

# Session calendar refresh: already applied by the chain; the suite checks its result.
sessions_migration="$(find supabase/migrations -maxdepth 1 -type f -name '*_platform_csca_sessions_refresh.sql')"
[[ -n "$sessions_migration" && "$(printf '%s\n' "$sessions_migration" | wc -l)" -eq 1 ]] || {
  echo 'CSCA sessions refresh migration not found (exactly one expected)' >&2; exit 1;
}
sessions_log="$(psql_run -At -f /workspace/supabase/tests/platform_csca_sessions_refresh.sql 2>&1)" || {
  printf '%s\n' "$sessions_log" | grep -v '^$' | tail -20 >&2; exit 1;
}
printf '%s\n' "$sessions_log" | grep -F 'CSCA_SESSIONS_REFRESH_SUITE_PASSED'
# A second run is refused by the anchor: the newest rows are already checked on 21.10.2026.
if rerun_log="$(psql_run -At -f "/workspace/$sessions_migration" 2>&1)"; then
  echo 'the sessions refresh migration accepted a second run' >&2; exit 1;
fi
printf '%s\n' "$rerun_log" | grep -F 'p313_anchor_rerun' >/dev/null || {
  printf '%s\n' "$rerun_log" | grep -v '^$' | tail -20 >&2
  echo 'the second run failed for the wrong reason' >&2; exit 1;
}
echo 'CSCA_SESSIONS_REFRESH_RERUN_REFUSED'
echo 'CSCA_LEARNING_POSTGRES_VERIFIED'
