#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="evo-platform-authz-$RANDOM-$$"
postgres_image="${POSTGRES_TEST_IMAGE:-pgvector/pgvector:pg15}"
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

for _ in $(seq 1 60); do
  if docker exec "$container_name" \
    pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$container_name" \
  pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/tests/bootstrap_supabase.sql

# Prove migration 040 fails closed instead of adopting a browser-owned object
# from a pre-existing namespace. The ordinary migration loop then proves that
# empty owner drift is safely normalized and remains idempotent.
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -c "SET ROLE authenticated; CREATE TABLE platform.p2b_untrusted_owner_probe (id integer); RESET ROLE;"

if docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
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
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -c "DROP TABLE platform.p2b_untrusted_owner_probe;"

while IFS= read -r migration; do
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
    -f "/workspace/$migration"

  # Preserve the P2B namespace/grant acceptance test at its exact migration
  # boundary. Later Platform migrations intentionally add relations, so this
  # proof must run immediately after 040 rather than against the final schema.
  if [[ "$(basename "$migration")" == 040_* ]]; then
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
      -f /workspace/supabase/tests/platform_grants.sql

    # Exercise the retained 038/039 hardening migrations and an interrupted
    # 040 deploy retry while 040 is still the schema tip. Re-running 040 after
    # P2C would incorrectly restore P2B's temporary broad service_role defaults.
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
      -f /workspace/supabase/migrations/038_authorization_containment.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
      -f /workspace/supabase/migrations/039_private_inbox_media.sql
    docker exec "$container_name" \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
      -f /workspace/supabase/migrations/040_platform_namespaces_and_secret_containment.sql
  fi
done < <(
  cd "$repo_root"
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort
)

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/tests/authorization_policies.sql

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/tests/authorization_inventory.sql

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/tests/platform_identity_rbac.sql
