import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
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
const platformAuthConfig = readFileSync(
  new URL("../playwright.platform-auth.config.ts", import.meta.url),
  "utf8",
);
const authHook = readFileSync(
  new URL("../scripts/test-supabase-auth-hook.mjs", import.meta.url),
  "utf8",
);
const nextConfig = readFileSync(
  new URL("../next.config.ts", import.meta.url),
  "utf8",
);
const ciWorkflow = readFileSync(
  new URL("../.github/workflows/evo-platform-ci.yml", import.meta.url),
  "utf8",
);
const executableLines = harness
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

const extractResetRecoverySource = () => {
  const migrationHistoryStart = harness.indexOf(
    "assert_local_migration_history() {",
  );
  const detectorStart = harness.indexOf(
    "reset_reached_post_migration_restart_failure() {",
  );
  const reloadStart = harness.indexOf("reload_exact_local_kong() {");
  const recoverStart = harness.indexOf(
    "recover_post_migration_restart_failure() {",
  );
  const runtimeStart = harness.indexOf(
    '\n[[ -x "${SUPABASE_CLI}" ]]',
    recoverStart,
  );

  assert.notEqual(migrationHistoryStart, -1);
  assert.notEqual(detectorStart, -1);
  assert.notEqual(reloadStart, -1);
  assert.notEqual(recoverStart, -1);
  assert.notEqual(runtimeStart, -1);

  return {
    migrationHistory: harness.slice(migrationHistoryStart, detectorStart),
    detector: harness.slice(detectorStart, reloadStart),
    reload: harness.slice(reloadStart, recoverStart),
    recover: harness.slice(recoverStart, runtimeStart),
    combined: harness.slice(detectorStart, runtimeStart),
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
    "assert_local_migration_history() {",
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

test("the isolated runtime gates use two bounded pre-browser resets", () => {
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
    /run_with_deadline 240000 env \\\n\s+EVO_P5B_BROWSER_PROOF=0[\s\S]*?EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 660000 env \\\n\s+EVO_P5B_BROWSER_PROOF=0[\s\S]*?EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 240000 env \\\n\s+EVO_P5B_BROWSER_PROOF=1[\s\S]*?EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 240000 env \\\n\s+EVO_P5B_BROWSER_PROOF=0[\s\S]*?EVO_P5C_BROWSER_PROOF=0[\s\S]*?EVO_P5D_BROWSER_PROOF=1[\s\S]*?EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 240000 env \\\n\s+EVO_P5B_BROWSER_PROOF=0[\s\S]*?EVO_U6_BROWSER_PROOF=1[\s\S]*?EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
  );
  assert.match(
    executableLines,
    /run_with_deadline 360000 env \\\n\s+EVO_P5B_BROWSER_PROOF=0[\s\S]*?EVO_U7_BROWSER_PROOF=1[\s\S]*?EVO_PLATFORM_AUTH_FIXTURE_PATH=[\s\S]*?"\$\{PLAYWRIGHT_CLI\}" \\\n\s+test/,
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

test("the P5C browser partition has its own bounded deadline", () => {
  const p5cPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5c",
  );
  const p5cCommand = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    p5cPartition,
  );
  const p5cGrep = executableLines.indexOf(
    '--grep "${P5C_BROWSER_TEST}"',
    p5cPartition,
  );

  assert.notEqual(p5cPartition, -1);
  assert.notEqual(p5cCommand, -1);
  assert.notEqual(p5cGrep, -1);
  assert.ok(p5cCommand < p5cPartition);
  assert.ok(p5cPartition < p5cGrep);
});

test("the P5D browser partition has its own bounded deadline", () => {
  const p5dPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5d",
  );
  const p5dCommand = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    p5dPartition,
  );
  const p5dGrep = executableLines.indexOf(
    '--grep "${P5D_BROWSER_TEST}"',
    p5dPartition,
  );

  assert.notEqual(p5dPartition, -1);
  assert.notEqual(p5dCommand, -1);
  assert.notEqual(p5dGrep, -1);
  assert.ok(p5dCommand < p5dPartition);
  assert.ok(p5dPartition < p5dGrep);
});

test("the P5F1 browser partition has its own bounded deadline", () => {
  const p5f1Partition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5f1",
  );
  const p5f1Command = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    p5f1Partition,
  );
  const p5f1Grep = executableLines.indexOf(
    '--grep "${P5F1_BROWSER_TEST}"',
    p5f1Partition,
  );

  assert.notEqual(p5f1Partition, -1);
  assert.notEqual(p5f1Command, -1);
  assert.notEqual(p5f1Grep, -1);
  assert.ok(p5f1Command < p5f1Partition);
  assert.ok(p5f1Partition < p5f1Grep);
});

test("the P5F3 browser partition has its own bounded deadline", () => {
  const p5f3Partition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5f3",
  );
  const p5f3Command = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    p5f3Partition,
  );
  const p5f3Grep = executableLines.indexOf(
    '--grep "${P5F3_BROWSER_TEST}"',
    p5f3Partition,
  );

  assert.notEqual(p5f3Partition, -1);
  assert.notEqual(p5f3Command, -1);
  assert.notEqual(p5f3Grep, -1);
  assert.ok(p5f3Command < p5f3Partition);
  assert.ok(p5f3Partition < p5f3Grep);
});

test("the P6A browser partition has its own bounded deadline", () => {
  const p6aPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6a",
  );
  const p6aCommand = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    p6aPartition,
  );
  const p6aGrep = executableLines.indexOf(
    '--grep "${P6A_BROWSER_TEST}"',
    p6aPartition,
  );

  assert.notEqual(p6aPartition, -1);
  assert.notEqual(p6aCommand, -1);
  assert.notEqual(p6aGrep, -1);
  assert.ok(p6aCommand < p6aPartition);
  assert.ok(p6aPartition < p6aGrep);
});

test("the P6B browser partition keeps its own bounded deadline and P6C prerequisite flag", () => {
  const p6bPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6b",
  );
  const p6bCommand = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    p6bPartition,
  );
  const p6bGrep = executableLines.indexOf(
    '--grep "${P6B_BROWSER_TEST}"',
    p6bPartition,
  );

  assert.notEqual(p6bPartition, -1);
  assert.notEqual(p6bCommand, -1);
  assert.notEqual(p6bGrep, -1);
  assert.ok(p6bCommand < p6bPartition);
  assert.ok(p6bPartition < p6bGrep);
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED:[\s\S]*p6bBrowserProof \|\| p6cBrowserProof \|\| p6dBrowserProof \? "1" : "0"/,
  );
  assert.match(nextConfig, /"p6b"/);
});

test("the P6C browser partition has its own bounded deadline and producer flag", () => {
  const p6cPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6c",
  );
  const p6cCommand = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    p6cPartition,
  );
  const p6cGrep = executableLines.indexOf(
    '--grep "${P6C_BROWSER_TEST}"',
    p6cPartition,
  );

  assert.notEqual(p6cPartition, -1);
  assert.notEqual(p6cCommand, -1);
  assert.notEqual(p6cGrep, -1);
  assert.ok(p6cCommand < p6cPartition);
  assert.ok(p6cPartition < p6cGrep);
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED:[\s\S]*p6cBrowserProof \|\| p6dBrowserProof \? "1" : "0"/,
  );
  assert.match(nextConfig, /"p6c"/);
});

test("the P6D browser partition has its own bounded deadline and exact composite flags", () => {
  const p6dPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6d",
  );
  const p6dCommand = executableLines.lastIndexOf(
    "run_with_deadline 660000 env",
    p6dPartition,
  );
  const p6dGrep = executableLines.indexOf(
    '--grep "${P6D_BROWSER_TEST}"',
    p6dPartition,
  );

  assert.notEqual(p6dPartition, -1);
  assert.notEqual(p6dCommand, -1);
  assert.notEqual(p6dGrep, -1);
  assert.ok(p6dCommand < p6dPartition);
  assert.ok(p6dPartition < p6dGrep);
  assert.match(
    platformAuthConfig,
    /\(platformAuthBrowserPartition === "p6d"\) !== p6dBrowserProof/,
  );
  assert.match(nextConfig, /"p6d"/);
});

test("the P7A browser partition is singleton, bounded, and audit-only", () => {
  const title =
    "P7A searches and exports safe organization audit evidence through connected Settings";
  const p7aPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p7a",
  );
  const p7aCommand = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    p7aPartition,
  );
  const p7aGrep = executableLines.indexOf(
    '--grep "${P7A_BROWSER_TEST}"',
    p7aPartition,
  );
  const p7aCleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P7A browser partition."',
    p7aPartition,
  );
  const p6dPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6d",
  );
  const p6dRuntimeDisable = executableLines.indexOf(
    'fail "Unable to disable the exact synthetic P6D organization overdue runtime control; output was withheld."',
    p6dPartition,
  );

  assert.notEqual(p7aPartition, -1);
  assert.notEqual(p7aCommand, -1);
  assert.notEqual(p7aGrep, -1);
  assert.notEqual(p7aCleanup, -1);
  assert.notEqual(p6dPartition, -1);
  assert.notEqual(p6dRuntimeDisable, -1);
  assert.ok(p7aCommand < p7aPartition);
  assert.ok(p7aPartition < p7aGrep);
  assert.ok(p7aGrep < p7aCleanup);
  assert.ok(p6dPartition < p6dRuntimeDisable);
  assert.ok(p6dRuntimeDisable < p7aCommand);
  assert.ok(harness.includes(`readonly P7A_BROWSER_TEST="${title}"`));
  assert.equal(platformAuthSpec.split(`test("${title}"`).length - 1, 1);
  assert.match(
    platformAuthConfig,
    /\(platformAuthBrowserPartition === "p7a"\) !== p7aBrowserProof/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_P7A_AUDIT_ENABLED: p7aBrowserProof \? "1" : "0"/,
  );
  assert.match(nextConfig, /"p7a"/);
  assert.match(authHook, /"p7a-browser-safe-audit-fixture"/);
  assert.match(authHook, /p7a:\s*\{/);
  assert.match(platformAuthSpec, /safeAuditSearch\(adminToken/);
  for (const privateFixtureField of [
    "privatePrincipal",
    "privatePhone",
    "privateReason",
    "privateBefore",
    "privateAfter",
  ]) {
    assert.match(authHook, new RegExp(privateFixtureField), privateFixtureField);
    assert.match(
      platformAuthSpec,
      new RegExp(`fixture\\.p7a\\.${privateFixtureField}`),
      privateFixtureField,
    );
  }

  const p7aSource = executableLines.slice(p7aCommand, p7aCleanup);
  assert.match(p7aSource, /EVO_P7A_BROWSER_PROOF=1/);
  assert.match(p7aSource, /EVO_PLATFORM_P7A_AUDIT_ENABLED=1/);
  for (const disabledProof of [
    "EVO_P5B_BROWSER_PROOF",
    "EVO_P5C_BROWSER_PROOF",
    "EVO_P5D_BROWSER_PROOF",
    "EVO_P5E_BROWSER_PROOF",
    "EVO_P5F1_BROWSER_PROOF",
    "EVO_P5F3_BROWSER_PROOF",
    "EVO_P6A_BROWSER_PROOF",
    "EVO_P6B_BROWSER_PROOF",
    "EVO_P6C_BROWSER_PROOF",
    "EVO_P6D_BROWSER_PROOF",
  ]) {
    assert.match(p7aSource, new RegExp(`${disabledProof}=0`), disabledProof);
  }
  for (const disabledFlag of [
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "EVO_PLATFORM_WAHA_WORKER_ENABLED",
    "EVO_PLATFORM_WAHA_HISTORY_ENABLED",
    "EVO_PLATFORM_WAHA_MEDIA_ENABLED",
    "EVO_PLATFORM_AMOCRM_READ_ENABLED",
    "EVO_PLATFORM_AI_MEMORY_ENABLED",
    "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED",
    "EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED",
    "EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED",
    "EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED",
  ]) {
    assert.match(p7aSource, new RegExp(`${disabledFlag}=0`), disabledFlag);
  }
  assert.match(p7aSource, /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/);
  assert.equal(
    executableLines.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p7a/g)?.length,
    1,
  );
  assert.equal(executableLines.match(/EVO_P7A_BROWSER_PROOF=1/g)?.length, 1);
  assert.equal(executableLines.match(/EVO_P7A_BROWSER_PROOF=0/g)?.length, 19);
  assert.equal(
    executableLines.match(/EVO_PLATFORM_P7A_AUDIT_ENABLED=0/g)?.length,
    14,
  );
});

