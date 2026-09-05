#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OPT_IN = "EVO_RUN_V3_RELEASE_ROLLBACK_ORBSTACK";
const REQUIRED_OPT_IN_VALUE = "1";
const HARNESS_PREFIX = "evo-v3-release-rollback-";
const SHA256_IMAGE = /^sha256:[0-9a-f]{64}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const CLAMAV_IMAGE = "clamav/clamav@sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9";
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;

if (process.env[OPT_IN] !== REQUIRED_OPT_IN_VALUE) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, status: "skipped", code: "explicit_opt_in_required", optIn: OPT_IN })}\n`,
  );
  process.exit(0);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const controllerPath = join(repositoryRoot, "scripts/evo-fast-release.sh");
const temporaryRoot = realpathSync(tmpdir());
const harnessRoot = realpathSync(mkdtempSync(join(temporaryRoot, HARNESS_PREFIX)));
const markerPath = join(harnessRoot, ".evo-v3-release-rollback-harness");
const suffix = randomBytes(6).toString("hex");
const projectName = `evov3rollback${suffix}`;
const networkName = `evo_v3_rollback_${suffix}_private`;
const signatureVolumeName = `${projectName}_clamav_signatures`;
const baselineRevision = createHash("sha1").update(`baseline-${suffix}`).digest("hex");
const candidateRevision = createHash("sha1").update(`candidate-${suffix}`).digest("hex");
const baselineVersion = `rollback-baseline-${suffix}`;
const candidateVersion = `rollback-candidate-${suffix}`;
const runId = `rollback-proof-${suffix}`;
const baselineTag = `evo-crm:${baselineRevision}`;
const candidateTag = `evo-crm:${candidateRevision}`;
const rollbackTag = `evo-crm:rollback-${runId}`;
const releaseRoot = join(harnessRoot, "release");
const transferRoot = join(harnessRoot, "transfer");
const evidenceRoot = join(harnessRoot, "evidence");
const imageContext = join(harnessRoot, "image");
const toolRoot = join(harnessRoot, "tools");
const composeFile = join(releaseRoot, "docker-compose.yml");
const appEnvironmentFile = join(releaseRoot, ".env.production");
const wahaEnvironmentFile = join(releaseRoot, ".env.waha");
const environmentExampleFile = join(releaseRoot, "env.production.example");
const candidateArchive = join(transferRoot, `candidate-${candidateRevision}.tar`);
const rollbackSeed = join(evidenceRoot, "sealed-baseline", "state.json");

let baselineImageId = "";
let candidateImageId = "";
let scannerProbeImage = "";
let scannerCleanProof;
let hostPort = 0;
let composeWasStarted = false;
let orbStackReady = false;
let runtimeComposeEnvironment;
let releaseToolPath = process.env.PATH ?? "";
let releaseLockTool = "native-flock";
let releaseLockContentionProved = false;
let cleaned = false;

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function safeOutput(value) {
  const output = String(value ?? "");
  return output.length > 12_000 ? output.slice(-12_000) : output;
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1_000,
  });
  const accepted = options.accepted ?? [0];
  if (!accepted.includes(result.status)) {
    throw new Error(
      `${options.label ?? command} failed with status ${result.status}\n${safeOutput(result.stdout)}\n${safeOutput(result.stderr)}`,
    );
  }
  return {
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
  };
}

function docker(args, options = {}) {
  return execute("docker", ["--context", "orbstack", ...args], options);
}

function compose(args, options = {}) {
  return docker(
    [
      "compose",
      "--ansi",
      "never",
      "--project-name",
      projectName,
      "--file",
      composeFile,
      "--env-file",
      appEnvironmentFile,
      ...args,
    ],
    options,
  );
}

function inspectImage(reference, format) {
  return docker(["image", "inspect", "--format", format, reference]).stdout;
}

function inspectContainer(container, format) {
  return docker(["inspect", "--format", format, container]).stdout;
}

function serviceContainer(service) {
  const output = docker([
    "ps",
    "-aq",
    "--filter",
    `label=com.docker.compose.project=${projectName}`,
    "--filter",
    `label=com.docker.compose.service=${service}`,
  ]).stdout;
  const ids = output.split(/\r?\n/u).filter(Boolean);
  assert.equal(ids.length, 1, `expected exactly one disposable ${service} container`);
  return ids[0];
}

function serviceContainerIds(service) {
  const output = docker([
    "ps",
    "-aq",
    "--filter",
    `label=com.docker.compose.project=${projectName}`,
    "--filter",
    `label=com.docker.compose.service=${service}`,
  ]).stdout;
  return output.split(/\r?\n/u).filter(Boolean);
}

function waitForScannerHealth() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const containers = serviceContainerIds("clamav");
    if (containers.length === 1) {
      const health = docker([
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        containers[0],
      ], { accepted: [0, 1] });
      if (health.status === 0 && health.stdout === "healthy") return containers[0];
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
  }
  throw new Error("clamav_health_timeout");
}

const scannerProbeSource = String.raw`
import assert from "node:assert/strict";
import {
  ClamdScanError,
  scanBytesWithClamd,
} from "/workspace/src/lib/server/clamd-malware-scanner.ts";

