#!/usr/bin/env bash
set -euo pipefail

umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
expected_head_sha="${1:-${EVO_PLATFORM_ACCEPTANCE_EXPECTED_SHA:-}}"
remote_acceptance_ref="${EVO_PLATFORM_ACCEPTANCE_REMOTE_REF:-}"
ssh_host="hermes-vps"
supabase_lock_dir="${TMPDIR:-/tmp}/evo-platform-provider-acceptance.lock"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-platform-provider-acceptance.XXXXXX")"
provider_bundle_file="$tmp_dir/provider.bundle"
provider_source_file="$tmp_dir/provider-source.json"
supabase_env_file="$tmp_dir/supabase.env"
supabase_log="$tmp_dir/supabase.log"
staff_log="$tmp_dir/staff.log"
communications_log="$tmp_dir/communications.log"
app_log="$tmp_dir/app.log"
playwright_log="$tmp_dir/playwright.log"
app_pid=""
tunnel_pid=""
supabase_started=0
supabase_lock_acquired=0
waha_api_key=""
gemini_api_key=""
waha_container_ip=""

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_env() {
  local variable_name="$1"
  [[ -n "${!variable_name:-}" ]] \
    || fail "Required environment variable is missing: $variable_name"
}

free_port() {
  "$node_bin" --input-type=module <<'EOF'
import { createServer } from "node:net";

const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") process.exit(1);
  process.stdout.write(`${address.port}\n`);
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

decode_base64() {
  EVO_PLATFORM_ENCODED_VALUE="$1" "$node_bin" --input-type=module <<'EOF'
const encoded = process.env.EVO_PLATFORM_ENCODED_VALUE ?? "";
if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) process.exit(1);
const value = Buffer.from(encoded, "base64");
if (value.length === 0 || value.includes(0)) process.exit(1);
process.stdout.write(value);
EOF
}

cleanup() {
  local exit_status=$?

  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$tunnel_pid" ]]; then
    kill "$tunnel_pid" >/dev/null 2>&1 || true
    wait "$tunnel_pid" >/dev/null 2>&1 || true
  fi
  if (( supabase_started == 1 )); then
    (
      cd "$repo_root"
      npx --no-install supabase stop --no-backup
    ) >/dev/null 2>&1 || true
  fi
  if (( supabase_lock_acquired == 1 )); then
    rmdir "$supabase_lock_dir" >/dev/null 2>&1 || true
  fi

  unset waha_api_key gemini_api_key waha_container_ip
  if [[ -d "$tmp_dir" && "$tmp_dir" == "${TMPDIR:-/tmp}/evo-platform-provider-acceptance."* ]]; then
    rm -R -- "$tmp_dir"
  fi
  return "$exit_status"
}
trap cleanup EXIT

assert_next_dev_lock_available() {
  local lock_path="$repo_root/.next/dev/lock"
  [[ -e "$lock_path" ]] || return 0
  command -v lsof >/dev/null 2>&1 \
    || fail "Cannot inspect the current Next development lock"
  local holder_pids=""
  holder_pids="$(lsof -t -- "$lock_path" 2>/dev/null | sort -u || true)"
  [[ -z "$holder_pids" ]] \
    || fail "Another Next server owns this worktree; no process was terminated"
}

wait_for_http() {
  local url="$1"
  local pid="$2"
  local deadline=$((SECONDS + 120))
  local status=""
  while (( SECONDS < deadline )); do
    kill -0 "$pid" >/dev/null 2>&1 \
      || fail "The private application exited before it became reachable"
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
      --max-time 3 "$url" || true)"
    [[ "$status" =~ ^[23][0-9][0-9]$ ]] && return 0
    sleep 1
  done
  fail "The private application did not become reachable"
}

case "$-" in
  *x*) fail "Shell xtrace must be disabled because this harness handles provider secrets" ;;
esac

