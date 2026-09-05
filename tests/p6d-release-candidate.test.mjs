import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const activeReleaseFiles = [
  ".github/workflows/evo-platform-ci.yml",
  ".github/workflows/evo-fast-pr-checks.yml",
  ".github/workflows/evo-fast-release.yml",
  "package.json",
  "scripts/evo-fast-release.sh",
  "scripts/fast-release-ci-gate.mjs",
  "scripts/validate-runtime-hardening.mjs",
  "deploy/README.md",
  "deploy/production-release.md",
  "deploy/runtime-hardening.md",
];

const executableLegacy =
  /(?:agent-lead2-inbox|evo-lead-agent|manual-send-worker|backup-sqlite|EVO_DB_PATH|EVO_BACKUP_DIR|EVO_AGENT_|p8(?:u|v|d|b|c|:))/iu;

test("active release authority has no executable legacy topology", async () => {
  for (const path of activeReleaseFiles) {
    const value = await read(path);
    const executableLines = value
      .split(/\r?\n/u)
      .filter((line) => executableLegacy.test(line))
      .filter((line) => !/(?:must not|never|no longer|not |forbid|retir|histor|frozen|absence|zero|exclude|removed|supersed|legacy)/iu.test(line));
    assert.deepEqual(executableLines, [], `${path} retains executable legacy references`);
  }
});

test("obsolete P8 programs are absent from active script and test directories", async () => {
  for (const directory of ["scripts", "tests"]) {
    const entries = await readdir(new URL(`${directory}/`, root), { recursive: true });
    assert.deepEqual(
      entries.filter((entry) => /(?:^|\/)(?:test-)?p8(?:u|v|d|b|c|-)/iu.test(entry)),
      [],
      `${directory} retains obsolete P8 executable programs`,
    );
  }
});

test("the active package exposes one P6D proof and no P8 release entrypoint", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(
    packageJson.scripts["test:p6d:orbstack"],
    "EVO_NODE_BIN=/opt/homebrew/opt/node@22/bin/node EVO_P6D_CANDIDATE_PROOF=1 bash scripts/test-postgres-v2-foundation.sh",
  );
  assert.match(packageJson.scripts["test:p6d"], /p6d-release-candidate\.test\.mjs/u);
  assert.deepEqual(
    Object.keys(packageJson.scripts).filter((name) => /^p8|^test:p8/u.test(name)),
    [],
  );
  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /tests\/lead-agent-|scripts\/p8|tests\/p8/u);
});