const bytes = Buffer.from(process.argv[1], "base64");
const expected = process.argv[2];
try {
  const proof = await scanBytesWithClamd(bytes, {
    host: "evo-crm-clamav",
    port: 3310,
    timeoutMs: 10_000,
  });
  assert.equal(expected, "clean");
  assert.equal(proof.engine, "ClamAV");
  assert.match(proof.engineVersion, /^[0-9][0-9A-Za-z.+~-]{0,63}$/u);
  assert.match(proof.signatureVersion, /^[1-9][0-9]{0,18}$/u);
  assert.equal(proof.protocol, "clamd-zinstream-v1");
  assert.match(proof.sha256Hex, /^[0-9a-f]{64}$/u);
  console.log(JSON.stringify({ outcome: "clean", ...proof }));
} catch (error) {
  assert(error instanceof ClamdScanError);
  assert.equal(error.code, expected);
  console.log(JSON.stringify({ outcome: error.code }));
}
`;

function scanWithProductClient(bytes, expected) {
  assert.match(scannerProbeImage, /^node@sha256:[0-9a-f]{64}$/u);
  const output = docker([
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--network",
    networkName,
    "--mount",
    `type=bind,source=${repositoryRoot},target=/workspace,readonly`,
    "--workdir",
    "/workspace",
    scannerProbeImage,
    "node",
    "--conditions=react-server",
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    scannerProbeSource,
    Buffer.from(bytes).toString("base64"),
    expected,
  ], { label: `scan ${expected} with real product client` }).stdout;
  return JSON.parse(output);
}

function controllerEnvironment(overrides = {}) {
  const environment = {
    ...process.env,
    PATH: releaseToolPath,
    PYTHONNOUSERSITE: "1",
    DOCKER_CONTEXT: "orbstack",
    EVO_RELEASE_ROOT: releaseRoot,
    EVO_RELEASE_PROJECT_NAME: projectName,
    EVO_RELEASE_TRANSFER_ROOT: transferRoot,
    EVO_RELEASE_EVIDENCE_ROOT: evidenceRoot,
    EVO_RELEASE_COMPOSE_FILE: composeFile,
    EVO_RELEASE_ACTIVE_COMPOSE_FILE: composeFile,
    EVO_RELEASE_APP_ENV_FILE: appEnvironmentFile,
    EVO_RELEASE_ENV_EXAMPLE_FILE: environmentExampleFile,
    EVO_RELEASE_EXTERNAL_HEALTH_URL: `http://127.0.0.1:${hostPort}/api/health`,
    EVO_RELEASE_DOCKER_STORAGE_PATH: harnessRoot,
    EVO_RELEASE_MIN_FREE_KB: "1048576",
    EVO_RELEASE_MIN_AVAILABLE_MEMORY_KB: "4194304",
    EVO_RELEASE_ROLLBACK_SEED: rollbackSeed,
    EVO_SUPABASE_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa",
    EVO_CRM_APP_ENV_FILE: appEnvironmentFile,
    EVO_CRM_WAHA_ENV_FILE: wahaEnvironmentFile,
    EVO_TEST_HOST_PORT: String(hostPort),
    EVO_TEST_NETWORK: networkName,
    ...overrides,
  };
  delete environment.DOCKER_HOST;
  return environment;
}

