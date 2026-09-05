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
readonly PROJECT_NAME_RE='^[a-z0-9][a-z0-9_-]{0,99}$'
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
  require_match "$EVO_WAHA_IMAGE_DIGEST" "$SHA256_RE" "waha_digest_invalid"

  EVO_RELEASE_ACTIVE_COMPOSE_FILE=${EVO_RELEASE_ACTIVE_COMPOSE_FILE:-$EVO_RELEASE_COMPOSE_FILE}
  require_absolute_path "$EVO_RELEASE_ACTIVE_COMPOSE_FILE" "active_compose_path_invalid"
  if [[ -n ${EVO_RELEASE_ROLLBACK_SEED-} ]]; then
    require_absolute_path "$EVO_RELEASE_ROLLBACK_SEED" "rollback_seed_path_invalid"
  fi

  export EVO_CRM_APP_ENV_FILE=$EVO_RELEASE_APP_ENV_FILE
  export EVO_CRM_WAHA_ENV_FILE=${EVO_CRM_WAHA_ENV_FILE:-$EVO_RELEASE_ROOT/.env.waha}
}

load_candidate_configuration() {
  local variable
  for variable in \
    EVO_RELEASE_REVISION \
    EVO_RELEASE_VERSION \
    EVO_RELEASE_RUN_ID \
    EVO_RELEASE_ARCHIVE \
    EVO_RELEASE_ARCHIVE_SHA256 \
    EVO_RELEASE_EXPECTED_IMAGE_ID \
    EVO_RELEASE_EXPECTED_COMPOSE_SHA256; do
    require_variable "$variable"
  done

  require_match "$EVO_RELEASE_REVISION" "$SHA40_RE" "target_revision_invalid"
  require_match "$EVO_RELEASE_VERSION" "$VERSION_RE" "target_version_invalid"
  require_match "$EVO_RELEASE_RUN_ID" "$SAFE_NAME_RE" "run_id_invalid"
  require_absolute_path "$EVO_RELEASE_ARCHIVE" "archive_path_invalid"
  require_match "$EVO_RELEASE_ARCHIVE_SHA256" "$HASH64_RE" "archive_hash_invalid"
  require_match "$EVO_RELEASE_EXPECTED_IMAGE_ID" "$SHA256_RE" "candidate_image_id_invalid"
  require_match "$EVO_RELEASE_EXPECTED_COMPOSE_SHA256" "$HASH64_RE" "compose_hash_invalid"
  readonly candidate_expected_image_id="$EVO_RELEASE_EXPECTED_IMAGE_ID"

  local archive_real transfer_real
  require_file "$EVO_RELEASE_ARCHIVE" "archive_missing"
  archive_real=$(canonical_path "$EVO_RELEASE_ARCHIVE")
  transfer_real=$(canonical_path "$EVO_RELEASE_TRANSFER_ROOT")
  [[ $archive_real == "$transfer_real/"* ]] || fail "archive_outside_transfer"
}

compose() {
  docker compose \
    --ansi never \
    --project-name "$EVO_RELEASE_PROJECT_NAME" \
    --file "$EVO_RELEASE_COMPOSE_FILE" \
    --env-file "$EVO_RELEASE_APP_ENV_FILE" \
    "$@"
}

verify_env_contract() {
  local example_file=${EVO_RELEASE_ENV_EXAMPLE_FILE:-$EVO_RELEASE_ROOT/deploy/env.production.example}
  local script_dir validator
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  validator=$script_dir/evo-app-env-contract.mjs
  require_file "$example_file" "env_example_missing"
  require_file "$EVO_RELEASE_APP_ENV_FILE" "app_env_missing"
  require_file "$validator" "app_env_validator_missing"
  local mode
  mode=$(file_mode "$EVO_RELEASE_APP_ENV_FILE")
  [[ $mode == 600 || $mode == 640 ]] || fail "app_env_permissions_invalid"
  node "$validator" \
    --example "$example_file" \
    --env "$EVO_RELEASE_APP_ENV_FILE" \
    >/dev/null || fail "app_env_contract_invalid"
}

