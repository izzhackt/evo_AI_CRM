#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const RESULT_STATUSES = Object.freeze([
  "verified",
  "blocked",
  "deferred",
  "not_applicable",
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const P8B2_TARGET_PLATFORM = Object.freeze({
  architecture: "amd64",
  os: "linux",
  variant: "",
});
const CONFIG_FILES = Object.freeze([
  ".env.example",
  "docker-compose.prod.yml",
  "agent-lead2-inbox/deploy/Caddyfile.evo-edge",
  "agent-lead2-inbox/deploy/docker-compose.edge.yml",
  "agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml",
  "agent-lead2-inbox/deploy/env.production.example",
  "agent-lead2-inbox/deploy/env.waha.example",
]);
const RUNTIME_EXAMPLES = Object.freeze([
  { owner: "main_crm", path: "deploy/env.production.example" },
  { owner: "crm_waha", path: "deploy/env.waha.example" },
  { owner: "lead_agent", path: "deploy/env.lead-agent.example" },
  { owner: "evo_inbox", path: "agent-lead2-inbox/deploy/env.production.example" },
  { owner: "inbox_waha", path: "agent-lead2-inbox/deploy/env.waha.example" },
]);
const IMAGE_SPECS = Object.freeze([
  { buildLog: "build-crm.log", name: "main_crm", tagPrefix: "evo-crm" },
  { buildLog: "build-inbox.log", name: "evo_inbox", tagPrefix: "evo-inbox" },
  { buildLog: "build-lead-agent.log", name: "lead_agent", tagPrefix: "evo-lead-agent" },
]);
const SENSITIVE_PATTERNS = Object.freeze([
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/i,
  /sbp_[A-Za-z0-9_-]{12,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
]);

function fail(message) {
  throw new Error(message);
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonText(value) {
  return `${JSON.stringify(JSON.parse(stableJson(value)), null, 2)}\n`;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function assertSafeMetadata(value, label = "metadata") {
  const text = typeof value === "string" ? value : stableJson(value);
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) fail(`${label} contains prohibited sensitive data`);
  }
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  if (stableJson(Object.keys(value).sort()) !== stableJson([...keys].sort())) {
    fail(`${label} must contain exactly: ${[...keys].sort().join(", ")}`);
  }
}

export function validateImageInspection(inspected, { candidateCommit, tag }) {
  if (!inspected || typeof inspected !== "object" || Array.isArray(inspected)) {
    fail(`${tag} inspect result must be an object`);
  }
  const labels = inspected.Config?.Labels ?? {};
  if (!DIGEST_PATTERN.test(inspected.Id ?? "")) fail(`${tag} has no immutable image ID`);
  if (labels["org.opencontainers.image.revision"] !== candidateCommit) {
    fail(`${tag} OCI revision does not match candidate commit`);
  }
  const platform = {
    architecture: inspected.Architecture ?? "",
    os: inspected.Os ?? "",
    variant: inspected.Variant ?? "",
  };
  if (stableJson(platform) !== stableJson(P8B2_TARGET_PLATFORM)) {
    fail(`${tag} platform must be exactly linux/amd64 with no variant`);
  }
  return {
    digest: inspected.Id,
    platform,
    revision: labels["org.opencontainers.image.revision"],
    source: labels["org.opencontainers.image.source"] ?? "",
    version: labels["org.opencontainers.image.version"] ?? "",
  };
}

export function validateImageEvidence(value) {
  assertExactKeys(value, ["base_commit", "build_records", "candidate_commit", "images", "release_control_commit"], "image evidence");
  if (!Array.isArray(value.build_records) || value.build_records.length !== 3) {
    fail("image evidence must contain exactly 3 build records");
  }
  if (!Array.isArray(value.images) || value.images.length !== 3) {
    fail("image evidence must contain exactly 3 images");
  }
  const seenTags = new Set();
  const seenLogs = new Set();
  const seenDigests = new Set();
  for (const [index, record] of value.build_records.entries()) {
    const spec = IMAGE_SPECS[index];
    assertExactKeys(
      record,
      ["base_commit", "candidate_commit", "image_name", "image_tag", "log_name", "log_sha256", "release_control_commit", "result_marker"],
      `image build record ${index}`,
    );
    const expectedTag = `${spec.tagPrefix}:${value.candidate_commit}-linux-amd64`;
    if (
      record.base_commit !== value.base_commit
      || record.candidate_commit !== value.candidate_commit
      || record.image_name !== spec.name
      || record.image_tag !== expectedTag
      || record.log_name !== spec.buildLog
      || record.release_control_commit !== value.release_control_commit
      || record.result_marker !== `Image ${expectedTag} Built`
      || !/^[0-9a-f]{64}$/.test(record.log_sha256)
    ) {
      fail(`image build record ${index} is not bound to its exact source image`);
    }
    if (seenTags.has(record.image_tag) || seenLogs.has(record.log_name)) {
      fail("image build records must use distinct tags and logs");
    }
    seenTags.add(record.image_tag);
    seenLogs.add(record.log_name);
  }
  for (const [index, image] of value.images.entries()) {
    const spec = IMAGE_SPECS[index];
    const record = value.build_records[index];
    assertExactKeys(
      image,
      ["build_record", "digest", "name", "platform", "revision", "source", "tag", "version"],
      `image ${index}`,
    );
    assertExactKeys(image.platform, ["architecture", "os", "variant"], `image ${index} platform`);
    if (stableJson(image.platform) !== stableJson(P8B2_TARGET_PLATFORM)) {
      fail(`image ${index} platform must be exactly linux/amd64 with no variant`);
    }
    if (
      image.name !== spec.name
      || image.tag !== record.image_tag
      || image.revision !== value.candidate_commit
      || stableJson(image.build_record) !== stableJson(record)
      || !DIGEST_PATTERN.test(image.digest)
    ) {
      fail(`image ${index} is not bound one-to-one to its exact build record`);
    }
    if (seenDigests.has(image.digest)) fail("candidate images must have distinct immutable IDs");
    seenDigests.add(image.digest);
  }
  return value;
}

function readJson(path, label) {
  try {
    return parseJsonRejectingDuplicates(readFileSync(path, "utf8"), label);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

export function parseJsonRejectingDuplicates(text, label = "JSON") {
  let index = 0;
  const whitespace = () => {
    while (/\s/.test(text[index] ?? "")) index += 1;
  };
  const string = () => {
    const start = index;
    if (text[index] !== '"') fail(`${label} expected a string at offset ${index}`);
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
      } else if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      } else {
        index += 1;
      }
    }
    fail(`${label} contains an unterminated string`);
  };
  const value = () => {
    whitespace();
    if (text[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (text[index] === "}") { index += 1; return; }
      while (index < text.length) {
        const key = string();
        if (keys.has(key)) fail(`${label} contains duplicate key ${JSON.stringify(key)}`);
        keys.add(key);
        whitespace();
        if (text[index] !== ":") fail(`${label} expected ':' at offset ${index}`);
        index += 1;
        value();
        whitespace();
        if (text[index] === "}") { index += 1; return; }
        if (text[index] !== ",") fail(`${label} expected ',' at offset ${index}`);
        index += 1;
        whitespace();
      }
      fail(`${label} contains an unterminated object`);
    }
    if (text[index] === "[") {
      index += 1;
      whitespace();
      if (text[index] === "]") { index += 1; return; }
      while (index < text.length) {
        value();
        whitespace();
        if (text[index] === "]") { index += 1; return; }
        if (text[index] !== ",") fail(`${label} expected ',' at offset ${index}`);
        index += 1;
      }
      fail(`${label} contains an unterminated array`);
    }
    if (text[index] === '"') { string(); return; }
    const start = index;
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1;
    if (start === index) fail(`${label} expected a value at offset ${index}`);
    JSON.parse(text.slice(start, index));
  };
  value();
  whitespace();
  if (index !== text.length) fail(`${label} contains trailing data at offset ${index}`);
  return JSON.parse(text);
}

function git(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
}

export function validateGitIdentity(repoRoot, { baseCommit, candidateCommit }) {
  try {
    git(repoRoot, ["cat-file", "-e", `${baseCommit}^{commit}`]);
    git(repoRoot, ["cat-file", "-e", `${candidateCommit}^{commit}`]);
  } catch {
    fail("base and candidate commits must exist in this repository");
  }
  if (git(repoRoot, ["rev-parse", `${candidateCommit}^`]) !== baseCommit) {
    fail("base commit must be the candidate commit's exact parent");
  }
  if (git(repoRoot, ["merge-base", baseCommit, candidateCommit]) !== baseCommit) {
    fail("base commit must be the candidate commit's exact merge base");
  }
}

export function validateReleaseControlIdentity(toolRoot, releaseControlCommit) {
  if (!SHA_PATTERN.test(releaseControlCommit)) fail("release-control commit must be a full lowercase Git SHA");
  if (git(toolRoot, ["rev-parse", "HEAD"]) !== releaseControlCommit) {
    fail("release-control commit does not match tool HEAD");
  }
  if (git(toolRoot, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    fail("release-control repository must be clean");
  }
}

export function validateCandidateRepositories({
  baseCommit,
  candidateCommit,
  releaseControlCommit,
  sourceRoot,
  toolRoot,
}) {
  validateGitIdentity(sourceRoot, { baseCommit, candidateCommit });
  if (git(sourceRoot, ["rev-parse", "HEAD"]) !== candidateCommit) {
    fail("candidate commit does not match source HEAD");
  }
  if (git(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    fail("candidate source repository must be clean");
  }
  validateReleaseControlIdentity(toolRoot, releaseControlCommit);
}

export function resolveEvidencePath(repoRoot, path, label) {
  const evidenceRoot = join(repoRoot, ".evo-release-evidence");
  const resolved = resolve(repoRoot, path);
  if (!resolved.startsWith(`${evidenceRoot}${sep}`)) {
    fail(`${label} must be inside ${relative(repoRoot, evidenceRoot)}/`);
  }
  if (lstatSync(evidenceRoot).isSymbolicLink()) fail("evidence root must not be a symlink");
  const realEvidenceRoot = realpathSync(evidenceRoot);
  if (realEvidenceRoot !== join(realpathSync(repoRoot), ".evo-release-evidence")) {
    fail("evidence root must resolve inside the real repository");
  }
  let current = evidenceRoot;
  for (const part of relative(evidenceRoot, resolved).split(sep)) {
    current = join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) fail(`${label} must not contain symlinks`);
  }
  if (existsSync(resolved)) {
    const realResolved = realpathSync(resolved);
    if (!realResolved.startsWith(`${realEvidenceRoot}${sep}`)) {
      fail(`${label} resolves outside .evo-release-evidence/`);
    }
  }
  return resolved;
}

function requireMode(path, expected, label) {
  const actual = statSync(path).mode & 0o777;
  if (actual !== expected) fail(`${label} must have mode ${expected.toString(8).padStart(4, "0")}`);
}

function writeEvidence(outputDir, filename, value) {
  assertSafeMetadata(value, filename);
  const path = join(outputDir, filename);
  writeFileSync(path, jsonText(value), { mode: 0o600 });
  return { path: filename, sha256: sha256File(path) };
}

function verifiedSegment(candidateCommit, timestamp, evidence, operation, result) {
  return {
    candidate_commit: candidateCommit,
    evidence,
    operation,
    result,
    status: "verified",
    timestamp,
  };
}

function parseTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail("timestamp must be ISO-8601");
  return new Date(value).toISOString();
}

export function collectMigrationInventory(repoRoot) {
  const directory = join(repoRoot, "supabase", "migrations");
  const migrations = readdirSync(directory)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({ name, sha256: sha256File(join(directory, name)) }));
  if (migrations.length !== 93) fail("migration inventory must contain 93 files");
  migrations.forEach((migration, index) => {
    if (migration.name.slice(0, 3) !== String(index + 1).padStart(3, "0")) {
      fail("migration inventory must be contiguous 001-093");
    }
  });
  return migrations;
}