test("the P7B browser partition is singleton, bounded, and observability-only", () => {
  const title =
    "P7B exposes signed private readiness and metrics without claiming provider health";
  const p7bPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p7b",
  );
  const p7bCommand = executableLines.lastIndexOf(
    "run_with_deadline 660000 env",
    p7bPartition,
  );
  const p7bGrep = executableLines.indexOf(
    '--grep "${P7B_BROWSER_TEST}"',
    p7bPartition,
  );
  const p7bCleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P7B browser partition."',
    p7bPartition,
  );
  const p7aPartition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p7a",
  );

  assert.notEqual(p7bPartition, -1);
  assert.notEqual(p7bCommand, -1);
  assert.notEqual(p7bGrep, -1);
  assert.notEqual(p7bCleanup, -1);
  assert.notEqual(p7aPartition, -1);
  assert.ok(p7aPartition < p7bCommand);
  assert.ok(p7bCommand < p7bPartition);
  assert.ok(p7bPartition < p7bGrep);
  assert.ok(p7bGrep < p7bCleanup);
  assert.ok(harness.includes(`readonly P7B_BROWSER_TEST="${title}"`));
  assert.equal(platformAuthSpec.split(`test("${title}"`).length - 1, 1);
  assert.match(
    platformAuthConfig,
    /\(platformAuthBrowserPartition === "p7b"\) !== p7bBrowserProof/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: p7bBrowserProof \? "1" : "0"/,
  );
  assert.match(nextConfig, /"p7b"/);
  assert.match(
    harness,
    /if \[\[ "\$\(uname -s\)" == "Darwin" \]\]; then[\s\S]*command -v orb[\s\S]*orb status[\s\S]*== "Running"[\s\S]*docker_context[\s\S]*== "orbstack"/,
  );

  const p7bSource = executableLines.slice(p7bCommand, p7bCleanup);
  assert.match(p7bSource, /EVO_P7B_BROWSER_PROOF=1/);
  assert.match(p7bSource, /EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1/);
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_P7B_OBSERVABILITY_SECRET:[\s\S]*fixture\.p7b\.observabilitySecret/,
  );
  assert.match(p7bSource, /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/);
  for (const disabledProof of [
    "EVO_P5B_BROWSER_PROOF",
    "EVO_P5C_BROWSER_PROOF",
    "EVO_P5D_BROWSER_PROOF",
    "EVO_P5E_BROWSER_PROOF",
    "EVO_P5F1_BROWSER_PROOF",
    "EVO_P5F3_BROWSER_PROOF",
    "EVO_P6A_BROWSER_PROOF",
    "EVO_P6B_BROWSER_PROOF",
    "EVO_P6C_BROWSER_PROOF",
    "EVO_P6D_BROWSER_PROOF",
    "EVO_P7A_BROWSER_PROOF",
  ]) {
    assert.match(p7bSource, new RegExp(`${disabledProof}=0`), disabledProof);
  }
  assert.equal(
    executableLines.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p7b/g)?.length,
    1,
  );
  assert.equal(executableLines.match(/EVO_P7B_BROWSER_PROOF=1/g)?.length, 1);
  assert.equal(executableLines.match(/EVO_P7B_BROWSER_PROOF=0/g)?.length, 19);
  assert.equal(
    executableLines.match(/EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0/g)?.length,
    19,
  );
});

test("the U2/U4/U5 browser partition is bounded, real-Auth and provider-disabled", () => {
  const u2Title =
    "U2 reads canonical EVO clients and leads through real Supabase with tenant isolation";
  const u4Title =
    "U4 qualifies and assigns canonical Sales leads through audited real Supabase workflow";
  const u5Title =
    "U5 confirms contract and first mandatory payment before normal Admissions handoff";
  const u2Partition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=u2",
  );
  const u2Command = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    u2Partition,
  );
  const u2Grep = executableLines.indexOf(
    '--grep "${U2_BROWSER_TEST}|${U4_BROWSER_TEST}|${U5_BROWSER_TEST}"',
    u2Partition,
  );
  const u2Cleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the U2/U4/U5 browser partition."',
    u2Partition,
  );

  assert.notEqual(u2Partition, -1);
  assert.notEqual(u2Command, -1);
  assert.notEqual(u2Grep, -1);
  assert.notEqual(u2Cleanup, -1);
  assert.ok(u2Command < u2Partition);
  assert.ok(u2Partition < u2Grep);
  assert.ok(u2Grep < u2Cleanup);
  assert.ok(harness.includes(`readonly U2_BROWSER_TEST="${u2Title}"`));
  assert.ok(harness.includes(`readonly U4_BROWSER_TEST="${u4Title}"`));
  assert.ok(harness.includes(`readonly U5_BROWSER_TEST="${u5Title}"`));
  assert.equal(platformAuthSpec.split(`test("${u2Title}"`).length - 1, 1);
  assert.equal(platformAuthSpec.split(`test("${u4Title}"`).length - 1, 1);
  assert.equal(platformAuthSpec.split(`test("${u5Title}"`).length - 1, 1);
  assert.equal(
    executableLines.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=u2/g)?.length,
    1,
  );

  const u2Source = executableLines.slice(u2Command, u2Cleanup);
  for (const disabledFlag of [
    "EVO_P5B_BROWSER_PROOF",
    "EVO_P5C_BROWSER_PROOF",
    "EVO_P5D_BROWSER_PROOF",
    "EVO_P5E_BROWSER_PROOF",
    "EVO_P5F1_BROWSER_PROOF",
    "EVO_P5F3_BROWSER_PROOF",
    "EVO_P6A_BROWSER_PROOF",
    "EVO_P6B_BROWSER_PROOF",
    "EVO_P6C_BROWSER_PROOF",
    "EVO_P6D_BROWSER_PROOF",
    "EVO_P7A_BROWSER_PROOF",
    "EVO_P7B_BROWSER_PROOF",
    "EVO_PLATFORM_P7A_AUDIT_ENABLED",
    "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED",
    "EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED",
    "EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED",
    "EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED",
    "EVO_PLATFORM_AMOCRM_READ_ENABLED",
    "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED",
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "EVO_PLATFORM_WAHA_WORKER_ENABLED",
    "EVO_PLATFORM_WAHA_HISTORY_ENABLED",
    "EVO_PLATFORM_WAHA_MEDIA_ENABLED",
    "EVO_PLATFORM_AI_MEMORY_ENABLED",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED",
  ]) {
    assert.match(u2Source, new RegExp(`${disabledFlag}=0`), disabledFlag);
  }
  assert.match(u2Source, /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/);
  assert.match(u2Source, /EVO_PLATFORM_AUTH_FIXTURE_PATH=/);
  assert.match(authHook, /const u2SyntheticRowCount = 1_005/);
  assert.match(authHook, /u2-lead-traversal-exact-set/);
  assert.match(authHook, /u2-client-traversal-exact-set/);
  assert.match(authHook, /u2-cross-org-detail-denial-shape/);
  assert.match(authHook, /u2:\s*\{/);
  assert.match(authHook, /u4-responsible-self-plus-unowned-exact-set/);
  assert.match(authHook, /u4-concurrent-same-request-exact-replay/);
  assert.match(authHook, /u4-one-audit-and-receipt-per-accepted-change/);
  assert.match(authHook, /u4:\s*\{/);
});

test("the U6 browser proof runs in its own bounded invocation after the U2/U4/U5 partition", () => {
  const u6Title =
    "U6 performs one audited Sales-to-Admissions handoff with full-versus-summary visibility";
  const u6Flag = executableLines.indexOf("EVO_U6_BROWSER_PROOF=1");
  const u6Partition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=u6",
    u6Flag,
  );
  const u6Command = executableLines.lastIndexOf(
    "run_with_deadline 240000 env",
    u6Flag,
  );
  const u6Grep = executableLines.indexOf('--grep "${U6_BROWSER_TEST}"', u6Flag);
  const u6Cleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the U6 browser proof."',
    u6Flag,
  );

  assert.notEqual(u6Flag, -1);
  assert.notEqual(u6Partition, -1);
  assert.notEqual(u6Command, -1);
  assert.notEqual(u6Grep, -1);
  assert.notEqual(u6Cleanup, -1);
  assert.ok(u6Command < u6Flag);
  assert.ok(u6Flag < u6Partition);
  assert.ok(u6Partition < u6Grep);
  assert.ok(u6Grep < u6Cleanup);
  assert.ok(harness.includes(`readonly U6_BROWSER_TEST="${u6Title}"`));
  assert.equal(platformAuthSpec.split(`test("${u6Title}"`).length - 1, 1);
  assert.match(authHook, /u6:\s*\{/);
});

