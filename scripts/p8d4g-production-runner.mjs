#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";

export const P8D4G = Object.freeze({
  releaseId: "2026-08-17.p8d4r.1",
  releaseControlCommit: "86303ad0f3a25b54395327c03974ef00a80140fa",
  releaseControlTree: "150474f6f035a2ce29e8f404a655176970086549",
  releaseControlCiRun: 31920969058,
  candidateCommit: "aaa9f618131f604f79c694e4b332a0b13afd7a30",
  candidateTree: "36632068dbfa5ae3d11fdd5bb6876940ca7fc14a",
  candidateParent: "e8e1b0e41c17b8e55f75edd34afedd551c1d57f8",
  candidateCiRun: 31916279374,
  platform: "linux/amd64",
  migrationRange: "001-076",
  confirmation: "EXECUTE-P8D4R-2026-08-17.P8D4R.1",
  windowMs: 120 * 60 * 1000,
  deployments: Object.freeze(["inbox", "crm", "lead_agent"]),
  pilots: Object.freeze(["client_china_documents", "internal_malaysia_handoff"]),
  productionEvidenceRoot: resolve(fileURLToPath(new URL("..", import.meta.url)), `.evo-release-evidence/p8d4g-${"2026-08-17.p8d4r.1"}`),
});

const RESULT_CODES = new Set([
  "preflight_verified", "pilot_verified", "preflight_blocked",
  "staging_failed", "config_failed", "migration_drift", "knowledge_failed",
  "cleanup_failed", "deployment_failed", "rollback_failed", "pilot_failed",
  "operation_failed",
]);
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const FORBIDDEN_KEY_PATTERN = /(?:secret|token|password|cookie)|^(?:account_?id|prompt|response|body|url|provider_?id|customer_?id)$/i;
const schema = JSON.parse(readFileSync(new URL("../docs/schemas/p8d4g-result.schema.json", import.meta.url), "utf8"));
const validateSchema = new Ajv2020({ strict: false, formats: { "date-time": true } }).compile(schema);

function fail(message, code = "operation_failed") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertSafeValue(value, path = "result") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEY_PATTERN.test(key)) fail(`${path}.${key} is forbidden in redacted evidence`);
      assertSafeValue(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && UUID_PATTERN.test(value)) fail(`${path} contains a forbidden UUID`);
}

function emptyAudience(name) {
  return { name, status: "not_run", document_count: null, chunk_count: null, bundle_sha256: null, manifest_sha256: null, database_revision_sha256: null };
}

function emptyDeployment(name) {
  return { name, status: "not_run", image_id: null, healthy: null, restart_count: null, disabled_state: null };
}

function emptyPilot(caseId, audience) {
  return { case_id: caseId, audience, status: "not_run", http_status: null, expected_source_match: null, cross_audience_sources: null, audit_body_free: null, side_effect_free: null };
}

export function createP8D4GResult(now = new Date()) {
  return {
    schema_version: "p8d4g-v1",
    result_code: "operation_failed",
    observed_at: now.toISOString(),
    release: {
      release_id: P8D4G.releaseId,
      release_control_commit: P8D4G.releaseControlCommit,
      release_control_tree: P8D4G.releaseControlTree,
      release_control_ci_run: P8D4G.releaseControlCiRun,
      candidate_commit: P8D4G.candidateCommit,
      candidate_tree: P8D4G.candidateTree,
      candidate_parent: P8D4G.candidateParent,
      candidate_ci_run: P8D4G.candidateCiRun,
      platform: P8D4G.platform,
      migration_range: P8D4G.migrationRange,
    },
    window: { status: "not_started", started_at: null, deadline_at: null },
    phases: { preflight: "not_run", staging: "not_run", configuration: "not_run", migrations: "not_run", knowledge: "not_run", deployment: "not_run", pilot: "not_run" },
    proof: {
      execution_control: { status: "not_run", implementation_commit: null, implementation_tree: null, implementation_ci_run: null, execution_commit: null, execution_tree: null, execution_ci_run: null, files: [] },
      preflight_containers: [],
      transferred_artifacts: [],
      rollback_files: [],
      migrations: { status: "not_run", before_range: null, before_count: null, after_range: null, after_count: null, applied_count: null, project_status: null },
    },
    knowledge: { account_resolution: "not_run", deterministic_builds: "not_run", audiences: [emptyAudience("client"), emptyAudience("internal")] },
    deployments: [emptyDeployment("inbox"), emptyDeployment("crm"), emptyDeployment("lead_agent")],
    pilots: [emptyPilot("client_china_documents", "client"), emptyPilot("internal_malaysia_handoff", "internal")],
    rollback: { status: "not_required", boundaries: [] },
    cleanup: { status: "not_required", local_roots_removed: 0, remote_pairs_removed: 0, container_pairs_removed: 0, importer_removed: false },
  };
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join("\0") !== expected.join("\0")) fail(`${label} has an invalid closed shape`);
}

