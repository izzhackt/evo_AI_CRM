#!/usr/bin/env bash
set -euo pipefail

umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
expected_main_sha="${1:-${EVO_V2_EXPECTED_MAIN_SHA:-}}"
original_attempt_sha="${EVO_V2_10D_ORIGINAL_ATTEMPT_SHA:-}"
preserved_tmp_dir="${EVO_V2_10D_PRESERVED_TMP_DIR:-}"
project_name="${EVO_V2_10D_PRESERVED_COMPOSE_PROJECT:-}"
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

[[ "$#" -le 1 ]] || fail "Usage: $0 <exact-recovery-origin-main-sha>"
[[ "${EVO_V2_REAL_END_TO_END_RECOVERY:-}" == "1" ]] \
  || fail "Set EVO_V2_REAL_END_TO_END_RECOVERY=1 for the one preserved review recovery"
[[ "$expected_main_sha" =~ ^[0-9a-f]{40}$ ]] \
  || fail "Provide the exact 40-character recovery origin/main SHA"
[[ "$original_attempt_sha" =~ ^[0-9a-f]{40}$ ]] \
  || fail "EVO_V2_10D_ORIGINAL_ATTEMPT_SHA must identify the preserved attempt"
[[ "$expected_main_sha" != "$original_attempt_sha" ]] \
  || fail "Recovery code and original attempt SHAs must be distinct"
[[ "$project_name" =~ ^evo-v2-10d-[0-9]+-[0-9]+$ ]] \
  || fail "EVO_V2_10D_PRESERVED_COMPOSE_PROJECT is invalid"

for command_name in git docker orb ssh curl openssl stat; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "Required command is unavailable: $command_name"
done
command -v "$node_bin" >/dev/null 2>&1 \
  || fail "The configured Node executable is unavailable"
[[ "$($node_bin --version)" == v22.* ]] \
  || fail "V2-10D review recovery requires Node 22.x"
[[ "$(uname -s)" == "Darwin" ]] \
  || fail "V2-10D review recovery is restricted to the macOS OrbStack contour"
[[ "$(orb status)" == "Running" ]] \
  || fail "OrbStack must report Running before V2-10D review recovery"
[[ "$(docker context show)" == "orbstack" ]] \
  || fail "Docker context must be exactly orbstack before V2-10D review recovery"

cd "$repo_root"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "V2-10D review recovery requires a clean exact-main worktree"
git fetch --quiet origin main
head_sha="$(git rev-parse HEAD)"
origin_main_sha="$(git rev-parse refs/remotes/origin/main)"
[[ "$head_sha" == "$origin_main_sha" && "$head_sha" == "$expected_main_sha" ]] \
  || fail "HEAD, freshly fetched origin/main and the recovery SHA must match exactly"
git merge-base --is-ancestor "$head_sha" "$origin_main_sha" \
  || fail "The supplied recovery SHA is not current origin/main"
git cat-file -e "${original_attempt_sha}^{commit}" \
  || fail "The preserved attempt commit is unavailable"
git merge-base --is-ancestor "$original_attempt_sha" "$head_sha" \
  || fail "Current main does not descend from the preserved attempt"
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
  scripts/prepare-connected-amocrm-validation.mjs \
  tests/e2e/canonical-v2-10d-real-acceptance.spec.ts; do
  [[ -e "$required_path" ]] \
    || fail "Required local dependency or V2-10D recovery file is missing: $required_path"
done

evidence_root="$repo_root/output/provider-acceptance/v2-10d"
evidence_dir="$evidence_root/$original_attempt_sha"
authority_marker="$evidence_dir/authority-blocked.json"
review_marker="$evidence_dir/review-required.json"
dispatch_marker="$evidence_dir/dispatch-attempt.json"
success_marker="$evidence_dir/success.json"
[[ -f "$authority_marker" && -f "$review_marker" ]] \
  || fail "The preserved disabled-authority and review markers are required"
[[ ! -e "$dispatch_marker" \
  && ! -e "$success_marker" \
  && ! -e "$evidence_dir/review-rejected.json" \
  && ! -e "$evidence_dir/proposal-error.json" ]] \
  || fail "The preserved attempt is no longer at the pre-dispatch review boundary"

