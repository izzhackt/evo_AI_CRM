#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
export DO_NOT_TRACK=1
export SUPABASE_TELEMETRY_DISABLED=1
umask 077

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SUPABASE_CLI="${REPO_ROOT}/node_modules/.bin/supabase"
readonly PLAYWRIGHT_CLI="${REPO_ROOT}/node_modules/.bin/playwright"
readonly NEXT_CLI="${REPO_ROOT}/node_modules/.bin/next"
readonly DEADLINE_RUNNER="${REPO_ROOT}/scripts/run-command-with-deadline.mjs"
readonly SUPABASE_PROJECT_ID="evo-platform-local"
readonly EXPECTED_CLI_VERSION="2.110.0"
readonly MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"
readonly POSTGREST_CONTAINER="supabase_rest_${SUPABASE_PROJECT_ID}"
readonly DATABASE_CONTAINER="supabase_db_${SUPABASE_PROJECT_ID}"
readonly AUTH_CONTAINER="supabase_auth_${SUPABASE_PROJECT_ID}"
readonly STORAGE_CONTAINER="supabase_storage_${SUPABASE_PROJECT_ID}"
readonly KONG_CONTAINER="supabase_kong_${SUPABASE_PROJECT_ID}"
readonly STACK_LABEL="com.supabase.cli.project=${SUPABASE_PROJECT_ID}"
readonly INBOX_STACK_LABEL="com.supabase.cli.project=inbox"
readonly KNOWN_STORAGE_GATEWAY_502_STATUS="Error status 502:"
readonly KNOWN_STORAGE_GATEWAY_502_MESSAGE="An invalid response was received from the upstream server"
readonly EXCLUDED_SERVICES="imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
readonly TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/evo-supabase-p2h.XXXXXX")"
readonly BROWSER_BUILD_RUN_KEY="$(
  basename "${TEMP_DIR}" | tr -c 'A-Za-z0-9_-' '-'
)"
readonly BROWSER_BUILD_DIR="${REPO_ROOT}/.next/platform-auth/${BROWSER_BUILD_RUN_KEY}"
readonly PLATFORM_AUTH_TSCONFIG_DIR_RELATIVE=".next/platform-auth/${BROWSER_BUILD_RUN_KEY}"
readonly ROOT_TSCONFIG="${REPO_ROOT}/tsconfig.json"
readonly ROOT_TSCONFIG_SHA_BEFORE="$(
  shasum -a 256 "${ROOT_TSCONFIG}" | awk '{print $1}'
)"
readonly CANONICAL_VERSIONS_FILE="${TEMP_DIR}/canonical-versions.txt"
readonly INBOX_FINGERPRINT_BEFORE="${TEMP_DIR}/inbox-before.txt"
readonly INBOX_FINGERPRINT_AFTER="${TEMP_DIR}/inbox-after.txt"
readonly BROWSER_HOST="127.0.0.1"
readonly BROWSER_PORT="3311"
readonly PROVIDER_GATED_BROWSER_TESTS="RU and EN draft requests work while uncertain language stops for manual selection|admin reads the persisted local P3C workflow without proving providers|assigned Curator reads the same persisted local P3C workflow|staff writes and persists a manual reply while AI is unavailable|staff submits an approved-knowledge AI draft request through the real form|staff reviews an AI draft then authorizes the edited final text"
readonly P5B_BROWSER_TEST="P5B projects verified inbound WAHA work into the accepted conversation UI"
readonly P5C_BROWSER_TEST="P5C reconciles available WAHA history into the accepted conversation UI"
readonly P5D_BROWSER_TEST="P5D archives private WAHA media into the accepted conversation UI"
readonly P5E_BROWSER_TEST="P5E projects WAHA ACK and session state into the live conversation UI"
# Keep the established cross-checkout namespace: older repository revisions
# use this exact lock while operating the same Docker project ID.
readonly LOCK_DIR="${TMPDIR:-/tmp}/evo-supabase-p2c-${SUPABASE_PROJECT_ID}.lock"
lock_acquired=false
stack_owned=false
inbox_fingerprint_recorded=false
browser_gate_started=false

run_with_deadline() {
  local timeout_ms=$1
  shift
  node "${DEADLINE_RUNNER}" "${timeout_ms}" "$@"
}

prepare_platform_auth_tsconfig() {
  local partition=$1
  local tsconfig_path="${BROWSER_BUILD_DIR}/tsconfig-platform-auth-${partition}.json"

  case "${partition}" in
    provider|p5b|p5c|p5d|p5e|remaining) ;;
    *) return 1 ;;
  esac

  mkdir -p -- "${BROWSER_BUILD_DIR}"
  chmod 700 "${BROWSER_BUILD_DIR}"

  node - "${ROOT_TSCONFIG}" "${tsconfig_path}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [rootTsconfig, outputPath] = process.argv.slice(2);
const payload = {
  extends: path.relative(path.dirname(outputPath), rootTsconfig),
};

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n", {
  encoding: "utf8",
  mode: 0o600,
});
fs.chmodSync(outputPath, 0o600);
NODE
}

