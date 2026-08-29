#!/usr/bin/env bash
set -euo pipefail

umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
expected_main_sha="${1:-${EVO_V2_EXPECTED_MAIN_SHA:-}}"
ssh_host="hermes-vps"
project_name="evo-v2-real-waha-$RANDOM-$$"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-v2-real-waha.XXXXXX")"
compose_env_file="$tmp_dir/postgres.env"
provider_bundle_file="$tmp_dir/provider.bundle"
ssh_probe_log="$tmp_dir/ssh-probe.log"
tunnel_log="$tmp_dir/ssh-tunnel.log"
app_log="$tmp_dir/app.log"
playwright_log="$tmp_dir/playwright.log"
session_response_file="$tmp_dir/session.json"
private_document_root="$tmp_dir/private-documents"
run_succeeded=0
preserve_failure=0
app_pid=""
tunnel_pid=""
compose_started=0
compose_args=()
waha_api_key=""
waha_session_name=""
self_id=""

fail() {
  printf '%s\n' "$1" >&2
  exit 1
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
  unset waha_api_key self_id

  if (( compose_started == 1 )); then
    if (( run_succeeded == 1 )); then
      docker compose "${compose_args[@]}" down --volumes --remove-orphans \
        >/dev/null 2>&1 || true
    else
      docker compose "${compose_args[@]}" stop postgres >/dev/null 2>&1 || true
    fi
  fi

  if (( run_succeeded == 1 || preserve_failure == 0 )); then
    if [[ -d "$tmp_dir" && "$tmp_dir" == "${TMPDIR:-/tmp}/evo-v2-real-waha."* ]]; then
      rm -R -- "$tmp_dir"
    fi
  else
    chmod -R go-rwx "$tmp_dir" >/dev/null 2>&1 || true
    printf 'Connected WAHA acceptance stopped. Protected diagnostics were preserved at %s\n' \
      "$tmp_dir" >&2
  fi

  return "$exit_status"
}
trap cleanup EXIT

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

case "$-" in
  *x*) fail "Shell xtrace must be disabled because this harness handles provider secrets" ;;
esac

[[ "$#" -le 1 ]] || fail "Usage: $0 <exact-origin-main-sha>"
[[ "${EVO_V2_REAL_WAHA_ACCEPTANCE:-}" == "1" ]] \
  || fail "Set EVO_V2_REAL_WAHA_ACCEPTANCE=1 to authorize the single connected self-send"
[[ "$expected_main_sha" =~ ^[0-9a-f]{40}$ ]] \
  || fail "Provide the exact 40-character main SHA as the argument or EVO_V2_EXPECTED_MAIN_SHA"

for command_name in git docker orb ssh curl openssl; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "Required command is unavailable: $command_name"
done
command -v "$node_bin" >/dev/null 2>&1 \
  || fail "The configured Node executable is unavailable"
[[ "$($node_bin --version)" == v22.* ]] \
  || fail "Connected WAHA acceptance requires Node 22.x"
[[ "$(uname -s)" == "Darwin" ]] \
  || fail "Connected WAHA acceptance is restricted to the macOS OrbStack contour"
[[ "$(orb status)" == "Running" ]] || fail "OrbStack must be Running"
[[ "$(docker context show)" == "orbstack" ]] \
  || fail "Docker context must be exactly orbstack"

cd "$repo_root"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "The worktree must be clean before connected provider acceptance"
git fetch --quiet origin main
head_sha="$(git rev-parse HEAD)"
origin_main_sha="$(git rev-parse refs/remotes/origin/main)"
[[ "$head_sha" == "$origin_main_sha" && "$head_sha" == "$expected_main_sha" ]] \
  || fail "HEAD, the supplied SHA and freshly fetched origin/main must match exactly"
git merge-base --is-ancestor "$head_sha" "$origin_main_sha" \
  || fail "The acceptance SHA is not current origin/main"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "The worktree changed during exact-main verification"

for required_path in \
  node_modules/next/dist/bin/next \
  node_modules/@playwright/test/cli.js \
  node_modules/drizzle-kit/bin.cjs \
  scripts/migrate-drizzle.mjs \
  scripts/verify-drizzle-history.mjs \
  tests/e2e/canonical-waha-connected-provider.spec.ts; do
  [[ -e "$required_path" ]] || fail "Required local dependency or acceptance file is missing"
done

evidence_dir="$repo_root/output/provider-acceptance/waha/$head_sha"
dispatch_marker="$evidence_dir/dispatch-attempt.json"
success_evidence="$evidence_dir/success.json"
mkdir -p "$evidence_dir"
chmod 700 "$repo_root/output/provider-acceptance" \
  "$repo_root/output/provider-acceptance/waha" "$evidence_dir" 2>/dev/null || true
[[ ! -e "$dispatch_marker" && ! -e "$success_evidence" ]] \
  || fail "This exact SHA already has a dispatch marker; inspect it instead of rerunning blindly"
