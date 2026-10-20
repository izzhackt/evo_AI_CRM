#!/bin/bash
# EVO cutover: point /opt/evo-crm/.env.production at the self-hosted Supabase. Run as root on hermes-vps.
#   env-switch.sh check    build the candidate (3 values replaced) in /root/contract-check/candidate.env and validate it with the
#                          repository's own env contract (including the live key probes against the public self-hosted URL)
#   env-switch.sh apply    check, then atomically install the candidate as /opt/evo-crm/.env.production (0600)
# Replaces exactly NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, EVO_PLATFORM_SUPABASE_SECRET_KEY; format NAME=value,
# no quotes, no export. Never prints a value.
set -uo pipefail
umask 077
MODE="${1:-}"; [ "$MODE" = check ] || [ "$MODE" = apply ] || { echo "usage: env-switch.sh check|apply"; exit 2; }
PROD=/opt/evo-crm/.env.production; SELF=/opt/evo-supabase/.env; D=/root/contract-check
[ -d "$D" ] && [ -s "$D/evo-app-env-contract.mjs" ] && [ -s "$D/env.production.example" ] || { echo "missing $D/evo-app-env-contract.mjs or env.production.example"; exit 2; }
python3 -I - "$PROD" "$SELF" "$D/candidate.env" <<'PY' || exit 1
import os, sys
prod, selfh, out = sys.argv[1:4]
def parse(path):
    d = {}
    for l in open(path, encoding="utf-8").read().split("\n"):
        if "=" in l and not l.lstrip().startswith("#"):
            k, v = l.split("=", 1); d[k.strip()] = v.strip().strip('"').strip("'")
    return d
s = parse(selfh)
new = {"NEXT_PUBLIC_SUPABASE_URL": "https://supabase.evoadmissions.com",
       "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": s["SUPABASE_PUBLISHABLE_KEY"],
       "EVO_PLATFORM_SUPABASE_SECRET_KEY": s["SUPABASE_SECRET_KEY"]}
assert new["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].startswith("sb_publishable_") and new["EVO_PLATFORM_SUPABASE_SECRET_KEY"].startswith("sb_secret_")
lines = open(prod, encoding="utf-8").read().split("\n"); seen = {k: 0 for k in new}; changed = []
for i, l in enumerate(lines):
    for k in new:
        if l.startswith(k + "="):
            seen[k] += 1
            if l != k + "=" + new[k]: changed.append(k)
            lines[i] = k + "=" + new[k]
assert all(v == 1 for v in seen.values()), "each of the three names must appear exactly once: %r" % seen
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, "\n".join(lines).encode()); os.close(fd)
print("candidate built; names that differ from the current file:", ",".join(changed) if changed else "(none)")
PY
chmod 600 "$D/candidate.env"
# only these three lines may differ
DIFFN=$(diff <(sed 's/=.*//' "$PROD") <(sed 's/=.*//' "$D/candidate.env") | wc -l); echo "name list identical to the current file: $([ "$DIFFN" = 0 ] && echo yes || echo NO)"
[ "$DIFFN" = 0 ] || exit 1
echo "lines whose value differs: $(diff "$PROD" "$D/candidate.env" | grep -c '^>')"
node "$D/evo-app-env-contract.mjs" --example "$D/env.production.example" --env "$D/candidate.env" --supabase-project-ref selfhosted --verify-supabase-keys \
  && echo "contract + key probes: OK" || { echo "contract check FAILED"; exit 1; }
if [ "$MODE" = apply ]; then
  [ "$(stat -c %a "$PROD")" = 600 ] || { echo "unexpected mode on $PROD"; exit 1; }
  T=$(mktemp /opt/evo-crm/.env.production.new.XXXXXX) && cat "$D/candidate.env" > "$T" && chown --reference="$PROD" "$T" && chmod 600 "$T" && mv -f "$T" "$PROD" \
    && echo "installed: $(stat -c '%a %U:%G' "$PROD"), nothing printed" || { echo "install FAILED"; exit 1; }
fi
