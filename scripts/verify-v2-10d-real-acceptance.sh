#!/usr/bin/env bash
set -euo pipefail

umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
expected_main_sha="${1:-${EVO_V2_EXPECTED_MAIN_SHA:-}}"
provider_env_file="${EVO_V2_AMOCRM_PROVIDER_ENV_FILE:-$repo_root/data/private-v2-provider.env}"
token_file="${EVO_V2_AMOCRM_TOKEN_FILE:-$repo_root/data/private-v2-amocrm-token.json}"
ssh_host="hermes-vps"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

case "$-" in
  *x*) fail "Shell xtrace must be disabled because this harness handles provider secrets" ;;
esac

[[ "$#" -le 1 ]] || fail "Usage: $0 <exact-origin-main-sha>"
[[ "${EVO_V2_REAL_END_TO_END_ACCEPTANCE:-}" == "1" ]] \
  || fail "Set EVO_V2_REAL_END_TO_END_ACCEPTANCE=1 for the single V2-10D real acceptance run"
[[ "$expected_main_sha" =~ ^[0-9a-f]{40}$ ]] \
  || fail "Provide the exact 40-character origin/main SHA as argv[1] or EVO_V2_EXPECTED_MAIN_SHA"

for command_name in git docker orb ssh curl openssl stat; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "Required command is unavailable: $command_name"
done
command -v "$node_bin" >/dev/null 2>&1 \
  || fail "The configured Node executable is unavailable"
[[ "$($node_bin --version)" == v22.* ]] \
  || fail "V2-10D real acceptance requires Node 22.x"
[[ "$(uname -s)" == "Darwin" ]] \
  || fail "V2-10D real acceptance is restricted to the macOS OrbStack contour"
[[ "$(orb status)" == "Running" ]] \
  || fail "OrbStack must report Running before V2-10D real acceptance"
[[ "$(docker context show)" == "orbstack" ]] \
  || fail "Docker context must be exactly orbstack before V2-10D real acceptance"

cd "$repo_root"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "V2-10D real acceptance requires a clean exact-main worktree"
git fetch --quiet origin main
head_sha="$(git rev-parse HEAD)"
origin_main_sha="$(git rev-parse refs/remotes/origin/main)"
[[ "$head_sha" == "$origin_main_sha" && "$head_sha" == "$expected_main_sha" ]] \
  || fail "HEAD, freshly fetched origin/main and the supplied SHA must match exactly"
git merge-base --is-ancestor "$head_sha" "$origin_main_sha" \
  || fail "The supplied acceptance SHA is not current origin/main"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "The worktree changed during exact-main verification"

assert_ignored_private_file() {
  local path="$1"
  local label="$2"
  [[ -f "$path" && ! -L "$path" ]] \
    || fail "$label must be an existing regular non-symlink file"
  [[ "$(stat -f '%Lp' "$path")" == "600" ]] \
    || fail "$label must have exact mode 0600"
  [[ "$(stat -f '%Su' "$path")" == "$(id -un)" ]] \
    || fail "$label must be owned by the current operator"
  git check-ignore --quiet "$path" \
    || fail "$label must be ignored by Git"
}

assert_ignored_private_file "$provider_env_file" "The amoCRM provider environment file"
assert_ignored_private_file "$token_file" "The amoCRM long-lived token file"

for required_path in \
  node_modules/next/dist/bin/next \
  node_modules/@playwright/test/cli.js \
  node_modules/drizzle-kit/bin.cjs \
  scripts/migrate-drizzle.mjs \
  scripts/verify-drizzle-history.mjs \
  scripts/prepare-connected-amocrm-validation.mjs \
  tests/e2e/canonical-v2-10d-real-acceptance.spec.ts; do
  [[ -e "$required_path" ]] \
    || fail "Required local dependency or V2-10D acceptance file is missing: $required_path"
done

