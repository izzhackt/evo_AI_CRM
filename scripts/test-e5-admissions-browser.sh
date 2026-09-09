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
      echo "Owned E5 Supabase containers remained after cleanup." >&2
      cleanup_status=1
    fi
  fi

  if [[ -n "$tmp_dir" && -d "$tmp_dir" ]]; then
    if [[ "$tmp_dir" == "${TMPDIR:-/tmp}/evo-e5-admissions."* ]]; then
      rm -R -- "$tmp_dir" || cleanup_status=1
    else
      echo "Refusing to remove unexpected E5 scratch path: $tmp_dir" >&2
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
  || fail "The E5 Admissions browser gate requires Node 22.x"
npx_bin="$(dirname "$node_bin")/npx"
[[ -x "$npx_bin" ]] || fail "The Node 22 npx binary is unavailable"
[[ -x "$repo_root/node_modules/.bin/playwright" ]] \
  || fail "Dependencies are missing; run Node 22 npm ci --ignore-scripts first"

if [[ "$(uname -s)" == "Darwin" ]]; then
  [[ "$(orb status)" == "Running" ]] || fail "OrbStack must be Running"
  [[ "$(docker context show)" == "orbstack" ]] \
    || fail "Docker context must be exactly orbstack"
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-e5-admissions.XXXXXX")"
project_root="$tmp_dir/project"
app_root="$tmp_dir/app"
evidence_root="$(mktemp -d "${TMPDIR:-/tmp}/evo-e5-admissions-evidence.XXXXXX")"
supabase_log="$tmp_dir/supabase.log"
supabase_env_file="$tmp_dir/supabase.env"
provision_log="$tmp_dir/provision.log"
provision_result="$tmp_dir/provision-result.json"
second_provision_log="$tmp_dir/second-provision.log"
second_provision_result="$tmp_dir/second-provision-result.json"
app_log="$tmp_dir/app.log"
browser_log="$evidence_root/browser.log"
mkdir -p "$project_root/supabase" "$app_root/tests/e2e" "$app_root/scripts" "$app_root/supabase/tests/fixtures" "$evidence_root/screenshots"
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
cp "$repo_root/tests/e2e/admissions.spec.ts" \
  "$repo_root/tests/e2e/playwright.admissions.config.ts" "$app_root/tests/e2e/"
cp "$repo_root/scripts/test-e5-admissions-browser.sh" \
  "$repo_root/scripts/provision-local-student-portal-browser.mjs" \
  "$repo_root/scripts/supabase-auth-readiness.mjs" "$app_root/scripts/"
cp "$repo_root/supabase/tests/fixtures/e5_admissions_browser.sql" "$app_root/supabase/tests/fixtures/"
cp "$repo_root/supabase/config.toml" "$app_root/supabase/config.toml"
if [[ "$(uname -s)" == "Darwin" ]]; then
  cp -cR "$repo_root/node_modules" "$app_root/node_modules"
else
  cp -R "$repo_root/node_modules" "$app_root/node_modules"
fi
echo "E5_ADMISSIONS_PRIVATE_EVIDENCE $evidence_root"

project_id="evo-e5-$RANDOM-$$-$(openssl rand -hex 4)"
[[ "$project_id" =~ ^evo-e5-[0-9]+-[0-9]+-[0-9a-f]{8}$ ]] \
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

EVO_E4_CONFIG_SOURCE="$app_root/supabase/config.toml" \
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

cp -R "$repo_root/supabase/migrations" "$project_root/supabase/migrations"
ln -s "$repo_root/supabase/templates" "$project_root/supabase/templates"

# Bind evidence to the copied source, not to a later checkout HEAD.
EVO_E5_SOURCE_HEAD="$(git -C "$repo_root" rev-parse HEAD)" \
EVO_E5_APP_COPY="$app_root" EVO_E5_MIGRATIONS_COPY="$project_root/supabase/migrations" \
EVO_E5_SOURCE_MANIFEST="$evidence_root/source-manifest.json" \
  "$node_bin" --input-type=module <<'EOF'
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const files = {};
async function visit(root, relative, prefix = "") {
  const path = join(root, relative);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const next = join(relative, entry.name);
    if (entry.isDirectory()) await visit(root, next, prefix);
    else if (entry.isFile()) files[prefix + next] = createHash("sha256").update(await readFile(join(root, next))).digest("hex");
  }
}
for (const dir of ["src", "public", "tests/e2e", "scripts", "supabase"]) await visit(process.env.EVO_E5_APP_COPY, dir);
for (const name of ["package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"])
  files[name] = createHash("sha256").update(await readFile(join(process.env.EVO_E5_APP_COPY, name))).digest("hex");
