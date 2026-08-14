import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createP8CReport, deriveOverallStatus, ENVIRONMENTS, OPERATIONS, SEGMENTS } from "../scripts/p8c-environment-reconciliation.mjs";

const candidate = "0505143657858e710acdd5029f1cc77c5524083e";
const merged = "6ee93bd308aa478357279dd71511c7dc479b1f69";
const repoRoot = new URL("..", import.meta.url).pathname;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const imageDigests = { evo_inbox: `sha256:${"2".repeat(64)}`, lead_agent: `sha256:${"3".repeat(64)}`, main_crm: `sha256:${"1".repeat(64)}` };
const p8bEvidenceIndexSha256 = "4".repeat(64);
const baseArgs = (f) => ({ candidateCommit: candidate, evidenceRoot: f.evidenceRoot, imageDigests, inputPath: f.inputPath, mergedMainCommit: merged, outputPath: f.outputPath, p8bEvidenceIndexSha256, prNumber: 179, repoRoot, timestamp: "2026-08-14T00:00:00.000Z" });

function fixture(statuses = {}) {
  const root = mkdtempSync(join(tmpdir(), "p8c-"));
  const evidenceRoot = join(repoRoot, ".evo-release-evidence", root.split("/").at(-1));
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const segments = {};
  for (const name of SEGMENTS) {
    const evidenceName = `${name.replaceAll("_", "-")}-reconciliation.json`;
    const body = `${JSON.stringify({ candidate_commit: candidate, checks: [{ check_id: "identity", observed: { kind: "presence", value: "present" }, result_code: "requirements_match", status: statuses[name] ?? "verified" }], environment: ENVIRONMENTS[name], observed_at: "2026-08-14T00:00:00.000Z", schema_version: 1 })}\n`;
    writeFileSync(join(evidenceRoot, evidenceName), body, { mode: 0o600 });
    segments[name] = { evidence: { path: evidenceName, sha256: sha(body) }, observed_at: "2026-08-14T00:00:00.000Z", operation: OPERATIONS[name], result_code: statuses[name] === "blocked" ? "requirements_mismatch" : "requirements_match", status: statuses[name] ?? "verified" };
  }
  const inputPath = join(evidenceRoot, "observations.json");
  writeFileSync(inputPath, `${JSON.stringify({ candidate_commit: candidate, schema_version: 1, segments })}\n`, { mode: 0o600 });
  chmodSync(inputPath, 0o600);
  return { evidenceRoot, inputPath, outputPath: join(evidenceRoot, "p8c-report.json"), segments };
}

test("derives closed overall-status precedence", () => {
  assert.equal(deriveOverallStatus({ a: { status: "verified" }, b: { status: "not_applicable" } }), "verified");
  assert.equal(deriveOverallStatus({ a: { status: "deferred" }, b: { status: "verified" } }), "deferred");
  assert.equal(deriveOverallStatus({ a: { status: "blocked" }, b: { status: "deferred" } }), "blocked");
});

test("binds the P8B head to the identical squash-main tree without relabelling images", () => {
  const f = fixture({ hermes: "blocked" });
  const report = createP8CReport(baseArgs(f));
  assert.equal(report.candidate.pr_head_commit, candidate);
  assert.equal(report.candidate.merged_main_commit, merged);
  assert.equal(report.candidate.trees_equal, true);
  assert.deepEqual(report.candidate.image_digests, imageDigests);
  assert.equal(report.candidate.p8b_evidence_index_sha256, p8bEvidenceIndexSha256);
  assert.equal(report.overall_status, "blocked");
  assert.equal(JSON.parse(readFileSync(f.outputPath, "utf8")).candidate.pr_head_commit, candidate);
});

test("rejects local evidence for a verified real segment", () => {
  const f = fixture();
  const path = join(f.evidenceRoot, "gemini-reconciliation.json");
  const body = `${JSON.stringify({ candidate_commit: candidate, checks: [{ check_id: "identity", observed: { kind: "presence", value: "present" }, result_code: "requirements_match", status: "verified" }], environment: "local", observed_at: "2026-08-14T00:00:00.000Z", schema_version: 1 })}\n`;
  writeFileSync(path, body, { mode: 0o600 });
  f.segments.gemini.evidence.sha256 = sha(body);
  writeFileSync(f.inputPath, `${JSON.stringify({ candidate_commit: candidate, schema_version: 1, segments: f.segments })}\n`);
  assert.throws(() => createP8CReport(baseArgs(f)), /wrong environment/);
});

test("rejects evidence tampering, sensitive-looking values, and unknown segments", () => {
  const tampered = fixture();
  writeFileSync(join(tampered.evidenceRoot, "waha-reconciliation.json"), '{"candidate_commit":"0505143657858e710acdd5029f1cc77c5524083e","token":"secret-value"}\n');
  assert.throws(() => createP8CReport(baseArgs(tampered)), /hash mismatch/);
  const extra = fixture();
  const parsed = JSON.parse(readFileSync(extra.inputPath, "utf8")); parsed.segments.other = parsed.segments.github;
  writeFileSync(extra.inputPath, `${JSON.stringify(parsed)}\n`);
  assert.throws(() => createP8CReport(baseArgs(extra)), /exact keys/);
});

test("rejects a verified segment whose retained evidence contains a blocker", () => {
  const f = fixture();
  const path = join(f.evidenceRoot, "waha-reconciliation.json");
  const body = `${JSON.stringify({ candidate_commit: candidate, checks: [{ check_id: "webhook_owner", observed: { kind: "identifier", value: "legacy_crm_webhook" }, result_code: "requirements_mismatch", status: "blocked" }], environment: ENVIRONMENTS.waha, observed_at: "2026-08-14T00:00:00.000Z", schema_version: 1 })}\n`;
  writeFileSync(path, body, { mode: 0o600 });
  f.segments.waha.evidence.sha256 = sha(body);
  writeFileSync(f.inputPath, `${JSON.stringify({ candidate_commit: candidate, schema_version: 1, segments: f.segments })}\n`);
  assert.throws(() => createP8CReport(baseArgs(f)), /status does not match/);
});

test("rejects symlinked input and output paths", () => {
  const inputFixture = fixture();
  const inputSymlink = join(inputFixture.evidenceRoot, "input-link.json");
  symlinkSync(inputFixture.inputPath, inputSymlink);
  assert.throws(() => createP8CReport({ ...baseArgs(inputFixture), inputPath: inputSymlink }), /input cannot use symlinks/);

  const outputFixture = fixture();
  const outsideDir = mkdtempSync(join(tmpdir(), "p8c-outside-"));
  const outputLink = join(outputFixture.evidenceRoot, "linked-output");
  symlinkSync(outsideDir, outputLink);
  assert.throws(() => createP8CReport({ ...baseArgs(outputFixture), outputPath: join(outputLink, "report.json") }), /output cannot use symlinks/);

  const rootFixture = fixture();
  const evidenceRootLink = join(repoRoot, ".evo-release-evidence", `linked-root-${Date.now()}`);
  symlinkSync(rootFixture.evidenceRoot, evidenceRootLink);
  assert.throws(() => createP8CReport({ ...baseArgs(rootFixture), evidenceRoot: evidenceRootLink, inputPath: join(evidenceRootLink, "observations.json"), outputPath: join(evidenceRootLink, "report.json") }), /evidence root cannot use symlinks/);
});