evidence_root="$repo_root/output/provider-acceptance/v2-10d"
evidence_dir="$evidence_root/$head_sha"
authority_marker="$evidence_dir/authority-blocked.json"
review_marker="$evidence_dir/review-required.json"
dispatch_marker="$evidence_dir/dispatch-attempt.json"
success_marker="$evidence_dir/success.json"
mkdir -p "$repo_root/output/provider-acceptance" "$evidence_root" "$evidence_dir"
chmod 700 "$repo_root/output/provider-acceptance" "$evidence_root" "$evidence_dir"
[[ ! -e "$review_marker" && ! -e "$dispatch_marker" && ! -e "$success_marker" ]] \
  || fail "This exact SHA already has a review or side-effect marker; reconcile it instead of rerunning blindly"
if find "$evidence_dir" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  fail "The exact-SHA V2-10D evidence directory is not empty"
fi

tmp_root="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
tmp_dir="$(mktemp -d "$tmp_root/evo-v2-10d.XXXXXX")"
project_name="evo-v2-10d-$RANDOM-$$"
compose_env_file="$tmp_dir/postgres.env"
provider_bundle_file="$tmp_dir/provider.bundle"
ssh_probe_log="$tmp_dir/ssh-probe.log"
tunnel_log="$tmp_dir/ssh-tunnel.log"
blocked_app_log="$tmp_dir/app-blocked.log"
operator_app_log="$tmp_dir/app-operator.log"
blocked_browser_log="$tmp_dir/playwright-blocked.log"
operator_browser_log="$tmp_dir/playwright-operator.log"
runtime_file="$tmp_dir/amocrm-runtime.json"
self_file="$tmp_dir/waha-self.json"
session_response_file="$tmp_dir/waha-session.json"
context_file="$tmp_dir/acceptance-context.json"
private_document_root="$tmp_dir/private-documents"
compose_started=0
run_succeeded=0
app_pid=""
tunnel_pid=""
compose_args=()
current_app_log=""
waha_api_key=""
waha_session_name=""
gemini_api_key=""
gemini_model=""
self_id=""
self_lid=""

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

  rm -f -- "$provider_bundle_file" "$session_response_file" >/dev/null 2>&1 || true
  unset waha_api_key waha_session_name gemini_api_key gemini_model self_id self_lid

  if (( compose_started == 1 )); then
    if (( run_succeeded == 1 )); then
      docker compose "${compose_args[@]}" down --volumes --remove-orphans \
        >/dev/null 2>&1 || true
    else
      docker compose "${compose_args[@]}" stop postgres >/dev/null 2>&1 || true
    fi
  fi

  if (( run_succeeded == 1 )); then
    if [[ -d "$tmp_dir" && "$tmp_dir" == "$tmp_root/evo-v2-10d."* ]]; then
      rm -R -- "$tmp_dir"
    fi
  else
    chmod -R go-rwx "$tmp_dir" >/dev/null 2>&1 || true
    printf 'V2-10D acceptance stopped. Protected diagnostics and PostgreSQL recovery state were preserved at %s (Compose project: %s)\n' \
      "$tmp_dir" "$project_name" >&2
  fi

  return "$exit_status"
}
trap cleanup EXIT

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

assert_next_dev_lock_available() {
  local lock_path="$repo_root/.next/dev/lock"
  [[ -e "$lock_path" ]] || return 0
  command -v lsof >/dev/null 2>&1 \
    || fail "Cannot inspect the existing Next development lock: lsof is unavailable"
  local holder_pids=""
  holder_pids="$(lsof -t -- "$lock_path" 2>/dev/null | sort -u || true)"
  [[ -z "$holder_pids" ]] \
    || fail "Another Next development server owns this worktree; no process was terminated"
}

decode_base64() {
  EVO_V2_ENCODED_VALUE="$1" "$node_bin" --input-type=module <<'EOF'
const encoded = process.env.EVO_V2_ENCODED_VALUE ?? "";
if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) process.exit(1);
const value = Buffer.from(encoded, "base64");
if (value.length === 0 || value.includes(0)) process.exit(1);
process.stdout.write(value);
EOF
}

