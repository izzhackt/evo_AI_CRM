import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  P8V2,
  createEmptyP8V2Result,
  runP8V2Preparation,
  validateP8V2PreparationResult,
  verifyP8V2FinalRoot,
} from "../scripts/p8v2-production-preparation.mjs";

const schemaUrl = new URL(
  "../docs/schemas/p8v-v1-preparation-result.schema.json",
  import.meta.url,
);
const SHA = "a".repeat(64);
const IMAGE_ID = `sha256:${"b".repeat(64)}`;

test("real preparation CLI fails closed without authorization and does not deadlock", () => {
  const environment = { ...process.env };
  delete environment.EVO_P8V2C_AUTHORIZATION;
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/p8v2-production-preparation-cli.mjs", import.meta.url)), "--application-root", tmpdir()],
    { encoding: "utf8", env: environment },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "p8v2c_failed:operation_failed\n");
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /unsettled top-level await/i);
});

function verifiedImage(name, prefix) {
  return {
    name,
    tag: `${prefix}:${P8V2.applicationCommit}-p8v2c-linux-amd64`,
    archive: `${prefix}-${P8V2.applicationCommit}-p8v2c-linux-amd64.tar`,
    image_id: IMAGE_ID,
    oci_index_digest: IMAGE_ID,
    platform_manifest_digest: `sha256:${"c".repeat(64)}`,
    archive_sha256: SHA,
    sbom_sha256: SHA,
    smoke_sha256: SHA,
    source_commit: P8V2.applicationCommit,
    platform: { os: "linux", architecture: "amd64", variant: "" },
  };
}

function verifiedContainer(name, containerId, imageId) {
  return {
    name,
    container_id: containerId,
    image_id: imageId,
    health: "healthy",
    restart_count: 0,
  };
}

function verifiedResult() {
  const value = createEmptyP8V2Result({
    generatedAt: "2026-08-18T04:00:00.000Z",
    execution: {
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      ci_run_id: 123456,
    },
  });
  value.result_code = "preparation_verified";
  value.blocker = null;
  value.steps.forEach((step) => { step.status = "verified"; });
  value.images = [
    verifiedImage("main_crm", "evo-crm"),
    verifiedImage("evo_inbox", "evo-inbox"),
    verifiedImage("lead_agent", "evo-lead-agent"),
  ];
  value.production_containers = P8V2.productionContainers.map((item) =>
    verifiedContainer(item.name, item.containerId, item.imageId));
  value.migration = {
    status: "verified",
    repository_range: "001-077",
    repository_count: 77,
    production_range: "001-076",
    production_count: 76,
    pending_versions: ["077"],
    project_status: "ACTIVE_HEALTHY",
  };
  value.rollback = {
    status: "verified",
    manual_worker_pre_state: "absent",
    files: P8V2.rollbackFiles.map((item) => ({
      name: item.name,
      source_mode: item.sourceMode,
      retained_mode: 600,
      size: 123,
      sha256: SHA,
    })),
    images: P8V2.images.map((item) => ({
      name: item.name,
      reference: item.rollbackReference,
      image_id: item.rollbackImageId,
      archive: item.rollbackArchive,
      size: 123,
      sha256: SHA,
    })),
    renders: P8V2.images.map((item) => ({ name: item.name, status: "verified" })),
  };
  value.identity_resolution = {
    status: "verified",
    account: "exactly_one_active",
    organization: "exactly_one_active",
    supabase_project: "exact_production",
  };
  value.knowledge = {
    status: "verified",
    cleanup_status: "verified",
    audiences: [
      { name: "client", status: "verified", document_count: 11, bundle_sha256: SHA, manifest_sha256: SHA, vault_unchanged: true, pii_gate: "passed", forbidden_root_gate: "passed" },
      { name: "internal", status: "verified", document_count: 291, bundle_sha256: SHA, manifest_sha256: SHA, vault_unchanged: true, pii_gate: "passed", forbidden_root_gate: "passed" },
    ],
  };
  value.configuration = {
    status: "verified",
    root_crm: "verified",
    lead_agent: "verified",
    manual_worker: "verified",
    configured_account_match: true,
    configured_organization_match: true,
    supabase_project_match: true,
    blockers: [],
  };
  value.collection = { index_sha256: SHA };
  return value;
}

async function validators() {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  const schemaValidator = new Ajv2020({ strict: false }).compile(schema);
  return {
    schemaValidator,
    accepts(value) {
      const schemaAccepted = schemaValidator(value);
      let runtimeAccepted = true;
      try { validateP8V2PreparationResult(value); } catch { runtimeAccepted = false; }
      return { schemaAccepted, runtimeAccepted };
    },
  };
}

