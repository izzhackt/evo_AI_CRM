#!/usr/bin/env bash

set -euo pipefail
umask 077

fail() {
  echo "PROVIDER_RUNTIME_INVENTORY_ERROR:$1" >&2
  exit 1
}

if [[ "$-" == *x* ]]; then
  fail "xtrace_must_be_disabled"
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root"

node_bin="${EVO_NODE_BIN:-/opt/homebrew/opt/node@22/bin/node}"
[[ -x "$node_bin" ]] || fail "node_22_binary_missing"
node_version="$("$node_bin" --version)"
[[ "$node_version" == v22.* ]] || fail "node_22_required"

[[ "$(uname -s)" == "Darwin" ]] || fail "darwin_required"
orb_status="$(orb status)"
[[ "$orb_status" == *"Running"* ]] || fail "orbstack_not_running"
[[ "$(docker context show)" == "orbstack" ]] || fail "orbstack_context_required"

[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "worktree_must_be_clean"
git fetch --quiet origin
head_sha="$(git rev-parse HEAD)"
main_sha="$(git rev-parse origin/main)"
expected_sha="${1:-${EVO_PLATFORM_RUNTIME_INVENTORY_EXPECTED_SHA:-$main_sha}}"
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || fail "exact_sha_required"
[[ "$head_sha" == "$expected_sha" ]] || fail "head_sha_mismatch"
[[ "$main_sha" == "$expected_sha" ]] || fail "origin_main_sha_mismatch"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] \
  || fail "fetch_changed_worktree"

run_id="${EVO_PLATFORM_RUNTIME_INVENTORY_RUN_ID:-run-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
[[ "$run_id" =~ ^[A-Za-z0-9._-]+$ ]] || fail "unsafe_run_id"
relative_evidence_dir="output/provider-runtime-inventory/$expected_sha/$run_id"
evidence_dir="$repo_root/$relative_evidence_dir"
evidence_root="$repo_root/output/provider-runtime-inventory/$expected_sha"
[[ ! -e "$evidence_dir" ]] || fail "evidence_run_already_exists"
mkdir -p "$evidence_dir"
chmod 700 "$repo_root/output/provider-runtime-inventory" "$evidence_root" "$evidence_dir"

unit_log="$evidence_dir/unit.log"
database_log="$evidence_dir/database.log"
remote_log="$evidence_dir/remote-readonly.json"
inventory_log="$evidence_dir/inventory.log"
browser_evidence="$evidence_dir/browser-database-readonly.json"
database_evidence="$evidence_dir/database-readonly.json"
success_evidence="$evidence_dir/success.json"

node_dir="$(dirname "$node_bin")"
if ! PATH="$node_dir:$PATH" npm run test:u9 >"$unit_log" 2>&1; then
  chmod 600 "$unit_log"
  fail "unit_validation_failed"
fi
chmod 600 "$unit_log"

# The probe below is deliberately read-only. It reuses the already-connected
# crm_primary session and never requests a QR code or calls a send endpoint.
if ! ssh hermes-vps bash -s -- "$expected_sha" >"$remote_log" <<'REMOTE_PROBE'
set -euo pipefail
umask 077

expected_sha="$1"
runtime_env="/opt/evo-crm/.env.lead-agent"
[[ -r "$runtime_env" ]] || exit 20

set -a
# shellcheck disable=SC1090
. "$runtime_env"
set +a

[[ "${EVO_AGENT_WAHA_SESSION:-}" == "crm_primary" ]] || exit 21
[[ "${EVO_AGENT_WAHA_BASE_URL:-}" == "http://evo-crm-waha:3000" ]] || exit 22
[[ -n "${EVO_AGENT_WAHA_API_KEY:-}" ]] || exit 23
[[ "$(docker inspect --format '{{.State.Running}}' evo-crm-waha-1)" == "true" ]] || exit 24

