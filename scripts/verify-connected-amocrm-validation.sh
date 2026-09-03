#!/usr/bin/env bash
set -euo pipefail

umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-node}"
expected_main_sha="${1:-${EVO_V2_EXPECTED_MAIN_SHA:-}}"
provider_env_file="${EVO_V2_AMOCRM_PROVIDER_ENV_FILE:-}"
token_file="${EVO_V2_AMOCRM_TOKEN_FILE:-}"
ssh_host="hermes-vps"
container_name="evo-crm-waha-1"
tmp_root="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
tmp_dir="$(mktemp -d "$tmp_root/evo-v2-real-amocrm.XXXXXX")"
supabase_env_file="$tmp_dir/supabase.env"
supabase_log="$tmp_dir/supabase.log"
staff_log="$tmp_dir/staff.log"
ssh_probe_log="$tmp_dir/ssh-probe.log"
tunnel_log="$tmp_dir/ssh-tunnel.log"
app_log="$tmp_dir/app.log"
blocked_log="$tmp_dir/playwright-blocked.log"
dispatch_log="$tmp_dir/playwright-dispatch.log"
runtime_file="$tmp_dir/runtime.json"
self_file="$tmp_dir/self.json"
context_file="$tmp_dir/context.json"
run_succeeded=0
app_pid=""
tunnel_pid=""

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
  local primary_name="$1"
  local fallback_name="${2:-}"
  local line=""
  local value=""

  line="$(rg -m 1 "^${primary_name}=" "$supabase_env_file" || true)"
  if [[ -z "$line" && -n "$fallback_name" ]]; then
    line="$(rg -m 1 "^${fallback_name}=" "$supabase_env_file" || true)"
  fi
  [[ -n "$line" ]] \
    || fail "Local Supabase status did not provide ${primary_name}"
  value="${line#*=}"
  value="${value#\"}"
  value="${value%\"}"
  [[ -n "$value" ]] \
    || fail "Local Supabase status provided an empty ${primary_name}"
  printf '%s' "$value"
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

  if (( run_succeeded == 1 )); then
    rm -R -- "$tmp_dir"
  else
    chmod -R go-rwx "$tmp_dir" >/dev/null 2>&1 || true
    printf 'Connected amoCRM acceptance stopped. Protected diagnostics were preserved at %s\n' \
      "$tmp_dir" >&2
  fi

  return "$exit_status"
}
trap cleanup EXIT

if [[ "${-}" == *x* ]]; then
  fail "Shell xtrace must be disabled for connected amoCRM acceptance"
fi

if [[ "${EVO_V2_REAL_AMOCRM_ACCEPTANCE:-0}" == "1" ]]; then
  :
else
  fail "Connected amoCRM acceptance requires EVO_V2_REAL_AMOCRM_ACCEPTANCE=1"
fi

if [[ "$($node_bin --version)" != v22.* ]]; then
  fail "Connected amoCRM acceptance requires Node 22.x"
fi

[[ -n "$expected_main_sha" && "$expected_main_sha" =~ ^[0-9a-f]{40}$ ]] \
  || fail "Provide the exact expected main commit SHA as argv[1] or EVO_V2_EXPECTED_MAIN_SHA"
[[ -n "$provider_env_file" ]] \
  || fail "Provide the private legacy provider env file via EVO_V2_AMOCRM_PROVIDER_ENV_FILE"
[[ -n "$token_file" ]] \
  || fail "Provide the private token file via EVO_V2_AMOCRM_TOKEN_FILE"
for variable_name in \
  NEXT_PUBLIC_SUPABASE_URL \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  EVO_PLATFORM_SUPABASE_SECRET_KEY; do
  require_env "$variable_name"
done

git fetch --quiet origin main
head_sha="$(git rev-parse HEAD)"
origin_main_sha="$(git rev-parse origin/main)"
git_status="$(git status --porcelain=v1 --untracked-files=all)"

[[ -z "$git_status" ]] \
  || fail "Connected amoCRM acceptance requires a clean exact-main worktree"
[[ "$origin_main_sha" == "$expected_main_sha" ]] \
  || fail "origin/main no longer matches the expected main SHA"
[[ "$head_sha" == "$origin_main_sha" ]] \
  || fail "Checkout exact origin/main before running connected amoCRM acceptance"

