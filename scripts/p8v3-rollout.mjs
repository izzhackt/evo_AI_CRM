#!/usr/bin/env node

import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STEP_NAMES = Object.freeze([
  "pre_state",
  "migration",
  "client_import",
  "internal_import",
  "crm",
  "inbox",
  "lead_agent",
]);
const BOUNDARY_NAMES = Object.freeze(["crm", "inbox", "lead_agent"]);
const RESULT_CODES = new Set([
  "rollout_verified",
  "rollout_failed_rolled_back",
  "rollout_failed_reconciliation_required",
  "evidence_failed",
]);
const FAILURE_CODES = new Set([
  "preflight_drift",
  "authorization_expired",
  "configuration_failed",
  "migration_failed",
  "knowledge_failed",
  "deployment_failed",
  "verification_failed",
  "rollback_failed",
  "evidence_publication_failed",
]);
const KNOWLEDGE_REASON_CODES = new Set([
  "provider_rate_limited",
  "provider_rejected",
  "bundle_invalid",
  "manifest_mismatch",
  "account_binding_failed",
  "rpc_rejected",
  "transport_failed",
]);

export const P8V3 = Object.freeze({
  version: "p8v-v1-rollout-result/v1",
  authorization: "EXECUTE-P8V3I-2026-08-21.P8V3I.1",
  previousAuthorization: "EXECUTE-P8V3H-2026-08-21.P8V3H.1",
  legacyAuthorization: "EXECUTE-P8V3G-2026-08-21.P8V3G.1",
  earlierAuthorization: "EXECUTE-P8V3F-2026-08-20.P8V3F.1",
  historicalAuthorization: "EXECUTE-P8V3E-2026-08-20.P8V3E.1",
  applicationCommit: "0f1454d014bbc9eca9d7381dfe557e980965543e",
  applicationTree: "19599bcf043dc4a555c8996c21e7801934b64633",
  windowMs: 90 * 60 * 1000,
  stepNames: STEP_NAMES,
  boundaryNames: BOUNDARY_NAMES,
  requiredConfigurationNames: Object.freeze([
    "EVO_PLATFORM_GEMINI_API_KEY",
    "EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED",
    "EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET",
    "EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED",
    "EVO_PLATFORM_STAFF_ASSISTANT_ENABLED",
  ]),
});

function fail(message, code = "verification_failed") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactKeys(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) fail(`${label} is not closed`);
}

function emptyAudience(name) {
  return {
    name,
    status: "not_run",
    document_count: null,
    chunk_count: null,
    bundle_sha256: null,
    manifest_sha256: null,
    database_revision_sha256: null,
  };
}

function emptyBoundary(name) {
  return {
    name,
    status: "not_run",
    before_image_id: null,
    after_image_id: null,
    container_id: null,
    health: null,
    restart_count: null,
    networks: [],
    disabled_state: null,
    manual_worker: name === "crm" ? "not_run" : "not_applicable",
  };
}

export function createEmptyP8V3Result({ generatedAt, execution, startedAt, expiresAt, preflightSha256 }) {
  return {
    version: P8V3.version,
    generated_at: generatedAt,
    result_code: "rollout_failed_reconciliation_required",
    execution: structuredClone(execution),
    application: { commit: P8V3.applicationCommit, tree: P8V3.applicationTree },
    authorization: { id: P8V3.authorization, started_at: startedAt, expires_at: expiresAt, preflight_sha256: preflightSha256 },
    steps: STEP_NAMES.map((name) => ({ name, status: "not_run" })),
    failure: null,
    pre_state: [],
    migration: { status: "not_run", before_range: null, before_count: null, after_range: null, after_count: null, applied_versions: [] },
    knowledge: { cleanup_status: "not_required", audiences: [emptyAudience("client"), emptyAudience("internal")] },
    configuration: { status: "not_run", installed_names: [], backup_sha256: null, lead_file_verified: null, worker_file_verified: null },
    boundaries: BOUNDARY_NAMES.map(emptyBoundary),
    waha: { crm_container_id: "0".repeat(64), crm_image_id: `sha256:${"0".repeat(64)}`, inbox_container_id: "0".repeat(64), inbox_image_id: `sha256:${"0".repeat(64)}`, unchanged: false },
    rollback: { status: "not_required", boundaries: [], configuration_restored: false },
    effects: { migration_applied: 0, knowledge_imports: 0, application_recreates: 0, waha_recreates: 0, amo_writes: 0, whatsapp_sends: 0, staff_draft_calls: 0 },
  };
}