function validatePreflight(record) {
  exactKeys(record, ["status", "execution_control", "containers", "migration_range", "migration_count", "candidate_tag_boundary_verified", "roots_absent", "rollback_inputs_verified"], "preflight");
  if (record.status !== "verified" || record.migration_range !== P8D4G.migrationRange || record.migration_count !== 76 || record.candidate_tag_boundary_verified !== true || record.roots_absent !== true || record.rollback_inputs_verified !== true) fail("preflight did not verify the frozen boundary", "preflight_blocked");
  const expected = [
    ["evo-crm-app-1", "sha256:d4626208423df2c0df24262763917b82b1157b53a115b44f02478ecf7245f580"],
    ["evo-inbox-app-1", "sha256:6d5e0a9d5ea073737bdd8c2c5621818ca7bdb76dd5b16ca5e44563d39833cb6b"],
    ["evo-crm-lead-agent-1", "sha256:3678747c1ea1c9b5655bb830296c9e4d4aedf60d3d193b438633b68eb3f97cc7"],
    ["evo-crm-waha-1", "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c"],
    ["evo-inbox-waha", "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c"],
  ];
  if (!Array.isArray(record.containers) || record.containers.length !== 5 || record.containers.some((item, index) => item.name !== expected[index][0] || item.image_id !== expected[index][1] || item.healthy !== true || item.restart_count !== 0)) fail("preflight containers are not stable", "preflight_blocked");
  validateExecutionControl(record.execution_control);
}

function validateExecutionControl(record) {
  exactKeys(record, ["status", "implementation_commit", "implementation_tree", "implementation_ci_run", "execution_commit", "execution_tree", "execution_ci_run", "files"], "execution control");
  if (record.status !== "verified" || !/^[0-9a-f]{40}$/.test(record.implementation_commit) || !/^[0-9a-f]{40}$/.test(record.implementation_tree) || !Number.isInteger(record.implementation_ci_run) || !/^[0-9a-f]{40}$/.test(record.execution_commit) || !/^[0-9a-f]{40}$/.test(record.execution_tree) || !Number.isInteger(record.execution_ci_run)) fail("execution control did not verify", "preflight_blocked");
  const expectedPaths = ["scripts/p8d4g-production-runner.mjs", "scripts/p8d4g-production-operations.mjs", "docs/schemas/p8d4g-result.schema.json", "docs/schemas/p8d4g-execution-control.schema.json", "package.json"];
  if (!Array.isArray(record.files) || record.files.length !== expectedPaths.length || record.files.some((item, index) => {
    exactKeys(item, ["path", "sha256"], `execution control file ${index}`);
    return item.path !== expectedPaths[index] || !/^[0-9a-f]{64}$/.test(item.sha256);
  })) fail("execution control file evidence drifted", "preflight_blocked");
}

