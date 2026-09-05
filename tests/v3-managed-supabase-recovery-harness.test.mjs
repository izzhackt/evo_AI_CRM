import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ProcessSupervisor,
  RecoveryInterruptionGuard,
  RecoveryFailure,
  apiRequest,
  buildDurableEvidence,
  buildIsolationEvidence,
  canonicalJson,
  classifyExpectedDatabaseDenial,
  cleanupDisposition,
  databaseAggregatesFromTableCounts,
  extractExactMigrationLedger,
  latchInterruption,
  migrationStatementsDigest,
  parseHarnessOptions,
  runBrowserOperation,
  sanitizePsqlDiagnostic,
  sanitizeCommandDiagnostic,
  selectAdmissionsTaskMutation,
  selectOwnedContainerIds,
  selectOwnedNetworkNames,
  selectOwnedVolumeNames,
  validateBrowserRouteProof,
  validateDatabaseManifest,
  validateImmutableImageInspection,
  validateRepresentativeCohort,
  validateRestoredDatabaseAggregates,
  validateRestrictedSqlEnvelope,
  validateSignedReceipt,
  validateStorageManifest,
  validateWriteBoundaryResults,
  verifyLedgerAgainstRoot,
  verifyReceiptSignature,
  verifyRestoredStorageInventory,
} from "../scripts/test-v3-managed-supabase-recovery-orbstack.mjs";

const script = new URL("../scripts/test-v3-managed-supabase-recovery-orbstack.mjs", import.meta.url);
const source = readFileSync(script, "utf8");
const commit = "1".repeat(40);
const migrationTree = "2".repeat(40);
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
    managed_dump_inputs_sha256: "8".repeat(64),
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
  return { project, backup, pooler, sha256: hash(canonicalJson({ project, backup, pooler })) };
}

const sqlNames = ["roles.sql", "schema.sql", "history-schema.sql", "history-data.sql", "data.sql"];
const artifactDescriptors = Object.fromEntries(sqlNames.map((name, index) => [name, { bytes: 100 + index, sha256: String(index + 1).repeat(64) }]));
const semantic = Object.fromEntries(sqlNames.map((name, index) => [name, String(index + 5).repeat(64)]));
const stabilityProof = hash(canonicalJson(semantic));
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
    repositoryCommit: commit,
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
    { id: "platform-documents", name: "platform-documents", public: false, file_size_limit: 1000, allowed_mime_types: ["text/plain"], created_at: null, updated_at: null },
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
    "--repository-commit", commit,
    "--app-image", `evo-crm@sha256:${"e".repeat(64)}`,
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

test("arguments require immutable image, both organization bindings, and three distinct restored actors", () => {
  const parsed = parseHarnessOptions(optionsArgs(), {});
  assert.equal(parsed.projectRef, projectRef);
  assert.equal(parsed.supabaseOrganizationId, supabaseOrganizationId);
  assert.equal(parsed.platformOrganizationId, platformOrganizationId);
  expectCode(() => parseHarnessOptions(optionsArgs().filter((_, index) => ![10, 11].includes(index)), {}), "required_argument_missing");
  const mutable = optionsArgs();
  mutable[mutable.indexOf("--app-image") + 1] = "evo-crm:latest";
  expectCode(() => parseHarnessOptions(mutable, {}), "app_image_not_immutable");
  const duplicate = optionsArgs();
  duplicate[duplicate.indexOf("--sales-user-id") + 1] = adminUserId;
  expectCode(() => parseHarnessOptions(duplicate, {}), "representative_user_ids_not_distinct");
});