function validateContainer(record) {
  exactKeys(record, ["name", "container_id", "image_id", "health", "restart_count", "networks"], "container");
  if (!record.name || !SHA64.test(record.container_id) || !IMAGE_ID.test(record.image_id) || record.health !== "healthy" || record.restart_count !== 0 || !Array.isArray(record.networks) || record.networks.length < 1 || new Set(record.networks).size !== record.networks.length) fail("container evidence drifted");
}

function validateAudience(record, name, count) {
  exactKeys(record, ["name", "status", "document_count", "chunk_count", "bundle_sha256", "manifest_sha256", "database_revision_sha256"], `${name} audience`);
  if (record.name !== name || !["not_run", "verified", "failed"].includes(record.status)) fail("audience progression drifted");
  if (record.status === "verified") {
    if (record.document_count !== count || !Number.isSafeInteger(record.chunk_count) || record.chunk_count < 1 || !SHA64.test(record.bundle_sha256) || !SHA64.test(record.manifest_sha256) || !SHA64.test(record.database_revision_sha256)) fail("verified audience evidence drifted");
  } else if (record.document_count !== null || record.chunk_count !== null || record.bundle_sha256 !== null || record.manifest_sha256 !== null || record.database_revision_sha256 !== null) fail("non-verified audience retained success evidence");
}

function validateBoundary(record, name) {
  exactKeys(record, ["name", "status", "before_image_id", "after_image_id", "container_id", "health", "restart_count", "networks", "disabled_state", "manual_worker"], `${name} boundary`);
  if (record.name !== name || !["not_run", "verified", "failed"].includes(record.status)) fail("boundary progression drifted");
  if (record.status === "verified") {
    if (!IMAGE_ID.test(record.before_image_id) || !IMAGE_ID.test(record.after_image_id) || !SHA64.test(record.container_id) || record.health !== "healthy" || record.restart_count !== 0 || !Array.isArray(record.networks) || record.networks.length < 1 || record.disabled_state !== true || (name === "crm" ? record.manual_worker !== "verified" : record.manual_worker !== "not_applicable")) fail("verified boundary evidence drifted");
  }
}

function validateMigration(record) {
  exactKeys(record, ["status", "before_range", "before_count", "after_range", "after_count", "applied_versions"], "migration");
  if (!["not_run", "verified", "observed_applied", "failed"].includes(record.status) || !Array.isArray(record.applied_versions) || record.applied_versions.some((item) => item !== "077") || record.applied_versions.length > 1) fail("migration evidence drifted");
  const applied = record.before_range === "001-076" && record.before_count === 76 && record.after_range === "001-077" && record.after_count === 77 && record.applied_versions.join() === "077";
  const reconciled = record.before_range === "001-077" && record.before_count === 77 && record.after_range === "001-077" && record.after_count === 77 && record.applied_versions.length === 0;
  if (record.status === "observed_applied" && !applied) fail("observed migration evidence drifted");
  if (record.status === "verified" && !applied && !reconciled) fail("verified migration evidence drifted");
  if (record.status === "not_run" && (record.before_range !== null || record.before_count !== null || record.after_range !== null || record.after_count !== null || record.applied_versions.length !== 0)) fail("not-run migration retained progress");
  return record;
}

