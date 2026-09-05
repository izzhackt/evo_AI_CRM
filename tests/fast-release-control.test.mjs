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
  assert.match(controller, /--verify-supabase-keys/u);
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

test("release controller closes archive TOCTOU and verifies every runtime transition", () => {
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
  const candidateConfiguration = controller.slice(
    controller.indexOf("load_candidate_configuration() {"),
    controller.indexOf("compose() {"),
  );
  const archiveVerification = controller.slice(
    controller.indexOf("verify_archive() {"),
    controller.indexOf("load_candidate_image() {"),
  );
  const loadCandidate = controller.slice(
    controller.indexOf("load_candidate_image() {"),
    controller.indexOf("verify_external_health() {"),
  );
  const transitionCheck = controller.slice(
    controller.indexOf("verify_transition_runtime() ("),
    controller.indexOf("verify_capacity() {"),
  );
  const rollback = controller.slice(
    controller.indexOf("rollback_from_state() {"),
    controller.indexOf("deploy() {"),
  );
  const deploy = controller.slice(
    controller.indexOf("deploy() {"),
    controller.indexOf("manual_rollback() {"),
  );
  const manualRollback = controller.slice(
    controller.indexOf("manual_rollback() {"),
    controller.indexOf("case \"$command_name\" in"),
  );

  assert.ok(loadCandidate.includes('actual_hash=$(sha256sum "$EVO_RELEASE_ARCHIVE"'));
  assert.ok(loadCandidate.includes('[[ $actual_hash == "$EVO_RELEASE_ARCHIVE_SHA256" ]]'));
  assert.match(candidateConfiguration, /readonly candidate_expected_image_id=/u);
  assert.ok(loadCandidate.includes('[[ $image_id == "$candidate_expected_image_id" ]]'));
  assert.match(archiveVerification, /\.manifests\[0\]\.digest/u);
  assert.ok(archiveVerification.includes('[[ "sha256:$descriptor_hash" == "$descriptor_digest" ]]'));
  assert.match(archiveVerification, /archive_platform_manifest_invalid/u);
  assert.match(archiveVerification, /\.platform\.os == "linux" and \.platform\.architecture == "amd64"/u);
  assert.match(archiveVerification, /attestation-manifest/u);
  assert.ok(archiveVerification.includes('[[ "sha256:$image_manifest_hash" == "$image_manifest_digest" ]]'));
  assert.ok(archiveVerification.includes('.config.digest == $config_digest'));
  assert.match(archiveVerification, /candidate_image_id_unbound/u);
  assert.doesNotMatch(
    archiveVerification,
    /descriptor_path="blobs\/sha256\/\$\{EVO_RELEASE_EXPECTED_IMAGE_ID/u,
  );

  assert.match(
    transitionCheck,
    /verify_current_runtime[\s\S]*verify_runtime_waha_image[\s\S]*verify_networks/u,
  );
  assert.match(deploy, /verify_transition_runtime/u);
  assert.ok(deploy.includes('"$candidate_expected_image_id"'));
  assert.match(rollback, /verify_transition_runtime/u);
  assert.match(rollback, />"\$override" \|\| return 1/u);
  assert.match(rollback, /chmod 600 "\$override" \|\| return 1/u);

  assert.match(manualRollback, /verify_rollback_state_contract/u);
  assert.match(manualRollback, /verify_current_runtime/u);
  assert.match(manualRollback, /manual_rollback_requires_active_app/u);
  assert.ok(manualRollback.includes('[[ $current_revision == "$target_revision" ]]'));
  assert.match(manualRollback, /verify_runtime_waha_image/u);
  assert.match(manualRollback, /verify_networks/u);
  assert.doesNotMatch(manualRollback, /verify_rollback_seed/u);
});

