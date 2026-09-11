#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() {
  echo "$1" >&2
  exit 1
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${EVO_NODE_BIN:-$(command -v node || true)}"
npx_bin=""
tmp_dir=""
project_root=""
project_id=""
app_pid=""
app_root=""
evidence_root=""
stack_owned=0

cleanup() {
  local original_status="$?"
  local cleanup_status=0
  trap - EXIT INT TERM
  set +e

  if [[ -n "$app_pid" && "$app_pid" =~ ^[0-9]+$ ]]; then
    kill "$app_pid" >/dev/null 2>&1
    wait "$app_pid" >/dev/null 2>&1
    app_pid=""
  fi

  if [[ "$stack_owned" == "1" && -n "$project_id" && -n "$project_root" ]]; then
    "$npx_bin" --no-install supabase stop \
      --workdir "$project_root" \
      --project-id "$project_id" \
      --no-backup \
      >>"${supabase_log:-/dev/null}" 2>&1 || cleanup_status=1

    local remaining_containers=""
    remaining_containers="$(
      docker ps -a --format '{{.Names}}' 2>/dev/null \
        | grep -E "^supabase_[a-z0-9_-]+_${project_id}$" || true
    )"
    if [[ -n "$remaining_containers" ]]; then
      echo "Owned E4 Supabase containers remained after cleanup." >&2
      cleanup_status=1
    fi
  fi

  if [[ -n "$tmp_dir" && -d "$tmp_dir" ]]; then
    if [[ "$tmp_dir" == "${TMPDIR:-/tmp}/evo-e4-student-portal."* ]]; then
      rm -R -- "$tmp_dir" || cleanup_status=1
    else
      echo "Refusing to remove unexpected E4 scratch path: $tmp_dir" >&2
      cleanup_status=1
    fi
  fi

  if [[ "$original_status" == "0" && "$cleanup_status" != "0" ]]; then
    exit "$cleanup_status"
  fi
  exit "$original_status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

[[ -n "$node_bin" && -x "$node_bin" ]] \
  || fail "Node 22 is required via EVO_NODE_BIN or PATH"
[[ "$("$node_bin" --version)" == v22.* ]] \
  || fail "The E4 Student Portal browser gate requires Node 22.x"
npx_bin="$(dirname "$node_bin")/npx"
[[ -x "$npx_bin" ]] || fail "The Node 22 npx binary is unavailable"
[[ -x "$repo_root/node_modules/.bin/playwright" ]] \
  || fail "Dependencies are missing; run Node 22 npm ci --ignore-scripts first"

if [[ "$(uname -s)" == "Darwin" ]]; then
  [[ "$(orb status)" == "Running" ]] || fail "OrbStack must be Running"
  [[ "$(docker context show)" == "orbstack" ]] \
    || fail "Docker context must be exactly orbstack"
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-e4-student-portal.XXXXXX")"
project_root="$tmp_dir/project"
app_root="$tmp_dir/app"
evidence_root="$(mktemp -d "${TMPDIR:-/tmp}/evo-e4-student-portal-evidence.XXXXXX")"
supabase_log="$tmp_dir/supabase.log"
supabase_env_file="$tmp_dir/supabase.env"
provision_log="$tmp_dir/provision.log"
provision_result="$tmp_dir/provision-result.json"
second_provision_log="$tmp_dir/second-provision.log"
second_provision_result="$tmp_dir/second-provision-result.json"
app_log="$tmp_dir/app.log"
browser_log="$evidence_root/browser.log"
mkdir -p "$project_root/supabase" "$app_root/tests/e2e" "$evidence_root/screenshots"
chmod 700 "$tmp_dir" "$project_root" "$project_root/supabase" "$app_root" "$evidence_root" "$evidence_root/screenshots"
: >"$supabase_log"
: >"$provision_log"
: >"$app_log"
: >"$second_provision_log"
: >"$browser_log"
chmod 600 "$supabase_log" "$provision_log" "$second_provision_log" "$app_log" "$browser_log"

# Never share .next or load a checkout's .env files while another preview runs.
cp -R "$repo_root/src" "$repo_root/public" "$app_root/"
for config_file in package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs; do
  cp "$repo_root/$config_file" "$app_root/$config_file"
