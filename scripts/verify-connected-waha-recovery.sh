#!/usr/bin/env bash
set -euo pipefail

umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
fixed_dispatch_sha="9c3df2e0d56378f6bf94af8d7592e525e9d41bcf"
fixed_recovery_occurred_sha="104ea651a14a373418ed2e2308ac8b008fb1fb3d"
dispatch_sha="${EVO_V2_WAHA_DISPATCH_SHA:-}"
reconciliation_sha="${1:-${EVO_V2_RECOVERY_MAIN_SHA:-}}"
recovery_occurred_sha="${EVO_V2_RECOVERY_OCCURRED_MAIN_SHA:-}"
finalize_only="${EVO_V2_WAHA_RECOVERY_FINALIZE:-0}"
preserved_tmp_dir="${EVO_V2_WAHA_PRESERVED_TMP_DIR:-}"
project_name="${EVO_V2_WAHA_PRESERVED_COMPOSE_PROJECT:-}"
expected_provider_id_sha256="${EVO_V2_EXPECTED_PROVIDER_MESSAGE_ID_SHA256:-}"
expected_provider_source="${EVO_V2_EXPECTED_PROVIDER_SOURCE:-app}"
ssh_host="hermes-vps"
run_succeeded=0
compose_started=0
app_pid=""
proxy_pid=""
tunnel_pid=""
runtime_dir=""
provider_bundle_file=""
ssh_probe_log=""
tunnel_log=""
proxy_log=""
proxy_stats_file=""
proxy_ready_file=""
prior_playwright_log=""
prior_playwright_result=""
app_log=""
playwright_log=""
private_document_root=""
compose_env_file=""
compose_args=()
waha_api_key=""
waha_session_name=""

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
  if [[ -n "$proxy_pid" ]]; then
    kill "$proxy_pid" >/dev/null 2>&1 || true
    wait "$proxy_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$tunnel_pid" ]]; then
    kill "$tunnel_pid" >/dev/null 2>&1 || true
    wait "$tunnel_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$provider_bundle_file" ]]; then
    rm -f -- "$provider_bundle_file" >/dev/null 2>&1 || true
  fi
  unset waha_api_key

  if (( compose_started == 1 )); then
    docker compose "${compose_args[@]}" stop postgres >/dev/null 2>&1 || true
  fi

  if (( run_succeeded == 0 )) && [[ -n "$preserved_tmp_dir" && -d "$preserved_tmp_dir" ]]; then
    chmod -R go-rwx "$preserved_tmp_dir" >/dev/null 2>&1 || true
    printf 'Connected WAHA recovery stopped. Protected diagnostics and the preserved database remain at %s\n' \
      "$preserved_tmp_dir" >&2
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

[[ "$#" -le 1 ]] || fail "Usage: $0 <exact-reconciliation-origin-main-sha>"
[[ "${EVO_V2_REAL_WAHA_RECOVERY:-}" == "1" ]] \
  || fail "Set EVO_V2_REAL_WAHA_RECOVERY=1 for the recovery-only acceptance"
[[ "$finalize_only" == "0" || "$finalize_only" == "1" ]] \
  || fail "EVO_V2_WAHA_RECOVERY_FINALIZE must be exactly 0 or 1"
[[ "$dispatch_sha" == "$fixed_dispatch_sha" ]] \
  || fail "EVO_V2_WAHA_DISPATCH_SHA must identify the one preserved dispatch"
[[ "$reconciliation_sha" =~ ^[0-9a-f]{40}$ ]] \
  || fail "Provide the exact 40-character reconciliation main SHA"
[[ "$expected_provider_id_sha256" =~ ^[0-9a-f]{64}$ ]] \
  || fail "EVO_V2_EXPECTED_PROVIDER_MESSAGE_ID_SHA256 must be the expected digest"
[[ "$expected_provider_source" == "api" || "$expected_provider_source" == "app" ]] \
  || fail "EVO_V2_EXPECTED_PROVIDER_SOURCE must be exactly api or app"
if [[ "$finalize_only" == "1" ]]; then
  [[ "$recovery_occurred_sha" == "$fixed_recovery_occurred_sha" ]] \
    || fail "Finalization must identify the one exact main SHA where recovery occurred"
  [[ "$recovery_occurred_sha" != "$reconciliation_sha" ]] \
    || fail "Recovery and evidence-finalization SHAs must be distinct"