function isExactRolledBackFailure(value) {
  const originalConfigurationFailure = value.failure?.step === "pre_state"
    && value.failure?.code === "configuration_failed"
    && value.steps.map((step) => step.status).join("\0") === ["failed", ...Array(6).fill("not_run")].join("\0")
    && value.pre_state.length === 5
    && value.migration.status === "not_run"
    && value.migration.before_range === null
    && value.migration.before_count === null
    && value.migration.after_range === null
    && value.migration.after_count === null
    && value.migration.applied_versions.length === 0
    && value.knowledge.cleanup_status === "not_required"
    && value.knowledge.audiences.every((item) => item.status === "not_run")
    && ["not_run", "failed"].includes(value.configuration.status)
    && value.configuration.installed_names.length === 0
    && value.configuration.backup_sha256 === null
    && ([P8V3.authorization, P8V3.previousAuthorization].includes(value.authorization?.id) ? value.configuration.lead_file_verified === null : !("lead_file_verified" in value.configuration))
    && value.configuration.worker_file_verified === null
    && value.boundaries.every((item) => item.status === "not_run"
      && item.before_image_id === null
      && item.after_image_id === null
      && item.container_id === null
      && item.health === null
      && item.restart_count === null
      && item.networks.length === 0
      && item.disabled_state === null
      && item.manual_worker === (item.name === "crm" ? "not_run" : "not_applicable"))
    && value.waha.unchanged === false
    && value.rollback.status === "verified"
    && value.rollback.boundaries.length === 0
    && value.rollback.configuration_restored === true
    && value.effects.migration_applied === 0
    && value.effects.knowledge_imports === 0
    && value.effects.application_recreates === 0;
  const reconciledMigrationFailure = [P8V3.authorization, P8V3.previousAuthorization].includes(value.authorization?.id)
    && value.failure?.step === "migration"
    && value.failure?.code === "migration_failed"
    && value.steps.map((step) => step.status).join("\0") === ["verified", "failed", ...Array(5).fill("not_run")].join("\0")
    && value.pre_state.length === 5
    && value.migration.status === "not_run"
    && value.knowledge.cleanup_status === "not_required"
    && value.knowledge.audiences.every((item) => item.status === "not_run")
    && value.configuration.status === "verified"
    && value.boundaries.every((item) => item.status === "not_run")
    && value.waha.unchanged === false
    && value.rollback.status === "verified"
    && value.rollback.boundaries.length === 0
    && value.rollback.configuration_restored === true
    && value.effects.migration_applied === 0
    && value.effects.knowledge_imports === 0
    && value.effects.application_recreates === 0;
  return originalConfigurationFailure || reconciledMigrationFailure;
}

