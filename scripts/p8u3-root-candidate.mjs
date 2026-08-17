#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const APPLICATION = Object.freeze({
  commit: "b798c7d36be8e3325a9621d96e496ec0a2bb624f",
  tree: "eb3a8a863e014606e707bd279f67d9194663e30a",
  parent: "42dc877b6ce3a2c5c8f7f42c6adc192399322d07",
  ciRun: 32072948258,
  tag: "evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u3-linux-amd64",
  source: "https://github.com/izzhackt/evo_AI_CRM",
  version: "p8u3-b798c7d3-20260818",
  container: "evo-p8u3-smoke-b798c7d36be8",
  evidenceDirectory: "p8u3-root-b798c7d36be8e3325a9621d96e496ec0a2bb624f-20260818",
});

export const CONTROLLED_FILES = Object.freeze([
  "scripts/p8u3-root-candidate.mjs",
  "docs/schemas/p8u3-root-candidate.schema.json",
  "Dockerfile",
  "package.json",
  "package-lock.json",
]);

export const EVIDENCE_FILES = Object.freeze([
  "build-crm.log",
  "candidate-result.json",
  "collection-index.json",
  "image-identity.json",
  "sbom-crm.spdx.json",
  "smoke-crm.log",
]);

export const PRESERVED_P8U2 = Object.freeze({
  tag: "evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u2-linux-amd64",
  imageId: "sha256:1483c286f7d4db3f3bfcfb6eb262416e92290cea1e3666321005f4c73873114e",
  evidenceDirectory: "p8u2-root-b798c7d36be8e3325a9621d96e496ec0a2bb624f-20260818",
  files: Object.freeze({
    "build-crm.log": "c478bd933f8f89bb2a117a2d50cf5bd9612f8356d01d5ea3135ccf594227377a",
    "candidate-result.json": "c4416cbe6cfb78187275069035da248229594920624eb2c22d0811e24472a7ec",
    "image-identity.json": "8d0b470a7d67b39bc2f2703020cea7d18a9515fe86a2947bec4e6af23ed8f763",
  }),
});

const ARTIFACT_FILES = Object.freeze(["build-crm.log", "image-identity.json", "sbom-crm.spdx.json", "smoke-crm.log"]);
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = new RegExp(`\\b${UUID_SOURCE}\\b`, "i");
const UUID_GLOBAL = new RegExp(`\\b${UUID_SOURCE}\\b`, "gi");
const SYFT_DOCUMENT_NAMESPACE = new RegExp(`^https://anchore\\.com/syft/image/sha256-([0-9a-f]{64})-(${UUID_SOURCE})$`);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?<![A-Z0-9._%+-])\+\d{9,15}\b/i;
const CREDENTIAL = /(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/i;
const PRIVATE_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//;

function fail(message) {
  throw new Error(message);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWrite(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, typeof value === "string" ? value : jsonText(value), { mode: 0o600, flag: "wx" });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

function execResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? "utf8",
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    stdio: options.stdio,
  });
  if (result.error) throw result.error;
  return result;
}

function execText(command, args, options = {}) {
  const result = execResult(command, args, options);
  if (result.status !== 0) fail(`${command} failed`);
  return String(result.stdout ?? "").trim();
}

function textFromResult(result, command) {
  if (result.status !== 0) fail(`${command} failed`);
  return String(result.stdout ?? "").trim();
}

export function createDockerExecutor(runCommand = execResult) {
  function verify() {
    const orb = textFromResult(runCommand("orb", ["status"]), "orb");
    const context = textFromResult(runCommand("docker", ["context", "show"]), "docker context show");
    if (orb !== "Running") fail("orb status must be exactly Running");
    if (context !== "orbstack") fail("docker context show must be exactly orbstack");
  }
  return {
    verify,
    result(args, options = {}) {
      verify();
      return runCommand("docker", args, options);
    },
    text(args, options = {}) {
      return textFromResult(this.result(args, options), "docker");
    },
  };
}

const docker = createDockerExecutor();

function assertRegularMode(path, mode) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(`${basename(path)} must be a regular non-symlink file`);
  if ((stats.mode & 0o777) !== mode) fail(`${basename(path)} must have mode ${mode.toString(8)}`);
}