else
  [[ -z "$recovery_occurred_sha" ]] \
    || fail "Recovery occurrence SHA is accepted only in finalization mode"
fi
[[ -n "$preserved_tmp_dir" && -d "$preserved_tmp_dir" && ! -L "$preserved_tmp_dir" ]] \
  || fail "EVO_V2_WAHA_PRESERVED_TMP_DIR must be the preserved real-WAHA directory"
[[ "$project_name" =~ ^evo-v2-real-waha-[0-9]+-[0-9]+$ ]] \
  || fail "EVO_V2_WAHA_PRESERVED_COMPOSE_PROJECT is invalid"

for command_name in git docker orb ssh curl openssl; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "Required command is unavailable: $command_name"
done
command -v "$node_bin" >/dev/null 2>&1 \
  || fail "The configured Node executable is unavailable"
[[ "$($node_bin --version)" == v22.* ]] \
  || fail "Connected WAHA recovery requires Node 22.x"
[[ "$(uname -s)" == "Darwin" ]] \
  || fail "Connected WAHA recovery is restricted to the macOS OrbStack contour"
[[ "$(orb status)" == "Running" ]] || fail "OrbStack must be Running"
[[ "$(docker context show)" == "orbstack" ]] \
  || fail "Docker context must be exactly orbstack"

tmp_parent="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
preserved_tmp_dir="$(cd "$preserved_tmp_dir" && pwd -P)"
[[ "$(dirname "$preserved_tmp_dir")" == "$tmp_parent" ]] \
  || fail "The preserved directory is outside the process temporary root"
[[ "$(basename "$preserved_tmp_dir")" == evo-v2-real-waha.* ]] \
  || fail "The preserved directory name is outside the real-WAHA contour"
compose_env_file="$preserved_tmp_dir/postgres.env"
[[ -f "$compose_env_file" && ! -L "$compose_env_file" ]] \
  || fail "The preserved PostgreSQL environment file is missing"

cd "$repo_root"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "The worktree must be clean before connected provider recovery"
git fetch --quiet origin main
head_sha="$(git rev-parse HEAD)"
origin_main_sha="$(git rev-parse refs/remotes/origin/main)"
[[ "$head_sha" == "$origin_main_sha" && "$head_sha" == "$reconciliation_sha" ]] \
  || fail "HEAD, the supplied reconciliation SHA and freshly fetched origin/main must match exactly"
git merge-base --is-ancestor "$head_sha" "$origin_main_sha" \
  || fail "The recovery SHA is not current origin/main"
if [[ "$finalize_only" == "1" ]]; then
  git cat-file -e "${recovery_occurred_sha}^{commit}" \
    || fail "The recorded recovery occurrence SHA is unavailable"
  git merge-base --is-ancestor "$recovery_occurred_sha" "$head_sha" \
    || fail "The evidence-finalization main does not descend from the recovery occurrence"
fi
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "The worktree changed during exact-main verification"

for required_path in \
  node_modules/next/dist/bin/next \
  node_modules/@playwright/test/cli.js \
  tests/e2e/canonical-waha-connected-recovery.spec.ts; do
  [[ -e "$required_path" ]] \
    || fail "Required local dependency or recovery file is missing: $required_path"
done

evidence_dir="$repo_root/output/provider-acceptance/waha/$dispatch_sha"
dispatch_marker="$evidence_dir/dispatch-attempt.json"
old_success_evidence="$evidence_dir/success.json"
recovered_success_evidence="$evidence_dir/recovered-success.json"
[[ -f "$dispatch_marker" && ! -L "$dispatch_marker" ]] \
  || fail "The original dispatch marker is missing"
[[ ! -e "$old_success_evidence" ]] \
  || fail "The original dispatch already has success evidence; recovery is not applicable"
[[ ! -e "$recovered_success_evidence" ]] \
  || fail "Recovery evidence already exists; inspect it instead of rerunning"
if ! dispatch_recorded_at="$(EVO_V2_DISPATCH_MARKER="$dispatch_marker" \
  EVO_V2_EXPECTED_DISPATCH_SHA="$dispatch_sha" \
  "$node_bin" --input-type=module <<'EOF'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const finalText = "EVO V2 technical verification — no response needed.";