done
cp "$repo_root/tests/e2e/student-portal.spec.ts" \
  "$repo_root/tests/e2e/student-assessments.spec.ts" \
  "$repo_root/tests/e2e/playwright.student-portal.config.ts" "$app_root/tests/e2e/"
if [[ "$(uname -s)" == "Darwin" ]]; then
  cp -cR "$repo_root/node_modules" "$app_root/node_modules"
else
  cp -R "$repo_root/node_modules" "$app_root/node_modules"
fi
echo "E4_STUDENT_PORTAL_PRIVATE_EVIDENCE $evidence_root"

project_id="evo-e4-$RANDOM-$$-$(openssl rand -hex 4)"
[[ "$project_id" =~ ^evo-e4-[0-9]+-[0-9]+-[0-9a-f]{8}$ ]] \
  || fail "Unable to create a safe isolated Supabase project id"

read -r api_port db_port shadow_port studio_port mailpit_port smtp_port \
  pop3_port inspector_port analytics_port pooler_port app_port <<<"$(
  "$node_bin" --input-type=module <<'EOF'
import { createServer } from "node:net";

const servers = [];
const ports = [];
for (let index = 0; index < 11; index += 1) {
  const server = createServer();
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("free port unavailable");
  ports.push(address.port);
}
for (const server of servers) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log(ports.join(" "));
EOF
)"

for port in "$api_port" "$db_port" "$shadow_port" "$studio_port" \
  "$mailpit_port" "$smtp_port" "$pop3_port" "$inspector_port" \
  "$analytics_port" "$pooler_port" "$app_port"; do
  [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1024 && "$port" -le 65535 ]] \
    || fail "Unable to reserve an isolated loopback port"
done

EVO_E4_CONFIG_SOURCE="$repo_root/supabase/config.toml" \
EVO_E4_CONFIG_TARGET="$project_root/supabase/config.toml" \
EVO_E4_PROJECT_ID="$project_id" \
EVO_E4_API_PORT="$api_port" \
EVO_E4_DB_PORT="$db_port" \
EVO_E4_SHADOW_PORT="$shadow_port" \
EVO_E4_STUDIO_PORT="$studio_port" \
EVO_E4_MAILPIT_PORT="$mailpit_port" \
EVO_E4_SMTP_PORT="$smtp_port" \
EVO_E4_POP3_PORT="$pop3_port" \
EVO_E4_INSPECTOR_PORT="$inspector_port" \
EVO_E4_ANALYTICS_PORT="$analytics_port" \
EVO_E4_POOLER_PORT="$pooler_port" \
EVO_E4_APP_PORT="$app_port" \
  "$node_bin" --input-type=module <<'EOF'
import { readFile, writeFile } from "node:fs/promises";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const source = required("EVO_E4_CONFIG_SOURCE");
const target = required("EVO_E4_CONFIG_TARGET");
let config = await readFile(source, "utf8");
const replacements = [
  ['project_id = "evo-platform-local"', `project_id = "${required("EVO_E4_PROJECT_ID")}"`],
  ["port = 45421", `port = ${required("EVO_E4_API_PORT")}`],
  ["port = 45422", `port = ${required("EVO_E4_DB_PORT")}`],
  ["shadow_port = 45420", `shadow_port = ${required("EVO_E4_SHADOW_PORT")}`],
  ["port = 45423", `port = ${required("EVO_E4_STUDIO_PORT")}`],
  ["port = 45424", `port = ${required("EVO_E4_MAILPIT_PORT")}`],
  ["smtp_port = 45425", `smtp_port = ${required("EVO_E4_SMTP_PORT")}`],
  ["pop3_port = 45426", `pop3_port = ${required("EVO_E4_POP3_PORT")}`],
  ["inspector_port = 45428", `inspector_port = ${required("EVO_E4_INSPECTOR_PORT")}`],
  ["port = 45427", `port = ${required("EVO_E4_ANALYTICS_PORT")}`],
  ["port = 45429", `port = ${required("EVO_E4_POOLER_PORT")}`],
  ['site_url = "http://127.0.0.1:3000"', `site_url = "http://127.0.0.1:${required("EVO_E4_APP_PORT")}"`],
  ['additional_redirect_urls = ["http://127.0.0.1:3000/auth/callback"]', `additional_redirect_urls = ["http://127.0.0.1:${required("EVO_E4_APP_PORT")}/auth/callback"]`],
];
for (const [before, after] of replacements) {
  const occurrences = config.split(before).length - 1;
  if (occurrences !== 1) throw new Error(`config contract drifted for ${before}`);
  config = config.replace(before, after);
}
await writeFile(target, config, { mode: 0o600 });
EOF

