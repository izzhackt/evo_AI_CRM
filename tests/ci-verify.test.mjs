import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_STEPS, parseArgs, runSteps, selectSteps, STEPS, summary } from "../scripts/ci/verify.mjs";
import { parseNodeTestShard, runNodeTestPlan } from "../scripts/test-runners/run-node-test-suite.mjs";

// `npm run verify` (PLAN_CHANGES 22.11.2026): one command, the same steps on a laptop and in CI.

test("verify: a plain run takes every default step; migrations join only when supabase/ changed; preview on request", () => {
  assert.deepEqual(DEFAULT_STEPS, ["diff-check", "typecheck", "lint", "tests", "contracts", "mobile", "build"]);
  assert.deepEqual(selectSteps(parseArgs([]), ["src/app/page.tsx"]), [...DEFAULT_STEPS]);
  assert.deepEqual(selectSteps(parseArgs([]), ["supabase/migrations/373_x.sql"]), [...DEFAULT_STEPS, "migrations"]);
  assert.deepEqual(selectSteps(parseArgs(["--with", "preview"]), []), [...DEFAULT_STEPS, "preview"]);
  assert.deepEqual(selectSteps(parseArgs(["--skip", "build,mobile"]), []), ["diff-check", "typecheck", "lint", "tests", "contracts"]);
  // --only is exact: no automatic additions, table order kept.
  assert.deepEqual(selectSteps(parseArgs(["--only", "tests,lint"]), ["supabase/x.sql"]), ["lint", "tests"]);
  assert.deepEqual(selectSteps(parseArgs(["--only", "tests", "--shard", "2/4"]), []), ["tests"]);
});

test("verify: unknown steps, a bad shard or a shard without tests are refused, never ignored", () => {
  assert.throws(() => parseArgs(["--only", "types"]), /Unknown step: types/u);
  assert.throws(() => parseArgs(["--skip", "everything"]), /Unknown step/u);
  assert.throws(() => parseArgs(["--shard", "0/4"]), /Invalid --shard/u);
  assert.throws(() => parseArgs(["--shard", "x"]), /Invalid --shard/u);
  assert.throws(() => parseArgs(["--only"]), /needs a value/u);
  assert.throws(() => parseArgs(["--fast"]), /Unknown argument/u);
  assert.throws(() => selectSteps(parseArgs(["--only", "lint", "--shard", "1/2"]), []), /--shard applies to the tests step only/u);
  for (const name of Object.keys(STEPS)) assert.equal(typeof STEPS[name].command, "function", name);
});

function fakeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "evo-verify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const sink = () => {
  const lines = [];
  return { lines, write: (text) => { lines.push(text); return true; } };
};
const nodeStep = (title, code, extra = {}) => ({
  title,
  command: () => [process.execPath, ["-e", `console.log(${JSON.stringify(title)}); process.exit(${code})`]],
  ...extra,
});

test("verify: every selected step runs, each into its own log, and one failure fails the whole run", async (t) => {
  const root = fakeRoot(t);
  const steps = {
    ok: nodeStep("fine", 0),
    broken: nodeStep("broken", 3),
    blocked: { ...nodeStep("never runs", 0), requires: () => "a prerequisite is missing" },
  };
  const out = sink();
  const results = await runSteps(["ok", "broken", "blocked"], { ctx: { root, base: "HEAD", shard: null }, steps, jobs: 2, out });
  assert.deepEqual(results.map((result) => [result.name, result.status]), [["ok", "PASS"], ["broken", "FAIL"], ["blocked", "FAIL"]]);
  assert.equal(results.find((result) => result.name === "broken").detail, "exit 3");
  assert.equal(results.find((result) => result.name === "blocked").detail, "a prerequisite is missing", "a missing prerequisite fails, it is not skipped");
  assert.match(readFileSync(join(root, ".verify/ok.log"), "utf8"), /fine/u);
  assert.match(readFileSync(join(root, ".verify/broken.log"), "utf8"), /broken/u);
  const { table, verdict, failed } = summary(results, 1500);
  assert.deepEqual(failed.map((result) => result.name), ["broken", "blocked"]);
  assert.match(verdict, /^VERIFY FAIL — broken, blocked$/u);
  assert.match(table, /^\| step \| result \| time \| log \/ reason \|$/mu);
  assert.match(table, /^\| broken \| FAIL \| \d+s \| exit 3 \|$/mu);
  assert.match(out.lines.join(""), /PASS {2}ok/u);
});

test("verify: all steps passing is VERIFY PASS; the CLI exits 0 only then", async (t) => {
  const root = fakeRoot(t);
  const results = await runSteps(["a", "b"], {
    ctx: { root, base: "HEAD", shard: null }, steps: { a: nodeStep("a", 0), b: nodeStep("b", 0) }, jobs: 1, out: sink(),
  });
  const { verdict, failed } = summary(results, 61_000);
  assert.equal(failed.length, 0);
  assert.equal(verdict, "VERIFY PASS — 2 step(s) in 1m01s");
});

test("Node test manifest: a shard is Node's own --test-shard, and every group runs even after one fails", (t) => {
  assert.equal(parseNodeTestShard(null), null);
  assert.equal(parseNodeTestShard("2/4"), "2/4");
  assert.throws(() => parseNodeTestShard("5/4"), /Invalid --shard/u);
  assert.throws(() => parseNodeTestShard("0/4"), /Invalid --shard/u);
  const dir = fakeRoot(t);
  const failing = join(dir, "a.test.mjs");
  const passing = join(dir, "b.test.mjs");
  const marker = join(dir, "ran-b");
  writeFileSync(failing, 'import test from "node:test"; test("fails", () => { throw new Error("no"); });\n');
  writeFileSync(passing, `import test from "node:test"; import { writeFileSync } from "node:fs"; test("passes", () => { writeFileSync(${JSON.stringify(marker)}, "1"); });\n`);
  const plan = { groups: [
    { nodeArgs: [], concurrency: 1, files: [failing] },
    { nodeArgs: [], concurrency: 1, files: [passing] },
  ] };
  // Inside `node --test` a nested runner inherits NODE_TEST_CONTEXT and reports to the parent instead of exiting
  // with its own status; a real `npm run verify` has no such variable.
  const inherited = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  let status;
  try {
    status = runNodeTestPlan(plan, { repositoryRoot: dir });
  } finally {
    if (inherited !== undefined) process.env.NODE_TEST_CONTEXT = inherited;
  }
  assert.notEqual(status, 0, "the first group's failure is the result");
  assert.equal(readFileSync(marker, "utf8"), "1", "the second group still ran");
});
