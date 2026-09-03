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
    "src/lib/server/platform-gemini-provider.ts",
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
  assert.match(preflight, /verify_env_contract/u);
  assert.match(controller, /evo-app-env-contract\.mjs/u);
  assert.match(controller, /app_env_contract_invalid/u);
  assert.doesNotMatch(preflight, /docker image load/u);
  assert.match(deploy, /load_candidate_image/u);
  assert.match(controller, /archive_layers_invalid/u);
  assert.doesNotMatch(controller, /docker compose down/u);
  assert.doesNotMatch(controller, /docker system prune/u);
  assert.doesNotMatch(controller, /git pull/u);
  assert.doesNotMatch(controller, /rm -rf/u);
});

test("release controller exposes a validation-only controlled staging preflight", () => {
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
  const start = controller.indexOf("controlled_staging_preflight() {");
  const end = controller.indexOf("\npreflight() {", start);
  assert.notEqual(start, -1);
  assert.ok(end > start);

  const stagingPreflight = controller.slice(start, end);
  assert.match(stagingPreflight, /evo-release-environment-profile\.mjs/u);
  assert.match(stagingPreflight, /verify_controlled_staging_env_contract/u);
  assert.match(controller, /evo-app-env-contract\.mjs/u);
  assert.match(controller, /--controlled-staging/u);
  assert.match(controller, /EVO_RELEASE_APP_ENV_FILE/u);
  assert.match(controller, /EVO_RELEASE_ENV_EXAMPLE_FILE/u);
  assert.match(
    controller,
    /export EVO_CRM_APP_ENV_FILE=\$EVO_RELEASE_APP_ENV_FILE/u,
  );
  assert.match(controller, /controlled-staging-preflight\)/u);
  assert.doesNotMatch(stagingPreflight, /load_configuration/u);
  assert.doesNotMatch(stagingPreflight, /load_candidate_configuration/u);
  assert.doesNotMatch(stagingPreflight, /docker/u);
  assert.doesNotMatch(stagingPreflight, /curl/u);
  assert.doesNotMatch(stagingPreflight, /ssh/u);
  assert.doesNotMatch(stagingPreflight, /supabase (db|migration|link)/u);
});

test("staging Compose owns only successor app and private WAHA identities", () => {
  const stagingCompose = readFileSync("docker-compose.staging.yml", "utf8");
  const services = stagingCompose
    .slice(stagingCompose.indexOf("services:\n") + "services:\n".length)
    .split(/\n(?:networks|volumes):\n/, 1)[0];
  assert.match(stagingCompose, /^name: evo-crm-staging$/mu);
  assert.match(stagingCompose, /\$\{EVO_CRM_APP_ENV_FILE:-\.env\.staging\}/u);
  assert.deepEqual(
    [...services.matchAll(/^  ([a-z][a-z0-9-]+):\s*$/gmu)].map((match) => match[1]),
    ["app", "waha"],
  );
  assert.match(stagingCompose, /name: evo_crm_staging_private/u);
  for (const volume of [
    "evo_crm_staging_output",
    "evo_crm_staging_waha_sessions",
  ]) {
    assert.match(stagingCompose, new RegExp(`name: ${volume}`, "u"), volume);
  }
  assert.match(stagingCompose, /name: \$\{EVO_CADDY_NETWORK:-evo_public_web\}/u);
  assert.doesNotMatch(stagingCompose, /name: evo_crm_private$/mu);
  assert.doesNotMatch(
    stagingCompose,
    /manual-send-worker|lead-agent|evo-inbox|crm_primary|EVO_AGENT_|EVO_DB_PATH|EVO_BACKUP_DIR|evo_crm_staging_(?:data|backups|lead_agent_data)/u,
  );
});