wait_for_local_http() {
  local url="$1"
  local pid="$2"
  local label="$3"
  local deadline=$((SECONDS + 120))
  local status=""
  while (( SECONDS < deadline )); do
    kill -0 "$pid" >/dev/null 2>&1 \
      || fail "$label exited before it became reachable"
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
      --max-time 3 "$url" || true)"
    if [[ "$status" =~ ^[234][0-9][0-9]$ ]]; then
      return 0
    fi
    sleep 1
  done
  fail "$label did not become reachable within 120 seconds"
}

stop_app() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
    app_pid=""
  fi
}

start_app() {
  local provider_authorized="$1"
  current_app_log="$2"
  : >"$current_app_log"
  chmod 600 "$current_app_log"
  assert_next_dev_lock_available
  DATABASE_URL="$database_url" \
    EVO_PRIVATE_DOCUMENT_ROOT="$private_document_root" \
    EVO_DEV_GATE_SESSION_SECRET="$gate_session_secret" \
    EVO_DEV_GATE_ADMIN_IDENTIFIER="$gate_admin_identifier" \
    EVO_DEV_GATE_ADMIN_SECRET="$gate_admin_secret" \
    EVO_DEV_GATE_SALES_IDENTIFIER="$gate_sales_identifier" \
    EVO_DEV_GATE_SALES_SECRET="$gate_sales_secret" \
    EVO_DEV_GATE_ADMISSIONS_IDENTIFIER="$gate_admissions_identifier" \
    EVO_DEV_GATE_ADMISSIONS_SECRET="$gate_admissions_secret" \
    EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$inbound_secret" \
    EVO_V2_GEMINI_PROPOSALS_ENABLED=1 \
    EVO_V2_GEMINI_PROVIDER_AUTHORIZED="$provider_authorized" \
    EVO_V2_GEMINI_API_KEY="$gemini_api_key" \
    EVO_V2_GEMINI_MODEL="$gemini_model" \
    EVO_V2_WAHA_ENABLED=1 \
    EVO_V2_WAHA_PROVIDER_AUTHORIZED="$provider_authorized" \
    EVO_V2_WAHA_BASE_URL="http://127.0.0.1:${tunnel_port}" \
    EVO_V2_WAHA_API_KEY="$waha_api_key" \
    EVO_V2_WAHA_SESSION_NAME="$waha_session_name" \
    "$node_bin" scripts/prepare-connected-amocrm-validation.mjs run-app \
      --runtime-file "$runtime_file" \
      --context-file "$context_file" \
      --provider-authorized "$provider_authorized" \
      -- \
      "$node_bin" node_modules/next/dist/bin/next dev \
        --hostname 127.0.0.1 --port "$app_port" >"$current_app_log" 2>&1 &
  app_pid=$!
  wait_for_local_http "http://127.0.0.1:${app_port}/api/health" \
    "$app_pid" "The private V2 application"
}

postgres_port="$(free_port)"
app_port="$(free_port)"
tunnel_port="$(free_port)"
postgres_user="evo_v2_10d"
postgres_database="evo_v2_10d"
postgres_password="$(openssl rand -hex 24)"
database_url="postgresql://${postgres_user}:${postgres_password}@127.0.0.1:${postgres_port}/${postgres_database}"
gate_session_secret="$(openssl rand -hex 32)"
gate_admin_identifier="admin-v2-10d-$RANDOM"
gate_admin_secret="$(openssl rand -hex 32)"
gate_sales_identifier="sales-v2-10d-$RANDOM"
gate_sales_secret="$(openssl rand -hex 32)"
gate_admissions_identifier="admissions-v2-10d-$RANDOM"
gate_admissions_secret="$(openssl rand -hex 32)"
inbound_secret="$(openssl rand -hex 32)"

mkdir -p "$private_document_root"
chmod 700 "$tmp_dir" "$private_document_root"
printf 'POSTGRES_USER=%s\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=%s\nPOSTGRES_PORT=%s\n' \
  "$postgres_user" "$postgres_password" "$postgres_database" "$postgres_port" \
  >"$compose_env_file"
chmod 600 "$compose_env_file"
compose_args=(
  --project-name "$project_name"
  --env-file "$compose_env_file"
  --file "$repo_root/docker-compose.local.yml"
)

