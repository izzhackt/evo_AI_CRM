import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertExactExportBundle,
  buildRestoredRoleReadiness,
  installProcessCleanupHandlers,
  localSignedStorageUrl,
  parseExportedMigrationHistory,
  parseHarnessOptions,
  parseQualifiedCopyHeader,
  parseSupabaseStatus,
  safeHarnessRoot,
  sanitizeAppStartupDiagnostic,
  sanitizeDatabaseCommandDiagnostic,
  sanitizeLocalSupabaseStartDiagnostic,
  selectOwnedContainerIds,
  selectOwnedNetworkNames,
  selectOwnedVolumeNames,
  validateDatabaseManifest,
  validateExportReceipt,
  validateRepositoryStateSnapshot,
  validateSanitizedEvidence,
  validateStorageArchiveEntries,
  validateStorageManifest,
  verifiedExportedHistoryPrefix,
  verifyReceiptSignature,
} from "../scripts/test-v3-managed-supabase-recovery-orbstack.mjs";
import {
  canonicalJson,
  sshPublicKeyFingerprint,
} from "../scripts/export-v3-managed-supabase-backup.mjs";

const scriptUrl = new URL(
  "../scripts/test-v3-managed-supabase-recovery-orbstack.mjs",
  import.meta.url,
);
const source = readFileSync(scriptUrl, "utf8");
const capturedAt = "2026-09-05T00:00:00.000Z";
const projectRef = "abcde12345fghij67890";
const exportCommit = "a".repeat(40);
const exportMigrationTree = "b".repeat(40);
const recoveryCommit = "c".repeat(40);
const trustedFingerprint = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const encryptedNames = Object.freeze([
  "roles.sql.age",
  "schema.sql.age",
  "data.sql.age",
  "history-schema.sql.age",
  "history-data.sql.age",
  "database-manifest.json.age",
  "storage-manifest.json.age",
  "storage-objects.tar.age",
]);
const sqlNames = Object.freeze([
  "roles.sql",
  "schema.sql",
  "data.sql",
  "history-schema.sql",
  "history-data.sql",
]);
const semanticArtifactHashes = Object.freeze(Object.fromEntries(
  sqlNames.map((name) => [name, "e".repeat(64)]),
));
const stabilityProofSha256 = sha(canonicalJson(semanticArtifactHashes));

function unsignedJwt(role) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role })).toString("base64url"),
    "signature",
  ].join(".");
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

async function waitUntil(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  return predicate();
}

function sourceReceipt() {
  const value = {
    project: { ref: projectRef },
    backup: { id: "backup-1" },
    pooler: { host: "pooler.invalid" },
  };
  return { ...value, sha256: sha(canonicalJson(value)) };
}

function rawReceipt(overrides = {}) {
  const sourceIdentitySha256 = sourceReceipt().sha256;
  return {
    schema: "evo-v3-managed-supabase-export-receipt/v1",
    captured_at: capturedAt,
    git: { head: exportCommit, migration_tree: exportMigrationTree },
    source: { identity_sha256: sourceIdentitySha256 },
    provider_backup: {
      id: "backup-1",
      inserted_at: capturedAt,
      status: "COMPLETED",
      physical: true,
    },
    database: {
      postgres_major: 15,
      migration_count: 2,
      migration_min_version: "001",
      migration_max_version: "002",
      migration_copy_rows_sha256: "1".repeat(64),
      data_copy_sections_sha256: "2".repeat(64),
      stability_proof_sha256: stabilityProofSha256,
      snapshot_mode: "postgresql-exported-repeatable-read-read-only",
      table_count: 12,
      row_count: 34,
      auth_user_count: 1,
    },
    storage: {
      inventory_sha256: "4".repeat(64),
      bucket_count: 1,
      private_bucket_count: 1,
      public_bucket_count: 0,
      object_count: 1,
      total_bytes: 3,
    },
    encrypted_artifacts: Object.fromEntries(
      encryptedNames.map((name, index) => [
        name,
        { bytes: index + 1, sha256: String(index + 5).repeat(64).slice(0, 64) },
      ]),
    ),
    tools: { supabase: "2.72.7", pg_dump: "15.14" },
    signature: {
      namespace: "evo-v3-managed-supabase-recovery",
      identity: "evo-v3-managed-supabase-export",
      public_key_fingerprint: trustedFingerprint,
      trust_root: "operator-held-external-public-key",
    },
    result: "export_verified",
    ...overrides,
  };
}