function validateStage(record) {
  exactKeys(record, ["status", "archives_verified", "images_verified", "rollback_verified", "release_repo_verified", "artifacts", "rollback_files"], "staging");
  if (record.status !== "verified" || record.archives_verified !== 3 || record.images_verified !== 3 || record.rollback_verified !== true || record.release_repo_verified !== true) fail("staging did not verify the frozen release", "staging_failed");
  const expectedArtifacts = [
    ["portable_identity", "portable-image-identity.json", "53fa00c63338a55925fa8d2c8d6e6faaa61d63b0f99251e50dabafd792755ccd", null],
    ["image_archive", `evo-crm-${P8D4G.candidateCommit}-linux-amd64.tar`, "07c9341c0aeae456b2bd51ae66a8f0ba81645e49f064a212cdc1485df0db50b1", "sha256:3174e8e35f27ca3983e971d6f4b94b6863a5b64a9ffd751042b3db5ed2f8c55a"],
    ["image_archive", `evo-inbox-${P8D4G.candidateCommit}-linux-amd64.tar`, "6bbeadd9e7571db018e0d9932cddfd8f22503b0090c4a27467af9a071eef5a48", "sha256:d7be064bdd690ac42f9e18fbcb32b8fb42eac32f588256a983393ede9f8b79ca"],
    ["image_archive", `evo-lead-agent-${P8D4G.candidateCommit}-linux-amd64.tar`, "32b2937ef5bd2e23ae5c5b405242bade6e9af237165649f737d97a935c709063", "sha256:9194b569df458a7a80792ca3f4aebfa417204961f229585178aa91c710d45c01"],
  ];
  if (!Array.isArray(record.artifacts) || record.artifacts.length !== 4 || record.artifacts.some((item, index) => {
    exactKeys(item, ["kind", "filename", "sha256", "image_id"], `staged artifact ${index}`);
    return item.kind !== expectedArtifacts[index][0] || item.filename !== expectedArtifacts[index][1] || item.sha256 !== expectedArtifacts[index][2] || item.image_id !== expectedArtifacts[index][3];
  })) fail("staged artifact evidence drifted", "staging_failed");
  const rollbackOrder = [["image", "crm"], ["image", "inbox"], ["image", "lead_agent"], ["env", "crm"], ["env", "inbox"], ["env", "lead_agent"], ["compose", "crm"], ["compose", "inbox"], ["compose", "lead_agent"]];
  if (!Array.isArray(record.rollback_files) || record.rollback_files.length !== 9 || record.rollback_files.some((item, index) => item.kind !== rollbackOrder[index][0] || item.name !== rollbackOrder[index][1] || !/^[0-9a-f]{64}$/.test(item.sha256) || (item.kind === "image" ? !/^sha256:[0-9a-f]{64}$/.test(item.image_id) : item.image_id !== null))) fail("rollback evidence drifted", "staging_failed");
}

function validateConfiguration(record) {
  exactKeys(record, ["status", "files_verified", "disabled_state_verified", "waha_unchanged"], "configuration");
  if (record.status !== "verified" || record.files_verified !== 3 || record.disabled_state_verified !== true || record.waha_unchanged !== true) fail("disabled configuration was not verified", "config_failed");
}

function validateMigrations(record) {
  exactKeys(record, ["status", "range", "count", "project_status"], "migrations");
  if (record.status !== "verified_noop" || record.range !== P8D4G.migrationRange || record.count !== 76 || record.project_status !== "ACTIVE_HEALTHY") fail("managed migration ledger drifted", "migration_drift");
}

function validateKnowledge(record) {
  exactKeys(record, ["account_resolution", "deterministic_builds", "audiences", "artifacts_created"], "knowledge");
  if (record.account_resolution !== "exactly_one_active" || record.deterministic_builds !== "verified" || record.artifacts_created !== true) fail("knowledge identity did not verify", "knowledge_failed");
  if (!Array.isArray(record.audiences) || record.audiences.length !== 2) fail("knowledge audiences are incomplete", "knowledge_failed");
  const expected = [["client", 11], ["internal", 291]];
  record.audiences.forEach((item, index) => {
    exactKeys(item, ["name", "status", "document_count", "chunk_count", "bundle_sha256", "manifest_sha256", "database_revision_sha256"], `knowledge audience ${index}`);
    if (item.name !== expected[index][0] || item.status !== "verified" || item.document_count !== expected[index][1] || !Number.isInteger(item.chunk_count) || item.chunk_count < 1) fail("knowledge audience result is invalid", "knowledge_failed");
    for (const field of ["bundle_sha256", "manifest_sha256", "database_revision_sha256"]) if (!/^[0-9a-f]{64}$/.test(item[field])) fail(`knowledge ${field} is invalid`, "knowledge_failed");
  });
}

function validateDeployment(record, expectedName) {
  exactKeys(record, ["name", "status", "image_id", "healthy", "restart_count", "disabled_state"], `deployment ${expectedName}`);
  if (record.name !== expectedName || record.status !== "verified" || record.healthy !== true || record.restart_count !== 0 || record.disabled_state !== true) fail(`${expectedName} deployment did not verify`, "deployment_failed");
}