test("receipt accepts only exact #636 schema and exact signing identity/fingerprint", () => {
  const result = validatedReceipt();
  assert.equal(result.sourceIdentity, sourceReceipt().sha256);
  assert.equal(result.encryptedArtifacts["history-data.sql.age"].bytes, 204);
  expectCode(() => validateSignedReceipt(receipt({ schema: "evo-managed-supabase-export/v1" }), {
    repositoryCommit: commit, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_schema_invalid");
  expectCode(() => validateSignedReceipt(receipt({ signature: { ...receipt().signature, namespace: "spoof" } }), {
    repositoryCommit: commit, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_signature_metadata_invalid");
  expectCode(() => validateSignedReceipt(receipt(), {
    repositoryCommit: commit, trustedFingerprint: "SHA256:different", now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_signature_metadata_invalid");
  expectCode(() => validateSignedReceipt(receipt({ database: { ...receipt().database, snapshot_mode: "independent-dumps" } }), {
    repositoryCommit: commit, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
  }), "receipt_database_snapshot_mode_invalid");
  const missingArtifact = receipt();
  delete missingArtifact.encrypted_artifacts["history-schema.sql.age"];
  expectCode(() => validateSignedReceipt(missingArtifact, {
    repositoryCommit: commit, trustedFingerprint: fingerprint, now: new Date("2026-09-05T01:00:00.000Z"), maxAgeHours: 72,
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

test("exact history parser binds ordered full COPY rows and rejects reconstruction", () => {
  const sql = historySql();
  const ledger = extractExactMigrationLedger(sql);
  assert.deepEqual(ledger.entries.map(({ version, name }) => ({ version, name })), [
    { version: "001", name: "initial_schema" },
    { version: "002", name: "add_students" },
  ]);
  const summary = { count: 2, min_version: "001", max_version: "002", copy_rows_sha256: ledger.copyRowsSha256 };
  const rootEntry = (version, name, sql) => ({ version, name, ...migrationStatementsDigest(sql) });
  const root = { entries: [
    rootEntry("001", "initial_schema", "first;"),
    rootEntry("002", "add_students", "second;"),
    rootEntry("003", "next", "next;"),
  ] };
  assert.deepEqual(verifyLedgerAgainstRoot(ledger, root, summary).pending.map((entry) => entry.version), ["003"]);
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
});

test("restored Storage inventory requires exact identity, version and streamed byte digest with no extras", () => {
  const source = [{
    bucket_id: "platform-documents",
    path: "org/document.pdf",
    source_id: "50000000-0000-4000-8000-000000000001",
    source_version: "60000000-0000-4000-8000-000000000001",
    sha256: "a".repeat(64),
    bytes: 42,
  }];
  const identities = source.map(({ source_id, source_version, bucket_id, path }) => ({ source_id, source_version, bucket_id, path }));
  const readbacks = source.map(({ bucket_id, path, sha256, bytes }) => ({ bucket_id, path, sha256, bytes }));
  assert.deepEqual(verifyRestoredStorageInventory(source, identities, readbacks), {
    objectCount: 1,
    totalBytes: 42,
    restoredInventorySha256: hash(canonicalJson(source)),
  });
  expectCode(() => verifyRestoredStorageInventory(source, [{ ...identities[0], source_version: "60000000-0000-4000-8000-000000000002" }], readbacks), "restored_storage_identity_mismatch");
  expectCode(() => verifyRestoredStorageInventory(source, identities, [{ ...readbacks[0], sha256: "b".repeat(64) }]), "restored_storage_content_mismatch");
  expectCode(() => verifyRestoredStorageInventory(source, identities, []), "restored_storage_readback_missing");
  expectCode(() => verifyRestoredStorageInventory(source, identities, [...readbacks, { ...readbacks[0], path: "org/extra.pdf" }]), "restored_storage_readback_extra");
});

test("all five SQL payloads require one matching active restricted-mode guard", () => {
  const sql = historySql();
  assert.match(validateRestrictedSqlEnvelope(sql, "history-data.sql").guardSha256, /^[0-9a-f]{64}$/u);
  expectCode(() => validateRestrictedSqlEnvelope(sql.replace("\\unrestrict", "-- \\unrestrict"), "history-data.sql"), "sql_restricted_guard_invalid");
  expectCode(() => validateRestrictedSqlEnvelope(sql.replace(`\\unrestrict ${"A".repeat(63)}`, `\\unrestrict ${"B".repeat(63)}`), "history-data.sql"), "sql_restricted_guard_invalid");
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

test("expected database denial requires the exact SQLSTATE and domain sentinel", () => {
  const expectedMessage = "Active scoped Admin permission membership.role.change is required";
  const expected = { sqlstate: "42501", domainSentinel: "admin_membership_permission_required" };
  const diagnostic = sanitizePsqlDiagnostic(`ERROR:  42501: ${expectedMessage}\nLOCATION:  exec_stmt_raise, pl_exec.c:3905\n`, 3);
  assert.equal(classifyExpectedDatabaseDenial(diagnostic, expected), true);
  assert.equal(JSON.stringify(diagnostic).includes(expectedMessage), false);
  assert.equal(classifyExpectedDatabaseDenial({ ...diagnostic, postgres: { ...diagnostic.postgres, sqlstate: "42P01" } }, expected), false);
  assert.equal(classifyExpectedDatabaseDenial({ ...diagnostic, postgres: { ...diagnostic.postgres, domainSentinel: null } }, expected), false);
  assert.equal(classifyExpectedDatabaseDenial(sanitizePsqlDiagnostic("connection refused", 2), expected), false);
  assert.equal(classifyExpectedDatabaseDenial(sanitizePsqlDiagnostic("ERROR:  42601: syntax error\n", 3), expected), false);
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
});

test("immutable image proof binds Docker id or RepoDigest and revision", () => {
  const digest = `evo-crm@sha256:${"e".repeat(64)}`;
  const image = [{ Id: `sha256:${"d".repeat(64)}`, RepoDigests: [digest], Config: { Labels: { "org.opencontainers.image.revision": commit } } }];
  assert.equal(validateImmutableImageInspection(image, digest).revision, commit);
  expectCode(() => validateImmutableImageInspection(image, `evo-crm@sha256:${"f".repeat(64)}`), "app_image_digest_mismatch");
  expectCode(() => validateImmutableImageInspection([{ ...image[0], Config: { Labels: {} } }], digest), "app_image_revision_missing");
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
  try {
    execFileSync("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key], { stdio: "ignore" });
    chmodSync(`${key}.pub`, 0o600);
    await import("node:fs").then(({ mkdirSync }) => { mkdirSync(backup, { mode: 0o700 }); mkdirSync(harness, { mode: 0o700 }); mkdirSync(tamperedHarness, { mode: 0o700 }); mkdirSync(spoofHarness, { mode: 0o700 }); });
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
  expectCode(() => selectOwnedContainerIds("bad", project), "cleanup_container_inventory_invalid");
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
  assert.match(source, /--network", "host"/u);
  assert.match(source, /change_membership_permission/u);
  assert.match(source, /ROLLBACK/u);
  assert.match(source, /selectAdmissionsTaskMutation\(admissionsTask\)/u);
  assert.match(source, /return await reconcileRestoredDatabase\(/u);
  assert.match(source, /classifyExpectedDatabaseDenial\(error\.diagnostic/u);
  assert.match(source, /response\?\.status\(\) \?\? 0/u);
  assert.match(source, /buildIsolationEvidence\(state\.isolationInput, \{ requireComplete: true \}\)/u);
  const evidenceBuild = source.lastIndexOf("const evidence = buildDurableEvidence");
  const evidenceWrite = source.lastIndexOf("writeEvidence(evidenceOut, evidence)");
  const listenerRemoval = source.lastIndexOf('process.removeListener("SIGINT", sigint)');
  assert.ok(evidenceBuild > 0 && evidenceBuild < evidenceWrite);
  assert.ok(evidenceWrite < listenerRemoval);
});

test("focused recovery harness is registered exactly once in the CI-invoked u11 suite", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const testName = "tests/v3-managed-supabase-recovery-harness.test.mjs";
  assert.equal(packageJson.scripts["test:u11"].split(testName).length - 1, 1);
  assert.equal(packageJson.scripts["test:fast-release"].includes(testName), false);
});
