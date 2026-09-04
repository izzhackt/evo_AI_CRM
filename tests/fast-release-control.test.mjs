import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

test("CI gate requires only the exact root CRM check from GitHub Actions", async () => {
  assert.deepEqual(FAST_RELEASE_REQUIRED_CHECKS, ["Main CRM"]);
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
  assert.match(controller, /compose config --services/u);
  assert.match(controller, /services == \$'app\\nwaha'/u);
  assert.match(controller, /runtime_service_contract_invalid/u);
  assert.match(controller, /runtime_waha_image_drift/u);
  assert.doesNotMatch(controller, /EVO_REQUIRED_HEALTHY_CONTAINERS/u);
  assert.doesNotMatch(
    controller,
    /EVO_CRM_(?:LEAD_AGENT|MANUAL_SEND_WORKER)_ENV_FILE/u,
  );
  assert.doesNotMatch(controller, /docker compose down/u);
  assert.doesNotMatch(controller, /docker system prune/u);
  assert.doesNotMatch(controller, /git pull/u);
  assert.doesNotMatch(controller, /rm -rf/u);
});

test("release status accepts exactly healthy app plus WAHA and rejects an extra runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-fast-runtime-"));
  const bin = join(root, "bin");
  const docker = join(bin, "docker");
  mkdirSync(bin);
  writeFileSync(
    docker,
    `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ $1 == ps ]]; then
  if [[ $* == *com.docker.compose.service=app* ]]; then
    printf 'app-id\\n'
  elif [[ $* == *com.docker.compose.service=waha* ]]; then
    printf 'waha-id\\n'
  else
    printf 'app-id\\nwaha-id\\n'
    if [[ \${FAKE_EXTRA_RUNTIME:-0} == 1 ]]; then
      printf 'legacy-id\\n'
    fi
  fi
elif [[ $1 == inspect ]]; then
  format=$3
  id=$4
  case $format in
    *com.docker.compose.service*)
      [[ $id == app-id ]] && printf 'app\\n' || printf 'waha\\n'
      ;;
    *State.Health*) printf 'healthy\\n' ;;
    *RestartCount*) printf '0\\n' ;;
    *org.opencontainers.image.revision*) printf '${REVISION}\\n' ;;
    *org.opencontainers.image.version*) printf 'p6d-test\\n' ;;
    *Image*) printf 'sha256:${"1".repeat(64)}\\n' ;;
    *) exit 64 ;;
  esac
else
  exit 64
fi
`,
  );
  chmodSync(docker, 0o755);

  const environment = {
    ...process.env,
    EVO_RELEASE_PROJECT_NAME: "evo-crm",
    PATH: `${bin}:${process.env.PATH}`,
  };
  try {
    const result = JSON.parse(execFileSync(
      "bash",
      ["scripts/evo-fast-release.sh", "status"],
      { encoding: "utf8", env: environment },
    ));
    assert.deepEqual(
      { ok: result.ok, health: result.health, revision: result.revision },
      { ok: true, health: "healthy", revision: REVISION },
    );
    const blocked = spawnSync(
      "bash",
      ["scripts/evo-fast-release.sh", "status"],
      { encoding: "utf8", env: { ...environment, FAKE_EXTRA_RUNTIME: "1" } },
    );
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /runtime_service_contract_invalid/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release controller exposes one production deploy path and no controlled staging mode", () => {
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
  assert.match(controller, /EVO_RELEASE_TRANSFER_ROOT/u);
  assert.match(controller, /load_candidate_image/u);
  assert.match(controller, /rollback_from_state/u);
  assert.match(controller, /manual_rollback/u);
  assert.match(controller, /up --detach --no-deps --no-build --pull never --wait --wait-timeout 120 app/u);
  assert.doesNotMatch(
    controller,
    /EVO_RELEASE_STAGING_ROOT|EVO_RELEASE_ENVIRONMENT|controlled_staging|controlled-staging|--controlled-staging|evo-release-environment-profile|docker-compose\.staging|env\.staging/u,
  );
});