test("release mutations hold one host flock and rollback on interruption", () => {
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
  const lock = controller.slice(
    controller.indexOf("acquire_release_lock() {"),
    controller.indexOf("service_container_id() {"),
  );
  const trapHandler = controller.slice(
    controller.indexOf("disarm_release_mutation_trap() {"),
    controller.indexOf("deploy() {"),
  );
  const deploy = controller.slice(
    controller.indexOf("deploy() {"),
    controller.indexOf("manual_rollback() {"),
  );
  const manualRollback = controller.slice(
    controller.indexOf("manual_rollback() {"),
    controller.indexOf("case \"$command_name\" in"),
  );

  assert.match(lock, /require_command flock/u);
  assert.match(lock, /\.evo-fast-release\.lock/u);
  assert.match(lock, /flock --nonblock 9/u);
  assert.match(deploy, /acquire_release_lock/u);
  assert.match(manualRollback, /acquire_release_lock/u);

  assert.match(trapHandler, /trap 'release_signal_exit HUP' HUP/u);
  assert.match(trapHandler, /trap 'release_signal_exit INT' INT/u);
  assert.match(trapHandler, /trap 'release_signal_exit TERM' TERM/u);
  assert.match(trapHandler, /trap 'release_exit_rollback' EXIT/u);
  assert.match(trapHandler, /rollback_from_state "\$release_mutation_state"/u);
  assert.match(trapHandler, /deployment_interrupted/u);
  assert.match(
    trapHandler,
    /status:"rolled_back",code:"deployment_interrupted",evidenceDir:\$evidenceDir/u,
  );
  assert.doesNotMatch(trapHandler, />&2 \|\| true/u);
  assert.ok(
    deploy.indexOf("arm_release_mutation_trap") <
      deploy.indexOf("compose up --detach"),
  );
  assert.ok(
    deploy.indexOf("verify_transition_runtime") <
      deploy.indexOf("disarm_release_mutation_trap"),
  );
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

test("release controller requires one sealed rollback source and never stages a fallback path", () => {
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
  assert.match(controller, /verify_rollback_seed\(\)/u);
  assert.match(controller, /seal_rollback_seed\(\)/u);
  assert.match(controller, /evo-release-rollback-seed\/v1/u);
  assert.match(controller, /EVO_RELEASE_ROLLBACK_SEED/u);
  assert.match(controller, /rollback_seed_env_drift/u);
  assert.match(controller, /docker-compose\.previous\.yml/u);
  assert.match(controller, /appEnvSha256/u);
  assert.match(controller, /current_app_container_id/u);
  assert.match(controller, /services == waha \|\| \$services == \$'app\\nwaha'/u);
  assert.match(controller, /if \[\[ -n \$current_app_container_id \]\]; then/u);
  assert.match(controller, /evo-app-env-contract\.mjs/u);
  assert.match(controller, /EVO_RELEASE_APP_ENV_FILE/u);
  assert.match(
    controller,
    /export EVO_CRM_APP_ENV_FILE=\$EVO_RELEASE_APP_ENV_FILE/u,
  );
  assert.doesNotMatch(controller, /controlled[_-]staging|EVO_RELEASE_STAGING_ROOT/u);
});

test("release runbooks install the controller before sealing and provide complete executable commands", () => {
  const fastRelease = readFileSync("deploy/fast-app-release.md", "utf8");
  const productionRelease = readFileSync("deploy/production-release.md", "utf8");
  const preparation = productionRelease.slice(
    productionRelease.indexOf("## One-time #552 preparation"),
    productionRelease.indexOf("## Verification"),
  );

  assert.ok(
    preparation.indexOf("install the exact reviewed #551 controller") <
      preparation.indexOf("`seal-rollback-seed`"),
  );
  for (const runbook of [fastRelease, productionRelease]) {
    assert.match(runbook, /export EVO_SUPABASE_PROJECT_REF='<20-character-project-ref>'/u);
    assert.match(runbook, /evo-fast-release\.sh rollback/u);
  }
});

test("workflow binds exact green main to one runner-built immutable release", () => {
  const workflow = readFileSync(".github/workflows/evo-fast-release.yml", "utf8");
  assert.match(workflow, /workflow_run:/u);
  assert.match(workflow, /EVO_AUTOMATED_PRODUCTION_RELEASE_ENABLED/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /git rev-parse origin\/main/u);
  assert.match(workflow, /fast-release-ci-gate\.mjs/u);
  assert.match(workflow, /fast-release-ledger-gate\.mjs/u);
  assert.match(workflow, /docker build/u);
  assert.match(workflow, /docker save/u);
  assert.match(workflow, /StrictHostKeyChecking yes/u);
  assert.match(workflow, /evo-production-release-controller-error\.log/u);
  assert.match(workflow, /phase:"preflight_or_load"/u);
  assert.doesNotMatch(
    workflow.slice(workflow.indexOf("Upload sanitized release evidence")),
    /controller-error/u,
  );
  assert.doesNotMatch(workflow, /ssh-keyscan/u);
  assert.doesNotMatch(workflow, /StrictHostKeyChecking no/u);
  assert.doesNotMatch(workflow, /git pull/u);
  assert.doesNotMatch(workflow, /EVO_REQUIRED_HEALTHY_CONTAINERS/u);
  assert.doesNotMatch(workflow, /^\s*environment:/mu);
  assert.doesNotMatch(workflow, /staging/iu);
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
