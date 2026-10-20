#!/bin/bash
# EVO: put the Resend API key into SMTP_PASS of the self-hosted Supabase and recreate ONLY the auth service.
# usage (key on stdin, never as an argument):   printf '%s' "$RESEND_KEY" | ssh hermes-vps /opt/evo-supabase/ops/set-smtp-pass.sh
# Prints only lengths and health, never the key.
set -euo pipefail
umask 077
ENV=/opt/evo-supabase/.env
KEY="$(cat)"
[ -n "$KEY" ] || { echo "empty key"; exit 2; }
case "$KEY" in re_[A-Za-z0-9_]*) ;; *) echo "this does not look like a Resend key (re_...)"; exit 2;; esac
case "$KEY" in *[!A-Za-z0-9_]*) echo "unexpected characters in the key"; exit 2;; esac
cp -p "$ENV" "$ENV.bak-$(date -u +%Y%m%d-%H%M%S)-before-smtp-pass"
KEY="$KEY" python3 -I - "$ENV" <<'PY'
import os, sys, tempfile
path = sys.argv[1]; key = os.environ["KEY"]
lines = open(path, encoding="utf-8").read().split("\n")
n = 0
for i, l in enumerate(lines):
    if l.startswith("SMTP_PASS="):
        lines[i] = "SMTP_PASS=" + key; n += 1
if n != 1: sys.exit("expected exactly one SMTP_PASS line, found %d" % n)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path)); os.write(fd, "\n".join(lines).encode()); os.close(fd)
os.chmod(tmp, 0o600); os.replace(tmp, path)
PY
cd /opt/evo-supabase
docker compose up -d --no-deps auth >/dev/null 2>&1
for _ in $(seq 1 40); do docker ps --filter name=evo-supabase-auth --format '{{.Status}}' | grep -q '(healthy)' && break; sleep 3; done
echo "auth: $(docker ps --filter name=evo-supabase-auth --format '{{.Status}}')"
echo "GOTRUE_SMTP_PASS length in the container: $(docker exec evo-supabase-auth printenv GOTRUE_SMTP_PASS | tr -d '\n' | wc -c)"