waha_ip="$(docker inspect --format '{{with index .NetworkSettings.Networks "evo_crm_private"}}{{.IPAddress}}{{end}}' evo-crm-waha-1)"
[[ "$waha_ip" =~ ^[0-9a-fA-F:.]+$ ]] || exit 25
export EVO_PROVIDER_RUNTIME_WAHA_IP="$waha_ip"
export EVO_PROVIDER_RUNTIME_EXPECTED_SHA="$expected_sha"
export EVO_PROVIDER_RUNTIME_GEMINI_CONFIGURED="false"
[[ -n "${GEMINI_API_KEY:-}" ]] && export EVO_PROVIDER_RUNTIME_GEMINI_CONFIGURED="true"

python3 <<'PY'
import datetime
import ipaddress
import json
import os
import urllib.request

ip = os.environ["EVO_PROVIDER_RUNTIME_WAHA_IP"]
ipaddress.ip_address(ip)
endpoint = f"http://{ip}:3000/api/sessions/crm_primary"
request = urllib.request.Request(
    endpoint,
    method="GET",
    headers={"X-Api-Key": os.environ["EVO_AGENT_WAHA_API_KEY"]},
)
with urllib.request.urlopen(request, timeout=10) as response:
    if response.status != 200:
        raise RuntimeError("WAHA session inspection returned a non-200 status")
    payload = json.load(response)

if payload.get("name") != "crm_primary" or payload.get("status") != "WORKING":
    raise RuntimeError("The connected crm_primary WAHA session is not WORKING")

result = {
    "schemaVersion": 1,
    "kind": "platform-provider-runtime-remote-readiness",
    "gitSha": os.environ["EVO_PROVIDER_RUNTIME_EXPECTED_SHA"],
    "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "waha": {
        "selectedSession": "crm_primary",
        "status": "WORKING",
        "observedReadOnly": True,
        "fallbackObserved": False,
        "wrongSessionObserved": False,
        "mutationAttempted": False,
    },
    "amocrm": {
        "configured": False,
        "observedReadOnly": True,
        "mutationAttempted": False,
    },
    "gemini": {
        "configured": os.environ["EVO_PROVIDER_RUNTIME_GEMINI_CONFIGURED"] == "true",
        "observedReadOnly": True,
        "mutationAttempted": False,
    },
}
print(json.dumps(result, separators=(",", ":")))
PY
REMOTE_PROBE
then
  chmod 600 "$remote_log"
  fail "remote_readonly_validation_failed"
fi
chmod 600 "$remote_log"

if ! EVO_NODE_BIN="$node_bin" \
  EVO_PLATFORM_RUNTIME_INVENTORY_MAIN_SHA="$expected_sha" \
  EVO_PLATFORM_RUNTIME_INVENTORY_EVIDENCE_DIR="$evidence_dir" \
  PATH="$node_dir:$PATH" \
  npm run test:database:local >"$database_log" 2>&1; then
  chmod 600 "$database_log"
  fail "database_browser_validation_failed"
fi
chmod 600 "$database_log"

[[ -f "$browser_evidence" ]] || fail "browser_evidence_missing"
[[ -f "$database_evidence" ]] || fail "database_evidence_missing"
chmod 600 "$browser_evidence" "$database_evidence"

if ! "$node_bin" scripts/platform-provider-runtime-inventory.mjs \
  --repo-root "$repo_root" \
  --expected-sha "$expected_sha" \
  --remote-evidence "$relative_evidence_dir/remote-readonly.json" \
  --browser-evidence "$relative_evidence_dir/browser-database-readonly.json" \
  --database-evidence "$relative_evidence_dir/database-readonly.json" \
  --output "$relative_evidence_dir/success.json" \
  >"$inventory_log" 2>&1; then
  chmod 600 "$inventory_log"
  fail "runtime_inventory_validation_failed"
fi
chmod 600 "$inventory_log" "$success_evidence"

echo "PROVIDER_RUNTIME_INVENTORY_OK $expected_sha $relative_evidence_dir"
