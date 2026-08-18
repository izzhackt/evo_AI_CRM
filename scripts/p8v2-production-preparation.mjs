#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STEP_NAMES = Object.freeze([
  "candidate_images",
  "production_baseline",
  "migration_ledger",
  "rollback_capture",
  "identity_resolution",
  "knowledge_builds",
  "configuration",
  "evidence_publication",
]);
const RESULT_CODES = new Set(["preparation_verified", "preparation_blocked", "evidence_failed"]);
const BLOCKER_CODES = new Set([
  "candidate_build_failed",
  "production_baseline_drift",
  "migration_ledger_drift",
  "rollback_capture_failed",
  "identity_resolution_failed",
  "knowledge_build_failed",
  "required_configuration_missing",
  "evidence_publication_failed",
  "privacy_validation_failed",
]);
const CONFIG_BLOCKERS = new Set([
  "root_crm_settings_missing",
  "root_crm_settings_invalid",
  "root_crm_identity_mismatch",
  "lead_agent_amocrm_credentials_missing",
  "lead_agent_settings_invalid",
  "manual_worker_secret_missing",
  "manual_worker_file_drift",
  "supabase_project_mismatch",
]);

const APPLICATION_COMMIT = "0f1454d014bbc9eca9d7381dfe557e980965543e";
const APPLICATION_TREE = "19599bcf043dc4a555c8996c21e7801934b64633";
const SOURCE = "https://github.com/izzhackt/evo_AI_CRM";

const IMAGES = Object.freeze([
  Object.freeze({
    name: "main_crm",
    prefix: "evo-crm",
    tag: `evo-crm:${APPLICATION_COMMIT}-p8v2d-linux-amd64`,
    archive: `evo-crm-${APPLICATION_COMMIT}-p8v2d-linux-amd64.tar`,
    rollbackReference: "evo-crm:564332b420a1fb1bd6232dda945d044bb922d3f0",
    rollbackImageId: "sha256:d4626208423df2c0df24262763917b82b1157b53a115b44f02478ecf7245f580",
    rollbackArchive: "rollback-evo-crm-d4626208423d-linux-amd64.tar",
  }),
  Object.freeze({
    name: "evo_inbox",
    prefix: "evo-inbox",
    tag: `evo-inbox:${APPLICATION_COMMIT}-p8v2d-linux-amd64`,
    archive: `evo-inbox-${APPLICATION_COMMIT}-p8v2d-linux-amd64.tar`,
    rollbackReference: "evo-inbox:a09a72fc55d869c861df520f76d62413a2315fc1",
    rollbackImageId: "sha256:6d5e0a9d5ea073737bdd8c2c5621818ca7bdb76dd5b16ca5e44563d39833cb6b",
    rollbackArchive: "rollback-evo-inbox-6d5e0a9d5ea0-linux-amd64.tar",
  }),
  Object.freeze({
    name: "lead_agent",
    prefix: "evo-lead-agent",
    tag: `evo-lead-agent:${APPLICATION_COMMIT}-p8v2d-linux-amd64`,
    archive: `evo-lead-agent-${APPLICATION_COMMIT}-p8v2d-linux-amd64.tar`,
    rollbackReference: "evo-lead-agent:rollback-2026-08-15.p8d.1",
    rollbackImageId: "sha256:3678747c1ea1c9b5655bb830296c9e4d4aedf60d3d193b438633b68eb3f97cc7",
    rollbackArchive: "rollback-evo-lead-agent-3678747c1ea1-linux-amd64.tar",
  }),
]);

const PRODUCTION_CONTAINERS = Object.freeze([
  Object.freeze({ name: "evo-crm-app-1", containerId: "7b3b6d026c84055045a0e31d520d2946dbf2dc181d5829c6ea1088d872366c46", imageId: IMAGES[0].rollbackImageId }),
  Object.freeze({ name: "evo-crm-waha-1", containerId: "0d1017e3304dfb3e1dce37ca00a2826b019429266763e211ed399b938baaa750", imageId: "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c" }),
  Object.freeze({ name: "evo-crm-lead-agent-1", containerId: "7e8539399eb69cee8b109c5b0580bf06dd77ff4648c9b0e622edd09af9743e88", imageId: IMAGES[2].rollbackImageId }),
  Object.freeze({ name: "evo-inbox-app-1", containerId: "c78a94b69114e24dba918db7bab574b20f85b83dd5756a3016b2c9652cfd2592", imageId: IMAGES[1].rollbackImageId }),
  Object.freeze({ name: "evo-inbox-waha", containerId: "048c820d3f607772ce6b4720832a53ce10e979c80af00ee53bbcaed628a8c7e9", imageId: "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c" }),
]);

