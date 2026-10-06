#!/usr/bin/env bash
# Real-chain check for scripts/waha-runtime-binding.mjs (docs/runbooks/whatsapp-go-live.md).
#
# Runs the real CLI over HTTP against a real PostgREST in front of a disposable
# Supabase Postgres that has every migration applied (including 081, 099 and
# 102), so the real SQL functions, Supabase Vault and audit trail execute.
# Everything is synthetic and local: no managed Supabase project, WAHA instance
# or provider is contacted. The only network use is pulling the pinned images.
#
#   npm run test:waha-runtime-binding:postgres
#
# This applies the migration chain without the interleaved fixtures of
# scripts/test-postgres-authorization.sh (the full migration-boundary harness
# remains the authority for the SQL contract); expect a few minutes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deadline_runner="$repo_root/scripts/run-command-with-deadline.mjs"
suffix="$RANDOM-$$"
network_name="evo-wrb-net-$suffix"
db_container="evo-wrb-db-$suffix"
rest_container="evo-wrb-rest-$suffix"
test_database="evo_waha_runtime_binding"
postgres_image="$("$repo_root/scripts/resolve-postgres-test-image.sh")"
postgrest_image="${POSTGREST_TEST_IMAGE:-public.ecr.aws/supabase/postgrest@sha256:85258123312dc496ad4c2ed832154a65e9746f84df0d6d09b44229ff9230c08e}"
health_timeout_seconds="${EVO_POSTGRES_HEALTH_TIMEOUT_SECONDS:-300}"

organization_id="7e000000-0000-4000-8000-000000000001"
unknown_organization_id="7e000000-0000-4000-8000-0000000000ff"
key_a="wrb-synthetic-key-A-0123456789abcdef"
key_b="wrb-synthetic-key-B-fedcba9876543210"
jwt_secret="wrb-local-jwt-secret-0123456789abcdef0123456789abcdef"
other_jwt_secret="wrb-other-jwt-secret-fedcba9876543210fedcba9876543210"

