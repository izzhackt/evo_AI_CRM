#!/bin/bash
# EVO cutover, Mac side: cloud vs self-hosted, counts AND per-table content hashes (md5 of row text; no contents shown).
# usage: cutover-compare.sh          (read-only on both sides)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export SUPABASE_ACCESS_TOKEN="$(security find-generic-password -s "Supabase CLI" -a supabase -w)"
python3 -I - "$HERE" <<'PY'
import json, os, subprocess, sys, urllib.request
here = sys.argv[1]
def cloud(sqlfile):
    req = urllib.request.Request("https://api.supabase.com/v1/projects/iosckaqtovbbnssqcpde/database/query",
        data=json.dumps({"query": open(os.path.join(here, sqlfile)).read(), "read_only": True}).encode(), method="POST",
        headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"], "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=300).read())
def selfhosted(sqlfile):
    p = subprocess.run(["ssh", "hermes-vps", "docker exec -i evo-supabase-db psql -U postgres -d postgres -X -q -A -t -F '|' -f -"],
                       input=open(os.path.join(here, sqlfile)).read(), capture_output=True, text=True, check=True)
    return {l.split("|")[0]: l.split("|")[1] for l in p.stdout.splitlines() if "|" in l}
c = {r["t"]: r["n"] for r in cloud("counts.sql")}; s = selfhosted("counts.sql")
bad = 0
print("%-46s %10s %10s" % ("table (row count)", "cloud", "self"))
for k in sorted(c):
    same = str(c[k]) == s.get(k); bad += not same
    print("%-46s %10s %10s%s" % (k, c[k], s.get(k), "" if same else "   <-- DIFFERENT"))
print("tables with different counts:", bad)
ch = {r["t"]: r["h"] for r in cloud("rowhash.sql")}; sh = selfhosted("rowhash.sql")
badh = [k for k in sorted(ch) if ch[k] != sh.get(k)]
print("content hashes: %d tables compared, different: %d %s" % (len(ch), len(badh), badh))
sys.exit(1 if (bad or badh) else 0)
PY