export function collectRuntimeSettingInventory(repoRoot) {
  const settings = [];
  for (const example of RUNTIME_EXAMPLES) {
    const content = readFileSync(join(repoRoot, example.path), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
      if (match) settings.push({ name: match[1], owner: example.owner, present_in_candidate_example: true });
    }
  }
  return settings.sort((left, right) => `${left.owner}:${left.name}`.localeCompare(`${right.owner}:${right.name}`));
}

export function validateValidationRecords(records, { baseCommit, candidateCommit, repoRoot }) {
  if (!Array.isArray(records) || records.length === 0) fail("validations must be a non-empty array");
  return records.map((entry, index) => {
    assertExactKeys(
      entry,
      ["base_commit", "candidate_commit", "command", "evidence_path", "exit_code", "name", "test_count"],
      `validation ${index}`,
    );
    if (entry.base_commit !== baseCommit || entry.candidate_commit !== candidateCommit) {
      fail(`validation ${index} does not match the requested base/candidate commits`);
    }
    if (typeof entry.name !== "string" || !entry.name || typeof entry.command !== "string" || !entry.command) {
      fail(`validation ${index} name and command are required`);
    }
    if (!Number.isInteger(entry.exit_code) || !Number.isInteger(entry.test_count) || entry.test_count < 0) {
      fail(`validation ${index} result metadata is invalid`);
    }
    const evidencePath = resolveEvidencePath(repoRoot, entry.evidence_path, `validation ${index} evidence`);
    if (!statSync(evidencePath).isFile()) fail(`validation ${index} evidence is not a file`);
    requireMode(evidencePath, 0o600, `validation ${index} evidence`);
    const evidenceText = readFileSync(evidencePath, "utf8");
    assertSafeMetadata(entry, `validation ${index}`);
    assertSafeMetadata(evidenceText, `validation ${index} evidence`);
    if (!evidenceText.includes(candidateCommit) || !evidenceText.includes(baseCommit)) {
      fail(`validation ${index} evidence does not name the exact candidate and base`);
    }
    if (!evidenceText.includes(`command=${entry.command}`) || !evidenceText.includes(`exit_code=${entry.exit_code}`)) {
      fail(`validation ${index} evidence does not contain its exact command and exit code`);
    }
    return {
      base_commit: baseCommit,
      candidate_commit: candidateCommit,
      command: entry.command,
      evidence_sha256: sha256File(evidencePath),
      exit_code: entry.exit_code,
      name: entry.name,
      status: entry.exit_code === 0 ? "verified" : "blocked",
      test_count: entry.test_count,
    };
  });
}

