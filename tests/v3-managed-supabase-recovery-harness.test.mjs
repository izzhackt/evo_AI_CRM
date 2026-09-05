import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import test from "node:test";

import {
  classifyMigrationLedgerQueryFailure,
  classifyLocalSupabaseStartFailure,
  deriveSourceIdentitySha256,
  parseHarnessOptions,
  parseQualifiedCopyHeader,
  sanitizeHttpResponseDiagnostic,
  sanitizeLocalSupabaseStartDiagnostic,
  sanitizeDatabaseCommandDiagnostic,
  selectOwnedContainerIds,
  selectOwnedNetworkNames,
  selectOwnedVolumeNames,
  validateMigrationLedgerAttestation,
  validateRepositoryStateSnapshot,
  validateDatabaseManifest,
  validateStorageManifest,
  verifiedAttestedPrefix,
} from "../scripts/test-v3-managed-supabase-recovery-orbstack.mjs";

const scriptUrl = new URL(
  "../scripts/test-v3-managed-supabase-recovery-orbstack.mjs",
  import.meta.url,
);
const source = readFileSync(scriptUrl, "utf8");
const createdAt = "2026-09-05T00:00:00.000Z";
const storageCreatedAt = "2026-09-05T00:07:00.000Z";
const ledgerAttestedAt = "2026-09-05T03:00:00.000Z";
const projectRef = "abcde12345fghij67890";
const region = "ap-southeast-1";
const sourceIdentitySha256 = deriveSourceIdentitySha256(projectRef, region);
const projectRefSha256 = createHash("sha256").update(projectRef).digest("hex");
const expectedRepositoryCommit = "a".repeat(40);

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessToStop(pid) {
  const deadline = Date.now() + 2_000;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  return !processExists(pid);
}

