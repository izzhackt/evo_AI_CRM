import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const harness = readFileSync(
  new URL("../scripts/test-supabase-local-reset.sh", import.meta.url),
  "utf8",
);
const platformAuthSpec = readFileSync(
  new URL("./platform-auth/platform-auth.spec.ts", import.meta.url),
  "utf8",
);
const executableLines = harness
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

const extractResetRecoverySource = () => {
  const detectorStart = harness.indexOf(
    "reset_outputs_have_known_storage_gateway_failure() {",
  );
  const reloadStart = harness.indexOf("reload_exact_local_kong() {");
  const recoverStart = harness.indexOf(
    "recover_known_reset_storage_gateway_failure() {",
  );
  const historyStart = harness.indexOf(
    '\n[[ -x "${SUPABASE_CLI}" ]]',
    recoverStart,
  );

  assert.notEqual(detectorStart, -1);
  assert.notEqual(reloadStart, -1);
  assert.notEqual(recoverStart, -1);
  assert.notEqual(historyStart, -1);

  return {
    detector: harness.slice(detectorStart, reloadStart),
    reload: harness.slice(reloadStart, recoverStart),
    recover: harness.slice(recoverStart, historyStart),
    combined: harness.slice(detectorStart, historyStart),
  };
};

test("cleanup discovers every resource with the exact disposable project label", () => {
  assert.match(
    harness,
    /readonly STACK_LABEL="com\.supabase\.cli\.project=\$\{SUPABASE_PROJECT_ID\}"/,
  );
  assert.equal(
    harness.match(/--filter "label=\$\{STACK_LABEL\}"/g)?.length,
    3,
  );
  assert.match(harness, /docker rm -f "\$\{container_ids\[@\]\}"/);
  assert.match(harness, /docker volume rm "\$\{volume_names\[@\]\}"/);
  assert.match(harness, /docker network rm "\$\{network_ids\[@\]\}"/);
});

