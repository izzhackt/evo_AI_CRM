#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
project_name="evo-database-foundation-$RANDOM-$$"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-database-foundation.XXXXXX")"
env_file="$tmp_dir/postgres.env"
app_log="$tmp_dir/app.log"
verification_log="$tmp_dir/verification.log"
broken_log="$tmp_dir/broken-migration.log"
canonical_acceptance_result="$tmp_dir/canonical-acceptance.json"
private_document_acceptance_result="$tmp_dir/private-document-acceptance.json"
private_document_root="$tmp_dir/private-documents"
missing_private_document_root="$tmp_dir/missing-private-documents"
inbound_test_phone="+15550004300"
inbound_test_conversation_id="v2-browser-conversation-430"
inbound_test_message_id="v2-browser-message-430"
inbound_test_text="V2 inbound browser proof 430"
canonical_lead_id=""
canonical_override_lead_id=""
private_document_case_id=""
app_pid=""
compose_args=()

fail() {
  echo "$1" >&2
  exit 1
}

free_port() {
  "$node_bin" --input-type=module <<'EOF'
import { createServer } from "node:net";
const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") process.exit(1);
  console.log(address.port);
  server.close();
});
EOF
}

cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
  fi
  if (( ${#compose_args[@]} > 0 )); then
    docker compose "${compose_args[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ -d "$tmp_dir" && "$tmp_dir" == "${TMPDIR:-/tmp}/evo-database-foundation."* ]]; then
    rm -R -- "$tmp_dir"
  fi
}
trap cleanup EXIT

stop_stale_next_dev_server() {
  local lock_path="$repo_root/.next/dev/lock"
  [[ -e "$lock_path" ]] || return 0

  local stale_pid=""
  while IFS= read -r stale_pid; do
    [[ -n "$stale_pid" ]] || continue

    local stale_cwd=""
    stale_cwd="$(lsof -a -p "$stale_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    [[ "$stale_cwd" == "$repo_root" ]] || continue

    local stale_command=""
    stale_command="$(ps -p "$stale_pid" -o command= 2>/dev/null || true)"
    [[ "$stale_command" == *"next-server"* || "$stale_command" == *"node_modules/next"* ]] || continue

    kill "$stale_pid" >/dev/null 2>&1 || true
    local deadline=$((SECONDS + 15))
    while kill -0 "$stale_pid" >/dev/null 2>&1; do
      (( SECONDS < deadline )) || fail "Stale next dev server ${stale_pid} in ${repo_root} did not stop"
      sleep 1
    done
  done < <(lsof -t -- "$lock_path" 2>/dev/null | sort -u)

  return 0
}

if [[ "$($node_bin --version)" != v22.* ]]; then
  fail "The database foundation gate requires Node 22.x"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  [[ "$(orb status)" == "Running" ]] || fail "OrbStack must be Running"
  [[ "$(docker context show)" == "orbstack" ]] || fail "Docker context must be exactly orbstack"
fi

postgres_port="${EVO_DATABASE_POSTGRES_PORT:-$(free_port)}"
app_port="${EVO_DATABASE_APP_PORT:-$(free_port)}"
postgres_user="evo_foundation"
postgres_database="evo_foundation"
broken_database="evo_foundation_broken"
postgres_password="$(openssl rand -hex 24)"
gate_session_secret="$(openssl rand -hex 32)"
gate_admin_identifier="director-local-$RANDOM"
gate_admin_secret="$(openssl rand -hex 32)"
gate_sales_identifier="sales-local-$RANDOM"
gate_sales_secret="$(openssl rand -hex 32)"
gate_admissions_identifier="admissions-local-$RANDOM"
gate_admissions_secret="$(openssl rand -hex 32)"
whatsapp_inbound_secret="$(openssl rand -hex 32)"
database_url="postgresql://${postgres_user}:${postgres_password}@127.0.0.1:${postgres_port}/${postgres_database}"
broken_database_url="postgresql://${postgres_user}:${postgres_password}@127.0.0.1:${postgres_port}/${broken_database}"

compose_args=(
  --project-name "$project_name"
  --env-file "$env_file"
  --file "$repo_root/docker-compose.local.yml"
)

cat >"$env_file" <<EOF
POSTGRES_USER=$postgres_user
POSTGRES_PASSWORD=$postgres_password
POSTGRES_DB=$postgres_database
POSTGRES_PORT=$postgres_port
EOF
chmod 600 "$env_file"

docker compose "${compose_args[@]}" up --detach postgres >/dev/null
container_id="$(docker compose "${compose_args[@]}" ps --quiet postgres)"
[[ -n "$container_id" ]] || fail "The private PostgreSQL container did not start"

health_deadline=$((SECONDS + 120))
status=""
while (( SECONDS < health_deadline )); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
if [[ "$status" != "healthy" ]]; then
  docker logs --tail 120 "$container_id" >&2 || true
  fail "The private PostgreSQL container did not become healthy"
fi

start_app() {
  local app_database_url="$1"
  local gate_mode="${2:-configured}"
  local document_mode="${3:-configured}"
  local inbound_mode="${4:-configured}"
  local document_root="$private_document_root"
  local inbound_secret="$whatsapp_inbound_secret"
  if [[ "$document_mode" == "unavailable" ]]; then
    document_root="$missing_private_document_root"
  fi
  if [[ "$inbound_mode" == "unavailable" ]]; then
    inbound_secret=""
  fi
  stop_stale_next_dev_server
  : >"$app_log"
  if [[ "$gate_mode" == "configured" ]]; then
    DATABASE_URL="$app_database_url" \
      EVO_PRIVATE_DOCUMENT_ROOT="$document_root" \
      EVO_DEV_GATE_SESSION_SECRET="$gate_session_secret" \
      EVO_DEV_GATE_ADMIN_IDENTIFIER="$gate_admin_identifier" \
      EVO_DEV_GATE_ADMIN_SECRET="$gate_admin_secret" \
      EVO_DEV_GATE_SALES_IDENTIFIER="$gate_sales_identifier" \
      EVO_DEV_GATE_SALES_SECRET="$gate_sales_secret" \
      EVO_DEV_GATE_ADMISSIONS_IDENTIFIER="$gate_admissions_identifier" \
      EVO_DEV_GATE_ADMISSIONS_SECRET="$gate_admissions_secret" \
      EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$inbound_secret" \
      "$node_bin" node_modules/next/dist/bin/next dev \
        --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
  else
    env \
      -u EVO_DEV_GATE_SESSION_SECRET \
      -u EVO_DEV_GATE_ADMIN_IDENTIFIER \
      -u EVO_DEV_GATE_ADMIN_SECRET \
      -u EVO_DEV_GATE_SALES_IDENTIFIER \
      -u EVO_DEV_GATE_SALES_SECRET \
      -u EVO_DEV_GATE_ADMISSIONS_IDENTIFIER \
      -u EVO_DEV_GATE_ADMISSIONS_SECRET \
      DATABASE_URL="$app_database_url" \
      EVO_PRIVATE_DOCUMENT_ROOT="$document_root" \
      EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$inbound_secret" \
      "$node_bin" node_modules/next/dist/bin/next dev \
        --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
  fi
  app_pid=$!

  local deadline=$((SECONDS + 120))
  local code=""
  while (( SECONDS < deadline )); do
    if ! kill -0 "$app_pid" >/dev/null 2>&1; then
      sed -n '1,200p' "$app_log" >&2
      fail "The application exited before browser validation"
    fi
    code="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${app_port}/api/health" || true)"
    [[ "$code" == "200" ]] && return
    sleep 2
  done
  sed -n '1,200p' "$app_log" >&2
  fail "The application did not become reachable"
}

stop_app() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
    app_pid=""
  fi
}