test("closed Draft 2020-12 schema and runtime accept the exact verified result", async () => {
  const { accepts, schemaValidator } = await validators();
  const value = verifiedResult();
  assert.deepEqual(accepts(value), { schemaAccepted: true, runtimeAccepted: true }, JSON.stringify(schemaValidator.errors));

  for (const invalid of [
    { ...value, extra: true },
    { ...value, images: [] },
    { ...value, production_containers: value.production_containers.toReversed() },
    { ...value, migration: { ...value.migration, pending_versions: [] } },
    { ...value, knowledge: { ...value.knowledge, audiences: value.knowledge.audiences.toReversed() } },
    { ...value, collection: { index_sha256: null } },
  ]) {
    assert.deepEqual(accepts(invalid), { schemaAccepted: false, runtimeAccepted: false });
  }
});

test("configuration blocker is a truthful final prefix and contains no false success", async () => {
  const { accepts } = await validators();
  const blocked = verifiedResult();
  blocked.result_code = "preparation_blocked";
  blocked.blocker = { step: "configuration", code: "required_configuration_missing" };
  blocked.steps.at(-2).status = "blocked";
  blocked.steps.at(-1).status = "not_run";
  blocked.configuration = {
    status: "blocked",
    root_crm: "blocked",
    lead_agent: "blocked",
    manual_worker: "blocked",
    configured_account_match: false,
    configured_organization_match: false,
    supabase_project_match: false,
    blockers: ["root_crm_settings_missing", "lead_agent_amocrm_credentials_missing", "manual_worker_secret_missing"],
  };
  blocked.collection = { index_sha256: null };
  assert.deepEqual(accepts(blocked), { schemaAccepted: true, runtimeAccepted: true });

  const falseSuccess = structuredClone(blocked);
  falseSuccess.result_code = "preparation_verified";
  falseSuccess.blocker = null;
  assert.deepEqual(accepts(falseSuccess), { schemaAccepted: false, runtimeAccepted: false });

  const impossibleProgress = structuredClone(blocked);
  impossibleProgress.blocker = { step: "identity_resolution", code: "identity_resolution_failed" };
  impossibleProgress.steps[4].status = "blocked";
  impossibleProgress.steps[5].status = "verified";
  assert.deepEqual(accepts(impossibleProgress), { schemaAccepted: false, runtimeAccepted: false });
});

test("orchestrator continues the frozen independent prefix and records the configuration blocker", async () => {
  const calls = [];
  const canonical = verifiedResult();
  const operations = {
    async verifyExecution() {
      calls.push("execution");
      return {
        commit: canonical.source.execution_commit,
        tree: canonical.source.execution_tree,
        ci_run_id: canonical.source.execution_ci_run_id,
      };
    },
    async buildImages() { calls.push("images"); return canonical.images; },
    async observeProduction() { calls.push("production"); return canonical.production_containers; },
    async verifyMigrations() { calls.push("migration"); return canonical.migration; },
    async captureRollback() { calls.push("rollback"); return canonical.rollback; },
    async resolveIdentities() { calls.push("identity"); return canonical.identity_resolution; },
    async buildKnowledge() { calls.push("knowledge"); return canonical.knowledge; },
    async verifyConfiguration() {
      calls.push("configuration");
      const error = new Error("configuration missing");
      error.code = "required_configuration_missing";
      error.safeDetails = {
        status: "blocked",
        root_crm: "blocked",
        lead_agent: "blocked",
        manual_worker: "blocked",
        configured_account_match: false,
        configured_organization_match: false,
        supabase_project_match: false,
        blockers: ["root_crm_settings_missing"],
      };
      throw error;
    },
    async writeResult(value) { calls.push("write"); return value; },
  };
  const result = await runP8V2Preparation({
    operations,
    generatedAt: canonical.generated_at,
  });
  assert.equal(result.result_code, "preparation_blocked");
  assert.deepEqual(result.blocker, { step: "configuration", code: "required_configuration_missing" });
  assert.deepEqual(calls, ["execution", "images", "production", "migration", "rollback", "identity", "knowledge", "configuration", "write"]);
  validateP8V2PreparationResult(result);
});