function normalizedReceipt(raw = rawReceipt()) {
  return validateExportReceipt(raw, {
    exportCommit,
    exportMigrationTree,
    sourceIdentitySha256: raw.source.identity_sha256,
    trustedPublicKeyFingerprint: raw.signature.public_key_fingerprint,
  });
}

function databaseManifest(receipt = normalizedReceipt()) {
  return {
    schema: "evo-v3-managed-supabase-logical-backup/v1",
    captured_at: capturedAt,
    source_receipt: sourceReceipt(),
    git: receipt.raw.git,
    tools: receipt.raw.tools,
    artifacts: Object.fromEntries(
      sqlNames.map((name, index) => [name, { bytes: index + 10, sha256: "d".repeat(64) }]),
    ),
    migration_ledger: {
      count: 2,
      min_version: "001",
      max_version: "002",
      copy_rows_sha256: "1".repeat(64),
    },
    data_copy_sections_sha256: "2".repeat(64),
    stability: {
      snapshot_mode: "postgresql-exported-repeatable-read-read-only",
      artifact_semantic_sha256: semanticArtifactHashes,
      proof_sha256: stabilityProofSha256,
    },
    aggregates: {
      table_count: 12,
      row_count: 34,
      auth_user_count: 1,
      storage_bucket_row_count: 1,
      storage_object_row_count: 1,
      table_counts_sha256: "f".repeat(64),
    },
  };
}

function storageManifest(receipt = normalizedReceipt()) {
  return {
    schema: "evo-v3-managed-supabase-storage-backup/v1",
    captured_at: capturedAt,
    source_receipt_sha256: receipt.sourceIdentitySha256,
    inventory_sha256: receipt.storage.inventorySha256,
    buckets: [{
      id: "platform-documents",
      name: "platform-documents",
      public: false,
      file_size_limit: 52_428_800,
      allowed_mime_types: ["application/pdf"],
      created_at: capturedAt,
      updated_at: capturedAt,
    }],
    objects: [{
      bucket_id: "platform-documents",
      path: "org/case/document.pdf",
      source_id: "00000000-0000-4000-8000-000000000001",
      source_version: "version-1",
      blob: "00000000.bin",
      bytes: 3,
      sha256: "9".repeat(64),
    }],
    aggregates: {
      bucket_count: 1,
      private_bucket_count: 1,
      public_bucket_count: 0,
      object_count: 1,
      total_bytes: 3,
    },
  };
}

function historyFixture() {
  const header = "COPY supabase_migrations.schema_migrations (version, statements, name, created_by, idempotency_key, rollback) FROM stdin;";
  const rows = [
    "001\t{}\tinitial\t\\N\t\\N\t\\N",
    "002\t{}\tadd_crm\t\\N\t\\N\t\\N",
  ];
  const copy = `${header}\n${rows.join("\n")}\n\\.\n`;
  return {
    text: `-- authenticated history\n${copy}`,
    ledger: {
      count: 2,
      minVersion: "001",
      maxVersion: "002",
      copyRowsSha256: sha(copy),
    },
  };
}

function createExactBundle(parent, name = "bundle") {
  const bundle = join(parent, name);
  mkdirSync(bundle, { mode: 0o700 });
  for (const filename of [
    ".evo-v3-managed-supabase-export",
    ...encryptedNames,
    "receipt.json",
    "receipt.json.sig",
  ]) {
    const contents = filename === ".evo-v3-managed-supabase-export"
      ? "managed-supabase-export\n"
      : "x";
    writeFileSync(join(bundle, filename), contents, { mode: 0o600 });
  }
  return bundle;
}

