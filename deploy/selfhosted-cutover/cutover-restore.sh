#!/bin/bash
# EVO: restore a cloud dump into the self-hosted Supabase. The same script is used for the rehearsal and for the cutover.
# usage (as root on hermes-vps):  /opt/evo-supabase/restore/cutover-restore.sh <tag>
# input : /opt/evo-supabase/restore/runs/<tag>/  roles.sql schema.sql data.sql history_schema.sql history_data.sql
#         [acl_cloud.tsv = ACL snapshot of the cloud made by acl-snapshot.sql; without it only the legacy acl_fix*.sql run]
# output: /opt/evo-supabase/restore/logs/<tag>/  timing.tsv, *.out, *.err, checks.txt   (counts only, no row contents)
# Destroys and replaces the self-hosted database (volumes/db/data <- restore/pgdata.clean). Never touches the CRM app,
# /opt/evo-crm, WAHA or any other project. Never prints passwords, keys or row contents.
set -uo pipefail
umask 077
export LC_ALL=C

TAG="${1:-}"
case "$TAG" in ""|*[!A-Za-z0-9._-]*) echo "usage: cutover-restore.sh <tag>   (tag: letters, digits, . _ -)"; exit 2;; esac
BASE=/opt/evo-supabase
RESTORE=$BASE/restore
RUN=$RESTORE/runs/$TAG
LOG=$RESTORE/logs/$TAG
DATA=$BASE/volumes/db/data
SNAP=$RESTORE/pgdata.clean
SERVICES="auth storage realtime rest supavisor meta studio imgproxy"
PSQL_BASE="docker exec -i evo-supabase-db psql -U postgres -d postgres -X -q"

exec 9>/var/lock/evo-cutover-restore.lock
flock -n 9 || { echo "another cutover-restore is running"; exit 3; }

mkdir -p "$LOG"; : > "$LOG/timing.tsv"
T_ALL=$(date +%s); STAGE=init; T_S=$T_ALL
stage()  { STAGE="$1"; T_S=$(date +%s); echo "[$(date -u +%T)] $STAGE"; }
endst()  { local d=$(( $(date +%s) - T_S )); printf '%s\t%s\n' "$STAGE" "$d" >> "$LOG/timing.tsv"; echo "    done: $STAGE ${d}s"; }
fail()   { printf 'FAILED\t%s\t%s\n' "$STAGE" "$1" >> "$LOG/timing.tsv"; echo "FAILED at stage '$STAGE': $1"; exit 1; }
errs()   { grep -c -E '(^|: )ERROR' "$1" 2>/dev/null || true; }
wait_db() { for _ in $(seq 1 90); do docker exec evo-supabase-db pg_isready -U postgres -h localhost >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }
q()      { docker exec evo-supabase-db psql -U postgres -d postgres -X -A -t -c "$1"; }

# ---------------------------------------------------------------- 0. preflight
stage "0 preflight"
for f in roles.sql schema.sql data.sql history_schema.sql history_data.sql; do
  [ -s "$RUN/$f" ] || fail "missing or empty $RUN/$f"
done
[ -f "$SNAP/PG_VERSION" ] || fail "no clean snapshot $SNAP (rebuild it: see selfhosted-cutover.md, step 3)"
FREE_GB=$(df --output=avail -BG "$BASE" | tail -1 | tr -dc 0-9)
[ "${FREE_GB:-0}" -ge 10 ] || fail "free disk ${FREE_GB}G < 10G"
docker inspect evo-supabase-db >/dev/null 2>&1 || fail "container evo-supabase-db not found"
grep -q -E '^EVO_AI_AGENT_PASSWORD=.' "$BASE/.env" || fail "EVO_AI_AGENT_PASSWORD missing in .env"
HAVE_ACL=0; [ -s "$RUN/acl_cloud.tsv" ] && HAVE_ACL=1
echo "    dump sizes: $(du -ch "$RUN"/*.sql | tail -1 | cut -f1); acl_cloud.tsv: $HAVE_ACL; free disk ${FREE_GB}G"
endst

