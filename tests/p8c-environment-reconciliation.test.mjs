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
const targetPlatform = { architecture: "amd64", os: "linux", variant: "" };
const p8Segments = () => Object.fromEntries(["configuration_identity", "image_identity", "migration_identity", "repository_identity", "runtime_setting_inventory", "validation_identity"].map((name) => [name, { candidate_commit: candidate, evidence: { path: `${name.replaceAll("_", "-")}.json`, sha256: "9".repeat(64) }, operation: `verify_${name}`, result: "verified", status: "verified", timestamp: "2026-08-14T00:00:00.000Z" }]));
const baseArgs = (f) => ({ candidateCommit: candidate, candidateManifestPath: f.candidateManifestPath, collectionIndexPath: f.collectionIndexPath, evidenceIndexPath: f.evidenceIndexPath, evidenceRoot: f.evidenceRoot, inputPath: f.inputPath, mergedMainCommit: merged, outputPath: f.outputPath, p8bEvidenceIndexPath: f.p8bEvidenceIndexPath, prNumber: 179, repoRoot, timestamp: "2026-08-14T00:00:00.000Z" });

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
  const evidenceIndexPath = join(evidenceRoot, "evidence-index.json");
  const evidenceIndexBody = `${JSON.stringify({ candidate_commit: candidate, schema_version: 1, segments: p8Segments() })}\n`;
  writeFileSync(evidenceIndexPath, evidenceIndexBody, { mode: 0o600 });
  const p8bEvidenceIndexPath = join(evidenceRoot, "p8b-evidence-index.json");
  const p8bEvidenceIndexBody = `${JSON.stringify({ candidate_commit: candidate, schema_version: 1, segments: p8Segments() })}\n`;
  writeFileSync(p8bEvidenceIndexPath, p8bEvidenceIndexBody, { mode: 0o600 });
  const tagPrefix = { main_crm: "evo-crm", evo_inbox: "evo-inbox", lead_agent: "evo-lead-agent" };
  const logName = { main_crm: "build-crm.log", evo_inbox: "build-inbox.log", lead_agent: "build-lead-agent.log" };
  const orderedNames = ["main_crm", "evo_inbox", "lead_agent"];
  const buildRecords = orderedNames.map((name) => ({ base_commit: "a".repeat(40), candidate_commit: candidate, image_name: name, image_tag: `${tagPrefix[name]}:${candidate}-linux-amd64`, log_name: logName[name], log_sha256: "a".repeat(64), release_control_commit: "b".repeat(40), result_marker: `Image ${tagPrefix[name]}:${candidate}-linux-amd64 Built` }));
  const images = orderedNames.map((name, index) => ({ build_record: buildRecords[index], digest: imageDigests[name], name, platform: targetPlatform, revision: candidate, source: "https://github.com/izzhackt/evo_AI_CRM", tag: `${tagPrefix[name]}:${candidate}-linux-amd64`, version: "p8b2-linux-amd64-20260815" }));
  const imageIdentityPath = join(evidenceRoot, "image-identity.json");
  const imageIdentityBody = `${JSON.stringify({ base_commit: "a".repeat(40), build_records: buildRecords, candidate_commit: candidate, images, release_control_commit: "b".repeat(40) })}\n`;
  writeFileSync(imageIdentityPath, imageIdentityBody, { mode: 0o600 });
  const sbomRecords = images.map(({ digest, name }) => {
    const file = { main_crm: "sbom-crm.spdx.json", evo_inbox: "sbom-inbox.spdx.json", lead_agent: "sbom-lead-agent.spdx.json" }[name]; const body = `${JSON.stringify({ name })}\n`;
    writeFileSync(join(evidenceRoot, file), body, { mode: 0o600 });
    return { command: "docker sbom --format spdx-json <image-tag>", exit_code: 0, file, file_sha256: sha(body), format: "spdx-json", image_id: digest, image_tag: `${tagPrefix[name]}:${candidate}-linux-amd64`, name, platform: targetPlatform, tool: "docker-sbom 0.6.0" };
  });
  const smokeRecords = images.map(({ digest, name }) => {
    const file = { main_crm: "smoke-crm.log", evo_inbox: "smoke-inbox.log", lead_agent: "smoke-lead-agent.log" }[name]; const body = `name=${name}\n`;
    writeFileSync(join(evidenceRoot, file), body, { mode: 0o600 });
    return { exit_code: 0, finished_at: "2026-08-14T00:00:01.000Z", image_id: digest, image_tag: `${tagPrefix[name]}:${candidate}-linux-amd64`, log_sha256: sha(body), name, network: "none", platform: "linux/amd64", restart_count: 0, result_code: "liveness_verified", route: name === "lead_agent" ? "/health" : "/api/health", started_at: "2026-08-14T00:00:00.000Z" };
  });
  writeFileSync(join(evidenceRoot, "sbom-identity.json"), `${JSON.stringify({ candidate_commit: candidate, records: sbomRecords, schema_version: 1 })}\n`, { mode: 0o600 });
  writeFileSync(join(evidenceRoot, "smoke-identity.json"), `${JSON.stringify({ candidate_commit: candidate, records: smokeRecords, schema_version: 1 })}\n`, { mode: 0o600 });
  const candidateManifestPath = join(evidenceRoot, "candidate-manifest.json");
  const manifest = { base_commit: "a".repeat(40), candidate_commit: candidate, evidence_index: { path: "evidence-index.json", sha256: sha(evidenceIndexBody) }, generated_at: "2026-08-14T00:00:00.000Z", images: { path: "image-identity.json", sha256: sha(imageIdentityBody) }, release_control_commit: "b".repeat(40), runtime_settings: { path: "runtime-setting-inventory.json", sha256: "8".repeat(64) }, schema_version: 2, target_platform: targetPlatform };
  writeFileSync(candidateManifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  const collectionIndexPath = join(evidenceRoot, "collection-index.json");
  const files = ["sbom-identity.json", "smoke-identity.json", ...sbomRecords.map((record) => record.file), ...smokeRecords.map((record) => ({ main_crm: "smoke-crm.log", evo_inbox: "smoke-inbox.log", lead_agent: "smoke-lead-agent.log" })[record.name])].map((file) => ({ file, mode: 600, sha256: sha(readFileSync(join(evidenceRoot, file))) }));
  writeFileSync(collectionIndexPath, `${JSON.stringify({ candidate_commit: candidate, files, schema_version: 1 })}\n`, { mode: 0o600 });
  chmodSync(inputPath, 0o600);
  return { candidateManifestPath, collectionIndexPath, evidenceIndexPath, evidenceRoot, inputPath, outputPath: join(evidenceRoot, "p8c-report.json"), p8bEvidenceIndexPath, segments };
}
function rehashCollection(f, file) {
  const collection = JSON.parse(readFileSync(f.collectionIndexPath));
  collection.files.find((entry) => entry.file === file).sha256 = sha(readFileSync(join(f.evidenceRoot, file)));
  writeFileSync(f.collectionIndexPath, `${JSON.stringify(collection)}\n`, { mode: 0o600 });
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
  assert.equal(report.candidate.p8b_evidence_index_sha256, sha(readFileSync(f.p8bEvidenceIndexPath)));
  assert.equal(report.candidate.candidate_manifest_sha256, sha(readFileSync(f.candidateManifestPath)));
  assert.equal(report.candidate.candidate_evidence_index_sha256, sha(readFileSync(f.evidenceIndexPath)));
  assert.equal(report.candidate.p8b2_collection_index_sha256, sha(readFileSync(f.collectionIndexPath)));
  assert.deepEqual(report.candidate.target_platform, targetPlatform);
  assert.equal(report.schema_version, 2);
  assert.equal(report.overall_status, "blocked");
  assert.equal(JSON.parse(readFileSync(f.outputPath, "utf8")).candidate.pr_head_commit, candidate);
});

