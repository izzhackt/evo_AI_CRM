#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Bounded SQL-only proof. Reuse the existing pinned Supabase PostgreSQL
# foundation; do not start Auth, a browser, a scanner, or any provider.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
node_bin="${EVO_NODE_BIN:-node}"
with_document_exports=0
with_university_form_exports=0
if [[ "$#" -eq 1 && "$1" == --document-exports ]]; then
  with_document_exports=1
elif [[ "$#" -eq 1 && "$1" == --university-form-exports ]]; then
  with_document_exports=1
  with_university_form_exports=1
elif [[ "$#" -ne 0 ]]; then
  echo 'Usage: test-document-recognition-postgres.sh [--document-exports|--university-form-exports]' >&2; exit 1
fi
[[ "$("$node_bin" --version)" == v22.* ]] || { echo 'Node 22 is required' >&2; exit 1; }

# Reject gaps, duplicate prefixes and unexpected files before creating resources.
# All domain fixtures use this complete schema, never a selected migration slice.
migrations=()
next_migration=1
while IFS= read -r migration; do
  migration_name="${migration##*/}"
  if [[ ! "$migration_name" =~ ^([0-9]{3})_.+\.sql$ ]]; then
    echo "Invalid foundation migration filename: $migration_name" >&2; exit 1
  fi
  if [[ "$((10#${BASH_REMATCH[1]}))" -ne "$next_migration" ]]; then
    echo "Non-contiguous foundation at $migration_name; expected $next_migration" >&2; exit 1
  fi
  migrations+=("$migration")
  next_migration=$((next_migration + 1))
done < <(rg --files supabase/migrations | LC_ALL=C sort)
minimum_migrations=163
[[ "$with_document_exports" == 0 ]] || minimum_migrations=169
[[ "${#migrations[@]}" -ge "$minimum_migrations" ]] || {
  echo "Foundation requires at least migrations 001-$minimum_migrations" >&2; exit 1;
}
if [[ "$(uname -s)" == Darwin ]]; then
  [[ "$(orb status)" == Running && "$(docker context show)" == orbstack ]] || {
    echo 'Document recognition SQL proof requires running OrbStack context' >&2; exit 1;
  }
fi

postgres_image="$(bash scripts/resolve-postgres-test-image.sh)"
container_name="evo-document-recognition-proof-${RANDOM}-$$"
test_database='evo_document_recognition_proof'
proof_log="$(mktemp -t evo-document-recognition-proof.XXXXXX)"
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
# The daemon may create the owned container before a timeout loses its reply.
# Cleanup responsibility starts before dispatch, not after a successful reply.
container_created=1
"$node_bin" "$deadline_runner" 120000 docker run --detach --name "$container_name" \
  --network none --memory 1g --cpus 1 --pids-limit 128 --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,source=$repo_root,target=/workspace,readonly" "$postgres_image" >/dev/null
echo "DOCUMENT_RECOGNITION_PROOF_CONTAINER $container_name"
ready=0
for attempt in {1..120}; do
  if "$node_bin" "$deadline_runner" 10000 docker exec "$container_name" \
    pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Disposable PostgreSQL did not start' >&2; exit 1; }
docker inspect --format 'DOCUMENT_RECOGNITION_PROOF_IMAGE {{.Image}}' "$container_name"

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
# Compare the actual installed definitions, not a hand-copied approximation.
# The same ACL assertion must fail at167 and pass at168 in this one database.
legacy_definitions_sql="SELECT string_agg(pg_get_functiondef(signature::REGPROCEDURE),E'\n' ORDER BY signature)
 FROM (VALUES
 ('platform.begin_student_profile_export(uuid,uuid,uuid,uuid,bigint,text,text,uuid)'),
 ('platform.complete_student_profile_export(uuid,text,text,integer,text)')) AS legacy(signature);"
legacy_service_acl_sql="DO \$\$ BEGIN
 IF NOT has_function_privilege('service_role','platform.begin_student_profile_export(uuid,uuid,uuid,uuid,bigint,text,text,uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','platform.complete_student_profile_export(uuid,text,text,integer,text)','EXECUTE') THEN
 RAISE EXCEPTION 'Rollback compatibility service EXECUTE missing';
 END IF; END \$\$;"
legacy_definitions_161=''
migration_count=0
for migration in "${migrations[@]}"; do
  if [[ "$with_document_exports" == 1 && "${migration##*/}" == 168_* ]]; then
    if legacy_acl_red="$(run_sql -c "$legacy_service_acl_sql" 2>&1)"; then
      echo 'Expected the compatibility ACL regression to fail before168' >&2; exit 1
    fi
    [[ "$legacy_acl_red" == *'ERROR:  Rollback compatibility service EXECUTE missing'* ]] || {
      printf '%s\n' "$legacy_acl_red" >&2; exit 1;
    }
    echo 'STUDENT_PROFILE_EXPORT_COMPATIBILITY_RED_BEFORE168'
  fi
  if ! run_sql -f "/workspace/$migration" >>"$proof_log" 2>&1; then
    echo "Foundation migration failed: $(basename "$migration")" >&2
    tail -20 "$proof_log" >&2
    exit 1
  fi
  migration_count=$((migration_count + 1))
  if [[ "$with_document_exports" == 1 && "${migration##*/}" == 161_* ]]; then
    legacy_definitions_161="$(run_sql -At -c "$legacy_definitions_sql")"
    [[ -n "$legacy_definitions_161" ]] || { echo 'Missing161 function definitions' >&2; exit 1; }
  elif [[ "$with_document_exports" == 1 && "${migration##*/}" == 168_* ]]; then
    run_sql -c "$legacy_service_acl_sql"
    legacy_definitions_168="$(run_sql -At -c "$legacy_definitions_sql")"
    [[ "$legacy_definitions_168" == "$legacy_definitions_161" ]] || {
      echo 'Rollback compatibility changed161 function definitions' >&2; exit 1;
    }
    echo 'STUDENT_PROFILE_EXPORT_COMPATIBILITY_GREEN_AFTER168_DEFINITIONS_UNCHANGED'
  fi
done
echo "DOCUMENT_RECOGNITION_PROOF_MIGRATIONS $migration_count"
# SQL exercises authenticated public RPCs and rolls back its synthetic fixtures.
# Any assertion/error remains a nonzero exit; no synthetic success receipt.
run_sql -f /workspace/supabase/tests/document_recognition_queue_positive.sql
echo 'DOCUMENT_RECOGNITION_QUEUE_POSTGRES_VERIFIED'
if [[ "$with_document_exports" == 1 ]]; then
  # Synthetic source/scanner/Storage metadata tests SQL authority and transitions;
  # this is not an Auth, private-byte upload/download, or browser acceptance.
  run_sql -f /workspace/supabase/tests/platform_document_export_artifacts.sql
  echo 'DOCUMENT_EXPORT_ARTIFACTS_POSTGRES_VERIFIED'
fi
if [[ "$with_university_form_exports" == 1 ]]; then
  run_sql -f /workspace/supabase/tests/platform_university_form_exports.sql
  echo 'UNIVERSITY_FORM_EXPORTS_POSTGRES_VERIFIED'
  run_sql -f /workspace/supabase/tests/platform_document_packages.sql
  echo 'DOCUMENT_PACKAGES_POSTGRES_VERIFIED'
fi