let marker;
try {
  marker = JSON.parse(readFileSync(process.env.EVO_V2_DISPATCH_MARKER, "utf8"));
} catch {
  process.exit(1);
}
if (
  marker?.schemaVersion !== 1 ||
  marker?.kind !== "evo-v2-connected-waha-self-send" ||
  marker?.status !== "dispatch_intent_recorded" ||
  marker?.gitSha !== process.env.EVO_V2_EXPECTED_DISPATCH_SHA ||
  typeof marker?.createdAt !== "string" ||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(marker.createdAt) ||
  !Number.isFinite(Date.parse(marker.createdAt)) ||
  marker?.recipientClass !== "connected_provider_session_self" ||
  marker?.finalTextSha256 !== createHash("sha256").update(finalText).digest("hex") ||
  marker?.rerunPolicy !== "inspect_before_any_rerun"
) {
  process.exit(1);
}
process.stdout.write(marker.createdAt);
EOF
)"; then
  fail "The original dispatch marker does not match the preserved authorized action"
fi

if [[ "$finalize_only" == "1" ]]; then
  prior_runtime_dir="$preserved_tmp_dir/recovery-$recovery_occurred_sha"
  [[ -d "$prior_runtime_dir" && ! -L "$prior_runtime_dir" ]] \
    || fail "The exact preserved recovery diagnostics are missing"
  runtime_dir="$preserved_tmp_dir/finalization-$reconciliation_sha"
else
  prior_runtime_dir=""
  runtime_dir="$preserved_tmp_dir/recovery-$reconciliation_sha"
fi
[[ ! -e "$runtime_dir" ]] \
  || fail "Recovery or finalization diagnostics already exist for this SHA; inspect them instead of rerunning"
mkdir -p "$runtime_dir"
chmod 700 "$preserved_tmp_dir" "$runtime_dir"
provider_bundle_file="$runtime_dir/provider.bundle"
ssh_probe_log="$runtime_dir/ssh-probe.log"
tunnel_log="$runtime_dir/ssh-tunnel.log"
proxy_log="$runtime_dir/get-only-proxy.log"
proxy_stats_file="$runtime_dir/get-only-proxy-stats.json"
proxy_ready_file="$runtime_dir/get-only-proxy-ready.json"
app_log="$runtime_dir/app.log"
playwright_log="$runtime_dir/playwright.log"
private_document_root="$runtime_dir/private-documents"
mkdir -p "$private_document_root"
chmod 700 "$private_document_root"

postgres_bundle_file="$runtime_dir/postgres.bundle"
if ! EVO_V2_POSTGRES_ENV_FILE="$compose_env_file" \
  "$node_bin" --input-type=module >"$postgres_bundle_file" <<'EOF'
import { readFileSync } from "node:fs";

const raw = readFileSync(process.env.EVO_V2_POSTGRES_ENV_FILE, "utf8");
const values = new Map();
for (const line of raw.split(/\r?\n/u)) {
  if (!line) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
  if (!match || values.has(match[1])) process.exit(1);
  values.set(match[1], match[2]);
}
if (
  values.size !== 4 ||
  !/^[a-z_][a-z0-9_]{0,62}$/u.test(values.get("POSTGRES_USER") ?? "") ||
  !/^[a-f0-9]{48}$/u.test(values.get("POSTGRES_PASSWORD") ?? "") ||
  !/^[a-z_][a-z0-9_]{0,62}$/u.test(values.get("POSTGRES_DB") ?? "") ||
  !/^[1-9][0-9]{3,4}$/u.test(values.get("POSTGRES_PORT") ?? "")
) {
  process.exit(1);
}
for (const name of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "POSTGRES_PORT"]) {
  process.stdout.write(`${Buffer.from(values.get(name), "utf8").toString("base64")}\n`);
}
EOF
then
  fail "The preserved PostgreSQL environment does not match the original harness contract"
fi
chmod 600 "$postgres_bundle_file"
exec 3<"$postgres_bundle_file"
IFS= read -r encoded_postgres_user <&3 || fail "The protected PostgreSQL bundle is incomplete"
IFS= read -r encoded_postgres_password <&3 || fail "The protected PostgreSQL bundle is incomplete"
IFS= read -r encoded_postgres_database <&3 || fail "The protected PostgreSQL bundle is incomplete"
IFS= read -r encoded_postgres_port <&3 || fail "The protected PostgreSQL bundle is incomplete"
IFS= read -r unexpected_postgres_line <&3 \
  && fail "The protected PostgreSQL bundle contains unexpected data"
