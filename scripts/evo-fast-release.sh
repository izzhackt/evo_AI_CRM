#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly SHA40_RE='^[0-9a-f]{40}$'
readonly SHA256_RE='^sha256:[0-9a-f]{64}$'
readonly HASH64_RE='^[0-9a-f]{64}$'
readonly IMAGE_CONFIG_PATH_RE='^(blobs/sha256/[0-9a-f]{64}|[0-9a-f]{64}\.json)$'
readonly IMAGE_LAYER_PATH_RE='^(blobs/sha256/[0-9a-f]{64}|[0-9a-f]{64}/layer\.tar)$'
readonly VERSION_RE='^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
readonly SAFE_NAME_RE='^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
readonly REPOSITORY_RE='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
readonly POSITIVE_INT_RE='^[1-9][0-9]*$'
readonly PROJECT_NAME_RE='^[a-z0-9][a-z0-9_-]{0,99}$'
readonly SUPABASE_PROJECT_REF_RE='^[a-z0-9]{20}$'
readonly ABSOLUTE_PATH_RE='^/[A-Za-z0-9._/-]+$'
readonly HEALTH_URL_RE='^(https://[A-Za-z0-9.-]+(:[0-9]{1,5})?|http://127\.0\.0\.1:[0-9]{1,5})/api/health$'

command_name=${1:-}
candidate_expected_image_id=''
current_app_container_id=''
rollback_previous_image=''
rollback_previous_revision=''
rollback_previous_version=''
rollback_previous_compose=''
rollback_compose_sha256=''
rollback_app_env_sha256=''
rollback_app_env_snapshot=''
rollback_previous_generation=''
rollback_previous_release_id=''
rollback_previous_pointer=''
rollback_previous_pointer_sha256=''
candidate_app_env_snapshot=''
candidate_app_env_sha256=''
candidate_compose_file=''
release_evidence_dir=''
rollback_controller_sha256=''
rollback_wrapper_sha256=''
bound_candidate_container_id=''
release_mutation_armed=false
release_mutation_state=''
release_mutation_evidence_dir=''

fail() {
  local code=$1
  printf '{"ok":false,"code":"%s"}\n' "$code" >&2
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing_runtime_dependency"
}

require_variable() {
  [[ -n ${!1-} ]] || fail "configuration_missing"
}

require_match() {
  local value=$1
  local pattern=$2
  local code=$3
  [[ $value =~ $pattern ]] || fail "$code"
}

require_file() {
  [[ -f $1 && ! -L $1 ]] || fail "$2"
}

require_absolute_path() {
  require_match "$1" "$ABSOLUTE_PATH_RE" "$2"
  [[ $1 != / && $1 != *//* && $1 != */../* && $1 != */.. && $1 != */./* && $1 != */. ]] \
    || fail "$2"
}

count_nonempty_lines() {
  awk 'NF { count += 1 } END { print count + 0 }'
}

canonical_path() {
  realpath "$1"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

acquire_release_lock() {
  require_command flock
  local lock_file=$EVO_RELEASE_ROOT/.evo-fast-release.lock
  [[ -d $EVO_RELEASE_ROOT && ! -L $EVO_RELEASE_ROOT ]] || fail "release_root_invalid"
  [[ ! -L $lock_file ]] || fail "release_lock_invalid"
  exec 9>"$lock_file" || fail "release_lock_open_failed"
  flock --nonblock 9 || fail "release_lock_busy"
}

service_container_id() {
  local service=$1
  require_match "$service" "$PROJECT_NAME_RE" "runtime_service_name_invalid"
  local ids
  ids=$(docker ps -aq \
    --filter "label=com.docker.compose.project=${EVO_RELEASE_PROJECT_NAME}" \
    --filter "label=com.docker.compose.service=${service}")
  [[ $(printf '%s\n' "$ids" | count_nonempty_lines) -eq 1 ]] || return 1
  printf '%s\n' "$ids"
}

app_container_id() {
  service_container_id app
}

container_health() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1"
}

container_label() {
  docker inspect --format "{{index .Config.Labels \"$2\"}}" "$1"
}

safe_status() {
  require_command docker
  require_command jq
  require_variable EVO_RELEASE_PROJECT_NAME
  require_match "$EVO_RELEASE_PROJECT_NAME" "$PROJECT_NAME_RE" "project_name_invalid"
  verify_current_runtime
  local container image health restarts revision version
  container=$(app_container_id) || fail "app_container_unavailable"
  image=$(docker inspect --format '{{.Image}}' "$container")
  health=$(container_health "$container")
  restarts=$(docker inspect --format '{{.RestartCount}}' "$container")
  revision=$(container_label "$container" 'org.opencontainers.image.revision')
  version=$(container_label "$container" 'org.opencontainers.image.version')
  require_match "$image" "$SHA256_RE" "current_image_invalid"
  require_match "$revision" "$SHA40_RE" "current_revision_invalid"
  require_match "$version" "$VERSION_RE" "current_version_invalid"
  [[ $health == healthy && $restarts == 0 ]] || fail "current_app_unhealthy"
  jq -cn \
    --arg image "$image" \
    --arg revision "$revision" \
    --arg version "$version" \
    '{ok:true,command:"status",health:"healthy",restarts:0,image:$image,revision:$revision,version:$version}'
}

load_configuration() {
  local variable
  for variable in \
    EVO_RELEASE_ROOT \
    EVO_RELEASE_PROJECT_NAME \
    EVO_RELEASE_TRANSFER_ROOT \
    EVO_RELEASE_EVIDENCE_ROOT \
    EVO_RELEASE_COMPOSE_FILE \
    EVO_RELEASE_APP_ENV_FILE \
    EVO_RELEASE_EXTERNAL_HEALTH_URL \
    EVO_SUPABASE_PROJECT_REF \
    EVO_WAHA_IMAGE_DIGEST; do
    require_variable "$variable"
  done

  require_absolute_path "$EVO_RELEASE_ROOT" "release_root_invalid"
  require_match "$EVO_RELEASE_PROJECT_NAME" "$PROJECT_NAME_RE" "project_name_invalid"
  require_absolute_path "$EVO_RELEASE_TRANSFER_ROOT" "transfer_root_invalid"
  require_absolute_path "$EVO_RELEASE_EVIDENCE_ROOT" "evidence_root_invalid"
  require_absolute_path "$EVO_RELEASE_COMPOSE_FILE" "compose_path_invalid"
  require_absolute_path "$EVO_RELEASE_APP_ENV_FILE" "app_env_path_invalid"
  require_match "$EVO_RELEASE_EXTERNAL_HEALTH_URL" "$HEALTH_URL_RE" "health_url_invalid"
  require_match "$EVO_SUPABASE_PROJECT_REF" "$SUPABASE_PROJECT_REF_RE" "supabase_project_ref_invalid"
  require_match "$EVO_WAHA_IMAGE_DIGEST" "$SHA256_RE" "waha_digest_invalid"

  EVO_RELEASE_ACTIVE_COMPOSE_FILE=${EVO_RELEASE_ACTIVE_COMPOSE_FILE:-$EVO_RELEASE_COMPOSE_FILE}
  require_absolute_path "$EVO_RELEASE_ACTIVE_COMPOSE_FILE" "active_compose_path_invalid"
  if [[ -n ${EVO_RELEASE_ROLLBACK_SEED-} ]]; then
    require_absolute_path "$EVO_RELEASE_ROLLBACK_SEED" "rollback_seed_path_invalid"
  fi

  export EVO_CRM_WAHA_ENV_FILE=${EVO_CRM_WAHA_ENV_FILE:-$EVO_RELEASE_ROOT/.env.waha}
}

load_candidate_configuration() {
  local variable
  for variable in \
    EVO_RELEASE_REVISION \
    EVO_RELEASE_VERSION \
    EVO_RELEASE_ID \
    EVO_RELEASE_REPOSITORY \
    EVO_RELEASE_RUN_ID \
    EVO_RELEASE_WORKFLOW_RUN_ID \
    EVO_RELEASE_WORKFLOW_RUN_ATTEMPT \
    EVO_RELEASE_UPSTREAM_CI_RUN_ID \
    EVO_RELEASE_UPSTREAM_CI_RUN_ATTEMPT \
    EVO_RELEASE_ARTIFACT_ID \
    EVO_RELEASE_ARTIFACT_DIGEST \
    EVO_RELEASE_ARCHIVE \
    EVO_RELEASE_ARCHIVE_SHA256 \
    EVO_RELEASE_EXPECTED_IMAGE_ID \
    EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST \
    EVO_RELEASE_EXPECTED_COMPOSE_SHA256; do
    require_variable "$variable"
  done

  require_match "$EVO_RELEASE_REVISION" "$SHA40_RE" "target_revision_invalid"
  require_match "$EVO_RELEASE_VERSION" "$VERSION_RE" "target_version_invalid"
  require_match "$EVO_RELEASE_ID" "$SAFE_NAME_RE" "release_id_invalid"
  require_match "$EVO_RELEASE_REPOSITORY" "$REPOSITORY_RE" "repository_invalid"
  require_match "$EVO_RELEASE_RUN_ID" "$SAFE_NAME_RE" "run_id_invalid"
  require_match "$EVO_RELEASE_WORKFLOW_RUN_ID" "$POSITIVE_INT_RE" "workflow_run_id_invalid"
  require_match "$EVO_RELEASE_WORKFLOW_RUN_ATTEMPT" "$POSITIVE_INT_RE" "workflow_run_attempt_invalid"
  require_match "$EVO_RELEASE_UPSTREAM_CI_RUN_ID" "$POSITIVE_INT_RE" "upstream_ci_run_id_invalid"
  require_match "$EVO_RELEASE_UPSTREAM_CI_RUN_ATTEMPT" "$POSITIVE_INT_RE" "upstream_ci_run_attempt_invalid"
  require_match "$EVO_RELEASE_ARTIFACT_ID" "$POSITIVE_INT_RE" "artifact_id_invalid"
  require_match "$EVO_RELEASE_ARTIFACT_DIGEST" "$SHA256_RE" "artifact_digest_invalid"
  require_absolute_path "$EVO_RELEASE_ARCHIVE" "archive_path_invalid"
  require_match "$EVO_RELEASE_ARCHIVE_SHA256" "$HASH64_RE" "archive_hash_invalid"
  require_match "$EVO_RELEASE_EXPECTED_IMAGE_ID" "$SHA256_RE" "candidate_image_id_invalid"
  require_match "$EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST" "$SHA256_RE" "candidate_image_config_digest_invalid"
  require_match "$EVO_RELEASE_EXPECTED_COMPOSE_SHA256" "$HASH64_RE" "compose_hash_invalid"
  readonly candidate_expected_image_id="$EVO_RELEASE_EXPECTED_IMAGE_ID"

  local archive_real transfer_real
  require_file "$EVO_RELEASE_ARCHIVE" "archive_missing"
  archive_real=$(canonical_path "$EVO_RELEASE_ARCHIVE")
  transfer_real=$(canonical_path "$EVO_RELEASE_TRANSFER_ROOT")
  [[ $archive_real == "$transfer_real/"* ]] || fail "archive_outside_transfer"
}

require_app_env_snapshot() {
  local snapshot=$1 expected_hash=$2 code=${3:-app_env_snapshot_invalid}
  require_absolute_path "$snapshot" "$code"
  require_file "$snapshot" "$code"
  [[ $(file_mode "$snapshot") == 600 ]] || fail "$code"
  require_match "$expected_hash" "$HASH64_RE" "$code"
  local actual_hash
  actual_hash=$(sha256sum "$snapshot" | awk '{print $1}') || fail "$code"
  [[ $actual_hash == "$expected_hash" ]] || fail "$code"
}

compose_with_app_env() {
  local app_env_snapshot=$1 app_env_hash=$2 compose_file=$3
  shift 3
  require_app_env_snapshot "$app_env_snapshot" "$app_env_hash"
  EVO_CRM_APP_ENV_FILE="$app_env_snapshot" docker compose \
    --ansi never \
    --project-name "$EVO_RELEASE_PROJECT_NAME" \
    --file "$compose_file" \
    --env-file "$app_env_snapshot" \
    "$@"
}

compose() {
  compose_with_app_env \
    "$candidate_app_env_snapshot" \
    "$candidate_app_env_sha256" \
    "$candidate_compose_file" \
    "$@"
}

seal_app_env_snapshot() {
  local source=$1 destination=$2 output
  local script_dir validator
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  validator=$script_dir/evo-app-env-contract.mjs
  require_file "$validator" "app_env_validator_missing"
  output=$(node "$validator" \
    --seal-private-env "$source" \
    --snapshot "$destination") || fail "app_env_snapshot_seal_failed"
  jq -e 'type == "object" and keys == ["ok", "sha256"] and .ok == true and (.sha256 | test("^[0-9a-f]{64}$"))' \
    <<<"$output" >/dev/null 2>&1 || fail "app_env_snapshot_seal_failed"
  jq -er '.sha256' <<<"$output"
}

verify_env_contract() {
  local example_file=${EVO_RELEASE_ENV_EXAMPLE_FILE:-$EVO_RELEASE_ROOT/deploy/env.production.example}
  local script_dir validator
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  validator=$script_dir/evo-app-env-contract.mjs
  require_file "$example_file" "env_example_missing"
  require_app_env_snapshot "$candidate_app_env_snapshot" "$candidate_app_env_sha256"
  require_file "$validator" "app_env_validator_missing"
  local mode
  mode=$(file_mode "$candidate_app_env_snapshot")
  [[ $mode == 600 || $mode == 640 ]] || fail "app_env_permissions_invalid"
  node "$validator" \
    --example "$example_file" \
    --env "$candidate_app_env_snapshot" \
    --supabase-project-ref "$EVO_SUPABASE_PROJECT_REF" \
    --verify-supabase-keys \
    >/dev/null || fail "app_env_contract_invalid"
}

verify_current_runtime_identity() {
  local ids id service services
  ids=$(docker ps -aq \
    --filter "label=com.docker.compose.project=${EVO_RELEASE_PROJECT_NAME}")
  local service_count
  service_count=$(printf '%s\n' "$ids" | count_nonempty_lines)
  [[ $service_count -eq 1 || $service_count -eq 2 ]] || fail "runtime_service_contract_invalid"
  services=''
  while IFS= read -r id; do
    [[ -n $id ]] || continue
    service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$id")
    services+="${service}"$'\n'
  done <<<"$ids"
  services=$(printf '%s' "$services" | awk 'NF' | LC_ALL=C sort -u)
  [[ $services == waha || $services == $'app\nwaha' ]] || fail "runtime_service_contract_invalid"

  current_app_container_id=''
  if [[ $services == $'app\nwaha' ]]; then
    current_app_container_id=$(app_container_id) || fail "runtime_service_contract_invalid"
  fi
}

verify_current_runtime() {
  verify_current_runtime_identity
  local service id health restarts
  local -a runtime_services=(waha)
  if [[ -n $current_app_container_id ]]; then
    runtime_services=(app waha)
  fi
  for service in "${runtime_services[@]}"; do
    id=$(service_container_id "$service") || fail "runtime_service_contract_invalid"
    health=$(container_health "$id")
    restarts=$(docker inspect --format '{{.RestartCount}}' "$id")
    [[ $health == healthy && $restarts == 0 ]] || fail "runtime_service_unhealthy"
  done
}

verify_runtime_waha_image() {
  local id expected_image actual_image
  id=$(service_container_id waha) || fail "runtime_service_contract_invalid"
  expected_image=$(EVO_RELEASE_REVISION=$EVO_RELEASE_REVISION \
    EVO_RELEASE_VERSION=$EVO_RELEASE_VERSION \
    compose config --format json 2>/dev/null | jq -er '.services.waha.image') \
    || fail "compose_waha_image_invalid"
  actual_image=$(docker inspect --format '{{.Config.Image}}' "$id")
  [[ $actual_image == "$expected_image" ]] || fail "runtime_waha_image_drift"
}

verify_networks() {
  local service container networks expected_networks network
  local -a runtime_services=(waha)
  if [[ -n $current_app_container_id ]]; then
    runtime_services=(app waha)
  fi
  for service in "${runtime_services[@]}"; do
    container=$(service_container_id "$service") || fail "runtime_service_contract_invalid"
    networks=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$container")
    expected_networks=$(EVO_RELEASE_REVISION=$EVO_RELEASE_REVISION \
      EVO_RELEASE_VERSION=$EVO_RELEASE_VERSION \
      compose config --format json 2>/dev/null \
      | jq -er --arg service "$service" '. as $root | ($root.services[$service].networks // {}) | keys[] as $key | ($root.networks[$key].name // $key)' \
      | LC_ALL=C sort -u) || fail "runtime_network_contract_invalid"
    networks=$(printf '%s\n' "$networks" | awk 'NF' | LC_ALL=C sort -u)
    [[ -n $networks && -n $expected_networks && $networks == "$expected_networks" ]] \
      || fail "runtime_network_contract_invalid"
    while IFS= read -r network; do
      [[ -n $network ]] || continue
      require_match "$network" "$SAFE_NAME_RE" "runtime_network_invalid"
      [[ $network != acadis && $network != acadis_* ]] || fail "forbidden_runtime_network"
      docker network inspect "$network" >/dev/null 2>&1 || fail "runtime_network_unavailable"
    done <<<"$networks"
  done
}

verify_transition_runtime_identity() (
  set -Eeuo pipefail
  local EVO_RELEASE_COMPOSE_FILE=$1
  local EVO_RELEASE_REVISION=$2
  local EVO_RELEASE_VERSION=$3
  local expected_image=$4
  local candidate_app_env_snapshot=$5
  local candidate_app_env_sha256=$6
  local candidate_compose_file=$EVO_RELEASE_COMPOSE_FILE
  local container actual_image actual_revision actual_version

  require_file "$EVO_RELEASE_COMPOSE_FILE" "runtime_compose_missing"
  require_match "$EVO_RELEASE_REVISION" "$SHA40_RE" "runtime_revision_invalid"
  require_match "$EVO_RELEASE_VERSION" "$VERSION_RE" "runtime_version_invalid"
  require_match "$expected_image" "$SHA256_RE" "runtime_image_invalid"

  current_app_container_id=''
  verify_current_runtime_identity
  [[ -n $current_app_container_id ]] || fail "app_container_unavailable"
  verify_runtime_waha_image
  verify_networks

  container=$(app_container_id) || fail "runtime_service_contract_invalid"
  actual_image=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || true)
  actual_revision=$(container_label "$container" 'org.opencontainers.image.revision' 2>/dev/null || true)
  actual_version=$(container_label "$container" 'org.opencontainers.image.version' 2>/dev/null || true)
  [[ $actual_image == "$expected_image" ]] || fail "runtime_app_image_drift"
  [[ $actual_revision == "$EVO_RELEASE_REVISION" ]] || fail "runtime_app_revision_drift"
  [[ $actual_version == "$EVO_RELEASE_VERSION" ]] || fail "runtime_app_version_drift"
)

verify_transition_runtime() {
  verify_transition_runtime_identity "$@"
  verify_current_runtime
}

verify_capacity() {
  local minimum=${EVO_RELEASE_MIN_FREE_KB:-2097152}
  [[ $minimum =~ ^[0-9]+$ && $minimum -ge 1048576 ]] || fail "capacity_contract_invalid"
  local docker_storage=${EVO_RELEASE_DOCKER_STORAGE_PATH:-/var/lib/docker}
  require_absolute_path "$docker_storage" "capacity_path_invalid"
  local path available
  for path in "$EVO_RELEASE_ROOT" "$docker_storage"; do
    [[ -d $path ]] || fail "capacity_path_missing"
    available=$(df -Pk "$path" | awk 'NR == 2 { print $4 }')
    [[ $available =~ ^[0-9]+$ && $available -ge $minimum ]] || fail "insufficient_capacity"
  done
  local minimum_memory=${EVO_RELEASE_MIN_AVAILABLE_MEMORY_KB:-4194304}
  [[ $minimum_memory =~ ^[0-9]+$ && $minimum_memory -ge 4194304 ]] \
    || fail "memory_capacity_contract_invalid"
  local available_memory docker_memory_bytes
  if [[ -r /proc/meminfo ]]; then
    available_memory=$(awk '$1 == "MemAvailable:" { print $2 }' /proc/meminfo)
  elif [[ $(uname -s) == Darwin ]]; then
    # The macOS proof runs against OrbStack's Linux VM. Docker's allocated
    # memory is the relevant container capacity; scanner health is then proved.
    docker_memory_bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || true)
    [[ $docker_memory_bytes =~ ^[0-9]+$ ]] || fail "memory_capacity_unavailable"
    available_memory=$((docker_memory_bytes / 1024))
  else
    fail "memory_capacity_unavailable"
  fi
  [[ $available_memory =~ ^[0-9]+$ && $available_memory -ge $minimum_memory ]] \
    || fail "insufficient_memory_capacity"
}

