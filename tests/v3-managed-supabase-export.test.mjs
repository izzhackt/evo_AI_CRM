import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ManagedSupabaseExportError,
  assertRedactedReceipt,
  canonicalJson,
  createStorageClientFetch,
  dataRowAggregates,
  downloadStorageObjects,
  drainConcurrentOperations,
  exactMigrationLedger,
  guardedRemove,
  managedDatabaseDumpPlan,
  normalizeProjectReceipt,
  normalizePoolerReceipt,
  openSynchronizedDatabaseSnapshot,
  parseArgs,
  parseCopySections,
  patchedPostgresClientVersion,
  registerSignalCleanup,
  selectLatestCompletedBackup,
  semanticSqlFileDigest,
  sha256,
  spawnCommand,
  storageClientHeaders,
  storageDownloadHeaders,
  storageInventoryDigest,
  synchronizedSnapshotFlag,
  validateOperatorHome,
  validateOutputRoot,
  validateSupabaseDatabaseCa,
  verifyPrivateSigningKey,
  verifySigningKeyPair,
} from "../scripts/export-v3-managed-supabase-backup.mjs";

const REF = "a".repeat(20);
const DATABASE_CA = fileURLToPath(
  new URL("../scripts/support/supabase-prod-ca-2021.crt", import.meta.url),
);
const DUMP_FILTERS = [
  "v3-managed-supabase-dump-schema.sh",
  "v3-managed-supabase-dump-data.sh",
  "v3-managed-supabase-dump-roles.sh",
].map((name) => fileURLToPath(new URL(`../scripts/support/${name}`, import.meta.url)));

function expectCode(action, code) {
  assert.throws(
    action,
    (error) => error instanceof ManagedSupabaseExportError && error.code === code,
  );
}

async function expectCodeAsync(action, code) {
  await assert.rejects(
    action,
    (error) => error instanceof ManagedSupabaseExportError && error.code === code,
  );
}

