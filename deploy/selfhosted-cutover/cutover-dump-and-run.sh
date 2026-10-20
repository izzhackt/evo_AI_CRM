#!/bin/bash
# EVO cutover, Mac side. Reads the CLOUD only (Supabase CLI dumps + Management API read-only queries); writes only into $WORK
# (0700) and to hermes-vps:/opt/evo-supabase/restore/runs/<tag>/. The CLI token comes from the Keychain, inside this process only.
# Dumps with data are shredded here after the upload.
#
#   cutover-dump-and-run.sh predump <ptag>                         BEFORE the freeze (app still running): roles, schema, history_schema
#                                                                   + fingerprint of the cloud schema. About 5-6 minutes, no downtime.
#   cutover-dump-and-run.sh run <tag> [--predump <ptag>] [--no-restore]
#                                                                   AFTER the freeze: data, history_data, ACL snapshot; with --predump the
#                                                                   schema files are reused if the cloud fingerprint is unchanged (else it stops);
#                                                                   then upload and the server script cutover-restore.sh.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:?usage: predump <ptag> | run <tag> [--predump <ptag>] [--no-restore]}"; TAG="${2:?tag}"; shift 2
PREDUMP=""; NORESTORE=0
while [ $# -gt 0 ]; do case "$1" in --predump) PREDUMP="$2"; shift 2;; --no-restore) NORESTORE=1; shift;; *) echo "unknown arg $1"; exit 2;; esac; done
case "$TAG$PREDUMP" in *[!A-Za-z0-9._-]*) echo "bad tag"; exit 2;; esac
CLI="${CLI:-/opt/homebrew/bin/supabase}"; REF=iosckaqtovbbnssqcpde; REMOTE=hermes-vps
WORK_ROOT="${WORK_ROOT:-${TMPDIR:-/tmp}/evo-cutover}"; mkdir -p "$WORK_ROOT"; chmod 700 "$WORK_ROOT"   # never inside the repository: the dumps carry personal data
WORK="$WORK_ROOT/dump-$TAG"; RDIR=/opt/evo-supabase/restore/runs/$TAG
T0=$(date +%s); t() { echo "[$(date +%T)] +$(( $(date +%s) - T0 ))s  $*"; }
mkdir -p "$WORK"; cd "$WORK"
export SUPABASE_ACCESS_TOKEN="$(security find-generic-password -s "Supabase CLI" -a supabase -w)" SUPABASE_CLI_DISABLE_UPDATE_CHECK=1
D() { "$CLI" db dump --linked --workdir "$WORK" "$@" >/dev/null 2>>dump.err; }
cloud_sql() { # file.sql -> JSON on stdout (read-only Management API query; token from the environment)
  python3 -I - "$1" "$REF" <<'PY'
import json, os, sys, urllib.request
req = urllib.request.Request("https://api.supabase.com/v1/projects/%s/database/query" % sys.argv[2],
    data=json.dumps({"query": open(sys.argv[1]).read(), "read_only": True}).encode(), method="POST",
    headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"], "Content-Type": "application/json"})
print(urllib.request.urlopen(req, timeout=120).read().decode())
PY
}
fingerprint() { cloud_sql "$HERE/schema-fingerprint.sql" | python3 -I -c 'import json,sys; r=json.load(sys.stdin); print(r[0]["fp"], r[0]["n"])'; }

: > dump.err
t "link"; "$CLI" link --project-ref "$REF" --workdir "$WORK" >/dev/null 2>&1

if [ "$MODE" = predump ]; then
  t "fingerprint before"; F1="$(fingerprint)"; echo "$F1" > fingerprint.txt
  t "roles";           D -f roles.sql --role-only
  t "history_schema";  D -f history_schema.sql --schema supabase_migrations
  t "schema (the slow one)"; D -f schema.sql
  t "fingerprint after"; F2="$(fingerprint)"
  [ "$F1" = "$F2" ] || { echo "the cloud schema changed while dumping; run predump again"; exit 1; }
  for f in roles schema history_schema; do [ -s "$f.sql" ] || { echo "MISSING $f.sql"; exit 1; }; done
  t "predump ready in $WORK ($(du -ch roles.sql schema.sql history_schema.sql | tail -1 | cut -f1)); fingerprint $(cut -c1-12 fingerprint.txt)"
  exit 0
fi

[ "$MODE" = run ] || { echo "mode must be predump or run"; exit 2; }
if [ -n "$PREDUMP" ]; then
  PD="$WORK_ROOT/dump-$PREDUMP"
  for f in roles.sql schema.sql history_schema.sql fingerprint.txt; do [ -s "$PD/$f" ] || { echo "predump $PREDUMP incomplete: $f"; exit 1; }; done
  t "fingerprint now vs predump"; NOW="$(fingerprint)"
  [ "$NOW" = "$(cat "$PD/fingerprint.txt")" ] || { echo "THE CLOUD SCHEMA CHANGED since predump $PREDUMP; run without --predump (full dump)"; exit 1; }
  cp "$PD/roles.sql" "$PD/schema.sql" "$PD/history_schema.sql" .
  t "schema files reused from predump $PREDUMP (cloud fingerprint unchanged)"
else
  t "roles";          D -f roles.sql --role-only
  t "history_schema"; D -f history_schema.sql --schema supabase_migrations
  t "schema";         D -f schema.sql
fi
t "ACL snapshot (API) in the background"
( cloud_sql "$HERE/acl-snapshot.sql" > acl_cloud.json && python3 -I "$HERE/json2tsv.py" acl_cloud.json kind,obj,sub,grantee,priv,grantable | LC_ALL=C sort -u > acl_cloud.tsv ) &
ACLPID=$!
t "data";         D -f data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
t "history_data"; D -f history_data.sql --use-copy --data-only --schema supabase_migrations
wait $ACLPID || { echo "ACL snapshot failed"; exit 1; }
for f in roles.sql schema.sql data.sql history_schema.sql history_data.sql acl_cloud.tsv; do [ -s "$f" ] || { echo "MISSING $f"; exit 1; }; done
t "dumps done: $(du -ch roles.sql schema.sql data.sql history_schema.sql history_data.sql | tail -1 | cut -f1), ACL rows $(wc -l < acl_cloud.tsv)"

ssh "$REMOTE" "umask 077; mkdir -p $RDIR && chmod 700 $RDIR"
scp -q roles.sql schema.sql data.sql history_schema.sql history_data.sql acl_cloud.tsv "$REMOTE:$RDIR/"
ssh "$REMOTE" "chmod 600 $RDIR/*"
for f in schema.sql data.sql history_data.sql acl_cloud.tsv; do
  [ "$(shasum -a 256 "$f" | cut -c1-64)" = "$(ssh "$REMOTE" "sha256sum $RDIR/$f" | cut -c1-64)" ] || { echo "HASH MISMATCH $f"; exit 1; }
done
t "uploaded and hash-verified"
shred -u data.sql history_data.sql 2>/dev/null || rm -f data.sql history_data.sql      # personal data: gone from the Mac
[ "$NORESTORE" = 1 ] && { t "stopped before restore (--no-restore)"; exit 0; }
t "server: cutover-restore.sh $TAG"
ssh "$REMOTE" "/opt/evo-supabase/restore/cutover-restore.sh $TAG"
t "server restore finished"
echo "next: ssh $REMOTE /opt/evo-supabase/restore/rehearsal-checks.sh ; $HERE/cutover-compare.sh"