# ---------------------------------------------------------------- 1. clean reset
stage "1 clean reset (stop db services, volume <- pgdata.clean, start db)"
cd "$BASE" || fail "cd $BASE"
docker compose stop $SERVICES >/dev/null 2>&1
docker compose stop db >/dev/null 2>&1
[ -n "$DATA" ] && [ "$DATA" = "/opt/evo-supabase/volumes/db/data" ] || fail "unexpected DATA path"
rm -rf "$DATA" && cp -a "$SNAP" "$DATA" || fail "copy of the snapshot failed"
docker compose start db >/dev/null 2>&1
wait_db || fail "db did not become ready"
EMPTY=$(q "select (select count(*) from auth.users) || ',' || (select count(*) from pg_namespace where nspname in ('platform','pgmq','platform_private'))")
[ "$EMPTY" = "0,0" ] || fail "snapshot is not empty (auth.users,schemas=$EMPTY)"
endst

# ---------------------------------------------------------------- 2. roles + schema + pgmq queues + data (ONE transaction)
stage "2 restore: roles + schema + pgmq + data (one transaction)"
{
  cat "$RUN/roles.sql"
  cat "$RUN/schema.sql"
  cat <<'SQL'
select pgmq.create('platform_work_v1');
select pgmq.create('platform_dead_letter_v1');
select pgmq.create('ai_agent_work_v1');
select pgmq.create('ai_agent_dead_letter_v1');
SET session_replication_role = replica;
SQL
  cat "$RUN/data.sql"      # includes the rows of the pgmq q_* (live queue) and a_* (archive) tables and the msg_id sequences
  cat <<'SQL'
-- In the cloud the queue/archive tables are ordinary tables (not extension members), the msg_id sequences stay members.
-- Detach the tables the same way, so a later pg_dump of this database carries their rows.
alter extension pgmq drop table pgmq.q_platform_work_v1;
alter extension pgmq drop table pgmq.q_platform_dead_letter_v1;
alter extension pgmq drop table pgmq.q_ai_agent_work_v1;
alter extension pgmq drop table pgmq.q_ai_agent_dead_letter_v1;
alter extension pgmq drop table pgmq.a_platform_work_v1;
alter extension pgmq drop table pgmq.a_platform_dead_letter_v1;
alter extension pgmq drop table pgmq.a_ai_agent_work_v1;
alter extension pgmq drop table pgmq.a_ai_agent_dead_letter_v1;
SQL
} | $PSQL_BASE -v ON_ERROR_STOP=1 --single-transaction > "$LOG/main.out" 2> "$LOG/main.err"
RC=$?
E=$(errs "$LOG/main.err"); echo "    rc=$RC errors=$E warnings=$(grep -c WARNING "$LOG/main.err" || true)"
[ "$RC" = 0 ] && [ "$E" = 0 ] || fail "main restore rc=$RC errors=$E (see $LOG/main.err); database left as is, nothing else was run"
endst

# ---------------------------------------------------------------- 3. migration ledger
stage "3 ledger (supabase_migrations)"
{ cat "$RUN/history_schema.sql"; echo "SET session_replication_role = replica;"; cat "$RUN/history_data.sql"; } \
  | $PSQL_BASE -v ON_ERROR_STOP=1 --single-transaction > "$LOG/hist.out" 2> "$LOG/hist.err"
RC=$?; E=$(errs "$LOG/hist.err"); echo "    rc=$RC errors=$E"
[ "$RC" = 0 ] && [ "$E" = 0 ] || fail "ledger restore rc=$RC errors=$E"
endst

# ---------------------------------------------------------------- 4. steps the dump does not carry
stage "4 post-restore: trigger, publication, policies, evo_ai_agent password, hook grants"
$PSQL_BASE -v ON_ERROR_STOP=1 < "$RESTORE/post-restore.sql" > "$LOG/post.out" 2> "$LOG/post.err" || fail "post-restore.sql failed (see $LOG/post.err)"
# 17 policies on storage.objects (13) and realtime.messages (4); the dump does not carry them
PRE=$(q "select count(*) from pg_policies where schemaname in ('storage','realtime')")
[ "$PRE" = 0 ] || fail "expected 0 policies before policies.sql, found $PRE"
$PSQL_BASE -v ON_ERROR_STOP=1 --single-transaction < "$RESTORE/policies.sql" > "$LOG/policies.out" 2> "$LOG/policies.err" || fail "policies.sql failed (see $LOG/policies.err)"
# evo_ai_agent password: SCRAM verifier computed here, so neither the password nor pg_stat_statements/log see the plain text
python3 -I - "$BASE/.env" <<'PY' | $PSQL_BASE -v ON_ERROR_STOP=1 > "$LOG/aipw.out" 2> "$LOG/aipw.err" || fail "setting the evo_ai_agent password failed"
import base64, hashlib, hmac, os, sys
pw = None
for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith("EVO_AI_AGENT_PASSWORD="):
        pw = line.rstrip("\n").split("=", 1)[1].strip().strip('"').strip("'")