function assertDirectoryMode(path, mode) {
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(`${basename(path)} must be a real non-symlink directory`);
  if ((stats.mode & 0o777) !== mode) fail(`${basename(path)} must have mode ${mode.toString(8)}`);
}

function assertContained(sourceRoot, path) {
  const source = realpathSync(sourceRoot);
  const actual = realpathSync(path);
  const child = relative(source, actual);
  if (child === "" || child === ".." || child.startsWith("../")) fail("evidence path escapes application source");
  return actual;
}

export function prepareEvidencePaths(sourceRoot) {
  const source = realpathSync(sourceRoot);
  const parent = join(source, ".evo-release-evidence");
  const root = join(parent, APPLICATION.evidenceDirectory);
  if (existsSync(parent)) {
    assertDirectoryMode(parent, 0o700);
    assertContained(source, parent);
  } else {
    mkdirSync(parent, { mode: 0o700 });
    chmodSync(parent, 0o700);
    assertDirectoryMode(parent, 0o700);
    assertContained(source, parent);
  }
  if (existsSync(root)) fail("evidence root already exists");
  return { parent, root };
}

export function verifyPreservedP8U2Evidence(sourceRoot, boundary = PRESERVED_P8U2) {
  const source = realpathSync(sourceRoot);
  const parent = join(source, ".evo-release-evidence");
  const root = join(parent, boundary.evidenceDirectory);
  assertDirectoryMode(parent, 0o700);
  assertContained(source, parent);
  assertDirectoryMode(root, 0o700);
  assertContained(source, root);
  const expectedFiles = Object.keys(boundary.files).sort();
  if (JSON.stringify(readdirSync(root).sort()) !== JSON.stringify(expectedFiles)) fail("preserved P8U2 evidence allowlist drift");
  for (const file of expectedFiles) {
    const path = join(root, file);
    assertRegularMode(path, 0o600);
    if (sha256File(path) !== boundary.files[file]) fail("preserved P8U2 evidence hash drift");
  }
  return root;
}

function assertEvidencePaths(source, parent, root) {
  assertDirectoryMode(parent, 0o700);
  assertContained(source, parent);
  assertDirectoryMode(root, 0o700);
  assertContained(source, root);
}

function isCanonicalSpdxContact(path, value) {
  if (path.length !== 3 || path[0] !== "packages" || !Number.isInteger(path[1])) return false;
  if (path[2] === "originator") return /^Person: [^\r\n]{1,2048}$/i.test(value) && EMAIL.test(value) && !PHONE.test(value);
  if (path[2] === "downloadLocation") return /^git@[a-z0-9.-]+:[a-z0-9._/-]+(?:\.git)?$/i.test(value);
  return false;
}

function canonicalSpdxNamespace(value, imageId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("SPDX namespace document must be an object");
  if (!DIGEST.test(imageId ?? "")) fail("SPDX namespace requires an immutable image ID");
  const match = typeof value.documentNamespace === "string" ? value.documentNamespace.match(SYFT_DOCUMENT_NAMESPACE) : null;
  if (!match) fail("SPDX documentNamespace is not the canonical Syft image namespace");
  if (match[1].toLowerCase() !== imageId.slice("sha256:".length)) fail("SPDX documentNamespace image digest mismatch");
  return { namespace: value.documentNamespace, uuid: match[2].toLowerCase() };
}

function isCanonicalSpdxNamespaceValue(path, value, { spdx, imageId, namespaceUuid }) {
  if (!spdx || path.length !== 1 || path[0] !== "documentNamespace") return false;
  const match = value.match(SYFT_DOCUMENT_NAMESPACE);
  return Boolean(
    match
    && DIGEST.test(imageId ?? "")
    && match[1].toLowerCase() === imageId.slice("sha256:".length)
    && match[2].toLowerCase() === namespaceUuid,
  );
}

export function scanArtifactPrivacy(value, options = {}, path = []) {
  const { spdx = false, imageId, namespaceUuid } = options;
  if (typeof value === "string") {
    if (CREDENTIAL.test(value) || PRIVATE_PATH.test(value)) fail("artifact contains sensitive-looking content");
    if (UUID.test(value) && !isCanonicalSpdxNamespaceValue(path, value, { spdx, imageId, namespaceUuid })) fail("artifact contains non-allowlisted UUID content");
    if ((EMAIL.test(value) || PHONE.test(value)) && !(spdx && isCanonicalSpdxContact(path, value))) fail("artifact contains sensitive-looking contact data");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanArtifactPrivacy(item, options, [...path, index]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      scanArtifactPrivacy(key, { spdx: false }, [...path, key, "$key"]);
      scanArtifactPrivacy(item, options, [...path, key]);
    }
  }
}

