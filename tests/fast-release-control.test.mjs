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
const CLAMAV_IMAGE = "clamav/clamav@sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function createInterruptedReleaseFixture({ previousScannerPresent, killPoint }) {
  const root = mkdtempSync(join(tmpdir(), "evo-fast-interruption-"));
  const bin = join(root, "bin");
  const releaseRoot = join(root, "release");
  const transferRoot = join(root, "transfer");
  const evidenceRoot = join(root, "evidence");
  const archiveRoot = join(root, "archive");
  const statePath = join(root, "runtime-state.json");
  for (const directory of [bin, releaseRoot, transferRoot, evidenceRoot, archiveRoot]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const previousRevision = "1".repeat(40);
  const targetRevision = "2".repeat(40);
  const unrelatedRevision = "3".repeat(40);
  const previousVersion = "previous-v3";
  const targetVersion = "candidate-v3";
  const previousImage = `sha256:${"a".repeat(64)}`;
  const unrelatedImage = `sha256:${"c".repeat(64)}`;
  const runId = `interrupt-${previousScannerPresent ? "scanner" : "no-scanner"}-${killPoint}`;
  const releaseId = `release-${runId}`;
  const rollbackSeed = join(evidenceRoot, `seed-${runId}`, "state.json");
  const composeFile = join(releaseRoot, "docker-compose.yml");
  const environmentFile = join(releaseRoot, ".env.production");
  const environmentExample = join(releaseRoot, "env.production.example");
  const archive = join(transferRoot, "candidate.tar");
  const config = JSON.stringify({
    architecture: "amd64",
    config: {
      Labels: {
        "org.opencontainers.image.source": "https://github.com/izzhackt/evo_AI_CRM",
        "org.opencontainers.image.revision": targetRevision,
        "org.opencontainers.image.version": targetVersion,
      },
    },
    os: "linux",
  });
  const configDigest = hash(config);
  const targetImage = `sha256:${configDigest}`;
  const configPath = `${configDigest}.json`;
  const layerDirectory = "d".repeat(64);
  const layerPath = `${layerDirectory}/layer.tar`;
  mkdirSync(join(archiveRoot, layerDirectory), { mode: 0o700 });
  writeFileSync(join(archiveRoot, configPath), config);
  writeFileSync(join(archiveRoot, layerPath), "layer");
  writeFileSync(
    join(archiveRoot, "manifest.json"),
    JSON.stringify([{
      Config: configPath,
      Layers: [layerPath],
      RepoTags: [`evo-crm:${targetRevision}`],
    }]),
  );
  execFileSync("tar", ["-cf", archive, "-C", archiveRoot, "manifest.json", configPath, layerPath]);

  const compose = `services:
  app:
    image: "evo-crm:\${EVO_RELEASE_REVISION}"
    networks: [private]
  clamav:
    image: "${CLAMAV_IMAGE}"
    networks: [private]
  waha:
    image: "fixture/waha@\${EVO_WAHA_IMAGE_DIGEST}"
    networks: [private]
networks:
  private:
    name: fixture_private
`;
  writeFileSync(composeFile, compose, { mode: 0o600 });
  writeFileSync(environmentFile, "SAFE_FIXTURE=1\n", { mode: 0o600 });
  writeFileSync(environmentExample, "SAFE_FIXTURE=1\n", { mode: 0o600 });
  writeFileSync(statePath, JSON.stringify({
    app: "baseline",
    killed: false,
    rollbackTagPresent: false,
    scanner: previousScannerPresent,
    scannerHealthy: true,
    scannerImage: CLAMAV_IMAGE,
  }));

  const dockerPath = join(bin, "docker");
  writeExecutable(
    dockerPath,
    `#!${process.execPath}
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const statePath = process.env.FAKE_RUNTIME_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const previousImage = ${JSON.stringify(previousImage)};
const targetImage = ${JSON.stringify(targetImage)};
const unrelatedImage = ${JSON.stringify(unrelatedImage)};
const previousRevision = ${JSON.stringify(previousRevision)};
const targetRevision = ${JSON.stringify(targetRevision)};
const unrelatedRevision = ${JSON.stringify(unrelatedRevision)};
const previousVersion = ${JSON.stringify(previousVersion)};
const targetVersion = ${JSON.stringify(targetVersion)};
const scannerImage = ${JSON.stringify(CLAMAV_IMAGE)};
const wahaImage = "fixture/waha@" + process.env.EVO_WAHA_IMAGE_DIGEST;

function save() { writeFileSync(statePath, JSON.stringify(state)); }
function output(value) { if (value !== "") process.stdout.write(String(value) + "\\n"); }
function serviceIds() {
  return [state.app === null ? null : "app-id", state.scanner ? "clamav-id" : null, "waha-id"].filter(Boolean);
}
function serviceFor(id) {
  if (id === "app-id") return "app";
  if (id === "clamav-id") return "clamav";
  if (id === "waha-id") return "waha";
  process.exit(64);
}
function killController() {
  state.killed = true;
  save();
  process.kill(process.ppid, "SIGKILL");
  process.exit(0);
}

if (args[0] === "info") {
  output("8589934592");
} else if (args[0] === "ps") {
  const filter = args.find((value) => value.startsWith("label=com.docker.compose.service="));
  if (filter) {
    const service = filter.split("=").at(-1);
    if (service === "app" && state.app !== null) output("app-id");
    if (service === "clamav" && state.scanner) output("clamav-id");
    if (service === "waha") output("waha-id");
  } else {
    output(serviceIds().join("\\n"));
  }
} else if (args[0] === "inspect") {
  const format = args[2];
  const id = args[3];
  const service = serviceFor(id);
  if (format.includes("com.docker.compose.service")) output(service);
  else if (format.includes("State.Health")) {
    if (service === "app") output(state.app === "baseline" ? "healthy" : "unhealthy");
    else if (service === "clamav") output(state.scannerHealthy ? "healthy" : "unhealthy");
    else output("healthy");
  } else if (format.includes("RestartCount")) output(service === "app" && state.app !== "baseline" ? "1" : "0");
  else if (format.includes("org.opencontainers.image.revision")) {
    output(state.app === "baseline" ? previousRevision : state.app === "target" ? targetRevision : unrelatedRevision);
  } else if (format.includes("org.opencontainers.image.version")) {
    output(state.app === "baseline" ? previousVersion : state.app === "target" ? targetVersion : "unrelated-v3");
  } else if (format.includes("Config.Image")) {
    if (service === "clamav") output(state.scannerImage);
    else if (service === "waha") output(wahaImage);
    else output("evo-crm:" + (state.app === "baseline" ? previousRevision : targetRevision));
  } else if (format.includes("PortBindings")) output("{}");
  else if (format.includes("NetworkSettings.Networks")) output("fixture_private");
  else if (format.includes(".Image")) {
    output(state.app === "baseline" ? previousImage : state.app === "target" ? targetImage : unrelatedImage);
  } else process.exit(64);
} else if (args[0] === "image" && args[1] === "inspect") {
  const reference = args.at(-1);
  if (reference.startsWith("evo-crm:rollback-") && !state.rollbackTagPresent) process.exit(1);
  const formatIndex = args.indexOf("--format");
  if (formatIndex !== -1) {
    const format = args[formatIndex + 1];
    if (format.includes(".Id")) output(reference.startsWith("evo-crm:rollback-") ? previousImage : reference === scannerImage ? scannerImage : reference === previousImage ? previousImage : targetImage);
    else if (format.includes("org.opencontainers.image.source")) output("https://github.com/izzhackt/evo_AI_CRM");
    else if (format.includes("org.opencontainers.image.revision")) output(reference === previousImage ? previousRevision : targetRevision);
    else if (format.includes("org.opencontainers.image.version")) output(reference === previousImage ? previousVersion : targetVersion);
    else if (format.includes(".Os")) output("linux");
    else if (format.includes(".Architecture")) output("amd64");
    else process.exit(64);
  }
} else if (args[0] === "image" && args[1] === "load") {
  // The fixture archive is already bound to targetImage by the real controller.
} else if (args[0] === "tag") {
  state.rollbackTagPresent = true;
  save();
} else if (args[0] === "network" && args[1] === "inspect") {
  // The unique fixture network exists for the duration of the test.
} else if (args[0] === "compose") {
  const commandIndex = args.findIndex((value) => ["config", "pull", "up", "rm"].includes(value));
  const command = args[commandIndex];
  if (command === "config") {
    if (args.includes("--services")) output("app\\nclamav\\nwaha");
    else if (args.includes("--format")) {
      output(JSON.stringify({
        networks: { private: { name: "fixture_private" } },
        services: {
          app: { image: "evo-crm:" + process.env.EVO_RELEASE_REVISION, networks: { private: {} } },
          clamav: { image: scannerImage, networks: { private: {} } },
          waha: { image: wahaImage, networks: { private: {} } },
        },
      }));
    }
  } else if (command === "pull") {
    // The pinned scanner is present in the fixture image inventory.
  } else if (command === "up") {
    const service = args.at(-1);
    const rollbackApp = service === "app" && args.filter((value) => value === "--file").length === 2;
    if (service === "clamav") {
      state.scanner = true;
      state.scannerHealthy = true;
      state.scannerImage = scannerImage;
      save();
      if (!state.killed && process.env.FAKE_KILL_POINT === "after-scanner" && state.app === "baseline") killController();
      if (!state.killed && process.env.FAKE_KILL_POINT === "mid-rollback" && state.app === "target") killController();
    } else if (rollbackApp) {
      if (!state.killed && process.env.FAKE_KILL_POINT === "mid-rollback") {
        state.app = null;
        killController();
      }
      state.app = "baseline";
      save();
    } else if (service === "app") {
      state.app = "target";
      save();
      process.exit(1);
    }
  } else if (command === "rm") {
    const service = args.at(-1);
    if (service === "clamav") state.scanner = false;
    if (service === "app") state.app = null;
    save();
  }
} else {
  process.exit(64);
}
`,
  );

  writeExecutable(
    join(bin, "node"),
    `#!/usr/bin/env bash
if [[ \${1-} == *evo-app-env-contract.mjs ]]; then
  if [[ \${2-} == --seal-private-env && \${4-} == --snapshot ]]; then
    cp -- "$3" "$5"
    chmod 600 "$5"
    digest=$(sha256sum "$5" | awk '{print $1}')
    printf '{"ok":true,"sha256":"%s"}\\n' "$digest"
  fi
  exit 0
fi
exec ${JSON.stringify(process.execPath)} "$@"
`,
  );
  writeExecutable(join(bin, "curl"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n");

  const wahaDigest = `sha256:${"e".repeat(64)}`;
  const environment = {
    ...process.env,
    EVO_RELEASE_ACTIVE_COMPOSE_FILE: composeFile,
    EVO_RELEASE_APP_ENV_FILE: environmentFile,
    EVO_RELEASE_ARCHIVE: archive,
    EVO_RELEASE_ARCHIVE_SHA256: hash(readFileSync(archive)),
    EVO_RELEASE_ARTIFACT_DIGEST: `sha256:${"6".repeat(64)}`,
    EVO_RELEASE_ARTIFACT_ID: "3",
    EVO_RELEASE_COMPOSE_FILE: composeFile,
    EVO_RELEASE_DOCKER_STORAGE_PATH: root,
    EVO_RELEASE_ENV_EXAMPLE_FILE: environmentExample,
    EVO_RELEASE_EVIDENCE_ROOT: evidenceRoot,
    EVO_RELEASE_EXPECTED_COMPOSE_SHA256: hash(readFileSync(composeFile)),
    EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST: targetImage,
    EVO_RELEASE_EXPECTED_IMAGE_ID: targetImage,
    EVO_RELEASE_EXTERNAL_HEALTH_URL: "http://127.0.0.1:9/api/health",
    EVO_RELEASE_ID: releaseId,
    EVO_RELEASE_MIN_AVAILABLE_MEMORY_KB: "4194304",
    EVO_RELEASE_MIN_FREE_KB: "1048576",
    EVO_RELEASE_PROJECT_NAME: "fixture-release",
    EVO_RELEASE_REPOSITORY: "izzhackt/evo_AI_CRM",
    EVO_RELEASE_REVISION: targetRevision,
    EVO_RELEASE_ROOT: releaseRoot,
    EVO_RELEASE_ROLLBACK_SEED: rollbackSeed,
    EVO_RELEASE_RUN_ID: runId,
    EVO_RELEASE_SEED_IMAGE: previousImage,
    EVO_RELEASE_TRANSFER_ROOT: transferRoot,
    EVO_RELEASE_UPSTREAM_CI_RUN_ATTEMPT: "1",
    EVO_RELEASE_UPSTREAM_CI_RUN_ID: "2",
    EVO_RELEASE_VERSION: targetVersion,
    EVO_RELEASE_WORKFLOW_RUN_ATTEMPT: "1",
    EVO_RELEASE_WORKFLOW_RUN_ID: "1",
    EVO_SUPABASE_PROJECT_REF: "a".repeat(20),
    EVO_WAHA_IMAGE_DIGEST: wahaDigest,
    FAKE_KILL_POINT: killPoint,
    FAKE_RUNTIME_STATE: statePath,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  };
  const releaseStatePath = join(
    evidenceRoot,
    releaseId,
    "state.json",
  );
  return {
    environment,
    evidenceRoot,
    previousImage,
    previousRevision,
    previousScannerPresent,
    previousVersion,
    releaseStatePath,
    root,
    statePath,
    targetImage,
    targetRevision,
    targetVersion,
    unrelatedImage,
    unrelatedRevision,
  };
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
    schema: "evo-fast-release-state/v3",
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
      scannerPresent: false,
      scannerImage: "",
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
    "CLAMAV_PRESENT=1",
    "",
  ].join("\n"), { mode: 0o600 });

  const docker = join(bin, "docker");
  writeFileSync(docker, `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%q ' "$@" >> "$FAKE_DOCKER_LOG"
printf '\\n' >> "$FAKE_DOCKER_LOG"
source "$FAKE_DOCKER_STATE"
clamav_container=eeeeeeeeeeee
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
  elif [[ $service == clamav ]]; then
    [[ $CLAMAV_PRESENT == 1 ]] && printf '%s\\n' "$clamav_container"
  elif [[ $service == waha ]]; then
    printf '%s\\n' "$waha_container"
  else
    [[ $CLAMAV_PRESENT == 1 ]] && printf '%s\\n' "$clamav_container"
    [[ $APP_PRESENT == 1 ]] && printf '%s\\n' "$APP_CONTAINER"
    printf '%s\\n' "$waha_container"
  fi
elif [[ $1 == inspect ]]; then
  format=$3
  container=$4
  if [[ $container == "$clamav_container" ]]; then
    case "$format" in
      *com.docker.compose.service*) printf '%s\\n' clamav ;;
      *NetworkSettings.Networks*) printf '%s\\n' evo-private ;;
      *HostConfig.PortBindings*) printf '%s\\n' '{}' ;;
      *Config.Image*) printf '%s\\n' "$FAKE_CLAMAV_IMAGE" ;;
      *RestartCount*) printf '%s\\n' 0 ;;
      *State.Health*) printf '%s\\n' healthy ;;
      *) exit 1 ;;
    esac
  elif [[ $container == "$waha_container" ]]; then
    case "$format" in
      *com.docker.compose.service*) printf '%s\\n' waha ;;
      *NetworkSettings.Networks*) printf '%s\\n' evo-private ;;
      *HostConfig.PortBindings*) printf '%s\\n' '{}' ;;
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
      printf '%s\\n' app clamav waha
    elif [[ $arguments == *' --format json '* ]]; then
      printf '%s\\n' "$FAKE_COMPOSE_JSON"
    fi
  elif [[ $arguments == *' up '* && $arguments == *' clamav '* ]]; then
    sed -i.bak 's/^CLAMAV_PRESENT=.*/CLAMAV_PRESENT=1/' "$FAKE_DOCKER_STATE"
    rm -f "$FAKE_DOCKER_STATE.bak"
  elif [[ $arguments == *' up '* ]]; then
    printf '%s\\n' \\
      'APP_PRESENT=1' \\
      "APP_IMAGE=$FAKE_PREVIOUS_IMAGE" \\
      "APP_REVISION=$FAKE_PREVIOUS_REVISION" \\
      "APP_VERSION=$FAKE_PREVIOUS_VERSION" \\
      'APP_HEALTH=healthy' \\
      'APP_RESTARTS=0' \\
      'APP_CONTAINER=bbbbbbbbbbbb' \\
      "CLAMAV_PRESENT=$CLAMAV_PRESENT" > "$FAKE_DOCKER_STATE"
  elif [[ $arguments == *' rm '* && $arguments == *' clamav '* ]]; then
    sed -i.bak 's/^CLAMAV_PRESENT=.*/CLAMAV_PRESENT=0/' "$FAKE_DOCKER_STATE"
    rm -f "$FAKE_DOCKER_STATE.bak"
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
      clamav: { image: CLAMAV_IMAGE, networks: { private: {} } },
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
    FAKE_CLAMAV_IMAGE: CLAMAV_IMAGE,
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
    "CLAMAV_PRESENT=0",
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

test("manual recovery is state-bound and idempotent after no-EXIT interruptions", () => {
  const scenarios = [
    { killPoint: "after-scanner", previousScannerPresent: false, interruptedApp: "baseline" },
    { killPoint: "after-scanner", previousScannerPresent: true, interruptedApp: "baseline" },
    { killPoint: "mid-rollback", previousScannerPresent: false, interruptedApp: null },
    { killPoint: "mid-rollback", previousScannerPresent: true, interruptedApp: "target" },
  ];

  for (const scenario of scenarios) {
    const fixture = createInterruptedReleaseFixture(scenario);
    try {
      const sealed = spawnSync(
        "bash",
        ["scripts/evo-fast-release.sh", "seal-rollback-seed"],
        { encoding: "utf8", env: fixture.environment, timeout: 20_000 },
      );
      assert.equal(sealed.status, 0, `rollback seed failed: ${sealed.stderr}`);
      const interrupted = spawnSync(
        "bash",
        ["scripts/evo-fast-release.sh", "deploy"],
        { encoding: "utf8", env: fixture.environment, timeout: 20_000 },
      );
      assert.equal(
        interrupted.signal,
        "SIGKILL",
        `the ${scenario.killPoint}/${scenario.previousScannerPresent} fixture must bypass EXIT; status=${interrupted.status}; stderr=${interrupted.stderr}; stdout=${interrupted.stdout}`,
      );
      const interruptedRuntime = JSON.parse(readFileSync(fixture.statePath, "utf8"));
      assert.equal(interruptedRuntime.app, scenario.interruptedApp);
      assert.equal(interruptedRuntime.scanner, true);

      const releaseState = JSON.parse(readFileSync(fixture.releaseStatePath, "utf8"));
      assert.deepEqual(
        {
          previousImage: releaseState.previous.imageId,
          previousRevision: releaseState.previous.revision,
          previousScannerPresent: releaseState.previous.scannerPresent,
          previousVersion: releaseState.previous.version,
          schema: releaseState.schema,
          targetImage: releaseState.imageId,
          targetRevision: releaseState.revision,
          targetVersion: releaseState.version,
        },
        {
          previousImage: fixture.previousImage,
          previousRevision: fixture.previousRevision,
          previousScannerPresent: scenario.previousScannerPresent,
          previousVersion: fixture.previousVersion,
          schema: "evo-fast-release-state/v3",
          targetImage: fixture.targetImage,
          targetRevision: fixture.targetRevision,
          targetVersion: fixture.targetVersion,
        },
      );

      const recoveryEnvironment = {
        ...fixture.environment,
        EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID: releaseState.releaseId,
        EVO_RELEASE_ROLLBACK_STATE: fixture.releaseStatePath,
      };
      const recovery = spawnSync(
        "bash",
        ["scripts/evo-fast-release.sh", "rollback"],
        { encoding: "utf8", env: recoveryEnvironment, timeout: 20_000 },
      );
      assert.equal(recovery.status, 0, recovery.stderr);
      const recoveryResult = JSON.parse(recovery.stdout.trim());
      assert.deepEqual(
        { ok: recoveryResult.ok, command: recoveryResult.command, status: recoveryResult.status },
        { ok: true, command: "rollback", status: "rolled_back" },
      );
      const restoredRuntime = JSON.parse(readFileSync(fixture.statePath, "utf8"));
      assert.equal(restoredRuntime.app, "baseline");
      assert.equal(restoredRuntime.scanner, scenario.previousScannerPresent);

      if (scenario.killPoint === "after-scanner") {
        const repeated = spawnSync(
          "bash",
          ["scripts/evo-fast-release.sh", "rollback"],
          { encoding: "utf8", env: recoveryEnvironment, timeout: 20_000 },
        );
        assert.equal(repeated.status, 0, repeated.stderr);
        assert.equal(JSON.parse(repeated.stdout.trim()).status, "rolled_back");
      }

      if (scenario.killPoint === "after-scanner" && !scenario.previousScannerPresent) {
        writeFileSync(fixture.statePath, JSON.stringify({
          ...restoredRuntime,
          app: "unrelated",
        }));
        const unrelatedApp = spawnSync(
          "bash",
          ["scripts/evo-fast-release.sh", "rollback"],
          { encoding: "utf8", env: recoveryEnvironment, timeout: 20_000 },
        );
        assert.equal(unrelatedApp.status, 2);
        assert.match(unrelatedApp.stderr, /rollback_failed/u);

        writeFileSync(fixture.statePath, JSON.stringify({
          ...restoredRuntime,
          scanner: true,
          scannerImage: `unrelated/scanner@sha256:${"f".repeat(64)}`,
        }));
        const unrelatedScanner = spawnSync(
          "bash",
          ["scripts/evo-fast-release.sh", "rollback"],
          { encoding: "utf8", env: recoveryEnvironment, timeout: 20_000 },
        );
        assert.equal(unrelatedScanner.status, 2);
        assert.match(unrelatedScanner.stderr, /rollback_(?:failed|scanner_mismatch)/u);

        const draftV2State = { ...releaseState, schema: "evo-fast-release-state/v2" };
        writeFileSync(fixture.releaseStatePath, JSON.stringify(draftV2State), { mode: 0o600 });
        const rejectedDraft = spawnSync(
          "bash",
          ["scripts/evo-fast-release.sh", "rollback"],
          { encoding: "utf8", env: recoveryEnvironment, timeout: 20_000 },
        );
        assert.equal(rejectedDraft.status, 2);
        assert.match(rejectedDraft.stderr, /rollback_state_contract_invalid/u);
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
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
      ["scripts/evo-fast-release.sh", "status"],
      { encoding: "utf8", env: environment },
    ));
    assert.deepEqual(
      { ok: result.ok, health: result.health, revision: result.revision, scanner: result.scanner },
      { ok: true, health: "healthy", revision: REVISION, scanner: "healthy" },
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
  assert.match(preMutation, /verify_recovery_runtime_for_state "\$state_file" \|\| return 1/u);
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
  assert.match(workflow, /github\.event\.workflow_run\.event == 'workflow_dispatch'/u);
  assert.match(workflow, /EVO_PRODUCTION_RELEASE_ARMED/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /git\/ref\/heads\/main/u);
  assert.match(workflow, /EVO_RELEASE_WORKFLOW_SHA", env\.EVO_UPSTREAM_HEAD_SHA/u);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.event == 'push'|EVO_UPSTREAM_EVENT", "push"|ci\?\.event !== "push"/u);
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
  const fastPr = readFileSync(".github/workflows/evo-fast-pr-checks.yml", "utf8");
  const auditAllowlist = readFileSync("scripts/check-npm-audit-allowlist.mjs", "utf8");
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
  assert.match(workflow, /^  crm:\n    name: Main CRM$/mu);
  assert.match(workflow, /^  crm_node_static:\n    name: Main CRM Node\/static$/mu);
  assert.match(workflow, /^  crm_browser:\n    name: Main CRM database\/browser proof$/mu);
  assert.equal((workflow.match(/run: npm run test:ci:node/gu) ?? []).length, 1);
  assert.match(workflow, /run: npm run lint/u);
  assert.match(workflow, /run: npm run build/u);
  assert.doesNotMatch(workflow, /run: npm run typecheck|run: npm run test:security|run: npm run test:unit/u);
  assert.match(workflow, /node_modules\/\.bin\/playwright install --with-deps --only-shell chromium/u);
  assert.equal((workflow.match(/node_modules\/\.bin\/playwright install --with-deps --only-shell chromium/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /node_modules\/\.bin\/playwright install --with-deps chromium/u);
  assert.doesNotMatch(workflow, /test:database:migration-boundaries|v3-managed-supabase-recovery-harness/u);
  assert.match(workflow, /^  dependency_audit:\n    name: Dependency audit$/mu);
  assert.match(workflow, /needs:\n      - main_admission\n      - crm_node_static\n      - crm_browser\n      - dependency_audit/u);
  assert.match(workflow, /ADMISSION_RESULT: \$\{\{ needs\.main_admission\.result \}\}/u);
  assert.match(workflow, /test "\$ADMISSION_RESULT" = "success"/u);
  assert.match(workflow, /NODE_STATIC_RESULT: \$\{\{ needs\.crm_node_static\.result \}\}/u);
  assert.match(workflow, /BROWSER_RESULT: \$\{\{ needs\.crm_browser\.result \}\}/u);
  assert.match(workflow, /AUDIT_RESULT: \$\{\{ needs\.dependency_audit\.result \}\}/u);
  assert.match(workflow, /test "\$NODE_STATIC_RESULT" = "success"/u);
  assert.match(workflow, /test "\$BROWSER_RESULT" = "success"/u);
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

  assert.match(fastPr, /^name: EVO fast PR checks$/mu);
  assert.match(fastPr, /^  pull_request:$/mu);
  assert.doesNotMatch(fastPr, /^\s+paths(?:-ignore)?:/mu);
  assert.doesNotMatch(fastPr, /^  push:|^  workflow_dispatch:/mu);
  assert.match(fastPr, /^  changed-range:\n    name: Changed range$/mu);
  assert.match(fastPr, /^  fast-checks:\n    name: Fast checks$/mu);
  assert.equal((`${workflow}\n${fastPr}`.match(/^    name: Changed range$/gmu) ?? []).length, 1);
  assert.equal((`${workflow}\n${fastPr}`.match(/^    name: Fast checks$/gmu) ?? []).length, 1);
  assert.match(fastPr, /git diff --check origin\/main\.\.\.HEAD/u);
  assert.match(fastPr, /node scripts\/classify-pr-changes\.mjs --base "\$BASE_SHA" --head "\$HEAD_SHA" --github-output "\$GITHUB_OUTPUT"/u);
  for (const output of ["has_changes", "ordinary_docs", "contracts", "migration_boundary", "code", "lint", "build", "unknown"]) {
    assert.match(fastPr, new RegExp(`${output}: \\$\\{\\{ steps\\.classify\\.outputs\\.${output} \\}\\}`, "u"));
  }
  assert.doesNotMatch(fastPr, /^  classification_guard:/mu);
  assert.match(fastPr, /^  fast-checks:[\s\S]*test "\$HAS_CHANGES" = "true"/mu);
  assert.match(fastPr, /^  fast-checks:[\s\S]*test "\$UNKNOWN" = "false"/mu);
  assert.match(fastPr, /^  contracts:\n    name: Release contracts$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.contracts == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /run: npm run test:fast-release/u);
  assert.match(fastPr, /^  lint:\n    name: Lint$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.lint == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /run: npm run lint/u);
  assert.match(fastPr, /^  build:\n    name: Build$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.build == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /run: npm run build/u);
  assert.match(fastPr, /^  migration_boundary:\n    name: Migration boundary$/mu);
  assert.match(fastPr, /if: \$\{\{ needs\.changed-range\.outputs\.migration_boundary == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u);
  assert.match(fastPr, /run: npm run test:database:migration-boundaries/u);
  assert.match(fastPr, /needs:\n      - changed-range\n      - contracts\n      - lint\n      - build\n      - migration_boundary/u);
  assert.doesNotMatch(fastPr, /^  typecheck:\n    name: Standalone typecheck$/mu);
  assert.doesNotMatch(fastPr, /outputs\.typecheck|TYPECHECK/u);
  assert.doesNotMatch(fastPr, /run: npm run typecheck/u);
  assert.doesNotMatch(fastPr, /test:database:local|test:security|test:unit|playwright|supabase/iu);
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