function prepareReleaseLockTool() {
  const nativeProbe = spawnSync("flock", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (nativeProbe.error?.code !== "ENOENT") return;
  assert.equal(
    process.platform,
    "darwin",
    "the production-compatible flock command is required outside the macOS harness",
  );
  execute("/usr/bin/python3", ["-c", "import fcntl; assert hasattr(fcntl, 'flock')"], {
    label: "verify macOS fcntl lock bridge",
  });
  mkdirSync(toolRoot, { recursive: true, mode: 0o700 });
  const bridgePath = join(toolRoot, "flock");
  writeFileSync(
    bridgePath,
    `#!/usr/bin/python3
import fcntl
import sys

if sys.argv[1:] != ["--nonblock", "9"]:
    raise SystemExit(64)
try:
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
except (BlockingIOError, OSError):
    raise SystemExit(1)
`,
    { encoding: "utf8", mode: 0o700 },
  );
  chmodSync(bridgePath, 0o700);
  releaseToolPath = `${toolRoot}:${releaseToolPath}`;
  releaseLockTool = "macos-python-fcntl";
}

function verifyReleaseLockContention() {
  const lockPath = join(toolRoot, "contention.lock");
  const readyPath = join(toolRoot, "contention.ready");
  execute(
    "bash",
    [
      "-c",
      `set -Eeuo pipefail
lock_path=$1
ready_path=$2
(
  exec 9>"$lock_path"
  flock --nonblock 9
  : >"$ready_path"
  sleep 1
) &
holder_pid=$!
cleanup_holder() {
  kill "$holder_pid" >/dev/null 2>&1 || true
  wait "$holder_pid" >/dev/null 2>&1 || true
}
trap cleanup_holder EXIT
for _attempt in $(seq 1 40); do
  [[ -f "$ready_path" ]] && break
  sleep 0.05
done
[[ -f "$ready_path" ]]
set +e
(
  exec 9>"$lock_path"
  flock --nonblock 9 >/dev/null 2>&1
)
contender_status=$?
set -e
[[ $contender_status -ne 0 ]]
wait "$holder_pid"
trap - EXIT
(
  exec 9>"$lock_path"
  flock --nonblock 9
)
`,
      "evo-release-lock-contention",
      lockPath,
      readyPath,
    ],
    {
      env: { ...process.env, PATH: releaseToolPath, PYTHONNOUSERSITE: "1" },
      label: "prove release lock contention",
    },
  );
  releaseLockContentionProved = true;
}

function runController(command, overrides = {}, accepted = [0]) {
  return execute("bash", [controllerPath, command], {
    env: controllerEnvironment(overrides),
    accepted,
    timeout: 5 * 60 * 1_000,
    label: `release controller ${command}`,
  });
}

function writePrivateFile(path, contents) {
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function parseJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseLastJsonLine(output) {
  const lines = output.split(/\r?\n/u).filter(Boolean);
  assert.ok(lines.length > 0, "controller must emit a JSON result");
  return JSON.parse(lines.at(-1));
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object" && address.port > 0);
  const port = address.port;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return port;
}

async function assertHealthyHttp(expectedRevision, expectedVersion) {
  const response = await fetch(`http://127.0.0.1:${hostPort}/api/health`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: true,
    revision: expectedRevision,
    version: expectedVersion,
  });
}

function assertOrbStackPreflight() {
  assert.equal(
    execute("orb", ["status"], { label: "OrbStack status" }).stdout,
    "Running",
    "OrbStack must report exactly Running",
  );
  assert.equal(
    execute("docker", ["context", "show"], { label: "Docker context" }).stdout,
    "orbstack",
    "Docker context must be exactly orbstack",
  );
  assert.equal(
    process.env.DOCKER_HOST,
    undefined,
    "DOCKER_HOST must be unset so it cannot bypass the selected OrbStack context",
  );
  assert.ok(
    process.env.DOCKER_CONTEXT === undefined || process.env.DOCKER_CONTEXT === "orbstack",
    "DOCKER_CONTEXT may only be unset or explicitly orbstack",
  );
  orbStackReady = true;
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;

  if (orbStackReady && composeWasStarted) {
    assert.ok(runtimeComposeEnvironment, "disposable Compose cleanup environment is required");
    compose(["down", "--volumes", "--remove-orphans", "--timeout", "5"], {
      env: runtimeComposeEnvironment,
      timeout: 2 * 60 * 1_000,
    });
  }

  if (orbStackReady) {
    const remainingContainers = docker([
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
    ]).stdout.split(/\r?\n/u).filter(Boolean);
    if (remainingContainers.length > 0) {
      docker(["rm", "--force", ...remainingContainers]);
    }
    assert.equal(
      docker([
        "ps",
        "-aq",
        "--filter",
        `label=com.docker.compose.project=${projectName}`,
      ]).stdout,
      "",
      "disposable containers must not survive cleanup",
    );

    const signatureVolumeExists = docker(["volume", "inspect", signatureVolumeName], {
      accepted: [0, 1],
    }).status === 0;
    if (signatureVolumeExists) docker(["volume", "rm", signatureVolumeName]);
    assert.equal(
      docker(["volume", "inspect", signatureVolumeName], { accepted: [0, 1] }).status,
      1,
      "disposable scanner signatures must not survive cleanup",
    );

    const networkExists = docker(["network", "inspect", networkName], {
      accepted: [0, 1],
    }).status === 0;
    if (networkExists) docker(["network", "rm", networkName]);
    assert.equal(
      docker(["network", "inspect", networkName], { accepted: [0, 1] }).status,
      1,
      "disposable network must not survive cleanup",
    );

    const ownedReferences = [baselineTag, candidateTag, rollbackTag].filter(Boolean);
    if (ownedReferences.length > 0) {
      docker(["image", "rm", "--force", ...ownedReferences], { accepted: [0, 1] });
    }
    const ownedImageIds = [baselineImageId, candidateImageId].filter((value) =>
      SHA256_IMAGE.test(value),
    );
    if (ownedImageIds.length > 0) {
      docker(["image", "rm", "--force", ...new Set(ownedImageIds)], { accepted: [0, 1] });
    }
    for (const reference of ownedReferences) {
      assert.equal(
        docker(["image", "inspect", reference], { accepted: [0, 1] }).status,
        1,
        `disposable image ${reference} must not survive cleanup`,
      );
    }
  }

  assert.equal(basename(harnessRoot).startsWith(HARNESS_PREFIX), true);
  assert.equal(dirname(harnessRoot), temporaryRoot);
  assert.equal(readFileSync(markerPath, "utf8"), `${projectName}\n`);
  rmSync(harnessRoot, { recursive: true, force: true });
}

function writeHarnessFiles() {
  for (const directory of [releaseRoot, transferRoot, evidenceRoot, imageContext, toolRoot]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const environment = `EVO_CRM_DOMAIN=rollback-proof.invalid
EVO_CADDY_NETWORK=${networkName}
NEXT_PUBLIC_SUPABASE_URL=https://aaaaaaaaaaaaaaaaaaaa.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_rollback_proof
EVO_PLATFORM_SUPABASE_SECRET_KEY=sb_secret_rollback_proof_only_1234567890
EVO_PLATFORM_ORGANIZATION_ID=11111111-1111-4111-8111-111111111111
EVO_PLATFORM_WAHA_INGRESS_ENABLED=0
EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0
`;
  writePrivateFile(environmentExampleFile, environment);
  writePrivateFile(appEnvironmentFile, environment);
  writePrivateFile(wahaEnvironmentFile, "# disposable WAHA surrogate has no credentials\n");

  writePrivateFile(
    join(imageContext, "Dockerfile"),
    `ARG BASE_IMAGE
FROM \${BASE_IMAGE}
ARG EVO_IMAGE_REVISION
ARG EVO_IMAGE_VERSION
ARG EVO_TEST_HEALTH_STATUS
LABEL org.opencontainers.image.revision="\${EVO_IMAGE_REVISION}" \\
      org.opencontainers.image.version="\${EVO_IMAGE_VERSION}"
ENV EVO_RELEASE_REVISION="\${EVO_IMAGE_REVISION}" \\
    EVO_RELEASE_VERSION="\${EVO_IMAGE_VERSION}" \\
    EVO_TEST_HEALTH_STATUS="\${EVO_TEST_HEALTH_STATUS}"
COPY server.mjs /app/server.mjs
EXPOSE 3000
CMD ["node", "/app/server.mjs"]
`,
  );
  writePrivateFile(
    join(imageContext, "server.mjs"),
    `import { createServer } from "node:http";

const status = Number(process.env.EVO_TEST_HEALTH_STATUS);
createServer((request, response) => {
  if (request.url !== "/api/health") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({
    ok: status === 200,
    revision: process.env.EVO_RELEASE_REVISION,
    version: process.env.EVO_RELEASE_VERSION,
  }));
}).listen(3000, "0.0.0.0");
`,
  );
}

function writeComposeFile(wahaRepository, wahaDigest) {
  writePrivateFile(
    composeFile,
    `services:
  app:
    platform: linux/amd64
    image: "evo-crm:\${EVO_RELEASE_REVISION:?exact revision required}"
    labels:
      org.opencontainers.image.revision: "\${EVO_RELEASE_REVISION}"
      org.opencontainers.image.version: "\${EVO_RELEASE_VERSION}"
    env_file:
      - "\${EVO_CRM_APP_ENV_FILE}"
    environment:
      EVO_CLAMD_HOST: evo-crm-clamav
      EVO_CLAMD_PORT: "3310"
      EVO_CLAMD_TIMEOUT_MS: "10000"
    ports:
      - "127.0.0.1:\${EVO_TEST_HOST_PORT}:3000"
    networks:
      - private
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]
      interval: 1s
      timeout: 1s
      retries: 2
      start_period: 1s
  clamav:
    platform: linux/amd64
    image: "${CLAMAV_IMAGE}"
    restart: unless-stopped
    init: true
    cpus: "2.0"
    mem_limit: 4096m
    pids_limit: 256
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    expose:
      - "3310"
    volumes:
      - clamav_signatures:/var/lib/clamav
    networks:
      private:
        aliases:
          - evo-crm-clamav
    healthcheck:
      test: ["CMD-SHELL", "/usr/local/bin/clamdcheck.sh"]
      interval: 5s
      timeout: 10s
      retries: 60
      start_period: 30s
  waha:
    platform: linux/amd64
    image: "\${EVO_WAHA_IMAGE_REPOSITORY}@\${EVO_WAHA_IMAGE_DIGEST}"
    command: ["node", "-e", "require('node:http').createServer((q,s)=>{s.writeHead(q.url==='/ping'?200:404);s.end()}).listen(3000,'0.0.0.0')"]
    env_file:
      - "\${EVO_CRM_WAHA_ENV_FILE}"
    networks:
      - private
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/ping').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]
      interval: 1s
      timeout: 1s
      retries: 5
      start_period: 1s
networks:
  private:
    name: "\${EVO_TEST_NETWORK}"
volumes:
  clamav_signatures:
`,
  );
  assert.equal(`${wahaRepository}@${wahaDigest}`.includes("@sha256:"), true);
}

function buildAppImage({ baseImage, revision, version, healthStatus, tag }) {
  docker([
    "build",
    "--platform",
    "linux/amd64",
    "--build-arg",
    `BASE_IMAGE=${baseImage}`,
    "--build-arg",
    `EVO_IMAGE_REVISION=${revision}`,
    "--build-arg",
    `EVO_IMAGE_VERSION=${version}`,
    "--build-arg",
    `EVO_TEST_HEALTH_STATUS=${healthStatus}`,
    "--tag",
    tag,
    imageContext,
  ], { timeout: 10 * 60 * 1_000, label: `build ${tag}` });
  const id = inspectImage(tag, "{{.Id}}");
  assert.match(id, SHA256_IMAGE);
  assert.equal(inspectImage(tag, "{{.Os}}/{{.Architecture}}"), "linux/amd64");
  assert.equal(
    inspectImage(tag, '{{index .Config.Labels "org.opencontainers.image.revision"}}'),
    revision,
  );
  assert.equal(
    inspectImage(tag, '{{index .Config.Labels "org.opencontainers.image.version"}}'),
    version,
  );
  return id;
}

function pinnedNodeImage() {
  docker(["pull", "--platform", "linux/amd64", "node:22-alpine"], {
    timeout: 10 * 60 * 1_000,
    label: "pull disposable Node base",
  });
  const digests = JSON.parse(inspectImage("node:22-alpine", "{{json .RepoDigests}}"));
  assert.ok(Array.isArray(digests) && digests.length > 0, "Node base must expose a pinned digest");
  const pinned = digests.find((value) => /^node@sha256:[0-9a-f]{64}$/u.test(value));
  assert.ok(pinned, "Node base must resolve to an exact node@sha256 reference");
  const [repository, digest] = pinned.split("@");
  assert.match(digest, SHA256_IMAGE);
  return { pinned, repository, digest };
}

function candidateEnvironment(wahaRepository, wahaDigest) {
  return {
    EVO_RELEASE_REVISION: candidateRevision,
    EVO_RELEASE_VERSION: candidateVersion,
    EVO_RELEASE_RUN_ID: runId,
    EVO_RELEASE_ARCHIVE: candidateArchive,
    EVO_RELEASE_ARCHIVE_SHA256: sha256File(candidateArchive),
    EVO_RELEASE_EXPECTED_IMAGE_ID: candidateImageId,
    EVO_RELEASE_EXPECTED_COMPOSE_SHA256: sha256File(composeFile),
    EVO_RELEASE_SEED_IMAGE: baselineImageId,
    EVO_WAHA_IMAGE_REPOSITORY: wahaRepository,
    EVO_WAHA_IMAGE_DIGEST: wahaDigest,
  };
}

async function run() {
  // Establish deletion authority before any preflight can throw. Cleanup then
  // preserves the original failure while still proving this exact temp root is
  // owned by the current disposable run.
  writePrivateFile(markerPath, `${projectName}\n`);
  assertOrbStackPreflight();
  assert.match(baselineRevision, SHA40);
  assert.match(candidateRevision, SHA40);
  hostPort = await reserveLoopbackPort();
  writeHarnessFiles();
  prepareReleaseLockTool();
  verifyReleaseLockContention();

  const { pinned: wahaImage, repository: wahaRepository, digest: wahaDigest } = pinnedNodeImage();
  scannerProbeImage = wahaImage;
  writeComposeFile(wahaRepository, wahaDigest);

  baselineImageId = buildAppImage({
    baseImage: wahaImage,
    revision: baselineRevision,
    version: baselineVersion,
    healthStatus: 200,
    tag: baselineTag,
  });
  candidateImageId = buildAppImage({
    baseImage: wahaImage,
    revision: candidateRevision,
    version: candidateVersion,
    healthStatus: 503,
    tag: candidateTag,
  });
  assert.notEqual(baselineImageId, candidateImageId);

  const baselineComposeEnvironment = controllerEnvironment({
    EVO_RELEASE_REVISION: baselineRevision,
    EVO_RELEASE_VERSION: baselineVersion,
    EVO_WAHA_IMAGE_REPOSITORY: wahaRepository,
    EVO_WAHA_IMAGE_DIGEST: wahaDigest,
  });
  runtimeComposeEnvironment = baselineComposeEnvironment;
  composeWasStarted = true;
  compose(["up", "--detach", "--wait", "--wait-timeout", "30", "app", "waha"], {
    env: baselineComposeEnvironment,
    timeout: 2 * 60 * 1_000,
    label: "start disposable baseline runtime",
  });
  await assertHealthyHttp(baselineRevision, baselineVersion);

  const baselineContainer = serviceContainer("app");
  assert.equal(inspectContainer(baselineContainer, "{{.Image}}"), baselineImageId);
  const wahaContainer = serviceContainer("waha");
  assert.equal(inspectContainer(wahaContainer, "{{.Config.Image}}"), wahaImage);
  assert.equal(
    inspectContainer(
      wahaContainer,
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
    ),
    "healthy",
  );

  compose(["rm", "--stop", "--force", "app"], {
    env: baselineComposeEnvironment,
    label: "remove only disposable baseline app",
  });
  assert.equal(
    docker([
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
      "--filter",
      "label=com.docker.compose.service=app",
    ]).stdout,
    "",
  );
  assert.equal(serviceContainer("waha"), wahaContainer);

  const seal = runController("seal-rollback-seed", {
    EVO_RELEASE_SEED_IMAGE: baselineImageId,
    EVO_WAHA_IMAGE_REPOSITORY: wahaRepository,
    EVO_WAHA_IMAGE_DIGEST: wahaDigest,
  });
  const sealResult = parseLastJsonLine(seal.stdout);
  assert.deepEqual(sealResult, {
    ok: true,
    command: "seal-rollback-seed",
    status: "sealed",
    revision: baselineRevision,
    version: baselineVersion,
  });
  const seed = parseJson(rollbackSeed);
  assert.equal(seed.schema, "evo-release-rollback-seed/v2");
  assert.equal(seed.previousImage, baselineImageId);
  assert.equal(seed.previousRevision, baselineRevision);
  assert.equal(seed.previousVersion, baselineVersion);
  assert.equal(seed.previousScannerPresent, false);
  assert.equal(seed.previousScannerImage, "");
  assert.equal(seed.composeSha256, sha256File(composeFile));
  assert.equal(seed.appEnvSha256, sha256File(appEnvironmentFile));
  assert.match(seed.composeSha256, SHA256_HEX);
  assert.match(seed.appEnvSha256, SHA256_HEX);

  compose(["pull", "--quiet", "clamav"], {
    env: baselineComposeEnvironment,
    timeout: 10 * 60 * 1_000,
    label: "pull exact disposable ClamAV image",
  });
  compose([
    "up",
    "--detach",
    "--no-deps",
    "--no-build",
    "--pull",
    "never",
    "--wait",
    "--wait-timeout",
    "600",
    "clamav",
  ], {
    env: baselineComposeEnvironment,
    timeout: 11 * 60 * 1_000,
    label: "start exact disposable ClamAV runtime",
  });
  const scannerContainer = waitForScannerHealth();
  assert.equal(inspectContainer(scannerContainer, "{{.Config.Image}}"), CLAMAV_IMAGE);
  assert.equal(inspectImage(CLAMAV_IMAGE, "{{.Os}}/{{.Architecture}}"), "linux/amd64");
  assert.equal(inspectContainer(scannerContainer, "{{json .HostConfig.PortBindings}}"), "{}");
  assert.equal(inspectContainer(scannerContainer, "{{.HostConfig.Memory}}"), "4294967296");
  assert.equal(inspectContainer(scannerContainer, "{{.HostConfig.NanoCpus}}"), "2000000000");
  assert.equal(inspectContainer(scannerContainer, "{{.HostConfig.PidsLimit}}"), "256");
  assert.equal(inspectContainer(scannerContainer, "{{.HostConfig.LogConfig.Type}}"), "json-file");
  assert.equal(
    inspectContainer(
      scannerContainer,
      "{{index .HostConfig.LogConfig.Config \"max-size\"}}",
    ),
    "10m",
  );
  assert.equal(
    inspectContainer(
      scannerContainer,
      "{{range .Mounts}}{{if eq .Destination \"/var/lib/clamav\"}}{{.Name}}{{end}}{{end}}",
    ),
    signatureVolumeName,
  );
  assert.equal(
    inspectContainer(
      scannerContainer,
      "{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}",
    ),
    networkName,
  );

  scannerCleanProof = scanWithProductClient(
    Buffer.from("EVO ClamAV clean validation\n", "utf8"),
    "clean",
  );
  assert.equal(scanWithProductClient(Buffer.from(EICAR, "ascii"), "infected").outcome, "infected");
  docker(["stop", "--time", "30", scannerContainer], {
    label: "stop disposable scanner for fail-closed proof",
  });
  assert.equal(
    scanWithProductClient(Buffer.from("scanner outage", "utf8"), "unavailable").outcome,
    "unavailable",
  );
  docker(["start", scannerContainer], { label: "restart disposable scanner" });
  waitForScannerHealth();
  assert.equal(
    scanWithProductClient(Buffer.from("scanner recovered", "utf8"), "clean").outcome,
    "clean",
  );

  docker(["image", "save", "--output", candidateArchive, candidateTag], {
    timeout: 5 * 60 * 1_000,
    label: "save unhealthy candidate archive",
  });
  docker(["image", "rm", "--force", candidateTag], {
    label: "remove candidate before archive load proof",
  });
  assert.equal(
    docker(["image", "inspect", candidateTag], { accepted: [0, 1] }).status,
    1,
    "candidate image must be absent before the controller loads the archive",
  );
  const deploy = runController(
    "deploy",
    candidateEnvironment(wahaRepository, wahaDigest),
    [3],
  );
  const deployResult = parseLastJsonLine(deploy.stdout);
  assert.equal(deployResult.ok, false);
  assert.equal(deployResult.command, "deploy");
  assert.equal(deployResult.status, "rolled_back");
  assert.equal(deployResult.code, "deployment_failed");
  assert.equal(typeof deployResult.evidenceDir, "string");
  assert.equal(dirname(deployResult.evidenceDir), evidenceRoot);

  const expectedEvidence = join(
    evidenceRoot,
    `${candidateVersion}-${candidateRevision.slice(0, 8)}-${runId}`,
  );
  assert.equal(realpathSync(deployResult.evidenceDir), realpathSync(expectedEvidence));
  const state = parseJson(join(expectedEvidence, "state.json"));
  const result = parseJson(join(expectedEvidence, "result.json"));
  assert.equal(state.schema, "evo-fast-release-state/v2");
  assert.equal(state.previousImage, baselineImageId);
  assert.equal(state.previousRevision, baselineRevision);
  assert.equal(state.previousScannerPresent, false);
  assert.equal(state.previousScannerImage, "");
  assert.equal(state.previousVersion, baselineVersion);
  assert.equal(state.rollbackTag, rollbackTag);
  assert.equal(state.targetRevision, candidateRevision);
  assert.equal(state.composeSha256, seed.composeSha256);
  assert.equal(state.appEnvSha256, seed.appEnvSha256);
  assert.deepEqual(result, {
    schema: "evo-fast-release/v1",
    status: "blocked",
    code: "deployment_failed",
    revision: candidateRevision,
    version: candidateVersion,
    image: candidateImageId,
    rolledBack: true,
  });

  const restoredApp = serviceContainer("app");
  assert.equal(inspectContainer(restoredApp, "{{.Image}}"), baselineImageId);
  assert.equal(
    inspectContainer(restoredApp, '{{index .Config.Labels "org.opencontainers.image.revision"}}'),
    baselineRevision,
  );
  assert.equal(
    inspectContainer(restoredApp, '{{index .Config.Labels "org.opencontainers.image.version"}}'),
    baselineVersion,
  );
  assert.equal(
    inspectContainer(
      restoredApp,
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
    ),
    "healthy",
  );
  assert.equal(inspectContainer(restoredApp, "{{.RestartCount}}"), "0");
  await assertHealthyHttp(baselineRevision, baselineVersion);
  assert.equal(serviceContainer("waha"), wahaContainer);
  assert.deepEqual(
    serviceContainerIds("clamav"),
    [],
    "rollback must remove the candidate scanner when the sealed baseline had none",
  );

  const staleRollback = runController(
    "rollback",
    {
      ...candidateEnvironment(wahaRepository, wahaDigest),
      EVO_RELEASE_ROLLBACK_STATE: join(expectedEvidence, "state.json"),
    },
    [2],
  );
  assert.deepEqual(parseLastJsonLine(staleRollback.stderr), {
    ok: false,
    code: "rollback_target_not_active",
  });
  assert.equal(inspectContainer(serviceContainer("app"), "{{.Image}}"), baselineImageId);
  await assertHealthyHttp(baselineRevision, baselineVersion);

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      status: "verified",
      code: "candidate_failed_and_exact_baseline_rolled_back",
      projectName,
      baselineImage: baselineImageId,
      baselineRevision,
      baselineVersion,
      candidateImage: candidateImageId,
      candidateRevision,
      candidateVersion,
      controllerExit: deploy.status,
      resultSchema: result.schema,
      stateSchema: state.schema,
      rolledBack: result.rolledBack,
      staleRollbackRefused: true,
      releaseLockTool,
      releaseLockContentionProved,
      scannerImage: CLAMAV_IMAGE,
      scannerEngine: scannerCleanProof.engine,
      scannerEngineVersion: scannerCleanProof.engineVersion,
      scannerSignatureVersion: scannerCleanProof.signatureVersion,
      scannerClean: "clean",
      scannerEicar: "infected",
      scannerOutage: "unavailable",
      scannerRecovery: "clean",
      scannerRemovedByRollback: true,
      providersCalled: false,
    })}\n`,
  );
}

try {
  await run();
} finally {
  cleanup();
}