tmp_root="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
[[ -n "$preserved_tmp_dir" && -d "$preserved_tmp_dir" && ! -L "$preserved_tmp_dir" ]] \
  || fail "EVO_V2_10D_PRESERVED_TMP_DIR must be the preserved private directory"
preserved_tmp_dir="$(cd "$preserved_tmp_dir" && pwd -P)"
[[ "$(dirname "$preserved_tmp_dir")" == "$tmp_root" ]] \
  || fail "The preserved directory is outside the process temporary root"
[[ "$(basename "$preserved_tmp_dir")" == evo-v2-10d.* ]] \
  || fail "The preserved directory name is outside the V2-10D contour"
[[ "$(stat -f '%Lp' "$preserved_tmp_dir")" == "700" ]] \
  || fail "The preserved directory must have exact mode 0700"
[[ "$(stat -f '%Su' "$preserved_tmp_dir")" == "$(id -un)" ]] \
  || fail "The preserved directory must be owned by the current operator"
if find "$preserved_tmp_dir" -mindepth 1 -perm -077 -print -quit | grep -q .; then
  fail "The preserved recovery state exposes group or other permissions"
fi

compose_env_file="$preserved_tmp_dir/postgres.env"
runtime_file="$preserved_tmp_dir/amocrm-runtime.json"
context_file="$preserved_tmp_dir/acceptance-context.json"
private_document_root="$preserved_tmp_dir/private-documents"
for private_file in "$compose_env_file" "$runtime_file" "$context_file"; do
  [[ -f "$private_file" && ! -L "$private_file" ]] \
    || fail "A required preserved private file is missing"
  [[ "$(stat -f '%Lp' "$private_file")" == "600" ]] \
    || fail "Every required preserved private file must have exact mode 0600"
done
mkdir -p "$private_document_root"
chmod 700 "$private_document_root"

read -r postgres_user postgres_password postgres_database postgres_port <<<"$(
  EVO_V2_PRIVATE_POSTGRES_ENV_FILE="$compose_env_file" \
    "$node_bin" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";

const text = readFileSync(process.env.EVO_V2_PRIVATE_POSTGRES_ENV_FILE, "utf8");
const values = new Map();
for (const line of text.split(/\r?\n/u)) {
  if (!line) continue;
  const match = /^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|POSTGRES_PORT)=([^\r\n]+)$/u.exec(line);
  if (!match || values.has(match[1])) process.exit(1);
  values.set(match[1], match[2]);
}
if (
  values.size !== 4 ||
  values.get("POSTGRES_USER") !== "evo_v2_10d" ||
  values.get("POSTGRES_DB") !== "evo_v2_10d" ||
  !/^[0-9a-f]{48}$/u.test(values.get("POSTGRES_PASSWORD") ?? "") ||
  !/^[1-9][0-9]{3,4}$/u.test(values.get("POSTGRES_PORT") ?? "")
) process.exit(1);
process.stdout.write([
  values.get("POSTGRES_USER"),
  values.get("POSTGRES_PASSWORD"),
  values.get("POSTGRES_DB"),
  values.get("POSTGRES_PORT"),
].join(" "));
EOF
)" || fail "The preserved PostgreSQL environment is invalid"
database_url="postgresql://${postgres_user}:${postgres_password}@127.0.0.1:${postgres_port}/${postgres_database}"

compose_args=(
  --project-name "$project_name"
  --env-file "$compose_env_file"
  --file "$repo_root/docker-compose.local.yml"
)
postgres_container_id="$(docker compose "${compose_args[@]}" ps --all --quiet postgres)"
[[ -n "$postgres_container_id" && "$postgres_container_id" != *$'\n'* ]] \
  || fail "The exact preserved PostgreSQL container is unavailable"
[[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$postgres_container_id")" == "$project_name" ]] \
  || fail "The preserved PostgreSQL container belongs to another Compose project"
volume_name="${project_name}_postgres-local-data"
docker volume inspect "$volume_name" >/dev/null \
  || fail "The exact preserved PostgreSQL volume is unavailable"