if find "$evidence_dir" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  fail "The exact-SHA evidence directory is not empty"
fi

postgres_port="$(free_port)"
app_port="$(free_port)"
tunnel_port="$(free_port)"
postgres_user="evo_waha_acceptance"
postgres_database="evo_waha_acceptance"
postgres_password="$(openssl rand -hex 24)"
database_url="postgresql://${postgres_user}:${postgres_password}@127.0.0.1:${postgres_port}/${postgres_database}"
gate_session_secret="$(openssl rand -hex 32)"
gate_admin_identifier="director-waha-$RANDOM"
gate_admin_secret="$(openssl rand -hex 32)"
gate_sales_identifier="sales-waha-$RANDOM"
gate_sales_secret="$(openssl rand -hex 32)"
gate_admissions_identifier="admissions-waha-$RANDOM"
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

# Read only the existing lead-agent client credential and session on Hermes.
# Values are encoded inside the protected SSH stream and are never printed.
preserve_failure=1
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
encode_line "$container_ip"
REMOTE
then
  fail "Could not read the existing private WAHA connection metadata on hermes-vps"
fi
chmod 600 "$provider_bundle_file" "$ssh_probe_log"

exec 3<"$provider_bundle_file"
IFS= read -r encoded_api_key <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_session <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_container_ip <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r unexpected_bundle_line <&3 \
  && fail "The protected provider bundle contains unexpected data"
exec 3<&-

waha_api_key="$(decode_base64 "$encoded_api_key")" \
  || fail "The protected WAHA API key could not be decoded"
waha_session_name="$(decode_base64 "$encoded_session")" \
  || fail "The protected WAHA session could not be decoded"
container_ip="$(decode_base64 "$encoded_container_ip")" \
  || fail "The protected WAHA container address could not be decoded"
rm -f -- "$provider_bundle_file"
unset encoded_api_key encoded_session encoded_container_ip unexpected_bundle_line

