#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
document_exports=false
if [[ "${1:-}" == --document-exports && $# -eq 1 ]]; then
  document_exports=true
elif [[ $# -ne 0 ]]; then
  echo 'Usage: test-student-profile-fields-postgres.sh [--document-exports]' >&2
  exit 1
fi
if [[ "$(uname -s)" == Darwin ]]; then
  [[ "$(orb status)" == Running && "$(docker context show)" == orbstack ]] || {
    echo 'Student Profile SQL proof requires running OrbStack context' >&2
    exit 1
  }
fi

postgres_image="$(bash scripts/resolve-postgres-test-image.sh)"
container_name="evo-profile-fields-proof-${RANDOM}-$$"
container_id=''
container_created=false
stage='start isolated PostgreSQL'
cleanup() {
  local result=$?
  if [[ "$container_created" == true ]]; then
    if docker rm --force --volumes "$container_name" >/dev/null; then
      printf 'Removed owned proof container: %s\n' "$container_name"
    else
      echo "Failed to remove owned proof container: $container_name" >&2
      result=1
    fi
  fi
  if [[ "$result" -ne 0 ]]; then printf 'Student Profile SQL proof failed at: %s\n' "$stage" >&2; fi
  exit "$result"
}
trap cleanup EXIT

if docker container inspect "$container_name" >/dev/null 2>&1; then
  echo 'Refusing an existing proof container name' >&2
  exit 1
fi
# A lost daemon reply must not skip cleanup of this exact owned target.
container_created=true
container_id="$(docker run --detach --name "$container_name" --network none \
  --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,source=$repo_root/supabase,target=/workspace/supabase,readonly" \
  "$postgres_image")"
printf 'Pinned PostgreSQL image: %s\n' "$postgres_image"
docker inspect --format 'Owned proof: {{.Name}} network={{.HostConfig.NetworkMode}} ports={{json .HostConfig.PortBindings}}' "$container_id"
ready=false
for attempt in {1..60}; do
  if docker exec "$container_id" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Disposable PostgreSQL did not start' >&2; exit 1; }

stage='bootstrap clean proof database'
docker exec "$container_id" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -c 'CREATE DATABASE evo_profile_fields_proof TEMPLATE template0;'
docker exec --env PGPASSWORD=postgres "$container_id" psql -X -q -v ON_ERROR_STOP=1 \
  -h 127.0.0.1 -U supabase_admin -d evo_profile_fields_proof \
  -c 'GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;'
psql_proof() {
  docker exec --env PGOPTIONS='-c client_min_messages=warning' "$container_id" \
    psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d evo_profile_fields_proof "$@"
}
psql_proof -f /workspace/supabase/tests/bootstrap_supabase.sql >/dev/null

last_migration=0
while IFS= read -r migration; do
  filename="${migration##*/}"
  number="${filename%%_*}"
  [[ "$number" =~ ^[0-9]{3}$ ]] || { echo "Unexpected migration filename: $filename" >&2; exit 1; }
  if (( 10#$number > 158 )); then continue; fi
  stage="$migration"
  psql_proof -f "/workspace/$migration" >/dev/null
  last_migration=$((10#$number))
done < <(rg --files supabase/migrations | LC_ALL=C sort)
[[ "$last_migration" -eq 158 ]] || { echo 'Expected migration158 baseline is missing' >&2; exit 1; }
echo 'STUDENT_PROFILE_FIELDS_BASELINE_158_APPLIED'

# The positive SQL fixture captures a real pre-migration row, applies only
# 159/160, then exercises the intended authenticated staff command/read seam.
stage='positive Student Profile migration159/160 command proof'
psql_proof -f /workspace/supabase/tests/student_profile_fields_positive.sql
stage='positive Student Profile export migration161 and audit proof'
psql_proof -f /workspace/supabase/migrations/161_platform_student_profile_exports.sql
psql_proof -f /workspace/supabase/tests/student_profile_exports_positive.sql
if [[ "$document_exports" == true ]]; then
  # D4 behavioral proof on the known 001–161 baseline, not a claim that the
  # unmerged D3 162–163 sequence has been applied or validated for release.
  stage='D4 migration164 isolated artifact behavior'
  psql_proof -f /workspace/supabase/migrations/164_platform_document_export_artifacts.sql
  psql_proof -f /workspace/supabase/tests/platform_document_export_artifacts.sql
  echo 'DOCUMENT_EXPORT_ARTIFACTS_SQL_BEHAVIOR_VERIFIED'
fi
echo 'STUDENT_PROFILE_FIELDS_POSTGRES_VERIFIED'
