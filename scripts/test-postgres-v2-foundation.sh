#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
project_name="evo-database-foundation-$RANDOM-$$"
supabase_lock_dir="${TMPDIR:-/tmp}/evo-platform-local-supabase-foundation.lock"
if ! mkdir "$supabase_lock_dir" 2>/dev/null; then
  echo "Another EVO local Supabase foundation harness is already running: ${supabase_lock_dir}" >&2
  exit 1
fi
supabase_lock_acquired=1
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-database-foundation.XXXXXX")"
env_file="$tmp_dir/postgres.env"
app_log="$tmp_dir/app.log"
supabase_log="$tmp_dir/supabase.log"
supabase_env_file="$tmp_dir/supabase.env"
staff_provision_log="$tmp_dir/staff-provision.log"
sales_proof_provision_log="$tmp_dir/sales-proof-provision.log"
waha_log="$tmp_dir/waha.log"
waha_acceptance_result="$tmp_dir/waha-acceptance.json"
verification_log="$tmp_dir/verification.log"
broken_log="$tmp_dir/broken-migration.log"
private_document_root="$tmp_dir/private-documents"
missing_private_document_root="$tmp_dir/missing-private-documents"
inbound_test_phone="+15550004300"
inbound_test_conversation_id="15550004300@c.us"
inbound_test_message_id="v2-browser-message-430"
inbound_test_text="V2 inbound browser proof 430"
supabase_sales_lead_id="54600000-0000-4000-8000-000000000001"
supabase_sales_client_id="54600000-0000-4000-8000-000000000002"
supabase_sales_workflow_lead_id="54600000-0000-4000-8000-000000000003"
supabase_sales_api_lead_id="54600000-0000-4000-8000-000000000004"
supabase_sales_conversation_lead_id="54600000-0000-4000-8000-000000000006"
supabase_sales_conversation_id="54600000-0000-4000-8000-000000000007"
supabase_handoff_client_id="54600000-0000-4000-8000-000000000028"
supabase_handoff_lead_id="54600000-0000-4000-8000-000000000029"
app_pid=""
waha_pid=""
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

read_supabase_env_value() {
  local name="$1"
  local line=""
  local value=""

  line="$(grep -m 1 -E "^${name}=" "$supabase_env_file" || true)"
  [[ -n "$line" ]] || fail "Local Supabase status did not provide ${name}"
  value="${line#*=}"
  value="${value#\"}"
  value="${value%\"}"
  [[ -n "$value" ]] || fail "Local Supabase status provided an empty ${name}"
  printf '%s' "$value"
}

wait_for_local_supabase_auth_admin() {
  local api_url="$1"
  local service_role_key="$2"

  API_URL="$api_url" \
    SERVICE_ROLE_KEY="$service_role_key" \
    "$node_bin" --input-type=module <<'EOF'
import { waitForLocalSupabaseAuthAdmin } from "./scripts/supabase-auth-readiness.mjs";

await waitForLocalSupabaseAuthAdmin({
  apiUrl: process.env.API_URL,
  serviceRoleKey: process.env.SERVICE_ROLE_KEY,
  maxAttempts: 1200,
  readinessTimeoutMs: 300000,
});
EOF
}

cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$waha_pid" ]]; then
    kill "$waha_pid" >/dev/null 2>&1 || true
    wait "$waha_pid" >/dev/null 2>&1 || true
  fi
  if (( ${#compose_args[@]} > 0 )); then
    docker compose "${compose_args[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ -d "$tmp_dir" && "$tmp_dir" == "${TMPDIR:-/tmp}/evo-database-foundation."* ]]; then
    rm -R -- "$tmp_dir"
  fi
  if [[ "${supabase_lock_acquired:-0}" == "1" ]]; then
    rmdir "$supabase_lock_dir" >/dev/null 2>&1 || true
    supabase_lock_acquired=0
  fi
}
trap cleanup EXIT

assert_next_dev_lock_available() {
  local lock_path="$repo_root/.next/dev/lock"
  [[ -e "$lock_path" ]] || return 0

  command -v lsof >/dev/null 2>&1 \
    || fail "Cannot inspect the existing Next dev lock at ${lock_path}: lsof is unavailable"

  local holder_pids=""
  holder_pids="$(lsof -t -- "$lock_path" 2>/dev/null | sort -u || true)"
  [[ -z "$holder_pids" ]] || fail \
    "Cannot start isolated V2 proof: an active process owns ${lock_path} (PID(s): $(echo "$holder_pids" | tr '\n' ' ')). Stop that development server explicitly and rerun. No process was terminated."
}

if [[ "$($node_bin --version)" != v22.* ]]; then
  fail "The database foundation gate requires Node 22.x"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  [[ "$(orb status)" == "Running" ]] || fail "OrbStack must be Running"
  [[ "$(docker context show)" == "orbstack" ]] || fail "Docker context must be exactly orbstack"
fi

"$repo_root/scripts/test-postgres-authorization.sh"
echo "Supabase migration, RLS, request replay and concurrent handoff proofs passed."

postgres_port="${EVO_DATABASE_POSTGRES_PORT:-$(free_port)}"
app_port="${EVO_DATABASE_APP_PORT:-$(free_port)}"
postgres_user="evo_foundation"
postgres_database="evo_foundation"
broken_database="evo_foundation_broken"
postgres_password="$(openssl rand -hex 24)"
staff_identity_suffix="${RANDOM}-$$-$(openssl rand -hex 4)"
staff_admin_email="admin-${staff_identity_suffix}@evo.local.test"
staff_admin_password="$(openssl rand -hex 24)"
staff_sales_email="sales-${staff_identity_suffix}@evo.local.test"
staff_sales_password="$(openssl rand -hex 24)"
staff_admissions_email="admissions-${staff_identity_suffix}@evo.local.test"
staff_admissions_password="$(openssl rand -hex 24)"
supabase_api_url=""
supabase_publishable_key=""
supabase_service_role_key=""
supabase_database_url=""
whatsapp_inbound_secret="$(openssl rand -hex 32)"
waha_api_key="technical-waha-provider-key"
waha_session_name="evo-v2-technical"
waha_port="${EVO_DATABASE_WAHA_PORT:-$(free_port)}"
waha_base_url="http://127.0.0.1:${waha_port}"
amocrm_token_probe="$(openssl rand -hex 24)"
amocrm_token_file="$tmp_dir/amocrm-token.json"
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

if ! (
  cd "$repo_root"
  npx --no-install supabase start --yes
) >"$supabase_log" 2>&1; then
  fail "The disposable local Supabase stack did not start; inspect its private harness log"
fi
if ! (
  cd "$repo_root"
  npx --no-install supabase db reset --local --no-seed --yes
) >>"$supabase_log" 2>&1; then
  fail "The disposable local Supabase database did not reset to repository migrations"
fi
if ! (
  cd "$repo_root"
  npx --no-install supabase status -o env
) >"$supabase_env_file" 2>>"$supabase_log"; then
  fail "The disposable local Supabase stack did not expose its local runtime configuration"
fi
chmod 600 "$supabase_env_file" "$supabase_log"

supabase_api_url="$(read_supabase_env_value API_URL)"
supabase_publishable_key="$(read_supabase_env_value PUBLISHABLE_KEY)"
supabase_service_role_key="$(read_supabase_env_value SERVICE_ROLE_KEY)"
supabase_database_url="$(read_supabase_env_value DB_URL)"
[[ "$supabase_api_url" == http://127.0.0.1:* || "$supabase_api_url" == http://localhost:* ]] \
  || fail "The local Supabase API URL is not loopback-only"
[[ "$supabase_database_url" == postgresql://*@127.0.0.1:*/* || "$supabase_database_url" == postgresql://*@localhost:*/* ]] \
  || fail "The local Supabase database URL is not loopback-only"
[[ ${#supabase_publishable_key} -ge 16 && ${#supabase_service_role_key} -ge 16 ]] \
  || fail "The local Supabase stack returned malformed API keys"
if ! wait_for_local_supabase_auth_admin "$supabase_api_url" "$supabase_service_role_key" \
  >>"$supabase_log" 2>&1; then
  fail "The local Supabase Auth Admin API did not become ready"
fi

if ! NEXT_PUBLIC_SUPABASE_URL="$supabase_api_url" \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$supabase_publishable_key" \
  SUPABASE_SERVICE_ROLE_KEY="$supabase_service_role_key" \
  EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
  EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
  EVO_STAFF_AUTH_SALES_EMAIL="$staff_sales_email" \
  EVO_STAFF_AUTH_SALES_PASSWORD="$staff_sales_password" \
  EVO_STAFF_AUTH_ADMISSIONS_EMAIL="$staff_admissions_email" \
  EVO_STAFF_AUTH_ADMISSIONS_PASSWORD="$staff_admissions_password" \
  "$node_bin" scripts/provision-local-supabase-staff.mjs \
    >"$staff_provision_log" 2>&1; then
  provision_failure="$(grep -m 1 -E '^LOCAL_SUPABASE_STAFF_ERROR:[A-Z0-9_]+$' "$staff_provision_log" || true)"
  [[ -z "$provision_failure" ]] || echo "$provision_failure" >&2
  fail "Local Supabase staff identity and RLS provisioning failed"
fi
grep -Fx "LOCAL_SUPABASE_STAFF_PROVISIONED" "$staff_provision_log" >/dev/null \
  || fail "Local Supabase staff provisioning did not return its success marker"
for sensitive_value in \
  "$supabase_service_role_key" \
  "$staff_admin_email" \
  "$staff_admin_password" \
  "$staff_sales_email" \
  "$staff_sales_password" \
  "$staff_admissions_email" \
  "$staff_admissions_password"; do
  if grep -F "$sensitive_value" "$staff_provision_log" >/dev/null; then
    fail "Local Supabase staff provisioning exposed a credential in its output"
  fi
done

if ! SUPABASE_DB_URL="$supabase_database_url" \
  EVO_STAFF_AUTH_SALES_EMAIL="$staff_sales_email" \
  "$node_bin" scripts/provision-local-supabase-sales-proof.mjs \
    >"$sales_proof_provision_log" 2>&1; then
  sales_proof_failure="$(grep -m 1 -E '^LOCAL_SUPABASE_SALES_PROOF_ERROR:[A-Z0-9_]+$' "$sales_proof_provision_log" || true)"
  [[ -z "$sales_proof_failure" ]] || echo "$sales_proof_failure" >&2
  fail "Local Supabase Sales read proof provisioning failed"
fi
chmod 600 "$sales_proof_provision_log"
grep -Fx "LOCAL_SUPABASE_SALES_PROOF ${supabase_sales_lead_id} ${supabase_sales_client_id} ${supabase_sales_workflow_lead_id} ${supabase_sales_api_lead_id} ${supabase_sales_conversation_lead_id} ${supabase_sales_conversation_id} ${supabase_handoff_lead_id} ${supabase_handoff_client_id}" \
  "$sales_proof_provision_log" >/dev/null \
  || fail "Local Supabase Sales read proof did not return its success marker"
for sensitive_value in "$supabase_database_url" "$staff_sales_email"; do
  if grep -F "$sensitive_value" "$sales_proof_provision_log" >/dev/null; then
    fail "Local Supabase Sales read proof exposed a credential in its output"
  fi
done

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

start_isolated_waha_service() {
  [[ -z "$waha_pid" ]] || fail "The isolated WAHA-shaped service is already running"
  : >"$waha_log"
  EVO_TEST_WAHA_PORT="$waha_port" \
    EVO_TEST_WAHA_API_KEY="$waha_api_key" \
    EVO_TEST_WAHA_SESSION="$waha_session_name" \
    EVO_TEST_WAHA_RESULT_FILE="$waha_acceptance_result" \
    "$node_bin" --input-type=module >"$waha_log" 2>&1 <<'EOF' &
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.EVO_TEST_WAHA_PORT);
const apiKey = process.env.EVO_TEST_WAHA_API_KEY;
const session = process.env.EVO_TEST_WAHA_SESSION;
const resultFile = process.env.EVO_TEST_WAHA_RESULT_FILE;
const providerAccount = "971500000000@c.us";
const providerAccountLid = "100000000000000@lid";
let sendCount = 0;
let listReadCount = 0;
let exactReadCount = 0;
const requests = [];
const listReadRecipients = [];
const storedMessages = [];

function writeResult() {
  writeFileSync(
    resultFile,
    JSON.stringify({
      sendCount,
      listReadCount,
      exactReadCount,
      requests,
      listReadRecipients,
    }),
    { mode: 0o600 },
  );
}

function json(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(encoded),
  });
  response.end(encoded);
}

const server = createServer(async (request, response) => {
  if (request.headers["x-api-key"] !== apiKey) {
    json(response, 401, { error: "unauthorized" });
    return;
  }
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === `/api/sessions/${session}`) {
    json(response, 200, {
      name: session,
      status: "WORKING",
      me: { id: providerAccount, lid: providerAccountLid },
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sendText") {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    sendCount += 1;
    requests.push(body);
    writeResult();
    if (sendCount > 2) {
      json(response, 409, { error: "duplicate_send" });
      return;
    }
    const storedMessage = {
      id:
        sendCount === 1
          ? "technical-provider-message-465"
          : "technical-provider-recovered-message-465",
      timestamp: Math.floor(Date.now() / 1000),
      from: providerAccount,
      to: sendCount === 2 ? providerAccountLid : body.chatId,
      fromMe: true,
      source: sendCount === 2 ? "app" : "api",
      body: body.text,
      ack: 1,
      ackName: "SERVER",
    };
    storedMessages.push(storedMessage);
    if (sendCount === 2) {
      json(response, 200, { ...storedMessage, body: `${body.text} malformed` });
      return;
    }
    json(response, 200, storedMessage);
    return;
  }

  const messagesPrefix = `/api/${session}/chats/`;
  if (
    request.method === "GET" &&
    url.pathname.startsWith(messagesPrefix) &&
    url.pathname.endsWith("/messages") &&
    url.searchParams.get("limit") === "100" &&
    url.searchParams.get("downloadMedia") === "false" &&
    url.searchParams.get("filter.fromMe") === "true"
  ) {
    const windowStart = Number(url.searchParams.get("filter.timestamp.gte"));
    const windowEnd = Number(url.searchParams.get("filter.timestamp.lte"));
    if (
      !Number.isFinite(windowStart) ||
      !Number.isFinite(windowEnd) ||
      windowEnd < windowStart
    ) {
      json(response, 400, { error: "invalid_window" });
      return;
    }
    const encodedRecipient = url.pathname.slice(
      messagesPrefix.length,
      -"/messages".length,
    );
    const recipient = decodeURIComponent(encodedRecipient.replace(/\/$/u, ""));
    listReadCount += 1;
    listReadRecipients.push(recipient);
    writeResult();
    json(
      response,
      200,
      storedMessages.filter(
        (message) =>
          message.to === recipient &&
          message.fromMe === true &&
          message.timestamp >= windowStart &&
          message.timestamp <= windowEnd,
      ),
    );
    return;
  }

  if (
    request.method === "GET" &&
    url.searchParams.get("downloadMedia") === "false"
  ) {
    const matchedMessage = storedMessages.find(
      (message) =>
        url.pathname ===
        `/api/${session}/chats/${encodeURIComponent(message.to)}/messages/${encodeURIComponent(message.id)}`,
    );
    if (matchedMessage) {
      exactReadCount += 1;
      writeResult();
      json(response, 200, matchedMessage);
      return;
    }
  }
  json(response, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1");
EOF
  waha_pid=$!

  local deadline=$((SECONDS + 30))
  local code=""
  while (( SECONDS < deadline )); do
    if ! kill -0 "$waha_pid" >/dev/null 2>&1; then
      sed -n '1,160p' "$waha_log" >&2
      fail "The isolated WAHA-shaped service exited before browser validation"
    fi
    code="$(curl --silent --output /dev/null --write-out '%{http_code}' \
      --header "X-Api-Key: ${waha_api_key}" \
      "${waha_base_url}/api/sessions/${waha_session_name}" || true)"
    [[ "$code" == "200" ]] && return
    sleep 1
  done
  sed -n '1,160p' "$waha_log" >&2
  fail "The isolated WAHA-shaped service did not become ready"
}

start_app() {
  local app_database_url="$1"
  local supabase_mode="${2:-configured}"
  local document_mode="${3:-configured}"
  local inbound_mode="${4:-configured}"
  local waha_mode="${5:-blocked}"
  local amocrm_mode="${6:-provider-not-authorized}"
  local document_root="$private_document_root"
  local inbound_secret="$whatsapp_inbound_secret"
  local waha_provider_authorized=0
  local app_waha_base_url="http://evo-v2-waha:3000"
  local amocrm_provider_authorized=0
  local amocrm_sales_pipeline_id=""
  local amocrm_sales_status_id=""
  local amocrm_sales_responsible_user_id=""
  local amocrm_sales_tag_name=""
  local amocrm_admissions_pipeline_id=""
  local amocrm_admissions_status_id=""
  local amocrm_admissions_responsible_user_id=""
  local amocrm_admissions_tag_name=""
  if [[ "$document_mode" == "unavailable" ]]; then
    document_root="$missing_private_document_root"
  fi
  if [[ "$inbound_mode" == "unavailable" ]]; then
    inbound_secret=""
  fi
  if [[ "$waha_mode" == "local-service" ]]; then
    waha_provider_authorized=1
    app_waha_base_url="$waha_base_url"
  elif [[ "$waha_mode" != "blocked" ]]; then
    fail "Unknown isolated WAHA harness mode: $waha_mode"
  fi
  if [[ "$amocrm_mode" == "routing-missing" ]]; then
    amocrm_provider_authorized=1
  elif [[ "$amocrm_mode" == "token-missing" || "$amocrm_mode" == "token-invalid" ]]; then
    amocrm_provider_authorized=1
    amocrm_sales_pipeline_id="466001"
    amocrm_sales_status_id="466002"
    amocrm_sales_responsible_user_id="466003"
    amocrm_sales_tag_name="EVO V2 Sales"
    amocrm_admissions_pipeline_id="466004"
    amocrm_admissions_status_id="466005"
    amocrm_admissions_responsible_user_id="466006"
    amocrm_admissions_tag_name="EVO V2 Admissions"
  elif [[ "$amocrm_mode" != "provider-not-authorized" ]]; then
    fail "Unknown isolated amoCRM harness mode: $amocrm_mode"
  fi
  assert_next_dev_lock_available
  : >"$app_log"
  if [[ "$supabase_mode" == "configured" ]]; then
    DATABASE_URL="$app_database_url" \
      EVO_PRIVATE_DOCUMENT_ROOT="$document_root" \
      NEXT_PUBLIC_SUPABASE_URL="$supabase_api_url" \
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$supabase_publishable_key" \
      EVO_PLATFORM_SUPABASE_SECRET_KEY="$supabase_service_role_key" \
      EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
      EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
      EVO_STAFF_AUTH_SALES_EMAIL="$staff_sales_email" \
      EVO_STAFF_AUTH_SALES_PASSWORD="$staff_sales_password" \
      EVO_STAFF_AUTH_ADMISSIONS_EMAIL="$staff_admissions_email" \
      EVO_STAFF_AUTH_ADMISSIONS_PASSWORD="$staff_admissions_password" \
      EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$inbound_secret" \
      EVO_V2_GEMINI_PROPOSALS_ENABLED=1 \
      EVO_V2_GEMINI_PROVIDER_AUTHORIZED=0 \
      EVO_V2_WAHA_ENABLED=1 \
      EVO_V2_WAHA_PROVIDER_AUTHORIZED="$waha_provider_authorized" \
      EVO_V2_WAHA_BASE_URL="$app_waha_base_url" \
      EVO_V2_WAHA_API_KEY="$waha_api_key" \
      EVO_V2_WAHA_SESSION_NAME="$waha_session_name" \
      EVO_V2_AMOCRM_WRITES_ENABLED=1 \
      EVO_V2_AMOCRM_PROVIDER_AUTHORIZED="$amocrm_provider_authorized" \
      EVO_V2_AMOCRM_BASE_URL="https://evo-v2-technical.amocrm.ru" \
      EVO_V2_AMOCRM_TOKEN_FILE="$amocrm_token_file" \
      EVO_V2_AMOCRM_SALES_PIPELINE_ID="$amocrm_sales_pipeline_id" \
      EVO_V2_AMOCRM_SALES_STATUS_ID="$amocrm_sales_status_id" \
      EVO_V2_AMOCRM_SALES_RESPONSIBLE_USER_ID="$amocrm_sales_responsible_user_id" \
      EVO_V2_AMOCRM_SALES_TAG_NAME="$amocrm_sales_tag_name" \
      EVO_V2_AMOCRM_ADMISSIONS_PIPELINE_ID="$amocrm_admissions_pipeline_id" \
      EVO_V2_AMOCRM_ADMISSIONS_STATUS_ID="$amocrm_admissions_status_id" \
      EVO_V2_AMOCRM_ADMISSIONS_RESPONSIBLE_USER_ID="$amocrm_admissions_responsible_user_id" \
      EVO_V2_AMOCRM_ADMISSIONS_TAG_NAME="$amocrm_admissions_tag_name" \
      "$node_bin" node_modules/next/dist/bin/next dev \
        --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
  else
    env \
      -u NEXT_PUBLIC_SUPABASE_URL \
      -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
      -u EVO_PLATFORM_SUPABASE_SECRET_KEY \
      -u SUPABASE_SERVICE_ROLE_KEY \
      DATABASE_URL="$app_database_url" \
      EVO_PRIVATE_DOCUMENT_ROOT="$document_root" \
      EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
      EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
      EVO_STAFF_AUTH_SALES_EMAIL="$staff_sales_email" \
      EVO_STAFF_AUTH_SALES_PASSWORD="$staff_sales_password" \
      EVO_STAFF_AUTH_ADMISSIONS_EMAIL="$staff_admissions_email" \
      EVO_STAFF_AUTH_ADMISSIONS_PASSWORD="$staff_admissions_password" \
      EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$inbound_secret" \
      EVO_V2_GEMINI_PROPOSALS_ENABLED=1 \
      EVO_V2_GEMINI_PROVIDER_AUTHORIZED=0 \
      EVO_V2_WAHA_ENABLED=1 \
      EVO_V2_WAHA_PROVIDER_AUTHORIZED="$waha_provider_authorized" \
      EVO_V2_WAHA_BASE_URL="$app_waha_base_url" \
      EVO_V2_WAHA_API_KEY="$waha_api_key" \
      EVO_V2_WAHA_SESSION_NAME="$waha_session_name" \
      EVO_V2_AMOCRM_WRITES_ENABLED=1 \
      EVO_V2_AMOCRM_PROVIDER_AUTHORIZED="$amocrm_provider_authorized" \
      EVO_V2_AMOCRM_BASE_URL="https://evo-v2-technical.amocrm.ru" \
      EVO_V2_AMOCRM_TOKEN_FILE="$amocrm_token_file" \
      EVO_V2_AMOCRM_SALES_PIPELINE_ID="$amocrm_sales_pipeline_id" \
      EVO_V2_AMOCRM_SALES_STATUS_ID="$amocrm_sales_status_id" \
      EVO_V2_AMOCRM_SALES_RESPONSIBLE_USER_ID="$amocrm_sales_responsible_user_id" \
      EVO_V2_AMOCRM_SALES_TAG_NAME="$amocrm_sales_tag_name" \
      EVO_V2_AMOCRM_ADMISSIONS_PIPELINE_ID="$amocrm_admissions_pipeline_id" \
      EVO_V2_AMOCRM_ADMISSIONS_STATUS_ID="$amocrm_admissions_status_id" \
      EVO_V2_AMOCRM_ADMISSIONS_RESPONSIBLE_USER_ID="$amocrm_admissions_responsible_user_id" \
      EVO_V2_AMOCRM_ADMISSIONS_TAG_NAME="$amocrm_admissions_tag_name" \
      "$node_bin" node_modules/next/dist/bin/next dev \
        --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
  fi
  app_pid=$!

  local deadline=$((SECONDS + 120))
  local code=""
  local database_status_code=""
  while (( SECONDS < deadline )); do
    if ! kill -0 "$app_pid" >/dev/null 2>&1; then
      sed -n '1,200p' "$app_log" >&2
      fail "The application exited before browser validation"
    fi
    code="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${app_port}/api/health" || true)"
    database_status_code="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${app_port}/api/database/status" || true)"
    if [[ "$code" == "200" && ( "$database_status_code" == "200" || "$database_status_code" == "503" ) ]]; then
      return
    fi
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

supabase_staff_auth_browser_assert() {
  local auth_mode="$1"
  assert_app_reachable
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
    EVO_EXPECT_STAFF_AUTH_MODE="$auth_mode" \
    EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
    EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
    EVO_STAFF_AUTH_SALES_EMAIL="$staff_sales_email" \
    EVO_STAFF_AUTH_SALES_PASSWORD="$staff_sales_password" \
    EVO_STAFF_AUTH_ADMISSIONS_EMAIL="$staff_admissions_email" \
    EVO_STAFF_AUTH_ADMISSIONS_PASSWORD="$staff_admissions_password" \
    EVO_SUPABASE_SALES_PROOF_LEAD_ID="$supabase_sales_lead_id" \
    EVO_SUPABASE_SALES_PROOF_CLIENT_ID="$supabase_sales_client_id" \
    EVO_SUPABASE_SALES_WORKFLOW_LEAD_ID="$supabase_sales_workflow_lead_id" \
    EVO_SUPABASE_SALES_API_LEAD_ID="$supabase_sales_api_lead_id" \
    EVO_SUPABASE_SALES_CONVERSATION_LEAD_ID="$supabase_sales_conversation_lead_id" \
    EVO_SUPABASE_SALES_CONVERSATION_ID="$supabase_sales_conversation_id" \
    EVO_SUPABASE_HANDOFF_PROOF_LEAD_ID="$supabase_handoff_lead_id" \
    EVO_SUPABASE_HANDOFF_PROOF_CLIENT_ID="$supabase_handoff_client_id" \
    EVO_SUPABASE_DIRECT_API_URL="$supabase_api_url" \
    EVO_SUPABASE_DIRECT_PUBLISHABLE_KEY="$supabase_publishable_key" \
    "$node_bin" node_modules/@playwright/test/cli.js test \
      --config=playwright.supabase-staff-auth.config.ts
}

canonical_read_browser_assert() {
  local read_mode="$1"
  assert_app_reachable
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
    DATABASE_URL="$database_url" \
    EVO_EXPECT_CANONICAL_READ_MODE="$read_mode" \
    EVO_SUPABASE_SALES_PROOF_LEAD_ID="$supabase_sales_lead_id" \
    EVO_SUPABASE_SALES_PROOF_CLIENT_ID="$supabase_sales_client_id" \
    EVO_EXPECT_WAHA_SESSION_NAME="$waha_session_name" \
    EVO_V2_WAHA_ACCEPTANCE_RESULT_FILE="$waha_acceptance_result" \
    EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$whatsapp_inbound_secret" \
    EVO_V2_INBOUND_TEST_PHONE="$inbound_test_phone" \
    EVO_V2_INBOUND_TEST_CONVERSATION_ID="$inbound_test_conversation_id" \
    EVO_V2_INBOUND_TEST_MESSAGE_ID="$inbound_test_message_id" \
    EVO_V2_INBOUND_TEST_TEXT="$inbound_test_text" \
    EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
    EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
    EVO_STAFF_AUTH_SALES_EMAIL="$staff_sales_email" \
    EVO_STAFF_AUTH_SALES_PASSWORD="$staff_sales_password" \
    EVO_STAFF_AUTH_ADMISSIONS_EMAIL="$staff_admissions_email" \
    EVO_STAFF_AUTH_ADMISSIONS_PASSWORD="$staff_admissions_password" \
    "$node_bin" node_modules/@playwright/test/cli.js test \
      --config=playwright.canonical-crm.config.ts
}

assert_no_secret_or_payload_logs() {
  local value
  for value in \
    "missing-staff@example.invalid" \
    "invalid-password" \
    "any@example.invalid" \
    "any-password" \
    "$staff_admin_email" \
    "$staff_admin_password" \
    "$staff_sales_email" \
    "$staff_sales_password" \
    "$staff_admissions_email" \
    "$staff_admissions_password" \
    "$whatsapp_inbound_secret" \
    "$waha_api_key" \
    "$amocrm_token_probe" \
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
[[ "$migration_count" == "6" ]] || fail "Expected exact 0000 -> 0001 -> 0002 -> 0003 -> 0004 -> 0005 migration history"
[[ "$contract_version" == "4" ]] || fail "Canonical CRM migration did not publish database contract version 4"
echo "Exact 0000 -> 0001 -> 0002 -> 0003 -> 0004 -> 0005 migration, repeat migration and stored history passed."

DATABASE_URL="$database_url" \
  "$node_bin" --conditions=react-server --experimental-strip-types --test \
    tests/private-document-repository-postgres.test.mjs
echo "Private document case scope, immutable metadata reads and fail-closed repository checks passed."

DATABASE_URL="$database_url" \
  "$node_bin" --conditions=react-server --experimental-strip-types --test \
    --test-concurrency=1 \
    tests/canonical-whatsapp-outbound-postgres.test.mjs
DATABASE_URL="$database_url" \
  "$node_bin" --conditions=react-server --experimental-strip-types --test \
    --test-concurrency=1 \
    tests/canonical-amocrm-schema-postgres.test.mjs \
    tests/canonical-amocrm-command-postgres.test.mjs \
    tests/canonical-amocrm-discovery-postgres.test.mjs
echo "Later-owned WhatsApp and amoCRM repository contracts passed without the retired Drizzle gate fixture."

stop_app
start_isolated_waha_service
start_app "$database_url" configured configured configured local-service
browser_assert 200
supabase_staff_auth_browser_assert configured
canonical_read_browser_assert configured
assert_no_secret_or_payload_logs

# Runtime contract drift blocks the real browser path.
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE evo_database_contract SET version = 5 WHERE id = 1;" >/dev/null
browser_assert 503 database_contract_mismatch
docker exec "$container_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --command "UPDATE evo_database_contract SET version = 4 WHERE id = 1;" >/dev/null
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
start_app "$database_url" configured configured unavailable
canonical_read_browser_assert inbound-unavailable
assert_no_secret_or_payload_logs

stop_app
start_app "$database_url" unavailable
supabase_staff_auth_browser_assert unavailable
assert_no_secret_or_payload_logs

echo "Real PostgreSQL, Supabase Auth/RLS, canonical provider repositories, application and Chromium proof passed."