function forceStopProcess(pid) {
  if (!pid || !processExists(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function migrationLedgerDigest(entries) {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function ledgerAttestation(entries = [
  { version: "001", name: "platform_foundation" },
  { version: "002", name: "platform_identity" },
], overrides = {}) {
  return {
    schema: "evo-managed-supabase-migration-ledger-attestation/v1",
    createdAt: ledgerAttestedAt,
    databaseCreatedAt: createdAt,
    sourceIdentitySha256,
    ledgerSha256: migrationLedgerDigest(entries),
    source: entries,
    ...overrides,
  };
}

function logicalManifest(overrides = {}) {
  return {
    schema: "evo-managed-supabase-logical-backup/v1",
    createdAt,
    projectRef,
    region,
    databaseMajor: 17,
    migrationLedger: {
      count: 79,
      minVersion: "001",
      maxVersion: "079",
    },
    files: {
      "roles.sql": { bytes: 11, sha256: "1".repeat(64) },
      "schema.sql": { bytes: 22, sha256: "2".repeat(64) },
      "data.sql": { bytes: 33, sha256: "3".repeat(64) },
    },
    ...overrides,
  };
}

function sourceBuckets() {
  return [
    {
      id: "profile-avatars",
      name: "profile-avatars",
      public: true,
      fileSizeLimit: 26_214_400,
      allowedMimeTypes: ["image/png"],
    },
    {
      id: "flow-media",
      name: "flow-media",
      public: true,
      fileSizeLimit: 26_214_400,
      allowedMimeTypes: null,
    },
    {
      id: "private-inbox-media",
      name: "private-inbox-media",
      public: false,
      fileSizeLimit: 52_428_800,
      allowedMimeTypes: ["application/octet-stream", "image/png"],
    },
  ];
}

function emptyStorageManifest(overrides = {}) {
  return {
    schema: "evo-managed-supabase-storage-backup/v1",
    createdAt: storageCreatedAt,
    projectRef,
    bucketCount: 3,
    publicBucketCount: 2,
    objectCount: 0,
    totalBytes: 0,
    archive: {
      format: "tar.gz",
      bytes: 64,
      sha256: "4".repeat(64),
    },
    buckets: sourceBuckets(),
    ...overrides,
  };
}

function failureCode(factory) {
  assert.throws(factory, (error) => {
    assert.equal(typeof error?.code, "string");
    return true;
  });
  try {
    factory();
  } catch (error) {
    return error.code;
  }
  return null;
}

test("contract and missing opt-in are side-effect-free machine-readable states", () => {
  const contract = spawnSync(process.execPath, [scriptUrl.pathname, "contract"], {
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(contract.status, 0);
  const contractResult = JSON.parse(contract.stdout);
  assert.equal(contractResult.status, "contract");
  assert.equal(contractResult.proof, "not_run");
  assert.equal(contractResult.exportStage, "separate_read_only_operator_process");
  assert.equal(contractResult.safety.managedSupabase, "never_contacted");

  const skipped = spawnSync(process.execPath, [scriptUrl.pathname, "run"], {
    encoding: "utf8",
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name !== "EVO_RUN_V3_MANAGED_SUPABASE_RECOVERY_ORBSTACK",
      ),
    ),
  });
  assert.equal(skipped.status, 0);
  assert.deepEqual(JSON.parse(skipped.stdout), {
    ok: true,
    status: "skipped",
    code: "explicit_opt_in_required",
    optIn: "EVO_RUN_V3_MANAGED_SUPABASE_RECOVERY_ORBSTACK",
    managedSupabaseTouched: false,
    localSupabaseStarted: false,
  });
});

test("arguments require all encrypted artifacts, one private age identity, and explicit source binding", () => {
  const args = [
    "--database-manifest", "/private/database-manifest.json.age",
    "--migration-ledger-attestation", "/private/migration-ledger-attestation.json.age",
    "--roles", "/private/roles.sql.age",
    "--schema", "/private/schema.sql.age",
    "--data", "/private/data.sql.age",
    "--storage-manifest", "/private/storage-manifest.json.age",
    "--storage-archive", "/private/storage-objects.tar.gz.age",
    "--age-identity", "/private/identity.txt",
    "--backup-created-at", createdAt,
    "--source-identity-sha256", sourceIdentitySha256,
    "--expected-repository-commit", expectedRepositoryCommit,
    "--max-age-hours", "96",
  ];
  const parsed = parseHarnessOptions(args, {});
  assert.equal(parsed.databaseManifest, "/private/database-manifest.json.age");
  assert.equal(parsed.migrationLedgerAttestation, "/private/migration-ledger-attestation.json.age");
  assert.equal(parsed.storageArchive, "/private/storage-objects.tar.gz.age");
  assert.equal(parsed.ageIdentity, "/private/identity.txt");
  assert.equal(parsed.maxAgeHours, 96);
  assert.equal(parsed.sourceIdentitySha256, sourceIdentitySha256);
  assert.equal(parsed.expectedRepositoryCommit, expectedRepositoryCommit);

  assert.equal(
    failureCode(() => parseHarnessOptions(args, {
      EVO_V3_RECOVERY_DATABASE_MANIFEST: "/private/other.age",
    })),
    "argument_environment_conflict",
  );
  assert.equal(
    failureCode(() => parseHarnessOptions(args.slice(0, -4), {})),
    "required_argument_missing",
  );
});

test("repository state is exact-commit bound and rejects tracked or untracked drift", () => {
  const clean = validateRepositoryStateSnapshot({
    commit: expectedRepositoryCommit,
    tree: "b".repeat(40),
    status: "",
  }, expectedRepositoryCommit);
  assert.deepEqual(clean, { commit: expectedRepositoryCommit, tree: "b".repeat(40) });

  assert.equal(failureCode(() => validateRepositoryStateSnapshot({
    commit: "c".repeat(40),
    tree: "b".repeat(40),
    status: "",
  }, expectedRepositoryCommit)), "repository_commit_mismatch");
  assert.equal(failureCode(() => validateRepositoryStateSnapshot({
    commit: expectedRepositoryCommit,
    tree: "b".repeat(40),
    status: "?? src/untracked.ts\n M supabase/config.toml",
  }, expectedRepositoryCommit)), "repository_worktree_not_clean");
});

test("encrypted ledger attestation binds exact ordered version/name rows and digest", () => {
  const rows = [
    { version: "001", name: "platform_foundation" },
    { version: "002", name: "platform_identity" },
  ];
  const validated = validateMigrationLedgerAttestation(ledgerAttestation(rows), {
    databaseCreatedAt: createdAt,
    sourceIdentitySha256,
  });
  assert.deepEqual(validated.source, rows);
  assert.equal(validated.ledgerSha256, migrationLedgerDigest(rows));

  assert.equal(failureCode(() => validateMigrationLedgerAttestation(
    ledgerAttestation(rows, { sourceIdentitySha256: "f".repeat(64) }),
    { databaseCreatedAt: createdAt, sourceIdentitySha256 },
  )), "migration_ledger_attestation_source_mismatch");
  assert.equal(failureCode(() => validateMigrationLedgerAttestation(
    ledgerAttestation(rows, { ledgerSha256: "f".repeat(64) }),
    { databaseCreatedAt: createdAt, sourceIdentitySha256 },
  )), "migration_ledger_attestation_digest_mismatch");
  assert.equal(failureCode(() => validateMigrationLedgerAttestation(
    ledgerAttestation(rows, { createdAt: "2026-09-04T23:59:59.999Z" }),
    { databaseCreatedAt: createdAt, sourceIdentitySha256 },
  )), "migration_ledger_attestation_precedes_database");
  const reversed = [...rows].reverse();
  assert.equal(failureCode(() => validateMigrationLedgerAttestation(
    ledgerAttestation(reversed),
    { databaseCreatedAt: createdAt, sourceIdentitySha256 },
  )), "migration_ledger_attestation_sequence_invalid");

  const root = {
    entries: rows.map((entry) => ({ ...entry, filename: `${entry.version}_${entry.name}.sql` })),
    recordedHistoryCount: 2,
  };
  assert.deepEqual(verifiedAttestedPrefix(root, {
    count: 2,
    minVersion: "001",
    maxVersion: "002",
  }, validated).map(({ version, name }) => ({ version, name })), rows);
  const renamed = [{ ...rows[0] }, { version: "002", name: "wrong_name" }];
  assert.equal(failureCode(() => verifiedAttestedPrefix(root, {
    count: 2,
    minVersion: "001",
    maxVersion: "002",
  }, validateMigrationLedgerAttestation(ledgerAttestation(renamed), {
    databaseCreatedAt: createdAt,
    sourceIdentitySha256,
  }))), "migration_ledger_attestation_root_prefix_mismatch");
});

test("database manifest binds official roles/schema/data hashes, source, time, major, and ledger", () => {
  const result = validateDatabaseManifest(logicalManifest(), {
    createdAt,
    sourceIdentitySha256,
  });
  assert.equal(result.databaseMajor, 17);
  assert.deepEqual(result.migrationLedger, {
    count: 79,
    minVersion: "001",
    maxVersion: "079",
  });
  assert.equal(result.files["data.sql"].sha256, "3".repeat(64));

  assert.equal(
    failureCode(() => validateDatabaseManifest(logicalManifest({ region: "eu-west-1" }), {
      createdAt,
      sourceIdentitySha256,
    })),
    "database_manifest_source_identity_mismatch",
  );
  assert.equal(
    failureCode(() => validateDatabaseManifest(logicalManifest({
      migrationLedger: { count: 78, minVersion: "001", maxVersion: "079" },
    }), { createdAt, sourceIdentitySha256 })),
    "database_migration_ledger_invalid",
  );
  assert.equal(
    failureCode(() => validateDatabaseManifest(logicalManifest({ unexpected: true }), {
      createdAt,
      sourceIdentitySha256,
    })),
    "database_manifest_shape_invalid",
  );
});

test("truthfully empty Storage inventory preserves two public legacy buckets and nullable MIME policy", () => {
  const result = validateStorageManifest(emptyStorageManifest(), {
    databaseCreatedAt: createdAt,
    projectRefSha256,
  });
  assert.equal(result.bucketCount, 3);
  assert.equal(result.publicBucketCount, 2);
  assert.equal(result.objectCount, 0);
  assert.equal(result.totalBytes, 0);
  assert.deepEqual(result.objects, []);
  assert.equal(result.buckets.filter((bucket) => bucket.public).length, 2);
  assert.equal(result.buckets[1].allowedMimeTypes, null);

  assert.equal(
    validateStorageManifest(
      emptyStorageManifest({ createdAt: "2026-09-05T00:59:59.000Z" }),
      { databaseCreatedAt: createdAt, projectRefSha256 },
    ).createdAt,
    "2026-09-05T00:59:59.000Z",
  );

  assert.equal(
    failureCode(() => validateStorageManifest(emptyStorageManifest({ publicBucketCount: 1 }), {
      databaseCreatedAt: createdAt,
      projectRefSha256,
    })),
    "storage_public_bucket_count_mismatch",
  );
  const buckets = sourceBuckets();
  buckets[0] = { ...buckets[0], public: "true" };
  assert.equal(
    failureCode(() => validateStorageManifest(emptyStorageManifest({ buckets }), {
      databaseCreatedAt: createdAt,
      projectRefSha256,
    })),
    "storage_bucket_invalid",
  );
  assert.equal(
    failureCode(() => validateStorageManifest(
      emptyStorageManifest({ createdAt: "2026-09-05T01:00:01.000Z" }),
      { databaseCreatedAt: createdAt, projectRefSha256 },
    )),
    "backup_capture_window_exceeded",
  );
});

test("non-empty Storage backup requires per-object integrity and traversal-safe archive mapping", () => {
  const validObject = {
    archivePath: `objects/${"a".repeat(64)}.bin`,
    bucketId: "private-inbox-media",
    objectPath: "organization/document.pdf",
    contentType: "application/pdf",
    bytes: 10,
    sha256: "5".repeat(64),
  };
  const withObject = emptyStorageManifest({
    objectCount: 1,
    totalBytes: 10,
    objects: [validObject],
  });
  assert.equal(
    validateStorageManifest(withObject, { createdAt, projectRefSha256 }).objectCount,
    1,
  );
  const missingObjects = { ...withObject };
  delete missingObjects.objects;
  assert.equal(
    failureCode(() => validateStorageManifest(missingObjects, { createdAt, projectRefSha256 })),
    "storage_object_manifest_missing",
  );
  assert.equal(
    failureCode(() => validateStorageManifest({
      ...withObject,
      objects: [{ ...validObject, archivePath: "../outside" }],
    }, { createdAt, projectRefSha256 })),
    "storage_archive_path_invalid",
  );
  assert.equal(
    failureCode(() => validateStorageManifest({
      ...withObject,
      objects: [{ ...validObject, objectPath: "../../customer.pdf" }],
    }, { createdAt, projectRefSha256 })),
    "storage_object_path_invalid",
  );
});

test("COPY parser accepts only qualified targets from the exact live-dump schema allowlist", () => {
  assert.deepEqual(
    parseQualifiedCopyHeader('COPY "auth"."users" ("id", email) FROM stdin;'),
    { schema: "auth", table: "users" },
  );
  assert.deepEqual(
    parseQualifiedCopyHeader("COPY platform.organization_memberships (id, organization_id) FROM stdin;"),
    { schema: "platform", table: "organization_memberships" },
  );
  assert.deepEqual(
    parseQualifiedCopyHeader("COPY pgmq.q_platform_work_v1 (msg_id, message) FROM stdin;"),
    { schema: "pgmq", table: "q_platform_work_v1" },
  );
  assert.equal(
    failureCode(() => parseQualifiedCopyHeader("COPY users (id) FROM stdin;")),
    "copy_header_invalid",
  );
  assert.equal(
    failureCode(() => parseQualifiedCopyHeader(
      "COPY supabase_migrations.schema_migrations (version) FROM stdin;",
    )),
    "copy_target_schema_not_allowed",
  );
  assert.equal(
    failureCode(() => parseQualifiedCopyHeader("COPY pg_catalog.pg_authid (oid) FROM stdin;")),
    "copy_target_schema_not_allowed",
  );
  assert.equal(
    failureCode(() => parseQualifiedCopyHeader(
      "COPY public.safe (id) FROM stdin; TRUNCATE public.other;",
    )),
    "copy_header_invalid",
  );
  assert.equal(
    failureCode(() => parseQualifiedCopyHeader("COPY pgmq.meta (queue_name) FROM stdin;")),
    "pgmq_copy_inventory_unsupported",
  );
});

test("cleanup inventory selectors match only the exact isolated Supabase contour", () => {
  const projectName = "evov3recoverya1b2c3d4e5f6";
  const networkName = "evo_v3_recovery_a1b2c3d4e5f6_private";
  assert.deepEqual(
    [...selectOwnedContainerIds([
      `0123456789ab\tsupabase_db_${projectName}`,
      `123456789abc\tsupabase_db_${projectName}x`,
      `23456789abcd\tnotsupabase_db_${projectName}`,
      "3456789abcde\tsupabase_db_evov3recovery000000000000",
    ].join("\n"), projectName)],
    ["0123456789ab"],
  );
  assert.deepEqual(
    [...selectOwnedVolumeNames([
      `supabase_db_${projectName}`,
      `supabase_db_${projectName}x`,
      `notsupabase_db_${projectName}`,
    ].join("\n"), projectName)],
    [`supabase_db_${projectName}`],
  );
  assert.deepEqual(
    [...selectOwnedNetworkNames([
      networkName,
      `${networkName}_other`,
      "evo_v3_recovery_000000000000_private",
    ].join("\n"), networkName)],
    [networkName],
  );
  assert.equal(
    failureCode(() => selectOwnedContainerIds("malformed", projectName)),
    "cleanup_container_inventory_invalid",
  );
  assert.equal(
    failureCode(() => selectOwnedNetworkNames("", "bridge")),
    "cleanup_network_scope_invalid",
  );
});

test("local Supabase start captures only classified failures and requires its own readiness proof", () => {
  assert.equal(
    classifyLocalSupabaseStartFailure("Error response from daemon: network recovery not found"),
    "local_supabase_start_network_unavailable",
  );
  assert.equal(
    classifyLocalSupabaseStartFailure(
      "failed to connect to postgres: dial error (connect ECONNREFUSED 127.0.0.1:54321)",
    ),
    "local_supabase_start_postgres_loopback_unreachable",
  );
  assert.equal(
    classifyLocalSupabaseStartFailure("Bind for 127.0.0.1:54321 failed: port is already allocated"),
    "local_supabase_start_port_conflict",
  );
  assert.equal(
    classifyLocalSupabaseStartFailure("container supabase_auth is unhealthy"),
    "local_supabase_start_health_check_failed",
  );
  assert.equal(
    classifyLocalSupabaseStartFailure("failed parsing config.toml"),
    "local_supabase_start_config_invalid",
  );
  assert.equal(
    classifyLocalSupabaseStartFailure("unrecognized failure with eyJ-secret-like-local-key"),
    "local_supabase_start_failed_unclassified",
  );
  const diagnostic = sanitizeLocalSupabaseStartDiagnostic([
    "ANON_KEY=eyJ-private-local-value",
    "failed to create docker volume in /Users/private-person/work",
    "failed for evov3recoverya1b2c3d4e5f6 on evo_v3_recovery_a1b2c3d4e5f6_private",
  ].join("\n"), 1);
  assert.deepEqual(diagnostic.fingerprints, ["volume_create"]);
  assert.equal(diagnostic.exitStatus, 1);
  assert.equal(diagnostic.sanitizedErrorTemplates.length, 2);
  assert.doesNotMatch(JSON.stringify(diagnostic), /eyJ-private|private-person|a1b2c3d4e5f6/u);

  const runBody = source.slice(
    source.indexOf("async function runRecovery"),
    source.indexOf("async function main"),
  );
  assert.match(runBody, /"--ignore-health-check"/u);
  assert.match(runBody, /failureClassifier: classifyLocalSupabaseStartFailure/u);
  assert.match(runBody, /failureDiagnostic: sanitizeLocalSupabaseStartDiagnostic/u);
  assert.match(runBody, /await waitForLocalSupabaseReadiness/u);
  assert.ok(runBody.indexOf("state.stackStarted = true") <
    runBody.indexOf("await waitForLocalSupabaseReadiness"));
});

test("post-migration ledger failures expose only a bounded category and output fingerprint", () => {
  assert.equal(
    classifyMigrationLedgerQueryFailure(
      'ERROR: relation "supabase_migrations.schema_migrations" does not exist',
    ),
    "migration_ledger_relation_missing",
  );
  assert.equal(
    classifyMigrationLedgerQueryFailure('ERROR: permission denied for schema supabase_migrations'),
    "migration_ledger_permission_denied",
  );
  assert.equal(
    classifyMigrationLedgerQueryFailure("psql: connection to server at 127.0.0.1 failed: Connection refused"),
    "migration_ledger_connection_failed",
  );
  assert.equal(
    classifyMigrationLedgerQueryFailure("ERROR: unexpected database failure"),
    "migration_ledger_query_failed_unclassified",
  );

  const diagnostic = sanitizeDatabaseCommandDiagnostic([
    'ERROR: relation "supabase_migrations.schema_migrations" does not exist',
    "DETAIL: private row value must never leave the child process",
  ].join("\n"), 1);
  assert.deepEqual(diagnostic.fingerprints, ["relation_missing"]);
  assert.equal(diagnostic.exitStatus, 1);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private row value|schema_migrations/u);
});

test("HTTP diagnostics expose only status and a bounded PostgREST or SQLSTATE code", () => {
  const diagnostic = sanitizeHttpResponseDiagnostic(new Response(null, {
    status: 503,
    headers: {
      "Proxy-Status": 'PostgREST; error=PGRST002; details="private-person@example.invalid"',
      "X-Private-Value": "must-not-escape",
    },
  }));
  assert.deepEqual(diagnostic, { httpStatus: 503, proxyErrorCode: "PGRST002" });
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-person|must-not-escape/u);

  assert.deepEqual(sanitizeHttpResponseDiagnostic(new Response(null, {
    status: 503,
    headers: { "Proxy-Status": "PostgREST; error=08006" },
  })), { httpStatus: 503, proxyErrorCode: "08006" });
});

test("executor is pinned to OrbStack and only targets one unique local contour", () => {
  assert.match(source, /execute\("orb", \["status"\]/u);
  assert.match(source, /execute\("docker", \["context", "show"\]/u);
  assert.match(source, /context !== "orbstack"/u);
  assert.match(source, /process\.env\.DOCKER_HOST/u);
  assert.match(source, /\["--context", "orbstack", \.\.\.args\]/u);
  assert.match(source, /mkdtempSync\(join\(temporaryRoot, HARNESS_PREFIX\)\)/u);
  assert.match(source, /projectName = `evov3recovery\$\{suffix\}`/u);
  assert.match(source, /bridge\.host_binding_ipv4=127\.0\.0\.1/u);
  assert.match(source, /safeHarnessRoot/u);
  assert.match(source, /name\.startsWith\("supabase_"\) && name\.endsWith\(`_\$\{projectName\}`\)/u);
  assert.match(source, /"stop", "--no-backup", "--project-id", state\.projectName, "--workdir", state\.supabaseRoot/u);
  assert.match(source, /cleanup_owned_containers_remain/u);
  assert.match(source, /cleanup_owned_volumes_remain/u);
  assert.match(source, /cleanup_owned_network_remains/u);
  assert.doesNotMatch(source, /docker context use|orb start|system\s+prune|volume\s+prune|network\s+prune/u);

  const networkCreateBody = source.slice(
    source.indexOf("state.networkCreated = true"),
    source.indexOf("state.stackStarted = true"),
  );
  assert.match(networkCreateBody, /docker\(\[\s*"network",\s*"create"/u);
  assert.doesNotMatch(networkCreateBody, /"--internal"/u);

  const cleanupBody = source.slice(
    source.indexOf("function cleanupContour"),
    source.indexOf("function writeSanitizedEvidence"),
  );
  assert.equal(cleanupBody.match(/ownedContainerIds\(state\)/gu)?.length, 2);
  assert.equal(cleanupBody.match(/ownedVolumeNames\(state\)/gu)?.length, 2);
  assert.equal(cleanupBody.match(/ownedNetworkNames\(state\)/gu)?.length, 1);
  assert.ok(cleanupBody.indexOf('["network", "rm", state.networkName]') <
    cleanupBody.indexOf("ownedNetworkNames(state)"));
  assert.match(source, /process\.on\("SIGINT", sigintHandler\)/u);
  assert.match(source, /process\.on\("SIGTERM", sigtermHandler\)/u);
  assert.match(source, /process\.removeListener\("SIGINT", sigintHandler\)/u);
  assert.match(source, /process\.removeListener\("SIGTERM", sigtermHandler\)/u);
  assert.match(source, /process\.once\("exit", exitCleanupHandler\)/u);
  assert.match(source, /cleanupActiveState/u);
});

test("SIGINT and SIGTERM stop the exact active browser-proof children before exit", async (t) => {
  for (const [signal, expectedExitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    await t.test(signal, async () => {
      const helperSource = `
        import { spawn } from "node:child_process";
        import { installProcessCleanupHandlers } from ${JSON.stringify(scriptUrl.href)};

        const waitForExit = (child) => child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise((resolveExit) => child.once("exit", resolveExit));
        const sleeper = "setInterval(() => {}, 1_000)";
        const appChild = spawn(process.execPath, ["--eval", sleeper], {
          detached: process.platform !== "win32",
          stdio: "ignore",
        });
        const browserChild = spawn(process.execPath, ["--eval", sleeper], {
          stdio: "ignore",
        });
        const browserServer = {
          process: () => browserChild,
          close: async () => {
            if (browserChild.exitCode === null && browserChild.signalCode === null) {
              browserChild.kill("SIGTERM");
            }
            await waitForExit(browserChild);
          },
          kill: async () => {
            if (browserChild.exitCode === null && browserChild.signalCode === null) {
              browserChild.kill("SIGKILL");
            }
            await waitForExit(browserChild);
          },
        };
        const browserProof = {
          appChild,
          browserServerPromise: Promise.resolve(browserServer),
        };
        const processExists = (pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (error) {
            if (error?.code === "ESRCH") return false;
            throw error;
          }
        };
        installProcessCleanupHandlers({
          getBrowserProof: () => browserProof,
          cleanup: () => process.stdout.write(JSON.stringify({
            cleanupSawAppRunning: processExists(appChild.pid),
            cleanupSawBrowserRunning: processExists(browserChild.pid),
          }) + "\\n"),
        });
        process.stdout.write(JSON.stringify({
          appPid: appChild.pid,
          browserPid: browserChild.pid,
        }) + "\\n");
      `;
      const probe = spawn(
        process.execPath,
        ["--input-type=module", "--eval", helperSource],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      let pids;
      probe.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const exitPromise = once(probe, "exit");
      const lines = createInterface({ input: probe.stdout });
      try {
        const line = await withTimeout(
          Promise.race([
            once(lines, "line").then(([value]) => value),
            exitPromise.then(([code, exitSignal]) => {
              throw new Error(
                `signal probe exited before ready: code=${code} signal=${exitSignal} stderr=${stderr}`,
              );
            }),
          ]),
          5_000,
          `signal probe did not become ready: stderr=${stderr}`,
        );
        pids = JSON.parse(line);
        assert.equal(processExists(pids.appPid), true);
        assert.equal(processExists(pids.browserPid), true);
        const cleanupLinePromise = once(lines, "line").then(([value]) => JSON.parse(value));
        assert.equal(probe.kill(signal), true);
        const cleanupObservation = await withTimeout(
          cleanupLinePromise,
          5_000,
          `signal probe did not report cleanup ordering after ${signal}: stderr=${stderr}`,
        );
        const [exitCode, exitSignal] = await withTimeout(
          exitPromise,
          5_000,
          `signal probe did not exit after ${signal}: stderr=${stderr}`,
        );
        assert.deepEqual(cleanupObservation, {
          cleanupSawAppRunning: false,
          cleanupSawBrowserRunning: false,
        }, `stderr=${stderr}`);
        assert.equal(exitSignal, null);
        assert.equal(exitCode, expectedExitCode);
        assert.equal(await waitForProcessToStop(pids.appPid), true);
        assert.equal(await waitForProcessToStop(pids.browserPid), true);
      } finally {
        lines.close();
        if (probe.exitCode === null && probe.signalCode === null) probe.kill("SIGKILL");
        forceStopProcess(pids?.appPid);
        forceStopProcess(pids?.browserPid);
      }
    });
  }
});

test("SIGTERM without an active browser proof still cleans up and exits 143", async () => {
  const helperSource = `
    import { installProcessCleanupHandlers } from ${JSON.stringify(scriptUrl.href)};
    const preSignalLifetime = setInterval(() => undefined, 1_000);
    installProcessCleanupHandlers({
      getBrowserProof: () => undefined,
      cleanup: () => {
        clearInterval(preSignalLifetime);
        process.stdout.write(JSON.stringify({ exitCodeDuringCleanup: process.exitCode }) + "\\n");
      },
    });
    process.stdin.once("data", () => {
      process.stdin.destroy();
      process.kill(process.pid, "SIGTERM");
    });
    process.stdout.write("ready\\n");
  `;
  const probe = spawn(
    process.execPath,
    ["--input-type=module", "--eval", helperSource],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  probe.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitPromise = once(probe, "exit");
  const lines = createInterface({ input: probe.stdout });
  try {
    const [ready] = await withTimeout(
      once(lines, "line"),
      5_000,
      `no-browser signal probe did not become ready: stderr=${stderr}`,
    );
    assert.equal(ready, "ready");
    const cleanupLinePromise = once(lines, "line").then(([line]) => JSON.parse(line));
    probe.stdin.end("signal\n");
    const [cleanupObservation, [exitCode, exitSignal]] = await withTimeout(
      Promise.all([cleanupLinePromise, exitPromise]),
      5_000,
      `no-browser signal probe did not finish: stderr=${stderr}`,
    );
    assert.deepEqual(cleanupObservation, { exitCodeDuringCleanup: 143 });
    assert.equal(exitSignal, null);
    assert.equal(exitCode, 143);
  } finally {
    lines.close();
    if (probe.exitCode === null && probe.signalCode === null) probe.kill("SIGKILL");
  }
});

test("repeated same or different signals cannot bypass active teardown", async (t) => {
  for (const { firstSignal, secondSignal, expectedExitCode } of [
    { firstSignal: "SIGTERM", secondSignal: "SIGTERM", expectedExitCode: 143 },
    { firstSignal: "SIGINT", secondSignal: "SIGINT", expectedExitCode: 130 },
    { firstSignal: "SIGTERM", secondSignal: "SIGINT", expectedExitCode: 143 },
    { firstSignal: "SIGINT", secondSignal: "SIGTERM", expectedExitCode: 130 },
  ]) {
    await t.test(`${firstSignal} followed by ${secondSignal}`, async () => {
      const helperSource = `
        import { spawn } from "node:child_process";
        import { once } from "node:events";
        import { installProcessCleanupHandlers } from ${JSON.stringify(scriptUrl.href)};

        const appChild = spawn(
          process.execPath,
          ["--eval", "setInterval(() => undefined, 1_000)"],
          { detached: process.platform !== "win32", stdio: "ignore" },
        );
        const browserChild = spawn(
          process.execPath,
          ["--eval", "setInterval(() => undefined, 1_000)"],
          { stdio: "ignore" },
        );
        const browserServer = {
          process: () => browserChild,
          close: async () => {
            process.stdout.write("teardown-started\\n");
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
            if (browserChild.exitCode === null && browserChild.signalCode === null) {
              const browserExit = once(browserChild, "exit");
              browserChild.kill("SIGTERM");
              await browserExit;
            }
          },
          kill: () => browserChild.kill("SIGKILL"),
        };
        const processExists = (pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (error) {
            if (error?.code === "ESRCH") return false;
            throw error;
          }
        };
        installProcessCleanupHandlers({
          getBrowserProof: () => ({
            appChild,
            browserServerPromise: Promise.resolve(browserServer),
          }),
          cleanup: () => process.stdout.write(JSON.stringify({
            appRunning: processExists(appChild.pid),
            browserRunning: processExists(browserChild.pid),
          }) + "\\n"),
        });
        process.stdout.write(JSON.stringify({
          appPid: appChild.pid,
          browserPid: browserChild.pid,
        }) + "\\n");
      `;
      const probe = spawn(
        process.execPath,
        ["--input-type=module", "--eval", helperSource],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      let pids;
      probe.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const exitPromise = once(probe, "exit");
      const lines = createInterface({ input: probe.stdout });
      try {
        const [readyLine] = await withTimeout(
          once(lines, "line"),
          5_000,
          `repeated-signal probe did not become ready: stderr=${stderr}`,
        );
        pids = JSON.parse(readyLine);
        assert.equal(probe.kill(firstSignal), true);
        const [teardownLine] = await withTimeout(
          once(lines, "line"),
          5_000,
          `repeated-signal teardown did not start: stderr=${stderr}`,
        );
        assert.equal(teardownLine, "teardown-started");
        const cleanupLinePromise = once(lines, "line").then(([line]) => JSON.parse(line));
        assert.equal(probe.kill(secondSignal), true);
        const cleanupObservation = await withTimeout(
          Promise.race([
            cleanupLinePromise,
            exitPromise.then(([prematureCode, prematureSignal]) => {
              throw new Error(
                `repeated-signal probe exited before cleanup: code=${prematureCode} signal=${prematureSignal}`,
              );
            }),
          ]),
          5_000,
          `repeated-signal probe did not finish: stderr=${stderr}`,
        );
        const [exitCode, exitSignal] = await withTimeout(
          exitPromise,
          5_000,
          `repeated-signal probe did not exit after cleanup: stderr=${stderr}`,
        );
        assert.deepEqual(cleanupObservation, {
          appRunning: false,
          browserRunning: false,
        }, `stderr=${stderr}`);
        assert.equal(exitSignal, null);
        assert.equal(exitCode, expectedExitCode);
      } finally {
        lines.close();
        if (probe.exitCode === null && probe.signalCode === null) probe.kill("SIGKILL");
        forceStopProcess(pids?.appPid);
        forceStopProcess(pids?.browserPid);
      }
    });
  }
});

test("signal teardown still kills browser and the full app group when browser stops fail", async () => {
  const descendantSource = "setInterval(() => undefined, 1_000)";
  const appSource = `
    const { spawn } = require("node:child_process");
    const descendant = spawn(process.execPath, ["--eval", ${JSON.stringify(descendantSource)}], {
      stdio: "ignore",
    });
    process.stdout.write(String(descendant.pid) + "\\n");
    setInterval(() => undefined, 1_000);
  `;
  const helperSource = `
    import { spawn } from "node:child_process";
    import { once } from "node:events";
    import { createInterface } from "node:readline";
    import { installProcessCleanupHandlers } from ${JSON.stringify(scriptUrl.href)};

    const appChild = spawn(process.execPath, ["--eval", ${JSON.stringify(appSource)}], {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const appLines = createInterface({ input: appChild.stdout });
    const [descendantPidText] = await once(appLines, "line");
    appLines.close();
    const descendantPid = Number(descendantPidText);
    const browserChild = spawn(
      process.execPath,
      ["--eval", "setInterval(() => undefined, 1_000)"],
      { stdio: "ignore" },
    );
    const browserServer = {
      process: () => browserChild,
      close: () => { throw new Error("injected browser close failure"); },
      kill: () => { throw new Error("injected browser kill failure"); },
    };
    const browserProof = {
      appChild,
      browserServerPromise: Promise.resolve(browserServer),
    };
    const processExists = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        throw error;
      }
    };
    installProcessCleanupHandlers({
      getBrowserProof: () => browserProof,
      cleanup: () => {
        process.stdout.write(JSON.stringify({
          appRunning: processExists(appChild.pid),
          descendantRunning: processExists(descendantPid),
          browserRunning: processExists(browserChild.pid),
        }) + "\\n");
        throw new Error("injected contour cleanup failure");
      },
    });
    process.stdout.write(JSON.stringify({
      appPid: appChild.pid,
      descendantPid,
      browserPid: browserChild.pid,
    }) + "\\n");
  `;
  const probe = spawn(
    process.execPath,
    ["--input-type=module", "--eval", helperSource],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  let pids;
  probe.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitPromise = once(probe, "exit");
  const lines = createInterface({ input: probe.stdout });
  try {
    const [readyLine] = await withTimeout(
      once(lines, "line"),
      5_000,
      `stop-failure signal probe did not become ready: stderr=${stderr}`,
    );
    pids = JSON.parse(readyLine);
    assert.equal(processExists(pids.appPid), true);
    assert.equal(processExists(pids.descendantPid), true);
    assert.equal(processExists(pids.browserPid), true);
    const cleanupLinePromise = once(lines, "line").then(([line]) => JSON.parse(line));
    assert.equal(probe.kill("SIGTERM"), true);
    const [cleanupObservation, [exitCode, exitSignal]] = await withTimeout(
      Promise.all([cleanupLinePromise, exitPromise]),
      5_000,
      `stop-failure signal probe did not finish: stderr=${stderr}`,
    );
    assert.deepEqual(cleanupObservation, {
      appRunning: false,
      descendantRunning: false,
      browserRunning: false,
    }, `stderr=${stderr}`);
    assert.equal(exitSignal, null);
    assert.equal(exitCode, 143);
  } finally {
    lines.close();
    if (probe.exitCode === null && probe.signalCode === null) probe.kill("SIGKILL");
    forceStopProcess(pids?.appPid);
    forceStopProcess(pids?.descendantPid);
    forceStopProcess(pids?.browserPid);
  }
});

test("restore follows official logical order, applies only local pending root migrations, and never exports", () => {
  assert.match(source, /"--single-transaction"/u);
  assert.match(source, /"ON_ERROR_STOP=1"/u);
  assert.match(source, /artifacts\.plaintext\.roles/u);
  assert.match(source, /artifacts\.plaintext\.schema/u);
  assert.match(source, /SET session_replication_role = replica/u);
  assert.match(source, /"migration_ledger_query_failed"/u);
  assert.match(source, /"post_migration_schema_reload_failed"/u);
  assert.match(source, /psqlEnvironment\(status\.dbUrl, "supabase_admin"\)/u);
  assert.match(source, /local_database_major_mismatch/u);
  assert.match(source, /artifacts\.plaintext\.data/u);
  assert.match(source, /scanCopyInventory/u);
  assert.match(source, /COPY_ALLOWED_SCHEMAS/u);
  assert.match(source, /assertCopyTargetsExist/u);
  assert.match(source, /TRUNCATE TABLE \$\{exactTargets\} RESTART IDENTITY CASCADE/u);
  assert.match(source, /SELECT pgmq\.create/u);
  assert.match(source, /pgmq_queue_row_count_mismatch/u);
  assert.match(source, /reconstructManifestLedger/u);
  assert.match(source, /verifiedAttestedPrefix/u);
  assert.match(source, /CREATE SCHEMA IF NOT EXISTS supabase_migrations;/u);
  assert.match(source, /CREATE TABLE IF NOT EXISTS supabase_migrations\.schema_migrations/u);
  assert.match(source, /ADD COLUMN IF NOT EXISTS statements text\[\]/u);
  assert.match(source, /ADD COLUMN IF NOT EXISTS name text/u);
  assert.doesNotMatch(source, /ALTER (?:SCHEMA supabase_migrations|TABLE supabase_migrations\.schema_migrations) OWNER TO/u);
  assert.match(source, /migration_ledger_shape_invalid/u);
  assert.match(source, /root_migration_history_disk_mismatch/u);
  assert.match(source, /migration_ledger_attestation_root_prefix_mismatch/u);
  assert.ok(source.includes('if (/^\\[storage\\.buckets\\./u.test(line))'));
  assert.match(source, /ensureBuckets\(status, artifacts\.storage\.buckets, \{ allowUpdate: false \}\)/u);
  assert.match(source, /source_storage_metadata_state_invalid/u);
  assert.match(source, /storage_bucket_inventory_mismatch/u);
  assert.match(source, /public: bucket\.public/u);
  assert.match(source, /publicBucketCount/u);
  assert.match(source, /\["migration", "up", "--local", "--include-all", "--workdir", supabaseRoot\]/u);
  assert.match(source, /assertManifestLedger/u);
  assert.match(source, /assertExactRootLedger/u);
  assert.doesNotMatch(source, /"--linked"|\["db", "reset"\]|\["db", "dump"\]|\["link"/u);

  const restoreBody = source.slice(
    source.indexOf("function restoreLogicalDatabase"),
    source.indexOf("function psqlScalar"),
  );
  assert.ok(restoreBody.indexOf("artifacts.plaintext.schema") < restoreBody.indexOf("preparePgmqQueues"));
  assert.ok(restoreBody.indexOf("preparePgmqQueues") < restoreBody.indexOf("truncateCopyTargets"));
  assert.ok(restoreBody.indexOf("truncateCopyTargets") < restoreBody.indexOf("artifacts.plaintext.data"));

  const ledgerBody = source.slice(
    source.indexOf("function reconstructManifestLedger"),
    source.indexOf("function assertManifestLedger"),
  );
  assert.ok(ledgerBody.indexOf("initializeLocalMigrationLedger(status)") <
    ledgerBody.indexOf('readAppliedMigrationVersions(status, "database_restore")'));
  assert.ok(ledgerBody.indexOf('readAppliedMigrationVersions(status, "database_restore")') <
    ledgerBody.indexOf("INSERT INTO supabase_migrations.schema_migrations"));

  const initializeLedgerBody = source.slice(
    source.indexOf("function initializeLocalMigrationLedger"),
    source.indexOf("function reconstructManifestLedger"),
  );
  assert.match(initializeLedgerBody, /"database_restore",\s*false,\s*"migration_ledger_initialize_failed"/u);
  assert.match(initializeLedgerBody, /pg_get_userbyid\(namespace\.nspowner\) = 'postgres'/u);
  assert.match(initializeLedgerBody, /pg_get_userbyid\(relation\.relowner\) = 'postgres'/u);

  const ensureBucketsBody = source.slice(
    source.indexOf("async function ensureBuckets"),
    source.indexOf("function readV3PrivateBucketContract"),
  );
  assert.match(ensureBucketsBody, /const current = readBucketState\(status, bucket\.id\)/u);
  assert.doesNotMatch(ensureBucketsBody, /storageRequest\(|storage_bucket_read_failed/u);
  assert.ok(ensureBucketsBody.indexOf("current === null") < ensureBucketsBody.indexOf("writeBucket("));
  assert.ok(ensureBucketsBody.indexOf("bucketStateMatches(current, bucket)") <
    ensureBucketsBody.indexOf("v3_storage_bucket_update_failed"));

  const runBody = source.slice(
    source.indexOf("async function runRecovery"),
    source.indexOf("async function main"),
  );
  assert.ok(runBody.indexOf("assertRepositoryState(options.expectedRepositoryCommit)") <
    runBody.indexOf("assertOrbStackPreflight()"));
  assert.ok(runBody.indexOf("assertRepositoryState(options.expectedRepositoryCommit)") <
    runBody.indexOf("prepareArtifacts(options, harnessRoot, true)"));
  assert.ok(runBody.indexOf("verifiedAttestedPrefix(") <
    runBody.indexOf("docker(["));
  assert.ok(runBody.indexOf("verifiedAttestedPrefix(") <
    runBody.indexOf("reconstructManifestLedger(status, sourceMigrationPrefix)"));
  assert.ok(runBody.indexOf("state.networkCreated = true") < runBody.indexOf("docker(["));
  assert.ok(runBody.indexOf("state.stackStarted = true") <
    runBody.indexOf("execute(\n      supabaseCli,\n      [\n        \"start\""));
  assert.ok(runBody.indexOf("NOTIFY pgrst, 'reload schema'") <
    runBody.indexOf("await waitForPostgrestSchemaReadiness(status)"));
  assert.ok(runBody.indexOf("await waitForPostgrestSchemaReadiness(status)") <
    runBody.indexOf("prepareRepresentativeActors(status)"));
  const postgrestReadinessBody = source.slice(
    source.indexOf("async function waitForPostgrestSchemaReadiness"),
    source.indexOf("function readBucketState"),
  );
  assert.match(postgrestReadinessBody, /url\.searchParams\.set\("select", "id"\)/u);
  assert.match(postgrestReadinessBody, /url\.searchParams\.set\("limit", "0"\)/u);
  assert.match(postgrestReadinessBody, /method: "HEAD"/u);
  assert.match(source, /response\.status !== 503/u);
  assert.match(source, /post_migration_postgrest_reload_timeout/u);
  assert.ok(runBody.indexOf("const finalLedger = assertExactRootLedger") <
    runBody.indexOf("verifyPgmqQueueRows(status, pgmqQueues)"));
  assert.ok(runBody.indexOf("verifyPgmqQueueRows(status, pgmqQueues)") <
    runBody.indexOf("const aggregatesAfter"));
  assert.match(runBody, /pgmqRowsAfterMigrations: "passed"/u);
});

test("decryption, logging, providers, and proof stay fail-closed", () => {
  assert.match(source, /"age",[\s\S]*?"--decrypt"/u);
  assert.match(source, /mkdirSync\(decryptedRoot, \{ mode: 0o700 \}\)/u);
  assert.match(source, /chmodSync\(outputPath, 0o600\)/u);
  assert.match(source, /permissions_too_open/u);
  assert.match(source, /aggregateCountsBeforeMigrations/u);
  assert.match(source, /aggregateCountsAfterMigrationsBeforeTestIdentitySetup/u);
  assert.match(source, /sourceAggregatesCapturedBeforeTestIdentitySetup: true/u);
  assert.match(source, /encryptedLogicalSetSha256/u);
  assert.match(source, /migrationLedgerAttestationSha256/u);
  assert.match(source, /const repository = assertRepositoryState/u);
  assert.match(source, /status: "passed",\s*repository,/u);
  const preflightBody = source.slice(
    source.indexOf("async function runPreflight"),
    source.indexOf("async function runRecovery"),
  );
  assert.ok(preflightBody.indexOf("assertRepositoryState(options.expectedRepositoryCommit)") <
    preflightBody.indexOf("prepareArtifacts(options, harnessRoot, false)"));
  assert.ok(preflightBody.indexOf("verifiedAttestedPrefix(") <
    preflightBody.indexOf('status: "preflight_passed"'));
  assert.match(preflightBody, /migrationLedgerRepositoryPrefix:\s*\{\s*status: "passed"/u);
  assert.match(source, /post_restore_behavior_only_source_inventory_empty/u);
  assert.match(source, /providersBlocked: true/u);
  assert.match(source, /managedSupabaseTouched: false/u);
  assert.match(source, /providersCalled: false/u);
  assert.match(source, /webhooksTouched: false/u);
  assert.match(source, /payload\.components\?\.supabase\?\.status !== "ready"/u);
  assert.match(source, /payload\.components\?\.waha\?\.status === "ready"/u);
  assert.doesNotMatch(source, /\.supabase\.co|72\.62\.119\.112|crm\.evoadmissions\.com|\/opt\/evo-crm/u);
  assert.doesNotMatch(source, /console\.(?:log|error)|printenv|set -x/u);
});

test("restored Admin plus isolated representative actors, RLS, and V3-private Storage are required", () => {
  assert.match(source, /membership\.current_role IN \('admin', 'sales', 'curator'\)/u);
  assert.match(source, /restored_admin_actor_missing/u);
  assert.match(source, /local_auth_password_reset_failed/u);
  assert.match(source, /local_representative_auth_create_failed/u);
  assert.match(source, /provision_pilot_staff_member/u);
  assert.match(source, /isolated_local_test_identity/u);
  assert.doesNotMatch(source, /representative_staff_roles_missing/u);
  assert.match(source, /same_organization_rls_failed/u);
  assert.match(source, /cross_organization_rls_failed/u);
  assert.match(source, /anonymous_storage_read_not_denied/u);
  assert.match(source, /authenticated_storage_read_not_denied/u);
  assert.match(source, /private_storage_signed_download_failed/u);
  assert.match(source, /active_v3_public_legacy_bucket_dependency/u);
  assert.match(source, /allAuthoritativeBucketsPrivate: true/u);
  assert.match(source, /getByTestId\("v3-shell"\)/u);
  assert.match(source, /v3_browser_role_mismatch/u);
  assert.match(source, /readinessStatus: "not_ready"/u);
});