function scanRawArtifactPrivacy(raw, { allowedUuid } = {}) {
  if (CREDENTIAL.test(raw) || PRIVATE_PATH.test(raw)) fail("artifact contains sensitive-looking raw content");
  const matches = [...raw.matchAll(UUID_GLOBAL)].map((match) => match[0].toLowerCase());
  if (matches.length === 0) return;
  if (!allowedUuid || matches.length !== 1 || matches[0] !== allowedUuid) fail("artifact contains non-allowlisted raw UUID content");
}

export function scanArtifactFile(path, { spdx = false, imageId } = {}) {
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    const value = JSON.parse(raw);
    const namespace = spdx ? canonicalSpdxNamespace(value, imageId) : null;
    scanRawArtifactPrivacy(raw, { allowedUuid: namespace?.uuid });
    scanArtifactPrivacy(value, { spdx, imageId, namespaceUuid: namespace?.uuid });
    return;
  }
  scanRawArtifactPrivacy(raw);
  scanArtifactPrivacy(raw);
}

export function validatePreservedP8U2Image(inventory, image, boundary = PRESERVED_P8U2) {
  if (!(inventory instanceof Map) || inventory.get(boundary.tag) !== boundary.imageId) fail("preserved P8U2 tag/image binding drift");
  if (!image || image.Id !== boundary.imageId) fail("preserved P8U2 immutable image drift");
  const platform = { os: image.Os, architecture: image.Architecture, variant: image.Variant ?? "" };
  if (JSON.stringify(platform) !== JSON.stringify({ os: "linux", architecture: "amd64", variant: "" })) fail("preserved P8U2 platform drift");
  const labels = image.Config?.Labels ?? {};
  if (
    labels["org.opencontainers.image.source"] !== APPLICATION.source
    || labels["org.opencontainers.image.revision"] !== APPLICATION.commit
    || labels["org.opencontainers.image.version"] !== "p8u2-b798c7d3-20260818"
  ) fail("preserved P8U2 OCI label drift");
}

function verifyPreservedP8U2(source) {
  verifyPreservedP8U2Evidence(source);
  const before = dockerImageInventory();
  const values = JSON.parse(docker.text(["image", "inspect", PRESERVED_P8U2.imageId]));
  if (!Array.isArray(values) || values.length !== 1) fail("preserved P8U2 image inspect cardinality mismatch");
  validatePreservedP8U2Image(before, values[0]);
  const after = dockerImageInventory();
  if (after.get(PRESERVED_P8U2.tag) !== PRESERVED_P8U2.imageId) fail("preserved P8U2 tag changed during verification");
}

function withPreservedP8U2(source, effect) {
  verifyPreservedP8U2(source);
  const value = effect();
  verifyPreservedP8U2(source);
  return value;
}

export function parseImageInventory(text) {
  const rows = new Map();
  for (const line of String(text).split(/\r?\n/).filter(Boolean)) {
    const parts = line.split("|");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !DIGEST.test(parts[2])) fail("malformed Docker image inventory row");
    const tag = `${parts[0]}:${parts[1]}`;
    if (rows.has(tag)) fail("duplicate Docker image inventory row");
    rows.set(tag, parts[2]);
  }
  return rows;
}

export function parseContainerInventory(text) {
  const names = new Map();
  for (const line of String(text).split(/\r?\n/).filter(Boolean)) {
    const parts = line.split("|");
    if (parts.length !== 2 || !/^[0-9a-f]{64}$/.test(parts[0]) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(parts[1]) || names.has(parts[1])) fail("malformed or duplicate Docker container inventory row");
    names.set(parts[1], parts[0]);
  }
  return names;
}

const schemaPath = new URL("../docs/schemas/p8u3-root-candidate.schema.json", import.meta.url);
const resultSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
const validateSchema = new Ajv2020({ strict: false }).compile(resultSchema);

