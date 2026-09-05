import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rollbackFixture({ appPresent, appHealth }) {
  const root = mkdtempSync(join(tmpdir(), "evo-fast-rollback-"));
  const bin = join(root, "bin");
  const releaseRoot = join(root, "release");
  const transferRoot = join(root, "transfer");
  const evidenceRoot = join(root, "evidence");
  const releaseId = "v3-test-release";
  const evidenceDir = join(evidenceRoot, releaseId);
  for (const directory of [bin, releaseRoot, transferRoot, evidenceRoot, evidenceDir]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const targetImage = `sha256:${"a".repeat(64)}`;
  const previousImage = `sha256:${"b".repeat(64)}`;
  const previousRevision = "c".repeat(40);
  const targetVersion = "v3-test";
  const previousVersion = "v2-test";
  const wahaDigest = `sha256:${"d".repeat(64)}`;
  const wahaImage = `devlikeapro/waha@${wahaDigest}`;
  const candidateCompose = JSON.stringify({ candidate: true });
  const previousCompose = JSON.stringify({ previous: true });
  const candidateEnv = "NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\n";
  const previousEnv = "NEXT_PUBLIC_SUPABASE_URL=https://previous.supabase.co\n";
  const candidateComposePath = join(evidenceDir, "docker-compose.candidate.yml");
  const previousComposePath = join(evidenceDir, "docker-compose.previous.yml");
  const candidateEnvPath = join(evidenceDir, "candidate-app.env");
  const previousEnvPath = join(evidenceDir, "rollback-app.env");
  for (const [path, contents] of [
    [candidateComposePath, candidateCompose],
    [previousComposePath, previousCompose],
    [candidateEnvPath, candidateEnv],
    [previousEnvPath, previousEnv],
  ]) {
    writeFileSync(path, contents, { mode: 0o600 });
    chmodSync(path, 0o600);
  }

  const state = {
    schema: "evo-fast-release-state/v2",
    generation: "v3",
    repository: "izzhackt/evo_AI_CRM",
    releaseId,
    releaseRunId: "release-1-1",
    workflowRunId: "1",
    workflowRunAttempt: "1",
    upstreamCiRunId: "2",
    upstreamCiRunAttempt: "1",
    artifactId: "3",
    artifactDigest: `sha256:${"e".repeat(64)}`,
    revision: REVISION,
    version: targetVersion,
    imageId: targetImage,
    imageConfigDigest: targetImage,
    imageSource: "https://github.com/izzhackt/evo_AI_CRM",
    archiveSha256: "f".repeat(64),
    composeSnapshot: "docker-compose.candidate.yml",
    composeSha256: sha256(candidateCompose),
    appEnvSnapshot: "candidate-app.env",
    appEnvSha256: sha256(candidateEnv),
    controllerSha256: "1".repeat(64),
    rollbackWrapperSha256: "2".repeat(64),
    rollbackTag: "evo-crm:rollback-v1-test",
    previous: {
      generation: "v1",
      releaseId: "v1-test",
      appPresent: true,
      imageId: previousImage,
      revision: previousRevision,
      version: previousVersion,
      composeSnapshot: "docker-compose.previous.yml",
      composeSha256: sha256(previousCompose),
      appEnvSnapshot: "rollback-app.env",
      appEnvSha256: sha256(previousEnv),
      acceptedPointerSnapshot: "",
      acceptedPointerSha256: "absent",
    },
  };
  const statePath = join(evidenceDir, "state.json");
  const stateText = JSON.stringify(state);
  writeFileSync(statePath, stateText, { mode: 0o600 });
  chmodSync(statePath, 0o600);
  const pending = {
    schema: "evo-v3-pending-current/v1",
    generation: "v3",
    releaseId,
    repository: state.repository,
    revision: REVISION,
    workflowRunId: state.workflowRunId,
    workflowRunAttempt: state.workflowRunAttempt,
    artifactId: state.artifactId,
    artifactDigest: state.artifactDigest,
    stateSha256: sha256(stateText),
  };
  const pendingPath = join(evidenceRoot, "pending-current.json");
  writeFileSync(pendingPath, JSON.stringify(pending), { mode: 0o600 });
  chmodSync(pendingPath, 0o600);

  const candidateContainer = "a".repeat(12);
  if (appPresent) {
    const runtime = {
      schema: "evo-v3-candidate-runtime/v1",
      releaseId,
      revision: REVISION,
      imageId: targetImage,
      candidateContainerId: candidateContainer,
      stateSha256: sha256(stateText),
    };
    const runtimePath = join(evidenceDir, "candidate-runtime.json");
    writeFileSync(runtimePath, JSON.stringify(runtime), { mode: 0o600 });
    chmodSync(runtimePath, 0o600);
  }

  const dockerState = join(root, "docker-state");
  writeFileSync(dockerState, [
    `APP_PRESENT=${appPresent ? "1" : "0"}`,
    `APP_IMAGE=${targetImage}`,
    `APP_REVISION=${REVISION}`,
    `APP_VERSION=${targetVersion}`,
    `APP_HEALTH=${appHealth}`,
    `APP_RESTARTS=${appHealth === "healthy" ? "0" : "7"}`,
    `APP_CONTAINER=${candidateContainer}`,
    "",
  ].join("\n"), { mode: 0o600 });

  const docker = join(bin, "docker");
  writeFileSync(docker, `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%q ' "$@" >> "$FAKE_DOCKER_LOG"
printf '\\n' >> "$FAKE_DOCKER_LOG"
source "$FAKE_DOCKER_STATE"
waha_container=${"d".repeat(12)}
if [[ $1 == ps ]]; then
  service=''
  for argument in "$@"; do
    case "$argument" in
      label=com.docker.compose.service=*) service=\${argument##*=} ;;
    esac
  done
  if [[ $service == app ]]; then
    [[ $APP_PRESENT == 1 ]] && printf '%s\\n' "$APP_CONTAINER"
  elif [[ $service == waha ]]; then
    printf '%s\\n' "$waha_container"
  else
    [[ $APP_PRESENT == 1 ]] && printf '%s\\n' "$APP_CONTAINER"
    printf '%s\\n' "$waha_container"
  fi
elif [[ $1 == inspect ]]; then
  format=$3
  container=$4
  if [[ $container == "$waha_container" ]]; then
    case "$format" in
      *com.docker.compose.service*) printf '%s\\n' waha ;;
      *NetworkSettings.Networks*) printf '%s\\n' evo-private ;;
      *Config.Image*) printf '%s\\n' "$FAKE_WAHA_IMAGE" ;;
      *RestartCount*) printf '%s\\n' 0 ;;
      *State.Health*) printf '%s\\n' healthy ;;
      *) exit 1 ;;
    esac
  else
    case "$format" in
      *com.docker.compose.service*) printf '%s\\n' app ;;
      *NetworkSettings.Networks*) printf '%s\\n' evo-private ;;
      *RestartCount*) printf '%s\\n' "$APP_RESTARTS" ;;
      *State.Health*) printf '%s\\n' "$APP_HEALTH" ;;
      *org.opencontainers.image.revision*) printf '%s\\n' "$APP_REVISION" ;;
      *org.opencontainers.image.version*) printf '%s\\n' "$APP_VERSION" ;;
      '{{.Image}}') printf '%s\\n' "$APP_IMAGE" ;;
      *) exit 1 ;;
    esac
  fi
elif [[ $1 == image && $2 == inspect ]]; then
  [[ $4 == '{{.Id}}' ]] && printf '%s\\n' "$FAKE_PREVIOUS_IMAGE"
elif [[ $1 == network && $2 == inspect ]]; then
  exit 0
elif [[ $1 == compose ]]; then
  arguments=" $* "
  if [[ $arguments == *' config '* ]]; then
    if [[ $arguments == *' --services '* ]]; then
      printf '%s\\n' app waha
    elif [[ $arguments == *' --format json '* ]]; then
      printf '%s\\n' "$FAKE_COMPOSE_JSON"
    fi
  elif [[ $arguments == *' up '* ]]; then
    printf '%s\\n' \\
      'APP_PRESENT=1' \\
      "APP_IMAGE=$FAKE_PREVIOUS_IMAGE" \\
      "APP_REVISION=$FAKE_PREVIOUS_REVISION" \\
      "APP_VERSION=$FAKE_PREVIOUS_VERSION" \\
      'APP_HEALTH=healthy' \\
      'APP_RESTARTS=0' \\
      'APP_CONTAINER=bbbbbbbbbbbb' > "$FAKE_DOCKER_STATE"
  else
    exit 1
  fi
else
  exit 1
fi
`, { mode: 0o700 });
  chmodSync(docker, 0o700);
  for (const command of ["curl", "flock"]) {
    const path = join(bin, command);
    writeFileSync(path, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o700 });
    chmodSync(path, 0o700);
  }
  const liveEnv = join(root, "live.env");
  const dockerLog = join(root, "docker.log");
  writeFileSync(dockerLog, "", { mode: 0o600 });
  writeFileSync(liveEnv, candidateEnv, { mode: 0o600 });
  const composeJson = JSON.stringify({
    services: {
      app: { image: "unused", networks: { private: {} } },
      waha: { image: wahaImage, networks: { private: {} } },
    },
    networks: { private: { name: "evo-private" } },
  });
  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_DOCKER_STATE: dockerState,
    FAKE_DOCKER_LOG: dockerLog,
    FAKE_WAHA_IMAGE: wahaImage,
    FAKE_PREVIOUS_IMAGE: previousImage,
    FAKE_PREVIOUS_REVISION: previousRevision,
    FAKE_PREVIOUS_VERSION: previousVersion,
    FAKE_COMPOSE_JSON: composeJson,
    EVO_RELEASE_ROOT: releaseRoot,
    EVO_RELEASE_PROJECT_NAME: "evo-crm",
    EVO_RELEASE_TRANSFER_ROOT: transferRoot,
    EVO_RELEASE_EVIDENCE_ROOT: evidenceRoot,
    EVO_RELEASE_COMPOSE_FILE: candidateComposePath,
    EVO_RELEASE_APP_ENV_FILE: liveEnv,
    EVO_RELEASE_EXTERNAL_HEALTH_URL: "https://crm.example.test/api/health",
    EVO_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    EVO_WAHA_IMAGE_DIGEST: wahaDigest,
    EVO_RELEASE_ROLLBACK_STATE: statePath,
    EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID: releaseId,
  };
  return {
    dockerLog,
    dockerState,
    environment,
    evidenceDir,
    evidenceRoot,
    pendingPath,
    previousImage,
    releaseId,
    root,
  };
}