const ROLLBACK_FILES = Object.freeze([
  ["crm-current-docker-compose.prod.yml", 644],
  ["crm-env.production", 600],
  ["crm-env.lead-agent", 600],
  ["crm-env.waha", 600],
  ["inbox-current-docker-compose.prod.yml", 644],
  ["inbox-env.production", 600],
  ["inbox-env.waha", 600],
  ["crm-app-compose.prod.yml", 644],
  ["crm-waha-compose.prod.yml", 644],
  ["lead-agent-compose.prod.yml", 600],
  ["inbox-app-compose.prod.yml", 644],
  ["inbox-waha-compose.prod.yml", 644],
].map(([name, sourceMode]) => Object.freeze({ name, sourceMode })));

const FINAL_ARTIFACTS = Object.freeze([
  ...IMAGES.map((item) => item.archive),
  "knowledge-build-result.json",
  "portable-image-identity.json",
  "rollback-capture.json",
].sort());
const FINAL_FILES = Object.freeze([
  ...FINAL_ARTIFACTS,
  "collection-index.json",
  "v2-preparation-result.json",
].sort());

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message, code = "invalid_evidence") {
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

function sameOrder(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((item, index) => item?.name === expected[index]);
}

function validUtc(value) {
  return typeof value === "string" && UTC.test(value) && !Number.isNaN(Date.parse(value));
}

function safeEvidence(value) {
  const raw = JSON.stringify(value);
  if (
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(raw) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(raw) ||
    /\/(?:Users|private|var\/folders|opt\/evo-(?:crm|inbox))\//.test(raw) ||
    /(?:cookie|authorization|password|secret|api[_-]?key|refresh[_-]?token)\s*[=:]\s*[^,}\s]+/i.test(raw)
  ) fail("safe evidence contains private data", "privacy_validation_failed");
}

function validateSource(source) {
  exactKeys(source, ["application_commit", "application_tree", "application_ci_run_id", "execution_commit", "execution_tree", "execution_ci_run_id"], "source");
  if (
    source.application_commit !== APPLICATION_COMMIT ||
    source.application_tree !== APPLICATION_TREE ||
    source.application_ci_run_id !== 32093566626 ||
    !SHA40.test(source.execution_commit) ||
    !SHA40.test(source.execution_tree) ||
    !Number.isSafeInteger(source.execution_ci_run_id) ||
    source.execution_ci_run_id < 1
  ) fail("source identity drifted");
}

function validateImages(images, required) {
  if (!required && images.length === 0) return;
  if (!sameOrder(images, IMAGES.map((item) => item.name))) fail("candidate image order drifted");
  for (const [index, image] of images.entries()) {
    exactKeys(image, ["name", "tag", "archive", "image_id", "oci_index_digest", "platform_manifest_digest", "archive_sha256", "sbom_sha256", "smoke_sha256", "source_commit", "platform"], `image ${index}`);
    exactKeys(image.platform, ["os", "architecture", "variant"], `image ${index} platform`);
    const spec = IMAGES[index];
    if (
      image.tag !== spec.tag ||
      image.archive !== spec.archive ||
      image.source_commit !== APPLICATION_COMMIT ||
      image.platform.os !== "linux" || image.platform.architecture !== "amd64" || image.platform.variant !== "" ||
      !IMAGE_ID.test(image.image_id) || !IMAGE_ID.test(image.oci_index_digest) || !IMAGE_ID.test(image.platform_manifest_digest) ||
      image.oci_index_digest !== image.image_id ||
      !SHA64.test(image.archive_sha256) || !SHA64.test(image.sbom_sha256) || !SHA64.test(image.smoke_sha256)
    ) fail("candidate image identity drifted");
  }
}

function validateContainers(records, required) {
  if (!required && records.length === 0) return;
  if (!sameOrder(records, PRODUCTION_CONTAINERS.map((item) => item.name))) fail("production container order drifted");
  for (const [index, record] of records.entries()) {
    exactKeys(record, ["name", "container_id", "image_id", "health", "restart_count"], `container ${index}`);
    const expected = PRODUCTION_CONTAINERS[index];
    if (record.container_id !== expected.containerId || record.image_id !== expected.imageId || record.health !== "healthy" || record.restart_count !== 0) fail("production container drifted");
  }
}

