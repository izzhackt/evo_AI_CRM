#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
[[ $# -eq 0 ]] || { echo 'Usage: test-university-form-registry-postgres.sh' >&2; exit 1; }
preflight() {
 if [[ "$(uname -s)" == Darwin ]]; then
  [[ "$(orb status)" == Running && "$(docker context show)" == orbstack ]] || {
   echo 'University template proof requires running OrbStack context' >&2; exit 1;
  }
 fi
}
preflight
docker_safe() { preflight; command docker "$@"; }
export -f preflight docker_safe
postgres_image="$(DOCKER_BIN=docker_safe bash scripts/resolve-postgres-test-image.sh)"
container_name="evo-form-registry-proof-${RANDOM}-$$"
container_created=false
stage='owned isolated database'
cleanup() {
 local result=$?
 if [[ "$container_created" == true ]]; then
  preflight
  if docker rm --force --volumes "$container_name" >/dev/null; then
   printf 'Removed owned proof container: %s\n' "$container_name"
  else result=1; fi
 fi
 if [[ "$result" -ne 0 ]]; then printf 'University template proof failed at: %s\n' "$stage" >&2; fi
 exit "$result"
}
trap cleanup EXIT
preflight
if docker container inspect "$container_name" >/dev/null 2>&1; then
 echo 'Refusing existing proof container' >&2; exit 1
fi
container_created=true
preflight
docker run --detach --name "$container_name" --network none --env POSTGRES_PASSWORD=postgres \
 --mount "type=bind,source=$repo_root/supabase,target=/workspace/supabase,readonly" "$postgres_image" >/dev/null
printf 'Pinned PostgreSQL image: %s\nOwned proof: %s network=none\n' "$postgres_image" "$container_name"
ready=false
for attempt in {1..60}; do
 preflight
 if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then ready=true; break; fi
 sleep 1
done
[[ "$ready" == true ]] || { echo 'Owned database failed to start' >&2; exit 1; }
preflight
docker exec "$container_name" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
 -c 'CREATE DATABASE evo_form_registry_proof TEMPLATE template0;'
preflight
docker exec --env PGPASSWORD=postgres "$container_name" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d evo_form_registry_proof \
 -c 'GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;'
psql_proof() {
 preflight
 docker exec --env PGOPTIONS='-c client_min_messages=warning' "$container_name" \
  psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d evo_form_registry_proof "$@"
}
psql_proof -f /workspace/supabase/tests/bootstrap_supabase.sql >/dev/null
last=0
while IFS= read -r migration; do
 filename="${migration##*/}"
 number="${filename%%_*}"
 [[ "$number" =~ ^[0-9]{3}$ ]] || { echo 'Unexpected migration filename' >&2; exit 1; }
 # The integrated ingress proof requires the complete current baseline.
 if (( 10#$number > 165 )); then continue; fi
 [[ $((10#$number)) -eq $((last+1)) ]] || { echo 'Noncontiguous migration baseline' >&2; exit 1; }
 stage="$migration"
 psql_proof -f "/workspace/$migration" >/dev/null
 last=$((10#$number))
done < <(rg --files supabase/migrations | LC_ALL=C sort)
[[ "$last" -eq 165 ]] || { echo 'Missing165 baseline' >&2; exit 1; }
stage='synthetic registry command behavior'
psql_proof -f /workspace/supabase/tests/university_form_registry.sql
stage='migration166 ingress and passive PDF semantics'
psql_proof -f /workspace/supabase/migrations/166_platform_university_form_ingress.sql >/dev/null
stage='synthetic ingress command behavior'
psql_proof -f /workspace/supabase/tests/university_form_ingress.sql
echo 'UNIVERSITY_FORM_INGRESS_SQL_VERIFIED_CONTIGUOUS_001_166'
