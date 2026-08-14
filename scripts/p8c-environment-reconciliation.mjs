#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonRejectingDuplicates } from "./p8-candidate-manifest.mjs";

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
const SENSITIVE = [
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/i,
  /sbp_[A-Za-z0-9_-]{12,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\+\d{9,15}\b/,
];

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
function git(repoRoot, args) { return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim(); }
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

export function createP8CReport({ candidateCommit, evidenceRoot, imageDigests, inputPath, mergedMainCommit, outputPath, p8bEvidenceIndexSha256, prNumber, repoRoot, timestamp }) {
  for (const [label, value] of [["candidate commit", candidateCommit], ["merged main commit", mergedMainCommit]]) if (!SHA.test(value)) fail(`${label} must be a full lowercase Git SHA`);
  if (!Number.isInteger(prNumber) || prNumber < 1) fail("PR number must be positive");
  exactKeys(imageDigests, ["evo_inbox", "lead_agent", "main_crm"], "image digests");
  for (const [name, digest] of Object.entries(imageDigests)) if (!DIGEST.test(digest)) fail(`${name} image digest is invalid`);
  if (!SHA256.test(p8bEvidenceIndexSha256)) fail("P8B evidence-index SHA-256 is invalid");
  utc(timestamp, "timestamp");
  const root = realpathSync(resolve(repoRoot));
  const evidenceResolved = resolve(evidenceRoot);
  if (!inside(root, evidenceResolved)) fail("evidence root must be inside the repository");
  rejectSymlinkAncestors(root, evidenceResolved, "evidence root");
  const evidence = realpathSync(evidenceResolved);
  if (!inside(root, evidence)) fail("evidence root must be inside the repository");
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
  const prHeadTree = git(root, ["rev-parse", `${candidateCommit}^{tree}`]);
  const mergedMainTree = git(root, ["rev-parse", `${mergedMainCommit}^{tree}`]);
  if (prHeadTree !== mergedMainTree) fail("candidate PR head and merged main trees differ");
  git(root, ["merge-base", "--is-ancestor", mergedMainCommit, "origin/main"]);
  const report = {
    candidate: { image_digests: imageDigests, merged_main_commit: mergedMainCommit, merged_main_tree: mergedMainTree, p8b_evidence_index_sha256: p8bEvidenceIndexSha256, pr_head_commit: candidateCommit, pr_head_tree: prHeadTree, pr_number: prNumber, trees_equal: true },
    generated_at: timestamp,
    overall_status: deriveOverallStatus(segments),
    schema_version: 1,
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
  for (const key of ["candidate", "crm-image-digest", "evidence-root", "inbox-image-digest", "input", "lead-agent-image-digest", "merged-main", "output", "p8b-evidence-index-sha256", "pr-number", "timestamp"]) if (!out[key]) fail(`--${key} is required`);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const values = args(process.argv.slice(2));
    const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const report = createP8CReport({ candidateCommit: values.candidate, evidenceRoot: values["evidence-root"], imageDigests: { evo_inbox: values["inbox-image-digest"], lead_agent: values["lead-agent-image-digest"], main_crm: values["crm-image-digest"] }, inputPath: values.input, mergedMainCommit: values["merged-main"], outputPath: values.output, p8bEvidenceIndexSha256: values["p8b-evidence-index-sha256"], prNumber: Number(values["pr-number"]), repoRoot, timestamp: values.timestamp });
    process.stdout.write(`${JSON.stringify({ overall_status: report.overall_status, output: relative(repoRoot, resolve(values.output)) })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`); process.exitCode = 1;
  }
}
