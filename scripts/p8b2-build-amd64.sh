#!/usr/bin/env bash
set -euo pipefail

required=(
  EVO_P8_SOURCE_ROOT
  EVO_P8_BASE_COMMIT
  EVO_RELEASE_REVISION
  EVO_P8_RELEASE_CONTROL_COMMIT
  EVO_RELEASE_VERSION
  EVO_IMAGE_SOURCE
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  NEXT_PUBLIC_SITE_URL
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required setting: ${name}" >&2
    exit 2
  fi
done

if [[ "$(orb status)" != "Running" ]]; then
  echo "OrbStack must be Running" >&2
  exit 2
fi
if [[ "$(docker context show)" != "orbstack" ]]; then
  echo "Docker context must be exactly orbstack" >&2
  exit 2
fi

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source_root="$(cd "$EVO_P8_SOURCE_ROOT" && pwd -P)"
if [[ "$(git -C "$tool_root" rev-parse HEAD)" != "$EVO_P8_RELEASE_CONTROL_COMMIT" ]]; then
  echo "release-control commit does not match tool HEAD" >&2
  exit 2
fi
if [[ -n "$(git -C "$tool_root" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "release-control checkout must be clean" >&2
  exit 2
fi
if [[ "$(git -C "$source_root" rev-parse HEAD)" != "$EVO_RELEASE_REVISION" ]]; then
  echo "application source commit does not match source HEAD" >&2
  exit 2
fi
if [[ "$(git -C "$source_root" rev-parse "${EVO_RELEASE_REVISION}^")" != "$EVO_P8_BASE_COMMIT" ]]; then
  echo "application base is not the source commit's exact parent" >&2
  exit 2
fi
if [[ -n "$(git -C "$source_root" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "application source checkout must be clean" >&2
  exit 2
fi

evidence_dir="$source_root/.evo-release-evidence/p8b2-input-$EVO_RELEASE_REVISION-linux-amd64"
mkdir -p "$source_root/.evo-release-evidence" "$evidence_dir"
chmod 0700 "$source_root/.evo-release-evidence" "$evidence_dir"

crm_tag="evo-crm:$EVO_RELEASE_REVISION-linux-amd64"
inbox_tag="evo-inbox:$EVO_RELEASE_REVISION-linux-amd64"
lead_tag="evo-lead-agent:$EVO_RELEASE_REVISION-linux-amd64"
for tag in "$crm_tag" "$inbox_tag" "$lead_tag"; do
  if docker image inspect "$tag" >/dev/null 2>&1; then
    echo "target image tag already exists; refusing stale-image reuse: $tag" >&2
    exit 2
  fi
done

run_build() {
  local name="$1"
  local tag="$2"
  shift 2
  local log="$evidence_dir/build-$name.log"
  printf 'base_commit=%s\ncandidate_commit=%s\nrelease_control_commit=%s\nplatform=linux/amd64\n' \
    "$EVO_P8_BASE_COMMIT" "$EVO_RELEASE_REVISION" "$EVO_P8_RELEASE_CONTROL_COMMIT" >"$log"
  set +e
  docker buildx build --platform linux/amd64 --load --tag "$tag" "$@" >>"$log" 2>&1
  local status=$?
  set -e
  printf 'exit_code=%s\n' "$status" >>"$log"
  chmod 0600 "$log"
  if [[ "$status" -ne 0 ]]; then
    echo "build failed for $name" >&2
    exit "$status"
  fi
  printf 'Image %s Built\n' "$tag" >>"$log"
}

run_build crm "$crm_tag" \
  --build-arg "EVO_IMAGE_SOURCE=$EVO_IMAGE_SOURCE" \
  --build-arg "EVO_IMAGE_REVISION=$EVO_RELEASE_REVISION" \
  --build-arg "EVO_IMAGE_VERSION=$EVO_RELEASE_VERSION" \
  "$source_root"

run_build inbox "$inbox_tag" \
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg "NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL" \
  --build-arg "EVO_IMAGE_SOURCE=$EVO_IMAGE_SOURCE" \
  --build-arg "EVO_IMAGE_REVISION=$EVO_RELEASE_REVISION" \
  --build-arg "EVO_IMAGE_VERSION=$EVO_RELEASE_VERSION" \
  "$source_root/agent-lead2-inbox"

run_build lead-agent "$lead_tag" \
  --build-arg "EVO_IMAGE_SOURCE=$EVO_IMAGE_SOURCE" \
  --build-arg "EVO_IMAGE_REVISION=$EVO_RELEASE_REVISION" \
  --build-arg "EVO_IMAGE_VERSION=$EVO_RELEASE_VERSION" \
  "$source_root/evo-lead-agent"

printf '%s\n' "$evidence_dir"