gateway_pid=""
gateway_dir=""
cleanup() {
  if [[ -n "$gateway_pid" ]]; then
    kill "$gateway_pid" >/dev/null 2>&1 || true
    wait "$gateway_pid" >/dev/null 2>&1 || true
  fi
  [[ -z "$gateway_dir" ]] || rm -rf "$gateway_dir"
  docker rm -f "$rest_container" >/dev/null 2>&1 || true
  docker rm -f "$db_container" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

step() { printf '== %s\n' "$*"; }
die() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

psql_db() {
  docker exec "$db_container" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" "$@"
}

sha256_of() { printf '%s' "$1" | shasum -a 256 | awk '{print $1}'; }

make_jwt() {
  JWT_SECRET="$1" node -e '
    const { createHmac } = require("node:crypto");
    const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const head = enc({ alg: "HS256", typ: "JWT" });
    const body = enc({ role: "service_role", iss: "evo-wrb", exp: Math.floor(Date.now() / 1000) + 3600 });
    const sig = createHmac("sha256", process.env.JWT_SECRET).update(`${head}.${body}`).digest("base64url");
    process.stdout.write(`${head}.${body}.${sig}`);
  '
}

json_field() { # json_field '<json>' <field>
  JSON_TEXT="$1" FIELD="$2" node -e '
    const value = JSON.parse(process.env.JSON_TEXT)[process.env.FIELD];
    process.stdout.write(value === null || value === undefined ? "null" : String(value));
  '
}

expect_field() { # expect_field '<json>' <field> <expected> <label>
  local actual
  actual="$(json_field "$1" "$2")"
  [[ "$actual" == "$3" ]] || die "$4: expected $2=$3, got $2=$actual (output: $1)"
}

# run_cli <expected-exit> <stdin-or-empty> <args...>; sets $cli_out / $cli_err.
run_cli() {
  local expected="$1" input="$2" status=0
  shift 2
  local out_file err_file
  out_file="$(mktemp)"; err_file="$(mktemp)"
  if [[ -n "$input" ]]; then
    printf '%s\n' "$input" | node "$repo_root/scripts/waha-runtime-binding.mjs" "$@" >"$out_file" 2>"$err_file" || status=$?
  else
    node "$repo_root/scripts/waha-runtime-binding.mjs" "$@" </dev/null >"$out_file" 2>"$err_file" || status=$?
  fi
  cli_out="$(cat "$out_file")"; cli_err="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
  [[ "$status" == "$expected" ]] \
    || die "'$*' exited $status, expected $expected (stdout: $cli_out; stderr: $cli_err)"
  for secret in "$key_a" "$key_b" "$(sha256_of "$key_a")" "$(sha256_of "$key_b")" "$jwt"; do
    [[ "$cli_out$cli_err" != *"$secret"* ]] || die "'$*' printed a secret-bearing value"
  done
}

if [[ ! "$health_timeout_seconds" =~ ^[0-9]+$ ]] \
  || (( health_timeout_seconds < 60 || health_timeout_seconds > 600 )); then
  die "EVO_POSTGRES_HEALTH_TIMEOUT_SECONDS must be an integer from 60 to 600"
fi

step "start disposable Supabase Postgres"
docker network create "$network_name" >/dev/null
node "$deadline_runner" 300000 docker run \
  --detach \
  --name "$db_container" \
  --network "$network_name" \
  --env POSTGRES_PASSWORD=postgres \
  --mount "type=bind,src=$repo_root,dst=/workspace,readonly" \
  "$postgres_image" >/dev/null

health_status=""
health_deadline=$((SECONDS + health_timeout_seconds))
while (( SECONDS < health_deadline )); do
  health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$db_container" 2>/dev/null || echo docker_unavailable)"
  [[ "$health_status" == "healthy" ]] && break
  sleep 1
done
[[ "$health_status" == "healthy" ]] || die "Postgres did not become healthy (last status: $health_status)"

step "bootstrap roles and apply the migration chain"
docker exec "$db_container" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -c "CREATE DATABASE ${test_database} TEMPLATE template0;"
docker exec --env PGPASSWORD=postgres "$db_container" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "$test_database" \
  -c "GRANT anon, authenticated, service_role, supabase_auth_admin, supabase_admin TO postgres;"
psql_db -f /workspace/supabase/tests/bootstrap_supabase.sql >/dev/null

applied=0
while IFS= read -r migration; do
  psql_db -q -f "/workspace/$migration" >/dev/null 2>"${TMPDIR:-/tmp}/evo-wrb-migration-$suffix.log" \
    || { cat "${TMPDIR:-/tmp}/evo-wrb-migration-$suffix.log" >&2; rm -f "${TMPDIR:-/tmp}/evo-wrb-migration-$suffix.log"; die "migration failed: $migration"; }
  applied=$((applied + 1))
done < <(cd "$repo_root" && find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)
rm -f "${TMPDIR:-/tmp}/evo-wrb-migration-$suffix.log"
echo "applied $applied migrations"
(( applied > 100 )) || die "unexpectedly few migrations applied: $applied"

step "create a synthetic organization"
# The organization-admin invariant is a deferred constraint trigger that needs a
# full staff fixture. The RPCs under test only need an active organization row,
# so the fixture bypasses that unrelated trigger the way the migration-boundary
# harness does for its own historical fixtures.
psql_db -q -c "SET session_replication_role = replica; INSERT INTO platform.organizations (id, name) VALUES ('$organization_id', 'WRB real-chain fixture'); SET session_replication_role = origin;"

step "start PostgREST (the same API surface the CLI reaches in production)"
auth_role="authenticator"
# The image creates the Supabase API login role without a password; give it the
# disposable test password so PostgREST can connect (cluster role, container only).
docker exec --env PGPASSWORD=postgres "$db_container" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d postgres \
  -c "ALTER ROLE ${auth_role} WITH LOGIN PASSWORD 'postgres'" >/dev/null
docker run --detach \
  --name "$rest_container" \
  --network "$network_name" \
  --publish 127.0.0.1::3000 \
  --env "PGRST_DB_URI=postgres://${auth_role}:postgres@${db_container}:5432/${test_database}" \
  --env PGRST_DB_SCHEMAS=platform \
  --env PGRST_DB_ANON_ROLE=anon \
  --env "PGRST_JWT_SECRET=$jwt_secret" \
  "$postgrest_image" >/dev/null
sleep 3
rest_port="$(docker port "$rest_container" 3000/tcp 2>/dev/null | head -1 | awk -F: '{print $NF}' || true)"
if [[ ! "$rest_port" =~ ^[0-9]+$ ]]; then
  docker logs --tail 40 "$rest_container" >&2 || true
  die "PostgREST is not running or published no port"
fi
rest_deadline=$((SECONDS + 90))
until [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$rest_port/" || true)" =~ ^(200|401|404)$ ]]; do
  (( SECONDS < rest_deadline )) || { docker logs --tail 40 "$rest_container" >&2; die "PostgREST did not start"; }
  sleep 1