function jwtForRole(role) {
  return `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
}

test("argument contract accepts no secret values and rejects missing or duplicate fields", () => {
  const parsed = parseArgs([
    "run",
    "--project-ref", REF,
    "--output-root", "/private/evo",
    "--age-recipient", `age1${"q".repeat(30)}`,
    "--signing-key", "/private/signing-key",
    "--trusted-public-key", "/private/trusted-signing-key.pub",
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
      "--trusted-public-key", "/private/trusted.pub",
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
      "--trusted-public-key", "/private/trusted.pub",
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

test("OrbStack operator home must be canonical, owned, and not writable by peers", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-home-test-")));
  try {
    chmodSync(root, 0o700);
    assert.equal(validateOperatorHome(root), root);
    chmodSync(root, 0o722);
    expectCode(() => validateOperatorHome(root), "operator_home_invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("guarded cleanup requires its marker and removes that marker last", () => {
  const removable = realpathSync(
    mkdtempSync(join(tmpdir(), "evo-v3-managed-export-cleanup-test-")),
  );
  const markerless = realpathSync(
    mkdtempSync(join(tmpdir(), "evo-v3-managed-export-cleanup-test-")),
  );
  try {
    chmodSync(removable, 0o700);
    mkdirSync(join(removable, "nested"), { mode: 0o700 });
    writeFileSync(join(removable, "nested", "artifact"), "ciphertext\n", { mode: 0o600 });
    writeFileSync(
      join(removable, ".evo-v3-managed-supabase-export"),
      "managed-supabase-export-runtime\n",
      { mode: 0o600 },
    );
    guardedRemove(removable);
    assert.equal(existsSync(removable), false);
    expectCode(() => guardedRemove(markerless), "cleanup_target_invalid");
  } finally {
    rmSync(removable, { recursive: true, force: true });
    rmSync(markerless, { recursive: true, force: true });
  }
});

test("guarded cleanup restores the exact marker when a late file prevents root removal", () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "evo-v3-managed-export-cleanup-race-test-")),
  );
  const marker = join(root, ".evo-v3-managed-supabase-export");
  const markerContent = "managed-supabase-export-runtime\n";
  try {
    chmodSync(root, 0o700);
    writeFileSync(marker, markerContent, { mode: 0o600 });
    expectCode(
      () => guardedRemove(root, {
        beforeRootRemoval(directory) {
          writeFileSync(join(directory, "late-artifact"), "late\n", { mode: 0o600 });
        },
      }),
      "cleanup_directory_not_empty",
    );
    assert.equal(readFileSync(marker, "utf8"), markerContent);
    assert.equal(statSync(marker).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Storage headers never send opaque secret keys as bearer JWTs", () => {
  const opaque = `sb_secret_${"a".repeat(24)}`;
  const direct = storageDownloadHeaders(opaque);
  assert.equal(direct.apikey, opaque);
  assert.equal(direct.Authorization, undefined);
  assert.equal(direct["Accept-Encoding"], "identity");

  const sanitized = storageClientHeaders({ Authorization: `Bearer ${opaque}` }, opaque);
  assert.equal(sanitized.get("apikey"), opaque);
  assert.equal(sanitized.get("authorization"), null);

  const userJwt = jwtForRole("authenticated");
  const preserved = storageClientHeaders({ Authorization: `Bearer ${userJwt}` }, opaque);
  assert.equal(preserved.get("authorization"), `Bearer ${userJwt}`);

  const legacy = jwtForRole("service_role");
  assert.equal(storageDownloadHeaders(legacy).Authorization, `Bearer ${legacy}`);
  assert.equal(
    storageClientHeaders({}, legacy).get("authorization"),
    `Bearer ${legacy}`,
  );
});

test("Storage SDK fetch rejects redirects and never sends an opaque secret as bearer", async () => {
  const opaque = `sb_secret_${"b".repeat(24)}`;
  const controller = new AbortController();
  let observed = null;
  const origin = `https://${REF}.supabase.co`;
  const storageFetch = createStorageClientFetch(
    origin,
    opaque,
    controller.signal,
    async (url, options) => {
      observed = { url: String(url), options };
      return new Response(null, { status: 204 });
    },
  );

  await storageFetch(`${origin}/storage/v1/bucket`, {
    redirect: "follow",
    headers: { Authorization: `Bearer ${opaque}`, "x-client-info": "focused-test" },
  });

  assert.equal(observed.url, `${origin}/storage/v1/bucket`);
  assert.equal(observed.options.redirect, "error");
  assert.equal(observed.options.headers.get("apikey"), opaque);
  assert.equal(observed.options.headers.get("authorization"), null);
  assert.equal(observed.options.headers.get("x-client-info"), "focused-test");
  expectCode(
    () => storageFetch("https://attacker.invalid/storage/v1/bucket"),
    "storage_origin_invalid",
  );
});

test("signal cleanup aborts and terminates children without running filesystem cleanup", () => {
  const controller = new AbortController();
  const calls = [];
  let cleanupCalls = 0;
  const state = {
    cleanup() {
      cleanupCalls += 1;
    },
    signal: null,
    signalCount: 0,
    terminators: new Set([
      (reason, force) => calls.push({ reason, force }),
    ]),
  };
  const before = new Set(process.listeners("SIGTERM"));
  const remove = registerSignalCleanup(controller, state);
  const handler = process.listeners("SIGTERM").find((listener) => !before.has(listener));
  try {
    assert.equal(typeof handler, "function");
    handler();
    handler();
    assert.equal(controller.signal.aborted, true);
    assert.equal(cleanupCalls, 0);
    assert.deepEqual(calls, [
      { reason: "export_interrupted", force: false },
      { reason: "export_interrupted", force: true },
    ]);
  } finally {
    remove();
  }
});