exec 3<&-
postgres_user="$(decode_base64 "$encoded_postgres_user")" \
  || fail "The protected PostgreSQL user could not be decoded"
postgres_password="$(decode_base64 "$encoded_postgres_password")" \
  || fail "The protected PostgreSQL password could not be decoded"
postgres_database="$(decode_base64 "$encoded_postgres_database")" \
  || fail "The protected PostgreSQL database could not be decoded"
postgres_port="$(decode_base64 "$encoded_postgres_port")" \
  || fail "The protected PostgreSQL port could not be decoded"
rm -f -- "$postgres_bundle_file"
unset encoded_postgres_user encoded_postgres_password encoded_postgres_database \
  encoded_postgres_port unexpected_postgres_line
database_url="postgresql://${postgres_user}:${postgres_password}@127.0.0.1:${postgres_port}/${postgres_database}"
unset postgres_password

compose_args=(
  --project-name "$project_name"
  --env-file "$compose_env_file"
  --file "$repo_root/docker-compose.local.yml"
)
preserved_container_id="$(docker compose "${compose_args[@]}" ps --all --quiet postgres)"
[[ -n "$preserved_container_id" && "$preserved_container_id" != *$'\n'* ]] \
  || fail "The preserved PostgreSQL container is missing; recovery will not create a replacement"
[[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$preserved_container_id")" == "$project_name" ]] \
  || fail "The preserved PostgreSQL container belongs to a different Compose project"
preserved_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' "$preserved_container_id")"
[[ -n "$preserved_volume" && "$preserved_volume" == "$project_name"_* ]] \
  || fail "The preserved PostgreSQL data volume is missing or belongs to another project"

app_port="$(free_port)"
if [[ "$finalize_only" == "1" ]]; then
  proxy_stats_file="$prior_runtime_dir/get-only-proxy-stats.json"
  proxy_log="$prior_runtime_dir/get-only-proxy.log"
  prior_playwright_log="$prior_runtime_dir/playwright.log"
  prior_playwright_result="$prior_runtime_dir/playwright-results/.last-run.json"
  for preserved_recovery_file in \
    "$proxy_stats_file" \
    "$proxy_log" \
    "$prior_playwright_log" \
    "$prior_playwright_result"; do
    [[ -f "$preserved_recovery_file" && ! -L "$preserved_recovery_file" ]] \
      || fail "A required preserved recovery diagnostic is missing or unsafe"
  done
  [[ ! -s "$proxy_log" ]] \
    || fail "The preserved GET-only proxy emitted diagnostics"
  if ! EVO_V2_PROXY_STATS_FILE="$proxy_stats_file" \
    EVO_V2_PRIOR_PLAYWRIGHT_LOG="$prior_playwright_log" \
    EVO_V2_PRIOR_PLAYWRIGHT_RESULT="$prior_playwright_result" \
    "$node_bin" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";

let stats;
let result;
let log;
try {
  stats = JSON.parse(readFileSync(process.env.EVO_V2_PROXY_STATS_FILE, "utf8"));
  result = JSON.parse(
    readFileSync(process.env.EVO_V2_PRIOR_PLAYWRIGHT_RESULT, "utf8"),
  );
  log = readFileSync(process.env.EVO_V2_PRIOR_PLAYWRIGHT_LOG, "utf8");
} catch {
  process.exit(1);
}
const exactKeys = [
  "forwardedGetCount",
  "getCount",
  "maxResponseBytesObserved",
  "otherMethodCount",
  "postCount",
  "rejectedCount",
  "schemaVersion",
].sort();
const staleAssertion = "Recovery changed the authorized actor/provider lineage";
if (
  JSON.stringify(Object.keys(stats).sort()) !== JSON.stringify(exactKeys) ||
  stats.schemaVersion !== 1 ||
  stats.getCount !== 3 ||
  stats.forwardedGetCount !== 3 ||
  stats.postCount !== 0 ||
  stats.otherMethodCount !== 0 ||
  stats.rejectedCount !== 0 ||
  !Number.isInteger(stats.maxResponseBytesObserved) ||
  stats.maxResponseBytesObserved < 1 ||
  stats.maxResponseBytesObserved > 1024 * 1024 ||
  result?.status !== "failed" ||
  log.split(staleAssertion).length !== 2
) {
  process.exit(1);
}
EOF
  then
    fail "The preserved recovery diagnostics do not prove the one completed GET-only recovery"
  fi
