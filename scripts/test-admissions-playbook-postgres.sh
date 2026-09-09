#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
if [[ "$(uname -s)" == Darwin ]]; then
  [[ "$(orb status)" == Running && "$(docker context show)" == orbstack ]] || {
    echo 'Admissions SQL tests require running OrbStack context' >&2; exit 1;
  }
fi
postgres_image="$(bash scripts/resolve-postgres-test-image.sh)"
container_name="evo-admissions-proof-${RANDOM}-$$"
worker_a_pid=''
cleanup() {
  if [[ -n "$worker_a_pid" ]]; then kill "$worker_a_pid" >/dev/null 2>&1 || true; wait "$worker_a_pid" >/dev/null 2>&1 || true; fi
  docker rm --force --volumes "$container_name" >/dev/null 2>&1 || true;
}
trap cleanup EXIT
docker run --detach --name "$container_name" --network none --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,source=$repo_root,target=/workspace,readonly" "$postgres_image" >/dev/null
ready=false
for attempt in {1..120}; do
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Disposable PostgreSQL did not start' >&2; exit 1; }
docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -c 'CREATE DATABASE evo_admissions_proof TEMPLATE template0;'
docker exec --env PGPASSWORD=postgres "$container_name" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d evo_admissions_proof \
  -c 'GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;'
docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d evo_admissions_proof -f /workspace/supabase/tests/bootstrap_supabase.sql
while IFS= read -r migration; do
  docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d evo_admissions_proof -f "/workspace/$migration"
done < <(rg --files supabase/migrations | LC_ALL=C sort)
docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -v a137_mode=setup -h 127.0.0.1 -U postgres -d evo_admissions_proof \
  -f /workspace/supabase/tests/platform_admissions_playbook_boundary.sql
docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -v a137_mode=worker -v a137_value='First writer' -v a137_request=9801 -h 127.0.0.1 -U postgres -d evo_admissions_proof \
  -f /workspace/supabase/tests/platform_admissions_playbook_boundary.sql &
worker_a_pid=$!
docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -v a137_mode=worker -v a137_value='Second writer' -v a137_request=9802 -h 127.0.0.1 -U postgres -d evo_admissions_proof \
  -f /workspace/supabase/tests/platform_admissions_playbook_boundary.sql
wait "$worker_a_pid"
worker_a_pid=''
docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -v a137_mode=assert -h 127.0.0.1 -U postgres -d evo_admissions_proof \
  -f /workspace/supabase/tests/platform_admissions_playbook_boundary.sql
echo 'ADMISSIONS_PLAYBOOK_POSTGRES_VERIFIED'