verify_compose() {
  require_file "$candidate_compose_file" "compose_missing"
  local actual_hash services app_image waha_image
  actual_hash=$(sha256sum "$candidate_compose_file" | awk '{print $1}')
  [[ $actual_hash == "$EVO_RELEASE_EXPECTED_COMPOSE_SHA256" ]] || fail "compose_drift"
  EVO_RELEASE_REVISION=$EVO_RELEASE_REVISION \
  EVO_RELEASE_VERSION=$EVO_RELEASE_VERSION \
  compose config --quiet >/dev/null || fail "compose_invalid"
  services=$(EVO_RELEASE_REVISION=$EVO_RELEASE_REVISION \
    EVO_RELEASE_VERSION=$EVO_RELEASE_VERSION \
    compose config --services 2>/dev/null | awk 'NF' | LC_ALL=C sort -u) \
    || fail "compose_service_contract_invalid"
  [[ $services == $'app\nwaha' ]] || fail "compose_service_contract_invalid"
  app_image=$(EVO_RELEASE_REVISION=$EVO_RELEASE_REVISION \
    EVO_RELEASE_VERSION=$EVO_RELEASE_VERSION \
    compose config --format json 2>/dev/null | jq -er '.services.app.image') \
    || fail "compose_service_contract_invalid"
  waha_image=$(EVO_RELEASE_REVISION=$EVO_RELEASE_REVISION \
    EVO_RELEASE_VERSION=$EVO_RELEASE_VERSION \
    compose config --format json 2>/dev/null | jq -er '.services.waha.image') \
    || fail "compose_service_contract_invalid"
  [[ $app_image == "evo-crm:${EVO_RELEASE_REVISION}" ]] \
    || fail "compose_app_image_invalid"
  [[ $waha_image == *@"${EVO_WAHA_IMAGE_DIGEST}" ]] \
    || fail "compose_waha_image_invalid"
}