test("pre-clean skips Supabase teardown only after exact-label emptiness proof", () => {
  const stopStart = harness.indexOf("stop_exact_local_stack() {");
  const cleanupStart = harness.indexOf("\ncleanup() {", stopStart);
  const stopFunction = harness.slice(stopStart, cleanupStart);

  assert.notEqual(stopStart, -1);
  assert.notEqual(cleanupStart, -1);
  assert.match(stopFunction, /list_exact_stack_containers/);
  assert.match(stopFunction, /list_exact_stack_volumes/);
  assert.match(stopFunction, /list_exact_stack_networks/);
  assert.match(
    stopFunction,
    /if \[\[ -z "\$\{existing_containers\}"[\s\S]*return 0[\s\S]*run_with_deadline 90000/,
  );
});

test("empty exact-project network teardown is bounded and refreshes identities", () => {
  const removeStart = harness.indexOf("remove_exact_local_stack_resources() {");
  const stopStart = harness.indexOf("stop_exact_local_stack() {");
  const removeFunction = harness.slice(removeStart, stopStart);

  assert.notEqual(removeStart, -1);
  assert.notEqual(stopStart, -1);
  assert.match(
    removeFunction,
    /for attempt in \{1\.\.20\}; do[\s\S]*network_ids=\(\)[\s\S]*list_exact_stack_networks[\s\S]*run_with_deadline 2000 \\\n\s+docker network rm "\$\{network_ids\[@\]\}"/,
  );
  assert.match(
    removeFunction,
    /listed_resources="\$\(list_exact_stack_networks\)" \|\| return 1[\s\S]*if \[\[ -n "\$\{listed_resources\}" \]\]; then[\s\S]*removal_failed=true/,
  );
  assert.doesNotMatch(removeFunction, /docker network disconnect/);
});

test("local Supabase start hands health proof to the explicit bounded readiness gate", () => {
  const startIndex = harness.indexOf(
    'run_with_deadline 600000 "${SUPABASE_CLI}"',
  );
  const resetIndex = harness.indexOf(
    'run_with_deadline 600000 "${SUPABASE_CLI}"',
    startIndex + 1,
  );
  const startPhase = harness.slice(startIndex, resetIndex);
  const readinessStart = harness.indexOf("wait_for_local_stack_readiness() {");
  const readinessEnd = harness.indexOf(
    "reset_outputs_have_known_storage_gateway_failure() {",
    readinessStart,
  );
  const readiness = harness.slice(readinessStart, readinessEnd);

  assert.notEqual(startIndex, -1);
  assert.notEqual(resetIndex, -1);
  assert.match(
    startPhase,
    /start \\\n+[\s\S]*?--ignore-health-check/,
  );
  assert.match(
    startPhase,
    /if ! wait_for_local_stack_readiness; then[\s\S]*fail "The disposable local Supabase stack did not become ready/,
  );
  assert.ok(
    startPhase.indexOf("--ignore-health-check") <
      startPhase.indexOf("wait_for_local_stack_readiness"),
  );

  for (const container of [
    "DATABASE_CONTAINER",
    "POSTGREST_CONTAINER",
    "AUTH_CONTAINER",
    "STORAGE_CONTAINER",
    "KONG_CONTAINER",
  ]) {
    assert.match(readiness, new RegExp(`\\$\\{${container}\\}`));
  }
  assert.match(
    readiness,
    /"\$\{SUPABASE_CLI\}" \\\n+[\s\S]*? status \\\n+[\s\S]*? --output json/,
  );
});

test("both clean resets use one bounded cold-OrbStack attempt", () => {
  const boundedResetPattern =
    /run_with_deadline 600000 "\$\{SUPABASE_CLI\}" \\\n+\s+--workdir "\$\{REPO_ROOT\}" \\\n+\s+--output-format json \\\n+\s+db reset \\\n+/g;

  assert.equal(harness.match(boundedResetPattern)?.length, 2);
  assert.doesNotMatch(
    executableLines,
    /run_with_deadline 300000 "\$\{SUPABASE_CLI\}"[\s\S]*?db reset/,
  );
});

test("every long-running child gate has a process-group deadline", () => {
  assert.match(
    executableLines,
    /run_with_deadline 300000 node \\\n\s+"\$\{REPO_ROOT\}\/scripts\/test-supabase-auth-hook\.mjs"/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 240000 env \\\n\s+EVO_P5B_BROWSER_PROOF=0 \\\n\s+EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 660000 env \\\n\s+EVO_P5B_BROWSER_PROOF=0 \\\n\s+EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 240000 env \\\n\s+EVO_P5B_BROWSER_PROOF=1 \\\n\s+EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 600000 node \\\n\s+"\$\{REPO_ROOT\}\/scripts\/test-p2h-storage-api\.mjs"/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 300000 bash \\\n\s+"\$\{REPO_ROOT\}\/scripts\/test-p2g-queues-runtime\.sh"/,
  );
});

test("provider and P5B browser partitions run before the remaining suite", () => {
  const expectedTitles = [
    "RU and EN draft requests work while uncertain language stops for manual selection",
    "admin reads the persisted local P3C workflow without proving providers",
    "assigned Curator reads the same persisted local P3C workflow",
    "staff writes and persists a manual reply while AI is unavailable",
    "staff submits an approved-knowledge AI draft request through the real form",
    "staff reviews an AI draft then authorizes the edited final text",
  ];
  const titles = `readonly PROVIDER_GATED_BROWSER_TESTS="${expectedTitles.join("|")}"`;
  const p5bTitle =
    "P5B projects verified inbound WAHA work into the accepted conversation UI";
  const providerPass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
  );
  const betweenPassCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop between browser partitions."',
    providerPass,
  );
  const p5bPass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    betweenPassCleanup,
  );
  const p5bCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P5B browser partition."',
    p5bPass,
  );
  const remainingPass = harness.indexOf(
    "if ! run_with_deadline 660000 env \\",
    p5bCleanup,
  );
  const finalCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the browser gate."',
    remainingPass,
  );

  assert.ok(harness.includes(titles));
  assert.equal(expectedTitles.length, 6);
  for (const title of expectedTitles) {
    assert.equal(platformAuthSpec.split(`test("${title}"`).length - 1, 1);
  }
  assert.ok(
    harness.includes(`readonly P5B_BROWSER_TEST="${p5bTitle}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p5bTitle}"`).length - 1, 1);
  assert.notEqual(providerPass, -1);
  assert.notEqual(betweenPassCleanup, -1);
  assert.notEqual(p5bPass, -1);
  assert.notEqual(p5bCleanup, -1);
  assert.notEqual(remainingPass, -1);
  assert.notEqual(finalCleanup, -1);
  assert.ok(providerPass < betweenPassCleanup);
  assert.ok(betweenPassCleanup < p5bPass);
  assert.ok(p5bPass < p5bCleanup);
  assert.ok(p5bCleanup < remainingPass);
  assert.ok(remainingPass < finalCleanup);
  assert.match(
    harness.slice(providerPass, betweenPassCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*--grep "\$\{PROVIDER_GATED_BROWSER_TESTS\}"/,
  );
  assert.match(
    harness.slice(p5bPass, p5bCleanup),
    /EVO_P5B_BROWSER_PROOF=1[\s\S]*--grep "\$\{P5B_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(remainingPass, finalCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*--grep-invert "\$\{PROVIDER_GATED_BROWSER_TESTS\}\|\$\{P5B_BROWSER_TEST\}"/,
  );
  assert.equal(
    harness.slice(providerPass, finalCleanup).match(/EVO_P5B_BROWSER_PROOF=1/g)
      ?.length,
    1,
  );
  assert.doesNotMatch(executableLines, /run_with_deadline 900000 env/);
});

