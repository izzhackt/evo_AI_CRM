#!/usr/bin/env bash
set -euo pipefail

readonly CLAMAV_IMAGE="clamav/clamav:1.5.3-debian13-slim@sha256:741e6c447241220e0792a901befcaec1d55a755c5097fc9cd88d7fd8be251a5c"
readonly CONTAINER_NAME="evo-bw8b-clamav-test-${PPID}-$$"
CONTAINER_ID=""

cleanup() {
  local original_status=$?
  local actual_name=""
  trap - EXIT INT TERM
  if [[ -n "${CONTAINER_ID}" && "${CONTAINER_ID}" =~ ^[0-9a-f]{12,64}$ ]]; then
    for _ in $(seq 1 5); do
      if ! docker inspect "${CONTAINER_ID}" >/dev/null 2>&1; then
        exit "${original_status}"
      fi
      actual_name="$(docker inspect --format '{{.Name}}' "${CONTAINER_ID}")"
      if [[ "${actual_name}" != "/${CONTAINER_NAME}" ]]; then
        echo "BLOCKED: refusing to clean a container outside this exact test run." >&2
        exit 1
      fi
      docker rm --force "${CONTAINER_ID}" >/dev/null 2>&1 || true
      sleep 1
    done
    if docker inspect "${CONTAINER_ID}" >/dev/null 2>&1; then
      echo "BLOCKED: exact ClamAV test container cleanup did not complete." >&2
      exit 1
    fi
  fi
  exit "${original_status}"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "BLOCKED: Docker CLI is required for real ClamAV integration proof." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "BLOCKED: Docker daemon is unavailable for real ClamAV integration proof." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "BLOCKED: Node.js is required for the ClamAV adapter integration proof." >&2
  exit 1
fi

if ! docker image inspect "${CLAMAV_IMAGE}" >/dev/null 2>&1; then
  if ! docker pull "${CLAMAV_IMAGE}"; then
    echo "BLOCKED: pinned official ClamAV image ${CLAMAV_IMAGE} is unavailable." >&2
    exit 1
  fi
fi

CONTAINER_ID="$(docker run --detach \
  --name "${CONTAINER_NAME}" \
  --publish 127.0.0.1::3310/tcp \
  --pids-limit 512 \
  --memory 4g \
  --cpus 2 \
  "${CLAMAV_IMAGE}")"

if [[ ! "${CONTAINER_ID}" =~ ^[0-9a-f]{12,64}$ ]]; then
  echo "BLOCKED: Docker did not return the exact ClamAV test container ID." >&2
  exit 1
fi

health="starting"
for _ in $(seq 1 150); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${CONTAINER_ID}")"
  state="$(docker inspect --format '{{.State.Status}}' "${CONTAINER_ID}")"
  if [[ "${health}" == "healthy" ]]; then
    break
  fi
  if [[ "${state}" == "exited" || "${state}" == "dead" ]]; then
    echo "BLOCKED: pinned ClamAV container stopped before signatures became healthy." >&2
    exit 1
  fi
  sleep 2
done
if [[ "${health}" != "healthy" ]]; then
  echo "BLOCKED: pinned ClamAV container did not become healthy with signatures loaded." >&2
  exit 1
fi

binding="$(docker port "${CONTAINER_ID}" 3310/tcp)"
if [[ ! "${binding}" =~ ^127\.0\.0\.1:[0-9]+$ ]]; then
  echo "BLOCKED: ClamAV test port was not bound only to ephemeral 127.0.0.1." >&2
  exit 1
fi
host_port="${binding##*:}"

node --conditions=react-server --experimental-strip-types \
  scripts/test-platform-clamav-integration.mjs scan 127.0.0.1 "${host_port}"

docker stop --time 10 "${CONTAINER_ID}" >/dev/null

node --conditions=react-server --experimental-strip-types \
  scripts/test-platform-clamav-integration.mjs unavailable 127.0.0.1 "${host_port}"