assert_app_reachable() {
  local deadline=$((SECONDS + 30))
  local code=""
  while (( SECONDS < deadline )); do
    if [[ -n "$app_pid" ]] && ! kill -0 "$app_pid" >/dev/null 2>&1; then
      sed -n '1,200p' "$app_log" >&2
      fail "The application exited before browser validation"
    fi
    code="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${app_port}/api/health" || true)"
    [[ "$code" == "200" ]] && return
    sleep 1
  done
  sed -n '1,200p' "$app_log" >&2
  fail "The application became unreachable before browser validation"
}

browser_assert() {
  local expected_status="$1"
  local expected_code="${2:-}"
  assert_app_reachable
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
    EVO_EXPECT_STATUS="$expected_status" \
    EVO_EXPECT_DATABASE_CODE="$expected_code" \
    "$node_bin" node_modules/@playwright/test/cli.js test \
      --config=playwright.database.config.ts
}

development_gate_browser_assert() {
  local gate_mode="$1"
  assert_app_reachable
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
    EVO_EXPECT_GATE_MODE="$gate_mode" \
    EVO_DEV_GATE_SESSION_SECRET="$gate_session_secret" \
    EVO_DEV_GATE_ADMIN_IDENTIFIER="$gate_admin_identifier" \
    EVO_DEV_GATE_ADMIN_SECRET="$gate_admin_secret" \
    EVO_DEV_GATE_SALES_IDENTIFIER="$gate_sales_identifier" \
    EVO_DEV_GATE_SALES_SECRET="$gate_sales_secret" \
    EVO_DEV_GATE_ADMISSIONS_IDENTIFIER="$gate_admissions_identifier" \
    EVO_DEV_GATE_ADMISSIONS_SECRET="$gate_admissions_secret" \
    "$node_bin" node_modules/@playwright/test/cli.js test \
      --config=playwright.development-gate.config.ts
}