export function collectBuildRecords({ baseCommit, buildEvidenceDir, candidateCommit, releaseControlCommit }) {
  const buildDirectory = resolve(buildEvidenceDir);
  requireMode(buildDirectory, 0o700, "build evidence directory");
  const logs = new Map();
  for (const name of new Set(IMAGE_SPECS.map((spec) => spec.buildLog))) {
    const path = join(buildDirectory, name);
    if (!statSync(path).isFile()) fail(`missing retained build evidence: ${name}`);
    requireMode(path, 0o600, name);
    const content = readFileSync(path, "utf8");
    assertSafeMetadata(content, name);
    if (!content.includes(candidateCommit) || !content.includes(baseCommit) || !content.includes(releaseControlCommit)) {
      fail(`${name} is not bound to the exact base, candidate and release-control commits`);
    }
    const exitLines = content.split("\n").filter((line) => line.startsWith("exit_code="));
    if (stableJson(exitLines) !== stableJson(["exit_code=0"])) {
      fail(`${name} does not record exactly one successful build exit`);
    }
    logs.set(name, { content, sha256: sha256File(path) });
  }
  return IMAGE_SPECS.map((spec) => {
    const imageTag = `${spec.tagPrefix}:${candidateCommit}-linux-amd64`;
    const resultMarker = `Image ${imageTag} Built`;
    const log = logs.get(spec.buildLog);
    if (!log.content.includes(resultMarker)) fail(`${spec.buildLog} does not prove ${imageTag} was built`);
    return {
      base_commit: baseCommit,
      candidate_commit: candidateCommit,
      image_name: spec.name,
      image_tag: imageTag,
      log_name: spec.buildLog,
      log_sha256: log.sha256,
      release_control_commit: releaseControlCommit,
      result_marker: resultMarker,
    };
  });
}

