import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ProcessSupervisor,
  RecoveryInterruptionGuard,
  RecoveryFailure,
  assessRepresentativeCohort,
  apiRequest,
  browserRequestAllowed,
  buildRestoredRoleOutcomeReadiness,
  canonicalRecoveryPdfBytes,
  buildDurableEvidence,
  buildIsolationEvidence,
  canonicalJson,
  classifyExpectedDatabaseDenial,
  cleanupDisposition,
  cleanupContainerPolicy,
  cleanupState,
  databaseAggregatesFromTableCounts,
  extractExactMigrationLedger,
  evidenceDestination,
  gitBlobOid,
  installBrowserWebSocketBlocker,
  latchInterruption,
  migrationStatementsDigest,
  parseHarnessOptions,
  privateBackupDirectory,
  parseTargetTreeListing,
  orderedTargetEntries,
  orbStackEnvironment,
  runBrowserOperation,
  resolveSupabaseExecutableChain,
  sanitizePsqlDiagnostic,
  sanitizeCommandDiagnostic,
  storageSourceRecoveryReadiness,
  suppliedRepresentativeUserIds,
  selectAdmissionsTaskMutation,
  selectOwnedContainerIds,
  selectCandidateImageIds,
  selectOwnedImageIds,
  selectOwnedNetworkNames,
  selectOwnedVolumeNames,
  uploadStorageObjectFromFile,
  validateEvidenceRuntimeSeparation,
  validateBrowserRouteProof,
  validateBrowserNetworkProof,
  validateCandidateNetworkAttachment,
  validateContainerCensusIds,
  validateDatabaseManifest,
  validateBuiltImageInspection,
  validateLocalSupabaseNetwork,
  validatePgmqRestoreInventory,
  validateRepresentativeCohort,
  validateRepositoryBindings,
  validateRestoredDatabaseAggregates,
  validateRestoredTableCounts,
  validateRestrictedSqlFile,
  validateRestrictedSqlEnvelope,
  validateSignedReceipt,
  validateStorageManifest,
  validateWriteBoundaryResults,
  verifyLedgerAgainstRoot,
  verifyMigrationTreePrefix,
  verifyReceiptSignature,
  verifyRestoredStorageInventory,
  writeEvidence,
} from "../scripts/test-v3-managed-supabase-recovery-orbstack.mjs";

const script = new URL("../scripts/test-v3-managed-supabase-recovery-orbstack.mjs", import.meta.url);
const source = readFileSync(script, "utf8");
const sourceCommit = "1".repeat(40);
const sourceMigrationTree = "2".repeat(40);
const targetCommit = "3".repeat(40);
const targetMigrationTree = "4".repeat(40);
const sourceMainEquivalentCommit = "5".repeat(40);
const sourceFullTree = "6".repeat(40);
const targetFullTree = "7".repeat(40);
const commit = sourceCommit;
const migrationTree = sourceMigrationTree;

test("runtime preflight pins Node 22 and provisions private OrbStack buildx state", () => {
  assert.match(source, /const REQUIRED_NODE_VERSION = "22\.23\.1"/u);
  assert.match(source, /process\.versions\.node !== REQUIRED_NODE_VERSION/u);
  assert.match(source, /function activatePrivateChildEnvironment/u);
  assert.match(source, /DOCKER_CONFIG:\s*dockerConfig/u);
  assert.match(source, /dockerConfig, "cli-plugins"/u);
  assert.match(source, /"docker-buildx"/u);
  assert.match(source, /private_docker_buildx_unavailable/u);
});

test("candidate image uses a production-valid local Supabase TLS origin", () => {
  assert.match(source, /const RECOVERY_SUPABASE_HOSTNAME = "evov3recoverylocal00\.supabase\.co"/u);
  assert.match(source, /function createRecoveryTlsMaterial/u);
  assert.match(source, /subjectAltName = DNS:\$\{RECOVERY_SUPABASE_HOSTNAME\}/u);
  assert.match(source, /NEXT_PUBLIC_SUPABASE_URL:\s*`https:\/\/\$\{RECOVERY_SUPABASE_HOSTNAME\}`/u);
  assert.match(source, /NODE_EXTRA_CA_CERTS:\s*"\/run\/evo-recovery-ca\.pem"/u);
  assert.match(source, /"--network", `container:\$\{state\.appContainer\}`/u);
  assert.match(source, /recovery_app_tls_proxy_start_failed/u);
});