test("CI and the exact-SHA gate require only the current root successor", async () => {
  const workflow = await read(".github/workflows/evo-platform-ci.yml");
  const fastPr = await read(".github/workflows/evo-fast-pr-checks.yml");
  const gate = await read("scripts/fast-release-ci-gate.mjs");
  const auditAllowlist = await read("scripts/check-npm-audit-allowlist.mjs");
  assert.match(workflow, /^  workflow_dispatch:$/mu);
  assert.match(workflow, /proof_revision:\n        description: Exact current main commit SHA to prove\./u);
  assert.doesNotMatch(workflow, /^  pull_request:|^  push:/mu);
  assert.match(workflow, /^  main_admission:\n    name: Current main admission$/mu);
  assert.match(workflow, /exact\("EVO_EVENT_NAME", "workflow_dispatch"\)/u);
  assert.match(workflow, /exact\("EVO_REF", "refs\/heads\/main"\)/u);
  assert.match(workflow, /EVO_PROOF_REVISION: \$\{\{ inputs\.proof_revision \}\}/u);
  assert.match(workflow, /exact\("EVO_PROOF_REVISION", env\.EVO_SHA\)/u);
  assert.match(workflow, /exact\("EVO_WORKFLOW_SHA", env\.EVO_SHA\)/u);
  assert.match(workflow, /git\/ref\/heads\/main/u);
  assert.match(workflow, /^  crm:\n    name: Main CRM$/mu);
  assert.match(workflow, /^  crm_node_static:\n    name: Main CRM Node\/static$/mu);
  assert.match(workflow, /^  crm_browser:\n    name: Main CRM database\/browser proof$/mu);
  assert.equal((workflow.match(/run: npm run test:ci:node/gu) ?? []).length, 1);
  assert.match(workflow, /run: npm run lint/u);
  assert.match(workflow, /run: npm run build/u);
  assert.doesNotMatch(workflow, /run: npm run typecheck|run: npm run test:security|run: npm run test:unit/u);
  assert.match(workflow, /node_modules\/\.bin\/playwright install --with-deps --only-shell chromium/u);
  assert.equal((workflow.match(/node_modules\/\.bin\/playwright install --with-deps --only-shell chromium/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /node_modules\/\.bin\/playwright install --with-deps chromium/u);
  assert.doesNotMatch(workflow, /test:database:migration-boundaries|v3-managed-supabase-recovery-harness/u);
  assert.match(workflow, /^  dependency_audit:\n    name: Dependency audit$/mu);
  assert.match(workflow, /needs:\n      - main_admission\n      - crm_node_static\n      - crm_browser\n      - dependency_audit/u);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(workflow, /Install pinned npm audit CLI/u);
  assert.match(workflow, /Install pinned npm audit CLI\n        timeout-minutes: 4/u);
  assert.match(workflow, /npm_config_fetch_retries: "0"/u);
  assert.match(workflow, /npm_config_fetch_timeout: "30000"/u);
  assert.match(workflow, /for attempt in 1 2 3; do/u);
  assert.match(workflow, /timeout 60s npm install --prefix "\$audit_prefix" npm@11\.19\.0 --ignore-scripts --no-audit --no-fund/u);
  assert.match(workflow, /test "\$\("\$audit_prefix\/node_modules\/\.bin\/npm" --version\)" = "11\.19\.0"/u);
  assert.match(workflow, /echo "EVO_NPM_BIN=\$audit_prefix\/node_modules\/\.bin\/npm" >> "\$GITHUB_ENV"/u);
  assert.match(workflow, /npm install --prefix "\$audit_prefix" npm@11\.19\.0 --ignore-scripts --no-audit --no-fund/u);
  assert.match(workflow, /name: Audit production dependencies[\s\S]*npm_config_fetch_retries: "0"[\s\S]*npm_config_fetch_timeout: "70000"/u);
  assert.match(workflow, /name: Audit development dependencies against the temporary allowlist[\s\S]*npm_config_fetch_retries: "0"[\s\S]*npm_config_fetch_timeout: "70000"/u);
  assert.match(workflow, /if "\$EVO_NPM_BIN" audit --package-lock-only --omit=dev --audit-level=moderate; then/u);
  assert.match(workflow, /if node scripts\/check-npm-audit-allowlist\.mjs; then/u);
  assert.match(auditAllowlist, /const npmBin = process\.env\.EVO_NPM_BIN\?\.trim\(\) \|\| "npm";/u);
  assert.match(auditAllowlist, /spawnSync\(\n    npmBin,/u);
  assert.doesNotMatch(auditAllowlist, /hasMeaningfulAuditError|empty npm audit placeholder/u);
  assert.doesNotMatch(workflow, /npm exec --yes --package=npm@11\.19\.0/u);
  assert.doesNotMatch(workflow, /name: EVO Inbox|name: EVO Lead Agent|working-directory: (?:agent-lead2-inbox|evo-lead-agent)|Prepare P8/u);
  assert.match(fastPr, /^  pull_request:$/mu);
  assert.doesNotMatch(fastPr, /^\s+paths(?:-ignore)?:/mu);
  assert.doesNotMatch(fastPr, /^  push:|^  workflow_dispatch:/mu);
  assert.match(fastPr, /^  changed-range:\n    name: Changed range$/mu);
  assert.match(fastPr, /^  fast-checks:\n    name: Fast checks$/mu);
  assert.match(fastPr, /git diff --check origin\/main\.\.\.HEAD/u);
  assert.match(fastPr, /node scripts\/classify-pr-changes\.mjs --base "\$BASE_SHA" --head "\$HEAD_SHA" --github-output "\$GITHUB_OUTPUT"/u);
  for (const output of ["has_changes", "ordinary_docs", "contracts", "migration_boundary", "code", "lint", "build", "unknown"]) {
    assert.match(fastPr, new RegExp(`${output}: \\$\\{\\{ steps\\.classify\\.outputs\\.${output} \\}\\}`, "u"));
  }
  assert.doesNotMatch(fastPr, /^  classification_guard:/mu);
  assert.match(fastPr, /^  fast-checks:[\s\S]*test "\$HAS_CHANGES" = "true"/mu);
  assert.match(fastPr, /^  fast-checks:[\s\S]*test "\$UNKNOWN" = "false"/mu);
  assert.match(fastPr, /^  contracts:\n    name: Release contracts$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.contracts == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /run: npm run test:fast-release/u);
  assert.match(fastPr, /^  lint:\n    name: Lint$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.lint == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /run: npm run lint/u);
  assert.match(fastPr, /^  build:\n    name: Build$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.build == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /run: npm run build/u);
  assert.match(fastPr, /^  migration_boundary:\n    name: Migration boundary$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.migration_boundary == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /run: npm run test:database:migration-boundaries/u);
  assert.match(fastPr, /needs:\n      - changed-range\n      - contracts\n      - lint\n      - build\n      - migration_boundary/u);
  assert.doesNotMatch(fastPr, /^  typecheck:\n    name: Standalone typecheck$/mu);
  assert.doesNotMatch(fastPr, /outputs\.typecheck|TYPECHECK/u);
  assert.doesNotMatch(fastPr, /run: npm run typecheck/u);
  assert.doesNotMatch(fastPr, /test:database:local|test:security|test:unit|playwright|supabase/iu);
  assert.match(gate, /"Main CRM"/u);
  assert.doesNotMatch(gate, /"EVO Inbox"|"EVO Lead Agent"/u);
});

test("P6D proof accepts only process-provided real local Supabase authority", async () => {
  const harness = await read("scripts/test-p6d-release-candidate-orbstack.mjs");
  const foundation = await read("scripts/test-postgres-v2-foundation.sh");
  assert.match(foundation, /node_bin="\$\{EVO_NODE_BIN:-\}"/u);
  assert.match(foundation, /node_bin="\$\(command -v node \|\| true\)"/u);
  assert.match(
    foundation,
    /Node 22 binary is required via EVO_NODE_BIN or PATH/u,
  );
  for (const name of [
    "EVO_P6D_SUPABASE_API_URL",
    "EVO_P6D_SUPABASE_PUBLISHABLE_KEY",
    "EVO_P6D_SUPABASE_SECRET_KEY",
    "EVO_P6D_ORGANIZATION_ID",
    "EVO_P6D_ADMIN_EMAIL",
    "EVO_P6D_ADMIN_PASSWORD",
  ]) {
    assert.match(harness, new RegExp(name, "u"));
    assert.match(foundation, new RegExp(name, "u"));
  }
  assert.doesNotMatch(harness, /abcdefghijklmnopqrst\.supabase\.co|sb_publishable_.*randomBytes|sb_secret_.*randomBytes/u);
  assert.match(harness, /linux\/amd64/u);
  assert.match(harness, /org\.opencontainers\.image\.revision/u);
  assert.match(harness, /NODE_EXTRA_CA_CERTS/u);
  assert.match(harness, /evolocalp6d000000000\.supabase\.co/u);
  assert.match(harness, /\.listen\(443,'127\.0\.0\.1'\)/u);
  assert.doesNotMatch(harness, /NODE_ENV: "development"/u);
  assert.match(harness, /evo_p6d_\$\{suffix\}_waha_sessions/u);
  assert.match(harness, /evo_p6d_\$\{suffix\}_clamav_signatures/u);
  assert.match(harness, /\["app", "clamav", "waha"\]/u);
  assert.match(harness, /createNetwork\(privateNetwork, \{ internal: true \}\)/u);
  assert.match(harness, /createNetwork\(webNetwork, \{ internal: false \}\)/u);
  assert.match(harness, /Auth|Postgres|Storage/u);
  assert.match(harness, /chromium/u);
  assert.match(harness, /response\.status,\s*503/u);
  assert.match(harness, /components\?\.supabase\?\.status/u);
  assert.match(harness, /components\?\.audit_append\?\.status/u);
  assert.match(harness, /recordCandidateProviderBoundary\(revision\)/u);
  assert.match(harness, /record_messaging_integration_health_event/u);
  assert.match(harness, /p_readiness: "unconfigured"/u);
  assert.match(harness, /p_evidence_kind: "configuration_check"/u);
  assert.match(harness, /readiness\?\.signals\?\.\[`\$\{provider\}_evidence_kind`\]/u);
  assert.doesNotMatch(harness, /\[200, 503\]\.includes/u);
  assert.match(foundation, /EVO_P6D_CANDIDATE_PROOF/u);
});

test("the P6D contract preserves V3 frontend ownership", async () => {
  const changedPaths = await read("docs/EVO_LAUNCH_PLAN.md");
  assert.match(changedPaths, /It does not edit `src\/lib\/v3\/\*`/u);
});