private_document_browser_assert() {
  local document_mode="$1"
  assert_app_reachable
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
    EVO_EXPECT_DOCUMENT_MODE="$document_mode" \
    EVO_PRIVATE_DOCUMENT_CASE_ID="$private_document_case_id" \
    EVO_PRIVATE_DOCUMENT_ACCEPTANCE_RESULT_FILE="$private_document_acceptance_result" \
    EVO_DEV_GATE_ADMIN_IDENTIFIER="$gate_admin_identifier" \
    EVO_DEV_GATE_ADMIN_SECRET="$gate_admin_secret" \
    EVO_DEV_GATE_SALES_IDENTIFIER="$gate_sales_identifier" \
    EVO_DEV_GATE_SALES_SECRET="$gate_sales_secret" \
    EVO_DEV_GATE_ADMISSIONS_IDENTIFIER="$gate_admissions_identifier" \
    EVO_DEV_GATE_ADMISSIONS_SECRET="$gate_admissions_secret" \
    "$node_bin" node_modules/@playwright/test/cli.js test \
      --config=playwright.private-documents.config.ts
}

canonical_read_browser_assert() {
  local read_mode="$1"
  assert_app_reachable
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
    EVO_EXPECT_CANONICAL_READ_MODE="$read_mode" \
    EVO_CANONICAL_LEAD_ID="$canonical_lead_id" \
    EVO_CANONICAL_OVERRIDE_LEAD_ID="$canonical_override_lead_id" \
    EVO_CANONICAL_STUDENT_CASE_ID="$private_document_case_id" \
    EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$whatsapp_inbound_secret" \
    EVO_V2_INBOUND_TEST_PHONE="$inbound_test_phone" \
    EVO_V2_INBOUND_TEST_CONVERSATION_ID="$inbound_test_conversation_id" \
    EVO_V2_INBOUND_TEST_MESSAGE_ID="$inbound_test_message_id" \
    EVO_V2_INBOUND_TEST_TEXT="$inbound_test_text" \
    EVO_DEV_GATE_ADMIN_IDENTIFIER="$gate_admin_identifier" \
    EVO_DEV_GATE_ADMIN_SECRET="$gate_admin_secret" \
    EVO_DEV_GATE_SALES_IDENTIFIER="$gate_sales_identifier" \
    EVO_DEV_GATE_SALES_SECRET="$gate_sales_secret" \
    EVO_DEV_GATE_ADMISSIONS_IDENTIFIER="$gate_admissions_identifier" \
    EVO_DEV_GATE_ADMISSIONS_SECRET="$gate_admissions_secret" \
    "$node_bin" node_modules/@playwright/test/cli.js test \
      --config=playwright.canonical-crm.config.ts
}

assert_no_secret_or_payload_logs() {
  local value
  for value in \
    "gate-invalid-identifier-probe" \
    "gate-invalid-secret-probe" \
    "any-identifier" \
    "any-secret" \
    "$gate_admin_identifier" \
    "$gate_admin_secret" \
    "$gate_sales_identifier" \
    "$gate_sales_secret" \
    "$gate_admissions_identifier" \
    "$gate_admissions_secret" \
    "$whatsapp_inbound_secret" \
    "$inbound_test_phone" \
    "$inbound_test_conversation_id" \
    "$inbound_test_message_id" \
    "$inbound_test_text"; do
    if grep -F "$value" "$app_log" >/dev/null; then
      fail "The application log exposed a submitted secret or inbound payload value"
    fi
  done
}

expect_verify_failure() {
  local label="$1"
  if DATABASE_URL="$database_url" "$node_bin" scripts/verify-drizzle-history.mjs >"$verification_log" 2>&1; then
    fail "Database history verification unexpectedly passed: $label"
  fi
  if grep -F "$postgres_password" "$verification_log" >/dev/null; then
    fail "Database history verification leaked the database secret: $label"
  fi
}

cd "$repo_root"
mkdir -m 700 "$private_document_root"

"$node_bin" --conditions=react-server --experimental-strip-types --test \
  tests/database-config.test.mjs \
  tests/database-status-route.test.mjs
