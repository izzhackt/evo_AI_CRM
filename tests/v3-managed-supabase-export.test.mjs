import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ManagedSupabaseExportError,
  assertRedactedReceipt,
  canonicalJson,
  dataRowAggregates,
  exactMigrationLedger,
  normalizeProjectReceipt,
  parseArgs,
  parseCopySections,
  selectLatestCompletedBackup,
  sha256,
  storageInventoryDigest,
  validateOutputRoot,
} from "../scripts/export-v3-managed-supabase-backup.mjs";

const REF = "a".repeat(20);

function expectCode(action, code) {
  assert.throws(
    action,
    (error) => error instanceof ManagedSupabaseExportError && error.code === code,
  );
}

test("argument contract accepts no secret values and rejects missing or duplicate fields", () => {
  const parsed = parseArgs([
    "run",
    "--project-ref", REF,
    "--output-root", "/private/evo",
    "--age-recipient", `age1${"q".repeat(30)}`,
    "--signing-key", "/private/signing-key",
  ]);
  assert.equal(parsed.projectRef, REF);
  assert.equal(parsed.command, "run");
  expectCode(
    () => parseArgs(["run", "--project-ref", REF]),
    "arguments_invalid",
  );
  expectCode(
    () => parseArgs([
      "run",
      "--project-ref", REF,
      "--project-ref", REF,
      "--age-recipient", `age1${"q".repeat(30)}`,
      "--signing-key", "/private/key",
    ]),
    "arguments_invalid",
  );
  expectCode(
    () => parseArgs([
      "run",
      "--project-ref", "wrong",
      "--output-root", "/private/evo",
      "--age-recipient", `age1${"q".repeat(30)}`,
      "--signing-key", "/private/key",
    ]),
    "project_ref_invalid",
  );
});

