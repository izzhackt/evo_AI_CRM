import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { P8D4G, createP8D4GResult, runP8D4G, validateP8D4GResult } from "../scripts/p8d4g-production-runner.mjs";

test("partial knowledge evidence uses the collision-free P8D4S identity", () => {
  assert.equal(P8D4G.releaseId, "2026-08-17.p8d4s.1");
  assert.match(P8D4G.productionEvidenceRoot, /p8d4g-2026-08-17\.p8d4s\.1$/);
  assert.equal(P8D4G.confirmation, "EXECUTE-P8D4S-2026-08-17.P8D4S.1");
});

const schema = JSON.parse(readFileSync(new URL("../docs/schemas/p8d4g-result.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ strict: false, formats: { "date-time": true } }).compile(schema);
const hashes = { client: "1".repeat(64), clientManifest: "2".repeat(64), clientRevision: "3".repeat(64), internal: "4".repeat(64), internalManifest: "5".repeat(64), internalRevision: "6".repeat(64) };
const preflightContainers = [
  ["evo-crm-app-1", "sha256:d4626208423df2c0df24262763917b82b1157b53a115b44f02478ecf7245f580"],
  ["evo-inbox-app-1", "sha256:6d5e0a9d5ea073737bdd8c2c5621818ca7bdb76dd5b16ca5e44563d39833cb6b"],
  ["evo-crm-lead-agent-1", "sha256:3678747c1ea1c9b5655bb830296c9e4d4aedf60d3d193b438633b68eb3f97cc7"],
  ["evo-crm-waha-1", "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c"],
  ["evo-inbox-waha", "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c"],
].map(([name, image_id]) => ({ name, image_id, healthy: true, restart_count: 0 }));
const stagedArtifacts = [
  { kind: "portable_identity", filename: "portable-image-identity.json", sha256: "53fa00c63338a55925fa8d2c8d6e6faaa61d63b0f99251e50dabafd792755ccd", image_id: null },
  { kind: "image_archive", filename: `evo-crm-${P8D4G.candidateCommit}-linux-amd64.tar`, sha256: "07c9341c0aeae456b2bd51ae66a8f0ba81645e49f064a212cdc1485df0db50b1", image_id: "sha256:3174e8e35f27ca3983e971d6f4b94b6863a5b64a9ffd751042b3db5ed2f8c55a" },
  { kind: "image_archive", filename: `evo-inbox-${P8D4G.candidateCommit}-linux-amd64.tar`, sha256: "6bbeadd9e7571db018e0d9932cddfd8f22503b0090c4a27467af9a071eef5a48", image_id: "sha256:d7be064bdd690ac42f9e18fbcb32b8fb42eac32f588256a983393ede9f8b79ca" },
  { kind: "image_archive", filename: `evo-lead-agent-${P8D4G.candidateCommit}-linux-amd64.tar`, sha256: "32b2937ef5bd2e23ae5c5b405242bade6e9af237165649f737d97a935c709063", image_id: "sha256:9194b569df458a7a80792ca3f4aebfa417204961f229585178aa91c710d45c01" },
];
const rollbackFiles = [
  ["image", "crm", preflightContainers[0].image_id], ["image", "inbox", preflightContainers[1].image_id], ["image", "lead_agent", preflightContainers[2].image_id],
  ["env", "crm", null], ["env", "inbox", null], ["env", "lead_agent", null],
  ["compose", "crm", null], ["compose", "inbox", null], ["compose", "lead_agent", null],
].map(([kind, name, image_id], index) => ({ kind, name, sha256: String(index + 1).repeat(64), image_id }));
const executionControl = {
  status: "verified", implementation_commit: "a".repeat(40), implementation_tree: "b".repeat(40), implementation_ci_run: 101,
  execution_commit: "c".repeat(40), execution_tree: "d".repeat(40), execution_ci_run: 102,
  files: ["scripts/p8d4g-production-runner.mjs", "scripts/p8d4g-production-operations.mjs", "docs/schemas/p8d4g-result.schema.json", "docs/schemas/p8d4g-execution-control.schema.json", "package.json"].map((path, index) => ({ path, sha256: String(index + 1).repeat(64) })),
};
const failedKnowledgeProgress = {
  account_resolution: "exactly_one_active",
  deterministic_builds: "verified",
  failure_step: "client_bundle_transfer",
  failure_attempt: 3,
  audiences: [
    { name: "client", status: "failed", document_count: 11, chunk_count: null, bundle_sha256: hashes.client, manifest_sha256: hashes.clientManifest, database_revision_sha256: null },
    { name: "internal", status: "built", document_count: 291, chunk_count: null, bundle_sha256: hashes.internal, manifest_sha256: hashes.internalManifest, database_revision_sha256: null },
  ],
};

function outputTarget() {
  const root = mkdtempSync(join(tmpdir(), "p8d4g-result-"));
  return { root, output: join(root, "result.json") };
}

function operations(overrides = {}) {
  const calls = [];
  const adapter = {
    calls,
    async preflight() { calls.push("preflight"); return { status: "verified", execution_control: executionControl, containers: preflightContainers, migration_range: "001-076", migration_count: 76, candidate_tag_boundary_verified: true, roots_absent: true, rollback_inputs_verified: true }; },
    async stage() { calls.push("stage"); return { status: "verified", archives_verified: 3, images_verified: 3, rollback_verified: true, release_repo_verified: true, artifacts: stagedArtifacts, rollback_files: rollbackFiles }; },
    async configureDisabled() { calls.push("configureDisabled"); return { status: "verified", files_verified: 3, disabled_state_verified: true, waha_unchanged: true }; },
    async verifyMigrations() { calls.push("verifyMigrations"); return { status: "verified_noop", range: "001-076", count: 76, project_status: "ACTIVE_HEALTHY" }; },
    async publishKnowledge() { calls.push("publishKnowledge"); return { account_resolution: "exactly_one_active", deterministic_builds: "verified", failure_step: null, failure_attempt: null, artifacts_created: true, audiences: [
      { name: "client", status: "verified", document_count: 11, chunk_count: 20, bundle_sha256: hashes.client, manifest_sha256: hashes.clientManifest, database_revision_sha256: hashes.clientRevision },
      { name: "internal", status: "verified", document_count: 291, chunk_count: 500, bundle_sha256: hashes.internal, manifest_sha256: hashes.internalManifest, database_revision_sha256: hashes.internalRevision },
    ] }; },
    async deploy(name) { calls.push(`deploy:${name}`); const ids = { inbox: "sha256:dfc1aae9743e2b6bf6d7e174933c36cd89e03e5d769b859f2aaaa557a7a68af3", crm: "sha256:34c0f3806a934c7b09c92cea6c4420a0c8ab3d2acb586e45a9b872f01f85d281", lead_agent: "sha256:a50289ffadf3e73b121a56fd1a5621164ddc9e723a58e8280a0a8536f7484ac3" }; return { name, status: "verified", image_id: ids[name], healthy: true, restart_count: 0, disabled_state: true }; },
    async pilot(caseId) { calls.push(`pilot:${caseId}`); return { case_id: caseId, audience: caseId.startsWith("client_") ? "client" : "internal", status: "verified", http_status: 200, expected_source_match: true, cross_audience_sources: 0, audit_body_free: true, side_effect_free: true }; },
    async rollback(boundaries) { calls.push(`rollback:${boundaries.join(",")}`); return { status: "verified", boundaries }; },
    async cleanupKnowledge() { calls.push("cleanupKnowledge"); return { status: "verified", local_roots_removed: 4, remote_pairs_removed: 2, container_pairs_removed: 2, importer_removed: true }; },
  };
  return Object.assign(adapter, overrides);
}

function clock() {
  let tick = Date.parse("2026-08-16T02:30:00.000Z");
  return () => new Date(tick += 1000);
}

test("preflight is read-only and writes a closed result", async () => {
  const target = outputTarget();
  try {
    const adapter = operations();
    const result = await runP8D4G({ mode: "preflight", outputPath: target.output, operations: adapter, now: clock() });
    assert.equal(result.result_code, "preflight_verified");
    assert.deepEqual(adapter.calls, ["preflight"]);
    assert.equal(validate(JSON.parse(readFileSync(target.output, "utf8"))), true, JSON.stringify(validate.errors));
  } finally { rmSync(target.root, { recursive: true, force: true }); }
});

test("execute follows the frozen order and verifies the complete pilot", async () => {
  const target = outputTarget();
  try {
    const adapter = operations();
    const result = await runP8D4G({ mode: "execute", confirmation: P8D4G.confirmation, outputPath: target.output, operations: adapter, now: clock() });
    assert.equal(result.result_code, "pilot_verified");
    assert.deepEqual(adapter.calls, ["preflight", "stage", "configureDisabled", "verifyMigrations", "publishKnowledge", "cleanupKnowledge", "deploy:inbox", "deploy:crm", "deploy:lead_agent", "pilot:client_china_documents", "pilot:internal_malaysia_handoff"]);
    assert.equal(validateP8D4GResult(result), true);
    assert.equal(result.proof.preflight_containers.length, 5);
    assert.equal(result.proof.execution_control.status, "verified");
    assert.equal(result.proof.transferred_artifacts.length, 4);
    assert.equal(result.proof.rollback_files.length, 9);
    assert.deepEqual(result.proof.migrations, { status: "verified_noop", before_range: "001-076", before_count: 76, after_range: "001-076", after_count: 76, applied_count: 0, project_status: "ACTIVE_HEALTHY" });
    const missingArtifacts = structuredClone(result);
    missingArtifacts.proof.transferred_artifacts = [];
    assert.equal(validate(missingArtifacts), false);
    const missingRollbackHash = structuredClone(result);
    missingRollbackHash.proof.rollback_files[3].sha256 = null;
    assert.equal(validate(missingRollbackHash), false);
  } finally { rmSync(target.root, { recursive: true, force: true }); }
});

test("a later deployment failure rolls back completed boundaries in reverse", async () => {
  const target = outputTarget();
  try {
    const adapter = operations({ async deploy(name) { this.calls.push(`deploy:${name}`); if (name === "lead_agent") throw new Error("simulated failure"); return operations().deploy(name); } });
    await assert.rejects(runP8D4G({ mode: "execute", confirmation: P8D4G.confirmation, outputPath: target.output, operations: adapter, now: clock() }), /P8D4G stopped/);
    const result = JSON.parse(readFileSync(target.output, "utf8"));
    assert.equal(result.result_code, "deployment_failed");
    assert.deepEqual(result.rollback, { status: "verified", boundaries: ["lead_agent", "crm", "inbox"] });
    assert.equal(adapter.calls.at(-1), "rollback:lead_agent,crm,inbox");
  } finally { rmSync(target.root, { recursive: true, force: true }); }
});

test("knowledge failure retains safe partial progress before cleanup", async () => {
  const target = outputTarget();
  try {
    const adapter = operations({ async publishKnowledge({ onProgress }) { this.calls.push("publishKnowledge"); onProgress(failedKnowledgeProgress); throw new Error("simulated transfer failure"); } });
    await assert.rejects(runP8D4G({ mode: "execute", confirmation: P8D4G.confirmation, outputPath: target.output, operations: adapter, now: clock() }));
    assert.equal(adapter.calls.at(-1), "cleanupKnowledge");
    const result = JSON.parse(readFileSync(target.output, "utf8"));
    assert.equal(result.cleanup.status, "verified");
    assert.equal(result.result_code, "knowledge_failed");
    assert.deepEqual(result.knowledge, failedKnowledgeProgress);
    assert.equal(validate(result), true, JSON.stringify(validate.errors));
  } finally { rmSync(target.root, { recursive: true, force: true }); }
});

test("cleanup failure overrides the primary error and blocks deployment", async () => {
  const target = outputTarget();
  try {
    const adapter = operations({ async publishKnowledge({ onProgress }) { this.calls.push("publishKnowledge"); onProgress(failedKnowledgeProgress); throw new Error("simulated transfer failure"); }, async cleanupKnowledge() { this.calls.push("cleanupKnowledge"); throw new Error("simulated cleanup failure"); } });
    await assert.rejects(runP8D4G({ mode: "execute", confirmation: P8D4G.confirmation, outputPath: target.output, operations: adapter, now: clock() }), (error) => error.code === "cleanup_failed");
    const result = JSON.parse(readFileSync(target.output, "utf8"));
    assert.equal(result.result_code, "cleanup_failed");
    assert.equal(result.cleanup.status, "failed");
    assert.equal(adapter.calls.some((item) => item.startsWith("deploy:")), false);
  } finally { rmSync(target.root, { recursive: true, force: true }); }
});

test("expired authorization stops before the next effect", async () => {
  const target = outputTarget();
  let tick = Date.parse("2026-08-16T02:30:00.000Z");
  const times = [0, 1, 2, P8D4G.windowMs + 2].map((offset) => new Date(tick + offset));
  const now = () => times.shift() ?? new Date(tick + P8D4G.windowMs + 2);
  try {
    const adapter = operations();
    await assert.rejects(
      runP8D4G({ mode: "execute", confirmation: P8D4G.confirmation, outputPath: target.output, operations: adapter, now }),
      (error) => error.code === "operation_failed",
    );
    assert.deepEqual(adapter.calls, ["preflight", "stage"]);
    assert.equal(JSON.parse(readFileSync(target.output, "utf8")).window.status, "expired");
  } finally { rmSync(target.root, { recursive: true, force: true }); }
});

test("redacted evidence rejects UUIDs, secret-shaped keys and false success", () => {
  const result = createP8D4GResult(new Date("2026-08-16T02:30:00.000Z"));
  result.extra = "not allowed";
  assert.equal(validate(result), false);
  delete result.extra;
  result.knowledge.account_id = "00000000-0000-4000-8000-000000000000";
  assert.throws(() => validateP8D4GResult(result), /forbidden/);
});

test("knowledge failure schema rejects contradictory partial progress", () => {
  const base = createP8D4GResult(new Date("2026-08-17T17:23:08.000Z"));
  base.result_code = "knowledge_failed";
  base.phases.knowledge = "failed";
  base.knowledge = structuredClone(failedKnowledgeProgress);
  assert.equal(validate(base), true, JSON.stringify(validate.errors));

  const cases = [
    (value) => { value.knowledge.failure_attempt = null; },
    (value) => { value.knowledge.failure_step = "importer_creation"; },
    (value) => { value.knowledge.audiences[0].status = "not_run"; },
    (value) => { value.knowledge.audiences[0].status = "verified"; },
    (value) => { value.knowledge.failure_step = null; },
    (value) => {
      value.knowledge.account_resolution = "not_run";
      value.knowledge.deterministic_builds = "not_run";
      value.knowledge.failure_attempt = 1;
      value.knowledge.audiences[0].status = "built";
    },
    (value) => {
      value.knowledge.failure_step = "internal_bundle_transfer";
      value.knowledge.failure_attempt = 1;
    },
    (value) => {
      value.knowledge.failure_step = "account_resolution";
      value.knowledge.failure_attempt = null;
      value.knowledge.account_resolution = "failed";
      value.knowledge.deterministic_builds = "not_run";
    },
  ];
  for (const mutate of cases) {
    const invalid = structuredClone(base);
    mutate(invalid);
    assert.equal(validate(invalid), false, "contradictory knowledge evidence must fail closed");
  }
  const impossibleTransfer = structuredClone(base);
  impossibleTransfer.knowledge.account_resolution = "not_run";
  impossibleTransfer.knowledge.deterministic_builds = "not_run";
  impossibleTransfer.knowledge.failure_attempt = 1;
  impossibleTransfer.knowledge.audiences[0].status = "built";
  assert.throws(() => validateP8D4GResult(impossibleTransfer), /order is contradictory/);
});
