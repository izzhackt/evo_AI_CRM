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

test("provider, P5B, P5D, P5C and P5E browser partitions run before the remaining suite", () => {
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
  const remainingPass = harness.indexOf(
    "if ! run_with_deadline 660000 env \\",
    p5eCleanup,
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
  assert.notEqual(providerPass, -1);
  assert.notEqual(betweenPassCleanup, -1);
  assert.notEqual(p5bPass, -1);
  assert.notEqual(p5bCleanup, -1);
  assert.notEqual(p5cPass, -1);
  assert.notEqual(p5cCleanup, -1);
  assert.notEqual(p5dPass, -1);
  assert.notEqual(p5dCleanup, -1);
  assert.notEqual(p5ePass, -1);
  assert.notEqual(p5eCleanup, -1);
  assert.notEqual(remainingPass, -1);
  assert.notEqual(finalCleanup, -1);
  assert.ok(providerPass < betweenPassCleanup);
  assert.ok(betweenPassCleanup < p5bPass);
  assert.ok(p5bPass < p5bCleanup);
  assert.ok(p5bCleanup < p5dPass);
  assert.ok(p5dPass < p5dCleanup);
  assert.ok(p5dCleanup < p5cPass);
  assert.ok(p5cPass < p5cCleanup);
  assert.ok(p5cCleanup < p5ePass);
  assert.ok(p5ePass < p5eCleanup);
  assert.ok(p5eCleanup < remainingPass);
  assert.ok(remainingPass < finalCleanup);
  assert.match(
    harness.slice(providerPass, betweenPassCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*--grep "\$\{PROVIDER_GATED_BROWSER_TESTS\}"/,
  );
  assert.match(
    harness.slice(p5bPass, p5bCleanup),
    /EVO_P5B_BROWSER_PROOF=1[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*--grep "\$\{P5B_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p5cPass, p5cCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=1[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*--grep "\$\{P5C_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p5dPass, p5dCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=1[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*--grep "\$\{P5D_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(p5ePass, p5eCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=1[\s\S]*--grep "\$\{P5E_BROWSER_TEST\}"/,
  );
  assert.match(
    harness.slice(remainingPass, finalCleanup),
    /EVO_P5B_BROWSER_PROOF=0[\s\S]*EVO_P5C_BROWSER_PROOF=0[\s\S]*EVO_P5D_BROWSER_PROOF=0[\s\S]*EVO_P5E_BROWSER_PROOF=0[\s\S]*--grep-invert "\$\{PROVIDER_GATED_BROWSER_TESTS\}\|\$\{P5B_BROWSER_TEST\}\|\$\{P5C_BROWSER_TEST\}\|\$\{P5D_BROWSER_TEST\}\|\$\{P5E_BROWSER_TEST\}"/,
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
    harness.match(/EVO_PLATFORM_AUTH_BROWSER_PARTITION=p5e/g)?.length,
    1,
  );
  assert.doesNotMatch(executableLines, /run_with_deadline 900000 env/);
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
    /EVO_PLATFORM_WAHA_INGRESS_ENABLED:[\s\S]*p5bBrowserProof \|\| p5dBrowserProof \|\| p5eBrowserProof \? "1" : "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_WORKER_ENABLED:[\s\S]*p5bBrowserProof \|\| p5dBrowserProof \|\| p5eBrowserProof \? "1" : "0"/,
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
    /EVO_PLATFORM_WAHA_INGRESS_ENABLED:[\s\S]*p5bBrowserProof \|\| p5dBrowserProof \|\| p5eBrowserProof \? "1" : "0"/,
  );
  assert.match(
    platformAuthConfig,
    /EVO_PLATFORM_WAHA_WORKER_ENABLED:[\s\S]*p5bBrowserProof \|\| p5dBrowserProof \|\| p5eBrowserProof \? "1" : "0"/,
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
    /readonly KNOWN_STORAGE_GATEWAY_502_STATUS="Error status 502:"/,
  );
  assert.match(
    harness,
    /readonly KNOWN_STORAGE_GATEWAY_502_MESSAGE="An invalid response was received from the upstream server"/,
  );
  assert.match(detector, /grep -Fq "Restarting containers"/);
  assert.match(detector, /last_nonempty_line/);
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
    /reset_reached_post_migration_restart_failure "\$\{progress_log\}"[\s\S]*reload_exact_local_kong[\s\S]*wait_for_local_stack_readiness[\s\S]*assert_local_migration_history recovery/,
  );
});

test("post-migration recovery rejects unrelated errors after restart", () => {
  const { detector } = extractResetRecoverySource();
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "evo-reset-detector-"));
  const runDetector = (name, contents) => {
    const progressLog = join(temporaryDirectory, `${name}.log`);
    writeFileSync(progressLog, contents, { mode: 0o600 });
    return spawnSync(
      "bash",
      [
        "-c",
        `
set -Eeuo pipefail
readonly KNOWN_STORAGE_GATEWAY_502_STATUS="Error status 502:"
readonly KNOWN_STORAGE_GATEWAY_502_MESSAGE="An invalid response was received from the upstream server"
${detector}
reset_reached_post_migration_restart_failure "$1"
`,
        "bash",
        progressLog,
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
  assert.match(
    harness,
    /readonly BROWSER_BUILD_RUN_KEY=/,
  );
  for (const partition of ["provider", "p5b", "p5c", "p5d", "p5e", "remaining"]) {
    assert.match(
      harness,
      new RegExp(`EVO_PLATFORM_AUTH_BROWSER_PARTITION=${partition}`),
      partition,
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
    /extends: path\.relative\(path\.dirname\(outputPath\), rootTsconfig\)/,
  );
  for (const partition of ["provider", "p5b", "p5c", "p5d", "p5e", "remaining"]) {
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
  assert.match(executableLines, /KNOWN_STORAGE_GATEWAY_502_STATUS/);
  assert.match(executableLines, /KNOWN_STORAGE_GATEWAY_502_MESSAGE/);
});
