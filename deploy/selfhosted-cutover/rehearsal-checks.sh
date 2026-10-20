#!/bin/bash
# EVO: read-only checks of the self-hosted stack through its PUBLIC address. Run on hermes-vps as root.
# Keys are read from /opt/evo-supabase/.env inside this process and never printed; only HTTP codes, sizes and counts are.
# usage: rehearsal-checks.sh           (no test data is created: GET/HEAD/OPTIONS, a rolled-back SQL transaction, select 1)
set -uo pipefail
umask 077
ENV=/opt/evo-supabase/.env
BASE=https://supabase.evoadmissions.com
rd() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }
PUB=$(rd SUPABASE_PUBLISHABLE_KEY); SEC=$(rd SUPABASE_SECRET_KEY); ANON=$(rd ANON_KEY); SRV=$(rd SERVICE_ROLE_KEY)
[ -n "$PUB" ] && [ -n "$SEC" ] && [ -n "$ANON" ] && [ -n "$SRV" ] || { echo "keys missing in .env"; exit 2; }
# one request; keys go through curl's config on stdin, not through argv
#   code METHOD PATH APIKEY BEARER [EXTRA_HEADER]
code() {
  local m="$1" p="$2" k="$3" b="$4" x="${5:-}"
  { printf 'url = "%s%s"\n' "$BASE" "$p"; printf 'request = "%s"\n' "$m"
    [ -n "$k" ] && printf 'header = "apikey: %s"\n' "$k"
    [ -n "$b" ] && printf 'header = "Authorization: Bearer %s"\n' "$b"
    [ -n "$x" ] && printf 'header = "%s"\n' "$x"; } | curl -s -o /dev/null -m 20 -w '%{http_code}' --config - 2>/dev/null
}
row() { printf '  %-58s %s\n' "$1" "$2"; }

