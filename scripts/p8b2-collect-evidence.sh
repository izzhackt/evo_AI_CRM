#!/usr/bin/env bash
set -euo pipefail

: "${EVO_RELEASE_REVISION:?missing EVO_RELEASE_REVISION}"
: "${EVO_P8_BUILD_EVIDENCE:?missing EVO_P8_BUILD_EVIDENCE}"

if [[ "$(orb status)" != "Running" ]]; then
  echo "OrbStack must be Running" >&2
  exit 2
fi
if [[ "$(docker context show)" != "orbstack" ]]; then
  echo "Docker context must be exactly orbstack" >&2
  exit 2
fi

evidence_dir="$(cd "$EVO_P8_BUILD_EVIDENCE" && pwd -P)"
chmod 0700 "$evidence_dir"
candidate="$EVO_RELEASE_REVISION"
tool_version="$(docker sbom version | awk '/Application:/ {gsub(/[()]/, "", $3); print $2 " " $3; exit}')"
[[ "$tool_version" =~ ^docker-sbom\ [0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "unexpected SBOM tool version" >&2; exit 2; }

specs=(
  "main_crm|crm|evo-crm|/api/health"
  "evo_inbox|inbox|evo-inbox|/api/health"
  "lead_agent|lead-agent|evo-lead-agent|/health"
)

sbom_records="$(mktemp)"
smoke_records="$(mktemp)"
active_container=""
active_file=""
cleanup_all() {
  if [[ -n "$active_container" ]]; then
    docker rm -f "$active_container" >/dev/null 2>&1 || true
  fi
  if [[ -n "$active_file" ]]; then
    rm -f "$active_file"
  fi
  rm -f "$sbom_records" "$smoke_records"
}
trap cleanup_all EXIT

for spec in "${specs[@]}"; do
  IFS='|' read -r name file_name prefix route <<<"$spec"
  tag="$prefix:$candidate-linux-amd64"
  inspect="$(docker image inspect "$tag" --format '{{json .}}')"
  image_id="$(jq -r '.Id' <<<"$inspect")"
  [[ "$(jq -r '.Os' <<<"$inspect")" == linux ]]
  [[ "$(jq -r '.Architecture' <<<"$inspect")" == amd64 ]]
  [[ "$(jq -r '.Variant // ""' <<<"$inspect")" == "" ]]
  [[ "$(jq -r '.Config.Labels["org.opencontainers.image.revision"]' <<<"$inspect")" == "$candidate" ]]

  sbom_file="$evidence_dir/sbom-$file_name.spdx.json"
  tmp="$sbom_file.tmp.$$"
  active_file="$tmp"
  docker sbom --format spdx-json "$tag" >"$tmp"
  chmod 0600 "$tmp"
  mv "$tmp" "$sbom_file"
  active_file=""
  chmod 0600 "$sbom_file"
  jq -e '.spdxVersion | startswith("SPDX-")' "$sbom_file" >/dev/null
  jq -e --arg expected "${tag/:/-}" '.name == $expected' "$sbom_file" >/dev/null
  sbom_sha="$(shasum -a 256 "$sbom_file" | awk '{print $1}')"
  jq -nc \
    --arg name "$name" --arg tag "$tag" --arg image_id "$image_id" \
    --arg file "$(basename "$sbom_file")" --arg sha "$sbom_sha" --arg tool "$tool_version" \
    '{name:$name,image_tag:$tag,image_id:$image_id,platform:{os:"linux",architecture:"amd64",variant:""},format:"spdx-json",command:"docker sbom --format spdx-json <image-tag>",tool:$tool,file:$file,file_sha256:$sha,exit_code:0}' \
    >>"$sbom_records"

  container="evo-p8b2-smoke-${file_name}-${candidate:0:12}"
  if docker container inspect "$container" >/dev/null 2>&1; then
    echo "stale smoke container exists: $container" >&2
    exit 2
  fi
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  env_args=()
  case "$name" in
    main_crm)
      smoke_secret="$(openssl rand -hex 32)"
      env_args=(
        -e EVO_PLATFORM_WAHA_INGRESS_ENABLED=0 -e EVO_PLATFORM_WAHA_WORKER_ENABLED=0
        -e EVO_PLATFORM_WAHA_HISTORY_ENABLED=0 -e EVO_PLATFORM_WAHA_MEDIA_ENABLED=0
        -e EVO_PLATFORM_AMOCRM_READ_ENABLED=0 -e EVO_PLATFORM_AI_MEMORY_ENABLED=0
        -e EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED=0 -e EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED=0
        -e EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1 -e EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0
        -e EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=0 -e EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED=0
        -e EVO_PLATFORM_P7A_AUDIT_ENABLED=0 -e EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1
        -e "EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=$smoke_secret"
      )
      ;;
    evo_inbox)
      smoke_secret="$(openssl rand -hex 32)"
      env_args=(-e EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1 -e "EVO_INBOX_P7B_OBSERVABILITY_SECRET=$smoke_secret")
      ;;
    lead_agent)
      env_args=(-e EVO_AGENT_FROZEN=true -e EVO_AGENT_WORKER_ENABLED=false -e EVO_AGENT_AUTOREPLY_ENABLED=false -e EVO_AGENT_OUTBOUND_ENABLED=false -e EVO_AGENT_GEMINI_MODEL=gemini-3.5-flash)
      ;;
  esac
  docker run -d --platform linux/amd64 --name "$container" --network none "${env_args[@]}" "$tag" >/dev/null
  active_container="$container"
  smoke_ok=0
  for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Status}}' "$container")" == running ]] || break
    if [[ "$name" == lead_agent ]]; then
      docker exec "$container" python -c 'import json,urllib.request; r=urllib.request.urlopen("http://127.0.0.1:8000/health",timeout=2); j=json.load(r); assert r.status==200 and j.get("ok") is True and j.get("status")=="live" and j.get("frozen") is True and j.get("ready") is False' >/dev/null 2>&1 && smoke_ok=1 && break
    else
      expected_service=evo-crm
      [[ "$name" == evo_inbox ]] && expected_service=evo-inbox-companion
      docker exec "$container" node -e 'const s=process.argv[1];fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(2000)}).then(async r=>{const j=await r.json();if(r.status!==200||JSON.stringify(j)!==JSON.stringify({ok:true,status:"live",service:s}))process.exit(2)}).catch(()=>process.exit(3))' "$expected_service" >/dev/null 2>&1 && smoke_ok=1 && break
    fi
    sleep 1
  done
  restart_count="$(docker inspect -f '{{.RestartCount}}' "$container")"
  docker rm -f "$container" >/dev/null
  active_container=""
  [[ "$smoke_ok" == 1 && "$restart_count" == 0 ]] || { echo "smoke failed: $name" >&2; exit 1; }
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log_file="$evidence_dir/smoke-$file_name.log"
  printf 'name=%s\nplatform=linux/amd64\nnetwork=none\nroute=%s\nresult_code=liveness_verified\nrestart_count=0\nexit_code=0\n' "$name" "$route" >"$log_file"
  chmod 0600 "$log_file"
  log_sha="$(shasum -a 256 "$log_file" | awk '{print $1}')"
  jq -nc \
    --arg name "$name" --arg tag "$tag" --arg image_id "$image_id" --arg route "$route" \
    --arg started "$started_at" --arg finished "$finished_at" --arg log_sha "$log_sha" \
    '{name:$name,image_tag:$tag,image_id:$image_id,platform:"linux/amd64",network:"none",route:$route,result_code:"liveness_verified",started_at:$started,finished_at:$finished,restart_count:0,exit_code:0,log_sha256:$log_sha}' \
    >>"$smoke_records"
