#!/bin/bash
# EVO cutover: temporary maintenance answer (503) on the EVO edge for the CRM/app hosts (everything except /api/health)
# and for the website lead POST. The CRM container itself is NOT stopped (the release controller requires a running,
# healthy app and a working public /api/health). Run as root on hermes-vps.
#   edge-maint.sh on            put the maintenance rules into the live Caddyfile (in place, same inode), validate, reload
#   edge-maint.sh off           put the saved original back, validate, reload
#   edge-maint.sh watch <id>    run in the background: call `off` as soon as the container behind evo-crm-app-1 is not <id>
#                               any more (the release replaced it) or after MAX_MIN minutes
set -uo pipefail
umask 077
LIVE=/opt/evo-releases/ee8a825ebc72f84449636e3feaefab7a330913d4/repo/agent-lead2-inbox/deploy/Caddyfile.evo-edge
SAVED=/root/Caddyfile.evo-edge.pre-maintenance
LOG=/root/edge-maint.log
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
reload() {
  docker exec evo-edge-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { log "VALIDATE FAILED"; return 1; }
  docker exec evo-edge-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { log "RELOAD FAILED"; return 1; }
  return 0
}
build() { # $1 = source Caddyfile -> /root/Caddyfile.evo-edge.maintenance (validated in the real container)
  python3 -I - "$1" <<'PY' > /root/Caddyfile.evo-edge.maintenance || { log "transform failed"; exit 1; }
import sys
s = open(sys.argv[1], encoding="utf-8").read()
head = "crm.evoadmissions.com, app.evoadmissions.com {\n"
assert s.count(head) == 1
maint = head + """\t# EVO-CUTOVER-MAINTENANCE (temporary)
\t@evo_cutover_maint not path /api/health
\theader @evo_cutover_maint Retry-After "600"
\trespond @evo_cutover_maint "Идёт плановый переход на новую базу данных. Вернёмся через несколько минут." 503
"""
s = s.replace(head, maint)
leads = "\t\thandle @website_intake {\n"
assert s.count(leads) == 1
s = s.replace(leads, leads + "\t\t\t# EVO-CUTOVER-MAINTENANCE (temporary)\n\t\t\trespond \"Заявки временно не принимаются, повторите через несколько минут.\" 503\n")
sys.stdout.write(s)
PY
  # a dry check of the transformed file in the real container before touching the live file
  docker exec -i evo-edge-caddy caddy validate --config /dev/stdin --adapter caddyfile < /root/Caddyfile.evo-edge.maintenance >/dev/null 2>&1 || { log "maintenance file does not validate; live file untouched"; exit 1; }
}
case "${1:-}" in
  dry)
    [ -e "$SAVED" ] && SRC="$SAVED" || SRC="$LIVE"
    build "$SRC" && log "dry run ok: /root/Caddyfile.evo-edge.maintenance validates (live file untouched)"
    ;;
  on)
    [ -e "$SAVED" ] || cp -p "$LIVE" "$SAVED"
    build "$SAVED" || exit 1
    cat /root/Caddyfile.evo-edge.maintenance > "$LIVE" && reload && log "MAINTENANCE ON" || { cat "$SAVED" > "$LIVE"; reload; log "on failed, original restored"; exit 1; }
    ;;
  off)
    [ -s "$SAVED" ] || { log "no saved original"; exit 1; }
    cat "$SAVED" > "$LIVE" && reload && log "MAINTENANCE OFF (original restored, sha $(sha256sum "$LIVE" | cut -c1-12))" || { log "off FAILED"; exit 1; }
    ;;
  watch)
    ORIG="${2:?container id}"; MAX_MIN="${MAX_MIN:-40}"; END=$(( $(date +%s) + MAX_MIN * 60 ))
    log "watching evo-crm-app-1 (original ${ORIG:0:12}), limit ${MAX_MIN} min"
    while [ "$(date +%s)" -lt "$END" ]; do
      CUR=$(docker ps --filter name='^evo-crm-app-1$' --filter status=running --format '{{.ID}}' | head -1)
      FULL=""; [ -n "$CUR" ] && FULL=$(docker inspect -f '{{.Id}}' "$CUR" 2>/dev/null)
      if [ -n "$FULL" ] && [ "$FULL" != "$ORIG" ]; then log "app container replaced (${FULL:0:12})"; "$0" off; exit $?; fi
      sleep 1
    done
    log "time limit reached, lifting maintenance"; "$0" off
    ;;
  *) echo "usage: edge-maint.sh dry|on|off|watch <full container id>"; exit 2;;
esac