[[ "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$postgres_container_id")" == "$volume_name" ]] \
  || fail "The preserved PostgreSQL container is not attached to its exact data volume"

run_tmp_dir="$(mktemp -d "$tmp_root/evo-v2-10d-recovery.XXXXXX")"
provider_bundle_file="$run_tmp_dir/provider.bundle"
session_response_file="$run_tmp_dir/waha-session.json"
ssh_probe_log="$preserved_tmp_dir/recovery-ssh-probe.log"
tunnel_log="$preserved_tmp_dir/recovery-ssh-tunnel.log"
app_log="$preserved_tmp_dir/recovery-app.log"
browser_log="$preserved_tmp_dir/recovery-playwright.log"
app_pid=""
tunnel_pid=""
compose_started=0
run_succeeded=0
waha_api_key=""
waha_session_name=""
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
  unset waha_api_key waha_session_name self_id self_lid postgres_password database_url
  if (( compose_started == 1 )); then
    if (( run_succeeded == 1 )); then
      docker compose "${compose_args[@]}" down --volumes --remove-orphans \
        >/dev/null 2>&1 || true
    else
      docker compose "${compose_args[@]}" stop postgres >/dev/null 2>&1 || true
    fi
  fi
  if [[ -d "$run_tmp_dir" && "$run_tmp_dir" == "$tmp_root/evo-v2-10d-recovery."* ]]; then
    rm -R -- "$run_tmp_dir"
  fi
  if (( run_succeeded == 1 )); then
    if [[ -d "$preserved_tmp_dir" && "$preserved_tmp_dir" == "$tmp_root/evo-v2-10d."* ]]; then
      rm -R -- "$preserved_tmp_dir"
    fi
  else
    chmod -R go-rwx "$preserved_tmp_dir" >/dev/null 2>&1 || true
    printf 'V2-10D review recovery stopped. Protected state remains at %s (Compose project: %s)\n' \
      "$preserved_tmp_dir" "$project_name" >&2
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

decode_base64() {
  EVO_V2_ENCODED_VALUE="$1" "$node_bin" --input-type=module <<'EOF'
const encoded = process.env.EVO_V2_ENCODED_VALUE ?? "";
if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) process.exit(1);
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
    kill -0 "$pid" >/dev/null 2>&1 || fail "$label exited before it became reachable"
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "$url" || true)"
    [[ "$status" =~ ^[234][0-9][0-9]$ ]] && return 0
    sleep 1
  done
  fail "$label did not become reachable within 120 seconds"
}

app_port="$(free_port)"
tunnel_port="$(free_port)"
gate_session_secret="$(openssl rand -hex 32)"
gate_admin_identifier="admin-v2-10d-recovery-$RANDOM"
gate_admin_secret="$(openssl rand -hex 32)"
gate_sales_identifier="sales-v2-10d-recovery-$RANDOM"
gate_sales_secret="$(openssl rand -hex 32)"
gate_admissions_identifier="admissions-v2-10d-recovery-$RANDOM"
gate_admissions_secret="$(openssl rand -hex 32)"
inbound_secret="$(openssl rand -hex 32)"

if ! ssh -T -o BatchMode=yes -o ConnectTimeout=15 "$ssh_host" 'bash -s' \
  >"$provider_bundle_file" 2>"$ssh_probe_log" <<'REMOTE'