# No SSH connection or provider operation occurs above this point. The explicit
# authority, exact-main, private-secret and no-rerun gates have all passed.
"$node_bin" scripts/prepare-connected-amocrm-validation.mjs map \
  --provider-env "$provider_env_file" \
  --token-file "$token_file" \
  --runtime-file "$runtime_file"

# Retrieve only the existing WAHA/Gemini process inputs from Hermes. The values
# travel as base64 lines inside a protected file and are never printed.
if ! ssh -T -o BatchMode=yes -o ConnectTimeout=15 "$ssh_host" 'bash -s' \
  >"$provider_bundle_file" 2>"$ssh_probe_log" <<'REMOTE'
set -euo pipefail
umask 077

env_file="/opt/evo-crm/.env.lead-agent"
container_name="evo-crm-waha-1"
[[ -r "$env_file" ]]
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
: "${EVO_AGENT_WAHA_API_KEY:?}"
: "${EVO_AGENT_WAHA_SESSION:?}"
: "${GEMINI_API_KEY:?}"
: "${EVO_AGENT_GEMINI_MODEL:?}"
[[ "$EVO_AGENT_WAHA_SESSION" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]]

container_id="$(docker ps --filter "name=^/${container_name}$" --format '{{.ID}}')"
[[ -n "$container_id" && "$container_id" != *$'\n'* ]]
[[ "$(docker inspect --format '{{.State.Running}}' "$container_id")" == "true" ]]
container_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' \
  "$container_id" | awk 'NF { print; exit }')"
[[ -n "$container_ip" ]]

encode_line() {
  printf '%s' "$1" | base64 | tr -d '\n'
  printf '\n'
}

encode_line "$EVO_AGENT_WAHA_API_KEY"
encode_line "$EVO_AGENT_WAHA_SESSION"
encode_line "$GEMINI_API_KEY"
encode_line "$EVO_AGENT_GEMINI_MODEL"
encode_line "$container_ip"
REMOTE
then
  fail "Could not retrieve the existing private WAHA/Gemini connection metadata on hermes-vps"
fi
chmod 600 "$provider_bundle_file" "$ssh_probe_log"

exec 3<"$provider_bundle_file"
IFS= read -r encoded_waha_api_key <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_waha_session <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_gemini_api_key <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_gemini_model <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_container_ip <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r unexpected_bundle_line <&3 \
  && fail "The protected provider bundle contains unexpected data"
exec 3<&-

waha_api_key="$(decode_base64 "$encoded_waha_api_key")" \
  || fail "The protected WAHA credential is invalid"
waha_session_name="$(decode_base64 "$encoded_waha_session")" \
  || fail "The protected WAHA session name is invalid"
gemini_api_key="$(decode_base64 "$encoded_gemini_api_key")" \
  || fail "The protected Gemini credential is invalid"
gemini_model="$(decode_base64 "$encoded_gemini_model")" \
  || fail "The protected Gemini model is invalid"
container_ip="$(decode_base64 "$encoded_container_ip")" \
  || fail "The protected WAHA container address is invalid"
unset encoded_waha_api_key encoded_waha_session encoded_gemini_api_key \
  encoded_gemini_model encoded_container_ip unexpected_bundle_line
rm -f -- "$provider_bundle_file"

EVO_V2_PRIVATE_RUNTIME_FILE="$runtime_file" \
EVO_V2_PRIVATE_WAHA_API_KEY="$waha_api_key" \
EVO_V2_PRIVATE_WAHA_SESSION="$waha_session_name" \
EVO_V2_PRIVATE_GEMINI_API_KEY="$gemini_api_key" \
EVO_V2_PRIVATE_GEMINI_MODEL="$gemini_model" \
  "$node_bin" --input-type=module <<'EOF' \
  || fail "The existing WAHA/Gemini process inputs did not pass exact private validation"
import { readFileSync } from "node:fs";