echo "Missing and malformed DATABASE_URL fail closed without any alternate local database path."

# Missing application configuration must block even if old environment values
# are present. The exact browser route must not invoke those paths.
EVO_DB_PATH="$tmp_dir/inert-local.db" \
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
  start_app ""
browser_assert 503 database_configuration_missing
canonical_read_browser_assert unavailable
stop_app

# Malformed configuration must be distinguished from an absent value without
# exposing the rejected connection string.
start_app "mysql://evo:private@127.0.0.1:3306/evo"
browser_assert 503 database_configuration_invalid
stop_app

# A reachable but unmigrated real database is still blocked.
start_app "$database_url"
browser_assert 503 database_migration_required

DATABASE_URL="$database_url" "$node_bin" node_modules/drizzle-kit/bin.cjs check
expect_verify_failure "no applied migration journal"

# A syntactically broken migration must roll back rather than create a partial
# technical contract in a second disposable database.
docker exec "$container_id" psql --username "$postgres_user" --dbname postgres \
  --command "CREATE DATABASE ${broken_database};" >/dev/null
broken_migrations="$tmp_dir/broken-drizzle"
cp -R "$repo_root/drizzle" "$broken_migrations"
printf '\nTHIS IS DELIBERATELY INVALID SQL;\n' >>"$broken_migrations/0000_database_foundation.sql"
if BROKEN_DATABASE_URL="$broken_database_url" BROKEN_MIGRATIONS="$broken_migrations" \
  "$node_bin" --input-type=module >"$broken_log" 2>&1 <<'EOF'
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const client = postgres(process.env.BROKEN_DATABASE_URL, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: process.env.BROKEN_MIGRATIONS });
} finally {
  await client.end({ timeout: 5 });
}
EOF
then
  fail "A deliberately broken migration unexpectedly succeeded"
fi
if grep -F "$postgres_password" "$broken_log" >/dev/null; then
  fail "Broken migration output leaked the database secret"
fi
partial_contract="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$broken_database" --tuples-only --no-align --command "SELECT to_regclass('public.evo_database_contract');")"
[[ -z "$partial_contract" ]] || fail "The broken migration left a partial database contract"

# The real migration command must be idempotent and verify the stored journal
# after each run, not merely trust a zero Drizzle CLI exit code.
DATABASE_URL="$database_url" "$node_bin" scripts/migrate-drizzle.mjs
DATABASE_URL="$database_url" "$node_bin" scripts/migrate-drizzle.mjs
DATABASE_URL="$database_url" "$node_bin" scripts/verify-drizzle-history.mjs
migration_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT count(*) FROM drizzle.__drizzle_migrations;')"
contract_version="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT version FROM evo_database_contract WHERE id = 1;')"
[[ "$migration_count" == "3" ]] || fail "Expected exact 0000 -> 0001 -> 0002 migration history"
[[ "$contract_version" == "3" ]] || fail "Canonical CRM migration did not publish database contract version 3"
echo "Exact 0000 -> 0001 -> 0002 migration, repeat migration and stored history passed."

DATABASE_URL="$database_url" \
  "$node_bin" --conditions=react-server --experimental-strip-types --test \
    tests/private-document-repository-postgres.test.mjs
echo "Private document case scope, immutable metadata reads and fail-closed repository checks passed."

DATABASE_URL="$database_url" \
  EVO_CANONICAL_ACCEPTANCE_RESULT_FILE="$canonical_acceptance_result" \
  "$node_bin" --conditions=react-server --experimental-strip-types --test \
    tests/canonical-crm-postgres.test.mjs
read -r canonical_lead_id canonical_override_lead_id private_document_case_id <<<"$(
  EVO_CANONICAL_ACCEPTANCE_RESULT_FILE="$canonical_acceptance_result" \
    "$node_bin" --input-type=module <<'EOF'
import { readFile } from "node:fs/promises";

const path = process.env.EVO_CANONICAL_ACCEPTANCE_RESULT_FILE;
const result = JSON.parse(await readFile(path, "utf8"));
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (
  typeof result.canonicalLeadId !== "string" ||
  !uuidPattern.test(result.canonicalLeadId) ||
  typeof result.canonicalOverrideLeadId !== "string" ||
  !uuidPattern.test(result.canonicalOverrideLeadId) ||
  typeof result.privateDocumentCaseId !== "string" ||
  !uuidPattern.test(result.privateDocumentCaseId)
) {
  throw new Error(
    "Canonical acceptance did not return valid normal lead, override lead and case ids",
  );
}
console.log(
  result.canonicalLeadId,
  result.canonicalOverrideLeadId,
  result.privateDocumentCaseId,
);
EOF
)"
echo "Canonical CRM graph, transactional idempotency, gate and append-only event checks passed."

