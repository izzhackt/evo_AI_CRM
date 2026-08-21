import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { runP8V3Preflight, validateP8V3Preflight } from "../scripts/p8v3-preflight.mjs";
import {
  configurationInstallScript,
  configurationRestoreScript,
  configurationSshArgs,
  commandSshArgs,
  createP8V3ProductionOperations,
  createP8V3PublicRestReader,
  P8V3_IMAGES,
  parseP8V3KnowledgeImporterOutputForTest,
  parseP8V3ProviderProbeOutputForTest,
  parseP8V3ContainerRowsForTest,
  renderP8V3CandidateImageBoundaryForTest,
  renderP8V3KnowledgeCleanupForTest,
  renderP8V3PreflightCleanupForTest,
  renderP8V3ShellContractsForTest,
  runP8V3StreamedRemoteForTest,
  verifyP8V3FGemini,
  verifyP8V3FImporterBuild,
  verifyP8V3HRemoteCommandFormsForTest,
  validateCandidateComposeForTest,
  validateP8V3DMigrationReadiness,
  validateP8V3EvidencePrivacy,
  validateP8V3RetrievalProvider,
} from "../scripts/p8v3-production-operations.mjs";
import {
  P8V3,
  runP8V3Rollout,
  validateP8V3Result,
} from "../scripts/p8v3-rollout.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const IMAGE_A = `sha256:${SHA_A}`;
const IMAGE_B = `sha256:${SHA_B}`;
const WAHA_IMAGE = `sha256:${SHA_C}`;