test("browser health refresh is exact-local and preserves Org A AI negative proof", () => {
  const refreshStart = harness.indexOf("refresh_synthetic_browser_health() {");
  const refreshEnd = harness.indexOf(
    "\n}\n\nlist_exact_stack_containers() {",
    refreshStart,
  );
  const refreshSource = harness.slice(refreshStart, refreshEnd);
  const authHook = harness.indexOf(
    '"${REPO_ROOT}/scripts/test-supabase-auth-hook.mjs"',
  );
  const refreshCall = harness.indexOf(
    "\nrefresh_synthetic_browser_health\n",
    authHook,
  );
  const browserStart = harness.indexOf(
    "\nbrowser_gate_started=true\n",
    refreshCall,
  );

  assert.notEqual(refreshStart, -1);
  assert.notEqual(refreshEnd, -1);
  assert.notEqual(authHook, -1);
  assert.notEqual(refreshCall, -1);
  assert.notEqual(browserStart, -1);
  assert.ok(authHook < refreshCall);
  assert.ok(refreshCall < browserStart);
  assert.match(
    refreshSource,
    /run_with_deadline 30000 docker exec -i \\\n\s+"\$\{DATABASE_CONTAINER\}"/,
  );
  assert.match(refreshSource, /request\.jwt\.claims/);
  assert.match(refreshSource, /\{"role":"service_role"\}/);
  assert.match(refreshSource, /EVO P2C Synthetic Organization A/);
  assert.match(refreshSource, /EVO P2C Synthetic Organization B/);
  assert.equal(
    refreshSource.match(/record_messaging_integration_health_event/g)?.length,
    3,
  );
  assert.match(refreshSource, /org_a,\n\s+'waha'/);
  assert.match(refreshSource, /org_b,\n\s+'ai'/);
  assert.match(refreshSource, /org_b,\n\s+'waha'/);
  assert.doesNotMatch(refreshSource, /org_a,\n\s+'ai'/);
  assert.doesNotMatch(refreshSource, /https?:\/\//);
  assert.doesNotMatch(refreshSource, /SUPABASE_SERVICE_ROLE(?:_KEY)?/);
});

test("browser process matching is exact to this worktree, host, and port", () => {
  const listStart = harness.indexOf("list_exact_browser_server_pids() {");
  const stopStart = harness.indexOf("stop_exact_browser_server() {");
  const listFunction = harness.slice(listStart, stopStart);
  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -Eeuo pipefail
NEXT_CLI=/fixture/evo/node_modules/.bin/next
BROWSER_HOST=127.0.0.1
BROWSER_PORT=3311
ps() {
  cat <<'EOF'
  101 node /fixture/evo/node_modules/.bin/next dev --hostname 127.0.0.1 --port 3311
  102 node /fixture/other/node_modules/.bin/next dev --hostname 127.0.0.1 --port 3311
  103 node /fixture/evo/node_modules/.bin/next dev --hostname 127.0.0.1 --port 4411
  104 npm run dev --hostname 127.0.0.1 --port 3311
EOF
}
${listFunction}
list_exact_browser_server_pids
`,
    ],
    { encoding: "utf8" },
  );

  assert.notEqual(listStart, -1);
  assert.notEqual(stopStart, -1);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "101\n");
});

test("browser gate rejects stale exact-worktree state and cleans only its own server", () => {
  const cleanupStart = harness.indexOf("cleanup() {");
  const cleanupEnd = harness.indexOf("\n}\n\ntrap cleanup", cleanupStart);
  const cleanupFunction = harness.slice(cleanupStart, cleanupEnd);
  const preflightIndex = harness.indexOf(
    'browser_server_pids="$(list_exact_browser_server_pids)"',
  );
  const stackOwnershipIndex = harness.indexOf("stack_owned=true");
  const browserStartIndex = harness.indexOf("browser_gate_started=true");
  const playwrightIndex = harness.indexOf(
    'run_with_deadline 240000 env',
    browserStartIndex,
  );

  assert.notEqual(preflightIndex, -1);
  assert.notEqual(stackOwnershipIndex, -1);
  assert.ok(preflightIndex < stackOwnershipIndex);
  assert.notEqual(browserStartIndex, -1);
  assert.ok(browserStartIndex < playwrightIndex);
  assert.match(
    harness.slice(preflightIndex, stackOwnershipIndex),
    /browser_server_pids="\$\(list_exact_browser_server_pids\)" \\\n\s+\|\| fail "Unable to inspect exact-worktree Platform browser processes\."[\s\S]*\[\[ -z "\$\{browser_server_pids\}" \]\]/,
  );
  assert.match(
    cleanupFunction,
    /if \[\[ "\$\{browser_gate_started\}" == true \]\]; then[\s\S]*stop_exact_browser_server/,
  );
  assert.match(
    harness,
    /if ! stop_exact_browser_server; then[\s\S]*browser server did not stop[\s\S]*browser_gate_started=false/,
  );
  assert.doesNotMatch(executableLines, /\b(?:pkill|killall)\b/);
  assert.doesNotMatch(executableLines, /lsof[^\n]*3311[^\n]*kill/);
});

test("cleanup fails closed without hiding an earlier command failure", () => {
  const cleanupStart = harness.indexOf("cleanup() {");
  const cleanupEnd = harness.indexOf("\n}\n\ntrap cleanup", cleanupStart);
  const cleanupFunction = harness.slice(cleanupStart, cleanupEnd);

  assert.notEqual(cleanupStart, -1);
  assert.notEqual(cleanupEnd, -1);
  assert.doesNotMatch(cleanupFunction, /stop_exact_local_stack[^\n]*\|\| true/);
  assert.match(cleanupFunction, /local exit_code=\$\?/);
  assert.match(cleanupFunction, /local cleanup_failed=false/);
  assert.match(
    cleanupFunction,
    /if ! stop_exact_local_stack[\s\S]*cleanup_failed=true/,
  );
  assert.match(cleanupFunction, /if ! rm -f[\s\S]*cleanup_failed=true/);
  assert.match(cleanupFunction, /if ! rmdir[\s\S]*cleanup_failed=true/);
  assert.match(
    cleanupFunction,
    /if \(\( exit_code != 0 \)\); then[\s\S]*exit "\$\{exit_code\}"/,
  );
  assert.match(
    cleanupFunction,
    /if \[\[ "\$\{cleanup_failed\}" == true \]\]; then[\s\S]*exit 1/,
  );
});

test("cleanup never broadens to all projects or a prune operation", () => {
  assert.doesNotMatch(executableLines, /supabase[ \t]+stop[ \t]+--all/);
  assert.doesNotMatch(
    executableLines,
    /docker(?:[ \t]+container|[ \t]+volume|[ \t]+network)?[ \t]+prune/,
  );
});

test("cleanup preserves the exact EVO Inbox container, volume, and network identities", () => {
  const captureStart = harness.indexOf("capture_inbox_stack_fingerprint() {");
  const assertionStart = harness.indexOf("assert_inbox_stack_unchanged() {");
  const assertionEnd = harness.indexOf("\n}\n", assertionStart) + 2;
  const cleanupStart = harness.indexOf("cleanup() {");
  const cleanupEnd = harness.indexOf("\n}\n\ntrap cleanup", cleanupStart);
  const capture = harness.slice(captureStart, assertionStart);
  const assertion = harness.slice(assertionStart, assertionEnd);
  const cleanup = harness.slice(cleanupStart, cleanupEnd);
  const fingerprintCall = harness.indexOf(
    'capture_inbox_stack_fingerprint "${INBOX_FINGERPRINT_BEFORE}"',
  );
  const lockCall = harness.indexOf('mkdir -- "${LOCK_DIR}"');

  assert.match(
    harness,
    /readonly INBOX_STACK_LABEL="com\.supabase\.cli\.project=inbox"/,
  );
  assert.notEqual(captureStart, -1);
  assert.notEqual(assertionStart, -1);
  assert.match(
    capture,
    /docker container ls \\\n+[\s\S]*?--all \\\n+[\s\S]*?--no-trunc \\\n+[\s\S]*?--filter "label=\$\{INBOX_STACK_LABEL\}"/,
  );
  assert.match(
    capture,
    /docker volume ls \\\n+[\s\S]*?--filter "label=\$\{INBOX_STACK_LABEL\}"/,
  );
  assert.match(
    capture,
    /docker network ls \\\n+[\s\S]*?--no-trunc \\\n+[\s\S]*?--filter "label=\$\{INBOX_STACK_LABEL\}"/,
  );
  assert.match(capture, /container:%s/);
  assert.match(capture, /volume:%s/);
  assert.match(capture, /network:%s/);
  assert.doesNotMatch(capture, /\.State|\.Status|Health|StartedAt/);
  assert.match(assertion, /cmp -s --/);
  assert.match(cleanup, /if ! assert_inbox_stack_unchanged; then[\s\S]*cleanup_failed=true/);
  assert.notEqual(fingerprintCall, -1);
  assert.notEqual(lockCall, -1);
  assert.ok(fingerprintCall < lockCall);

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "evo-inbox-fingerprint-"));
  const runComparison = (mode) =>
    spawnSync(
      "bash",
      [
        "-c",
        `
set -Eeuo pipefail
readonly INBOX_FINGERPRINT_BEFORE="$1/inbox-before.txt"
readonly INBOX_FINGERPRINT_AFTER="$1/inbox-after.txt"
readonly MODE="$2"
inbox_fingerprint_recorded=true
printf 'container:before\\n' >"\${INBOX_FINGERPRINT_BEFORE}"
capture_inbox_stack_fingerprint() {
  if [[ "\${MODE}" == same ]]; then
    cp -- "\${INBOX_FINGERPRINT_BEFORE}" "$1"
  else
    printf 'container:after\\n' >"$1"
  fi
}
${assertion}
assert_inbox_stack_unchanged
`,
        "evo-inbox-fingerprint-test",
        temporaryDirectory,
        mode,
      ],
      { encoding: "utf8" },
    );

  try {
    const same = runComparison("same");
    assert.equal(same.status, 0, same.stderr);

    const changed = runComparison("changed");
    assert.notEqual(changed.status, 0, changed.stderr);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Supabase mutation and cleanup commands stay local-only and unlinked", () => {
  assert.doesNotMatch(executableLines, /(?:^|\s)--linked(?:\s|$)/m);
  assert.doesNotMatch(executableLines, /(?:^|\s)--project-ref(?:\s|$)/m);
  assert.doesNotMatch(executableLines, /(?:^|\s)--db-url(?:\s|$)/m);
  assert.doesNotMatch(executableLines, /(?:^|\s)stop\s+--all(?:\s|$)/m);

  assert.equal(
    harness.match(/db reset \\\n+\s+--local \\\n+\s+--no-seed/g)?.length,
    2,
  );
  assert.equal(
    harness.match(/seed buckets \\\n+\s+--local/g)?.length,
    2,
  );
  assert.match(
    harness,
    /migration list \\\n+\s+--local/,
  );
});

test("known post-reset Storage 502 recovery stays exact-project and bounded", () => {
  const { detector, reload, recover } = extractResetRecoverySource();

  assert.match(
    harness,
    /readonly KNOWN_STORAGE_GATEWAY_502_STATUS="Error status 502:"/,
  );
  assert.match(
    harness,
    /readonly KNOWN_STORAGE_GATEWAY_502_MESSAGE="An invalid response was received from the upstream server"/,
  );
  assert.match(detector, /grep -Fq "Restarting containers"/);
  assert.match(
    detector,
    /grep -Fq "\$\{KNOWN_STORAGE_GATEWAY_502_STATUS\}" "\$\{result_file\}"/,
  );
  assert.match(
    detector,
    /grep -Fq "\$\{KNOWN_STORAGE_GATEWAY_502_MESSAGE\}" "\$\{result_file\}"/,
  );
  assert.equal(
    reload.match(/index \.Config\.Labels "com\.supabase\.cli\.project"/g)
      ?.length,
    2,
  );
  assert.match(
    reload,
    /\[\[ "\$\{project_label\}" == "\$\{SUPABASE_PROJECT_ID\}" \]\]/,
  );
  assert.match(
    reload,
    /run_with_deadline 30000 docker exec \\\n\s+"\$\{KONG_CONTAINER\}" kong reload/,
  );
  assert.match(
    reload,
    /run_with_deadline 60000 docker restart \\\n\s+"\$\{KONG_CONTAINER\}"/,
  );
  assert.doesNotMatch(reload, /docker restart[^\n]*\$\{[A-Z_]*CONTAINERS?\[@\]\}/);
  assert.match(
    recover,
    /reset_outputs_have_known_storage_gateway_failure "\$\{progress_log\}" "\$\{result_file\}"[\s\S]*reload_exact_local_kong[\s\S]*wait_for_local_stack_readiness/,
  );
});

test("Storage 502 recovery reloads or restarts only the owned Kong container", () => {
  const { combined } = extractResetRecoverySource();
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "evo-kong-recovery-"));

  const runMode = (mode) => {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `
set -Eeuo pipefail

readonly TEMP_DIR=$1
readonly MODE=$2
readonly SUPABASE_PROJECT_ID="evo-platform-local"
readonly KONG_CONTAINER="supabase_kong_evo-platform-local"
readonly KNOWN_STORAGE_GATEWAY_502_STATUS="Error status 502:"
readonly KNOWN_STORAGE_GATEWAY_502_MESSAGE="An invalid response was received from the upstream server"
readonly COMMAND_LOG="\${TEMP_DIR}/commands-\${MODE}.log"
: >"\${COMMAND_LOG}"

run_with_deadline() {
  local timeout_ms=$1
  shift
  printf '%s\\n' "$*" >>"\${COMMAND_LOG}"

  if [[ $1 == docker && $2 == inspect ]]; then
    if [[ \${MODE} == foreign ]]; then
      printf '%s\\n' inbox
    else
      printf '%s\\n' "\${SUPABASE_PROJECT_ID}"
    fi
    return 0
  fi
  if [[ $1 == docker && $2 == exec ]]; then
    [[ \${MODE} != fallback ]]
    return
  fi
  if [[ $1 == docker && $2 == restart ]]; then
    return 0
  fi
  return 1
}

wait_for_local_stack_readiness() {
  return 0
}

${combined}

readonly RESET_LOG="\${TEMP_DIR}/reset-\${MODE}.log"
readonly RESET_RESULT="\${TEMP_DIR}/reset-\${MODE}.json"
printf 'Restarting containers...\\n' >"\${RESET_LOG}"
printf '{"_tag":"Error","error":{"code":"UNKNOWN","message":"Error status 502: {\\n  \\"message\\":\\"%s\\"\\n}"}}\\n' \
  "\${KNOWN_STORAGE_GATEWAY_502_MESSAGE}" >"\${RESET_RESULT}"

case "\${MODE}" in
  missing-restart)
    printf 'Recreating database...\\n' >"\${RESET_LOG}"
    ;;
  missing-status)
    printf '{"_tag":"Error","error":{"message":"%s"}}\\n' \
      "\${KNOWN_STORAGE_GATEWAY_502_MESSAGE}" >"\${RESET_RESULT}"
    ;;
  missing-message)
    printf '{"_tag":"Error","error":{"message":"Error status 502: unrelated upstream failure"}}\\n' \
      >"\${RESET_RESULT}"
    ;;
  stderr-only)
    printf 'Restarting containers...\\n%s %s\\n' \
      "\${KNOWN_STORAGE_GATEWAY_502_STATUS}" \
      "\${KNOWN_STORAGE_GATEWAY_502_MESSAGE}" >"\${RESET_LOG}"
    printf '{"_tag":"Error","error":{"message":"unrelated failure"}}\\n' \
      >"\${RESET_RESULT}"
    ;;
  mixed-source)
    printf 'Restarting containers...\\n%s\\n' \
      "\${KNOWN_STORAGE_GATEWAY_502_STATUS}" >"\${RESET_LOG}"
    printf '{"_tag":"Error","error":{"message":"%s"}}\\n' \
      "\${KNOWN_STORAGE_GATEWAY_502_MESSAGE}" >"\${RESET_RESULT}"
    ;;