verify_archive() {
  local actual_hash candidate_tag manifest config_path config_hash config_digest config_json
  local index_json descriptor_digest descriptor_path descriptor_hash descriptor_json
  local descriptor_media_type image_manifest_digest image_manifest_path image_manifest_hash image_manifest_json
  local config_image_digest
  local image_source image_revision image_version image_os image_arch
  local layer_path image_layer_digest image_layer_path image_layer_hash
  local -a layer_paths=()
  actual_hash=$(sha256sum "$EVO_RELEASE_ARCHIVE" | awk '{print $1}')
  [[ $actual_hash == "$EVO_RELEASE_ARCHIVE_SHA256" ]] || fail "archive_hash_mismatch"
  candidate_tag="evo-crm:${EVO_RELEASE_REVISION}"
  manifest=$(tar -xOf "$EVO_RELEASE_ARCHIVE" manifest.json 2>/dev/null) || fail "archive_manifest_invalid"
  config_path=$(jq -er --arg tag "$candidate_tag" \
    'if length == 1 and .[0].RepoTags == [$tag] and (.[0].Layers | type) == "array" and (.[0].Layers | length) > 0 then .[0].Config else error("invalid") end' \
    <<<"$manifest" 2>/dev/null) || fail "archive_manifest_invalid"
  require_match "$config_path" "$IMAGE_CONFIG_PATH_RE" "archive_manifest_invalid"
  config_hash=$(tar -xOf "$EVO_RELEASE_ARCHIVE" "$config_path" 2>/dev/null | sha256sum | awk '{print $1}') \
    || fail "archive_config_invalid"
  config_digest=${config_path#blobs/sha256/}
  config_digest=${config_digest%.json}
  [[ $config_hash == "$config_digest" ]] || fail "archive_config_invalid"
  config_image_digest="sha256:$config_hash"
  [[ $config_image_digest == "$EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST" ]] \
    || fail "candidate_image_config_digest_mismatch"

  jq -e \
    '.[0].Layers | type == "array" and length > 0 and all(.[]; type == "string") and length == (unique | length)' \
    <<<"$manifest" >/dev/null 2>&1 || fail "archive_layers_invalid"
  while IFS= read -r layer_path; do
    require_match "$layer_path" "$IMAGE_LAYER_PATH_RE" "archive_layers_invalid"
    layer_paths+=("$layer_path")
  done < <(jq -er '.[0].Layers[]' <<<"$manifest" 2>/dev/null) \
    || fail "archive_layers_invalid"
  [[ ${#layer_paths[@]} -gt 0 ]] || fail "archive_layers_invalid"
  tar -xOf "$EVO_RELEASE_ARCHIVE" "${layer_paths[@]}" >/dev/null 2>&1 \
    || fail "archive_layers_invalid"

  if index_json=$(tar -xOf "$EVO_RELEASE_ARCHIVE" index.json 2>/dev/null); then
    descriptor_digest=$(jq -er \
      'if .schemaVersion == 2 and (.manifests | type) == "array" and (.manifests | length) == 1 then .manifests[0].digest else error("invalid") end' \
      <<<"$index_json" 2>/dev/null) || fail "archive_descriptor_invalid"
    require_match "$descriptor_digest" "$SHA256_RE" "archive_descriptor_invalid"
    descriptor_path="blobs/sha256/${descriptor_digest#sha256:}"
    descriptor_hash=$(tar -xOf "$EVO_RELEASE_ARCHIVE" "$descriptor_path" 2>/dev/null | sha256sum | awk '{print $1}') \
      || fail "archive_descriptor_invalid"
    [[ "sha256:$descriptor_hash" == "$descriptor_digest" ]] \
      || fail "archive_descriptor_invalid"
    descriptor_json=$(tar -xOf "$EVO_RELEASE_ARCHIVE" "$descriptor_path" 2>/dev/null) \
      || fail "archive_descriptor_invalid"
    descriptor_media_type=$(jq -er '.mediaType' <<<"$descriptor_json" 2>/dev/null) \
      || fail "archive_descriptor_invalid"

    case "$descriptor_media_type" in
      application/vnd.oci.image.index.v1+json|application/vnd.docker.distribution.manifest.list.v2+json)
        image_manifest_digest=$(jq -er '
          if .schemaVersion != 2 or (.manifests | type) != "array" then error("invalid") else
            [.manifests[] |
              select(.mediaType == "application/vnd.oci.image.manifest.v1+json" or .mediaType == "application/vnd.docker.distribution.manifest.v2+json") |
              select(.platform.os == "linux" and .platform.architecture == "amd64") |
              select((.annotations["vnd.docker.reference.type"] // "") != "attestation-manifest")
            ] | if length == 1 then .[0].digest else error("invalid") end
          end
        ' <<<"$descriptor_json" 2>/dev/null) || fail "archive_platform_manifest_invalid"
        require_match "$image_manifest_digest" "$SHA256_RE" "archive_platform_manifest_invalid"
        image_manifest_path="blobs/sha256/${image_manifest_digest#sha256:}"
        image_manifest_hash=$(tar -xOf "$EVO_RELEASE_ARCHIVE" "$image_manifest_path" 2>/dev/null | sha256sum | awk '{print $1}') \
          || fail "archive_platform_manifest_invalid"
        [[ "sha256:$image_manifest_hash" == "$image_manifest_digest" ]] \
          || fail "archive_platform_manifest_invalid"
        image_manifest_json=$(tar -xOf "$EVO_RELEASE_ARCHIVE" "$image_manifest_path" 2>/dev/null) \
          || fail "archive_platform_manifest_invalid"
        ;;
      application/vnd.oci.image.manifest.v1+json|application/vnd.docker.distribution.manifest.v2+json)
        image_manifest_digest=$descriptor_digest
        image_manifest_json=$descriptor_json
        ;;
      *)
        fail "archive_descriptor_invalid"
        ;;
    esac

    jq -e --arg config_digest "$config_image_digest" \
      '.schemaVersion == 2 and (.config | type) == "object" and .config.digest == $config_digest and (.layers | type) == "array" and (.layers | length) > 0' \
      <<<"$image_manifest_json" >/dev/null 2>&1 || fail "archive_platform_config_mismatch"
    [[ $candidate_expected_image_id == "$descriptor_digest" \
      || $candidate_expected_image_id == "$image_manifest_digest" \
      || $candidate_expected_image_id == "$config_image_digest" ]] \
      || fail "candidate_image_id_unbound"
    while IFS= read -r image_layer_digest; do
      require_match "$image_layer_digest" "$SHA256_RE" "archive_layers_invalid"
      image_layer_path="blobs/sha256/${image_layer_digest#sha256:}"
      image_layer_hash=$(tar -xOf "$EVO_RELEASE_ARCHIVE" "$image_layer_path" 2>/dev/null | sha256sum | awk '{print $1}') \
        || fail "archive_layers_invalid"
      [[ "sha256:$image_layer_hash" == "$image_layer_digest" ]] \
        || fail "archive_layers_invalid"
    done < <(jq -er '.layers[].digest' <<<"$image_manifest_json" 2>/dev/null) \
      || fail "archive_layers_invalid"
  else
    [[ $candidate_expected_image_id == "$config_image_digest" ]] \
      || fail "candidate_image_id_unbound"
  fi
  config_json=$(tar -xOf "$EVO_RELEASE_ARCHIVE" "$config_path" 2>/dev/null) || fail "archive_config_invalid"
  image_source=$(jq -er '.config.Labels["org.opencontainers.image.source"]' <<<"$config_json" 2>/dev/null) \
    || fail "candidate_source_mismatch"
  image_revision=$(jq -er '.config.Labels["org.opencontainers.image.revision"]' <<<"$config_json" 2>/dev/null) \
    || fail "candidate_revision_mismatch"
  image_version=$(jq -er '.config.Labels["org.opencontainers.image.version"]' <<<"$config_json" 2>/dev/null) \
    || fail "candidate_version_mismatch"
  image_os=$(jq -er '.os' <<<"$config_json" 2>/dev/null) || fail "candidate_platform_mismatch"
  image_arch=$(jq -er '.architecture' <<<"$config_json" 2>/dev/null) || fail "candidate_platform_mismatch"
  [[ $image_source == "https://github.com/${EVO_RELEASE_REPOSITORY}" ]] \
    || fail "candidate_source_mismatch"
  [[ $image_revision == "$EVO_RELEASE_REVISION" ]] || fail "candidate_revision_mismatch"
  [[ $image_version == "$EVO_RELEASE_VERSION" ]] || fail "candidate_version_mismatch"
  [[ $image_os == linux && $image_arch == amd64 ]] || fail "candidate_platform_mismatch"
}

load_candidate_image() {
  local actual_hash candidate_tag image_id image_source image_revision image_version image_os image_arch
  candidate_tag="evo-crm:${EVO_RELEASE_REVISION}"
  actual_hash=$(sha256sum "$EVO_RELEASE_ARCHIVE" | awk '{print $1}') \
    || fail "archive_hash_mismatch"
  [[ $actual_hash == "$EVO_RELEASE_ARCHIVE_SHA256" ]] || fail "archive_hash_mismatch"
  docker image load --input "$EVO_RELEASE_ARCHIVE" >/dev/null || fail "archive_load_failed"
  image_id=$(docker image inspect --format '{{.Id}}' "$candidate_tag" 2>/dev/null || true)
  image_source=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$candidate_tag" 2>/dev/null || true)
  image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$candidate_tag" 2>/dev/null || true)
  image_version=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$candidate_tag" 2>/dev/null || true)
  image_os=$(docker image inspect --format '{{.Os}}' "$candidate_tag" 2>/dev/null || true)
  image_arch=$(docker image inspect --format '{{.Architecture}}' "$candidate_tag" 2>/dev/null || true)
  [[ $image_id == "$candidate_expected_image_id" ]] || fail "candidate_image_id_mismatch"
  [[ $image_id == "$EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST" ]] \
    || fail "candidate_image_config_digest_mismatch"
  [[ $image_source == "https://github.com/${EVO_RELEASE_REPOSITORY}" ]] \
    || fail "candidate_source_mismatch"
  [[ $image_revision == "$EVO_RELEASE_REVISION" ]] || fail "candidate_revision_mismatch"
  [[ $image_version == "$EVO_RELEASE_VERSION" ]] || fail "candidate_version_mismatch"
  [[ $image_os == linux && $image_arch == amd64 ]] || fail "candidate_platform_mismatch"
}

verify_external_health() {
  curl --fail --silent --show-error --max-time 20 --output /dev/null \
    "$EVO_RELEASE_EXTERNAL_HEALTH_URL" || return 1
}

verify_previous_compose() {
  local compose_file=$1 revision=$2 version=$3 app_env_snapshot=$4 app_env_hash=$5 services
  require_file "$compose_file" "rollback_compose_missing"
  require_app_env_snapshot "$app_env_snapshot" "$app_env_hash" "rollback_app_env_invalid"
  EVO_RELEASE_REVISION=$revision EVO_RELEASE_VERSION=$version \
  compose_with_app_env "$app_env_snapshot" "$app_env_hash" "$compose_file" \
    config --quiet >/dev/null 2>&1 || fail "rollback_compose_invalid"
  services=$(EVO_RELEASE_REVISION=$revision EVO_RELEASE_VERSION=$version \
    compose_with_app_env "$app_env_snapshot" "$app_env_hash" "$compose_file" \
      config --services 2>/dev/null) || fail "rollback_compose_invalid"
  printf '%s\n' "$services" | awk '$0 == "app" { found = 1 } END { exit !found }' \
    || fail "rollback_compose_app_missing"
}

verify_rollback_seed() {
  require_variable EVO_RELEASE_ROLLBACK_SEED
  require_absolute_path "$EVO_RELEASE_ROLLBACK_SEED" "rollback_seed_path_invalid"
  require_file "$EVO_RELEASE_ROLLBACK_SEED" "rollback_seed_missing"
  local seed_real evidence_real seed_dir previous_compose previous_app_env actual_hash actual_id image_revision image_version image_os image_arch
  seed_real=$(canonical_path "$EVO_RELEASE_ROLLBACK_SEED")
  evidence_real=$(canonical_path "$EVO_RELEASE_EVIDENCE_ROOT")
  [[ $seed_real == "$evidence_real/"*/state.json ]] || fail "rollback_seed_outside_evidence"
  seed_dir=$(dirname "$seed_real")
  previous_compose=$seed_dir/docker-compose.previous.yml
  previous_app_env=$seed_dir/app.env
  require_file "$previous_compose" "rollback_compose_missing"
  require_file "$previous_app_env" "rollback_seed_env_missing"
  [[ $(file_mode "$seed_real") == 600 ]] || fail "rollback_seed_permissions_invalid"
  [[ $(file_mode "$previous_compose") == 600 ]] || fail "rollback_compose_permissions_invalid"
  [[ $(file_mode "$previous_app_env") == 600 ]] || fail "rollback_seed_env_permissions_invalid"
  jq -e '
    type == "object" and
    keys == ["appEnvSha256", "appEnvSnapshot", "composeSha256", "generation", "previousImage", "previousRevision", "previousVersion", "releaseId", "schema"] and
    .schema == "evo-release-rollback-seed/v2" and
    .generation == "v1" and
    .appEnvSnapshot == "app.env" and
    all(.[]; type == "string")
  ' "$seed_real" >/dev/null 2>&1 || fail "rollback_seed_contract_invalid"

  rollback_previous_image=$(jq -er '.previousImage' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_previous_revision=$(jq -er '.previousRevision' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_previous_version=$(jq -er '.previousVersion' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_compose_sha256=$(jq -er '.composeSha256' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_app_env_sha256=$(jq -er '.appEnvSha256' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_previous_generation=v1
  rollback_previous_release_id=$(jq -er '.releaseId' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_app_env_snapshot=$previous_app_env
  rollback_previous_compose=$previous_compose
  require_match "$rollback_previous_image" "$SHA256_RE" "rollback_seed_image_invalid"
  require_match "$rollback_previous_revision" "$SHA40_RE" "rollback_seed_revision_invalid"
  require_match "$rollback_previous_version" "$VERSION_RE" "rollback_seed_version_invalid"
  require_match "$rollback_compose_sha256" "$HASH64_RE" "rollback_seed_compose_hash_invalid"
  require_match "$rollback_app_env_sha256" "$HASH64_RE" "rollback_seed_env_hash_invalid"
  require_match "$rollback_previous_release_id" "$SAFE_NAME_RE" "rollback_seed_release_id_invalid"
  [[ ${EVO_RELEASE_REVISION-} != "$rollback_previous_revision" ]] || fail "rollback_seed_target_collision"
  [[ ${candidate_expected_image_id-} != "$rollback_previous_image" ]] || fail "rollback_seed_target_collision"

  actual_hash=$(sha256sum "$previous_compose" | awk '{print $1}')
  [[ $actual_hash == "$rollback_compose_sha256" ]] || fail "rollback_seed_compose_drift"
  actual_hash=$(sha256sum "$previous_app_env" | awk '{print $1}')
  [[ $actual_hash == "$rollback_app_env_sha256" ]] || fail "rollback_seed_env_drift"
  actual_id=$(docker image inspect --format '{{.Id}}' "$rollback_previous_image" 2>/dev/null || true)
  [[ $actual_id == "$rollback_previous_image" ]] || fail "rollback_seed_image_missing"
  image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$rollback_previous_image" 2>/dev/null || true)
  image_version=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$rollback_previous_image" 2>/dev/null || true)
  image_os=$(docker image inspect --format '{{.Os}}' "$rollback_previous_image" 2>/dev/null || true)
  image_arch=$(docker image inspect --format '{{.Architecture}}' "$rollback_previous_image" 2>/dev/null || true)
  [[ $image_revision == "$rollback_previous_revision" ]] || fail "rollback_seed_revision_mismatch"
  [[ $image_version == "$rollback_previous_version" ]] || fail "rollback_seed_version_mismatch"
  [[ $image_os == linux && $image_arch == amd64 ]] || fail "rollback_seed_platform_mismatch"
  verify_previous_compose \
    "$previous_compose" \
    "$rollback_previous_revision" \
    "$rollback_previous_version" \
    "$previous_app_env" \
    "$rollback_app_env_sha256"
}

load_accepted_v3_source() {
  local pointer=$EVO_RELEASE_EVIDENCE_ROOT/current-v3-accepted.json
  require_file "$pointer" "accepted_pointer_missing"
  [[ $(file_mode "$pointer") == 600 ]] || fail "accepted_pointer_permissions_invalid"
  jq -e '
    type == "object" and
    keys == ["acceptanceRecord", "acceptanceRecordSha256", "generation", "releaseId", "revision", "schema"] and
    .schema == "evo-v3-current-accepted/v1" and
    .generation == "v3" and
    all(.[]; type == "string")
  ' "$pointer" >/dev/null 2>&1 || fail "accepted_pointer_contract_invalid"

  local release_id revision record_relative record_hash record record_dir actual_hash
  release_id=$(jq -er '.releaseId' "$pointer") || fail "accepted_pointer_contract_invalid"
  revision=$(jq -er '.revision' "$pointer") || fail "accepted_pointer_contract_invalid"
  record_relative=$(jq -er '.acceptanceRecord' "$pointer") || fail "accepted_pointer_contract_invalid"
  record_hash=$(jq -er '.acceptanceRecordSha256' "$pointer") || fail "accepted_pointer_contract_invalid"
  require_match "$release_id" "$SAFE_NAME_RE" "accepted_release_id_invalid"
  require_match "$revision" "$SHA40_RE" "accepted_revision_invalid"
  require_match "$record_hash" "$HASH64_RE" "accepted_record_hash_invalid"
  [[ $record_relative == "$release_id/v3-acceptance-record.json" ]] \
    || fail "accepted_record_path_invalid"
  record="$EVO_RELEASE_EVIDENCE_ROOT/$record_relative"
  require_file "$record" "accepted_record_missing"
  [[ $(file_mode "$record") == 600 ]] || fail "accepted_record_permissions_invalid"
  actual_hash=$(sha256sum "$record" | awk '{print $1}') || fail "accepted_record_hash_invalid"
  [[ $actual_hash == "$record_hash" ]] || fail "accepted_record_hash_mismatch"
  jq -e '
    type == "object" and
    keys == ["actorId", "appEnvSha256", "appEnvSnapshot", "archiveSha256", "artifactDigest", "artifactId", "browserReceiptSha256", "candidateContainerId", "composeSha256", "composeSnapshot", "currentMainRevision", "generation", "imageConfigDigest", "imageId", "imageSource", "preparedEvidence", "previous", "releaseId", "releaseRunId", "repository", "revision", "schema", "upstreamCiRunAttempt", "upstreamCiRunId", "version", "workflowRunAttempt", "workflowRunId"] and
    .schema == "evo-v3-acceptance-record/v1" and
    .preparedEvidence == true and
    .generation == "v3" and
    .appEnvSnapshot == "candidate-app.env" and
    .composeSnapshot == "docker-compose.candidate.yml" and
    (.previous | type) == "object"
  ' "$record" >/dev/null 2>&1 || fail "accepted_record_contract_invalid"
  [[ $(jq -er '.releaseId' "$record") == "$release_id" ]] \
    || fail "accepted_record_identity_mismatch"
  [[ $(jq -er '.revision' "$record") == "$revision" ]] \
    || fail "accepted_record_identity_mismatch"

  record_dir=$(dirname "$record")
  rollback_previous_generation=v3
  rollback_previous_release_id=$release_id
  rollback_previous_image=$(jq -er '.imageId' "$record") || fail "accepted_record_contract_invalid"
  rollback_previous_revision=$revision
  rollback_previous_version=$(jq -er '.version' "$record") || fail "accepted_record_contract_invalid"
  rollback_compose_sha256=$(jq -er '.composeSha256' "$record") || fail "accepted_record_contract_invalid"
  rollback_app_env_sha256=$(jq -er '.appEnvSha256' "$record") || fail "accepted_record_contract_invalid"
  rollback_previous_compose=$record_dir/docker-compose.candidate.yml
  rollback_app_env_snapshot=$record_dir/candidate-app.env
  rollback_previous_pointer=$pointer
  rollback_previous_pointer_sha256=$(sha256sum "$pointer" | awk '{print $1}') \
    || fail "accepted_pointer_hash_invalid"
  require_match "$rollback_previous_image" "$SHA256_RE" "accepted_image_invalid"
  require_match "$rollback_previous_version" "$VERSION_RE" "accepted_version_invalid"
  require_match "$rollback_compose_sha256" "$HASH64_RE" "accepted_compose_hash_invalid"
  require_app_env_snapshot \
    "$rollback_app_env_snapshot" \
    "$rollback_app_env_sha256" \
    "accepted_app_env_invalid"
  require_file "$rollback_previous_compose" "accepted_compose_missing"
  actual_hash=$(sha256sum "$rollback_previous_compose" | awk '{print $1}') \
    || fail "accepted_compose_hash_invalid"
  [[ $actual_hash == "$rollback_compose_sha256" ]] || fail "accepted_compose_hash_mismatch"
  verify_previous_compose \
    "$rollback_previous_compose" \
    "$rollback_previous_revision" \
    "$rollback_previous_version" \
    "$rollback_app_env_snapshot" \
    "$rollback_app_env_sha256"
}

verify_rollback_source() {
  rollback_previous_image=''
  rollback_previous_revision=''
  rollback_previous_version=''
  rollback_previous_compose=''
  rollback_compose_sha256=''
  rollback_app_env_sha256=''
  rollback_app_env_snapshot=''
  rollback_previous_generation=''
  rollback_previous_release_id=''
  rollback_previous_pointer=''
  rollback_previous_pointer_sha256=''

  local pending_pointer=$EVO_RELEASE_EVIDENCE_ROOT/pending-current.json
  [[ ! -e $pending_pointer ]] || fail "unresolved_pending_release"
  local accepted_pointer=$EVO_RELEASE_EVIDENCE_ROOT/current-v3-accepted.json
  if [[ -z $current_app_container_id ]]; then
    [[ ! -e $accepted_pointer ]] || fail "accepted_runtime_missing"
    rollback_previous_generation=none
    rollback_previous_release_id=none
    return
  fi

  if [[ -e $accepted_pointer ]]; then
    load_accepted_v3_source
  else
    verify_rollback_seed
  fi

  local current_image current_revision current_version
  current_image=$(docker inspect --format '{{.Image}}' "$current_app_container_id")
  current_revision=$(container_label "$current_app_container_id" 'org.opencontainers.image.revision')
  current_version=$(container_label "$current_app_container_id" 'org.opencontainers.image.version')
  local current_restarts
  current_restarts=$(docker inspect --format '{{.RestartCount}}' "$current_app_container_id")
  [[ $current_image == "$rollback_previous_image" ]] || fail "current_release_unrecognized"
  [[ $current_revision == "$rollback_previous_revision" ]] || fail "current_release_unrecognized"
  [[ $current_version == "$rollback_previous_version" ]] || fail "current_release_unrecognized"
  [[ $rollback_previous_revision != "$EVO_RELEASE_REVISION" && $current_restarts == 0 ]] \
    || fail "current_release_invalid"
  [[ $rollback_previous_image != "$candidate_expected_image_id" ]] || fail "current_release_invalid"
}

seal_rollback_seed() {
  require_command docker
  require_command flock
  require_command jq
  require_command mktemp
  require_command node
  require_command realpath
  require_command sha256sum
  require_command sync
  load_configuration
  acquire_release_lock
  require_variable EVO_RELEASE_ROLLBACK_SEED
  require_variable EVO_RELEASE_SEED_IMAGE
  require_match "$EVO_RELEASE_SEED_IMAGE" "$SHA256_RE" "rollback_seed_image_invalid"
  require_file "$EVO_RELEASE_ACTIVE_COMPOSE_FILE" "active_compose_missing"
  require_file "$EVO_RELEASE_APP_ENV_FILE" "app_env_missing"
  [[ -d $EVO_RELEASE_EVIDENCE_ROOT && ! -L $EVO_RELEASE_EVIDENCE_ROOT ]] \
    || fail "evidence_root_invalid"
  verify_current_runtime
  [[ -n $current_app_container_id ]] || fail "rollback_seed_requires_active_app"

  local evidence_real seed_dir seed_parent seed_name temporary_dir image_id image_revision image_version image_os image_arch compose_hash env_hash
  evidence_real=$(canonical_path "$EVO_RELEASE_EVIDENCE_ROOT")
  seed_dir=$(dirname "$EVO_RELEASE_ROLLBACK_SEED")
  seed_parent=$(dirname "$seed_dir")
  seed_name=$(basename "$seed_dir")
  [[ $(basename "$EVO_RELEASE_ROLLBACK_SEED") == state.json ]] || fail "rollback_seed_path_invalid"
  require_match "$seed_name" "$SAFE_NAME_RE" "rollback_seed_path_invalid"
  [[ -d $seed_parent && $(canonical_path "$seed_parent") == "$evidence_real" ]] \
    || fail "rollback_seed_outside_evidence"
  [[ ! -e $seed_dir ]] || fail "rollback_seed_collision"

  image_id=$(docker image inspect --format '{{.Id}}' "$EVO_RELEASE_SEED_IMAGE" 2>/dev/null || true)
  [[ $image_id == "$EVO_RELEASE_SEED_IMAGE" ]] || fail "rollback_seed_image_missing"
  [[ $(docker inspect --format '{{.Image}}' "$current_app_container_id") == "$image_id" ]] \
    || fail "rollback_seed_runtime_mismatch"
  image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id" 2>/dev/null || true)
  image_version=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image_id" 2>/dev/null || true)
  image_os=$(docker image inspect --format '{{.Os}}' "$image_id" 2>/dev/null || true)
  image_arch=$(docker image inspect --format '{{.Architecture}}' "$image_id" 2>/dev/null || true)
  require_match "$image_revision" "$SHA40_RE" "rollback_seed_revision_invalid"
  require_match "$image_version" "$VERSION_RE" "rollback_seed_version_invalid"
  [[ $image_os == linux && $image_arch == amd64 ]] || fail "rollback_seed_platform_mismatch"
  temporary_dir=$(mktemp -d "$evidence_real/.rollback-seed.XXXXXX") \
    || fail "rollback_seed_create_failed"
  chmod 700 "$temporary_dir"
  install -m 600 "$EVO_RELEASE_ACTIVE_COMPOSE_FILE" "$temporary_dir/docker-compose.previous.yml" \
    || fail "rollback_seed_create_failed"
  compose_hash=$(sha256sum "$temporary_dir/docker-compose.previous.yml" | awk '{print $1}') \
    || fail "rollback_seed_create_failed"
  env_hash=$(seal_app_env_snapshot \
    "$EVO_RELEASE_APP_ENV_FILE" \
    "$temporary_dir/app.env") || fail "rollback_seed_create_failed"
  verify_previous_compose \
    "$temporary_dir/docker-compose.previous.yml" \
    "$image_revision" \
    "$image_version" \
    "$temporary_dir/app.env" \
    "$env_hash"
  jq -cn \
    --arg releaseId "$seed_name" \
    --arg previousImage "$image_id" \
    --arg previousRevision "$image_revision" \
    --arg previousVersion "$image_version" \
    --arg composeSha256 "$compose_hash" \
    --arg appEnvSha256 "$env_hash" \
    '{schema:"evo-release-rollback-seed/v2",generation:"v1",releaseId:$releaseId,previousImage:$previousImage,previousRevision:$previousRevision,previousVersion:$previousVersion,composeSha256:$composeSha256,appEnvSnapshot:"app.env",appEnvSha256:$appEnvSha256}' \
    >"$temporary_dir/state.json" || fail "rollback_seed_create_failed"
  chmod 600 "$temporary_dir/state.json"
  sync -f "$temporary_dir/state.json" || fail "rollback_seed_create_failed"
  mv -- "$temporary_dir" "$seed_dir" || fail "rollback_seed_create_failed"
  sync -f "$evidence_real" || fail "rollback_seed_create_failed"
  verify_rollback_seed
  jq -cn \
    --arg revision "$image_revision" \
    --arg version "$image_version" \
    '{ok:true,command:"seal-rollback-seed",status:"sealed",revision:$revision,version:$version}'
}

prepare_candidate_generation() {
  local directory=$1 evidence_real parent_real actual_hash
  [[ -d $EVO_RELEASE_EVIDENCE_ROOT && ! -L $EVO_RELEASE_EVIDENCE_ROOT ]] \
    || fail "evidence_root_invalid"
  evidence_real=$(canonical_path "$EVO_RELEASE_EVIDENCE_ROOT")
  parent_real=$(canonical_path "$(dirname "$directory")")
  [[ $parent_real == "$evidence_real" ]] || fail "evidence_path_invalid"
  [[ ! -e $directory ]] || fail "evidence_collision"
  install -d -m 700 "$directory" || fail "evidence_create_failed"
  release_evidence_dir=$directory

  candidate_compose_file=$directory/docker-compose.candidate.yml
  install -m 600 "$EVO_RELEASE_COMPOSE_FILE" "$candidate_compose_file" \
    || fail "candidate_compose_snapshot_failed"
  actual_hash=$(sha256sum "$candidate_compose_file" | awk '{print $1}') \
    || fail "candidate_compose_snapshot_failed"
  [[ $actual_hash == "$EVO_RELEASE_EXPECTED_COMPOSE_SHA256" ]] \
    || fail "compose_hash_mismatch"

  candidate_app_env_snapshot=$directory/candidate-app.env
  candidate_app_env_sha256=$(seal_app_env_snapshot \
    "$EVO_RELEASE_APP_ENV_FILE" \
    "$candidate_app_env_snapshot") || fail "app_env_snapshot_seal_failed"
  require_app_env_snapshot "$candidate_app_env_snapshot" "$candidate_app_env_sha256"
}

run_preflight_checks() {
  verify_env_contract
  verify_capacity
  verify_compose
  verify_current_runtime
  verify_runtime_waha_image
  verify_networks
  verify_archive
  verify_rollback_source
  if [[ -n $current_app_container_id ]]; then
    verify_external_health || fail "external_health_failed"
  fi
}

require_release_runtime_commands() {
  require_command curl
  require_command docker
  require_command flock
  require_command install
  require_command jq
  require_command mktemp
  require_command node
  require_command realpath
  require_command sha256sum
  require_command sync
  require_command tar
}

preflight() {
  require_release_runtime_commands
  load_configuration
  load_candidate_configuration
  acquire_release_lock
  local preflight_dir
  preflight_dir=$(mktemp -d "$EVO_RELEASE_EVIDENCE_ROOT/.preflight-${EVO_RELEASE_ID}.XXXXXX") \
    || fail "evidence_create_failed"
  chmod 700 "$preflight_dir"
  # prepare_candidate_generation requires a nonexistent path; reserve only the
  # unique name here, then remove the empty directory without broad deletion.
  rmdir "$preflight_dir" || fail "evidence_create_failed"
  prepare_candidate_generation "$preflight_dir"
  run_preflight_checks
  unlink "$candidate_app_env_snapshot" "$candidate_compose_file" \
    || fail "preflight_cleanup_failed"
  rmdir "$preflight_dir" || fail "preflight_cleanup_failed"
  jq -cn --arg releaseId "$EVO_RELEASE_ID" \
    '{ok:true,command:"preflight",code:"ready",releaseId:$releaseId}'
}

sync_file_and_parent() {
  sync -f "$1" || return 1
  sync -f "$(dirname "$1")" || return 1
}

create_once_json() {
  local target=$1 payload=$2 temporary
  [[ ! -e $target ]] || return 1
  temporary=$(mktemp "$(dirname "$target")/.json.XXXXXX") || return 1
  chmod 600 "$temporary" || return 1
  printf '%s\n' "$payload" >"$temporary" || return 1
  sync -f "$temporary" || return 1
  if ! ln "$temporary" "$target"; then
    unlink "$temporary" || true
    return 1
  fi
  unlink "$temporary" || return 1
  sync_file_and_parent "$target"
}

replace_json_atomically() {
  local target=$1 payload=$2 temporary
  [[ ! -L $target ]] || return 1
  temporary=$(mktemp "$(dirname "$target")/.json.XXXXXX") || return 1
  chmod 600 "$temporary" || return 1
  printf '%s\n' "$payload" >"$temporary" || return 1
  sync -f "$temporary" || return 1
  mv -- "$temporary" "$target" || return 1
  sync_file_and_parent "$target"
}

file_hash_or_absent() {
  local target=$1
  if [[ ! -e $target ]]; then
    printf 'absent\n'
    return
  fi
  require_file "$target" "authority_pointer_invalid"
  sha256sum "$target" | awk '{print $1}'
}

require_pointer_hash() {
  local target=$1 expected=$2
  local actual
  actual=$(file_hash_or_absent "$target") || return 1
  [[ $actual == "$expected" ]]
}

write_result() {
  local directory=$1 status=$2 code=$3 rolled_back=$4
  local payload
  payload=$(jq -cn \
    --arg status "$status" \
    --arg code "$code" \
    --arg revision "$EVO_RELEASE_REVISION" \
    --arg version "$EVO_RELEASE_VERSION" \
    --arg image "$candidate_expected_image_id" \
    --argjson rolledBack "$rolled_back" \
    '{schema:"evo-fast-release/v2",status:$status,code:$code,revision:$revision,version:$version,image:$image,rolledBack:$rolledBack}') \
    || return 1
  replace_json_atomically "$directory/result.json" "$payload"
}

create_rollback_wrapper() {
  local directory=$1 script_dir controller validator wrapper command_file
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  controller=$directory/controller/evo-fast-release.sh
  validator=$directory/controller/evo-app-env-contract.mjs
  wrapper=$directory/rollback-command.sh
  command_file=$directory/rollback-command.txt
  install -d -m 700 "$directory/controller" || fail "rollback_wrapper_create_failed"
  install -m 700 "$script_dir/evo-fast-release.sh" "$controller" \
    || fail "rollback_wrapper_create_failed"
  install -m 600 "$script_dir/evo-app-env-contract.mjs" "$validator" \
    || fail "rollback_wrapper_create_failed"
  rollback_controller_sha256=$(sha256sum "$controller" | awk '{print $1}') \
    || fail "rollback_wrapper_create_failed"
  printf '%s  %s\n' "$rollback_controller_sha256" "controller/evo-fast-release.sh" \
    >"$directory/controller.sha256" || fail "rollback_wrapper_create_failed"
  chmod 600 "$directory/controller.sha256"

  {
    printf '%s\n' '#!/usr/bin/env bash' 'set -Eeuo pipefail' 'umask 077'
    printf 'readonly EVIDENCE_DIR=%q\n' "$directory"
    printf 'cd -- "$EVIDENCE_DIR"\n'
    printf 'sha256sum --check --status "$EVIDENCE_DIR/controller.sha256"\n'
    printf 'expected_wrapper_hash=$(awk '\''{print $1}'\'' "$EVIDENCE_DIR/rollback-command.sha256")\n'
    printf 'actual_wrapper_hash=$(sha256sum "$0" | awk '\''{print $1}'\'')\n'
    printf '[[ $actual_wrapper_hash == "$expected_wrapper_hash" ]]\n'
    printf 'export EVO_RELEASE_ROOT=%q\n' "$EVO_RELEASE_ROOT"
    printf 'export EVO_RELEASE_PROJECT_NAME=%q\n' "$EVO_RELEASE_PROJECT_NAME"
    printf 'export EVO_RELEASE_TRANSFER_ROOT=%q\n' "$EVO_RELEASE_TRANSFER_ROOT"
    printf 'export EVO_RELEASE_EVIDENCE_ROOT=%q\n' "$EVO_RELEASE_EVIDENCE_ROOT"
    printf 'export EVO_RELEASE_COMPOSE_FILE=%q\n' "$candidate_compose_file"
    printf 'export EVO_RELEASE_ACTIVE_COMPOSE_FILE=%q\n' "$candidate_compose_file"
    printf 'export EVO_RELEASE_APP_ENV_FILE=%q\n' "$candidate_app_env_snapshot"
    printf 'export EVO_CRM_WAHA_ENV_FILE=%q\n' "$EVO_CRM_WAHA_ENV_FILE"
    printf 'export EVO_RELEASE_EXTERNAL_HEALTH_URL=%q\n' "$EVO_RELEASE_EXTERNAL_HEALTH_URL"
    printf 'export EVO_SUPABASE_PROJECT_REF=%q\n' "$EVO_SUPABASE_PROJECT_REF"
    printf 'export EVO_WAHA_IMAGE_DIGEST=%q\n' "$EVO_WAHA_IMAGE_DIGEST"
    printf 'export EVO_RELEASE_ROLLBACK_STATE=%q\n' "$directory/state.json"
    printf 'export EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID=%q\n' "$EVO_RELEASE_ID"
    printf '%s\n' \
      'case "$#" in' \
      '  0) rollback_command=rollback ;;' \
      '  1) [[ $1 == pending-only ]] || { printf '\''{"ok":false,"code":"invalid_arguments"}\\n'\'' >&2; exit 2; }; rollback_command=rollback-pending ;;' \
      '  *) printf '\''{"ok":false,"code":"invalid_arguments"}\\n'\'' >&2; exit 2 ;;' \
      'esac' \
      'exec "$EVIDENCE_DIR/controller/evo-fast-release.sh" "$rollback_command"'
  } >"$wrapper" || fail "rollback_wrapper_create_failed"
  chmod 700 "$wrapper"
  rollback_wrapper_sha256=$(sha256sum "$wrapper" | awk '{print $1}') \
    || fail "rollback_wrapper_create_failed"
  printf '%s  %s\n' "$rollback_wrapper_sha256" "rollback-command.sh" \
    >"$directory/rollback-command.sha256" || fail "rollback_wrapper_create_failed"
  chmod 600 "$directory/rollback-command.sha256"
  printf 'sudo -- %s\n' "$wrapper" >"$command_file" \
    || fail "rollback_wrapper_create_failed"
  chmod 600 "$command_file"
  sync_file_and_parent "$wrapper" || fail "rollback_wrapper_create_failed"
  sync_file_and_parent "$command_file" || fail "rollback_wrapper_create_failed"
}

create_rollback_state() {
  local directory=$1 rollback_tag='' actual_hash previous_app_present=false
  local previous_compose_snapshot='' previous_env_snapshot=''
  local previous_pointer_snapshot='' previous_pointer_hash='absent'

  require_app_env_snapshot "$candidate_app_env_snapshot" "$candidate_app_env_sha256"
  actual_hash=$(sha256sum "$candidate_compose_file" | awk '{print $1}') \
    || fail "candidate_compose_drift"
  [[ $actual_hash == "$EVO_RELEASE_EXPECTED_COMPOSE_SHA256" ]] \
    || fail "candidate_compose_drift"

  case "$rollback_previous_generation" in
    none)
      ;;
    v1|v3)
      previous_app_present=true
      require_match "$rollback_previous_image" "$SHA256_RE" "rollback_source_invalid"
      require_match "$rollback_previous_revision" "$SHA40_RE" "rollback_source_invalid"
      require_match "$rollback_previous_version" "$VERSION_RE" "rollback_source_invalid"
      require_match "$rollback_compose_sha256" "$HASH64_RE" "rollback_source_invalid"
      require_match "$rollback_app_env_sha256" "$HASH64_RE" "rollback_source_invalid"
      require_file "$rollback_previous_compose" "rollback_compose_missing"
      require_app_env_snapshot \
        "$rollback_app_env_snapshot" \
        "$rollback_app_env_sha256" \
        "rollback_app_env_drift"
      [[ $(docker image inspect --format '{{.Id}}' "$rollback_previous_image" 2>/dev/null || true) == "$rollback_previous_image" ]] \
        || fail "rollback_image_missing"
      rollback_tag="evo-crm:rollback-${EVO_RELEASE_RUN_ID}"
      docker image inspect "$rollback_tag" >/dev/null 2>&1 && fail "rollback_tag_collision"
      docker tag "$rollback_previous_image" "$rollback_tag" || fail "rollback_tag_failed"

      previous_compose_snapshot=$directory/docker-compose.previous.yml
      install -m 600 "$rollback_previous_compose" "$previous_compose_snapshot" \
        || fail "rollback_compose_snapshot_failed"
      actual_hash=$(sha256sum "$previous_compose_snapshot" | awk '{print $1}') \
        || fail "rollback_compose_snapshot_failed"
      [[ $actual_hash == "$rollback_compose_sha256" ]] || fail "rollback_compose_drift"

      previous_env_snapshot=$directory/rollback-app.env
      actual_hash=$(seal_app_env_snapshot \
        "$rollback_app_env_snapshot" \
        "$previous_env_snapshot") || fail "rollback_app_env_snapshot_failed"
      [[ $actual_hash == "$rollback_app_env_sha256" ]] || fail "rollback_app_env_drift"
      verify_previous_compose \
        "$previous_compose_snapshot" \
        "$rollback_previous_revision" \
        "$rollback_previous_version" \
        "$previous_env_snapshot" \
        "$rollback_app_env_sha256"

      if [[ $rollback_previous_generation == v3 ]]; then
        previous_pointer_snapshot=$directory/previous-current-v3-accepted.json
        install -m 600 "$rollback_previous_pointer" "$previous_pointer_snapshot" \
          || fail "previous_pointer_snapshot_failed"
        previous_pointer_hash=$(sha256sum "$previous_pointer_snapshot" | awk '{print $1}') \
          || fail "previous_pointer_snapshot_failed"
        [[ $previous_pointer_hash == "$rollback_previous_pointer_sha256" ]] \
          || fail "previous_pointer_drift"
      fi
      ;;
    *)
      fail "rollback_generation_invalid"
      ;;
  esac

  local state_payload pending_payload state_hash
  state_payload=$(jq -cn \
    --arg repository "$EVO_RELEASE_REPOSITORY" \
    --arg releaseId "$EVO_RELEASE_ID" \
    --arg releaseRunId "$EVO_RELEASE_RUN_ID" \
    --arg workflowRunId "$EVO_RELEASE_WORKFLOW_RUN_ID" \
    --arg workflowRunAttempt "$EVO_RELEASE_WORKFLOW_RUN_ATTEMPT" \
    --arg upstreamCiRunId "$EVO_RELEASE_UPSTREAM_CI_RUN_ID" \
    --arg upstreamCiRunAttempt "$EVO_RELEASE_UPSTREAM_CI_RUN_ATTEMPT" \
    --arg artifactId "$EVO_RELEASE_ARTIFACT_ID" \
    --arg artifactDigest "$EVO_RELEASE_ARTIFACT_DIGEST" \
    --arg revision "$EVO_RELEASE_REVISION" \
    --arg version "$EVO_RELEASE_VERSION" \
    --arg imageId "$candidate_expected_image_id" \
    --arg imageConfigDigest "$EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST" \
    --arg imageSource "https://github.com/${EVO_RELEASE_REPOSITORY}" \
    --arg archiveSha256 "$EVO_RELEASE_ARCHIVE_SHA256" \
    --arg composeSha256 "$EVO_RELEASE_EXPECTED_COMPOSE_SHA256" \
    --arg appEnvSha256 "$candidate_app_env_sha256" \
    --arg controllerSha256 "$rollback_controller_sha256" \
    --arg rollbackWrapperSha256 "$rollback_wrapper_sha256" \
    --arg previousImage "$rollback_previous_image" \
    --arg previousRevision "$rollback_previous_revision" \
    --arg previousVersion "$rollback_previous_version" \
    --arg previousGeneration "$rollback_previous_generation" \
    --arg previousReleaseId "$rollback_previous_release_id" \
    --arg rollbackTag "$rollback_tag" \
    --arg previousComposeSha256 "$rollback_compose_sha256" \
    --arg previousAppEnvSha256 "$rollback_app_env_sha256" \
    --arg previousPointerSha256 "$previous_pointer_hash" \
    --argjson previousAppPresent "$previous_app_present" \
    '{schema:"evo-fast-release-state/v2",generation:"v3",repository:$repository,releaseId:$releaseId,releaseRunId:$releaseRunId,workflowRunId:$workflowRunId,workflowRunAttempt:$workflowRunAttempt,upstreamCiRunId:$upstreamCiRunId,upstreamCiRunAttempt:$upstreamCiRunAttempt,artifactId:$artifactId,artifactDigest:$artifactDigest,revision:$revision,version:$version,imageId:$imageId,imageConfigDigest:$imageConfigDigest,imageSource:$imageSource,archiveSha256:$archiveSha256,composeSnapshot:"docker-compose.candidate.yml",composeSha256:$composeSha256,appEnvSnapshot:"candidate-app.env",appEnvSha256:$appEnvSha256,controllerSha256:$controllerSha256,rollbackWrapperSha256:$rollbackWrapperSha256,rollbackTag:$rollbackTag,previous:{generation:$previousGeneration,releaseId:$previousReleaseId,appPresent:$previousAppPresent,imageId:$previousImage,revision:$previousRevision,version:$previousVersion,composeSnapshot:(if $previousAppPresent then "docker-compose.previous.yml" else "" end),composeSha256:$previousComposeSha256,appEnvSnapshot:(if $previousAppPresent then "rollback-app.env" else "" end),appEnvSha256:$previousAppEnvSha256,acceptedPointerSnapshot:(if $previousGeneration == "v3" then "previous-current-v3-accepted.json" else "" end),acceptedPointerSha256:$previousPointerSha256}}') \
    || fail "release_state_create_failed"
  create_once_json "$directory/state.json" "$state_payload" \
    || fail "release_state_create_failed"
  state_hash=$(sha256sum "$directory/state.json" | awk '{print $1}') \
    || fail "release_state_create_failed"
  pending_payload=$(jq -cn \
    --arg releaseId "$EVO_RELEASE_ID" \
    --arg repository "$EVO_RELEASE_REPOSITORY" \
    --arg revision "$EVO_RELEASE_REVISION" \
    --arg workflowRunId "$EVO_RELEASE_WORKFLOW_RUN_ID" \
    --arg workflowRunAttempt "$EVO_RELEASE_WORKFLOW_RUN_ATTEMPT" \
    --arg artifactId "$EVO_RELEASE_ARTIFACT_ID" \
    --arg artifactDigest "$EVO_RELEASE_ARTIFACT_DIGEST" \
    --arg stateSha256 "$state_hash" \
    '{schema:"evo-v3-pending-current/v1",generation:"v3",releaseId:$releaseId,repository:$repository,revision:$revision,workflowRunId:$workflowRunId,workflowRunAttempt:$workflowRunAttempt,artifactId:$artifactId,artifactDigest:$artifactDigest,stateSha256:$stateSha256}') \
    || fail "pending_pointer_create_failed"
  create_once_json "$EVO_RELEASE_EVIDENCE_ROOT/pending-current.json" "$pending_payload" \
    || fail "pending_pointer_create_failed"
}

verify_rollback_state_contract() {
  local state_file=$1
  [[ -f $state_file && ! -L $state_file ]] || return 1
  [[ $(file_mode "$state_file") == 600 ]] || return 1
  jq -e '
    type == "object" and
    keys == ["appEnvSha256", "appEnvSnapshot", "archiveSha256", "artifactDigest", "artifactId", "composeSha256", "composeSnapshot", "controllerSha256", "generation", "imageConfigDigest", "imageId", "imageSource", "previous", "releaseId", "releaseRunId", "repository", "revision", "rollbackTag", "rollbackWrapperSha256", "schema", "upstreamCiRunAttempt", "upstreamCiRunId", "version", "workflowRunAttempt", "workflowRunId"] and
    .schema == "evo-fast-release-state/v2" and
    .generation == "v3" and
    .appEnvSnapshot == "candidate-app.env" and
    .composeSnapshot == "docker-compose.candidate.yml" and
    ([.repository,.releaseId,.releaseRunId,.workflowRunId,.workflowRunAttempt,.upstreamCiRunId,.upstreamCiRunAttempt,.artifactId,.artifactDigest,.revision,.version,.imageId,.imageConfigDigest,.imageSource,.archiveSha256,.composeSha256,.appEnvSha256,.controllerSha256,.rollbackWrapperSha256,.rollbackTag] | all(.[]; type == "string")) and
    (.previous | type) == "object" and
    (.previous | keys) == ["acceptedPointerSha256", "acceptedPointerSnapshot", "appEnvSha256", "appEnvSnapshot", "appPresent", "composeSha256", "composeSnapshot", "generation", "imageId", "releaseId", "revision", "version"] and
    (.previous.appPresent | type) == "boolean" and
    ([.previous.generation,.previous.releaseId,.previous.imageId,.previous.revision,.previous.version,.previous.composeSnapshot,.previous.composeSha256,.previous.appEnvSnapshot,.previous.appEnvSha256,.previous.acceptedPointerSnapshot,.previous.acceptedPointerSha256] | all(.[]; type == "string"))
  ' "$state_file" >/dev/null 2>&1
}

verify_pending_for_state() {
  local state_file=$1 pending=$EVO_RELEASE_EVIDENCE_ROOT/pending-current.json
  verify_rollback_state_contract "$state_file" || return 1
  [[ -f $pending && ! -L $pending && $(file_mode "$pending") == 600 ]] || return 1
  jq -e '
    type == "object" and
    keys == ["artifactDigest", "artifactId", "generation", "releaseId", "repository", "revision", "schema", "stateSha256", "workflowRunAttempt", "workflowRunId"] and
    .schema == "evo-v3-pending-current/v1" and
    .generation == "v3" and
    all(.[]; type == "string")
  ' "$pending" >/dev/null 2>&1 || return 1
  local state_hash
  state_hash=$(sha256sum "$state_file" | awk '{print $1}') || return 1
  [[ $(jq -er '.stateSha256' "$pending") == "$state_hash" ]] || return 1
  for field in releaseId repository revision workflowRunId workflowRunAttempt artifactId artifactDigest; do
    [[ $(jq -er ".${field}" "$pending") == $(jq -er ".${field}" "$state_file") ]] \
      || return 1
  done
}

record_candidate_container() {
  local state_file=$1 container_id=$2 directory runtime_record state_hash runtime_payload
  verify_pending_for_state "$state_file" || fail "pending_state_invalid"
  require_match "$container_id" '^[0-9a-f]{12,64}$' "candidate_container_id_invalid"
  directory=$(dirname "$state_file")
  runtime_record=$directory/candidate-runtime.json
  state_hash=$(sha256sum "$state_file" | awk '{print $1}') \
    || fail "candidate_container_record_failed"
  runtime_payload=$(jq -cn \
    --arg releaseId "$EVO_RELEASE_ID" \
    --arg revision "$EVO_RELEASE_REVISION" \
    --arg imageId "$candidate_expected_image_id" \
    --arg candidateContainerId "$container_id" \
    --arg stateSha256 "$state_hash" \
    '{schema:"evo-v3-candidate-runtime/v1",releaseId:$releaseId,revision:$revision,imageId:$imageId,candidateContainerId:$candidateContainerId,stateSha256:$stateSha256}') \
    || fail "candidate_container_record_failed"
  create_once_json "$runtime_record" "$runtime_payload" \
    || fail "candidate_container_record_failed"
  verify_pending_for_state "$state_file" || fail "candidate_container_record_failed"
}

load_candidate_runtime_record() {
  local state_file=$1 directory runtime_record state_hash
  directory=$(dirname "$state_file")
  runtime_record=$directory/candidate-runtime.json
  [[ -f $runtime_record && ! -L $runtime_record && $(file_mode "$runtime_record") == 600 ]] \
    || return 1
  jq -e '
    type == "object" and
    keys == ["candidateContainerId", "imageId", "releaseId", "revision", "schema", "stateSha256"] and
    .schema == "evo-v3-candidate-runtime/v1" and
    all(.[]; type == "string")
  ' "$runtime_record" >/dev/null 2>&1 || return 1
  state_hash=$(sha256sum "$state_file" | awk '{print $1}') || return 1
  [[ $(jq -er '.stateSha256' "$runtime_record") == "$state_hash" ]] || return 1
  [[ $(jq -er '.releaseId' "$runtime_record") == $(jq -er '.releaseId' "$state_file") ]] \
    || return 1
  [[ $(jq -er '.revision' "$runtime_record") == $(jq -er '.revision' "$state_file") ]] \
    || return 1
  [[ $(jq -er '.imageId' "$runtime_record") == $(jq -er '.imageId' "$state_file") ]] \
    || return 1
  bound_candidate_container_id=$(jq -er '.candidateContainerId' "$runtime_record") \
    || return 1
  [[ $bound_candidate_container_id =~ ^[0-9a-f]{12,64}$ ]]
}

rollback_from_state() {
  local state_file=$1 directory pending current_pointer mode='' runtime_already_restored=false
  directory=$(dirname "$state_file")
  pending=$EVO_RELEASE_EVIDENCE_ROOT/pending-current.json
  current_pointer=$EVO_RELEASE_EVIDENCE_ROOT/current-v3-accepted.json
  local release_id target_image target_revision target_version target_container
  local previous_generation previous_image previous_revision previous_version rollback_tag compose_hash app_env_hash
  local previous_pointer_hash actual_hash override previous_compose previous_app_env current_image current_revision current_version
  local previous_pointer='' pointer_payload=''
  local candidate_compose_file candidate_app_env_snapshot candidate_app_env_sha256
  verify_rollback_state_contract "$state_file" || return 1
  release_id=$(jq -er '.releaseId' "$state_file") || return 1
  target_image=$(jq -er '.imageId' "$state_file") || return 1
  target_revision=$(jq -er '.revision' "$state_file") || return 1
  target_version=$(jq -er '.version' "$state_file") || return 1
  target_container=''
  if load_candidate_runtime_record "$state_file"; then
    target_container=$bound_candidate_container_id
  fi
  previous_generation=$(jq -er '.previous.generation' "$state_file") || return 1
  previous_image=$(jq -er '.previous.imageId' "$state_file") || return 1
  previous_revision=$(jq -er '.previous.revision' "$state_file") || return 1
  previous_version=$(jq -er '.previous.version' "$state_file") || return 1
  rollback_tag=$(jq -er '.rollbackTag' "$state_file") || return 1
  previous_pointer_hash=$(jq -er '.previous.acceptedPointerSha256' "$state_file") || return 1
  require_match "$release_id" "$SAFE_NAME_RE" "rollback_release_id_invalid"
  require_match "$target_image" "$SHA256_RE" "rollback_target_image_invalid"
  require_match "$target_revision" "$SHA40_RE" "rollback_target_revision_invalid"
  require_match "$target_version" "$VERSION_RE" "rollback_target_version_invalid"

  if verify_pending_for_state "$state_file"; then
    mode=pending
    require_pointer_hash "$current_pointer" "$previous_pointer_hash" || return 1
  elif [[ ! -e $pending && -f $current_pointer ]] \
    && [[ $(jq -er '.releaseId' "$current_pointer" 2>/dev/null || true) == "$release_id" ]] \
    && [[ $previous_generation == v3 ]]; then
    mode=accepted
    local acceptance_record=$directory/v3-acceptance-record.json acceptance_hash
    [[ $(jq -er '.revision' "$current_pointer" 2>/dev/null || true) == "$target_revision" ]] \
      || return 1
    [[ $(jq -er '.acceptanceRecord' "$current_pointer" 2>/dev/null || true) == "$release_id/v3-acceptance-record.json" ]] \
      || return 1
    [[ -f $acceptance_record && ! -L $acceptance_record ]] || return 1
    acceptance_hash=$(sha256sum "$acceptance_record" | awk '{print $1}') || return 1
    [[ $acceptance_hash == $(jq -er '.acceptanceRecordSha256' "$current_pointer" 2>/dev/null || true) ]] \
      || return 1
    [[ $(jq -er '.imageId' "$acceptance_record" 2>/dev/null || true) == "$target_image" ]] \
      || return 1
  else
    return 1
  fi

  candidate_compose_file=$directory/docker-compose.candidate.yml
  compose_hash=$(jq -er '.composeSha256' "$state_file") || return 1
  [[ -f $candidate_compose_file && ! -L $candidate_compose_file ]] || return 1
  actual_hash=$(sha256sum "$candidate_compose_file" | awk '{print $1}') || return 1
  [[ $actual_hash == "$compose_hash" ]] || return 1
  candidate_app_env_snapshot=$directory/candidate-app.env
  candidate_app_env_sha256=$(jq -er '.appEnvSha256' "$state_file") || return 1
  require_app_env_snapshot "$candidate_app_env_snapshot" "$candidate_app_env_sha256" || return 1

  current_app_container_id=''
  verify_current_runtime_identity || return 1
  EVO_RELEASE_REVISION=$target_revision EVO_RELEASE_VERSION=$target_version \
    verify_runtime_waha_image || return 1
  EVO_RELEASE_REVISION=$target_revision EVO_RELEASE_VERSION=$target_version \
    verify_networks || return 1
  if [[ -n $current_app_container_id ]]; then
    current_image=$(docker inspect --format '{{.Image}}' "$current_app_container_id" 2>/dev/null || true)
    current_revision=$(container_label "$current_app_container_id" 'org.opencontainers.image.revision' 2>/dev/null || true)
    current_version=$(container_label "$current_app_container_id" 'org.opencontainers.image.version' 2>/dev/null || true)
    if [[ $current_image == "$target_image" && $current_revision == "$target_revision" && $current_version == "$target_version" ]]; then
      if [[ -n $target_container && $current_app_container_id != "$target_container" ]]; then
        return 1
      fi
    elif [[ $previous_generation != none && $current_image == "$previous_image" && $current_revision == "$previous_revision" && $current_version == "$previous_version" ]]; then
      if [[ $mode == accepted && $previous_generation == v3 ]]; then
        runtime_already_restored=true
      elif [[ $mode != pending ]]; then
        return 1
      fi
    else
      return 1
    fi
  elif [[ $mode != pending ]]; then
    return 1
  fi

  if [[ $previous_generation == none ]]; then
    [[ $mode == pending ]] || return 1
    if [[ -n $current_app_container_id ]]; then
      EVO_RELEASE_REVISION=$target_revision EVO_RELEASE_VERSION=$target_version \
      compose_with_app_env "$candidate_app_env_snapshot" "$candidate_app_env_sha256" "$candidate_compose_file" \
        stop app >/dev/null || return 1
      EVO_RELEASE_REVISION=$target_revision EVO_RELEASE_VERSION=$target_version \
      compose_with_app_env "$candidate_app_env_snapshot" "$candidate_app_env_sha256" "$candidate_compose_file" \
        rm --force --stop app >/dev/null || return 1
    fi
    verify_current_runtime || return 1
    [[ -z $current_app_container_id ]] || return 1
  else
    compose_hash=$(jq -er '.previous.composeSha256' "$state_file") || return 1
    app_env_hash=$(jq -er '.previous.appEnvSha256' "$state_file") || return 1
    [[ $rollback_tag =~ ^evo-crm:rollback-[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ ]] || return 1
    [[ $compose_hash =~ $HASH64_RE && $app_env_hash =~ $HASH64_RE ]] || return 1
    previous_compose=$directory/docker-compose.previous.yml
    previous_app_env=$directory/rollback-app.env
    [[ -f $previous_compose && ! -L $previous_compose ]] || return 1
    actual_hash=$(sha256sum "$previous_compose" | awk '{print $1}') || return 1
    [[ $actual_hash == "$compose_hash" ]] || return 1
    require_app_env_snapshot "$previous_app_env" "$app_env_hash" || return 1
    [[ $(docker image inspect --format '{{.Id}}' "$rollback_tag" 2>/dev/null || true) == "$previous_image" ]] || return 1
    EVO_RELEASE_REVISION=$previous_revision EVO_RELEASE_VERSION=$previous_version \
      compose_with_app_env "$previous_app_env" "$app_env_hash" "$previous_compose" \
      config --quiet >/dev/null 2>&1 || return 1
    if [[ $previous_generation == v3 ]]; then
      previous_pointer=$directory/previous-current-v3-accepted.json
      [[ -f $previous_pointer && ! -L $previous_pointer ]] || return 1
      actual_hash=$(sha256sum "$previous_pointer" | awk '{print $1}') || return 1
      [[ $actual_hash == "$previous_pointer_hash" ]] || return 1
      pointer_payload=$(cat "$previous_pointer") || return 1
    fi
    override=$directory/rollback.override.yml
    printf 'services:\n  app:\n    image: "%s"\n    labels:\n      org.opencontainers.image.revision: "%s"\n      org.opencontainers.image.version: "%s"\n' \
      "$rollback_tag" "$previous_revision" "$previous_version" >"$override" || return 1
    chmod 600 "$override" || return 1
    if [[ $runtime_already_restored != true ]]; then
      EVO_RELEASE_REVISION=$previous_revision EVO_RELEASE_VERSION=$previous_version \
        EVO_CRM_APP_ENV_FILE="$previous_app_env" docker compose \
        --ansi never --project-name "$EVO_RELEASE_PROJECT_NAME" \
        --file "$previous_compose" --file "$override" --env-file "$previous_app_env" \
        up --detach --no-deps --no-build --pull never --wait --wait-timeout 120 app >/dev/null || return 1
    fi
    verify_transition_runtime \
      "$previous_compose" "$previous_revision" "$previous_version" "$previous_image" \
      "$previous_app_env" "$app_env_hash" || return 1
    verify_external_health || return 1
    if [[ $mode == accepted ]]; then
      runtime_already_restored=true
    fi
  fi

  if [[ $mode == pending ]]; then
    verify_pending_for_state "$state_file" || return 1
    unlink "$pending" || return 1
    sync -f "$EVO_RELEASE_EVIDENCE_ROOT" || return 1
  else
    [[ $runtime_already_restored == true && -n $previous_pointer && -n $pointer_payload ]] \
      || return 1
    replace_json_atomically "$current_pointer" "$pointer_payload" || return 1
  fi
}

load_bound_release_state() {
  release_evidence_dir=$EVO_RELEASE_EVIDENCE_ROOT/$EVO_RELEASE_ID
  local state_file=$release_evidence_dir/state.json actual_hash expected_hash expected
  require_file "$state_file" "release_state_missing"
  verify_rollback_state_contract "$state_file" || fail "release_state_contract_invalid"
  for field in repository releaseId releaseRunId workflowRunId workflowRunAttempt upstreamCiRunId upstreamCiRunAttempt artifactId artifactDigest revision version imageId imageConfigDigest imageSource archiveSha256 composeSha256; do
    case "$field" in
      repository) expected=${EVO_RELEASE_REPOSITORY} ;;
      releaseId) expected=${EVO_RELEASE_ID} ;;
      releaseRunId) expected=${EVO_RELEASE_RUN_ID} ;;
      workflowRunId) expected=${EVO_RELEASE_WORKFLOW_RUN_ID} ;;
      workflowRunAttempt) expected=${EVO_RELEASE_WORKFLOW_RUN_ATTEMPT} ;;
      upstreamCiRunId) expected=${EVO_RELEASE_UPSTREAM_CI_RUN_ID} ;;
      upstreamCiRunAttempt) expected=${EVO_RELEASE_UPSTREAM_CI_RUN_ATTEMPT} ;;
      artifactId) expected=${EVO_RELEASE_ARTIFACT_ID} ;;
      artifactDigest) expected=${EVO_RELEASE_ARTIFACT_DIGEST} ;;
      revision) expected=${EVO_RELEASE_REVISION} ;;
      version) expected=${EVO_RELEASE_VERSION} ;;
      imageId) expected=${candidate_expected_image_id} ;;
      imageConfigDigest) expected=${EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST} ;;
      imageSource) expected=https://github.com/${EVO_RELEASE_REPOSITORY} ;;
      archiveSha256) expected=${EVO_RELEASE_ARCHIVE_SHA256} ;;
      composeSha256) expected=${EVO_RELEASE_EXPECTED_COMPOSE_SHA256} ;;
    esac
    [[ $(jq -er ".${field}" "$state_file") == "$expected" ]] \
      || fail "release_state_identity_mismatch"
  done
  [[ $(jq -er '.generation' "$state_file") == v3 ]] || fail "release_generation_invalid"
  candidate_app_env_snapshot=$release_evidence_dir/candidate-app.env
  candidate_app_env_sha256=$(jq -er '.appEnvSha256' "$state_file") \
    || fail "release_state_contract_invalid"
  candidate_compose_file=$release_evidence_dir/docker-compose.candidate.yml
  require_app_env_snapshot "$candidate_app_env_snapshot" "$candidate_app_env_sha256"
  actual_hash=$(sha256sum "$candidate_compose_file" | awk '{print $1}') \
    || fail "candidate_compose_missing"
  [[ $actual_hash == "$EVO_RELEASE_EXPECTED_COMPOSE_SHA256" ]] \
    || fail "candidate_compose_drift"
  expected_hash=$(jq -er '.controllerSha256' "$state_file") \
    || fail "release_state_contract_invalid"
  actual_hash=$(sha256sum "$release_evidence_dir/controller/evo-fast-release.sh" | awk '{print $1}') \
    || fail "release_controller_missing"
  [[ $actual_hash == "$expected_hash" ]] || fail "release_controller_drift"
  expected_hash=$(jq -er '.rollbackWrapperSha256' "$state_file") \
    || fail "release_state_contract_invalid"
  actual_hash=$(sha256sum "$release_evidence_dir/rollback-command.sh" | awk '{print $1}') \
    || fail "rollback_wrapper_missing"
  [[ $actual_hash == "$expected_hash" ]] || fail "rollback_wrapper_drift"
}