if not pw: sys.exit("no password")
salt = os.urandom(16); it = 4096
salted = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, it)
ck = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
sk = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
b = lambda x: base64.b64encode(x).decode()
print("alter role evo_ai_agent with password 'SCRAM-SHA-256$%d:%s$%s:%s';" % (it, b(salt), b(hashlib.sha256(ck).digest()), b(sk)))
PY
endst

# ---------------------------------------------------------------- 5. grants: align with the cloud
stage "5 grants (public/platform/... ACL aligned with the cloud snapshot)"
snap_self() { $PSQL_BASE -A -t -F $'\t' -v ON_ERROR_STOP=1 -f - < "$RESTORE/acl-snapshot.sql" 2>>"$LOG/acl.err" | grep -v '^SET$' | LC_ALL=C sort -u; }
if [ "$HAVE_ACL" = 1 ]; then
  LC_ALL=C sort -u "$RUN/acl_cloud.tsv" -o "$RUN/acl_cloud.tsv"
  echo "    cloud rows: $(wc -l < "$RUN/acl_cloud.tsv")"
  # A table-level REVOKE also removes the column-level grant of the same privilege, so the alignment is repeated until it is stable.
  for PASS in 1 2 3; do
    snap_self > "$LOG/acl_self_pass$PASS.tsv"
    DIFF=$(comm -3 "$RUN/acl_cloud.tsv" "$LOG/acl_self_pass$PASS.tsv" | wc -l)
    echo "    pass $PASS: rows differing from the cloud before: $DIFF"
    [ "$DIFF" = 0 ] && break
    {
      echo "create temp table acl_cloud(kind text, obj text, sub text, grantee text, priv text, grantable text);"
      echo "copy acl_cloud from stdin;"; cat "$RUN/acl_cloud.tsv"; echo '\.'
      echo "create temp table acl_self(kind text, obj text, sub text, grantee text, priv text, grantable text);"
      echo "copy acl_self from stdin;"; cat "$LOG/acl_self_pass$PASS.tsv"; echo '\.'
      cat <<'SQL'
create temp table roles_here as select pg_catalog.quote_ident(rolname) as r from pg_roles union select 'PUBLIC';
create temp table acl_rev as select s.* from acl_self s
  where not exists (select 1 from acl_cloud c where (c.kind,c.obj,c.sub,c.grantee,c.priv,c.grantable) is not distinct from (s.kind,s.obj,s.sub,s.grantee,s.priv,s.grantable));
create temp table acl_grt as select c.* from acl_cloud c
  where c.grantee in (select r from roles_here)
    and not exists (select 1 from acl_self s where (c.kind,c.obj,c.sub,c.grantee,c.priv,c.grantable) is not distinct from (s.kind,s.obj,s.sub,s.grantee,s.priv,s.grantable));
select 'to revoke: ' || count(*) from acl_rev;
select 'to grant: ' || count(*) from acl_grt;
\set ON_ERROR_STOP off
select format('revoke %s%s on %s %s from %s',
         priv, case when kind = 'column' then ' (' || sub || ')' else '' end,
         case kind when 'column' then 'table' else kind end, obj, case when grantee = 'PUBLIC' then 'public' else grantee end)
  from acl_rev order by kind, obj \gexec
select format('grant %s%s on %s %s to %s%s',
         priv, case when kind = 'column' then ' (' || sub || ')' else '' end,
         case kind when 'column' then 'table' else kind end, obj, case when grantee = 'PUBLIC' then 'public' else grantee end,
         case when grantable = 't' then ' with grant option' else '' end)
  from acl_grt order by kind, obj \gexec
SQL
    } | $PSQL_BASE > "$LOG/acl_align_pass$PASS.out" 2> "$LOG/acl_align_pass$PASS.err"
    echo "    pass $PASS: $(grep -E -o 'to (revoke|grant): [0-9]+' "$LOG/acl_align_pass$PASS.out" | tr '\n' ' ') statement errors: $(errs "$LOG/acl_align_pass$PASS.err")"
  done
  snap_self > "$LOG/acl_self_after.tsv"
  DIFF=$(comm -3 "$RUN/acl_cloud.tsv" "$LOG/acl_self_after.tsv" | wc -l)
  echo "    ACL rows differing from the cloud at the end: $DIFF"
  echo "acl_diff_after=$DIFF" >> "$LOG/checks.txt"
  [ "$DIFF" = 0 ] || fail "ACL still differs from the cloud ($DIFF rows, see $LOG/acl_self_after.tsv)"
