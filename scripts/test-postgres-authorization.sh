#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="evo-platform-authz-$RANDOM-$$"
postgres_image="${POSTGRES_TEST_IMAGE:-pgvector/pgvector:pg15}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
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

while IFS= read -r migration; do
  docker exec "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
    -f "/workspace/$migration"
done < <(
  cd "$repo_root"
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort
)

# Exercise the retained 038/039 hardening migrations after 040, then rerun 040.
# This catches both legacy regressions and an interrupted-deploy retry.
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/migrations/038_authorization_containment.sql
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/migrations/039_private_inbox_media.sql
docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/migrations/040_platform_namespaces_and_secret_containment.sql

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/tests/authorization_policies.sql

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/tests/platform_grants.sql

docker exec "$container_name" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -f /workspace/supabase/tests/authorization_inventory.sql