test("concurrent preflight drains an aborted sibling and every registered terminator", async () => {
  const state = { terminators: new Set(), processGroups: new Set() };
  let siblingSettled = false;
  const siblingTerminator = () => {};

  await expectCodeAsync(
    drainConcurrentOperations([
      async () => {
        throw new ManagedSupabaseExportError("local_gate_failed");
      },
      async (signal) => {
        state.terminators.add(siblingTerminator);
        await new Promise((resolve) => {
          const settle = () => setTimeout(resolve, 20);
          if (signal.aborted) settle();
          else signal.addEventListener("abort", settle, { once: true });
        });
        state.terminators.delete(siblingTerminator);
        siblingSettled = true;
      },
    ], new AbortController().signal, state),
    "local_gate_failed",
  );

  assert.equal(siblingSettled, true);
  assert.equal(state.terminators.size, 0);
  assert.equal(state.processGroups.size, 0);
});

test("signing trust stays pinned when both key paths are replaced after preflight", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-signing-trust-test-")));
  const privateKey = join(root, "signing-key");
  const publicKey = join(root, "signing-key.pub");
  const fakeKeygen = join(root, "fake-ssh-keygen");
  const state = { terminators: new Set(), processGroups: new Set() };
  const environment = { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root };
  const executables = { sshKeygen: { real: fakeKeygen } };
  const controller = new AbortController();
  try {
    writeFileSync(privateKey, "ssh-ed25519 AAAA\n", { mode: 0o600 });
    writeFileSync(publicKey, "ssh-ed25519 AAAA original\n", { mode: 0o644 });
    writeFileSync(
      fakeKeygen,
      "#!/bin/sh\n[ \"$1\" = \"-y\" ] || exit 2\ncat \"$3\"\n",
      { mode: 0o700 },
    );
    const trust = await verifySigningKeyPair(
      { privateKey, publicKey },
      root,
      controller.signal,
      state,
      environment,
      executables,
    );
    assert.equal(trust.publicLine, "ssh-ed25519 AAAA");

    writeFileSync(privateKey, "ssh-ed25519 AQID\n", { mode: 0o600 });
    writeFileSync(publicKey, "ssh-ed25519 AQID replacement\n", { mode: 0o644 });
    await expectCodeAsync(
      verifyPrivateSigningKey(
        privateKey,
        trust.publicLine,
        root,
        controller.signal,
        state,
        environment,
        executables,
      ),
      "signing_trust_root_mismatch",
    );
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
  const empty = storageInventoryDigest({
    buckets: [{ id: "empty", name: "empty", public: false }],
    objects: [{ bucket_id: "empty", path: "zero.bin", id: "0", metadata: { size: 0 } }],
  });
  assert.equal(empty.total_bytes, 0);
  expectCode(
    () => storageInventoryDigest({
      buckets: [{ id: "bad", name: "bad", public: false }],
      objects: [{ bucket_id: "bad", path: "missing.bin", id: "x", metadata: {} }],
    }),
    "storage_object_size_invalid",
  );
});

function guardToken(token) {
  return token.replaceAll(/[^A-Za-z0-9]/gu, "0").padEnd(63, "0").slice(0, 63);
}

function pgDumpEnvelope(body, token) {
  const guard = guardToken(token);
  return [
    "SET session_replication_role = replica;",
    "",
    "--",
    "-- PostgreSQL database dump",
    "--",
    "",
    `\\restrict ${guard}`,
    "",
    body,
    "--",
    "-- PostgreSQL database dump complete",
    "--",
    "",
    `\\unrestrict ${guard}`,
    "",
    "RESET ALL;",
    "",
  ].join("\n");
}

function pgSchemaEnvelope(body, token) {
  const guard = guardToken(token);
  return ["", `\\restrict ${guard}`, "", body, `\\unrestrict ${guard}`, "", ""].join("\n");
}

function pgRolesEnvelope(body, token) {
  const guard = guardToken(token);
  return [
    "",
    `\\restrict ${guard}`,
    "",
    body,
    `\\unrestrict ${guard}`,
    "",
    "RESET ALL;",
    "",
  ].join("\n");
}

test("tracked Supabase dump filters preserve PostgreSQL restricted-mode guards", () => {
  for (const path of DUMP_FILTERS) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /(?:un)?restrict/u);
  }
});