let runtime;
try {
  runtime = JSON.parse(readFileSync(process.env.EVO_V2_PRIVATE_RUNTIME_FILE, "utf8"));
} catch {
  process.exit(1);
}
const apiKey = process.env.EVO_V2_PRIVATE_GEMINI_API_KEY ?? "";
const model = process.env.EVO_V2_PRIVATE_GEMINI_MODEL ?? "";
if (
  runtime?.waha?.apiKey !== process.env.EVO_V2_PRIVATE_WAHA_API_KEY ||
  runtime?.waha?.sessionName !== process.env.EVO_V2_PRIVATE_WAHA_SESSION ||
  apiKey.trim() !== apiKey ||
  Buffer.byteLength(apiKey, "utf8") < 16 ||
  Buffer.byteLength(apiKey, "utf8") > 4_096 ||
  !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(model)
) {
  process.exit(1);
}
EOF

"$node_bin" scripts/prepare-connected-amocrm-validation.mjs validate-private-ipv4 \
  --value "$container_ip" \
  || fail "The connected WAHA container address was not an exact private IPv4 address"

ssh -o BatchMode=yes \
  -o ConnectTimeout=15 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -N \
  -L "127.0.0.1:${tunnel_port}:${container_ip}:3000" \
  "$ssh_host" >"$tunnel_log" 2>&1 &
tunnel_pid=$!
chmod 600 "$tunnel_log"

tunnel_deadline=$((SECONDS + 30))
tunnel_code=""
while (( SECONDS < tunnel_deadline )); do
  [[ -n "$tunnel_pid" ]] && ! kill -0 "$tunnel_pid" >/dev/null 2>&1 \
    && fail "The private WAHA SSH tunnel exited before validation"
  tunnel_code="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --max-time 3 "http://127.0.0.1:${tunnel_port}/" || true)"
  [[ "$tunnel_code" != "000" ]] && break
  sleep 1
done
[[ "$tunnel_code" != "000" ]] \
  || fail "The private WAHA SSH tunnel never became reachable"

docker compose "${compose_args[@]}" up --detach postgres >/dev/null
compose_started=1
postgres_container_id="$(docker compose "${compose_args[@]}" ps --quiet postgres)"
[[ -n "$postgres_container_id" ]] \
  || fail "The disposable PostgreSQL container did not start"
health_deadline=$((SECONDS + 120))
postgres_status=""
while (( SECONDS < health_deadline )); do
  postgres_status="$(docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$postgres_container_id" 2>/dev/null || true)"
  [[ "$postgres_status" == "healthy" ]] && break
  sleep 2
done
[[ "$postgres_status" == "healthy" ]] \
  || fail "The disposable PostgreSQL container did not become healthy"

DATABASE_URL="$database_url" "$node_bin" node_modules/drizzle-kit/bin.cjs check >/dev/null
DATABASE_URL="$database_url" "$node_bin" scripts/migrate-drizzle.mjs >/dev/null
DATABASE_URL="$database_url" "$node_bin" scripts/verify-drizzle-history.mjs >/dev/null

"$node_bin" scripts/prepare-connected-amocrm-validation.mjs read-waha-self \
  --runtime-file "$runtime_file" \
  --base-url "http://127.0.0.1:${tunnel_port}/" \
  --self-file "$self_file"

EVO_V2_PRIVATE_WAHA_BASE_URL="http://127.0.0.1:${tunnel_port}" \
EVO_V2_PRIVATE_WAHA_API_KEY="$waha_api_key" \
EVO_V2_PRIVATE_WAHA_SESSION="$waha_session_name" \
EVO_V2_PRIVATE_WAHA_SESSION_FILE="$session_response_file" \
  "$node_bin" --input-type=module <<'EOF' \
  || fail "The connected WAHA self identifiers could not be read privately"
import { chmod, writeFile } from "node:fs/promises";

const response = await fetch(
  `${process.env.EVO_V2_PRIVATE_WAHA_BASE_URL}/api/sessions/${encodeURIComponent(process.env.EVO_V2_PRIVATE_WAHA_SESSION ?? "")}`,
  {
    headers: {
      Accept: "application/json",
      "X-Api-Key": process.env.EVO_V2_PRIVATE_WAHA_API_KEY ?? "",
    },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  },
);
if (!response.ok) process.exit(1);
const body = await response.text();
if (Buffer.byteLength(body, "utf8") > 64 * 1024) process.exit(1);
await writeFile(process.env.EVO_V2_PRIVATE_WAHA_SESSION_FILE, body, { mode: 0o600 });
await chmod(process.env.EVO_V2_PRIVATE_WAHA_SESSION_FILE, 0o600);
EOF