test("the U7 browser proof runs in its own bounded invocation after U6", () => {
  const u7Title =
    "U7 operates one complete canonical Admissions case with bounded history";
  const u6Flag = executableLines.indexOf("EVO_U6_BROWSER_PROOF=1");
  const u7Flag = executableLines.indexOf("EVO_U7_BROWSER_PROOF=1", u6Flag);
  const u7Partition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=u7",
    u7Flag,
  );
  const u7Command = executableLines.lastIndexOf(
    "run_with_deadline 360000 env",
    u7Flag,
  );
  const u7Grep = executableLines.indexOf('--grep "${U7_BROWSER_TEST}"', u7Flag);
  const u7Cleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the U7 browser proof."',
    u7Flag,
  );

  assert.notEqual(u6Flag, -1);
  assert.notEqual(u7Flag, -1);
  assert.notEqual(u7Partition, -1);
  assert.notEqual(u7Command, -1);
  assert.notEqual(u7Grep, -1);
  assert.notEqual(u7Cleanup, -1);
  assert.ok(u6Flag < u7Flag);
  assert.ok(u7Command < u7Flag);
  assert.ok(u7Flag < u7Partition);
  assert.ok(u7Partition < u7Grep);
  assert.ok(u7Grep < u7Cleanup);
  assert.ok(harness.includes(`readonly U7_BROWSER_TEST="${u7Title}"`));
  assert.equal(platformAuthSpec.split(`test("${u7Title}"`).length - 1, 1);
});

test("the U8 browser proof runs in its own bounded invocation after U7", () => {
  const u8Title =
    "U8 controls overdue payment stops and finance history without provider writes";
  const u7Flag = executableLines.indexOf("EVO_U7_BROWSER_PROOF=1");
  const u7Cleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the U7 browser proof."',
    u7Flag,
  );
  const u8Flag = executableLines.indexOf("EVO_U8_BROWSER_PROOF=1", u7Cleanup);
  const u8Partition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=u8",
    u8Flag,
  );
  const u8Command = executableLines.lastIndexOf(
    "run_with_deadline 360000 env",
    u8Flag,
  );
  const u8Grep = executableLines.indexOf('--grep "${U8_BROWSER_TEST}"', u8Flag);
  const u8Cleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the U8 browser proof."',
    u8Flag,
  );

  assert.notEqual(u7Flag, -1);
  assert.notEqual(u7Cleanup, -1);
  assert.notEqual(u8Flag, -1);
  assert.notEqual(u8Partition, -1);
  assert.notEqual(u8Command, -1);
  assert.notEqual(u8Grep, -1);
  assert.notEqual(u8Cleanup, -1);
  assert.ok(u7Cleanup < u8Command);
  assert.ok(u8Command < u8Flag);
  assert.ok(u8Flag < u8Partition);
  assert.ok(u8Partition < u8Grep);
  assert.ok(u8Grep < u8Cleanup);
  assert.ok(harness.includes(`readonly U8_BROWSER_TEST="${u8Title}"`));
  assert.equal(platformAuthSpec.split(`test("${u8Title}"`).length - 1, 1);
});

test("the U9 browser proof runs alone after U8 with every external lane disabled", () => {
  const u9Title =
    "U9 reviews synthetic Gemini proposals with human-only authority and tenant isolation";
  const u8Flag = executableLines.indexOf("EVO_U8_BROWSER_PROOF=1");
  const u8Cleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the U8 browser proof."',
    u8Flag,
  );
  const u9Command = executableLines.indexOf(
    "run_with_deadline 360000 env",
    u8Cleanup,
  );
  const u9Flag = executableLines.indexOf("EVO_U9_BROWSER_PROOF=1", u9Command);
  const u9Partition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=u9",
    u9Flag,
  );
  const u9Grep = executableLines.indexOf('--grep "${U9_BROWSER_TEST}"', u9Flag);
  const u9Cleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the U9 browser proof."',
    u9Flag,
  );

  assert.notEqual(u8Flag, -1);
  assert.notEqual(u8Cleanup, -1);
  assert.notEqual(u9Command, -1);
  assert.notEqual(u9Flag, -1);
  assert.notEqual(u9Partition, -1);
  assert.notEqual(u9Grep, -1);
  assert.notEqual(u9Cleanup, -1);
  assert.ok(u8Cleanup < u9Command);
  assert.ok(u9Command < u9Flag);
  assert.ok(u9Flag < u9Partition);
  assert.ok(u9Partition < u9Grep);
  assert.ok(u9Grep < u9Cleanup);
  assert.ok(harness.includes(`readonly U9_BROWSER_TEST="${u9Title}"`));
  assert.equal(platformAuthSpec.split(`test("${u9Title}"`).length - 1, 1);

  const u9Source = executableLines.slice(u9Command, u9Cleanup);
  for (const disabledProof of [
    "EVO_P5B_BROWSER_PROOF",
    "EVO_P5C_BROWSER_PROOF",
    "EVO_P5D_BROWSER_PROOF",
    "EVO_P5E_BROWSER_PROOF",
    "EVO_P5F1_BROWSER_PROOF",
    "EVO_P5F3_BROWSER_PROOF",
    "EVO_P6A_BROWSER_PROOF",
    "EVO_P6B_BROWSER_PROOF",
    "EVO_P6C_BROWSER_PROOF",
    "EVO_P6D_BROWSER_PROOF",
    "EVO_P7A_BROWSER_PROOF",
    "EVO_P7B_BROWSER_PROOF",
    "EVO_U6_BROWSER_PROOF",
    "EVO_U7_BROWSER_PROOF",
    "EVO_U8_BROWSER_PROOF",
    "EVO_U10_BROWSER_PROOF",
  ]) {
    assert.match(u9Source, new RegExp(`${disabledProof}=0`), disabledProof);
  }
  for (const disabledLane of [
    "EVO_PLATFORM_AMOCRM_READ_ENABLED",
    "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED",
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "EVO_PLATFORM_WAHA_WORKER_ENABLED",
    "EVO_PLATFORM_WAHA_HISTORY_ENABLED",
    "EVO_PLATFORM_WAHA_MEDIA_ENABLED",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED",
  ]) {
    assert.match(u9Source, new RegExp(`${disabledLane}=0`), disabledLane);
  }
  assert.match(u9Source, /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/);
  assert.match(harness, /export EVO_U9_BROWSER_PROOF=0/);
  assert.equal(executableLines.match(/EVO_U9_BROWSER_PROOF=1/g)?.length, 1);
  assert.equal(executableLines.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=u9/g)?.length, 1);
  assert.match(
    harness,
    /\$\{U8_BROWSER_TEST\}\|\$\{U9_BROWSER_TEST\}\|\$\{U10_BROWSER_TEST\}"; then/,
  );
  assert.doesNotMatch(platformAuthSpec, /p_model_ref: "gemini-3\.5-flash"/);
  assert.doesNotMatch(platformAuthSpec, /p_schema_version: 1/);
  assert.doesNotMatch(
    platformAuthSpec,
    /p_prompt_policy_version: "p5f2-consultative-sales-v2"/,
  );
  assert.ok(
    (platformAuthSpec.match(/p_model_ref: "gemini-3\.7-flash"/g)?.length ?? 0)
      >= 2,
  );
  assert.ok(
    (platformAuthSpec.match(/p_schema_version: 2/g)?.length ?? 0) >= 2,
  );
  assert.ok(
    (platformAuthSpec.match(/p_prompt_policy_version: "u9-gemini-human-review-v1"/g)?.length ?? 0)
      >= 2,
  );
  assert.match(platformAuthSpec, /decision: "accepted"/);
  assert.match(platformAuthSpec, /decision: "edited"/);
  assert.match(platformAuthSpec, /decision: "rejected"/);
  assert.match(platformAuthSpec, /reviewed_by_membership_id: reviewerMembershipId/);
  assert.match(platformAuthSpec, /unauthorizedReview\.status\)\.toBe\(403\)/);
  assert.match(platformAuthSpec, /crossOrgReview\.status\)\.toBe\(403\)/);
  assert.match(platformAuthSpec, /expect\(externalBrowserWrites\)\.toEqual\(\[\]\)/);
});

