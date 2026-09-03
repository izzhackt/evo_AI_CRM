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
candidate_loaded_image_id=''

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
    EVO_RELEASE_STAGING_ROOT \
    EVO_RELEASE_EVIDENCE_ROOT \
    EVO_RELEASE_COMPOSE_FILE \
    EVO_RELEASE_APP_ENV_FILE \
    EVO_RELEASE_EXTERNAL_HEALTH_URL \
    EVO_WAHA_IMAGE_DIGEST; do
    require_variable "$variable"
  done

  require_absolute_path "$EVO_RELEASE_ROOT" "release_root_invalid"
  require_match "$EVO_RELEASE_PROJECT_NAME" "$PROJECT_NAME_RE" "project_name_invalid"
  require_absolute_path "$EVO_RELEASE_STAGING_ROOT" "staging_root_invalid"
  require_absolute_path "$EVO_RELEASE_EVIDENCE_ROOT" "evidence_root_invalid"
  require_absolute_path "$EVO_RELEASE_COMPOSE_FILE" "compose_path_invalid"
  require_absolute_path "$EVO_RELEASE_APP_ENV_FILE" "app_env_path_invalid"
  require_match "$EVO_RELEASE_EXTERNAL_HEALTH_URL" "$HEALTH_URL_RE" "health_url_invalid"
  require_match "$EVO_WAHA_IMAGE_DIGEST" "$SHA256_RE" "waha_digest_invalid"

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

  local archive_real staging_real
  require_file "$EVO_RELEASE_ARCHIVE" "archive_missing"
  archive_real=$(canonical_path "$EVO_RELEASE_ARCHIVE")
  staging_real=$(canonical_path "$EVO_RELEASE_STAGING_ROOT")
  [[ $archive_real == "$staging_real/"* ]] || fail "archive_outside_staging"
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

verify_controlled_staging_env_contract() {
  local variable
  for variable in \
    EVO_RELEASE_APP_ENV_FILE \
    EVO_RELEASE_ENV_EXAMPLE_FILE \
    EVO_RELEASE_SUPABASE_PROJECT_REF \
    EVO_PRODUCTION_SUPABASE_PROJECT_REF \
    EVO_RELEASE_PLATFORM_ORGANIZATION_ID \
    EVO_RELEASE_SUPABASE_PUBLISHABLE_KEY_SHA256 \
    EVO_RELEASE_SUPABASE_SECRET_KEY_SHA256 \
    EVO_PRODUCTION_SUPABASE_PUBLISHABLE_KEY_SHA256 \
    EVO_PRODUCTION_SUPABASE_SECRET_KEY_SHA256 \
    EVO_RELEASE_PUBLIC_HOSTNAME; do
    require_variable "$variable"
  done
  require_absolute_path "$EVO_RELEASE_APP_ENV_FILE" "app_env_path_invalid"
  require_absolute_path "$EVO_RELEASE_ENV_EXAMPLE_FILE" "env_example_path_invalid"

  local script_dir validator mode
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  validator=$script_dir/evo-app-env-contract.mjs
  require_file "$EVO_RELEASE_ENV_EXAMPLE_FILE" "env_example_missing"
  require_file "$EVO_RELEASE_APP_ENV_FILE" "app_env_missing"
  require_file "$validator" "app_env_validator_missing"
  mode=$(file_mode "$EVO_RELEASE_APP_ENV_FILE")
  [[ $mode == 600 || $mode == 640 ]] || fail "app_env_permissions_invalid"
  node "$validator" \
    --controlled-staging \
    --example "$EVO_RELEASE_ENV_EXAMPLE_FILE" \
    --env "$EVO_RELEASE_APP_ENV_FILE" \
    >/dev/null || fail "controlled_staging_env_contract_invalid"
}

