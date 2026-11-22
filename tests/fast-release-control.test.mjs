import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
} from "../scripts/release/fast-release-ci-gate.mjs";
import { expectedMigrationVersions, verifySelfHostedMigrationLedger } from "../scripts/release/fast-release-ledger-gate.mjs";
import { sealCandidateEnvironmentSnapshot } from "../scripts/release/evo-app-env-contract.mjs";
import {
  REVISION,
  CLAMAV_IMAGE,
  writeExecutable,
  rollbackFixture,
  candidateIdentityFixture,
  acceptedV3RollbackRetryFixture,
  greenChecks,
} from "./helpers/fast-release-fixtures.mjs";

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
test("migration gate requires an exact contiguous source tree", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-fast-ledger-"));
  try {
    writeFileSync(join(root, "001_one.sql"), "select 1;\n");
    writeFileSync(join(root, "002_two.sql"), "select 2;\n");
    assert.deepEqual(expectedMigrationVersions(root), ["001", "002"]);
    writeFileSync(join(root, "004_four.sql"), "select 4;\n");
    assert.throws(() => expectedMigrationVersions(root), /not contiguous/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("self-hosted migration gate compares the database ledger with the same exactness and never calls any HTTP API", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-fast-ledger-selfhosted-"));
  try {
    writeFileSync(join(root, "001_one.sql"), "select 1;\n");
    writeFileSync(join(root, "002_two.sql"), "select 2;\n");
    const rows = (...versions) => async () => versions.map((version) => ({ version }));
    assert.deepEqual(
      await verifySelfHostedMigrationLedger({ migrationDirectory: root, readRemoteRows: rows("001", "002") }),
      { ok: true, count: 2, range: "001-002" },
    );
    // the workflow reads only `.ok`
    assert.deepEqual(
      Object.keys(await verifySelfHostedMigrationLedger({ migrationDirectory: root, readRemoteRows: rows("001", "002") })),
      ["ok", "count", "range"],
    );
    for (const [label, remote] of [
      ["behind the tree", rows("001")],
      ["ahead of the tree", rows("001", "002", "003")],
      ["a gap", rows("001", "003")],
      ["a duplicate", rows("001", "001", "002")],
      ["unordered", rows("002", "001")],
      ["empty", rows()],
      ["malformed", rows("1", "2")],
    ]) {
      await assert.rejects(
        verifySelfHostedMigrationLedger({ migrationDirectory: root, readRemoteRows: remote }),
        /ledger/u,
        label,
      );
    }
    await assert.rejects(
      verifySelfHostedMigrationLedger({ migrationDirectory: root, readRemoteRows: async () => { throw new Error("selfhosted_remote_failed"); } }),
      /selfhosted_remote_failed/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("the gate CLI reads the ledger only over ssh with a fixed command; leftover cloud variables change nothing and an unreachable database stops it", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-fast-ledger-cli-"));
  try {
    const migrations = join(root, "supabase", "migrations");
    mkdirSync(migrations, { recursive: true });
    writeFileSync(join(migrations, "001_one.sql"), "select 1;\n");
    writeFileSync(join(migrations, "002_two.sql"), "select 2;\n");
    const bin = join(root, "bin");
    mkdirSync(bin);
    const record = join(root, "ssh-argv.log");
    // A fake `ssh` records its argv and answers like psql -A -t. It stands in for the transport only.
    writeExecutable(join(bin, "ssh"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${record}"\nprintf '001\\n002\\n'\n`);
    const gate = join(process.cwd(), "scripts", "release", "fast-release-ledger-gate.mjs");
    const run = (environment) => spawnSync(process.execPath, [gate], {
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, EVO_RELEASE_REPO: root, ...environment },
      timeout: 30_000,
    });

    const selfhosted = run({});
    assert.equal(selfhosted.status, 0, selfhosted.stderr);
    assert.deepEqual(JSON.parse(selfhosted.stdout), { ok: true, count: 2, range: "001-002" });
    const argv = readFileSync(record, "utf8").trimEnd().split("\n");
    assert.equal(argv.at(-2), "evo-production");
    assert.equal(
      argv.at(-1),
      "docker exec -i evo-supabase-db psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -A -t -c 'select version from supabase_migrations.schema_migrations order by version'",
    );
    assert.doesNotMatch(argv.join("\n"), /-L|-R|-D|:5432|:25432|:25433|PGPASSWORD|password/u, "no tunnel, no database port, no credential");

    // leftover cloud variables are ignored: there is no cloud branch to select
    rmSync(record);
    const leftover = run({ EVO_SUPABASE_TARGET: "cloud", EVO_SUPABASE_PROJECT_REF: "a".repeat(20), SUPABASE_ACCESS_TOKEN: "fixture" });
    assert.equal(leftover.status, 0, leftover.stderr);
    assert.deepEqual(JSON.parse(leftover.stdout), { ok: true, count: 2, range: "001-002" });
    assert.equal(existsSync(record), true, "the ledger is read over ssh, never over HTTP");

    // a failing remote fails the gate generically, without echoing remote output
    writeExecutable(join(bin, "ssh"), "#!/bin/sh\necho 'secret remote detail' >&2\nexit 255\n");
    const failed = run({ EVO_SUPABASE_TARGET: "cloud", SUPABASE_ACCESS_TOKEN: "fixture" });
    assert.equal(failed.status, 2);
    assert.equal(failed.stdout, "");
    assert.equal(failed.stderr, "production migration ledger gate failed\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("preflight removes only owned snapshots with real filesystem commands", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const preflight = controller.slice(
    controller.indexOf("preflight() {"),
    controller.indexOf("sync_file_and_parent() {"),
  );
  const start = preflight.indexOf('  unlink "$candidate_app_env_snapshot"');
  const end = preflight.indexOf("  jq -cn", start);
  assert.ok(start >= 0 && end > start, "actual preflight cleanup must exist");
  const root = mkdtempSync(join(tmpdir(), "evo-preflight-cleanup-"));
  const preflightDir = join(root, "owned-preflight");
  const original = join(root, "original.env");
  mkdirSync(preflightDir, { mode: 0o700 });
  writeFileSync(original, "original fixture\n", { mode: 0o600 });
  const appSnapshot = join(preflightDir, "candidate-app.env");
  const composeSnapshot = join(preflightDir, "docker-compose.candidate.yml");
  writeFileSync(appSnapshot, "snapshot fixture\n", { mode: 0o600 });
  writeFileSync(composeSnapshot, "compose fixture\n", { mode: 0o600 });
  try {
    // Run the actual cleanup against real unlink/rmdir, not a permissive stub.
    const result = spawnSync("bash", ["-c", `
      set -Eeuo pipefail
      fail() { printf '%s\\n' "$1" >&2; exit 2; }
      ${preflight.slice(start, end)}
    `], {
      env: { PATH: "/usr/bin:/bin", candidate_app_env_snapshot: appSnapshot,
        candidate_compose_file: composeSnapshot, preflight_dir: preflightDir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(existsSync(preflightDir), false);
    assert.equal(readFileSync(original, "utf8"), "original fixture\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("release health accepts only the canonical staff host and existing loopback rehearsal", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const declaration = controller.match(/^readonly HEALTH_URL_RE=.*$/mu)?.[0];
  assert.ok(declaration, "actual release health declaration must exist");
  for (const [url, accepted] of [
    ["https://crm.evoadmissions.com/api/health", true],
    ["http://127.0.0.1:9/api/health", true],
    ["https://evo-crm.72.62.119.112.sslip.io/api/health", false],
    ["https://app.evoadmissions.com/api/health", false],
    ["http://crm.evoadmissions.com/api/health", false],
    ["https://crm.evoadmissions.com.attacker.invalid/api/health", false],
    ["https://user:pass@crm.evoadmissions.com/api/health", false],
    ["https://crm.evoadmissions.com:443/api/health", false],
    ["https://crm.evoadmissions.com/api/health?ok=1", false],
    ["https://crm.evoadmissions.com/api/health#ok", false],
  ]) {
    const result = spawnSync("bash", ["-c", `${declaration}\n[[ "$HEALTH_URL" =~ $HEALTH_URL_RE ]]`], {
      env: { PATH: process.env.PATH, HEALTH_URL: url },
      encoding: "utf8",
    });
    assert.equal(result.status, accepted ? 0 : 1, url);
  }
});
test("controller accepts the word selfhosted as the Supabase identity and nothing else", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const declaration = controller.match(/^readonly SUPABASE_PROJECT_REF_RE=.*$/mu)?.[0];
  assert.ok(declaration, "actual project identity declaration must exist");
  for (const [value, accepted] of [
    ["selfhosted", true],
    ["abcdefghijklmnopqrst", false], ["a1b2c3d4e5f6g7h8i9j0", false], ["ABCDEFGHIJKLMNOPQRST", false],
    ["Selfhosted", false], ["self-hosted", false], ["selfhosted ", false], [" selfhosted", false], ["selfhosted\n", false],
    ["selfhostedx", false], ["xselfhosted", false], ["supabase.evoadmissions.com", false], ["", false],
  ]) {
    const result = spawnSync("bash", ["-c", `${declaration}\n[[ "$VALUE" =~ $SUPABASE_PROJECT_REF_RE ]]`], {
      env: { PATH: process.env.PATH, VALUE: value },
      encoding: "utf8",
    });
    assert.equal(result.status, accepted ? 0 : 1, JSON.stringify(value));
  }
  // the identity travels unchanged to the env validator and into the rollback wrapper
  assert.match(controller, /--supabase-project-ref "\$EVO_SUPABASE_IDENTITY"/u);
  assert.match(controller, /printf 'export EVO_SUPABASE_IDENTITY=%q\\n' "\$EVO_SUPABASE_IDENTITY"/u);
});
test("release controller is app-only, wait-gated, and avoids destructive shortcuts", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const preflight = controller.slice(
    controller.indexOf("preflight() {"),
    controller.indexOf("write_result() {"),
  );
  const preflightChecks = controller.slice(
    controller.indexOf("run_preflight_checks() {"),
    controller.indexOf("require_release_runtime_commands() {"),
  );
  const deploy = controller.slice(
    controller.indexOf("deploy() {"),
    controller.indexOf("manual_rollback() {"),
  );
  execFileSync("bash", ["-n", "scripts/release/evo-fast-release.sh"]);
  assert.match(controller, /--no-deps/u);
  assert.match(controller, /--no-build/u);
  assert.match(controller, /--pull never/u);
  assert.match(controller, /--wait/u);
  assert.match(controller, /rollback_from_state/u);
  assert.match(preflight, /acquire_release_lock/u);
  assert.match(preflight, /prepare_candidate_generation/u);
  assert.match(preflight, /run_preflight_checks/u);
  assert.match(preflightChecks, /verify_archive/u);
  assert.match(preflightChecks, /verify_env_contract/u);
  assert.match(controller, /evo-app-env-contract\.mjs/u);
  assert.match(controller, /--verify-supabase-keys/u);
  assert.match(controller, /app_env_contract_invalid/u);
  assert.doesNotMatch(preflight, /docker image load/u);
  assert.match(deploy, /load_candidate_image/u);
  assert.match(controller, /archive_layers_invalid/u);
  assert.match(controller, /compose config --services/u);
  assert.match(controller, /services == \$'app\\nclamav\\nwaha'/u);
  assert.match(controller, /runtime_service_contract_invalid/u);
  assert.match(controller, /runtime_waha_image_drift/u);
  assert.match(controller, /runtime_clamav_image_drift/u);
  assert.match(controller, /private_service_port_published/u);
  assert.match(controller, /provision_scanner_runtime/u);
  assert.match(controller, /--wait-timeout 600 clamav/u);
  assert.match(controller, /EVO_RELEASE_MIN_AVAILABLE_MEMORY_KB:-4194304/u);
  assert.match(controller, /minimum_memory -ge 4194304/u);
  assert.match(controller, /MemAvailable:/u);
  assert.match(controller, /uname -s\) == Darwin/u);
  assert.match(controller, /docker info --format '\{\{\.MemTotal\}\}'/u);
  assert.match(controller, /memory_capacity_unavailable/u);
  assert.match(controller, /insufficient_memory_capacity/u);
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
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
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
    controller.indexOf("verify_transition_runtime_identity() ("),
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
  assert.ok(
    !loadCandidate.includes('[[ $image_id == "$EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST" ]]'),
  );
  assert.ok(
    archiveVerification.includes('[[ $config_image_digest == "$EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST" ]]'),
  );
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
    /verify_current_runtime_identity[\s\S]*verify_runtime_waha_image[\s\S]*verify_networks/u,
  );
  assert.match(deploy, /verify_transition_runtime/u);
  assert.ok(deploy.includes('"$candidate_expected_image_id"'));
  assert.match(rollback, /verify_transition_runtime/u);
  assert.match(rollback, />"\$override" \|\| return 1/u);
  assert.match(rollback, /chmod 600 "\$override" \|\| return 1/u);

  assert.match(manualRollback, /verify_rollback_state_contract/u);
  assert.match(manualRollback, /EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID/u);
  assert.match(manualRollback, /rollback_state_outside_evidence/u);
  assert.match(manualRollback, /rollback_from_state/u);
  assert.doesNotMatch(manualRollback, /verify_rollback_seed/u);
});
test("release mutations hold one host flock and rollback on interruption", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
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
test("release status accepts exactly healthy app plus private ClamAV and WAHA and rejects an extra runtime", () => {
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
  elif [[ $* == *com.docker.compose.service=clamav* ]]; then
    printf 'clamav-id\\n'
  elif [[ $* == *com.docker.compose.service=waha* ]]; then
    printf 'waha-id\\n'
  else
    printf 'app-id\\nclamav-id\\nwaha-id\\n'
    if [[ \${FAKE_EXTRA_RUNTIME:-0} == 1 ]]; then
      printf 'legacy-id\\n'
    fi
  fi
elif [[ $1 == inspect ]]; then
  format=$3
  id=$4
  case $format in
    *com.docker.compose.service*)
      case $id in
        app-id) printf 'app\\n' ;;
        clamav-id) printf 'clamav\\n' ;;
        waha-id) printf 'waha\\n' ;;
        *) printf 'legacy\\n' ;;
      esac
      ;;
    *State.Health*) printf 'healthy\\n' ;;
    *RestartCount*) printf '0\\n' ;;
    *HostConfig.PortBindings*) printf '{}\\n' ;;
    *Config.Image*)
      [[ $id == clamav-id ]] && printf '%s\\n' '${CLAMAV_IMAGE}' || printf 'unused\\n'
      ;;
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
      ["scripts/release/evo-fast-release.sh", "status"],
      { encoding: "utf8", env: environment },
    ));
    assert.deepEqual(
      { ok: result.ok, health: result.health, revision: result.revision, scanner: result.scanner },
      { ok: true, health: "healthy", revision: REVISION, scanner: "healthy" },
    );
    const blocked = spawnSync(
      "bash",
      ["scripts/release/evo-fast-release.sh", "status"],
      { encoding: "utf8", env: { ...environment, FAKE_EXTRA_RUNTIME: "1" } },
    );
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /runtime_service_contract_invalid/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("release controller requires one sealed rollback source and never stages a fallback path", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  assert.match(controller, /verify_rollback_seed\(\)/u);
  assert.match(controller, /seal_rollback_seed\(\)/u);
  assert.match(controller, /evo-release-rollback-seed\/v3/u);
  assert.match(controller, /evo-fast-release-state\/v3/u);
  assert.match(controller, /scannerPresent/u);
  assert.match(controller, /scannerImage/u);
  assert.match(controller, /EVO_RELEASE_ROLLBACK_SEED/u);
  assert.match(controller, /rollback_seed_env_drift/u);
  assert.match(controller, /docker-compose\.previous\.yml/u);
  assert.match(controller, /appEnvSha256/u);
  assert.match(controller, /current_app_container_id/u);
  assert.match(controller, /\$services == waha/u);
  assert.match(controller, /\$'clamav\\nwaha'/u);
  assert.match(controller, /\$'app\\nwaha'/u);
  assert.match(controller, /\$'app\\nclamav\\nwaha'/u);
  assert.match(controller, /if \[\[ -n \$current_app_container_id \]\]; then/u);
  assert.match(controller, /evo-app-env-contract\.mjs/u);
  assert.match(controller, /EVO_RELEASE_APP_ENV_FILE/u);
  assert.match(controller, /candidate-app\.env/u);
  assert.match(controller, /rollback-app\.env/u);
  assert.match(controller, /compose_with_app_env/u);
  assert.doesNotMatch(
    controller,
    /export EVO_CRM_APP_ENV_FILE=\$EVO_RELEASE_APP_ENV_FILE/u,
  );
  assert.doesNotMatch(controller, /controlled[_-]staging|EVO_RELEASE_STAGING_ROOT/u);
});
test("controller seals the mutable app environment once after the host lock and never reopens it for runtime work", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const deploy = controller.slice(
    controller.indexOf("deploy() {"),
    controller.indexOf("manual_rollback() {"),
  );
  const seed = controller.slice(
    controller.indexOf("seal_rollback_seed() {"),
    controller.indexOf("prepare_candidate_generation() {"),
  );
  const composeWithSnapshot = controller.slice(
    controller.indexOf("compose_with_app_env() {"),
    controller.indexOf("seal_app_env_snapshot() {"),
  );

  assert.ok(deploy.indexOf("acquire_release_lock") < deploy.indexOf("prepare_candidate_generation"));
  assert.ok(deploy.indexOf("prepare_candidate_generation") < deploy.indexOf("run_preflight_checks"));
  assert.ok(seed.indexOf("acquire_release_lock") < seed.indexOf("seal_app_env_snapshot"));
  assert.match(controller, /--seal-private-env "\$source"/u);
  assert.match(composeWithSnapshot, /EVO_CRM_APP_ENV_FILE="\$app_env_snapshot" docker compose/u);
  assert.match(composeWithSnapshot, /--env-file "\$app_env_snapshot"/u);
  assert.doesNotMatch(controller, /--env-file "\$EVO_RELEASE_APP_ENV_FILE"/u);
  assert.doesNotMatch(controller, /sha256sum "\$EVO_RELEASE_APP_ENV_FILE"/u);
  assert.doesNotMatch(controller, /export EVO_CRM_APP_ENV_FILE=\$EVO_RELEASE_APP_ENV_FILE/u);
});
test("pending state and runtime receipt use crash-safe single-file transitions", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const state = controller.slice(
    controller.indexOf("create_rollback_state() {"),
    controller.indexOf("verify_rollback_state_contract() {"),
  );
  const runtime = controller.slice(
    controller.indexOf("record_candidate_container() {"),
    controller.indexOf("load_candidate_runtime_record() {"),
  );
  const deploy = controller.slice(
    controller.indexOf("deploy() {"),
    controller.indexOf("manual_rollback() {"),
  );
  const rollback = controller.slice(
    controller.indexOf("rollback_from_state() {"),
    controller.indexOf("load_bound_release_state() {"),
  );

  assert.match(state, /create_once_json "\$directory\/state\.json"/u);
  assert.match(state, /create_once_json "\$EVO_RELEASE_EVIDENCE_ROOT\/pending-current\.json"/u);
  assert.match(runtime, /candidate-runtime\.json/u);
  assert.match(runtime, /evo-v3-candidate-runtime\/v1/u);
  assert.match(runtime, /create_once_json "\$runtime_record"/u);
  assert.doesNotMatch(runtime, /replace_json_atomically "\$state_file"/u);
  assert.doesNotMatch(runtime, /replace_json_atomically "\$pending"/u);
  assert.ok(deploy.indexOf("create_rollback_state") < deploy.indexOf("arm_release_mutation_trap"));
  assert.ok(deploy.indexOf("record_candidate_container") < deploy.indexOf("verify_transition_runtime"));
  assert.match(rollback, /if load_candidate_runtime_record "\$state_file"; then/u);
  assert.doesNotMatch(rollback, /load_candidate_runtime_record "\$state_file" \|\| return 1/u);
  assert.match(deploy, /status:"pending"/u);
  assert.doesNotMatch(deploy, /status:"accepted"/u);
});
test("acceptance is deterministic, generation-bound, atomic, and idempotent across both crash windows", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const derive = controller.slice(
    controller.indexOf("derive_acceptance_payload() {"),
    controller.indexOf("accept_candidate() {"),
  );
  const accept = controller.slice(
    controller.indexOf("accept_candidate() {"),
    controller.indexOf("disarm_release_mutation_trap() {"),
  );
  const status = controller.slice(
    controller.indexOf("candidate_status() {"),
    controller.indexOf("derive_acceptance_payload() {"),
  );

  for (const identity of [
    "repository",
    "releaseId",
    "workflowRunId",
    "workflowRunAttempt",
    "upstreamCiRunId",
    "upstreamCiRunAttempt",
    "artifactId",
    "artifactDigest",
    "revision",
    "imageId",
    "imageConfigDigest",
    "imageSource",
    "archiveSha256",
    "appEnvSha256",
    "browserReceiptSha256",
    "candidateContainerId",
    "currentMainRevision",
  ]) {
    assert.match(derive, new RegExp(`${identity}:`, "u"));
  }
  assert.ok(accept.indexOf("derive_acceptance_payload") < accept.indexOf("pointer_names_bound_acceptance"));
  assert.match(accept, /actual_payload == "\$acceptance_payload"/u);
  assert.ok(accept.indexOf('create_once_json "$acceptance_record"') < accept.indexOf('replace_json_atomically "$current_pointer"'));
  assert.ok(accept.indexOf('replace_json_atomically "$current_pointer"') < accept.lastIndexOf('unlink "$pending"'));
  assert.match(accept, /require_pointer_hash "\$current_pointer" "\$previous_pointer_hash"/u);
  assert.match(accept, /EVO_RELEASE_CURRENT_MAIN_REVISION == "\$EVO_RELEASE_REVISION"/u);
  assert.match(status, /status:"pending"/u);
  assert.match(status, /status:"accepted"/u);
  assert.match(controller, /accept-candidate\)/u);
  assert.match(controller, /candidate-status\)/u);
});
test("lost accept response is classified accepted without consulting health", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const status = controller.slice(
    controller.indexOf("candidate_status() {"),
    controller.indexOf("derive_acceptance_payload() {"),
  );
  const identity = controller.slice(
    controller.indexOf("verify_bound_candidate_identity() {"),
    controller.indexOf("verify_running_bound_candidate() {"),
  );

  assert.match(status, /verify_bound_candidate_identity/u);
  assert.doesNotMatch(status, /verify_running_bound_candidate|verify_external_health|container_health/u);
  assert.ok(status.indexOf("pointer_names_bound_acceptance") < status.indexOf("verify_pending_for_state"));
  assert.match(status, /status:"accepted"/u);
  assert.match(identity, /load_candidate_runtime_record/u);
  assert.match(identity, /verify_transition_runtime_identity/u);
  assert.match(identity, /container == "\$expected_container"/u);
});
test("unhealthy pending candidate remains classifiable for the rollback decision", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const status = controller.slice(
    controller.indexOf("candidate_status() {"),
    controller.indexOf("derive_acceptance_payload() {"),
  );
  const running = controller.slice(
    controller.indexOf("verify_running_bound_candidate() {"),
    controller.indexOf("verify_browser_receipt() {"),
  );
  const accept = controller.slice(
    controller.indexOf("accept_candidate() {"),
    controller.indexOf("disarm_release_mutation_trap() {"),
  );

  assert.match(status, /elif verify_pending_for_state[\s\S]*status:"pending"/u);
  assert.doesNotMatch(status, /verify_current_runtime|verify_external_health/u);
  assert.match(running, /verify_bound_candidate_identity/u);
  assert.match(running, /verify_current_runtime/u);
  assert.match(running, /verify_external_health/u);
  assert.match(accept, /verify_running_bound_candidate/u);
});
test("rollback restores the previous app from an exact unhealthy pending candidate", () => {
  const fixture = rollbackFixture({ appPresent: true, appHealth: "unhealthy" });
  try {
    const execution = spawnSync(
      "bash",
      ["scripts/release/evo-fast-release.sh", "rollback-pending"],
      { encoding: "utf8", env: fixture.environment },
    );
    assert.equal(execution.status, 0, `${execution.stderr}\n${readFileSync(fixture.dockerLog, "utf8")}`);
    const result = JSON.parse(execution.stdout);
    assert.deepEqual(
      { command: result.command, ok: result.ok, status: result.status },
      { command: "rollback-pending", ok: true, status: "rolled_back" },
    );
    assert.match(readFileSync(fixture.dockerState, "utf8"), new RegExp(`APP_IMAGE=${fixture.previousImage}`, "u"));
    assert.equal(existsSync(fixture.pendingPath), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("candidate status and accept reject actual environment drift before accepting any receipt", () => {
  const fixture = candidateIdentityFixture();
  try {
    const status = spawnSync("bash", ["scripts/release/evo-fast-release.sh", "candidate-status"], {
      encoding: "utf8", env: fixture.environment,
    });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).status, "pending");
    for (const command of ["candidate-status", "accept-candidate", "rollback-pending"]) {
      const execution = spawnSync("bash", ["scripts/release/evo-fast-release.sh", command], {
        encoding: "utf8", env: {
          ...fixture.environment,
          FAKE_APP_ENV_JSON: JSON.stringify([`EVO_RELEASE_REVISION=${REVISION}`]),
        },
      });
      assert.notEqual(execution.status, 0);
      assert.match(execution.stderr, /runtime_environment_identity_drift/u);
      assert.equal(existsSync(fixture.pendingPath), true);
      assert.equal(existsSync(join(fixture.evidenceDir, "v3-acceptance-record.json")), false);
      assert.doesNotMatch(readFileSync(fixture.dockerLog, "utf8"), / up | stop | rm /u);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("rollback restores the exact previous sealed image ID instead of inheriting the candidate ID", () => {
  const fixture = rollbackFixture({ appPresent: true, appHealth: "unhealthy", previousIdentity: true });
  const previousEnvPath = join(fixture.evidenceDir, "rollback-app.env");
  const previousBytes = readFileSync(previousEnvPath);
  try {
    const execution = spawnSync("bash", ["scripts/release/evo-fast-release.sh", "rollback-pending"], {
      encoding: "utf8", env: fixture.environment,
    });
    assert.equal(execution.status, 0, execution.stderr);
    assert.deepEqual(readFileSync(previousEnvPath), previousBytes);
    assert.equal(existsSync(fixture.pendingPath), false);
    assert.match(readFileSync(fixture.dockerState, "utf8"), new RegExp(`APP_IMAGE=${fixture.previousImage}`, "u"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("pending-only rollback refuses both accepted crash windows before runtime mutation", () => {
  for (const pendingRemains of [true, false]) {
    const fixture = rollbackFixture({ appPresent: true, appHealth: "unhealthy" });
    try {
      const acceptedPointer = join(fixture.evidenceRoot, "current-v3-accepted.json");
      writeFileSync(acceptedPointer, JSON.stringify({ accepted: true }), { mode: 0o600 });
      chmodSync(acceptedPointer, 0o600);
      if (!pendingRemains) rmSync(fixture.pendingPath);
      const before = readFileSync(fixture.dockerState, "utf8");
      const execution = spawnSync(
        "bash",
        ["scripts/release/evo-fast-release.sh", "rollback-pending"],
        { encoding: "utf8", env: fixture.environment },
      );
      assert.equal(execution.status, 2);
      assert.match(
        execution.stderr,
        pendingRemains ? /pending_candidate_superseded/u : /pending_candidate_not_current/u,
      );
      assert.equal(readFileSync(fixture.dockerState, "utf8"), before);
      assert.equal(readFileSync(fixture.dockerLog, "utf8"), "");
      assert.equal(existsSync(acceptedPointer), true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
test("rollback restores the previous app when failed deploy left no candidate container", () => {
  const fixture = rollbackFixture({ appPresent: false, appHealth: "unhealthy" });
  try {
    const execution = spawnSync(
      "bash",
      ["scripts/release/evo-fast-release.sh", "rollback"],
      { encoding: "utf8", env: fixture.environment },
    );
    assert.equal(execution.status, 0, `${execution.stderr}\n${readFileSync(fixture.dockerLog, "utf8")}`);
    const result = JSON.parse(execution.stdout);
    assert.deepEqual(
      { command: result.command, ok: result.ok, status: result.status },
      { command: "rollback", ok: true, status: "rolled_back" },
    );
    const runtime = readFileSync(fixture.dockerState, "utf8");
    assert.match(runtime, /APP_PRESENT=1/u);
    assert.match(runtime, new RegExp(`APP_IMAGE=${fixture.previousImage}`, "u"));
    assert.equal(existsSync(fixture.pendingPath), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("accepted V3 rollback retry finishes pointer restore without mutating restored runtime", () => {
  const fixture = acceptedV3RollbackRetryFixture();
  try {
    const execution = spawnSync(
      "bash",
      ["scripts/release/evo-fast-release.sh", "rollback"],
      { encoding: "utf8", env: fixture.environment },
    );
    assert.equal(execution.status, 0, `${execution.stderr}\n${readFileSync(fixture.dockerLog, "utf8")}`);
    const result = JSON.parse(execution.stdout);
    assert.deepEqual(
      { command: result.command, ok: result.ok, status: result.status },
      { command: "rollback", ok: true, status: "rolled_back" },
    );
    assert.deepEqual(
      JSON.parse(readFileSync(fixture.currentPointerPath, "utf8")),
      fixture.previousPointer,
    );
    assert.doesNotMatch(readFileSync(fixture.dockerLog, "utf8"), /\bup\b/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("accepted V3 rollback retry refuses a foreign runtime and preserves its pointer", () => {
  const fixture = acceptedV3RollbackRetryFixture();
  try {
    const foreignRuntime = readFileSync(fixture.dockerState, "utf8")
      .replace(/^APP_IMAGE=.*$/mu, `APP_IMAGE=sha256:${"9".repeat(64)}`);
    writeFileSync(fixture.dockerState, foreignRuntime, { mode: 0o600 });
    const pointerBefore = readFileSync(fixture.currentPointerPath, "utf8");
    const execution = spawnSync(
      "bash",
      ["scripts/release/evo-fast-release.sh", "rollback"],
      { encoding: "utf8", env: fixture.environment },
    );
    assert.equal(execution.status, 2);
    assert.match(execution.stderr, /rollback_failed/u);
    assert.equal(readFileSync(fixture.currentPointerPath, "utf8"), pointerBefore);
    assert.doesNotMatch(readFileSync(fixture.dockerLog, "utf8"), /\bup\b/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("rollback is bound to the exact pending or accepted generation and has no mutable env fallback", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const rollback = controller.slice(
    controller.indexOf("rollback_from_state() {"),
    controller.indexOf("load_bound_release_state() {"),
  );
  const preMutation = rollback.slice(0, rollback.indexOf("if [[ $previous_generation == none ]]"));
  assert.match(rollback, /verify_pending_for_state/u);
  assert.match(rollback, /require_pointer_hash "\$current_pointer" "\$previous_pointer_hash"/u);
  assert.match(rollback, /previous_generation == v3/u);
  assert.match(rollback, /previous-current-v3-accepted\.json/u);
  assert.match(rollback, /candidate-runtime\.json|load_candidate_runtime_record/u);
  assert.match(rollback, /rollback-app\.env/u);
  assert.match(preMutation, /verify_recovery_runtime_for_state "\$state_file" \|\| return 1/u);
  assert.doesNotMatch(preMutation, /verify_current_runtime \|\| return 1/u);
  assert.match(preMutation, /elif \[\[ \$mode != pending \]\]; then/u);
  assert.match(preMutation, /current_app_container_id != "\$target_container"/u);
  assert.doesNotMatch(rollback, /EVO_RELEASE_APP_ENV_FILE/u);
  assert.doesNotMatch(rollback, /--env-file "\$EVO_RELEASE_APP_ENV_FILE"/u);
});
test("pending-only wrapper and controller hold one lock from authority check through rollback", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const wrapper = controller.slice(
    controller.indexOf("create_rollback_wrapper() {"),
    controller.indexOf("create_rollback_state() {"),
  );
  const pendingRollback = controller.slice(
    controller.indexOf("rollback_pending_candidate() {"),
    controller.indexOf('case "$command_name" in'),
  );

  assert.match(wrapper, /1\) \[\[ \$1 == pending-only \]\]/u);
  assert.match(wrapper, /rollback_command=rollback-pending/u);
  assert.match(wrapper, /0\) rollback_command=rollback/u);
  assert.ok(pendingRollback.indexOf("acquire_release_lock") < pendingRollback.indexOf("verify_pending_for_state"));
  assert.ok(pendingRollback.indexOf("verify_pending_for_state") < pendingRollback.indexOf("require_pointer_hash"));
  assert.ok(pendingRollback.indexOf("require_pointer_hash") < pendingRollback.indexOf("rollback_from_state"));
  assert.doesNotMatch(pendingRollback, /candidate_status/u);
  assert.match(controller, /rollback-pending\)/u);
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
    assert.match(runbook, /export EVO_SUPABASE_IDENTITY='selfhosted'/u);
    assert.match(runbook, /evo-fast-release\.sh rollback/u);
  }
});
test("workflow binds exact green main to one runner-built immutable release", () => {
  const workflow = readFileSync(".github/workflows/evo-fast-release.yml", "utf8");
  assert.match(workflow, /workflow_run:/u);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'workflow_dispatch'/u);
  assert.match(workflow, /EVO_PRODUCTION_RELEASE_ARMED/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /git\/ref\/heads\/main/u);
  assert.match(workflow, /EVO_RELEASE_WORKFLOW_SHA", env\.EVO_UPSTREAM_HEAD_SHA/u);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.event == 'push'|EVO_UPSTREAM_EVENT", "push"|ci\?\.event !== "push"/u);
  assert.doesNotMatch(workflow, /fast-release-ci-gate\.mjs/u);
  assert.equal((workflow.match(/check-runs\?filter=latest&per_page=100/gu) ?? []).length, 2);
  assert.equal((workflow.match(/run\?\.name === "Main CRM"/gu) ?? []).length, 2);
  assert.equal((workflow.match(/String\(run\?\.check_suite\?\.id\) === upstreamSuiteId/gu) ?? []).length, 2);
  assert.equal((workflow.match(/run\?\.app\?\.slug === "github-actions"/gu) ?? []).length, 2);
  assert.match(workflow, /fast-release-ledger-gate\.mjs/u);
  assert.match(
    workflow,
    /\[\[ -z "\$EVO_RELEASE_ROLLBACK_SEED" \|\| "\$EVO_RELEASE_ROLLBACK_SEED" =~/u,
  );
  assert.match(workflow, /docker build/u);
  assert.match(workflow, /docker save/u);
  assert.match(workflow, /StrictHostKeyChecking yes/u);
  assert.match(workflow, /evo-production-deploy-error\.log/u);
  assert.doesNotMatch(workflow, /cat [^\n]*evo-production-deploy-error\.log/u);
  assert.doesNotMatch(workflow, /path: [^\n]*evo-production-deploy-error\.log/u);
  assert.doesNotMatch(workflow, /Upload sanitized release evidence/u);
  assert.doesNotMatch(workflow, /ssh-keyscan/u);
  assert.doesNotMatch(workflow, /StrictHostKeyChecking no/u);
  assert.doesNotMatch(workflow, /git pull/u);
  assert.doesNotMatch(workflow, /EVO_REQUIRED_HEALTHY_CONTAINERS/u);
  assert.doesNotMatch(workflow, /^\s*environment:/mu);
  assert.doesNotMatch(workflow, /staging/iu);
});
test("active platform CI executes only the root successor product", () => {
  const workflow = readFileSync(".github/workflows/evo-platform-ci.yml", "utf8");
  const fastPr = readFileSync(".github/workflows/evo-fast-pr-checks.yml", "utf8");
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
  // The admission ref lookup is authenticated (anonymous shared-runner limit -> 403, #1342).
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(workflow, /Authorization: `Bearer \$\{env\.GITHUB_TOKEN\}`/u);
  assert.match(workflow, /^  crm:\n    name: Main CRM$/mu);
  assert.match(workflow, /^  crm:\n    name: Main CRM\n    needs: main_admission\n    runs-on: ubuntu-latest\n    timeout-minutes: 5$/mu);
  assert.match(workflow, /bash -n scripts\/release\/evo-fast-release\.sh/u);
  assert.match(workflow, /node --check scripts\/release\/evo-production-browser-smoke\.mjs/u);
  assert.match(workflow, /node --check scripts\/release\/fast-release-ledger-gate\.mjs/u);
  assert.match(workflow, /name: Check scoped release source contracts\n        run: >-\n          node --test/u);
  assert.match(workflow, /--test-name-pattern='\^\(CI and the exact-SHA gate require only the current root successor\|active platform CI executes only the root successor product\|workflow binds exact green main to one runner-built immutable release\)\$'/u);
  assert.match(workflow, /tests\/p6d-release-candidate\.test\.mjs\n          tests\/fast-release-control\.test\.mjs/u);
  assert.doesNotMatch(workflow, /crm_node_static|crm_browser|dependency_audit|test:ci:node|test:database:|npm run (?:lint|build|typecheck|test:security|test:unit)|npm (?:ci|install|audit)|playwright install|check-npm-audit-allowlist/u);
  assert.doesNotMatch(workflow, /continue-on-error|always\(\)|secrets\./u);
  assert.doesNotMatch(workflow, /^  (?:inbox|lead-agent):/mu);
  assert.doesNotMatch(workflow, /EVO Inbox|EVO Lead Agent/u);
  assert.doesNotMatch(workflow, /Prepare P8|refs\/pull\/179|6ee93bd/u);
  assert.doesNotMatch(workflow, /izzhacktcodex\/waha-integration/u);

  assert.match(fastPr, /^name: EVO fast PR checks$/mu);
  assert.match(fastPr, /^  pull_request:$/mu);
  assert.doesNotMatch(fastPr, /^\s+paths(?:-ignore)?:/mu);
  assert.doesNotMatch(fastPr, /^  push:|^  workflow_dispatch:/mu);
  assert.match(fastPr, /^  changed-range:\n    name: Changed range$/mu);
  assert.match(fastPr, /^  fast-checks:\n    name: Fast checks$/mu);
  assert.equal((`${workflow}\n${fastPr}`.match(/^    name: Changed range$/gmu) ?? []).length, 1);
  assert.equal((`${workflow}\n${fastPr}`.match(/^    name: Fast checks$/gmu) ?? []).length, 1);
  assert.match(fastPr, /git diff --check origin\/main\.\.\.HEAD/u);
  assert.match(fastPr, /node scripts\/checks\/classify-pr-changes\.mjs --base "\$format_base_sha" --head "\$format_head_sha" --github-output "\$GITHUB_OUTPUT"/u);
  for (const output of ["has_changes", "ordinary_docs", "contracts", "migration_boundary", "code", "lint", "build", "mobile", "unknown"]) {
    assert.match(fastPr, new RegExp(`${output}: \\$\\{\\{ steps\\.classify\\.outputs\\.${output} \\}\\}`, "u"));
  }
  assert.doesNotMatch(fastPr, /^  classification_guard:/mu);
  assert.match(fastPr, /^  fast-checks:[\s\S]*test "\$HAS_CHANGES" = "true"/mu);
  assert.match(fastPr, /^  fast-checks:[\s\S]*test "\$UNKNOWN" = "false"/mu);
  assert.match(fastPr, /^  contracts:\n    name: Release contracts$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.contracts == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /name: Test release contracts\n        run: npm run verify -- --only contracts/u);
  assert.match(fastPr, /^  lint:\n    name: Lint$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.lint == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /name: Lint\n        run: npm run verify -- --only lint/u);
  assert.match(fastPr, /^  build:\n    name: Build$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.build == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /name: Build with TypeScript authority\n        run: npm run verify -- --only build/u);
  assert.match(fastPr, /^  mobile:\n    name: Mobile app$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.mobile == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /working-directory: mobile\n        run: npm ci/u);
  assert.match(fastPr, /name: Check the mobile app\n        run: npm run verify -- --only mobile/u);
  assert.match(fastPr, /^  migration_boundary:\n    name: Migration boundary$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.migration_boundary == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /run: npm run test:database:migration-boundaries/u);
  assert.match(fastPr, /needs:\n      - changed-range\n      - typecheck\n      - tests\n      - preview\n      - contracts\n      - lint\n      - build\n      - mobile\n      - migration_boundary/u);
  // Fast and strict CI (PLAN_CHANGES 22.11.2026, superseding the light checks of #821): every change that is not
  // ordinary docs runs the types and the whole Node test manifest in four parts, all through the one command `npm run verify`.
  assert.match(fastPr, /^  typecheck:\n    name: Types\n    needs: changed-range\n    if: \$\{\{ needs\.changed-range\.outputs\.has_changes == 'true' && needs\.changed-range\.outputs\.ordinary_docs != 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}$/mu);
  assert.match(fastPr, /name: Check types\n        run: npm run verify -- --only typecheck/u);
  assert.match(fastPr, /^  tests:\n    name: Tests \(\$\{\{ matrix\.shard \}\}\/4\)\n    needs: changed-range\n    if: \$\{\{ needs\.changed-range\.outputs\.has_changes == 'true' && needs\.changed-range\.outputs\.ordinary_docs != 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}$/mu);
  assert.match(fastPr, /strategy:\n      fail-fast: false\n      matrix:\n        shard: \[1, 2, 3, 4\]/u);
  assert.match(fastPr, /run: npm run verify -- --only tests --shard \$\{\{ matrix\.shard \}\}\/4/u);
  assert.doesNotMatch(fastPr, /run: npm run (?:typecheck|lint|build|test:fast-release|test:ci:node)$/mu);
  // node_modules comes from a cache keyed by the lockfile and Node; only a miss runs `npm ci`.
  assert.equal((fastPr.match(/uses: actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6\.1\.0\n        with:\n          path: node_modules\n          key: node-modules-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('\.nvmrc', 'package-lock\.json'\) \}\}/gu) ?? []).length, 6);
  assert.equal((fastPr.match(/if: \$\{\{ steps\.deps\.outputs\.cache-hit != 'true' \}\}\n        run: npm ci/gu) ?? []).length, 6);
  assert.doesNotMatch(fastPr, /inbox_|lead_agent_/u);
  // Mobile is a separate product lane: only its two steps may leave the repository root.
  assert.deepEqual(fastPr.match(/working-directory: .*/gu), ["working-directory: mobile"]);
  // Inspect command invocations, not source paths such as supabase/migrations/.
  assert.doesNotMatch(fastPr, /(?:^|[\n;&|]|\brun:)\s*(?:(?:npx|pnpm\s+(?:exec|dlx)|yarn\s+(?:exec|dlx)|npm\s+exec(?:\s+--)?)\s+)?(?:playwright|supabase)(?:@[^\s/]+)?(?:\s|$)/imu);
  assert.doesNotMatch(fastPr, /(?:^|[\n;&|]|\brun:)\s*(?:npm|pnpm|yarn)\s+(?:run\s+)?test:(?:database:local|security|unit)(?:\b|:)/imu);
});
test("actual Fast checks shell requires every selected check to succeed or be skipped", () => {
  const workflow = readFileSync(".github/workflows/evo-fast-pr-checks.yml", "utf8");
  const gate = workflow.split("      - name: Require selected fast PR checks\n")[1];
  assert.ok(gate);
  const script = gate.split("        run: |\n")[1].replace(/^          /gmu, "");
  const env = {
    PATH: process.env.PATH,
    RANGE_RESULT: "success", HAS_CHANGES: "true", UNKNOWN: "false", ORDINARY_DOCS: "true",
    TYPECHECK_RESULT: "skipped", TESTS_RESULT: "skipped", PREVIEW_RESULT: "skipped",
    CONTRACTS_RESULT: "skipped", LINT_RESULT: "skipped", BUILD_RESULT: "skipped", MOBILE_RESULT: "skipped",
    MIGRATION_BOUNDARY_RESULT: "skipped",
  };
  const run = (changes) => spawnSync("bash", ["-c", script], { env: { ...env, ...changes }, encoding: "utf8" }).status;
  assert.equal(run({}), 0, "a docs-only change needs no code checks");
  assert.equal(run({ ORDINARY_DOCS: "false", TYPECHECK_RESULT: "success", TESTS_RESULT: "success", PREVIEW_RESULT: "success", CONTRACTS_RESULT: "success", LINT_RESULT: "success", BUILD_RESULT: "success", MOBILE_RESULT: "success", MIGRATION_BOUNDARY_RESULT: "success" }), 0);
  // Anything but ordinary docs (code, workflows, migrations, the mobile app) must really run the types and every test
  // part: skipped is not enough there.
  assert.notEqual(run({ ORDINARY_DOCS: "false", TESTS_RESULT: "success", PREVIEW_RESULT: "success" }), 0, "a non-docs change without types");
  assert.notEqual(run({ ORDINARY_DOCS: "false", TYPECHECK_RESULT: "success", PREVIEW_RESULT: "success" }), 0, "a non-docs change without tests");
  assert.notEqual(run({ ORDINARY_DOCS: "false", TYPECHECK_RESULT: "success", TESTS_RESULT: "success" }), 0, "a non-docs change without the preview");
  assert.equal(run({ ORDINARY_DOCS: "false", TYPECHECK_RESULT: "success", TESTS_RESULT: "success", PREVIEW_RESULT: "success" }), 0);
  for (const name of ["TYPECHECK_RESULT", "TESTS_RESULT", "PREVIEW_RESULT", "CONTRACTS_RESULT", "LINT_RESULT", "BUILD_RESULT", "MOBILE_RESULT", "MIGRATION_BOUNDARY_RESULT"]) {
    for (const result of ["failure", "cancelled", "", "unknown"]) {
      assert.notEqual(run({ [name]: result }), 0, `${name}=${result}`);
    }
  }
  assert.notEqual(run({ RANGE_RESULT: "failure" }), 0);
  assert.notEqual(run({ HAS_CHANGES: "false" }), 0);
  assert.notEqual(run({ UNKNOWN: "true" }), 0);
});
test("actual OrbStack container transports and verifies sealed runtime image identity", {
  skip: process.env.EVO_RUNTIME_IDENTITY_IMAGE === undefined,
}, (context) => {
  const requestedImage = process.env.EVO_RUNTIME_IDENTITY_IMAGE;
  assert.match(requestedImage, /^sha256:[a-f0-9]{64}$/u);
  const docker = (args) => {
    assert.equal(execFileSync("orb", ["status"], { encoding: "utf8" }).trim(), "Running");
    assert.equal(execFileSync("docker", ["context", "show"], { encoding: "utf8" }).trim(), "orbstack");
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 }).trim();
  };
  const [imageId, revision] = docker([
    "image", "inspect", "--format", '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}', requestedImage,
  ]).split(" ");
  assert.equal(imageId, requestedImage);
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const project = `evo-identity-${randomUUID().slice(0, 8)}`;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-identity-container-")));
  const source = join(root, "operator.env");
  const snapshot = join(root, "candidate-app.env");
  const compose = join(root, "compose.json");
  let cleanupVerified = false;
  try {
    writeFileSync(source, "SYNTHETIC_IDENTITY_PROOF=1\n", { mode: 0o600 });
    sealCandidateEnvironmentSnapshot(source, snapshot, imageId);
    writeFileSync(compose, JSON.stringify({ services: { app: {
      image: imageId, env_file: [snapshot], network_mode: "none", read_only: true,
      cap_drop: ["ALL"], pids_limit: 32, mem_limit: "128m",
      labels: { "evo.identity-proof": project },
      entrypoint: ["node"], command: ["-e", "setInterval(() => {}, 1000)"],
    } } }), { mode: 0o600 });
    docker(["compose", "--project-name", project, "--file", compose, "--env-file", snapshot,
      "up", "--detach", "--no-deps", "--no-build", "--pull", "never", "app"]);
    const container = docker(["ps", "-aq", "--filter", `label=evo.identity-proof=${project}`]);
    assert.match(container, /^[a-f0-9]{12,64}$/u);
    assert.equal(docker(["inspect", "--format", "{{.Image}}", container]), imageId);
    const environment = docker(["inspect", "--format", "{{json .Config.Env}}", container]);
    const args = ["scripts/release/evo-app-env-contract.mjs", "--verify-runtime-identity", "--snapshot", snapshot,
      "--runtime-image-id", imageId, "--release-revision", revision];
    const checked = spawnSync(process.execPath, args, { input: environment, encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(JSON.parse(checked.stdout), { ok: true });
    const processIdentity = JSON.parse(docker(["exec", container, "node", "-e",
      "console.log(JSON.stringify({imageId:process.env.EVO_RUNTIME_IMAGE_ID,revision:process.env.EVO_RELEASE_REVISION}))"]));
    assert.deepEqual(processIdentity, { imageId, revision });
    const rejected = spawnSync(process.execPath, [...args.slice(0, -1), "0".repeat(40)], {
      input: environment, encoding: "utf8",
    });
    assert.notEqual(rejected.status, 0);
    assert.doesNotMatch(rejected.stderr, /SYNTHETIC_IDENTITY_PROOF/u);
  } finally {
    const ids = docker(["ps", "-aq", "--filter", `label=evo.identity-proof=${project}`]).split("\n").filter(Boolean);
    for (const id of ids) {
      assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "evo.identity-proof"}}', id]), project);
      docker(["rm", "--force", id]);
    }
    assert.equal(docker(["ps", "-aq", "--filter", `label=evo.identity-proof=${project}`]), "");
    cleanupVerified = true;
    rmSync(root, { recursive: true, force: true });
    context.diagnostic(JSON.stringify({ imageId, revision, project, cleanupVerified,
      scope: "actual local env transport/readback; no app release or D4 receipt" }));
  }
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