read -r self_id self_lid <<<"$(
  EVO_V2_PRIVATE_WAHA_SESSION_FILE="$session_response_file" \
    "$node_bin" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";

let session;
try {
  session = JSON.parse(readFileSync(process.env.EVO_V2_PRIVATE_WAHA_SESSION_FILE, "utf8"));
} catch {
  process.exit(1);
}
const direct = /^[1-9][0-9]{4,31}@(c\.us|lid)$/;
if (session?.status !== "WORKING") {
  process.exit(1);
}
const identities = [session?.me?.id, session?.me?.lid]
  .filter((candidate) => typeof candidate === "string" && direct.test(candidate))
  .filter((candidate, index, values) => values.indexOf(candidate) === index);
const phoneIdentities = identities.filter((identity) => identity.endsWith("@c.us"));
const lidIdentities = identities.filter((identity) => identity.endsWith("@lid"));
if (phoneIdentities.length !== 1 || lidIdentities.length > 1) process.exit(1);
const alternateIdentity = identities.find(
  (identity) => identity !== phoneIdentities[0],
);
process.stdout.write(`${phoneIdentities[0]} ${alternateIdentity ?? ""}`);
EOF
)" || fail "The connected WAHA session is not WORKING with direct self identifiers"
rm -f -- "$session_response_file"
[[ "$self_id" =~ ^[1-9][0-9]{4,31}@c\.us$ ]] \
  || fail "The connected WAHA self phone identifier is not a direct address"
[[ -z "$self_lid" || "$self_lid" =~ ^[1-9][0-9]{4,31}@lid$ ]] \
  || fail "The connected WAHA self LID is not a direct address"

DATABASE_URL="$database_url" \
  "$node_bin" --conditions=react-server --experimental-strip-types \
    scripts/prepare-connected-amocrm-validation.mjs seed \
    --self-file "$self_file" \
    --context-file "$context_file"

# First prove that the complete application contour fails closed when every
# provider authority flag is disabled. This run performs zero provider writes.
start_app 0 "$blocked_app_log"
PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
DATABASE_URL="$database_url" \
EVO_V2_REAL_END_TO_END_ACCEPTANCE=1 \
EVO_V2_REAL_END_TO_END_MODE=blocked \
EVO_V2_ACCEPTANCE_MAIN_SHA="$head_sha" \
EVO_V2_10D_EVIDENCE_DIR="$evidence_dir" \
EVO_V2_AMOCRM_PRIVATE_RUNTIME_FILE="$runtime_file" \
EVO_V2_AMOCRM_PRIVATE_CONTEXT_FILE="$context_file" \
EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$inbound_secret" \
EVO_DEV_GATE_ADMIN_IDENTIFIER="$gate_admin_identifier" \
EVO_DEV_GATE_ADMIN_SECRET="$gate_admin_secret" \
EVO_V2_CONNECTED_WAHA_BASE_URL="http://127.0.0.1:${tunnel_port}" \
EVO_V2_CONNECTED_WAHA_API_KEY="$waha_api_key" \
EVO_V2_CONNECTED_WAHA_SESSION_NAME="$waha_session_name" \
EVO_V2_CONNECTED_WAHA_SELF_ID="$self_id" \
EVO_V2_CONNECTED_WAHA_SELF_LID="$self_lid" \
  "$node_bin" node_modules/@playwright/test/cli.js test \
    tests/e2e/canonical-v2-10d-real-acceptance.spec.ts \
    --config=playwright.config.ts \
    --project=desktop-chromium \
    --workers=1 \
    --reporter=line \
    --output="$tmp_dir/playwright-blocked-results" >"$blocked_browser_log" 2>&1 \
  || fail "The fail-closed V2-10D browser mode failed; inspect protected diagnostics"