[[ "$#" -le 1 ]] || fail "Usage: $0 <exact-clean-head-sha>"
[[ "${EVO_PLATFORM_REAL_PROVIDER_ACCEPTANCE:-}" == "1" ]] \
  || fail "Set EVO_PLATFORM_REAL_PROVIDER_ACCEPTANCE=1 for this bounded provider proof"
[[ "${EVO_PLATFORM_ACCEPTANCE_TARGET_AUTHORIZATION:-}" == "MINIMIZED_SINGLE_CHAT" ]] \
  || fail "EVO_PLATFORM_ACCEPTANCE_TARGET_AUTHORIZATION must be MINIMIZED_SINGLE_CHAT"
[[ "$expected_head_sha" =~ ^[0-9a-f]{40}$ ]] \
  || fail "Provide the exact 40-character acceptance HEAD SHA"
[[ "$remote_acceptance_ref" =~ ^refs/(heads/[A-Za-z0-9._/-]+|pull/[1-9][0-9]*/head)$ ]] \
  || fail "EVO_PLATFORM_ACCEPTANCE_REMOTE_REF must name one remote branch or PR head"
require_env EVO_PLATFORM_ACCEPTANCE_TARGET_CHAT_ID
require_env EVO_PLATFORM_ACCEPTANCE_SOURCE_MESSAGE_ID

for command_name in git docker orb ssh curl openssl npx; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "Required command is unavailable: $command_name"
done
command -v "$node_bin" >/dev/null 2>&1 \
  || fail "The configured Node executable is unavailable"
[[ "$($node_bin --version)" == v22.* ]] \
  || fail "Platform provider acceptance requires Node 22.x"
[[ "$(uname -s)" == "Darwin" ]] \
  || fail "Platform provider acceptance is restricted to the macOS OrbStack contour"
[[ "$(orb status)" == "Running" ]] || fail "OrbStack must be Running"
[[ "$(docker context show)" == "orbstack" ]] \
  || fail "Docker context must be exactly orbstack"

cd "$repo_root"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "The worktree must be clean before real provider acceptance"
git fetch --quiet origin "$remote_acceptance_ref"
head_sha="$(git rev-parse HEAD)"
remote_head_sha="$(git rev-parse FETCH_HEAD)"
[[ "$head_sha" == "$expected_head_sha" && "$head_sha" == "$remote_head_sha" ]] \
  || fail "HEAD, the supplied SHA and the freshly fetched remote acceptance ref must match"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "The worktree changed during remote acceptance ref verification"

for required_path in \
  node_modules/next/dist/bin/next \
  node_modules/@playwright/test/cli.js \
  scripts/provision-local-supabase-staff.mjs \
  scripts/provision-local-platform-communications.mjs \
  scripts/supabase-auth-readiness.mjs \
  tests/helpers/platform-waha-local-fetch.cjs \
  tests/e2e/platform-provider-acceptance.spec.ts \
  playwright.platform-provider-acceptance.config.ts; do
  [[ -e "$required_path" ]] \
    || fail "Required Platform acceptance dependency is missing"
done

if ! TARGET_CHAT_ID="$EVO_PLATFORM_ACCEPTANCE_TARGET_CHAT_ID" \
  SOURCE_MESSAGE_ID="$EVO_PLATFORM_ACCEPTANCE_SOURCE_MESSAGE_ID" \
  "$node_bin" --input-type=module <<'EOF'
const chatId = process.env.TARGET_CHAT_ID ?? "";
const messageId = process.env.SOURCE_MESSAGE_ID ?? "";
if (!/^[1-9][0-9]{6,14}@c[.]us$/.test(chatId)) process.exit(1);
if (
  messageId !== messageId.trim() ||
  Buffer.byteLength(messageId, "utf8") < 1 ||
  Buffer.byteLength(messageId, "utf8") > 512 ||
  /[\u0000-\u001f\u007f]/u.test(messageId)
) process.exit(1);
EOF
then
  fail "The protected minimized target or source-message identifier is invalid"
fi

