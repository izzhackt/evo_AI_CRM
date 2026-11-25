import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { STAFF_PAGES, STUDENT_PAGES } from "../scripts/ci/pr-preview-pages.mjs";
import { redact } from "../scripts/ci/redact.mjs";

// The preview is a job of the fast PR checks (one workflow, one «Fast checks» gate that requires it).
const workflow = readFileSync(new URL("../.github/workflows/evo-fast-pr-checks.yml", import.meta.url), "utf8");
const scriptSource = readFileSync(new URL("../scripts/ci/pr-preview.mjs", import.meta.url), "utf8");
const script = scriptSource.split("\n").filter((line) => !/^\s*\/\//u.test(line)).join("\n");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const code = (text) => text.split("\n").filter((line) => !/^\s*#/u.test(line)).join("\n");
const executable = code(workflow);
const previewJob = (() => {
  const start = executable.indexOf("\n  preview:\n    name: Preview (synthetic stack and browser)\n");
  assert.notEqual(start, -1, "the preview job exists in the fast PR checks");
  const end = executable.indexOf("\n  contracts:\n", start + 1);
  return executable.slice(start, end === -1 ? executable.length : end);
})();

test("the preview runs on pull_request only, never on pull_request_target or other privileged triggers", () => {
  assert.match(executable, /^on:\n  pull_request:\n    branches:\n      - main\n/mu);
  assert.doesNotMatch(executable, /pull_request_target|workflow_run|workflow_dispatch|schedule:|issue_comment|\bpush:/u);
});

test("the workflow is read-only, bounded and one run per PR", () => {
  assert.match(executable, /^permissions:\n  contents: read\n/mu);
  // Exactly one job has a permissions block of its own: «Mobile parity» also reads its pull request (the description),
  // read-only. The preview and every other job keep the workflow default.
  assert.equal([...executable.matchAll(/^\s*permissions:/gmu)].length, 2, "no job but «Mobile parity» has permissions of its own");
  const parityJob = executable.slice(executable.indexOf("\n  mobile-parity:\n"), executable.indexOf("\n  migration_boundary:\n"));
  assert.match(parityJob, /\n    permissions:\n      contents: read\n      pull-requests: read\n    steps:\n/u);
  assert.doesNotMatch(executable, /contents:\s*write|id-token|pull-requests:\s*write|packages:|actions:\s*write/u);
  assert.match(executable, /concurrency:\n  group: evo-fast-pr-checks-\$\{\{ github\.event\.pull_request\.number \}\}\n  cancel-in-progress: true/u);
  const timeout = Number(previewJob.match(/timeout-minutes:\s*(\d+)/u)?.[1]);
  assert.ok(timeout > 0 && timeout <= 20, `the preview timeout ${timeout} must be set and at most 20`);
});

test("it uses no secrets, no tokens and no environment with deployment authority", () => {
  assert.doesNotMatch(executable, /\$\{\{\s*secrets\./u);
  assert.doesNotMatch(previewJob, /GITHUB_TOKEN|github\.token|\btoken:|ssh-key|SSH_|DEPLOY|VPS|hermes/iu);
  assert.doesNotMatch(executable, /^\s*environment:/mu);
  assert.doesNotMatch(previewJob, /\bdocker login\b|ghcr\.io|--password/u);
  for (const checkout of previewJob.split("actions/checkout@").slice(1)) {
    assert.match(checkout.slice(0, 300), /persist-credentials: false/u, "checkout must not persist credentials");
  }
});

test("every action of the preview is pinned to a full commit SHA and dependencies come from the shared cache", () => {
  const uses = [...previewJob.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gmu)].map((m) => m[1]);
  assert.ok(uses.length >= 4);
  for (const reference of uses) assert.match(reference, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u, reference);
  assert.match(previewJob, /actions\/setup-node@[0-9a-f]{40}[\s\S]*?cache: npm/u);
  assert.match(previewJob, /uses: actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/u);
  assert.match(previewJob, /if: \$\{\{ steps\.deps\.outputs\.cache-hit != 'true' \}\}\n        run: npm ci/u);
});

test("the preview runs for every change but ordinary docs, and «Fast checks» requires it", () => {
  assert.match(previewJob, /if: \$\{\{ needs\.changed-range\.outputs\.has_changes == 'true' && needs\.changed-range\.outputs\.ordinary_docs != 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  const gate = executable.slice(executable.indexOf("\n  fast-checks:\n"));
  assert.match(gate, /needs:[\s\S]*?\n      - preview\n/u);
  assert.match(gate, /PREVIEW_RESULT: \$\{\{ needs\.preview\.result \}\}/u);
  assert.match(gate, /test "\$PREVIEW_RESULT" = "success"/u);
  assert.equal((executable.match(/^    name: Changed range$/gmu) ?? []).length, 1, "one classifier job, no duplicate check name");
});

test("the artifact carries screenshots, logs and the timing table, and runs even after a failure", () => {
  const upload = previewJob.slice(previewJob.indexOf("Upload screenshots"));
  assert.match(upload, /if: \$\{\{ always\(\) \}\}/u);
  for (const path of ["summary.md", "screenshots/", "app.log", "build.log"]) assert.ok(upload.includes(`output/pr-preview/${path}`), path);
  // The `supabase start` log can hold S3 and JWT secrets: it is never uploaded, and nothing else (texts, work dir) is.
  assert.doesNotMatch(upload, /supabase\.log|texts|work\/|output\/pr-preview\/?\s*$/mu);
  // Redaction is a separate step that runs under always() before the upload, so an interrupted run is covered too.
  const redactStep = previewJob.slice(previewJob.indexOf("Redact uploaded logs"), previewJob.indexOf("Upload screenshots"));
  assert.match(redactStep, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(redactStep, /node scripts\/ci\/redact\.mjs output\/pr-preview\/app\.log output\/pr-preview\/build\.log/u);
  assert.ok(previewJob.indexOf("Redact uploaded logs") < previewJob.indexOf("Upload screenshots"));
  // One command: the job runs the preview step of `npm run verify`, which runs `npm run preview:ci`.
  assert.match(previewJob, /run: npm run verify -- --only preview/u);
  const verifySource = readFileSync(new URL("../scripts/ci/verify.mjs", import.meta.url), "utf8");
  assert.match(verifySource, /preview: \{ title: "PR preview \(synthetic stack \+ browser\)", command: \(\) => \[NPM, \["run", "--silent", "preview:ci"\]\] \}/u);
  assert.equal(packageJson.scripts["preview:ci"], "node scripts/ci/pr-preview.mjs");
});

test("the script is synthetic-only: isolated project and ports, local Docker, no real credentials", () => {
  assert.match(script, /PROJECT_ID = "evo-pr-preview"/u);
  assert.doesNotMatch(script, /evo-mobile-dev/u);
  // 18440-18451: below the Linux ephemeral range 32768-60999 (tests/pr-preview-ports.test.mjs guards the whole block).
  assert.match(script, /BASE_PORT = 18440;/u);
  assert.match(script, /REMOTE_DOCKER_FORBIDDEN/u);
  assert.match(script, /seedMobileDevStack/u);
  assert.match(script, /ENV_FILE_IN_CHECKOUT/u);
  assert.match(script, /GITHUB_STEP_SUMMARY/u);
  // Process environment is an allow-list; no secret-bearing variable names are forwarded.
  const allowList = script.match(/const PASS_ENV = \[([^\]]*)\]/u)?.[1] ?? "";
  assert.ok(allowList.length > 0);
  assert.doesNotMatch(allowList, /TOKEN|SECRET|KEY|PASSWORD|GITHUB/u);
  assert.doesNotMatch(script, /ssh |hermes-vps|crm\.evoadmissions|app\.evoadmissions|api\.supabase\.com/u);
  const covered = [...STAFF_PAGES, ...STUDENT_PAGES].map((page) => page.path.split("?")[0]);
  for (const page of ["/main", "/profile", "/pipeline", "/admissions-requests", "/calendar", "/tasks", "/finance", "/universities", "/portal", "/portal/documents"]) {
    assert.ok(covered.includes(page), page);
  }
});

test("page anchors are real content: never the bare page frame or a fallback testid", () => {
  const generic = new Set(["v3-shell", "v3-shell-topbar", "active-role", "student-portal-shell", "v3-error", "queue-empty", "list-filters", "queue-view-tabs"]);
  // Test ids that the legacy or fallback views share with the current ones (see the comments in the pages module).
  const sharedWithFallback = new Set(["v3-pipeline-board", "v3-student-case-directory", "v3-universities-next-frame"]);
  for (const page of [...STAFF_PAGES, ...STUDENT_PAGES]) {
    const { testIds = [], text = [], role } = page.anchor;
    assert.ok(testIds.length + text.length > 0 || role, `${page.path} needs an anchor`);
    for (const id of testIds) {
      assert.ok(!generic.has(id), `${page.path}: ${id} is a generic frame id`);
      assert.ok(!sharedWithFallback.has(id), `${page.path}: ${id} is also rendered by a fallback or legacy view`);
    }
  }
  const byPath = new Map(STAFF_PAGES.map((page) => [page.path, page.anchor]));
  // `v3-universities-next` is the page frame of an empty or failed list too: seeded universities are required.
  assert.deepEqual(byPath.get("/universities").text, ["Test University Alpha", "Test University Beta", "Test University Gamma"]);
  assert.ok(byPath.get("/pipeline").text.includes("Тест Приглашённый"));
  assert.ok(byPath.get("/profile?view=active").text.includes("Тест Сопровождаемый"));
  assert.ok(byPath.get("/finance?tab=debts").text.some((text) => text.includes("оплачено 400 USD")));
});

test("the signal handler stays fast: it kills children and exits, without running Docker", () => {
  const handler = script.slice(script.indexOf('for (const signal of ["SIGINT", "SIGTERM"])'));
  const body = handler.slice(0, handler.indexOf("\n}\n"));
  assert.match(body, /child\.kill\("SIGKILL"\)/u);
  assert.match(body, /process\.exit\(130\)/u);
  assert.doesNotMatch(body, /stopSupabase|spawnSync|run\(/u);
});

test("page visits fail on 5xx document and XHR responses, not only on page errors", () => {
  assert.match(script, /response\.status\(\) >= 500/u);
  assert.match(script, /\["document", "xhr", "fetch"\]/u);
  assert.match(script, /serverErrors/u);
});

test("uploaded logs are redacted of JWTs, sb_ keys and database passwords", () => {
  const jwt = `eyJ${"a".repeat(20)}.${"b".repeat(30)}.${"c".repeat(20)}`;
  const text = `Access Key: 625729a08b95bf1b7ff351a663f3a23c\nSecret Key: 850181e4652dd023b7a98c58ae0d2d34bd487ee0cc3254aed6eda37307425907\nJWT secret: super-secret-jwt-token-with-at-least-32-characters\nservice_role key: ${jwt}\nsb_secret_ABCdef123_-x and sb_publishable_ZZZ999\nDB: postgresql://postgres:postgres@127.0.0.1:46442/postgres`;
  const out = redact(text);
  assert.doesNotMatch(out, /eyJ|sb_secret_|sb_publishable_|:postgres@|625729a0|850181e4|super-secret-jwt/u);
  assert.match(out, /\[redacted/u);
  assert.match(redact(`token ${jwt}`), /\[redacted-jwt\]/u);
  assert.match(out, /postgresql:\/\/postgres:\[redacted\]@127\.0\.0\.1/u);
  // The redaction is applied to every uploaded log before the summary is written.
  assert.match(script, /for \(const file of \[APP_LOG, BUILD_LOG\]\) \{\n  try \{ writeFileSync\(file, redact/u);
});

test("the debug page-text dump is gone", () => {
  assert.doesNotMatch(scriptSource, /EVO_PR_PREVIEW_DUMP|innerText|"texts"/u);
});
