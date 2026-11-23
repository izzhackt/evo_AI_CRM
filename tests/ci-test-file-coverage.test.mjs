import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { DEFAULT_ENTRY_SCRIPTS, resolveNodeTestPlan } from "../scripts/test-runners/run-node-test-suite.mjs";

// Every test file under tests/ runs in the PR checks (docs/PLAN_CHANGES.md, 22.11.2026): through the Node manifest
// («Tests (1/4..4/4)», `npm run verify -- --only tests`), through «Release contracts» (`npm run test:fast-release`),
// or it is listed in EXCLUDED with the reason it cannot. On 22.11.2026, 109 of 451 files ran nowhere, and six of them
// had drifted unnoticed. A new test file therefore goes into a CI script, usually `test:unit:supplemental`, in the
// segment whose Node flags it needs.
// The mobile app's Jest tests (mobile/src, mobile/scripts) run in the «Mobile app» check and are not counted here.

/** file -> one-line reason it does not run in CI. Empty on 22.11.2026: every file passed or was repaired. */
const EXCLUDED = new Map([]);

const repositoryRoot = new URL("..", import.meta.url).pathname;
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const manifest = new Set(resolveNodeTestPlan({ packageJson, repositoryRoot, entryScripts: DEFAULT_ENTRY_SCRIPTS }).files);
const contracts = new Set(resolveNodeTestPlan({ packageJson, repositoryRoot, entryScripts: ["test:fast-release"] }).files);

function testFiles(directory) {
  const found = [];
  for (const entry of readdirSync(join(repositoryRoot, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") found.push(...testFiles(path));
    } else if (/\.test\.(?:mjs|cjs|js|mts|cts|ts)$/u.test(entry.name)) {
      found.push(relative(".", path));
    }
  }
  return found.sort();
}

test("every test file under tests/ runs in CI or is excluded with a reason", () => {
  const files = testFiles("tests");
  assert.ok(files.length > 400, `the scan found only ${files.length} files`);
  const uncovered = files.filter(file => !manifest.has(file) && !contracts.has(file) && !EXCLUDED.has(file));
  assert.deepEqual(
    uncovered,
    [],
    "add each file to a CI script (usually test:unit:supplemental, in the segment with the Node flags it needs) or to EXCLUDED with a reason",
  );
});

test("an exclusion names an existing file that CI does not run, with a reason", () => {
  for (const [file, reason] of EXCLUDED) {
    assert.ok(existsSync(join(repositoryRoot, file)), `${file} does not exist; drop the exclusion`);
    assert.ok(!manifest.has(file) && !contracts.has(file), `${file} runs in CI; drop the exclusion`);
    assert.match(reason, /\p{L}{3}/u, `${file} needs a reason`);
  }
});

test("the PR checks run both surfaces this guard counts", () => {
  const verify = readFileSync(join(repositoryRoot, "scripts/ci/verify.mjs"), "utf8");
  assert.match(verify, /"scripts\/test-runners\/run-node-test-suite\.mjs", ?"--suite", ?"ci"/u, "verify's tests step is the CI manifest");
  assert.match(verify, /contracts: \{ title: "Release contracts", command: \(\) => \[NPM, \["run", "--silent", "test:fast-release"\]\] \}/u);
  const workflow = readFileSync(join(repositoryRoot, ".github/workflows/evo-fast-pr-checks.yml"), "utf8");
  assert.match(workflow, /run: npm run verify -- --only tests --shard \$\{\{ matrix\.shard \}\}\/4/u);
  assert.match(workflow, /run: npm run verify -- --only contracts/u);
});