[[ "$(orb status)" == "Running" ]] \
  || fail "OrbStack must report Running before local connected acceptance"
[[ "$(docker context show)" == "orbstack" ]] \
  || fail "docker context must be exactly orbstack before local connected acceptance"

app_port="$(free_port)"
tunnel_port="$(free_port)"
evidence_dir="$repo_root/output/provider-acceptance/amocrm/$expected_main_sha"

mkdir -p "$evidence_dir"
chmod 700 "$evidence_dir"

if ! npx --no-install supabase status -o env \
  >"$supabase_env_file" 2>"$supabase_log"; then
  fail "The running local Supabase stack did not expose its configuration"
fi
chmod 600 "$supabase_env_file" "$supabase_log"

supabase_api_url="$(read_supabase_env_value API_URL)"
supabase_publishable_key="$(read_supabase_env_value PUBLISHABLE_KEY ANON_KEY)"
supabase_secret_key="$(read_supabase_env_value SECRET_KEY SERVICE_ROLE_KEY)"
supabase_database_url="$(read_supabase_env_value DB_URL)"
[[ "$supabase_api_url" == http://127.0.0.1:* || "$supabase_api_url" == http://localhost:* ]] \
  || fail "The local Supabase API is not loopback-only"
[[ "$supabase_database_url" == postgresql://*@127.0.0.1:*/* || "$supabase_database_url" == postgresql://*@localhost:*/* ]] \
  || fail "The local Supabase database is not loopback-only"
[[ "$supabase_api_url" == "$NEXT_PUBLIC_SUPABASE_URL" ]] \
  || fail "The application URL does not match the running local Supabase stack"
[[ "$supabase_publishable_key" == "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" ]] \
  || fail "The application publishable key does not match the running local Supabase stack"
[[ "$supabase_secret_key" == "$EVO_PLATFORM_SUPABASE_SECRET_KEY" ]] \
  || fail "The application server key does not match the running local Supabase stack"

staff_admin_password="$(openssl rand -hex 24)"
if ! staff_admin_email="$(
  EVO_V2_SUPABASE_DATABASE_URL="$supabase_database_url" \
  NEXT_PUBLIC_SUPABASE_URL="$supabase_api_url" \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$supabase_publishable_key" \
  EVO_PLATFORM_SUPABASE_SECRET_KEY="$supabase_secret_key" \
  EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
  "$node_bin" scripts/prepare-connected-amocrm-validation.mjs prepare-admin \
  2>"$staff_log"
)"; then
  chmod 600 "$staff_log"
  fail "Existing local Supabase Admin preparation failed"
fi
chmod 600 "$staff_log"
[[ "$staff_admin_email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] \
  || fail "Existing local Supabase Admin preparation returned no exact email"

assert_app_reachable() {
  local deadline=$((SECONDS + 120))
  local code=""
  while (( SECONDS < deadline )); do
    if [[ -n "$app_pid" ]] && ! kill -0 "$app_pid" >/dev/null 2>&1; then
      sed -n '1,200p' "$app_log" >&2 || true
      fail "The application exited before browser validation"
    fi
    code="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${app_port}/api/health" || true)"
    [[ "$code" == "200" ]] && return
    sleep 2
  done
  sed -n '1,200p' "$app_log" >&2 || true
  fail "The application became unreachable before browser validation"
}

start_app() {
  local provider_authorized="$1"
  : >"$app_log"
  NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
    EVO_PLATFORM_SUPABASE_SECRET_KEY="$EVO_PLATFORM_SUPABASE_SECRET_KEY" \
    "$node_bin" scripts/prepare-connected-amocrm-validation.mjs run-app \
      --runtime-file "$runtime_file" \
      --context-file "$context_file" \
      --provider-authorized "$provider_authorized" \
      -- \
      "$node_bin" node_modules/next/dist/bin/next dev \
        --hostname 127.0.0.1 --port "$app_port" >"$app_log" 2>&1 &
  app_pid=$!
  assert_app_reachable
}

stop_app() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
    app_pid=""
  fi
}

"$node_bin" scripts/prepare-connected-amocrm-validation.mjs map \
  --provider-env "$provider_env_file" \
  --token-file "$token_file" \
  --runtime-file "$runtime_file"

if ! ssh -o BatchMode=yes \
  -o ConnectTimeout=15 \
  "$ssh_host" \
  "container_id=\$(docker ps --filter \"name=^/${container_name}\$\" --format '{{.ID}}'); \
  [[ -n \"\$container_id\" ]]; \
  docker inspect --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' \
    \"\$container_id\" | awk 'NF { print; exit }'" \
  >"$ssh_probe_log" 2>"$tunnel_log"
then
  fail "Could not resolve the connected WAHA container address on hermes-vps"
fi
container_ip="$(awk 'NF { print; exit }' "$ssh_probe_log")"
[[ -n "$container_ip" ]] || fail "The connected WAHA container address was empty"
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

tunnel_deadline=$((SECONDS + 30))
tunnel_code=""
while (( SECONDS < tunnel_deadline )); do
  [[ -n "$tunnel_pid" ]] && ! kill -0 "$tunnel_pid" >/dev/null 2>&1 \
    && fail "The private WAHA SSH tunnel exited before validation"
  tunnel_code="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    "http://127.0.0.1:${tunnel_port}/" || true)"
  [[ "$tunnel_code" != "000" ]] && break
  sleep 1
done
[[ "$tunnel_code" != "000" ]] || fail "The private WAHA SSH tunnel never became reachable"

"$node_bin" scripts/prepare-connected-amocrm-validation.mjs read-waha-self \
  --runtime-file "$runtime_file" \
  --base-url "http://127.0.0.1:${tunnel_port}/" \
  --self-file "$self_file"

EVO_V2_SUPABASE_DATABASE_URL="$supabase_database_url" \
  EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
  "$node_bin" --conditions=react-server --experimental-strip-types \
    scripts/prepare-connected-amocrm-validation.mjs seed \
    --self-file "$self_file" \
    --context-file "$context_file"

start_app 0
PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
  EVO_V2_SUPABASE_DATABASE_URL="$supabase_database_url" \
  EVO_V2_REAL_AMOCRM_ACCEPTANCE=1 \
  EVO_V2_CONNECTED_AMOCRM_MODE=blocked \
  EVO_V2_ACCEPTANCE_MAIN_SHA="$expected_main_sha" \
  EVO_V2_AMOCRM_EVIDENCE_DIR="$evidence_dir" \
  EVO_V2_AMOCRM_PRIVATE_RUNTIME_FILE="$runtime_file" \
  EVO_V2_AMOCRM_PRIVATE_CONTEXT_FILE="$context_file" \
  EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
  EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
  "$node_bin" node_modules/@playwright/test/cli.js test \
    tests/e2e/canonical-amocrm-connected-provider.spec.ts \
    --config=playwright.config.ts \
    --project=desktop-chromium \
    --workers=1 \
    --reporter=line >"$blocked_log" 2>&1 || {
      sed -n '1,240p' "$blocked_log" >&2 || true
      fail "The blocked-authority amoCRM browser validation failed"
    }
stop_app

"$node_bin" scripts/prepare-connected-amocrm-validation.mjs mark-attempt \
  --kind provider-preparation-attempt \
  --git-sha "$expected_main_sha" \
  --output "$evidence_dir/provider-preparation-attempt.json"

"$node_bin" --conditions=react-server --experimental-strip-types \
    scripts/prepare-connected-amocrm-validation.mjs discover \
    --runtime-file "$runtime_file" \
    --context-file "$context_file"

start_app 1
PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
  EVO_V2_SUPABASE_DATABASE_URL="$supabase_database_url" \
  EVO_V2_REAL_AMOCRM_ACCEPTANCE=1 \
  EVO_V2_CONNECTED_AMOCRM_MODE=dispatch \
  EVO_V2_ACCEPTANCE_MAIN_SHA="$expected_main_sha" \
  EVO_V2_AMOCRM_EVIDENCE_DIR="$evidence_dir" \
  EVO_V2_AMOCRM_PRIVATE_RUNTIME_FILE="$runtime_file" \
  EVO_V2_AMOCRM_PRIVATE_CONTEXT_FILE="$context_file" \
  EVO_STAFF_AUTH_ADMIN_EMAIL="$staff_admin_email" \
  EVO_STAFF_AUTH_ADMIN_PASSWORD="$staff_admin_password" \
  "$node_bin" node_modules/@playwright/test/cli.js test \
    tests/e2e/canonical-amocrm-connected-provider.spec.ts \
    --config=playwright.config.ts \
    --project=desktop-chromium \
    --workers=1 \
    --reporter=line >"$dispatch_log" 2>&1 || {
      sed -n '1,260p' "$dispatch_log" >&2 || true
      fail "The connected amoCRM dispatch validation failed"
    }
stop_app

[[ -f "$evidence_dir/authority-blocked.json" ]] \
  || fail "The connected amoCRM run did not produce authority-blocked.json"
[[ -f "$evidence_dir/provider-preparation-attempt.json" ]] \
  || fail "The connected amoCRM run did not produce provider-preparation-attempt.json"
[[ -f "$evidence_dir/dispatch-attempt.json" ]] \
  || fail "The connected amoCRM run did not produce dispatch-attempt.json"
[[ -f "$evidence_dir/success.json" ]] \
  || fail "The connected amoCRM run did not produce success.json"

EVO_V2_AMOCRM_EVIDENCE_DIR="$evidence_dir" \
  EVO_V2_ACCEPTANCE_MAIN_SHA="$expected_main_sha" \
  "$node_bin" --input-type=module <<'EOF' \
  || fail "The connected amoCRM evidence did not prove the exact redacted acceptance boundary"
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const evidenceDir = process.env.EVO_V2_AMOCRM_EVIDENCE_DIR;
const expectedSha = process.env.EVO_V2_ACCEPTANCE_MAIN_SHA;
const fileNames = [
  "authority-blocked.json",
  "provider-preparation-attempt.json",
  "dispatch-attempt.json",
  "success.json",
];
const evidence = Object.fromEntries(
  await Promise.all(
    fileNames.map(async (fileName) => [
      fileName,
      JSON.parse(await readFile(join(evidenceDir, fileName), "utf8")),
    ]),
  ),
);
const blocked = evidence["authority-blocked.json"];
const preparation = evidence["provider-preparation-attempt.json"];
const dispatch = evidence["dispatch-attempt.json"];
const success = evidence["success.json"];
const assert = (condition) => {
  if (!condition) throw new Error("redacted_acceptance_evidence_invalid");
};

for (const marker of Object.values(evidence)) {
  assert(marker && typeof marker === "object" && marker.gitSha === expectedSha);
}
assert(blocked.status === "passed" && blocked.checks?.providerAttemptCount === 0);
assert(blocked.checks?.bindingCount === 0 && blocked.checks?.fallbackObserved === false);
assert(preparation.status === "started" && dispatch.status === "started");
assert(dispatch.action === "one_explicit_admin_sync");
assert(success.status === "passed" && success.action === "one_explicit_admin_sync");
assert(success.provider?.exactReadback === true);
assert(success.provider?.validationContactCount === 1);
assert(success.provider?.validationLeadCount === 1);
assert(success.provider?.validationNoteCount === 1);
assert(success.database?.attemptCount === 8 && success.database?.receiptCount === 8);
assert(success.database?.provenanceCount === 1);
assert(success.database?.exactUiReplay === true);
assert(success.database?.replayAddedAttemptCount === 0);
assert(success.database?.replayAddedReceiptCount === 0);
assert(success.database?.replayAddedBindingCount === 0);
assert(success.database?.replayProviderEntitySetUnchanged === true);
assert(success.database?.persistedAfterReload === true);
assert(success.boundaries?.v1ApplicationPathExecuted === false);
assert(success.boundaries?.existingWahaSessionReadOnly === true);
assert(success.boundaries?.database === "local_supabase_postgresql");
assert(success.boundaries?.deploymentMutated === false);
assert(success.boundaries?.fallbackObserved === false);

const forbiddenKey = /^(?:access_?token|refresh_?token|client_?secret|api_?key|phone|contact_?id|lead_?id|note_?id|pipeline_?id|status_?id|responsible_?user_?id)$/iu;
const inspect = (value) => {
  if (Array.isArray(value)) return value.forEach(inspect);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!forbiddenKey.test(key));
    inspect(child);
  }
};
for (const marker of Object.values(evidence)) inspect(marker);
EOF

run_succeeded=1
printf 'Connected amoCRM acceptance passed at %s\n' "$evidence_dir"