browser_assert 200
development_gate_browser_assert configured
canonical_read_browser_assert configured
private_document_browser_assert configured
assert_no_secret_or_payload_logs

document_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT count(*) FROM evo_private_documents;')"
version_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT count(*) FROM evo_private_document_versions;')"
[[ "$document_count" == "1" ]] || fail "Private document browser proof did not persist exactly one logical document"
[[ "$version_count" == "2" ]] || fail "Private document browser proof did not persist exactly two immutable versions"
linked_document_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT count(*) FROM evo_private_documents AS document INNER JOIN evo_student_cases AS student_case ON student_case.id = document.case_id;')"
[[ "$linked_document_count" == "1" ]] || fail "Private document browser proof did not persist a canonical case foreign key"

read -r private_document_id initial_document_version_id initial_document_sha initial_document_bytes replacement_document_version_id replacement_document_sha replacement_document_bytes <<<"$(
  EVO_PRIVATE_DOCUMENT_ACCEPTANCE_RESULT_FILE="$private_document_acceptance_result" \
    EVO_PRIVATE_DOCUMENT_CASE_ID="$private_document_case_id" \
    "$node_bin" --input-type=module <<'EOF'
import { readFile } from "node:fs/promises";

const path = process.env.EVO_PRIVATE_DOCUMENT_ACCEPTANCE_RESULT_FILE;
const result = JSON.parse(await readFile(path, "utf8"));
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shaPattern = /^[0-9a-f]{64}$/;
if (
  !uuidPattern.test(result.documentId) ||
  result.caseId !== process.env.EVO_PRIVATE_DOCUMENT_CASE_ID ||
  !Array.isArray(result.versions) ||
  result.versions.length !== 2 ||
  result.versions.some(
    (version, index) =>
      !uuidPattern.test(version.versionId) ||
      version.versionNumber !== index + 1 ||
      !Number.isSafeInteger(version.byteLength) ||
      version.byteLength <= 0 ||
      !shaPattern.test(version.sha256),
  ) ||
  Object.hasOwn(result, "objectKey") ||
  result.versions.some((version) => Object.hasOwn(version, "objectKey"))
) {
  throw new Error("Private document UI acceptance result has an invalid shape");
}
console.log(
  result.documentId,
  result.versions[0].versionId,
  result.versions[0].sha256,
  result.versions[0].byteLength,
  result.versions[1].versionId,
  result.versions[1].sha256,
  result.versions[1].byteLength,
);
EOF
)"

private_document_row="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT case_id || '|' || created_by_role FROM evo_private_documents WHERE id = '${private_document_id}';")"
[[ "$private_document_row" == "${private_document_case_id}|admissions" ]] || fail "Private document UI proof did not bind the logical document to the canonical case and role"

initial_document_row="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT version_number || '|' || original_filename || '|' || declared_mime_type || '|' || byte_length || '|' || sha256 || '|' || created_by_role || '|' || object_key FROM evo_private_document_versions WHERE document_id = '${private_document_id}' AND id = '${initial_document_version_id}';")"
replacement_document_row="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT version_number || '|' || original_filename || '|' || declared_mime_type || '|' || byte_length || '|' || sha256 || '|' || created_by_role || '|' || object_key FROM evo_private_document_versions WHERE document_id = '${private_document_id}' AND id = '${replacement_document_version_id}';")"
IFS='|' read -r initial_version_number initial_filename initial_mime initial_bytes initial_sha initial_role initial_object_key <<<"$initial_document_row"
IFS='|' read -r replacement_version_number replacement_filename replacement_mime replacement_bytes replacement_sha replacement_role replacement_object_key <<<"$replacement_document_row"
[[ "$initial_version_number" == "1" && "$initial_filename" == "acceptance.pdf" && "$initial_mime" == "application/pdf" && "$initial_bytes" == "$initial_document_bytes" && "$initial_sha" == "$initial_document_sha" && "$initial_role" == "admissions" ]] || fail "Initial private document SQL metadata does not match the Student 360 upload"
[[ "$replacement_version_number" == "2" && "$replacement_filename" == "acceptance-replacement.pdf" && "$replacement_mime" == "application/pdf" && "$replacement_bytes" == "$replacement_document_bytes" && "$replacement_sha" == "$replacement_document_sha" && "$replacement_role" == "admissions" ]] || fail "Replacement private document SQL metadata does not match the Student 360 resubmission"