test("the U10 browser proof runs alone after U9 with legacy fallback and every external lane disabled", () => {
  const u10Title =
    "U10 isolates a net-new pilot cohort from legacy writes with audited exact replay";
  const u9Flag = executableLines.indexOf("EVO_U9_BROWSER_PROOF=1");
  const u9Cleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the U9 browser proof."',
    u9Flag,
  );
  const u10Command = executableLines.indexOf(
    "run_with_deadline 360000 env",
    u9Cleanup,
  );
  const u10Flag = executableLines.indexOf("EVO_U10_BROWSER_PROOF=1", u10Command);
  const u10Partition = executableLines.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=u10",
    u10Flag,
  );
  const u10Grep = executableLines.indexOf('--grep "${U10_BROWSER_TEST}"', u10Flag);
  const u10Cleanup = executableLines.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the U10 browser proof."',
    u10Flag,
  );

  assert.notEqual(u9Flag, -1);
  assert.notEqual(u9Cleanup, -1);
  assert.notEqual(u10Command, -1);
  assert.notEqual(u10Flag, -1);
  assert.notEqual(u10Partition, -1);
  assert.notEqual(u10Grep, -1);
  assert.notEqual(u10Cleanup, -1);
  assert.ok(u9Cleanup < u10Command);
  assert.ok(u10Command < u10Flag);
  assert.ok(u10Flag < u10Partition);
  assert.ok(u10Partition < u10Grep);
  assert.ok(u10Grep < u10Cleanup);
  assert.ok(harness.includes(`readonly U10_BROWSER_TEST="${u10Title}"`));
  assert.equal(platformAuthSpec.split(`test("${u10Title}"`).length - 1, 1);

  const u10Source = executableLines.slice(u10Command, u10Cleanup);
  for (const disabledProof of [
    "EVO_P5B_BROWSER_PROOF",
    "EVO_P5C_BROWSER_PROOF",
    "EVO_P5D_BROWSER_PROOF",
    "EVO_P5E_BROWSER_PROOF",
    "EVO_P5F1_BROWSER_PROOF",
    "EVO_P5F3_BROWSER_PROOF",
    "EVO_P6A_BROWSER_PROOF",
    "EVO_P6B_BROWSER_PROOF",
    "EVO_P6C_BROWSER_PROOF",
    "EVO_P6D_BROWSER_PROOF",
    "EVO_P7A_BROWSER_PROOF",
    "EVO_P7B_BROWSER_PROOF",
    "EVO_U6_BROWSER_PROOF",
    "EVO_U7_BROWSER_PROOF",
    "EVO_U8_BROWSER_PROOF",
    "EVO_U9_BROWSER_PROOF",
  ]) {
    assert.match(u10Source, new RegExp(`${disabledProof}=0`), disabledProof);
  }
  for (const disabledLane of [
    "EVO_PLATFORM_AMOCRM_READ_ENABLED",
    "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED",
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "EVO_PLATFORM_WAHA_WORKER_ENABLED",
    "EVO_PLATFORM_WAHA_HISTORY_ENABLED",
    "EVO_PLATFORM_WAHA_MEDIA_ENABLED",
    "EVO_PLATFORM_AI_MEMORY_ENABLED",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED",
  ]) {
    assert.match(u10Source, new RegExp(`${disabledLane}=0`), disabledLane);
  }
  assert.match(u10Source, /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/);
  assert.match(harness, /export EVO_U10_BROWSER_PROOF=0/);
  assert.equal(executableLines.match(/EVO_U10_BROWSER_PROOF=1/g)?.length, 1);
  assert.equal(executableLines.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=u10/g)?.length, 1);
  assert.match(
    harness,
    /\$\{U9_BROWSER_TEST\}\|\$\{U10_BROWSER_TEST\}"; then/,
  );

  for (const rpc of [
    "configure_pilot_cohort",
    "set_student_case_pilot_membership",
    "staff_student_case_pilot_cohort",
    "staff_pilot_write_boundary",
  ]) {
    assert.match(platformAuthSpec, new RegExp(`"${rpc}"`), rpc);
  }
  assert.match(platformAuthSpec, /platform-pilot-cohort-card/);
  assert.match(platformAuthSpec, /platform-pilot-membership-include-form/);
  assert.match(platformAuthSpec, /platform-pilot-membership-exclude-form/);
  assert.match(platformAuthSpec, /legacy_write_forbidden/);
  assert.match(platformAuthSpec, /fallback_allowed: false/);
  assert.match(platformAuthSpec, /membership_status: "outside"/);
  assert.match(platformAuthSpec, /membership_status: "included"/);
  assert.match(platformAuthSpec, /membership_status: "excluded"/);
  assert.match(platformAuthSpec, /replayed: true/);
  assert.match(platformAuthSpec, /unauthorizedConfiguration\.status\)\.toBe\(403\)/);
  assert.match(platformAuthSpec, /crossOrganizationMembership\.status\)\.toBe\(403\)/);
  assert.match(platformAuthSpec, /"append_student_case_update"/);
  assert.match(platformAuthSpec, /"create_case_task"/);
  assert.match(platformAuthSpec, /expect\(externalBrowserWrites\)\.toEqual\(\[\]\)/);
});

test("the P7B acceptance runs one pinned disposable Caddy denial proof", () => {
  const runtimeScript = readFileSync(
    new URL("../scripts/test-p7b-caddy-runtime.sh", import.meta.url),
    "utf8",
  );

  assert.match(
    harness,
    /run_with_deadline 240000 bash[\s\S]*scripts\/test-p7b-caddy-runtime\.sh/,
  );
  assert.match(
    runtimeScript,
    /readonly CADDY_IMAGE="caddy@sha256:[0-9a-f]{64}"/,
  );
  assert.match(
    runtimeScript,
    /awk '[\s\S]*admin off[\s\S]*auto_https off[\s\S]*SOURCE_CADDYFILE[\s\S]*TEST_CADDYFILE/,
  );
  assert.doesNotMatch(runtimeScript, /import \/source\/Caddyfile\.evo-edge/);
  assert.match(runtimeScript, /--read-only/);
  assert.match(runtimeScript, /--memory 128m/);
  assert.match(runtimeScript, /--pids-limit 64/);
  assert.match(runtimeScript, /--log-opt max-size=1m/);
  assert.match(
    runtimeScript,
    /\/api\/readiness[\s\S]*\/api\/readiness\/near[\s\S]*\/metrics[\s\S]*\/metrics\/near[\s\S]*\/api\/internal\/p7b[\s\S]*\/admin\/p7b/,
  );
  assert.match(runtimeScript, /Authorization: Bearer \$\{AUTH_SENTINEL\}/);
  assert.match(runtimeScript, /x-evo-observability-hmac: \$\{HMAC_SENTINEL\}/);
  assert.ok(
    runtimeScript.indexOf("container_cleanup_armed=true") <
      runtimeScript.indexOf("docker run --detach"),
    "exact-name cleanup must be armed before Docker can create the container",
  );
  assert.match(runtimeScript, /docker rm -f "\$\{CONTAINER_NAME\}"/);
  assert.doesNotMatch(runtimeScript, /docker (?:rm|stop) -f? --all/);
});

test("Main CRM CI installs the locked Chromium runtime before the full browser gate", () => {
  const mainCrmJobStart = ciWorkflow.indexOf("\n  crm:\n");
  const inboxJobStart = ciWorkflow.indexOf("\n  inbox:\n", mainCrmJobStart);

  assert.notEqual(mainCrmJobStart, -1);
  assert.notEqual(inboxJobStart, -1);

  const mainCrmJob = ciWorkflow.slice(mainCrmJobStart, inboxJobStart);
  const dependencyInstall = mainCrmJob.indexOf("run: npm ci");
  const securityGate = mainCrmJob.indexOf("run: npm run test:security");
  const browserInstall = mainCrmJob.indexOf(
    "node_modules/.bin/playwright install --with-deps chromium",
  );
  const fullGate = mainCrmJob.indexOf("run: npm run test:supabase:local");

  assert.notEqual(dependencyInstall, -1);
  assert.notEqual(securityGate, -1);
  assert.notEqual(browserInstall, -1);
  assert.notEqual(fullGate, -1);
  assert.ok(dependencyInstall < securityGate);
  assert.ok(securityGate < browserInstall);
  assert.ok(browserInstall < fullGate);
});