function validateMigration(value, required) {
  exactKeys(value, ["status", "repository_range", "repository_count", "production_range", "production_count", "pending_versions", "project_status"], "migration");
  if (!required && value.status === "not_run") {
    if ([value.repository_range, value.repository_count, value.production_range, value.production_count, value.project_status].some((item) => item !== null) || value.pending_versions.length !== 0) fail("not-run migration has evidence");
    return;
  }
  if (value.status !== "verified" || value.repository_range !== "001-077" || value.repository_count !== 77 || value.production_range !== "001-076" || value.production_count !== 76 || JSON.stringify(value.pending_versions) !== '["077"]' || value.project_status !== "ACTIVE_HEALTHY") fail("migration ledger drifted");
}

function validateRollback(value, required) {
  exactKeys(value, ["status", "manual_worker_pre_state", "files", "images", "renders"], "rollback");
  if (!required && value.status === "not_run") {
    if (value.manual_worker_pre_state !== null || value.files.length || value.images.length || value.renders.length) fail("not-run rollback has evidence");
    return;
  }
  if (value.status !== "verified" || value.manual_worker_pre_state !== "absent" || !sameOrder(value.files, ROLLBACK_FILES.map((item) => item.name)) || !sameOrder(value.images, IMAGES.map((item) => item.name)) || !sameOrder(value.renders, IMAGES.map((item) => item.name))) fail("rollback capture drifted");
  for (const [index, record] of value.files.entries()) {
    exactKeys(record, ["name", "source_mode", "retained_mode", "size", "sha256"], `rollback file ${index}`);
    if (record.source_mode !== ROLLBACK_FILES[index].sourceMode || record.retained_mode !== 600 || !Number.isSafeInteger(record.size) || record.size < 1 || !SHA64.test(record.sha256)) fail("rollback file identity drifted");
  }
  for (const [index, record] of value.images.entries()) {
    exactKeys(record, ["name", "reference", "image_id", "archive", "size", "sha256"], `rollback image ${index}`);
    const expected = IMAGES[index];
    if (record.reference !== expected.rollbackReference || record.image_id !== expected.rollbackImageId || record.archive !== expected.rollbackArchive || !Number.isSafeInteger(record.size) || record.size < 1 || !SHA64.test(record.sha256)) fail("rollback image identity drifted");
  }
  for (const record of value.renders) {
    exactKeys(record, ["name", "status"], "rollback render");
    if (record.status !== "verified") fail("rollback render failed");
  }
}

function validateIdentity(value, required) {
  exactKeys(value, ["status", "account", "organization", "supabase_project"], "identity resolution");
  if (!required && value.status === "not_run") {
    if (value.account !== "not_run" || value.organization !== "not_run" || value.supabase_project !== "not_run") fail("not-run identity has evidence");
    return;
  }
  if (value.status !== "verified" || value.account !== "exactly_one_active" || value.organization !== "exactly_one_active" || value.supabase_project !== "exact_production") fail("identity resolution drifted");
}

function validateKnowledge(value, required) {
  exactKeys(value, ["status", "cleanup_status", "audiences"], "knowledge");
  if (!required && value.status === "not_run") {
    if (value.cleanup_status !== "not_required" || value.audiences.length !== 0) fail("not-run knowledge has evidence");
    return;
  }
  if (value.status !== "verified" || value.cleanup_status !== "verified" || !sameOrder(value.audiences, ["client", "internal"])) fail("knowledge build drifted");
  const counts = [11, 291];
  for (const [index, record] of value.audiences.entries()) {
    exactKeys(record, ["name", "status", "document_count", "bundle_sha256", "manifest_sha256", "vault_unchanged", "pii_gate", "forbidden_root_gate"], `knowledge audience ${index}`);
    if (record.status !== "verified" || record.document_count !== counts[index] || !SHA64.test(record.bundle_sha256) || !SHA64.test(record.manifest_sha256) || record.vault_unchanged !== true || record.pii_gate !== "passed" || record.forbidden_root_gate !== "passed") fail("knowledge audience drifted");
  }
}

