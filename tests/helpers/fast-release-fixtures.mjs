// Fixtures shared by the release-controller tests (tests/fast-release-*.test.mjs).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAST_RELEASE_REQUIRED_CHECKS } from "../../scripts/release/fast-release-ci-gate.mjs";

export const REVISION = "90ab8b1b0c1dd6a92c931e9793c052f984f19fc4";
export const CLAMAV_IMAGE = "clamav/clamav@sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9";
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
export function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
export function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}
export function createInterruptedReleaseFixture({ previousScannerPresent, killPoint }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-fast-interruption-")));
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
  } else if (format.includes("Config.Env")) {
    output(JSON.stringify(state.app === "baseline"
      ? ["EVO_RELEASE_REVISION=" + previousRevision]
      : ["EVO_RELEASE_REVISION=" + targetRevision, "EVO_RUNTIME_IMAGE_ID=" + targetImage]));
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
} else if (args[0] === "compose" && args[1] === "version") {
  output("5.1.2");
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
if [[ \${1-} == *evo-app-env-contract.mjs && \${2-} == --example ]]; then
  # Provider validation is outside this interrupted-controller fixture;
  # snapshot sealing and runtime identity use the actual Node implementation.
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
    EVO_SUPABASE_IDENTITY: "selfhosted",
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
export function rollbackFixture({ appPresent, appHealth, previousIdentity = false }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-fast-rollback-")));
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
  const candidateEnv = `NEXT_PUBLIC_SUPABASE_URL=https://supabase.evoadmissions.com\nEVO_RUNTIME_IMAGE_ID=${targetImage}\n`;
  const previousEnv = `NEXT_PUBLIC_SUPABASE_URL=https://previous.supabase.evoadmissions.com\n${previousIdentity ? `EVO_RUNTIME_IMAGE_ID=${previousImage}\n` : ""}`;
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
      *Config.Env*)
        if [[ -n \${FAKE_APP_ENV_JSON-} ]]; then
          printf '%s\\n' "$FAKE_APP_ENV_JSON"
        elif [[ $APP_IMAGE == "$FAKE_PREVIOUS_IMAGE" && $FAKE_PREVIOUS_IDENTITY != 1 ]]; then
          jq -cn --arg revision "$APP_REVISION" '["EVO_RELEASE_REVISION=" + $revision]'
        else
          jq -cn --arg revision "$APP_REVISION" --arg image "$APP_IMAGE" \\
            '["EVO_RELEASE_REVISION=" + $revision, "EVO_RUNTIME_IMAGE_ID=" + $image]'
        fi ;;
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
    FAKE_PREVIOUS_IDENTITY: previousIdentity ? "1" : "0",
    FAKE_COMPOSE_JSON: composeJson,
    EVO_RELEASE_ROOT: releaseRoot,
    EVO_RELEASE_PROJECT_NAME: "evo-crm",
    EVO_RELEASE_TRANSFER_ROOT: transferRoot,
    EVO_RELEASE_EVIDENCE_ROOT: evidenceRoot,
    EVO_RELEASE_COMPOSE_FILE: candidateComposePath,
    EVO_RELEASE_APP_ENV_FILE: liveEnv,
    EVO_RELEASE_EXTERNAL_HEALTH_URL: "https://crm.evoadmissions.com/api/health",
    EVO_SUPABASE_IDENTITY: "selfhosted",
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
export function candidateIdentityFixture() {
  const fixture = rollbackFixture({ appPresent: true, appHealth: "healthy" });
  const statePath = fixture.environment.EVO_RELEASE_ROLLBACK_STATE;
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const controllerDir = join(fixture.evidenceDir, "controller");
  mkdirSync(controllerDir, { mode: 0o700 });
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const wrapper = "#!/bin/sh\nexit 1\n";
  writeFileSync(join(controllerDir, "evo-fast-release.sh"), controller, { mode: 0o700 });
  writeFileSync(join(fixture.evidenceDir, "rollback-command.sh"), wrapper, { mode: 0o700 });
  state.controllerSha256 = sha256(controller);
  state.rollbackWrapperSha256 = sha256(wrapper);
  const stateText = JSON.stringify(state);
  writeFileSync(statePath, stateText);
  for (const path of [fixture.pendingPath, join(fixture.evidenceDir, "candidate-runtime.json")]) {
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    receipt.stateSha256 = sha256(stateText);
    writeFileSync(path, JSON.stringify(receipt));
  }
  const archive = join(fixture.environment.EVO_RELEASE_TRANSFER_ROOT, "candidate.tar");
  writeFileSync(archive, "control-flow fixture; archive verifier has separate tests\n");
  Object.assign(fixture.environment, {
    EVO_RELEASE_REVISION: state.revision, EVO_RELEASE_VERSION: state.version,
    EVO_RELEASE_ID: state.releaseId, EVO_RELEASE_REPOSITORY: state.repository,
    EVO_RELEASE_RUN_ID: state.releaseRunId, EVO_RELEASE_WORKFLOW_RUN_ID: state.workflowRunId,
    EVO_RELEASE_WORKFLOW_RUN_ATTEMPT: state.workflowRunAttempt,
    EVO_RELEASE_UPSTREAM_CI_RUN_ID: state.upstreamCiRunId,
    EVO_RELEASE_UPSTREAM_CI_RUN_ATTEMPT: state.upstreamCiRunAttempt,
    EVO_RELEASE_ARTIFACT_ID: state.artifactId, EVO_RELEASE_ARTIFACT_DIGEST: state.artifactDigest,
    EVO_RELEASE_ARCHIVE: archive, EVO_RELEASE_ARCHIVE_SHA256: state.archiveSha256,
    EVO_RELEASE_EXPECTED_IMAGE_ID: state.imageId,
    EVO_RELEASE_EXPECTED_IMAGE_CONFIG_DIGEST: state.imageConfigDigest,
    EVO_RELEASE_EXPECTED_COMPOSE_SHA256: state.composeSha256,
    EVO_RELEASE_ACTOR_ID: "1", EVO_RELEASE_CURRENT_MAIN_REVISION: state.revision,
  });
  return fixture;
}
export function acceptedV3RollbackRetryFixture() {
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
export function greenChecks() {
  return {
    check_runs: FAST_RELEASE_REQUIRED_CHECKS.map((name) => ({
      name,
      status: "completed",
      conclusion: "success",
      app: { slug: "github-actions" },
    })),
  };
}
// «ИИ-агент» (plan §4.2/§4.6): the agent pair joins a release only for EVO_AI_AGENT_ENABLED=true.
// The fixture drives the real controller end to end against a stateful fake Docker; agent
// containers, digests and secrets are synthetic.
export const AGENT_REPOSITORY = "ghcr.io/izzhackt/evo-ai-agent";
export const PREVIOUS_AGENT_DIGEST = `sha256:${"7".repeat(64)}`;
export const TARGET_AGENT_DIGEST = `sha256:${"8".repeat(64)}`;
export const FOREIGN_AGENT_DIGEST = `sha256:${"9".repeat(64)}`;
// The fixed override the controller feeds to compose on standard input while the agent is on
// (the here-string adds the last newline). It also declares the bridge, so it renders on top of
// a previous compose snapshot that predates it.
export const AGENT_APP_NETWORK_OVERRIDE = "services:\n  app:\n    networks:\n      ai:\n        aliases:\n          - evo-crm-app\n"
  + "networks:\n  ai:\n    name: evo_crm_ai\n    driver: bridge\n\n";
// Synthetic output of `docker logs --timestamps` for the outgoing app (both container streams).
export const FAKE_APP_LOG_STDOUT = "2026-10-10T09:00:00.000000001Z ▲ Next.js fixture ready\n"
  + "2026-10-10T09:00:01.000000002Z GET /api/health 200\n";
export const FAKE_APP_LOG_STDERR = "2026-10-10T09:00:02.000000003Z fixture warning on stderr\n";
export const FAKE_APP_LOG_ERROR = "error from daemon in stream: fixture log read failure\n";
export function aiAgentReleaseFixture({ enabled, previousAgent = false, agentEnv = "complete", appOnAgentNetwork = previousAgent }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-ai-agent-release-")));
  const bin = join(root, "bin");
  const releaseRoot = join(root, "release");
  const transferRoot = join(root, "transfer");
  const evidenceRoot = join(root, "evidence");
  const archiveRoot = join(root, "archive");
  const statePath = join(root, "runtime-state.json");
  const dockerLog = join(root, "docker.log");
  for (const directory of [bin, releaseRoot, transferRoot, evidenceRoot, archiveRoot]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const previousRevision = "4".repeat(40);
  const targetRevision = "5".repeat(40);
  const previousVersion = "previous-ai";
  const targetVersion = "candidate-ai";
  const previousImage = `sha256:${"a".repeat(64)}`;
  const runId = `ai-agent-${enabled ? "on" : "off"}-${previousAgent ? "upgrade" : "first"}`;
  const releaseId = `release-${runId}`;
  const composeFile = join(releaseRoot, "docker-compose.yml");
  const environmentFile = join(releaseRoot, ".env.production");
  const environmentExample = join(releaseRoot, "env.production.example");
  const agentEnvironmentFile = join(releaseRoot, ".env.ai-agent");
  const archive = join(transferRoot, "candidate.tar");
  const config = JSON.stringify({
    architecture: "amd64",
    config: { Labels: {
      "org.opencontainers.image.source": "https://github.com/izzhackt/evo_AI_CRM",
      "org.opencontainers.image.revision": targetRevision,
      "org.opencontainers.image.version": targetVersion,
    } },
    os: "linux",
  });
  const configDigest = hash(config);
  const targetImage = `sha256:${configDigest}`;
  const configPath = `${configDigest}.json`;
  const layerPath = `${"d".repeat(64)}/layer.tar`;
  mkdirSync(join(archiveRoot, "d".repeat(64)), { mode: 0o700 });
  writeFileSync(join(archiveRoot, configPath), config);
  writeFileSync(join(archiveRoot, layerPath), "layer");
  writeFileSync(join(archiveRoot, "manifest.json"), JSON.stringify([{
    Config: configPath, Layers: [layerPath], RepoTags: [`evo-crm:${targetRevision}`],
  }]));
  execFileSync("tar", ["-cf", archive, "-C", archiveRoot, "manifest.json", configPath, layerPath]);
  writeFileSync(composeFile, "# fixture: the fake Docker renders the services\n", { mode: 0o600 });
  writeFileSync(environmentFile, "SAFE_FIXTURE=1\n", { mode: 0o600 });
  writeFileSync(environmentExample, "SAFE_FIXTURE=1\n", { mode: 0o600 });
  const agentEnvironment = {
    // Raw format keeps `$` and `#` literally, so they are allowed in a value.
    complete: "# synthetic\nEVO_AI_AGENT_GEMINI_API_KEY=synthetic-fixture\n  EVO_AI_AGENT_DATABASE_URL=postgresql://fixture:pa$word#1@fixture/db\nEVO_AI_AGENT_INTERNAL_SECRET=synthetic-fixture\nEVO_AI_AGENT_STORAGE_SECRET=\n",
    incomplete: "EVO_AI_AGENT_GEMINI_API_KEY=synthetic-fixture\nEVO_AI_AGENT_DATABASE_URL=\n",
    quoted: "EVO_AI_AGENT_GEMINI_API_KEY=\"synthetic-fixture\"\nEVO_AI_AGENT_DATABASE_URL=postgresql://fixture\nEVO_AI_AGENT_INTERNAL_SECRET=synthetic-fixture\n",
    exported: "export EVO_AI_AGENT_GEMINI_API_KEY=synthetic-fixture\nEVO_AI_AGENT_DATABASE_URL=postgresql://fixture\nEVO_AI_AGENT_INTERNAL_SECRET=synthetic-fixture\n",
    padded: "EVO_AI_AGENT_GEMINI_API_KEY=synthetic-fixture \nEVO_AI_AGENT_DATABASE_URL=postgresql://fixture\nEVO_AI_AGENT_INTERNAL_SECRET=synthetic-fixture\n",
  }[agentEnv];
  if (agentEnvironment !== undefined) {
    writeFileSync(agentEnvironmentFile, agentEnvironment, { mode: 0o600 });
    chmodSync(agentEnvironmentFile, 0o600);
  }
  writeFileSync(dockerLog, "", { mode: 0o600 });
  const previousAgentImage = `${AGENT_REPOSITORY}@${PREVIOUS_AGENT_DIGEST}`;
  writeFileSync(statePath, JSON.stringify({
    app: "baseline",
    scanner: true,
    agent: previousAgent ? { api: previousAgentImage, worker: previousAgentImage, healthy: true } : null,
    agentImages: previousAgent ? [previousAgentImage] : [],
    appAi: appOnAgentNetwork,
    rollbackTagPresent: false,
  }));

  writeExecutable(join(bin, "docker"), `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + "\\n");
const statePath = process.env.FAKE_RUNTIME_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const previousImage = ${JSON.stringify(previousImage)};
const targetImage = ${JSON.stringify(targetImage)};
const previousRevision = ${JSON.stringify(previousRevision)};
const targetRevision = ${JSON.stringify(targetRevision)};
const previousVersion = ${JSON.stringify(previousVersion)};
const targetVersion = ${JSON.stringify(targetVersion)};
const scannerImage = ${JSON.stringify(CLAMAV_IMAGE)};
const wahaImage = "fixture/waha@" + process.env.EVO_WAHA_IMAGE_DIGEST;
const agentRepository = ${JSON.stringify(AGENT_REPOSITORY)};
const ids = { app: state.app === "target" ? "b0b0b0b0b0b0" : "a0a0a0a0a0a0", clamav: "c0c0c0c0c0c0",
  waha: "d0d0d0d0d0d0", "ai-agent-api": "e0e0e0e0e0e0", "ai-agent-worker": "f0f0f0f0f0f0" };
const save = () => writeFileSync(statePath, JSON.stringify(state));
const output = (value) => { if (value !== "") process.stdout.write(String(value) + "\\n"); };
// "--file -": the controller's app-network override arrives on standard input, exactly.
const appOverride = args.some((value, index) => value === "-" && args[index - 1] === "--file");
if (appOverride && readFileSync(0, "utf8") !== ${JSON.stringify(AGENT_APP_NETWORK_OVERRIDE)}) process.exit(65);
const present = (service) => service === "app" ? state.app !== null : service === "clamav" ? state.scanner
  : service === "waha" ? true : service === "ai-agent-api" ? Boolean(state.agent?.api)
  : service === "ai-agent-worker" ? Boolean(state.agent?.worker) : false;
const serviceFor = (id) => Object.keys(ids).find((service) => ids[service] === id && present(service));
const agentImageFor = (service) => service === "ai-agent-api" ? state.agent.api : state.agent.worker;
const services = Object.keys(ids);
// hermes reported Docker Compose v5.1.2 on 2026-10-06; FAKE_COMPOSE_VERSION overrides it.
if (args[0] === "compose" && args[1] === "version") {
  if (args.length !== 3 || args[2] !== "--short") process.exit(64);
  output(process.env.FAKE_COMPOSE_VERSION ?? "5.1.2");
  process.exit(process.env.FAKE_COMPOSE_VERSION_FAIL === "1" ? 1 : 0);
}
if (args[0] === "info") output("8589934592");
else if (args[0] === "ps") {
  const filter = args.find((value) => value.startsWith("label=com.docker.compose.service="));
  const wanted = filter ? [filter.split("=").at(-1)] : services;
  output(wanted.filter(present).map((service) => ids[service]).join("\\n"));
} else if (args[0] === "inspect") {
  const format = args[2];
  const service = serviceFor(args[3]);
  if (!service) process.exit(1);
  const agent = service.startsWith("ai-agent-");
  if (format.includes("com.docker.compose.service")) output(service);
  else if (format.includes("State.Health")) output(agent ? (state.agent.healthy ? "healthy" : "unhealthy") : "healthy");
  else if (format.includes("State.Running")) output("true");
  else if (format.includes("RestartCount")) output("0");
  else if (format.includes("org.opencontainers.image.revision")) output(state.app === "target" ? targetRevision : previousRevision);
  else if (format.includes("org.opencontainers.image.version")) output(state.app === "target" ? targetVersion : previousVersion);
  else if (format.includes("Config.Image")) {
    output(service === "clamav" ? scannerImage : service === "waha" ? wahaImage : agent ? agentImageFor(service)
      : "evo-crm:" + (state.app === "target" ? targetRevision : previousRevision));
  } else if (format.includes("Config.Env")) {
    output(JSON.stringify(state.app === "target"
      ? ["EVO_RELEASE_REVISION=" + targetRevision, "EVO_RUNTIME_IMAGE_ID=" + targetImage]
      : ["EVO_RELEASE_REVISION=" + previousRevision]));
  } else if (format.includes("PortBindings")) output("{}");
  else if (format.includes("NetworkSettings.Networks")) {
    output(service === "app" ? "fixture_private\\nfixture_web" + (state.appAi ? "\\nevo_crm_ai" : "")
      : agent ? "evo_crm_ai" : "fixture_private");
  } else if (format.includes(".Image")) output(state.app === "target" ? targetImage : previousImage);
  else process.exit(64);
} else if (args[0] === "image" && args[1] === "inspect") {
  const reference = args.at(-1);
  const formatIndex = args.indexOf("--format");
  const format = formatIndex === -1 ? "" : args[formatIndex + 1];
  if (reference.startsWith(agentRepository + "@")) {
    if (!state.agentImages.includes(reference)) process.exit(1);
    if (format.includes(".Os")) output("linux");
    else if (format.includes(".Architecture")) output("amd64");
    else if (format.includes("org.opencontainers.image.source")) output("https://github.com/izzhackt/evo-ai-agent");
    else if (format.includes("org.opencontainers.image.revision")) output("6".repeat(40));
    else if (format !== "") process.exit(64);
  } else {
    if (reference.startsWith("evo-crm:rollback-") && !state.rollbackTagPresent) process.exit(1);
    if (format.includes(".Id")) output(reference.startsWith("evo-crm:rollback-") || reference === previousImage ? previousImage : reference === scannerImage ? scannerImage : targetImage);
    else if (format.includes("org.opencontainers.image.source")) output("https://github.com/izzhackt/evo_AI_CRM");
    else if (format.includes("org.opencontainers.image.revision")) output(reference === previousImage ? previousRevision : targetRevision);
    else if (format.includes("org.opencontainers.image.version")) output(reference === previousImage ? previousVersion : targetVersion);
    else if (format.includes(".Os")) output("linux");
    else if (format.includes(".Architecture")) output("amd64");
    else if (format !== "") process.exit(64);
  }
} else if (args[0] === "image" && args[1] === "load") {
  // The fixture archive is bound to targetImage by the real controller.
} else if (args[0] === "tag") { state.rollbackTagPresent = true; save(); }
else if (args[0] === "network" && args[1] === "inspect") { /* fixture networks exist */ }
else if (args[0] === "logs") {
  // Only the exact bounded read of the outgoing app; both container streams, synthetic lines.
  if (args.length !== 5 || args[1] !== "--timestamps" || args[2] !== "--tail" || args[3] !== "20000"
    || serviceFor(args[4]) !== "app" || state.app !== "baseline") process.exit(64);
  const mode = process.env.FAKE_APP_LOGS ?? "ok";
  if (mode === "silent") process.exit(1);
  if (mode === "error") {
    process.stderr.write(${JSON.stringify(FAKE_APP_LOG_ERROR)});
    process.exit(1);
  }
  process.stdout.write(${JSON.stringify(FAKE_APP_LOG_STDOUT)});
  process.stderr.write(${JSON.stringify(FAKE_APP_LOG_STDERR)});
}
else if (args[0] === "exec") {
  if (args[1] !== ids["ai-agent-api"] || !args.join(" ").includes("/v1/ready")) process.exit(64);
  process.exit(process.env.FAKE_AGENT_READY_FAIL === "1" ? 1 : 0);
} else if (args[0] === "compose") {
  const profile = args.includes("--profile") && args[args.indexOf("--profile") + 1] === "ai-agent";
  const agentImage = agentRepository + "@" + (process.env.EVO_AI_AGENT_IMAGE_DIGEST ?? "");
  const command = args.find((value) => ["config", "pull", "up", "rm", "stop"].includes(value));
  if (command === "config") {
    if (args.includes("--services")) output((profile ? ["ai-agent-api", "ai-agent-worker"] : []).concat(["app", "clamav", "waha"]).join("\\n"));
    else if (args.includes("--format")) {
      // FAKE_COMPOSE_BREACH renders a compose that would put the agent next to WAHA or clamd.
      const breach = process.env.FAKE_COMPOSE_BREACH ?? "";
      const agentNetwork = breach === "agent-private" ? "private" : "ai";
      const agentService = (aliases) => ({ image: agentImage, profiles: ["ai-agent"], read_only: true,
        user: "10001:10001", cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"],
        healthcheck: { test: ["CMD"] }, networks: { [agentNetwork]: aliases ? { aliases } : null } });
      const agentBridge = profile || appOverride;
      output(JSON.stringify({
        networks: { private: { name: "fixture_private" }, web: { name: "fixture_web" },
          ...(agentBridge ? { ai: { name: "evo_crm_ai", driver: "bridge" } } : {}) },
        services: {
          app: { image: "evo-crm:" + process.env.EVO_RELEASE_REVISION,
            networks: { private: {}, web: {}, ...(appOverride ? { ai: { aliases: ["evo-crm-app"] } } : {}) } },
          clamav: { image: scannerImage, networks: { private: {} } },
          waha: { image: wahaImage, networks: { private: {}, ...(breach === "waha-ai" && agentBridge ? { ai: {} } : {}) } },
          ...(profile ? { "ai-agent-api": agentService(["evo-ai-agent"]), "ai-agent-worker": agentService(null) } : {}),
        },
      }));
    }
  } else if (command === "pull") {
    if (!profile || args.at(-1) !== "ai-agent-api") process.exit(64);
    if (process.env.FAKE_AGENT_PULL_FAIL === "1") process.exit(1);
    state.agentImages.push(agentImage); save();
  } else if (command === "up") {
    if (args.includes("ai-agent-api")) {
      if (!profile || !args.includes("ai-agent-worker")) process.exit(64);
      if (!state.agentImages.includes(agentImage)) process.exit(1);
      const healthy = process.env.FAKE_AGENT_UP_FAIL !== "1" || agentImage !== process.env.FAKE_TARGET_AGENT_IMAGE;
      state.agent = { api: agentImage, worker: agentImage, healthy };
      save();
      if (!healthy) process.exit(1);
    } else if (args.at(-1) === "clamav") { state.scanner = true; save(); }
    else if (args.at(-1) === "app") {
      state.app = args.some((value) => value.endsWith("/rollback.override.yml")) ? "baseline" : "target";
      state.appAi = appOverride;
      save();
    } else process.exit(64);
  } else if (command === "rm") {
    if (args.includes("ai-agent-api")) { if (!profile) process.exit(64); state.agent = null; }
    else if (args.at(-1) === "clamav") state.scanner = false;
    else if (args.at(-1) === "app") state.app = null;
    save();
  } else process.exit(64);
} else process.exit(64);
`);
  writeExecutable(join(bin, "node"), `#!/usr/bin/env bash
if [[ \${1-} == *evo-app-env-contract.mjs && \${2-} == --example ]]; then exit 0; fi
exec ${JSON.stringify(process.execPath)} "$@"
`);
  writeExecutable(join(bin, "curl"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");

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
    EVO_RELEASE_ROLLBACK_SEED: join(evidenceRoot, `seed-${runId}`, "state.json"),
    EVO_RELEASE_RUN_ID: runId,
    EVO_RELEASE_SEED_IMAGE: previousImage,
    EVO_RELEASE_TRANSFER_ROOT: transferRoot,
    EVO_RELEASE_UPSTREAM_CI_RUN_ATTEMPT: "1",
    EVO_RELEASE_UPSTREAM_CI_RUN_ID: "2",
    EVO_RELEASE_VERSION: targetVersion,
    EVO_RELEASE_WORKFLOW_RUN_ATTEMPT: "1",
    EVO_RELEASE_WORKFLOW_RUN_ID: "1",
    EVO_SUPABASE_IDENTITY: "selfhosted",
    EVO_WAHA_IMAGE_DIGEST: `sha256:${"e".repeat(64)}`,
    EVO_AI_AGENT_ENABLED: enabled ? "true" : "",
    EVO_AI_AGENT_IMAGE_DIGEST: enabled ? TARGET_AGENT_DIGEST : "",
    EVO_AI_AGENT_READY_ATTEMPTS: "2",
    FAKE_DOCKER_LOG: dockerLog,
    FAKE_RUNTIME_STATE: statePath,
    FAKE_TARGET_AGENT_IMAGE: `${AGENT_REPOSITORY}@${TARGET_AGENT_DIGEST}`,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  };
  delete environment.EVO_CRM_AI_AGENT_ENV_FILE;
  delete environment.COMPOSE_PROFILES;
  const releaseDir = join(evidenceRoot, releaseId);
  const run = (command, overrides = {}) => spawnSync("bash", ["scripts/release/evo-fast-release.sh", command], {
    encoding: "utf8", env: { ...environment, ...overrides }, timeout: 60_000,
  });
  const runtime = () => JSON.parse(readFileSync(statePath, "utf8"));
  const setRuntime = (changes) => writeFileSync(statePath, JSON.stringify({ ...runtime(), ...changes }));
  const dockerCalls = () => readFileSync(dockerLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const rollbackEnvironment = {
    EVO_RELEASE_ROLLBACK_STATE: join(releaseDir, "state.json"),
    EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID: releaseId,
  };
  return {
    agentEnvironmentFile, dockerCalls, environment, evidenceRoot, previousAgentImage, releaseDir,
    releaseId, rollbackEnvironment, root, run, runtime, setRuntime, targetRevision,
    targetAgentImage: `${AGENT_REPOSITORY}@${TARGET_AGENT_DIGEST}`,
  };
}
export const TODAY_STATE_KEYS = ["appEnvSha256", "appEnvSnapshot", "archiveSha256", "artifactDigest", "artifactId",
  "composeSha256", "composeSnapshot", "controllerSha256", "generation", "imageConfigDigest", "imageId",
  "imageSource", "previous", "releaseId", "releaseRunId", "repository", "revision", "rollbackTag",
  "rollbackWrapperSha256", "schema", "upstreamCiRunAttempt", "upstreamCiRunId", "version",
  "workflowRunAttempt", "workflowRunId"];
// Health audit A2 (2026-10-10): a release replaces the app container and Docker discards its
// log with it. The controller keeps the outgoing app's bounded log tail root-only in the
// release directory, prints none of it, and never lets a failed copy stop or roll back a release.
export const PREVIOUS_APP_LOG_RECORD_KEYS = ["bytes", "code", "containerId", "log", "schema", "sha256", "status", "tailLines"];
export function privateMode(path) {
  return statSync(path).mode & 0o777;
}
export function assertSingleDeployResult(deployed, releaseDir, releaseId) {
  const lines = deployed.stdout.split("\n").filter(Boolean);
  assert.equal(lines.length, 1, deployed.stdout);
  assert.deepEqual(JSON.parse(lines[0]), {
    ok: true, command: "deploy", status: "pending", releaseId, evidenceDir: releaseDir,
  });
}
export function leftoverLogTemporaries(releaseDir) {
  return readdirSync(releaseDir).filter((name) => name.startsWith(".previous-app-log."));
}