function acceptedV3RollbackRetryFixture() {
  const fixture = rollbackFixture({ appPresent: true, appHealth: "healthy" });
  const statePath = fixture.environment.EVO_RELEASE_ROLLBACK_STATE;
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const previousPointer = {
    schema: "evo-v3-current-accepted/v1",
    generation: "v3",
    releaseId: "previous-v3-release",
    revision: state.previous.revision,
    acceptanceRecord: "previous-v3-release/v3-acceptance-record.json",
    acceptanceRecordSha256: "3".repeat(64),
  };
  const previousPointerText = JSON.stringify(previousPointer);
  const previousPointerPath = join(fixture.evidenceDir, "previous-current-v3-accepted.json");
  writeFileSync(previousPointerPath, previousPointerText, { mode: 0o600 });
  chmodSync(previousPointerPath, 0o600);
  state.previous.generation = "v3";
  state.previous.releaseId = previousPointer.releaseId;
  state.previous.acceptedPointerSnapshot = "previous-current-v3-accepted.json";
  state.previous.acceptedPointerSha256 = sha256(previousPointerText);
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  chmodSync(statePath, 0o600);
  rmSync(join(fixture.evidenceDir, "candidate-runtime.json"), { force: true });
  rmSync(fixture.pendingPath, { force: true });

  const acceptanceRecordText = JSON.stringify({ imageId: state.imageId });
  const acceptanceRecordPath = join(fixture.evidenceDir, "v3-acceptance-record.json");
  writeFileSync(acceptanceRecordPath, acceptanceRecordText, { mode: 0o600 });
  chmodSync(acceptanceRecordPath, 0o600);
  const currentPointerPath = join(fixture.evidenceRoot, "current-v3-accepted.json");
  writeFileSync(currentPointerPath, JSON.stringify({
    schema: "evo-v3-current-accepted/v1",
    generation: "v3",
    releaseId: fixture.releaseId,
    revision: state.revision,
    acceptanceRecord: `${fixture.releaseId}/v3-acceptance-record.json`,
    acceptanceRecordSha256: sha256(acceptanceRecordText),
  }), { mode: 0o600 });
  chmodSync(currentPointerPath, 0o600);
  writeFileSync(fixture.dockerState, [
    "APP_PRESENT=1",
    `APP_IMAGE=${state.previous.imageId}`,
    `APP_REVISION=${state.previous.revision}`,
    `APP_VERSION=${state.previous.version}`,
    "APP_HEALTH=healthy",
    "APP_RESTARTS=0",
    "APP_CONTAINER=bbbbbbbbbbbb",
    "",
  ].join("\n"), { mode: 0o600 });
  return { ...fixture, currentPointerPath, previousPointer };
}

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
  const preflightChecks = controller.slice(
    controller.indexOf("run_preflight_checks() {"),
    controller.indexOf("require_release_runtime_commands() {"),
  );
  const deploy = controller.slice(
    controller.indexOf("deploy() {"),
    controller.indexOf("manual_rollback() {"),
  );
  const rollback = controller.slice(
    controller.indexOf("rollback_from_state() {"),
    controller.indexOf("load_bound_release_state() {"),
  );
  execFileSync("bash", ["-n", "scripts/evo-fast-release.sh"]);
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
  assert.match(controller, /evo-release-rollback-seed\/v2/u);
  assert.match(controller, /EVO_RELEASE_ROLLBACK_SEED/u);
  assert.match(controller, /rollback_seed_env_drift/u);
  assert.match(controller, /docker-compose\.previous\.yml/u);
  assert.match(controller, /appEnvSha256/u);
  assert.match(controller, /current_app_container_id/u);
  assert.match(controller, /services == waha \|\| \$services == \$'app\\nwaha'/u);
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
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
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
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
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
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
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
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
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
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
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
      ["scripts/evo-fast-release.sh", "rollback-pending"],
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
        ["scripts/evo-fast-release.sh", "rollback-pending"],
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
      ["scripts/evo-fast-release.sh", "rollback"],
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
      ["scripts/evo-fast-release.sh", "rollback"],
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
      ["scripts/evo-fast-release.sh", "rollback"],
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
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
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
  assert.match(preMutation, /verify_current_runtime_identity \|\| return 1/u);
  assert.match(preMutation, /verify_runtime_waha_image \|\| return 1/u);
  assert.match(preMutation, /verify_networks \|\| return 1/u);
  assert.doesNotMatch(preMutation, /verify_current_runtime \|\| return 1/u);
  assert.match(preMutation, /elif \[\[ \$mode != pending \]\]; then/u);
  assert.match(preMutation, /current_app_container_id != "\$target_container"/u);
  assert.doesNotMatch(rollback, /EVO_RELEASE_APP_ENV_FILE/u);
  assert.doesNotMatch(rollback, /--env-file "\$EVO_RELEASE_APP_ENV_FILE"/u);
});