test("rejects candidates that are not the closed linux/amd64 platform", () => {
  const f = fixture();
  const manifest = JSON.parse(readFileSync(f.candidateManifestPath)); manifest.target_platform.architecture = "arm64";
  writeFileSync(f.candidateManifestPath, `${JSON.stringify(manifest)}\n`);
  assert.throws(() => createP8CReport(baseArgs(f)), /exact linux\/amd64 candidate/);
});

test("rejects tampered, mismatched, or escaping P8B2 artifacts", () => {
  const f = fixture();
  writeFileSync(f.evidenceIndexPath, '{}\n');
  assert.throws(() => createP8CReport(baseArgs(f)), /evidence index binding mismatch/);
  const escaped = fixture();
  assert.throws(() => createP8CReport({ ...baseArgs(escaped), collectionIndexPath: join(tmpdir(), "outside.json") }), /below the evidence root/);
  const mismatch = fixture();
  const collection = JSON.parse(readFileSync(mismatch.collectionIndexPath)); collection.files[0].sha256 = "f".repeat(64);
  writeFileSync(mismatch.collectionIndexPath, `${JSON.stringify(collection)}\n`);
  assert.throws(() => createP8CReport(baseArgs(mismatch)), /collection hash mismatch/);
});

test("computes the historical P8B evidence-index hash from a closed retained file", () => {
  const tampered = fixture();
  writeFileSync(tampered.p8bEvidenceIndexPath, `${JSON.stringify({ candidate_commit: "f".repeat(40), schema_version: 1, segments: p8Segments() })}\n`);
  assert.throws(() => createP8CReport(baseArgs(tampered)), /P8B evidence index candidate binding mismatch/);
  const escaped = fixture();
  assert.throws(() => createP8CReport({ ...baseArgs(escaped), p8bEvidenceIndexPath: join(tmpdir(), "p8b-outside.json") }), /below the evidence root/);
});