else
# Read only the existing lead-agent client credential, session and private WAHA
# container address. Values are encoded in the protected SSH stream and never
# printed.
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

tunnel_port="$(free_port)"
proxy_port="$(free_port)"
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

EVO_V2_PROXY_PORT="$proxy_port" \
EVO_V2_PROXY_UPSTREAM="http://127.0.0.1:${tunnel_port}" \
EVO_V2_PROXY_API_KEY="$waha_api_key" \
EVO_V2_PROXY_STATS_FILE="$proxy_stats_file" \
EVO_V2_PROXY_READY_FILE="$proxy_ready_file" \
EVO_V2_PROXY_MAX_GET=16 \
  "$node_bin" --input-type=module >"$proxy_log" 2>&1 <<'EOF' &
import { createServer } from "node:http";
import { chmod, rename, writeFile } from "node:fs/promises";

const port = Number(process.env.EVO_V2_PROXY_PORT);
const upstream = new URL(process.env.EVO_V2_PROXY_UPSTREAM);
const apiKey = process.env.EVO_V2_PROXY_API_KEY;
const statsFile = process.env.EVO_V2_PROXY_STATS_FILE;
const readyFile = process.env.EVO_V2_PROXY_READY_FILE;
const maxGet = Number(process.env.EVO_V2_PROXY_MAX_GET);
const maxResponseBytes = 1024 * 1024;
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  upstream.hostname !== "127.0.0.1" ||
  upstream.protocol !== "http:" ||
  !apiKey ||
  !statsFile ||
  !readyFile ||
  !Number.isInteger(maxGet) ||
  maxGet < 1 ||
  maxGet > 32
) {
  process.exit(1);
}