test("provider configuration evidence is local-only and authenticated readiness stays fail-closed", () => {
  const providerStart = source.indexOf("async function recordRecoveryProviderBoundary");
  const readinessStart = source.indexOf("async function proveFailClosedReadiness");
  const runStart = source.indexOf("async function executeMode");
  const providerCall = source.indexOf('runStage("provider_boundary"', runStart);
  const appCall = source.indexOf('runStage("candidate_start"', runStart);
  assert.ok(providerStart > 0 && readinessStart > providerStart);
  assert.ok(providerCall > runStart && appCall > providerCall);
  assert.match(source.slice(providerStart, readinessStart), /p_readiness:\s*"unconfigured"/u);
  assert.match(source.slice(providerStart, readinessStart), /p_evidence_kind:\s*"configuration_check"/u);
  assert.match(source.slice(readinessStart, runStart), /createHmac\("sha256"/u);
  assert.match(source.slice(readinessStart, runStart), /\[503\]/u);
  assert.match(source.slice(readinessStart, runStart), /waha_evidence_kind !== "configuration_check"/u);
  assert.match(source.slice(readinessStart, runStart), /ai_evidence_kind !== "configuration_check"/u);
});

test("Admin passes only after complete server and exact-role browser outcomes", () => {
  const missing = buildRestoredRoleOutcomeReadiness({ admin: { userId: "admin" } });
  assert.equal(missing.complete, false);
  assert.equal(missing.blocker, "restored_role_outcome_proof_incomplete");
  assert.equal(missing.outcomes.admin, "incomplete_mutation_replay_audit_document_suite");
  assert.equal(missing.outcomes.sales, "missing_restored_identity");
  const actors = { admin: {}, sales: {}, admissions: {} };
  const server = {
    outcomes: { admin: "passed", sales: "passed", admissions: "passed" },
    blockers: [],
  };
  const browserIncomplete = buildRestoredRoleOutcomeReadiness(actors, server, {
    roleOutcomes: { admin: "passed", sales: "passed", admissions: "not_run_incomplete_server_outcomes" },
  });
  assert.equal(browserIncomplete.complete, false);
  assert.equal(browserIncomplete.outcomes.admissions, "incomplete_exact_role_browser_readback");
  const complete = buildRestoredRoleOutcomeReadiness(actors, server, {
    roleOutcomes: { admin: "passed", sales: "passed", admissions: "passed" },
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.blocker, null);
  assert.deepEqual(complete.blockers, []);
  assert.deepEqual(complete.outcomes, { admin: "passed", sales: "passed", admissions: "passed" });
  const missingData = buildRestoredRoleOutcomeReadiness(actors, {
    outcomes: {
      admin: "incomplete_role_outcome_suite",
      sales: "missing_restored_sales_lead",
      admissions: "missing_restored_admissions_task",
    },
    blockers: ["restored_sales_lead_missing", "restored_admissions_task_missing"],
  });
  assert.deepEqual(missingData.blockers, [
    "restored_sales_lead_missing",
    "restored_admissions_task_missing",
    "restored_role_outcome_proof_incomplete",
  ]);
  assert.match(source, /restored_role_outcome_proof_incomplete/u);
});

test("private pinned ClamAV is exercised through the Company Files product route", () => {
  const scannerStart = source.indexOf("async function startRecoveryScanner");
  const dataPathStart = source.indexOf("async function proveScannerDataPath");
  const browserStart = source.indexOf("async function proveBrowser", dataPathStart);
  assert.ok(scannerStart > 0 && dataPathStart > scannerStart && browserStart > dataPathStart);
  const scannerSource = source.slice(scannerStart, dataPathStart);
  const dataPathSource = source.slice(dataPathStart, browserStart);
  assert.match(source, /clamav\/clamav@sha256:[0-9a-f]{64}/u);
  assert.match(scannerSource, /const networkHost = `evo-recovery-clamav-/u);
  assert.match(scannerSource, /"--network-alias", networkHost/u);
  assert.match(scannerSource, /publish:\s*"none"/u);
  assert.match(source, /\/api\/v3\/company-files\/\$\{encodeURIComponent\(fileId\)\}\/versions/u);
  assert.match(dataPathSource, /malware_scanner_clean_attestation_invalid/u);
  assert.match(dataPathSource, /malware_scanner_eicar_persisted_state/u);
  assert.match(dataPathSource, /malware_scanner_outage_persisted_state/u);
  assert.match(dataPathSource, /malware_scanner_recovered_persistence_invalid/u);
  assert.match(dataPathSource, /Buffer\.from\(EICAR, "ascii"\)/u);
});

test("restored role proof mutates existing records, replays, audits, and reads back in browser", () => {
  const roleStart = source.indexOf("async function proveRestoredRoleServerOutcomes");
  const storageStart = source.indexOf("export function canonicalRecoveryPdfBytes", roleStart);
  const roleSource = source.slice(roleStart, storageStart);
  assert.ok(roleStart > 0 && storageStart > roleStart);
  assert.match(roleSource, /staff_sales_lead_page/u);
  assert.match(roleSource, /mutate_sales_lead_workflow/u);
  assert.match(roleSource, /change_case_task/u);
  assert.match(roleSource, /staff_student_case_task_workspace/u);
  assert.match(roleSource, /staff_document_queue/u);
  assert.match(roleSource, /assertReplayResult/u);
  assert.match(roleSource, /assertRoleMutationAudit/u);
  assert.doesNotMatch(roleSource, /create_case_task/u);
  assert.match(source, /proveBrowserSalesReadback/u);
  assert.match(source, /proveBrowserAdmissionsReadback/u);
  assert.match(source, /proveBrowserDocumentDownload/u);
  assert.match(source, /restored_sales_lead_missing/u);
  assert.match(source, /restored_admissions_task_missing/u);
  assert.match(source, /restored_downloadable_document_missing/u);
  assert.match(source, /roleOutcomeProof: roleServerProof\.evidence/u);
  assert.doesNotMatch(source, /roleOutcomeEvidence:/u);
});
const projectRef = "iosckaqtovbbnssqcpde";
const supabaseOrganizationId = "provider-org";
const platformOrganizationId = "10000000-0000-4000-8000-000000000001";
const capturedAt = "2026-09-05T00:00:00.000Z";
const fingerprint = "SHA256:abcdefghijklmnopqrstuvwxyz0123456789+/AB";
const adminUserId = "20000000-0000-4000-8000-000000000001";
const salesUserId = "20000000-0000-4000-8000-000000000002";
const admissionsUserId = "20000000-0000-4000-8000-000000000003";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => error instanceof RecoveryFailure && error.code === code);
}

async function expectCodeAsync(operation, code) {
  await assert.rejects(operation, (error) => error instanceof RecoveryFailure && error.code === code);
}

function tools() {
  return {
    supabase_cli: "2.116.0",
    pg_dump: "18.6",
    pg_dumpall: "18.6",
    psql: "18.6",
    age: "v1.3.1",
    ssh: "available",
    orb: "Running",
    docker_context: "orbstack",
    database_ca_sha256: "7".repeat(64),
    database_ca_fingerprint: "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    managed_dump_inputs_sha256: {
      data: "8".repeat(64),
      database_ca: "7".repeat(64),
      roles: "9".repeat(64),
      schema: "a".repeat(64),
    },
  };
}

function sourceReceipt() {
  const project = {
    ref: projectRef,
    organization_id: supabaseOrganizationId,
    name: "evo-platform-prod",
    region: "ap-southeast-1",
    created_at: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE_HEALTHY",
    database: {
      host: `db.${projectRef}.supabase.co`,
      version: "17.6.1.155",
      postgres_engine: "17",
      release_channel: "ga",
    },
  };
  const backup = {
    id: "backup-123",
    inserted_at: "2026-09-04T22:54:35.725Z",
    is_physical_backup: true,
    status: "COMPLETED",
  };
  const pooler = {
    host: "aws-1-ap-southeast-1.pooler.supabase.com",
    user: `postgres.${projectRef}`,
    database: "postgres",
    session_port: 5432,
    source_mode: "transaction",
    source_port: 6543,
  };
  return { project, backup, pooler, sha256: hash(`${canonicalJson({ project, backup, pooler })}\n`) };
}

const sqlNames = ["roles.sql", "schema.sql", "history-schema.sql", "history-data.sql", "data.sql"];
const artifactDescriptors = Object.fromEntries(sqlNames.map((name, index) => [name, { bytes: 100 + index, sha256: String(index + 1).repeat(64) }]));
const semantic = Object.fromEntries(sqlNames.map((name, index) => [name, String(index + 5).repeat(64)]));
const stabilityProof = hash(`${canonicalJson(semantic)}\n`);
const migrationCopyHash = "a".repeat(64);
const dataCopyHash = "b".repeat(64);
const storageInventoryHash = "c".repeat(64);

function receipt(overrides = {}) {
  return {
    schema: "evo-v3-managed-supabase-export-receipt/v1",
    captured_at: capturedAt,
    git: { head: commit, migration_tree: migrationTree },
    source: { identity_sha256: sourceReceipt().sha256 },
    provider_backup: { id: "backup-123", inserted_at: "2026-09-04T22:54:35.725Z", status: "COMPLETED", physical: true },
    database: {
      postgres_major: 17,
      migration_count: 2,
      migration_min_version: "001",
      migration_max_version: "002",
      migration_copy_rows_sha256: migrationCopyHash,
      data_copy_sections_sha256: dataCopyHash,
      stability_proof_sha256: stabilityProof,
      snapshot_mode: "postgresql-exported-repeatable-read-read-only",
      table_count: 10,
      row_count: 20,
      auth_user_count: 3,
    },
    storage: { inventory_sha256: storageInventoryHash, bucket_count: 3, private_bucket_count: 1, public_bucket_count: 2, object_count: 0, total_bytes: 0 },
    encrypted_artifacts: Object.fromEntries([
      "roles.sql.age", "schema.sql.age", "data.sql.age", "history-schema.sql.age", "history-data.sql.age",
      "database-manifest.json.age", "storage-manifest.json.age", "storage-objects.tar.age",
    ].map((name, index) => [name, { bytes: 200 + index, sha256: String((index + 1) % 10).repeat(64) }])),
    tools: tools(),
    signature: { namespace: "evo-v3-managed-supabase-recovery", identity: "evo-v3-managed-supabase-export", public_key_fingerprint: fingerprint, trust_root: "operator-held-external-public-key" },
    result: "export_verified",
    ...overrides,
  };
}

function validatedReceipt() {
  return validateSignedReceipt(receipt(), {
    sourceRepositoryCommit: sourceCommit,
    sourceMigrationTree,
    trustedFingerprint: fingerprint,
    now: new Date("2026-09-05T01:00:00.000Z"),
    maxAgeHours: 72,
  });
}

function databaseManifest(overrides = {}) {
  return {
    schema: "evo-v3-managed-supabase-logical-backup/v1",
    captured_at: capturedAt,
    source_receipt: sourceReceipt(),
    git: { head: commit, migration_tree: migrationTree },
    tools: tools(),
    artifacts: artifactDescriptors,
    migration_ledger: { count: 2, min_version: "001", max_version: "002", copy_rows_sha256: migrationCopyHash },
    data_copy_sections_sha256: dataCopyHash,
    stability: { snapshot_mode: "postgresql-exported-repeatable-read-read-only", artifact_semantic_sha256: semantic, proof_sha256: stabilityProof },
    aggregates: { table_count: 10, row_count: 20, auth_user_count: 3, storage_bucket_row_count: 3, storage_object_row_count: 0, table_counts_sha256: "d".repeat(64) },
    ...overrides,
  };
}

function buckets() {
  return [
    { id: "platform-documents", name: "platform-documents", public: false, file_size_limit: 1000, allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"], created_at: null, updated_at: null },
    { id: "avatars", name: "avatars", public: true, file_size_limit: null, allowed_mime_types: null, created_at: null, updated_at: null },
    { id: "attachments", name: "attachments", public: true, file_size_limit: null, allowed_mime_types: null, created_at: null, updated_at: null },
  ];
}

function storageManifest(overrides = {}) {
  return {
    schema: "evo-v3-managed-supabase-storage-backup/v1",
    captured_at: capturedAt,
    source_receipt_sha256: sourceReceipt().sha256,
    inventory_sha256: storageInventoryHash,
    buckets: buckets(),
    objects: [],
    aggregates: { bucket_count: 3, private_bucket_count: 1, public_bucket_count: 2, object_count: 0, total_bytes: 0 },
    ...overrides,
  };
}

function optionsArgs() {
  return [
    "--backup-dir", "/private/tmp/backup",
    "--trusted-public-key", "/private/tmp/key.pub",
    "--age-identity", "/private/tmp/identity",
    "--project-ref", projectRef,
    "--supabase-organization-id", supabaseOrganizationId,
    "--platform-organization-id", platformOrganizationId,
    "--source-repository-commit", sourceCommit,
    "--source-migration-tree", sourceMigrationTree,
    "--source-main-equivalent-commit", sourceMainEquivalentCommit,
    "--target-repository-commit", targetCommit,
    "--target-migration-tree", targetMigrationTree,
    "--admin-user-id", adminUserId,
    "--sales-user-id", salesUserId,
    "--admissions-user-id", admissionsUserId,
    "--evidence-out", "/private/tmp/evidence.json",
  ];
}

test("contract advertises signed exporter artifacts and no remote/provider authority", () => {
  const output = JSON.parse(execFileSync(process.execPath, [script.pathname, "contract"], { encoding: "utf8" }));
  assert.equal(output.ok, true);
  assert.equal(output.safety.remoteManagedSupabaseContact, false);
  assert.equal(output.safety.syntheticActors, false);
  assert.deepEqual(output.signedInput.encryptedArtifacts, [
    "roles.sql.age", "schema.sql.age", "data.sql.age", "history-schema.sql.age", "history-data.sql.age",
    "database-manifest.json.age", "storage-manifest.json.age", "storage-objects.tar.age",
  ]);
  const noOptIn = spawnSync(process.execPath, [script.pathname, "preflight", ...optionsArgs()], { encoding: "utf8", env: {} });
  assert.notEqual(noOptIn.status, 0);
  assert.equal(JSON.parse(noOptIn.stdout).code, "explicit_opt_in_required");
});

test("OrbStack receives only a validated HOME in the otherwise minimal child environment", (t) => {
  const home = mkdtempSync(join(tmpdir(), "evo-recovery-orbstack-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const environment = orbStackEnvironment(home);
  assert.equal(environment.HOME, realpathSync(home));
  assert.deepEqual(Object.keys(environment).sort(), ["DOCKER_CONTEXT", "HOME", "LANG", "LC_ALL", "PATH"]);
  const notDirectory = join(home, "not-a-directory");
  writeFileSync(notDirectory, "not a home\n", { mode: 0o600 });
  const peerWritable = join(home, "peer-writable");
  mkdirSync(peerWritable, { mode: 0o700 });
  chmodSync(peerWritable, 0o722);
  expectCode(() => orbStackEnvironment("relative/home"), "orbstack_home_invalid");
  expectCode(() => orbStackEnvironment(join(home, "missing")), "orbstack_home_invalid");
  expectCode(() => orbStackEnvironment(notDirectory), "orbstack_home_invalid");
  expectCode(() => orbStackEnvironment(peerWritable), "orbstack_home_invalid");
});

test("arguments separate immutable source and target bindings and reject the retired compatibility flag", () => {
  const parsed = parseHarnessOptions(optionsArgs(), {});
  assert.equal(parsed.projectRef, projectRef);
  assert.equal(parsed.supabaseOrganizationId, supabaseOrganizationId);
  assert.equal(parsed.platformOrganizationId, platformOrganizationId);
  assert.equal(parsed.sourceRepositoryCommit, sourceCommit);
  assert.equal(parsed.sourceMigrationTree, sourceMigrationTree);
  assert.equal(parsed.sourceMainEquivalentCommit, sourceMainEquivalentCommit);
  assert.equal(parsed.targetRepositoryCommit, targetCommit);
  assert.equal(parsed.targetMigrationTree, targetMigrationTree);
  const withoutFlag = (args, flag) => {
    const index = args.indexOf(flag);
    return args.filter((_, itemIndex) => ![index, index + 1].includes(itemIndex));
  };
  for (const flag of ["--source-repository-commit", "--source-migration-tree", "--source-main-equivalent-commit", "--target-repository-commit", "--target-migration-tree"]) {
    const args = optionsArgs();
    const index = args.indexOf(flag);
    expectCode(() => parseHarnessOptions(args.filter((_, itemIndex) => ![index, index + 1].includes(itemIndex)), {}), "required_argument_missing");
  }
  expectCode(() => parseHarnessOptions([...optionsArgs(), "--repository-commit", sourceCommit], {}), "unknown_argument");
  expectCode(() => parseHarnessOptions([...optionsArgs(), "--app-image", `sha256:${"e".repeat(64)}`], {}), "unknown_argument");
  const duplicate = optionsArgs();
  duplicate[duplicate.indexOf("--sales-user-id") + 1] = adminUserId;
  expectCode(() => parseHarnessOptions(duplicate, {}), "representative_user_ids_not_distinct");
  const adminOnly = parseHarnessOptions(
    withoutFlag(withoutFlag(optionsArgs(), "--sales-user-id"), "--admissions-user-id"),
    {},
  );
  assert.equal(adminOnly.adminUserId, adminUserId);
  assert.equal(adminOnly.salesUserId, undefined);
  assert.equal(adminOnly.admissionsUserId, undefined);
  assert.deepEqual(suppliedRepresentativeUserIds(adminOnly), [adminUserId]);
  expectCode(() => parseHarnessOptions(withoutFlag(optionsArgs(), "--admin-user-id"), {}), "required_argument_missing");
  expectCode(
    () => parseHarnessOptions([
      ...withoutFlag(withoutFlag(optionsArgs(), "--sales-user-id"), "--admissions-user-id"),
      "--sales-user-id", "not-a-uuid",
    ], {}),
    "sales_user_id_invalid",
  );
  expectCode(
    () => parseHarnessOptions([
      ...withoutFlag(withoutFlag(optionsArgs(), "--sales-user-id"), "--admissions-user-id"),
      "--admissions-user-id", adminUserId,
    ], {}),
    "representative_user_ids_not_distinct",
  );
});

test("backup directory preflight names missing, invalid and non-private inputs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "evo-recovery-backup-preflight-"));
  const privateDirectory = join(root, "backup");
  const file = join(root, "file");
  const link = join(root, "link");
  mkdirSync(privateDirectory, { mode: 0o700 });
  writeFileSync(file, "not a directory", { mode: 0o600 });
  symlinkSync(privateDirectory, link);
  t.after(() => {
    chmodSync(privateDirectory, 0o700);
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(privateBackupDirectory(privateDirectory), realpathSync(privateDirectory));
  expectCode(() => privateBackupDirectory(join(root, "missing")), "backup_directory_missing");
  expectCode(() => privateBackupDirectory("relative/backup"), "backup_directory_path_invalid");
  expectCode(() => privateBackupDirectory(file), "backup_directory_invalid");
  expectCode(() => privateBackupDirectory(link), "backup_directory_not_private");
  chmodSync(privateDirectory, 0o755);
  expectCode(() => privateBackupDirectory(privateDirectory), "backup_directory_not_private");
});

test("repository binding proves squash-equivalent source trees before target ancestry", () => {
  const expected = { sourceRepositoryCommit: sourceCommit, sourceMigrationTree, sourceMainEquivalentCommit, targetRepositoryCommit: targetCommit, targetMigrationTree };
  const value = {
    head: targetCommit,
    status: "",
    sourceCommit,
    sourceTree: sourceFullTree,
    sourceMigrationTree,
    sourceMainEquivalentCommit,
    sourceMainEquivalentTree: sourceFullTree,
    sourceMainEquivalentMigrationTree: sourceMigrationTree,
    targetCommit,
    targetTree: targetFullTree,
    targetMigrationTree,
    objectFormat: "sha1",
    equivalentIsAncestor: true,
  };
  assert.deepEqual(validateRepositoryBindings(value, expected), {
    source: {
      receiptCommit: sourceCommit,
      tree: sourceFullTree,
      migrationTree: sourceMigrationTree,
      mainEquivalentCommit: sourceMainEquivalentCommit,
      mainEquivalentTree: sourceFullTree,
      mainEquivalentMigrationTree: sourceMigrationTree,
    },
    target: { commit: targetCommit, tree: targetFullTree, migrationTree: targetMigrationTree, objectFormat: "sha1" },
    sourceTreeEqualsMainEquivalent: true,
    sourceMainEquivalentIsAncestorOfTarget: true,
  });
  expectCode(() => validateRepositoryBindings({ ...value, head: sourceCommit }, expected), "target_repository_commit_mismatch");
  expectCode(() => validateRepositoryBindings({ ...value, sourceMigrationTree: targetMigrationTree }, expected), "source_migration_tree_mismatch");
  expectCode(() => validateRepositoryBindings({ ...value, targetMigrationTree: sourceMigrationTree }, expected), "target_migration_tree_mismatch");
  expectCode(() => validateRepositoryBindings({ ...value, sourceMainEquivalentTree: targetFullTree }, expected), "source_main_equivalent_tree_mismatch");
  expectCode(() => validateRepositoryBindings({ ...value, sourceMainEquivalentMigrationTree: targetMigrationTree }, expected), "source_main_equivalent_migration_tree_mismatch");
  expectCode(() => validateRepositoryBindings({ ...value, objectFormat: "md5" }, expected), "repository_object_format_invalid");
  expectCode(() => validateRepositoryBindings({ ...value, equivalentIsAncestor: false }, expected), "source_main_equivalent_not_ancestor");
  assert.match(source, /\["merge-base", "--is-ancestor", options\.sourceMainEquivalentCommit, options\.targetRepositoryCommit\]/u);
  assert.doesNotMatch(source, /\["merge-base", "--is-ancestor", options\.sourceRepositoryCommit, options\.targetRepositoryCommit\]/u);
});

test("receipt accepts only exact #636 schema and exact signing identity/fingerprint", () => {
  const result = validatedReceipt();
  assert.equal(result.sourceIdentity, sourceReceipt().sha256);
  assert.equal(result.encryptedArtifacts["history-data.sql.age"].bytes, 204);
  expectCode(() => validateSignedReceipt(receipt({ schema: "evo-managed-supabase-export/v1" }), {
    sourceRepositoryCommit: sourceCommit, sourceMigrationTree, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_schema_invalid");
  expectCode(() => validateSignedReceipt(receipt({ git: { head: sourceCommit, migration_tree: targetMigrationTree } }), {
    sourceRepositoryCommit: sourceCommit, sourceMigrationTree, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_source_migration_tree_mismatch");
  expectCode(() => validateSignedReceipt(receipt({ signature: { ...receipt().signature, namespace: "spoof" } }), {
    sourceRepositoryCommit: sourceCommit, sourceMigrationTree, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_signature_metadata_invalid");
  expectCode(() => validateSignedReceipt(receipt(), {
    sourceRepositoryCommit: sourceCommit, sourceMigrationTree, trustedFingerprint: "SHA256:different", now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_signature_metadata_invalid");
  expectCode(() => validateSignedReceipt(receipt({ database: { ...receipt().database, snapshot_mode: "independent-dumps" } }), {
    sourceRepositoryCommit: sourceCommit, sourceMigrationTree, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_database_snapshot_mode_invalid");
  expectCode(() => validateSignedReceipt(receipt({
    tools: { ...tools(), managed_dump_inputs_sha256: "8".repeat(64) },
  }), {
    sourceRepositoryCommit: sourceCommit, sourceMigrationTree, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "export_tool_evidence_invalid");
  expectCode(() => validateSignedReceipt(receipt({
    tools: {
      ...tools(),
      managed_dump_inputs_sha256: { ...tools().managed_dump_inputs_sha256, database_ca: "0".repeat(64) },
    },
  }), {
    sourceRepositoryCommit: sourceCommit, sourceMigrationTree, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "export_tool_evidence_invalid");
  const missingArtifact = receipt();
  delete missingArtifact.encrypted_artifacts["history-schema.sql.age"];
  expectCode(() => validateSignedReceipt(missingArtifact, {
    sourceRepositoryCommit: sourceCommit, sourceMigrationTree, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_artifact_set_invalid");
});

test("database manifest cross-binds project, provider backup, git, tools and every SQL artifact", () => {
  const result = validateDatabaseManifest(databaseManifest(), {
    receipt: validatedReceipt(), projectRef, organizationId: supabaseOrganizationId,
  });
  assert.equal(result.source.project.ref, projectRef);
  assert.deepEqual(Object.keys(result.artifacts), sqlNames);
  expectCode(() => validateDatabaseManifest(databaseManifest({ source_receipt: { ...sourceReceipt(), sha256: "0".repeat(64) } }), {
    receipt: validatedReceipt(), projectRef, organizationId: supabaseOrganizationId,
  }), "database_source_identity_mismatch");
  expectCode(() => validateDatabaseManifest(databaseManifest({ data_copy_sections_sha256: "0".repeat(64) }), {
    receipt: validatedReceipt(), projectRef, organizationId: supabaseOrganizationId,
  }), "database_manifest_receipt_mismatch");
  expectCode(() => validateDatabaseManifest(databaseManifest({ stability: { snapshot_mode: "two-unrelated-snapshots", artifact_semantic_sha256: semantic, proof_sha256: stabilityProof } }), {
    receipt: validatedReceipt(), projectRef, organizationId: supabaseOrganizationId,
  }), "database_snapshot_mode_invalid");
});

test("Storage manifest is exact, source-bound, private-bucket aware, and traversal safe", () => {
  const valid = validateStorageManifest(storageManifest(), { receipt: validatedReceipt(), databaseCapturedAt: capturedAt });
  assert.equal(valid.aggregates.private_bucket_count, 1);
  const object = { bucket_id: "platform-documents", path: "org/file.txt", source_id: "50000000-0000-4000-8000-000000000001", source_version: "60000000-0000-4000-8000-000000000001", blob: `${"a".repeat(64)}.bin`, bytes: 4, sha256: "f".repeat(64) };
  const baseReceipt = validatedReceipt();
  const objectReceipt = {
    ...baseReceipt,
    storage: { ...baseReceipt.storage, object_count: 1, total_bytes: 4 },
  };
  const withObject = storageManifest({ objects: [object], aggregates: { bucket_count: 3, private_bucket_count: 1, public_bucket_count: 2, object_count: 1, total_bytes: 4 } });
  assert.equal(validateStorageManifest(withObject, { receipt: objectReceipt, databaseCapturedAt: capturedAt }).objects.length, 1);
  expectCode(() => validateStorageManifest({ ...withObject, objects: [{ ...object, path: "../escape" }] }, { receipt: objectReceipt, databaseCapturedAt: capturedAt }), "storage_object_path_invalid");
  expectCode(() => validateStorageManifest(storageManifest({ source_receipt_sha256: "0".repeat(64) }), { receipt: validatedReceipt(), databaseCapturedAt: capturedAt }), "storage_source_binding_mismatch");
});

function historySql(rows = [
  "001\t{first}\tinitial_schema",
  "002\t{second}\tadd_students",
]) {
  const guard = "A".repeat(63);
  return `\\restrict ${guard}\nCOPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;\n${rows.join("\n")}\n\\.\n\\unrestrict ${guard}\n`;
}

function signedHistorySql(rows) {
  const guard = "B".repeat(63);
  return `\\restrict ${guard}\nCOPY "supabase_migrations"."schema_migrations" ("version", "statements", "name", "created_by", "idempotency_key", "rollback") FROM stdin;\n${rows.join("\n")}\n\\.\n\\unrestrict ${guard}\n`;
}

test("exact history parser binds ordered full COPY rows and rejects reconstruction", () => {
  const sql = historySql();
  const ledger = extractExactMigrationLedger(sql);
  assert.deepEqual(ledger.entries.map(({ version, name }) => ({ version, name })), [
    { version: "001", name: "initial_schema" },
    { version: "002", name: "add_students" },
  ]);
  const summary = { count: 2, min_version: "001", max_version: "002", copy_rows_sha256: ledger.copyRowsSha256 };
  const rootEntry = (version, name, sql) => ({
    version,
    name,
    bytes: Buffer.byteLength(sql),
    sha256: hash(sql),
    ...migrationStatementsDigest(sql),
  });
  const root = { entries: [
    rootEntry("001", "initial_schema", "first;"),
    rootEntry("002", "add_students", "second;"),
    rootEntry("003", "next", "next;"),
  ] };
  assert.deepEqual(verifyLedgerAgainstRoot(ledger, root, summary).pending.map((entry) => entry.version), ["003"]);
  const fullyMigratedRoot = { entries: root.entries.slice(0, 2) };
  assert.equal(verifyLedgerAgainstRoot(ledger, fullyMigratedRoot, summary).pending.length, 0);
  assert.equal(verifyLedgerAgainstRoot(ledger, fullyMigratedRoot, summary, { requireComplete: true }).pending.length, 0);
  expectCode(() => verifyLedgerAgainstRoot(ledger, root, summary, { requireComplete: true }), "source_migration_ledger_not_complete");
  expectCode(() => verifyLedgerAgainstRoot({ count: 2, min_version: "001", max_version: "002" }, root, summary), "migration_ledger_reconstruction_forbidden");
  expectCode(() => extractExactMigrationLedger(historySql([
    "002\t{second}\tadd_students", "001\t{first}\tinitial_schema",
  ])), "migration_history_order_invalid");
  expectCode(() => verifyLedgerAgainstRoot(ledger, { entries: [rootEntry("001", "wrong", "first;")] }, summary), "migration_ledger_root_prefix_mismatch");
  const contentDrift = { entries: [
    rootEntry("001", "initial_schema", "changed despite identical version and name;"),
    rootEntry("002", "add_students", "second;"),
  ] };
  expectCode(() => verifyLedgerAgainstRoot(ledger, contentDrift, summary), "migration_ledger_root_prefix_mismatch");
  assert.deepEqual(migrationStatementsDigest("select ';'; DO $$ BEGIN PERFORM 1; END $$; select (1 + 2);"), {
    statementCount: 3,
    statementsSha256: hash(canonicalJson(["select ';'", "DO $$ BEGIN PERFORM 1; END $$", "select (1 + 2)"])),
  });
  const escaped = String.raw`select E'first \'quoted\'; second'; select 2;`;
  assert.deepEqual(migrationStatementsDigest(escaped), {
    statementCount: 2,
    statementsSha256: hash(canonicalJson([String.raw`select E'first \'quoted\'; second'`, "select 2"])),
  });
  const migration102 = readFileSync(
    new URL("../supabase/migrations/102_platform_crm_primary_waha_authority.sql", import.meta.url),
    "utf8",
  );
  assert.deepEqual(migrationStatementsDigest(migration102), {
    statementCount: 37,
    statementsSha256: "7c1afc344169fc5492dcf917d6b05279c3f60d3962993cc218c5f90a1711727d",
  });
});

test("only the two signed empty-history anomalies are accepted and hash-bound", () => {
  const ledger = extractExactMigrationLedger(signedHistorySql([
    "038\t{}\tauthorization_containment\t\\N\t\\N\t\\N",
    "039\t{}\tprivate_inbox_media\t\\N\t\\N\t\\N",
  ]));
  const summary = {
    count: 2,
    min_version: "038",
    max_version: "039",
    copy_rows_sha256: ledger.copyRowsSha256,
  };
  const rootEntry = (version, name, sql) => ({
    version,
    name,
    bytes: Buffer.byteLength(sql),
    sha256: hash(sql),
    ...migrationStatementsDigest(sql),
  });
  const migration038 = readFileSync(
    new URL("../supabase/migrations/038_authorization_containment.sql", import.meta.url),
    "utf8",
  );
  const migration039 = readFileSync(
    new URL("../supabase/migrations/039_private_inbox_media.sql", import.meta.url),
    "utf8",
  );
  const root = { entries: [
    rootEntry("038", "authorization_containment", migration038),
    rootEntry("039", "private_inbox_media", migration039),
    rootEntry("040", "next", "select 40;"),
  ] };
  const verified = verifyLedgerAgainstRoot(ledger, root, summary);
  assert.deepEqual(verified.pending.map(({ version }) => version), ["040"]);
  assert.deepEqual(verified.recordedSource.map(({ version, statementCount }) => ({ version, statementCount })), [
    { version: "038", statementCount: 0 },
    { version: "039", statementCount: 0 },
  ]);
  assert.deepEqual(
    verified.emptyStatementHistoryExceptions.map(({ version, name }) => ({ version, name })),
    [
      { version: "038", name: "authorization_containment" },
      { version: "039", name: "private_inbox_media" },
    ],
  );
  for (const exception of verified.emptyStatementHistoryExceptions) {
    assert.match(exception.signedRowSha256, /^[a-f0-9]{64}$/u);
    assert.match(exception.rootFileSha256, /^[a-f0-9]{64}$/u);
  }
  expectCode(() => extractExactMigrationLedger(signedHistorySql([
    "038\t{}\twrong_name\t\\N\t\\N\t\\N",
  ])), "migration_statements_array_invalid");
  expectCode(() => extractExactMigrationLedger(signedHistorySql([
    "037\t{}\tauthorization_containment\t\\N\t\\N\t\\N",
  ])), "migration_statements_array_invalid");
  expectCode(() => extractExactMigrationLedger(signedHistorySql([
    "040\t{}\tnext\t\\N\t\\N\t\\N",
  ])), "migration_statements_array_invalid");
  expectCode(
    () => verifyLedgerAgainstRoot(ledger, {
      entries: [
        rootEntry("038", "authorization_containment", migration038),
        rootEntry("039", "wrong_name", migration039),
      ],
    }, summary),
    "migration_ledger_root_prefix_mismatch",
  );
  expectCode(
    () => verifyLedgerAgainstRoot(ledger, {
      entries: [
        rootEntry("038", "authorization_containment", `${migration038}\n-- drift`),
        rootEntry("039", "private_inbox_media", migration039),
      ],
    }, summary),
    "migration_ledger_root_prefix_mismatch",
  );
});

test("the one signed comment-only statement drift is accepted only by exact hashes", () => {
  const migration030 = readFileSync(
    new URL("../supabase/migrations/030_ai_knowledge.sql", import.meta.url),
    "utf8",
  );
  const digest = migrationStatementsDigest(migration030);
  const root = { entries: [{
    version: "030",
    name: "ai_knowledge",
    bytes: Buffer.byteLength(migration030),
    sha256: hash(migration030),
    ...digest,
  }] };
  const entry = {
    version: "030",
    name: "ai_knowledge",
    row_sha256: "391845ec8286a35d27d3be4bc1badb08a69587cd07f7cacec128727d2dc4db07",
    statement_count: 36,
    statements_sha256: "3d2c866a2c3a5eee959fa7e2fa6b08f961c74a1794a91ce3016ed5d2ad8c2efd",
    statement_evidence: "recorded_statements",
  };
  const ledger = {
    entries: [entry],
    copyRowsSha256: "8".repeat(64),
    orderedLedgerSha256: "9".repeat(64),
  };
  const summary = {
    count: 1,
    min_version: "030",
    max_version: "030",
    copy_rows_sha256: ledger.copyRowsSha256,
  };
  const verified = verifyLedgerAgainstRoot(ledger, root, summary, { requireComplete: true });
  assert.deepEqual(verified.recordedRootHistoryExceptions.map(({ version, name, kind }) => ({ version, name, kind })), [{
    version: "030",
    name: "ai_knowledge",
    kind: "signed_comment_only_history_drift",
  }]);
  assert.deepEqual(verified.recordedSource, [{
    version: "030",
    name: "ai_knowledge",
    statementCount: 36,
    statementsSha256: entry.statements_sha256,
  }]);
  expectCode(
    () => verifyLedgerAgainstRoot({ ...ledger, entries: [{ ...entry, row_sha256: "0".repeat(64) }] }, root, summary),
    "migration_ledger_root_prefix_mismatch",
  );
  const changedRoot = { entries: [{ ...root.entries[0], sha256: "0".repeat(64) }] };
  expectCode(
    () => verifyLedgerAgainstRoot(ledger, changedRoot, summary),
    "migration_ledger_root_prefix_mismatch",
  );
});

test("database pending migrations and source-code target suffix are independently bound", () => {
  const entry = (version, name) => {
    const sql = `select ${Number(version)};`;
    return { version, name, bytes: Buffer.byteLength(sql), sha256: hash(sql), ...migrationStatementsDigest(sql) };
  };
  const ledger = extractExactMigrationLedger(historySql([
    "001\t{select 1}\tone",
    "002\t{select 2}\ttwo",
  ]));
  const summary = { count: 2, min_version: "001", max_version: "002", copy_rows_sha256: ledger.copyRowsSha256 };
  const sourceRoot = { entries: [entry("001", "one"), entry("002", "two"), entry("003", "source_added")] };
  const targetRoot = { entries: [...sourceRoot.entries, entry("004", "target_only")] };
  assert.deepEqual(verifyLedgerAgainstRoot(ledger, sourceRoot, summary).pending.map(({ version }) => version), ["003"]);
  assert.deepEqual(verifyLedgerAgainstRoot(ledger, targetRoot, summary).pending.map(({ version }) => version), ["003", "004"]);
  assert.deepEqual(verifyMigrationTreePrefix(sourceRoot, targetRoot).pending.map(({ version }) => version), ["004"]);
  assert.equal(verifyMigrationTreePrefix(sourceRoot, sourceRoot).pending.length, 0);
  expectCode(
    () => verifyMigrationTreePrefix(sourceRoot, { entries: [...sourceRoot.entries.slice(0, 2), entry("003", "changed")] }),
    "repository_migration_prefix_mismatch",
  );
});

test("restored Storage inventory requires exact identity, version and streamed byte digest with no extras", () => {
  const sourceObjects = [{
    bucket_id: "platform-documents",
    path: "org/document.pdf",
    source_id: "50000000-0000-4000-8000-000000000001",
    source_version: "60000000-0000-4000-8000-000000000001",
    sha256: "a".repeat(64),
    bytes: 42,
  }];
  const identities = sourceObjects.map(({ source_id, source_version, bucket_id, path }) => ({ source_id, source_version, bucket_id, path }));
  const readbacks = sourceObjects.map(({ bucket_id, path, sha256, bytes }) => ({ bucket_id, path, sha256, bytes }));
  assert.deepEqual(verifyRestoredStorageInventory(sourceObjects, identities, readbacks), {
    objectCount: 1,
    totalBytes: 42,
    restoredInventorySha256: hash(canonicalJson(sourceObjects)),
  });
  expectCode(() => verifyRestoredStorageInventory(sourceObjects, [{ ...identities[0], source_version: "60000000-0000-4000-8000-000000000002" }], readbacks), "restored_storage_identity_mismatch");
  expectCode(() => verifyRestoredStorageInventory(sourceObjects, identities, [{ ...readbacks[0], sha256: "b".repeat(64) }]), "restored_storage_content_mismatch");
  expectCode(() => verifyRestoredStorageInventory(sourceObjects, identities, []), "restored_storage_readback_missing");
  expectCode(() => verifyRestoredStorageInventory(sourceObjects, identities, [...readbacks, { ...readbacks[0], path: "org/extra.pdf" }]), "restored_storage_readback_extra");
  const ready = storageSourceRecoveryReadiness({ objectCount: 1 });
  assert.equal(ready.status, "ready");
  const empty = storageSourceRecoveryReadiness({ objectCount: 0 });
  assert.deepEqual(empty, { status: "not_ready", blocker: "storage_source_object_missing", recoveredObjectCount: 0 });
  assert.match(source, /evidenceScope: "behavior_canary_only_not_source_recovery"/u);
});

test("private document behavior canary is a deterministic canonical PDF accepted by Storage policy", () => {
  const first = canonicalRecoveryPdfBytes();
  const second = canonicalRecoveryPdfBytes();
  const document = first.toString("latin1");
  assert.deepEqual(first, second);
  assert.equal(first.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(document, /\nxref\n0 4\n/u);
  assert.match(document, /trailer\n<< \/Size 4 \/Root 1 0 R >>\nstartxref\n([0-9]+)\n%%EOF\n$/u);
  const xrefOffset = Number(document.match(/startxref\n([0-9]+)\n%%EOF\n$/u)?.[1]);
  assert.equal(document.slice(xrefOffset, xrefOffset + 4), "xref");
  assert.match(source, /`recovery-proof\/\$\{randomUUID\(\)\}\.pdf`/u);
  assert.match(source, /"content-type": "application\/pdf"/u);
  assert.doesNotMatch(source, /"content-type": "text\/plain"/u);
});

test("Storage restore streams bounded file chunks and aborts an in-flight upload", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "evo-recovery-storage-stream-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "large-object.bin");
  const bytes = Buffer.alloc(512 * 1_024 + 17, 7);
  writeFileSync(path, bytes, { mode: 0o600 });
  const guard = new RecoveryInterruptionGuard();
  let maximumChunk = 0;
  let streamedBytes = 0;
  let sawStream = false;
  const response = await uploadStorageObjectFromFile(path, {
    url: "http://127.0.0.1:54321/storage/v1/object/private/large-object.bin",
    headers: { "content-type": "application/octet-stream" },
    expectedBytes: bytes.length,
  }, guard, {
    fetchImpl: async (_url, init) => {
      sawStream = typeof init.body?.pipe === "function" && !Buffer.isBuffer(init.body);
      assert.equal(init.duplex, "half");
      for await (const chunk of init.body) {
        maximumChunk = Math.max(maximumChunk, chunk.length);
        streamedBytes += chunk.length;
      }
      return new Response("", { status: 200 });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(sawStream, true);
  assert.equal(streamedBytes, bytes.length);
  assert.ok(maximumChunk <= 64 * 1_024);

  const interrupted = new RecoveryInterruptionGuard();
  let fetchInvoked = false;
  const pending = uploadStorageObjectFromFile(path, {
    url: "http://127.0.0.1:54321/storage/v1/object/private/large-object.bin",
    headers: { "content-type": "application/octet-stream" },
    expectedBytes: bytes.length,
  }, interrupted, {
    fetchImpl: async (_url, init) => {
      fetchInvoked = true;
      await new Promise((resolvePromise, rejectPromise) => {
        init.signal.addEventListener("abort", () => rejectPromise(new DOMException("aborted", "AbortError")), { once: true });
      });
    },
  });
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  interrupted.latch("SIGINT");
  await expectCodeAsync(() => pending, "operation_interrupted");
  assert.equal(fetchInvoked, true);
  assert.doesNotMatch(source, /readFileSync\(join\(extracted, "storage-blobs"/u);
});

test("all five SQL payloads require one matching active restricted-mode guard", () => {
  const sql = historySql();
  assert.match(validateRestrictedSqlEnvelope(sql, "history-data.sql").guardSha256, /^[0-9a-f]{64}$/u);
  expectCode(() => validateRestrictedSqlEnvelope(sql.replace("\\unrestrict", "-- \\unrestrict"), "history-data.sql"), "sql_restricted_guard_invalid");
  expectCode(() => validateRestrictedSqlEnvelope(sql.replace(`\\unrestrict ${"A".repeat(63)}`, `\\unrestrict ${"B".repeat(63)}`), "history-data.sql"), "sql_restricted_guard_invalid");
});

test("streaming SQL validation requires restrict before unrestrict", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "evo-recovery-streamed-sql-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const guard = "A".repeat(63);
  const valid = join(root, "valid.sql");
  const reversed = join(root, "reversed.sql");
  writeFileSync(valid, `\\restrict ${guard}\nSELECT 1;\n\\unrestrict ${guard}\n`);
  writeFileSync(reversed, `\\unrestrict ${guard}\nSELECT 1;\n\\restrict ${guard}\n`);
  assert.match((await validateRestrictedSqlFile(valid, "valid.sql")).guardSha256, /^[0-9a-f]{64}$/u);
  await expectCodeAsync(
    () => validateRestrictedSqlFile(reversed, "reversed.sql"),
    "sql_restricted_guard_invalid",
  );
});

function cohortRows() {
  return [
    { userId: adminUserId, profileId: "30000000-0000-4000-8000-000000000001", membershipId: "40000000-0000-4000-8000-000000000001", organizationId: platformOrganizationId, databaseRole: "admin", email: "admin@example.invalid" },
    { userId: salesUserId, profileId: "30000000-0000-4000-8000-000000000002", membershipId: "40000000-0000-4000-8000-000000000002", organizationId: platformOrganizationId, databaseRole: "sales", email: "sales@example.invalid" },
    { userId: admissionsUserId, profileId: "30000000-0000-4000-8000-000000000003", membershipId: "40000000-0000-4000-8000-000000000003", organizationId: platformOrganizationId, databaseRole: "curator", email: "admissions@example.invalid" },
  ];
}

test("representatives must be explicit, pre-existing, same-org Admin Sales Admissions", () => {
  const expected = { adminUserId, salesUserId, admissionsUserId, platformOrganizationId };
  assert.equal(validateRepresentativeCohort(cohortRows(), expected).admissions.appRole, "admissions");
  const incomplete = assessRepresentativeCohort(cohortRows().slice(0, 1), expected);
  assert.deepEqual(Object.keys(incomplete.actors), ["admin"]);
  assert.deepEqual(incomplete.blockers, ["sales_representative_missing", "admissions_representative_missing"]);
  const adminOnlyExpected = { adminUserId, platformOrganizationId };
  const adminOnly = assessRepresentativeCohort(cohortRows(), adminOnlyExpected);
  assert.deepEqual(Object.keys(adminOnly.actors), ["admin"]);
  assert.deepEqual(adminOnly.blockers, ["sales_representative_missing", "admissions_representative_missing"]);
  assert.deepEqual(suppliedRepresentativeUserIds(adminOnlyExpected), [adminUserId]);
  assert.match(source, /const ids = suppliedRepresentativeUserIds\(options\)\.map\(sqlLiteral\)\.join\(","\)/u);
  expectCode(() => validateRepresentativeCohort(cohortRows().slice(0, 2), expected), "authorized_representative_missing");
  const cross = cohortRows();
  cross[2] = { ...cross[2], organizationId: "10000000-0000-4000-8000-000000000002" };
  expectCode(() => validateRepresentativeCohort(cross, expected), "representative_cohort_organization_mismatch");
});

test("write proof requires Admin audit, cross-org denial, Sales denial and Admissions allowed/denied boundaries", () => {
  const complete = {
    adminAuditCount: 1,
    crossOrganizationWriteDenied: true,
    salesAdminWriteDenied: true,
    admissionsTaskAuditCount: 1,
    admissionsAdminWriteDenied: true,
  };
  assert.equal(validateWriteBoundaryResults(complete).admissionsTaskWriteRollbackOnly, "passed");
  for (const field of Object.keys(complete)) {
    const invalid = { ...complete, [field]: typeof complete[field] === "boolean" ? false : 0 };
    expectCode(() => validateWriteBoundaryResults(invalid), "authorization_write_boundary_failed");
  }
});

test("Admissions recovery proof selects a real status change and preserves every restricted field", () => {
  const task = {
    id: "30000000-0000-4000-8000-000000000001",
    status: "open",
    assigneeMembershipId: "40000000-0000-4000-8000-000000000001",
    priority: "normal",
    dueAt: null,
    dueOn: "2026-09-05",
    studentVisible: false,
    version: 4,
  };
  const mutation = selectAdmissionsTaskMutation(task);
  assert.equal(mutation.status, "in_progress");
  assert.notEqual(mutation.status, task.status);
  assert.equal(mutation.assigneeMembershipId, task.assigneeMembershipId);
  assert.equal(mutation.priority, task.priority);
  assert.equal(mutation.dueAt, task.dueAt);
  assert.equal(mutation.dueOn, task.dueOn);
  assert.equal(mutation.studentVisible, task.studentVisible);
  assert.equal(mutation.version, task.version);
  for (const status of ["open", "in_progress", "blocked", "done", "cancelled"]) {
    assert.notEqual(selectAdmissionsTaskMutation({ ...task, status }).status, status);
  }
});

test("restored database aggregate reconciliation fails on every signed aggregate mismatch", () => {
  const counts = { "platform.zero_rows": 0, "auth.users": 3, "platform.leads": 5 };
  const expected = databaseAggregatesFromTableCounts(counts);
  assert.deepEqual(expected, databaseAggregatesFromTableCounts({ "platform.leads": 5, "platform.zero_rows": 0, "auth.users": 3 }));
  assert.equal(expected.table_count, 3);
  assert.equal(expected.row_count, 8);
  assert.equal(expected.auth_user_count, 3);
  assert.deepEqual(validateRestoredDatabaseAggregates(expected, expected), {
    tableCount: 3,
    rowCount: 8,
    authUserCount: 3,
    tableCountsSha256: expected.table_counts_sha256,
  });
  for (const [key, value] of [
    ["table_count", 4],
    ["row_count", 9],
    ["auth_user_count", 2],
    ["table_counts_sha256", "b".repeat(64)],
  ]) {
    expectCode(
      () => validateRestoredDatabaseAggregates(expected, { ...expected, [key]: value }),
      "restored_database_aggregate_mismatch",
    );
  }
  const missingZeroRowTable = databaseAggregatesFromTableCounts({ "auth.users": 3, "platform.leads": 5 });
  expectCode(() => validateRestoredDatabaseAggregates(expected, missingZeroRowTable), "restored_database_aggregate_mismatch");
});

test("restored table-count drift reports only safe table coordinates and counts", () => {
  const expected = { "auth.users": 1, "platform.audit_events": 1 };
  assert.deepEqual(validateRestoredTableCounts(expected, { ...expected }), expected);
  let failure;
  try {
    validateRestoredTableCounts(expected, { "auth.users": 1, "platform.audit_events": 2 });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof RecoveryFailure);
  assert.equal(failure.code, "restored_database_table_count_mismatch");
  assert.deepEqual(failure.diagnostic, {
    mismatchCount: 1,
    mismatchSetSha256: hash(canonicalJson(["platform.audit_events"])),
    firstTable: "platform.audit_events",
    expectedCount: 1,
    actualCount: 2,
  });
  expectCode(
    () => validateRestoredTableCounts(expected, { ...expected, "public.extra": 0 }),
    "restored_database_table_count_mismatch",
  );
});

test("expected database denial requires the exact SQLSTATE and domain sentinel", () => {
  const expectedMessage = "Active scoped Admin permission membership.role.change is required";
  const expected = { sqlstate: "42501", domainSentinel: "admin_membership_permission_required" };
  const diagnostic = sanitizePsqlDiagnostic(`ERROR:  42501: ${expectedMessage}\nLOCATION:  exec_stmt_raise, pl_exec.c:3905\n`, 3);
  assert.equal(classifyExpectedDatabaseDenial(diagnostic, expected), true);
  assert.deepEqual(diagnostic.postgres, {
    sqlstate: "42501",
    errorClass: "insufficient_privilege",
    inputLine: null,
    domainSentinel: "admin_membership_permission_required",
  });
  assert.equal(JSON.stringify(diagnostic).includes(expectedMessage), false);
  const restoreDiagnostic = sanitizePsqlDiagnostic(
    `psql:/private/redacted/data.sql:741: ERROR:  23503: row-specific text\nDETAIL:  redacted\n`,
    3,
  );
  assert.deepEqual(restoreDiagnostic.postgres, {
    sqlstate: "23503",
    errorClass: "foreign_key_violation",
    inputLine: 741,
    domainSentinel: null,
  });
  assert.equal(JSON.stringify(restoreDiagnostic).includes("row-specific text"), false);
  assert.equal(JSON.stringify(restoreDiagnostic).includes("/private/redacted"), false);
  assert.equal(classifyExpectedDatabaseDenial({ ...diagnostic, postgres: { ...diagnostic.postgres, sqlstate: "42P01" } }, expected), false);
  assert.equal(classifyExpectedDatabaseDenial({ ...diagnostic, postgres: { ...diagnostic.postgres, domainSentinel: null } }, expected), false);
  assert.equal(classifyExpectedDatabaseDenial(sanitizePsqlDiagnostic("connection refused", 2), expected), false);
  assert.equal(classifyExpectedDatabaseDenial(sanitizePsqlDiagnostic("ERROR:  42601: syntax error\n", 3), expected), false);
});

test("PGMQ recovery binds the two canonical queue relation pairs and containment", () => {
  const counts = {
    "auth.users": 1,
    "pgmq.a_platform_dead_letter_v1": 0,
    "pgmq.a_platform_work_v1": 2,
    "pgmq.q_platform_dead_letter_v1": 3,
    "pgmq.q_platform_work_v1": 4,
  };
  const inventory = validatePgmqRestoreInventory(counts);
  assert.equal(inventory.signedRowCount, 9);
  assert.match(inventory.queueSetSha256, /^[0-9a-f]{64}$/u);
  assert.match(inventory.relationSetSha256, /^[0-9a-f]{64}$/u);
  assert.match(inventory.relationCountsSha256, /^[0-9a-f]{64}$/u);
  expectCode(
    () => validatePgmqRestoreInventory({ ...counts, "pgmq.q_unreviewed": 0 }),
    "pgmq_restore_inventory_invalid",
  );
  const missing = { ...counts };
  delete missing["pgmq.a_platform_work_v1"];
  expectCode(() => validatePgmqRestoreInventory(missing), "pgmq_restore_inventory_invalid");
  assert.match(source, /SELECT pgmq\.create\('platform_work_v1'\)/u);
  assert.match(source, /SELECT pgmq\.create\('platform_dead_letter_v1'\)/u);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA pgmq/u);
  assert.match(source, /forbiddenAclCount/u);
});

test("durable evidence fails closed before write when cleanup quarantines", () => {
  const common = {
    result: { schema: "evo-v3-managed-supabase-recovery-result/v2", ok: true, status: "passed" },
    failure: undefined,
    interrupted: undefined,
    stages: [],
    tools: { psql: "18.6" },
    isolation: { status: "verified" },
  };
  const removed = buildDurableEvidence({
    ...common,
    cleanup: { descendantsDrained: true, targetsOwned: true, cleanupSucceeded: true, disposition: "remove" },
  });
  assert.equal(removed.ok, true);
  const quarantined = buildDurableEvidence({
    ...common,
    cleanup: { descendantsDrained: true, targetsOwned: true, cleanupSucceeded: false, disposition: "quarantine" },
  });
  assert.equal(quarantined.ok, false);
  assert.equal(quarantined.failure.code, "cleanup_quarantined");
  assert.deepEqual(quarantined.tools, { psql: "18.6" });
  assert.deepEqual(quarantined.isolation, { status: "verified" });
  const failed = buildDurableEvidence({
    ...common,
    result: undefined,
    failure: { code: "signed_input_failed", stage: "artifact_validation", diagnostic: null },
    tools: { psql: "18.6", git: "/usr/bin/git", unknownField: "discarded-value" },
    isolation: { status: "partial" },
    cleanup: { descendantsDrained: true, targetsOwned: true, cleanupSucceeded: true, disposition: "remove" },
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.tools, { psql: "18.6" });
  assert.equal(JSON.stringify(failed).includes("/usr/bin/git"), false);
  assert.equal(JSON.stringify(failed).includes("discarded-value"), false);

  const binaryDigest = "a".repeat(64);
  const safeToolResult = buildDurableEvidence({
    ...common,
    cleanup: { descendantsDrained: true, targetsOwned: true, cleanupSucceeded: true, disposition: "remove" },
    tools: {
      git: "git version 2.50.1 (Apple Git-155)",
      tar: "bsdtar 3.5.3",
      orb: "Running",
      orb_version: "OrbStack 2.4.1",
      docker_context: "orbstack",
      docker_client: "28.3.3",
      docker_server: "28.3.3",
      sshKeygen_binary_sha256: binaryDigest,
      git_binary_sha256: binaryDigest,
      tar_binary_sha256: binaryDigest,
      orb_binary_sha256: binaryDigest,
      docker_binary_sha256: binaryDigest,
      chromium: "Chromium 140.0.7339.16",
      chromium_binary_sha256: binaryDigest,
      leaked_path: "/usr/local/bin/tool",
    },
  });
  assert.equal(safeToolResult.tools.git, "git version 2.50.1 (Apple Git-155)");
  assert.equal(safeToolResult.tools.sshKeygen_binary_sha256, binaryDigest);
  assert.equal(safeToolResult.tools.chromium_binary_sha256, binaryDigest);
  assert.equal(JSON.stringify(safeToolResult.tools).includes("/usr/"), false);
  assert.equal(Object.hasOwn(safeToolResult.tools, "leaked_path"), false);

  const notReady = buildDurableEvidence({
    ...common,
    result: {
      schema: "evo-v3-managed-supabase-recovery-result/v2",
      ok: false,
      status: "not_ready",
      blockers: ["sales_representative_missing", "admissions_representative_missing", "storage_source_object_missing"],
    },
    cleanup: { descendantsDrained: true, targetsOwned: true, cleanupSucceeded: true, disposition: "remove" },
  });
  assert.equal(notReady.ok, false);
  assert.equal(notReady.status, "not_ready");
  assert.equal(notReady.failure.code, "recovery_not_ready");
  assert.equal(notReady.failure.diagnostic.blockerCount, 3);
  assert.deepEqual(notReady.blockers, ["sales_representative_missing", "admissions_representative_missing", "storage_source_object_missing"]);
});

test("durable evidence is atomically retained mode-0600 outside the runtime root", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "evo-recovery-evidence-"));
  chmodSync(parent, 0o700);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const harnessRoot = join(parent, "evo-v3-managed-recovery-runtime");
  mkdirSync(harnessRoot, { mode: 0o700 });
  const output = join(parent, "result.json");
  const destination = evidenceDestination(output);
  assert.equal(validateEvidenceRuntimeSeparation(destination, harnessRoot), destination);
  writeEvidence(destination, { schema: "test", ok: false });
  assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), { schema: "test", ok: false });
  assert.equal(lstatSync(destination).mode & 0o777, 0o600);
  assert.equal(readdirSync(parent).some((name) => name.includes(".tmp")), false);
  assert.throws(() => writeEvidence(destination, { schema: "overwrite" }), /EEXIST/u);
  const insideRuntime = join(harnessRoot, "result.json");
  expectCode(
    () => validateEvidenceRuntimeSeparation(evidenceDestination(insideRuntime), harnessRoot),
    "evidence_destination_inside_runtime",
  );
  assert.match(source, /pathAtOrBelow\(candidate, realpathSync\(repositoryRoot\)\)/u);
  assert.match(source, /linkSync\(temporary, path\)/u);
  assert.match(source, /fsyncSync\(parentFd\)/u);
});

test("interruption latches once, ignores a second default exit, and blocks new non-cleanup work", async () => {
  let stops = 0;
  let latched = 0;
  const supervisor = {
    latchInterruption() { latched += 1; },
    async stopAll() { stops += 1; return true; },
  };
  let directAborts = 0;
  const interruptionGuard = new RecoveryInterruptionGuard();
  interruptionGuard.signal.addEventListener("abort", () => { directAborts += 1; });
  const state = { interruptionGuard };
  const first = latchInterruption(state, supervisor, "SIGINT");
  const second = latchInterruption(state, supervisor, "SIGTERM");
  assert.equal(first, second);
  assert.equal(state.interrupted, "SIGINT");
  assert.equal(state.signalCount, 2);
  assert.equal(stops, 1);
  assert.equal(latched, 2);
  assert.equal(directAborts, 1);
  assert.equal(interruptionGuard.interrupted, "SIGINT");
  await first;

  const interruptedEvidence = buildDurableEvidence({
    result: { schema: "evo-v3-managed-supabase-recovery-result/v2", ok: true, status: "passed" },
    failure: undefined,
    interrupted: state.interrupted,
    stages: [],
    cleanup: { descendantsDrained: true, targetsOwned: true, cleanupSucceeded: true, disposition: "remove" },
    tools: {},
    isolation: { status: "partial" },
  });
  assert.equal(interruptedEvidence.ok, false);
  assert.equal(interruptedEvidence.status, "interrupted");
  assert.equal(interruptedEvidence.failure.code, "recovery_interrupted");

  const realSupervisor = new ProcessSupervisor();
  realSupervisor.latchInterruption();
  await expectCodeAsync(
    () => realSupervisor.run(process.execPath, ["--version"], { stage: "signal_test" }),
    "command_started_after_interruption",
  );
  const cleanup = await realSupervisor.run(process.execPath, ["--version"], {
    stage: "cleanup",
    allowAfterInterrupt: true,
  });
  assert.match(cleanup.stdout.toString("utf8"), /^v\d+/u);
});

test("interruption aborts pending HTTP and refuses later API or browser work while allowing cleanup", async () => {
  const pendingGuard = new RecoveryInterruptionGuard();
  let pendingFetchStarted = false;
  let pendingFetchAborted = false;
  const pending = apiRequest(
    "http://127.0.0.1:43123/rest/v1/organizations",
    {},
    [200],
    "pending_api_failed",
    "auth_rls_proof",
    pendingGuard,
    {
      fetchImpl: async (_url, { signal }) => {
        pendingFetchStarted = true;
        return await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            pendingFetchAborted = true;
            reject(new Error("aborted"));
          }, { once: true });
        });
      },
    },
  );
  assert.equal(pendingFetchStarted, true);
  pendingGuard.latch("SIGINT");
  await expectCodeAsync(() => pending, "operation_interrupted");
  assert.equal(pendingFetchAborted, true);

  const latchedGuard = new RecoveryInterruptionGuard();
  latchedGuard.latch("SIGTERM");
  let laterApiInvocations = 0;
  await expectCodeAsync(
    () => apiRequest(
      "http://127.0.0.1:43123/rest/v1/organizations",
      {},
      [200],
      "later_api_failed",
      "auth_rls_proof",
      latchedGuard,
      {
        fetchImpl: async () => {
          laterApiInvocations += 1;
          return new Response(null, { status: 200 });
        },
      },
    ),
    "operation_started_after_interruption",
  );
  assert.equal(laterApiInvocations, 0);

  let laterBrowserInvocations = 0;
  await expectCodeAsync(
    () => runBrowserOperation(latchedGuard, async () => { laterBrowserInvocations += 1; }),
    "operation_started_after_interruption",
  );
  assert.equal(laterBrowserInvocations, 0);

  let cleanupInvocations = 0;
  await latchedGuard.run("cleanup", async () => { cleanupInvocations += 1; }, { allowAfterInterrupt: true });
  assert.equal(cleanupInvocations, 1);
});

test("browser proof requires a 2xx response, exact final route and loaded module marker", () => {
  const valid = {
    appOrigin: "http://127.0.0.1:43123",
    requestedRoute: "/v3/calendar",
    responseStatus: 200,
    finalUrl: "http://127.0.0.1:43123/v3/calendar",
    moduleMarker: "calendar_heading",
    markerVisible: true,
  };
  assert.deepEqual(validateBrowserRouteProof(valid), {
    route: "/v3/calendar",
    moduleMarker: "calendar_heading",
    responseStatus: 200,
  });
  expectCode(() => validateBrowserRouteProof({ ...valid, responseStatus: 500 }), "browser_route_response_failed");
  expectCode(() => validateBrowserRouteProof({ ...valid, finalUrl: "http://127.0.0.1:43123/login" }), "browser_final_route_mismatch");
  expectCode(() => validateBrowserRouteProof({ ...valid, finalUrl: "http://127.0.0.1:43124/v3/calendar" }), "browser_final_route_mismatch");
  expectCode(() => validateBrowserRouteProof({ ...valid, markerVisible: false }), "browser_module_marker_missing");
});

test("browser network policy allows only the exact loopback app origin and fails on any denied attempt", () => {
  const appOrigin = "http://127.0.0.1:43123";
  assert.equal(browserRequestAllowed(`${appOrigin}/v3/main`, appOrigin), true);
  assert.equal(browserRequestAllowed("http://127.0.0.1:54321/rest/v1/students", appOrigin), false);
  assert.equal(browserRequestAllowed("https://example.com/tracker", appOrigin), false);
  assert.equal(browserRequestAllowed("data:text/plain,ok", appOrigin), false);
  const clean = {
    allowedOriginSha256: hash(appOrigin),
    deniedExternalRequestCount: 0,
    serviceWorkers: "blocked",
    webSocketAttemptCount: 0,
    webSockets: "blocked_all",
  };
  assert.deepEqual(validateBrowserNetworkProof(clean), clean);
  expectCode(() => validateBrowserNetworkProof({ ...clean, deniedExternalRequestCount: 1 }), "browser_external_request_attempted");
  expectCode(() => validateBrowserNetworkProof({ ...clean, serviceWorkers: "allow" }), "browser_service_workers_not_blocked");
  expectCode(() => validateBrowserNetworkProof({ ...clean, webSocketAttemptCount: 1 }), "browser_websocket_attempted");
  expectCode(() => validateBrowserNetworkProof({ ...clean, webSockets: "same_origin" }), "browser_websockets_not_blocked");
  const contextIndex = source.indexOf('newContext({ locale: "ru-RU", serviceWorkers: "block" })');
  const httpRouteIndex = source.indexOf('context.route("**/*"', contextIndex);
  const webSocketRouteIndex = source.indexOf("installBrowserWebSocketBlocker(context", httpRouteIndex);
  const pageIndex = source.indexOf("context.newPage()", webSocketRouteIndex);
  assert.ok(contextIndex >= 0 && httpRouteIndex > contextIndex && webSocketRouteIndex > httpRouteIndex && pageIndex > webSocketRouteIndex);
  assert.doesNotMatch(source, /connectToServer/u);
});

test("WebSocket blocker rejects every socket without connecting to a server", async () => {
  let pattern;
  let handler;
  let browserStepCount = 0;
  const browserNetwork = { webSocketAttemptCount: 0 };
  await installBrowserWebSocketBlocker(
    {
      async routeWebSocket(receivedPattern, receivedHandler) {
        pattern = receivedPattern;
        handler = receivedHandler;
      },
    },
    browserNetwork,
    async (operation) => {
      browserStepCount += 1;
      return await operation();
    },
  );
  assert.equal(pattern, "**/*");
  assert.equal(browserStepCount, 1);

  let connected = false;
  let closeOptions;
  await handler({
    async close(options) { closeOptions = options; },
    connectToServer() { connected = true; },
  });
  assert.equal(browserNetwork.webSocketAttemptCount, 1);
  assert.equal(connected, false);
  assert.deepEqual(closeOptions, { code: 1008, reason: "Blocked by recovery isolation" });
});

test("durable isolation evidence is hash-only and rejects any source/destination identity collision", () => {
  const identities = {
    source: {
      projectRef: "iosckaqtovbbnssqcpde",
      urls: ["https://iosckaqtovbbnssqcpde.supabase.co", "postgresql://db.iosckaqtovbbnssqcpde.supabase.co:5432/postgres"],
      networks: ["managed-supabase:iosckaqtovbbnssqcpde"],
      volumes: ["managed-backup:backup-123", `managed-storage:${"a".repeat(64)}`],
    },
    destination: {
      projectRef: "evov3recoveryabcdef123456",
      urls: ["http://127.0.0.1:43123", "postgresql://postgres:supersecret@127.0.0.1:43124/postgres"],
      networks: ["evov3recoveryabcdef123456_private"],
      volumes: ["supabase_db_evov3recoveryabcdef123456", "supabase_storage_evov3recoveryabcdef123456"],
      appNetworkAttachment: null,
    },
  };
  const evidence = buildIsolationEvidence(identities, { requireComplete: true });
  assert.equal(evidence.status, "verified");
  assert.deepEqual(evidence.separation, {
    projectRefsUnequal: true,
    urlsDisjoint: true,
    networksDisjoint: true,
    volumesDisjoint: true,
  });
  assert.equal(JSON.stringify(evidence).includes(projectRef), false);
  assert.equal(JSON.stringify(evidence).includes("127.0.0.1"), false);
  assert.equal(JSON.stringify(evidence).includes("supersecret"), false);
  for (const field of ["projectRef", "urls", "networks", "volumes"]) {
    const collision = structuredClone(identities);
    if (field === "projectRef") collision.destination.projectRef = collision.source.projectRef;
    else collision.destination[field] = [collision.source[field][0]];
    expectCode(() => buildIsolationEvidence(collision, { requireComplete: true }), "source_destination_not_isolated");
  }
  const publicDestination = structuredClone(identities);
  publicDestination.destination.urls = ["https://example.com"];
  expectCode(() => buildIsolationEvidence(publicDestination, { requireComplete: true }), "destination_endpoint_not_loopback");
  const foreignNetwork = structuredClone(identities);
  foreignNetwork.destination.networks = ["bridge"];
  expectCode(() => buildIsolationEvidence(foreignNetwork, { requireComplete: true }), "destination_identity_invalid");
  const foreignVolume = structuredClone(identities);
  foreignVolume.destination.volumes = ["unrelated_volume"];
  expectCode(() => buildIsolationEvidence(foreignVolume, { requireComplete: true }), "destination_identity_invalid");
  expectCode(() => buildIsolationEvidence(identities, { requireComplete: true, requireAppNetwork: true }), "destination_app_network_missing");
});

function projectedContainer({ id, name, image = `sha256:${"e".repeat(64)}`, labels, networkMode, ports, networks }) {
  return [id, `/${name}`, image, labels, networkMode, ports, networks].map((value) => JSON.stringify(value)).join("\t");
}

test("egress-blocked recovery bridge derives the Supabase API target and proves one loopback-only candidate attachment", () => {
  const projectName = "evov3recoveryabcdef123456";
  const networkName = `${projectName}_private`;
  const networkId = "a".repeat(64);
  const kongId = "b".repeat(64);
  const authId = "c".repeat(64);
  const databaseId = "f".repeat(64);
  const appId = "d".repeat(64);
  const appImageId = `sha256:${"e".repeat(64)}`;
  assert.deepEqual(validateContainerCensusIds(`${kongId}\n${authId}\n${databaseId}\n`, ""), [kongId, authId, databaseId].sort());
  assert.deepEqual(validateContainerCensusIds(`${kongId}\n${authId}\n${databaseId}\n`, `${appId}\n`, { requireOwner: true }), [kongId, authId, databaseId, appId].sort());
  expectCode(() => validateContainerCensusIds(`${kongId}\n`, "", { requireOwner: true }), "container_census_invalid");
  const containerNetwork = (name, aliases = [name]) => ({
    [networkName]: { NetworkID: networkId, Aliases: aliases },
  });
  const network = (containers) => [{
    Id: networkId,
    Name: networkName,
    Driver: "bridge",
    Scope: "local",
    Internal: false,
    EnableIPv6: false,
    Ingress: false,
    Options: {
      "com.docker.network.bridge.enable_ip_masquerade": "false",
      "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1",
    },
    Labels: { "evo.recovery.owner": projectName },
    Containers: containers,
  }];
  const supabaseMembers = {
    [kongId]: { Name: `supabase_kong_${projectName}` },
    [authId]: { Name: `supabase_auth_${projectName}` },
    [databaseId]: { Name: `supabase_db_${projectName}` },
  };
  const baseProjection = [
    projectedContainer({
      id: kongId,
      name: supabaseMembers[kongId].Name,
      labels: { "com.supabase.cli.project": projectName },
      networkMode: networkName,
      ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "43121" }] },
      networks: containerNetwork(supabaseMembers[kongId].Name, [supabaseMembers[kongId].Name, "kong"]),
    }),
    projectedContainer({
      id: authId,
      name: supabaseMembers[authId].Name,
      labels: { "com.supabase.cli.project": projectName },
      networkMode: networkName,
      ports: { "9999/tcp": null },
      networks: containerNetwork(supabaseMembers[authId].Name),
    }),
    projectedContainer({
      id: databaseId,
      name: supabaseMembers[databaseId].Name,
      labels: { "com.supabase.cli.project": projectName },
      networkMode: networkName,
      ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "43122" }] },
      networks: containerNetwork(supabaseMembers[databaseId].Name),
    }),
  ].join("\n");
  const endpoint = validateLocalSupabaseNetwork(network(supabaseMembers), baseProjection, {
    apiUrl: "http://127.0.0.1:43121",
    censusIds: [kongId, authId, databaseId],
    networkName,
    projectName,
  });
  assert.deepEqual(endpoint, {
    networkId,
    memberIds: [kongId, authId, databaseId].sort(),
    targetHost: supabaseMembers[kongId].Name,
    targetPort: 8000,
    apiLoopbackPort: 43121,
    databaseContainerId: databaseId,
  });

  const appName = `supabase_app_${projectName}`;
  const appProjection = projectedContainer({
    id: appId,
    name: appName,
    image: appImageId,
    labels: { "evo.recovery.owner": projectName },
    networkMode: networkName,
    ports: { "3000/tcp": null, "43123/tcp": [{ HostIp: "127.0.0.1", HostPort: "43123" }] },
    networks: containerNetwork(appName),
  });
  const candidateProjection = `${baseProjection}\n${appProjection}`;
  const candidateExpected = {
    appContainerId: appId,
    appContainerName: appName,
    appImageId,
    appPort: 43123,
    censusIds: [...endpoint.memberIds, appId],
    networkName,
    previousMemberIds: endpoint.memberIds,
    projectName,
  };
  const attachment = validateCandidateNetworkAttachment(
    network({ ...supabaseMembers, [appId]: { Name: appName } }),
    candidateProjection,
    candidateExpected,
  );
  assert.deepEqual(attachment, {
    schema: "evo-v3-recovery-app-network/v1",
    appContainerIdSha256: hash(appId),
    appImageIdSha256: hash(appImageId),
    networkIdSha256: hash(networkId),
    attachedNetworkCount: 1,
    publishedPortCount: 1,
    loopbackOnly: true,
    externalEgress: "blocked_by_disabled_masquerade_and_runtime_probe",
  });

  const masqueradedNetwork = network(supabaseMembers);
  masqueradedNetwork[0].Options["com.docker.network.bridge.enable_ip_masquerade"] = "true";
  expectCode(() => validateLocalSupabaseNetwork(masqueradedNetwork, baseProjection, { apiUrl: "http://127.0.0.1:43121", censusIds: endpoint.memberIds, networkName, projectName }), "local_supabase_network_invalid");
  const wildcardProjection = baseProjection.replace('"127.0.0.1"', '"0.0.0.0"');
  expectCode(() => validateLocalSupabaseNetwork(network(supabaseMembers), wildcardProjection, { apiUrl: "http://127.0.0.1:43121", censusIds: endpoint.memberIds, networkName, projectName }), "local_supabase_container_inspection_invalid");
  const duplicateApiProjection = baseProjection.replace(
    '{"9999/tcp":null}',
    '{"9999/tcp":[{"HostIp":"127.0.0.1","HostPort":"43121"}]}',
  );
  expectCode(
    () => validateLocalSupabaseNetwork(network(supabaseMembers), duplicateApiProjection, { apiUrl: "http://127.0.0.1:43121", censusIds: endpoint.memberIds, networkName, projectName }),
    "local_supabase_api_endpoint_ambiguous",
  );
  const wrongProjectProjection = baseProjection.replace(
    `"com.supabase.cli.project":"${projectName}"`,
    '"com.supabase.cli.project":"foreign-project"',
  );
  expectCode(
    () => validateLocalSupabaseNetwork(network(supabaseMembers), wrongProjectProjection, { apiUrl: "http://127.0.0.1:43121", censusIds: endpoint.memberIds, networkName, projectName }),
    "local_supabase_container_inspection_invalid",
  );
  const hostApp = appProjection.replace(JSON.stringify(networkName), JSON.stringify("host"));
  expectCode(
    () => validateCandidateNetworkAttachment(network({ ...supabaseMembers, [appId]: { Name: appName } }), `${baseProjection}\n${hostApp}`, candidateExpected),
    "candidate_network_attachment_invalid",
  );
  const publicApp = appProjection.replace('"127.0.0.1"', '"0.0.0.0"');
  expectCode(
    () => validateCandidateNetworkAttachment(network({ ...supabaseMembers, [appId]: { Name: appName } }), `${baseProjection}\n${publicApp}`, candidateExpected),
    "candidate_network_attachment_invalid",
  );
  const extraNetworkApp = projectedContainer({
    id: appId,
    name: appName,
    image: appImageId,
    labels: { "evo.recovery.owner": projectName },
    networkMode: networkName,
    ports: { "43123/tcp": [{ HostIp: "127.0.0.1", HostPort: "43123" }] },
    networks: { ...containerNetwork(appName), bridge: { NetworkID: "f".repeat(64), Aliases: [appName] } },
  });
  expectCode(
    () => validateCandidateNetworkAttachment(network({ ...supabaseMembers, [appId]: { Name: appName } }), `${baseProjection}\n${extraNetworkApp}`, candidateExpected),
    "candidate_network_attachment_invalid",
  );
  const extraPublishedPortApp = projectedContainer({
    id: appId,
    name: appName,
    image: appImageId,
    labels: { "evo.recovery.owner": projectName },
    networkMode: networkName,
    ports: {
      "43123/tcp": [{ HostIp: "127.0.0.1", HostPort: "43123" }],
      "43124/tcp": [{ HostIp: "127.0.0.1", HostPort: "43124" }],
    },
    networks: containerNetwork(appName),
  });
  expectCode(
    () => validateCandidateNetworkAttachment(network({ ...supabaseMembers, [appId]: { Name: appName } }), `${baseProjection}\n${extraPublishedPortApp}`, candidateExpected),
    "candidate_network_attachment_invalid",
  );
  expectCode(
    () => validateCandidateNetworkAttachment(
      network({ ...supabaseMembers, [appId]: { Name: appName } }),
      candidateProjection,
      { ...candidateExpected, censusIds: [kongId, appId] },
    ),
    "candidate_container_census_mismatch",
  );
  const orphanId = "9".repeat(64);
  expectCode(
    () => validateLocalSupabaseNetwork(network(supabaseMembers), baseProjection, {
      apiUrl: "http://127.0.0.1:43121", censusIds: [...endpoint.memberIds, orphanId], networkName, projectName,
    }),
    "local_supabase_container_census_mismatch",
  );

  const verifiedIdentities = {
    source: {
      projectRef,
      urls: [`https://${projectRef}.supabase.co`],
      networks: [`managed-supabase:${projectRef}`],
      volumes: ["managed-backup:backup-123"],
    },
    destination: {
      projectRef: projectName,
      urls: ["http://127.0.0.1:43121", "http://127.0.0.1:43123"],
      networks: [networkName],
      volumes: [`supabase_db_${projectName}`],
      appNetworkAttachment: attachment,
    },
  };
  const durable = buildIsolationEvidence(verifiedIdentities, { requireComplete: true, requireAppNetwork: true });
  assert.deepEqual(durable.destination.appNetworkAttachment, attachment);
  assert.equal(JSON.stringify(durable).includes(appName), false);
});

test("candidate image is locally built from sorted exact target blobs for linux/amd64", async (t) => {
  const required = [".dockerignore", "Dockerfile", "package.json", "package-lock.json", "scripts/check-node-runtime.mjs"];
  const listing = Buffer.from(required.map((path, index) => `100644 blob ${String(index + 1).repeat(40)}\t${path}\0`).join(""), "utf8");
  assert.deepEqual(parseTargetTreeListing(listing).map(({ path }) => path), required);
  const reversed = parseTargetTreeListing(Buffer.from([...required].reverse().map((path, index) => `100644 blob ${String(index + 1).repeat(40)}\t${path}\0`).join(""), "utf8"));
  const ordered = orderedTargetEntries(reversed, "sha1");
  assert.deepEqual(ordered.map(({ path }) => path), [...required].sort((left, right) => left.localeCompare(right, "en")));
  assert.equal(ordered.find(({ path }) => path === required.at(-1)).oid, "1".repeat(40));
  expectCode(() => orderedTargetEntries(reversed, "sha256"), "target_snapshot_object_format_mismatch");
  expectCode(() => parseTargetTreeListing(Buffer.from(`120000 blob ${"a".repeat(40)}\tDockerfile\0`, "utf8")), "target_snapshot_git_entry_invalid");
  expectCode(() => parseTargetTreeListing(Buffer.from(`100644 blob ${"a".repeat(40)}\t.GiT/config\0`, "utf8")), "target_snapshot_path_invalid");
  expectCode(() => parseTargetTreeListing(Buffer.from(`100644 blob ${"a".repeat(40)}\t.g\u200cit/config\0`, "utf8")), "target_snapshot_path_invalid");
  const blobRoot = mkdtempSync(join(tmpdir(), "evo-recovery-blob-"));
  t.after(() => rmSync(blobRoot, { recursive: true, force: true }));
  const blob = join(blobRoot, "blob.txt");
  writeFileSync(blob, "hello\n", { mode: 0o600 });
  assert.equal(await gitBlobOid(blob, "sha1"), "ce013625030ba8dba906f756967f9e9ca394464a");
  const sha256Blob = createHash("sha256").update("blob 6\0hello\n").digest("hex");
  assert.equal(await gitBlobOid(blob, "sha256"), sha256Blob);
  const imageId = `sha256:${"d".repeat(64)}`;
  const projectName = "evov3recoveryabcdef123456";
  const archiveSha256 = "e".repeat(64);
  const labels = {
    "org.opencontainers.image.revision": targetCommit,
    "evo.recovery.owner": projectName,
    "evo.recovery.target-tree": targetFullTree,
    "evo.recovery.snapshot-archive-sha256": archiveSha256,
    "evo.recovery.build-network": "dependency-fetch-only",
  };
  const projection = `${JSON.stringify(imageId)}\t[]\t${JSON.stringify(labels)}\t"linux"\t"amd64"\n`;
  const image = validateBuiltImageInspection(projection, {
    archiveSha256,
    imageId,
    projectName,
    targetCommit,
    targetTree: targetFullTree,
  });
  assert.equal(image.id, imageId);
  assert.equal(image.operatingSystem, "linux");
  assert.equal(image.architecture, "amd64");
  expectCode(() => validateBuiltImageInspection(projection.replace('"amd64"', '"arm64"'), {
    archiveSha256,
    imageId,
    projectName,
    targetCommit,
    targetTree: targetFullTree,
  }), "app_image_provenance_mismatch");
  expectCode(() => validateBuiltImageInspection(projection, {
    archiveSha256,
    imageId,
    projectName,
    targetCommit,
    targetTree: sourceFullTree,
  }), "app_image_provenance_mismatch");
  assert.match(source, /\["archive", "--format=tar", "--output", archive, repository\.target\.commit\]/u);
  assert.match(source, /"--network=default"/u);
  assert.match(source, /"--platform=linux\/amd64"/u);
  assert.doesNotMatch(source, /"--network=none"/u);
  assert.doesNotMatch(source, /\["hash-object", "--stdin-paths"\]/u);
  assert.match(source, /image\.id,/u);
  assert.match(source, /NODE_ENV: "production"/u);
  assert.doesNotMatch(source, /NODE_ENV: "development"/u);
});

test("detached SSH signature accepts exact namespace and rejects receipt tamper/spoof", async (t) => {
  if (process.platform === "win32") return t.skip("OpenSSH process-group contract is Unix-only");
  const root = mkdtempSync(join(tmpdir(), "evo-recovery-signature-test-"));
  chmodSync(root, 0o700);
  const key = join(root, "key");
  const backup = join(root, "backup");
  const harness = join(root, "harness");
  const tamperedHarness = join(root, "tampered-harness");
  const spoofHarness = join(root, "spoof-harness");
  const backupKeyHarness = join(root, "backup-key-harness");
  const repositoryKeyHarness = join(root, "repository-key-harness");
  try {
    execFileSync("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key], { stdio: "ignore" });
    chmodSync(`${key}.pub`, 0o600);
    for (const path of [backup, harness, tamperedHarness, spoofHarness, backupKeyHarness, repositoryKeyHarness]) {
      mkdirSync(path, { mode: 0o700 });
    }
    const receiptPath = join(backup, "receipt.json");
    writeFileSync(receiptPath, "signed receipt\n", { mode: 0o600 });
    execFileSync("/usr/bin/ssh-keygen", ["-Y", "sign", "-f", key, "-n", "evo-v3-managed-supabase-recovery", receiptPath], { stdio: "ignore" });
    chmodSync(`${receiptPath}.sig`, 0o600);
    const toolchain = { paths: { sshKeygen: { real: "/usr/bin/ssh-keygen" } } };
    const verified = await verifyReceiptSignature({ backupDir: backup, trustedPublicKey: `${key}.pub` }, harness, new ProcessSupervisor(), toolchain);
    assert.match(verified.fingerprint, /^SHA256:/u);
    writeFileSync(receiptPath, "tampered receipt\n", { mode: 0o600 });
    await expectCodeAsync(() => verifyReceiptSignature({ backupDir: backup, trustedPublicKey: `${key}.pub` }, tamperedHarness, new ProcessSupervisor(), toolchain), "receipt_signature_invalid");
    writeFileSync(receiptPath, "spoof namespace\n", { mode: 0o600 });
    rmSync(`${receiptPath}.sig`);
    execFileSync("/usr/bin/ssh-keygen", ["-Y", "sign", "-f", key, "-n", "wrong-namespace", receiptPath], { stdio: "ignore" });
    chmodSync(`${receiptPath}.sig`, 0o600);
    await expectCodeAsync(() => verifyReceiptSignature({ backupDir: backup, trustedPublicKey: `${key}.pub` }, spoofHarness, new ProcessSupervisor(), toolchain), "receipt_signature_invalid");
    const backupKey = join(backup, "trusted.pub");
    writeFileSync(backupKey, readFileSync(`${key}.pub`), { mode: 0o600, flag: "wx" });
    await expectCodeAsync(
      () => verifyReceiptSignature({ backupDir: backup, trustedPublicKey: backupKey }, backupKeyHarness, new ProcessSupervisor(), toolchain),
      "trusted_public_key_not_independent",
    );
    const repositoryLink = join(root, "repository-link");
    symlinkSync(fileURLToPath(new URL("..", import.meta.url)), repositoryLink, "dir");
    await expectCodeAsync(
      () => verifyReceiptSignature({ backupDir: backup, trustedPublicKey: join(repositoryLink, "package.json") }, repositoryKeyHarness, new ProcessSupervisor(), toolchain),
      "trusted_public_key_not_independent",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; }
}

test("tracked process groups TERM then drain descendants and timeouts cannot orphan work", async (t) => {
  if (process.platform === "win32") return t.skip("Unix process-group semantics");
  const supervisor = new ProcessSupervisor();
  const record = supervisor.start(process.execPath, ["-e", `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    process.stdout.write(String(child.pid) + '\\n');
    setInterval(() => {}, 1000);
  `]);
  const deadline = Date.now() + 2_000;
  while (!record.stdout.toString("utf8").trim() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const descendant = Number(record.stdout.toString("utf8").trim());
  assert.equal(Number.isInteger(descendant), true);
  assert.equal(await supervisor.stopOne(record), true);
  const drainDeadline = Date.now() + 2_000;
  while (processAlive(descendant) && Date.now() < drainDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(processAlive(descendant), false);
  await expectCodeAsync(() => supervisor.run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 50, timeoutCode: "bounded_timeout", stage: "test" }), "bounded_timeout");
  assert.equal(await supervisor.stopAll(), true);
});

test("tracked commands preserve an explicit validated argv0 for multi-call tools", async () => {
  const supervisor = new ProcessSupervisor();
  const result = await supervisor.run(
    process.execPath,
    ["-e", "process.stdout.write(process.argv0)"],
    { argv0: "docker", stage: "toolchain", timeoutMs: 10_000 },
  );
  assert.equal(result.stdout.toString("utf8"), "docker");
  await expectCodeAsync(
    () => supervisor.run(process.execPath, ["--version"], { argv0: "../docker", stage: "toolchain" }),
    "command_argv0_invalid",
  );

  const record = supervisor.start(
    process.execPath,
    ["-e", "process.stdout.write(process.argv0)"],
    { argv0: "docker", stage: "toolchain" },
  );
  const status = await new Promise((resolve, reject) => {
    record.child.once("error", reject);
    record.child.once("close", resolve);
  });
  assert.equal(status, 0);
  assert.equal(record.stdout.toString("utf8"), "docker");
  assert.equal(await supervisor.stopOne(record), true);
  expectCode(
    () => supervisor.start(process.execPath, ["--version"], { argv0: "../docker", stage: "toolchain" }),
    "command_argv0_invalid",
  );
});

test("tracked long-lived spawn failures are observed and remain drainable", async () => {
  const supervisor = new ProcessSupervisor();
  const record = supervisor.start(join(tmpdir(), `missing-recovery-tool-${process.pid}`), [], { stage: "browser_proof" });
  const deadline = Date.now() + 2_000;
  while (!record.spawnError && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(record.spawnError?.code, "ENOENT");
  assert.equal(await supervisor.stopOne(record), true);
  assert.equal(await supervisor.stopAll(), true);
});

test("shutdown during a long restore drains its descendant before the restore rejects", async (t) => {
  if (process.platform === "win32") return t.skip("Unix process-group semantics");
  const supervisor = new ProcessSupervisor();
  let descendant;
  const running = supervisor.run(process.execPath, ["-e", `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    process.stdout.write(String(child.pid) + '\\n');
    setInterval(() => {}, 1000);
  `], { stage: "database_restore", code: "restore_interrupted", timeoutMs: 30_000 });
  const settled = running.then(
    () => null,
    (error) => error,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const record of supervisor.children) descendant = Number(record.stdout?.toString("utf8").trim());
  assert.equal(Number.isInteger(descendant), true);
  assert.equal(await supervisor.stopAll(), true);
  const error = await settled;
  assert.equal(error instanceof RecoveryFailure && error.code === "restore_interrupted", true);
  const deadline = Date.now() + 2_000;
  while (processAlive(descendant) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(processAlive(descendant), false);
});

test("unsafe drain or ownership always quarantines cleanup", () => {
  assert.equal(cleanupDisposition({ descendantsDrained: true, targetsOwned: true, cleanupSucceeded: true }), "remove");
  assert.equal(cleanupDisposition({ descendantsDrained: false, targetsOwned: true, cleanupSucceeded: true }), "quarantine");
  assert.equal(cleanupDisposition({ descendantsDrained: true, targetsOwned: false, cleanupSucceeded: true }), "quarantine");
  assert.equal(cleanupDisposition({ descendantsDrained: true, targetsOwned: true, cleanupSucceeded: false }), "quarantine");
});

test("cleanup inventory selects only the exact isolated Supabase contour", () => {
  const project = "evov3recoveryabcdef123456";
  assert.deepEqual(selectOwnedContainerIds([
    `aaaaaaaaaaaa\tsupabase_db_${project}`,
    "bbbbbbbbbbbb\tsupabase_db_other",
    `cccccccccccc\tnotsupabase_${project}`,
  ].join("\n"), project), ["aaaaaaaaaaaa"]);
  assert.deepEqual(selectOwnedVolumeNames([
    `supabase_db_${project}`,
    `supabase_storage_${project}`,
    "supabase_db_other",
  ].join("\n"), project), [`supabase_db_${project}`, `supabase_storage_${project}`]);
  const network = `${project}_private`;
  assert.deepEqual(selectOwnedNetworkNames(`${network}\nbridge\n`, network), [network]);
  const imageId = `sha256:${"d".repeat(64)}`;
  const secondImageId = `sha256:${"e".repeat(64)}`;
  assert.deepEqual(selectCandidateImageIds(`${imageId}\n${secondImageId}\n${imageId}\n`), [imageId, secondImageId]);
  assert.deepEqual(selectOwnedImageIds([
    `${JSON.stringify(imageId)}\t${JSON.stringify([`evo-v3-recovery-${project}:candidate`])}\t${JSON.stringify({ "evo.recovery.owner": project })}`,
    `${JSON.stringify(secondImageId)}\t${JSON.stringify([])}\t${JSON.stringify({ "evo.recovery.owner": project })}`,
  ].join("\n"), project), [imageId, secondImageId]);
  expectCode(() => selectOwnedContainerIds("bad", project), "cleanup_container_inventory_invalid");
  expectCode(() => selectCandidateImageIds("bad"), "cleanup_image_list_invalid");
  expectCode(() => selectOwnedImageIds("bad", project), "cleanup_image_inventory_invalid");
  expectCode(() => selectOwnedImageIds(
    `${JSON.stringify(imageId)}\t${JSON.stringify(["unrelated:latest"])}\t${JSON.stringify({ "evo.recovery.owner": "other" })}`,
    project,
  ), "cleanup_image_inventory_invalid");
});

test("cleanup is local-only before container preflight and quarantines contradictory mutation state", async (t) => {
  const createRoot = () => {
    const root = mkdtempSync(join(tmpdir(), "evo-v3-managed-recovery-"));
    chmodSync(root, 0o700);
    writeFileSync(join(root, ".evo-v3-managed-recovery-harness"), "owned\n", { mode: 0o600 });
    return root;
  };
  let runtimeCalls = 0;
  const supervisor = {
    stopAll: async () => true,
    run: async () => {
      runtimeCalls += 1;
      throw new Error("container runtime must not be called");
    },
  };
  const localRoot = createRoot();
  const local = await cleanupState({
    harnessRoot: localRoot,
    containerPreflightPassed: false,
    containerMutationAttempted: false,
    networkCreated: false,
    stackStarted: false,
  }, supervisor, undefined);
  assert.equal(local.containerPolicy, "local_only");
  assert.equal(local.disposition, "remove");
  assert.equal(runtimeCalls, 0);

  const contradictoryRoot = createRoot();
  t.after(() => {
    const prefix = `${basename(contradictoryRoot)}.quarantine-`;
    for (const name of readdirSync(tmpdir()).filter((entry) => entry.startsWith(prefix))) {
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
    }
  });
  assert.equal(cleanupContainerPolicy({
    containerPreflightPassed: false,
    containerMutationAttempted: false,
    networkCreated: true,
    stackStarted: false,
  }, false), "quarantine");
  const quarantined = await cleanupState({
    harnessRoot: contradictoryRoot,
    containerPreflightPassed: false,
    containerMutationAttempted: false,
    networkCreated: true,
    stackStarted: false,
  }, supervisor, undefined);
  assert.equal(quarantined.containerPolicy, "quarantine");
  assert.equal(quarantined.disposition, "quarantine");
  assert.equal(runtimeCalls, 0);
});

test("Supabase launcher pins the platform-native executable children", () => {
  const chain = resolveSupabaseExecutableChain();
  assert.match(chain.launcher.real, /node_modules\/supabase\/dist\/supabase\.js$/u);
  assert.match(chain.native.real, /node_modules\/@supabase\/cli-[^/]+\/bin\/supabase(?:\.exe)?$/u);
  assert.match(chain.go.real, /node_modules\/@supabase\/cli-[^/]+\/bin\/supabase-go(?:\.exe)?$/u);
  assert.notEqual(chain.launcher.real, chain.native.real);
  assert.equal(chain.packageVersion, "2.116.0");
  assert.match(chain.binLinkSha256, /^[0-9a-f]{64}$/u);
  assert.match(source, /supervisor\.run\(toolchain\.paths\.supabaseNative\.real/u);
  assert.doesNotMatch(source, /supervisor\.run\(toolchain\.paths\.supabase\.real/u);
  assert.match(source, /SUPABASE_GO_BINARY: paths\.supabaseGo\.real/u);
});

test("all Docker commands preserve the verified docker frontend name", () => {
  assert.match(
    source,
    /function runDocker\(supervisor, executable, args, options = \{\}\) \{\s+return supervisor\.run\(executable\.real, args, \{ \.\.\.options, argv0: "docker" \}\);/u,
  );
  assert.doesNotMatch(source, /supervisor\.run\((?:toolchain\.paths|tools)\.docker\.real/u);
  assert.ok(source.split("runDocker(").length - 1 > 10);
});

test("diagnostics are hash-only and implementation has no sync executor or synthetic actor path", () => {
  const diagnostic = sanitizeCommandDiagnostic("password=secret connection refused", 1);
  assert.deepEqual(Object.keys(diagnostic).sort(), ["bytes", "category", "outputSha256", "status"]);
  assert.equal(JSON.stringify(diagnostic).includes("secret"), false);
  assert.equal(source.includes("spawnSync"), false);
  assert.equal(source.includes("provisionLocalRepresentative"), false);
  assert.equal(source.includes("INSERT INTO platform.organizations"), false);
  assert.match(source, /history-schema\.sql\.age/u);
  assert.match(source, /history-data\.sql\.age/u);
  assert.match(source, /receipt\.json\.sig/u);
  assert.doesNotMatch(source, /--network", "host"/u);
  assert.doesNotMatch(source, /"network", "create", "--internal"/u);
  assert.match(source, /com\.docker\.network\.bridge\.enable_ip_masquerade=false/u);
  assert.match(source, /bridge_ip_masquerade_disabled_plus_runtime_probe/u);
  assert.match(source, /"--network", state\.networkName/u);
  assert.match(source, /"--publish", `127\.0\.0\.1:\$\{appPort\}:\$\{appPort\}`/u);
  assert.match(source, /SAFE_CONTAINER_INSPECT_FORMAT/u);
  assert.match(source, /target=\/opt\/evo-recovery-entry\.mjs,readonly/u);
  assert.match(source, /await import\("\/app\/server\.js"\)/u);
  assert.match(source, /change_membership_permission/u);
  assert.match(source, /ROLLBACK/u);
  assert.match(source, /selectAdmissionsTaskMutation\(\{/u);
  assert.match(source, /\.\.\.await reconcileRestoredDatabase\(/u);
  assert.match(source, /classifyExpectedDatabaseDenial\(error\.diagnostic/u);
  assert.match(source, /response\?\.status\(\) \?\? 0/u);
  assert.match(source, /buildIsolationEvidence\(state\.isolationInput, \{ requireComplete: true \}\)/u);
  assert.match(source, /requireAppNetwork: true/u);
  const evidenceBuild = source.lastIndexOf("const evidence = buildDurableEvidence");
  const evidenceWrite = source.lastIndexOf("writeEvidence(evidenceOut, evidence)");
  const listenerRemoval = source.lastIndexOf('process.removeListener("SIGINT", sigint)');
  assert.ok(evidenceBuild > 0 && evidenceBuild < evidenceWrite);
  assert.ok(evidenceWrite < listenerRemoval);
});

test("focused recovery harness is registered exactly once in the CI-invoked u11 suite", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const fullWorkflow = readFileSync(new URL("../.github/workflows/evo-platform-ci.yml", import.meta.url), "utf8");
  const fastPrWorkflow = readFileSync(new URL("../.github/workflows/evo-fast-pr-checks.yml", import.meta.url), "utf8");
  const testName = "tests/v3-managed-supabase-recovery-harness.test.mjs";
  assert.equal(packageJson.scripts["test:u11"].split(testName).length - 1, 1);
  assert.equal(packageJson.scripts["test:fast-release"].includes(testName), false);
  assert.equal(fullWorkflow.includes(testName), false);
  assert.doesNotMatch(fullWorkflow, /test:database:migration-boundaries/u);
  assert.match(fastPrWorkflow, /run: npm run test:database:migration-boundaries/u);
  assert.match(
    fastPrWorkflow,
    /if: \$\{\{ needs\.changed-range\.outputs\.migration_boundary == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}/u,
  );
});
