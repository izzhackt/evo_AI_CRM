#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
umask 077

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEADLINE_RUNNER="${REPO_ROOT}/scripts/run-command-with-deadline.mjs"
readonly SOURCE_CADDYFILE="${REPO_ROOT}/agent-lead2-inbox/deploy/Caddyfile.evo-edge"
readonly CADDY_IMAGE="caddy@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"
readonly RUN_ID="p7b-edge-$$_${RANDOM}"
readonly CONTAINER_NAME="evo-platform-${RUN_ID}"
readonly TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/evo-p7b-edge.XXXXXX")"
readonly TEST_CADDYFILE="${TEMP_DIR}/Caddyfile"
readonly RESPONSE_FILE="${TEMP_DIR}/response.txt"
readonly LOG_FILE="${TEMP_DIR}/caddy.log"
readonly START_STDERR_FILE="${TEMP_DIR}/caddy-start.stderr"
readonly AUTH_SENTINEL="p7b-authorization-must-not-enter-edge-logs"
readonly HMAC_SENTINEL="$(printf 'a%.0s' {1..64})"

container_cleanup_armed=false

run_with_deadline() {
  local timeout_ms=$1
  shift
  node "${DEADLINE_RUNNER}" "${timeout_ms}" "$@"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local exit_code=$?
  trap - EXIT HUP INT TERM
  set +e
  if [[ "${container_cleanup_armed}" == true ]]; then
    run_with_deadline 15000 docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1
  fi
  rm -rf -- "${TEMP_DIR}"
  exit "${exit_code}"
}

trap cleanup EXIT HUP INT TERM

[[ -x "${DEADLINE_RUNNER}" || -f "${DEADLINE_RUNNER}" ]] \
  || fail "The bounded command runner is missing."
[[ -f "${SOURCE_CADDYFILE}" ]] \
  || fail "The canonical EVO edge Caddyfile is missing."
command -v docker >/dev/null 2>&1 \
  || fail "A local container engine is required for the Caddy runtime proof."

docker_context="$(run_with_deadline 10000 docker context show 2>/dev/null)" \
  || fail "Unable to determine the active container context."
if [[ "$(uname -s)" == "Darwin" ]]; then
  command -v orb >/dev/null 2>&1 \
    || fail "OrbStack is required for macOS container-backed tests."
  [[ "$(run_with_deadline 10000 orb status 2>/dev/null)" == "Running" ]] \
    || fail "OrbStack must be Running before the Caddy runtime proof."
  [[ "${docker_context}" == "orbstack" ]] \
    || fail "The active Docker context must be exactly orbstack on macOS."
fi

# Build from the exact production Caddyfile while extending its one existing
# global options block. Defining a second global block would be invalid Caddy
# syntax, and importing a rewritten snippet would no longer exercise the
# production edge source of truth.
awk '
  NR == 1 {
    if ($0 != "{") exit 64
    print
    print "\tadmin off"
    print "\tauto_https off"
    next
  }
  { print }
' "${SOURCE_CADDYFILE}" >"${TEST_CADDYFILE}" \
  || fail "Unable to prepare the exact disposable Caddy configuration."

cat >>"${TEST_CADDYFILE}" <<'CADDY'
:8080 {
	import evo_app
	respond 204
}
CADDY

run_with_deadline 180000 docker pull "${CADDY_IMAGE}" >/dev/null \
  || fail "Unable to obtain the exact pinned Caddy test image."

# Arm exact-name cleanup before Docker receives the create request. A Docker
# daemon can create the container and then stall before the CLI returns; the
# EXIT trap must still remove that one uniquely named disposable container.
container_cleanup_armed=true
run_with_deadline 30000 docker run --detach \
  --name "${CONTAINER_NAME}" \
  --label "com.evo.test=p7b-edge" \
  --read-only \
  --tmpfs /data:rw,noexec,nosuid,size=16m \
  --tmpfs /config:rw,noexec,nosuid,size=16m \
  --cpus 0.50 \
  --memory 128m \
  --pids-limit 64 \
  --log-driver json-file \
  --log-opt max-size=1m \
  --log-opt max-file=1 \
  --publish 127.0.0.1::8080 \
  --volume "${TEST_CADDYFILE}:/test/Caddyfile:ro" \
  "${CADDY_IMAGE}" \
  caddy run --config /test/Caddyfile --adapter caddyfile \
  >/dev/null 2>"${START_STDERR_FILE}" \
  || {
    sed -n '1,20p' "${START_STDERR_FILE}" >&2
    fail "The exact disposable Caddy container failed to start."
  }