function validateConfiguration(value, status) {
  exactKeys(value, ["status", "root_crm", "lead_agent", "manual_worker", "configured_account_match", "configured_organization_match", "supabase_project_match", "blockers"], "configuration");
  if (status === "not_run") {
    if (value.status !== "not_run" || [value.root_crm, value.lead_agent, value.manual_worker].some((item) => item !== "not_run") || [value.configured_account_match, value.configured_organization_match, value.supabase_project_match].some((item) => item !== null) || value.blockers.length) fail("not-run configuration has evidence");
    return;
  }
  if (status === "verified") {
    if (value.status !== "verified" || [value.root_crm, value.lead_agent, value.manual_worker].some((item) => item !== "verified") || [value.configured_account_match, value.configured_organization_match, value.supabase_project_match].some((item) => item !== true) || value.blockers.length) fail("verified configuration drifted");
    return;
  }
  if (value.status !== "blocked" || !value.blockers.length || value.blockers.some((item) => !CONFIG_BLOCKERS.has(item)) || [value.root_crm, value.lead_agent, value.manual_worker].some((item) => !["verified", "blocked"].includes(item)) || [value.configured_account_match, value.configured_organization_match, value.supabase_project_match].some((item) => ![true, false].includes(item))) fail("blocked configuration drifted");
}

function validateProgress(value) {
  if (!sameOrder(value.steps, STEP_NAMES)) fail("step order drifted");
  let blockedIndex = -1;
  for (const [index, step] of value.steps.entries()) {
    exactKeys(step, ["name", "status"], `step ${index}`);
    if (!["verified", "blocked", "failed", "not_run"].includes(step.status)) fail("step status drifted");
    if (["blocked", "failed"].includes(step.status)) {
      if (blockedIndex !== -1) fail("multiple blocking steps");
      blockedIndex = index;
    }
  }
  if (value.result_code === "preparation_verified") {
    if (value.blocker !== null || value.steps.some((step) => step.status !== "verified")) fail("false preparation success");
    return { terminalIndex: STEP_NAMES.length, terminalStatus: "verified" };
  }
  exactKeys(value.blocker, ["step", "code"], "blocker");
  if (!STEP_NAMES.includes(value.blocker.step) || !BLOCKER_CODES.has(value.blocker.code)) fail("unknown blocker");
  const expectedIndex = STEP_NAMES.indexOf(value.blocker.step);
  if (blockedIndex !== expectedIndex) fail("blocker does not match step");
  const expectedStatus = value.result_code === "evidence_failed" ? "failed" : "blocked";
  if (value.steps[expectedIndex].status !== expectedStatus || value.steps.slice(0, expectedIndex).some((step) => step.status !== "verified") || value.steps.slice(expectedIndex + 1).some((step) => step.status !== "not_run")) fail("result is not a truthful prefix");
  return { terminalIndex: expectedIndex, terminalStatus: expectedStatus };
}

export const P8V2 = Object.freeze({
  version: "p8v-v1-preparation-result/v1",
  release: "2026-08-18.p8v2d.1",
  applicationCommit: APPLICATION_COMMIT,
  applicationTree: APPLICATION_TREE,
  applicationCiRun: 32093566626,
  applicationParent: "a7c589c2c735d4ef2d15ab5153eb07dba07d6286",
  source: SOURCE,
  projectRef: "iosckaqtovbbnssqcpde",
  authorization: "PREPARE-P8V2D-2026-08-18.P8V2D.1",
  images: IMAGES,
  productionContainers: PRODUCTION_CONTAINERS,
  rollbackFiles: ROLLBACK_FILES,
  finalArtifacts: FINAL_ARTIFACTS,
  finalFiles: FINAL_FILES,
  sha256File: async (path) => sha256(readFileSync(path)),
});