export function validateCandidateResult(value) {
  if (!validateSchema(value)) fail(`candidate result schema mismatch: ${JSON.stringify(validateSchema.errors)}`);
  return value;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("arguments must be --key value pairs");
    values[key.slice(2)] = value;
  }
  if (!values["source-root"]) fail("--source-root is required");
  return values;
}

function verifyApplicationSource(sourceRoot) {
  const root = realpathSync(resolve(sourceRoot));
  const commit = execText("git", ["-C", root, "rev-parse", "HEAD"]);
  const tree = execText("git", ["-C", root, "rev-parse", "HEAD^{tree}"]);
  const parent = execText("git", ["-C", root, "rev-parse", "HEAD^"]);
  const status = execText("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"]);
  if (commit !== APPLICATION.commit || tree !== APPLICATION.tree || parent !== APPLICATION.parent || status !== "") fail("application source identity is not exact and clean");
  return root;
}

function verifyReleaseControl(toolRoot) {
  execText("git", ["-C", toolRoot, "fetch", "origin", "main", "--prune"]);
  const commit = execText("git", ["-C", toolRoot, "rev-parse", "HEAD"]);
  const main = execText("git", ["-C", toolRoot, "rev-parse", "origin/main"]);
  const tree = execText("git", ["-C", toolRoot, "rev-parse", "HEAD^{tree}"]);
  const status = execText("git", ["-C", toolRoot, "status", "--porcelain=v1", "--untracked-files=all"]);
  if (!SHA.test(commit) || commit !== main || status !== "") fail("release-control checkout must be clean current main");
  const runs = JSON.parse(execText("gh", ["run", "list", "--workflow", "EVO platform CI", "--commit", commit, "--event", "push", "--limit", "10", "--json", "databaseId,status,conclusion,headSha"]));
  const successful = runs.filter((run) => run.headSha === commit && run.status === "completed" && run.conclusion === "success");
  if (successful.length !== 1) fail("release-control exact-main push CI must be singular and successful");
  const files = CONTROLLED_FILES.map((file) => ({ file, sha256: sha256File(join(toolRoot, file)) }));
  return { commit, tree, ci_run: successful[0].databaseId, files };
}

function verifyOrbStack() {
  docker.verify();
}

function dockerImageInventory() {
  return parseImageInventory(docker.text(["image", "ls", "--no-trunc", "--format", "{{.Repository}}|{{.Tag}}|{{.ID}}"]));
}

function dockerContainerInventory() {
  return parseContainerInventory(docker.text(["container", "ls", "-a", "--no-trunc", "--format", "{{.ID}}|{{.Names}}"]));
}

function artifactRecord(root, file) {
  const path = join(root, file);
  assertRegularMode(path, 0o600);
  const stats = statSync(path);
  return { file, mode: 600, size: stats.size, sha256: sha256File(path) };
}

function copyEvidence(source, destination) {
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  chmodSync(destination, 0o600);
  assertRegularMode(destination, 0o600);
}

function inspectImage() {
  const values = JSON.parse(docker.text(["image", "inspect", APPLICATION.tag]));
  if (!Array.isArray(values) || values.length !== 1) fail("image inspect must return exactly one image");
  const image = values[0];
  const labels = image.Config?.Labels ?? {};
  const platform = { os: image.Os, architecture: image.Architecture, variant: image.Variant ?? "" };
  if (!DIGEST.test(image.Id) || platform.os !== "linux" || platform.architecture !== "amd64" || platform.variant !== "") fail("image platform identity mismatch");
  if (labels["org.opencontainers.image.source"] !== APPLICATION.source || labels["org.opencontainers.image.revision"] !== APPLICATION.commit || labels["org.opencontainers.image.version"] !== APPLICATION.version) fail("image OCI label mismatch");
  if (image.Config?.User !== "nextjs") fail("image configured user must be nextjs");
  return { image, platform, labels };
}

