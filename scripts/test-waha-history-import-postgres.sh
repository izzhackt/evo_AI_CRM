#!/usr/bin/env bash
# Real-chain check for scripts/waha-history-import.mjs (docs/runbooks/whatsapp-history-import.md).
#
# Runs the real CLI over HTTP against a real PostgREST in front of a disposable
# Supabase Postgres that has every migration applied (001-260), so the real SQL
# RPCs (begin, page, finish, preview), the Vault runtime binding and the audit
# trail execute. WAHA is a loopback MOCK with synthetic history (GET only); no
# managed Supabase project, WAHA instance or provider is contacted and nothing
# real is used. The only network use is pulling the pinned images.
#
#   npm run test:waha-history-import:postgres
#
# Phases (each is one CLI run, the database is asserted in between): preview
# (writes nothing), pilot (--only-chats-file), an interrupted full run (paused),
# its resume (--resume), and a re-run (idempotent) plus a dry run (nothing left).
# This applies the migration chain without the interleaved fixtures of
# scripts/test-postgres-authorization.sh (that harness stays the authority for
# the SQL contract); expect several minutes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deadline_runner="$repo_root/scripts/run-command-with-deadline.mjs"
suffix="$RANDOM-$$"
network_name="evo-whi-net-$suffix"
db_container="evo-whi-db-$suffix"
rest_container="evo-whi-rest-$suffix"
test_database="evo_waha_history_import"
postgres_image="$("$repo_root/scripts/resolve-postgres-test-image.sh")"
postgrest_image="${POSTGREST_TEST_IMAGE:-public.ecr.aws/supabase/postgrest@sha256:85258123312dc496ad4c2ed832154a65e9746f84df0d6d09b44229ff9230c08e}"
health_timeout_seconds="${EVO_POSTGRES_HEALTH_TIMEOUT_SECONDS:-300}"

org="7e000000-0000-4000-8000-000000000001"
membership="7e000000-0000-4000-8000-000000000301"
# Must equal WAHA_KEY of tests/helpers/waha-history-mock.mjs (the mock WAHA only accepts it).
waha_key="synthetic-waha-api-key-0123456789abcdef"
jwt_secret="whi-local-jwt-secret-0123456789abcdef0123456789abcdef"