verify_current_runtime() {
  local ids id service services health restarts
  ids=$(docker ps -aq \
    --filter "label=com.docker.compose.project=${EVO_RELEASE_PROJECT_NAME}")
  [[ $(printf '%s\n' "$ids" | count_nonempty_lines) -eq 2 ]] \
    || fail "runtime_service_contract_invalid"
  services=''
  while IFS= read -r id; do
    [[ -n $id ]] || continue
    service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$id")
    services+="${service}"$'\n'
  done <<<"$ids"
  services=$(printf '%s' "$services" | awk 'NF' | LC_ALL=C sort -u)
  [[ $services == $'app\nwaha' ]] || fail "runtime_service_contract_invalid"

  for service in app waha; do
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
  for service in app waha; do
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
  local index_json descriptor_path descriptor_hash image_revision image_version image_os image_arch
  local layer_path
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
    jq -e --arg image_id "$EVO_RELEASE_EXPECTED_IMAGE_ID" \
      '(.manifests | type) == "array" and any(.manifests[]; .digest == $image_id)' \
      <<<"$index_json" >/dev/null 2>&1 || fail "candidate_image_id_mismatch"
    descriptor_path="blobs/sha256/${EVO_RELEASE_EXPECTED_IMAGE_ID#sha256:}"
    descriptor_hash=$(tar -xOf "$EVO_RELEASE_ARCHIVE" "$descriptor_path" 2>/dev/null | sha256sum | awk '{print $1}') \
      || fail "archive_descriptor_invalid"
    [[ "sha256:$descriptor_hash" == "$EVO_RELEASE_EXPECTED_IMAGE_ID" ]] \
      || fail "archive_descriptor_invalid"
  else
    [[ "sha256:$config_hash" == "$EVO_RELEASE_EXPECTED_IMAGE_ID" ]] \
      || fail "candidate_image_id_mismatch"
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
  local candidate_tag image_id image_revision image_version image_os image_arch
  candidate_tag="evo-crm:${EVO_RELEASE_REVISION}"
  docker image load --input "$EVO_RELEASE_ARCHIVE" >/dev/null || fail "archive_load_failed"
  image_id=$(docker image inspect --format '{{.Id}}' "$candidate_tag" 2>/dev/null || true)
  image_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$candidate_tag" 2>/dev/null || true)
  image_version=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$candidate_tag" 2>/dev/null || true)
  image_os=$(docker image inspect --format '{{.Os}}' "$candidate_tag" 2>/dev/null || true)
  image_arch=$(docker image inspect --format '{{.Architecture}}' "$candidate_tag" 2>/dev/null || true)
  require_match "$image_id" "$SHA256_RE" "candidate_image_id_invalid"
  [[ $image_revision == "$EVO_RELEASE_REVISION" ]] || fail "candidate_revision_mismatch"
  [[ $image_version == "$EVO_RELEASE_VERSION" ]] || fail "candidate_version_mismatch"
  [[ $image_os == linux && $image_arch == amd64 ]] || fail "candidate_platform_mismatch"
  candidate_loaded_image_id=$image_id
}

verify_external_health() {
  curl --fail --silent --show-error --max-time 20 --output /dev/null \
    "$EVO_RELEASE_EXTERNAL_HEALTH_URL" || return 1
}

controlled_staging_preflight() {
  require_command node
  local script_dir
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  verify_controlled_staging_env_contract
  node "$script_dir/evo-release-environment-profile.mjs" --from-env
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
  case ${EVO_RELEASE_ENVIRONMENT:-production} in
    production)
      ;;
    staging)
      verify_controlled_staging_env_contract
      node "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/evo-release-environment-profile.mjs" \
        --from-env >/dev/null
      ;;
    *)
      fail "release_environment_invalid"
      ;;
  esac
  verify_capacity
  verify_compose
  verify_current_runtime
  verify_runtime_waha_image
  verify_networks
  verify_archive
  verify_external_health || fail "external_health_failed"
  printf '{"ok":true,"command":"preflight","code":"ready"}\n'
}