else
  echo "    no acl_cloud.tsv: legacy acl_fix.sql + acl_fix2.sql only"
  $PSQL_BASE -v ON_ERROR_STOP=0 < "$RESTORE/acl_fix.sql" > "$LOG/acl_fix.out" 2> "$LOG/acl_fix.err"
  $PSQL_BASE -v ON_ERROR_STOP=0 < "$RESTORE/acl_fix2.sql" > "$LOG/acl_fix2.out" 2> "$LOG/acl_fix2.err"
fi
HOOK=$(q "select has_function_privilege('supabase_auth_admin','platform_private.custom_access_token_hook(jsonb)','execute') and has_schema_privilege('supabase_auth_admin','platform_private','usage')")
[ "$HOOK" = t ] || fail "supabase_auth_admin cannot execute the access-token hook after the ACL step"
endst

# ---------------------------------------------------------------- 6. planner statistics
stage "6 analyze"
q "analyze" >/dev/null 2>"$LOG/analyze.err"
endst

# ---------------------------------------------------------------- 7. services re-read the database
stage "7 start services (auth storage realtime rest supavisor meta studio imgproxy)"
cd "$BASE" || fail "cd $BASE"
docker compose start $SERVICES >/dev/null 2>&1
for _ in $(seq 1 60); do
  N=$(docker ps --filter "name=evo-supabase-" --format '{{.Names}} {{.Status}}' | grep -E 'evo-supabase-(auth|storage|realtime|rest|supavisor) ' | grep -c '(healthy)')
  [ "$N" -ge 5 ] && break; sleep 3
done
echo "    healthy core services: $N/5"
[ "$N" -ge 5 ] || fail "core services not healthy ($N/5); see docker ps"
endst

# ---------------------------------------------------------------- 8. checks (counts only)
stage "8 checks"
{
  echo "tag=$TAG finished=$(date -u +%FT%TZ)"
  echo "ledger=$(q "select count(*) || ' min=' || min(version) || ' max=' || max(version) from supabase_migrations.schema_migrations")"
  echo "policies_storage_realtime=$(q "select count(*) from pg_policies where schemaname in ('storage','realtime')")"
  echo "publication_supabase_realtime_tables=$(q "select count(*) from pg_publication_tables where pubname='supabase_realtime'")"
  echo "pgmq_queues=$(q "select count(*) from pgmq.meta")"
  echo "signup_trigger=$(q "select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created'")"
  echo "evo_ai_agent=$(q "select rolcanlogin::text || ' limit=' || rolconnlimit || ' password_set=' || (rolpassword is not null)::text from pg_authid where rolname='evo_ai_agent'")"
  echo "hook_execute=$HOOK"
  echo "extensions=$(q "select string_agg(extname, ',' order by extname) from pg_extension")"
  echo "supavisor_tenants=$(docker exec evo-supabase-db psql -U postgres -d _supabase -X -A -t -c "select count(*) from _supavisor.tenants")"
  echo "realtime_tenants=$(q "select count(*) from _realtime.tenants")"
  echo "--- counts"
  docker exec -i evo-supabase-db psql -U postgres -d postgres -X -A -t -F $'\t' -f - < "$RESTORE/counts.sql"
} >> "$LOG/checks.txt" 2>&1
endst

TOTAL=$(( $(date +%s) - T_ALL ))
printf 'TOTAL\t%s\n' "$TOTAL" >> "$LOG/timing.tsv"
echo "FINISHED tag=$TAG total=${TOTAL}s   (timing: $LOG/timing.tsv, checks: $LOG/checks.txt)"