ln -s "$repo_root/supabase/migrations" "$project_root/supabase/migrations"
ln -s "$repo_root/supabase/templates" "$project_root/supabase/templates"

stack_owned=1
if ! "$npx_bin" --no-install supabase start \
  --workdir "$project_root" --yes >"$supabase_log" 2>&1; then
  fail "The isolated E4 Supabase stack did not start; inspect the private harness log"
fi
if ! "$npx_bin" --no-install supabase status \
  --workdir "$project_root" -o env >"$supabase_env_file" 2>>"$supabase_log"; then
  fail "The isolated E4 Supabase stack did not expose local configuration"
fi
chmod 600 "$supabase_env_file"

read_supabase_env() {
  local name="$1"
  local line=""
  local value=""
  line="$(grep -m 1 -E "^${name}=" "$supabase_env_file" || true)"
  [[ -n "$line" ]] || fail "Local Supabase status omitted ${name}"
  value="${line#*=}"
  value="${value#\"}"
  value="${value%\"}"
  [[ -n "$value" ]] || fail "Local Supabase status returned empty ${name}"
  printf '%s' "$value"
}

supabase_api_url="$(read_supabase_env API_URL)"
supabase_publishable_key="$(read_supabase_env PUBLISHABLE_KEY)"
supabase_service_role_key="$(read_supabase_env SERVICE_ROLE_KEY)"
supabase_database_url="$(read_supabase_env DB_URL)"
[[ "$supabase_api_url" == "http://127.0.0.1:${api_port}" ]] \
  || fail "The E4 Supabase API escaped its reserved loopback port"