await visit(process.env.EVO_E5_MIGRATIONS_COPY, "", "supabase/migrations/");
const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
const digest = createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
await writeFile(process.env.EVO_E5_SOURCE_MANIFEST, JSON.stringify({ head: process.env.EVO_E5_SOURCE_HEAD, digest, files: ordered }, null, 2) + "\n", { mode: 0o600 });
console.log("E5_ADMISSIONS_COPIED_SOURCE", process.env.EVO_E5_SOURCE_HEAD, digest);
EOF

stack_owned=1
if ! "$npx_bin" --no-install supabase start \
  --workdir "$project_root" --yes >"$supabase_log" 2>&1; then
  fail "The isolated E5 Supabase stack did not start; inspect the private harness log"
fi
if ! "$npx_bin" --no-install supabase status \
  --workdir "$project_root" -o env >"$supabase_env_file" 2>>"$supabase_log"; then
  fail "The isolated E5 Supabase stack did not expose local configuration"
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
  || fail "The E5 Supabase API escaped its reserved loopback port"
[[ "$supabase_database_url" == postgresql://*@127.0.0.1:"${db_port}"/* ]] \
  || fail "The E5 database escaped its reserved loopback port"
[[ ${#supabase_publishable_key} -ge 16 && ${#supabase_service_role_key} -ge 16 ]] \
  || fail "The E5 Supabase stack returned malformed API keys"

if ! EVO_E4_DB_URL="$supabase_database_url" \
  EVO_E4_MIGRATIONS_DIR="$project_root/supabase/migrations" \
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
if (expectedVersions.length === 0 || !expectedVersions.includes("138")) {
  throw new Error("repository migration inventory omits the Admissions content");
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
  fail "The isolated E5 database did not apply the exact repository migration ledger including 138"
fi

if ! API_URL="$supabase_api_url" SERVICE_ROLE_KEY="$supabase_service_role_key" \
  EVO_E5_READINESS_MODULE="$app_root/scripts/supabase-auth-readiness.mjs" \
  "$node_bin" --input-type=module >>"$supabase_log" 2>&1 <<'EOF'
const { waitForLocalSupabaseAuthAdmin } = await import(process.env.EVO_E5_READINESS_MODULE);
await waitForLocalSupabaseAuthAdmin({
  apiUrl: process.env.API_URL,
  serviceRoleKey: process.env.SERVICE_ROLE_KEY,
  maxAttempts: 1200,
  readinessTimeoutMs: 300000,
});
EOF
then
  fail "The isolated E5 Supabase Auth Admin API did not become ready"
fi

identity_suffix="$RANDOM-$$-$(openssl rand -hex 4)"
admin_email="admin-${identity_suffix}@e5.local.test"
student_email="student-${identity_suffix}@e5.local.test"
admin_password="$(openssl rand -hex 24)"
student_password="$(openssl rand -hex 24)"
curator_password="$(openssl rand -hex 24)"
sales_password="$(openssl rand -hex 24)"
fixture_result="$tmp_dir/admissions-fixture.json"
second_admin_email="admin-second-${identity_suffix}@e5.local.test"
second_student_email="student-second-${identity_suffix}@e5.local.test"
second_admin_password="$(openssl rand -hex 24)"
second_student_password="$(openssl rand -hex 24)"

if ! EVO_E4_SUPABASE_URL="$supabase_api_url" \
  EVO_E4_SUPABASE_SERVICE_ROLE_KEY="$supabase_service_role_key" \
  EVO_E4_SUPABASE_DB_URL="$supabase_database_url" \
  EVO_E4_ADMIN_EMAIL="$admin_email" \
  EVO_E4_ADMIN_PASSWORD="$admin_password" \
  EVO_E4_STUDENT_EMAIL="$student_email" \
  EVO_E4_STUDENT_PASSWORD="$student_password" \
  EVO_E4_PROVISION_RESULT="$provision_result" \
  "$node_bin" "$app_root/scripts/provision-local-student-portal-browser.mjs" \
    >"$provision_log" 2>&1; then
  provision_error="$(grep -m 1 -E '^LOCAL_STUDENT_PORTAL_BROWSER_ERROR:[A-Z0-9_]+$' "$provision_log" || true)"
  [[ -z "$provision_error" ]] || echo "$provision_error" >&2
  fail "The isolated E5 Admissions fixture could not be provisioned"
fi
provision_marker="$(grep -m 1 -E '^LOCAL_STUDENT_PORTAL_BROWSER_PROVISIONED [0-9a-f-]{36} [0-9a-f-]{36} [0-9a-f-]{36}$' "$provision_log" || true)"
[[ -n "$provision_marker" ]] \
  || fail "The E5 Admissions provisioner returned no success marker"
read -r _ organization_id student_membership_id notification_id <<<"$provision_marker"
for value in "$organization_id" "$student_membership_id" "$notification_id"; do
  [[ "$value" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
    || fail "The E5 Admissions provisioner returned an invalid UUID"
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
  "$node_bin" "$app_root/scripts/provision-local-student-portal-browser.mjs" \
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
    fail "The E5 Admissions provisioner exposed a credential"
  fi
done


# Bootstrap only fictional upstream clients/leads. All gate/handoff writes use
# real signed Auth sessions and existing RPCs; no handoff snapshots or replica.
if ! EVO_E5_DB_URL="$supabase_database_url" \
  EVO_E5_URL="$supabase_api_url" EVO_E5_KEY="$supabase_publishable_key" \
  EVO_E5_SERVICE_KEY="$supabase_service_role_key" EVO_E5_ORG="$organization_id" \
  EVO_E5_ADMIN_EMAIL="$admin_email" EVO_E5_ADMIN_PASSWORD="$admin_password" \
  EVO_E5_CURATOR_PASSWORD="$curator_password" EVO_E5_SALES_PASSWORD="$sales_password" \
  EVO_E5_FIXTURE_SQL="$app_root/supabase/tests/fixtures/e5_admissions_browser.sql" \
  EVO_E5_FIXTURE_RESULT="$fixture_result" \
  "$node_bin" --input-type=module >>"$provision_log" 2>&1 <<'EOF'
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
const env = (name) => { if (!process.env[name]) throw new Error(name + "_MISSING"); return process.env[name]; };
const org = env("EVO_E5_ORG");
const sql = postgres(env("EVO_E5_DB_URL"), { max: 1, prepare: false });
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const service = createClient(env("EVO_E5_URL"), env("EVO_E5_SERVICE_KEY"), options);
try {
  const actors = await sql.unsafe(
    "SELECT m.id,m.current_role::text AS role,u.id AS auth_id,u.email FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id JOIN auth.users u ON u.id=p.auth_user_id WHERE m.organization_id=$1 AND m.current_role IN ('sales','curator') AND m.status='active'",[org]);
  if (actors.length !== 2) throw new Error("E5_ACTOR_COUNT");
  const curator = actors.find((actor) => actor.role === "curator");
  const sales = actors.find((actor) => actor.role === "sales");
  for (const actor of [curator,sales]) {
    if (!actor || !actor.email.endsWith("@e4.local.test")) throw new Error("E5_FICTIONAL_ACTOR_SCOPE");
    const result = await service.auth.admin.updateUserById(actor.auth_id, {
      password: env(actor.role === "curator" ? "EVO_E5_CURATOR_PASSWORD" : "EVO_E5_SALES_PASSWORD"),
    });
    if (result.error) throw new Error("E5_FICTIONAL_AUTH_SETUP");
  }
  await sql.begin(async (tx) => {
    await tx.unsafe("SELECT set_config('e5.organization',$1,true),set_config('e5.sales',$2,true)",[org,sales.id]);
    await tx.unsafe(await readFile(env("EVO_E5_FIXTURE_SQL"),"utf8"));
  });
  const adminClient = createClient(env("EVO_E5_URL"),env("EVO_E5_KEY"),options);
  const salesClient = createClient(env("EVO_E5_URL"),env("EVO_E5_KEY"),options);
  for (const [client,email,password] of [
    [adminClient,env("EVO_E5_ADMIN_EMAIL"),env("EVO_E5_ADMIN_PASSWORD")],
    [salesClient,sales.email,env("EVO_E5_SALES_PASSWORD")],
  ]) {
    const result = await client.auth.signInWithPassword({ email,password });
    if (result.error || !result.data.session) throw new Error("E5_REAL_AUTH_LOGIN");
  }
  async function rpc(client,name,args) {
    const {data,error} = await client.schema("platform").rpc(name,args);
    if(error) throw new Error("E5_RPC_" + name + "_" + error.code);
    return data;
  }
  const [admin] = await sql.unsafe("SELECT m.id FROM platform.organization_memberships m WHERE m.organization_id=$1 AND m.current_role='admin' AND m.status='active'",[org]);
  if (!admin) throw new Error("E5_ADMIN_MEMBERSHIP_MISSING");
  // Sensitive evidence confirmation is an individual grant, not an implicit
  // Admin privilege. Exercise the existing Admin grant RPC, then refresh Auth.
  for (const permission of ["contract.evidence.confirm", "finance.first.payment.confirm"]) {
    await rpc(adminClient,"change_membership_permission", {
      p_organization_id:org,p_membership_id:admin.id,p_permission_key:permission,
      p_granted:true,p_reason:"E5 explicit fictional evidence-confirmation authority",p_request_id:randomUUID(),
    });
    const refreshed = await adminClient.auth.signInWithPassword({email:env("EVO_E5_ADMIN_EMAIL"),password:env("EVO_E5_ADMIN_PASSWORD")});
    if(refreshed.error || !refreshed.data.session) throw new Error("E5_ADMIN_AUTH_REFRESH");
  }
  // Staff sign-in requires an organization scope as well as case assignments.
  // The E4 Student-only seed omits it for unused Sales/Curator identities.
  for (const staff of [sales,curator]) await rpc(adminClient,"assign_organization_scope", {
    p_organization_id:org,p_membership_id:staff.id,
    p_reason:"E5 fictional staff sign-in authority",p_request_id:randomUUID(),
  });
  const refreshedSales = await salesClient.auth.signInWithPassword({email:sales.email,password:env("EVO_E5_SALES_PASSWORD")});
  if(refreshedSales.error || !refreshedSales.data.session) throw new Error("E5_SALES_AUTH_REFRESH");
  const today = new Date().toISOString().slice(0,10);
  const leads = await sql.unsafe("SELECT id,source_key FROM platform.leads WHERE organization_id=$1 AND source_key LIKE 'e5-browser.%' ORDER BY source_key",[org]);
  const cases = {};
  for (const lead of leads) {
    const params = {p_lead_id:lead.id,p_request_id:randomUUID(),p_expected_gate_version:1,
      p_action:"confirm_contract",p_amount:1,p_currency:"USD",p_due_date:today,
      p_received_date:null,p_evidence_reference:"E5 FICTIONAL contract, not real money",p_reason:"Isolated browser QA"};
    await rpc(adminClient,"mutate_lead_admissions_gate",params);
    await rpc(adminClient,"mutate_lead_admissions_gate",{...params,p_request_id:randomUUID(),
      p_expected_gate_version:2,p_action:"confirm_first_payment",p_amount:null,p_currency:null,
      p_due_date:null,p_received_date:today,p_evidence_reference:"E5 FICTIONAL receipt, no payment rail"});
    const handoff = await rpc(salesClient,"handoff_lead_to_admissions",{
      p_lead_id:lead.id,p_expected_gate_version:3,p_admissions_owner_membership_id:curator.id,
      p_handoff_mode:"normal",p_reason:"E5 real RPC fictional Sales handoff",p_request_id:randomUUID(),
    });
    if (!handoff?.case_id) throw new Error("E5_HANDOFF_CASE_MISSING");
    const [proof] = await sql.unsafe("SELECT count(*)::int AS count FROM platform.sales_admissions_handoffs WHERE organization_id=$1 AND lead_id=$2 AND student_case_id=$3",[org,lead.id,handoff.case_id]);
    if(proof.count!==1) throw new Error("E5_HANDOFF_COUNT");
    cases[lead.source_key.slice("e5-browser.".length)] = {caseId:handoff.case_id,leadId:lead.id};
  }
  if(Object.keys(cases).length!==6) throw new Error("E5_CASE_COUNT");
  await writeFile(env("EVO_E5_FIXTURE_RESULT"),JSON.stringify({
    organizationId:org,curatorEmail:curator.email,curatorMembershipId:curator.id,cases,
  }),{mode:0o600});
  console.log("E5_REAL_AUTH_SALES_HANDOFF_FIXTURE_VERIFIED 6");
} catch (error) {
  if (typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)) {
    console.error("Error: E5_BOOTSTRAP_DATABASE_" + error.code);
    // These database errors refer only to fictional fixture SQL. Keep a
    // restricted diagnostic without query parameters or stack/connection data.
    await writeFile(env("EVO_E5_FIXTURE_RESULT") + ".error.json", JSON.stringify({ code: error.code, message: error.message, constraint: error.constraint_name }), { mode: 0o600 });
  }
  throw error;
} finally { await sql.end({timeout:5}); }
EOF
then
  fixture_error="$(grep -m 1 -E '^Error: E5_[A-Za-z0-9_]+$' "$provision_log" || true)"
  [[ -z "$fixture_error" ]] || echo "$fixture_error" >&2
  [[ ! -f "$fixture_result.error.json" ]] || cp "$fixture_result.error.json" "$evidence_root/fixture-error.json"
  fail "The E5 real Sales handoff fixture failed; scratch credentials will be removed"
fi

(
cd "$app_root"
exec env -u EVO_PLATFORM_GEMINI_API_KEY \
  NEXT_PUBLIC_SUPABASE_URL="$supabase_api_url" \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$supabase_publishable_key" \
  EVO_PLATFORM_SUPABASE_SECRET_KEY="$supabase_service_role_key" \
  SUPABASE_SERVICE_ROLE_KEY="$supabase_service_role_key" \
  EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS=3600 \
  "$node_bin" node_modules/next/dist/bin/next dev \
    --hostname 127.0.0.1 --port "$app_port"
) >"$app_log" 2>&1 &
app_pid=$!

app_deadline=$((SECONDS + 180))
while (( SECONDS < app_deadline )); do
  if ! kill -0 "$app_pid" >/dev/null 2>&1; then
    fail "The E5 application exited before browser validation"
  fi
  health_code="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    "http://127.0.0.1:${app_port}/api/health" || true)"
  [[ "$health_code" == "200" ]] && break
  sleep 1
done
[[ "${health_code:-}" == "200" ]] || {
  fail "The E5 application did not become reachable"
}

echo "E5_ADMISSIONS_LOCAL_ORIGIN http://127.0.0.1:${app_port}"
browser_status=0
(
cd "$app_root"
PLAYWRIGHT_BASE_URL="http://127.0.0.1:${app_port}" \
EVO_ADMISSIONS_SCREENSHOT_DIR="$evidence_root/screenshots" \
EVO_ADMISSIONS_FIXTURE_PATH="$fixture_result" \
EVO_ADMISSIONS_CURATOR_PASSWORD="$curator_password" \
EVO_ADMISSIONS_ADMIN_EMAIL="$admin_email" \
EVO_ADMISSIONS_ADMIN_PASSWORD="$admin_password" \
EVO_ADMISSIONS_STUDENT_EMAIL="$student_email" \
EVO_ADMISSIONS_STUDENT_PASSWORD="$student_password" \
EVO_ADMISSIONS_STUDENT_SECOND_EMAIL="$second_student_email" \
EVO_ADMISSIONS_STUDENT_SECOND_PASSWORD="$second_student_password" \
EVO_ADMISSIONS_NOTIFICATION_ID="$notification_id" \
EVO_ADMISSIONS_DB_URL="$supabase_database_url" \
EVO_ADMISSIONS_SUPABASE_URL="$supabase_api_url" \
EVO_ADMISSIONS_SUPABASE_PUBLISHABLE_KEY="$supabase_publishable_key" \
  "$node_bin" node_modules/@playwright/test/cli.js test \
    --config=tests/e2e/playwright.admissions.config.ts --reporter=list
) >"$browser_log" 2>&1 || browser_status=$?

for sensitive_value in "$supabase_service_role_key" "$supabase_database_url" \
  "$admin_password" "$student_password" "$curator_password" "$sales_password" "$second_admin_password" "$second_student_password"; do
  if grep -F "$sensitive_value" "$app_log" "$browser_log" >/dev/null; then
    rm -f -- "$browser_log"
    fail "The E5 application log exposed a credential"
  fi
done
cp "$app_log" "$evidence_root/app.log"
chmod 600 "$evidence_root/app.log"
cat "$browser_log"
[[ "$browser_status" == "0" ]] || exit "$browser_status"

echo "E5_ADMISSIONS_MIGRATION_LEDGER_VERIFIED_THROUGH 138" | tee -a "$browser_log"
echo "E5_ADMISSIONS_FIXTURE_MODE real_signed_admin_gate_sales_handoff_curator_ui_fictional_upstream_not_invite_or_payment_proof" | tee -a "$browser_log"
echo "E5_ADMISSIONS_BROWSER_VERIFIED" | tee -a "$browser_log"