evidence_dir="$repo_root/output/provider-acceptance/platform/$head_sha"
run_marker="$evidence_dir/run-attempt.json"
dispatch_marker="$evidence_dir/waha-dispatch-attempt.json"
success_evidence="$evidence_dir/success.json"
mkdir -p "$evidence_dir"
chmod 700 "$repo_root/output" \
  "$repo_root/output/provider-acceptance" \
  "$repo_root/output/provider-acceptance/platform" \
  "$evidence_dir" 2>/dev/null || true
[[ ! -e "$run_marker" && ! -e "$dispatch_marker" && ! -e "$success_evidence" ]] \
  || fail "This exact SHA already has a provider-attempt marker; inspect it before any rerun"
if find "$evidence_dir" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  fail "The exact-SHA provider evidence directory is not empty"
fi

if ! mkdir "$supabase_lock_dir" 2>/dev/null; then
  fail "Another EVO local Supabase harness is already running"
fi
supabase_lock_acquired=1
if npx --no-install supabase status >/dev/null 2>&1; then
  fail "A local Supabase stack is already running; this acceptance refuses to replace its state"
fi

chmod 700 "$tmp_dir"
if ! ssh -T -o BatchMode=yes -o ConnectTimeout=15 "$ssh_host" 'bash -s' \
  >"$provider_bundle_file" 2>/dev/null <<'REMOTE'
set -euo pipefail
umask 077

runtime_env="/opt/evo-crm/.env.lead-agent"
container_name="evo-crm-waha-1"
[[ -r "$runtime_env" ]]
set -a
# shellcheck disable=SC1090
. "$runtime_env"
set +a
: "${EVO_AGENT_WAHA_API_KEY:?}"
: "${EVO_AGENT_WAHA_BASE_URL:?}"
: "${EVO_AGENT_WAHA_SESSION:?}"
: "${GEMINI_API_KEY:?}"
[[ "$EVO_AGENT_WAHA_SESSION" == "crm_primary" ]]
[[ "$EVO_AGENT_WAHA_BASE_URL" == "http://evo-crm-waha:3000" ]]

container_id="$(docker ps --filter "name=^/${container_name}$" --format '{{.ID}}')"
[[ -n "$container_id" && "$container_id" != *$'\n'* ]]
[[ "$(docker inspect --format '{{.State.Running}}' "$container_id")" == "true" ]]
container_ip="$(docker inspect \
  --format '{{(index .NetworkSettings.Networks "evo_crm_private").IPAddress}}' \
  "$container_id")"
[[ -n "$container_ip" ]]

encode_line() {
  printf '%s' "$1" | base64 | tr -d '\n'
  printf '\n'
}

encode_line "$EVO_AGENT_WAHA_API_KEY"
encode_line "$GEMINI_API_KEY"
encode_line "$container_ip"
REMOTE
then
  fail "The connected private EVO sales provider bundle could not be resolved"
fi
chmod 600 "$provider_bundle_file"

exec 3<"$provider_bundle_file"
IFS= read -r encoded_waha_api_key <&3 \
  || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_gemini_api_key <&3 \
  || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_waha_container_ip <&3 \
  || fail "The protected provider bundle is incomplete"
IFS= read -r unexpected_bundle_line <&3 \
  && fail "The protected provider bundle contains unexpected data"
exec 3<&-
waha_api_key="$(decode_base64 "$encoded_waha_api_key")" \
  || fail "The protected WAHA credential could not be decoded"
gemini_api_key="$(decode_base64 "$encoded_gemini_api_key")" \
  || fail "The protected Gemini credential could not be decoded"
waha_container_ip="$(decode_base64 "$encoded_waha_container_ip")" \
  || fail "The protected WAHA address could not be decoded"
rm -f -- "$provider_bundle_file"
unset encoded_waha_api_key encoded_gemini_api_key encoded_waha_container_ip unexpected_bundle_line

if ! WAHA_API_KEY="$waha_api_key" GEMINI_API_KEY="$gemini_api_key" \
  WAHA_CONTAINER_IP="$waha_container_ip" "$node_bin" --input-type=module <<'EOF'