chmod 600 "$blocked_browser_log"
stop_app

[[ -f "$authority_marker" ]] \
  || fail "The fail-closed browser mode did not create authority-blocked.json"
chmod 600 "$authority_marker"

"$node_bin" scripts/prepare-connected-amocrm-validation.mjs mark-attempt \
  --kind provider-preparation-attempt \
  --git-sha "$head_sha" \
  --output "$evidence_dir/provider-preparation-attempt.json"

DATABASE_URL="$database_url" \
  "$node_bin" --conditions=react-server --experimental-strip-types \
    scripts/prepare-connected-amocrm-validation.mjs discover \
    --runtime-file "$runtime_file" \
    --context-file "$context_file"

# The operator run is one uninterrupted headed browser session. The spec writes
# review-required.json before waiting for a human review and dispatch-attempt.json
# immediately before the human-confirmed send. Automation never clicks either
# the review decision or send confirmation controls.
start_app 1 "$operator_app_log"
PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
DATABASE_URL="$database_url" \
EVO_V2_REAL_END_TO_END_ACCEPTANCE=1 \
EVO_V2_REAL_END_TO_END_MODE=operator \
EVO_V2_ACCEPTANCE_MAIN_SHA="$head_sha" \
EVO_V2_10D_EVIDENCE_DIR="$evidence_dir" \
EVO_V2_AMOCRM_PRIVATE_RUNTIME_FILE="$runtime_file" \
EVO_V2_AMOCRM_PRIVATE_CONTEXT_FILE="$context_file" \
EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$inbound_secret" \
EVO_DEV_GATE_ADMIN_IDENTIFIER="$gate_admin_identifier" \
EVO_DEV_GATE_ADMIN_SECRET="$gate_admin_secret" \
EVO_V2_CONNECTED_WAHA_BASE_URL="http://127.0.0.1:${tunnel_port}" \
EVO_V2_CONNECTED_WAHA_API_KEY="$waha_api_key" \
EVO_V2_CONNECTED_WAHA_SESSION_NAME="$waha_session_name" \
EVO_V2_CONNECTED_WAHA_SELF_ID="$self_id" \
EVO_V2_CONNECTED_WAHA_SELF_LID="$self_lid" \
  "$node_bin" node_modules/@playwright/test/cli.js test \
    tests/e2e/canonical-v2-10d-real-acceptance.spec.ts \
    --config=playwright.config.ts \
    --project=desktop-chromium \
    --headed \
    --workers=1 \
    --reporter=line \
    --output="$tmp_dir/playwright-operator-results" >"$operator_browser_log" 2>&1 \
  || fail "The operator V2-10D browser run stopped; do not rerun if a durable marker exists"
chmod 600 "$operator_browser_log"
stop_app

for required_marker in \
  "$authority_marker" \
  "$evidence_dir/provider-preparation-attempt.json" \
  "$review_marker" \
  "$dispatch_marker" \
  "$success_marker"; do
  [[ -f "$required_marker" ]] \
    || fail "The bounded V2-10D run did not produce every required durable marker"
  chmod 600 "$required_marker"
done