EVO_PRIVATE_DOCUMENT_ROOT="$private_document_root" \
  EVO_INITIAL_OBJECT_KEY="$initial_object_key" \
  EVO_INITIAL_OBJECT_SHA="$initial_document_sha" \
  EVO_INITIAL_OBJECT_BYTES="$initial_document_bytes" \
  EVO_REPLACEMENT_OBJECT_KEY="$replacement_object_key" \
  EVO_REPLACEMENT_OBJECT_SHA="$replacement_document_sha" \
  EVO_REPLACEMENT_OBJECT_BYTES="$replacement_document_bytes" \
  "$node_bin" --input-type=module <<'EOF'
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const proofs = [
  {
    key: process.env.EVO_INITIAL_OBJECT_KEY,
    sha256: process.env.EVO_INITIAL_OBJECT_SHA,
    byteLength: Number(process.env.EVO_INITIAL_OBJECT_BYTES),
  },
  {
    key: process.env.EVO_REPLACEMENT_OBJECT_KEY,
    sha256: process.env.EVO_REPLACEMENT_OBJECT_SHA,
    byteLength: Number(process.env.EVO_REPLACEMENT_OBJECT_BYTES),
  },
];
for (const proof of proofs) {
  if (!/^[0-9a-f-]{36}$/.test(proof.key ?? "")) {
    throw new Error("Private document object key is not opaque");
  }
  const bytes = await readFile(
    join(process.env.EVO_PRIVATE_DOCUMENT_ROOT, "objects", proof.key),
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== proof.byteLength || sha256 !== proof.sha256) {
    throw new Error("Private document object bytes do not match PostgreSQL metadata");
  }
}
EOF

inbound_conversation_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_conversations WHERE external_conversation_id = '${inbound_test_conversation_id}';")"
inbound_message_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_messages WHERE external_message_id = '${inbound_test_message_id}';")"
inbound_person_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_people WHERE phone_e164 = '${inbound_test_phone}';")"
inbound_lead_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_leads AS lead INNER JOIN evo_people AS person ON person.id = lead.person_id WHERE person.phone_e164 = '${inbound_test_phone}' AND lead.source = 'whatsapp';")"
inbound_event_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_business_events WHERE transition = 'message.received' AND business_object_id IN (SELECT id FROM evo_messages WHERE external_message_id = '${inbound_test_message_id}');")"
[[ "$inbound_conversation_count" == "1" ]] || fail "Inbound HTTP proof did not persist exactly one canonical conversation"
[[ "$inbound_message_count" == "1" ]] || fail "Inbound HTTP replay persisted duplicate canonical messages"
[[ "$inbound_person_count" == "1" ]] || fail "Inbound HTTP replay persisted duplicate canonical people"
[[ "$inbound_lead_count" == "1" ]] || fail "Inbound HTTP replay persisted duplicate canonical WhatsApp leads"
[[ "$inbound_event_count" == "1" ]] || fail "Inbound HTTP replay persisted duplicate message events"

browser_completed_task_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_admissions_tasks WHERE title = 'Browser V2-8A: проверить перевод аттестата' AND status = 'completed' AND version = 2;")"
browser_completed_task_event_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_business_events WHERE business_object_type = 'task' AND business_object_id IN (SELECT id FROM evo_admissions_tasks WHERE title = 'Browser V2-8A: проверить перевод аттестата') AND transition IN ('task.created', 'task.completed');")"
browser_cancelled_task_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_admissions_tasks WHERE title = 'Проверить унаследованный контекст Sales' AND status = 'cancelled' AND closure_reason = 'Контекст Sales уже проверен во время browser acceptance' AND version = 2;")"
browser_cancelled_task_event_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_business_events WHERE business_object_type = 'task' AND transition = 'task.cancelled' AND business_object_id IN (SELECT id FROM evo_admissions_tasks WHERE title = 'Проверить унаследованный контекст Sales' AND closure_reason = 'Контекст Sales уже проверен во время browser acceptance');")"
[[ "$browser_completed_task_count" == "1" ]] || fail "Admissions browser proof did not persist exactly one completed canonical task"
[[ "$browser_completed_task_event_count" == "2" ]] || fail "Admissions browser proof did not persist exactly one create and one completion event"
[[ "$browser_cancelled_task_count" == "1" ]] || fail "Admissions browser proof did not persist exactly one reasoned canonical cancellation"
[[ "$browser_cancelled_task_event_count" == "1" ]] || fail "Admissions browser proof did not persist exactly one cancellation event"