test("dedicated browser partitions run in the exact state-safe sequence", () => {
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
  const p5cTitle =
    "P5C reconciles available WAHA history into the accepted conversation UI";
  const p5dTitle =
    "P5D archives private WAHA media into the accepted conversation UI";
  const p5eTitle =
    "P5E projects WAHA ACK and session state into the live conversation UI";
  const p5f1Title =
    "P5F1 persists staff-controlled memory and degraded lexical evidence in the accepted conversation UI";
  const p5f3Title =
    "P5F3 persists and reconciles one synthetic autonomous reply in the accepted conversation UI";
  const p6aTitle =
    "P6A exposes read-only overdue Portal attention without notification or provider controls";
  const p6bTitle =
    "P6B turns an authenticated staff document review into one live durable Student notification";
  const p6cTitle =
    "P6C publishes deterministic overdue task and payment notifications through the signed worker";
  const p6dTitle =
    "P6D closes the real Student 360 and Portal cross-domain loop with tenant isolation";
  const providerPass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
  );
  const betweenPassCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop between browser partitions."',
    providerPass,
  );
  const betweenPassCleanupEnd = harness.indexOf(
    "\nfi\n",
    betweenPassCleanup,
  );
  const remainingPass = harness.indexOf(
    "if ! run_with_deadline 660000 env \\",
    betweenPassCleanup,
  );
  const remainingCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the browser gate."',
    remainingPass,
  );
  const p5bPass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    remainingCleanup,
  );
  const p5bCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P5B browser partition."',
    p5bPass,
  );
  const p5dPass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    p5bCleanup,
  );
  const p5dCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P5D browser partition."',
    p5dPass,
  );
  const p5cPass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    p5dCleanup,
  );
  const p5cCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P5C browser partition."',
    p5cPass,
  );
  const p5ePass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    p5cCleanup,
  );
  const p5eCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P5E browser partition."',
    p5ePass,
  );
  const p5f1Pass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    p5eCleanup,
  );
  const p5f1Cleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P5F1 browser partition."',
    p5f1Pass,
  );
  const p5f3Pass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    p5f1Cleanup,
  );
  const p5f3Cleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P5F3 browser partition."',
    p5f3Pass,
  );
  const p6aPass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    p5f3Cleanup,
  );
  const p6aCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P6A browser partition."',
    p6aPass,
  );
  const p6bPass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    p6aCleanup,
  );
  const p6bCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P6B browser partition."',
    p6bPass,
  );
  const p6cPass = harness.indexOf(
    "if ! run_with_deadline 240000 env \\",
    p6bCleanup,
  );
  const p6cCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P6C browser partition."',
    p6cPass,
  );
  const p6dPass = harness.indexOf(
    "if ! run_with_deadline 660000 env \\",
    p6cCleanup,
  );
  const p6dCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P6D browser partition."',
    p6dPass,
  );
  const finalCleanup = p6dCleanup;

  assert.ok(harness.includes(titles));
  assert.equal(expectedTitles.length, 6);
  for (const title of expectedTitles) {
    assert.equal(platformAuthSpec.split(`test("${title}"`).length - 1, 1);
  }
  assert.ok(
    harness.includes(`readonly P5B_BROWSER_TEST="${p5bTitle}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p5bTitle}"`).length - 1, 1);
  assert.ok(
    harness.includes(`readonly P5C_BROWSER_TEST="${p5cTitle}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p5cTitle}"`).length - 1, 1);
  assert.ok(
    harness.includes(`readonly P5D_BROWSER_TEST="${p5dTitle}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p5dTitle}"`).length - 1, 1);
  assert.ok(
    harness.includes(`readonly P5E_BROWSER_TEST="${p5eTitle}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p5eTitle}"`).length - 1, 1);
  assert.ok(
    harness.includes(`readonly P5F1_BROWSER_TEST="${p5f1Title}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p5f1Title}"`).length - 1, 1);
  assert.ok(
    harness.includes(`readonly P5F3_BROWSER_TEST="${p5f3Title}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p5f3Title}"`).length - 1, 1);
  assert.ok(
    harness.includes(`readonly P6A_BROWSER_TEST="${p6aTitle}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p6aTitle}"`).length - 1, 1);
  assert.ok(
    harness.includes(`readonly P6B_BROWSER_TEST="${p6bTitle}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p6bTitle}"`).length - 1, 1);
  assert.ok(
    harness.includes(`readonly P6C_BROWSER_TEST="${p6cTitle}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p6cTitle}"`).length - 1, 1);
  assert.ok(
    harness.includes(`readonly P6D_BROWSER_TEST="${p6dTitle}"`),
  );
  assert.equal(platformAuthSpec.split(`test("${p6dTitle}"`).length - 1, 1);
  assert.notEqual(providerPass, -1);
  assert.notEqual(betweenPassCleanup, -1);
  assert.notEqual(betweenPassCleanupEnd, -1);
  assert.notEqual(p5bPass, -1);
  assert.notEqual(p5bCleanup, -1);
  assert.notEqual(p5cPass, -1);
  assert.notEqual(p5cCleanup, -1);
  assert.notEqual(p5dPass, -1);
  assert.notEqual(p5dCleanup, -1);
  assert.notEqual(p5ePass, -1);
  assert.notEqual(p5eCleanup, -1);
  assert.notEqual(p5f1Pass, -1);
  assert.notEqual(p5f1Cleanup, -1);
  assert.notEqual(p5f3Pass, -1);
  assert.notEqual(p5f3Cleanup, -1);
  assert.notEqual(p6aPass, -1);
  assert.notEqual(p6aCleanup, -1);
  assert.notEqual(p6bPass, -1);
  assert.notEqual(p6bCleanup, -1);
  assert.notEqual(p6cPass, -1);
  assert.notEqual(p6cCleanup, -1);
  assert.notEqual(p6dPass, -1);
  assert.notEqual(p6dCleanup, -1);
  assert.notEqual(remainingPass, -1);
  assert.notEqual(remainingCleanup, -1);
  assert.notEqual(finalCleanup, -1);
  assert.ok(providerPass < betweenPassCleanup);
  assert.ok(betweenPassCleanupEnd < remainingPass);
  assert.ok(remainingPass < remainingCleanup);
  assert.ok(remainingCleanup < p5bPass);
  assert.ok(p5bPass < p5bCleanup);
  assert.ok(p5bCleanup < p5dPass);
  assert.ok(p5dPass < p5dCleanup);
  assert.ok(p5dCleanup < p5cPass);
  assert.ok(p5cPass < p5cCleanup);
  assert.ok(p5cCleanup < p5ePass);
  assert.ok(p5ePass < p5eCleanup);
  assert.ok(p5eCleanup < p5f1Pass);
  assert.ok(p5f1Pass < p5f1Cleanup);
  assert.ok(p5f1Cleanup < p5f3Pass);
  assert.ok(p5f3Pass < p5f3Cleanup);
  assert.ok(p5f3Cleanup < p6aPass);
  assert.ok(p6aPass < p6aCleanup);
  assert.ok(p6aCleanup < p6bPass);
  assert.ok(p6bPass < p6bCleanup);
  assert.ok(p6bCleanup < p6cPass);
  assert.ok(p6cPass < p6cCleanup);
  assert.ok(p6cCleanup < p6dPass);
  assert.ok(p6dPass < p6dCleanup);
  assert.match(
    harness.slice(providerPass, betweenPassCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*EVO_P5F1_BROWSER_PROOF=0[\s\S]*EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0[\s\S]*--grep "\$\{PROVIDER_GATED_BROWSER_TESTS\}"/,
  );
  assert.match(
    harness.slice(p5bPass, p5bCleanup),
    /EVO_P5B_BROWSER_PROOF=1[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*EVO_P5F1_BROWSER_PROOF=0[\s\S]*EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0[\s\S]*--grep "\$\{P5B_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p5cPass, p5cCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=1[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*EVO_P5F1_BROWSER_PROOF=0[\s\S]*EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0[\s\S]*--grep "\$\{P5C_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p5dPass, p5dCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=1[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*EVO_P5F1_BROWSER_PROOF=0[\s\S]*EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0[\s\S]*--grep "\$\{P5D_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p5ePass, p5eCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=1[\s\S]*EVO_P5F1_BROWSER_PROOF=0[\s\S]*EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0[\s\S]*--grep "\$\{P5E_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p5f1Pass, p5f1Cleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*EVO_P5F1_BROWSER_PROOF=1[\s\S]*EVO_P5F3_BROWSER_PROOF=0[\s\S]*EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0[\s\S]*--grep "\$\{P5F1_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p5f3Pass, p5f3Cleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*EVO_P5F1_BROWSER_PROOF=0[\s\S]*EVO_P5F3_BROWSER_PROOF=1[\s\S]*EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0[\s\S]*--grep "\$\{P5F3_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p6aPass, p6aCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*EVO_P5F1_BROWSER_PROOF=0[\s\S]*EVO_P5F3_BROWSER_PROOF=0[\s\S]*EVO_P6A_BROWSER_PROOF=1[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=1[\s\S]*EVO_PLATFORM_AMOCRM_READ_ENABLED=0[\s\S]*EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED=0[\s\S]*--grep "\$\{P6A_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p6bPass, p6bCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*EVO_P5F1_BROWSER_PROOF=0[\s\S]*EVO_P5F3_BROWSER_PROOF=0[\s\S]*EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_P6B_BROWSER_PROOF=1[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0[\s\S]*EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=1[\s\S]*EVO_PLATFORM_AMOCRM_READ_ENABLED=0[\s\S]*EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED=0[\s\S]*--grep "\$\{P6B_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p6cPass, p6cCleanup),
    /EVO_P6B_BROWSER_PROOF=0[\s\S]*EVO_P6C_BROWSER_PROOF=1[\s\S]*EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=1[\s\S]*EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED=1[\s\S]*EVO_PLATFORM_AMOCRM_READ_ENABLED=0[\s\S]*EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED=0[\s\S]*--grep "\$\{P6C_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p6dPass, p6dCleanup),
    /EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_P6B_BROWSER_PROOF=0[\s\S]*EVO_P6C_BROWSER_PROOF=0[\s\S]*EVO_P6D_BROWSER_PROOF=1[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=1[\s\S]*EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=1[\s\S]*EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED=1[\s\S]*--grep "\$\{P6D_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(remainingPass, remainingCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*EVO_P5F1_BROWSER_PROOF=0[\s\S]*EVO_P5F3_BROWSER_PROOF=0[\s\S]*EVO_P6A_BROWSER_PROOF=0[\s\S]*EVO_P6B_BROWSER_PROOF=0[\s\S]*EVO_P6C_BROWSER_PROOF=0[\s\S]*EVO_P6D_BROWSER_PROOF=0[\s\S]*EVO_P7A_BROWSER_PROOF=0[\s\S]*EVO_P7B_BROWSER_PROOF=0[\s\S]*EVO_PLATFORM_P7A_AUDIT_ENABLED=0[\s\S]*EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0[\s\S]*EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0[\s\S]*EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=0[\s\S]*EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED=0[\s\S]*--grep-invert "\$\{PROVIDER_GATED_BROWSER_TESTS\}\|\$\{P5B_BROWSER_TEST\}\|\$\{P5C_BROWSER_TEST\}\|\$\{P5D_BROWSER_TEST\}\|\$\{P5E_BROWSER_TEST\}\|\$\{P5F1_BROWSER_TEST\}\|\$\{P5F3_BROWSER_TEST\}\|\$\{P6A_BROWSER_TEST\}\|\$\{P6B_BROWSER_TEST\}\|\$\{P6C_BROWSER_TEST\}\|\$\{P6D_BROWSER_TEST\}\|\$\{P7A_BROWSER_TEST\}\|\$\{P7B_BROWSER_TEST\}\|\$\{U2_BROWSER_TEST\}\|\$\{U4_BROWSER_TEST\}\|\$\{U5_BROWSER_TEST\}\|\$\{U6_BROWSER_TEST\}\|\$\{U7_BROWSER_TEST\}\|\$\{U8_BROWSER_TEST\}\|\$\{U9_BROWSER_TEST\}\|\$\{U10_BROWSER_TEST\}"/,
  );
  assert.equal(
    harness.slice(providerPass, finalCleanup).match(/EVO_P5B_BROWSER_PROOF=1/g)
      ?.length,
    1,
  );
  assert.equal(
    harness.slice(providerPass, finalCleanup).match(/EVO_P5C_BROWSER_PROOF=1/g)
      ?.length,
    1,
  );
  assert.equal(
    harness.slice(providerPass, finalCleanup).match(/EVO_P5D_BROWSER_PROOF=1/g)
      ?.length,
    1,
  );
  assert.equal(
    harness.slice(providerPass, finalCleanup).match(/EVO_P5E_BROWSER_PROOF=1/g)
      ?.length,
    1,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P5F1_BROWSER_PROOF=1/g)?.length,
    1,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P5F1_BROWSER_PROOF=0/g)?.length,
    17,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P5F3_BROWSER_PROOF=1/g)?.length,
    1,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P5F3_BROWSER_PROOF=0/g)?.length,
    17,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P6A_BROWSER_PROOF=1/g)?.length,
    1,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P6A_BROWSER_PROOF=0/g)?.length,
    17,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=1/g)?.length,
    2,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED=0/g)?.length,
    16,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P6B_BROWSER_PROOF=1/g)?.length,
    1,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P6B_BROWSER_PROOF=0/g)?.length,
    17,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=1/g)?.length,
    3,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=0/g)?.length,
    15,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P6C_BROWSER_PROOF=1/g)?.length,
    1,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P6C_BROWSER_PROOF=0/g)?.length,
    17,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED=1/g)?.length,
    2,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED=0/g)?.length,
    11,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P6D_BROWSER_PROOF=1/g)?.length,
    1,
  );
  assert.equal(
    harness
      .slice(providerPass, finalCleanup)
      .match(/EVO_P6D_BROWSER_PROOF=0/g)?.length,
    17,
  );
  assert.equal(
    harness.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5e/g)?.length,
    1,
  );
  assert.equal(
    harness.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5f1/g)?.length,
    1,
  );
  assert.equal(
    harness.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5f3/g)?.length,
    1,
  );
  assert.equal(
    harness.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6a/g)?.length,
    1,
  );
  assert.equal(
    harness.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6b/g)?.length,
    1,
  );
  assert.equal(
    harness.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6c/g)?.length,
    1,
  );
  assert.equal(
    harness.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6d/g)?.length,
    1,
  );
  assert.doesNotMatch(executableLines, /run_with_deadline 900000 env/);
});