verify_bound_candidate_identity() {
  local state_file=$release_evidence_dir/state.json container expected_container
  load_candidate_runtime_record "$state_file" || fail "candidate_runtime_record_invalid"
  expected_container=$bound_candidate_container_id
  require_match "$expected_container" '^[0-9a-f]{12,64}$' "candidate_container_missing"
  verify_transition_runtime_identity \
    "$candidate_compose_file" \
    "$EVO_RELEASE_REVISION" \
    "$EVO_RELEASE_VERSION" \
    "$candidate_expected_image_id" \
    "$candidate_app_env_snapshot" \
    "$candidate_app_env_sha256"
  container=$(app_container_id) || fail "candidate_container_missing"
  [[ $container == "$expected_container" ]] || fail "candidate_container_drift"
}

verify_running_bound_candidate() {
  verify_bound_candidate_identity
  verify_current_runtime
  verify_external_health || fail "external_health_failed"
}

verify_browser_receipt() {
  require_variable EVO_RELEASE_BROWSER_RECEIPT
  require_variable EVO_RELEASE_BROWSER_RECEIPT_SHA256
  require_absolute_path "$EVO_RELEASE_BROWSER_RECEIPT" "browser_receipt_path_invalid"
  [[ $EVO_RELEASE_BROWSER_RECEIPT == "$release_evidence_dir/browser-receipt.json" ]] \
    || fail "browser_receipt_path_invalid"
  require_file "$EVO_RELEASE_BROWSER_RECEIPT" "browser_receipt_missing"
  [[ $(file_mode "$EVO_RELEASE_BROWSER_RECEIPT") == 600 ]] \
    || fail "browser_receipt_permissions_invalid"
  require_match "$EVO_RELEASE_BROWSER_RECEIPT_SHA256" "$HASH64_RE" "browser_receipt_hash_invalid"
  local actual_hash
  actual_hash=$(sha256sum "$EVO_RELEASE_BROWSER_RECEIPT" | awk '{print $1}') \
    || fail "browser_receipt_hash_invalid"
  [[ $actual_hash == "$EVO_RELEASE_BROWSER_RECEIPT_SHA256" ]] \
    || fail "browser_receipt_hash_mismatch"
  jq -e '
    type == "object" and
    keys == ["artifactDigest", "artifactId", "releaseId", "repository", "result", "revision", "schema", "workflowRunAttempt", "workflowRunId"] and
    .schema == "evo-v3-browser-receipt/v1" and
    .result == "passed" and
    all(.[]; type == "string")
  ' "$EVO_RELEASE_BROWSER_RECEIPT" >/dev/null 2>&1 \
    || fail "browser_receipt_contract_invalid"
  for field in releaseId repository revision workflowRunId workflowRunAttempt artifactId artifactDigest; do
    [[ $(jq -er ".${field}" "$EVO_RELEASE_BROWSER_RECEIPT") == $(jq -er ".${field}" "$release_evidence_dir/state.json") ]] \
      || fail "browser_receipt_identity_mismatch"
  done
}

