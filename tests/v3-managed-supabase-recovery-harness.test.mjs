import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ProcessSupervisor,
  RecoveryFailure,
  canonicalJson,
  cleanupDisposition,
  extractExactMigrationLedger,
  parseHarnessOptions,
  sanitizeCommandDiagnostic,
  selectOwnedContainerIds,
  selectOwnedNetworkNames,
  selectOwnedVolumeNames,
  validateDatabaseManifest,
  validateImmutableImageInspection,
  validateRepresentativeCohort,
  validateRestrictedSqlEnvelope,
  validateSignedReceipt,
  validateStorageManifest,
  verifyLedgerAgainstRoot,
  verifyReceiptSignature,
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
    stability: { artifact_semantic_sha256: semantic, proof_sha256: stabilityProof },
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
});

test("Storage manifest is exact, source-bound, private-bucket aware, and traversal safe", () => {
  const valid = validateStorageManifest(storageManifest(), { receipt: validatedReceipt(), databaseCapturedAt: capturedAt });
  assert.equal(valid.aggregates.private_bucket_count, 1);
  const object = { bucket_id: "platform-documents", path: "org/file.txt", source_id: "object-id", source_version: null, blob: `${"a".repeat(64)}.bin`, bytes: 4, sha256: "f".repeat(64) };
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
  const root = { entries: [
    { version: "001", name: "initial_schema" },
    { version: "002", name: "add_students" },
    { version: "003", name: "next" },
  ] };
  assert.deepEqual(verifyLedgerAgainstRoot(ledger, root, summary).pending.map((entry) => entry.version), ["003"]);
  expectCode(() => verifyLedgerAgainstRoot({ count: 2, min_version: "001", max_version: "002" }, root, summary), "migration_ledger_reconstruction_forbidden");
  expectCode(() => extractExactMigrationLedger(historySql([
    "002\t{second}\tadd_students", "001\t{first}\tinitial_schema",
  ])), "migration_history_order_invalid");
  expectCode(() => verifyLedgerAgainstRoot(ledger, { entries: [{ version: "001", name: "wrong" }] }, summary), "migration_ledger_root_prefix_mismatch");
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
});