test("P6A browser proof enables only read-only Portal attention", () => {
  const p6aPartition = harness.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6a",
  );
  const p6aCommand = harness.lastIndexOf(
    "if ! run_with_deadline 240000 env \\",
    p6aPartition,
  );
  const p6aCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P6A browser partition."',
    p6aPartition,
  );
  const p6aSource = harness.slice(p6aCommand, p6aCleanup);

  assert.notEqual(p6aPartition, -1);
  assert.notEqual(p6aCommand, -1);
  assert.notEqual(p6aCleanup, -1);
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED:[\s\S]*p6aBrowserProof \|\| p6dBrowserProof \? "1" : "0"/,
  );
  assert.match(
    platformAuthConfig,
    /\(platformAuthBrowserPartition === "p6a"\) !== p6aBrowserProof/,
  );
  assert.match(
    authHook,
    /"create_payment_obligation"[\s\S]*"p6a-student-portal-finance-overdue"/,
  );
  assert.match(
    authHook,
    /p6a: \{[\s\S]*sameOrgOtherStudentCaseId: bw4UnrelatedCaseId[\s\S]*overduePaymentObligationId: p6aOverduePaymentObligationId/,
  );
  assert.match(
    platformAuthSpec,
    /EVO_P6A_BROWSER_PROOF !== "1"[\s\S]*portal-attention-read-only[\s\S]*portal-overdue-payment-helper/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED: p5f3BrowserProof \? "1" : "0"/,
  );
  assert.doesNotMatch(
    platformAuthConfig,
    /EVO_PLATFORM_(?:WAHA|AI_MEMORY|AUTONOMOUS)[A-Z0-9_]*_ENABLED: p6aBrowserProof/,
  );
  for (const disabledFlag of [
    "EVO_PLATFORM_AMOCRM_READ_ENABLED",
    "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED",
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "EVO_PLATFORM_WAHA_WORKER_ENABLED",
    "EVO_PLATFORM_WAHA_HISTORY_ENABLED",
    "EVO_PLATFORM_WAHA_MEDIA_ENABLED",
    "EVO_PLATFORM_AI_MEMORY_ENABLED",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED",
  ]) {
    assert.match(p6aSource, new RegExp(`${disabledFlag}=0`), disabledFlag);
  }
  assert.match(
    p6aSource,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/,
  );
});

test("P6B browser proof enables only in-app Portal notifications", () => {
  const p6bPartition = harness.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6b",
  );
  const p6bCommand = harness.lastIndexOf(
    "if ! run_with_deadline 240000 env \\",
    p6bPartition,
  );
  const p6bCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P6B browser partition."',
    p6bPartition,
  );
  const p6bSource = harness.slice(p6bCommand, p6bCleanup);

  assert.notEqual(p6bPartition, -1);
  assert.notEqual(p6bCommand, -1);
  assert.notEqual(p6bCleanup, -1);
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED:[\s\S]*p6bBrowserProof \|\| p6cBrowserProof \|\| p6dBrowserProof \? "1" : "0"/,
  );
  assert.match(
    platformAuthConfig,
    /\(platformAuthBrowserPartition === "p6b"\) !== p6bBrowserProof/,
  );
  assert.match(
    authHook,
    /p6bStudent: syntheticIdentity\("p6b-student"\)[\s\S]*crossOrgStudent: syntheticIdentity\("cross-org-student"\)/,
  );
  assert.match(
    authHook,
    /INSERT INTO platform_private\.student_portal_notification_runtime_controls[\s\S]*p6b-runtime-control-enable/,
  );
  assert.match(
    authHook,
    /platform\.record_document_version_metadata\([\s\S]*p6b-document-version-record[\s\S]*p6b: \{[\s\S]*documentVersionId: p6bDocumentVersionId/,
  );
  assert.match(
    platformAuthSpec,
    /EVO_P6B_BROWSER_PROOF !== "1"[\s\S]*portal-notifications-realtime[\s\S]*platform-document-review-form[\s\S]*student_portal_notifications_v1[\s\S]*portal-notification-mark-read/,
  );
  assert.doesNotMatch(
    platformAuthConfig,
    /EVO_PLATFORM_(?:WAHA|AI_MEMORY|AUTONOMOUS)[A-Z0-9_]*_ENABLED: p6bBrowserProof/,
  );
  for (const disabledFlag of [
    "EVO_PLATFORM_AMOCRM_READ_ENABLED",
    "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED",
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "EVO_PLATFORM_WAHA_WORKER_ENABLED",
    "EVO_PLATFORM_WAHA_HISTORY_ENABLED",
    "EVO_PLATFORM_WAHA_MEDIA_ENABLED",
    "EVO_PLATFORM_AI_MEMORY_ENABLED",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED",
  ]) {
    assert.match(p6bSource, new RegExp(`${disabledFlag}=0`), disabledFlag);
  }
  assert.match(
    p6bSource,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/,
  );
  assert.match(p6bSource, /EVO_P6C_BROWSER_PROOF=0/);
  assert.match(
    p6bSource,
    /EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED=0/,
  );
});

test("P6C browser proof enables only the prerequisite feed and overdue producer", () => {
  const p6cPartition = harness.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6c",
  );
  const p6cCommand = harness.lastIndexOf(
    "if ! run_with_deadline 240000 env \\",
    p6cPartition,
  );
  const p6cCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P6C browser partition."',
    p6cPartition,
  );
  const p6cSource = harness.slice(p6cCommand, p6cCleanup);

  assert.notEqual(p6cPartition, -1);
  assert.notEqual(p6cCommand, -1);
  assert.notEqual(p6cCleanup, -1);
  assert.match(
    platformAuthConfig,
    /\(platformAuthBrowserPartition === "p6c"\) !== p6cBrowserProof/,
  );
  assert.match(p6cSource, /EVO_P6C_BROWSER_PROOF=1/);
  assert.match(
    p6cSource,
    /EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=1/,
  );
  assert.match(
    p6cSource,
    /EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED=1/,
  );
  assert.match(
    platformAuthSpec,
    /EVO_P6C_BROWSER_PROOF !== "1"[\s\S]*api\/internal\/platform-operations\/portal-overdue[\s\S]*student_portal_notifications_v2[\s\S]*portal-notification-mark-read/,
  );
  for (const disabledFlag of [
    "EVO_PLATFORM_AMOCRM_READ_ENABLED",
    "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED",
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "EVO_PLATFORM_WAHA_WORKER_ENABLED",
    "EVO_PLATFORM_WAHA_HISTORY_ENABLED",
    "EVO_PLATFORM_WAHA_MEDIA_ENABLED",
    "EVO_PLATFORM_AI_MEMORY_ENABLED",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED",
  ]) {
    assert.match(p6cSource, new RegExp(`${disabledFlag}=0`), disabledFlag);
  }
  assert.match(
    p6cSource,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/,
  );
});

test("P6D browser proof composes only Portal capabilities and keeps every provider lane off", () => {
  const p6dPartition = harness.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6d",
  );
  const p6dCommand = harness.lastIndexOf(
    "if ! run_with_deadline 660000 env \\",
    p6dPartition,
  );
  const p6dCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P6D browser partition."',
    p6dPartition,
  );
  const p6dSource = harness.slice(p6dCommand, p6dCleanup);

  assert.notEqual(p6dPartition, -1);
  assert.notEqual(p6dCommand, -1);
  assert.notEqual(p6dCleanup, -1);
  assert.match(p6dSource, /EVO_P6D_BROWSER_PROOF=1/);
  for (const disabledProof of [
    "EVO_P5B_BROWSER_PROOF",
    "EVO_P5C_BROWSER_PROOF",
    "EVO_P5D_BROWSER_PROOF",
    "EVO_P5E_BROWSER_PROOF",
    "EVO_P5F1_BROWSER_PROOF",
    "EVO_P5F3_BROWSER_PROOF",
    "EVO_P6A_BROWSER_PROOF",
    "EVO_P6B_BROWSER_PROOF",
    "EVO_P6C_BROWSER_PROOF",
  ]) {
    assert.match(p6dSource, new RegExp(`${disabledProof}=0`), disabledProof);
  }
  for (const enabledCapability of [
    "EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED",
    "EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED",
    "EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED",
  ]) {
    assert.match(
      p6dSource,
      new RegExp(`${enabledCapability}=1`),
      enabledCapability,
    );
  }
  for (const disabledFlag of [
    "EVO_PLATFORM_AMOCRM_READ_ENABLED",
    "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED",
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "EVO_PLATFORM_WAHA_WORKER_ENABLED",
    "EVO_PLATFORM_WAHA_HISTORY_ENABLED",
    "EVO_PLATFORM_WAHA_MEDIA_ENABLED",
    "EVO_PLATFORM_AI_MEMORY_ENABLED",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED",
  ]) {
    assert.match(p6dSource, new RegExp(`${disabledFlag}=0`), disabledFlag);
  }
  assert.match(
    p6dSource,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/,
  );
  assert.match(
    platformAuthSpec,
    /EVO_P6D_BROWSER_PROOF !== "1"[\s\S]*platform-visa-form[\s\S]*student-case-close-form[\s\S]*platform-document-review-form[\s\S]*portal-notification-destination[\s\S]*settle_payment_obligation/,
  );
  assert.match(
    authHook,
    /p6dApplications[\s\S]*p6d: \{[\s\S]*crossOrgStudentCaseId: p6dCrossOrgStudentCaseId/,
  );
  assert.match(
    platformAuthSpec,
    /record_document_version_metadata[\s\S]*synthetic-non-storage:p6d-browser-proof[\s\S]*platform-document-review-form/,
  );
});

test("P5F1 browser proof is isolated and keeps provider and WAHA execution disabled", () => {
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_AI_MEMORY_ENABLED: p5f1BrowserProof \? "1" : "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_INGRESS_ENABLED:[\s\S]*p5bBrowserProof \|\|[\s\S]*p5dBrowserProof \|\|[\s\S]*p5eBrowserProof \|\|[\s\S]*p5f3BrowserProof[\s\S]*\? "1"[\s\S]*: "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_WORKER_ENABLED:[\s\S]*p5bBrowserProof \|\|[\s\S]*p5dBrowserProof \|\|[\s\S]*p5eBrowserProof \|\|[\s\S]*p5f3BrowserProof[\s\S]*\? "1"[\s\S]*: "0"/,
  );
  assert.doesNotMatch(
    platformAuthConfig,
    /p5f1BrowserProof[\s\S]{0,120}EVO_PLATFORM_WAHA_(?:INGRESS|WORKER|HISTORY|MEDIA)_ENABLED/,
  );
});