echo "== 1. Auth settings (publishable / anon JWT)"
row "GET /auth/v1/settings  apikey=sb_publishable"                "$(code GET /auth/v1/settings "$PUB" "")"
row "GET /auth/v1/settings  apikey=ANON_KEY (JWT)"                "$(code GET /auth/v1/settings "$ANON" "")"
row "GET /auth/v1/settings  apikey=ANON_KEY + Bearer"             "$(code GET /auth/v1/settings "$ANON" "$ANON")"
echo "== 2. Auth admin (/auth/v1/admin/users?page=1&per_page=1): must be 200 for the secret key"
A='/auth/v1/admin/users?page=1&per_page=1'
row "sb_secret      apikey only"                                  "$(code GET "$A" "$SEC" "")"
row "sb_secret      apikey + Bearer sb_secret"                    "$(code GET "$A" "$SEC" "$SEC")"
row "SERVICE_ROLE   apikey only"                                  "$(code GET "$A" "$SRV" "")"
row "SERVICE_ROLE   apikey + Bearer (what the controller sends)"  "$(code GET "$A" "$SRV" "$SRV")"
echo "== 3. PostgREST harmless select (public.profiles id, limit 1; body not read)"
R='/rest/v1/profiles?select=id&limit=1'
row "sb_secret      apikey only"                                  "$(code GET "$R" "$SEC" "" "Accept-Profile: public")"
row "sb_secret      apikey + Bearer sb_secret"                    "$(code GET "$R" "$SEC" "$SEC" "Accept-Profile: public")"
row "SERVICE_ROLE   apikey only"                                  "$(code GET "$R" "$SRV" "" "Accept-Profile: public")"
row "SERVICE_ROLE   apikey + Bearer"                              "$(code GET "$R" "$SRV" "$SRV" "Accept-Profile: public")"
echo "== 3b. PostgREST platform schema select (platform.profiles id, limit 1)"
R2='/rest/v1/profiles?select=id&limit=1'
row "sb_secret      apikey only, Accept-Profile: platform"        "$(code GET "$R2" "$SEC" "" "Accept-Profile: platform")"
row "SERVICE_ROLE   apikey + Bearer, Accept-Profile: platform"    "$(code GET "$R2" "$SRV" "$SRV" "Accept-Profile: platform")"
echo "== 3c. PostgREST RPC read (platform.read_amocrm_command_by_idempotency_key, nonexistent key; Content-Profile platform)"
ORG=$(docker exec evo-supabase-db psql -U postgres -d postgres -X -A -t -c "select id from platform.organizations order by created_at limit 1")
rpc() { # RPC apikey bearer
  { printf 'url = "%s/rest/v1/rpc/read_amocrm_command_by_idempotency_key"\nrequest = "POST"\n' "$BASE"
    printf 'header = "apikey: %s"\n' "$2"; [ -n "$3" ] && printf 'header = "Authorization: Bearer %s"\n' "$3"
    printf 'header = "Content-Type: application/json"\nheader = "Accept-Profile: platform"\nheader = "Content-Profile: platform"\n'
    printf 'data = "{\\"p_organization_id\\":\\"%s\\",\\"p_idempotency_key\\":\\"rehearsal-nonexistent-key\\"}"\n' "$ORG"; } \
  | curl -s -o /dev/null -m 20 -w '%{http_code}' --config - 2>/dev/null
}
row "RPC  sb_secret      apikey only"                              "$(rpc x "$SEC" "")"
row "RPC  sb_secret      apikey + Bearer sb_secret"                "$(rpc x "$SEC" "$SEC")"
row "RPC  SERVICE_ROLE   apikey only"                              "$(rpc x "$SRV" "")"
row "RPC  SERVICE_ROLE   apikey + Bearer"                          "$(rpc x "$SRV" "$SRV")"
row "RPC  sb_publishable (anon: must NOT be 200)"                  "$(rpc x "$PUB" "")"
echo "== 4. Negative: wrong key must be 401, anon on admin must be 403"
# deliberately wrong keys, assembled from pieces: no key-shaped text may sit in a public repository (secret scanners)
BAD_PUB="$(printf 'sb_%s_%s' publishable wrongwrongwrongwrong)"; BAD_SEC="$(printf 'sb_%s_%s' secret wrongwrongwrongwrongwrong)"
row "wrong apikey on /auth/v1/settings"                           "$(code GET /auth/v1/settings "$BAD_PUB" "")"
row "no key on /auth/v1/settings"                                 "$(code GET /auth/v1/settings "" "")"
row "wrong key on admin/users"                                    "$(code GET "$A" "$BAD_SEC" "")"
row "sb_publishable on admin/users"                               "$(code GET "$A" "$PUB" "")"
row "ANON_KEY (JWT) on admin/users"                               "$(code GET "$A" "$ANON" "$ANON")"
echo "== 5. Storage"
row "GET /storage/v1/bucket  sb_secret apikey only"               "$(code GET /storage/v1/bucket "$SEC" "")"
row "GET /storage/v1/bucket  SERVICE_ROLE apikey+Bearer"          "$(code GET /storage/v1/bucket "$SRV" "$SRV")"
# an existing object from a PUBLIC bucket, status and size only
OBJ=$(docker exec evo-supabase-db psql -U postgres -d postgres -X -A -t -F '|' -c "select o.bucket_id, o.name from storage.objects o join storage.buckets b on b.id=o.bucket_id where b.public and o.metadata is not null order by o.created_at desc limit 1")
if [ -n "$OBJ" ]; then
  URLPATH=$(python3 -I -c 'import sys,urllib.parse; b,n=sys.stdin.read().rstrip("\n").split("|",1); print("/storage/v1/object/public/"+urllib.parse.quote(b)+"/"+urllib.parse.quote(n))' <<<"$OBJ")
  RES=$(curl -s -o /dev/null -m 30 -w '%{http_code} size=%{size_download}' "$BASE$URLPATH")
  row "public object download (bucket: ${OBJ%%|*})"               "$RES"