esac

if [[ \${MODE} == foreign ]]; then
  if reload_exact_local_kong; then
    exit 90
  fi
elif [[ \${MODE} == missing-* || \${MODE} == stderr-only || \${MODE} == mixed-source ]]; then
  if recover_known_reset_storage_gateway_failure "\${RESET_LOG}" "\${RESET_RESULT}"; then
    exit 91
  fi
else
  recover_known_reset_storage_gateway_failure "\${RESET_LOG}" "\${RESET_RESULT}"
fi
`,
        "evo-reset-recovery-test",
        temporaryDirectory,
        mode,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    return readFileSync(
      join(temporaryDirectory, `commands-${mode}.log`),
      "utf8",
    );
  };

  try {
    const reloadCommands = runMode("reload");
    assert.match(reloadCommands, /docker inspect/);
    assert.match(
      reloadCommands,
      /docker exec supabase_kong_evo-platform-local kong reload/,
    );
    assert.doesNotMatch(reloadCommands, /docker restart/);

    const fallbackCommands = runMode("fallback");
    assert.equal(fallbackCommands.match(/docker inspect/g)?.length, 2);
    assert.match(
      fallbackCommands,
      /docker restart supabase_kong_evo-platform-local/,
    );

    const foreignCommands = runMode("foreign");
    assert.match(foreignCommands, /docker inspect/);
    assert.doesNotMatch(foreignCommands, /docker (?:exec|restart)/);

    for (const mode of [
      "missing-restart",
      "missing-status",
      "missing-message",
      "stderr-only",
      "mixed-source",
    ]) {
      assert.equal(runMode(mode), "", mode);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("both reset phases recover only the classified Storage gateway failure", () => {
  for (const [logName, resultName] of [
    ["reset.log", "reset.json"],
    ["post-browser-reset.log", "post-browser-reset.json"],
  ]) {
    assert.match(
      harness,
      new RegExp(
        `reset_outputs_have_known_storage_gateway_failure[\\s\\S]*"\\$\\{TEMP_DIR\\}/${logName.replaceAll(".", "\\.")}" "\\$\\{TEMP_DIR\\}/${resultName.replaceAll(".", "\\.")}"[\\s\\S]*recover_known_reset_storage_gateway_failure[\\s\\S]*"\\$\\{TEMP_DIR\\}/${logName.replaceAll(".", "\\.")}" "\\$\\{TEMP_DIR\\}/${resultName.replaceAll(".", "\\.")}"`,
      ),
      logName,
    );
  }

  for (const retryArtifact of [
    "reset-retry.json",
    "reset-retry.log",
    "post-browser-reset-retry.json",
    "post-browser-reset-retry.log",
  ]) {
    assert.doesNotMatch(harness, new RegExp(retryArtifact.replaceAll(".", "\\.")));
  }

  assert.match(
    harness,
    /Initial disposable Supabase reset failed without a classified transient recovery path\./,
  );
  assert.match(
    harness,
    /Post-browser disposable Supabase reset failed without a classified transient recovery path\./,
  );
});