verify_current_runtime() {
  local ids id service services health restarts
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

  for service in $services; do
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

verify_transition_runtime() (
  set -Eeuo pipefail
  local EVO_RELEASE_COMPOSE_FILE=$1
  local EVO_RELEASE_REVISION=$2
  local EVO_RELEASE_VERSION=$3
  local expected_image=$4
  local container actual_image actual_revision actual_version

  require_file "$EVO_RELEASE_COMPOSE_FILE" "runtime_compose_missing"
  require_match "$EVO_RELEASE_REVISION" "$SHA40_RE" "runtime_revision_invalid"
  require_match "$EVO_RELEASE_VERSION" "$VERSION_RE" "runtime_version_invalid"
  require_match "$expected_image" "$SHA256_RE" "runtime_image_invalid"

  current_app_container_id=''
  verify_current_runtime
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
}

verify_compose() {
  require_file "$EVO_RELEASE_COMPOSE_FILE" "compose_missing"
  local actual_hash services app_image waha_image
  actual_hash=$(sha256sum "$EVO_RELEASE_COMPOSE_FILE" | awk '{print $1}')
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
  local image_revision image_version image_os image_arch
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
  image_revision=$(jq -er '.config.Labels["org.opencontainers.image.revision"]' <<<"$config_json" 2>/dev/null) \
    || fail "candidate_revision_mismatch"
  image_version=$(jq -er '.config.Labels["org.opencontainers.image.version"]' <<<"$config_json" 2>/dev/null) \
    || fail "candidate_version_mismatch"
  image_os=$(jq -er '.os' <<<"$config_json" 2>/dev/null) || fail "candidate_platform_mismatch"
  image_arch=$(jq -er '.architecture' <<<"$config_json" 2>/dev/null) || fail "candidate_platform_mismatch"
  [[ $image_revision == "$EVO_RELEASE_REVISION" ]] || fail "candidate_revision_mismatch"
  [[ $image_version == "$EVO_RELEASE_VERSION" ]] || fail "candidate_version_mismatch"
  [[ $image_os == linux && $image_arch == amd64 ]] || fail "candidate_platform_mismatch"
}

load_candidate_image() {
  local actual_hash candidate_tag image_id image_revision image_version image_os image_arch
  candidate_tag="evo-crm:${EVO_RELEASE_REVISION}"
  actual_hash=$(sha256sum "$EVO_RELEASE_ARCHIVE" | awk '{print $1}') \
    || fail "archive_hash_mismatch"
  [[ $actual_hash == "$EVO_RELEASE_ARCHIVE_SHA256" ]] || fail "archive_hash_mismatch"
  docker image load --input "$EVO_RELEASE_ARCHIVE" >/dev/null || fail "archive_load_failed"
  image_id=$(docker image inspect --format '{{.Id}}' "$candidate_tag" 2>/dev/null || true)
  image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$candidate_tag" 2>/dev/null || true)
  image_version=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$candidate_tag" 2>/dev/null || true)
  image_os=$(docker image inspect --format '{{.Os}}' "$candidate_tag" 2>/dev/null || true)
  image_arch=$(docker image inspect --format '{{.Architecture}}' "$candidate_tag" 2>/dev/null || true)
  [[ $image_id == "$candidate_expected_image_id" ]] || fail "candidate_image_id_mismatch"
  [[ $image_revision == "$EVO_RELEASE_REVISION" ]] || fail "candidate_revision_mismatch"
  [[ $image_version == "$EVO_RELEASE_VERSION" ]] || fail "candidate_version_mismatch"
  [[ $image_os == linux && $image_arch == amd64 ]] || fail "candidate_platform_mismatch"
}

verify_external_health() {
  curl --fail --silent --show-error --max-time 20 --output /dev/null \
    "$EVO_RELEASE_EXTERNAL_HEALTH_URL" || return 1
}

verify_previous_compose() {
  local compose_file=$1 revision=$2 version=$3 services
  require_file "$compose_file" "rollback_compose_missing"
  EVO_RELEASE_REVISION=$revision \
  EVO_RELEASE_VERSION=$version \
  docker compose \
    --ansi never \
    --project-name "$EVO_RELEASE_PROJECT_NAME" \
    --file "$compose_file" \
    --env-file "$EVO_RELEASE_APP_ENV_FILE" \
    config --quiet >/dev/null 2>&1 || fail "rollback_compose_invalid"
  services=$(EVO_RELEASE_REVISION=$revision \
    EVO_RELEASE_VERSION=$version \
    docker compose \
      --ansi never \
      --project-name "$EVO_RELEASE_PROJECT_NAME" \
      --file "$compose_file" \
      --env-file "$EVO_RELEASE_APP_ENV_FILE" \
      config --services 2>/dev/null) || fail "rollback_compose_invalid"
  printf '%s\n' "$services" | awk '$0 == "app" { found = 1 } END { exit !found }' \
    || fail "rollback_compose_app_missing"
}

verify_rollback_seed() {
  require_variable EVO_RELEASE_ROLLBACK_SEED
  require_absolute_path "$EVO_RELEASE_ROLLBACK_SEED" "rollback_seed_path_invalid"
  require_file "$EVO_RELEASE_ROLLBACK_SEED" "rollback_seed_missing"
  local seed_real evidence_real seed_dir previous_compose actual_hash actual_id image_revision image_version image_os image_arch
  seed_real=$(canonical_path "$EVO_RELEASE_ROLLBACK_SEED")
  evidence_real=$(canonical_path "$EVO_RELEASE_EVIDENCE_ROOT")
  [[ $seed_real == "$evidence_real/"*/state.json ]] || fail "rollback_seed_outside_evidence"
  seed_dir=$(dirname "$seed_real")
  previous_compose=$seed_dir/docker-compose.previous.yml
  require_file "$previous_compose" "rollback_compose_missing"
  [[ $(file_mode "$seed_real") == 600 ]] || fail "rollback_seed_permissions_invalid"
  [[ $(file_mode "$previous_compose") == 600 ]] || fail "rollback_compose_permissions_invalid"
  jq -e '
    type == "object" and
    keys == ["appEnvSha256", "composeSha256", "previousImage", "previousRevision", "previousVersion", "schema"] and
    .schema == "evo-release-rollback-seed/v1" and
    all(.[]; type == "string")
  ' "$seed_real" >/dev/null 2>&1 || fail "rollback_seed_contract_invalid"

  rollback_previous_image=$(jq -er '.previousImage' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_previous_revision=$(jq -er '.previousRevision' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_previous_version=$(jq -er '.previousVersion' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_compose_sha256=$(jq -er '.composeSha256' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_app_env_sha256=$(jq -er '.appEnvSha256' "$seed_real") || fail "rollback_seed_contract_invalid"
  rollback_previous_compose=$previous_compose
  require_match "$rollback_previous_image" "$SHA256_RE" "rollback_seed_image_invalid"
  require_match "$rollback_previous_revision" "$SHA40_RE" "rollback_seed_revision_invalid"
  require_match "$rollback_previous_version" "$VERSION_RE" "rollback_seed_version_invalid"
  require_match "$rollback_compose_sha256" "$HASH64_RE" "rollback_seed_compose_hash_invalid"
  require_match "$rollback_app_env_sha256" "$HASH64_RE" "rollback_seed_env_hash_invalid"
  [[ ${EVO_RELEASE_REVISION-} != "$rollback_previous_revision" ]] || fail "rollback_seed_target_collision"
  [[ ${candidate_expected_image_id-} != "$rollback_previous_image" ]] || fail "rollback_seed_target_collision"

  actual_hash=$(sha256sum "$previous_compose" | awk '{print $1}')
  [[ $actual_hash == "$rollback_compose_sha256" ]] || fail "rollback_seed_compose_drift"
  actual_hash=$(sha256sum "$EVO_RELEASE_APP_ENV_FILE" | awk '{print $1}')
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
  verify_previous_compose "$previous_compose" "$rollback_previous_revision" "$rollback_previous_version"
}

verify_rollback_source() {
  rollback_previous_image=''
  rollback_previous_revision=''
  rollback_previous_version=''
  rollback_previous_compose=''
  rollback_compose_sha256=''
  rollback_app_env_sha256=''
  if [[ -z $current_app_container_id ]]; then
    verify_rollback_seed
    return
  fi

  require_file "$EVO_RELEASE_ACTIVE_COMPOSE_FILE" "active_compose_missing"
  rollback_previous_image=$(docker inspect --format '{{.Image}}' "$current_app_container_id")
  rollback_previous_revision=$(container_label "$current_app_container_id" 'org.opencontainers.image.revision')
  rollback_previous_version=$(container_label "$current_app_container_id" 'org.opencontainers.image.version')
  local current_restarts
  current_restarts=$(docker inspect --format '{{.RestartCount}}' "$current_app_container_id")
  require_match "$rollback_previous_image" "$SHA256_RE" "current_image_invalid"
  require_match "$rollback_previous_revision" "$SHA40_RE" "current_revision_invalid"
  require_match "$rollback_previous_version" "$VERSION_RE" "current_version_invalid"
  [[ $rollback_previous_revision != "$EVO_RELEASE_REVISION" && $current_restarts == 0 ]] \
    || fail "current_release_invalid"
  [[ $rollback_previous_image != "$candidate_expected_image_id" ]] || fail "current_release_invalid"
  rollback_previous_compose=$EVO_RELEASE_ACTIVE_COMPOSE_FILE
  rollback_compose_sha256=$(sha256sum "$rollback_previous_compose" | awk '{print $1}')
  rollback_app_env_sha256=$(sha256sum "$EVO_RELEASE_APP_ENV_FILE" | awk '{print $1}')
  verify_previous_compose "$rollback_previous_compose" "$rollback_previous_revision" "$rollback_previous_version"
}

seal_rollback_seed() {
  require_command docker
  require_command jq
  require_command mktemp
  require_command realpath
  require_command sha256sum
  load_configuration
  require_variable EVO_RELEASE_ROLLBACK_SEED
  require_variable EVO_RELEASE_SEED_IMAGE
  require_match "$EVO_RELEASE_SEED_IMAGE" "$SHA256_RE" "rollback_seed_image_invalid"
  require_file "$EVO_RELEASE_ACTIVE_COMPOSE_FILE" "active_compose_missing"
  require_file "$EVO_RELEASE_APP_ENV_FILE" "app_env_missing"
  [[ -d $EVO_RELEASE_EVIDENCE_ROOT && ! -L $EVO_RELEASE_EVIDENCE_ROOT ]] \
    || fail "evidence_root_invalid"
  verify_current_runtime
  [[ -z $current_app_container_id ]] || fail "rollback_seed_not_required"

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
  image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id" 2>/dev/null || true)
  image_version=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image_id" 2>/dev/null || true)
  image_os=$(docker image inspect --format '{{.Os}}' "$image_id" 2>/dev/null || true)
  image_arch=$(docker image inspect --format '{{.Architecture}}' "$image_id" 2>/dev/null || true)
  require_match "$image_revision" "$SHA40_RE" "rollback_seed_revision_invalid"
  require_match "$image_version" "$VERSION_RE" "rollback_seed_version_invalid"
  [[ $image_os == linux && $image_arch == amd64 ]] || fail "rollback_seed_platform_mismatch"
  verify_previous_compose "$EVO_RELEASE_ACTIVE_COMPOSE_FILE" "$image_revision" "$image_version"
  compose_hash=$(sha256sum "$EVO_RELEASE_ACTIVE_COMPOSE_FILE" | awk '{print $1}')
  env_hash=$(sha256sum "$EVO_RELEASE_APP_ENV_FILE" | awk '{print $1}')

  temporary_dir=$(mktemp -d "$evidence_real/.rollback-seed.XXXXXX") \
    || fail "rollback_seed_create_failed"
  chmod 700 "$temporary_dir"
  install -m 600 "$EVO_RELEASE_ACTIVE_COMPOSE_FILE" "$temporary_dir/docker-compose.previous.yml" \
    || fail "rollback_seed_create_failed"
  jq -cn \
    --arg previousImage "$image_id" \
    --arg previousRevision "$image_revision" \
    --arg previousVersion "$image_version" \
    --arg composeSha256 "$compose_hash" \
    --arg appEnvSha256 "$env_hash" \
    '{schema:"evo-release-rollback-seed/v1",previousImage:$previousImage,previousRevision:$previousRevision,previousVersion:$previousVersion,composeSha256:$composeSha256,appEnvSha256:$appEnvSha256}' \
    >"$temporary_dir/state.json" || fail "rollback_seed_create_failed"
  chmod 600 "$temporary_dir/state.json"
  mv -- "$temporary_dir" "$seed_dir" || fail "rollback_seed_create_failed"
  verify_rollback_seed
  jq -cn \
    --arg revision "$image_revision" \
    --arg version "$image_version" \
    '{ok:true,command:"seal-rollback-seed",status:"sealed",revision:$revision,version:$version}'
}

preflight() {
  require_command curl
  require_command docker
  require_command jq
  require_command node
  require_command realpath
  require_command sha256sum
  require_command tar
  load_configuration
  load_candidate_configuration
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
  printf '{"ok":true,"command":"preflight","code":"ready"}\n'
}

write_result() {
  local directory=$1 status=$2 code=$3 rolled_back=$4
  jq -cn \
    --arg status "$status" \
    --arg code "$code" \
    --arg revision "$EVO_RELEASE_REVISION" \
    --arg version "$EVO_RELEASE_VERSION" \
    --arg image "$candidate_expected_image_id" \
    --argjson rolledBack "$rolled_back" \
    '{schema:"evo-fast-release/v1",status:$status,code:$code,revision:$revision,version:$version,image:$image,rolledBack:$rolledBack}' \
    >"$directory/result.json"
  chmod 600 "$directory/result.json"
}

create_rollback_state() {
  local directory=$1 rollback_tag actual_hash
  require_match "$rollback_previous_image" "$SHA256_RE" "rollback_source_invalid"
  require_match "$rollback_previous_revision" "$SHA40_RE" "rollback_source_invalid"
  require_match "$rollback_previous_version" "$VERSION_RE" "rollback_source_invalid"
  require_match "$rollback_compose_sha256" "$HASH64_RE" "rollback_source_invalid"
  require_match "$rollback_app_env_sha256" "$HASH64_RE" "rollback_source_invalid"
  require_file "$rollback_previous_compose" "rollback_compose_missing"
  actual_hash=$(sha256sum "$rollback_previous_compose" | awk '{print $1}')
  [[ $actual_hash == "$rollback_compose_sha256" ]] || fail "rollback_compose_drift"
  actual_hash=$(sha256sum "$EVO_RELEASE_APP_ENV_FILE" | awk '{print $1}')
  [[ $actual_hash == "$rollback_app_env_sha256" ]] || fail "rollback_app_env_drift"
  [[ $(docker image inspect --format '{{.Id}}' "$rollback_previous_image" 2>/dev/null || true) == "$rollback_previous_image" ]] \
    || fail "rollback_image_missing"
  rollback_tag="evo-crm:rollback-${EVO_RELEASE_RUN_ID}"
  docker image inspect "$rollback_tag" >/dev/null 2>&1 && fail "rollback_tag_collision"
  docker tag "$rollback_previous_image" "$rollback_tag" || fail "rollback_tag_failed"
  cp -- "$rollback_previous_compose" "$directory/docker-compose.previous.yml"
  chmod 600 "$directory/docker-compose.previous.yml"
  jq -cn \
    --arg previousImage "$rollback_previous_image" \
    --arg previousRevision "$rollback_previous_revision" \
    --arg previousVersion "$rollback_previous_version" \
    --arg rollbackTag "$rollback_tag" \
    --arg composeSha256 "$rollback_compose_sha256" \
    --arg appEnvSha256 "$rollback_app_env_sha256" \
    --arg targetRevision "$EVO_RELEASE_REVISION" \
    '{schema:"evo-fast-release-state/v1",previousImage:$previousImage,previousRevision:$previousRevision,previousVersion:$previousVersion,rollbackTag:$rollbackTag,composeSha256:$composeSha256,appEnvSha256:$appEnvSha256,targetRevision:$targetRevision}' \
    >"$directory/state.json"
  chmod 600 "$directory/state.json"
}

verify_rollback_state_contract() {
  local state_file=$1
  [[ -f $state_file && ! -L $state_file ]] || return 1
  jq -e '
    type == "object" and
    keys == ["appEnvSha256", "composeSha256", "previousImage", "previousRevision", "previousVersion", "rollbackTag", "schema", "targetRevision"] and
    .schema == "evo-fast-release-state/v1" and
    all(.[]; type == "string")
  ' "$state_file" >/dev/null 2>&1
}

rollback_from_state() {
  local state_file=$1 directory
  directory=$(dirname "$state_file")
  local previous_image previous_revision previous_version rollback_tag compose_hash app_env_hash target_revision actual_hash override previous_compose
  verify_rollback_state_contract "$state_file" || return 1
  previous_image=$(jq -er '.previousImage' "$state_file") || return 1
  previous_revision=$(jq -er '.previousRevision' "$state_file") || return 1
  previous_version=$(jq -er '.previousVersion' "$state_file") || return 1
  rollback_tag=$(jq -er '.rollbackTag' "$state_file") || return 1
  compose_hash=$(jq -er '.composeSha256' "$state_file") || return 1
  app_env_hash=$(jq -er '.appEnvSha256' "$state_file") || return 1
  target_revision=$(jq -er '.targetRevision' "$state_file") || return 1
  [[ $previous_image =~ $SHA256_RE && $previous_revision =~ $SHA40_RE && $previous_version =~ $VERSION_RE ]] || return 1
  [[ $rollback_tag =~ ^evo-crm:rollback-[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ && $compose_hash =~ $HASH64_RE ]] || return 1
  [[ $app_env_hash =~ $HASH64_RE && $target_revision =~ $SHA40_RE && $target_revision != "$previous_revision" ]] || return 1
  previous_compose=$directory/docker-compose.previous.yml
  [[ -f $previous_compose && ! -L $previous_compose ]] || return 1
  actual_hash=$(sha256sum "$previous_compose" | awk '{print $1}')
  [[ $actual_hash == "$compose_hash" ]] || return 1
  actual_hash=$(sha256sum "$EVO_RELEASE_APP_ENV_FILE" | awk '{print $1}')
  [[ $actual_hash == "$app_env_hash" ]] || return 1
  [[ $(docker image inspect --format '{{.Id}}' "$rollback_tag" 2>/dev/null || true) == "$previous_image" ]] || return 1
  EVO_RELEASE_REVISION=$previous_revision \
  EVO_RELEASE_VERSION=$previous_version \
  docker compose \
    --ansi never \
    --project-name "$EVO_RELEASE_PROJECT_NAME" \
    --file "$previous_compose" \
    --env-file "$EVO_RELEASE_APP_ENV_FILE" \
    config --quiet >/dev/null 2>&1 || return 1
  override=$directory/rollback.override.yml
  printf 'services:\n  app:\n    image: "%s"\n    labels:\n      org.opencontainers.image.revision: "%s"\n      org.opencontainers.image.version: "%s"\n' \
    "$rollback_tag" "$previous_revision" "$previous_version" >"$override" || return 1
  chmod 600 "$override" || return 1
  EVO_RELEASE_REVISION=$previous_revision \
  EVO_RELEASE_VERSION=$previous_version \
  docker compose \
    --ansi never \
    --project-name "$EVO_RELEASE_PROJECT_NAME" \
    --file "$previous_compose" \
    --file "$override" \
    --env-file "$EVO_RELEASE_APP_ENV_FILE" \
    up --detach --no-deps --no-build --pull never --wait --wait-timeout 120 app >/dev/null || return 1
  verify_transition_runtime \
    "$previous_compose" \
    "$previous_revision" \
    "$previous_version" \
    "$previous_image" || return 1
  verify_external_health || return 1
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
  load_configuration
  acquire_release_lock
  preflight >/dev/null
  load_candidate_image
  local evidence_dir short_revision
  short_revision=${EVO_RELEASE_REVISION:0:8}
  evidence_dir="$EVO_RELEASE_EVIDENCE_ROOT/${EVO_RELEASE_VERSION}-${short_revision}-${EVO_RELEASE_RUN_ID}"
  [[ ! -e $evidence_dir ]] || fail "evidence_collision"
  install -d -m 700 "$evidence_dir"
  create_rollback_state "$evidence_dir"

  arm_release_mutation_trap "$evidence_dir/state.json" "$evidence_dir"
  if EVO_RELEASE_REVISION=$EVO_RELEASE_REVISION \
    EVO_RELEASE_VERSION=$EVO_RELEASE_VERSION \
    compose up --detach --no-deps --no-build --pull never --wait --wait-timeout 120 app >/dev/null; then
    if verify_transition_runtime \
      "$EVO_RELEASE_COMPOSE_FILE" \
      "$EVO_RELEASE_REVISION" \
      "$EVO_RELEASE_VERSION" \
      "$candidate_expected_image_id" \
      && verify_external_health; then
      write_result "$evidence_dir" "deployed" "verified" false
      disarm_release_mutation_trap
      jq -cn --arg evidenceDir "$evidence_dir" '{ok:true,command:"deploy",status:"deployed",evidenceDir:$evidenceDir}'
      return 0
    fi
  fi

  if rollback_from_state "$evidence_dir/state.json"; then
    write_result "$evidence_dir" "blocked" "deployment_failed" true
    disarm_release_mutation_trap
    jq -cn --arg evidenceDir "$evidence_dir" \
      '{ok:false,command:"deploy",status:"rolled_back",code:"deployment_failed",evidenceDir:$evidenceDir}'
    return 3
  fi
  write_result "$evidence_dir" "blocked" "rollback_failed" false
  disarm_release_mutation_trap
  jq -cn --arg evidenceDir "$evidence_dir" \
    '{ok:false,command:"deploy",status:"rollback_failed",code:"rollback_failed",evidenceDir:$evidenceDir}'
  return 4
}

manual_rollback() {
  require_command curl
  require_command docker
  require_command jq
  require_command realpath
  require_command sha256sum
  load_configuration
  acquire_release_lock
  require_variable EVO_RELEASE_ROLLBACK_STATE
  require_absolute_path "$EVO_RELEASE_ROLLBACK_STATE" "rollback_state_path_invalid"
  require_file "$EVO_RELEASE_ROLLBACK_STATE" "rollback_state_missing"
  local state_real evidence_real target_revision current_image current_revision current_version
  state_real=$(canonical_path "$EVO_RELEASE_ROLLBACK_STATE")
  evidence_real=$(canonical_path "$EVO_RELEASE_EVIDENCE_ROOT")
  [[ $state_real == "$evidence_real/"*/state.json ]] || fail "rollback_state_outside_evidence"
  verify_rollback_state_contract "$state_real" || fail "rollback_state_contract_invalid"
  target_revision=$(jq -er '.targetRevision' "$state_real") || fail "rollback_state_contract_invalid"
  require_match "$target_revision" "$SHA40_RE" "rollback_target_revision_invalid"

  verify_current_runtime
  [[ -n $current_app_container_id ]] || fail "manual_rollback_requires_active_app"
  current_image=$(docker inspect --format '{{.Image}}' "$current_app_container_id" 2>/dev/null || true)
  current_revision=$(container_label "$current_app_container_id" 'org.opencontainers.image.revision' 2>/dev/null || true)
  current_version=$(container_label "$current_app_container_id" 'org.opencontainers.image.version' 2>/dev/null || true)
  require_match "$current_image" "$SHA256_RE" "current_image_invalid"
  require_match "$current_revision" "$SHA40_RE" "current_revision_invalid"
  require_match "$current_version" "$VERSION_RE" "current_version_invalid"
  [[ $current_revision == "$target_revision" ]] || fail "rollback_target_not_active"

  local EVO_RELEASE_COMPOSE_FILE=$EVO_RELEASE_ACTIVE_COMPOSE_FILE
  local EVO_RELEASE_REVISION=$current_revision
  local EVO_RELEASE_VERSION=$current_version
  require_file "$EVO_RELEASE_COMPOSE_FILE" "active_compose_missing"
  verify_runtime_waha_image
  verify_networks
  verify_external_health || fail "external_health_failed"

  if rollback_from_state "$state_real"; then
    printf '{"ok":true,"command":"rollback","status":"rolled_back"}\n'
    return 0
  fi
  fail "rollback_failed"
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
  rollback)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    manual_rollback
    ;;
  *)
    fail "invalid_command"
    ;;
esac