done

jq -s --arg candidate "$candidate" '{schema_version:1,candidate_commit:$candidate,records:.}' "$sbom_records" >"$evidence_dir/sbom-identity.json"
jq -s --arg candidate "$candidate" '{schema_version:1,candidate_commit:$candidate,records:.}' "$smoke_records" >"$evidence_dir/smoke-identity.json"
chmod 0600 "$evidence_dir/sbom-identity.json" "$evidence_dir/smoke-identity.json"

gitleaks detect --no-git --source "$evidence_dir" --redact --exit-code 1 >/dev/null
index_tmp="$evidence_dir/collection-index.json.tmp.$$"
active_file="$index_tmp"
find "$evidence_dir" -maxdepth 1 -type f \
  ! -name 'collection-index.json' ! -name 'collection-index.json.tmp.*' \
  -print0 | sort -z | while IFS= read -r -d '' file; do
    jq -nc --arg file "$(basename "$file")" --arg sha "$(shasum -a 256 "$file" | awk '{print $1}')" \
      --argjson mode "$(stat -f %Lp "$file")" '{file:$file,mode:$mode,sha256:$sha}'
  done | jq -s --arg candidate "$candidate" '{schema_version:1,candidate_commit:$candidate,files:.}' >"$index_tmp"
chmod 0600 "$index_tmp"
mv "$index_tmp" "$evidence_dir/collection-index.json"
active_file=""
printf '%s\n' "$evidence_dir"