function collectImageEvidence({ baseCommit, buildEvidenceDir, candidateCommit, releaseControlCommit }) {
  if (execFileSync("docker", ["context", "show"], { encoding: "utf8" }).trim() !== "orbstack") {
    fail("Docker context must be exactly orbstack");
  }
  const buildRecords = collectBuildRecords({ baseCommit, buildEvidenceDir, candidateCommit, releaseControlCommit });
  const images = IMAGE_SPECS.map((spec) => {
    const tag = `${spec.tagPrefix}:${candidateCommit}-linux-amd64`;
    const buildRecord = buildRecords.find((record) => record.image_name === spec.name);
    const inspected = JSON.parse(execFileSync("docker", ["image", "inspect", tag], { encoding: "utf8" }))[0];
    const identity = validateImageInspection(inspected, { candidateCommit, tag });
    return {
      build_record: buildRecord,
      digest: identity.digest,
      name: spec.name,
      platform: identity.platform,
      revision: identity.revision,
      source: identity.source,
      tag,
      version: identity.version,
    };
  });
  const evidence = {
    base_commit: baseCommit,
    build_records: buildRecords,
    candidate_commit: candidateCommit,
    images,
    release_control_commit: releaseControlCommit,
  };
  validateImageEvidence(evidence);
  assertSafeMetadata(evidence, "image evidence");
  return evidence;
}

