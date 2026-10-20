#!/bin/bash
# Launcher for the one-off Storage copy (cloud -> self-hosted). Contains no secrets.
# usage: storage-copy-run.sh dryrun|copy   (env: ONLY_BUCKET, LIMIT, CONCURRENCY optional)
# The cloud key is read from the production env file into this process only,
# handed to the one-off container through the environment and never printed or written.
set -euo pipefail
set +x

MODE="${1:-dryrun}"
case "$MODE" in dryrun|copy) ;; *) echo "mode must be dryrun|copy"; exit 2;; esac

RESTORE=/opt/evo-supabase/restore
VOLUME=/opt/evo-supabase/volumes/storage
IMAGE=supabase/storage-api:v1.81.0
NAME=evo-storage-copy

# --- preflight: stop conditions from the task ---
mem_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
free_kb=$(df --output=avail -k "$VOLUME" | tail -1 | tr -d ' ')
echo "preflight: MemAvailable=$((mem_kb/1024/1024)) GiB, free=$((free_kb/1024/1024)) GiB"
if [ "$mem_kb" -lt $((4*1024*1024)) ]; then echo "STOP: MemAvailable < 4 GiB"; exit 3; fi
if [ "$free_kb" -lt $((60*1024*1024)) ]; then echo "STOP: free disk < 60 GB"; exit 3; fi

# --- secrets, in-process only ---
read_env() { grep -E "^$1=" /opt/evo-crm/.env.production | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }
CLOUD_URL="$(read_env NEXT_PUBLIC_SUPABASE_URL)"
CLOUD_KEY="$(read_env EVO_PLATFORM_SUPABASE_SECRET_KEY)"
DATABASE_URL="$(docker exec evo-supabase-storage printenv DATABASE_URL)"
[ -n "$CLOUD_URL" ] && [ -n "$CLOUD_KEY" ] && [ -n "$DATABASE_URL" ] || { echo "missing env values"; exit 4; }
export CLOUD_URL CLOUD_KEY DATABASE_URL MODE
export CONCURRENCY="${CONCURRENCY:-6}" ONLY_BUCKET="${ONLY_BUCKET:-}" LIMIT="${LIMIT:-0}"

VOLMODE=rw
[ "$MODE" = dryrun ] && VOLMODE=ro

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --restart on-failure:10 --name "$NAME" \
  --network evo-supabase_default \
  --memory 512m --memory-swap 512m --oom-score-adj 500 \
  --cpus 1 --cpu-shares 256 --pids-limit 256 \
  --tmpfs /tmp:size=64m \
  -e CLOUD_URL -e CLOUD_KEY -e DATABASE_URL -e MODE -e CONCURRENCY -e ONLY_BUCKET -e LIMIT \
  -v "$VOLUME:/var/lib/storage:$VOLMODE" \
  -v "$RESTORE:/restore" \
  -v "$RESTORE/storage-copy.cjs:/job/storage-copy.cjs:ro" \
  --entrypoint node \
  "$IMAGE" --max-old-space-size=300 /job/storage-copy.cjs >/dev/null
echo "started $NAME mode=$MODE concurrency=$CONCURRENCY only_bucket=${ONLY_BUCKET:-all} limit=$LIMIT"