browser_operations_case_id="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT student_case_id FROM evo_university_applications WHERE institution_name = 'Browser Technical University' AND program_name = 'Canonical CRM validation' AND target_intake = '2027 Spring';")"
[[ "$browser_operations_case_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || fail "Admissions browser proof did not identify exactly one canonical operations case"
browser_application_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_university_applications WHERE student_case_id = '${browser_operations_case_id}' AND institution_name = 'Browser Technical University' AND program_name = 'Canonical CRM validation' AND target_intake = '2027 Spring' AND status = 'accepted' AND version = 4 AND next_action IS NULL AND next_action_at IS NULL AND submitted_at IS NOT NULL AND decided_at IS NOT NULL;")"
browser_application_event_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_business_events WHERE business_object_type = 'application' AND business_object_id IN (SELECT id FROM evo_university_applications WHERE student_case_id = '${browser_operations_case_id}' AND institution_name = 'Browser Technical University') AND transition IN ('application.created', 'application.next_action_updated', 'application.submitted', 'application.accepted');")"
browser_application_receipt_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_command_receipts WHERE status = 'succeeded' AND business_object_type = 'application' AND business_object_id IN (SELECT id FROM evo_university_applications WHERE student_case_id = '${browser_operations_case_id}' AND institution_name = 'Browser Technical University');")"
[[ "$browser_application_count" == "1" ]] || fail "Admissions browser proof did not persist the accepted version-4 canonical application"
[[ "$browser_application_event_count" == "4" ]] || fail "Admissions browser proof did not persist exactly four successful application events"
[[ "$browser_application_receipt_count" == "4" ]] || fail "Admissions browser proof did not complete exactly four application commands (found ${browser_application_receipt_count})"

browser_finance_stop_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_finance_stop_states WHERE student_case_id = '${browser_operations_case_id}' AND is_stopped = false AND reason = 'Admin подтвердил снятие внутреннего ограничения' AND changed_by_role = 'admin' AND version = 2;")"
browser_finance_event_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_business_events WHERE business_object_type = 'finance_stop' AND business_object_id IN (SELECT id FROM evo_finance_stop_states WHERE student_case_id = '${browser_operations_case_id}') AND transition IN ('finance_stop.asserted', 'finance_stop.released');")"
browser_finance_receipt_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_command_receipts WHERE status = 'succeeded' AND business_object_type = 'finance_stop' AND business_object_id IN (SELECT id FROM evo_finance_stop_states WHERE student_case_id = '${browser_operations_case_id}');")"
[[ "$browser_finance_stop_count" == "1" ]] || fail "Admissions browser proof did not persist the reasoned Admin finance release at version 2"
[[ "$browser_finance_event_count" == "2" ]] || fail "Admissions browser proof did not persist exactly the finance assert and release events"
[[ "$browser_finance_receipt_count" == "2" ]] || fail "Admissions browser proof did not complete exactly two finance-stop commands (found ${browser_finance_receipt_count})"

browser_visa_milestone_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_visa_milestones WHERE student_case_id = '${browser_operations_case_id}';")"
browser_document_milestone_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_visa_milestones WHERE student_case_id = '${browser_operations_case_id}' AND milestone_kind = 'document_preparation' AND status = 'completed' AND version = 3 AND completed_at IS NOT NULL;")"
browser_appointment_milestone_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_visa_milestones WHERE student_case_id = '${browser_operations_case_id}' AND milestone_kind = 'appointment' AND status = 'in_progress' AND version = 3 AND blocked_reason IS NULL;")"
browser_submission_milestone_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_visa_milestones WHERE student_case_id = '${browser_operations_case_id}' AND milestone_kind = 'submission' AND status = 'completed' AND version = 3 AND completed_at IS NOT NULL;")"
browser_visa_transition_event_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_business_events WHERE business_object_type = 'visa_milestone' AND business_object_id IN (SELECT id FROM evo_visa_milestones WHERE student_case_id = '${browser_operations_case_id}') AND transition IN ('visa_milestone.in_progress', 'visa_milestone.completed', 'visa_milestone.blocked');")"
browser_visa_receipt_count="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT count(*) FROM evo_command_receipts WHERE status = 'succeeded' AND business_object_type = 'visa_milestone' AND business_object_id IN (SELECT id FROM evo_visa_milestones WHERE student_case_id = '${browser_operations_case_id}');")"
[[ "$browser_visa_milestone_count" == "6" ]] || fail "Sales-to-Admissions handoff did not persist exactly six canonical visa milestones"
[[ "$browser_document_milestone_count" == "1" ]] || fail "Admissions browser proof did not complete the document-preparation milestone at version 3"
[[ "$browser_appointment_milestone_count" == "1" ]] || fail "Admissions browser proof did not preserve the reasoned appointment block/resume sequence"
[[ "$browser_submission_milestone_count" == "1" ]] || fail "Admissions browser proof did not complete visa submission after finance release"
[[ "$browser_visa_transition_event_count" == "6" ]] || fail "Admissions browser proof did not persist exactly six successful visa transition events"
[[ "$browser_visa_receipt_count" == "6" ]] || fail "Admissions browser proof did not complete exactly six visa transition commands (found ${browser_visa_receipt_count})"

stored_object_count="$(EVO_PRIVATE_DOCUMENT_ROOT="$private_document_root" "$node_bin" --input-type=module <<'EOF'
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.env.EVO_PRIVATE_DOCUMENT_ROOT;
const objects = join(root, "objects");
const rootStat = await lstat(root);
const objectsStat = await lstat(objects);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) process.exit(2);
if (!objectsStat.isDirectory() || objectsStat.isSymbolicLink()) process.exit(3);
if ((objectsStat.mode & 0o777) !== 0o700) process.exit(4);
const entries = await readdir(objects);
for (const entry of entries) {
  const stat = await lstat(join(objects, entry));
  if (!stat.isFile() || stat.isSymbolicLink()) process.exit(5);
  if ((stat.mode & 0o777) !== 0o600) process.exit(6);
}
console.log(entries.length);
EOF
)"
[[ "$stored_object_count" == "2" ]] || fail "Private document browser proof did not finalize exactly two private objects"