test("semantic SQL digest normalizes valid active guards for all managed SQL artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-sql-digest-test-"));
  try {
    const cases = [
      ["data.sql", pgDumpEnvelope],
      ["history-data.sql", pgDumpEnvelope],
      ["schema.sql", pgSchemaEnvelope],
      ["history-schema.sql", pgSchemaEnvelope],
      ["roles.sql", pgRolesEnvelope],
    ];
    for (const [artifactName, envelope] of cases) {
      const first = join(root, `${artifactName}.first`);
      const equivalent = join(root, `${artifactName}.equivalent`);
      const drifted = join(root, `${artifactName}.drifted`);
      writeFileSync(first, envelope("CREATE TABLE x(id bigint);\nSELECT setval('x_id_seq', 7);", "token_one"));
      writeFileSync(equivalent, envelope("CREATE TABLE x(id bigint);\nSELECT setval('x_id_seq', 7);", "token_two"));
      writeFileSync(drifted, envelope("CREATE TABLE x(id bigint);\nSELECT setval('x_id_seq', 8);", "token_three"));
      assert.equal(
        await semanticSqlFileDigest(first, artifactName),
        await semanticSqlFileDigest(equivalent, artifactName),
        `${artifactName} should ignore only its random active guard token`,
      );
      assert.notEqual(
        await semanticSqlFileDigest(first, artifactName),
        await semanticSqlFileDigest(drifted, artifactName),
        `${artifactName} should retain body bytes in its digest`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic SQL digest hashes guard-shaped inner SQL content", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-semantic-inner-guard-test-"));
  const first = join(root, "first.sql");
  const changed = join(root, "changed.sql");
  try {
    writeFileSync(first, pgDumpEnvelope("SELECT 'before';\n-- \\restrict inner_one\nSELECT 'after';", "outer_one"));
    writeFileSync(changed, pgDumpEnvelope("SELECT 'before';\n-- \\restrict inner_two\nSELECT 'after';", "outer_two"));
    assert.notEqual(
      await semanticSqlFileDigest(first, "data.sql"),
      await semanticSqlFileDigest(changed, "data.sql"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic SQL digest rejects missing or mismatched pg_dump guard pairs", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-semantic-invalid-guard-test-"));
  const mismatched = join(root, "mismatched.sql");
  const missing = join(root, "missing.sql");
  try {
    const openingToken = "opening0token".padEnd(63, "0").slice(0, 63);
    const differentToken = "different0token".padEnd(63, "0").slice(0, 63);
    writeFileSync(
      mismatched,
      pgDumpEnvelope("SELECT 1;", "opening0token").replace(
        `\\unrestrict ${openingToken}`,
        `\\unrestrict ${differentToken}`,
      ),
    );
    writeFileSync(
      missing,
      pgDumpEnvelope("SELECT 1;", "opening0token").replace(
        `\\unrestrict ${openingToken}\n`,
        "",
      ),
    );
    await expectCodeAsync(
      semanticSqlFileDigest(mismatched, "data.sql"),
      "dump_guard_envelope_invalid",
    );
    await expectCodeAsync(
      semanticSqlFileDigest(missing, "data.sql"),
      "dump_guard_envelope_invalid",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic SQL digest is byte-exact outside known active guard tokens", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-semantic-bytes-test-"));
  const canonical = join(root, "canonical.sql");
  const crlf = join(root, "crlf.sql");
  const noFinalNewline = join(root, "no-final-newline.sql");
  const schema = join(root, "schema.sql");
  const schemaChanged = join(root, "schema-changed.sql");
  try {
    const envelope = pgDumpEnvelope("SELECT 1;", "outer0token");
    writeFileSync(canonical, envelope);
    writeFileSync(crlf, envelope.replaceAll("\n", "\r\n"));
    writeFileSync(noFinalNewline, envelope.slice(0, -1));
    await expectCodeAsync(
      semanticSqlFileDigest(crlf, "data.sql"),
      "dump_guard_envelope_invalid",
    );
    await expectCodeAsync(
      semanticSqlFileDigest(noFinalNewline, "data.sql"),
      "dump_guard_envelope_invalid",
    );

    writeFileSync(schema, "-- arbitrary artifact\nSELECT 1;\n");
    writeFileSync(schemaChanged, "-- arbitrary artifact\nSELECT 2;\n");
    assert.notEqual(
      await semanticSqlFileDigest(schema, "other.sql"),
      await semanticSqlFileDigest(schemaChanged, "other.sql"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pooler receipt pins the documented session endpoint and rejects drift", () => {
  const project = { ref: REF, region: "ap-southeast-1" };
  const payload = [{
    identifier: REF,
    database_type: "PRIMARY",
    db_host: "aws-1-ap-southeast-1.pooler.supabase.com",
    db_user: `postgres.${REF}`,
    db_name: "postgres",
    pool_mode: "transaction",
    db_port: 6543,
  }];
  assert.deepEqual(normalizePoolerReceipt(payload, project), {
    host: "aws-1-ap-southeast-1.pooler.supabase.com",
    user: `postgres.${REF}`,
    database: "postgres",
    session_port: 5432,
    source_mode: "transaction",
    source_port: 6543,
  });
  expectCode(
    () => normalizePoolerReceipt([{ ...payload[0], pool_mode: "session" }], project),
    "management_pooler_invalid",
  );
});

test("PostgreSQL dump clients must meet a patched security floor", () => {
  assert.equal(
    patchedPostgresClientVersion("pg_dump (PostgreSQL) 18.6\n", "pg_dump"),
    "18.6",
  );
  assert.equal(
    patchedPostgresClientVersion("pg_dumpall (PostgreSQL) 17.11\n", "pg_dumpall"),
    "17.11",
  );
  assert.equal(
    patchedPostgresClientVersion("psql (PostgreSQL) 18.6\n", "psql"),
    "18.6",
  );
  expectCode(
    () => patchedPostgresClientVersion("pg_dump (PostgreSQL) 17.10\n", "pg_dump"),
    "postgres_client_security_update_required",
  );
  expectCode(
    () => patchedPostgresClientVersion("pg_dump 18.6\n", "pg_dump"),
    "postgres_client_version_invalid",
  );
});

test("every database dump pass imports one strictly validated synchronized snapshot", () => {
  const snapshotId = "00000003-0000001B-1";
  assert.equal(synchronizedSnapshotFlag(snapshotId), `--snapshot=${snapshotId}`);
  const plan = managedDatabaseDumpPlan(snapshotId);
  assert.equal(plan.length, 5);
  assert.equal(plan.find((entry) => entry.filename === "roles.sql").variables.EXTRA_FLAGS, undefined);
  for (const entry of plan.filter((candidate) => candidate.filename !== "roles.sql")) {
    assert.match(entry.variables.EXTRA_FLAGS, new RegExp(`(?:^| )--snapshot=${snapshotId}(?: |$)`, "u"));
    assert.equal(entry.variables.EXTRA_FLAGS.match(/--snapshot=/gu)?.length, 1);
  }
  for (const invalid of [
    "",
    "00000003-0000001B-0",
    "00000003-0000001B-1 --file=/tmp/leak",
    "00000003-0000001B-1\n--no-owner",
  ]) {
    expectCode(() => synchronizedSnapshotFlag(invalid), "database_snapshot_id_invalid");
  }
});

test("snapshot holder keeps one read-only transaction alive and drains on close", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-snapshot-holder-")));
  const state = { terminators: new Set(), processGroups: new Set() };
  const controller = new AbortController();
  const fakeHolder = String.raw`
    let input = "";
    let ready = false;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
      if (!ready && input.includes("pg_export_snapshot")) {
        ready = true;
        process.stdout.write("EVO_SYNC_SNAPSHOT:00000003-0000001B-1\n");
      }
      if (input.includes("ROLLBACK;") && input.includes("\\q")) process.exit(0);
    });
    setInterval(() => undefined, 1000);
  `;
  try {
    const holder = await openSynchronizedDatabaseSnapshot(
      process.execPath,
      ["-e", fakeHolder],
      {
        cwd: root,
        environment: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root },
        signal: controller.signal,
        state,
        timeoutMs: 5_000,
        killGraceMs: 50,
      },
    );
    assert.equal(holder.snapshotId, "00000003-0000001B-1");
    assert.equal(state.terminators.size, 1);
    assert.equal(state.processGroups.size, 1);
    await holder.close();
    assert.equal(state.terminators.size, 0);
    assert.equal(state.processGroups.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("snapshot holder fails closed on malformed output and interruption", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-snapshot-failure-")));
  const environment = { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root };
  try {
    await expectCodeAsync(
      openSynchronizedDatabaseSnapshot(
        process.execPath,
        ["-e", 'process.stdout.write("not-a-snapshot\\n"); setInterval(() => {}, 1000)'],
        {
          cwd: root,
          environment,
          signal: new AbortController().signal,
          state: { terminators: new Set(), processGroups: new Set() },
          timeoutMs: 5_000,
          killGraceMs: 50,
        },
      ),
      "database_snapshot_holder_output_invalid",
    );

    const state = { terminators: new Set(), processGroups: new Set() };
    const controller = new AbortController();
    const holder = await openSynchronizedDatabaseSnapshot(
      process.execPath,
      ["-e", String.raw`
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => {
          input += chunk;
          if (input.includes("pg_export_snapshot")) {
            process.stdout.write("EVO_SYNC_SNAPSHOT:00000003-0000001B-1\n");
          }
        });
        process.on("SIGTERM", () => undefined);
        setInterval(() => undefined, 1000);
      `],
      {
        cwd: root,
        environment,
        signal: controller.signal,
        state,
        timeoutMs: 5_000,
        killGraceMs: 50,
      },
    );
    controller.abort();
    await expectCodeAsync(holder.done, "export_interrupted");
    assert.equal(state.terminators.size, 0);
    assert.equal(state.processGroups.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("database TLS pins the reviewed Supabase CA bytes, fingerprint, and validity", () => {
  const verified = validateSupabaseDatabaseCa(
    DATABASE_CA,
    Date.parse("2026-09-05T00:00:00Z"),
  );
  assert.equal(
    verified.sha256,
    "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
  );
  assert.equal(
    verified.fingerprint,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );

  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-export-ca-test-")));
  const changed = join(root, "changed.crt");
  try {
    writeFileSync(
      changed,
      readFileSync(DATABASE_CA, "utf8").replace("MIIDxD", "NIIDxD"),
      { mode: 0o600 },
    );
    expectCode(() => validateSupabaseDatabaseCa(changed), "database_ca_invalid");
    expectCode(
      () => validateSupabaseDatabaseCa(DATABASE_CA, Date.parse("2031-04-27T00:00:00Z")),
      "database_ca_invalid",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command timeout forcibly ends a child that ignores SIGTERM", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-command-timeout-test-"));
  const marker = join(root, "sigterm-observed");
  const startedAt = Date.now();
  try {
    await expectCodeAsync(
      spawnCommand(
        process.execPath,
        [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1] + '.ready', 'ready'); process.on('SIGTERM', () => require('node:fs').writeFileSync(process.argv[1], 'term')); setInterval(() => {}, 1000);",
          marker,
        ],
        {
          cwd: root,
          environment: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root },
          code: "bounded_timeout",
          timeoutMs: 300,
          killGraceMs: 100,
        },
      ),
      "bounded_timeout",
    );
    assert.equal(existsSync(`${marker}.ready`), true);
    assert.equal(existsSync(marker), true);
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command input failure rejects cleanly when the child closes stdin early", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-command-stdin-test-"));
  try {
    await expectCodeAsync(
      spawnCommand(
        process.execPath,
        ["-e", "process.stdin.destroy(); setTimeout(() => {}, 250);"],
        {
          cwd: root,
          environment: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root },
          input: Buffer.alloc(16 * 1024 * 1024, 0x61),
          code: "stdin_closed",
          timeoutMs: 2_000,
          killGraceMs: 100,
        },
      ),
      "stdin_closed",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command timeout kills a SIGTERM-ignoring process tree before settling", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-export-command-tree-test-"));
  const pidPath = join(root, "grandchild.pid");
  let grandchildPid = null;
  try {
    await expectCodeAsync(
      spawnCommand(
        process.execPath,
        [
          "-e",
          [
            "const { spawn } = require('node:child_process');",
            "const { writeFileSync } = require('node:fs');",
            "const grandchild = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`], { stdio: 'ignore' });",
            "writeFileSync(process.argv[1], String(grandchild.pid));",
            "process.on('SIGTERM', () => {});",
            "setInterval(() => {}, 1000);",
          ].join(" "),
          pidPath,
        ],
        {
          cwd: root,
          environment: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root },
          code: "process_tree_timeout",
          timeoutMs: 350,
          killGraceMs: 100,
        },
      ),
      "process_tree_timeout",
    );
    assert.equal(existsSync(pidPath), true);
    grandchildPid = Number(readFileSync(pidPath, "utf8"));
    assert.equal(Number.isSafeInteger(grandchildPid), true);
    assert.throws(
      () => process.kill(grandchildPid, 0),
      (error) => error?.code === "ESRCH",
    );
  } finally {
    if (Number.isSafeInteger(grandchildPid)) {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function oneObjectInventory(size) {
  return storageInventoryDigest({
    buckets: [{ id: "private", name: "private", public: false }],
    objects: [{
      bucket_id: "private",
      path: "object.bin",
      id: "object-id",
      metadata: { size },
    }],
  });
}

async function runDownloadCase({ size, body, idleTimeoutMs = 100, declaredSize = size }) {
  const root = mkdtempSync(join(tmpdir(), "evo-export-download-test-"));
  try {
    return await downloadStorageObjects({
      inventory: oneObjectInventory(size),
      origin: `https://${REF}.supabase.co`,
      secretKey: `sb_secret_${"a".repeat(24)}`,
      outputDirectory: join(root, "bytes"),
      signal: new AbortController().signal,
      idleTimeoutMs,
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-length": String(declaredSize) },
      }),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Storage downloader accepts a real zero-byte response and hashes empty content", async () => {
  const result = await runDownloadCase({ size: 0, body: null });
  assert.equal(result.totalBytes, 0);
  assert.equal(result.objects[0].sha256, sha256(Buffer.alloc(0)));
});

test("Storage downloader permits progressive streams longer than the idle window", async () => {
  const body = new ReadableStream({
    start(controller) {
      let sent = 0;
      const timer = setInterval(() => {
        controller.enqueue(Uint8Array.of(sent));
        sent += 1;
        if (sent === 3) {
          clearInterval(timer);
          controller.close();
        }
      }, 40);
    },
  });
  const result = await runDownloadCase({ size: 3, body, idleTimeoutMs: 100 });
  assert.equal(result.totalBytes, 3);
});

test("Storage downloader fails closed on inactivity and oversized streams", async () => {
  const stalled = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1));
    },
  });
  await expectCodeAsync(
    runDownloadCase({ size: 2, body: stalled, idleTimeoutMs: 50 }),
    "storage_object_download_timed_out",
  );
  await expectCodeAsync(
    runDownloadCase({ size: 1, body: Uint8Array.of(1, 2) }),
    "storage_object_size_mismatch",
  );
});

test("Storage downloader cancels the body when Content-Length is invalid", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await expectCodeAsync(
    runDownloadCase({ size: 1, declaredSize: 2, body }),
    "storage_object_size_invalid",
  );
  assert.equal(cancelled, true);
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
    signature: { namespace: "evo-v3-managed-supabase-recovery", identity: "evo-v3-managed-supabase-export", public_key_fingerprint: "SHA256:abc", trust_root: "operator-held-external-public-key" },
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
