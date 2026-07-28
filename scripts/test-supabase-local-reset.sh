#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
export DO_NOT_TRACK=1
export SUPABASE_TELEMETRY_DISABLED=1

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SUPABASE_CLI="${REPO_ROOT}/node_modules/.bin/supabase"
readonly SUPABASE_PROJECT_ID="evo-platform-local"
readonly EXPECTED_CLI_VERSION="2.110.0"
readonly MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"
readonly POSTGREST_CONTAINER="supabase_rest_${SUPABASE_PROJECT_ID}"
readonly EXCLUDED_SERVICES="gotrue,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
readonly TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/evo-supabase-p2b.XXXXXX")"
readonly CANONICAL_VERSIONS_FILE="${TEMP_DIR}/canonical-versions.txt"

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

if ! postgrest_environment="$(
  docker inspect \
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

if ! "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  --output-format json \
  migration list \
  --local \
  >"${TEMP_DIR}/migration-list.json" 2>"${TEMP_DIR}/migration-list.log"; then
  show_safe_failure_log "${TEMP_DIR}/migration-list.log"
  fail "Unable to read the local migration history."
fi

node - \
  "${TEMP_DIR}/migration-list.json" \
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

printf 'Supabase CLI %s reset the disposable local database successfully.\n' "${actual_cli_version}"
printf 'Verified %s contiguous canonical/applied migrations ending at %s; no seed data was loaded.\n' \
  "${expected_migration_count}" \
  "${expected_last_migration}"
printf 'Verified local PostgREST exposes platform but excludes platform_private and pgmq_public.\n'