function runBuild(sourceRoot, logPath) {
  writeFileSync(logPath, `candidate_commit=${APPLICATION.commit}\nplatform=linux/amd64\n`, { mode: 0o600, flag: "wx" });
  const fd = openSync(logPath, "a");
  let result;
  try {
    result = docker.result([
      "buildx", "build", "--platform", "linux/amd64", "--load", "--tag", APPLICATION.tag,
      "--build-arg", `EVO_IMAGE_SOURCE=${APPLICATION.source}`,
      "--build-arg", `EVO_IMAGE_REVISION=${APPLICATION.commit}`,
      "--build-arg", `EVO_IMAGE_VERSION=${APPLICATION.version}`,
      sourceRoot,
    ], { stdio: ["ignore", fd, fd] });
  } finally {
    closeSync(fd);
  }
  writeFileSync(logPath, `exit_code=${result.status ?? 1}\n`, { flag: "a" });
  chmodSync(logPath, 0o600);
  if (result.status !== 0) fail("docker buildx build failed");
  writeFileSync(logPath, `Image ${APPLICATION.tag} Built\n`, { flag: "a" });
}

function generateSbom(path, imageId) {
  const versionText = docker.text(["sbom", "version"]);
  const match = versionText.match(/Application:\s+(docker-sbom)\s+\((\d+\.\d+\.\d+)\)/);
  if (!match) fail("unexpected docker sbom version");
  const fd = openSync(path, "wx", 0o600);
  let result;
  try {
    result = docker.result(["sbom", "--format", "spdx-json", imageId], { stdio: ["ignore", fd, "pipe"] });
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o600);
  if (result.status !== 0) fail("docker sbom failed");
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value.spdxVersion !== "string" || !value.spdxVersion.startsWith("SPDX-")) fail("SBOM is not SPDX JSON");
  scanArtifactFile(path, { spdx: true, imageId });
  return { tool: `${match[1]} ${match[2]}`, value };
}

function waitForHealth(container) {
  const program = `fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(2000)}).then(async r=>{const b=await r.json();console.log(JSON.stringify({status:r.status,body:b}))}).catch(()=>process.exit(3))`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker.result(["exec", container, "node", "-e", program]);
    if (result.status === 0) {
      const value = JSON.parse(String(result.stdout).trim());
      if (value.status === 200 && JSON.stringify(value.body) === JSON.stringify({ ok: true, status: "live", service: "evo-crm" })) return value;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  fail("health probe timed out");
}

function probeDisabledRoute(container) {
  const body = JSON.stringify({ audience: "internal", turns: [{ role: "user", text: "private disabled-route probe" }] });
  const program = `const body=process.argv[1];fetch("http://127.0.0.1:3000/api/platform-ai/staff-assistant",{method:"POST",headers:{"content-type":"application/json",origin:"http://127.0.0.1:3000"},body,signal:AbortSignal.timeout(2000)}).then(async r=>{const b=await r.json();console.log(JSON.stringify({status:r.status,body:b}))}).catch(()=>process.exit(3))`;
  const result = docker.result(["exec", container, "node", "-e", program, body]);
  if (result.status !== 0) fail("disabled route probe failed");
  const value = JSON.parse(String(result.stdout).trim());
  if (value.status !== 503 || JSON.stringify(value.body) !== JSON.stringify({ error: { code: "assistant_disabled" } })) fail("disabled route response mismatch");
  return value;
}

export function removeOwnedContainer(containerId, executor = docker) {
  if (!containerId) return true;
  const before = parseContainerInventory(executor.text(["container", "ls", "-a", "--no-trunc", "--format", "{{.ID}}|{{.Names}}"]));
  const current = before.get(APPLICATION.container);
  if (current === undefined) return true;
  if (current !== containerId) fail("refusing to remove a foreign smoke container");
  const removed = executor.result(["rm", "-f", containerId]);
  if (removed.status !== 0) fail("smoke container cleanup failed");
  const after = parseContainerInventory(executor.text(["container", "ls", "-a", "--no-trunc", "--format", "{{.ID}}|{{.Names}}"]));
  if (after.has(APPLICATION.container) || [...after.values()].includes(containerId)) fail("smoke container remains after cleanup");
  return true;
}

function runSmoke(logPath, imageId, onCreated) {
  if (dockerContainerInventory().has(APPLICATION.container)) fail("smoke container already exists");
  const secret = randomBytes(32).toString("hex");
  const created = docker.text([
    "run", "-d", "--platform", "linux/amd64", "--name", APPLICATION.container,
    "--network", "none", "--restart", "no",
    "-e", "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1",
    "-e", `EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=${secret}`,
    imageId,
  ]);
  if (!/^[0-9a-f]{64}$/.test(created)) fail("docker run did not return one container ID");
  onCreated(created);
  let primaryError;
  try {
    const inspectValues = JSON.parse(docker.text(["container", "inspect", created]));
    if (!Array.isArray(inspectValues) || inspectValues.length !== 1) fail("container inspect mismatch");
    const inspect = inspectValues[0];
    if (inspect.Id !== created || inspect.Image !== imageId) fail("container immutable image identity mismatch");
    if (inspect.HostConfig?.NetworkMode !== "none" || inspect.HostConfig?.RestartPolicy?.Name !== "no" || (inspect.Mounts ?? []).length !== 0) fail("container isolation mismatch");
    const uid = Number(docker.text(["exec", created, "id", "-u"]));
    const gid = Number(docker.text(["exec", created, "id", "-g"]));
    if (uid !== 1001 || gid !== 1001) fail("container runtime user mismatch");
    const health = waitForHealth(created);
    const disabled = probeDisabledRoute(created);
    const restartValues = JSON.parse(docker.text(["container", "inspect", created]));
    if (!Array.isArray(restartValues) || restartValues.length !== 1 || restartValues[0].Id !== created || restartValues[0].Image !== imageId) fail("container identity drifted during smoke");
    const restartCount = Number(restartValues[0].RestartCount);
    if (restartCount !== 0) fail("smoke container restarted");
    const safe = [
      "result=liveness_and_disabled_route_verified",
      "platform=linux/amd64",
      "network=none",
      "mount_count=0",
      "caller_credential_count=0",
      "configured_user=nextjs",
      "runtime_uid=1001",
      "runtime_gid=1001",
      "restart_policy=no",
      "restart_count=0",
      "health_http_status=200",
      "assistant_http_status=503",
      "assistant_error_code=assistant_disabled",
      "provider_calls=0",
    ].join("\n") + "\n";
    writeFileSync(logPath, safe, { mode: 0o600, flag: "wx" });
    return { uid, gid, health, disabled, restartCount };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      removeOwnedContainer(created);
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
    }
  }
}