test("arguments expose only the canonical bundle and independent trust inputs", () => {
  const options = parseHarnessOptions([
    "--bundle", "/private/export",
    "--age-identity", "/private/identity.txt",
    "--trusted-public-key", "/private/signing.pub",
    "--trusted-public-key-fingerprint", trustedFingerprint,
    "--source-identity-sha256", "a".repeat(64),
    "--expected-export-commit", exportCommit,
    "--expected-export-migration-tree", exportMigrationTree,
    "--expected-repository-commit", recoveryCommit,
  ], {});
  assert.equal(options.bundle, "/private/export");
  assert.equal(options.maxAgeHours, 72);
  assert.notEqual(options.expectedExportCommit, options.expectedRepositoryCommit);
  expectCode(() => parseHarnessOptions([
    "--database-manifest", "/obsolete/database.json.age",
  ], {}), "unknown_argument");
  expectCode(() => parseHarnessOptions([
    "--migration-ledger-attestation", "/obsolete/ledger.json.age",
  ], {}), "unknown_argument");
  expectCode(() => parseHarnessOptions([
    "--bundle", "/flag/bundle",
  ], { EVO_V3_RECOVERY_BUNDLE: "/env/bundle" }), "argument_environment_conflict");
});

test("exact export bundle rejects symlinks, marker drift and inventory drift", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-recovery-bundle-test-"));
  chmodSync(root, 0o700);
  try {
    const bundle = createExactBundle(root);
    assert.equal(assertExactExportBundle(bundle), realpathSync(bundle));
    const linked = join(root, "linked-bundle");
    symlinkSync(bundle, linked, "dir");
    expectCode(() => assertExactExportBundle(linked), "export_bundle_not_directory");
    writeFileSync(join(bundle, ".evo-v3-managed-supabase-export"), "wrong\n", { mode: 0o600 });
    expectCode(() => assertExactExportBundle(bundle), "export_bundle_marker_invalid");
    writeFileSync(
      join(bundle, ".evo-v3-managed-supabase-export"),
      "managed-supabase-export\n",
      { mode: 0o600 },
    );
    writeFileSync(join(bundle, "unexpected"), "x", { mode: 0o600 });
    expectCode(() => assertExactExportBundle(bundle), "export_bundle_inventory_invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("signed receipt binds export commit, migration tree, source and trust root", () => {
  const receipt = rawReceipt();
  const normalized = normalizedReceipt(receipt);
  assert.equal(normalized.git.head, exportCommit);
  assert.equal(normalized.database.authUserCount, 1);
  expectCode(() => validateExportReceipt(receipt, {
    exportCommit: "f".repeat(40),
    exportMigrationTree,
    sourceIdentitySha256: receipt.source.identity_sha256,
    trustedPublicKeyFingerprint: trustedFingerprint,
  }), "receipt_export_commit_mismatch");
  expectCode(() => validateExportReceipt(receipt, {
    exportCommit,
    exportMigrationTree: "f".repeat(40),
    sourceIdentitySha256: receipt.source.identity_sha256,
    trustedPublicKeyFingerprint: trustedFingerprint,
  }), "receipt_export_migration_tree_mismatch");
  expectCode(() => validateExportReceipt(receipt, {
    exportCommit,
    exportMigrationTree,
    sourceIdentitySha256: "0".repeat(64),
    trustedPublicKeyFingerprint: trustedFingerprint,
  }), "receipt_source_identity_mismatch");
  expectCode(() => validateExportReceipt(receipt, {
    exportCommit,
    exportMigrationTree,
    sourceIdentitySha256: receipt.source.identity_sha256,
    trustedPublicKeyFingerprint: "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  }), "receipt_signing_fingerprint_mismatch");
});

test("detached SSH signature rejects receipt tamper and wrong trusted key", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-recovery-signature-test-"));
  chmodSync(root, 0o700);
  try {
    const privateKey = join(root, "signing");
    const generated = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", privateKey]);
    assert.equal(generated.status, 0);
    const publicKey = `${privateKey}.pub`;
    const receiptPath = join(root, "receipt.json");
    writeFileSync(receiptPath, canonicalJson(rawReceipt()), { mode: 0o600 });
    const signed = spawnSync("ssh-keygen", [
      "-Y", "sign", "-f", privateKey, "-n", "evo-v3-managed-supabase-recovery", receiptPath,
    ]);
    assert.equal(signed.status, 0);
    const signaturePath = `${receiptPath}.sig`;
    const fingerprint = sshPublicKeyFingerprint(readFileSync(publicKey, "utf8"));
    verifyReceiptSignature({
      receiptPath,
      signaturePath,
      trustedPublicKeyPath: publicKey,
      expectedFingerprint: fingerprint,
      workingDirectory: root,
    });
    writeFileSync(receiptPath, `${canonicalJson(rawReceipt())} `, { mode: 0o600 });
    expectCode(() => verifyReceiptSignature({
      receiptPath,
      signaturePath,
      trustedPublicKeyPath: publicKey,
      expectedFingerprint: fingerprint,
      workingDirectory: root,
    }), "receipt_signature_verification_failed");
    expectCode(() => verifyReceiptSignature({
      receiptPath,
      signaturePath,
      trustedPublicKeyPath: publicKey,
      expectedFingerprint: trustedFingerprint,
      workingDirectory: root,
    }), "trusted_public_key_fingerprint_mismatch");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("database manifest is bound to signed receipt and synchronized snapshot", () => {
  const receipt = normalizedReceipt();
  const manifest = databaseManifest(receipt);
  const validated = validateDatabaseManifest(manifest, { receipt });
  assert.equal(validated.sourceProjectRef, projectRef);
  assert.equal(validated.files["history-data.sql"].bytes, 14);
  expectCode(() => validateDatabaseManifest({
    ...manifest,
    source_receipt: { ...manifest.source_receipt, sha256: "0".repeat(64) },
  }, { receipt }), "database_manifest_source_identity_mismatch");
  expectCode(() => validateDatabaseManifest({
    ...manifest,
    data_copy_sections_sha256: "0".repeat(64),
  }, { receipt }), "database_manifest_data_digest_mismatch");
  expectCode(() => validateDatabaseManifest({
    ...manifest,
    stability: { ...manifest.stability, proof_sha256: "0".repeat(64) },
  }, { receipt }), "database_manifest_stability_mismatch");
  expectCode(() => validateDatabaseManifest({
    ...manifest,
    stability: {
      ...manifest.stability,
      artifact_semantic_sha256: {
        ...manifest.stability.artifact_semantic_sha256,
        "data.sql": "0".repeat(64),
      },
    },
  }, { receipt }), "database_manifest_stability_mismatch");
});

test("storage manifest enforces snake_case blob mapping and receipt hashes", () => {
  const receipt = normalizedReceipt();
  const manifest = storageManifest(receipt);
  const validated = validateStorageManifest(manifest, { receipt });
  assert.equal(validated.objects[0].archivePath, "storage-blobs/00000000.bin");
  expectCode(() => validateStorageManifest({
    ...manifest,
    inventory_sha256: "0".repeat(64),
  }, { receipt }), "storage_manifest_source_identity_mismatch");
  expectCode(() => validateStorageManifest({
    ...manifest,
    objects: [{ ...manifest.objects[0], blob: "00000001.bin" }],
  }, { receipt }), "storage_object_blob_mapping_invalid");
  expectCode(() => validateStorageManifest({
    ...manifest,
    objects: [{ ...manifest.objects[0], path: "../escape" }],
  }, { receipt }), "storage_object_path_invalid");
});

test("archive inventory rejects traversal and non-exact mapping", () => {
  const receipt = normalizedReceipt();
  const objects = validateStorageManifest(storageManifest(receipt), { receipt }).objects;
  const valid = ["storage-blobs/", "storage-blobs/00000000.bin", "storage-manifest.json"];
  assert.equal(validateStorageArchiveEntries(valid, objects).files.length, 2);
  for (const unsafe of [
    "../escape",
    "/absolute",
    "storage-blobs/../escape",
    "storage-blobs\\escape",
  ]) {
    expectCode(() => validateStorageArchiveEntries([
      "storage-blobs/", unsafe, "storage-manifest.json",
    ], objects), "storage_archive_entry_unsafe");
  }
  expectCode(() => validateStorageArchiveEntries([
    ...valid,
    "storage-blobs/unlisted.bin",
  ], objects), "storage_archive_inventory_mismatch");
  expectCode(() => validateStorageArchiveEntries([
    "storage-blobs/", "storage-manifest.json",
  ], objects), "storage_archive_inventory_mismatch");
});

test("authenticated history is the sole migration prefix source", () => {
  const fixture = historyFixture();
  const parsed = parseExportedMigrationHistory(fixture.text, fixture.ledger);
  assert.deepEqual(parsed.entries, [
    { version: "001", name: "initial" },
    { version: "002", name: "add_crm" },
  ]);
  assert.equal(verifiedExportedHistoryPrefix({ entries: [
    { version: "001", name: "initial" },
    { version: "002", name: "add_crm" },
    { version: "115", name: "platform_malware_scanning" },
  ] }, fixture.ledger, parsed).length, 2);
  expectCode(() => parseExportedMigrationHistory(
    fixture.text.replace("supabase_migrations.schema_migrations", "public.schema_migrations"),
    fixture.ledger,
  ), "exported_migration_history_target_invalid");
  expectCode(() => parseExportedMigrationHistory(fixture.text, {
    ...fixture.ledger,
    copyRowsSha256: "0".repeat(64),
  }), "exported_migration_history_manifest_mismatch");
  expectCode(() => parseExportedMigrationHistory(
    fixture.text.replace(", created_by, idempotency_key, rollback", ""),
    fixture.ledger,
  ), "exported_migration_history_columns_invalid");
  expectCode(() => verifiedExportedHistoryPrefix({ entries: [
    { version: "001", name: "different" },
    { version: "002", name: "add_crm" },
  ] }, fixture.ledger, parsed), "exported_migration_history_root_prefix_mismatch");
});

test("recovery HEAD is clean and exact but may be later than export HEAD", () => {
  const validated = validateRepositoryStateSnapshot({
    commit: recoveryCommit,
    tree: "d".repeat(40),
    status: "",
  }, recoveryCommit);
  assert.equal(validated.commit, recoveryCommit);
  expectCode(() => validateRepositoryStateSnapshot({
    commit: exportCommit,
    tree: "d".repeat(40),
    status: "",
  }, recoveryCommit), "repository_commit_mismatch");
  expectCode(() => validateRepositoryStateSnapshot({
    commit: recoveryCommit,
    tree: "d".repeat(40),
    status: " M package.json",
  }, recoveryCommit), "repository_worktree_not_clean");
});

test("local status separates the server secret from the service-role bearer JWT", () => {
  const serviceRoleKey = unsignedJwt("service_role");
  const serverSecretKey = `sb_secret_${"s".repeat(24)}`;
  const status = parseSupabaseStatus([
    "API_URL=http://127.0.0.1:54321",
    "DB_URL=postgresql://postgres:password@127.0.0.1:54322/postgres",
    `PUBLISHABLE_KEY=sb_publishable_${"p".repeat(24)}`,
    `SECRET_KEY=${serverSecretKey}`,
    `SERVICE_ROLE_KEY=${serviceRoleKey}`,
  ].join("\n"));
  assert.equal(status.serverSecretKey, serverSecretKey);
  assert.equal(status.serviceRoleKey, serviceRoleKey);
  expectCode(() => parseSupabaseStatus([
    "API_URL=http://127.0.0.1:54321",
    "DB_URL=postgresql://postgres:password@127.0.0.1:54322/postgres",
    `PUBLISHABLE_KEY=sb_publishable_${"p".repeat(24)}`,
    `SECRET_KEY=${serverSecretKey}`,
    `SERVICE_ROLE_KEY=${serverSecretKey}`,
  ].join("\n")), "supabase_status_service_role_key_invalid");
});

test("local signed Storage paths stay loopback-bound and gain the gateway prefix", () => {
  const apiUrl = "http://127.0.0.1:54321";
  const bucket = "platform-documents";
  const objectPath = "recovery-canary/object.png";
  assert.equal(
    localSignedStorageUrl(
      apiUrl,
      bucket,
      objectPath,
      "/object/sign/platform-documents/recovery-canary/object.png?token=short-lived",
    ),
    `${apiUrl}/storage/v1/object/sign/platform-documents/recovery-canary/object.png?token=short-lived`,
  );
  assert.equal(
    localSignedStorageUrl(
      apiUrl,
      bucket,
      objectPath,
      `${apiUrl}/storage/v1/object/sign/platform-documents/recovery-canary/object.png?token=short-lived`,
    ),
    `${apiUrl}/storage/v1/object/sign/platform-documents/recovery-canary/object.png?token=short-lived`,
  );
  expectCode(() => localSignedStorageUrl(
    apiUrl,
    bucket,
    objectPath,
    "https://example.invalid/object/sign/platform-documents/recovery-canary/object.png?token=x",
  ), "private_storage_signed_url_invalid");
  expectCode(() => localSignedStorageUrl(
    apiUrl,
    bucket,
    objectPath,
    "/object/sign/platform-documents/another-object.png?token=x",
  ), "private_storage_signed_url_invalid");
});

test("COPY parser remains schema-qualified and fail closed", () => {
  assert.deepEqual(
    parseQualifiedCopyHeader("COPY platform.leads (id, status) FROM stdin;"),
    { schema: "platform", table: "leads" },
  );
  expectCode(() => parseQualifiedCopyHeader("COPY leads (id) FROM stdin;"), "copy_header_invalid");
  expectCode(
    () => parseQualifiedCopyHeader("COPY public.\"../escape\" (id) FROM stdin;"),
    "copy_header_invalid",
  );
});

test("cleanup selectors only accept the exact disposable contour", () => {
  const project = "evov3recoveryabcdef123456";
  assert.deepEqual(selectOwnedContainerIds([
    `aaaaaaaaaaaa\tsupabase_db_${project}`,
    "bbbbbbbbbbbb\tsupabase_db_other",
  ].join("\n"), project), ["aaaaaaaaaaaa"]);
  assert.deepEqual(selectOwnedVolumeNames([
    `supabase_db_data_${project}`,
    "unrelated",
  ].join("\n"), project), [`supabase_db_data_${project}`]);
  const network = "evo_v3_recovery_abcdef123456_private";
  assert.deepEqual(selectOwnedNetworkNames(`${network}\nother`, network), [network]);
});

test("cleanup root guard permits only a direct prefixed temporary directory", () => {
  const safe = mkdtempSync(join(tmpdir(), "evo-v3-managed-recovery-"));
  const parent = mkdtempSync(join(tmpdir(), "evo-recovery-parent-"));
  const nested = join(parent, "evo-v3-managed-recovery-nested");
  mkdirSync(nested, { mode: 0o700 });
  try {
    assert.equal(safeHarnessRoot(safe), true);
    assert.equal(safeHarnessRoot(nested), false);
  } finally {
    rmSync(safe, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test("SIGTERM stops the exact detached app group before contour cleanup", async () => {
  const previousExitCode = process.exitCode;
  const appChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  const calls = [];
  let observedExit;
  try {
    const exitPromise = new Promise((resolveExit) => {
      installProcessCleanupHandlers({
        getBrowserProof: () => ({
          appChild,
          browserServerPromise: undefined,
          logFd: undefined,
          logClosed: false,
          shutdownPromise: undefined,
        }),
        cleanup: () => calls.push("cleanup"),
        exit: (code) => {
          observedExit = code;
          resolveExit();
        },
      });
    });
    process.emit("SIGTERM");
    await Promise.race([
      exitPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("signal cleanup timeout")), 5_000)),
    ]);
    assert.equal(observedExit, 143);
    assert.deepEqual(calls, ["cleanup"]);
    assert.equal(await waitUntil(() => appChild.exitCode !== null || appChild.signalCode !== null), true);
  } finally {
    process.exitCode = previousExitCode;
    if (appChild.exitCode === null && appChild.signalCode === null) {
      try {
        if (process.platform !== "win32") process.kill(-appChild.pid, "SIGKILL");
        else appChild.kill("SIGKILL");
      } catch {
        // The signal handler may already have reaped the exact child group.
      }
    }
  }
});

test("diagnostics and late role evidence stay aggregate-only", () => {
  const raw = "fatal: permission denied /Users/private/token secret=value admin@example.com";
  const local = sanitizeLocalSupabaseStartDiagnostic(raw, 1);
  const database = sanitizeDatabaseCommandDiagnostic(raw, 1);
  assert.equal(JSON.stringify(local).includes("admin@example.com"), false);
  assert.equal(JSON.stringify(local).includes("secret=value"), false);
  assert.equal(JSON.stringify(database).includes(raw), false);

  const readiness = buildRestoredRoleReadiness({
    admin: true,
    sales: false,
    admissions: false,
  });
  assert.equal(readiness.complete, false);
  assert.deepEqual(readiness.missingRoles, ["sales", "admissions"]);
  assert.equal(readiness.blocker.code, "restored_representative_staff_roles_missing");
  assert.equal(validateSanitizedEvidence({
    schema: "evo-v3-managed-supabase-recovery-result/v1",
    ok: false,
    status: "not_ready",
    blocker: readiness.blocker,
  }).status, "not_ready");
  expectCode(() => validateSanitizedEvidence({
    status: "not_ready",
    email: "staff@example.com",
  }), "evidence_contains_sensitive_material");
});

test("app startup diagnostics expose only bounded redacted fingerprints", () => {
  const diagnostic = sanitizeAppStartupDiagnostic(
    "Error: Cannot find module /Users/person/project/missing.js\n" +
      "warning token=never-print-this-value\n",
    { exitCode: 1, signalCode: null },
  );
  assert.equal(diagnostic.exitCode, 1);
  assert.deepEqual(diagnostic.fingerprints, ["module_missing"]);
  assert.equal(JSON.stringify(diagnostic).includes("/Users/person"), false);
  assert.equal(JSON.stringify(diagnostic).includes("never-print-this-value"), false);
  assert.equal(diagnostic.sanitizedErrorTemplates.length, 1);
});

test("source contains no obsolete attestation or compatibility fallback", () => {
  assert.doesNotMatch(source, /migration-ledger-attestation|migrationLedgerAttestation|verifiedAttestedPrefix/u);
  assert.doesNotMatch(source, /deriveSourceIdentitySha256|fallback repositor|dual[- ]read|dual[- ]write/iu);
  assert.match(source, /verifyReceiptSignature\([\s\S]*JSON\.parse/u);
  assert.match(source, /encrypted_artifact_receipt_mismatch/u);
  assert.match(source, /storage_archive_manifest_mismatch/u);
  assert.match(source, /restoreExportedMigrationHistory/u);
  assert.match(source, /storage_archive_entry_unsafe/u);
  assert.match(source, /process\.on\("SIGINT"/u);
  assert.match(source, /process\.on\("SIGTERM"/u);
});

test("restored contour runs migration 115 and the real scanner-backed upload path", () => {
  assert.match(source, /artifacts\.plaintext\.historySchema/u);
  assert.match(source, /base_migration_ledger_already_exists/u);
  assert.doesNotMatch(source, /initializeLocalMigrationLedger/u);
  assert.match(source, /\/rest\/v1\/rpc\/document_storage_backup_inventory/u);
  assert.match(source, /finalLedger\.includes\("115"\)/u);
  assert.match(source, /clamav\/clamav@sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9/u);
  assert.match(source, /clamd-malware-scanner\.ts/u);
  assert.match(source, /EICAR-STANDARD-ANTIVIRUS-TEST-FILE/u);
  assert.match(source, /\/api\/v3\/company-files\/\$\{encodeURIComponent\(fileId\)\}\/versions/u);
  assert.match(source, /malware_scanner_eicar_persisted_state/u);
  assert.match(source, /malware_scanner_outage_persisted_state/u);
  assert.match(source, /malware_scanner_recovered_persistence_invalid/u);
  assert.match(source, /unprovedCompanyFileBytesExposed: false/u);
  assert.match(source, /providersCalled: false/u);
});

test("late missing-role result is written after cleanup and still exits nonzero", () => {
  const cleanup = source.lastIndexOf("cleanupStatus = cleanupActiveState(state)");
  const write = source.lastIndexOf("writeSanitizedEvidence(options.evidenceOut, evidence)");
  const failure = source.lastIndexOf(
    'fail("restored_representative_staff_roles_missing", "auth_rls_proof", evidence.blocker)',
  );
  assert.ok(cleanup > 0 && write > cleanup && failure > write);
  assert.match(source, /status: roleReadiness\.complete \? "passed" : "not_ready"/u);
});

test("contract mode is inert and advertises the canonical fail-closed surface", () => {
  const result = spawnSync(process.execPath, [scriptUrl.pathname, "contract"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0, result.stderr);
  const contract = JSON.parse(result.stdout);
  assert.equal(contract.ok, true);
  assert.equal(contract.safety.managedSupabase, "never_contacted");
  assert.deepEqual(contract.requiredBundle.slice(1, 9), encryptedNames);
  assert.deepEqual(contract.requiredExternalTrust, [
    "age identity file",
    "trusted SSH public key",
    "trusted SSH public-key fingerprint",
  ]);
});
