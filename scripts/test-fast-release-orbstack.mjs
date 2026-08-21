#!/usr/bin/env node

import { createServer } from "node:net";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const controller = join(repositoryRoot, "scripts", "evo-fast-release.sh");
const suffix = randomBytes(5).toString("hex");
const projectName = `evo-fast-${suffix}`;
const baselineRevision = randomBytes(20).toString("hex");
const candidateRevision = randomBytes(20).toString("hex");
const badRevision = randomBytes(20).toString("hex");
const baselineVersion = `baseline-${suffix}`;
const candidateVersion = `candidate-${suffix}`;
const badVersion = "bad-harness";
const successRunId = `success-${suffix}`;
const failureRunId = `failure-${suffix}`;
const baselineTag = `evo-crm:${baselineRevision}`;
const candidateTag = `evo-crm:${candidateRevision}`;
const badTag = `evo-crm:${badRevision}`;
const successRollbackTag = `evo-crm:rollback-${successRunId}`;
const failureRollbackTag = `evo-crm:rollback-${failureRunId}`;
const harnessRoot = mkdtempSync(join(tmpdir(), "evo-fast-release-"));
const stagingRoot = join(harnessRoot, "staging");
const evidenceRoot = join(harnessRoot, "evidence");
const deployRoot = join(harnessRoot, "deploy");
const composeFile = join(harnessRoot, "docker-compose.yml");
const appEnvFile = join(harnessRoot, ".env.production");
const candidateArchive = join(stagingRoot, "candidate.tar");
const badArchive = join(stagingRoot, "bad.tar");
const corruptArchive = join(stagingRoot, "corrupt.tar");
const corruptArchiveRoot = join(harnessRoot, "corrupt-archive");

function tail(value, size = 4_000) {
  const text = String(value ?? "");
  return text.length > size ? text.slice(-size) : text;
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const expectedStatuses = options.expectedStatuses ?? [0];
  if (!expectedStatuses.includes(result.status)) {
    throw new Error(
      `${options.label ?? command} failed with status ${result.status}\n${tail(result.stdout)}\n${tail(result.stderr)}`,
    );
  }
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function docker(args, options = {}) {
  return execute("docker", args, options);
}

function imageId(tag) {
  return docker(["image", "inspect", "--format", "{{.Id}}", tag], {
    label: `inspect ${tag}`,
  }).stdout;
}

function archiveSha256(path) {
  return execute("sha256sum", [path], { label: `hash ${path}` }).stdout.split(/\s+/u)[0];
}

function composeEnvironment(revision, version, port) {
  return {
    ...process.env,
    EVO_RELEASE_REVISION: revision,
    EVO_RELEASE_VERSION: version,
    EVO_HARNESS_PORT: String(port),
    EVO_CRM_APP_ENV_FILE: appEnvFile,
  };
}

function compose(args, environment) {
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
      appEnvFile,
      ...args,
    ],
    { env: environment, label: `docker compose ${args.join(" ")}` },
  );
}

function buildImage(tag, revision, version) {
  process.stdout.write(`Building ${version}...\n`);
  docker(
    [
      "build",
      "--quiet",
      "--platform",
      "linux/amd64",
      "--build-arg",
      "EVO_IMAGE_SOURCE=local-orbstack-release-harness",
      "--build-arg",
      `EVO_IMAGE_REVISION=${revision}`,
      "--build-arg",
      `EVO_IMAGE_VERSION=${version}`,
      "--tag",
      tag,
      ".",
    ],
    { label: `build ${version}` },
  );
  const platform = docker([
    "image",
    "inspect",
    "--format",
    "{{.Os}}/{{.Architecture}}",
    tag,
  ]).stdout;
  if (platform !== "linux/amd64") {
    throw new Error(`Unexpected image platform: ${platform}`);
  }
}

function controllerEnvironment({
  revision,
  version,
  runId,
  archive,
  archiveHash,
  expectedImageId,
  composeHash,
  healthUrl,
  port,
}) {
  return {
    ...process.env,
    EVO_RELEASE_ROOT: harnessRoot,
    EVO_RELEASE_PROJECT_NAME: projectName,
    EVO_RELEASE_STAGING_ROOT: stagingRoot,
    EVO_RELEASE_EVIDENCE_ROOT: evidenceRoot,
    EVO_RELEASE_COMPOSE_FILE: composeFile,
    EVO_RELEASE_APP_ENV_FILE: appEnvFile,
    EVO_RELEASE_EXTERNAL_HEALTH_URL: healthUrl,
    EVO_REQUIRED_HEALTHY_CONTAINERS: `${projectName}-app-1`,
    EVO_RELEASE_MIN_FREE_KB: "1048576",
    EVO_RELEASE_DOCKER_STORAGE_PATH: harnessRoot,
    EVO_WAHA_IMAGE_DIGEST: `sha256:${"0".repeat(64)}`,
    EVO_RELEASE_REVISION: revision,
    EVO_RELEASE_VERSION: version,
    EVO_RELEASE_RUN_ID: runId,
    EVO_RELEASE_ARCHIVE: archive,
    EVO_RELEASE_ARCHIVE_SHA256: archiveHash,
    EVO_RELEASE_EXPECTED_IMAGE_ID: expectedImageId,
    EVO_RELEASE_EXPECTED_COMPOSE_SHA256: composeHash,
    EVO_HARNESS_PORT: String(port),
  };
}