export function createEmptyP8V2Result({ generatedAt = new Date().toISOString(), execution }) {
  if (!execution) fail("execution identity is required");
  return {
    version: P8V2.version,
    generated_at: generatedAt,
    result_code: "preparation_blocked",
    blocker: { step: "candidate_images", code: "candidate_build_failed" },
    source: {
      application_commit: APPLICATION_COMMIT,
      application_tree: APPLICATION_TREE,
      application_ci_run_id: P8V2.applicationCiRun,
      execution_commit: execution.commit,
      execution_tree: execution.tree,
      execution_ci_run_id: execution.ci_run_id,
    },
    steps: STEP_NAMES.map((name, index) => ({ name, status: index === 0 ? "blocked" : "not_run" })),
    images: [],
    production_containers: [],
    migration: { status: "not_run", repository_range: null, repository_count: null, production_range: null, production_count: null, pending_versions: [], project_status: null },
    rollback: { status: "not_run", manual_worker_pre_state: null, files: [], images: [], renders: [] },
    identity_resolution: { status: "not_run", account: "not_run", organization: "not_run", supabase_project: "not_run" },
    knowledge: { status: "not_run", cleanup_status: "not_required", audiences: [] },
    configuration: { status: "not_run", root_crm: "not_run", lead_agent: "not_run", manual_worker: "not_run", configured_account_match: null, configured_organization_match: null, supabase_project_match: null, blockers: [] },
    collection: { index_sha256: null },
  };
}

export function validateP8V2PreparationResult(value) {
  exactKeys(value, ["version", "generated_at", "result_code", "blocker", "source", "steps", "images", "production_containers", "migration", "rollback", "identity_resolution", "knowledge", "configuration", "collection"], "result");
  if (value.version !== P8V2.version || !RESULT_CODES.has(value.result_code) || !validUtc(value.generated_at)) fail("result header drifted");
  validateSource(value.source);
  const progress = validateProgress(value);
  const verified = (name) => value.steps[STEP_NAMES.indexOf(name)].status === "verified";
  validateImages(value.images, verified("candidate_images"));
  validateContainers(value.production_containers, verified("production_baseline"));
  validateMigration(value.migration, verified("migration_ledger"));
  validateRollback(value.rollback, verified("rollback_capture"));
  validateIdentity(value.identity_resolution, verified("identity_resolution"));
  validateKnowledge(value.knowledge, verified("knowledge_builds"));
  validateConfiguration(value.configuration, value.steps[STEP_NAMES.indexOf("configuration")].status);
  exactKeys(value.collection, ["index_sha256"], "collection");
  if (value.result_code === "preparation_verified") {
    if (!SHA64.test(value.collection.index_sha256)) fail("verified result lacks collection hash");
  } else if (value.collection.index_sha256 !== null) fail("blocked result cannot bind a success collection");
  if (progress.terminalIndex < STEP_NAMES.indexOf("candidate_images") && value.images.length) fail("later image evidence exists");
  safeEvidence(value);
  return value;
}

function normalizeBlocker(error, step) {
  const code = BLOCKER_CODES.has(error?.code) ? error.code : ({
    candidate_images: "candidate_build_failed",
    production_baseline: "production_baseline_drift",
    migration_ledger: "migration_ledger_drift",
    rollback_capture: "rollback_capture_failed",
    identity_resolution: "identity_resolution_failed",
    knowledge_builds: "knowledge_build_failed",
    configuration: "required_configuration_missing",
    evidence_publication: "evidence_publication_failed",
  })[step];
  return { step, code };
}

function setTerminal(result, step, error) {
  const index = STEP_NAMES.indexOf(step);
  const evidenceFailure = error?.code === "evidence_publication_failed" || error?.code === "privacy_validation_failed";
  result.steps.forEach((record, recordIndex) => {
    record.status = recordIndex < index ? "verified" : recordIndex === index ? (evidenceFailure ? "failed" : "blocked") : "not_run";
  });
  result.result_code = evidenceFailure ? "evidence_failed" : "preparation_blocked";
  result.blocker = normalizeBlocker(error, step);
  if (step === "configuration" && error?.safeDetails) result.configuration = structuredClone(error.safeDetails);
}