pointer_names_bound_acceptance() {
  local pointer=$EVO_RELEASE_EVIDENCE_ROOT/current-v3-accepted.json
  [[ -f $pointer && ! -L $pointer ]] || return 1
  jq -e --arg releaseId "$EVO_RELEASE_ID" --arg revision "$EVO_RELEASE_REVISION" '
    type == "object" and
    keys == ["acceptanceRecord", "acceptanceRecordSha256", "generation", "releaseId", "revision", "schema"] and
    .schema == "evo-v3-current-accepted/v1" and
    .generation == "v3" and
    .releaseId == $releaseId and
    .revision == $revision and
    .acceptanceRecord == ($releaseId + "/v3-acceptance-record.json") and
    (.acceptanceRecordSha256 | test("^[0-9a-f]{64}$"))
  ' "$pointer" >/dev/null 2>&1 || return 1
  local record=$release_evidence_dir/v3-acceptance-record.json actual_hash
  [[ -f $record && ! -L $record ]] || return 1
  actual_hash=$(sha256sum "$record" | awk '{print $1}') || return 1
  [[ $actual_hash == $(jq -er '.acceptanceRecordSha256' "$pointer") ]] || return 1
  jq -e --arg releaseId "$EVO_RELEASE_ID" --arg revision "$EVO_RELEASE_REVISION" '
    type == "object" and
    keys == ["actorId", "appEnvSha256", "appEnvSnapshot", "archiveSha256", "artifactDigest", "artifactId", "browserReceiptSha256", "candidateContainerId", "composeSha256", "composeSnapshot", "currentMainRevision", "generation", "imageConfigDigest", "imageId", "imageSource", "preparedEvidence", "previous", "releaseId", "releaseRunId", "repository", "revision", "schema", "upstreamCiRunAttempt", "upstreamCiRunId", "version", "workflowRunAttempt", "workflowRunId"] and
    .schema == "evo-v3-acceptance-record/v1" and
    .preparedEvidence == true and
    .generation == "v3" and
    .releaseId == $releaseId and
    .revision == $revision and
    .currentMainRevision == $revision
  ' "$record" >/dev/null 2>&1
}