test("staging app mounts only retained successor paths and has a safe env template", () => {
  const stagingCompose = readFileSync("docker-compose.staging.yml", "utf8");
  const stagingEnvironment = readFileSync("deploy/env.staging.example", "utf8");

  assert.match(
    stagingCompose,
    /EVO_PLATFORM_U11_RECOVERY_EVIDENCE_HOST_ROOT:-\/opt\/evo-crm-staging\/evidence\}:\/app\/recovery-evidence:ro/u,
  );
  assert.match(stagingEnvironment, /^EVO_CRM_DOMAIN=staging\.crm\.evoadmissions\.com$/mu);
  assert.match(stagingEnvironment, /^NEXT_PUBLIC_SUPABASE_URL=https:\/\//mu);
  assert.match(stagingEnvironment, /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/mu);
  assert.match(stagingEnvironment, /^EVO_PLATFORM_SUPABASE_SECRET_KEY=/mu);
  assert.match(stagingEnvironment, /^EVO_PLATFORM_ORGANIZATION_ID=/mu);
  assert.match(stagingEnvironment, /^EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1$/mu);
  assert.match(stagingEnvironment, /^EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=$/mu);
  assert.match(
    stagingEnvironment,
    /^EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT=\/app\/recovery-evidence$/mu,
  );
  assert.match(
    stagingEnvironment,
    /^EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH=\/app\/recovery-evidence\/u11-recovery-result\.json$/mu,
  );
  assert.doesNotMatch(stagingEnvironment, /iosckaqtovbbnssqcpde/u);
  assert.doesNotMatch(
    stagingEnvironment,
    /AUTH_SECRET|EVO_SECRET_ENCRYPTION_KEY|EVO_DB_PATH|EVO_BACKUP_DIR|EVO_AGENT_WAHA_SESSION|EVO_PLATFORM_(?:MANUAL_SEND|LEAD_AGENT)|EVO_LEAD_AGENT_|crm_primary|evo-inbox/u,
  );
  assert.doesNotMatch(stagingEnvironment, /replace-with-distinct-staging-observability/u);
});

test("workflow keeps controlled staging preflight protected and effect-free", () => {
  const workflow = readFileSync(".github/workflows/evo-fast-release.yml", "utf8");
  const start = workflow.indexOf("  staging_profile_preflight:");
  const end = workflow.indexOf("\n  prepare:", start);
  assert.notEqual(start, -1);
  assert.ok(end > start);

  const stagingJob = workflow.slice(start, end);
  assert.match(workflow, /release_environment:/u);
  assert.match(workflow, /- staging/u);
  assert.match(stagingJob, /if: inputs\.release_environment == 'staging'/u);
  assert.match(stagingJob, /environment: staging/u);
  assert.match(stagingJob, /git rev-parse origin\/main/u);
  assert.match(stagingJob, /fast-release-ci-gate\.mjs/u);
  assert.match(stagingJob, /controlled-staging-preflight/u);
  assert.match(stagingJob, /secrets\.EVO_RELEASE_STAGING_APP_ENV/u);
  assert.match(stagingJob, /EVO_RELEASE_APP_ENV_FILE/u);
  assert.match(stagingJob, /EVO_RELEASE_ENV_EXAMPLE_FILE/u);
  assert.match(stagingJob, /EVO_RELEASE_SUPABASE_PROJECT_REF/u);
  assert.match(stagingJob, /EVO_RELEASE_PLATFORM_ORGANIZATION_ID/u);
  assert.match(stagingJob, /EVO_RELEASE_SUPABASE_SECRET_KEY_SHA256/u);
  assert.match(stagingJob, /EVO_PRODUCTION_SUPABASE_SECRET_KEY_SHA256/u);
  assert.match(
    stagingJob,
    /^          EVO_RELEASE_VOLUME_NAMES: evo_crm_staging_output,evo_crm_staging_waha_sessions$/mu,
  );
  assert.match(
    stagingJob,
    /^          EVO_RELEASE_FIXED_CONTAINER_NAMES: ""$/mu,
  );
  assert.doesNotMatch(
    stagingJob,
    /evo_crm_staging_(?:data|backups|lead_agent_data)|evo-crm-staging-manual-send-worker/u,
  );
  assert.match(stagingJob, /install -m 600 \/dev\/null/u);
  assert.match(stagingJob, /trap .*rm -f/u);
  assert.match(stagingJob, /effectsAllowed/u);
  assert.match(stagingJob, /releaseStatus/u);
  assert.doesNotMatch(stagingJob, /set -x/u);
  assert.doesNotMatch(stagingJob, /echo .*STAGING_APP_ENV/u);
  assert.doesNotMatch(stagingJob, /cat .*STAGING_APP_ENV/u);
  assert.doesNotMatch(stagingJob, /\bssh\b/u);
  assert.doesNotMatch(stagingJob, /\bscp\b/u);
  assert.doesNotMatch(stagingJob, /docker (build|compose|save|load)/u);
  assert.doesNotMatch(stagingJob, /supabase (db|migration|link)/u);
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
  assert.match(route, /currentUser\(\)/u);
  assert.match(route, /authentication_required/u);
  assert.match(proxy, /path === "\/api\/version"/u);
  assert.doesNotMatch(health, /EVO_RELEASE/u);
});