export async function runP8V2Preparation({ operations, generatedAt = new Date().toISOString() }) {
  const execution = await operations.verifyExecution();
  const result = createEmptyP8V2Result({ generatedAt, execution });
  const steps = [
    ["candidate_images", "images", "buildImages"],
    ["production_baseline", "production_containers", "observeProduction"],
    ["migration_ledger", "migration", "verifyMigrations"],
    ["rollback_capture", "rollback", "captureRollback"],
    ["identity_resolution", "identity_resolution", "resolveIdentities"],
    ["knowledge_builds", "knowledge", "buildKnowledge"],
    ["configuration", "configuration", "verifyConfiguration"],
  ];
  let blocked = false;
  for (const [step, field, method] of steps) {
    try {
      result[field] = await operations[method]();
      result.steps[STEP_NAMES.indexOf(step)].status = "verified";
    } catch (error) {
      setTerminal(result, step, error);
      blocked = true;
      break;
    }
  }
  if (!blocked) {
    try {
      result.collection.index_sha256 = await operations.finalizeArtifacts(result);
      result.steps[STEP_NAMES.indexOf("evidence_publication")].status = "verified";
      result.result_code = "preparation_verified";
      result.blocker = null;
    } catch (error) {
      setTerminal(result, "evidence_publication", error);
    }
  }
  validateP8V2PreparationResult(result);
  try {
    return await operations.writeResult(result);
  } catch (error) {
    result.collection.index_sha256 = null;
    setTerminal(result, "evidence_publication", Object.assign(error instanceof Error ? error : new Error("evidence publication failed"), { code: "evidence_publication_failed" }));
    validateP8V2PreparationResult(result);
    if (typeof operations.recoverEvidenceFailure !== "function") throw error;
    return operations.recoverEvidenceFailure(result);
  }
}

function assertRegular0600(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) fail(`unsafe retained file: ${basename(path)}`);
}

function contained(root, path) {
  const rootReal = realpathSync(root);
  const pathReal = realpathSync(path);
  if (pathReal !== rootReal && !pathReal.startsWith(`${rootReal}${sep}`)) fail("evidence path escaped root");
}

export async function verifyP8V2FinalRoot(root) {
  const metadata = lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) fail("unsafe evidence root");
  const actual = readdirSync(root).sort();
  if (actual.join("\0") !== FINAL_FILES.join("\0")) fail("unexpected final evidence files");
  for (const file of actual) {
    const path = join(root, file);
    contained(root, path);
    assertRegular0600(path);
  }
  const indexPath = join(root, "collection-index.json");
  const resultPath = join(root, "v2-preparation-result.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  exactKeys(index, ["version", "files"], "collection index");
  if (index.version !== 1 || !Array.isArray(index.files) || index.files.length !== FINAL_ARTIFACTS.length || index.files.some((record, recordIndex) => record?.file !== FINAL_ARTIFACTS[recordIndex])) fail("collection index order drifted");
  for (const record of index.files) {
    exactKeys(record, ["file", "mode", "size", "sha256"], "collection record");
    const bytes = readFileSync(join(root, record.file));
    if (record.mode !== 600 || record.size !== bytes.length || record.sha256 !== sha256(bytes)) fail("collection artifact drifted");
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (result.collection?.index_sha256 !== sha256(readFileSync(indexPath))) fail("result/index hash mismatch");
  validateP8V2PreparationResult(result);
  const portable = JSON.parse(readFileSync(join(root, "portable-image-identity.json"), "utf8"));
  exactKeys(portable, ["version", "source_commit", "source_tree", "images"], "portable identity");
  if (portable.version !== "p8v2d-portable-image-identity.v1" || portable.source_commit !== APPLICATION_COMMIT || portable.source_tree !== APPLICATION_TREE || JSON.stringify(portable.images) !== JSON.stringify(result.images)) fail("portable/result image identity mismatch");
  const knowledge = JSON.parse(readFileSync(join(root, "knowledge-build-result.json"), "utf8"));
  if (JSON.stringify(knowledge) !== JSON.stringify(result.knowledge)) fail("knowledge/result identity mismatch");
  const rollback = JSON.parse(readFileSync(join(root, "rollback-capture.json"), "utf8"));
  if (JSON.stringify(rollback) !== JSON.stringify(result.rollback)) fail("rollback/result identity mismatch");
  for (const file of ["knowledge-build-result.json", "portable-image-identity.json", "rollback-capture.json", "collection-index.json", "v2-preparation-result.json"]) {
    safeEvidence(JSON.parse(readFileSync(join(root, file), "utf8")));
  }
  return result;
}

export function writeP8V2Result(outputPath, result) {
  validateP8V2PreparationResult(result);
  const parent = dirname(resolve(outputPath));
  const parentMetadata = lstatSync(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) fail("unsafe result parent");
  if (existsSync(outputPath)) fail("result destination collision");
  const temporary = `${outputPath}.tmp`;
  if (existsSync(temporary)) fail("result temporary collision");
  try {
    writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, outputPath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  assertRegular0600(outputPath);
  return result;
}
