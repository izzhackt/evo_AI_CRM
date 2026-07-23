#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="evo-inbox-authz-$RANDOM-$$"
postgres_image="${POSTGRES_TEST_IMAGE:-pgvector/pgvector:pg15}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run \
  --detach \
  --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,src=$repo_dir,dst=/workspace,readonly" \
  "$postgres_image" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f /workspace/supabase/tests/bootstrap_supabase.sql

while IFS= read -r migration; do
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -f "/workspace/$migration"
done < <(
  cd "$repo_dir"
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort
)

# The production migration process may safely retry a migration after an
# interrupted deploy. Exercise the hardening migration twice before assertions.
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f /workspace/supabase/migrations/038_authorization_containment.sql

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f /workspace/supabase/tests/authorization_policies.sql

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f /workspace/supabase/tests/authorization_inventory.sql
