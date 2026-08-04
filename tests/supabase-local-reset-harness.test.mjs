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

test("local Supabase start stays bounded while allowing a loaded cold OrbStack boot", () => {
  assert.match(
    executableLines,
    /run_with_deadline 600000 "\$\{SUPABASE_CLI\}" \\\n+[\s\S]*? start \\\n+/,
  );
});

test("both clean resets use one bounded cold-OrbStack attempt", () => {
  const boundedResetPattern =
    /if ! run_with_deadline 600000 "\$\{SUPABASE_CLI\}" \\\n+\s+--workdir "\$\{REPO_ROOT\}" \\\n+\s+--output-format json \\\n+\s+db reset \\\n+/g;

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
    /run_with_deadline 300000 env \\\n\s+EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
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