function writeFailure(source, parent, root, releaseControl, failureStep, resultCode, cleanup) {
  if (!existsSync(root)) {
    assertDirectoryMode(parent, 0o700);
    assertContained(source, parent);
    mkdirSync(root, { mode: 0o700 });
  }
  assertEvidencePaths(source, parent, root);
  const value = validateCandidateResult({
    schema_version: 1,
    result_code: resultCode,
    generated_at: new Date().toISOString(),
    failure_step: failureStep,
    application: { commit: APPLICATION.commit, tree: APPLICATION.tree, parent: APPLICATION.parent, ci_run: APPLICATION.ciRun },
    release_control: releaseControl,
    cleanup,
  });
  const resultPath = join(root, "candidate-result.json");
  if (!existsSync(resultPath)) atomicWrite(resultPath, value);
}

export function verifyFinalRoot(source, parent, root, result) {
  assertEvidencePaths(source, parent, root);
  const actual = readdirSync(root).sort();
  if (JSON.stringify(actual) !== JSON.stringify(EVIDENCE_FILES)) fail("retained evidence root allowlist mismatch");
  for (const file of EVIDENCE_FILES) assertRegularMode(join(root, file), 0o600);
  const parsed = JSON.parse(readFileSync(join(root, "candidate-result.json"), "utf8"));
  validateCandidateResult(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(result)) fail("retained result drift");
  const artifacts = ARTIFACT_FILES.map((file) => artifactRecord(root, file));
  if (JSON.stringify(parsed.collection.artifacts) !== JSON.stringify(artifacts)) fail("result artifact graph drift");
  const indexPath = join(root, "collection-index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const expectedIndex = { schema_version: 1, application_commit: APPLICATION.commit, files: artifacts };
  if (JSON.stringify(index) !== JSON.stringify(expectedIndex)) fail("collection index graph drift");
  if (parsed.collection.index_sha256 !== sha256File(indexPath)) fail("collection index hash drift");
  const expectedIdentity = {
    schema_version: 1,
    application_commit: APPLICATION.commit,
    tag: parsed.target.tag,
    image_id: parsed.target.image_id,
    platform: parsed.target.platform,
    labels: parsed.target.labels,
    configured_user: parsed.target.configured_user,
  };
  const identity = JSON.parse(readFileSync(join(root, "image-identity.json"), "utf8"));
  if (JSON.stringify(identity) !== JSON.stringify(expectedIdentity)) fail("image identity graph drift");
  if (parsed.build.sha256 !== sha256File(join(root, parsed.build.file))) fail("build hash drift");
  if (parsed.sbom.sha256 !== sha256File(join(root, parsed.sbom.file)) || parsed.sbom.image_id !== parsed.target.image_id) fail("SBOM graph drift");
  if (parsed.smoke.sha256 !== sha256File(join(root, parsed.smoke.file))) fail("smoke hash drift");
  for (const file of EVIDENCE_FILES) scanArtifactFile(join(root, file), { spdx: file === "sbom-crm.spdx.json", imageId: parsed.target.image_id });
}

export function runP8U3({ sourceRoot }) {
  const toolRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const source = verifyApplicationSource(sourceRoot);
  if (source === toolRoot) fail("application source and release-control checkout must be separate");
  const releaseControl = verifyReleaseControl(toolRoot);
  verifyPreservedP8U2(source);
  verifyOrbStack();
  const { parent: evidenceParent, root: evidenceRoot } = withPreservedP8U2(source, () => prepareEvidencePaths(source));
  if (dockerImageInventory().has(APPLICATION.tag)) fail("target image tag already exists");
  if (dockerContainerInventory().has(APPLICATION.container)) fail("smoke container already exists");

  const tempRoot = mkdtempSync(join(tmpdir(), "evo-p8u3-"));
  chmodSync(tempRoot, 0o700);
  let failureStep = "operation";
  let cleanup = { status: "verified", container_absent: true, temp_absent: true };
  let ownedContainerId;
  try {
    verifyOrbStack();
    failureStep = "build";
    const tempBuild = join(tempRoot, "build-crm.log");
    withPreservedP8U2(source, () => runBuild(source, tempBuild));
    withPreservedP8U2(source, () => {
      mkdirSync(evidenceRoot, { mode: 0o700 });
      assertEvidencePaths(source, evidenceParent, evidenceRoot);
      copyEvidence(tempBuild, join(evidenceRoot, "build-crm.log"));
    });

    verifyOrbStack();
    failureStep = "image_identity";
    const { image, platform, labels } = inspectImage();
    const inventoryId = dockerImageInventory().get(APPLICATION.tag);
    if (inventoryId !== image.Id) fail("post-build tag inventory does not bind inspected image ID");
    const imageIdentity = {
      schema_version: 1,
      application_commit: APPLICATION.commit,
      tag: APPLICATION.tag,
      image_id: image.Id,
      platform,
      labels: { source: labels["org.opencontainers.image.source"], revision: labels["org.opencontainers.image.revision"], version: labels["org.opencontainers.image.version"] },
      configured_user: image.Config.User,
    };
    withPreservedP8U2(source, () => {
      assertEvidencePaths(source, evidenceParent, evidenceRoot);
      atomicWrite(join(evidenceRoot, "image-identity.json"), imageIdentity);
    });

    verifyOrbStack();
    failureStep = "sbom";
    const tempSbom = join(tempRoot, "sbom-crm.spdx.json");
    const sbomInfo = withPreservedP8U2(source, () => generateSbom(tempSbom, image.Id));
    withPreservedP8U2(source, () => {
      assertEvidencePaths(source, evidenceParent, evidenceRoot);
      copyEvidence(tempSbom, join(evidenceRoot, "sbom-crm.spdx.json"));
    });

    verifyOrbStack();
    failureStep = "smoke";
    const tempSmoke = join(tempRoot, "smoke-crm.log");
    const smokeInfo = withPreservedP8U2(source, () => runSmoke(tempSmoke, image.Id, (id) => { ownedContainerId = id; }));
    withPreservedP8U2(source, () => {
      assertEvidencePaths(source, evidenceParent, evidenceRoot);
      copyEvidence(tempSmoke, join(evidenceRoot, "smoke-crm.log"));
    });

    failureStep = "privacy";
    for (const file of ARTIFACT_FILES) {
      scanArtifactFile(join(evidenceRoot, file), { spdx: file === "sbom-crm.spdx.json", imageId: image.Id });
    }

    const artifacts = ARTIFACT_FILES.map((file) => artifactRecord(evidenceRoot, file));
    const collectionIndex = { schema_version: 1, application_commit: APPLICATION.commit, files: artifacts };
    withPreservedP8U2(source, () => {
      assertEvidencePaths(source, evidenceParent, evidenceRoot);
      atomicWrite(join(evidenceRoot, "collection-index.json"), collectionIndex);
    });
    const indexSha = sha256File(join(evidenceRoot, "collection-index.json"));

    withPreservedP8U2(source, () => rmSync(tempRoot, { recursive: true, force: false }));
    cleanup = { status: "verified", container_absent: !dockerContainerInventory().has(APPLICATION.container), temp_absent: !existsSync(tempRoot) };
    if (!cleanup.container_absent || !cleanup.temp_absent) fail("cleanup verification failed");

    const result = validateCandidateResult({
      schema_version: 1,
      result_code: "candidate_verified",
      generated_at: new Date().toISOString(),
      application: { commit: APPLICATION.commit, tree: APPLICATION.tree, parent: APPLICATION.parent, ci_run: APPLICATION.ciRun },
      release_control: releaseControl,
      target: {
        tag: APPLICATION.tag,
        image_id: image.Id,
        platform,
        labels: imageIdentity.labels,
        configured_user: image.Config.User,
        runtime_uid: smokeInfo.uid,
        runtime_gid: smokeInfo.gid,
      },
      build: { status: "verified", exit_code: 0, file: "build-crm.log", sha256: sha256File(join(evidenceRoot, "build-crm.log")) },
      sbom: { status: "verified", exit_code: 0, file: "sbom-crm.spdx.json", sha256: sha256File(join(evidenceRoot, "sbom-crm.spdx.json")), format: "spdx-json", tool: sbomInfo.tool, image_id: image.Id },
      smoke: {
        status: "verified", file: "smoke-crm.log", sha256: sha256File(join(evidenceRoot, "smoke-crm.log")), container: APPLICATION.container,
        network: "none", mount_count: 0, caller_credential_count: 0, restart_policy: "no", restart_count: smokeInfo.restartCount,
        health: { http_status: smokeInfo.health.status, body: smokeInfo.health.body },
        assistant_disabled: { http_status: smokeInfo.disabled.status, body: smokeInfo.disabled.body },
      },
      privacy: { status: "verified" },
      cleanup,
      collection: { status: "verified", index_file: "collection-index.json", index_sha256: indexSha, retained_files: [...EVIDENCE_FILES], artifacts },
    });
    withPreservedP8U2(source, () => {
      assertEvidencePaths(source, evidenceParent, evidenceRoot);
      atomicWrite(join(evidenceRoot, "candidate-result.json"), result);
    });
    verifyFinalRoot(source, evidenceParent, evidenceRoot, result);
    verifyPreservedP8U2(source);
    return { evidenceRoot, result };
  } catch (error) {
    let cleanupFailed = false;
    let containerAbsent = false;
    try {
      removeOwnedContainer(ownedContainerId);
    } catch {
      cleanupFailed = true;
    }
    try {
      const current = dockerContainerInventory().get(APPLICATION.container);
      containerAbsent = current === undefined;
      if (current !== undefined && current !== ownedContainerId) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
    try {
      if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: false });
    } catch {
      cleanupFailed = true;
    }
    try {
      verifyPreservedP8U2(source);
    } catch {
      cleanupFailed = true;
    }
    cleanup = { status: cleanupFailed ? "failed" : "verified", container_absent: containerAbsent, temp_absent: !existsSync(tempRoot) };
    const resultCode = cleanupFailed ? "cleanup_failed" : ({ build: "build_failed", image_identity: "identity_failed", sbom: "sbom_failed", smoke: "smoke_failed", privacy: "privacy_failed" }[failureStep] ?? "operation_failed");
    try { writeFailure(source, evidenceParent, evidenceRoot, releaseControl, cleanupFailed ? "cleanup" : failureStep, resultCode, cleanup); } catch {}
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { evidenceRoot, result } = runP8U3({ sourceRoot: args["source-root"] });
  process.stdout.write(`${JSON.stringify({ result_code: result.result_code, evidence_root_name: basename(evidenceRoot), result_sha256: sha256File(join(evidenceRoot, "candidate-result.json")) })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`P8U3 failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
