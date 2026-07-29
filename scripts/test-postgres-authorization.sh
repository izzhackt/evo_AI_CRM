#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="evo-platform-authz-$RANDOM-$$"
postgres_image="$("$repo_root/scripts/resolve-postgres-test-image.sh")"
test_database="evo_platform_authorization"
p2b_drift_log="$(mktemp -t evo-p2b-owner-drift.XXXXXX)"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f -- "$p2b_drift_log"
}
trap cleanup EXIT

docker run \
  --detach \
  --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,src=$repo_root,dst=/workspace,readonly" \
  "$postgres_image" >/dev/null

health_status=""
for _ in $(seq 1 60); do
  health_status="$(
    docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
      "$container_name"
  )"
  [[ "$health_status" == "healthy" ]] && break
  sleep 1
done

if [[ "$health_status" != "healthy" ]]; then
  echo "Pinned Supabase Postgres container did not become healthy" >&2
  exit 1
fi

docker exec "$container_name" \
  pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null
postgres_image_id="$(
  docker inspect --format '{{.Image}}' "$container_name"
)"
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "postgres" \
  -c "CREATE DATABASE ${test_database} TEMPLATE template0;"
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -c "COMMENT ON DATABASE ${test_database} IS 'EVO disposable authorization and queue contract test';"
docker exec \
  --env PGPASSWORD=postgres \
  "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "$test_database" \
  -c "GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;"
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -f /workspace/supabase/tests/bootstrap_supabase.sql

# Prove migration 040 fails closed instead of adopting a browser-owned object
# from a pre-existing namespace. The ordinary migration loop then proves that
# empty owner drift is safely normalized and remains idempotent.
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -c "SET ROLE authenticated; CREATE TABLE platform.p2b_untrusted_owner_probe (id integer); RESET ROLE;"

if docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -f /workspace/supabase/migrations/040_platform_namespaces_and_secret_containment.sql \
  >"$p2b_drift_log" 2>&1; then
  echo "migration 040 unexpectedly adopted a browser-owned schema object" >&2
  exit 1
fi

if ! grep -Fq \
  "Platform schema owner drift contains non-postgres objects" \
  "$p2b_drift_log"; then
  echo "migration 040 failed for the wrong owner-drift reason" >&2
  sed -n '1,80p' "$p2b_drift_log" >&2
  exit 1
fi

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -c "DROP TABLE platform.p2b_untrusted_owner_probe;"

while IFS= read -r migration; do
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
    -f "/workspace/$migration"

  # Preserve the P2B namespace/grant acceptance test at its exact migration
  # boundary. Later Platform migrations intentionally add relations, so this
  # proof must run immediately after 040 rather than against the final schema.
  if [[ "$(basename "$migration")" == 040_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_grants.sql

    # Exercise the retained 038/039 hardening migrations and an interrupted
    # 040 deploy retry while 040 is still the schema tip. Re-running 040 after
    # P2C would incorrectly restore P2B's temporary broad service_role defaults.
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/migrations/038_authorization_containment.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/migrations/039_private_inbox_media.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/migrations/040_platform_namespaces_and_secret_containment.sql
  fi

  # P2C owns an exact ten-table identity/RBAC boundary. Run that acceptance
  # suite at migration 041 before later Platform domain tables are added. The
  # synthetic live memberships it leaves behind also prove that 042 upgrades
  # existing active, inactive and blocked authority rather than only clean
  # databases.
  if [[ "$(basename "$migration")" == 041_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_identity_rbac.sql
  fi

  # P2D owns the exact migration-042 admissions catalog and leaves behind the
  # two-organization/two-student fixtures that P2E must upgrade from immutable
  # v2 bundles. Preserve both admissions suites at that boundary before 043
  # intentionally adds new Platform relations and v3 permissions.
  if [[ "$(basename "$migration")" == 042_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_admissions_rls.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_inventory.sql
  fi

  # P2E owns the exact migration-043 documents/finance/notifications boundary
  # and leaves the two-organization/two-student fixtures plus immutable v3
  # memberships that P2F must upgrade. Run both suites before migration 044.
  if [[ "$(basename "$migration")" == 043_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_documents_finance_notifications_rls.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_documents_finance_notifications_inventory.sql
  fi

  # P2F owns the exact migration-044 communications/provider/draft-only AI
  # boundary. Run its stateful RLS suite and catalog inventory at that boundary
  # so a later migration cannot accidentally satisfy or mask a missing 044
  # contract.
  if [[ "$(basename "$migration")" == 044_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_communications_rls.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_communications_inventory.sql
  fi

  # P2G owns the exact migration-045 PGMQ, durable-work and manual-review
  # boundary. The SQL suites prove catalog/RLS behavior against the fixtures
  # carried forward from P2F before the separate-session runtime gate runs.
  if [[ "$(basename "$migration")" == 045_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_queues_rls.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
      -f /workspace/supabase/tests/platform_queues_inventory.sql
    bash "$repo_root/scripts/test-p2g-queues-runtime.sh" \
      "$container_name" \
      "$test_database"
  fi
done < <(
  cd "$repo_root"
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort
)

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -f /workspace/supabase/tests/authorization_policies.sql

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" \
  -f /workspace/supabase/tests/authorization_inventory.sql

printf 'Verified disposable authorization database with %s (%s).\n' \
  "$postgres_image" \
  "${postgres_image_id:0:19}"