write_result() {
  local directory=$1 status=$2 code=$3 rolled_back=$4
  jq -cn \
    --arg status "$status" \
    --arg code "$code" \
    --arg revision "$EVO_RELEASE_REVISION" \
    --arg version "$EVO_RELEASE_VERSION" \
    --arg image "$candidate_loaded_image_id" \
    --argjson rolledBack "$rolled_back" \
    '{schema:"evo-fast-release/v1",status:$status,code:$code,revision:$revision,version:$version,image:$image,rolledBack:$rolledBack}' \
    >"$directory/result.json"
  chmod 600 "$directory/result.json"
}

create_rollback_state() {
  local directory=$1 container=$2 current_image current_revision current_version current_restarts rollback_tag compose_hash
  current_image=$(docker inspect --format '{{.Image}}' "$container")
  current_revision=$(container_label "$container" 'org.opencontainers.image.revision')
  current_version=$(container_label "$container" 'org.opencontainers.image.version')
  current_restarts=$(docker inspect --format '{{.RestartCount}}' "$container")
  compose_hash=$(sha256sum "$EVO_RELEASE_COMPOSE_FILE" | awk '{print $1}')
  require_match "$current_image" "$SHA256_RE" "current_image_invalid"
  require_match "$current_revision" "$SHA40_RE" "current_revision_invalid"
  require_match "$current_version" "$VERSION_RE" "current_version_invalid"
  [[ $current_revision != "$EVO_RELEASE_REVISION" && $current_restarts == 0 ]] || fail "current_release_invalid"
  rollback_tag="evo-crm:rollback-${EVO_RELEASE_RUN_ID}"
  docker image inspect "$rollback_tag" >/dev/null 2>&1 && fail "rollback_tag_collision"
  docker tag "$current_image" "$rollback_tag" || fail "rollback_tag_failed"
  cp -- "$EVO_RELEASE_COMPOSE_FILE" "$directory/docker-compose.previous.yml"
  chmod 600 "$directory/docker-compose.previous.yml"
  jq -cn \
    --arg previousImage "$current_image" \
    --arg previousRevision "$current_revision" \
    --arg previousVersion "$current_version" \
    --arg rollbackTag "$rollback_tag" \
    --arg composeSha256 "$compose_hash" \
    --arg targetRevision "$EVO_RELEASE_REVISION" \
    '{schema:"evo-fast-release-state/v1",previousImage:$previousImage,previousRevision:$previousRevision,previousVersion:$previousVersion,rollbackTag:$rollbackTag,composeSha256:$composeSha256,targetRevision:$targetRevision}' \
    >"$directory/state.json"
  chmod 600 "$directory/state.json"
}