candidate_status() {
  require_release_runtime_commands
  load_configuration
  load_candidate_configuration
  acquire_release_lock
  load_bound_release_state
  verify_bound_candidate_identity
  if pointer_names_bound_acceptance; then
    if [[ -e $EVO_RELEASE_EVIDENCE_ROOT/pending-current.json ]]; then
      verify_pending_for_state "$release_evidence_dir/state.json" \
        || fail "accepted_pending_mismatch"
    fi
    jq -cn --arg releaseId "$EVO_RELEASE_ID" --arg revision "$EVO_RELEASE_REVISION" \
      '{ok:true,command:"candidate-status",status:"accepted",releaseId:$releaseId,revision:$revision}'
  elif verify_pending_for_state "$release_evidence_dir/state.json"; then
    jq -cn --arg releaseId "$EVO_RELEASE_ID" --arg revision "$EVO_RELEASE_REVISION" \
      '{ok:true,command:"candidate-status",status:"pending",releaseId:$releaseId,revision:$revision}'
  else
    fail "candidate_authority_unknown"
  fi
}

derive_acceptance_payload() {
  local state_file=$1
  jq -c \
    --arg actorId "$EVO_RELEASE_ACTOR_ID" \
    --arg browserReceiptSha256 "$EVO_RELEASE_BROWSER_RECEIPT_SHA256" \
    --arg candidateContainerId "$bound_candidate_container_id" \
    --arg currentMainRevision "$EVO_RELEASE_CURRENT_MAIN_REVISION" '
      {
        schema:"evo-v3-acceptance-record/v1",
        preparedEvidence:true,
        generation:.generation,
        repository:.repository,
        releaseId:.releaseId,
        releaseRunId:.releaseRunId,
        workflowRunId:.workflowRunId,
        workflowRunAttempt:.workflowRunAttempt,
        upstreamCiRunId:.upstreamCiRunId,
        upstreamCiRunAttempt:.upstreamCiRunAttempt,
        artifactId:.artifactId,
        artifactDigest:.artifactDigest,
        revision:.revision,
        version:.version,
        imageId:.imageId,
        imageConfigDigest:.imageConfigDigest,
        imageSource:.imageSource,
        archiveSha256:.archiveSha256,
        composeSnapshot:.composeSnapshot,
        composeSha256:.composeSha256,
        appEnvSnapshot:.appEnvSnapshot,
        appEnvSha256:.appEnvSha256,
        candidateContainerId:$candidateContainerId,
        actorId:$actorId,
        browserReceiptSha256:$browserReceiptSha256,
        currentMainRevision:$currentMainRevision,
        previous:.previous
      }
    ' "$state_file"
}