host_port="$(
  run_with_deadline 10000 docker port "${CONTAINER_NAME}" 8080/tcp \
    | awk -F: '/127[.]0[.]0[.]1:/ { print $NF; exit }'
)" || fail "Unable to inspect the exact disposable Caddy port."
[[ "${host_port}" =~ ^[0-9]+$ ]] \
  || fail "The disposable Caddy port was invalid."

edge_origin="http://127.0.0.1:${host_port}"
ready=false
for _ in {1..40}; do
  status="$(
    curl --silent --show-error \
      --output "${RESPONSE_FILE}" \
      --write-out '%{http_code}' \
      --header 'Host: crm.evoadmissions.com' \
      "${edge_origin}/api/health" 2>/dev/null || true
  )"
  if [[ "${status}" == "204" ]]; then
    ready=true
    break
  fi
  sleep 0.25
done
[[ "${ready}" == true ]] \
  || fail "The disposable Caddy edge did not become ready."

for private_path in \
  /api/readiness \
  /api/readiness/near \
  /metrics \
  /metrics/near \
  /api/internal/p7b \
  /admin/p7b; do
  status="$(
    curl --silent --show-error \
      --output "${RESPONSE_FILE}" \
      --write-out '%{http_code}' \
      --header 'Host: crm.evoadmissions.com' \
      --header "Authorization: Bearer ${AUTH_SENTINEL}" \
      --header "x-evo-observability-hmac: ${HMAC_SENTINEL}" \
      "${edge_origin}${private_path}"
  )" || fail "The disposable Caddy request failed."
  [[ "${status}" == "404" ]] \
    || fail "The public edge did not deny ${private_path}."
done

run_with_deadline 10000 docker logs "${CONTAINER_NAME}" >"${LOG_FILE}" 2>&1 \
  || fail "Unable to inspect bounded disposable Caddy logs."
if grep -Fq -- "${AUTH_SENTINEL}" "${LOG_FILE}" \
  || grep -Fq -- "${HMAC_SENTINEL}" "${LOG_FILE}"; then
  fail "A private credential-bearing header entered Caddy logs."
fi

log_driver="$(
  run_with_deadline 10000 docker inspect \
    --format '{{.HostConfig.LogConfig.Type}}' "${CONTAINER_NAME}"
)" || fail "Unable to inspect the disposable Caddy log driver."
log_max_size="$(
  run_with_deadline 10000 docker inspect \
    --format '{{index .HostConfig.LogConfig.Config "max-size"}}' \
    "${CONTAINER_NAME}"
)" || fail "Unable to inspect the disposable Caddy log bound."
memory_limit="$(
  run_with_deadline 10000 docker inspect \
    --format '{{.HostConfig.Memory}}' "${CONTAINER_NAME}"
)" || fail "Unable to inspect the disposable Caddy memory bound."
pids_limit="$(
  run_with_deadline 10000 docker inspect \
    --format '{{.HostConfig.PidsLimit}}' "${CONTAINER_NAME}"
)" || fail "Unable to inspect the disposable Caddy PID bound."

[[ "${log_driver}" == "json-file" && "${log_max_size}" == "1m" ]] \
  || fail "The disposable Caddy log bounds were not applied."
[[ "${memory_limit}" == "134217728" && "${pids_limit}" == "64" ]] \
  || fail "The disposable Caddy resource bounds were not applied."

printf 'Verified the pinned disposable Caddy runtime denies every private EVO route, redacts credential headers, and enforces bounded resources/logs.\n'