set -euo pipefail
umask 077
env_file="/opt/evo-crm/.env.lead-agent"
container_name="evo-crm-waha-1"
[[ -r "$env_file" ]]
declare -A env_values=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
  key="${BASH_REMATCH[2]}"
  case "$key" in
    EVO_AGENT_WAHA_API_KEY|EVO_AGENT_WAHA_SESSION) ;;
    *) continue ;;
  esac
  [[ -z "${env_values[$key]+present}" ]] || exit 1
  raw_value="${BASH_REMATCH[3]}"
  raw_value="${raw_value#"${raw_value%%[![:space:]]*}"}"
  raw_value="${raw_value%"${raw_value##*[![:space:]]}"}"
  [[ -n "$raw_value" ]] || exit 1
  first_character="${raw_value:0:1}"
  last_character="${raw_value: -1}"
  if [[ "$first_character" == "'" || "$first_character" == '"' ]]; then
    [[ ${#raw_value} -ge 2 && "$last_character" == "$first_character" ]] || exit 1
    raw_value="${raw_value:1:${#raw_value}-2}"
  elif [[ "$raw_value" == *"'"* || "$raw_value" == *'"'* ]]; then
    exit 1
  fi
  [[ -n "$raw_value" && ${#raw_value} -le 4096 ]] || exit 1
  env_values["$key"]="$raw_value"
done <"$env_file"
for required_key in EVO_AGENT_WAHA_API_KEY EVO_AGENT_WAHA_SESSION; do
  [[ -n "${env_values[$required_key]+present}" ]] || exit 1
done
[[ "${env_values[EVO_AGENT_WAHA_SESSION]}" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]]
container_id="$(docker ps --filter "name=^/${container_name}$" --format '{{.ID}}')"
[[ -n "$container_id" && "$container_id" != *$'\n'* ]]
[[ "$(docker inspect --format '{{.State.Running}}' "$container_id")" == "true" ]]
container_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' "$container_id" | awk 'NF { print; exit }')"
[[ -n "$container_ip" ]]
encode_line() { printf '%s' "$1" | base64 | tr -d '\n'; printf '\n'; }
encode_line "${env_values[EVO_AGENT_WAHA_API_KEY]}"
encode_line "${env_values[EVO_AGENT_WAHA_SESSION]}"
encode_line "$container_ip"
REMOTE
then
  fail "Could not retrieve the existing private WAHA connection metadata on hermes-vps"
fi
chmod 600 "$provider_bundle_file" "$ssh_probe_log"

exec 3<"$provider_bundle_file"
IFS= read -r encoded_waha_api_key <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_waha_session <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r encoded_container_ip <&3 || fail "The protected provider bundle is incomplete"
IFS= read -r unexpected_bundle_line <&3 && fail "The protected provider bundle contains unexpected data"
exec 3<&-
waha_api_key="$(decode_base64 "$encoded_waha_api_key")" || fail "The protected WAHA credential is invalid"
waha_session_name="$(decode_base64 "$encoded_waha_session")" || fail "The protected WAHA session name is invalid"
container_ip="$(decode_base64 "$encoded_container_ip")" || fail "The protected WAHA address is invalid"
unset encoded_waha_api_key encoded_waha_session encoded_container_ip unexpected_bundle_line
rm -f -- "$provider_bundle_file"

"$node_bin" scripts/prepare-connected-amocrm-validation.mjs validate-private-ipv4 \
  --value "$container_ip" || fail "The connected WAHA address was not an exact private IPv4 address"
ssh -o BatchMode=yes -o ConnectTimeout=15 -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -N \
  -L "127.0.0.1:${tunnel_port}:${container_ip}:3000" \
  "$ssh_host" >"$tunnel_log" 2>&1 &
tunnel_pid=$!
chmod 600 "$tunnel_log"
wait_for_local_http "http://127.0.0.1:${tunnel_port}/" "$tunnel_pid" "The private WAHA tunnel"

docker compose "${compose_args[@]}" up --detach postgres >/dev/null
compose_started=1
health_deadline=$((SECONDS + 120))
postgres_status=""
while (( SECONDS < health_deadline )); do
  postgres_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$postgres_container_id" 2>/dev/null || true)"
  [[ "$postgres_status" == "healthy" ]] && break
  sleep 2
done
[[ "$postgres_status" == "healthy" ]] || fail "The preserved PostgreSQL container did not become healthy"

EVO_V2_PRIVATE_WAHA_BASE_URL="http://127.0.0.1:${tunnel_port}" \
EVO_V2_PRIVATE_WAHA_API_KEY="$waha_api_key" \
EVO_V2_PRIVATE_WAHA_SESSION="$waha_session_name" \
EVO_V2_PRIVATE_WAHA_SESSION_FILE="$session_response_file" \
  "$node_bin" --input-type=module <<'EOF' || fail "The connected WAHA self identifiers could not be read privately"
import { chmod, writeFile } from "node:fs/promises";
const response = await fetch(
  `${process.env.EVO_V2_PRIVATE_WAHA_BASE_URL}/api/sessions/${encodeURIComponent(process.env.EVO_V2_PRIVATE_WAHA_SESSION ?? "")}`,
  { headers: { Accept: "application/json", "X-Api-Key": process.env.EVO_V2_PRIVATE_WAHA_API_KEY ?? "" }, redirect: "error", signal: AbortSignal.timeout(5_000) },
);
if (!response.ok) process.exit(1);
const body = await response.text();
if (Buffer.byteLength(body, "utf8") > 64 * 1024) process.exit(1);
await writeFile(process.env.EVO_V2_PRIVATE_WAHA_SESSION_FILE, body, { mode: 0o600 });
await chmod(process.env.EVO_V2_PRIVATE_WAHA_SESSION_FILE, 0o600);
EOF

read -r self_id self_lid <<<"$(
  EVO_V2_PRIVATE_WAHA_SESSION_FILE="$session_response_file" "$node_bin" --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
let session;
try { session = JSON.parse(readFileSync(process.env.EVO_V2_PRIVATE_WAHA_SESSION_FILE, "utf8")); } catch { process.exit(1); }
const direct = /^[1-9][0-9]{4,31}@(c[.]us|lid)$/u;
if (session?.status !== "WORKING") process.exit(1);
const identities = [session?.me?.id, session?.me?.lid]
  .filter((value) => typeof value === "string" && direct.test(value))
  .filter((value, index, values) => values.indexOf(value) === index);
const phones = identities.filter((value) => value.endsWith("@c.us"));
const lids = identities.filter((value) => value.endsWith("@lid"));
if (phones.length !== 1 || lids.length > 1) process.exit(1);
process.stdout.write(`${phones[0]} ${lids[0] ?? ""}`);
EOF
)" || fail "The connected WAHA self identities are invalid"
[[ "$self_id" =~ ^[1-9][0-9]{4,31}@c[.]us$ ]] || fail "The connected WAHA self identity is invalid"
[[ -z "$self_lid" || "$self_lid" =~ ^[1-9][0-9]{4,31}@lid$ ]] || fail "The connected WAHA self LID is invalid"

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
  "$node_bin" scripts/prepare-connected-amocrm-validation.mjs run-app \
    --runtime-file "$runtime_file" \
    --context-file "$context_file" \
    --provider-authorized 1 \
    -- \
    "$node_bin" node_modules/next/dist/bin/next dev \
      --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
app_pid=$!
chmod 600 "$app_log"
wait_for_local_http "http://127.0.0.1:${app_port}/api/health" "$app_pid" "The private V2 application"

PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
DATABASE_URL="$database_url" \
EVO_V2_REAL_END_TO_END_ACCEPTANCE=1 \
EVO_V2_REAL_END_TO_END_MODE=recovery \
EVO_V2_ACCEPTANCE_MAIN_SHA="$head_sha" \
EVO_V2_10D_ORIGINAL_ATTEMPT_SHA="$original_attempt_sha" \
EVO_V2_10D_EVIDENCE_DIR="$evidence_dir" \
EVO_V2_AMOCRM_PRIVATE_RUNTIME_FILE="$runtime_file" \
EVO_V2_AMOCRM_PRIVATE_CONTEXT_FILE="$context_file" \
EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET="$inbound_secret" \
EVO_DEV_GATE_ADMIN_IDENTIFIER="$gate_admin_identifier" \
EVO_DEV_GATE_ADMIN_SECRET="$gate_admin_secret" \
EVO_V2_REAL_END_TO_END_PROJECT=desktop-chromium \
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
    --output="$run_tmp_dir/playwright-results" >"$browser_log" 2>&1 \
  || fail "The V2-10D review recovery stopped; inspect protected diagnostics before any continuation"
chmod 600 "$browser_log"

for required_marker in "$authority_marker" "$review_marker" "$dispatch_marker" "$success_marker"; do
  [[ -f "$required_marker" ]] || fail "Recovery did not produce every required durable marker"
  chmod 600 "$required_marker"
done

EVO_V2_10D_EVIDENCE_DIR="$evidence_dir" \
EVO_V2_ORIGINAL_ATTEMPT_SHA="$original_attempt_sha" \
EVO_V2_RECOVERY_MAIN_SHA="$head_sha" \
  "$node_bin" --input-type=module <<'EOF' || fail "The recovered V2-10D evidence is invalid"
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const directory = process.env.EVO_V2_10D_EVIDENCE_DIR;
const attemptSha = process.env.EVO_V2_ORIGINAL_ATTEMPT_SHA;
const recoverySha = process.env.EVO_V2_RECOVERY_MAIN_SHA;
const names = ["authority-blocked.json", "review-required.json", "dispatch-attempt.json", "success.json"];
const records = Object.fromEntries(await Promise.all(names.map(async (name) => [name, JSON.parse(await readFile(join(directory, name), "utf8"))])));
const assert = (condition) => { if (!condition) throw new Error("redacted_v2_10d_recovery_evidence_invalid"); };
for (const record of Object.values(records)) assert(record && typeof record === "object" && record.gitSha === attemptSha);
const authority = records["authority-blocked.json"];
const review = records["review-required.json"];
const dispatch = records["dispatch-attempt.json"];
const success = records["success.json"];
assert(authority.status === "passed" && authority.checks?.fallbackObserved === false);
assert(review.status === "review_required" && review.proposal?.proposalCount === 1);
assert(review.providerMutation?.wahaSendAttemptCount === 0);
assert(review.providerMutation?.amocrmProviderAttemptCount === 0);
assert(dispatch.status === "dispatch_intent_recorded");
assert(dispatch.recovery?.occurred === true && dispatch.recovery?.codeSha === recoverySha);
assert(success.status === "passed" && success.recovery?.occurred === true && success.recovery?.codeSha === recoverySha);
assert(success.review?.decision === "accepted" || success.review?.decision === "edited");
assert(success.review?.proposalCount === 1 && success.review?.humanActionObserved === true);
assert(success.waha?.attemptCount === 1 && success.waha?.outboundMessageCount === 1 && success.waha?.exactReadback === true);
assert(success.amocrm?.attemptCount === 7 && success.amocrm?.receiptCount === 7);
assert(success.amocrm?.contactBindingCount === 1 && success.amocrm?.leadBindingCount === 1);
assert(success.amocrm?.validationContactCount === 1 && success.amocrm?.validationLeadCount === 1 && success.amocrm?.validationNoteCount === 1);
assert(success.amocrm?.exactReadback === true);
assert(success.replay?.messageDelta === 0 && success.replay?.providerAttemptDelta === 0);
assert(success.replay?.receiptDelta === 0 && success.replay?.bindingDelta === 0 && success.replay?.businessEventDelta === 0);
assert(success.replay?.providerEntitySetUnchanged === true);
assert(success.boundaries?.database === "disposable_local_postgresql");
assert(success.boundaries?.target === "connected_waha_session_self_validation_entity");
assert(success.boundaries?.v1ApplicationPathExecuted === false && success.boundaries?.deploymentMutated === false && success.boundaries?.fallbackObserved === false);
const forbiddenKey = /^(?:access_?token|refresh_?token|client_?secret|api_?key|phone(?:e164)?|recipient(?:_?id)?|self_?id|provider_?(?:message|contact|lead|note|pipeline|status|user)_?id|message_?text|proposal_?text|raw_?payload)$/iu;
const forbiddenValue = /(?:@(?:c[.]us|lid)|\+[1-9][0-9]{6,14}|bearer\s+[a-z0-9._-]{12,})/iu;
const inspect = (value) => {
  if (Array.isArray(value)) return value.forEach(inspect);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) { assert(!forbiddenKey.test(key)); inspect(child); }
  } else if (typeof value === "string") assert(!forbiddenValue.test(value));
};
for (const record of Object.values(records)) inspect(record);
EOF

run_succeeded=1
printf 'V2-10D preserved review recovery passed at exact main SHA %s. Sanitized evidence: %s\n' \
  "$head_sha" "$success_marker"