test("P5F3 browser proof alone enables the fail-closed synthetic autonomous lane", () => {
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED: p5f3BrowserProof \? "1" : "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH: p5f3BrowserProof[\s\S]*\? "0"[\s\S]*: "1"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_BASE_URL: p5f3BrowserProof[\s\S]*"http:\/\/127\.0\.0\.1:3314"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_API_KEY: p5f3BrowserProof[\s\S]*fixture\.p5c\.wahaApiKey/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_AUTONOMOUS_REPLIES_TRIGGER_SECRET: p5f3BrowserProof[\s\S]*fixture\.p5f3\.autonomousReplyTriggerSecret/,
  );
  assert.match(authHook, /const p5cWahaApiKey = randomBytes\(48\)/);
  assert.match(
    authHook,
    /const p5f3AutonomousReplyTriggerSecret = randomBytes\(48\)/,
  );
  assert.match(
    authHook,
    /p5f3: \{[\s\S]*autonomousReplyTriggerSecret: p5f3AutonomousReplyTriggerSecret/,
  );
  assert.doesNotMatch(harness, /p5f3AutonomousReplyTriggerSecret/);
});

test("P5F3 pins only its private policy clock and restores the exact production body", () => {
  const override = harness.indexOf("\nif ! override_p5f3_policy_clock; then\n");
  const p5f3Partition = harness.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5f3",
    override,
  );
  const p5f3Cleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P5F3 browser partition."',
    p5f3Partition,
  );
  const restore = harness.indexOf(
    "\nif ! restore_p5f3_policy_clock; then\n",
    p5f3Cleanup,
  );
  const p6aPartition = harness.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6a",
    restore,
  );
  const remainingPartition = harness.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=remaining",
  );

  assert.notEqual(override, -1);
  assert.notEqual(p5f3Partition, -1);
  assert.notEqual(p5f3Cleanup, -1);
  assert.notEqual(restore, -1);
  assert.notEqual(p6aPartition, -1);
  assert.notEqual(remainingPartition, -1);
  assert.ok(override < p5f3Partition);
  assert.ok(p5f3Partition < p5f3Cleanup);
  assert.ok(p5f3Cleanup < restore);
  assert.ok(restore < p6aPartition);
  assert.ok(remainingPartition < override);
  assert.match(
    harness,
    /CREATE OR REPLACE FUNCTION platform_private\.p5f3_policy_now\(\)[\s\S]*local_now::TIME < TIME '09:00'[\s\S]*local_now::TIME >= TIME '21:00'[\s\S]*AT TIME ZONE 'Asia\/Bishkek'/,
  );
  assert.match(
    harness,
    /CREATE OR REPLACE FUNCTION platform_private\.p5f3_policy_now\(\)[\s\S]*SELECT pg_catalog\.statement_timestamp\(\)[\s\S]*source_body IS DISTINCT FROM 'SELECTpg_catalog\.statement_timestamp\(\)'[\s\S]*volatility IS DISTINCT FROM 's'/,
  );
  assert.match(
    harness,
    /if \[\[ "\$\{p5f3_policy_clock_overridden\}" == true \]\]; then[\s\S]*restore_p5f3_policy_clock/,
  );
  assert.doesNotMatch(harness, /ALTER SYSTEM|p5f3_policy_now[\s\S]{0,120}set_config/);
  assert.match(
    harness,
    /function_settings IS DISTINCT FROM ARRAY\['search_path=""'\]::TEXT\[\][\s\S]*privilege\.grantee = 0/,
  );
});