test("rejects schema-invalid identities, evidence results, and retained modes", () => {
  const sbom = fixture();
  const sbomIdentity = JSON.parse(readFileSync(join(sbom.evidenceRoot, "sbom-identity.json"))); sbomIdentity.records[0].platform.architecture = "arm64";
  writeFileSync(join(sbom.evidenceRoot, "sbom-identity.json"), `${JSON.stringify(sbomIdentity)}\n`, { mode: 0o600 }); rehashCollection(sbom, "sbom-identity.json");
  assert.throws(() => createP8CReport(baseArgs(sbom)), /SBOM identity record violates its closed service schema/);

  for (const [field, value] of [["exit_code", 1], ["network", "bridge"], ["restart_count", 1], ["platform", "linux/arm64"]]) {
    const smoke = fixture(); const identity = JSON.parse(readFileSync(join(smoke.evidenceRoot, "smoke-identity.json"))); identity.records[0][field] = value;
    writeFileSync(join(smoke.evidenceRoot, "smoke-identity.json"), `${JSON.stringify(identity)}\n`, { mode: 0o600 }); rehashCollection(smoke, "smoke-identity.json");
    assert.throws(() => createP8CReport(baseArgs(smoke)), /smoke identity record violates its closed service schema/);
  }

  const evidence = fixture(); const index = JSON.parse(readFileSync(evidence.evidenceIndexPath)); index.segments.image_identity.status = "blocked";
  writeFileSync(evidence.evidenceIndexPath, `${JSON.stringify(index)}\n`, { mode: 0o600 });
  const manifest = JSON.parse(readFileSync(evidence.candidateManifestPath)); manifest.evidence_index.sha256 = sha(readFileSync(evidence.evidenceIndexPath));
  writeFileSync(evidence.candidateManifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  assert.throws(() => createP8CReport(baseArgs(evidence)), /malformed or nonverified segment/);

  const mode = fixture(); chmodSync(join(mode.evidenceRoot, "sbom-crm.spdx.json"), 0o644);
  assert.throws(() => createP8CReport(baseArgs(mode)), /collection mode mismatch/);
});

test("rejects name-specific SBOM and smoke schema violations", () => {
  const mutateIdentity = (file, mutate) => {
    const f = fixture(); const path = join(f.evidenceRoot, file); const identity = JSON.parse(readFileSync(path)); mutate(identity.records);
    writeFileSync(path, `${JSON.stringify(identity)}\n`, { mode: 0o600 }); rehashCollection(f, file); return f;
  };
  const swapped = mutateIdentity("sbom-identity.json", (records) => { [records[0], records[1]] = [records[1], records[0]]; });
  assert.throws(() => createP8CReport(baseArgs(swapped)), /closed service schema/);
  for (const mutate of [
    (records) => { records[2].route = "/api/health"; },
    (records) => { records[0].image_tag = `evo-crm:${"f".repeat(40)}-linux-amd64`; },
    (records) => { records[0].started_at = "not-a-date"; },
  ]) assert.throws(() => createP8CReport(baseArgs(mutateIdentity("smoke-identity.json", mutate))), /closed service schema/);
  for (const mutate of [
    (records) => { records[0].tool = "docker-sbom latest"; },
    (records) => { records[0].file = "sbom-wrong.spdx.json"; },
    (records) => { records[0].image_tag = `evo-crm:${"f".repeat(40)}-linux-amd64`; },
  ]) assert.throws(() => createP8CReport(baseArgs(mutateIdentity("sbom-identity.json", mutate))), /closed service schema/);
});

test("keeps closed, version-discriminated report schema branches", () => {
  const schema = JSON.parse(readFileSync(join(repoRoot, "docs/schemas/p8c-environment-reconciliation.schema.json"), "utf8"));
  assert.deepEqual(schema.oneOf, [{ $ref: "#/$defs/report_v1" }, { $ref: "#/$defs/report_v2" }]);
  assert.equal(schema.$defs.report_v1.properties.schema_version.const, 1);
  assert.equal(schema.$defs.report_v1.properties.candidate.$ref, "#/$defs/candidate_v1");
  assert.equal(schema.$defs.report_v2.properties.schema_version.const, 2);
  assert.equal(schema.$defs.report_v2.properties.candidate.$ref, "#/$defs/candidate_v2");
  assert.equal(schema.$defs.report_base.additionalProperties, false);
  assert.equal(schema.$defs.candidate_v1.additionalProperties, false);
  assert.equal(schema.$defs.candidate_v2.additionalProperties, false);
  assert.ok(!schema.$defs.candidate_v1.required.includes("target_platform"));
  assert.ok(schema.$defs.candidate_v2.required.includes("target_platform"));
  const structurallyValid = (value, definition) => {
    const actual = Object.keys(value).sort(); const required = [...definition.required].sort();
    return required.every((key) => actual.includes(key)) && (definition.additionalProperties !== false || actual.every((key) => definition.properties[key]));
  };
  const v2Candidate = createP8CReport(baseArgs(fixture())).candidate;
  assert.equal(structurallyValid(v2Candidate, schema.$defs.candidate_v2), true);
  const v1Candidate = { ...v2Candidate };
  for (const key of ["candidate_evidence_index_sha256", "candidate_manifest_sha256", "p8b2_collection_index_sha256", "target_platform"]) delete v1Candidate[key];
  assert.equal(structurallyValid(v1Candidate, schema.$defs.candidate_v1), true);
  assert.equal(structurallyValid(v1Candidate, schema.$defs.candidate_v2), false);
  assert.equal(structurallyValid({ ...v1Candidate, unknown: true }, schema.$defs.candidate_v1), false);
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