done

# Supabase serves PostgREST behind its gateway under /rest/v1. A raw PostgREST has
# no such prefix, so a minimal loopback forwarder models the gateway path only.
gateway_dir="$(mktemp -d)"
cat >"$gateway_dir/gateway.mjs" <<'GATEWAY'
import { createServer, request } from "node:http";
const target = Number(process.argv[2]);
createServer((incoming, outgoing) => {
  if (!incoming.url.startsWith("/rest/v1/")) {
    outgoing.writeHead(404).end();
    return;
  }
  const forwarded = request(
    {
      host: "127.0.0.1",
      port: target,
      method: incoming.method,
      path: incoming.url.slice("/rest/v1".length),
      headers: incoming.headers,
    },
    (answer) => {
      outgoing.writeHead(answer.statusCode, answer.headers);
      answer.pipe(outgoing);
    },
  );
  forwarded.on("error", () => outgoing.writeHead(502).end());
  incoming.pipe(forwarded);
}).listen(0, "127.0.0.1", function () {
  process.stdout.write(`${this.address().port}\n`);
});
GATEWAY
node "$gateway_dir/gateway.mjs" "$rest_port" >"$gateway_dir/port" &
gateway_pid=$!
gateway_deadline=$((SECONDS + 15))
until [[ -s "$gateway_dir/port" ]]; do
  (( SECONDS < gateway_deadline )) || die "the loopback gateway did not start"
  sleep 0.2
done
gateway_port="$(tr -d '\n' <"$gateway_dir/port")"
[[ "$gateway_port" =~ ^[0-9]+$ ]] || die "the loopback gateway published no port"

jwt="$(make_jwt "$jwt_secret")"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$gateway_port"
export EVO_PLATFORM_SUPABASE_SECRET_KEY="$jwt"
export EVO_PLATFORM_ORGANIZATION_ID="$organization_id"
export EVO_WAHA_BINDING_ALLOW_LOCAL_SUPABASE=1
unset EVO_PLATFORM_MANUAL_SEND_WAHA_API_KEY

audit_count() {
  psql_db -tA -c "SELECT count(*) FROM platform.audit_events WHERE organization_id = '$organization_id' AND action = 'configuration.waha.provision'"
}

step "check: missing binding is reported, exit 3"
run_cli 3 "" check
expect_field "$cli_out" reason_code missing_binding "initial check"
expect_field "$cli_out" ready false "initial check"

step "provision --dry-run plans a create and writes nothing"
run_cli 0 "$key_a" provision --key-stdin --dry-run --skip-waha-check
expect_field "$cli_out" action would_create "dry run"
[[ "$(audit_count)" == "0" ]] || die "dry run wrote an audit event"
run_cli 3 "" check
expect_field "$cli_out" reason_code missing_binding "check after dry run"

step "provision creates the binding (real SQL, Vault and audit)"
run_cli 0 "$key_a" provision --key-stdin --skip-waha-check
expect_field "$cli_out" action created "create"
expect_field "$cli_out" ready true "create"
expect_field "$cli_out" waha_session_name crm_primary "create"
expect_field "$cli_out" base_url http://evo-crm-waha:3000 "create"
expect_field "$cli_out" binding_version 1 "create"
[[ "$(audit_count)" == "1" ]] || die "create did not write exactly one audit event"

step "check --verify-key compares the stored hash locally"
run_cli 0 "$key_a" check --verify-key --key-stdin --skip-waha-check
expect_field "$cli_out" key_matches_stored_binding true "verify key A"
run_cli 3 "$key_b" check --verify-key --key-stdin --skip-waha-check
expect_field "$cli_out" key_matches_stored_binding false "verify key B against A"

step "provision is idempotent: same key leaves version and audit trail untouched"
run_cli 0 "$key_a" provision --key-stdin --skip-waha-check
expect_field "$cli_out" action unchanged "idempotent rerun"
expect_field "$cli_out" binding_version 1 "idempotent rerun"
[[ "$(audit_count)" == "1" ]] || die "idempotent rerun wrote an audit event"