export function validateP8V3Result(value) {
  exactKeys(value, ["version", "generated_at", "result_code", "execution", "application", "authorization", "steps", "failure", "pre_state", "migration", "knowledge", "configuration", "boundaries", "waha", "rollback", "effects"], "result");
  if (value.version !== P8V3.version || !RESULT_CODES.has(value.result_code) || !UTC.test(value.generated_at) || Number.isNaN(Date.parse(value.generated_at))) fail("result identity drifted");
  exactKeys(value.execution, ["commit", "tree", "ci_run_id"], "execution");
  if (!SHA40.test(value.execution.commit) || !SHA40.test(value.execution.tree) || !Number.isSafeInteger(value.execution.ci_run_id) || value.execution.ci_run_id < 1) fail("execution identity drifted");
  exactKeys(value.application, ["commit", "tree"], "application");
  if (value.application.commit !== P8V3.applicationCommit || value.application.tree !== P8V3.applicationTree) fail("application identity drifted");
  exactKeys(value.authorization, ["id", "started_at", "expires_at", "preflight_sha256"], "authorization");
  if (![P8V3.authorization, P8V3.previousAuthorization, P8V3.legacyAuthorization, P8V3.earlierAuthorization, P8V3.historicalAuthorization].includes(value.authorization.id) || !UTC.test(value.authorization.started_at) || !UTC.test(value.authorization.expires_at) || Date.parse(value.authorization.expires_at) - Date.parse(value.authorization.started_at) !== P8V3.windowMs || !SHA64.test(value.authorization.preflight_sha256)) fail("authorization window drifted");
  if (!Array.isArray(value.steps) || value.steps.length !== STEP_NAMES.length) fail("step cardinality drifted");
  let terminalIndex = -1;
  for (const [index, step] of value.steps.entries()) {
    exactKeys(step, ["name", "status"], "step");
    if (step.name !== STEP_NAMES[index] || !["not_run", "verified", "failed"].includes(step.status)) fail("step progression drifted");
    if (step.status === "failed") {
      if (terminalIndex !== -1) fail("multiple failed steps");
      terminalIndex = index;
    }
    if (terminalIndex !== -1 && index > terminalIndex && step.status !== "not_run") fail("work continued after failure");
    if (terminalIndex === -1 && step.status === "not_run" && value.steps.slice(index + 1).some((later) => later.status !== "not_run")) fail("step progression skipped a boundary");
  }
  if (!Array.isArray(value.pre_state) || (value.pre_state.length !== 0 && value.pre_state.length !== 5)) fail("pre-state cardinality drifted");
  for (const record of value.pre_state) validateContainer(record);
  validateMigration(value.migration);
  exactKeys(value.knowledge, ["cleanup_status", "audiences"], "knowledge");
  if (!["not_required", "verified", "failed"].includes(value.knowledge.cleanup_status) || !Array.isArray(value.knowledge.audiences) || value.knowledge.audiences.length !== 2) fail("knowledge evidence drifted");
  validateAudience(value.knowledge.audiences[0], "client", 11);
  validateAudience(value.knowledge.audiences[1], "internal", 291);
  const hasLeadFileEvidence = [P8V3.authorization, P8V3.previousAuthorization, P8V3.legacyAuthorization, P8V3.earlierAuthorization].includes(value.authorization.id);
  exactKeys(value.configuration, hasLeadFileEvidence
    ? ["status", "installed_names", "backup_sha256", "lead_file_verified", "worker_file_verified"]
    : ["status", "installed_names", "backup_sha256", "worker_file_verified"], "configuration");
  if (!["not_run", "verified", "failed"].includes(value.configuration.status) || !Array.isArray(value.configuration.installed_names)) fail("configuration evidence drifted");
  if (value.configuration.status === "verified" && (value.configuration.installed_names.slice().sort().join("\0") !== P8V3.requiredConfigurationNames.slice().sort().join("\0") || !SHA64.test(value.configuration.backup_sha256) || (hasLeadFileEvidence && value.configuration.lead_file_verified !== true) || value.configuration.worker_file_verified !== true)) fail("verified configuration evidence drifted");
  if (!Array.isArray(value.boundaries) || value.boundaries.length !== 3) fail("boundary cardinality drifted");
  BOUNDARY_NAMES.forEach((name, index) => validateBoundary(value.boundaries[index], name));
  exactKeys(value.waha, ["crm_container_id", "crm_image_id", "inbox_container_id", "inbox_image_id", "unchanged"], "waha");
  if (!SHA64.test(value.waha.crm_container_id) || !IMAGE_ID.test(value.waha.crm_image_id) || !SHA64.test(value.waha.inbox_container_id) || !IMAGE_ID.test(value.waha.inbox_image_id) || typeof value.waha.unchanged !== "boolean") fail("WAHA evidence drifted");
  exactKeys(value.rollback, ["status", "boundaries", "configuration_restored"], "rollback");
  if (!["not_required", "verified", "failed"].includes(value.rollback.status) || !Array.isArray(value.rollback.boundaries) || value.rollback.boundaries.some((item) => !BOUNDARY_NAMES.includes(item)) || typeof value.rollback.configuration_restored !== "boolean") fail("rollback evidence drifted");
  exactKeys(value.effects, ["migration_applied", "knowledge_imports", "application_recreates", "waha_recreates", "amo_writes", "whatsapp_sends", "staff_draft_calls"], "effects");
  if (![value.effects.migration_applied, value.effects.knowledge_imports, value.effects.application_recreates].every(Number.isSafeInteger) || value.effects.migration_applied < 0 || value.effects.migration_applied > 1 || value.effects.knowledge_imports < 0 || value.effects.knowledge_imports > 2 || value.effects.application_recreates < 0 || value.effects.application_recreates > 3 || value.effects.waha_recreates !== 0 || value.effects.amo_writes !== 0 || value.effects.whatsapp_sends !== 0 || value.effects.staff_draft_calls !== 0) fail("effect counters drifted");
  if (value.migration.status === "observed_applied" && (value.steps[1].status !== "failed" || value.effects.migration_applied !== 1 || !["rollout_failed_reconciliation_required", "evidence_failed"].includes(value.result_code))) fail("ambiguous applied migration evidence drifted");
  const noOpMigrationAuthorization = [P8V3.authorization, P8V3.previousAuthorization, P8V3.legacyAuthorization, P8V3.earlierAuthorization, "EXECUTE-P8V3E-2026-08-20.P8V3E.1"].includes(value.authorization.id);
  if (noOpMigrationAuthorization && value.migration.status === "observed_applied") fail("P8V3E/P8V3F/P8V3G/P8V3H/P8V3I cannot report a newly applied migration");
  if (noOpMigrationAuthorization && value.migration.status === "verified" && (value.migration.before_range !== "001-077" || value.migration.after_range !== "001-077" || value.migration.applied_versions.length !== 0 || value.effects.migration_applied !== 0)) fail("P8V3E/P8V3F/P8V3G/P8V3H/P8V3I reconciliation evidence drifted");
  if (value.failure !== null) {
    const requiresReason = value.authorization.id === P8V3.authorization && ["client_import", "internal_import"].includes(value.failure.step);
    exactKeys(value.failure, requiresReason ? ["step", "code", "reason_code"] : ["step", "code"], "failure");
    if (![...STEP_NAMES, "evidence"].includes(value.failure.step) || !FAILURE_CODES.has(value.failure.code)) fail("failure evidence drifted");
    if (requiresReason && !KNOWLEDGE_REASON_CODES.has(value.failure.reason_code)) fail("knowledge failure reason drifted");
    if (value.failure.step !== "evidence") {
      const failedSteps = value.steps.filter((step) => step.status === "failed");
      if (failedSteps.length !== 1 || failedSteps[0].name !== value.failure.step) fail("failure step does not match progression");
    }
  }
  if (value.result_code === "rollout_verified") {
  const expectedMigrationEffect = [P8V3.authorization, P8V3.previousAuthorization, P8V3.legacyAuthorization, P8V3.earlierAuthorization].includes(value.authorization.id) ? 0 : 1;
    if (value.failure !== null || value.steps.some((step) => step.status !== "verified") || value.pre_state.length !== 5 || value.migration.status !== "verified" || value.knowledge.cleanup_status !== "verified" || value.knowledge.audiences.some((item) => item.status !== "verified") || value.configuration.status !== "verified" || value.boundaries.some((item) => item.status !== "verified") || value.waha.unchanged !== true || value.rollback.status !== "not_required" || value.rollback.boundaries.length !== 0 || value.effects.migration_applied !== expectedMigrationEffect || value.effects.knowledge_imports !== 2 || value.effects.application_recreates !== 3) fail("false rollout success");
  } else if (value.failure === null) fail("failed result is missing failure evidence");
  else if (value.result_code === "rollout_failed_rolled_back" && !isExactRolledBackFailure(value)) fail("false fully rolled-back result");
  else if (value.result_code === "rollout_failed_reconciliation_required" && (value.failure.step === "evidence" || isExactRolledBackFailure(value))) fail("false reconciliation result");
  else if (value.result_code === "evidence_failed" && (value.failure.step !== "evidence" || value.failure.code !== "evidence_publication_failed")) fail("false evidence failure result");
  return value;
}