test("pending-only wrapper and controller hold one lock from authority check through rollback", () => {
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
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
    assert.match(runbook, /export EVO_SUPABASE_PROJECT_REF='<20-character-project-ref>'/u);
    assert.match(runbook, /evo-fast-release\.sh rollback/u);
  }
});

test("workflow binds exact green main to one runner-built immutable release", () => {
  const workflow = readFileSync(".github/workflows/evo-fast-release.yml", "utf8");
  assert.match(workflow, /workflow_run:/u);
  assert.match(workflow, /EVO_PRODUCTION_RELEASE_ARMED/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /git\/ref\/heads\/main/u);
  assert.match(workflow, /EVO_RELEASE_WORKFLOW_SHA", env\.EVO_UPSTREAM_HEAD_SHA/u);
  assert.doesNotMatch(workflow, /fast-release-ci-gate\.mjs/u);
  assert.equal((workflow.match(/check-runs\?filter=latest&per_page=100/gu) ?? []).length, 2);
  assert.equal((workflow.match(/run\?\.name === "Main CRM"/gu) ?? []).length, 2);
  assert.equal((workflow.match(/run\?\.app\?\.slug === "github-actions"/gu) ?? []).length, 2);
  assert.match(workflow, /fast-release-ledger-gate\.mjs/u);
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