function runController(command, environment, expectedStatuses = [0]) {
  return execute("bash", [controller, command], {
    env: environment,
    expectedStatuses,
    label: `release controller ${command}`,
  });
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolvePort(port);
        else reject(new Error("Could not reserve a loopback port."));
      });
    });
  });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function currentRevision() {
  return docker([
    "inspect",
    "--format",
    '{{index .Config.Labels "org.opencontainers.image.revision"}}',
    `${projectName}-app-1`,
  ]).stdout;
}

function removeImageIfPresent(tag) {
  const inspected = spawnSync("docker", ["image", "inspect", tag], {
    stdio: "ignore",
  });
  if (inspected.status === 0) {
    docker(["image", "rm", "--force", tag], { label: `remove ${tag}` });
  }
}

function createArchiveWithMissingLayer(sourceArchive, targetArchive) {
  mkdirSync(corruptArchiveRoot, { recursive: true, mode: 0o700 });
  execute("tar", ["-xf", sourceArchive, "-C", corruptArchiveRoot], {
    label: "extract candidate archive fixture",
  });
  const manifest = JSON.parse(readFileSync(join(corruptArchiveRoot, "manifest.json"), "utf8"));
  const layerPath = manifest?.[0]?.Layers?.[0];
  if (typeof layerPath !== "string" || !/^(?:blobs\/sha256\/[0-9a-f]{64}|[0-9a-f]{64}\/layer\.tar)$/u.test(layerPath)) {
    throw new Error("Candidate archive did not expose a safe layer fixture path.");
  }
  const resolvedLayer = resolve(corruptArchiveRoot, layerPath);
  if (!resolvedLayer.startsWith(`${resolve(corruptArchiveRoot)}/`)) {
    throw new Error("Candidate archive layer escaped the fixture root.");
  }
  rmSync(resolvedLayer);
  execute(
    "tar",
    ["-cf", targetArchive, "-C", corruptArchiveRoot, ...readdirSync(corruptArchiveRoot)],
    { label: "create corrupt candidate archive fixture" },
  );
}

const port = await getFreePort();
const healthUrl = `http://127.0.0.1:${port}/api/health`;
let composeCreated = false;