accept_candidate() {
  require_release_runtime_commands
  load_configuration
  load_candidate_configuration
  require_variable EVO_RELEASE_ACTOR_ID
  require_variable EVO_RELEASE_CURRENT_MAIN_REVISION
  require_match "$EVO_RELEASE_ACTOR_ID" "$POSITIVE_INT_RE" "accept_actor_id_invalid"
  [[ $EVO_RELEASE_CURRENT_MAIN_REVISION == "$EVO_RELEASE_REVISION" ]] \
    || fail "accept_current_main_mismatch"
  acquire_release_lock
  load_bound_release_state
  local state_file=$release_evidence_dir/state.json pending=$EVO_RELEASE_EVIDENCE_ROOT/pending-current.json
  local current_pointer=$EVO_RELEASE_EVIDENCE_ROOT/current-v3-accepted.json
  verify_running_bound_candidate
  verify_browser_receipt
  local acceptance_payload acceptance_record actual_payload
  acceptance_record=$release_evidence_dir/v3-acceptance-record.json
  acceptance_payload=$(derive_acceptance_payload "$state_file") \
    || fail "acceptance_record_create_failed"

  if pointer_names_bound_acceptance; then
    actual_payload=$(jq -c . "$acceptance_record" 2>/dev/null) \
      || fail "acceptance_record_invalid"
    [[ $actual_payload == "$acceptance_payload" ]] || fail "acceptance_record_mismatch"
    verify_pending_for_state "$state_file" || {
      [[ ! -e $pending ]] || fail "accepted_pending_mismatch"
      jq -cn --arg releaseId "$EVO_RELEASE_ID" --arg revision "$EVO_RELEASE_REVISION" \
        '{ok:true,command:"accept-candidate",status:"accepted",releaseId:$releaseId,revision:$revision}'
      return 0
    }
    unlink "$pending" || fail "accepted_pending_cleanup_failed"
    sync -f "$EVO_RELEASE_EVIDENCE_ROOT" || fail "accepted_pending_cleanup_failed"
    jq -cn --arg releaseId "$EVO_RELEASE_ID" --arg revision "$EVO_RELEASE_REVISION" \
      '{ok:true,command:"accept-candidate",status:"accepted",releaseId:$releaseId,revision:$revision}'
    return 0
  fi

  verify_pending_for_state "$state_file" || fail "pending_state_invalid"
  local previous_pointer_hash acceptance_hash pointer_payload
  previous_pointer_hash=$(jq -er '.previous.acceptedPointerSha256' "$state_file") \
    || fail "release_state_contract_invalid"
  require_pointer_hash "$current_pointer" "$previous_pointer_hash" \
    || fail "accepted_authority_superseded"
  if [[ -e $acceptance_record ]]; then
    actual_payload=$(jq -c . "$acceptance_record" 2>/dev/null) \
      || fail "acceptance_record_invalid"
    [[ $actual_payload == "$acceptance_payload" ]] || fail "acceptance_record_mismatch"
  else
    create_once_json "$acceptance_record" "$acceptance_payload" \
      || fail "acceptance_record_create_failed"
  fi
  acceptance_hash=$(sha256sum "$acceptance_record" | awk '{print $1}') \
    || fail "acceptance_record_hash_failed"

  verify_running_bound_candidate
  verify_browser_receipt
  verify_pending_for_state "$state_file" || fail "pending_state_invalid"
  require_pointer_hash "$current_pointer" "$previous_pointer_hash" \
    || fail "accepted_authority_superseded"
  pointer_payload=$(jq -cn \
    --arg releaseId "$EVO_RELEASE_ID" \
    --arg revision "$EVO_RELEASE_REVISION" \
    --arg acceptanceRecord "$EVO_RELEASE_ID/v3-acceptance-record.json" \
    --arg acceptanceRecordSha256 "$acceptance_hash" \
    '{schema:"evo-v3-current-accepted/v1",generation:"v3",releaseId:$releaseId,revision:$revision,acceptanceRecord:$acceptanceRecord,acceptanceRecordSha256:$acceptanceRecordSha256}') \
    || fail "accepted_pointer_create_failed"
  replace_json_atomically "$current_pointer" "$pointer_payload" \
    || fail "accepted_pointer_create_failed"
  pointer_names_bound_acceptance || fail "accepted_pointer_verify_failed"
  unlink "$pending" || fail "accepted_pending_cleanup_failed"
  sync -f "$EVO_RELEASE_EVIDENCE_ROOT" || fail "accepted_pending_cleanup_failed"
  jq -cn --arg releaseId "$EVO_RELEASE_ID" --arg revision "$EVO_RELEASE_REVISION" \
    '{ok:true,command:"accept-candidate",status:"accepted",releaseId:$releaseId,revision:$revision}'
}

