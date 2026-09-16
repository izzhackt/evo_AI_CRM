#!/usr/bin/env bash
# Real PostgreSQL schema/privilege check only. No fictional users or leads.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
[[ $# -eq 0 ]] || exit 2
preflight() {
  if [[ "$(uname -s)" == Darwin ]]; then
    [[ "$(orb status)" == Running && "$(docker context show)" == orbstack ]] || {
      echo 'Running OrbStack context is required' >&2; exit 1;
    }
  fi
}
preflight
image='public.ecr.aws/supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453'
docker image inspect "$image" >/dev/null
container="evo-website-schema-${RANDOM}-$$"
created=false
cleanup() {
  result=$?
  if [[ "$created" == true ]]; then
    preflight
    docker rm --force --volumes "$container" >/dev/null || result=1
    echo "Removed owned schema-check container: $container"
  fi
  exit "$result"
}
trap cleanup EXIT
if docker container inspect "$container" >/dev/null 2>&1; then exit 1; fi
docker run --detach --name "$container" --network none --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,source=$repo_root/supabase,target=/workspace/supabase,readonly" "$image" >/dev/null
created=true
for attempt in {1..45}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -c 'CREATE DATABASE evo_website_schema TEMPLATE template0;'
docker exec --env PGPASSWORD=postgres "$container" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d evo_website_schema \
  -c 'GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;'
psql_schema() {
  preflight
  docker exec --env PGOPTIONS='-c client_min_messages=warning' "$container" \
    psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d evo_website_schema "$@"
}
psql_schema -f /workspace/supabase/tests/bootstrap_supabase.sql >/dev/null
last=0
while IFS= read -r migration; do
  filename="${migration##*/}"
  number="${filename%%_*}"
  [[ "$number" =~ ^[0-9]{3}$ && $((10#$number)) -eq $((last+1)) ]] || exit 1
  psql_schema -f "/workspace/$migration" >/dev/null
  last=$((10#$number))
done < <(rg --files --no-ignore supabase/migrations | LC_ALL=C sort)
[[ "$last" -eq 170 ]] || exit 1
psql_schema -c "DO \$\$ BEGIN
  IF NOT has_function_privilege('service_role','platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text)','EXECUTE')
    OR has_function_privilege('anon','platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text)','EXECUTE')
    OR has_function_privilege('authenticated','platform.receive_website_lead(uuid,uuid,uuid,text,text,integer,text,text,boolean,text)','EXECUTE')
    OR has_function_privilege('service_role','platform.read_lead_website_submissions(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','platform.read_lead_website_submissions(uuid,uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'Website intake grants mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM platform.clients) OR EXISTS(SELECT 1 FROM platform.leads)
  THEN RAISE EXCEPTION 'Unexpected customer data in schema-only proof'; END IF;
END \$\$;"
echo 'WEBSITE_INTAKE_SCHEMA_001_170_AND_GRANTS_VERIFIED_NO_CUSTOMER_INPUT'