test("P5C browser proof uses runtime-only secrets and keeps ingress and send worker disabled", () => {
  assert.match(
    authHook,
    /const p5cWahaApiKey = randomBytes\(48\)\.toString\("base64url"\)/,
  );
  assert.match(
    authHook,
    /const p5cHistoryTriggerSecret = randomBytes\(48\)\.toString\("base64url"\)/,
  );
  assert.match(
    authHook,
    /p5c: \{[\s\S]*wahaApiKey: p5cWahaApiKey,[\s\S]*historyTriggerSecret: p5cHistoryTriggerSecret/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_INGRESS_ENABLED:[\s\S]*p5bBrowserProof \|\|[\s\S]*p5dBrowserProof \|\|[\s\S]*p5eBrowserProof \|\|[\s\S]*p5f3BrowserProof[\s\S]*\? "1"[\s\S]*: "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_WORKER_ENABLED:[\s\S]*p5bBrowserProof \|\|[\s\S]*p5dBrowserProof \|\|[\s\S]*p5eBrowserProof \|\|[\s\S]*p5f3BrowserProof[\s\S]*\? "1"[\s\S]*: "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_HISTORY_ENABLED: p5cBrowserProof \? "1" : "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_HISTORY_BASE_URL: p5cBrowserProof[\s\S]*"http:\/\/127\.0\.0\.1:3312"/,
  );
});

test("P5D browser proof uses runtime-only secrets and keeps the media lane disabled outside its own partition", () => {
  assert.match(
    authHook,
    /const p5dWahaApiKey = randomBytes\(48\)\.toString\("base64url"\)/,
  );
  assert.match(
    authHook,
    /const p5dMediaTriggerSecret = randomBytes\(48\)\.toString\("base64url"\)/,
  );
  assert.match(
    authHook,
    /p5d: \{[\s\S]*wahaApiKey: p5dWahaApiKey,[\s\S]*mediaTriggerSecret: p5dMediaTriggerSecret/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_MEDIA_ENABLED: p5dBrowserProof \? "1" : "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_MEDIA_BASE_URL: p5dBrowserProof[\s\S]*"http:\/\/127\.0\.0\.1:3313"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_INGRESS_ENABLED:[\s\S]*p5bBrowserProof \|\|[\s\S]*p5dBrowserProof \|\|[\s\S]*p5eBrowserProof \|\|[\s\S]*p5f3BrowserProof[\s\S]*\? "1"[\s\S]*: "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_WORKER_ENABLED:[\s\S]*p5bBrowserProof \|\|[\s\S]*p5dBrowserProof \|\|[\s\S]*p5eBrowserProof \|\|[\s\S]*p5f3BrowserProof[\s\S]*\? "1"[\s\S]*: "0"/,
  );
});

test("empty-queue proof is reset before Auth, Storage, and terminal browser validation", () => {
  const storageGate = harness.indexOf(
    '"${REPO_ROOT}/scripts/test-p2h-storage-api.mjs"',
  );
  const queueGate = harness.indexOf(
    '"${REPO_ROOT}/scripts/test-p2g-queues-runtime.sh"',
  );
  const authGate = harness.indexOf(
    '"${REPO_ROOT}/scripts/test-supabase-auth-hook.mjs"',
  );
  const browserGate = harness.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=provider",
  );
  const postQueueReset = harness.indexOf("post-queue-reset.json");

  assert.ok(queueGate > 0);
  assert.ok(postQueueReset > queueGate);
  assert.ok(authGate > postQueueReset);
  assert.ok(storageGate > authGate);
  assert.ok(browserGate > storageGate);
  assert.doesNotMatch(harness, /post-browser-reset/);
});

test("browser health refresh is exact-local and preserves Org A AI negative proof", () => {
  const refreshStart = harness.indexOf("refresh_synthetic_browser_health() {");
  const refreshEnd = harness.indexOf(
    "\n}\n\nappend_p7b_non_provider_health_boundary() {",
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

test("P7B appends a local-non-provider boundary after provider-dependent browser proofs", () => {
  const boundaryStart = harness.indexOf(
    "append_p7b_non_provider_health_boundary() {",
  );
  const boundaryEnd = harness.indexOf(
    "\n}\n\noverride_p5f3_policy_clock() {",
    boundaryStart,
  );
  const boundarySource = harness.slice(boundaryStart, boundaryEnd);
  const p7aCleanup = harness.indexOf(
    'fail "The exact-worktree Platform browser server did not stop after the P7A browser partition."',
  );
  const boundaryCall = harness.indexOf(
    "\nappend_p7b_non_provider_health_boundary\n",
    p7aCleanup,
  );
  const p7bPartition = harness.indexOf(
    "EVO_PLATFORM_AUTH_BROWSER_PARTITION=p7b",
    boundaryCall,
  );

  assert.notEqual(boundaryStart, -1);
  assert.notEqual(boundaryEnd, -1);
  assert.ok(p7aCleanup < boundaryCall);
  assert.ok(boundaryCall < p7bPartition);
  assert.equal(
    boundarySource.match(/record_messaging_integration_health_event/g)?.length,
    1,
  );
  assert.equal(
    boundarySource.match(/'local_non_provider'/g)?.length,
    1,
  );
  assert.doesNotMatch(boundarySource, /'provider_observed'/);
  assert.match(
    boundarySource,
    /FROM platform\.organizations[\s\S]*status = 'active'[\s\S]*ORDER BY id/,
  );
  assert.match(
    boundarySource,
    /ARRAY\['ai', 'waha'\]::platform\.messaging_integration_target\[\]/,
  );
  assert.match(boundarySource, /organization_record\.id,\n\s+target_value,/);
  assert.doesNotMatch(boundarySource, /EVO P2C Synthetic Organization [AB]/);
  assert.doesNotMatch(boundarySource, /https?:\/\//);
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
  const emptyFingerprint = spawnSync(
    "bash",
    [
      "-c",
      `
set -Eeuo pipefail
readonly INBOX_STACK_LABEL="com.supabase.cli.project=inbox"
run_with_deadline() {
  return 0
}
${capture}
capture_inbox_stack_fingerprint "$1"
[[ -f "$1" && ! -s "$1" ]]
`,
      "evo-inbox-empty-fingerprint-test",
      join(temporaryDirectory, "empty.txt"),
    ],
    { encoding: "utf8" },
  );
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
    assert.equal(emptyFingerprint.status, 0, emptyFingerprint.stderr);

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

test("post-migration reset recovery stays exact-project and proves parity", () => {
  const { migrationHistory, detector, reload, recover } =
    extractResetRecoverySource();

  assert.match(
    harness,
    /readonly KNOWN_STORAGE_GATEWAY_ERROR_CODE="LegacyStorageGatewayStatusError"/,
  );
  assert.match(
    harness,
    /readonly KNOWN_STORAGE_GATEWAY_502_STATUS="Error status 502:"/,
  );
  assert.match(
    harness,
    /readonly KNOWN_STORAGE_GATEWAY_502_MESSAGE="An invalid response was received from the upstream server"/,
  );
  assert.match(detector, /grep -Fq "Restarting containers"/);
  assert.match(detector, /last_nonempty_line/);
  assert.match(detector, /KNOWN_STORAGE_GATEWAY_ERROR_CODE/);
  assert.match(detector, /KNOWN_STORAGE_GATEWAY_502_STATUS/);
  assert.match(detector, /KNOWN_STORAGE_GATEWAY_502_MESSAGE/);
  assert.match(migrationHistory, /migration list \\\n+\s+--local/);
  assert.match(migrationHistory, /\["canonical files", local\]/);
  assert.match(migrationHistory, /\["applied local database", applied\]/);
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
    /reset_reached_post_migration_restart_failure[\s\S]*"\$\{progress_log\}" "\$\{result_file\}"[\s\S]*reload_exact_local_kong[\s\S]*wait_for_local_stack_readiness[\s\S]*assert_local_migration_history recovery/,
  );
});

test("post-migration recovery rejects unrelated errors after restart", () => {
  const { detector } = extractResetRecoverySource();
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "evo-reset-detector-"));
  const runDetector = (name, contents, resultContents = "") => {
    const progressLog = join(temporaryDirectory, `${name}.log`);
    const resultFile = join(temporaryDirectory, `${name}.json`);
    writeFileSync(progressLog, contents, { mode: 0o600 });
    writeFileSync(resultFile, resultContents, { mode: 0o600 });
    return spawnSync(
      "bash",
      [
        "-c",
        `
set -Eeuo pipefail
readonly KNOWN_STORAGE_GATEWAY_ERROR_CODE="LegacyStorageGatewayStatusError"
readonly KNOWN_STORAGE_GATEWAY_502_STATUS="Error status 502:"
readonly KNOWN_STORAGE_GATEWAY_502_MESSAGE="An invalid response was received from the upstream server"
${detector}
reset_reached_post_migration_restart_failure "$1" "$2"
`,
        "bash",
        progressLog,
        resultFile,
      ],
      { encoding: "utf8" },
    );
  };

  try {
    assert.equal(
      runDetector("stalled", "Applying migrations\nRestarting containers...\n")
        .status,
      0,
    );
    assert.equal(
      runDetector(
        "known-502",
        "Restarting containers...\nError status 502:\nAn invalid response was received from the upstream server\n",
      ).status,
      0,
    );
    assert.equal(
      runDetector(
        "known-502-split-output",
        "Applying migration 071_platform_audit_search_export.sql...\nRestarting containers...\nerror running container: exit 1\n",
        '{"_tag":"Error","error":{"code":"LegacyStorageGatewayStatusError","message":"Error status 502: An invalid response was received from the upstream server"}}\n',
      ).status,
      0,
    );
    assert.equal(
      runDetector(
        "stalled-with-cli-update-notice",
        "Restarting containers...\nA new version of Supabase CLI is available: v2.113.0 (currently installed v2.110.0)\nWe recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli\n",
      ).status,
      0,
    );
    assert.notEqual(
      runDetector(
        "unrelated",
        "Restarting containers...\nERROR: migration checksum mismatch\n",
      ).status,
      0,
    );
    assert.notEqual(
      runDetector(
        "known-502-then-unrelated",
        "Restarting containers...\nError status 502:\nAn invalid response was received from the upstream server\nERROR: later unrelated failure\n",
      ).status,
      0,
    );
    assert.notEqual(
      runDetector(
        "unrelated-before-cli-update-notice",
        "Restarting containers...\nERROR: migration checksum mismatch\nA new version of Supabase CLI is available: v2.113.0 (currently installed v2.110.0)\nWe recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli\n",
      ).status,
      0,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("post-migration recovery reloads or restarts only owned Kong", () => {
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
  [[ \${MODE} != readiness-failure ]]
}

assert_local_migration_history() {
  [[ \${MODE} != parity-failure ]]
}

${combined}

readonly RESET_LOG="\${TEMP_DIR}/reset-\${MODE}.log"
printf 'Restarting containers...\\n' >"\${RESET_LOG}"

case "\${MODE}" in
  missing-restart)
    printf 'Recreating database...\\n' >"\${RESET_LOG}"
    ;;
esac

if [[ \${MODE} == foreign ]]; then
  if reload_exact_local_kong; then
    exit 90
  fi
elif [[ \${MODE} == missing-restart || \${MODE} == readiness-failure || \${MODE} == parity-failure ]]; then
  if recover_post_migration_restart_failure "\${RESET_LOG}"; then
    exit 91
  fi
else
  recover_post_migration_restart_failure "\${RESET_LOG}"
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

    assert.equal(runMode("missing-restart"), "");
    for (const mode of ["readiness-failure", "parity-failure"]) {
      const commands = runMode(mode);
      assert.match(commands, /docker inspect/, mode);
      assert.match(
        commands,
        /docker exec supabase_kong_evo-platform-local kong reload/,
        mode,
      );
      assert.doesNotMatch(commands, /docker restart/, mode);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("both reset phases use only proved post-migration recovery", () => {
  assert.match(
    harness,
    /reset_reached_post_migration_restart_failure[\s\S]*"\$\{TEMP_DIR\}\/reset\.log"[\s\S]*recover_post_migration_restart_failure[\s\S]*"\$\{TEMP_DIR\}\/reset\.log"/,
  );
  assert.match(
    harness,
    /reset_reached_post_migration_restart_failure[\s\S]*"\$\{TEMP_DIR\}\/post-queue-reset\.log"[\s\S]*recover_post_migration_restart_failure[\s\S]*"\$\{TEMP_DIR\}\/post-queue-reset\.log"/,
  );

  for (const retryArtifact of ["reset-retry.json", "reset-retry.log"]) {
    assert.doesNotMatch(harness, new RegExp(retryArtifact.replaceAll(".", "\\.")));
  }

  assert.match(
    harness,
    /Initial disposable Supabase reset failed before the proved post-migration recovery boundary\./,
  );
  assert.match(
    harness,
    /Post-queue disposable Supabase reset failed before the proved post-migration recovery boundary\./,
  );
  assert.doesNotMatch(harness, /Post-browser disposable Supabase reset/);
});

test("browser partitions isolate Next dev artifacts by disposable run and partition", () => {
  const nextConfigPartitionList = nextConfig.match(
    /const platformAuthPartitions = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];
  const playwrightConfigPartitionList = platformAuthConfig.match(
    /!platformAuthBrowserPartition \|\|\s*!\[([\s\S]*?)\]\.includes\(/,
  )?.[1];
  assert.ok(
    nextConfigPartitionList,
    "Next config partition allowlist is missing",
  );
  assert.ok(
    playwrightConfigPartitionList,
    "Playwright config partition allowlist is missing",
  );
  assert.match(
    harness,
    /readonly BROWSER_BUILD_RUN_KEY=/,
  );
  for (const partition of [
    "provider",
    "p5b",
    "p5c",
    "p5d",
    "p5e",
    "p5f1",
    "p5f3",
    "p6a",
    "p6b",
    "p6c",
    "p6d",
    "p7a",
    "p7b",
    "u2",
    "u6",
    "u7",
    "u8",
    "u9",
    "u10",
    "remaining",
  ]) {
    assert.match(
      harness,
      new RegExp(`EVO_PLATFORM_AUTH_BROWSER_PARTITION=${partition}`),
      partition,
    );
    assert.match(
      nextConfigPartitionList,
      new RegExp(`"${partition}"`),
      `${partition} is missing from the Next config partition allowlist`,
    );
    assert.match(
      playwrightConfigPartitionList,
      new RegExp(`"${partition}"`),
      `${partition} is missing from the Playwright config partition allowlist`,
    );
  }
  assert.match(
    harness,
    /\.next\/platform-auth\/\$\{BROWSER_BUILD_RUN_KEY\}/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_AUTH_DEV_RUN_KEY/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_AUTH_BROWSER_PARTITION/,
  );
  assert.match(
    nextConfig,
    /\.next\/platform-auth\/\$\{platformAuthDevRunKey\}/,
  );
  assert.match(nextConfig, /\{ distDir: platformAuthDistDir \}/);
});

test("browser partitions keep Next type includes out of the tracked root tsconfig", () => {
  assert.match(harness, /prepare_platform_auth_tsconfig\(\)/);
  assert.match(
    harness,
    /for browser_partition in provider p5b p5c p5d p5e p5f1 p5f3 p6a p6b p6c p6d p7a p7b u2 u6 u7 u8 u9 u10 remaining; do/,
  );
  assert.match(
    harness,
    /provider\|p5b\|p5c\|p5d\|p5e\|p5f1\|p5f3\|p6a\|p6b\|p6c\|p6d\|p7a\|p7b\|u2\|u6\|u7\|u8\|u9\|u10\|remaining\) ;;/,
  );
  assert.match(
    harness,
    /extends: path\.relative\(path\.dirname\(outputPath\), rootTsconfig\)/,
  );
  for (const partition of [
    "provider",
    "p5b",
    "p5c",
    "p5d",
    "p5e",
    "p5f1",
    "p5f3",
    "p6a",
    "p6b",
    "p6c",
    "p6d",
    "p7a",
    "p7b",
    "u2",
    "u6",
    "u7",
    "u8",
    "u9",
    "u10",
    "remaining",
  ]) {
    assert.match(
      harness,
      new RegExp(
        'EVO_PLATFORM_AUTH_TSCONFIG_PATH="\\$\\{PLATFORM_AUTH_TSCONFIG_DIR_RELATIVE\\}/tsconfig-platform-auth-' +
          partition +
          '\\.json"',
      ),
      partition,
    );
  }
  assert.match(platformAuthConfig, /EVO_PLATFORM_AUTH_TSCONFIG_PATH/);
  assert.match(
    platformAuthConfig,
    /path\.resolve\(projectRoot, platformAuthTsconfigPath\)/,
  );
  assert.match(
    platformAuthConfig,
    /path\.join\(projectRoot, "\.next", "platform-auth", platformAuthDevRunKey\)/,
  );
  assert.match(nextConfig, /path\.isAbsolute\(platformAuthTsconfigPath\)/);
  assert.match(
    nextConfig,
    /typescript:[\s\S]*tsconfigPath: platformAuthTsconfigPath/,
  );
});

test("post-migration reset recovery proves parity at a narrowly classified boundary", () => {
  assert.match(
    harness,
    /reset_reached_post_migration_restart_failure\(\)/,
  );
  assert.match(
    harness,
    /assert_local_migration_history\(\)/,
  );
  assert.match(
    harness,
    /recover_post_migration_restart_failure\(\)[\s\S]*reset_reached_post_migration_restart_failure[\s\S]*reload_exact_local_kong[\s\S]*wait_for_local_stack_readiness[\s\S]*assert_local_migration_history/,
  );
  assert.match(executableLines, /last_nonempty_line/);
  assert.match(executableLines, /KNOWN_STORAGE_GATEWAY_ERROR_CODE/);
  assert.match(executableLines, /KNOWN_STORAGE_GATEWAY_502_STATUS/);
  assert.match(executableLines, /KNOWN_STORAGE_GATEWAY_502_MESSAGE/);
});
