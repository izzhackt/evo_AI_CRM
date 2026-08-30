#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonRejectingDuplicates, validateImageEvidence } from "./p8-candidate-manifest.mjs";

export { parseJsonRejectingDuplicates };

export const SEGMENTS = Object.freeze(["amocrm", "gemini", "github", "hermes", "managed_supabase", "rollback", "waha"]);
export const OPERATIONS = Object.freeze({
  amocrm: "amocrm_read_only_account_inventory",
  gemini: "gemini_read_only_model_and_access_inventory",
  github: "github_read_only_release_identity",
  hermes: "hermes_read_only_runtime_inventory",
  managed_supabase: "supabase_read_only_project_and_migration_inventory",
  rollback: "rollback_read_only_artifact_inventory",
  waha: "waha_read_only_health_and_ownership_inventory",
});
export const ENVIRONMENTS = Object.freeze({
  amocrm: "amocrm",
  gemini: "gemini",
  github: "github",
  hermes: "hermes-vps",
  managed_supabase: "evo-platform-prod",
  rollback: "hermes-vps",
  waha: "hermes-vps",
});
const STATUSES = new Set(["verified", "blocked", "deferred", "not_applicable"]);
const OBSERVED_KINDS = new Set(["boolean", "count", "identifier", "migration_range", "presence", "sha", "sha256_digest", "version"]);
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RESULT_CODE = /^[a-z0-9_]+$/;
const FILE_NAME = /^[a-z0-9-]+\.json$/;
const CREDENTIAL_SENSITIVE = [
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/i,
  /sbp_[A-Za-z0-9_-]{12,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/i,
];
const EMAIL_CONTACT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_CONTACT = /(?<![A-Z0-9._%+-])\+\d{9,15}\b/i;
const CONTACT_SENSITIVE = [EMAIL_CONTACT, PHONE_CONTACT];
const SENSITIVE = [...CREDENTIAL_SENSITIVE, ...CONTACT_SENSITIVE];

function isCanonicalSpdxContact(path, value) {
  if (path.length !== 3 || path[0] !== "packages" || !Number.isInteger(path[1])) return false;
  if (path[2] === "originator") return /^Person: [^\r\n]{1,2048}$/i.test(value) && EMAIL_CONTACT.test(value) && !PHONE_CONTACT.test(value);
  if (path[2] === "downloadLocation") return /^git@[a-z0-9.-]+:[a-z0-9._/-]+(?:\.git)?$/i.test(value);
  return false;
}

function rejectNoncanonicalSpdxContacts(value, label, path = []) {
  if (typeof value === "string") {
    if (CONTACT_SENSITIVE.some((pattern) => pattern.test(value)) && !isCanonicalSpdxContact(path, value)) fail(`${label} contains sensitive-looking content`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectNoncanonicalSpdxContacts(item, label, [...path, index]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) rejectNoncanonicalSpdxContacts(item, label, [...path, key]);
  }
}

function fail(message) { throw new Error(message); }
function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} must have exact keys: ${wanted.join(", ")}`);
}
function utc(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) fail(`${label} must be canonical UTC`);
  return value;
}
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function validateP8EvidenceIndex(value, candidateCommit, label) {
  const names = ["configuration_identity", "image_identity", "migration_identity", "repository_identity", "runtime_setting_inventory", "validation_identity"];
  exactKeys(value, ["candidate_commit", "schema_version", "segments"], label);
  if (value.schema_version !== 1 || value.candidate_commit !== candidateCommit) fail(`${label} candidate binding mismatch`);
  exactKeys(value.segments, names, `${label} segments`);
  for (const name of names) {
    const segment = value.segments[name];
    exactKeys(segment, ["candidate_commit", "evidence", "operation", "result", "status", "timestamp"], `${label} ${name}`);
    exactKeys(segment.evidence, ["path", "sha256"], `${label} ${name} evidence`);
    if (segment.candidate_commit !== candidateCommit || segment.status !== "verified" || typeof segment.operation !== "string" || !segment.operation || typeof segment.result !== "string" || !segment.result || !FILE_NAME.test(segment.evidence.path) || !SHA256.test(segment.evidence.sha256)) fail(`${label} contains a malformed or nonverified segment`);
    utc(segment.timestamp, `${label} ${name} timestamp`);
  }
}
function git(repoRoot, args) { return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim(); }
function gitIsAncestor(repoRoot, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
}
function inside(root, path) { return path === root || path.startsWith(`${root}${sep}`); }
function rejectSymlinkAncestors(baseRoot, targetPath, label) {
  const root = resolve(baseRoot);
  let current = resolve(targetPath);
  while (inside(root, current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail(`${label} cannot use symlinks`);
    if (current === root) break;
    current = dirname(current);
  }
}
function safeFile(root, name) {
  if (!FILE_NAME.test(name)) fail(`invalid evidence filename: ${name}`);
  const path = resolve(root, name);
  if (!inside(root, path)) fail(`evidence escapes evidence root: ${name}`);
  rejectSymlinkAncestors(root, path, `evidence ${name}`);
  if (lstatSync(path).isSymbolicLink()) fail(`evidence cannot be a symlink: ${name}`);
  const real = realpathSync(path);
  if (!inside(realpathSync(root), real)) fail(`evidence resolves outside evidence root: ${name}`);
  return real;
}
function readArtifact(root, path, label, parseJson = true, allowCanonicalSpdxContacts = false) {
  const resolved = resolve(path);
  if (!inside(root, resolved)) fail(`${label} must be below the evidence root`);
  rejectSymlinkAncestors(root, resolved, label);
  const real = realpathSync(resolved);
  if (!inside(realpathSync(root), real) || !lstatSync(real).isFile()) fail(`${label} must be a regular file below the evidence root`);
  const bytes = readFileSync(real);
  const text = bytes.toString("utf8");
  if (CREDENTIAL_SENSITIVE.some((pattern) => pattern.test(text))) fail(`${label} contains sensitive-looking content`);
  const value = parseJson ? parseJsonRejectingDuplicates(text, label) : undefined;
  if (allowCanonicalSpdxContacts) rejectNoncanonicalSpdxContacts(value, label);
  else if (CONTACT_SENSITIVE.some((pattern) => pattern.test(text))) fail(`${label} contains sensitive-looking content`);
  return { hash: hash(bytes), path: real, value };
}

function validateEvidence(value, name, candidateCommit) {
  exactKeys(value, ["candidate_commit", "checks", "environment", "observed_at", "schema_version"], `${name} evidence`);
  if (value.schema_version !== 1 || value.candidate_commit !== candidateCommit) fail(`${name} evidence candidate binding mismatch`);
  utc(value.observed_at, `${name} evidence observed_at`);
  if (typeof value.environment !== "string" || !/^[a-z0-9_-]+$/.test(value.environment)) fail(`${name} evidence has invalid environment`);
  if (!Array.isArray(value.checks) || value.checks.length === 0 || value.checks.length > 100) fail(`${name} evidence must have 1..100 checks`);
  const ids = new Set();
  for (const check of value.checks) {
    exactKeys(check, ["check_id", "observed", "result_code", "status"], `${name} check`);
    exactKeys(check.observed, ["kind", "value"], `${name} observed value`);
    if (!/^[a-z0-9_]+$/.test(check.check_id) || ids.has(check.check_id)) fail(`${name} evidence has invalid or duplicate check id`);
    ids.add(check.check_id);
    if (!STATUSES.has(check.status) || !RESULT_CODE.test(check.result_code)) fail(`${name} evidence has invalid check result`);
    if (!OBSERVED_KINDS.has(check.observed.kind)) fail(`${name} evidence has invalid observed kind`);
    const observed = check.observed.value;
    if (check.observed.kind === "boolean" && typeof observed !== "boolean") fail(`${name} boolean observation must be boolean`);
    if (check.observed.kind === "count" && (!Number.isInteger(observed) || observed < 0 || observed > 1_000_000)) fail(`${name} count observation is invalid`);
    if (!["boolean", "count"].includes(check.observed.kind) && (typeof observed !== "string" || observed.length < 1 || observed.length > 160 || /[\r\n]/.test(observed))) fail(`${name} observed text is invalid`);
  }
  return value;
}

export function deriveOverallStatus(segments) {
  const statuses = Object.values(segments).map((segment) => segment.status);
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("deferred")) return "deferred";
  return "verified";
}

function deriveSegmentStatus(checks) {
  const statuses = checks.map((check) => check.status);
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("deferred")) return "deferred";
  if (statuses.every((status) => status === "not_applicable")) return "not_applicable";
  return "verified";
}

export function createP8CReport({ candidateCommit, candidateManifestPath, collectionIndexPath, evidenceIndexPath, evidenceRoot, inputPath, mainlineCommit, mergedMainCommit, outputPath, p8bEvidenceIndexPath, prNumber, repoRoot, timestamp }) {
  for (const [label, value] of [["candidate commit", candidateCommit], ["merged main commit", mergedMainCommit], ["mainline commit", mainlineCommit]]) if (!SHA.test(value)) fail(`${label} must be a full lowercase Git SHA`);
  if (!Number.isInteger(prNumber) || prNumber < 1) fail("PR number must be positive");
  utc(timestamp, "timestamp");
  const root = realpathSync(resolve(repoRoot));
  const evidenceResolved = resolve(evidenceRoot);
  if (!inside(root, evidenceResolved)) fail("evidence root must be inside the repository");
  rejectSymlinkAncestors(root, evidenceResolved, "evidence root");
  const evidence = realpathSync(evidenceResolved);
  if (!inside(root, evidence)) fail("evidence root must be inside the repository");
  const p8bIndexArtifact = readArtifact(evidence, p8bEvidenceIndexPath, "P8B evidence index");
  validateP8EvidenceIndex(p8bIndexArtifact.value, candidateCommit, "P8B evidence index");
  const manifestArtifact = readArtifact(evidence, candidateManifestPath, "candidate manifest");
  const manifest = manifestArtifact.value;
  exactKeys(manifest, ["base_commit", "candidate_commit", "evidence_index", "generated_at", "images", "release_control_commit", "runtime_settings", "schema_version", "target_platform"], "candidate manifest");
  exactKeys(manifest.target_platform, ["architecture", "os", "variant"], "candidate target platform");
  if (manifest.schema_version !== 2 || manifest.candidate_commit !== candidateCommit || manifest.target_platform.os !== "linux" || manifest.target_platform.architecture !== "amd64" || manifest.target_platform.variant !== "") fail("candidate manifest does not bind the exact linux/amd64 candidate");
  exactKeys(manifest.evidence_index, ["path", "sha256"], "candidate evidence index binding");
  const indexArtifact = readArtifact(evidence, evidenceIndexPath, "candidate evidence index");
  if (manifest.evidence_index.path !== "evidence-index.json" || resolve(dirname(manifestArtifact.path), manifest.evidence_index.path) !== indexArtifact.path || manifest.evidence_index.sha256 !== indexArtifact.hash) fail("candidate evidence index binding mismatch");
  validateP8EvidenceIndex(indexArtifact.value, candidateCommit, "candidate evidence index");
  const imageArtifact = readArtifact(evidence, resolve(dirname(manifestArtifact.path), manifest.images.path), "image identity");
  if (manifest.images.sha256 !== imageArtifact.hash) fail("image identity binding mismatch");
  const imageEvidence = imageArtifact.value;
  validateImageEvidence(imageEvidence);
  if (imageEvidence.candidate_commit !== candidateCommit || !Array.isArray(imageEvidence.images) || imageEvidence.images.length !== 3) fail("image identity candidate binding mismatch");
  const expectedNames = ["evo_inbox", "lead_agent", "main_crm"];
  const names = imageEvidence.images.map((item) => item.name).sort();
  const ids = imageEvidence.images.map((item) => item.digest);
  if (JSON.stringify(names) !== JSON.stringify(expectedNames) || new Set(ids).size !== 3 || ids.some((id) => !DIGEST.test(id))) fail("image identity must contain exactly three distinct candidate images");
  for (const item of imageEvidence.images) {
    exactKeys(item.platform, ["architecture", "os", "variant"], `${item.name} platform`);
    if (item.revision !== candidateCommit || item.platform.os !== "linux" || item.platform.architecture !== "amd64" || item.platform.variant !== "") fail("image identity platform or revision mismatch");
  }
  const collectionArtifact = readArtifact(evidence, collectionIndexPath, "P8B2 collection index");
  const collection = collectionArtifact.value;
  exactKeys(collection, ["candidate_commit", "files", "schema_version"], "P8B2 collection index");
  if (collection.schema_version !== 1 || collection.candidate_commit !== candidateCommit || !Array.isArray(collection.files)) fail("P8B2 collection index candidate binding mismatch");
  const indexed = new Map();
  for (const entry of collection.files) {
    exactKeys(entry, ["file", "mode", "sha256"], "P8B2 collection entry");
    if (indexed.has(entry.file) || !SHA256.test(entry.sha256)) fail("invalid P8B2 collection entry");
    const isSpdxPayload = /^sbom-(?:crm|inbox|lead-agent)\.spdx\.json$/.test(entry.file);
    const artifact = readArtifact(evidence, resolve(dirname(collectionArtifact.path), entry.file), `P8B2 artifact ${entry.file}`, entry.file.endsWith(".json"), isSpdxPayload);
    if (entry.mode !== 600 || (lstatSync(artifact.path).mode & 0o777) !== 0o600) fail(`P8B2 collection mode mismatch: ${entry.file}`);
    if (artifact.hash !== entry.sha256) fail(`P8B2 collection hash mismatch: ${entry.file}`);
    indexed.set(entry.file, artifact);
  }
  for (const required of ["sbom-identity.json", "smoke-identity.json"]) if (!indexed.has(required)) fail(`P8B2 collection is missing ${required}`);
  for (const identityName of ["sbom-identity.json", "smoke-identity.json"]) {
    const identity = indexed.get(identityName).value;
    exactKeys(identity, ["candidate_commit", "records", "schema_version"], identityName);
    if (identity.schema_version !== 1 || identity.candidate_commit !== candidateCommit || !Array.isArray(identity.records) || identity.records.length !== 3) fail(`${identityName} candidate binding mismatch`);
    const identitySpecs = [
      { name: "main_crm", sbomFile: "sbom-crm.spdx.json", tag: `evo-crm:${candidateCommit}-linux-amd64`, route: "/api/health", smokeFile: "smoke-crm.log" },
      { name: "evo_inbox", sbomFile: "sbom-inbox.spdx.json", tag: `evo-inbox:${candidateCommit}-linux-amd64`, route: "/api/health", smokeFile: "smoke-inbox.log" },
      { name: "lead_agent", sbomFile: "sbom-lead-agent.spdx.json", tag: `evo-lead-agent:${candidateCommit}-linux-amd64`, route: "/health", smokeFile: "smoke-lead-agent.log" },
    ];
    for (const [recordIndex, record] of identity.records.entries()) {
      const spec = identitySpecs[recordIndex];
      if (identityName === "sbom-identity.json") {
        exactKeys(record, ["command", "exit_code", "file", "file_sha256", "format", "image_id", "image_tag", "name", "platform", "tool"], "SBOM identity record");
        exactKeys(record.platform, ["architecture", "os", "variant"], "SBOM identity platform");
        if (record.name !== spec.name || record.image_tag !== spec.tag || record.file !== spec.sbomFile || !SHA256.test(record.file_sha256) || !/^docker-sbom [0-9]+\.[0-9]+\.[0-9]+$/.test(record.tool) || record.exit_code !== 0 || record.format !== "spdx-json" || record.command !== "docker sbom --format spdx-json <image-tag>" || record.platform.os !== "linux" || record.platform.architecture !== "amd64" || record.platform.variant !== "") fail("SBOM identity record violates its closed service schema");
      } else {
        exactKeys(record, ["exit_code", "finished_at", "image_id", "image_tag", "log_sha256", "name", "network", "platform", "restart_count", "result_code", "route", "started_at"], "smoke identity record");
        const validDateTime = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
        if (record.name !== spec.name || record.image_tag !== spec.tag || record.route !== spec.route || !SHA256.test(record.log_sha256) || !validDateTime(record.started_at) || !validDateTime(record.finished_at) || record.exit_code !== 0 || record.restart_count !== 0 || record.network !== "none" || record.platform !== "linux/amd64" || record.result_code !== "liveness_verified") fail("smoke identity record violates its closed service schema");
      }
    }
    const identityNames = identity.records.map((record) => record.name).sort();
    const identityIds = identity.records.map((record) => record.image_id).sort();
    if (JSON.stringify(identityNames) !== JSON.stringify(expectedNames) || JSON.stringify(identityIds) !== JSON.stringify([...ids].sort())) fail(`${identityName} image identity mismatch`);
    for (const [recordIndex, record] of identity.records.entries()) {
      const retainedName = identityName === "sbom-identity.json" ? record.file : identitySpecs[recordIndex].smokeFile;
      const retainedHash = identityName === "sbom-identity.json" ? record.file_sha256 : record.log_sha256;
      if (!indexed.has(retainedName) || indexed.get(retainedName).hash !== retainedHash) fail(`${identityName} retained artifact hash mismatch`);
    }
  }
  const imageDigests = Object.fromEntries(imageEvidence.images.map((item) => [item.name, item.digest]));
  const inputResolved = resolve(inputPath);
  if (!inside(evidence, inputResolved)) fail("input must be a regular file below the evidence root");
  rejectSymlinkAncestors(evidence, inputResolved, "input");
  const inputReal = realpathSync(inputResolved);
  if (!inside(evidence, inputReal) || !lstatSync(inputReal).isFile()) fail("input must be a regular file below the evidence root");
  const raw = readFileSync(inputReal, "utf8");
  if (SENSITIVE.some((pattern) => pattern.test(raw))) fail("input evidence contains sensitive-looking content");
  const input = parseJsonRejectingDuplicates(raw, "P8C input");
  exactKeys(input, ["candidate_commit", "schema_version", "segments"], "P8C input");
  if (input.schema_version !== 1 || input.candidate_commit !== candidateCommit) fail("input candidate binding mismatch");
  exactKeys(input.segments, SEGMENTS, "P8C segments");
  const segments = {};
  for (const name of SEGMENTS) {
    const segment = input.segments[name];
    exactKeys(segment, ["evidence", "observed_at", "operation", "result_code", "status"], `${name} segment`);
    exactKeys(segment.evidence, ["path", "sha256"], `${name} evidence`);
    if (!STATUSES.has(segment.status)) fail(`${name} has invalid status`);
    if (segment.operation !== OPERATIONS[name]) fail(`${name} has invalid operation`);
    if (!RESULT_CODE.test(segment.result_code)) fail(`${name} has invalid result code`);
    utc(segment.observed_at, `${name} observed_at`);
    if (!SHA256.test(segment.evidence.sha256)) fail(`${name} has invalid evidence hash`);
    const evidencePath = safeFile(evidence, segment.evidence.path);
    const bytes = readFileSync(evidencePath);
    if (hash(bytes) !== segment.evidence.sha256) fail(`${name} evidence hash mismatch`);
    const evidenceText = bytes.toString("utf8");
    if (SENSITIVE.some((pattern) => pattern.test(evidenceText))) fail(`${name} evidence contains sensitive-looking content`);
    const parsedEvidence = parseJsonRejectingDuplicates(evidenceText, `${name} evidence`);
    validateEvidence(parsedEvidence, name, candidateCommit);
    if (parsedEvidence.environment !== ENVIRONMENTS[name]) fail(`${name} evidence uses the wrong environment`);
    if (parsedEvidence.observed_at !== segment.observed_at) fail(`${name} evidence timestamp mismatch`);
    const evidenceStatus = deriveSegmentStatus(parsedEvidence.checks);
    if (evidenceStatus !== segment.status) fail(`${name} segment status does not match its evidence`);
    segments[name] = segment;
  }
  git(root, ["cat-file", "-e", `${candidateCommit}^{commit}`]);
  git(root, ["cat-file", "-e", `${mergedMainCommit}^{commit}`]);
  git(root, ["cat-file", "-e", `${mainlineCommit}^{commit}`]);
  const prHeadTree = git(root, ["rev-parse", `${candidateCommit}^{tree}`]);
  const mergedMainTree = git(root, ["rev-parse", `${mergedMainCommit}^{tree}`]);
  if (prHeadTree !== mergedMainTree) fail("candidate PR head and merged main trees differ");
  if (!gitIsAncestor(root, mergedMainCommit, mainlineCommit)) fail("merged main commit is not an ancestor of the supplied mainline commit");
  const report = {
    candidate: { candidate_evidence_index_sha256: indexArtifact.hash, candidate_manifest_sha256: manifestArtifact.hash, image_digests: imageDigests, mainline_commit: mainlineCommit, merged_main_commit: mergedMainCommit, merged_main_tree: mergedMainTree, p8b2_collection_index_sha256: collectionArtifact.hash, p8b_evidence_index_sha256: p8bIndexArtifact.hash, pr_head_commit: candidateCommit, pr_head_tree: prHeadTree, pr_number: prNumber, target_platform: manifest.target_platform, trees_equal: true },
    generated_at: timestamp,
    overall_status: deriveOverallStatus(segments),
    schema_version: 2,
    segments,
  };
  const output = resolve(outputPath);
  if (!inside(evidence, output)) fail("output must be below the evidence root");
  rejectSymlinkAncestors(evidence, output, "output");
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(output, 0o600);
  return report;
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail(`invalid argument: ${key ?? "<missing>"}`);
    out[key.slice(2)] = value;
  }
  for (const key of ["candidate", "candidate-manifest", "collection-index", "evidence-index", "evidence-root", "input", "merged-main", "output", "p8b-evidence-index", "pr-number", "timestamp"]) if (out[key] === undefined) fail(`--${key} is required`);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const values = args(process.argv.slice(2));
    const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const mainlineCommit = values.mainline ?? git(repoRoot, ["rev-parse", "origin/main^{commit}"]);
    const report = createP8CReport({ candidateCommit: values.candidate, candidateManifestPath: values["candidate-manifest"], collectionIndexPath: values["collection-index"], evidenceIndexPath: values["evidence-index"], evidenceRoot: values["evidence-root"], inputPath: values.input, mainlineCommit, mergedMainCommit: values["merged-main"], outputPath: values.output, p8bEvidenceIndexPath: values["p8b-evidence-index"], prNumber: Number(values["pr-number"]), repoRoot, timestamp: values.timestamp });
    process.stdout.write(`${JSON.stringify({ overall_status: report.overall_status, output: relative(repoRoot, resolve(values.output)) })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`); process.exitCode = 1;
  }
}