[[ "$waha_session_name" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] \
  || fail "The protected WAHA session name is invalid"
if ! EVO_V2_PRIVATE_WAHA_API_KEY="$waha_api_key" "$node_bin" --input-type=module <<'EOF'
const value = process.env.EVO_V2_PRIVATE_WAHA_API_KEY ?? "";
const byteLength = Buffer.byteLength(value, "utf8");
process.exit(
  value === value.trim() &&
    byteLength >= 1 &&
    byteLength <= 4_096 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
    ? 0
    : 1,
);
EOF
then
  fail "The protected WAHA API key did not satisfy the server-only input contract"
fi
if ! EVO_V2_PRIVATE_ADDRESS="$container_ip" "$node_bin" --input-type=module <<'EOF'
import { isIP } from "node:net";

const value = process.env.EVO_V2_PRIVATE_ADDRESS ?? "";
if (isIP(value) !== 4) process.exit(1);
const octets = value.split(".").map(Number);
const isRfc1918 =
  octets[0] === 10 ||
  (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
  (octets[0] === 192 && octets[1] === 168);
process.exit(isRfc1918 ? 0 : 1);
EOF
then
  fail "The WAHA container did not expose one RFC1918 private IPv4 address"
fi

ssh -NT \
  -o BatchMode=yes \
  -o ConnectTimeout=15 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -L "127.0.0.1:${tunnel_port}:${container_ip}:3000" \
  "$ssh_host" >"$tunnel_log" 2>&1 &
tunnel_pid=$!
chmod 600 "$tunnel_log"

session_deadline=$((SECONDS + 45))
session_status=""
while (( SECONDS < session_deadline )); do
  kill -0 "$tunnel_pid" >/dev/null 2>&1 \
    || fail "The private SSH tunnel exited before the WAHA session was reachable"
  if EVO_V2_WAHA_SESSION_URL="http://127.0.0.1:${tunnel_port}/api/sessions/${waha_session_name}" \
    EVO_V2_WAHA_API_KEY="$waha_api_key" \
    EVO_V2_WAHA_SESSION_RESPONSE_FILE="$session_response_file" \
    "$node_bin" --input-type=module <<'EOF'
import { chmod, writeFile } from "node:fs/promises";

let response;
try {
  response = await fetch(process.env.EVO_V2_WAHA_SESSION_URL, {
    headers: { Accept: "application/json", "X-Api-Key": process.env.EVO_V2_WAHA_API_KEY },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
} catch {
  process.exit(1);
}
if (!response.ok) process.exit(1);
const body = await response.text();
if (Buffer.byteLength(body, "utf8") > 64 * 1024) process.exit(1);
await writeFile(process.env.EVO_V2_WAHA_SESSION_RESPONSE_FILE, body, { mode: 0o600 });
await chmod(process.env.EVO_V2_WAHA_SESSION_RESPONSE_FILE, 0o600);
EOF
  then
    session_status="200"
    break
  fi
  sleep 1
done
[[ "$session_status" == "200" ]] \
  || fail "The existing WAHA session was not reachable through the private tunnel"
chmod 600 "$session_response_file"
self_id="$(EVO_V2_SESSION_RESPONSE_FILE="$session_response_file" "$node_bin" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";

let value;
try {
  value = JSON.parse(readFileSync(process.env.EVO_V2_SESSION_RESPONSE_FILE, "utf8"));
} catch {
  process.exit(1);
}
if (
  !value ||
  value.status !== "WORKING" ||
  !value.me ||
  typeof value.me.id !== "string" ||
  !/^[1-9]\d{4,31}@(c\.us|lid)$/.test(value.me.id)
) {
  process.exit(1);
}
process.stdout.write(value.me.id);
EOF
)" || fail "The connected WAHA session is not WORKING with a direct self identifier"
rm -f -- "$session_response_file"
[[ "$self_id" =~ ^[1-9][0-9]{4,31}@(c\.us|lid)$ ]] \
  || fail "The connected WAHA self identifier is not a direct @c.us/@lid address"

docker compose "${compose_args[@]}" up --detach postgres >/dev/null
compose_started=1
postgres_container_id="$(docker compose "${compose_args[@]}" ps --quiet postgres)"
[[ -n "$postgres_container_id" ]] || fail "The disposable PostgreSQL container did not start"
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
EVO_V2_GEMINI_PROPOSALS_ENABLED=0 \
EVO_V2_GEMINI_PROVIDER_AUTHORIZED=0 \
EVO_V2_WAHA_ENABLED=1 \
EVO_V2_WAHA_PROVIDER_AUTHORIZED=1 \
EVO_V2_WAHA_BASE_URL="http://127.0.0.1:${tunnel_port}" \
EVO_V2_WAHA_API_KEY="$waha_api_key" \
EVO_V2_WAHA_SESSION_NAME="$waha_session_name" \
  "$node_bin" node_modules/next/dist/bin/next dev \
    --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
app_pid=$!
chmod 600 "$app_log"
wait_for_local_http "http://127.0.0.1:${app_port}/login" "$app_pid" "The real Next application"

if ! PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
  DATABASE_URL="$database_url" \
  EVO_V2_REAL_WAHA_ACCEPTANCE=1 \
  EVO_V2_ACCEPTANCE_MAIN_SHA="$head_sha" \
  EVO_V2_WAHA_EVIDENCE_DIR="$evidence_dir" \
  EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$inbound_secret" \
  EVO_DEV_GATE_SALES_IDENTIFIER="$gate_sales_identifier" \
  EVO_DEV_GATE_SALES_SECRET="$gate_sales_secret" \
  EVO_V2_CONNECTED_WAHA_BASE_URL="http://127.0.0.1:${tunnel_port}" \
  EVO_V2_CONNECTED_WAHA_API_KEY="$waha_api_key" \
  EVO_V2_CONNECTED_WAHA_SESSION_NAME="$waha_session_name" \
  EVO_V2_CONNECTED_WAHA_SELF_ID="$self_id" \
  "$node_bin" node_modules/@playwright/test/cli.js test \
    tests/e2e/canonical-waha-connected-provider.spec.ts \
    --config=playwright.config.ts \
    --project=desktop-chromium \
    --workers=1 \
    --reporter=line \
    --output="$tmp_dir/playwright-results" >"$playwright_log" 2>&1; then
  fail "Connected WAHA browser acceptance failed; do not rerun if a dispatch marker exists"
fi
chmod 600 "$playwright_log"

[[ -f "$dispatch_marker" && -f "$success_evidence" ]] \
  || fail "Connected WAHA acceptance did not produce both the dispatch marker and sanitized success evidence"
if ! EVO_V2_SUCCESS_EVIDENCE="$success_evidence" EVO_V2_EXPECTED_SHA="$head_sha" \
  "$node_bin" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";

let evidence;
try {
  evidence = JSON.parse(readFileSync(process.env.EVO_V2_SUCCESS_EVIDENCE, "utf8"));
} catch {
  process.exit(1);
}
const serialized = JSON.stringify(evidence);
if (
  evidence?.status !== "passed" ||
  evidence?.gitSha !== process.env.EVO_V2_EXPECTED_SHA ||
  evidence?.database?.attemptCount !== 1 ||
  evidence?.database?.outboundMessageCount !== 1 ||
  evidence?.provider?.exactReadback !== true ||
  Object.hasOwn(evidence ?? {}, "selfId") ||
  /api.?key|recipient.?id|self.?id/i.test(serialized)
) {
  process.exit(1);
}
EOF
then
  fail "The sanitized WAHA success evidence is invalid"
fi
chmod 600 "$dispatch_marker" "$success_evidence"

docker compose "${compose_args[@]}" down --volumes --remove-orphans >/dev/null
compose_started=0
run_succeeded=1
printf 'Connected WAHA self-send acceptance passed at exact main SHA %s. Sanitized evidence: %s\n' \
  "$head_sha" "$success_evidence"