function testCredential() {
  return ["not", "a", "real", "credential"].join("-");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function container(name, index, image = IMAGE_A) {
  return {
    name,
    container_id: `${index}`.repeat(64),
    image_id: image,
    health: "healthy",
    restart_count: 0,
    networks: ["private"],
  };
}

function operations(overrides = {}) {
  const calls = [];
  const preState = [
    container("evo-crm-app-1", 1),
    container("evo-crm-waha-1", 2, WAHA_IMAGE),
    container("evo-crm-lead-agent-1", 3),
    container("evo-inbox-app-1", 4),
    container("evo-inbox-waha", 5, WAHA_IMAGE),
  ];
  const waha = {
    crm_container_id: preState[1].container_id,
    crm_image_id: WAHA_IMAGE,
    inbox_container_id: preState[4].container_id,
    inbox_image_id: WAHA_IMAGE,
    unchanged: false,
  };
  const execution = { commit: "d".repeat(40), tree: "e".repeat(40), ci_run_id: 123 };
  const preflight = {
    version: "p8v3k-production-preflight/v1",
    generated_at: "2026-08-20T05:55:00.000Z",
    expires_at: "2026-08-20T06:25:00.000Z",
    execution,
    application: { commit: P8V3.applicationCommit, tree: P8V3.applicationTree },
    containers: preState,
    waha,
    migration: { versions: Array.from({ length: 77 }, (_, index) => String(index + 1).padStart(3, "0")), range: "001-077", count: 77 },
    archives: ["crm", "inbox", "lead_agent"].map((name) => ({ name, sha256: SHA_A, size: 1, index: IMAGE_A, platform: IMAGE_B })),
    gemini: { embedding_verified: true, draft_verified: true, retrieval_provider_verified: true, server_compose_verified: true },
    importer: { sha256: SHA_A, size: 1, verified: true },
    importer_network: { name: "evo_crm_private", driver: "bridge", scope: "local", internal: false, dns: "127.0.0.11" },
    compose_validated: true,
    prerequisites_verified: true,
  };
  const adapter = {
    calls,
    preflight,
    async executionIdentity() { calls.push("executionIdentity"); return execution; },
    async verifyPreflight() { calls.push("verifyPreflight"); return { status: "verified" }; },
    async configure() { calls.push("configure"); return { status: "verified", installed_names: [...P8V3.requiredConfigurationNames], backup_sha256: SHA_A, lead_file_verified: true, worker_file_verified: true }; },
    async restoreConfiguration() { calls.push("restoreConfiguration"); return { configuration_restored: true }; },
    async migrate() { calls.push("migrate"); return { status: "verified", before_range: "001-077", before_count: 77, after_range: "001-077", after_count: 77, applied_versions: [] }; },
    async importKnowledge(name) {
      calls.push(`importKnowledge:${name}`);
      return { name, status: "verified", document_count: name === "client" ? 11 : 291, chunk_count: name === "client" ? 20 : 400, bundle_sha256: SHA_A, manifest_sha256: SHA_B, database_revision_sha256: SHA_C };
    },
    async cleanupKnowledge() { calls.push("cleanupKnowledge"); return { status: "verified" }; },
    async cleanupPreparedReadiness() { calls.push("cleanupPreparedReadiness"); return { status: "verified" }; },
    async deploy(name, { before }) {
      calls.push(`deploy:${name}`);
      const original = before.find((item) => item.name === ({ crm: "evo-crm-app-1", inbox: "evo-inbox-app-1", lead_agent: "evo-crm-lead-agent-1" })[name]);
      return { name, status: "verified", before_image_id: original.image_id, after_image_id: IMAGE_B, container_id: "f".repeat(64), health: "healthy", restart_count: 0, networks: ["private"], disabled_state: true, manual_worker: name === "crm" ? "verified" : "not_applicable" };
    },
    async verifyWaha() { calls.push("verifyWaha"); return { ...waha, unchanged: true }; },
    async rollback(names) { calls.push(`rollback:${names.join(",")}`); return { status: "verified", configuration_restored: true }; },
    async publishEvidence(result) { calls.push(`publishEvidence:${result.result_code}`); },
    async cleanupEvidence() { calls.push("cleanupEvidence"); },
    ...overrides,
  };
  return adapter;
}

test("P8V3 executes the reviewed success order and produces closed evidence", async () => {
  const adapter = operations();
  const now = () => Date.parse("2026-08-20T06:00:00.000Z");
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now });
  assert.equal(result.result_code, "rollout_verified");
  assert.deepEqual(adapter.calls, [
    "executionIdentity", "verifyPreflight", "configure", "migrate",
    "importKnowledge:client", "importKnowledge:internal", "cleanupKnowledge",
    "deploy:crm", "deploy:inbox", "deploy:lead_agent", "verifyWaha",
    "publishEvidence:rollout_verified",
  ]);
  assert.equal(result.effects.waha_recreates, 0);
  assert.equal(result.effects.migration_applied, 0);
  assert.equal(result.effects.amo_writes, 0);
  assert.equal(result.effects.whatsapp_sends, 0);
  assert.equal(validateP8V3Result(result), result);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("P8V3 preflight produces the closed short-lived handoff consumed by rollout", async () => {
  const adapter = operations();
  const result = await runP8V3Preflight({
    operations: {
      executionIdentity: () => adapter.preflight.execution,
      preflight: () => ({
        containers: adapter.preflight.containers,
        waha: adapter.preflight.waha,
        migration: adapter.preflight.migration,
        archives: adapter.preflight.archives,
        gemini: adapter.preflight.gemini,
        importer: adapter.preflight.importer,
        importer_network: adapter.preflight.importer_network,
        compose_validated: true,
        prerequisites_verified: true,
      }),
    },
    now: () => Date.parse("2026-08-20T05:55:00.000Z"),
  });
  assert.equal(validateP8V3Preflight(result), result);
  assert.equal(result.expires_at, "2026-08-20T06:25:00.000Z");
  const stale = structuredClone(result);
  stale.migration = { versions: result.migration.versions.slice(0, 76), range: "001-076", count: 76 };
  assert.throws(() => validateP8V3Preflight(stale), /migration drifted/);
});

test("a failed current boundary rolls back apps but retains forward-only reconciliation", async () => {
  const adapter = operations({
    async deploy(name, context) {
      this.calls.push(`deploy:${name}`);
      if (name === "lead_agent") { const error = new Error("lead failed"); error.code = "deployment_failed"; throw error; }
      return operations().deploy(name, context);
    },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.equal(result.result_code, "rollout_failed_reconciliation_required");
  assert.deepEqual(result.rollback.boundaries, ["lead_agent", "inbox", "crm"]);
  assert.equal(adapter.calls.includes("rollback:lead_agent,inbox,crm"), true);
  assert.equal(result.steps[6].status, "failed");
  assert.equal(result.effects.application_recreates, 2);
});

test("configuration failure is recorded inside pre-state and restoration is attempted", async () => {
  const adapter = operations({
    async configure() { this.calls.push("configure"); const error = new Error("config failed"); error.code = "configuration_failed"; throw error; },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.equal(result.result_code, "rollout_failed_rolled_back");
  assert.equal(result.steps[0].status, "failed");
  assert.equal(result.failure.code, "configuration_failed");
  assert.equal(adapter.calls.includes("restoreConfiguration"), true);
  assert.equal(adapter.calls.includes("cleanupPreparedReadiness"), true);
  assert.equal(adapter.calls.some((item) => item.startsWith("deploy:")), false);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("failure identity must match the one failed progression step", async () => {
  const adapter = operations({
    async configure() { this.calls.push("configure"); const error = new Error("config failed"); error.code = "configuration_failed"; throw error; },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  const contradictory = structuredClone(result);
  contradictory.failure.step = "crm";
  assert.throws(() => validateP8V3Result(contradictory), /failure step does not match progression/);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(contradictory), false);
});

test("schema rejects false success and failed results without failure evidence", async () => {
  const adapter = operations();
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);

  const falseSuccess = structuredClone(result);
  falseSuccess.steps.forEach((step) => { step.status = "not_run"; });
  assert.throws(() => validateP8V3Result(falseSuccess), /false rollout success/);
  assert.equal(validate(falseSuccess), false);

  const missingFailure = structuredClone(result);
  missingFailure.result_code = "rollout_failed_reconciliation_required";
  assert.throws(() => validateP8V3Result(missingFailure), /missing failure evidence/);
  assert.equal(validate(missingFailure), false);
});

test("P8V3E cannot claim that it newly applied migration 077", async () => {
  const adapter = operations();
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  const contradictory = structuredClone(result);
  contradictory.result_code = "rollout_failed_reconciliation_required";
  contradictory.failure = { step: "migration", code: "migration_failed" };
  contradictory.steps[1].status = "failed";
  contradictory.steps.slice(2).forEach((step) => { step.status = "not_run"; });
  contradictory.migration = {
    status: "observed_applied",
    before_range: "001-076",
    before_count: 76,
    after_range: "001-077",
    after_count: 77,
    applied_versions: ["077"],
  };
  contradictory.effects.migration_applied = 1;

  assert.throws(() => validateP8V3Result(contradictory), /cannot report a newly applied migration/);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(contradictory), false);
});

test("success evidence requires every verified record proof", async () => {
  const adapter = operations();
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const mutations = [
    (value) => { value.configuration.backup_sha256 = null; },
    (value) => { value.knowledge.audiences[0].bundle_sha256 = null; },
    (value) => { value.migration.after_count = null; },
    (value) => { value.boundaries[0].container_id = null; },
  ];
  for (const mutate of mutations) {
    const contradictory = structuredClone(result);
    mutate(contradictory);
    assert.throws(() => validateP8V3Result(contradictory), /drifted/);
    assert.equal(validate(contradictory), false);
  }
});

test("evidence failure cannot hide skipped rollout progression", async () => {
  const adapter = operations();
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  const contradictory = structuredClone(result);
  contradictory.result_code = "evidence_failed";
  contradictory.failure = { step: "evidence", code: "evidence_publication_failed" };
  contradictory.steps[1].status = "not_run";
  assert.throws(() => validateP8V3Result(contradictory), /step progression skipped a boundary/);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(contradictory), false);
});

test("a P8V3E migration reconciliation failure restores configuration with zero forward effects", async () => {
  const adapter = operations({
    async migrate() {
      this.calls.push("migrate");
      const error = new Error("read-only proof drifted");
      error.code = "migration_failed";
      throw error;
    },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.equal(result.result_code, "rollout_failed_rolled_back");
  assert.equal(result.failure.step, "migration");
  assert.equal(result.migration.status, "not_run");
  assert.equal(result.effects.migration_applied, 0);
  assert.equal(result.rollback.configuration_restored, true);
  assert.equal(adapter.calls.some((item) => item.startsWith("deploy:")), false);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("knowledge failure cleans temporary artifacts before any application deployment", async () => {
  const adapter = operations({
    async importKnowledge(name) { this.calls.push(`importKnowledge:${name}`); const error = new Error("transfer failed"); error.code = "knowledge_failed"; error.reasonCode = "provider_rate_limited"; throw error; },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.deepEqual(result.failure, {
    step: "client_import",
    code: "knowledge_failed",
    reason_code: "provider_rate_limited",
  });
  assert.equal(adapter.calls.includes("cleanupKnowledge"), true);
  assert.equal(adapter.calls.some((item) => item.startsWith("deploy:")), false);
  const missingReason = structuredClone(result);
  delete missingReason.failure.reason_code;
  assert.throws(() => validateP8V3Result(missingReason), /closed|reason/u);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(missingReason), false);
  const retainedP8V3I = structuredClone(result);
  retainedP8V3I.authorization.id = P8V3.previousAuthorization;
  assert.equal(validateP8V3Result(retainedP8V3I), retainedP8V3I);
  assert.equal(validate(retainedP8V3I), true, JSON.stringify(validate.errors));
});

test("knowledge importer output maps only closed safe blocker codes into rollout errors", () => {
  const reasonCodes = [
    "provider_rate_limited",
    "provider_rejected",
    "bundle_invalid",
    "manifest_mismatch",
    "account_binding_failed",
    "rpc_rejected",
    "transport_failed",
  ];
  for (const reasonCode of reasonCodes) {
    assert.throws(
      () => parseP8V3KnowledgeImporterOutputForTest(`${JSON.stringify({
        status: "knowledge_import_blocked",
        version: 1,
        audience: "client",
        reason_code: reasonCode,
      })}\n`, "client", SHA_A),
      (error) => error?.code === "knowledge_failed" && error?.reasonCode === reasonCode,
    );
  }
  assert.throws(
    () => parseP8V3KnowledgeImporterOutputForTest(`${JSON.stringify({
      status: "knowledge_import_blocked",
      version: 1,
      audience: "client",
      reason_code: "private free text",
    })}\n`, "client", SHA_A),
    (error) => error?.code === "knowledge_failed" && error?.reasonCode === "transport_failed",
  );
  assert.deepEqual(parseP8V3KnowledgeImporterOutputForTest(`${JSON.stringify({
    status: "knowledge_import_verified",
    version: 1,
    audience: "client",
    bundle_sha256: SHA_A,
    documents_upserted: 11,
    documents_deleted: 0,
    chunks_replaced: 17,
  })}\n`, "client", SHA_A), {
    status: "knowledge_import_verified",
    version: 1,
    audience: "client",
    bundle_sha256: SHA_A,
    documents_upserted: 11,
    documents_deleted: 0,
    chunks_replaced: 17,
  });

  const valid = `${JSON.stringify({
    status: "knowledge_import_blocked",
    version: 1,
    audience: "client",
    reason_code: "provider_rate_limited",
  })}\n`;
  for (const unsafe of [
    valid.slice(0, -1),
    `UNAPPROVED_PREFIX\n${valid}`,
    `${valid}UNAPPROVED_SUFFIX\n`,
    `${valid}\n`,
    valid.replace("\n", "\r\n"),
  ]) {
    assert.throws(
      () => parseP8V3KnowledgeImporterOutputForTest(unsafe, "client", SHA_A),
      (error) => error?.code === "knowledge_failed" && error?.reasonCode === "transport_failed",
    );
  }
});

test("P8V3K provider probe accepts only one exact safe record", () => {
  const verified = `${JSON.stringify({
    status: "knowledge_import_provider_verified",
    version: 1,
    model: "gemini-embedding-2",
    vectors: 17,
    dimensions: 1_536,
    uid: 1_001,
    gid: 1_001,
  })}\n`;
  assert.deepEqual(parseP8V3ProviderProbeOutputForTest(verified), { server_compose_verified: true });

  assert.throws(
    () => parseP8V3ProviderProbeOutputForTest(`${JSON.stringify({
      status: "knowledge_import_provider_blocked",
      version: 1,
      reason_code: "provider_rate_limited",
    })}\n`),
    (error) => error?.code === "preflight_drift",
  );

  for (const unsafe of [verified.slice(0, -1), `${verified}\n`, `prefix\n${verified}`, verified.replace("\n", "\r\n")]) {
    assert.throws(
      () => parseP8V3ProviderProbeOutputForTest(unsafe),
      (error) => error?.code === "preflight_drift",
    );
  }
});

test("forward-only failures cannot be relabeled as fully rolled back", async () => {
  const scenarios = [
    operations({
      async importKnowledge(name) { this.calls.push(`importKnowledge:${name}`); const error = new Error("transfer failed"); error.code = "knowledge_failed"; throw error; },
    }),
    operations({
      async deploy(name, context) {
        this.calls.push(`deploy:${name}`);
        if (name === "crm") { const error = new Error("deploy failed"); error.code = "deployment_failed"; throw error; }
        return operations().deploy(name, context);
      },
    }),
  ];
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  for (const adapter of scenarios) {
    const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
    const contradictory = structuredClone(result);
    contradictory.result_code = "rollout_failed_rolled_back";
    assert.throws(() => validateP8V3Result(contradictory), /false fully rolled-back result/);
    assert.equal(validate(contradictory), false);
  }
});

test("evidence publication failure cannot retain a false success result", async () => {
  const adapter = operations({
    async publishEvidence(result) { this.calls.push(`publishEvidence:${result.result_code}`); const error = new Error("publish failed"); error.code = "evidence_publication_failed"; throw error; },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.equal(result.result_code, "evidence_failed");
  assert.deepEqual(result.failure, { step: "evidence", code: "evidence_publication_failed" });
  assert.equal(adapter.calls.at(-1), "cleanupEvidence");
});

test("evidence privacy rejects a UUID embedded inside retained JSON", () => {
  assert.throws(
    () => validateP8V3EvidencePrivacy('{"account":"550e8400-e29b-41d4-a716-446655440000"}'),
    /privacy validation failed/,
  );
  assert.doesNotThrow(() => validateP8V3EvidencePrivacy('{"account_bound":true}'));
});

test("retained SHA-bound P8V3E evidence remains valid under the historical closed shape", () => {
  const raw = readFileSync(join(process.cwd(), "tests/fixtures/p8v3e-retained-rollout-result.json"));
  assert.equal(sha256(raw), "328dd56efc616b1492b42c399651733186a5167e8214798b8e21eef5f60fa185");
  const result = JSON.parse(raw.toString("utf8"));
  assert.equal(Object.hasOwn(result.configuration, "lead_file_verified"), false);
  assert.doesNotThrow(() => validateP8V3Result(result));
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("P8V3F Gemini preflight sends two exact no-retry credential-safe requests", async () => {
  const apiKey = testCredential();
  const calls = [];
  const result = await verifyP8V3FGemini({
    apiKey,
    async fetchImpl(url, init) {
      calls.push({ url, init, body: JSON.parse(init.body) });
      if (url.endsWith("gemini-embedding-2:batchEmbedContents")) {
        return new Response(JSON.stringify({ embeddings: [{ values: Array.from({ length: 1536 }, () => 0.01) }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"reply":"READY","handoff":false}' }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(result, { embedding_verified: true, draft_verified: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers["x-goog-api-key"], apiKey);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].body.requests[0].content.parts[0].text, "title: EVO P8V3F readiness | text: EVO P8V3F readiness probe");
  assert.equal(Object.hasOwn(calls[0].body.requests[0], "taskType"), false);
  assert.equal(calls[0].body.requests[0].outputDimensionality, 1536);
  assert.equal(calls[1].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(calls[1].body, {
    store: false,
    contents: [{ role: "user", parts: [{ text: 'Return exactly this JSON object and nothing else: {"reply":"READY","handoff":false}' }] }],
    generationConfig: {
      maxOutputTokens: 128,
      candidateCount: 1,
      thinkingConfig: { thinkingLevel: "MINIMAL" },
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["reply", "handoff"],
        properties: {
          reply: { type: "string", enum: ["READY"] },
          handoff: { type: "boolean" },
        },
      },
    },
  });
  assert.equal(calls.some((call) => initContains(call.init.body, apiKey)), false);
});

test("P8V3F Gemini preflight does not retry quota failure or accept a credential leak", async () => {
  const apiKey = testCredential();
  let calls = 0;
  await assert.rejects(verifyP8V3FGemini({
    apiKey,
    async fetchImpl() { calls += 1; return new Response('{"error":"quota"}', { status: 429 }); },
  }), /failed/);
  assert.equal(calls, 1);
  await assert.rejects(verifyP8V3FGemini({
    apiKey,
    async fetchImpl() { return new Response(JSON.stringify({ leaked: apiKey }), { status: 200 }); },
  }), /leaked the credential/);
});

test("P8V3F Gemini draft probe rejects extra candidates and content parts", async () => {
  const apiKey = testCredential();
  for (const draft of [
    { candidates: [
      { content: { parts: [{ text: '{"reply":"READY","handoff":false}' }] } },
      { content: { parts: [{ text: '{"reply":"READY","handoff":false}' }] } },
    ] },
    { candidates: [{ content: { parts: [
      { text: '{"reply":"READY","handoff":false}' },
      { text: "extra" },
    ] } }] },
  ]) {
    let calls = 0;
    await assert.rejects(verifyP8V3FGemini({
      apiKey,
      async fetchImpl(url) {
        calls += 1;
        return url.endsWith("gemini-embedding-2:batchEmbedContents")
          ? new Response(JSON.stringify({ embeddings: [{ values: Array.from({ length: 1536 }, () => 0.01) }] }), { status: 200 })
          : new Response(JSON.stringify(draft), { status: 200 });
      },
    }), /draft readiness drifted/);
    assert.equal(calls, 2);
  }
});

test("P8V3F Gemini draft probe rejects a MAX_TOKENS truncated JSON response", async () => {
  const apiKey = testCredential();
  let calls = 0;
  await assert.rejects(verifyP8V3FGemini({
    apiKey,
    async fetchImpl(url) {
      calls += 1;
      return url.endsWith("gemini-embedding-2:batchEmbedContents")
        ? new Response(JSON.stringify({ embeddings: [{ values: Array.from({ length: 1536 }, () => 0.01) }] }), { status: 200 })
        : new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "He" }] } }] }), { status: 200 });
    },
  }), /draft readiness drifted/);
  assert.equal(calls, 2);
});

test("P8V3F importer build is deterministic and bounded", () => {
  const result = verifyP8V3FImporterBuild({ sourceRoot: process.cwd() });
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.ok(result.size > 0 && result.size <= 4 * 1024 * 1024);
  assert.equal(result.verified, true);
});

test("P8V3F importer removes the first temporary root when the second build fails", () => {
  const prefix = "evo-p8v3f-importer-";
  const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(prefix)));
  let build = 0;
  assert.throws(() => verifyP8V3FImporterBuild({
    sourceRoot: process.cwd(),
    run(_command, args) {
      build += 1;
      if (build === 2) throw new Error("second build failed");
      const output = args.find((arg) => arg.startsWith("--outfile=")).slice("--outfile=".length);
      writeFileSync(output, "deterministic importer\n");
      return { status: 0, stdout: "", stderr: "" };
    },
  }), /second build failed/);
  const after = readdirSync(tmpdir()).filter((name) => name.startsWith(prefix));
  assert.deepEqual(after.filter((name) => !before.has(name)), []);
});

function createConfigurationRollbackFixture(marker = "absent\n") {
  const fixture = mkdtempSync(join(realpathSync(tmpdir()), "p8v3f-config-restore-"));
  const crmRoot = join(fixture, "crm");
  const rollbackRoot = join(fixture, "rollback");
  mkdirSync(crmRoot, { mode: 0o700 });
  mkdirSync(rollbackRoot, { mode: 0o700 });
  for (const [name, bytes] of [
    ["env.production.before", "old-root\n"],
    ["env.lead-agent.before", "old-lead\n"],
    ["worker.prestate", marker],
  ]) {
    writeFileSync(join(rollbackRoot, name), bytes, { mode: 0o600 });
    chmodSync(join(rollbackRoot, name), 0o600);
  }
  writeFileSync(join(crmRoot, ".env.production"), "current-root\n", { mode: 0o600 });
  writeFileSync(join(crmRoot, ".env.lead-agent"), "current-lead\n", { mode: 0o600 });
  writeFileSync(join(crmRoot, ".env.manual-send-worker"), "current-worker\n", { mode: 0o600 });
  return { fixture, crmRoot, rollbackRoot };
}

function runConfigurationRestore(input, expectedUid = process.getuid(), expectedGid = process.getgid()) {
  return spawnSync("bash", ["-seu"], {
    input: configurationRestoreScript({ ...input, expectedUid, expectedGid }),
    encoding: "utf8",
  });
}

test("P8V3F configuration restore validates the complete rollback root before mutation", () => {
  const positive = createConfigurationRollbackFixture();
  try {
    const result = runConfigurationRestore(positive);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(positive.crmRoot, ".env.production"), "utf8"), "old-root\n");
    assert.equal(readFileSync(join(positive.crmRoot, ".env.lead-agent"), "utf8"), "old-lead\n");
    assert.equal(existsSync(join(positive.crmRoot, ".env.manual-send-worker")), false);
  } finally {
    rmSync(positive.fixture, { recursive: true, force: true });
  }

  for (const corrupt of [
    ({ rollbackRoot }) => chmodSync(rollbackRoot, 0o755),
    ({ rollbackRoot }) => chmodSync(join(rollbackRoot, "worker.prestate"), 0o644),
    ({ rollbackRoot }) => {
      rmSync(join(rollbackRoot, "worker.prestate"));
      symlinkSync(join(rollbackRoot, "env.production.before"), join(rollbackRoot, "worker.prestate"));
    },
  ]) {
    const state = createConfigurationRollbackFixture();
    try {
      corrupt(state);
      const result = runConfigurationRestore(state);
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(join(state.crmRoot, ".env.production"), "utf8"), "current-root\n");
      assert.equal(readFileSync(join(state.crmRoot, ".env.lead-agent"), "utf8"), "current-lead\n");
      assert.equal(readFileSync(join(state.crmRoot, ".env.manual-send-worker"), "utf8"), "current-worker\n");
    } finally {
      rmSync(state.fixture, { recursive: true, force: true });
    }
  }

  const ownership = createConfigurationRollbackFixture();
  try {
    const result = runConfigurationRestore(ownership, process.getuid() + 1, process.getgid());
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(ownership.crmRoot, ".env.production"), "utf8"), "current-root\n");
  } finally {
    rmSync(ownership.fixture, { recursive: true, force: true });
  }
});

test("P8V3H uses one command renderer and enables nounset before input", () => {
  const script = configurationInstallScript();
  assert.match(script, /^\nset -u\nIFS= read -r P8V3F_GEMINI_API_KEY\n/);
  const args = configurationSshArgs(script);
  assert.deepEqual(args.slice(0, 6), ["-o", "BatchMode=yes", "hermes-vps", "bash", "-e", "-c"]);
  assert.equal(args.includes("-u"), false);
  assert.equal(args.includes("-s"), false);
  assert.match(args.at(-1), /set -u/);
  assert.deepEqual(commandSshArgs("set -u\ntrue"), ["-o", "BatchMode=yes", "hermes-vps", "bash", "-e", "-c", "'set -u\ntrue'"]);
  assert.throws(() => commandSshArgs("true"), /must start with set -u/);
});

test("P8V3H preflight executes both exact remote shell forms and rejects startup stderr", () => {
  const calls = [];
  const run = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input ?? "" });
    if (args.at(-1)?.includes("P8V3H_SAFE_STDIN")) return { stdout: "p8v3h_command_stdin_verified\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  verifyP8V3HRemoteCommandFormsForTest(run);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args.slice(-2), ["bash", "-seu"]);
  assert.equal(calls[0].input, "true\n");
  assert.deepEqual(calls[1].args.slice(3, 6), ["bash", "-e", "-c"]);
  assert.deepEqual(calls[2].args.slice(3, 6), ["bash", "-e", "-c"]);
  assert.equal(calls[2].input, "P8V3H_SAFE_STDIN\n");
  assert.throws(() => verifyP8V3HRemoteCommandFormsForTest((command, args) => ({
    stdout: args.at(-1)?.includes("P8V3H_SAFE_STDIN") ? "p8v3h_command_stdin_verified\n" : "",
    stderr: args.at(-1)?.includes("P8V3H_SAFE_STDIN") ? "startup warning\n" : "",
  })), /stdin startup drifted/);
});

test("P8V3H streamed remote rejects command-specific stderr after successful status", () => {
  assert.throws(() => runP8V3StreamedRemoteForTest(
    () => ({ stdout: "safe\n", stderr: "command warning\n" }),
    "printf 'safe\\n'",
    { label: "staging", code: "knowledge_failed" },
  ), (error) => error.code === "knowledge_failed" && /staging emitted stderr/.test(error.message));
});

function executeCandidateImageBoundary(inventory, options = {}) {
  const script = String.raw`
docker() {
  if [[ "$1" == 'image' && "$2" == 'ls' ]]; then
    [[ "$P8V3_TEST_IMAGE_LS_STATUS" == '0' ]] || return "$P8V3_TEST_IMAGE_LS_STATUS"
    printf '%s\n' "$P8V3_TEST_IMAGE_INVENTORY"
    return 0
  fi
  if [[ "$1" == 'image' && "$2" == 'inspect' ]]; then
    case "$5" in
      '{{.Id}}') printf '%s\n' "$3" ;;
      '{{.Os}}/{{.Architecture}}/{{.Variant}}') printf 'linux/amd64/\n' ;;
      *org.opencontainers.image.revision*) printf '%s\n' '${P8V3.applicationCommit}' ;;
      *) return 2 ;;
    esac
    return 0
  fi
  return 2
}
${renderP8V3CandidateImageBoundaryForTest(options)}
`;
  return spawnSync("bash", ["-seu"], {
    input: script,
    encoding: "utf8",
    env: {
      ...process.env,
      P8V3_TEST_IMAGE_INVENTORY: inventory,
      P8V3_TEST_IMAGE_LS_STATUS: "0",
    },
  });
}

test("P8V3H treats portable source tags as OCI indexes and permits exact cleaned candidate state", () => {
  const retainedIndexInventory = Object.values(P8V3_IMAGES)
    .map((spec) => `${spec.sourceTag}|${spec.index}`)
    .join("\n");
  assert.equal(executeCandidateImageBoundary(retainedIndexInventory).status, 0);

  const fullyLoadedInventory = Object.values(P8V3_IMAGES)
    .flatMap((spec) => [
      `${spec.sourceTag}|${spec.index}`,
      `<none>:<none>|${spec.platform}`,
      `${spec.composeTag}|${spec.platform}`,
    ])
    .join("\n");
  assert.equal(executeCandidateImageBoundary(fullyLoadedInventory, { requireLoaded: true }).status, 0);

  const first = Object.values(P8V3_IMAGES)[0];
  assert.notEqual(executeCandidateImageBoundary(
    retainedIndexInventory.replace(`${first.sourceTag}|${first.index}`, `${first.sourceTag}|${first.platform}`),
  ).status, 0);
  assert.notEqual(executeCandidateImageBoundary(
    `${retainedIndexInventory}\n${first.composeTag}|${first.index}`,
  ).status, 0);
});

test("P8V3H image boundary fails closed on inventory failure and load binds index to platform", () => {
  const script = renderP8V3CandidateImageBoundaryForTest();
  const failedInventory = spawnSync("bash", ["-seu"], {
    input: `docker() { return 17; }\n${script}`,
    encoding: "utf8",
  });
  assert.notEqual(failedInventory.status, 0);

  const load = renderP8V3ShellContractsForTest().loadImages;
  for (const spec of Object.values(P8V3_IMAGES)) {
    assert.ok(load.includes(`[[ "$candidate_source_id" == '${spec.index}' ]]`));
    assert.ok(load.includes(`[[ "$candidate_platform_present" == '1' ]]`));
    assert.ok(load.includes(`docker image tag '${spec.platform}' '${spec.composeTag}'`));
  }
  assert.equal(renderP8V3ShellContractsForTest().preflight.includes("docker load"), false);
  assert.equal(renderP8V3ShellContractsForTest().preflight.includes("docker image tag"), false);
});

function initContains(value, needle) {
  return typeof value === "string" && value.includes(needle);
}

test("wrong authorization stops before identity or production access", async () => {
  const adapter = operations();
  await assert.rejects(runP8V3Rollout({ operations: adapter, authorization: "wrong", preflight: adapter.preflight, preflightSha256: SHA_A, now: Date.now }), /exact P8V3 authorization/);
  assert.deepEqual(adapter.calls, []);
});

test("expired preflight stops before identity or production access", async () => {
  const adapter = operations();
  await assert.rejects(runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:25:00.000Z") }), /expired or drifted/);
  assert.deepEqual(adapter.calls, []);
});

test("production adapter keeps staging, rollback and evidence cleanup narrowly ordered", () => {
  const source = readFileSync(join(process.cwd(), "scripts/p8v3-production-operations.mjs"), "utf8");
  const verifyStart = source.indexOf("async verifyPreflight(snapshot)");
  const configureStart = source.indexOf("async configure({ deadlineAt })");
  const verifyBody = source.slice(verifyStart, configureStart);
  const importStart = source.indexOf("async importKnowledge(audience");
  const cleanupStart = source.indexOf("async cleanupKnowledge()");
  const importBody = source.slice(importStart, cleanupStart);
  assert.ok(verifyStart >= 0 && configureStart > verifyStart);
  assert.match(verifyBody, /validateP8V3DMigrationReadiness\(readiness\)/);
  assert.match(verifyBody, /for \(const spec of Object\.values\(P8V3_IMAGES\)\) validateArchive/);
  assert.match(verifyBody, /validateCandidateCompose\(run, source\)/);
  assert.match(verifyBody, /resolveAccount\(\)/);
  assert.match(verifyBody, /buildAudience\(run, source, accountId, audience, vault, state\.localRoots\)/);
  assert.match(importBody, /state\.built\.get\(audience\)/);
  assert.doesNotMatch(importBody, /buildAudience\(/);
  assert.ok(source.indexOf("remote(run, stagePrepareScript()") < source.indexOf("repository transfer"));
  assert.ok(source.indexOf("label: \"configuration rollback\"") < source.indexOf("for (const name of boundaries)"));
  assert.equal(source.includes(".p8v3-result-*"), false);
  assert.doesNotMatch(source, /"migration apply"|"Supabase link"|"migration dry-run"/);
  assert.match(source, /database\/query\/read-only/);
  assert.match(source, /EVO_CRM_WAHA_ENV_FILE/);
  assert.match(source, /EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE: envPaths\.worker/);
  assert.match(source, /EVO_INBOX_WAHA_ENV_FILE/);
  assert.match(source, /\["crm", "lead", "crmWaha", "worker", "inbox", "inboxWaha"\]\.map/);
  assert.match(source, /input: `\$\{accountId\}\\n`/);
  assert.match(source, /for \(const args of commands\) \{\n\s+verifyOrbStack\(run\);\n\s+runChecked\(run, "candidate Compose validation", "docker"/);
  assert.match(source, /verifyPortableArchive\(path, \{ name: spec\.name, index: spec\.index, manifest: spec\.platform \}/);
  assert.match(source, /commandSshArgs\(knowledgeImportCommand\(item, owner\)\)/);
  assert.doesNotMatch(source, /"-seu", "-c", shellQuote\(knowledgeImportCommand\(item\)\)/);
  assert.match(source, /run\("ssh", configurationSshArgs\(\),/);
  assert.match(source, /input: `\$\{geminiKey\}\\n`/);
  assert.match(source, /snapshot\.gemini\?\.server_compose_verified !== true/);
  assert.match(source, /providerProbeCommand\(providerOwner, importer\)/);
  assert.match(source, /state\.serverComposeVerified = parseP8V3ProviderProbeOutput/);
  assert.match(source, /--verify-provider/);
  assert.doesNotMatch(source, /--verify-runtime/);
  assert.match(source, /docker compose --ansi never --progress quiet/);
  assert.match(source, /-f '\$\{PRODUCTION_CRM_COMPOSE\}'/);
  assert.match(source, /run --rm --no-deps --pull never -T --name '\$\{IMPORTER\}'/);
  assert.match(importBody, /knowledgeJobCleanupScript\(\{ owner \}\)/);
  assert.doesNotMatch(importBody, /knowledgeCleanupScript\(\{ owner \}\)/);
  assert.match(source, /importerSha256: state\.expectedImporter\?\.sha256 \?\? null/);
  assert.match(source, /expectedFiles,/);
  assert.match(source, /state\.serverComposeVerified = true/);
  assert.match(source, /account=sys\.stdin\.readline\(\)\.strip\(\)/);
  assert.doesNotMatch(source, /vault, accountId, audience/);
  assert.match(source, /os\.umask\(0o077\)/);
  assert.ok(source.indexOf("renameSync(temporary, localResultPath)") < source.indexOf('runChecked(run, "result transfer"'));
  assert.match(source, /if \(state\.localEvidenceWritten\) rmSync\(localResultPath/);
});

test("candidate Compose validation binds a disposable mode-0600 env for every service", () => {
  const composeCalls = [];
  const observedPaths = new Set();
  const run = (command, args, options = {}) => {
    if (command === "orb") return { stdout: "Running\n", stderr: "" };
    if (command === "docker" && args[0] === "context") return { stdout: "orbstack\n", stderr: "" };
    if (command === "docker" && args[0] === "compose") {
      const names = [
        "EVO_CRM_APP_ENV_FILE",
        "EVO_CRM_LEAD_AGENT_ENV_FILE",
        "EVO_CRM_WAHA_ENV_FILE",
        "EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE",
        "EVO_INBOX_APP_ENV_FILE",
        "EVO_INBOX_WAHA_ENV_FILE",
      ];
      for (const name of names) {
        const path = options.env[name];
        observedPaths.add(path);
        const metadata = lstatSync(path);
        assert.equal(metadata.isFile(), true, name);
        assert.equal(metadata.isSymbolicLink(), false, name);
        assert.equal(metadata.mode & 0o777, 0o600, name);
        const expected = name === "EVO_INBOX_APP_ENV_FILE"
          ? [
              "P8V3_COMPOSE_VALIDATION=1",
              "NEXT_PUBLIC_SUPABASE_URL=https://p8v3f.invalid",
              "NEXT_PUBLIC_SUPABASE_ANON_KEY=p8v3f-compose-validation-not-a-key",
              "NEXT_PUBLIC_SITE_URL=https://p8v3f.invalid",
              "",
            ].join("\n")
          : "P8V3_COMPOSE_VALIDATION=1\n";
        assert.equal(readFileSync(path, "utf8"), expected, name);
      }
      composeCalls.push(args);
    }
    return { stdout: "", stderr: "" };
  };

  validateCandidateComposeForTest(run, process.cwd());
  assert.equal(composeCalls.length, 2);
  assert.equal(observedPaths.size, 6);
  for (const path of observedPaths) assert.equal(existsSync(path), false, path);
  assert.equal(existsSync(dirname([...observedPaths][0])), false);
});

test("candidate Compose validation removes every disposable env after failure", () => {
  const observedPaths = new Set();
  const run = (command, args, options = {}) => {
    if (command === "orb") return { stdout: "Running\n", stderr: "" };
    if (command === "docker" && args[0] === "context") return { stdout: "orbstack\n", stderr: "" };
    if (command === "docker" && args[0] === "compose") {
      for (const name of [
        "EVO_CRM_APP_ENV_FILE",
        "EVO_CRM_LEAD_AGENT_ENV_FILE",
        "EVO_CRM_WAHA_ENV_FILE",
        "EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE",
        "EVO_INBOX_APP_ENV_FILE",
        "EVO_INBOX_WAHA_ENV_FILE",
      ]) observedPaths.add(options.env[name]);
      throw new Error("forced Compose failure");
    }
    return { stdout: "", stderr: "" };
  };

  assert.throws(() => validateCandidateComposeForTest(run, process.cwd()), /forced Compose failure/);
  assert.equal(observedPaths.size, 6);
  for (const path of observedPaths) assert.equal(existsSync(path), false, path);
  assert.equal(existsSync(dirname([...observedPaths][0])), false);
});

test("production inventory emits and accepts exact Compose container names", () => {
  const preflight = renderP8V3ShellContractsForTest().preflight;
  assert.match(preflight, /printf '%s\|' "\$name"/);
  assert.doesNotMatch(preflight, /docker inspect [^\n]+\{\{\.Name\}\}/);

  const rows = [
    `evo-crm-app-1|${SHA_A}|sha256:d4626208423df2c0df24262763917b82b1157b53a115b44f02478ecf7245f580|healthy|0|evo_crm_private,evo_public_web,`,
    `evo-crm-waha-1|${SHA_B}|sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c|healthy|0|evo_crm_private,`,
    `evo-crm-lead-agent-1|${SHA_C}|sha256:3678747c1ea1c9b5655bb830296c9e4d4aedf60d3d193b438633b68eb3f97cc7|healthy|0|evo_crm_private,`,
    `evo-inbox-app-1|${"d".repeat(64)}|sha256:6d5e0a9d5ea073737bdd8c2c5621818ca7bdb76dd5b16ca5e44563d39833cb6b|healthy|0|evo_inbox_private,evo_public_web,`,
    `evo-inbox-waha|${"e".repeat(64)}|sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c|healthy|0|evo_inbox_private,`,
  ].join("\n");

  assert.deepEqual(parseP8V3ContainerRowsForTest(rows).map((item) => item.name), [
    "evo-crm-app-1",
    "evo-crm-waha-1",
    "evo-crm-lead-agent-1",
    "evo-inbox-app-1",
    "evo-inbox-waha",
  ]);
  assert.throws(
    () => parseP8V3ContainerRowsForTest(rows.replace("evo-crm-app-1", "/evo-crm-app-1")),
    /production pre-state drifted: evo-crm-app-1/,
  );
});

test("P8V3E accepts only one closed all-true migration 077 readiness row", () => {
  const row = {
    table_exists: true,
    claim_exists: true,
    sync_exists: true,
    finish_exists: true,
    service_functions_execute: true,
    anon_functions_denied: true,
    authenticated_functions_denied: true,
    service_table_denied: true,
    anon_table_denied: true,
    authenticated_table_denied: true,
  };
  assert.equal(validateP8V3DMigrationReadiness([row]), true);
  assert.throws(() => validateP8V3DMigrationReadiness([{ ...row, claim_exists: false }]), /objects or grants drifted/);
  assert.throws(() => validateP8V3DMigrationReadiness([{ ...row, extra: true }]), /not closed/);
  assert.throws(() => validateP8V3DMigrationReadiness([row, row]), /row count drifted/);
});

test("P8V3F accepts only one active Gemini retrieval provider", () => {
  const row = {
    active_config_count: 1,
    active_account_count: 1,
    provider_is_gemini: true,
  };
  assert.deepEqual(validateP8V3RetrievalProvider([row]), { retrieval_provider_verified: true });
  assert.throws(() => validateP8V3RetrievalProvider([{ ...row, provider_is_gemini: false }]), /retrieval provider drifted/);
  assert.throws(() => validateP8V3RetrievalProvider([{ ...row, active_config_count: 2 }]), /retrieval provider drifted/);
  assert.throws(() => validateP8V3RetrievalProvider([{ ...row, extra: true }]), /retrieval provider.*not closed/);
});

test("P8V3E knowledge reads execute with the exact public PostgREST profile", async () => {
  const calls = [];
  const read = createP8V3PublicRestReader({
    key: testCredential(),
    projectUrl: "https://example.supabase.co",
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return new Response(JSON.stringify([{ account_id: "550e8400-e29b-41d4-a716-446655440000" }]), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "55" },
      });
    },
  });
  await read("/rest/v1/ai_configs?select=account_id");
  await read("/rest/v1/ai_knowledge_bundle_revisions?select=audience");
  assert.deepEqual(calls.map(({ url }) => url), [
    "https://example.supabase.co/rest/v1/ai_configs?select=account_id",
    "https://example.supabase.co/rest/v1/ai_knowledge_bundle_revisions?select=audience",
  ]);
  for (const { options } of calls) {
    assert.equal(options.headers["Accept-Profile"], "public");
    assert.equal(Object.values(options.headers).includes("platform"), false);
    assert.equal(options.redirect, "error");
  }
});

test("P8V3F preflight does not require the execute-only Supabase service-role key", async () => {
  const fixture = mkdtempSync(join(realpathSync(tmpdir()), "p8v3f-preflight-reader-"));
  const candidateRoot = join(fixture, "candidates");
  const supabaseCliPath = join(fixture, "supabase");
  mkdirSync(candidateRoot, { mode: 0o700 });
  writeFileSync(supabaseCliPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  try {
    await assert.doesNotReject(() => createP8V3ProductionOperations({
      mode: "preflight",
      sourceRoot: process.cwd(),
      candidateRoot,
      supabaseCliPath,
      localResultPath: join(fixture, "preflight-result.json"),
      environment: {
        SUPABASE_ACCESS_TOKEN: `${["s", "b", "p"].join("")}_${"x".repeat(24)}`,
        GEMINI_API_KEY: testCredential(),
      },
    }));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("P8V3E cleanup verifies an absent pre-stage directory and importer as clean", () => {
  const fixture = mkdtempSync(join(tmpdir(), "p8v3e-cleanup-"));
  const releaseRoot = join(fixture, "release");
  const knowledgeRemote = join(releaseRoot, "knowledge-incoming");
  const fakeBin = join(fixture, "bin");
  const docker = join(fakeBin, "docker");
  try {
    assert.equal(existsSync(releaseRoot), false);
    mkdirSync(fakeBin);
    writeFileSync(docker, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(docker, 0o700);
    const result = spawnSync("bash", ["-seu"], {
      input: renderP8V3KnowledgeCleanupForTest({ releaseRoot, knowledgeRemote }),
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(releaseRoot), false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("P8V3E cleanup blocks an unexpected staging remnant without deleting it", () => {
  const fixture = mkdtempSync(join(tmpdir(), "p8v3e-cleanup-remnant-"));
  const releaseRoot = join(fixture, "release");
  const knowledgeRemote = join(releaseRoot, "knowledge-incoming");
  const fakeBin = join(fixture, "bin");
  const docker = join(fakeBin, "docker");
  const unexpected = join(knowledgeRemote, "unexpected.txt");
  try {
    mkdirSync(knowledgeRemote, { recursive: true });
    mkdirSync(fakeBin);
    writeFileSync(unexpected, "must remain for reconciliation\n");
    writeFileSync(docker, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(docker, 0o700);
    const result = spawnSync("bash", ["-seu"], {
      input: renderP8V3KnowledgeCleanupForTest({ releaseRoot, knowledgeRemote }),
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(unexpected, "utf8"), "must remain for reconciliation\n");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("P8V3K cleanup removes only the exact named compose-run container on the reviewed image", () => {
  const fixture = mkdtempSync(join(tmpdir(), "p8v3k-cleanup-leftover-"));
  const releaseRoot = join(fixture, "release");
  const knowledgeRemote = join(releaseRoot, "knowledge-incoming");
  const fakeBin = join(fixture, "bin");
  const docker = join(fakeBin, "docker");
  const removalMarker = join(fixture, "removed");
  const containerId = "1".repeat(64);
  try {
    mkdirSync(fakeBin);
    writeFileSync(
      docker,
      `#!/bin/sh
if [ "$1" = "container" ] && [ "$2" = "ls" ]; then
  if [ ! -f "$REMOVAL_MARKER" ]; then
    printf '%s\\n' '${containerId}|evo-p8v3k-knowledge-import'
  fi
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$3" = "--format" ] && [ "$4" = "{{.Image}}|{{index .Config.Labels \\"evo.p8v3k.importer-owner\\"}}|{{.Name}}" ]; then
  printf '%s\\n' '${P8V3_IMAGES.crm.platform}|${"a".repeat(48)}|/evo-p8v3k-knowledge-import'
  exit 0
fi
if [ "$1" = "rm" ] && [ "$2" = "-f" ] && [ "$3" = "${containerId}" ]; then
  : > "$REMOVAL_MARKER"
  exit 0
fi
exit 1
`,
      { mode: 0o700 },
    );
    chmodSync(docker, 0o700);

    const result = spawnSync("bash", ["-seu"], {
      input: renderP8V3KnowledgeCleanupForTest({ releaseRoot, knowledgeRemote }),
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, REMOVAL_MARKER: removalMarker },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(removalMarker), true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("P8V3K cleanup still removes the exact owned container when the name inventory row has already disappeared", () => {
  const fixture = mkdtempSync(join(tmpdir(), "p8v3k-cleanup-owned-only-"));
  const releaseRoot = join(fixture, "release");
  const knowledgeRemote = join(releaseRoot, "knowledge-incoming");
  const fakeBin = join(fixture, "bin");
  const docker = join(fakeBin, "docker");
  const removalMarker = join(fixture, "removed");
  const containerId = "3".repeat(64);
  try {
    mkdirSync(fakeBin);
    writeFileSync(
      docker,
      `#!/bin/sh
if [ "$1" = "container" ] && [ "$2" = "ls" ]; then
  if printf '%s\\n' "$*" | grep -F -- 'label=evo.p8v3k.importer-owner' >/dev/null; then
    if [ ! -f "$REMOVAL_MARKER" ]; then
      printf '%s\\n' '${containerId}|evo-p8v3k-knowledge-import'
    fi
  fi
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$3" = "--format" ] && [ "$4" = "{{.Image}}|{{index .Config.Labels \\"evo.p8v3k.importer-owner\\"}}|{{.Name}}" ]; then
  printf '%s\\n' '${P8V3_IMAGES.crm.platform}|${"a".repeat(48)}|/evo-p8v3k-knowledge-import'
  exit 0
fi
if [ "$1" = "rm" ] && [ "$2" = "-f" ] && [ "$3" = "${containerId}" ]; then
  : > "$REMOVAL_MARKER"
  exit 0
fi
exit 1
`,
      { mode: 0o700 },
    );
    chmodSync(docker, 0o700);

    const result = spawnSync("bash", ["-seu"], {
      input: renderP8V3KnowledgeCleanupForTest({ releaseRoot, knowledgeRemote }),
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, REMOVAL_MARKER: removalMarker },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(removalMarker), true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("P8V3K cleanup blocks a leftover compose-run container on the wrong image", () => {
  const fixture = mkdtempSync(join(tmpdir(), "p8v3k-cleanup-wrong-image-"));
  const releaseRoot = join(fixture, "release");
  const knowledgeRemote = join(releaseRoot, "knowledge-incoming");
  const fakeBin = join(fixture, "bin");
  const docker = join(fakeBin, "docker");
  const removalMarker = join(fixture, "removed");
  const containerId = "2".repeat(64);
  try {
    mkdirSync(fakeBin);
    writeFileSync(
      docker,
      `#!/bin/sh
if [ "$1" = "container" ] && [ "$2" = "ls" ]; then
  if [ ! -f "$REMOVAL_MARKER" ]; then
    printf '%s\\n' '${containerId}|evo-p8v3k-knowledge-import'
  fi
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$3" = "--format" ] && [ "$4" = "{{.Image}}|{{index .Config.Labels \\"evo.p8v3k.importer-owner\\"}}|{{.Name}}" ]; then
  printf '%s\\n' 'sha256:${"f".repeat(64)}|${"a".repeat(48)}|/evo-p8v3k-knowledge-import'
  exit 0
fi
if [ "$1" = "rm" ] && [ "$2" = "-f" ] && [ "$3" = "${containerId}" ]; then
  : > "$REMOVAL_MARKER"
  exit 0
fi
exit 1
`,
      { mode: 0o700 },
    );
    chmodSync(docker, 0o700);

    const result = spawnSync("bash", ["-seu"], {
      input: renderP8V3KnowledgeCleanupForTest({ releaseRoot, knowledgeRemote }),
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, REMOVAL_MARKER: removalMarker },
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(removalMarker), false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("P8V3K cleanup fails closed when Docker inventory cannot prove absence", () => {
  const fixture = mkdtempSync(join(tmpdir(), "p8v3k-cleanup-inventory-failure-"));
  const releaseRoot = join(fixture, "release");
  const knowledgeRemote = join(releaseRoot, "knowledge-incoming");
  const fakeBin = join(fixture, "bin");
  const docker = join(fakeBin, "docker");
  try {
    mkdirSync(fakeBin);
    writeFileSync(docker, "#!/bin/sh\nexit 17\n", { mode: 0o700 });
    chmodSync(docker, 0o700);
    const result = spawnSync("bash", ["-seu"], {
      input: renderP8V3KnowledgeCleanupForTest({ releaseRoot, knowledgeRemote }),
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("P8V3K preflight cleanup rejects a symlinked evidence root without deleting its target", () => {
  const fixture = mkdtempSync(join(tmpdir(), "p8v3k-preflight-cleanup-symlink-"));
  const target = join(fixture, "foreign-target");
  const preflightRoot = join(fixture, "preflight-root");
  const sentinel = join(target, "p8v3k-platform-knowledge-import.mjs");
  const fakeBin = join(fixture, "bin");
  const docker = join(fakeBin, "docker");
  try {
    mkdirSync(target, { mode: 0o700 });
    mkdirSync(fakeBin, { mode: 0o700 });
    writeFileSync(sentinel, "must remain\n", { mode: 0o600 });
    symlinkSync(target, preflightRoot);
    writeFileSync(docker, "#!/bin/sh\nif [ \"$1\" = container ] && [ \"$2\" = ls ]; then exit 0; fi\nexit 2\n", { mode: 0o700 });
    chmodSync(docker, 0o700);
    const result = spawnSync("bash", ["-seu"], {
      input: renderP8V3PreflightCleanupForTest({ preflightRoot }),
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(sentinel, "utf8"), "must remain\n");
    assert.equal(lstatSync(preflightRoot).isSymbolicLink(), true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("every reviewed remote shell contract parses under bash", () => {
  for (const [name, script] of Object.entries(renderP8V3ShellContractsForTest())) {
    const parsed = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    assert.equal(parsed.status, 0, `${name}: ${parsed.stderr}`);
  }
});

test("P8V3K per-job cleanup removes only the one-off container and preserves shared staged files", () => {
  const { preflightCleanup, knowledgeJobCleanup, knowledgeCleanup } = renderP8V3ShellContractsForTest();
  assert.match(preflightCleanup, /root\.is_symlink\(\)/);
  assert.match(preflightCleanup, /\{entry\.name for entry in entries\} - \{'p8v3k-platform-knowledge-import\.mjs'\}/);
  assert.match(preflightCleanup, /hashlib\.sha256/);
  assert.doesNotMatch(preflightCleanup, /rm -f '\/opt\/evo-release-preflight/);
  assert.match(knowledgeJobCleanup, /docker container ls -a --no-trunc/);
  assert.match(knowledgeJobCleanup, /docker rm -f "\$owned_id"/);
  assert.doesNotMatch(knowledgeJobCleanup, /python3|knowledge-incoming|p8v3k-platform-knowledge-import\.mjs|unlink\(/);
  assert.match(knowledgeCleanup, /p8v3k-platform-knowledge-import\.mjs/);
  assert.match(knowledgeCleanup, /knowledge-incoming/);
  assert.match(knowledgeCleanup, /hashlib\.sha256/);
});

test("P8V3K CRM rollback removes the manual-send worker by exact container ID", () => {
  const { rollbackCrm } = renderP8V3ShellContractsForTest();
  assert.match(rollbackCrm, /docker container ls -a --no-trunc --format '\{\{\.ID\}\}\|\{\{\.Names\}\}'/);
  assert.match(rollbackCrm, /worker_row="\$\(printf '%s\\n' "\$worker_inventory" \| awk -F '\|' '\$2 == "evo-crm-manual-send-worker" \{ print \$0 \}'\)"/);
  assert.match(rollbackCrm, /docker inspect "\$worker_id" --format '\{\{\.Image\}\}\|\{\{\.Name\}\}'/);
  assert.match(rollbackCrm, /docker rm -f "\$worker_id" >/);
  assert.doesNotMatch(rollbackCrm, /grep -Fx evo-crm-manual-send-worker|docker rm -f evo-crm-manual-send-worker/);
});

test("P8V3K knowledge job uses compose run on the CRM service with individually mounted read-only files", () => {
  const { preflight, providerProbe, knowledgeImport } = renderP8V3ShellContractsForTest();

  assert.match(
    preflight,
    /docker network inspect 'evo_crm_private' --format '\{\{\.Name\}\}\|\{\{\.Driver\}\}\|\{\{\.Scope\}\}\|\{\{\.Internal\}\}'/,
  );
  assert.match(providerProbe, /docker compose[^\n]+run --rm --no-deps --pull never -T --name 'evo-p8v3k-knowledge-import'/);
  assert.match(providerProbe, /-f '\/opt\/evo-crm\/docker-compose\.prod\.yml'/);
  assert.match(providerProbe, /-e 'EVO_PLATFORM_GEMINI_API_KEY'/);
  assert.match(providerProbe, /-v '\/opt\/evo-release-preflight\/p8v3k-20260821\.1\/p8v3k-platform-knowledge-import\.mjs:\/run\/evo-p8v3k\/p8v3k-platform-knowledge-import\.mjs:ro'/);
  assert.match(providerProbe, /p8v3k-platform-knowledge-import\.mjs.*--verify-provider/s);
  assert.match(knowledgeImport, /-e 'EVO_EXPECTED_KNOWLEDGE_ACCOUNT_ID'/);
  assert.match(knowledgeImport, /-v '\/opt\/evo-releases\/[^']+\/p8v3k-platform-knowledge-import\.mjs:\/run\/evo-p8v3k\/p8v3k-platform-knowledge-import\.mjs:ro'/);
  assert.match(knowledgeImport, /-v '\/opt\/evo-releases\/[^']+\/knowledge-incoming\/evo-knowledge-client\.json:\/run\/evo-p8v3k\/knowledge-bundle\.json:ro'/);
  assert.match(knowledgeImport, /-v '\/opt\/evo-releases\/[^']+\/knowledge-incoming\/evo-knowledge-client\.sha256\.json:\/run\/evo-p8v3k\/knowledge-manifest\.json:ro'/);
  assert.match(knowledgeImport, /p8v3k-platform-knowledge-import\.mjs.*--audience '"'"'client'"'"'/s);
  assert.match(knowledgeImport, /\[\[ "\$EVO_EXPECTED_KNOWLEDGE_ACCOUNT_ID" == "\$EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID" \]\]/);
  assert.match(knowledgeImport, /knowledge-bundle\.json/);
  assert.match(knowledgeImport, /knowledge-manifest\.json/);
  assert.doesNotMatch(knowledgeImport, /docker create|docker cp|--verify-runtime/);
});

test("P8V3K provider probe blocks before compose run when the exact container name is already occupied", () => {
  const fixture = mkdtempSync(join(tmpdir(), "p8v3k-runtime-probe-"));
  const fakeBin = join(fixture, "bin");
  const dockerLog = join(fixture, "docker.log");
  const docker = join(fakeBin, "docker");
  mkdirSync(fakeBin, { mode: 0o700 });
  writeFileSync(docker, `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  container)
    if printf '%s\\n' "$*" | grep -F -- 'label=evo.p8v3k.importer-owner' >/dev/null; then
      exit 0
    fi
    printf '%s\\n' '${"1".repeat(64)}|evo-p8v3k-knowledge-import'
    exit 0
    ;;
  compose) exit 99 ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
  chmodSync(docker, 0o700);

  try {
    rmSync(dockerLog, { force: true });
    const result = spawnSync("bash", ["-seu"], {
      input: renderP8V3ShellContractsForTest().providerProbe,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        DOCKER_LOG: dockerLog,
      },
    });
    assert.notEqual(result.status, 0);
    const calls = existsSync(dockerLog)
      ? readFileSync(dockerLog, "utf8").trim().split("\n")
      : [];
    assert.equal(calls.some((call) => call.startsWith("compose ")), false, calls.join("\n"));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("P8V3K provider probe blocks before compose run when an owner-label collision exists", () => {
  const fixture = mkdtempSync(join(tmpdir(), "p8v3k-provider-label-collision-"));
  const fakeBin = join(fixture, "bin");
  const dockerLog = join(fixture, "docker.log");
  const docker = join(fakeBin, "docker");
  mkdirSync(fakeBin, { mode: 0o700 });
  writeFileSync(docker, `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [ "$1" = "container" ] && [ "$2" = "ls" ] && printf '%s\\n' "$*" | grep -F -- 'label=evo.p8v3k.importer-owner' >/dev/null; then
  printf '%s\\n' '${"2".repeat(64)}|foreign-owned-container'
  exit 0
fi
if [ "$1" = "container" ] && [ "$2" = "ls" ]; then exit 0; fi
if [ "$1" = "compose" ]; then exit 99; fi
exit 2
`, { mode: 0o700 });
  chmodSync(docker, 0o700);

  try {
    const result = spawnSync("bash", ["-seu"], {
      input: renderP8V3ShellContractsForTest().providerProbe,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        DOCKER_LOG: dockerLog,
      },
    });
    assert.notEqual(result.status, 0);
    const calls = existsSync(dockerLog)
      ? readFileSync(dockerLog, "utf8").trim().split("\n")
      : [];
    assert.equal(calls.some((call) => call.startsWith("compose ")), false, calls.join("\n"));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