EVO_V2_10D_EVIDENCE_DIR="$evidence_dir" \
EVO_V2_ACCEPTANCE_MAIN_SHA="$head_sha" \
  "$node_bin" --input-type=module <<'EOF' \
  || fail "The V2-10D evidence did not pass the redacted exact-SHA boundary"
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const directory = process.env.EVO_V2_10D_EVIDENCE_DIR;
const expectedSha = process.env.EVO_V2_ACCEPTANCE_MAIN_SHA;
const names = [
  "authority-blocked.json",
  "provider-preparation-attempt.json",
  "review-required.json",
  "dispatch-attempt.json",
  "success.json",
];
const records = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => [
      name,
      JSON.parse(await readFile(join(directory, name), "utf8")),
    ]),
  ),
);
const assert = (condition) => {
  if (!condition) throw new Error("redacted_v2_10d_evidence_invalid");
};
for (const record of Object.values(records)) {
  assert(record && typeof record === "object" && record.gitSha === expectedSha);
}
const authority = records["authority-blocked.json"];
const preparation = records["provider-preparation-attempt.json"];
const review = records["review-required.json"];
const dispatch = records["dispatch-attempt.json"];
const success = records["success.json"];
assert(authority.kind === "evo-v2-10d-authority-blocked");
assert(authority.status === "passed");
assert(authority.proofMode === "all-provider-authority-disabled");
assert(authority.checks?.geminiAvailability === "blocked");
assert(authority.checks?.geminiProposalCount === 0);
assert(authority.checks?.wahaAvailability === "blocked");
assert(authority.checks?.wahaSendAttemptCount === 0);
assert(authority.checks?.wahaOutboundMessageCount === 0);
assert(authority.checks?.amocrmAvailability === "blocked");
assert(authority.checks?.amocrmProviderAttemptCount === 0);
assert(authority.checks?.amocrmBindingCount === 0);
assert(authority.checks?.fallbackObserved === false);
assert(authority.boundaries?.providerMutation === false);
assert(authority.boundaries?.v1ApplicationPathExecuted === false);
assert(authority.boundaries?.deploymentMutated === false);
assert(preparation.status === "started");
assert(review.status === "review_required");
assert(dispatch.status === "dispatch_intent_recorded");
assert(success.kind === "evo-v2-10d-real-provider-workflow");
assert(success.status === "passed");
assert(success.action === "one_human_reviewed_self_send_then_one_admin_amocrm_sync");
assert(Object.values(success.hashes ?? {}).length === 4);
assert(Object.values(success.hashes ?? {}).every((value) => /^[0-9a-f]{64}$/.test(value)));
assert(success.review?.decision === "accepted" || success.review?.decision === "edited");
assert(success.review?.proposalCount === 1);
assert(success.review?.humanActionObserved === true);
assert(success.waha?.attemptCount === 1);
assert(success.waha?.outboundMessageCount === 1);
assert(success.waha?.exactReadback === true);
assert(success.amocrm?.attemptCount === 7);
assert(success.amocrm?.receiptCount === 7);
assert(success.amocrm?.contactBindingCount === 1);
assert(success.amocrm?.leadBindingCount === 1);
assert(success.amocrm?.validationContactCount === 1);
assert(success.amocrm?.validationLeadCount === 1);
assert(success.amocrm?.validationNoteCount === 1);
assert(success.amocrm?.exactReadback === true);
assert(success.replay?.messageDelta === 0);
assert(success.replay?.providerAttemptDelta === 0);
assert(success.replay?.receiptDelta === 0);
assert(success.replay?.bindingDelta === 0);
assert(success.replay?.businessEventDelta === 0);
assert(success.replay?.providerEntitySetUnchanged === true);
assert(success.boundaries?.database === "disposable_local_postgresql");
assert(success.boundaries?.target === "connected_waha_session_self_validation_entity");
assert(success.boundaries?.v1ApplicationPathExecuted === false);
assert(success.boundaries?.deploymentMutated === false);
assert(success.boundaries?.fallbackObserved === false);

const forbiddenKey = /^(?:access_?token|refresh_?token|client_?secret|api_?key|phone(?:e164)?|recipient(?:_?id)?|self_?id|provider_?(?:message|contact|lead|note|pipeline|status|user)_?id|message_?text|proposal_?text|raw_?payload)$/iu;
const forbiddenValue = /(?:@(?:c\.us|lid)|\+[1-9][0-9]{6,14}|bearer\s+[a-z0-9._-]{12,})/iu;
const inspect = (value) => {
  if (Array.isArray(value)) return value.forEach(inspect);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert(!forbiddenKey.test(key));
      inspect(child);
    }
    return;
  }
  if (typeof value === "string") assert(!forbiddenValue.test(value));
};
for (const record of Object.values(records)) inspect(record);
EOF

docker compose "${compose_args[@]}" down --volumes --remove-orphans >/dev/null
compose_started=0
run_succeeded=1
printf 'V2-10D real provider acceptance passed at exact main SHA %s. Sanitized evidence: %s\n' \
  "$head_sha" "$success_marker"