refresh_synthetic_browser_health() {
  local refresh_log="${TEMP_DIR}/browser-health-refresh.log"

  # Refresh only the positive synthetic readiness contracts exercised by the
  # browser suite. Org A AI intentionally remains local_non_provider so its
  # fail-closed assertions cannot be turned into provider proof.
  if ! run_with_deadline 30000 docker exec -i \
    "${DATABASE_CONTAINER}" \
    psql \
    -X \
    --no-psqlrc \
    -qAt \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d postgres \
    >"${refresh_log}" 2>&1 <<'SQL'
BEGIN;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
DO $refresh$
DECLARE
  org_a UUID;
  org_b UUID;
BEGIN
  SELECT id
  INTO STRICT org_a
  FROM platform.organizations
  WHERE name = 'EVO P2C Synthetic Organization A';

  SELECT id
  INTO STRICT org_b
  FROM platform.organizations
  WHERE name = 'EVO P2C Synthetic Organization B';

  PERFORM platform.record_messaging_integration_health_event(
    org_a,
    'waha'::platform.messaging_integration_target,
    'ready'::platform.messaging_integration_readiness,
    'provider_observed'::platform.messaging_integration_evidence_kind,
    'Refresh synthetic WAHA readiness for the bounded local browser contract gate',
    'synthetic:browser:waha:provider-ready:org-a',
    gen_random_uuid()
  );
  PERFORM platform.record_messaging_integration_health_event(
    org_b,
    'ai'::platform.messaging_integration_target,
    'ready'::platform.messaging_integration_readiness,
    'provider_observed'::platform.messaging_integration_evidence_kind,
    'Refresh synthetic AI readiness for the bounded local browser contract gate',
    'synthetic:browser:ai:provider-ready:org-b',
    gen_random_uuid()
  );
  PERFORM platform.record_messaging_integration_health_event(
    org_b,
    'waha'::platform.messaging_integration_target,
    'ready'::platform.messaging_integration_readiness,
    'provider_observed'::platform.messaging_integration_evidence_kind,
    'Refresh synthetic WAHA readiness for the bounded local browser contract gate',
    'synthetic:browser:waha:provider-ready:org-b',
    gen_random_uuid()
  );
END
$refresh$;
COMMIT;
SQL
  then
    fail "Unable to refresh the exact synthetic local browser health contracts; output was withheld."
  fi
}

list_exact_stack_containers() {
  run_with_deadline 5000 docker container ls \
    --all \
    --quiet \
    --filter "label=${STACK_LABEL}"
}

list_exact_stack_volumes() {
  run_with_deadline 5000 docker volume ls \
    --quiet \
    --filter "label=${STACK_LABEL}"
}

list_exact_stack_networks() {
  run_with_deadline 5000 docker network ls \
    --quiet \
    --filter "label=${STACK_LABEL}"
}

capture_inbox_stack_fingerprint() {
  local output_file=$1
  local resource_id
  local container_ids
  local volume_names
  local network_ids

  container_ids="$(
    run_with_deadline 5000 docker container ls \
      --all \
      --no-trunc \
      --quiet \
      --filter "label=${INBOX_STACK_LABEL}"
  )" || return 1
  volume_names="$(
    run_with_deadline 5000 docker volume ls \
      --quiet \
      --filter "label=${INBOX_STACK_LABEL}"
  )" || return 1
  network_ids="$(
    run_with_deadline 5000 docker network ls \
      --no-trunc \
      --quiet \
      --filter "label=${INBOX_STACK_LABEL}"
  )" || return 1

  {
    while IFS= read -r resource_id; do
      if [[ -n "${resource_id}" ]]; then
        printf 'container:%s\n' "${resource_id}"
      fi
    done <<<"${container_ids}"
    while IFS= read -r resource_id; do
      if [[ -n "${resource_id}" ]]; then
        printf 'volume:%s\n' "${resource_id}"
      fi
    done <<<"${volume_names}"
    while IFS= read -r resource_id; do
      if [[ -n "${resource_id}" ]]; then
        printf 'network:%s\n' "${resource_id}"
      fi
    done <<<"${network_ids}"
  } | LC_ALL=C sort >"${output_file}"
}

assert_inbox_stack_unchanged() {
  [[ "${inbox_fingerprint_recorded}" == true ]] || return 0
  capture_inbox_stack_fingerprint "${INBOX_FINGERPRINT_AFTER}" || return 1
  cmp -s -- "${INBOX_FINGERPRINT_BEFORE}" "${INBOX_FINGERPRINT_AFTER}"
}

list_exact_browser_server_pids() {
  local expected_command="node ${NEXT_CLI} dev --hostname ${BROWSER_HOST} --port ${BROWSER_PORT}"

  ps -axo pid=,command= | awk -v expected_command="${expected_command}" '
    {
      pid = $1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0)
      if ($0 == expected_command) {
        print pid
      }
    }
  '
}