test("evidence publication failure is distinct and cannot masquerade as a normal blocker", async () => {
  const complete = verifiedResult();
  const evidenceError = Object.assign(new Error("synthetic evidence failure"), { code: "evidence_publication_failed" });
  const operations = {
    verifyExecution: async () => ({ commit: "1".repeat(40), tree: "2".repeat(40), ci_run_id: 123456 }),
    buildImages: async () => complete.images,
    observeProduction: async () => complete.production_containers,
    verifyMigrations: async () => complete.migration,
    captureRollback: async () => complete.rollback,
    resolveIdentities: async () => complete.identity_resolution,
    buildKnowledge: async () => complete.knowledge,
    verifyConfiguration: async () => complete.configuration,
    finalizeArtifacts: async () => { throw evidenceError; },
    writeResult: async (value) => value,
  };
  const result = await runP8V2Preparation({ operations, generatedAt: complete.generated_at });
  assert.equal(result.result_code, "evidence_failed");
  assert.deepEqual(result.blocker, { step: "evidence_publication", code: "evidence_publication_failed" });
  assert.equal(result.steps.at(-1).status, "failed");
  validateP8V2PreparationResult(result);
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  const lie = structuredClone(result);
  lie.result_code = "preparation_blocked";
  assert.equal(validate(lie), false);
  assert.throws(() => validateP8V2PreparationResult(lie));
});

test("a failure while writing or verifying the final success is recovered as closed evidence_failed", async () => {
  const complete = verifiedResult();
  let recovered;
  const operations = {
    verifyExecution: async () => ({ commit: "1".repeat(40), tree: "2".repeat(40), ci_run_id: 123456 }),
    buildImages: async () => complete.images,
    observeProduction: async () => complete.production_containers,
    verifyMigrations: async () => complete.migration,
    captureRollback: async () => complete.rollback,
    resolveIdentities: async () => complete.identity_resolution,
    buildKnowledge: async () => complete.knowledge,
    verifyConfiguration: async () => complete.configuration,
    finalizeArtifacts: async () => SHA,
    writeResult: async () => { throw new Error("synthetic final verification failure"); },
    recoverEvidenceFailure: async (value) => { recovered = structuredClone(value); return value; },
  };
  const result = await runP8V2Preparation({ operations, generatedAt: complete.generated_at });
  assert.equal(result.result_code, "evidence_failed");
  assert.deepEqual(result.blocker, { step: "evidence_publication", code: "evidence_publication_failed" });
  assert.equal(result.collection.index_sha256, null);
  assert.deepEqual(recovered, result);
  validateP8V2PreparationResult(result);
});

test("evidence publication verifies exact six-artifact index and rejects drift or privacy leaks", async () => {
  const root = await mkdtemp(join(tmpdir(), "evo-p8v2-result-"));
  const value = verifiedResult();
  const artifacts = [
    ...P8V2.images.map((item) => item.archive),
    "portable-image-identity.json",
    "knowledge-build-result.json",
    "rollback-capture.json",
  ];
  const records = [];
  for (const file of artifacts) {
    const path = join(root, file);
    let retained = null;
    if (file === "portable-image-identity.json") retained = { version: "p8v2c-portable-image-identity.v1", source_commit: P8V2.applicationCommit, source_tree: P8V2.applicationTree, images: value.images };
    if (file === "knowledge-build-result.json") retained = value.knowledge;
    if (file === "rollback-capture.json") retained = value.rollback;
    const bytes = Buffer.from(retained ? `${JSON.stringify(retained)}\n` : `${file}\n`);
    await writeFile(path, bytes, { mode: 0o600 });
    records.push({ file, mode: 600, size: bytes.length, sha256: await P8V2.sha256File(path) });
  }
  records.sort((left, right) => left.file.localeCompare(right.file));
  const indexBytes = Buffer.from(`${JSON.stringify({ version: 1, files: records }, null, 2)}\n`);
  await writeFile(join(root, "collection-index.json"), indexBytes, { mode: 0o600 });
  value.collection.index_sha256 = await P8V2.sha256File(join(root, "collection-index.json"));
  await writeFile(join(root, "v2-preparation-result.json"), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await stat(root).then(() => import("node:fs/promises").then(({ chmod }) => chmod(root, 0o700)));

  assert.equal((await verifyP8V2FinalRoot(root)).result_code, "preparation_verified");
  await writeFile(join(root, artifacts[0]), "drift\n", { mode: 0o600 });
  await assert.rejects(() => verifyP8V2FinalRoot(root));
  await writeFile(join(root, artifacts[0]), `${P8V2.applicationCommit}\ncustomer@example.com\n`, { mode: 0o600 });
  await assert.rejects(() => verifyP8V2FinalRoot(root));
});