function validatePilot(record, expectedCase) {
  exactKeys(record, ["case_id", "audience", "status", "http_status", "expected_source_match", "cross_audience_sources", "audit_body_free", "side_effect_free"], `pilot ${expectedCase}`);
  if (record.case_id !== expectedCase || record.status !== "verified" || record.http_status !== 200 || record.expected_source_match !== true || record.cross_audience_sources !== 0 || record.audit_body_free !== true || record.side_effect_free !== true) fail(`${expectedCase} pilot did not verify`, "pilot_failed");
}

export function validateP8D4GResult(result) {
  assertSafeValue(result);
  if (!RESULT_CODES.has(result.result_code)) fail("result code is invalid");
  const valid = validateSchema(result);
  if (!valid) fail(`result schema failed: ${JSON.stringify(validateSchema.errors)}`);
  if (result.result_code === "pilot_verified" && result.cleanup.status !== "verified") fail("success requires verified UUID artifact cleanup");
  if (result.result_code === "rollback_failed" && result.rollback.status !== "failed") fail("rollback_failed requires failed rollback");
  return true;
}

export function writeP8D4GResult(outputPath, result) {
  validateP8D4GResult(result);
  const absolute = resolve(outputPath);
  const temporary = `${absolute}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, absolute);
}

function phaseCode(phase) {
  return ({ preflight: "preflight_blocked", staging: "staging_failed", configuration: "config_failed", migrations: "migration_drift", knowledge: "knowledge_failed", deployment: "deployment_failed", pilot: "pilot_failed" })[phase] ?? "operation_failed";
}

export async function runP8D4G({ mode, confirmation, outputPath, operations, now = () => new Date() }) {
  if (!operations || typeof operations !== "object") fail("operations adapter is required");
  if (!outputPath) fail("output path is required");
  const result = createP8D4GResult(now());
  let phase = "preflight";
  let knowledgeStarted = false;
  let knowledgeCleaned = false;
  const attemptedDeployments = [];
  let primaryError = null;

  const deadlineContext = () => ({ deadlineAt: result.window.deadline_at });
  const requireActiveWindow = () => {
    if (!result.window.deadline_at || now().getTime() > Date.parse(result.window.deadline_at)) {
      result.window.status = "expired";
      fail("production authorization window expired", "operation_failed");
    }
  };
  const cleanupKnowledge = async () => {
    const cleanup = await operations.cleanupKnowledge(deadlineContext());
    exactKeys(cleanup, ["status", "local_roots_removed", "remote_pairs_removed", "container_pairs_removed", "importer_removed"], "cleanup");
    result.cleanup = cleanup;
    if (cleanup.status !== "verified") fail("knowledge cleanup did not verify", "cleanup_failed");
    knowledgeCleaned = true;
  };

  try {
    const preflight = await operations.preflight();
    validatePreflight(preflight);
    result.proof.execution_control = preflight.execution_control;
    result.proof.preflight_containers = preflight.containers;
    result.proof.migrations = { status: "before_verified", before_range: preflight.migration_range, before_count: preflight.migration_count, after_range: null, after_count: null, applied_count: null, project_status: "ACTIVE_HEALTHY" };
    result.phases.preflight = "verified";
    if (mode === "preflight") {
      result.result_code = "preflight_verified";
      return result;
    }
    if (mode !== "execute" || confirmation !== P8D4G.confirmation) fail("exact execution confirmation is required", "preflight_blocked");
    const started = now();
    result.window = { status: "within_limit", started_at: started.toISOString(), deadline_at: new Date(started.getTime() + P8D4G.windowMs).toISOString() };

    phase = "staging";
    requireActiveWindow();
    const staging = await operations.stage(deadlineContext());
    validateStage(staging);
    result.proof.transferred_artifacts = staging.artifacts;
    result.proof.rollback_files = staging.rollback_files;
    result.phases.staging = "verified";

    phase = "configuration";
    requireActiveWindow();
    validateConfiguration(await operations.configureDisabled(deadlineContext()));
    result.phases.configuration = "verified";

    phase = "migrations";
    requireActiveWindow();
    const migrations = await operations.verifyMigrations(deadlineContext());
    validateMigrations(migrations);
    result.proof.migrations = { status: "verified_noop", before_range: preflight.migration_range, before_count: preflight.migration_count, after_range: migrations.range, after_count: migrations.count, applied_count: 0, project_status: migrations.project_status };
    result.phases.migrations = "verified_noop";

    phase = "knowledge";
    knowledgeStarted = true;
    requireActiveWindow();
    const knowledge = await operations.publishKnowledge(deadlineContext());
    validateKnowledge(knowledge);
    result.knowledge = { account_resolution: knowledge.account_resolution, deterministic_builds: knowledge.deterministic_builds, audiences: knowledge.audiences };
    result.phases.knowledge = "verified";

    // UUID-bearing bundles and manifests must be gone before the first app
    // boundary is recreated. The finally path below remains the fail-safe for
    // every earlier knowledge failure.
    await cleanupKnowledge();

    phase = "deployment";
    for (let index = 0; index < P8D4G.deployments.length; index += 1) {
      const name = P8D4G.deployments[index];
      requireActiveWindow();
      attemptedDeployments.push(name);
      const record = await operations.deploy(name, deadlineContext());
      validateDeployment(record, name);
      result.deployments[index] = record;
    }
    result.phases.deployment = "verified";

    phase = "pilot";
    for (let index = 0; index < P8D4G.pilots.length; index += 1) {
      const caseId = P8D4G.pilots[index];
      requireActiveWindow();
      const record = await operations.pilot(caseId, deadlineContext());
      validatePilot(record, caseId);
      result.pilots[index] = record;
    }
    result.phases.pilot = "verified";
    result.result_code = "pilot_verified";
  } catch (error) {
    primaryError = error;
    result.result_code = RESULT_CODES.has(error?.code) ? error.code : phaseCode(phase);
    if (result.phases[phase] !== undefined) result.phases[phase] = "failed";
    if (attemptedDeployments.length > 0) {
      try {
        const expectedRollback = [...attemptedDeployments].reverse();
        const rolledBack = await operations.rollback(expectedRollback, deadlineContext());
        exactKeys(rolledBack, ["status", "boundaries"], "rollback");
        if (rolledBack.status !== "verified" || rolledBack.boundaries.join("\0") !== expectedRollback.join("\0")) fail("rollback proof did not match attempted boundaries", "rollback_failed");
        result.rollback = rolledBack;
        for (const name of attemptedDeployments) result.deployments[P8D4G.deployments.indexOf(name)].status = "rolled_back";
        result.phases.deployment = "rolled_back";
      } catch (rollbackError) {
        result.rollback = { status: "failed", boundaries: [...attemptedDeployments].reverse() };
        result.result_code = "rollback_failed";
        primaryError = rollbackError;
      }
    }
  } finally {
    if (knowledgeStarted && !knowledgeCleaned) {
      try {
        await cleanupKnowledge();
      } catch (cleanupError) {
        if (result.cleanup.status !== "failed") result.cleanup = { status: "failed", local_roots_removed: 0, remote_pairs_removed: 0, container_pairs_removed: 0, importer_removed: false };
        result.result_code = "cleanup_failed";
        primaryError = cleanupError;
      }
    }
    if (result.window.started_at && now().getTime() > Date.parse(result.window.deadline_at)) result.window.status = "expired";
    result.observed_at = now().toISOString();
    writeP8D4GResult(outputPath, result);
    if (mode === "execute" && result.phases.staging !== "not_run" && typeof operations.publishEvidence === "function") {
      try {
        await operations.publishEvidence(outputPath, deadlineContext());
      } catch (evidenceError) {
        result.result_code = "operation_failed";
        primaryError = evidenceError;
        result.observed_at = now().toISOString();
        writeP8D4GResult(outputPath, result);
      }
    }
  }

  if (primaryError) {
    const error = new Error(`P8D4G stopped with ${result.result_code}`);
    error.code = result.result_code;
    error.cause = primaryError;
    throw error;
  }
  return result;
}

function parseArgs(argv) {
  const parsed = { mode: null, confirmation: null };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) fail(`missing value for ${key}`);
    if (key === "--mode") parsed.mode = value;
    else if (key === "--confirmation") parsed.confirmation = value;
    else fail(`unknown argument ${key}`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = resolve(P8D4G.productionEvidenceRoot, args.mode === "preflight" ? "preflight-result.json" : "result.json");
  if (existsSync(outputPath)) fail("closed production evidence output already exists");
  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(outputPath), 0o700);
  const { createP8D4GOperations } = await import("./p8d4g-production-operations.mjs");
  const operations = await createP8D4GOperations();
  await runP8D4G({ ...args, outputPath, operations });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { process.stderr.write(`P8D4G stopped: ${error.code ?? "operation_failed"}\n`); process.exitCode = 1; });