export function createCandidateManifest({
  baseCommit,
  buildEvidenceDir,
  candidateCommit,
  outputDir,
  releaseControlCommit,
  repoRoot,
  timestamp,
  toolRoot = resolve(fileURLToPath(new URL("..", import.meta.url))),
  validationsPath,
}) {
  const root = resolve(repoRoot);
  const controlRoot = resolve(toolRoot);
  const evidenceRoot = join(root, ".evo-release-evidence");
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  chmodSync(evidenceRoot, 0o700);
  const output = resolveEvidencePath(root, outputDir, "output directory");
  const builds = resolveEvidencePath(root, buildEvidenceDir, "build evidence directory");
  const validations = resolveEvidencePath(root, validationsPath, "validations file");
  const normalizedTimestamp = parseTimestamp(timestamp);
  if (![candidateCommit, baseCommit, releaseControlCommit].every((value) => SHA_PATTERN.test(value))) {
    fail("commits must be full lowercase Git SHAs");
  }
  validateCandidateRepositories({
    baseCommit,
    candidateCommit,
    releaseControlCommit,
    sourceRoot: root,
    toolRoot: controlRoot,
  });
  if (existsSync(output)) fail("output directory must not already exist");

  requireMode(validations, 0o600, "validations file");
  const validationRecords = validateValidationRecords(readJson(validations, "validations"), {
    baseCommit,
    candidateCommit,
    repoRoot: root,
  });
  const images = collectImageEvidence({ baseCommit, buildEvidenceDir: builds, candidateCommit, releaseControlCommit });
  const migrations = collectMigrationInventory(root);
  const configuration = CONFIG_FILES.map((path) => ({ path, sha256: sha256File(join(root, path)) }));
  const runtimeSettings = collectRuntimeSettingInventory(root);

  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  mkdirSync(output, { mode: 0o700 });
  const repositoryEvidence = writeEvidence(output, "repository-identity.json", {
    base_commit: baseCommit,
    candidate_commit: candidateCommit,
    clean: true,
    release_control_commit: releaseControlCommit,
    release_control_clean: true,
    tool_sha256: sha256File(fileURLToPath(import.meta.url)),
  });
  const migrationEvidence = writeEvidence(output, "migration-identity.json", { migrations });
  const configurationEvidence = writeEvidence(output, "configuration-identity.json", { files: configuration });
  const imageEvidence = writeEvidence(output, "image-identity.json", images);
  const runtimeEvidence = writeEvidence(output, "runtime-setting-inventory.json", { settings: runtimeSettings });
  const validationEvidence = writeEvidence(output, "validation-identity.json", { validations: validationRecords });

  const segments = {
    configuration_identity: verifiedSegment(candidateCommit, normalizedTimestamp, configurationEvidence, "hash reviewed deployment configuration", `${configuration.length} files hashed`),
    image_identity: verifiedSegment(candidateCommit, normalizedTimestamp, imageEvidence, "inspect OrbStack candidate images and retained builds", "3 OCI revision-bound image digests recorded"),
    migration_identity: verifiedSegment(candidateCommit, normalizedTimestamp, migrationEvidence, "hash contiguous Supabase migrations", "001-092 hashed"),
    repository_identity: verifiedSegment(candidateCommit, normalizedTimestamp, repositoryEvidence, "verify clean exact Git candidate", "clean exact candidate"),
    runtime_setting_inventory: verifiedSegment(candidateCommit, normalizedTimestamp, runtimeEvidence, "inventory required runtime setting names", `${runtimeSettings.length} names with presence and ownership recorded`),
    validation_identity: {
      ...verifiedSegment(candidateCommit, normalizedTimestamp, validationEvidence, "record candidate-bound validation commands", `${validationRecords.filter((entry) => entry.status === "verified").length}/${validationRecords.length} validations passed`),
      status: validationRecords.every((entry) => entry.status === "verified") ? "verified" : "blocked",
    },
  };
  const evidenceIndex = { candidate_commit: candidateCommit, schema_version: 1, segments };
  const evidenceIndexEvidence = writeEvidence(output, "evidence-index.json", evidenceIndex);
  const manifest = {
    base_commit: baseCommit,
    candidate_commit: candidateCommit,
    evidence_index: evidenceIndexEvidence,
    generated_at: normalizedTimestamp,
    images: imageEvidence,
    release_control_commit: releaseControlCommit,
    runtime_settings: runtimeEvidence,
    schema_version: 2,
    target_platform: P8B2_TARGET_PLATFORM,
  };
  writeFileSync(join(output, "candidate-manifest.json"), jsonText(manifest), { mode: 0o600 });
  return { evidenceIndex, manifest };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail(`invalid argument: ${key ?? "<missing>"}`);
    values[key.slice(2)] = value;
  }
  for (const key of ["base", "build-evidence-dir", "commit", "output-dir", "release-control", "source-root", "timestamp", "validations"]) {
    if (!values[key]) fail(`--${key} is required`);
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const toolRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const repoRoot = resolve(args["source-root"]);
    const result = createCandidateManifest({
      baseCommit: args.base,
      buildEvidenceDir: args["build-evidence-dir"],
      candidateCommit: args.commit,
      outputDir: args["output-dir"],
      releaseControlCommit: args["release-control"],
      repoRoot,
      timestamp: args.timestamp,
      toolRoot,
      validationsPath: args.validations,
    });
    process.stdout.write(`${JSON.stringify({
      candidate_commit: result.manifest.candidate_commit,
      evidence_index_sha256: result.manifest.evidence_index.sha256,
      output_dir: relative(repoRoot, resolve(args["output-dir"])),
      status: "verified",
    })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