import { isIP } from "node:net";

const waha = process.env.WAHA_API_KEY ?? "";
const gemini = process.env.GEMINI_API_KEY ?? "";
const address = process.env.WAHA_CONTAINER_IP ?? "";
const validSecret = (value) =>
  value === value.trim() &&
  Buffer.byteLength(value, "utf8") >= 16 &&
  Buffer.byteLength(value, "utf8") <= 4096 &&
  !/[\u0000-\u001f\u007f]/u.test(value);
if (!validSecret(waha) || !validSecret(gemini) || !/^[A-Za-z0-9_-]+$/.test(gemini)) {
  process.exit(1);
}
if (isIP(address) !== 4) process.exit(1);
const octets = address.split(".").map(Number);
const privateAddress =
  octets[0] === 10 ||
  (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
  (octets[0] === 192 && octets[1] === 168);
if (!privateAddress) process.exit(1);
EOF
then
  fail "The protected provider bundle failed its server-only input contract"
fi

tunnel_port="$(free_port)"
app_port="$(free_port)"
waha_base_url="http://127.0.0.1:${tunnel_port}"
ssh -NT \
  -o BatchMode=yes \
  -o ConnectTimeout=15 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -L "127.0.0.1:${tunnel_port}:${waha_container_ip}:3000" \
  "$ssh_host" >/dev/null 2>&1 &
tunnel_pid=$!

if ! WAHA_BASE_URL="$waha_base_url" \
  WAHA_API_KEY="$waha_api_key" \
  TARGET_CHAT_ID="$EVO_PLATFORM_ACCEPTANCE_TARGET_CHAT_ID" \
  SOURCE_MESSAGE_ID="$EVO_PLATFORM_ACCEPTANCE_SOURCE_MESSAGE_ID" \
  PROVIDER_SOURCE_FILE="$provider_source_file" \
  "$node_bin" --input-type=module <<'EOF'
import { chmod, writeFile } from "node:fs/promises";

const baseUrl = process.env.WAHA_BASE_URL;
const apiKey = process.env.WAHA_API_KEY;
const target = process.env.TARGET_CHAT_ID;
const sourceMessageId = process.env.SOURCE_MESSAGE_ID;
const output = process.env.PROVIDER_SOURCE_FILE;
const headers = { Accept: "application/json", "X-Api-Key": apiKey };

async function boundedJson(url) {
  const response = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("provider_not_ready");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 256 * 1024) throw new Error("provider_oversize");
  return JSON.parse(text);
}

const session = await boundedJson(new URL("/api/sessions/crm_primary", baseUrl));
if (
  !session ||
  session.status !== "WORKING" ||
  !session.me ||
  typeof session.me.id !== "string"
) throw new Error("session_not_working");