gateway_pid=""
gateway_dir=""
work_dir=""
cleanup() {
  if [[ -n "$gateway_pid" ]]; then
    kill "$gateway_pid" >/dev/null 2>&1 || true
    wait "$gateway_pid" >/dev/null 2>&1 || true
  fi
  [[ -z "$gateway_dir" ]] || rm -rf "$gateway_dir"
  [[ -z "$work_dir" ]] || rm -rf "$work_dir"
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

# The same with stdin forwarded (for a heredoc); never used inside a read loop.
psql_stdin() {
  docker exec -i "$db_container" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$test_database" "$@"
}

# sql_value '<query>' -> a single trimmed value
sql_value() { psql_db -tA -c "$1" | tr -d '[:space:]'; }

expect_sql() { # expect_sql '<query>' <expected> <label>
  local actual
  actual="$(sql_value "$1")"
  [[ "$actual" == "$2" ]] || die "$3: expected $2, got $actual"
}

make_jwt() {
  JWT_SECRET="$1" node -e '
    const { createHmac } = require("node:crypto");
    const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const head = enc({ alg: "HS256", typ: "JWT" });
    const body = enc({ role: "service_role", iss: "evo-whi", exp: Math.floor(Date.now() / 1000) + 7200 });
    const sig = createHmac("sha256", process.env.JWT_SECRET).update(`${head}.${body}`).digest("base64url");
    process.stdout.write(`${head}.${body}.${sig}`);
  '
}

json_field() { # json_field '<json>' <dotted.path>
  JSON_TEXT="$1" FIELD="$2" node -e '
    let value = JSON.parse(process.env.JSON_TEXT);
    for (const key of process.env.FIELD.split(".")) value = value?.[key];
    process.stdout.write(value === null || value === undefined ? "null" : String(value));
  '
}

expect_field() { # expect_field '<json>' <dotted.path> <expected> <label>
  local actual
  actual="$(json_field "$1" "$2")"
  [[ "$actual" == "$3" ]] || die "$4: expected $2=$3, got $2=$actual (output: $1)"
}

# run_phase <expected-exit> <phase>; sets $cli_out / $cli_err (the CLI's own lines).
run_phase() {
  local expected="$1" phase="$2" status=0
  local out_file err_file
  out_file="$(mktemp)"; err_file="$(mktemp)"
  node "$repo_root/scripts/test-waha-history-import-chain.mjs" "$phase" >"$out_file" 2>"$err_file" || status=$?
  cli_out="$(grep -v '^{"driver"' "$out_file" || true)"
  cli_err="$(grep -v '^{"driver"' "$err_file" || true)"
  cat "$out_file" "$err_file" >>"$work_dir/all-output.txt"
  rm -f "$out_file" "$err_file"
  [[ "$status" == "$expected" ]] \
    || die "phase '$phase' exited $status, expected $expected (stdout: $cli_out; stderr: $cli_err)"
  # The CLI answered with exactly one JSON line on stdout (or one error line on stderr).
  if [[ "$expected" == "0" ]]; then
    [[ "$(printf '%s\n' "$cli_out" | grep -c '^{')" == "1" ]] || die "phase '$phase': stdout is not one JSON line: $cli_out"
  fi
}

if [[ ! "$health_timeout_seconds" =~ ^[0-9]+$ ]] \
  || (( health_timeout_seconds < 60 || health_timeout_seconds > 600 )); then
  die "EVO_POSTGRES_HEALTH_TIMEOUT_SECONDS must be an integer from 60 to 600"
fi
work_dir="$(mktemp -d)"
: >"$work_dir/all-output.txt"

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
last_migration=""
while IFS= read -r migration; do
  psql_db -q -f "/workspace/$migration" >/dev/null 2>"$work_dir/migration.log" \
    || { cat "$work_dir/migration.log" >&2; die "migration failed: $migration"; }
  applied=$((applied + 1))
  last_migration="$migration"
done < <(cd "$repo_root" && find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)
echo "applied $applied migrations (last: $last_migration)"
(( applied > 100 )) || die "unexpectedly few migrations applied: $applied"
[[ "$last_migration" == *260_platform_waha_history_import.sql || "$(basename "$last_migration" | cut -c1-3)" -ge 260 ]] \
  || die "the chain does not reach migration 260"

step "create a synthetic organization with an eligible intake owner"
psql_stdin -q <<SQL >/dev/null
BEGIN;
INSERT INTO platform.organizations(id, name) VALUES ('$org', 'WHI real-chain fixture');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES ('7e000000-0000-4000-8000-000000000101', 'whi-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES ('7e000000-0000-4000-8000-000000000201', '7e000000-0000-4000-8000-000000000101', 'WHI Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES ('$membership', '$org', '7e000000-0000-4000-8000-000000000201', 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = '$membership';
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES ('7e000000-0000-4000-8000-000000000401', '$org', 'organization', '$org', 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES ('$org', '$membership', '7e000000-0000-4000-8000-000000000401', 1, 1, TRUE, 'system',
    'WHI synthetic organization scope', '7e000000-0000-4000-8000-000000000601');
COMMIT;
SQL

step "start PostgREST (the same API surface the CLI reaches in production)"
auth_role="authenticator"
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

step "provision the Vault WAHA runtime binding (the key the CLI will resolve)"
provisioned="$(curl -sS -X POST "http://127.0.0.1:$gateway_port/rest/v1/rpc/provision_manual_send_waha_runtime" \
  -H "Authorization: Bearer $jwt" -H "apikey: $jwt" -H "Accept-Profile: platform" -H "Content-Profile: platform" \
  -H "Content-Type: application/json" \
  -d "{\"p_organization_id\":\"$org\",\"p_waha_api_key\":\"$waha_key\",\"p_request_id\":\"7e000000-0000-4000-8000-000000000701\"}")"
[[ "$provisioned" == *'"ready":true'* || "$provisioned" == *'"ready": true'* ]] || die "the binding was not provisioned: $provisioned"

export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$gateway_port"
export EVO_PLATFORM_SUPABASE_SECRET_KEY="$jwt"
export EVO_PLATFORM_ORGANIZATION_ID="$org"
export EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID="$membership"
export EVO_WAHA_HISTORY_ALLOW_LOCAL_SUPABASE=1
export EVO_CHAIN_NOW="$(node -e 'process.stdout.write(new Date(Math.floor(Date.now() / 1000) * 1000).toISOString())')"
export EVO_CHAIN_DIR="$work_dir"

history_count() {
  sql_value "SELECT count(*) FROM platform_private.provider_webhook_events WHERE organization_id = '$org' AND event_type = 'history.message'"
}
conversation_count() {
  sql_value "SELECT count(*) FROM platform.communication_conversations WHERE organization_id = '$org'"
}
message_count() {
  sql_value "SELECT count(*) FROM platform.communication_messages WHERE organization_id = '$org'"
}

step "preview: counts and a 0600 file, nothing written to the database"
run_phase 0 preview
expect_field "$cli_out" mode preview "preview"
expect_field "$cli_out" out_file_mode 0600 "preview"
expect_field "$cli_out" totals.chats_candidates 7 "preview candidates (A, B, D, E and three @lid chats)"
expect_field "$cli_out" totals.chats_outbound_only 1 "preview outbound-only chats"
expect_field "$cli_out" totals.by_outcome.import_new 7 "preview outcomes come from the real RPC"
expect_field "$cli_out" totals.chats_multi_page 1 "preview: the 260-message chat has several pages"
[[ "$(node -e 'process.stdout.write((require("node:fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$work_dir/preview.jsonl")" == "600" ]] || die "the preview file is not mode 0600"
expect_sql "SELECT count(*) FROM platform_private.waha_history_reconciliation_runs WHERE organization_id = '$org'" 0 "preview created a run"
[[ "$(conversation_count)" == "0" && "$(message_count)" == "0" && "$(history_count)" == "0" ]] || die "preview wrote data"

step "pilot: one chat with --only-chats-file"
run_phase 0 pilot
expect_field "$cli_out" state completed "pilot"
expect_field "$cli_out" totals.chats_imported 1 "pilot"
expect_field "$cli_out" totals.projected 4 "pilot projected (the CRM API send is not imported)"
[[ "$(conversation_count)" == "1" && "$(message_count)" == "4" ]] || die "pilot did not create exactly one conversation with four messages"
expect_sql "SELECT count(*) FROM platform.communication_messages WHERE organization_id = '$org' AND message_identity_source = 'private_waha_history_binding'" 4 "pilot identity source"
expect_sql "SELECT count(*) FROM platform_private.provider_webhook_events WHERE organization_id = '$org' AND event_type = 'history.message' AND verification_status = 'missing' AND verification_headers ->> 'provenance' = 'api_history' AND verification_headers -> 'webhook_verified' = 'false'::jsonb" 4 "pilot evidence rows are history, never verified"
expect_sql "SELECT count(*) FROM platform_private.provider_webhook_events WHERE organization_id = '$org' AND verification_status = 'verified'" 0 "a verified event was written by the import"
expect_sql "SELECT count(*) FROM platform.clients WHERE organization_id = '$org'" 0 "the import created a client"
expect_sql "SELECT count(*) FROM platform.leads WHERE organization_id = '$org'" 0 "the import created a lead"
expect_sql "SELECT (SELECT c.created_at = min(m.created_at) FROM platform.communication_messages m WHERE m.conversation_id = c.id) FROM platform.communication_conversations c WHERE c.organization_id = '$org'" t "the conversation carries the WhatsApp time, not the import time"
expect_sql "SELECT count(*) FROM platform.audit_events WHERE organization_id = '$org' AND action = 'communication.waha.history.begin'" 1 "pilot begin audit"

step "interrupted full run (excluding the personal chat): paused, partly imported"
run_phase 1 interrupted
expect_field "$cli_err" error_code interrupted "interrupted"
interrupted_run="$(json_field "$cli_err" run_id)"
[[ "$interrupted_run" =~ ^[0-9a-f-]{36}$ ]] || die "the interrupted run named no run id: $cli_err"
expect_sql "SELECT lifecycle.state FROM platform_private.waha_history_reconciliation_lifecycle lifecycle WHERE lifecycle.run_id = '$interrupted_run' ORDER BY lifecycle.observed_at DESC, lifecycle.id DESC LIMIT 1" paused "interrupted run state"
partial="$(conversation_count)"
(( partial > 1 && partial < 7 )) || die "the interrupted run should be partway (conversations: $partial)"

step "an unfinished run is not continued without --resume"
run_phase 1 rerun
expect_field "$cli_err" error_code unfinished_run_exists "unfinished run guard"
expect_field "$cli_err" run_id "$interrupted_run" "unfinished run guard names the run"

step "resume from the durable cursor"
EVO_CHAIN_RUN_ID="$interrupted_run" run_phase 0 resume
expect_field "$cli_out" resumed true "resume"
expect_field "$cli_out" run_id "$interrupted_run" "resume"
expect_field "$cli_out" state completed "resume"
# A (pilot) + B + E + the three @lid chats; the personal chat (D) and the outbound-only chat (C) stay out.
expect_sql "SELECT count(*) FROM platform.communication_conversations WHERE organization_id = '$org'" 6 "conversations after the resume"
# A 4, B 3, E 260, LID1 2, LID2 1, LID3 1
expect_sql "SELECT count(*) FROM platform.communication_messages WHERE organization_id = '$org'" 271 "messages after the resume"
expect_sql "SELECT count(*) FROM platform.communication_messages WHERE organization_id = '$org' AND message_identity_source <> 'private_waha_history_binding'" 0 "every imported message has the history identity"
expect_sql "SELECT count(*) FROM platform_private.waha_message_bindings b JOIN platform.communication_messages m ON m.id = b.communication_message_id WHERE m.organization_id = '$org'" 271 "every message has its raw-id binding"
expect_sql "SELECT count(*) FROM platform_private.waha_direct_chat_bindings WHERE organization_id = '$org' AND normalized_chat_id IN ('15550000105@c.us', '15550000103@c.us', '15550000000@c.us')" 0 "the personal, outbound-only and own chats stay out"
expect_sql "SELECT count(*) FROM platform_private.waha_direct_chat_bindings WHERE organization_id = '$org' AND normalized_chat_id LIKE '%@g.us'" 0 "a group was bound"
expect_sql "SELECT count(*) FROM platform.clients WHERE organization_id = '$org'" 0 "the import created a client"
expect_sql "SELECT count(*) FROM platform.conversation_handoff_events WHERE organization_id = '$org'" 0 "the import created a handoff (not even for media)"
expect_sql "SELECT count(*) FROM platform.communication_messages m WHERE m.organization_id = '$org' AND m.body_text LIKE E'%откройте в WhatsApp продаж'" 1 "the media message is a typed marker"
# The 260-message chat: all messages, the outbound one that opens the chat included, in two or more pages.
expect_sql "SELECT count(*) FROM platform.communication_messages m JOIN platform_private.waha_direct_chat_bindings b ON b.conversation_id = m.conversation_id WHERE b.normalized_chat_id = '15550000106@c.us' AND m.direction = 'outbound'" 130 "the long chat's outbound messages"
expect_sql "SELECT count(*) FROM platform.communication_messages m JOIN platform_private.waha_direct_chat_bindings b ON b.conversation_id = m.conversation_id WHERE b.normalized_chat_id = '15550000106@c.us' AND m.direction = 'inbound'" 130 "the long chat's inbound messages"
# The @lid chat whose phone WAHA's lid map knows is named by that phone; the own-number mapping gives none.
expect_sql "SELECT c.subject FROM platform.communication_conversations c JOIN platform_private.waha_direct_chat_bindings b ON b.conversation_id = c.id WHERE b.normalized_chat_id = '900000000000101@lid'" "WhatsApp••••0104" "an @lid chat takes its phone from the lid map"
expect_sql "SELECT count(*) FROM platform.communication_conversations c JOIN platform_private.waha_direct_chat_bindings b ON b.conversation_id = c.id WHERE c.organization_id = '$org' AND b.normalized_chat_id IN ('900000000000102@lid', '900000000000103@lid') AND c.subject LIKE '%••••%'" 0 "an @lid chat without a usable phone got a number made of nothing"
expect_sql "SELECT count(*) FROM platform_private.waha_history_reconciliation_runs WHERE organization_id = '$org'" 2 "runs (pilot, interrupted+resumed)"

step "dry run: nothing left to import"
run_phase 0 dryrun
expect_field "$cli_out" mode apply-dry-run "dry run"
expect_field "$cli_out" totals.first_page_would_import 0 "dry run: would import"
expect_field "$cli_out" totals.by_outcome.skip_nothing_eligible 6 "dry run: every selected chat (A, B, E and the three @lid chats) is already imported"

step "re-run: idempotent"
run_phase 0 rerun
expect_field "$cli_out" totals.projected 0 "re-run projected"
expect_field "$cli_out" totals.conversations_created 0 "re-run conversations"
expect_field "$cli_out" totals.already_bound 271 "re-run already bound"
[[ "$(conversation_count)" == "6" && "$(message_count)" == "271" ]] || die "the re-run changed the data"

step "no secret or personal data in any CLI output"
for secret in "$waha_key" "$jwt" "$jwt_secret" "1555000010" "9000000000001" "Aigul" "Boris" "Dana" "Emil" "Lida" "A-secret-body" "E-body-" "B-body" "$work_dir"; do
  if grep -qF -- "$secret" "$work_dir/all-output.txt"; then
    die "a CLI output contains ${secret:0:12}..."
  fi
done

echo "WhatsApp history import real-chain check passed"