rollback_from_state() {
  local state_file=$1 directory
  directory=$(dirname "$state_file")
  local previous_image previous_revision previous_version rollback_tag compose_hash actual_hash override
  previous_image=$(jq -er '.previousImage' "$state_file") || return 1
  previous_revision=$(jq -er '.previousRevision' "$state_file") || return 1
  previous_version=$(jq -er '.previousVersion' "$state_file") || return 1
  rollback_tag=$(jq -er '.rollbackTag' "$state_file") || return 1
  compose_hash=$(jq -er '.composeSha256' "$state_file") || return 1
  [[ $previous_image =~ $SHA256_RE && $previous_revision =~ $SHA40_RE && $previous_version =~ $VERSION_RE ]] || return 1
  [[ $rollback_tag =~ ^evo-crm:rollback-[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ && $compose_hash =~ $HASH64_RE ]] || return 1
  actual_hash=$(sha256sum "$EVO_RELEASE_COMPOSE_FILE" | awk '{print $1}')
  [[ $actual_hash == "$compose_hash" ]] || return 1
  [[ $(docker image inspect --format '{{.Id}}' "$rollback_tag" 2>/dev/null || true) == "$previous_image" ]] || return 1
  override=$directory/rollback.override.yml
  printf 'services:\n  app:\n    image: "%s"\n    labels:\n      org.opencontainers.image.revision: "%s"\n      org.opencontainers.image.version: "%s"\n' \
    "$rollback_tag" "$previous_revision" "$previous_version" >"$override"
  chmod 600 "$override"
  EVO_RELEASE_REVISION=$previous_revision \
  EVO_RELEASE_VERSION=$previous_version \
  docker compose \
    --ansi never \
    --project-name "$EVO_RELEASE_PROJECT_NAME" \
    --file "$EVO_RELEASE_COMPOSE_FILE" \
    --file "$override" \
    --env-file "$EVO_RELEASE_APP_ENV_FILE" \
    up --detach --no-deps --no-build --pull never --wait --wait-timeout 120 app >/dev/null || return 1
  local container
  container=$(app_container_id) || return 1
  [[ $(docker inspect --format '{{.Image}}' "$container") == "$previous_image" ]] || return 1
  [[ $(container_health "$container") == healthy ]] || return 1
  [[ $(docker inspect --format '{{.RestartCount}}' "$container") == 0 ]] || return 1
  verify_external_health || return 1
}

deploy() {
  preflight >/dev/null
  load_candidate_image
  local evidence_dir short_revision container
  short_revision=${EVO_RELEASE_REVISION:0:8}
  evidence_dir="$EVO_RELEASE_EVIDENCE_ROOT/${EVO_RELEASE_VERSION}-${short_revision}-${EVO_RELEASE_RUN_ID}"
  [[ ! -e $evidence_dir ]] || fail "evidence_collision"
  install -d -m 700 "$evidence_dir"
  container=$(app_container_id) || fail "app_container_unavailable"
  create_rollback_state "$evidence_dir" "$container"

  if EVO_RELEASE_REVISION=$EVO_RELEASE_REVISION \
    EVO_RELEASE_VERSION=$EVO_RELEASE_VERSION \
    compose up --detach --no-deps --no-build --pull never --wait --wait-timeout 120 app >/dev/null; then
    container=$(app_container_id) || true
    if [[ -n $container ]] \
      && [[ $(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || true) == "$candidate_loaded_image_id" ]] \
      && [[ $(container_label "$container" 'org.opencontainers.image.revision' 2>/dev/null || true) == "$EVO_RELEASE_REVISION" ]] \
      && [[ $(container_label "$container" 'org.opencontainers.image.version' 2>/dev/null || true) == "$EVO_RELEASE_VERSION" ]] \
      && [[ $(container_health "$container" 2>/dev/null || true) == healthy ]] \
      && [[ $(docker inspect --format '{{.RestartCount}}' "$container" 2>/dev/null || true) == 0 ]] \
      && verify_external_health; then
      write_result "$evidence_dir" "deployed" "verified" false
      jq -cn --arg evidenceDir "$evidence_dir" '{ok:true,command:"deploy",status:"deployed",evidenceDir:$evidenceDir}'
      return 0
    fi
  fi

  if rollback_from_state "$evidence_dir/state.json"; then
    write_result "$evidence_dir" "blocked" "deployment_failed" true
    jq -cn --arg evidenceDir "$evidence_dir" \
      '{ok:false,command:"deploy",status:"rolled_back",code:"deployment_failed",evidenceDir:$evidenceDir}'
    return 3
  fi
  write_result "$evidence_dir" "blocked" "rollback_failed" false
  jq -cn --arg evidenceDir "$evidence_dir" \
    '{ok:false,command:"deploy",status:"rollback_failed",code:"rollback_failed",evidenceDir:$evidenceDir}'
  return 4
}

manual_rollback() {
  load_configuration
  require_variable EVO_RELEASE_ROLLBACK_STATE
  require_absolute_path "$EVO_RELEASE_ROLLBACK_STATE" "rollback_state_path_invalid"
  require_file "$EVO_RELEASE_ROLLBACK_STATE" "rollback_state_missing"
  local state_real evidence_real
  state_real=$(canonical_path "$EVO_RELEASE_ROLLBACK_STATE")
  evidence_real=$(canonical_path "$EVO_RELEASE_EVIDENCE_ROOT")
  [[ $state_real == "$evidence_real/"*/state.json ]] || fail "rollback_state_outside_evidence"
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
  controlled-staging-preflight)
    [[ $# -eq 1 ]] || fail "invalid_arguments"
    controlled_staging_preflight
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