test("output root must be an existing private directory outside the repository", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-root-test-")));
  const privateRoot = join(root, "private");
  const repoRoot = join(root, "repo");
  mkdirSync(privateRoot, { mode: 0o700 });
  mkdirSync(repoRoot, { mode: 0o700 });
  try {
    assert.equal(validateOutputRoot(privateRoot, repoRoot), privateRoot);
    expectCode(() => validateOutputRoot(repoRoot, repoRoot), "output_root_forbidden");
    const openRoot = join(root, "open");
    mkdirSync(openRoot, { mode: 0o755 });
    expectCode(() => validateOutputRoot(openRoot, repoRoot), "output_root_invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Management API receipt is allowlisted, exact-project bound, and healthy", () => {
  const project = normalizeProjectReceipt({
    id: REF,
    organization_id: "org-id",
    name: "evo-platform-prod",
    region: "ap-southeast-1",
    created_at: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE_HEALTHY",
    ignored_secret: "must-not-survive",
    database: {
      host: `db.${REF}.supabase.co`,
      version: "17.6.1.155",
      postgres_engine: "17",
      release_channel: "ga",
      ignored: "value",
    },
  }, REF);
  assert.deepEqual(Object.keys(project), [
    "ref",
    "organization_id",
    "name",
    "region",
    "created_at",
    "status",
    "database",
  ]);
  assert.equal(project.ref, REF);
  expectCode(
    () => normalizeProjectReceipt({ ...project, id: "b".repeat(20) }, REF),
    "management_project_mismatch",
  );
  expectCode(
    () => normalizeProjectReceipt({
      ...project,
      id: REF,
      status: "INACTIVE",
    }, REF),
    "management_project_not_healthy",
  );
});

test("provider receipt selects only a fresh latest completed backup", () => {
  const now = Date.parse("2026-09-05T04:00:00.000Z");
  const result = selectLatestCompletedBackup({
    backups: [
      { id: "older", inserted_at: "2026-09-04T00:00:00.000Z", status: "COMPLETED", is_physical_backup: true },
      { id: "failed", inserted_at: "2026-09-05T03:00:00.000Z", status: "FAILED", is_physical_backup: true },
      { id: 42, inserted_at: "2026-09-05T02:00:00.000Z", status: "COMPLETED", is_physical_backup: true },
    ],
  }, now);
  assert.equal(result.id, "42");
  expectCode(
    () => selectLatestCompletedBackup({ backups: [] }, now),
    "provider_backup_missing",
  );
  expectCode(
    () => selectLatestCompletedBackup({
      backups: [{ id: "stale", inserted_at: "2026-09-01T00:00:00.000Z", status: "COMPLETED" }],
    }, now),
    "provider_backup_stale",
  );
});

test("COPY parser preserves exact migration rows including statements", () => {
  const dump = [
    "COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;",
    "001\t{CREATE TABLE one;}\tinitial",
    "002\t{ALTER TABLE one ADD COLUMN two text;}\tsecond",
    "\\.",
    "",
  ].join("\n");
  const sections = parseCopySections(dump);
  assert.equal(sections.length, 1);
  const ledger = exactMigrationLedger(dump);
  assert.deepEqual(ledger, {
    count: 2,
    min_version: "001",
    max_version: "002",
    copy_rows_sha256: sections[0].raw_sha256,
  });
  assert.equal(ledger.copy_rows_sha256, sha256(
    "COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;\n" +
    "001\t{CREATE TABLE one;}\tinitial\n" +
    "002\t{ALTER TABLE one ADD COLUMN two text;}\tsecond\n\\.\n",
  ));
  expectCode(
    () => exactMigrationLedger(dump.replace("002", "001")),
    "migration_ledger_invalid",
  );
});

test("data aggregates publish counts and a hash, never row contents", () => {
  const dump = [
    "COPY auth.users (id, email) FROM stdin;",
    "1\tprivate@example.invalid",
    "2\tsecond@example.invalid",
    "\\.",
    "COPY storage.buckets (id) FROM stdin;",
    "documents",
    "\\.",
    "COPY platform.student_cases (id) FROM stdin;",
    "case-private",
    "\\.",
    "",
  ].join("\n");
  const result = dataRowAggregates(dump);
  assert.equal(result.row_count, 4);
  assert.equal(result.auth_user_count, 2);
  assert.equal(result.storage_bucket_row_count, 1);
  assert.doesNotMatch(JSON.stringify(result), /private@example|case-private/u);
});

test("Storage inventory is deterministic, duplicate-safe, and byte bounded", () => {
  const first = storageInventoryDigest({
    buckets: [
      { id: "z", name: "z", public: false },
      { id: "a", name: "a", public: true },
    ],
    objects: [
      { bucket_id: "z", path: "two.bin", id: "2", metadata: { size: 3 } },
      { bucket_id: "a", path: "one.bin", id: "1", metadata: { size: 2 } },
    ],
  });
  const second = storageInventoryDigest({
    buckets: [...first.normalized.buckets].reverse(),
    objects: [...first.normalized.objects].reverse(),
  });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.object_count, 2);
  assert.equal(first.total_bytes, 5);
  assert.equal(first.private_bucket_count, 1);
  expectCode(
    () => storageInventoryDigest({
      buckets: first.normalized.buckets,
      objects: [first.normalized.objects[0], first.normalized.objects[0]],
    }),
    "storage_inventory_duplicate_object",
  );
});

function receiptFixture() {
  return {
    schema: "evo-v3-managed-supabase-export-receipt/v1",
    captured_at: "2026-09-05T00:00:00.000Z",
    git: { head: "1".repeat(40), migration_tree: "2".repeat(40) },
    source: { identity_sha256: "3".repeat(64) },
    provider_backup: { id: "backup-id", inserted_at: "2026-09-04T00:00:00.000Z", status: "COMPLETED", physical: true },
    database: { postgres_major: 17, migration_count: 114, migration_min_version: "001", migration_max_version: "114", migration_copy_rows_sha256: "4".repeat(64), table_count: 20, row_count: 50, auth_user_count: 1 },
    storage: { inventory_sha256: "5".repeat(64), bucket_count: 3, private_bucket_count: 1, public_bucket_count: 2, object_count: 0, total_bytes: 0 },
    encrypted_artifacts: { "data.sql.age": { bytes: 100, sha256: "6".repeat(64) } },
    tools: { supabase_cli: "2.116.0", age: "v1.3.1", ssh: "available", orb: "Running", docker_context: "orbstack" },
    signature: { namespace: "evo-v3-managed-supabase-recovery", identity: "evo-v3-managed-supabase-export", public_key_fingerprint: "SHA256:abc" },
    result: "export_verified",
  };
}

test("redacted receipt rejects secret-shaped fields and requires ciphertext hashes", () => {
  const receipt = assertRedactedReceipt(receiptFixture());
  assert.equal(receipt.result, "export_verified");
  expectCode(
    () => assertRedactedReceipt({ ...receiptFixture(), access_token: "secret" }),
    "receipt_shape_invalid",
  );
  expectCode(
    () => assertRedactedReceipt({
      ...receiptFixture(),
      tools: { ...receiptFixture().tools, connection_string: "hidden" },
    }),
    "receipt_contains_sensitive_material",
  );
});

test("canonical JSON is stable across key order", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});