test("workflow releases only exact green main without staging or GitHub environment approval", () => {
  const workflow = readFileSync(".github/workflows/evo-fast-release.yml", "utf8");
  assert.match(workflow, /workflow_run:\n    workflows:\n      - EVO platform CI\n    types:\n      - completed\n    branches:\n      - main/u);
  assert.match(workflow, /group: evo-production-release/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /EVO_RELEASE_REVISION: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/u);
  assert.equal(
    [...workflow.matchAll(/github\.event\.workflow_run\.conclusion == 'success' && github\.event\.workflow_run\.event == 'push' && github\.event\.workflow_run\.head_branch == 'main'/gu)].length,
    2,
  );
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/u);
  assert.match(workflow, /git rev-parse HEAD/u);
  assert.match(workflow, /git rev-parse origin\/main/u);
  assert.match(workflow, /fast-release-ci-gate\.mjs/u);
  assert.match(workflow, /fast-release-ledger-gate\.mjs/u);
  assert.match(workflow, /docker build/u);
  assert.match(workflow, /docker save/u);
  assert.ok(
    workflow.indexOf("Build the exact linux-amd64") <
      workflow.indexOf("name: Deploy and verify CRM app"),
  );
  assert.match(workflow, /StrictHostKeyChecking yes/u);
  assert.match(workflow, /evo-fast-release-controller-error\.log/u);
  assert.match(workflow, /phase:"preflight_or_load"/u);
  assert.match(workflow, /EVO_RELEASE_TRANSFER_ROOT/u);
  assert.doesNotMatch(
    workflow.slice(workflow.indexOf("Upload sanitized release evidence")),
    /controller-error/u,
  );
  assert.doesNotMatch(
    workflow,
    /workflow_dispatch|release_environment|staging_profile_preflight|environment:|controlled-staging|EVO_RELEASE_STAGING_ROOT|supabase db push|supabase migration|supabase branch|supabase db reset/u,
  );
  assert.doesNotMatch(workflow, /ssh-keyscan/u);
  assert.doesNotMatch(workflow, /StrictHostKeyChecking no/u);
  assert.doesNotMatch(workflow, /git pull/u);
  assert.doesNotMatch(workflow, /EVO_REQUIRED_HEALTHY_CONTAINERS/u);
});

test("active platform CI executes only the root successor product", () => {
  const workflow = readFileSync(".github/workflows/evo-platform-ci.yml", "utf8");
  const auditAllowlist = readFileSync("scripts/check-npm-audit-allowlist.mjs", "utf8");
  assert.match(workflow, /^  crm:\n    name: Main CRM$/mu);
  assert.match(workflow, /^  crm_product:\n    name: Main CRM product$/mu);
  assert.match(workflow, /^  dependency_audit:\n    name: Dependency audit$/mu);
  assert.match(workflow, /needs:\n      - crm_product\n      - dependency_audit/u);
  assert.match(workflow, /PRODUCT_RESULT: \$\{\{ needs\.crm_product\.result \}\}/u);
  assert.match(workflow, /AUDIT_RESULT: \$\{\{ needs\.dependency_audit\.result \}\}/u);
  assert.match(workflow, /test "\$PRODUCT_RESULT" = "success"/u);
  assert.match(workflow, /test "\$AUDIT_RESULT" = "success"/u);
  assert.match(
    workflow,
    /name: Install pinned npm audit CLI\n        timeout-minutes: 4\n        env:\n          npm_config_audit: "false"\n          npm_config_fetch_retries: "0"\n          npm_config_fetch_timeout: "30000"\n          npm_config_fund: "false"[\s\S]*for attempt in 1 2 3; do[\s\S]*timeout 60s npm install --prefix "\$audit_prefix" npm@11\.19\.0 --ignore-scripts --no-audit --no-fund[\s\S]*test "\$\("\$audit_prefix\/node_modules\/\.bin\/npm" --version\)" = "11\.19\.0"[\s\S]*echo "\$audit_prefix\/node_modules\/\.bin" >> "\$GITHUB_PATH"[\s\S]*echo "EVO_NPM_BIN=\$audit_prefix\/node_modules\/\.bin\/npm" >> "\$GITHUB_ENV"/u,
  );
  assert.match(
    workflow,
    /name: Audit production dependencies[\s\S]*npm_config_fetch_retries: "0"\n          npm_config_fetch_timeout: "70000"[\s\S]*if ! test -x "\$EVO_NPM_BIN"; then[\s\S]*if "\$EVO_NPM_BIN" audit --package-lock-only --omit=dev --audit-level=moderate; then/u,
  );
  assert.match(
    workflow,
    /name: Audit development dependencies against the temporary allowlist[\s\S]*npm_config_fetch_retries: "0"\n          npm_config_fetch_timeout: "70000"[\s\S]*if node scripts\/check-npm-audit-allowlist\.mjs; then/u,
  );
  assert.match(auditAllowlist, /const npmBin = process\.env\.EVO_NPM_BIN\?\.trim\(\) \|\| "npm";/u);
  assert.match(auditAllowlist, /spawnSync\(\n    npmBin,/u);
  assert.doesNotMatch(auditAllowlist, /hasMeaningfulAuditError|empty npm audit placeholder/u);
  assert.doesNotMatch(
    workflow,
    /npm exec --yes --package=npm@11\.19\.0/u,
  );
  assert.doesNotMatch(workflow, /^  (?:inbox|lead-agent):/mu);
  assert.doesNotMatch(workflow, /EVO Inbox|EVO Lead Agent/u);
  assert.doesNotMatch(workflow, /Prepare P8|refs\/pull\/179|6ee93bd/u);
  assert.doesNotMatch(workflow, /izzhacktcodex\/waha-integration/u);
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