# Runtime contract drift blocks the real browser path.
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE evo_database_contract SET version = 4 WHERE id = 1;" >/dev/null
browser_assert 503 database_contract_mismatch
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE evo_database_contract SET version = 3 WHERE id = 1;" >/dev/null
browser_assert 200

# Applied-history proof covers missing, extra, reordered and tampered rows while
# preserving every expected migration in the now multi-migration journal.
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command 'CREATE TABLE public.evo_test_migration_history_backup AS TABLE drizzle.__drizzle_migrations;' >/dev/null
original_id="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT id FROM public.evo_test_migration_history_backup ORDER BY id LIMIT 1;')"
original_hash="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT hash FROM public.evo_test_migration_history_backup ORDER BY id LIMIT 1;')"
original_created_at="$(docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command 'SELECT created_at FROM public.evo_test_migration_history_backup ORDER BY id LIMIT 1;')"
[[ "$original_id" =~ ^[0-9]+$ ]] || fail "Stored migration id has an unexpected shape"
[[ "$original_hash" =~ ^[0-9a-f]{64}$ ]] || fail "Stored migration hash has an unexpected shape"
[[ "$original_created_at" =~ ^[0-9]+$ ]] || fail "Stored migration timestamp has an unexpected shape"

docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "DELETE FROM drizzle.__drizzle_migrations WHERE id = ${original_id};" >/dev/null
expect_verify_failure "missing applied migration"
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) SELECT id, hash, created_at FROM public.evo_test_migration_history_backup WHERE id = ${original_id};" >/dev/null

docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${original_hash}', $((original_created_at + 999999)));" >/dev/null
expect_verify_failure "extra applied migration"
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command 'DELETE FROM drizzle.__drizzle_migrations WHERE id NOT IN (SELECT id FROM public.evo_test_migration_history_backup);' >/dev/null

docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE drizzle.__drizzle_migrations SET created_at = $((original_created_at + 1)) WHERE id = ${original_id};" >/dev/null
expect_verify_failure "reordered migration timestamp"
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE drizzle.__drizzle_migrations SET created_at = ${original_created_at} WHERE id = ${original_id};" >/dev/null

docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE drizzle.__drizzle_migrations SET hash = repeat('0', 64) WHERE id = ${original_id};" >/dev/null
expect_verify_failure "tampered migration hash"
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE drizzle.__drizzle_migrations SET hash = '${original_hash}' WHERE id = ${original_id};" >/dev/null
DATABASE_URL="$database_url" "$node_bin" scripts/verify-drizzle-history.mjs
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command 'DROP TABLE public.evo_test_migration_history_backup;' >/dev/null

stop_app
start_app "$database_url" configured unavailable
private_document_browser_assert unavailable
assert_no_secret_or_payload_logs

stop_app
start_app "$database_url" configured configured unavailable
canonical_read_browser_assert inbound-unavailable
assert_no_secret_or_payload_logs

stop_app
start_app "$database_url" unavailable
development_gate_browser_assert unavailable
assert_no_secret_or_payload_logs

echo "Real PostgreSQL, Drizzle, canonical CRM, development gate, private files, application and Chromium proof passed."
