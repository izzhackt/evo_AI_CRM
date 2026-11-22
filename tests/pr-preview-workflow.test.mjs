import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/evo-pr-preview.yml", import.meta.url), "utf8");
const scriptSource = readFileSync(new URL("../scripts/ci/pr-preview.mjs", import.meta.url), "utf8");
const script = scriptSource.split("\n").filter((line) => !/^\s*\/\//u.test(line)).join("\n");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const code = (text) => text.split("\n").filter((line) => !/^\s*#/u.test(line)).join("\n");
const executable = code(workflow);

test("the preview runs on pull_request only, never on pull_request_target or other privileged triggers", () => {
  assert.match(executable, /^on:\n  pull_request:\n    branches:\n      - main\n/mu);
  assert.doesNotMatch(executable, /pull_request_target|workflow_run|workflow_dispatch|schedule:|issue_comment|\bpush:/u);
});

test("the workflow is read-only, bounded and one run per PR", () => {
  assert.match(executable, /^permissions:\n  contents: read\n/mu);
  assert.equal([...executable.matchAll(/^\s*permissions:/gmu)].length, 1, "no job widens permissions");
  assert.doesNotMatch(executable, /contents:\s*write|id-token|pull-requests:\s*write|packages:|actions:\s*write/u);
  assert.match(executable, /concurrency:\n  group: evo-pr-preview-\$\{\{ github\.event\.pull_request\.number \}\}\n  cancel-in-progress: true/u);
  const timeouts = [...executable.matchAll(/timeout-minutes:\s*(\d+)/gu)].map((m) => Number(m[1]));
  assert.equal(timeouts.length, 2, "every job has a timeout");
  for (const minutes of timeouts) assert.ok(minutes <= 20, `timeout ${minutes} must be at most 20`);
});

test("it uses no secrets, no tokens and no environment with deployment authority", () => {
  assert.doesNotMatch(executable, /secrets\./u);
  assert.doesNotMatch(executable, /GITHUB_TOKEN|github\.token|\btoken:|ssh-key|SSH_|DEPLOY|VPS|hermes/iu);
  assert.doesNotMatch(executable, /^\s*environment:/mu);
  assert.doesNotMatch(executable, /\bdocker login\b|ghcr\.io|--password/u);
  for (const checkout of executable.split("actions/checkout@").slice(1)) {
    assert.match(checkout.slice(0, 300), /persist-credentials: false/u, "checkout must not persist credentials");
  }
});

test("every action is pinned to a full commit SHA and Node uses the npm cache", () => {
  const uses = [...executable.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gmu)].map((m) => m[1]);
  assert.ok(uses.length >= 4);
  for (const reference of uses) assert.match(reference, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u, reference);
  assert.match(executable, /actions\/setup-node@[0-9a-f]{40}[\s\S]*?cache: npm/u);
  assert.match(executable, /npm ci/u);
});

test("docs-only changes skip the preview using the same classifier as the fast PR checks", () => {
  const fast = readFileSync(new URL("../.github/workflows/evo-fast-pr-checks.yml", import.meta.url), "utf8");
  const command = "node scripts/checks/classify-pr-changes.mjs --base \"$format_base_sha\" --head \"$format_head_sha\" --github-output \"$GITHUB_OUTPUT\"";
  assert.ok(fast.includes(command));
  assert.ok(workflow.includes(command));
  assert.match(executable, /if: \$\{\{ needs\.changed-range\.outputs\.run_preview == 'true' \}\}/u);
  assert.match(executable, /\[ "\$CODE" = "true" \] \|\| \[ "\$MIGRATION_BOUNDARY" = "true" \] \|\| \[ "\$UNKNOWN" = "true" \]/u);
});

test("the artifact carries screenshots, logs and the timing table, and runs even after a failure", () => {
  const upload = executable.slice(executable.indexOf("Upload screenshots"));
  assert.match(upload, /if: \$\{\{ always\(\) \}\}/u);
  for (const path of ["summary.md", "screenshots/", "app.log", "build.log", "supabase.log"]) assert.ok(upload.includes(`output/pr-preview/${path}`), path);
  assert.match(executable, /run: npm run preview:ci/u);
  assert.equal(packageJson.scripts["preview:ci"], "node scripts/ci/pr-preview.mjs");
});

test("the script is synthetic-only: isolated project and ports, local Docker, no real credentials", () => {
  assert.match(script, /PROJECT_ID = "evo-pr-preview"/u);
  assert.doesNotMatch(script, /evo-mobile-dev/u);
  assert.match(script, /BASE_PORT = 46440/u);
  assert.match(script, /REMOTE_DOCKER_FORBIDDEN/u);
  assert.match(script, /seedMobileDevStack/u);
  assert.match(script, /ENV_FILE_IN_CHECKOUT/u);
  assert.match(script, /GITHUB_STEP_SUMMARY/u);
  // Process environment is an allow-list; no secret-bearing variable names are forwarded.
  const allowList = script.match(/const PASS_ENV = \[([^\]]*)\]/u)?.[1] ?? "";
  assert.ok(allowList.length > 0);
  assert.doesNotMatch(allowList, /TOKEN|SECRET|KEY|PASSWORD|GITHUB/u);
  assert.doesNotMatch(script, /ssh |hermes-vps|crm\.evoadmissions|app\.evoadmissions|api\.supabase\.com/u);
  for (const page of ["/main", "/profile", "/pipeline", "/admissions-requests", "/calendar", "/tasks", "/finance", "/universities", "/portal\"", "/portal/documents"]) {
    assert.ok(script.includes(`path: "${page.replace(/"$/u, "")}"`), page);
  }
});
