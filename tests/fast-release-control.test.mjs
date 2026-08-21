import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FAST_RELEASE_REQUIRED_CHECKS,
  validateFastReleaseChecks,
  verifyFastReleaseCi,
} from "../scripts/fast-release-ci-gate.mjs";
import {
  expectedMigrationVersions,
  verifyProductionMigrationLedger,
} from "../scripts/fast-release-ledger-gate.mjs";
import {
  classifyFastReleasePaths,
  readFastReleaseDiff,
} from "../scripts/fast-release-scope.mjs";

const REVISION = "90ab8b1b0c1dd6a92c931e9793c052f984f19fc4";

function greenChecks() {
  return {
    check_runs: FAST_RELEASE_REQUIRED_CHECKS.map((name) => ({
      name,
      status: "completed",
      conclusion: "success",
      app: { slug: "github-actions" },
    })),
  };
}

test("fast release scope allows presentation-only changes", () => {
  assert.deepEqual(
    classifyFastReleasePaths([
      "docs/STAFF_RELEASES.md",
      "src/app/(staff)/dashboard/page.tsx",
      "src/app/globals.css",
      "src/components/ReleaseChip.tsx",
      "tests/release-chip.test.mjs",
    ]).allowed,
    true,
  );
});

test("fast release scope sends sensitive and unknown changes to controlled release", () => {
  for (const path of [
    ".github/workflows/evo-fast-release.yml",
    "Dockerfile",
    "agent-lead2-inbox/src/app/page.tsx",
    "docker-compose.prod.yml",
    "scripts/evo-fast-release.sh",
    "src/app/(staff)/settings/actions.ts",
    "src/app/api/ai/draft/route.ts",
    "src/lib/platform-auth.ts",
    "supabase/migrations/078_example.sql",
  ]) {
    const result = classifyFastReleasePaths([path]);
    assert.equal(result.allowed, false, path);
    assert.equal(result.reason, "controlled_release_required", path);
  }
});