[[ "$supabase_database_url" == postgresql://*@127.0.0.1:"${db_port}"/* ]] \
  || fail "The E4 database escaped its reserved loopback port"
[[ ${#supabase_publishable_key} -ge 16 && ${#supabase_service_role_key} -ge 16 ]] \
  || fail "The E4 Supabase stack returned malformed API keys"

if ! EVO_E4_DB_URL="$supabase_database_url" \
  EVO_E4_MIGRATIONS_DIR="$repo_root/supabase/migrations" \
  "$node_bin" --input-type=module >>"$supabase_log" 2>&1 <<'EOF'
import { readdir } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.EVO_E4_DB_URL;
const migrationsDirectory = process.env.EVO_E4_MIGRATIONS_DIR;
if (!databaseUrl || !migrationsDirectory) throw new Error("ledger input missing");

const expectedVersions = (await readdir(migrationsDirectory))
  .map((name) => /^(\d+)_.*\.sql$/u.exec(name)?.[1] ?? null)
  .filter((version) => version !== null)
  .sort();
if (expectedVersions.length === 0 || !["136", "152", "153"].every(version => expectedVersions.includes(version))) {
  throw new Error("repository migration inventory omits current Portal prerequisites");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const rows = await sql`
    SELECT version::TEXT AS version
    FROM supabase_migrations.schema_migrations
    ORDER BY version
  `;
  const appliedVersions = rows.map(({ version }) => version);
  if (JSON.stringify(appliedVersions) !== JSON.stringify(expectedVersions)) {
    throw new Error("local migration ledger does not match repository migrations");
  }
} finally {
  await sql.end({ timeout: 5 });
}
EOF
then
  fail "The isolated E4 database did not apply the exact repository migration ledger including 153"
fi

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
  fail "The isolated E4 Supabase Auth Admin API did not become ready"
fi

identity_suffix="$RANDOM-$$-$(openssl rand -hex 4)"
admin_email="admin-${identity_suffix}@e4.local.test"
student_email="student-${identity_suffix}@e4.local.test"
admin_password="$(openssl rand -hex 24)"
student_password="$(openssl rand -hex 24)"
second_admin_email="admin-second-${identity_suffix}@e4.local.test"
second_student_email="student-second-${identity_suffix}@e4.local.test"
second_admin_password="$(openssl rand -hex 24)"
second_student_password="$(openssl rand -hex 24)"

if ! EVO_E4_SUPABASE_URL="$supabase_api_url" \
  EVO_E4_REVIEW_UI_FIXTURE=1 \
  EVO_E4_SUPABASE_SERVICE_ROLE_KEY="$supabase_service_role_key" \
  EVO_E4_SUPABASE_DB_URL="$supabase_database_url" \
  EVO_E4_ADMIN_EMAIL="$admin_email" \
  EVO_E4_ADMIN_PASSWORD="$admin_password" \
  EVO_E4_STUDENT_EMAIL="$student_email" \
  EVO_E4_STUDENT_PASSWORD="$student_password" \
  EVO_E4_PROVISION_RESULT="$provision_result" \
  "$node_bin" scripts/provision-local-student-portal-browser.mjs \
    >"$provision_log" 2>&1; then
  provision_error="$(grep -m 1 -E '^LOCAL_STUDENT_PORTAL_BROWSER_ERROR:[A-Z0-9_]+$' "$provision_log" || true)"
  [[ -z "$provision_error" ]] || echo "$provision_error" >&2
  fail "The isolated E4 Student Portal fixture could not be provisioned"
fi
provision_marker="$(grep -m 1 -E '^LOCAL_STUDENT_PORTAL_BROWSER_PROVISIONED [0-9a-f-]{36} [0-9a-f-]{36} [0-9a-f-]{36}$' "$provision_log" || true)"
[[ -n "$provision_marker" ]] \
  || fail "The E4 Student Portal provisioner returned no success marker"
read -r _ organization_id student_membership_id notification_id <<<"$provision_marker"
student_case_id="$("$node_bin" --input-type=module -e 'import { readFile } from "node:fs/promises"; const value = JSON.parse(await readFile(process.argv[1], "utf8")).caseId; if (typeof value !== "string") process.exit(1); process.stdout.write(value);' "$provision_result")"
for value in "$organization_id" "$student_membership_id" "$notification_id" "$student_case_id"; do
  [[ "$value" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
    || fail "The E4 Student Portal provisioner returned an invalid UUID"
done

# A second invocation creates another real Auth identity and a separate private
# organization. Both are preactivated local fixtures, never normal invite proof.
if ! EVO_E4_SUPABASE_URL="$supabase_api_url" \
  EVO_E4_SUPABASE_SERVICE_ROLE_KEY="$supabase_service_role_key" \
  EVO_E4_SUPABASE_DB_URL="$supabase_database_url" \
  EVO_E4_ADMIN_EMAIL="$second_admin_email" \
  EVO_E4_ADMIN_PASSWORD="$second_admin_password" \
  EVO_E4_STUDENT_EMAIL="$second_student_email" \
  EVO_E4_STUDENT_PASSWORD="$second_student_password" \
  EVO_E4_PROVISION_RESULT="$second_provision_result" \
  "$node_bin" scripts/provision-local-student-portal-browser.mjs \
    >"$second_provision_log" 2>&1; then
  fail "The isolated second Student fixture could not be provisioned"
fi
second_marker="$(grep -m 1 -E '^LOCAL_STUDENT_PORTAL_BROWSER_PROVISIONED [0-9a-f-]{36} [0-9a-f-]{36} [0-9a-f-]{36}$' "$second_provision_log" || true)"
[[ -n "$second_marker" ]] || fail "The second fixture returned no success marker"
read -r _ second_organization_id second_membership_id second_notification_id <<<"$second_marker"
[[ "$second_organization_id" != "$organization_id" && "$second_membership_id" != "$student_membership_id" ]] \
  || fail "The second Student fixture did not isolate its authority"
for sensitive_value in "$supabase_service_role_key" "$supabase_database_url" \
  "$admin_email" "$admin_password" "$student_email" "$student_password" \
  "$second_admin_email" "$second_admin_password" "$second_student_email" "$second_student_password"; do
  if grep -F "$sensitive_value" "$provision_log" "$second_provision_log" >/dev/null; then
    fail "The E4 Student Portal provisioner exposed a credential"
  fi
done

run_isolated_app() (
  cd "$app_root"
  exec env -u EVO_PLATFORM_GEMINI_API_KEY \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SUPABASE_URL="$supabase_api_url" \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$supabase_publishable_key" \
    EVO_PLATFORM_SUPABASE_SECRET_KEY="$supabase_service_role_key" \
    SUPABASE_SERVICE_ROLE_KEY="$supabase_service_role_key" \
    EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS=3600 \
    HOSTNAME=127.0.0.1 PORT="$app_port" \
    "$node_bin" "$@"
)

# Match the deployed standalone server. A development overlay can intercept
# real controls and change mobile geometry, so it is not an acceptance target.
if ! run_isolated_app node_modules/next/dist/bin/next build >"$app_log" 2>&1; then
  fail "The isolated E4 production build failed; inspect the private application log"
fi
cp -R "$app_root/public" "$app_root/.next/standalone/public"
cp -R "$app_root/.next/static" "$app_root/.next/standalone/.next/static"
echo "E4_STUDENT_PORTAL_PRODUCTION_BUILD_VERIFIED"
run_isolated_app .next/standalone/server.js >>"$app_log" 2>&1 &
app_pid=$!

app_deadline=$((SECONDS + 180))
while (( SECONDS < app_deadline )); do
  if ! kill -0 "$app_pid" >/dev/null 2>&1; then
    fail "The E4 application exited before browser validation"
  fi
  health_code="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    "http://127.0.0.1:${app_port}/api/health" || true)"
  [[ "$health_code" == "200" ]] && break
  sleep 1
done
[[ "${health_code:-}" == "200" ]] || {
  fail "The E4 application did not become reachable"
}

echo "E4_STUDENT_PORTAL_LOCAL_ORIGIN http://127.0.0.1:${app_port}"
browser_status=0
(
cd "$app_root"
PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
EVO_STUDENT_PORTAL_SCREENSHOT_DIR="$evidence_root/screenshots" \
EVO_STUDENT_PORTAL_ADMIN_EMAIL="$admin_email" \
EVO_STUDENT_PORTAL_ADMIN_PASSWORD="$admin_password" \
EVO_STUDENT_PORTAL_STUDENT_EMAIL="$student_email" \
EVO_STUDENT_PORTAL_STUDENT_PASSWORD="$student_password" \
EVO_STUDENT_PORTAL_STUDENT_SECOND_EMAIL="$second_student_email" \
EVO_STUDENT_PORTAL_STUDENT_SECOND_PASSWORD="$second_student_password" \
EVO_STUDENT_PORTAL_NOTIFICATION_ID="$notification_id" \
EVO_STUDENT_PORTAL_CASE_ID="$student_case_id" \
EVO_STUDENT_PORTAL_DB_URL="$supabase_database_url" \
EVO_STUDENT_PORTAL_SUPABASE_URL="$supabase_api_url" \
EVO_STUDENT_PORTAL_SUPABASE_PUBLISHABLE_KEY="$supabase_publishable_key" \
  "$node_bin" node_modules/@playwright/test/cli.js test \
    --config=tests/e2e/playwright.student-portal.config.ts --reporter=list
) >"$browser_log" 2>&1 || browser_status=$?

for sensitive_value in "$supabase_service_role_key" "$supabase_database_url" \
  "$admin_password" "$student_password" "$second_admin_password" "$second_student_password"; do
  if grep -F "$sensitive_value" "$app_log" "$browser_log" >/dev/null; then
    rm -f -- "$browser_log"
    fail "The E4 application log exposed a credential"
  fi
done
cat "$browser_log"
[[ "$browser_status" == "0" ]] || exit "$browser_status"

echo "E4_STUDENT_PORTAL_MIGRATION_LEDGER_VERIFIED_EXACT_REPOSITORY_INCLUDING_153" | tee -a "$browser_log"
echo "E4_STUDENT_PORTAL_FIXTURE_MODE preactivated_synthetic_real_auth_db_two_organizations_not_invite_proof" | tee -a "$browser_log"
echo "E4_STUDENT_PORTAL_BROWSER_VERIFIED" | tee -a "$browser_log"