disarm_release_mutation_trap() {
  release_mutation_armed=false
  trap - HUP INT TERM EXIT
}

release_signal_exit() {
  local signal_name=$1 signal_status
  case "$signal_name" in
    HUP) signal_status=129 ;;
    INT) signal_status=130 ;;
    TERM) signal_status=143 ;;
    *) signal_status=125 ;;
  esac
  exit "$signal_status"
}

release_exit_rollback() {
  local exit_status=$?
  trap - HUP INT TERM EXIT
  if [[ $release_mutation_armed != true ]]; then
    exit "$exit_status"
  fi
  release_mutation_armed=false

  if rollback_from_state "$release_mutation_state"; then
    write_result "$release_mutation_evidence_dir" "blocked" "deployment_interrupted" true || true
    jq -cn --arg evidenceDir "$release_mutation_evidence_dir" \
      '{ok:false,command:"deploy",status:"rolled_back",code:"deployment_interrupted",evidenceDir:$evidenceDir}' \
      || true
  else
    write_result "$release_mutation_evidence_dir" "blocked" "rollback_failed" false || true
    jq -cn --arg evidenceDir "$release_mutation_evidence_dir" \
      '{ok:false,command:"deploy",status:"rollback_failed",code:"rollback_failed",evidenceDir:$evidenceDir}' \
      || true
  fi

  [[ $exit_status -ne 0 ]] || exit_status=125
  exit "$exit_status"
}

arm_release_mutation_trap() {
  release_mutation_state=$1
  release_mutation_evidence_dir=$2
  release_mutation_armed=true
  trap 'release_signal_exit HUP' HUP
  trap 'release_signal_exit INT' INT
  trap 'release_signal_exit TERM' TERM
  trap 'release_exit_rollback' EXIT
}

deploy() {
  require_release_runtime_commands
  load_configuration
  load_candidate_configuration
  acquire_release_lock
  release_evidence_dir=$EVO_RELEASE_EVIDENCE_ROOT/$EVO_RELEASE_ID
  prepare_candidate_generation "$release_evidence_dir"
  run_preflight_checks
  load_candidate_image
  create_rollback_wrapper "$release_evidence_dir"
  create_rollback_state "$release_evidence_dir"

  arm_release_mutation_trap "$release_evidence_dir/state.json" "$release_evidence_dir"
  if EVO_RELEASE_REVISION=$EVO_RELEASE_REVISION \
    EVO_RELEASE_VERSION=$EVO_RELEASE_VERSION \
    compose up --detach --no-deps --no-build --pull never --wait --wait-timeout 120 app >/dev/null; then
    local installed_container
    installed_container=$(app_container_id) || fail "candidate_container_missing"
    record_candidate_container "$release_evidence_dir/state.json" "$installed_container"
    if verify_transition_runtime \
      "$candidate_compose_file" \
      "$EVO_RELEASE_REVISION" \
      "$EVO_RELEASE_VERSION" \
      "$candidate_expected_image_id" \
      "$candidate_app_env_snapshot" \
      "$candidate_app_env_sha256" \
      && verify_external_health; then
      write_result "$release_evidence_dir" "pending" "verified" false
      disarm_release_mutation_trap
      jq -cn --arg evidenceDir "$release_evidence_dir" --arg releaseId "$EVO_RELEASE_ID" \
        '{ok:true,command:"deploy",status:"pending",releaseId:$releaseId,evidenceDir:$evidenceDir}'
      return 0
    fi
  fi

  if rollback_from_state "$release_evidence_dir/state.json"; then
    write_result "$release_evidence_dir" "blocked" "deployment_failed" true
    disarm_release_mutation_trap
    jq -cn --arg evidenceDir "$release_evidence_dir" \
      '{ok:false,command:"deploy",status:"rolled_back",code:"deployment_failed",evidenceDir:$evidenceDir}'
    return 3
  fi
  write_result "$release_evidence_dir" "blocked" "rollback_failed" false
  disarm_release_mutation_trap
  jq -cn --arg evidenceDir "$release_evidence_dir" \
    '{ok:false,command:"deploy",status:"rollback_failed",code:"rollback_failed",evidenceDir:$evidenceDir}'
  return 4
}

manual_rollback() {
  require_release_runtime_commands
  load_configuration
  acquire_release_lock
  require_variable EVO_RELEASE_ROLLBACK_STATE
  require_variable EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID
  require_absolute_path "$EVO_RELEASE_ROLLBACK_STATE" "rollback_state_path_invalid"
  require_file "$EVO_RELEASE_ROLLBACK_STATE" "rollback_state_missing"
  require_match "$EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID" "$SAFE_NAME_RE" "rollback_release_id_invalid"
  local state_real evidence_real release_id expected_state
  state_real=$(canonical_path "$EVO_RELEASE_ROLLBACK_STATE")
  evidence_real=$(canonical_path "$EVO_RELEASE_EVIDENCE_ROOT")
  expected_state=$evidence_real/$EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID/state.json
  [[ $state_real == "$expected_state" ]] || fail "rollback_state_outside_evidence"
  verify_rollback_state_contract "$state_real" || fail "rollback_state_contract_invalid"
  release_id=$(jq -er '.releaseId' "$state_real") || fail "rollback_state_contract_invalid"
  [[ $release_id == "$EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID" ]] \
    || fail "rollback_release_id_mismatch"

  if rollback_from_state "$state_real"; then
    jq -cn --arg releaseId "$release_id" \
      '{ok:true,command:"rollback",status:"rolled_back",releaseId:$releaseId}'
    return 0
  fi
  fail "rollback_failed"
}

rollback_pending_candidate() {
  require_release_runtime_commands
  load_configuration
  acquire_release_lock
  require_variable EVO_RELEASE_ROLLBACK_STATE
  require_variable EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID
  require_absolute_path "$EVO_RELEASE_ROLLBACK_STATE" "rollback_state_path_invalid"
  require_file "$EVO_RELEASE_ROLLBACK_STATE" "rollback_state_missing"
  require_match "$EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID" "$SAFE_NAME_RE" "rollback_release_id_invalid"
  local state_real evidence_real release_id expected_state current_pointer previous_pointer_hash
  state_real=$(canonical_path "$EVO_RELEASE_ROLLBACK_STATE")
  evidence_real=$(canonical_path "$EVO_RELEASE_EVIDENCE_ROOT")
  expected_state=$evidence_real/$EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID/state.json
  [[ $state_real == "$expected_state" ]] || fail "rollback_state_outside_evidence"
  verify_rollback_state_contract "$state_real" || fail "rollback_state_contract_invalid"
  release_id=$(jq -er '.releaseId' "$state_real") || fail "rollback_state_contract_invalid"
  [[ $release_id == "$EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID" ]] \
    || fail "rollback_release_id_mismatch"

  verify_pending_for_state "$state_real" || fail "pending_candidate_not_current"
  current_pointer=$EVO_RELEASE_EVIDENCE_ROOT/current-v3-accepted.json
  previous_pointer_hash=$(jq -er '.previous.acceptedPointerSha256' "$state_real") \
    || fail "rollback_state_contract_invalid"
  require_pointer_hash "$current_pointer" "$previous_pointer_hash" \
    || fail "pending_candidate_superseded"
  if rollback_from_state "$state_real"; then
    jq -cn --arg releaseId "$release_id" \
      '{ok:true,command:"rollback-pending",status:"rolled_back",releaseId:$releaseId}'
    return 0
  fi
  fail "pending_candidate_rollback_failed"
}

case "$command_name" in
  status)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    safe_status
    ;;
  preflight)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    preflight
    ;;
  seal-rollback-seed)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    seal_rollback_seed
    ;;
  deploy)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    deploy
    ;;
  candidate-status)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    candidate_status
    ;;
  accept-candidate)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    accept_candidate
    ;;
  rollback-pending)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    rollback_pending_candidate
    ;;
  rollback)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    manual_rollback
    ;;
  *)
    fail "invalid_command"
    ;;
esac
