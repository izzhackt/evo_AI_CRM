import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const activeReleaseFiles = [
  ".github/workflows/evo-platform-ci.yml",
  ".github/workflows/evo-fast-release.yml",
  "package.json",
  "scripts/evo-fast-release.sh",
  "scripts/fast-release-ci-gate.mjs",
  "scripts/evo-release-environment-profile.mjs",
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
      entries.filter((entry) => /(?:^|\/)p8(?:u|v|d|b|c|-)/iu.test(entry)),
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
  const gate = await read("scripts/fast-release-ci-gate.mjs");
  assert.match(workflow, /name: Main CRM/u);
  assert.doesNotMatch(workflow, /name: EVO Inbox|name: EVO Lead Agent|working-directory: (?:agent-lead2-inbox|evo-lead-agent)|Prepare P8/u);
  assert.match(gate, /"Main CRM"/u);
  assert.doesNotMatch(gate, /"EVO Inbox"|"EVO Lead Agent"/u);
});

test("P6D proof accepts only process-provided real local Supabase authority", async () => {
  const harness = await read("scripts/test-p6d-release-candidate-orbstack.mjs");
  const foundation = await read("scripts/test-postgres-v2-foundation.sh");
  assert.match(foundation, /node_bin="\$\{EVO_NODE_BIN:-\/opt\/homebrew\/opt\/node@22\/bin\/node\}"/u);
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
  assert.match(harness, /Auth|Postgres|Storage/u);
  assert.match(harness, /chromium/u);
  assert.match(foundation, /EVO_P6D_CANDIDATE_PROOF/u);
});

test("the P6D contract preserves V3 frontend ownership", async () => {
  const changedPaths = await read("docs/EVO_LAUNCH_PLAN.md");
  assert.match(changedPaths, /It does not edit `src\/lib\/v3\/\*`/u);
});