stop_exact_browser_server() {
  local listed_pids
  local process_id
  local attempt
  local -a server_pids=()

  listed_pids="$(list_exact_browser_server_pids)" || return 1
  while IFS= read -r process_id; do
    [[ -n "${process_id}" ]] && server_pids+=("${process_id}")
  done <<<"${listed_pids}"
  (( ${#server_pids[@]} > 0 )) || return 0

  # Match only this worktree's Next executable, host and port. Never kill a
  # generic port owner or another worktree's development server.
  kill -TERM "${server_pids[@]}" 2>/dev/null || :
  for attempt in {1..20}; do
    sleep 0.25
    listed_pids="$(list_exact_browser_server_pids)" || return 1
    [[ -z "${listed_pids}" ]] && return 0
  done

  server_pids=()
  listed_pids="$(list_exact_browser_server_pids)" || return 1
  while IFS= read -r process_id; do
    [[ -n "${process_id}" ]] && server_pids+=("${process_id}")
  done <<<"${listed_pids}"
  (( ${#server_pids[@]} > 0 )) || return 0
  kill -KILL "${server_pids[@]}" 2>/dev/null || :

  for attempt in {1..20}; do
    sleep 0.25
    listed_pids="$(list_exact_browser_server_pids)" || return 1
    [[ -z "${listed_pids}" ]] && return 0
  done
  return 1
}

remove_exact_local_stack_resources() {
  local resource_id
  local attempt
  local listed_resources
  local removal_failed=false
  local -a container_ids=()
  local -a volume_names=()
  local -a network_ids=()

  listed_resources="$(list_exact_stack_containers)" || return 1
  while IFS= read -r resource_id; do
    [[ -n "${resource_id}" ]] && container_ids+=("${resource_id}")
  done <<<"${listed_resources}"

  listed_resources="$(list_exact_stack_volumes)" || return 1
  while IFS= read -r resource_id; do
    [[ -n "${resource_id}" ]] && volume_names+=("${resource_id}")
  done <<<"${listed_resources}"

  listed_resources="$(list_exact_stack_networks)" || return 1
  while IFS= read -r resource_id; do
    [[ -n "${resource_id}" ]] && network_ids+=("${resource_id}")
  done <<<"${listed_resources}"

  if (( ${#container_ids[@]} > 0 )) && ! run_with_deadline 30000 \
    docker rm -f "${container_ids[@]}" >/dev/null 2>&1; then
    removal_failed=true
  fi

  if (( ${#volume_names[@]} > 0 )) && ! run_with_deadline 30000 \
    docker volume rm "${volume_names[@]}" >/dev/null 2>&1; then
    removal_failed=true
  fi

  # OrbStack can briefly retain an empty Compose network after the last exact
  # container disappears. Re-list the exact project label on every bounded
  # attempt; never disconnect endpoints or retry a stale/broader network set.
  for attempt in {1..20}; do
    network_ids=()
    listed_resources="$(list_exact_stack_networks)" || return 1
    while IFS= read -r resource_id; do
      [[ -n "${resource_id}" ]] && network_ids+=("${resource_id}")
    done <<<"${listed_resources}"
    (( ${#network_ids[@]} > 0 )) || break

    run_with_deadline 2000 \
      docker network rm "${network_ids[@]}" >/dev/null 2>&1 \
      || :
    sleep 0.25
  done

  listed_resources="$(list_exact_stack_networks)" || return 1
  if [[ -n "${listed_resources}" ]]; then
    removal_failed=true
  fi

  [[ "${removal_failed}" == false ]] || return 1

  # Prove the exact label is empty before a new stack can start. A half-failed
  # teardown must not be mistaken for a clean disposable environment.
  listed_resources="$(list_exact_stack_containers)" || return 1
  [[ -z "${listed_resources}" ]] || return 1
  listed_resources="$(list_exact_stack_volumes)" || return 1
  [[ -z "${listed_resources}" ]] || return 1
  listed_resources="$(list_exact_stack_networks)" || return 1
  [[ -z "${listed_resources}" ]] || return 1
}

stop_exact_local_stack() {
  local existing_containers
  local existing_volumes
  local existing_networks

  existing_containers="$(list_exact_stack_containers)" || return 1
  existing_volumes="$(list_exact_stack_volumes)" || return 1
  existing_networks="$(list_exact_stack_networks)" || return 1

  # Avoid calling the Supabase teardown path when the exact disposable stack
  # is already absent. On OrbStack an empty `supabase stop` can leave a slow
  # daemon-side request racing the immediately following clean start.
  if [[ -z "${existing_containers}" \
    && -z "${existing_volumes}" \
    && -z "${existing_networks}" ]]; then
    return 0
  fi

  if ! run_with_deadline 90000 "${SUPABASE_CLI}" \
    --workdir "${REPO_ROOT}" \
    stop \
    --project-id "${SUPABASE_PROJECT_ID}" \
    --no-backup \
    >"${TEMP_DIR}/stop.log" 2>&1; then
    :
  fi

  # Supabase CLI can hang during container teardown on OrbStack. Fall back to
  # resources carrying the exact disposable project label so the next run does
  # not inherit a half-removed stack. This never targets unrelated projects.
  if ! remove_exact_local_stack_resources; then
    return 1
  fi

  return 0
}

cleanup() {
  local exit_code=$?
  local cleanup_failed=false

  trap - EXIT HUP INT TERM
  set +e

  # Stop the exact browser server before its disposable database. This is only
  # armed after a clean preflight and the Playwright gate has started.
  if [[ "${browser_gate_started}" == true ]]; then
    if ! stop_exact_browser_server; then
      cleanup_failed=true
    fi
  fi

  # The project ID is explicit: never use `supabase stop --all`, and never stop
  # an unrelated local Supabase stack.
  if [[ "${stack_owned}" == true && -x "${SUPABASE_CLI}" ]]; then
    if ! stop_exact_local_stack >/dev/null 2>&1; then
      cleanup_failed=true
    fi
  fi

  if ! assert_inbox_stack_unchanged; then
    cleanup_failed=true
  fi

  if [[ "${lock_acquired}" == true ]]; then
    if ! rm -f -- "${LOCK_DIR}/pid"; then
      cleanup_failed=true
    fi
    if ! rmdir -- "${LOCK_DIR}" 2>/dev/null; then
      cleanup_failed=true
    fi
  fi

  # Each browser partition receives its own Next.js dev build directory. Remove
  # only this run's exact ignored artifact after every server has stopped.
  if [[ "${BROWSER_BUILD_DIR}" == "${REPO_ROOT}/.next/platform-auth/${BROWSER_BUILD_RUN_KEY}" ]]; then
    rm -rf -- "${BROWSER_BUILD_DIR}"
  else
    cleanup_failed=true
  fi

  if [[ "$(
    shasum -a 256 "${ROOT_TSCONFIG}" 2>/dev/null | awk '{print $1}'
  )" != "${ROOT_TSCONFIG_SHA_BEFORE}" ]]; then
    cleanup_failed=true
  fi

  rm -rf -- "${TEMP_DIR}"
  if (( exit_code != 0 )); then
    exit "${exit_code}"
  fi
  if [[ "${cleanup_failed}" == true ]]; then
    exit 1
  fi
  exit 0
}

trap cleanup EXIT HUP INT TERM

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

show_safe_failure_log() {
  local log_file=$1

  # Local start/status output can contain disposable JWTs, anon/service-role
  # keys, database passwords, and S3 credentials. Remove entire credential and
  # URL lines instead of attempting to partially mask unknown future formats.
  if [[ -s "${log_file}" ]]; then
    sed -E \
      -e '/(key|secret|token|password|credential|SUPABASE_|URL:|postgres(ql)?:\/\/)/Id' \
      "${log_file}" \
      | tail -n 80 \
      >&2
  fi
}

show_safe_database_deadlock_log() {
  local database_log="${TEMP_DIR}/database.log"
  local deadlock_log="${TEMP_DIR}/database-deadlock.log"

  if ! run_with_deadline 10000 \
    docker logs "${DATABASE_CONTAINER}" >"${database_log}" 2>&1; then
    return
  fi

  awk '
    /deadlock detected/ { capture = 1 }
    capture && $0 ~ /deadlock detected|DETAIL:|HINT:|CONTEXT:/ { print }
  ' "${database_log}" >"${deadlock_log}"

  show_safe_failure_log "${deadlock_log}"
}

wait_for_local_stack_readiness() {
  local deadline=$((SECONDS + 90))
  local status_file="${TEMP_DIR}/reset-readiness-status.json"
  local status_log="${TEMP_DIR}/reset-readiness-status.log"
  local container_name
  local container_state
  local containers_ready
  local remaining_seconds
  local probe_timeout_ms

  : >"${status_file}"
  chmod 600 "${status_file}"
  while (( SECONDS < deadline )); do
    containers_ready=true
    for container_name in \
      "${DATABASE_CONTAINER}" \
      "${POSTGREST_CONTAINER}" \
      "${AUTH_CONTAINER}" \
      "${STORAGE_CONTAINER}" \
      "${KONG_CONTAINER}"; do
      remaining_seconds=$((deadline - SECONDS))
      (( remaining_seconds > 0 )) || return 1
      probe_timeout_ms=$((remaining_seconds * 1000))
      (( probe_timeout_ms <= 5000 )) || probe_timeout_ms=5000
      container_state="$(
        run_with_deadline "${probe_timeout_ms}" docker inspect \
          --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
          "${container_name}" \
          2>/dev/null \
          || true
      )"
      if [[ "${container_state}" != healthy && "${container_state}" != running ]]; then
        containers_ready=false
        break
      fi
    done

    remaining_seconds=$((deadline - SECONDS))
    (( remaining_seconds > 0 )) || break
    probe_timeout_ms=$((remaining_seconds * 1000))
    (( probe_timeout_ms <= 10000 )) || probe_timeout_ms=10000
    if [[ "${containers_ready}" == true ]] && run_with_deadline \
      "${probe_timeout_ms}" "${SUPABASE_CLI}" \
      --workdir "${REPO_ROOT}" \
      status \
      --output json \
      >"${status_file}" 2>"${status_log}"; then
      rm -f -- "${status_file}"
      return 0
    fi
    sleep 2
  done

  rm -f -- "${status_file}"
  show_safe_failure_log "${status_log}"
  return 1
}

assert_local_migration_history() {
  local stage=$1
  local migration_list_file="${TEMP_DIR}/migration-list-${stage}.json"
  local migration_list_log="${TEMP_DIR}/migration-list-${stage}.log"

  [[ "${stage}" =~ ^[a-z-]+$ ]] || return 1
  if ! run_with_deadline 30000 "${SUPABASE_CLI}" \
    --workdir "${REPO_ROOT}" \
    --output-format json \
    migration list \
    --local \
    >"${migration_list_file}" 2>"${migration_list_log}"; then
    show_safe_failure_log "${migration_list_log}"
    return 1
  fi

  node - \
    "${migration_list_file}" \
    "${CANONICAL_VERSIONS_FILE}" <<'NODE'
const fs = require("node:fs");

const [jsonPath, expectedVersionsPath] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const migrations = payload.migrations;
const expected = fs
  .readFileSync(expectedVersionsPath, "utf8")
  .trim()
  .split("\n");

if (!Array.isArray(migrations)) {
  throw new Error("Supabase CLI did not return a migrations array.");
}

const local = migrations.map((row) => row.local).filter(Boolean);
const applied = migrations.map((row) => row.remote).filter(Boolean);

for (const [label, actual] of [
  ["canonical files", local],
  ["applied local database", applied],
]) {
  if (
    actual.length !== expected.length ||
    actual.some((version, index) => version !== expected[index])
  ) {
    throw new Error(
      `${label} migration history must match canonical ${expected.join(", ")}; found ${actual.join(", ")}`,
    );
  }
}
NODE
}

reset_reached_post_migration_restart_failure() {
  local progress_log=$1
  local last_nonempty_line

  # The CLI emits this banner only after it has recreated and migrated the
  # database and entered its service-restart phase. Accept only a timeout whose
  # last progress line is that banner, or the exact known local Storage gateway
  # 502 emitted at the same boundary. Any unrelated later error remains fatal.
  [[ -s "${progress_log}" ]] || return 1
  grep -Fq "Restarting containers" "${progress_log}" || return 1

  last_nonempty_line="$(
    sed -e 's/\r$//' -e '/^[[:space:]]*$/d' "${progress_log}" \
      | grep -Ev \
        '^A new version of Supabase CLI is available: v[0-9]+\.[0-9]+\.[0-9]+ \(currently installed v[0-9]+\.[0-9]+\.[0-9]+\)$|^We recommend updating regularly for new features and bug fixes: https://supabase\.com/docs/guides/cli/getting-started#updating-the-supabase-cli$' \
      | tail -n 1
  )"
  if [[ "${last_nonempty_line}" == "Restarting containers..." ]]; then
    return 0
  fi

  [[ "${last_nonempty_line}" == \
    "${KNOWN_STORAGE_GATEWAY_502_MESSAGE}" ]] || return 1

  grep -Fq "${KNOWN_STORAGE_GATEWAY_502_STATUS}" "${progress_log}" \
    && grep -Fq "${KNOWN_STORAGE_GATEWAY_502_MESSAGE}" "${progress_log}"
}

reload_exact_local_kong() {
  local project_label
  local reload_log="${TEMP_DIR}/kong-reload.log"
  local restart_log="${TEMP_DIR}/kong-restart.log"

  project_label="$(
    run_with_deadline 5000 docker inspect \
      --format '{{ index .Config.Labels "com.supabase.cli.project" }}' \
      "${KONG_CONTAINER}" \
      2>/dev/null
  )" || return 1
  [[ "${project_label}" == "${SUPABASE_PROJECT_ID}" ]] || return 1

  if run_with_deadline 30000 docker exec \
    "${KONG_CONTAINER}" kong reload >"${reload_log}" 2>&1; then
    return 0
  fi

  # Match the upstream CLI recovery guidance without widening beyond this
  # disposable project. Recheck ownership before the exact-container fallback.
  project_label="$(
    run_with_deadline 5000 docker inspect \
      --format '{{ index .Config.Labels "com.supabase.cli.project" }}' \
      "${KONG_CONTAINER}" \
      2>/dev/null
  )" || return 1
  [[ "${project_label}" == "${SUPABASE_PROJECT_ID}" ]] || return 1

  run_with_deadline 60000 docker restart \
    "${KONG_CONTAINER}" >"${restart_log}" 2>&1
}

recover_post_migration_restart_failure() {
  local progress_log=$1

  reset_reached_post_migration_restart_failure "${progress_log}" \
    || return 1
  reload_exact_local_kong || return 1
  wait_for_local_stack_readiness || return 1
  assert_local_migration_history recovery || return 1
  printf 'Recovered a post-migration reset restart failure after exact-stack readiness and migration parity proof.\n' >&2
}

[[ -x "${SUPABASE_CLI}" ]] \
  || fail "Project-local Supabase CLI is missing. Run npm ci with Node 22 first."
[[ -x "${NEXT_CLI}" ]] \
  || fail "Project-local Next.js CLI is missing. Run npm ci with Node 22 first."
[[ -f "${DEADLINE_RUNNER}" ]] \
  || fail "Project-local command deadline runner is missing."

[[ "$(node --version)" == v22.* ]] \
  || fail "Node 22 is required; found $(node --version)."

actual_cli_version="$("${SUPABASE_CLI}" --version)"
[[ "${actual_cli_version}" == "${EXPECTED_CLI_VERSION}" ]] \
  || fail "Expected Supabase CLI ${EXPECTED_CLI_VERSION}; found ${actual_cli_version}."

[[ -d "${MIGRATIONS_DIR}" ]] \
  || fail "Canonical migration directory is missing: ${MIGRATIONS_DIR}"

if ! node "${REPO_ROOT}/scripts/verify-supabase-history.mjs" \
  >"${TEMP_DIR}/history-verification.json" \
  2>"${TEMP_DIR}/history-verification.log"; then
  show_safe_failure_log "${TEMP_DIR}/history-verification.log"
  fail "Canonical migration history verification failed."
fi

migration_files=("${MIGRATIONS_DIR}"/*.sql)
[[ -e "${migration_files[0]}" ]] \
  || fail "No canonical SQL migrations were found."

: >"${CANONICAL_VERSIONS_FILE}"
for index in "${!migration_files[@]}"; do
  expected_version="$(printf '%03d' "$((index + 1))")"
  migration_name="$(basename "${migration_files[${index}]}")"
  migration_version="${migration_name%%_*}"

  [[ "${migration_name}" =~ ^[0-9]{3}_.+\.sql$ ]] \
    || fail "Invalid canonical migration filename: ${migration_name}"
  [[ "${migration_version}" == "${expected_version}" ]] \
    || fail "Migration history is not contiguous: expected ${expected_version}, found ${migration_version}."
  printf '%s\n' "${migration_version}" >>"${CANONICAL_VERSIONS_FILE}"
done

expected_migration_count="${#migration_files[@]}"
expected_last_migration="$(
  tail -n 1 "${CANONICAL_VERSIONS_FILE}"
)"

[[ ! -e "${REPO_ROOT}/supabase/.temp/project-ref" ]] \
  || fail "Refusing to run while this worktree contains a linked Supabase project ref."
[[ ! -e "${REPO_ROOT}/.supabase/project-ref" ]] \
  || fail "Refusing to run while this worktree contains a linked Supabase project ref."

command -v docker >/dev/null 2>&1 \
  || fail "Docker is required for the disposable local database."

browser_server_pids="$(list_exact_browser_server_pids)" \
  || fail "Unable to inspect exact-worktree Platform browser processes."
[[ -z "${browser_server_pids}" ]] \
  || fail "An exact-worktree Platform browser server is already running; stop it before the clean local gate."

if [[ -n "${DOCKER_HOST:-}" && "${DOCKER_HOST}" != unix://* ]]; then
  fail "DOCKER_HOST must reference a local unix socket, not ${DOCKER_HOST}."
fi

docker_context="$(run_with_deadline 10000 docker context show 2>/dev/null)" \
  || fail "Unable to determine the active Docker context."
docker_endpoint="$(
  run_with_deadline 10000 docker context inspect \
    "${docker_context}" \
    --format '{{ (index .Endpoints "docker").Host }}' \
    2>/dev/null
)" || fail "Unable to inspect Docker context ${docker_context}."
[[ "${docker_endpoint}" == unix://* ]] \
  || fail "Docker context ${docker_context} is not local (${docker_endpoint})."

run_with_deadline 10000 docker info >/dev/null 2>&1 \
  || fail "The local Docker engine is not running."

capture_inbox_stack_fingerprint "${INBOX_FINGERPRINT_BEFORE}" \
  || fail "Unable to record the existing EVO Inbox Docker resource identities."
inbox_fingerprint_recorded=true

if ! mkdir -- "${LOCK_DIR}" 2>/dev/null; then
  fail "Another evo-platform-local reset owns ${LOCK_DIR}; refusing to stop its stack."
fi
lock_acquired=true
printf '%s\n' "$$" >"${LOCK_DIR}/pid"
stack_owned=true

# Remove only a stale stack with this exact project ID so the run begins from
# clean volumes. Output is suppressed because Supabase may print local secrets.
if ! stop_exact_local_stack; then
  fail "Unable to remove the exact disposable Supabase stack before start."
fi

if ! run_with_deadline 600000 "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  --output-format json \
  start \
  --exclude "${EXCLUDED_SERVICES}" \
  --ignore-health-check \
  >"${TEMP_DIR}/start.json" 2>"${TEMP_DIR}/start.log"; then
  # Do not echo start output: even failed starts can emit ephemeral local keys.
  fail "The disposable local Supabase database failed to start; credential-bearing output was withheld."
fi

if ! wait_for_local_stack_readiness; then
  fail "The disposable local Supabase stack did not become ready after startup; credential-bearing output was withheld."
fi

reset_exit_code=0
run_with_deadline 600000 "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  --output-format json \
  db reset \
  --local \
  --no-seed \
  >"${TEMP_DIR}/reset.json" 2>"${TEMP_DIR}/reset.log" \
  || reset_exit_code=$?
if (( reset_exit_code != 0 )); then
  show_safe_failure_log "${TEMP_DIR}/reset.log"
  show_safe_database_deadlock_log
  if reset_reached_post_migration_restart_failure \
    "${TEMP_DIR}/reset.log"; then
    recover_post_migration_restart_failure \
      "${TEMP_DIR}/reset.log" \
      || fail "Post-migration reset recovery failed for the exact disposable stack."
  else
    fail "Initial disposable Supabase reset failed before the proved post-migration recovery boundary. Exit code ${reset_exit_code}."
  fi
fi

if ! run_with_deadline 120000 "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  seed buckets \
  --local \
  >"${TEMP_DIR}/seed-buckets.log" 2>&1; then
  # Bucket seeding can include local API coordinates. Keep its raw output in
  # the mode-0700 temporary directory and report only the bounded stage.
  fail "Declarative local Storage bucket seeding failed; output was withheld."
fi

if ! postgrest_environment="$(
  run_with_deadline 10000 docker inspect \
    --format '{{range .Config.Env}}{{println .}}{{end}}' \
    "${POSTGREST_CONTAINER}"
)"; then
  fail "Unable to inspect the disposable local PostgREST container."
fi

postgrest_schemas="$(
  sed -n 's/^PGRST_DB_SCHEMAS=//p' <<<"${postgrest_environment}"
)"
postgrest_search_path="$(
  sed -n 's/^PGRST_DB_EXTRA_SEARCH_PATH=//p' <<<"${postgrest_environment}"
)"

if ! node - "${postgrest_schemas}" "${postgrest_search_path}" <<'NODE'
const [schemasText, searchPathText] = process.argv.slice(2);
const split = (value) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const schemas = split(schemasText);
const searchPath = split(searchPathText);
const expectedSchemas = ["public", "platform", "graphql_public"];

if (JSON.stringify(schemas) !== JSON.stringify(expectedSchemas)) {
  throw new Error(
    `PostgREST schemas must be ${expectedSchemas.join(",")}; found ${schemas.join(",")}`,
  );
}

for (const forbidden of ["platform_private", "pgmq_public"]) {
  if (schemas.includes(forbidden) || searchPath.includes(forbidden)) {
    throw new Error(`PostgREST unexpectedly exposes ${forbidden}`);
  }
}
NODE
then
  fail "Disposable local PostgREST schema exposure does not match P2B."
fi

assert_local_migration_history initial \
  || fail "Disposable local migration history does not match canonical files."

# Prove the empty queue before any Auth/browser fixture can create outbox work.
# The queue runtime itself creates an organization fixture, while Auth must
# prove the guarded first-organization bootstrap. Recreate the disposable DB
# between those independent gates; both resets happen before browser evidence.
if ! run_with_deadline 300000 bash \
  "${REPO_ROOT}/scripts/test-p2g-queues-runtime.sh" \
  "${DATABASE_CONTAINER}" \
  "postgres"; then
  fail "Real local PGMQ visibility/retry/dead-letter gate failed."
fi

post_queue_reset_exit_code=0
run_with_deadline 600000 "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  --output-format json \
  db reset \
  --local \
  --no-seed \
  >"${TEMP_DIR}/post-queue-reset.json" \
  2>"${TEMP_DIR}/post-queue-reset.log" \
  || post_queue_reset_exit_code=$?
if (( post_queue_reset_exit_code != 0 )); then
  show_safe_failure_log "${TEMP_DIR}/post-queue-reset.log"
  show_safe_database_deadlock_log
  if reset_reached_post_migration_restart_failure \
    "${TEMP_DIR}/post-queue-reset.log"; then
    recover_post_migration_restart_failure \
      "${TEMP_DIR}/post-queue-reset.log" \
      || fail "Post-queue post-migration recovery failed for the exact disposable stack."
  else
    fail "Post-queue disposable Supabase reset failed before the proved post-migration recovery boundary. Exit code ${post_queue_reset_exit_code}."
  fi
fi

assert_local_migration_history post-queue \
  || fail "Post-queue migration history does not match canonical files."

if ! run_with_deadline 120000 "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  seed buckets \
  --local \
  >"${TEMP_DIR}/post-queue-seed-buckets.log" 2>&1; then
  fail "Post-queue local Storage bucket seeding failed; output was withheld."
fi

readonly AUTH_STATUS_FILE="${TEMP_DIR}/auth-status.json"
readonly PLATFORM_AUTH_BROWSER_FIXTURE="${TEMP_DIR}/platform-auth-browser.json"
readonly LEGACY_DB_SENTINEL="${TEMP_DIR}/legacy-must-not-exist.db"
: >"${AUTH_STATUS_FILE}"
: >"${PLATFORM_AUTH_BROWSER_FIXTURE}"
chmod 600 "${AUTH_STATUS_FILE}"
chmod 600 "${PLATFORM_AUTH_BROWSER_FIXTURE}"

if ! run_with_deadline 10000 "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  status \
  --output json \
  >"${AUTH_STATUS_FILE}" 2>"${TEMP_DIR}/auth-status.log"; then
  fail "Unable to read disposable local Supabase status; credential-bearing output was withheld."
fi

if ! run_with_deadline 300000 node \
  "${REPO_ROOT}/scripts/test-supabase-auth-hook.mjs" \
  "${AUTH_STATUS_FILE}" \
  "${DATABASE_CONTAINER}" \
  "${PLATFORM_AUTH_BROWSER_FIXTURE}"; then
  fail "Local Supabase Auth/PostgREST hook smoke failed."
fi

[[ ! -e "${AUTH_STATUS_FILE}" ]] \
  || fail "Auth smoke did not delete the credential-bearing local status file."

readonly STORAGE_STATUS_FILE="${TEMP_DIR}/storage-status.json"
: >"${STORAGE_STATUS_FILE}"
chmod 600 "${STORAGE_STATUS_FILE}"

if ! run_with_deadline 10000 "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  status \
  --output json \
  >"${STORAGE_STATUS_FILE}" 2>"${TEMP_DIR}/storage-status.log"; then
  fail "Unable to read disposable local Storage status; credential-bearing output was withheld."
fi

if ! run_with_deadline 600000 node \
  "${REPO_ROOT}/scripts/test-p2h-storage-api.mjs" \
  "${STORAGE_STATUS_FILE}" \
  "${DATABASE_CONTAINER}"; then
  show_safe_database_deadlock_log
  fail "Real local private Storage API/policy gate failed."
fi

[[ ! -e "${STORAGE_STATUS_FILE}" ]] \
  || fail "Storage gate did not delete the credential-bearing local status file."

refresh_synthetic_browser_health
for browser_partition in provider p5b p5c p5d p5e remaining; do
  prepare_platform_auth_tsconfig "${browser_partition}" \
    || fail "Unable to create the disposable ${browser_partition} browser tsconfig."
done
browser_gate_started=true
# The local fixture records deliberately short-lived, synthetic provider-health
# evidence. Run all six tests that exercise positive freshness first so their real
# five-minute freshness contract is tested deterministically. The second pass
# still runs every other browser test; no assertion or health TTL is weakened.
if ! run_with_deadline 240000 env \
  EVO_P5B_BROWSER_PROOF=0 \
  EVO_P5C_BROWSER_PROOF=0 \
  EVO_P5E_BROWSER_PROOF=0 \
  EVO_PLATFORM_AUTH_DEV_RUN_KEY="${BROWSER_BUILD_RUN_KEY}" \
  EVO_PLATFORM_AUTH_BROWSER_PARTITION=provider \
  EVO_PLATFORM_AUTH_TSCONFIG_PATH="${PLATFORM_AUTH_TSCONFIG_DIR_RELATIVE}/tsconfig-platform-auth-provider.json" \
  EVO_PLATFORM_AUTH_FIXTURE_PATH="${PLATFORM_AUTH_BROWSER_FIXTURE}" \
  EVO_PLATFORM_LEGACY_DB_SENTINEL="${LEGACY_DB_SENTINEL}" \
  "${PLAYWRIGHT_CLI}" \
  test \
  --config "${REPO_ROOT}/playwright.platform-auth.config.ts" \
  --grep "${PROVIDER_GATED_BROWSER_TESTS}"; then
  fail "Provider-gated browser Platform messaging proof failed."
fi
if ! stop_exact_browser_server; then
  fail "The exact-worktree Platform browser server did not stop between browser partitions."
fi
if ! run_with_deadline 240000 env \
  EVO_P5B_BROWSER_PROOF=1 \
  EVO_P5C_BROWSER_PROOF=0 \
  EVO_P5E_BROWSER_PROOF=0 \
  EVO_PLATFORM_AUTH_DEV_RUN_KEY="${BROWSER_BUILD_RUN_KEY}" \
  EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5b \
  EVO_PLATFORM_AUTH_TSCONFIG_PATH="${PLATFORM_AUTH_TSCONFIG_DIR_RELATIVE}/tsconfig-platform-auth-p5b.json" \
  EVO_PLATFORM_AUTH_FIXTURE_PATH="${PLATFORM_AUTH_BROWSER_FIXTURE}" \
  EVO_PLATFORM_LEGACY_DB_SENTINEL="${LEGACY_DB_SENTINEL}" \
  "${PLAYWRIGHT_CLI}" \
  test \
  --config "${REPO_ROOT}/playwright.platform-auth.config.ts" \
  --grep "${P5B_BROWSER_TEST}"; then
  fail "P5B verified inbound WAHA projection browser proof failed."
fi
if ! stop_exact_browser_server; then
  fail "The exact-worktree Platform browser server did not stop after the P5B browser partition."
fi
if ! run_with_deadline 240000 env \
  EVO_P5B_BROWSER_PROOF=0 \
  EVO_P5C_BROWSER_PROOF=0 \
  EVO_P5D_BROWSER_PROOF=1 \
  EVO_P5E_BROWSER_PROOF=0 \
  EVO_PLATFORM_AUTH_DEV_RUN_KEY="${BROWSER_BUILD_RUN_KEY}" \
  EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5d \
  EVO_PLATFORM_AUTH_TSCONFIG_PATH="${PLATFORM_AUTH_TSCONFIG_DIR_RELATIVE}/tsconfig-platform-auth-p5d.json" \
  EVO_PLATFORM_AUTH_FIXTURE_PATH="${PLATFORM_AUTH_BROWSER_FIXTURE}" \
  EVO_PLATFORM_LEGACY_DB_SENTINEL="${LEGACY_DB_SENTINEL}" \
  "${PLAYWRIGHT_CLI}" \
  test \
  --config "${REPO_ROOT}/playwright.platform-auth.config.ts" \
  --grep "${P5D_BROWSER_TEST}"; then
  fail "P5D private WAHA media browser proof failed."
fi
if ! stop_exact_browser_server; then
  fail "The exact-worktree Platform browser server did not stop after the P5D browser partition."
fi
if ! run_with_deadline 240000 env \
  EVO_P5B_BROWSER_PROOF=0 \
  EVO_P5C_BROWSER_PROOF=1 \
  EVO_P5D_BROWSER_PROOF=0 \
  EVO_P5E_BROWSER_PROOF=0 \
  EVO_PLATFORM_AUTH_DEV_RUN_KEY="${BROWSER_BUILD_RUN_KEY}" \
  EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5c \
  EVO_PLATFORM_AUTH_TSCONFIG_PATH="${PLATFORM_AUTH_TSCONFIG_DIR_RELATIVE}/tsconfig-platform-auth-p5c.json" \
  EVO_PLATFORM_AUTH_FIXTURE_PATH="${PLATFORM_AUTH_BROWSER_FIXTURE}" \
  EVO_PLATFORM_LEGACY_DB_SENTINEL="${LEGACY_DB_SENTINEL}" \
  "${PLAYWRIGHT_CLI}" \
  test \
  --config "${REPO_ROOT}/playwright.platform-auth.config.ts" \
  --grep "${P5C_BROWSER_TEST}"; then
  fail "P5C read-only WAHA history reconciliation browser proof failed."
fi
if ! stop_exact_browser_server; then
  fail "The exact-worktree Platform browser server did not stop after the P5C browser partition."
fi
if ! run_with_deadline 240000 env \
  EVO_P5B_BROWSER_PROOF=0 \
  EVO_P5C_BROWSER_PROOF=0 \
  EVO_P5D_BROWSER_PROOF=0 \
  EVO_P5E_BROWSER_PROOF=1 \
  EVO_PLATFORM_AUTH_DEV_RUN_KEY="${BROWSER_BUILD_RUN_KEY}" \
  EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5e \
  EVO_PLATFORM_AUTH_TSCONFIG_PATH="${PLATFORM_AUTH_TSCONFIG_DIR_RELATIVE}/tsconfig-platform-auth-p5e.json" \
  EVO_PLATFORM_AUTH_FIXTURE_PATH="${PLATFORM_AUTH_BROWSER_FIXTURE}" \
  EVO_PLATFORM_LEGACY_DB_SENTINEL="${LEGACY_DB_SENTINEL}" \
  "${PLAYWRIGHT_CLI}" \
  test \
  --config "${REPO_ROOT}/playwright.platform-auth.config.ts" \
  --grep "${P5E_BROWSER_TEST}"; then
  fail "P5E WAHA ACK, session health and private Realtime browser proof failed."
fi
if ! stop_exact_browser_server; then
  fail "The exact-worktree Platform browser server did not stop after the P5E browser partition."
fi
if ! run_with_deadline 660000 env \
  EVO_P5B_BROWSER_PROOF=0 \
  EVO_P5C_BROWSER_PROOF=0 \
  EVO_P5D_BROWSER_PROOF=0 \
  EVO_P5E_BROWSER_PROOF=0 \
  EVO_PLATFORM_AUTH_DEV_RUN_KEY="${BROWSER_BUILD_RUN_KEY}" \
  EVO_PLATFORM_AUTH_BROWSER_PARTITION=remaining \
  EVO_PLATFORM_AUTH_TSCONFIG_PATH="${PLATFORM_AUTH_TSCONFIG_DIR_RELATIVE}/tsconfig-platform-auth-remaining.json" \
  EVO_PLATFORM_AUTH_FIXTURE_PATH="${PLATFORM_AUTH_BROWSER_FIXTURE}" \
  EVO_PLATFORM_LEGACY_DB_SENTINEL="${LEGACY_DB_SENTINEL}" \
  "${PLAYWRIGHT_CLI}" \
  test \
  --config "${REPO_ROOT}/playwright.platform-auth.config.ts" \
  --grep-invert "${PROVIDER_GATED_BROWSER_TESTS}|${P5B_BROWSER_TEST}|${P5C_BROWSER_TEST}|${P5D_BROWSER_TEST}|${P5E_BROWSER_TEST}"; then
  fail "Remaining real browser Platform Auth/staff-shell gate failed."
fi
if ! stop_exact_browser_server; then
  fail "The exact-worktree Platform browser server did not stop after the browser gate."
fi
browser_gate_started=false

rm -f -- "${PLATFORM_AUTH_BROWSER_FIXTURE}"
[[ ! -e "${LEGACY_DB_SENTINEL}" ]] \
  || fail "Platform Auth browser gate touched the forbidden legacy SQLite sentinel."

printf 'Supabase CLI %s reset the disposable local database successfully.\n' "${actual_cli_version}"
printf 'Verified %s contiguous canonical/applied migrations ending at %s; no application seed or production data was loaded.\n' \
  "${expected_migration_count}" \
  "${expected_last_migration}"
printf 'Verified local PostgREST exposes platform but excludes platform_private and pgmq_public.\n'
printf 'Verified real local Auth hook claims, refresh invalidation and PostgREST RLS with synthetic users.\n'
printf 'Verified real browser Supabase login/logout, invite-only signup, staff/student routing, representative legacy page/API/non-GET denial and no SQLite sentinel access.\n'
printf 'Verified real local private Storage API policy, exact size/MIME, reservation, attestation, service-only one-time signing grant and object hash contract with synthetic users.\n'
printf 'Storage evidence is local API/policy proof only; it does not prove a malware provider, managed Supabase or production.\n'
printf 'Verified real local PGMQ claims, visibility, retries, terminal unknown handling and dead-letter evidence.\n'
printf 'Verified signed WAHA ACK/session projection and private Realtime invalidation update the accepted UI without a page reload; provider execution remains unproved.\n'
