#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
export DO_NOT_TRACK=1
export SUPABASE_TELEMETRY_DISABLED=1

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SUPABASE_CLI="${REPO_ROOT}/node_modules/.bin/supabase"
readonly SUPABASE_PROJECT_ID="evo-platform-local"
readonly EXPECTED_CLI_VERSION="2.110.0"
readonly EXPECTED_MIGRATION_COUNT=39
readonly MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"
readonly EXCLUDED_SERVICES="gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
readonly TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/evo-supabase-p2a.XXXXXX")"

cleanup() {
  local exit_code=$?

  trap - EXIT HUP INT TERM
  set +e

  # The project ID is explicit: never use `supabase stop --all`, and never stop
  # an unrelated local Supabase stack.
  if [[ -x "${SUPABASE_CLI}" ]]; then
    "${SUPABASE_CLI}" \
      --workdir "${REPO_ROOT}" \
      stop \
      --project-id "${SUPABASE_PROJECT_ID}" \
      --no-backup \
      >"${TEMP_DIR}/stop.log" 2>&1
  fi

  rm -rf -- "${TEMP_DIR}"
  exit "${exit_code}"
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

[[ -x "${SUPABASE_CLI}" ]] \
  || fail "Project-local Supabase CLI is missing. Run npm ci with Node 22 first."

[[ "$(node --version)" == v22.* ]] \
  || fail "Node 22 is required; found $(node --version)."

actual_cli_version="$("${SUPABASE_CLI}" --version)"
[[ "${actual_cli_version}" == "${EXPECTED_CLI_VERSION}" ]] \
  || fail "Expected Supabase CLI ${EXPECTED_CLI_VERSION}; found ${actual_cli_version}."

[[ -d "${MIGRATIONS_DIR}" ]] \
  || fail "Canonical migration directory is missing: ${MIGRATIONS_DIR}"

migration_files=("${MIGRATIONS_DIR}"/*.sql)
[[ -e "${migration_files[0]}" ]] \
  || fail "No canonical SQL migrations were found."
[[ "${#migration_files[@]}" -eq "${EXPECTED_MIGRATION_COUNT}" ]] \
  || fail "Expected ${EXPECTED_MIGRATION_COUNT} migrations; found ${#migration_files[@]}."

for index in "${!migration_files[@]}"; do
  expected_version="$(printf '%03d' "$((index + 1))")"
  migration_name="$(basename "${migration_files[${index}]}")"
  migration_version="${migration_name%%_*}"

  [[ "${migration_name}" =~ ^[0-9]{3}_.+\.sql$ ]] \
    || fail "Invalid canonical migration filename: ${migration_name}"
  [[ "${migration_version}" == "${expected_version}" ]] \
    || fail "Migration history is not contiguous: expected ${expected_version}, found ${migration_version}."
done

[[ ! -e "${REPO_ROOT}/supabase/.temp/project-ref" ]] \
  || fail "Refusing to run while this worktree contains a linked Supabase project ref."
[[ ! -e "${REPO_ROOT}/.supabase/project-ref" ]] \
  || fail "Refusing to run while this worktree contains a linked Supabase project ref."

command -v docker >/dev/null 2>&1 \
  || fail "Docker is required for the disposable local database."

if [[ -n "${DOCKER_HOST:-}" && "${DOCKER_HOST}" != unix://* ]]; then
  fail "DOCKER_HOST must reference a local unix socket, not ${DOCKER_HOST}."
fi

docker_context="$(docker context show 2>/dev/null)" \
  || fail "Unable to determine the active Docker context."
docker_endpoint="$(
  docker context inspect \
    "${docker_context}" \
    --format '{{ (index .Endpoints "docker").Host }}' \
    2>/dev/null
)" || fail "Unable to inspect Docker context ${docker_context}."
[[ "${docker_endpoint}" == unix://* ]] \
  || fail "Docker context ${docker_context} is not local (${docker_endpoint})."

docker info >/dev/null 2>&1 \
  || fail "The local Docker engine is not running."

# Remove only a stale stack with this exact project ID so the run begins from
# clean volumes. Output is suppressed because Supabase may print local secrets.
"${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  stop \
  --project-id "${SUPABASE_PROJECT_ID}" \
  --no-backup \
  >"${TEMP_DIR}/pre-stop.log" 2>&1 || true

if ! "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  --output-format json \
  start \
  --exclude "${EXCLUDED_SERVICES}" \
  >"${TEMP_DIR}/start.json" 2>"${TEMP_DIR}/start.log"; then
  # Do not echo start output: even failed starts can emit ephemeral local keys.
  fail "The disposable local Supabase database failed to start; credential-bearing output was withheld."
fi

if ! "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  --output-format json \
  db reset \
  --local \
  --no-seed \
  >"${TEMP_DIR}/reset.json" 2>"${TEMP_DIR}/reset.log"; then
  show_safe_failure_log "${TEMP_DIR}/reset.log"
  fail "Local Supabase reset failed."
fi

if ! "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  --output-format json \
  migration list \
  --local \
  >"${TEMP_DIR}/migration-list.json" 2>"${TEMP_DIR}/migration-list.log"; then
  show_safe_failure_log "${TEMP_DIR}/migration-list.log"
  fail "Unable to read the local migration history."
fi

node - "${TEMP_DIR}/migration-list.json" "${EXPECTED_MIGRATION_COUNT}" <<'NODE'
const fs = require("node:fs");

const [jsonPath, expectedCountText] = process.argv.slice(2);
const expectedCount = Number(expectedCountText);
const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const migrations = payload.migrations;

if (!Array.isArray(migrations)) {
  throw new Error("Supabase CLI did not return a migrations array.");
}

const expected = Array.from(
  { length: expectedCount },
  (_, index) => String(index + 1).padStart(3, "0"),
);
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
      `${label} migration history must be contiguous from 001 through 039; found ${actual.join(", ")}`,
    );
  }
}
NODE

printf 'Supabase CLI %s reset the disposable local database successfully.\n' "${actual_cli_version}"
printf 'Verified %s contiguous canonical/applied migrations ending at 039; no seed data was loaded.\n' \
  "${EXPECTED_MIGRATION_COUNT}"