const stats = {
  schemaVersion: 1,
  getCount: 0,
  forwardedGetCount: 0,
  postCount: 0,
  otherMethodCount: 0,
  rejectedCount: 0,
  maxResponseBytesObserved: 0,
};
let writeChain = Promise.resolve();
function persistStats() {
  writeChain = writeChain.then(async () => {
    const temporary = `${statsFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(stats)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, statsFile);
    await chmod(statsFile, 0o600);
  });
  return writeChain;
}

async function boundedBody(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new Error("response_bound");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      throw new Error("response_bound");
    }
    chunks.push(Buffer.from(value));
  }
  stats.maxResponseBytesObserved = Math.max(stats.maxResponseBytesObserved, total);
  return Buffer.concat(chunks, total);
}

function finish(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

const server = createServer((request, response) => {
  void (async () => {
    const method = (request.method ?? "").toUpperCase();
    if (method !== "GET") {
      if (method === "POST") stats.postCount += 1;
      else stats.otherMethodCount += 1;
      stats.rejectedCount += 1;
      request.resume();
      await persistStats();
      finish(response, 405, '{"error":"method_not_allowed"}');
      return;
    }

    stats.getCount += 1;
    if (
      stats.getCount > maxGet ||
      typeof request.url !== "string" ||
      request.url.length > 4096 ||
      !request.url.startsWith("/api/")
    ) {
      stats.rejectedCount += 1;
      request.resume();
      await persistStats();
      finish(response, 429, '{"error":"request_rejected"}');
      return;
    }

    try {
      const target = new URL(request.url, upstream);
      if (target.origin !== upstream.origin) throw new Error("target_origin");
      const upstreamResponse = await fetch(target, {
        method: "GET",
        headers: { Accept: "application/json", "X-Api-Key": apiKey },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      const body = await boundedBody(upstreamResponse);
      stats.forwardedGetCount += 1;
      await persistStats();
      response.writeHead(upstreamResponse.status, {
        "cache-control": "no-store",
        "content-length": body.byteLength,
        "content-type": "application/json; charset=utf-8",
      });
      response.end(body);
    } catch {
      stats.rejectedCount += 1;
      await persistStats();
      finish(response, 502, '{"error":"upstream_unavailable"}');
    }
  })().catch(async () => {
    stats.rejectedCount += 1;
    await persistStats().catch(() => undefined);
    if (!response.headersSent) finish(response, 500, '{"error":"proxy_failure"}');
    else response.destroy();
  });
});

server.on("clientError", (_error, socket) => socket.destroy());
server.listen(port, "127.0.0.1", async () => {
  await persistStats();
  await writeFile(readyFile, '{"status":"ready"}\n', { mode: 0o600 });
  await chmod(readyFile, 0o600);
});
EOF
proxy_pid=$!
chmod 600 "$proxy_log"

proxy_deadline=$((SECONDS + 30))
while (( SECONDS < proxy_deadline )); do
  kill -0 "$tunnel_pid" >/dev/null 2>&1 \
    || fail "The private SSH tunnel exited before recovery"
  kill -0 "$proxy_pid" >/dev/null 2>&1 \
    || fail "The GET-only WAHA proxy exited before it became ready"
  [[ -f "$proxy_ready_file" ]] && break
  sleep 1
done
[[ -f "$proxy_ready_file" ]] \
  || fail "The GET-only WAHA proxy did not become ready"
chmod 600 "$proxy_ready_file" "$proxy_stats_file"
fi

docker compose "${compose_args[@]}" up --detach postgres >/dev/null
compose_started=1
postgres_container_id="$(docker compose "${compose_args[@]}" ps --quiet postgres)"
[[ "$postgres_container_id" == "$preserved_container_id" ]] \
  || fail "Compose did not restart the exact preserved PostgreSQL container"
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
  || fail "The preserved PostgreSQL container did not become healthy"

gate_session_secret="$(openssl rand -hex 32)"
gate_admin_identifier="director-waha-recovery-$RANDOM"
gate_admin_secret="$(openssl rand -hex 32)"
gate_sales_identifier="sales-waha-recovery-$RANDOM"
gate_sales_secret="$(openssl rand -hex 32)"
gate_admissions_identifier="admissions-waha-recovery-$RANDOM"
gate_admissions_secret="$(openssl rand -hex 32)"
inbound_secret="$(openssl rand -hex 32)"

assert_next_dev_lock_available
app_environment=(
  "DATABASE_URL=$database_url"
  "EVO_PRIVATE_DOCUMENT_ROOT=$private_document_root"
  "EVO_DEV_GATE_SESSION_SECRET=$gate_session_secret"
  "EVO_DEV_GATE_ADMIN_IDENTIFIER=$gate_admin_identifier"
  "EVO_DEV_GATE_ADMIN_SECRET=$gate_admin_secret"
  "EVO_DEV_GATE_SALES_IDENTIFIER=$gate_sales_identifier"
  "EVO_DEV_GATE_SALES_SECRET=$gate_sales_secret"
  "EVO_DEV_GATE_ADMISSIONS_IDENTIFIER=$gate_admissions_identifier"
  "EVO_DEV_GATE_ADMISSIONS_SECRET=$gate_admissions_secret"
  "EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET=$inbound_secret"
  "EVO_V2_GEMINI_PROPOSALS_ENABLED=0"
  "EVO_V2_GEMINI_PROVIDER_AUTHORIZED=0"
)
if [[ "$finalize_only" == "1" ]]; then
  app_environment+=(
    "EVO_V2_WAHA_ENABLED=0"
    "EVO_V2_WAHA_PROVIDER_AUTHORIZED=0"
  )
else
  app_environment+=(
    "EVO_V2_WAHA_ENABLED=1"
    "EVO_V2_WAHA_PROVIDER_AUTHORIZED=1"
    "EVO_V2_WAHA_BASE_URL=http://127.0.0.1:${proxy_port}"
    "EVO_V2_WAHA_API_KEY=$waha_api_key"
    "EVO_V2_WAHA_SESSION_NAME=$waha_session_name"
  )
fi
env "${app_environment[@]}" "$node_bin" node_modules/next/dist/bin/next dev \
    --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
app_pid=$!
unset app_environment
chmod 600 "$app_log"
wait_for_local_http "http://127.0.0.1:${app_port}/login" "$app_pid" "The real Next application"

# The browser test receives no WAHA URL, session or API key. Normal recovery
# reads must traverse the GET-only proxy. Finalization starts the app with WAHA
# disabled and only verifies the already accepted PostgreSQL/browser result.
if ! PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
  DATABASE_URL="$database_url" \
  EVO_V2_REAL_WAHA_RECOVERY=1 \
  EVO_V2_WAHA_RECOVERY_FINALIZE="$finalize_only" \
  EVO_V2_RECOVERY_OCCURRED_MAIN_SHA="$recovery_occurred_sha" \
  EVO_V2_WAHA_DISPATCH_SHA="$dispatch_sha" \
  EVO_V2_WAHA_DISPATCH_RECORDED_AT="$dispatch_recorded_at" \
  EVO_V2_RECOVERY_MAIN_SHA="$reconciliation_sha" \
  EVO_V2_WAHA_EVIDENCE_DIR="$evidence_dir" \
  EVO_V2_EXPECTED_PROVIDER_MESSAGE_ID_SHA256="$expected_provider_id_sha256" \
  EVO_V2_EXPECTED_PROVIDER_SOURCE="$expected_provider_source" \
  EVO_DEV_GATE_SALES_IDENTIFIER="$gate_sales_identifier" \
  EVO_DEV_GATE_SALES_SECRET="$gate_sales_secret" \
  "$node_bin" node_modules/@playwright/test/cli.js test \
    tests/e2e/canonical-waha-connected-recovery.spec.ts \
    --config=playwright.config.ts \
    --project=desktop-chromium \
    --workers=1 \
    --reporter=line \
    --output="$runtime_dir/playwright-results" >"$playwright_log" 2>&1; then
  fail "Connected WAHA recovery browser acceptance failed; inspect the preserved state before any retry"
fi
chmod 600 "$playwright_log"

[[ -f "$recovered_success_evidence" ]] \
  || fail "Recovery did not produce sanitized success evidence"
if ! EVO_V2_RECOVERY_EVIDENCE="$recovered_success_evidence" \
  EVO_V2_EXPECTED_DISPATCH_SHA="$dispatch_sha" \
  EVO_V2_EXPECTED_RECOVERY_SHA="${recovery_occurred_sha:-$reconciliation_sha}" \
  EVO_V2_EXPECTED_FINALIZATION_SHA="$reconciliation_sha" \
  EVO_V2_EXPECTED_PROVIDER_ID_SHA256="$expected_provider_id_sha256" \
  EVO_V2_EXPECTED_PROVIDER_SOURCE="$expected_provider_source" \
  EVO_V2_EXPECT_FINALIZATION="$finalize_only" \
  "$node_bin" --input-type=module <<'EOF'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

let evidence;
try {
  evidence = JSON.parse(readFileSync(process.env.EVO_V2_RECOVERY_EVIDENCE, "utf8"));
} catch {
  process.exit(1);
}
const serialized = JSON.stringify(evidence);
const directIdentity = /[1-9][0-9]{4,31}@(c[.]us|lid)/u;
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u;
const expectedFinalTextSha256 = createHash("sha256")
  .update("EVO V2 technical verification — no response needed.")
  .digest("hex");
const ackNames = Object.freeze({
  0: "PENDING",
  1: "SERVER",
  2: "DEVICE",
  3: "READ",
  4: "PLAYED",
});
const finalization = process.env.EVO_V2_EXPECT_FINALIZATION === "1";
const invalidMode = finalization
  ? evidence?.schemaVersion !== 2 ||
    evidence?.finalizationSha !== process.env.EVO_V2_EXPECTED_FINALIZATION_SHA ||
    evidence?.action !== "resume_after_accepted_recovery_without_provider_calls" ||
    evidence?.provider?.lookup !== "validated_preserved_get_only_unique_match" ||
    evidence?.browser?.recoveryButtonClicked !== false ||
    evidence?.browser?.finalizationReadOnly !== true ||
    evidence?.boundaries?.finalizationProviderTransport !==
      "disabled_no_provider_configuration"
  : evidence?.schemaVersion !== 1 ||
    evidence?.finalizationSha !== undefined ||
    evidence?.action !== "one_explicit_browser_recovery_without_resend" ||
    evidence?.provider?.lookup !== "bounded_get_only_unique_match" ||
    evidence?.browser?.recoveryButtonClicked !== true ||
    evidence?.browser?.finalizationReadOnly !== false ||
    evidence?.boundaries?.finalizationProviderTransport !== null;
if (
  invalidMode ||
  evidence?.kind !== "evo-v2-connected-waha-unknown-recovery" ||
  evidence?.status !== "passed" ||
  evidence?.dispatchSha !== process.env.EVO_V2_EXPECTED_DISPATCH_SHA ||
  evidence?.reconciliationSha !== process.env.EVO_V2_EXPECTED_RECOVERY_SHA ||
  !isoTimestamp.test(evidence?.completedAt ?? "") ||
  evidence?.finalTextSha256 !== expectedFinalTextSha256 ||
  evidence?.providerMessageIdSha256 !== process.env.EVO_V2_EXPECTED_PROVIDER_ID_SHA256 ||
  evidence?.provider?.source !== process.env.EVO_V2_EXPECTED_PROVIDER_SOURCE ||
  ![0, 1, 2, 3, 4].includes(evidence?.provider?.ack) ||
  evidence?.provider?.ackName !== ackNames[evidence?.provider?.ack] ||
  evidence?.database?.sameAttemptRecovered !== true ||
  evidence?.database?.failureCleared !== true ||
  evidence?.database?.dispatchCorrelation !== "exact_text_and_marker_time_window" ||
  evidence?.database?.attemptCount !== 1 ||
  evidence?.database?.outboundMessageCount !== 1 ||
  evidence?.browser?.role !== "sales" ||
  evidence?.browser?.sendButtonClicked !== false ||
  evidence?.boundaries?.database !== "preserved_disposable_local_postgresql" ||
  evidence?.boundaries?.providerTransport !== "harness_enforced_get_only_proxy" ||
  evidence?.boundaries?.productionDatabaseMutated !== false ||
  evidence?.boundaries?.deploymentMutated !== false ||
  directIdentity.test(serialized) ||
  /api.?key|client.?secret|access.?token|refresh.?token/i.test(serialized)
) {
  process.exit(1);
}
EOF
then
  fail "The sanitized WAHA recovery evidence is invalid"
fi
chmod 600 "$dispatch_marker" "$recovered_success_evidence"

if ! EVO_V2_PROXY_STATS_FILE="$proxy_stats_file" \
  EVO_V2_EXPECT_FINALIZATION="$finalize_only" \
  "$node_bin" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";

let stats;
try {
  stats = JSON.parse(readFileSync(process.env.EVO_V2_PROXY_STATS_FILE, "utf8"));
} catch {
  process.exit(1);
}
const exactKeys = [
  "forwardedGetCount",
  "getCount",
  "maxResponseBytesObserved",
  "otherMethodCount",
  "postCount",
  "rejectedCount",
  "schemaVersion",
];
const finalization = process.env.EVO_V2_EXPECT_FINALIZATION === "1";
const validGetCounts = finalization
  ? stats?.getCount === 3 && stats?.forwardedGetCount === 3
  : Number.isInteger(stats?.getCount) &&
    stats.getCount >= 1 &&
    stats.getCount <= 16 &&
    stats.forwardedGetCount === stats.getCount;
if (
  JSON.stringify(Object.keys(stats).sort()) !== JSON.stringify(exactKeys) ||
  stats.schemaVersion !== 1 ||
  !validGetCounts ||
  stats.postCount !== 0 ||
  stats.otherMethodCount !== 0 ||
  stats.rejectedCount !== 0 ||
  !Number.isInteger(stats.maxResponseBytesObserved) ||
  stats.maxResponseBytesObserved < 1 ||
  stats.maxResponseBytesObserved > 1024 * 1024
) {
  process.exit(1);
}
EOF
then
  fail "The GET-only proxy did not prove a bounded read-only provider recovery"
fi
[[ ! -s "$proxy_log" ]] \
  || fail "The GET-only proxy emitted diagnostics; inspect them before cleanup"

kill "$app_pid" >/dev/null 2>&1 || true
wait "$app_pid" >/dev/null 2>&1 || true
app_pid=""
kill "$proxy_pid" >/dev/null 2>&1 || true
wait "$proxy_pid" >/dev/null 2>&1 || true
proxy_pid=""
kill "$tunnel_pid" >/dev/null 2>&1 || true
wait "$tunnel_pid" >/dev/null 2>&1 || true
tunnel_pid=""
unset waha_api_key

docker compose "${compose_args[@]}" down --volumes --remove-orphans >/dev/null
compose_started=0
rm -R -- "$preserved_tmp_dir"
run_succeeded=1
printf 'Connected WAHA unknown-result recovery passed at exact main SHA %s. Sanitized evidence: %s\n' \
  "$reconciliation_sha" "$recovered_success_evidence"
