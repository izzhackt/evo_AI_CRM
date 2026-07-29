#!/usr/bin/env bash
set -euo pipefail

docker_bin="${DOCKER_BIN:-docker}"
postgres_version="17.6.1.143"
postgres_index_digest="sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453"

if ! command -v "$docker_bin" >/dev/null 2>&1; then
  echo "Docker command is unavailable: $docker_bin" >&2
  exit 1
fi

if [[ "${POSTGRES_TEST_IMAGE+x}" == "x" ]]; then
  if [[ -z "$POSTGRES_TEST_IMAGE" ]]; then
    echo "POSTGRES_TEST_IMAGE must not be empty when provided" >&2
    exit 1
  fi
  candidates=("$POSTGRES_TEST_IMAGE")
else
  # Supabase publishes the same multi-architecture index to all three official
  # registries. Keep the content immutable while allowing bounded fallback when
  # one public registry throttles a shared CI runner.
  candidates=(
    "public.ecr.aws/supabase/postgres@${postgres_index_digest}"
    "ghcr.io/supabase/postgres@${postgres_index_digest}"
    "supabase/postgres@${postgres_index_digest}"
  )
fi

for candidate in "${candidates[@]}"; do
  if "$docker_bin" image inspect "$candidate" >/dev/null 2>&1; then
    printf '%s\n' "$candidate"
    exit 0
  fi

  echo "Pulling pinned Supabase Postgres test image: $candidate" >&2
  if "$docker_bin" pull "$candidate" >&2; then
    printf '%s\n' "$candidate"
    exit 0
  fi

  echo "Registry candidate unavailable; trying the next pinned mirror" >&2
done

echo \
  "Unable to pull pinned Supabase Postgres ${postgres_version} from any approved registry" \
  >&2
exit 1
