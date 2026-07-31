#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
export DO_NOT_TRACK=1
export SUPABASE_TELEMETRY_DISABLED=1
umask 077

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SUPABASE_CLI="${REPO_ROOT}/node_modules/.bin/supabase"
readonly PLAYWRIGHT_CLI="${REPO_ROOT}/node_modules/.bin/playwright"
readonly SUPABASE_PROJECT_ID="evo-platform-local"
readonly EXPECTED_CLI_VERSION="2.110.0"
readonly MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"
readonly POSTGREST_CONTAINER="supabase_rest_${SUPABASE_PROJECT_ID}"
readonly DATABASE_CONTAINER="supabase_db_${SUPABASE_PROJECT_ID}"
readonly EXCLUDED_SERVICES="realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"
readonly TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/evo-supabase-p2h.XXXXXX")"
readonly CANONICAL_VERSIONS_FILE="${TEMP_DIR}/canonical-versions.txt"
# Keep the established cross-checkout namespace: older repository revisions
# use this exact lock while operating the same Docker project ID.
readonly LOCK_DIR="${TMPDIR:-/tmp}/evo-supabase-p2c-${SUPABASE_PROJECT_ID}.lock"
lock_acquired=false
stack_owned=false

cleanup() {
  local exit_code=$?

  trap - EXIT HUP INT TERM
  set +e

  # The project ID is explicit: never use `supabase stop --all`, and never stop
  # an unrelated local Supabase stack.
  if [[ "${stack_owned}" == true && -x "${SUPABASE_CLI}" ]]; then
    "${SUPABASE_CLI}" \
      --workdir "${REPO_ROOT}" \
      stop \
      --project-id "${SUPABASE_PROJECT_ID}" \
      --no-backup \
      >"${TEMP_DIR}/stop.log" 2>&1
  fi

  if [[ "${lock_acquired}" == true ]]; then
    rm -f -- "${LOCK_DIR}/pid"
    rmdir -- "${LOCK_DIR}" 2>/dev/null
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

show_safe_database_deadlock_log() {
  local database_log="${TEMP_DIR}/database.log"
  local deadlock_log="${TEMP_DIR}/database-deadlock.log"

  if ! docker logs "${DATABASE_CONTAINER}" >"${database_log}" 2>&1; then
    return
  fi

  awk '
    /deadlock detected/ { capture = 1 }
    capture && $0 ~ /deadlock detected|DETAIL:|HINT:|CONTEXT:/ { print }
  ' "${database_log}" >"${deadlock_log}"

  show_safe_failure_log "${deadlock_log}"
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

if ! mkdir -- "${LOCK_DIR}" 2>/dev/null; then
  fail "Another evo-platform-local reset owns ${LOCK_DIR}; refusing to stop its stack."
fi
lock_acquired=true
printf '%s\n' "$$" >"${LOCK_DIR}/pid"
stack_owned=true

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
  seed buckets \
  --local \
  >"${TEMP_DIR}/seed-buckets.log" 2>&1; then
  # Bucket seeding can include local API coordinates. Keep its raw output in
  # the mode-0700 temporary directory and report only the bounded stage.
  fail "Declarative local Storage bucket seeding failed; output was withheld."
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

readonly AUTH_STATUS_FILE="${TEMP_DIR}/auth-status.json"
readonly PLATFORM_AUTH_BROWSER_FIXTURE="${TEMP_DIR}/platform-auth-browser.json"
readonly LEGACY_DB_SENTINEL="${TEMP_DIR}/legacy-must-not-exist.db"
: >"${AUTH_STATUS_FILE}"
: >"${PLATFORM_AUTH_BROWSER_FIXTURE}"
chmod 600 "${AUTH_STATUS_FILE}"
chmod 600 "${PLATFORM_AUTH_BROWSER_FIXTURE}"

if ! "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  status \
  --output json \
  >"${AUTH_STATUS_FILE}" 2>"${TEMP_DIR}/auth-status.log"; then
  fail "Unable to read disposable local Supabase status; credential-bearing output was withheld."
fi

if ! node \
  "${REPO_ROOT}/scripts/test-supabase-auth-hook.mjs" \
  "${AUTH_STATUS_FILE}" \
  "${DATABASE_CONTAINER}" \
  "${PLATFORM_AUTH_BROWSER_FIXTURE}"; then
  fail "Local Supabase Auth/PostgREST hook smoke failed."
fi

[[ ! -e "${AUTH_STATUS_FILE}" ]] \
  || fail "Auth smoke did not delete the credential-bearing local status file."

if ! EVO_PLATFORM_AUTH_FIXTURE_PATH="${PLATFORM_AUTH_BROWSER_FIXTURE}" \
  EVO_PLATFORM_LEGACY_DB_SENTINEL="${LEGACY_DB_SENTINEL}" \
  "${PLAYWRIGHT_CLI}" \
  test \
  --config "${REPO_ROOT}/playwright.platform-auth.config.ts"; then
  fail "Real browser Platform Auth/staff-shell gate failed."
fi

rm -f -- "${PLATFORM_AUTH_BROWSER_FIXTURE}"
[[ ! -e "${LEGACY_DB_SENTINEL}" ]] \
  || fail "Platform Auth browser gate touched the forbidden legacy SQLite sentinel."

# The browser workflow intentionally leaves one AI job and one manual-send job
# queued so the UI can prove real outbox persistence. Reset the disposable
# database before the independent Storage and empty-queue runtime gates.
if ! "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  --output-format json \
  db reset \
  --local \
  --no-seed \
  >"${TEMP_DIR}/post-browser-reset.json" \
  2>"${TEMP_DIR}/post-browser-reset.log"; then
  show_safe_failure_log "${TEMP_DIR}/post-browser-reset.log"
  fail "Post-browser disposable Supabase reset failed."
fi

if ! "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  seed buckets \
  --local \
  >"${TEMP_DIR}/post-browser-seed-buckets.log" 2>&1; then
  fail "Post-browser local Storage bucket seeding failed; output was withheld."
fi

readonly STORAGE_STATUS_FILE="${TEMP_DIR}/storage-status.json"
: >"${STORAGE_STATUS_FILE}"
chmod 600 "${STORAGE_STATUS_FILE}"

if ! "${SUPABASE_CLI}" \
  --workdir "${REPO_ROOT}" \
  status \
  --output json \
  >"${STORAGE_STATUS_FILE}" 2>"${TEMP_DIR}/storage-status.log"; then
  fail "Unable to read disposable local Storage status; credential-bearing output was withheld."
fi

if ! node \
  "${REPO_ROOT}/scripts/test-p2h-storage-api.mjs" \
  "${STORAGE_STATUS_FILE}" \
  "${DATABASE_CONTAINER}"; then
  show_safe_database_deadlock_log
  fail "Real local private Storage API/policy gate failed."
fi

[[ ! -e "${STORAGE_STATUS_FILE}" ]] \
  || fail "Storage gate did not delete the credential-bearing local status file."

if ! bash \
  "${REPO_ROOT}/scripts/test-p2g-queues-runtime.sh" \
  "${DATABASE_CONTAINER}" \
  "postgres"; then
  fail "Real local PGMQ visibility/retry/dead-letter gate failed."
fi

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