step "the app's own read path (resolve RPC) returns exactly the provisioned key"
resolved="$(curl -sS -X POST "http://127.0.0.1:$gateway_port/rest/v1/rpc/resolve_manual_send_waha_runtime" \
  -H "Authorization: Bearer $jwt" -H "apikey: $jwt" -H "Accept-Profile: platform" -H "Content-Profile: platform" \
  -H "Content-Type: application/json" \
  -d "{\"p_organization_id\":\"$organization_id\"}")"
resolved_key="$(JSON_TEXT="$resolved" node -e 'const rows = JSON.parse(process.env.JSON_TEXT); process.stdout.write(rows.length === 1 ? String(rows[0].waha_api_key) : "ROWS:" + rows.length)')"
[[ "$resolved_key" == "$key_a" ]] || die "resolve_manual_send_waha_runtime did not return the provisioned key"
resolved_target="$(JSON_TEXT="$resolved" node -e 'const row = JSON.parse(process.env.JSON_TEXT)[0]; process.stdout.write(`${row.waha_session_name} ${row.waha_base_url}`)')"
[[ "$resolved_target" == "crm_primary http://evo-crm-waha:3000" ]] || die "resolved target drifted: $resolved_target"

step "rotation to a new key bumps the binding version"
run_cli 0 "$key_b" provision --key-stdin --skip-waha-check
expect_field "$cli_out" action rotated "rotate"
expect_field "$cli_out" binding_version 2 "rotate"
[[ "$(audit_count)" == "2" ]] || die "rotation did not write exactly one more audit event"
run_cli 0 "$key_b" check --verify-key --key-stdin --skip-waha-check
expect_field "$cli_out" key_matches_stored_binding true "verify key B"
vault_sha="$(psql_db -tA -c "SELECT encode(sha256(convert_to(decrypted_secret, 'UTF8')), 'hex') FROM vault.decrypted_secrets WHERE name = 'evo-manual-send-waha-api-key-$organization_id'")"
[[ "$vault_sha" == "$(sha256_of "$key_b")" ]] || die "the Vault secret does not hold key B"

step "a disabled binding is repaired"
psql_db -q -c "UPDATE platform_private.manual_send_waha_runtime_bindings SET enabled = FALSE WHERE organization_id = '$organization_id';"
run_cli 3 "" check
expect_field "$cli_out" reason_code binding_disabled "disabled check"
run_cli 0 "$key_b" provision --key-stdin --skip-waha-check
expect_field "$cli_out" action repaired "repair"
expect_field "$cli_out" ready true "repair"
run_cli 0 "" check

step "failure modes surface as closed codes"
saved_secret="$EVO_PLATFORM_SUPABASE_SECRET_KEY"
export EVO_PLATFORM_SUPABASE_SECRET_KEY="$(make_jwt "$other_jwt_secret")"
run_cli 1 "" check
[[ "$cli_err" == '{"ok":false,"error_code":"rpc_unauthorized"}' ]] || die "wrong JWT secret: $cli_err"
export EVO_PLATFORM_SUPABASE_SECRET_KEY="$saved_secret"
export EVO_PLATFORM_ORGANIZATION_ID="$unknown_organization_id"
run_cli 1 "" check
[[ "$cli_err" == '{"ok":false,"error_code":"rpc_rejected"}' ]] || die "unknown organization: $cli_err"
export EVO_PLATFORM_ORGANIZATION_ID="$organization_id"

step "the legacy inbox transport cannot be provisioned or resolved"
[[ "$(psql_db -tA -c "SELECT count(*) FROM platform_private.manual_send_waha_runtime_bindings WHERE waha_session_name <> 'crm_primary' OR waha_base_url <> 'http://evo-crm-waha:3000'")" == "0" ]] \
  || die "a non-crm_primary binding exists"
legacy_insert_status=0
psql_db -q -c "UPDATE platform_private.manual_send_waha_runtime_bindings SET waha_session_name = 'evo-inbox' WHERE organization_id = '$organization_id'" >/dev/null 2>&1 || legacy_insert_status=$?
[[ "$legacy_insert_status" != "0" ]] || die "the schema accepted a legacy evo-inbox binding"

echo "WAHA runtime binding real-chain check passed"