const sourceUrl = new URL(
  `/api/crm_primary/chats/${encodeURIComponent(target)}/messages/${encodeURIComponent(sourceMessageId)}`,
  baseUrl,
);
sourceUrl.searchParams.set("downloadMedia", "false");
const message = await boundedJson(sourceUrl);
if (
  !message ||
  message.id !== sourceMessageId ||
  message.fromMe !== false ||
  message.from !== target ||
  !Number.isFinite(Number(message.timestamp)) ||
  Number(message.timestamp) <= 0
) throw new Error("source_message_not_authorized_reply_target");
const replyTarget = {
  id: message.id,
  from: message.from,
  fromMe: message.fromMe,
  timestamp: Number(message.timestamp),
};
await writeFile(output, `${JSON.stringify(replyTarget)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
await chmod(output, 0o600);
EOF
then
  fail "The exact minimized WAHA reply target could not be verified"
fi
chmod 600 "$provider_source_file"

if ! (
  npx --no-install supabase start --yes
) >"$supabase_log" 2>&1; then
  fail "The disposable local Supabase stack did not start"
fi
supabase_started=1
if ! (
  npx --no-install supabase db reset --local --no-seed --yes
) >>"$supabase_log" 2>&1; then
  fail "The disposable local Supabase database did not reset to repository migrations"
fi
if ! npx --no-install supabase status -o env \
  >"$supabase_env_file" 2>>"$supabase_log"; then
  fail "The disposable local Supabase stack did not expose its configuration"
fi
chmod 600 "$supabase_env_file" "$supabase_log"

supabase_api_url="$(read_supabase_env_value API_URL)"
supabase_publishable_key="$(read_supabase_env_value PUBLISHABLE_KEY)"
supabase_service_role_key="$(read_supabase_env_value SERVICE_ROLE_KEY)"
supabase_database_url="$(read_supabase_env_value DB_URL)"
[[ "$supabase_api_url" == http://127.0.0.1:* || "$supabase_api_url" == http://localhost:* ]] \
  || fail "The local Supabase API is not loopback-only"
[[ "$supabase_database_url" == postgresql://*@127.0.0.1:*/* || "$supabase_database_url" == postgresql://*@localhost:*/* ]] \
  || fail "The local Supabase database is not loopback-only"

if ! API_URL="$supabase_api_url" SERVICE_ROLE_KEY="$supabase_service_role_key" \
  "$node_bin" --input-type=module >>"$supabase_log" 2>&1 <<'EOF'
import { waitForLocalSupabaseAuthAdmin } from "./scripts/supabase-auth-readiness.mjs";

await waitForLocalSupabaseAuthAdmin({
  apiUrl: process.env.API_URL,
  serviceRoleKey: process.env.SERVICE_ROLE_KEY,
  maxAttempts: 1200,
  readinessTimeoutMs: 300000,
});
EOF
then
  fail "The local Supabase Auth Admin API did not become ready"
fi

staff_suffix="${RANDOM}-$$-$(openssl rand -hex 4)"
staff_admin_email="admin-${staff_suffix}@evo.local.test"
staff_admin_password="$(openssl rand -hex 24)"
staff_sales_email="sales-${staff_suffix}@evo.local.test"
staff_sales_password="$(openssl rand -hex 24)"
staff_admissions_email="admissions-${staff_suffix}@evo.local.test"
staff_admissions_password="$(openssl rand -hex 24)"
webhook_secret="$(openssl rand -hex 32)"

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
  >"$staff_log" 2>&1; then
  fail "Local Supabase staff identity provisioning failed"
fi
grep -Fx "LOCAL_SUPABASE_STAFF_PROVISIONED" "$staff_log" >/dev/null \
  || fail "Local Supabase staff provisioning returned no success marker"
chmod 600 "$staff_log"

if ! NEXT_PUBLIC_SUPABASE_URL="$supabase_api_url" \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$supabase_publishable_key" \
  EVO_PLATFORM_SUPABASE_SECRET_KEY="$supabase_service_role_key" \
  EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
  EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
  EVO_STAFF_AUTH_SALES_EMAIL="$staff_sales_email" \
  EVO_STAFF_AUTH_SALES_PASSWORD="$staff_sales_password" \
  EVO_TEST_WAHA_API_KEY="$waha_api_key" \
  "$node_bin" scripts/provision-local-platform-communications.mjs \
  >"$communications_log" 2>&1; then
  fail "Local Platform communications runtime provisioning failed"
fi
communications_marker="$(grep -m 1 -E '^LOCAL_PLATFORM_COMMUNICATIONS_PROVISIONED [0-9a-f-]{36} [0-9a-f-]{36}$' "$communications_log" || true)"
[[ -n "$communications_marker" ]] \
  || fail "Local Platform communications provisioning returned no success marker"
read -r _ platform_organization_id platform_intake_sales_membership_id <<<"$communications_marker"
[[ "$platform_organization_id" =~ ^[0-9a-f-]{36}$ ]] \
  || fail "Local Platform communications provisioning returned an invalid organization"
[[ "$platform_intake_sales_membership_id" =~ ^[0-9a-f-]{36}$ ]] \
  || fail "Local Platform communications provisioning returned an invalid Sales membership"
chmod 600 "$communications_log"

assert_next_dev_lock_available
env \
  DATABASE_URL="$supabase_database_url" \
  NEXT_PUBLIC_SUPABASE_URL="$supabase_api_url" \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$supabase_publishable_key" \
  EVO_PLATFORM_SUPABASE_SECRET_KEY="$supabase_service_role_key" \
  EVO_PLATFORM_ORGANIZATION_ID="$platform_organization_id" \
  EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID="$platform_intake_sales_membership_id" \
  EVO_PLATFORM_GEMINI_API_KEY="$gemini_api_key" \
  EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET="$webhook_secret" \
  EVO_TEST_WAHA_REWRITE_BASE_URL="$waha_base_url" \
  NODE_OPTIONS="--require=$repo_root/tests/helpers/platform-waha-local-fetch.cjs" \
  EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
  EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
  EVO_STAFF_AUTH_SALES_EMAIL="$staff_sales_email" \
  EVO_STAFF_AUTH_SALES_PASSWORD="$staff_sales_password" \
  EVO_STAFF_AUTH_ADMISSIONS_EMAIL="$staff_admissions_email" \
  EVO_STAFF_AUTH_ADMISSIONS_PASSWORD="$staff_admissions_password" \
  "$node_bin" node_modules/next/dist/bin/next dev \
    --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
app_pid=$!
chmod 600 "$app_log"
wait_for_http "http://127.0.0.1:${app_port}/login" "$app_pid"

EVIDENCE_RUN_MARKER="$run_marker" EVIDENCE_HEAD_SHA="$head_sha" \
  "$node_bin" --input-type=module <<'EOF'
import { chmod, writeFile } from "node:fs/promises";

await writeFile(
  process.env.EVIDENCE_RUN_MARKER,
  `${JSON.stringify({
    schemaVersion: 1,
    status: "provider_calls_authorized",
    gitSha: process.env.EVIDENCE_HEAD_SHA,
    maximumGeminiCalls: 1,
    maximumWhatsAppDispatches: 1,
    targetKind: "authorized_minimized_chat",
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600, flag: "wx" },
);
await chmod(process.env.EVIDENCE_RUN_MARKER, 0o600);
EOF

if ! PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
  SUPABASE_DB_URL="$supabase_database_url" \
  EVO_PLATFORM_ACCEPTANCE_HEAD_SHA="$head_sha" \
  EVO_PLATFORM_ACCEPTANCE_EVIDENCE_DIR="$evidence_dir" \
  EVO_PLATFORM_ACCEPTANCE_TARGET_CHAT_ID="$EVO_PLATFORM_ACCEPTANCE_TARGET_CHAT_ID" \
  EVO_PLATFORM_ACCEPTANCE_SOURCE_MESSAGE_ID="$EVO_PLATFORM_ACCEPTANCE_SOURCE_MESSAGE_ID" \
  EVO_PLATFORM_ACCEPTANCE_SOURCE_FILE="$provider_source_file" \
  EVO_PLATFORM_ACCEPTANCE_WAHA_BASE_URL="$waha_base_url" \
  EVO_PLATFORM_ACCEPTANCE_WAHA_API_KEY="$waha_api_key" \
  EVO_PLATFORM_ACCEPTANCE_WAHA_SESSION_NAME="crm_primary" \
  EVO_PLATFORM_ORGANIZATION_ID="$platform_organization_id" \
  EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET="$webhook_secret" \
  EVO_STAFF_AUTH_SALES_EMAIL="$staff_sales_email" \
  EVO_STAFF_AUTH_SALES_PASSWORD="$staff_sales_password" \
  "$node_bin" node_modules/@playwright/test/cli.js test \
    --config=playwright.platform-provider-acceptance.config.ts \
    >"$playwright_log" 2>&1; then
  fail "Platform real-provider browser acceptance failed; inspect sanitized markers before any rerun"
fi
chmod 600 "$playwright_log"

[[ -f "$run_marker" && -f "$dispatch_marker" && -f "$success_evidence" ]] \
  || fail "Platform provider acceptance did not create all one-shot evidence markers"
if ! SUCCESS_EVIDENCE="$success_evidence" EXPECTED_HEAD_SHA="$head_sha" \
  "$node_bin" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";

let value;
try {
  value = JSON.parse(readFileSync(process.env.SUCCESS_EVIDENCE, "utf8"));
} catch {
  process.exit(1);
}
const serialized = JSON.stringify(value);
if (
  value?.schemaVersion !== 1 ||
  value?.status !== "passed" ||
  value?.gitSha !== process.env.EXPECTED_HEAD_SHA ||
  value?.authority !== "local_supabase_postgres" ||
  value?.gemini?.requestCount !== 1 ||
  value?.gemini?.resultCount !== 1 ||
  value?.gemini?.humanReviewCount !== 1 ||
  value?.gemini?.advisoryOnly !== true ||
  value?.whatsapp?.authorizationCount !== 1 ||
  value?.whatsapp?.workCount !== 1 ||
  value?.whatsapp?.attemptCount !== 1 ||
  value?.whatsapp?.outboundMessageCount !== 1 ||
  value?.whatsapp?.receiptCount !== 1 ||
  value?.whatsapp?.exactReadback !== true ||
  value?.whatsapp?.matchingProviderSendCount !== 1 ||
  value?.whatsapp?.targetKind !== "authorized_minimized_chat" ||
  value?.safety?.inboundSeed !== "synthetic_non_personal_setup" ||
  value?.safety?.autonomousSend !== false ||
  value?.safety?.broadcast !== false ||
  value?.safety?.v1RuntimeUsed !== false ||
  value?.safety?.retryAfterAmbiguousResult !== false ||
  /api.?key|target.?chat|recipient|source.?message|provider.?message|final.?text|@c[.]us/i.test(serialized)
) process.exit(1);
EOF
then
  fail "The sanitized Platform provider success evidence is invalid"
fi
chmod 600 "$run_marker" "$dispatch_marker" "$success_evidence"

if ! APP_LOG="$app_log" PLAYWRIGHT_LOG="$playwright_log" \
  STAFF_LOG="$staff_log" COMMUNICATIONS_LOG="$communications_log" \
  WAHA_API_KEY="$waha_api_key" GEMINI_API_KEY="$gemini_api_key" \
  WEBHOOK_SECRET="$webhook_secret" STAFF_PASSWORD="$staff_sales_password" \
  SUPABASE_SECRET_KEY="$supabase_service_role_key" \
  TARGET_CHAT_ID="$EVO_PLATFORM_ACCEPTANCE_TARGET_CHAT_ID" \
  SOURCE_MESSAGE_ID="$EVO_PLATFORM_ACCEPTANCE_SOURCE_MESSAGE_ID" \
  "$node_bin" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";

const logs = [
  process.env.APP_LOG,
  process.env.PLAYWRIGHT_LOG,
  process.env.STAFF_LOG,
  process.env.COMMUNICATIONS_LOG,
].map((path) => readFileSync(path, "utf8")).join("\n");
for (const value of [
  process.env.WAHA_API_KEY,
  process.env.GEMINI_API_KEY,
  process.env.WEBHOOK_SECRET,
  process.env.STAFF_PASSWORD,
  process.env.SUPABASE_SECRET_KEY,
  process.env.TARGET_CHAT_ID,
  process.env.SOURCE_MESSAGE_ID,
]) {
  if (typeof value === "string" && value.length > 0 && logs.includes(value)) {
    process.exit(1);
  }
}
EOF
then
  fail "A private provider value appeared in an acceptance log"
fi

printf 'Platform provider acceptance passed at exact remote HEAD %s. Sanitized evidence: %s\n' \
  "$head_sha" "$success_evidence"