test("fast release scope observes deleted and renamed source paths", () => {
  const repository = mkdtempSync(join(tmpdir(), "evo-fast-scope-"));
  try {
    execFileSync("git", ["init", "--quiet", repository]);
    execFileSync("git", ["-C", repository, "config", "user.name", "Fast Release Test"]);
    execFileSync("git", ["-C", repository, "config", "user.email", "fast-release@example.invalid"]);
    mkdirSync(join(repository, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(repository, "supabase", "migrations", "078_sensitive.sql"), "select 1;\n");
    execFileSync("git", ["-C", repository, "add", "."]);
    execFileSync("git", ["-C", repository, "commit", "--quiet", "-m", "baseline"]);
    const from = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    rmSync(join(repository, "supabase", "migrations", "078_sensitive.sql"));
    mkdirSync(join(repository, "docs"), { recursive: true });
    writeFileSync(join(repository, "docs", "renamed.md"), "select 1;\n");
    execFileSync("git", ["-C", repository, "add", "-A"]);
    execFileSync("git", ["-C", repository, "commit", "--quiet", "-m", "rename"]);
    const to = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    const paths = readFastReleaseDiff({ repo: repository, from, to });
    assert.deepEqual(paths.sort(), ["docs/renamed.md", "supabase/migrations/078_sensitive.sql"]);
    assert.equal(classifyFastReleasePaths(paths).allowed, false);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("CI gate requires every exact check from GitHub Actions", async () => {
  assert.equal(validateFastReleaseChecks(greenChecks()).ok, true);
  assert.throws(
    () => validateFastReleaseChecks({ check_runs: greenChecks().check_runs.slice(1) }),
    /not green/u,
  );
  assert.throws(
    () => validateFastReleaseChecks({
      check_runs: greenChecks().check_runs.map((run) => ({ ...run, app: { slug: "other" } })),
    }),
    /not green/u,
  );
  assert.throws(
    () => validateFastReleaseChecks({
      check_runs: [
        ...greenChecks().check_runs,
        { ...greenChecks().check_runs[0], conclusion: "failure" },
      ],
    }),
    /not green/u,
  );

  let authorization = "";
  let requestUrl = "";
  const githubFixtureCredential = ["process", "only", "fixture"].join("-");
  const result = await verifyFastReleaseCi({
    repository: "owner/repository",
    revision: REVISION,
    token: githubFixtureCredential,
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      authorization = init.headers.Authorization;
      return Response.json(greenChecks());
    },
  });
  assert.equal(result.ok, true);
  assert.equal(authorization, `Bearer ${githubFixtureCredential}`);
  assert.match(requestUrl, /filter=latest/u);
});

test("migration gate requires an exact contiguous source and production ledger", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-fast-ledger-"));
  try {
    writeFileSync(join(root, "001_one.sql"), "select 1;\n");
    writeFileSync(join(root, "002_two.sql"), "select 2;\n");
    assert.deepEqual(expectedMigrationVersions(root), ["001", "002"]);
    const result = await verifyProductionMigrationLedger({
      projectRef: "abcdefghijklmnopqrst",
      accessToken: ["process", "only", "fixture"].join("-"),
      migrationDirectory: root,
      fetchImpl: async () => Response.json([
        { version: "001", name: "one" },
        { version: "002", name: "two" },
      ]),
    });
    assert.deepEqual(result, { ok: true, count: 2, range: "001-002" });

    await assert.rejects(
      verifyProductionMigrationLedger({
        projectRef: "abcdefghijklmnopqrst",
        accessToken: ["process", "only", "fixture"].join("-"),
        migrationDirectory: root,
        fetchImpl: async () => Response.json([{ version: "001", name: "one" }]),
      }),
      /does not match/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release controller is app-only, wait-gated, and avoids destructive shortcuts", () => {
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
  const preflight = controller.slice(
    controller.indexOf("preflight() {"),
    controller.indexOf("write_result() {"),
  );
  const deploy = controller.slice(
    controller.indexOf("deploy() {"),
    controller.indexOf("manual_rollback() {"),
  );
  execFileSync("bash", ["-n", "scripts/evo-fast-release.sh"]);
  assert.match(controller, /--no-deps/u);
  assert.match(controller, /--no-build/u);
  assert.match(controller, /--pull never/u);
  assert.match(controller, /--wait/u);
  assert.match(controller, /rollback_from_state/u);
  assert.match(preflight, /verify_archive/u);
  assert.doesNotMatch(preflight, /docker image load/u);
  assert.match(deploy, /load_candidate_image/u);
  assert.match(controller, /archive_layers_invalid/u);
  assert.doesNotMatch(controller, /docker compose down/u);
  assert.doesNotMatch(controller, /docker system prune/u);
  assert.doesNotMatch(controller, /git pull/u);
  assert.doesNotMatch(controller, /rm -rf/u);
});

test("workflow binds one protected approval to exact main and runner-built artifact", () => {
  const workflow = readFileSync(".github/workflows/evo-fast-release.yml", "utf8");
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /git rev-parse origin\/main/u);
  assert.match(workflow, /fast-release-ci-gate\.mjs/u);
  assert.match(workflow, /fast-release-ledger-gate\.mjs/u);
  assert.match(workflow, /docker build/u);
  assert.match(workflow, /docker save/u);
  assert.ok(workflow.indexOf("Build the exact linux-amd64") < workflow.indexOf("environment: production"));
  assert.match(workflow, /StrictHostKeyChecking yes/u);
  assert.match(workflow, /evo-fast-release-controller-error\.log/u);
  assert.match(workflow, /phase:"preflight_or_load"/u);
  assert.doesNotMatch(
    workflow.slice(workflow.indexOf("Upload sanitized release evidence")),
    /controller-error/u,
  );
  assert.doesNotMatch(workflow, /ssh-keyscan/u);
  assert.doesNotMatch(workflow, /StrictHostKeyChecking no/u);
  assert.doesNotMatch(workflow, /git pull/u);
});

test("version endpoint stays staff-authenticated while public health stays minimal", () => {
  const route = readFileSync("src/app/api/version/route.ts", "utf8");
  const proxy = readFileSync("src/proxy.ts", "utf8");
  const health = readFileSync("src/app/api/health/route.ts", "utf8");
  assert.match(route, /hasAuthenticatedStaffSession/u);
  assert.match(route, /authentication_required/u);
  assert.match(proxy, /path === "\/api\/version"/u);
  assert.doesNotMatch(health, /EVO_RELEASE/u);
});