try {
  assertEqual(execute("orb", ["status"]).stdout, "Running", "OrbStack must be running");
  assertEqual(docker(["context", "show"]).stdout, "orbstack", "Docker context must be OrbStack");

  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  mkdirSync(deployRoot, { recursive: true, mode: 0o700 });
  copyFileSync(join(repositoryRoot, "deploy", "env.production.example"), join(deployRoot, "env.production.example"));
  writeFileSync(
    appEnvFile,
    [
      `EVO_HARNESS_PORT=${port}`,
      "EVO_UI_CONTRACT_FIXTURES=0",
      `AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
      `EVO_SECRET_ENCRYPTION_KEY=${randomBytes(32).toString("base64url")}`,
      "NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_harness_only",
      "EVO_PLATFORM_WAHA_INGRESS_ENABLED=0",
      "EVO_PLATFORM_ORGANIZATION_ID=",
      "EVO_PLATFORM_SUPABASE_SECRET_KEY=",
      "EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET=",
      "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0",
      "EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=",
      "EVO_DB_PATH=/app/data/edu-admin.db",
      "EVO_BACKUP_DIR=/app/backups",
      "EVO_ALLOW_DEMO_SEED=0",
      "ANTHROPIC_API_KEY=",
      "ZAI_API_KEY=",
      "NEXT_PUBLIC_TRANSCRIPTION_SPLINE_SCENE_URL=",
      "EVO_ENABLE_LOCAL_TRANSCRIPTION=0",
      "EVO_CRM_DOMAIN=localhost",
      "EVO_CADDY_NETWORK=harness",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(appEnvFile, 0o600);
  writeFileSync(
    composeFile,
    `services:\n  app:\n    image: "evo-crm:\${EVO_RELEASE_REVISION:?set EVO_RELEASE_REVISION}"\n    labels:\n      org.opencontainers.image.revision: "\${EVO_RELEASE_REVISION}"\n      org.opencontainers.image.version: "\${EVO_RELEASE_VERSION}"\n    env_file:\n      - "\${EVO_CRM_APP_ENV_FILE}"\n    ports:\n      - "127.0.0.1:\${EVO_HARNESS_PORT}:3000"\n    healthcheck:\n      test:\n        - CMD-SHELL\n        - >-\n          test "$\${EVO_RELEASE_VERSION}" != "bad-harness" &&\n          node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"\n      interval: 2s\n      timeout: 2s\n      retries: 3\n      start_period: 2s\n`,
    { mode: 0o600 },
  );

  buildImage(baselineTag, baselineRevision, baselineVersion);
  buildImage(candidateTag, candidateRevision, candidateVersion);
  buildImage(badTag, badRevision, badVersion);

  const candidateImageId = imageId(candidateTag);
  const badImageId = imageId(badTag);
  docker(["save", "--output", candidateArchive, candidateTag], { label: "archive candidate" });
  docker(["save", "--output", badArchive, badTag], { label: "archive bad candidate" });
  createArchiveWithMissingLayer(candidateArchive, corruptArchive);
  removeImageIfPresent(candidateTag);
  removeImageIfPresent(badTag);

  const composeHash = archiveSha256(composeFile);
  const baseComposeEnv = composeEnvironment(baselineRevision, baselineVersion, port);
  composeCreated = true;
  compose(["up", "--detach", "--pull", "never", "--wait", "--wait-timeout", "120", "app"], baseComposeEnv);
  assertEqual(currentRevision(), baselineRevision, "Baseline revision");
  const health = JSON.parse(execute("curl", ["--fail", "--silent", healthUrl]).stdout);
  assertEqual(health.ok, true, "Public health status");
  assertEqual(health.service, "evo-crm", "Public health service");

  const corruptEnv = controllerEnvironment({
    revision: candidateRevision,
    version: candidateVersion,
    runId: `corrupt-${suffix}`,
    archive: corruptArchive,
    archiveHash: archiveSha256(corruptArchive),
    expectedImageId: candidateImageId,
    composeHash,
    healthUrl,
    port,
  });
  const corruptPreflight = runController("preflight", corruptEnv, [2]);
  if (!corruptPreflight.stderr.includes('"code":"archive_layers_invalid"')) {
    throw new Error(`Corrupt archive was not classified safely: ${tail(corruptPreflight.stderr)}`);
  }
  docker(["image", "inspect", candidateTag], {
    expectedStatuses: [1],
    label: "preflight must not load the corrupt candidate",
  });

  const candidateEnv = controllerEnvironment({
    revision: candidateRevision,
    version: candidateVersion,
    runId: successRunId,
    archive: candidateArchive,
    archiveHash: archiveSha256(candidateArchive),
    expectedImageId: candidateImageId,
    composeHash,
    healthUrl,
    port,
  });
  const deployed = JSON.parse(runController("deploy", candidateEnv).stdout);
  assertEqual(deployed.status, "deployed", "Candidate deployment status");
  assertEqual(currentRevision(), candidateRevision, "Candidate revision");

  const rollbackState = join(deployed.evidenceDir, "state.json");
  if (!existsSync(rollbackState)) throw new Error("Rollback state was not retained.");
  runController("rollback", { ...candidateEnv, EVO_RELEASE_ROLLBACK_STATE: rollbackState });
  assertEqual(currentRevision(), baselineRevision, "Manual rollback revision");

  const badEnv = controllerEnvironment({
    revision: badRevision,
    version: badVersion,
    runId: failureRunId,
    archive: badArchive,
    archiveHash: archiveSha256(badArchive),
    expectedImageId: badImageId,
    composeHash,
    healthUrl,
    port,
  });
  const failed = runController("deploy", badEnv, [3]);
  if (!failed.stdout.includes('"status":"rolled_back"')) {
    throw new Error(`Automatic rollback was not reported: ${tail(failed.stdout)}`);
  }
  assertEqual(currentRevision(), baselineRevision, "Automatic rollback revision");
  const failureEvidence = join(
    evidenceRoot,
    `${badVersion}-${badRevision.slice(0, 8)}-${failureRunId}`,
    "result.json",
  );
  const failureResult = JSON.parse(readFileSync(failureEvidence, "utf8"));
  assertEqual(failureResult.rolledBack, true, "Automatic rollback evidence");

  const status = JSON.parse(
    runController("status", {
      ...process.env,
      EVO_RELEASE_PROJECT_NAME: projectName,
    }).stdout,
  );
  assertEqual(status.revision, baselineRevision, "Final stable revision");
  assertEqual(status.health, "healthy", "Final health");
  process.stdout.write(
    "Fast release OrbStack harness passed: corrupt-archive rejection, health, deploy, manual rollback, and automatic rollback.\n",
  );
} finally {
  const cleanupEnvironment = composeEnvironment(baselineRevision, baselineVersion, port);
  if (composeCreated) {
    try {
      compose(["down", "--volumes", "--remove-orphans"], cleanupEnvironment);
    } catch (error) {
      process.stderr.write(`Harness Compose cleanup warning: ${error.message}\n`);
    }
  }
  for (const tag of [
    baselineTag,
    candidateTag,
    badTag,
    successRollbackTag,
    failureRollbackTag,
  ]) {
    try {
      removeImageIfPresent(tag);
    } catch (error) {
      process.stderr.write(`Harness image cleanup warning for ${tag}: ${error.message}\n`);
    }
  }
  if (harnessRoot.startsWith(`${tmpdir()}/evo-fast-release-`)) {
    rmSync(harnessRoot, { recursive: true, force: true });
  }
}