function failureCode(error, step) {
  if (FAILURE_CODES.has(error?.code)) return error.code;
  if (step === "pre_state") return "preflight_drift";
  if (step === "migration") return "migration_failed";
  if (step === "client_import" || step === "internal_import") return "knowledge_failed";
  if (BOUNDARY_NAMES.includes(step)) return "deployment_failed";
  return "verification_failed";
}

export async function runP8V3Rollout({ operations, authorization, preflight, preflightSha256, now = () => Date.now() }) {
  if (authorization !== P8V3.authorization) fail("exact P8V3 authorization is required", "preflight_drift");
  if (!SHA64.test(preflightSha256) || !preflight || preflight.application?.commit !== P8V3.applicationCommit || preflight.application?.tree !== P8V3.applicationTree || !UTC.test(preflight.generated_at) || !UTC.test(preflight.expires_at) || now() >= Date.parse(preflight.expires_at) || !Array.isArray(preflight.containers) || preflight.containers.length !== 5 || preflight.compose_validated !== true || preflight.prerequisites_verified !== true || preflight.migration?.range !== "001-077" || preflight.migration?.count !== 77 || !Array.isArray(preflight.archives) || preflight.archives.length !== 3 || preflight.gemini?.embedding_verified !== true || preflight.gemini?.draft_verified !== true || preflight.gemini?.retrieval_provider_verified !== true || !SHA64.test(preflight.importer?.sha256) || !Number.isSafeInteger(preflight.importer?.size) || preflight.importer.size < 1 || preflight.importer.verified !== true) fail("reviewed P8V3F preflight is missing, expired or drifted", "preflight_drift");
  preflight.containers.forEach(validateContainer);
  const startedMs = now();
  const expiresMs = startedMs + P8V3.windowMs;
  const execution = await operations.executionIdentity();
  if (JSON.stringify(execution) !== JSON.stringify(preflight.execution)) fail("execution identity changed after preflight", "preflight_drift");
  await operations.verifyPreflight(preflight);
  let readinessPrepared = true;
  const result = createEmptyP8V3Result({
    generatedAt: new Date(startedMs).toISOString(),
    execution,
    startedAt: new Date(startedMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    preflightSha256,
  });
  let stepIndex = 0;
  const attemptedBoundaries = [];
  let configurationStarted = false;
  let forwardOnlyStarted = false;
  let knowledgeStarted = false;
  const requireWindow = () => {
    if (now() >= expiresMs) fail("P8V3 authorization expired", "authorization_expired");
  };
  try {
    requireWindow();
    result.pre_state = structuredClone(preflight.containers);
    result.waha = structuredClone(preflight.waha);

    configurationStarted = true;
    requireWindow();
    const configuration = await operations.configure({ deadlineAt: expiresMs });
    result.configuration = structuredClone(configuration);
    if (configuration.status !== "verified") fail("configuration did not verify", "configuration_failed");
    result.steps[0].status = "verified";

    stepIndex = 1;
    requireWindow();
    // Migration 077 is already present. P8V3F only proves its ledger, objects
    // and grants read-only; the first new forward-only effect is publication.
    const migration = await operations.migrate({ deadlineAt: expiresMs });
    validateMigration(migration);
    result.migration = structuredClone(migration);
    if (migration.status !== "verified") fail("migration did not verify", "migration_failed");
    result.steps[1].status = "verified";

    forwardOnlyStarted = true;
    knowledgeStarted = true;
    for (const [audienceIndex, audience] of ["client", "internal"].entries()) {
      stepIndex = audienceIndex + 2;
      requireWindow();
      const record = await operations.importKnowledge(audience, { deadlineAt: expiresMs });
      validateAudience(record, audience, audience === "client" ? 11 : 291);
      result.knowledge.audiences[audienceIndex] = structuredClone(record);
      result.effects.knowledge_imports += 1;
      result.steps[stepIndex].status = "verified";
    }
    await operations.cleanupKnowledge();
    result.knowledge.cleanup_status = "verified";
    knowledgeStarted = false;
    readinessPrepared = false;

    for (const [boundaryIndex, name] of BOUNDARY_NAMES.entries()) {
      stepIndex = boundaryIndex + 4;
      requireWindow();
      attemptedBoundaries.push(name);
      const record = await operations.deploy(name, { deadlineAt: expiresMs, before: result.pre_state });
      validateBoundary(record, name);
      result.boundaries[boundaryIndex] = structuredClone(record);
      result.effects.application_recreates += 1;
      result.steps[stepIndex].status = "verified";
    }
    const waha = await operations.verifyWaha({ deadlineAt: expiresMs });
    if (JSON.stringify(waha) !== JSON.stringify({ ...result.waha, unchanged: true })) fail("WAHA identity changed", "verification_failed");
    result.waha = structuredClone(waha);
    result.result_code = "rollout_verified";
  } catch (error) {
    if (stepIndex === 1 && error?.migrationRecord) {
      validateMigration(error.migrationRecord);
      result.migration = structuredClone(error.migrationRecord);
      result.effects.migration_applied = 1;
    }
    if (stepIndex >= 0 && stepIndex < result.steps.length && result.steps[stepIndex].status !== "failed") result.steps[stepIndex].status = "failed";
    const failedStep = STEP_NAMES[stepIndex] ?? "pre_state";
    result.failure = { step: failedStep, code: failureCode(error, failedStep) };
    if (["client_import", "internal_import"].includes(failedStep)) {
      result.failure.reason_code = KNOWLEDGE_REASON_CODES.has(error?.reasonCode) ? error.reasonCode : "transport_failed";
    }
    let cleanupFailed = false;
    if (knowledgeStarted) {
      try {
        await operations.cleanupKnowledge();
        result.knowledge.cleanup_status = "verified";
      } catch {
        result.knowledge.cleanup_status = "failed";
        cleanupFailed = true;
      }
    } else if (readinessPrepared) {
      try {
        await operations.cleanupPreparedReadiness?.();
        readinessPrepared = false;
      } catch {
        cleanupFailed = true;
      }
    }
    if (attemptedBoundaries.length > 0) {
      const reverse = attemptedBoundaries.slice().reverse();
      try {
        const rollback = await operations.rollback(reverse);
        result.rollback = { status: "verified", boundaries: reverse, configuration_restored: rollback.configuration_restored === true };
      } catch {
        result.rollback = { status: "failed", boundaries: reverse, configuration_restored: false };
        result.failure.code = "rollback_failed";
        cleanupFailed = true;
      }
    } else if (configurationStarted) {
      try {
        await operations.restoreConfiguration();
        result.rollback = { status: "verified", boundaries: [], configuration_restored: true };
      } catch {
        result.rollback = { status: "failed", boundaries: [], configuration_restored: false };
        result.failure.code = "rollback_failed";
        cleanupFailed = true;
      }
    }
    result.result_code = !forwardOnlyStarted && !cleanupFailed && isExactRolledBackFailure(result)
      ? "rollout_failed_rolled_back"
      : "rollout_failed_reconciliation_required";
  }

  validateP8V3Result(result);
  try {
    await operations.publishEvidence(structuredClone(result));
  } catch {
    result.result_code = "evidence_failed";
    result.failure = { step: "evidence", code: "evidence_publication_failed" };
    try { await operations.cleanupEvidence(); } catch { /* retain local evidence below */ }
    validateP8V3Result(result);
  }
  return result;
}

export function writeP8V3Result(outputPath, result) {
  validateP8V3Result(result);
  const target = resolve(outputPath);
  const parent = dirname(target);
  const parentMeta = lstatSync(parent);
  if (!parentMeta.isDirectory() || parentMeta.isSymbolicLink()) fail("result parent is unsafe");
  const expected = `${JSON.stringify(result, null, 2)}\n`;
  if (existsSync(target)) {
    const metadata = lstatSync(target);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600 || readFileSync(target, "utf8") !== expected) fail("existing result does not match the published result");
    return target;
  }
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, expected, { encoding: "utf8", flag: "wx", mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) fail("result file is unsafe");
  return target;
}