else row "public object download" "no public object found"; fi
TUS=$(curl -s -o /dev/null -D - -m 20 -X OPTIONS -H "apikey: $PUB" -H "Tus-Resumable: 1.0.0" "$BASE/storage/v1/upload/resumable" 2>/dev/null | tr -d '\r')
row "OPTIONS /storage/v1/upload/resumable (TUS)"                  "$(printf '%s' "$TUS" | head -1 | cut -d' ' -f2) tus-version-header=$(printf '%s' "$TUS" | grep -ci '^tus-version')"
echo "== 6. Realtime websocket handshake (expects 101)"
WSKEY=$(head -c 16 /dev/urandom | base64)
ws() { # $1 = apikey for the query string
  { printf 'url = "%s/realtime/v1/websocket?apikey=%s&vsn=1.0.0"\n' "$BASE" "$1"
    printf 'header = "Connection: Upgrade"\nheader = "Upgrade: websocket"\nheader = "Sec-WebSocket-Version: 13"\nheader = "Sec-WebSocket-Key: %s"\n' "$WSKEY"; } \
  | curl -s -o /dev/null --http1.1 -m 4 -w '%{http_code}' --config - 2>/dev/null
}
row "websocket upgrade with sb_publishable"                       "$(ws "$PUB")"
row "websocket upgrade with ANON_KEY (JWT)"                       "$(ws "$ANON")"
join() { # $1 = key used both in the query string and as access_token
  K="$1" node -e '
    const k = process.env.K, topic = "realtime:rehearsal-check";
    const ws = new WebSocket("wss://supabase.evoadmissions.com/realtime/v1/websocket?apikey=" + k + "&vsn=1.0.0");
    const done = (m) => { console.log(m); process.exit(0); };
    setTimeout(() => done("timeout"), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ topic, event: "phx_join", ref: "1", join_ref: "1",
      payload: { config: { broadcast: { ack: false, self: false }, presence: { key: "" }, postgres_changes: [], private: false }, access_token: k } }));
    ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.event === "phx_reply" && d.ref === "1") { ws.close(); done("join " + (d.payload && d.payload.status) + (d.payload && d.payload.status !== "ok" ? " reason=" + String((d.payload.response && (d.payload.response.reason || d.payload.response.message)) || "").replace(k, "<key>").slice(0, 120) : "")); } };
    ws.onerror = () => done("ws error");
  ' 2>&1 | tail -1
}
row "phx_join public channel, key=ANON_KEY (JWT)"                 "$(join "$ANON")"
row "phx_join public channel, key=sb_publishable"                 "$(join "$PUB")"
row "phx_join public channel, key=sb_secret (server-side use)"    "$(join "$SEC")"
row "phx_join public channel, key=SERVICE_ROLE (JWT)"             "$(join "$SRV")"
# the edge log must not contain any of the four keys
LEAK=0
for K in "$PUB" "$SEC" "$ANON" "$SRV"; do
  C=$(docker logs --since 30m evo-edge-caddy 2>&1 | grep -c -F -f <(printf '%s\n' "$K")); LEAK=$((LEAK + C))
done
row "edge log (last 30 min): lines containing any of the 4 keys"  "$LEAK"
echo "== 7. Access-token hook inside a rolled-back transaction (claim names only)"
docker exec -i evo-supabase-db psql -U supabase_admin -d postgres -X -A -t <<'SQL' 2>&1 | sed 's/^/  /'
begin;
select p.auth_user_id as uid from platform.organization_memberships m join platform.profiles p on p.id = m.profile_id
  where m.status::text = 'active' and p.auth_user_id is not null order by m.created_at limit 1 \gset
set local role supabase_auth_admin;
select 'claims: ' || coalesce(string_agg(k, ',' order by k), '(none)')
from (
  select jsonb_object_keys(h -> 'claims') as k
  from (select platform_private.custom_access_token_hook(jsonb_build_object(
          'user_id', :'uid'::uuid,
          'claims', jsonb_build_object('sub', :'uid', 'role', 'authenticated', 'aud', 'authenticated'))) as h) x
) y;
rollback;
SQL
echo "== 8. AI agent pool user through Supavisor from the evo_crm_ai network (select 1)"
export PGPASSWORD="$(rd EVO_AI_AGENT_PASSWORD)"
TENANT=$(rd POOLER_TENANT_ID)
docker run --rm --network evo_crm_ai -e PGPASSWORD -e PGCONNECT_TIMEOUT=10 --entrypoint psql supabase/postgres:17.6.1.155 \
  "host=evo-supabase-pooler port=6543 user=evo_ai_agent.${TENANT} dbname=postgres sslmode=disable" -X -A -t -c "select 'pooler select 1 = ' || 1" 2>&1 | sed -E 's/^/  /; s/(password|PGPASSWORD)[^ ]*/\1=<masked>/Ig'
unset PGPASSWORD
echo "== 9. WAHA Vault transfer, DRY RUN only (reads the cloud Vault key in memory, writes nothing)"
node /opt/evo-supabase/ops/waha-vault-transfer.mjs --dry-run 2>&1 | sed 's/^/  /'
echo "== done"
