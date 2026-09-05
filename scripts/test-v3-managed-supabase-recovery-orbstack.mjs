#!/usr/bin/env node

/**
 * Restore-only consumer for the signed managed-Supabase export produced by
 * export-v3-managed-supabase-backup.mjs.  It never accepts a database URL and
 * never contacts the managed project.  Plaintext exists only below one marked,
 * private, disposable directory and every external command belongs to a
 * tracked process group.
 */

import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  createReadStream,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const OPT_IN = "EVO_RUN_V3_MANAGED_SUPABASE_RECOVERY_ORBSTACK";
const OPT_IN_VALUE = "1";
const RECEIPT_SCHEMA = "evo-v3-managed-supabase-export-receipt/v1";
const DATABASE_SCHEMA = "evo-v3-managed-supabase-logical-backup/v1";
const STORAGE_SCHEMA = "evo-v3-managed-supabase-storage-backup/v1";
const RESULT_SCHEMA = "evo-v3-managed-supabase-recovery-result/v2";
const REQUIRED_NODE_VERSION = "22.23.1";
const CLAMAV_IMAGE = "clamav/clamav@sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9";
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;
const RECOVERY_SUPABASE_HOSTNAME = "evov3recoverylocal00.supabase.co";
const SIGNATURE_NAMESPACE = "evo-v3-managed-supabase-recovery";
const SIGNATURE_IDENTITY = "evo-v3-managed-supabase-export";
const SNAPSHOT_MODE = "postgresql-exported-repeatable-read-read-only";
const MARKER = ".evo-v3-managed-recovery-harness";
const HARNESS_PREFIX = "evo-v3-managed-recovery-";
const QUARANTINE_SUFFIX = ".quarantine";
const CONTAINER_MUTATION_CAPTURE_STAGES = new Set([
  "exact_target_image_build",
  "local_supabase_start",
  "malware_scanner_start",
  "candidate_start",
]);
const COMMAND_GRACE_MS = 2_000;
const MAX_CAPTURE_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_TARGET_CONFIG_BYTES = 1024 * 1024;
const MAX_SQL_BYTES = 128 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024 * 1024;
const MAX_AGE_HOURS = 24 * 31;
const FUTURE_SKEW_MS = 5 * 60 * 1_000;
const CAPTURE_WINDOW_MS = 60 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const REGION = /^[a-z][a-z0-9-]{1,62}$/u;
const PLAYWRIGHT_CHROMIUM_VERSION = /^(?:Chromium|Google Chrome for Testing) \d+(?:\.\d+){3}$/u;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const PLAYWRIGHT_BROWSER_BINDINGS = Object.freeze({
  "darwin-arm64": Object.freeze({
    revision: "1228",
    directory: "chrome-mac-arm64",
    executable: "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    version: "Google Chrome for Testing 149.0.7827.55",
    sha256: "b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7",
  }),
});
const BROWSER_SANDBOX_PROFILE = '(version 1) (allow default) (deny network-outbound (remote ip "*:*")) (allow network-outbound (remote ip "localhost:*"))';
const MIGRATION_VERSION = /^\d{3}$/u;
const MIGRATION_NAME = /^[a-z0-9][a-z0-9_]{0,126}$/u;
const IMAGE = /^(?:[a-z0-9][a-z0-9._/-]*@)?sha256:[0-9a-f]{64}$/u;
const SSH_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]+$/u;
const GUARD = /^[A-Za-z0-9]{63}$/u;
const ADMIN_MEMBERSHIP_DENIAL = Object.freeze({
  sqlstate: "42501",
  domainSentinel: "admin_membership_permission_required",
});
const RECORDED_ROOT_HISTORY_EXCEPTIONS = Object.freeze({
  "030": Object.freeze({
    name: "ai_knowledge",
    kind: "signed_comment_only_history_drift",
    signedRowSha256: "391845ec8286a35d27d3be4bc1badb08a69587cd07f7cacec128727d2dc4db07",
    signedStatementCount: 36,
    signedStatementsSha256: "3d2c866a2c3a5eee959fa7e2fa6b08f961c74a1794a91ce3016ed5d2ad8c2efd",
    rootFileSha256: "173e1314a8c41014569ec431915bb578d7cd1626c56b6d7f1d59fa45b9dd8212",
    rootStatementCount: 36,
    rootStatementsSha256: "d41f32a95072a864107f222e5e92335212abac3bce7caa71448f3d5da313da98",
  }),
  "038": Object.freeze({
    name: "authorization_containment",
    kind: "signed_empty_history_exception",
    signedRowSha256: "addaa73497b212b650722cc0c64eabc0f9edb3410db79a8b11d7ea675ea2a309",
    signedStatementCount: 0,
    signedStatementsSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    rootFileSha256: "64c7d648e3cebd890212e021cc7774e2f427756a70af0bda083e1ddbc977499c",
    rootStatementCount: 49,
    rootStatementsSha256: "c18f4d19ab95e77252bad3a1726f8e655e5aec84c16155a94a5c03d50b888dae",
  }),
  "039": Object.freeze({
    name: "private_inbox_media",
    kind: "signed_empty_history_exception",
    signedRowSha256: "bf77eb6533399b4ffa738aeb75fcef8d67acf4f7c15b3f0c32421170d763332f",
    signedStatementCount: 0,
    signedStatementsSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    rootFileSha256: "a9297f27628a8ea7d2cd27e31b9cf396d9ea9a782aa668c4df330c6cfdc3c796",
    rootStatementCount: 20,
    rootStatementsSha256: "3a237b079808a3c9de431162dc564894645d3668d8d778bfbda35540239f48c1",
  }),
});
let activePrivateChildEnvironment;
// Deliberately excludes Config.Env so inspect output can never capture runtime secrets.
const SAFE_CONTAINER_INSPECT_FORMAT = "{{json .Id}}\t{{json .Name}}\t{{json .Image}}\t{{json .Config.Labels}}\t{{json .HostConfig.NetworkMode}}\t{{json .NetworkSettings.Ports}}\t{{json .NetworkSettings.Networks}}";
const SAFE_IMAGE_INSPECT_FORMAT = "{{json .Id}}\t{{json .RepoDigests}}\t{{json .Config.Labels}}\t{{json .Os}}\t{{json .Architecture}}";
const SAFE_CLEANUP_CONTAINER_INSPECT_FORMAT = "{{json .Id}}\t{{json .Name}}\t{{json .Image}}\t{{json .Config.Labels}}";
const SAFE_CLEANUP_VOLUME_INSPECT_FORMAT = "{{json .Name}}\t{{json .CreatedAt}}\t{{json .Driver}}\t{{json .Scope}}\t{{json .Labels}}\t{{json .Options}}";
const SAFE_CLEANUP_NETWORK_INSPECT_FORMAT = "{{json .Id}}\t{{json .Name}}\t{{json .Labels}}";
const SAFE_PINNED_IMAGE_INSPECT_FORMAT = "{{json .Id}}\t{{json .RepoDigests}}\t{{json .RepoTags}}\t{{json .Os}}\t{{json .Architecture}}";
const DATABASE_DENIAL_SENTINELS = Object.freeze({
  "Active scoped Admin permission membership.role.change is required": ADMIN_MEMBERSHIP_DENIAL.domainSentinel,
});
const ARTIFACTS = Object.freeze([
  "roles.sql.age",
  "schema.sql.age",
  "data.sql.age",
  "history-schema.sql.age",
  "history-data.sql.age",
  "database-manifest.json.age",
  "storage-manifest.json.age",
  "storage-objects.tar.age",
]);
const SQL_ARTIFACTS = Object.freeze([
  "roles.sql",
  "schema.sql",
  "history-schema.sql",
  "history-data.sql",
  "data.sql",
]);
const EXCLUDED_SERVICES =
  "imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
const RECOVERY_PGMQ_QUEUES = Object.freeze(["platform_dead_letter_v1", "platform_work_v1"]);
const RECOVERY_PGMQ_SIGNATURES = Object.freeze([
  "pgmq.create(text)",
  "pgmq.read(text,integer,integer,jsonb)",
  "pgmq.send(text,jsonb,integer)",
  "pgmq.set_vt(text,bigint,integer)",
  "pgmq.archive(text,bigint)",
]);
const RECOVERY_PGMQ_RELATIONS = Object.freeze([
  "pgmq.a_platform_dead_letter_v1",
  "pgmq.a_platform_work_v1",
  "pgmq.q_platform_dead_letter_v1",
  "pgmq.q_platform_work_v1",
]);
const RECOVERY_PGMQ_COPY_COLUMNS = Object.freeze({
  "pgmq.a_platform_dead_letter_v1": Object.freeze(["msg_id", "read_ct", "enqueued_at", "archived_at", "vt", "message", "headers"]),
  "pgmq.a_platform_work_v1": Object.freeze(["msg_id", "read_ct", "enqueued_at", "archived_at", "vt", "message", "headers"]),
  "pgmq.q_platform_dead_letter_v1": Object.freeze(["msg_id", "read_ct", "enqueued_at", "vt", "message", "headers"]),
  "pgmq.q_platform_work_v1": Object.freeze(["msg_id", "read_ct", "enqueued_at", "vt", "message", "headers"]),
});
const RECOVERY_PGMQ_COPY_COLUMN_COUNT = Object.values(RECOVERY_PGMQ_COPY_COLUMNS)
  .reduce((total, columns) => total + columns.length, 0);
const PINNED_SUPABASE_SERVICE_IMAGES = Object.freeze({
  auth: Object.freeze({
    reference: "public.ecr.aws/supabase/gotrue:v2.196.0",
    digest: "sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232",
  }),
  db: Object.freeze({
    reference: "public.ecr.aws/supabase/postgres:17.6.1.165",
    digest: "sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518",
  }),
  kong: Object.freeze({
    reference: "public.ecr.aws/supabase/kong:2.8.1",
    digest: "sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d",
  }),
  realtime: Object.freeze({
    reference: "public.ecr.aws/supabase/realtime:v2.129.3",
    digest: "sha256:3211f8ebd59edcd0aa772186f1c8249c82c6b1ae5565f40dedb7aa93e951fe37",
  }),
  rest: Object.freeze({
    reference: "public.ecr.aws/supabase/postgrest:v16.1",
    digest: "sha256:5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d",
  }),
  storage: Object.freeze({
    reference: "public.ecr.aws/supabase/storage-api:v1.70.3",
    digest: "sha256:528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd",
  }),
});
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class RecoveryFailure extends Error {
  constructor(code, stage = "contract", diagnostic) {
    super(code);
    this.name = "RecoveryFailure";
    this.code = code;
    this.stage = stage;
    this.diagnostic = diagnostic;
  }
}

function fail(code, stage, diagnostic) {
  throw new RecoveryFailure(code, stage, diagnostic);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainTable(value) {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, code, stage = "artifact_validation") {
  if (!isRecord(value)) fail(code, stage);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code, stage);
  }
  return value;
}

function string(value, pattern, code, stage = "artifact_validation", max = 8_192) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value !== value.trim() ||
    (pattern && !pattern.test(value))
  ) {
    fail(code, stage);
  }
  return value;
}

function integer(value, code, stage = "artifact_validation", minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(code, stage);
  return value;
}

function iso(value, code, stage = "artifact_validation") {
  string(value, null, code, stage, 64);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) fail(code, stage);
  return parsed;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function signedExportCanonicalValue(value) {
  if (Array.isArray(value)) return value.map(signedExportCanonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, signedExportCanonicalValue(item)]),
    );
  }
  return value;
}

function signedExportCanonicalJson(value) {
  return `${JSON.stringify(signedExportCanonicalValue(value))}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function descriptor(value, code) {
  exactKeys(value, ["bytes", "sha256"], code);
  return Object.freeze({
    bytes: integer(value.bytes, code, "artifact_validation", 1),
    sha256: string(value.sha256, SHA256, code, "artifact_validation", 64),
  });
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function timestampAge(createdAt, now, maxAgeHours) {
  const age = now.valueOf() - iso(createdAt, "backup_timestamp_invalid").valueOf();
  if (age < -FUTURE_SKEW_MS) fail("backup_timestamp_in_future", "artifact_validation");
  if (age > maxAgeHours * 60 * 60 * 1_000) fail("backup_too_old", "artifact_validation");
  return Math.max(0, age / (60 * 60 * 1_000));
}

function validateGit(value, code = "git_binding_invalid") {
  exactKeys(value, ["head", "migration_tree"], code);
  return Object.freeze({
    head: string(value.head, GIT_OID, code),
    migration_tree: string(value.migration_tree, GIT_OID, code),
  });
}

function validateTools(value) {
  exactKeys(
    value,
    [
      "supabase_cli", "pg_dump", "pg_dumpall", "psql", "age", "ssh", "orb", "docker_context",
      "database_ca_sha256", "database_ca_fingerprint", "managed_dump_inputs_sha256",
    ],
    "export_tool_evidence_invalid",
  );
  if (value.orb !== "Running" || value.docker_context !== "orbstack" || value.ssh !== "available") {
    fail("export_tool_evidence_invalid", "artifact_validation");
  }
  string(value.supabase_cli, VERSION, "export_tool_evidence_invalid");
  string(value.pg_dump, /^\d+\.\d+$/u, "export_tool_evidence_invalid");
  string(value.pg_dumpall, /^\d+\.\d+$/u, "export_tool_evidence_invalid");
  string(value.psql, /^\d+\.\d+$/u, "export_tool_evidence_invalid");
  if (value.pg_dump !== value.pg_dumpall || value.pg_dump !== value.psql) fail("export_postgres_tool_mismatch", "artifact_validation");
  string(value.age, null, "export_tool_evidence_invalid", "artifact_validation", 256);
  string(value.database_ca_sha256, SHA256, "export_tool_evidence_invalid");
  exactKeys(
    value.managed_dump_inputs_sha256,
    ["data", "database_ca", "roles", "schema"],
    "export_tool_evidence_invalid",
  );
  for (const digest of Object.values(value.managed_dump_inputs_sha256)) {
    string(digest, SHA256, "export_tool_evidence_invalid");
  }
  if (value.managed_dump_inputs_sha256.database_ca !== value.database_ca_sha256) {
    fail("export_tool_evidence_invalid", "artifact_validation");
  }
  string(value.database_ca_fingerprint, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u, "export_tool_evidence_invalid");
  return Object.freeze({ ...value });
}

function validateReceiptDatabase(value) {
  exactKeys(
    value,
    [
      "postgres_major",
      "migration_count",
      "migration_min_version",
      "migration_max_version",
      "migration_copy_rows_sha256",
      "data_copy_sections_sha256",
      "stability_proof_sha256",
      "snapshot_mode",
      "table_count",
      "row_count",
      "auth_user_count",
    ],
    "receipt_database_invalid",
  );
  return Object.freeze({
    postgres_major: integer(value.postgres_major, "receipt_database_invalid", "artifact_validation", 14),
    migration_count: integer(value.migration_count, "receipt_database_invalid", "artifact_validation", 1),
    migration_min_version: string(value.migration_min_version, MIGRATION_VERSION, "receipt_database_invalid"),
    migration_max_version: string(value.migration_max_version, MIGRATION_VERSION, "receipt_database_invalid"),
    migration_copy_rows_sha256: string(value.migration_copy_rows_sha256, SHA256, "receipt_database_invalid"),
    data_copy_sections_sha256: string(value.data_copy_sections_sha256, SHA256, "receipt_database_invalid"),
    stability_proof_sha256: string(value.stability_proof_sha256, SHA256, "receipt_database_invalid"),
    snapshot_mode: value.snapshot_mode === SNAPSHOT_MODE
      ? value.snapshot_mode
      : fail("receipt_database_snapshot_mode_invalid", "artifact_validation"),
    table_count: integer(value.table_count, "receipt_database_invalid"),
    row_count: integer(value.row_count, "receipt_database_invalid"),
    auth_user_count: integer(value.auth_user_count, "receipt_database_invalid"),
  });
}

function validateReceiptStorage(value) {
  exactKeys(
    value,
    [
      "inventory_sha256",
      "bucket_count",
      "private_bucket_count",
      "public_bucket_count",
      "object_count",
      "total_bytes",
    ],
    "receipt_storage_invalid",
  );
  const result = {
    inventory_sha256: string(value.inventory_sha256, SHA256, "receipt_storage_invalid"),
    bucket_count: integer(value.bucket_count, "receipt_storage_invalid"),
    private_bucket_count: integer(value.private_bucket_count, "receipt_storage_invalid"),
    public_bucket_count: integer(value.public_bucket_count, "receipt_storage_invalid"),
    object_count: integer(value.object_count, "receipt_storage_invalid"),
    total_bytes: integer(value.total_bytes, "receipt_storage_invalid"),
  };
  if (result.private_bucket_count + result.public_bucket_count !== result.bucket_count) {
    fail("receipt_storage_bucket_counts_invalid", "artifact_validation");
  }
  return Object.freeze(result);
}

/** Validate receipt only after its detached SSH signature has passed. */
export function validateSignedReceipt(receipt, expected) {
  exactKeys(
    receipt,
    [
      "schema",
      "captured_at",
      "git",
      "source",
      "provider_backup",
      "database",
      "storage",
      "encrypted_artifacts",
      "tools",
      "signature",
      "result",
    ],
    "receipt_shape_invalid",
  );
  if (receipt.schema !== RECEIPT_SCHEMA || receipt.result !== "export_verified") {
    fail("receipt_schema_invalid", "artifact_validation");
  }
  const capturedAt = iso(receipt.captured_at, "receipt_timestamp_invalid").toISOString();
  const git = validateGit(receipt.git, "receipt_git_invalid");
  if (git.head !== expected.sourceRepositoryCommit) fail("receipt_source_commit_mismatch", "artifact_validation");
  if (git.migration_tree !== expected.sourceMigrationTree) fail("receipt_source_migration_tree_mismatch", "artifact_validation");
  exactKeys(receipt.source, ["identity_sha256"], "receipt_source_invalid");
  const sourceIdentity = string(receipt.source.identity_sha256, SHA256, "receipt_source_invalid");
  exactKeys(receipt.provider_backup, ["id", "inserted_at", "status", "physical"], "receipt_backup_invalid");
  const providerBackup = Object.freeze({
    id: string(receipt.provider_backup.id, null, "receipt_backup_invalid", "artifact_validation", 512),
    inserted_at: iso(receipt.provider_backup.inserted_at, "receipt_backup_invalid").toISOString(),
    status: receipt.provider_backup.status,
    physical: receipt.provider_backup.physical,
  });
  if (providerBackup.status !== "COMPLETED" || providerBackup.physical !== true) {
    fail("receipt_backup_invalid", "artifact_validation");
  }
  exactKeys(
    receipt.signature,
    ["namespace", "identity", "public_key_fingerprint", "trust_root"],
    "receipt_signature_metadata_invalid",
  );
  if (
    receipt.signature.namespace !== SIGNATURE_NAMESPACE ||
    receipt.signature.identity !== SIGNATURE_IDENTITY ||
    receipt.signature.trust_root !== "operator-held-external-public-key" ||
    !SSH_FINGERPRINT.test(receipt.signature.public_key_fingerprint) ||
    receipt.signature.public_key_fingerprint !== expected.trustedFingerprint
  ) {
    fail("receipt_signature_metadata_invalid", "artifact_validation");
  }
  exactKeys(receipt.encrypted_artifacts, ARTIFACTS, "receipt_artifact_set_invalid");
  const encryptedArtifacts = Object.fromEntries(
    ARTIFACTS.map((name) => [name, descriptor(receipt.encrypted_artifacts[name], "receipt_artifact_invalid")]),
  );
  return Object.freeze({
    capturedAt,
    ageHours: timestampAge(capturedAt, expected.now, expected.maxAgeHours),
    git,
    sourceIdentity,
    providerBackup,
    database: validateReceiptDatabase(receipt.database),
    storage: validateReceiptStorage(receipt.storage),
    encryptedArtifacts: Object.freeze(encryptedArtifacts),
    tools: validateTools(receipt.tools),
    signature: Object.freeze({ ...receipt.signature }),
  });
}

function validateSourceReceipt(value, expected) {
  exactKeys(value, ["project", "backup", "pooler", "sha256"], "database_source_receipt_invalid");
  const project = value.project;
  exactKeys(project, ["ref", "organization_id", "name", "region", "created_at", "status", "database"], "database_project_invalid");
  exactKeys(project.database, ["host", "version", "postgres_engine", "release_channel"], "database_project_invalid");
  if (
    project.ref !== expected.projectRef ||
    project.organization_id !== expected.organizationId ||
    project.status !== "ACTIVE_HEALTHY" ||
    project.database.host !== `db.${expected.projectRef}.supabase.co` ||
    !REGION.test(project.region) ||
    !/^\d+$/u.test(project.database.postgres_engine)
  ) {
    fail("database_project_mismatch", "artifact_validation");
  }
  iso(project.created_at, "database_project_invalid");
  string(project.name, null, "database_project_invalid", "artifact_validation", 512);
  string(project.database.version, null, "database_project_invalid", "artifact_validation", 128);
  string(project.database.release_channel, null, "database_project_invalid", "artifact_validation", 128);
  exactKeys(value.backup, ["id", "inserted_at", "is_physical_backup", "status"], "database_backup_invalid");
  if (value.backup.status !== "COMPLETED" || value.backup.is_physical_backup !== true) {
    fail("database_backup_invalid", "artifact_validation");
  }
  iso(value.backup.inserted_at, "database_backup_invalid");
  string(value.backup.id, null, "database_backup_invalid", "artifact_validation", 512);
  exactKeys(value.pooler, ["host", "user", "database", "session_port", "source_mode", "source_port"], "database_pooler_invalid");
  if (
    value.pooler.user !== `postgres.${project.ref}` ||
    value.pooler.database !== "postgres" ||
    value.pooler.session_port !== 5432 ||
    value.pooler.source_mode !== "transaction" ||
    value.pooler.source_port !== 6543 ||
    !new RegExp(`^aws-[0-9]+-${project.region}\\.pooler\\.supabase\\.com$`, "u").test(value.pooler.host)
  ) {
    fail("database_pooler_invalid", "artifact_validation");
  }
  const calculated = sha256(signedExportCanonicalJson({ project, backup: value.backup, pooler: value.pooler }));
  if (value.sha256 !== calculated || value.sha256 !== expected.sourceIdentity) {
    fail("database_source_identity_mismatch", "artifact_validation");
  }
  return Object.freeze({ project: Object.freeze(project), backup: Object.freeze(value.backup), pooler: Object.freeze(value.pooler), sha256: calculated });
}

function validateLedgerSummary(value) {
  exactKeys(value, ["count", "min_version", "max_version", "copy_rows_sha256"], "database_ledger_summary_invalid");
  return Object.freeze({
    count: integer(value.count, "database_ledger_summary_invalid", "artifact_validation", 1),
    min_version: string(value.min_version, MIGRATION_VERSION, "database_ledger_summary_invalid"),
    max_version: string(value.max_version, MIGRATION_VERSION, "database_ledger_summary_invalid"),
    copy_rows_sha256: string(value.copy_rows_sha256, SHA256, "database_ledger_summary_invalid"),
  });
}

function validateAggregate(value) {
  exactKeys(
    value,
    ["table_count", "row_count", "auth_user_count", "storage_bucket_row_count", "storage_object_row_count", "table_counts_sha256"],
    "database_aggregate_invalid",
  );
  return Object.freeze({
    table_count: integer(value.table_count, "database_aggregate_invalid"),
    row_count: integer(value.row_count, "database_aggregate_invalid"),
    auth_user_count: integer(value.auth_user_count, "database_aggregate_invalid"),
    storage_bucket_row_count: integer(value.storage_bucket_row_count, "database_aggregate_invalid"),
    storage_object_row_count: integer(value.storage_object_row_count, "database_aggregate_invalid"),
    table_counts_sha256: string(value.table_counts_sha256, SHA256, "database_aggregate_invalid"),
  });
}

export function validateDatabaseManifest(manifest, expected) {
  exactKeys(
    manifest,
    ["schema", "captured_at", "source_receipt", "git", "tools", "artifacts", "migration_ledger", "data_copy_sections_sha256", "stability", "aggregates"],
    "database_manifest_shape_invalid",
  );
  if (manifest.schema !== DATABASE_SCHEMA) fail("database_manifest_schema_invalid", "artifact_validation");
  const capturedAt = iso(manifest.captured_at, "database_manifest_timestamp_invalid").toISOString();
  if (capturedAt !== expected.receipt.capturedAt) fail("database_manifest_timestamp_mismatch", "artifact_validation");
  const git = validateGit(manifest.git, "database_manifest_git_invalid");
  if (!sameJson(git, expected.receipt.git)) fail("database_manifest_git_mismatch", "artifact_validation");
  const tools = validateTools(manifest.tools);
  if (!sameJson(tools, expected.receipt.tools)) fail("database_manifest_tools_mismatch", "artifact_validation");
  const source = validateSourceReceipt(manifest.source_receipt, {
    projectRef: expected.projectRef,
    organizationId: expected.organizationId,
    sourceIdentity: expected.receipt.sourceIdentity,
  });
  if (
    source.backup.id !== expected.receipt.providerBackup.id ||
    source.backup.inserted_at !== expected.receipt.providerBackup.inserted_at
  ) {
    fail("database_manifest_backup_mismatch", "artifact_validation");
  }
  exactKeys(manifest.artifacts, SQL_ARTIFACTS, "database_artifact_set_invalid");
  const artifacts = Object.fromEntries(
    SQL_ARTIFACTS.map((name) => [name, descriptor(manifest.artifacts[name], "database_artifact_invalid")]),
  );
  const ledger = validateLedgerSummary(manifest.migration_ledger);
  const aggregates = validateAggregate(manifest.aggregates);
  exactKeys(manifest.stability, ["snapshot_mode", "artifact_semantic_sha256", "proof_sha256"], "database_stability_invalid");
  if (manifest.stability.snapshot_mode !== SNAPSHOT_MODE) fail("database_snapshot_mode_invalid", "artifact_validation");
  exactKeys(manifest.stability.artifact_semantic_sha256, SQL_ARTIFACTS, "database_stability_invalid");
  for (const hash of Object.values(manifest.stability.artifact_semantic_sha256)) {
    string(hash, SHA256, "database_stability_invalid");
  }
  const stabilityProof = string(manifest.stability.proof_sha256, SHA256, "database_stability_invalid");
  if (stabilityProof !== sha256(signedExportCanonicalJson(manifest.stability.artifact_semantic_sha256))) {
    fail("database_stability_digest_invalid", "artifact_validation");
  }
  const dataCopy = string(manifest.data_copy_sections_sha256, SHA256, "database_copy_digest_invalid");
  const receiptDb = expected.receipt.database;
  if (
    Number(source.project.database.postgres_engine) !== receiptDb.postgres_major ||
    ledger.count !== receiptDb.migration_count ||
    ledger.min_version !== receiptDb.migration_min_version ||
    ledger.max_version !== receiptDb.migration_max_version ||
    ledger.copy_rows_sha256 !== receiptDb.migration_copy_rows_sha256 ||
    dataCopy !== receiptDb.data_copy_sections_sha256 ||
    stabilityProof !== receiptDb.stability_proof_sha256 ||
    manifest.stability.snapshot_mode !== receiptDb.snapshot_mode ||
    aggregates.table_count !== receiptDb.table_count ||
    aggregates.row_count !== receiptDb.row_count ||
    aggregates.auth_user_count !== receiptDb.auth_user_count
  ) {
    fail("database_manifest_receipt_mismatch", "artifact_validation");
  }
  return Object.freeze({ capturedAt, source, git, tools, artifacts: Object.freeze(artifacts), ledger, aggregates, dataCopy, stability: Object.freeze(manifest.stability) });
}

function validateBucket(bucket) {
  exactKeys(bucket, ["id", "name", "public", "file_size_limit", "allowed_mime_types", "created_at", "updated_at"], "storage_bucket_invalid");
  string(bucket.id, null, "storage_bucket_invalid", "artifact_validation", 1_024);
  if (bucket.id.includes("/") || bucket.id.includes("\\") || /[\u0000-\u001f\u007f]/u.test(bucket.id) || [".", ".."].includes(bucket.id)) {
    fail("storage_bucket_invalid", "artifact_validation");
  }
  string(bucket.name, null, "storage_bucket_invalid", "artifact_validation", 1_024);
  if (typeof bucket.public !== "boolean") fail("storage_bucket_invalid", "artifact_validation");
  if (bucket.file_size_limit !== null) integer(bucket.file_size_limit, "storage_bucket_invalid");
  if (bucket.allowed_mime_types !== null && (!Array.isArray(bucket.allowed_mime_types) || bucket.allowed_mime_types.some((item) => typeof item !== "string"))) {
    fail("storage_bucket_invalid", "artifact_validation");
  }
  if (bucket.created_at !== null) string(bucket.created_at, null, "storage_bucket_invalid");
  if (bucket.updated_at !== null) string(bucket.updated_at, null, "storage_bucket_invalid");
  return Object.freeze({ ...bucket });
}

function safeObjectPath(value, code) {
  string(value, null, code, "artifact_validation", 8_192);
  if (value.startsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value) || value.split("/").some((part) => ["", ".", ".."].includes(part))) {
    fail(code, "artifact_validation");
  }
  return value;
}

function validateStoredObject(object, bucketIds) {
  exactKeys(object, ["bucket_id", "path", "source_id", "source_version", "blob", "bytes", "sha256"], "storage_object_invalid");
  if (!bucketIds.has(object.bucket_id)) fail("storage_object_bucket_unknown", "artifact_validation");
  safeObjectPath(object.path, "storage_object_path_invalid");
  string(object.source_id, UUID, "storage_object_invalid");
  if (object.source_version !== null) string(object.source_version, UUID, "storage_object_invalid");
  string(object.blob, /^[0-9a-f]{64}\.bin$/u, "storage_blob_name_invalid");
  return Object.freeze({
    ...object,
    bytes: integer(object.bytes, "storage_object_invalid"),
    sha256: string(object.sha256, SHA256, "storage_object_invalid"),
  });
}

export function validateStorageManifest(manifest, expected) {
  exactKeys(
    manifest,
    ["schema", "captured_at", "source_receipt_sha256", "inventory_sha256", "buckets", "objects", "aggregates"],
    "storage_manifest_shape_invalid",
  );
  if (manifest.schema !== STORAGE_SCHEMA) fail("storage_manifest_schema_invalid", "artifact_validation");
  const capturedAt = iso(manifest.captured_at, "storage_manifest_timestamp_invalid").toISOString();
  if (Math.abs(iso(expected.databaseCapturedAt, "database_manifest_timestamp_invalid").valueOf() - new Date(capturedAt).valueOf()) > CAPTURE_WINDOW_MS) {
    fail("storage_capture_window_invalid", "artifact_validation");
  }
  if (manifest.source_receipt_sha256 !== expected.receipt.sourceIdentity || manifest.inventory_sha256 !== expected.receipt.storage.inventory_sha256) {
    fail("storage_source_binding_mismatch", "artifact_validation");
  }
  if (!Array.isArray(manifest.buckets) || !Array.isArray(manifest.objects)) fail("storage_manifest_inventory_invalid", "artifact_validation");
  const buckets = manifest.buckets.map(validateBucket);
  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  if (bucketIds.size !== buckets.length) fail("storage_bucket_duplicate", "artifact_validation");
  const objects = manifest.objects.map((object) => validateStoredObject(object, bucketIds));
  if (new Set(objects.map((object) => `${object.bucket_id}\0${object.path}`)).size !== objects.length || new Set(objects.map((object) => object.blob)).size !== objects.length) {
    fail("storage_object_duplicate", "artifact_validation");
  }
  exactKeys(manifest.aggregates, ["bucket_count", "private_bucket_count", "public_bucket_count", "object_count", "total_bytes"], "storage_aggregate_invalid");
  const aggregates = {
    bucket_count: integer(manifest.aggregates.bucket_count, "storage_aggregate_invalid"),
    private_bucket_count: integer(manifest.aggregates.private_bucket_count, "storage_aggregate_invalid"),
    public_bucket_count: integer(manifest.aggregates.public_bucket_count, "storage_aggregate_invalid"),
    object_count: integer(manifest.aggregates.object_count, "storage_aggregate_invalid"),
    total_bytes: integer(manifest.aggregates.total_bytes, "storage_aggregate_invalid"),
  };
  if (
    aggregates.bucket_count !== buckets.length ||
    aggregates.private_bucket_count !== buckets.filter((bucket) => !bucket.public).length ||
    aggregates.public_bucket_count !== buckets.filter((bucket) => bucket.public).length ||
    aggregates.object_count !== objects.length ||
    aggregates.total_bytes !== objects.reduce((sum, object) => sum + object.bytes, 0) ||
    aggregates.bucket_count !== expected.receipt.storage.bucket_count ||
    aggregates.private_bucket_count !== expected.receipt.storage.private_bucket_count ||
    aggregates.public_bucket_count !== expected.receipt.storage.public_bucket_count ||
    aggregates.object_count !== expected.receipt.storage.object_count ||
    aggregates.total_bytes !== expected.receipt.storage.total_bytes
  ) {
    fail("storage_manifest_receipt_mismatch", "artifact_validation");
  }
  return Object.freeze({ capturedAt, buckets: Object.freeze(buckets), objects: Object.freeze(objects), aggregates: Object.freeze(aggregates) });
}

function copyHeader(line) {
  const match = /^COPY\s+(?:"([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))\.(?:"([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))\s+\(([^)]+)\)\s+FROM\s+stdin;$/u.exec(line);
  if (!match) return null;
  const columns = match[5].split(",").map((column) => column.trim().replaceAll('"', ""));
  if (columns.some((column) => !/^[a-z_][a-z0-9_]*$/u.test(column))) return null;
  return Object.freeze({ table: `${match[1] ?? match[2]}.${match[3] ?? match[4]}`, columns });
}

function decodeCopyField(field) {
  if (field === "\\N") return null;
  let result = "";
  for (let index = 0; index < field.length; index += 1) {
    if (field[index] !== "\\") {
      result += field[index];
      continue;
    }
    index += 1;
    if (index >= field.length) fail("migration_copy_escape_invalid", "artifact_validation");
    const escaped = field[index];
    const translations = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\" };
    if (Object.hasOwn(translations, escaped)) result += translations[escaped];
    else result += escaped;
  }
  return result;
}

function parsePostgresTextArray(value) {
  if (typeof value !== "string" || value[0] !== "{" || value.at(-1) !== "}") {
    fail("migration_statements_array_invalid", "artifact_validation");
  }
  if (value === "{}") return Object.freeze([]);
  const result = [];
  let index = 1;
  while (index < value.length - 1) {
    let element = "";
    if (value[index] === '"') {
      index += 1;
      let closed = false;
      while (index < value.length - 1) {
        if (value[index] === "\\") {
          index += 1;
          if (index >= value.length - 1) fail("migration_statements_array_invalid", "artifact_validation");
          element += value[index];
          index += 1;
          continue;
        }
        if (value[index] === '"') {
          index += 1;
          closed = true;
          break;
        }
        element += value[index];
        index += 1;
      }
      if (!closed) fail("migration_statements_array_invalid", "artifact_validation");
    } else {
      while (index < value.length - 1 && value[index] !== ",") {
        if (["{", "}", '"'].includes(value[index])) fail("migration_statements_array_invalid", "artifact_validation");
        if (value[index] === "\\") {
          index += 1;
          if (index >= value.length - 1) fail("migration_statements_array_invalid", "artifact_validation");
        }
        element += value[index];
        index += 1;
      }
      if (element === "NULL") fail("migration_statements_array_invalid", "artifact_validation");
    }
    result.push(element);
    if (index === value.length - 1) break;
    if (value[index] !== ",") fail("migration_statements_array_invalid", "artifact_validation");
    index += 1;
    if (index >= value.length - 1) fail("migration_statements_array_invalid", "artifact_validation");
  }
  return Object.freeze(result);
}

/**
 * Match the Supabase CLI migration ledger representation: SQL is split on
 * top-level semicolons, while quoted strings, dollar blocks, comments and
 * parenthesized expressions remain intact; trailing semicolons and outer
 * whitespace are removed before hashing the ordered statement array.
 */
export function migrationStatementsDigest(sql) {
  if (typeof sql !== "string" || sql.length === 0) fail("root_migration_content_invalid", "migration_rehearsal");
  const statements = [];
  let start = 0;
  let lexicalState = "normal";
  let dollarTag;
  let blockDepth = 0;
  let parentheses = 0;
  let atomic = false;
  const emit = (end) => {
    const statement = sql.slice(start, end).replace(/;+$/u, "").trim();
    if (statement) statements.push(statement);
    start = end;
  };
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
    if (lexicalState === "line_comment") {
      if (current === "\n") lexicalState = "normal";
      continue;
    }
    if (lexicalState === "block_comment") {
      if (current === "/" && next === "*") {
        blockDepth += 1;
        index += 1;
      } else if (current === "*" && next === "/") {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) lexicalState = "normal";
      }
      continue;
    }
    if (lexicalState === "dollar_quoted") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = undefined;
        lexicalState = "normal";
      }
      continue;
    }
    if (lexicalState === "escape_string") {
      if (current === "\\") {
        if (next === undefined) fail("root_migration_sql_unterminated", "migration_rehearsal");
        index += 1;
      } else if (current === "'") {
        if (next === "'") index += 1;
        else lexicalState = "normal";
      }
      continue;
    }
    if (lexicalState === "single_quoted" || lexicalState === "double_quoted") {
      const delimiter = lexicalState === "single_quoted" ? "'" : '"';
      if (current === delimiter) {
        if (next === delimiter) index += 1;
        else lexicalState = "normal";
      }
      continue;
    }
    if (current === "-" && next === "-") {
      lexicalState = "line_comment";
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      lexicalState = "block_comment";
      blockDepth = 1;
      index += 1;
      continue;
    }
    if (current === "'") {
      const prefix = sql[index - 1];
      const beforePrefix = sql[index - 2];
      lexicalState = /[eE]/u.test(prefix ?? "") && (beforePrefix === undefined || !/[A-Za-z0-9_$]/u.test(beforePrefix))
        ? "escape_string"
        : "single_quoted";
      continue;
    }
    if (current === '"') {
      lexicalState = "double_quoted";
      continue;
    }
    if (current === "$") {
      const match = /^\$[A-Za-z0-9_]*\$/u.exec(sql.slice(index));
      if (match) {
        dollarTag = match[0];
        lexicalState = "dollar_quoted";
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (current === "\\") {
      index += 1;
      continue;
    }
    if (current === "(") parentheses += 1;
    else if (current === ")" && parentheses > 0) parentheses -= 1;
    if (!atomic && parentheses === 0 && /(?:^|[^A-Za-z0-9_$])BEGIN\s+ATOMIC$/iu.test(sql.slice(start, index + 1))) atomic = true;
    if (current === ";" && parentheses === 0) {
      if (atomic && !/\bEND\s*;$/iu.test(sql.slice(start, index + 1))) continue;
      atomic = false;
      emit(index + 1);
    }
  }
  if (!new Set(["normal", "line_comment"]).has(lexicalState) || blockDepth !== 0 || parentheses !== 0 || atomic) {
    fail("root_migration_sql_unterminated", "migration_rehearsal");
  }
  emit(sql.length);
  if (statements.length === 0) fail("root_migration_content_invalid", "migration_rehearsal");
  return Object.freeze({
    statementCount: statements.length,
    statementsSha256: sha256(canonicalJson(statements)),
  });
}

/** Parse the exact history COPY rows. Summary-only input is deliberately invalid. */
export function extractExactMigrationLedger(historySql) {
  if (typeof historySql !== "string" || historySql.length === 0) {
    fail("migration_history_dump_invalid", "artifact_validation");
  }
  const lines = historySql.split(/\r?\n/u);
  let selected;
  for (let index = 0; index < lines.length; index += 1) {
    const header = copyHeader(lines[index]);
    if (!header || header.table !== "supabase_migrations.schema_migrations") continue;
    if (selected) fail("migration_history_copy_duplicate", "artifact_validation");
    const versionIndex = header.columns.indexOf("version");
    const nameIndex = header.columns.indexOf("name");
    const statementsIndex = header.columns.indexOf("statements");
    if (versionIndex < 0 || nameIndex < 0 || statementsIndex < 0) {
      fail("migration_history_columns_invalid", "artifact_validation");
    }
    const rows = [];
    const rawRows = [];
    for (index += 1; index < lines.length && lines[index] !== "\\."; index += 1) {
      if (lines[index] === "") fail("migration_history_row_invalid", "artifact_validation");
      rawRows.push(lines[index]);
      const cells = lines[index].split("\t").map(decodeCopyField);
      if (cells.length !== header.columns.length) fail("migration_history_row_invalid", "artifact_validation");
      const version = cells[versionIndex];
      const name = cells[nameIndex];
      const statements = cells[statementsIndex];
      if (!MIGRATION_VERSION.test(version ?? "") || !MIGRATION_NAME.test(name ?? "") || statements === null) {
        fail("migration_history_row_invalid", "artifact_validation");
      }
      const parsedStatements = parsePostgresTextArray(statements);
      const exception = RECORDED_ROOT_HISTORY_EXCEPTIONS[version];
      if (
        parsedStatements.length === 0 &&
        (exception?.name !== name || exception.signedStatementCount !== 0)
      ) {
        fail("migration_statements_array_invalid", "artifact_validation");
      }
      const row = Object.freeze({
        version,
        name,
        row_sha256: sha256(`${lines[index]}\n`),
        statement_count: parsedStatements.length,
        statements_sha256: sha256(canonicalJson(parsedStatements)),
        statement_evidence: parsedStatements.length === 0
          ? "signed_empty_history_exception"
          : "recorded_statements",
      });
      if (parsedStatements.length === 0 && (
        row.row_sha256 !== exception.signedRowSha256 ||
        row.statements_sha256 !== exception.signedStatementsSha256
      )) {
        fail("migration_statements_array_invalid", "artifact_validation");
      }
      rows.push(row);
    }
    if (index >= lines.length || lines[index] !== "\\." || rows.length === 0) {
      fail("migration_history_copy_unterminated", "artifact_validation");
    }
    selected = Object.freeze({
      entries: Object.freeze(rows),
      copyRowsSha256: sha256(`${lines[index - rawRows.length - 1]}\n${rawRows.join("\n")}\n\\.\n`),
      orderedLedgerSha256: sha256(canonicalJson(rows)),
    });
  }
  if (!selected) fail("migration_history_copy_missing", "artifact_validation");
  for (let index = 1; index < selected.entries.length; index += 1) {
    if (selected.entries[index - 1].version.localeCompare(selected.entries[index].version, "en") >= 0) {
      fail("migration_history_order_invalid", "artifact_validation");
    }
  }
  return selected;
}

export function validateRestrictedSqlEnvelope(sql, name) {
  if (typeof sql !== "string" || sql.length === 0) fail("sql_artifact_invalid", "artifact_validation");
  const openings = [...sql.matchAll(/^\\restrict ([A-Za-z0-9]{63})$/gmu)];
  const closings = [...sql.matchAll(/^\\unrestrict ([A-Za-z0-9]{63})$/gmu)];
  if (
    openings.length !== 1 ||
    closings.length !== 1 ||
    !GUARD.test(openings[0][1]) ||
    openings[0][1] !== closings[0][1] ||
    openings[0].index >= closings[0].index
  ) {
    fail("sql_restricted_guard_invalid", "artifact_validation", { artifact: name });
  }
  return Object.freeze({ artifact: name, guardSha256: sha256(openings[0][1]) });
}

export async function validateRestrictedSqlFile(path, name) {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let opening;
  let closing;
  let openingIndex = -1;
  let closingIndex = -1;
  let openingCount = 0;
  let closingCount = 0;
  let lineIndex = 0;
  try {
    for await (const line of lines) {
      const open = /^\\restrict ([A-Za-z0-9]{63})$/u.exec(line);
      if (open) {
        openingCount += 1;
        opening = open[1];
        if (openingIndex === -1) openingIndex = lineIndex;
      }
      const close = /^\\unrestrict ([A-Za-z0-9]{63})$/u.exec(line);
      if (close) {
        closingCount += 1;
        closing = close[1];
        if (closingIndex === -1) closingIndex = lineIndex;
      }
      lineIndex += 1;
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (
    openingCount !== 1 ||
    closingCount !== 1 ||
    opening !== closing ||
    !GUARD.test(opening ?? "") ||
    openingIndex < 0 ||
    openingIndex >= closingIndex
  ) {
    fail("sql_restricted_guard_invalid", "artifact_validation", { artifact: name });
  }
  return Object.freeze({ artifact: name, guardSha256: sha256(opening) });
}

export function verifyLedgerAgainstRoot(ledger, root, summary, { requireComplete = false } = {}) {
  if (!isRecord(ledger) || !Array.isArray(ledger.entries) || ledger.entries.length === 0) {
    fail("migration_ledger_reconstruction_forbidden", "migration_rehearsal");
  }
  if (
    ledger.entries.length !== summary.count ||
    ledger.entries[0].version !== summary.min_version ||
    ledger.entries.at(-1).version !== summary.max_version ||
    ledger.copyRowsSha256 !== summary.copy_rows_sha256
  ) {
    fail("migration_ledger_summary_mismatch", "migration_rehearsal");
  }
  const prefix = root.entries.slice(0, ledger.entries.length);
  if (prefix.length !== ledger.entries.length) fail("migration_ledger_root_prefix_mismatch", "migration_rehearsal");
  const recordedRootHistoryExceptions = [];
  for (let index = 0; index < prefix.length; index += 1) {
    const entry = prefix[index];
    const recorded = ledger.entries[index];
    if (entry.version !== recorded.version || entry.name !== recorded.name) {
      fail("migration_ledger_root_prefix_mismatch", "migration_rehearsal");
    }
    const exactStatementMatch = recorded.statement_count > 0 &&
      recorded.statement_evidence === "recorded_statements" &&
      entry.statementCount === recorded.statement_count &&
      entry.statementsSha256 === recorded.statements_sha256;
    if (exactStatementMatch) continue;
    const exception = RECORDED_ROOT_HISTORY_EXCEPTIONS[recorded.version];
    const evidenceMatches = exception?.kind === recorded.statement_evidence ||
      (exception?.kind === "signed_comment_only_history_drift" && recorded.statement_evidence === "recorded_statements");
    if (
      exception?.name !== recorded.name ||
      !evidenceMatches ||
      recorded.row_sha256 !== exception.signedRowSha256 ||
      recorded.statement_count !== exception.signedStatementCount ||
      recorded.statements_sha256 !== exception.signedStatementsSha256 ||
      entry.sha256 !== exception.rootFileSha256 ||
      entry.statementCount !== exception.rootStatementCount ||
      entry.statementsSha256 !== exception.rootStatementsSha256
    ) {
      fail("migration_ledger_root_prefix_mismatch", "migration_rehearsal");
    }
    recordedRootHistoryExceptions.push(Object.freeze({
      version: recorded.version,
      name: recorded.name,
      kind: exception.kind,
      signedRowSha256: recorded.row_sha256,
      signedStatementsSha256: recorded.statements_sha256,
      rootFileSha256: entry.sha256,
      rootStatementsSha256: entry.statementsSha256,
    }));
  }
  if (requireComplete && root.entries.length !== prefix.length) fail("source_migration_ledger_not_complete", "migration_rehearsal");
  const recordedSource = ledger.entries.map((recorded) => Object.freeze({
    version: recorded.version,
    name: recorded.name,
    statementCount: recorded.statement_count,
    statementsSha256: recorded.statements_sha256,
  }));
  const emptyStatementHistoryExceptions = recordedRootHistoryExceptions.filter(
    ({ kind }) => kind === "signed_empty_history_exception",
  );
  return Object.freeze({
    source: Object.freeze(prefix),
    recordedSource: Object.freeze(recordedSource),
    pending: Object.freeze(root.entries.slice(prefix.length)),
    orderedLedgerSha256: ledger.orderedLedgerSha256,
    recordedRootHistoryExceptions: Object.freeze(recordedRootHistoryExceptions),
    emptyStatementHistoryExceptions: Object.freeze(emptyStatementHistoryExceptions),
  });
}

export function verifyMigrationTreePrefix(sourceRoot, targetRoot) {
  if (!Array.isArray(sourceRoot?.entries) || !Array.isArray(targetRoot?.entries) || sourceRoot.entries.length === 0) {
    fail("repository_migration_prefix_invalid", "migration_rehearsal");
  }
  const prefix = targetRoot.entries.slice(0, sourceRoot.entries.length);
  const comparable = (entry) => ({
    version: entry.version,
    name: entry.name,
    bytes: entry.bytes,
    sha256: entry.sha256,
    statementCount: entry.statementCount,
    statementsSha256: entry.statementsSha256,
  });
  if (prefix.length !== sourceRoot.entries.length || prefix.some((entry, index) => !sameJson(comparable(entry), comparable(sourceRoot.entries[index])))) {
    fail("repository_migration_prefix_mismatch", "migration_rehearsal");
  }
  const pending = targetRoot.entries.slice(prefix.length);
  return Object.freeze({
    source: Object.freeze(sourceRoot.entries),
    pending: Object.freeze(pending),
    sourceLedgerSha256: sha256(canonicalJson(sourceRoot.entries.map(comparable))),
    targetSuffixSha256: sha256(canonicalJson(pending.map(comparable))),
  });
}

function parseFlags(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail("unknown_positional_argument", "arguments");
    const equal = token.indexOf("=");
    const name = equal < 0 ? token.slice(2) : token.slice(2, equal);
    const value = equal < 0 ? argv[++index] : token.slice(equal + 1);
    if (!name || !value || value.startsWith("--") || flags.has(name)) fail("argument_invalid", "arguments");
    flags.set(name, value);
  }
  return flags;
}

const OPTIONS = Object.freeze({
  backupDir: ["backup-dir", "EVO_V3_RECOVERY_BACKUP_DIR"],
  trustedPublicKey: ["trusted-public-key", "EVO_V3_RECOVERY_TRUSTED_PUBLIC_KEY"],
  ageIdentity: ["age-identity", "EVO_V3_RECOVERY_AGE_IDENTITY"],
  projectRef: ["project-ref", "EVO_V3_RECOVERY_PROJECT_REF"],
  supabaseOrganizationId: ["supabase-organization-id", "EVO_V3_RECOVERY_SUPABASE_ORGANIZATION_ID"],
  platformOrganizationId: ["platform-organization-id", "EVO_V3_RECOVERY_PLATFORM_ORGANIZATION_ID"],
  sourceRepositoryCommit: ["source-repository-commit", "EVO_V3_RECOVERY_SOURCE_REPOSITORY_COMMIT"],
  sourceMigrationTree: ["source-migration-tree", "EVO_V3_RECOVERY_SOURCE_MIGRATION_TREE"],
  sourceMainEquivalentCommit: ["source-main-equivalent-commit", "EVO_V3_RECOVERY_SOURCE_MAIN_EQUIVALENT_COMMIT"],
  targetRepositoryCommit: ["target-repository-commit", "EVO_V3_RECOVERY_TARGET_REPOSITORY_COMMIT"],
  targetMigrationTree: ["target-migration-tree", "EVO_V3_RECOVERY_TARGET_MIGRATION_TREE"],
  adminUserId: ["admin-user-id", "EVO_V3_RECOVERY_ADMIN_USER_ID"],
  salesUserId: ["sales-user-id", "EVO_V3_RECOVERY_SALES_USER_ID"],
  admissionsUserId: ["admissions-user-id", "EVO_V3_RECOVERY_ADMISSIONS_USER_ID"],
  evidenceOut: ["evidence-out", "EVO_V3_RECOVERY_EVIDENCE_OUT"],
  maxAgeHours: ["max-age-hours", "EVO_V3_RECOVERY_MAX_AGE_HOURS"],
});

export function parseHarnessOptions(argv, environment = process.env) {
  const flags = parseFlags(argv);
  const known = new Set(Object.values(OPTIONS).map(([name]) => name));
  if ([...flags.keys()].some((name) => !known.has(name))) fail("unknown_argument", "arguments");
  const values = {};
  for (const [key, [flag, envName]] of Object.entries(OPTIONS)) {
    const fromFlag = flags.get(flag);
    const fromEnvironment = environment[envName];
    if (fromFlag !== undefined && typeof fromEnvironment === "string" && fromEnvironment.length > 0) {
      fail("argument_environment_conflict", "arguments");
    }
    values[key] = fromFlag ?? (typeof fromEnvironment === "string" && fromEnvironment.length > 0
      ? fromEnvironment
      : undefined);
  }
  const optional = new Set(["maxAgeHours", "salesUserId", "admissionsUserId"]);
  const required = Object.keys(OPTIONS).filter((name) => !optional.has(name));
  if (required.some((name) => typeof values[name] !== "string" || values[name].length === 0)) {
    fail("required_argument_missing", "arguments");
  }
  string(values.projectRef, PROJECT_REF, "project_ref_invalid", "arguments");
  string(values.supabaseOrganizationId, /^[A-Za-z0-9_-]{1,256}$/u, "supabase_organization_id_invalid", "arguments");
  string(values.platformOrganizationId, UUID, "platform_organization_id_invalid", "arguments");
  string(values.sourceRepositoryCommit, GIT_OID, "source_repository_commit_invalid", "arguments");
  string(values.sourceMigrationTree, GIT_OID, "source_migration_tree_invalid", "arguments");
  string(values.sourceMainEquivalentCommit, GIT_OID, "source_main_equivalent_commit_invalid", "arguments");
  string(values.targetRepositoryCommit, GIT_OID, "target_repository_commit_invalid", "arguments");
  string(values.targetMigrationTree, GIT_OID, "target_migration_tree_invalid", "arguments");
  string(values.adminUserId, UUID, "admin_user_id_invalid", "arguments");
  for (const role of ["sales", "admissions"]) {
    const value = values[`${role}UserId`];
    if (value !== undefined) string(value, UUID, `${role}_user_id_invalid`, "arguments");
  }
  const suppliedRepresentativeIds = [values.adminUserId, values.salesUserId, values.admissionsUserId]
    .filter((value) => value !== undefined);
  if (new Set(suppliedRepresentativeIds).size !== suppliedRepresentativeIds.length) {
    fail("representative_user_ids_not_distinct", "arguments");
  }
  const maxAgeHours = values.maxAgeHours === undefined ? 72 : Number(values.maxAgeHours);
  if (!Number.isSafeInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > MAX_AGE_HOURS) {
    fail("max_age_hours_invalid", "arguments");
  }
  return Object.freeze({ ...values, maxAgeHours });
}

function ownedRegularFile(path, { code, maximum, privateMode = false }) {
  if (!isAbsolute(path)) fail(`${code}_path_invalid`, "preflight");
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    fail(`${code}_missing`, "preflight");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximum) {
    fail(`${code}_invalid`, "preflight");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${code}_owner_invalid`, "preflight");
  if ((metadata.mode & (privateMode ? 0o077 : 0o022)) !== 0) fail(`${code}_permissions_invalid`, "preflight");
  return realpathSync(path);
}

export function privateBackupDirectory(path) {
  if (!isAbsolute(path)) fail("backup_directory_path_invalid", "preflight");
  let sourceMetadata;
  try {
    sourceMetadata = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") fail("backup_directory_missing", "preflight");
    fail("backup_directory_invalid", "preflight");
  }
  if (sourceMetadata.isSymbolicLink()) fail("backup_directory_not_private", "preflight");
  if (!sourceMetadata.isDirectory()) fail("backup_directory_invalid", "preflight");
  let canonical;
  try {
    canonical = realpathSync(path);
  } catch {
    fail("backup_directory_invalid", "preflight");
  }
  let metadata;
  try {
    metadata = lstatSync(canonical);
  } catch (error) {
    if (error?.code === "ENOENT") fail("backup_directory_missing", "preflight");
    fail("backup_directory_invalid", "preflight");
  }
  if (
    !metadata.isDirectory() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) fail("backup_directory_not_private", "preflight");
  return canonical;
}

function pathAtOrBelow(candidate, root) {
  const relation = relative(root, candidate);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

export function evidenceDestination(path) {
  if (!isAbsolute(path) || existsSync(path)) fail("evidence_destination_invalid", "preflight");
  const parent = realpathSync(dirname(path));
  const metadata = lstatSync(parent);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    fail("evidence_parent_not_private", "preflight");
  }
  const candidate = join(parent, basename(path));
  if (dirname(candidate) !== parent) fail("evidence_destination_invalid", "preflight");
  if (pathAtOrBelow(candidate, realpathSync(repositoryRoot))) fail("evidence_destination_inside_repository", "preflight");
  return candidate;
}

export function validateEvidenceRuntimeSeparation(path, harnessRoot) {
  const candidate = resolve(path);
  const runtime = realpathSync(harnessRoot);
  if (pathAtOrBelow(candidate, runtime) || pathAtOrBelow(runtime, candidate)) {
    fail("evidence_destination_inside_runtime", "preflight");
  }
  return candidate;
}

function safeEnvironment(extra = {}) {
  return Object.freeze({
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    ...(activePrivateChildEnvironment ?? {}),
    LANG: "C.UTF-8",
    LC_ALL: "C",
    DOCKER_CONTEXT: "orbstack",
    ...extra,
  });
}

export function orbStackEnvironment(home = homedir()) {
  if (typeof home !== "string" || !isAbsolute(home)) fail("orbstack_home_invalid", "toolchain");
  let canonical;
  let metadata;
  try {
    canonical = realpathSync(home);
    metadata = lstatSync(canonical);
  } catch {
    fail("orbstack_home_invalid", "toolchain");
  }
  if (
    !metadata.isDirectory() ||
    (metadata.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    fail("orbstack_home_invalid", "toolchain");
  }
  return safeEnvironment({ HOME: canonical });
}

function activatePrivateChildEnvironment(harnessRoot, dockerHost, dockerBuildx) {
  if (activePrivateChildEnvironment) fail("private_child_environment_already_active", "toolchain");
  const home = join(harnessRoot, "child-home");
  const temporary = join(harnessRoot, "child-tmp");
  const dockerConfig = join(home, ".docker");
  const pluginDirectory = join(dockerConfig, "cli-plugins");
  for (const directory of [home, temporary, dockerConfig, pluginDirectory]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  symlinkSync(dockerBuildx.real, join(pluginDirectory, "docker-buildx"));
  const contextRoot = join(dockerConfig, "contexts", "meta", sha256("orbstack"));
  mkdirSync(contextRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(contextRoot, "meta.json"), `${JSON.stringify({
    Name: "orbstack",
    Metadata: { Description: "OrbStack recovery contour" },
    Endpoints: { docker: { Host: dockerHost, SkipTLSVerify: false } },
  })}\n`, { mode: 0o600, flag: "wx" });
  activePrivateChildEnvironment = Object.freeze({
    HOME: home,
    TMPDIR: temporary,
    DOCKER_CONFIG: dockerConfig,
  });
  return Object.freeze({
    homeMode: (lstatSync(home).mode & 0o777).toString(8),
    dockerConfigMode: (lstatSync(dockerConfig).mode & 0o777).toString(8),
    buildxRealpathSha256: sha256(realpathSync(join(pluginDirectory, "docker-buildx"))),
  });
}

function pinnedSupabaseEnvironment(paths) {
  if (!paths?.supabaseGo?.real) fail("supabase_go_binding_missing", "toolchain");
  return safeEnvironment({ SUPABASE_GO_BINARY: paths.supabaseGo.real });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function childRunning(child) {
  return child && child.exitCode === null && child.signalCode === null;
}

function groupRunning(child) {
  if (!child || !Number.isInteger(child.pid)) return false;
  if (process.platform === "win32") return childRunning(child);
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function signalGroup(child, signal) {
  if (!child || !Number.isInteger(child.pid)) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitGroupDrain(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (groupRunning(child) && Date.now() < deadline) await delay(20);
  return !groupRunning(child);
}

export class RecoveryInterruptionGuard {
  constructor() {
    this.controller = new AbortController();
    this.interrupted = undefined;
  }

  get signal() {
    return this.controller.signal;
  }

  latch(signal) {
    if (!this.interrupted) {
      this.interrupted = signal;
      this.controller.abort();
    }
    return this.interrupted;
  }

  assertActive(stage, { allowAfterInterrupt = false, afterOperation = false } = {}) {
    if (this.interrupted && !allowAfterInterrupt) {
      fail(afterOperation ? "operation_interrupted" : "operation_started_after_interruption", stage);
    }
  }

  async run(stage, operation, { allowAfterInterrupt = false } = {}) {
    this.assertActive(stage, { allowAfterInterrupt });
    try {
      const result = await operation(this.signal);
      this.assertActive(stage, { allowAfterInterrupt, afterOperation: true });
      return result;
    } catch (error) {
      this.assertActive(stage, { allowAfterInterrupt, afterOperation: true });
      throw error;
    }
  }
}

export async function runBrowserOperation(interruptionGuard, operation, options) {
  if (!(interruptionGuard instanceof RecoveryInterruptionGuard)) {
    fail("interruption_guard_invalid", "browser_proof");
  }
  return await interruptionGuard.run("browser_proof", operation, options);
}

export class ProcessSupervisor {
  constructor() {
    this.children = new Set();
    this.stopping = false;
    this.stopPromise = undefined;
    this.interrupted = false;
  }

  latchInterruption() {
    this.interrupted = true;
  }

  async stopOne(record) {
    if (!record?.child) return true;
    signalGroup(record.child, "SIGTERM");
    if (!(await waitGroupDrain(record.child, COMMAND_GRACE_MS))) {
      signalGroup(record.child, "SIGKILL");
      if (!(await waitGroupDrain(record.child, COMMAND_GRACE_MS))) return false;
    }
    this.children.delete(record);
    return true;
  }

  async stopAll() {
    if (this.stopPromise) return await this.stopPromise;
    this.stopping = true;
    this.stopPromise = (async () => {
      let drained = true;
      for (const record of [...this.children]) drained = (await this.stopOne(record)) && drained;
      return drained;
    })();
    try {
      return await this.stopPromise;
    } finally {
      this.stopPromise = undefined;
      this.stopping = false;
    }
  }

  start(command, args, options = {}) {
    if (this.interrupted && options.allowAfterInterrupt !== true) {
      fail("command_started_after_interruption", options.stage ?? "command");
    }
    if (this.stopping) fail("command_started_during_shutdown", options.stage ?? "command");
    if (
      options.argv0 !== undefined &&
      (typeof options.argv0 !== "string" || !/^[A-Za-z0-9._-]{1,64}$/u.test(options.argv0))
    ) {
      fail("command_argv0_invalid", options.stage ?? "command");
    }
    const child = spawn(command, args, {
      argv0: options.argv0,
      cwd: options.cwd,
      env: options.env ?? safeEnvironment(),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const record = {
      child,
      command: basename(command),
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      overflow: false,
      spawnError: undefined,
    };
    const limit = options.maxCaptureBytes ?? MAX_CAPTURE_BYTES;
    const append = (field, chunk) => {
      if (record[field].length + chunk.length > limit) record.overflow = true;
      else record[field] = Buffer.concat([record[field], chunk]);
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    // Long-lived children are observed outside a promise. Retain a sanitized
    // readiness signal instead of allowing an ENOENT/EACCES event to become an
    // unhandled process error.
    child.once("error", (error) => {
      record.spawnError = error;
    });
    this.children.add(record);
    return record;
  }

  async run(command, args, options = {}) {
    if (this.interrupted && options.allowAfterInterrupt !== true) {
      fail("command_started_after_interruption", options.stage ?? "command");
    }
    if (this.stopping) fail("command_started_during_shutdown", options.stage ?? "command");
    if (
      options.argv0 !== undefined &&
      (typeof options.argv0 !== "string" || !/^[A-Za-z0-9._-]{1,64}$/u.test(options.argv0))
    ) {
      fail("command_argv0_invalid", options.stage ?? "command");
    }
    const child = spawn(command, args, {
      argv0: options.argv0,
      cwd: options.cwd,
      env: options.env ?? safeEnvironment(),
      detached: process.platform !== "win32",
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const record = { child, command: basename(command), stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    this.children.add(record);
    let overflow = false;
    const append = (current, chunk) => {
      if (current.length + chunk.length > (options.maxCaptureBytes ?? MAX_CAPTURE_BYTES)) {
        overflow = true;
        return current;
      }
      return Buffer.concat([current, chunk]);
    };
    child.stdout.on("data", (chunk) => { record.stdout = append(record.stdout, chunk); });
    child.stderr.on("data", (chunk) => { record.stderr = append(record.stderr, chunk); });
    if (options.input !== undefined) child.stdin.end(options.input);
    const timeoutMs = options.timeoutMs ?? 30_000;
    let timer;
    const outcome = await Promise.race([
      new Promise((resolveExit, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolveExit({ code, signal, timedOut: false }));
      }),
      new Promise((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout({ code: null, signal: null, timedOut: true }), timeoutMs);
      }),
    ]).catch(async () => {
      await this.stopOne(record);
      fail(options.code ?? "command_failed", options.stage ?? "command");
    });
    clearTimeout(timer);
    if (outcome.timedOut || overflow) {
      const drained = await this.stopOne(record);
      if (!drained) fail("command_descendants_not_drained", options.stage ?? "command");
      fail(outcome.timedOut ? (options.timeoutCode ?? "command_timed_out") : "command_output_limit_exceeded", options.stage ?? "command");
    }
    if (!(await waitGroupDrain(child, COMMAND_GRACE_MS))) {
      const drained = await this.stopOne(record);
      if (!drained) fail("command_descendants_not_drained", options.stage ?? "command");
    }
    this.children.delete(record);
    if (this.interrupted && options.allowAfterInterrupt !== true) {
      fail("command_interrupted", options.stage ?? "command");
    }
    if (outcome.code !== 0) {
      const diagnostic = (options.sanitizeDiagnostic ?? sanitizeCommandDiagnostic)(record.stderr, outcome.code);
      fail(options.code ?? "command_failed", options.stage ?? "command", diagnostic);
    }
    return Object.freeze({ stdout: record.stdout, stderr: record.stderr, code: outcome.code });
  }
}

function runDocker(supervisor, executable, args, options = {}) {
  return supervisor.run(executable.real, args, { ...options, argv0: "docker" });
}

export function sanitizeCommandDiagnostic(output, status) {
  const text = Buffer.isBuffer(output) ? output.toString("utf8") : String(output ?? "");
  const category = /permission denied/iu.test(text)
    ? "permission_denied"
    : /connection refused|could not connect/iu.test(text)
      ? "connection_failed"
      : /timed? out/iu.test(text)
        ? "timeout"
        : /already exists|duplicate/iu.test(text)
          ? "conflict"
          : "command_failed";
  return Object.freeze({ category, status: Number.isInteger(status) ? status : null, outputSha256: sha256(text), bytes: Buffer.byteLength(text) });
}

export function sanitizeBrowserDiagnostic(error) {
  const message = error instanceof Error && typeof error.message === "string"
    ? error.message
    : String(error ?? "");
  const rawName = error instanceof Error && typeof error.name === "string" ? error.name : "Error";
  const name = /^[A-Za-z][A-Za-z0-9]{0,63}(?:Error)?$/u.test(rawName) ? rawName : "Error";
  const category = /timed?\s*out|timeout/iu.test(message)
    ? "timeout"
    : /target page, context or browser has been closed|browser has been closed|connection closed/iu.test(message)
      ? "browser_closed"
      : /net::err_|network/iu.test(message)
        ? "network"
        : /strict mode violation|resolved to \d+ elements/iu.test(message)
          ? "locator_ambiguous"
          : "browser_operation_failed";
  return Object.freeze({
    name,
    category,
    messageSha256: sha256(message),
    bytes: Buffer.byteLength(message),
  });
}

export function sanitizePsqlDiagnostic(output, status) {
  const text = Buffer.isBuffer(output) ? output.toString("utf8") : String(output ?? "");
  const base = sanitizeCommandDiagnostic(text, status);
  const match = /^(?:psql:[^\r\n]+?:(\d+):\s+)?ERROR:\s+([0-9A-Z]{5}):\s+([^\r\n]+)$/mu.exec(text);
  const errorClasses = Object.freeze({
    "22P02": "invalid_text_representation",
    "23502": "not_null_violation",
    "23503": "foreign_key_violation",
    "23505": "unique_violation",
    "42501": "insufficient_privilege",
    "42601": "syntax_error",
    "42703": "undefined_column",
    "42883": "undefined_function",
    "42P01": "undefined_table",
  });
  const domainSentinel = match ? DATABASE_DENIAL_SENTINELS[match[3]] ?? null : null;
  return Object.freeze({
    ...base,
    postgres: match
      ? Object.freeze({
          sqlstate: match[2],
          errorClass: errorClasses[match[2]] ?? "other",
          inputLine: match[1] === undefined ? null : Number(match[1]),
          domainSentinel,
        })
      : null,
  });
}

export function classifyExpectedDatabaseDenial(diagnostic, expected) {
  return isRecord(diagnostic) &&
    isRecord(diagnostic.postgres) &&
    diagnostic.postgres.sqlstate === expected?.sqlstate &&
    diagnostic.postgres.domainSentinel === expected?.domainSentinel;
}

function resolveExecutable(candidates, allowed, code) {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const real = realpathSync(candidate);
    if (allowed.some((root) => real === root || real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`))) {
      return Object.freeze({ invoked: candidate, real });
    }
  }
  fail(code, "toolchain");
}

export function resolveSupabaseExecutableChain(root = repositoryRoot, platform = process.platform, architecture = process.arch) {
  const suffixes = {
    darwin: { arm64: ["darwin-arm64"], x64: ["darwin-x64"] },
    linux: { arm64: ["linux-arm64", "linux-arm64-musl"], x64: ["linux-x64", "linux-x64-musl"] },
    win32: { arm64: ["windows-arm64"], x64: ["windows-x64"] },
  }[platform]?.[architecture];
  if (!suffixes) fail("supabase_native_platform_unsupported", "toolchain");
  const nodeModules = realpathSync(join(root, "node_modules"));
  const binLink = join(root, "node_modules", ".bin", "supabase");
  const launcher = resolveExecutable(
    [binLink],
    [nodeModules],
    "supabase_cli_unavailable",
  );
  const expectedLauncher = realpathSync(join(root, "node_modules", "supabase", "dist", "supabase.js"));
  const binLinkMetadata = lstatSync(binLink);
  if (!binLinkMetadata.isSymbolicLink()) fail("supabase_bin_link_invalid", "toolchain");
  const binLinkTarget = readlinkSync(binLink);
  let launcherManifest;
  try {
    launcherManifest = JSON.parse(readFileSync(join(root, "node_modules", "supabase", "package.json"), "utf8"));
  } catch {
    fail("supabase_launcher_package_invalid", "toolchain");
  }
  if (launcher.real !== expectedLauncher || !VERSION.test(launcherManifest.version ?? "")) {
    fail("supabase_launcher_invalid", "toolchain");
  }
  const extension = platform === "win32" ? ".exe" : "";
  for (const suffix of suffixes) {
    const packagePath = join(root, "node_modules", "@supabase", `cli-${suffix}`);
    const manifestPath = join(packagePath, "package.json");
    if (!existsSync(manifestPath)) continue;
    const packageRoot = realpathSync(packagePath);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      fail("supabase_native_package_invalid", "toolchain");
    }
    if (
      manifest.name !== `@supabase/cli-${suffix}` ||
      !VERSION.test(manifest.version ?? "") ||
      manifest.version !== launcherManifest.version
    ) {
      fail("supabase_native_package_invalid", "toolchain");
    }
    const native = resolveExecutable(
      [join(packagePath, "bin", `supabase${extension}`)],
      [packageRoot],
      "supabase_native_binary_unavailable",
    );
    const go = resolveExecutable(
      [join(packagePath, "bin", `supabase-go${extension}`)],
      [packageRoot],
      "supabase_go_binary_unavailable",
    );
    for (const executable of [launcher, native, go]) {
      const metadata = statSync(executable.real);
      if (!metadata.isFile() || (platform !== "win32" && (metadata.mode & 0o111) === 0)) {
        fail("supabase_executable_invalid", "toolchain");
      }
    }
    return Object.freeze({ launcher, native, go, packageVersion: manifest.version, binLinkSha256: sha256(binLinkTarget) });
  }
  fail("supabase_native_package_unavailable", "toolchain");
}

function patchedPsqlVersion(output) {
  const match = /^psql \(PostgreSQL\) (\d+)\.(\d+)(?:\.\d+)?$/u.exec(output.trim());
  if (!match) fail("psql_version_invalid", "toolchain");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const floor = new Map([[14, 24], [15, 19], [16, 15], [17, 11], [18, 6]]).get(major);
  if (floor === undefined || minor < floor) fail("psql_security_update_required", "toolchain");
  return `${major}.${minor}`;
}

function sanitizedToolVersion(output, prefix, code) {
  const lines = String(output).trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length === 0) fail(code, "toolchain");
  const value = lines[0];
  if (
    value.length > 160 ||
    !value.startsWith(prefix) ||
    !/\d/u.test(value) ||
    !/^[A-Za-z0-9][A-Za-z0-9 .()+:_-]*$/u.test(value)
  ) {
    fail(code, "toolchain");
  }
  return value;
}

function versionToken(output, label, code) {
  const match = /(?:^|[^A-Za-z0-9])v?(\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?)(?:$|[^A-Za-z0-9])/mu.exec(String(output));
  if (!match) fail(code, "toolchain");
  return `${label} ${match[1]}`;
}

async function trustedToolchain(supervisor, harnessRoot, availableEvidence = {}) {
  const supabaseChain = resolveSupabaseExecutableChain();
  availableEvidence.supabase_bin_link_sha256 = supabaseChain.binLinkSha256;
  const tools = Object.freeze({
    git: resolveExecutable(["/usr/bin/git"], ["/usr/bin/git"], "git_unavailable"),
    sshKeygen: resolveExecutable(["/usr/bin/ssh-keygen"], ["/usr/bin/ssh-keygen"], "ssh_keygen_unavailable"),
    tar: resolveExecutable(["/usr/bin/tar"], ["/usr/bin/tar", "/usr/bin/bsdtar"], "tar_unavailable"),
    age: resolveExecutable(
      ["/opt/homebrew/bin/age", "/usr/local/bin/age"],
      ["/opt/homebrew/Cellar/age", "/usr/local/Cellar/age"],
      "age_unavailable",
    ),
    orb: resolveExecutable(
      ["/Applications/OrbStack.app/Contents/MacOS/scli.app/Contents/MacOS/scli", "/usr/local/bin/orb"],
      ["/Applications/OrbStack.app/Contents/MacOS/scli.app/Contents/MacOS/scli"],
      "orbstack_unavailable",
    ),
    docker: resolveExecutable(
      ["/Applications/OrbStack.app/Contents/MacOS/xbin/docker", "/usr/local/bin/docker"],
      ["/Applications/OrbStack.app/Contents/MacOS/xbin/docker-tools"],
      "docker_unavailable",
    ),
    psql: resolveExecutable(
      ["/opt/homebrew/opt/libpq/bin/psql", "/usr/local/opt/libpq/bin/psql"],
      ["/opt/homebrew/Cellar/libpq", "/usr/local/Cellar/libpq"],
      "psql_unavailable",
    ),
    node: resolveExecutable(
      ["/opt/homebrew/opt/node@22/bin/node", "/usr/local/opt/node@22/bin/node"],
      ["/opt/homebrew/Cellar/node@22", "/usr/local/Cellar/node@22"],
      "node_22_unavailable",
    ),
    openssl: resolveExecutable(
      ["/usr/bin/openssl"],
      ["/usr/bin/openssl"],
      "openssl_unavailable",
    ),
    sandboxExec: resolveExecutable(
      ["/usr/bin/sandbox-exec"],
      ["/usr/bin/sandbox-exec"],
      "browser_sandbox_unavailable",
    ),
    dockerBuildx: resolveExecutable(
      ["/Applications/OrbStack.app/Contents/MacOS/xbin/docker-buildx"],
      ["/Applications/OrbStack.app/Contents/MacOS/xbin/docker-tools"],
      "docker_buildx_unavailable",
    ),
    supabaseLauncher: supabaseChain.launcher,
    supabaseNative: supabaseChain.native,
    supabaseGo: supabaseChain.go,
  });
  Object.assign(availableEvidence, Object.fromEntries(
    Object.entries(tools).map(([name, executable]) => [`${name}_realpath_sha256`, sha256(executable.real)]),
  ));
  for (const [name, executable] of Object.entries(tools)) {
    availableEvidence[`${name}_binary_sha256`] = await sha256File(executable.real);
  }
  availableEvidence.supabase_execution_chain_sha256 = sha256(canonicalJson({
    native: availableEvidence.supabaseNative_binary_sha256,
    delegatedGo: availableEvidence.supabaseGo_binary_sha256,
  }));
  const gitVersion = await supervisor.run(tools.git.real, ["--version"], { stage: "toolchain", code: "git_version_failed", timeoutMs: 10_000 });
  availableEvidence.git = sanitizedToolVersion(gitVersion.stdout.toString("utf8"), "git version ", "git_version_invalid");
  const tarVersion = await supervisor.run(tools.tar.real, ["--version"], { stage: "toolchain", code: "tar_version_failed", timeoutMs: 10_000 });
  const tarOutput = tarVersion.stdout.length > 0 ? tarVersion.stdout : tarVersion.stderr;
  availableEvidence.tar = versionToken(tarOutput.toString("utf8"), "bsdtar", "tar_version_invalid");
  const psqlVersion = await supervisor.run(tools.psql.real, ["--version"], { stage: "toolchain", code: "psql_version_failed", timeoutMs: 10_000 });
  availableEvidence.psql = patchedPsqlVersion(psqlVersion.stdout.toString("utf8"));
  const cliVersion = await supervisor.run(tools.supabaseNative.real, ["--version"], {
    stage: "toolchain",
    code: "supabase_version_failed",
    timeoutMs: 10_000,
    env: safeEnvironment({ SUPABASE_GO_BINARY: tools.supabaseGo.real }),
  });
  const supabaseVersion = cliVersion.stdout.toString("utf8").trim();
  if (!VERSION.test(supabaseVersion)) fail("supabase_version_invalid", "toolchain");
  if (supabaseVersion !== supabaseChain.packageVersion) fail("supabase_native_package_version_mismatch", "toolchain");
  availableEvidence.supabase_cli = supabaseVersion;
  const goVersionResult = await supervisor.run(tools.supabaseGo.real, ["--version"], {
    stage: "toolchain",
    code: "supabase_go_version_failed",
    timeoutMs: 10_000,
  });
  const goVersion = goVersionResult.stdout.toString("utf8").trim();
  if (goVersion !== supabaseChain.packageVersion) fail("supabase_go_version_mismatch", "toolchain");
  availableEvidence.supabase_go_cli = goVersion;
  const ageVersion = await supervisor.run(tools.age.real, ["--version"], { stage: "toolchain", code: "age_version_failed", timeoutMs: 10_000 });
  availableEvidence.age = string(ageVersion.stdout.toString("utf8").trim(), /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u, "age_version_invalid", "toolchain", 64);
  const orbEnvironment = orbStackEnvironment();
  const orbVersion = await supervisor.run(tools.orb.real, ["version"], {
    stage: "toolchain",
    code: "orbstack_version_failed",
    timeoutMs: 10_000,
    env: orbEnvironment,
  });
  const orbVersionOutput = orbVersion.stdout.length > 0 ? orbVersion.stdout : orbVersion.stderr;
  availableEvidence.orb_version = versionToken(orbVersionOutput.toString("utf8"), "OrbStack", "orbstack_version_invalid");
  const orb = await supervisor.run(tools.orb.real, ["status"], {
    stage: "toolchain",
    code: "orbstack_unavailable",
    timeoutMs: 10_000,
    env: orbEnvironment,
  });
  if (orb.stdout.toString("utf8").trim() !== "Running") fail("orbstack_not_running", "toolchain");
  availableEvidence.orb = "Running";
  const context = await runDocker(supervisor, tools.docker, ["--context", "orbstack", "context", "show"], { stage: "toolchain", code: "docker_context_invalid", timeoutMs: 10_000 });
  if (context.stdout.toString("utf8").trim() !== "orbstack") fail("docker_context_invalid", "toolchain");
  availableEvidence.docker_context = "orbstack";
  const contextHost = await runDocker(supervisor, tools.docker, ["--context", "orbstack", "context", "inspect", "orbstack", "--format", "{{.Endpoints.docker.Host}}"], {
    stage: "toolchain",
    code: "docker_context_endpoint_invalid",
    timeoutMs: 10_000,
  });
  const dockerHost = contextHost.stdout.toString("utf8").trim();
  if (!/^unix:\/\/[A-Za-z0-9_./-]+$/u.test(dockerHost)) fail("docker_context_endpoint_invalid", "toolchain");
  const privateEnvironment = activatePrivateChildEnvironment(harnessRoot, dockerHost, tools.dockerBuildx);
  const privateContext = await runDocker(supervisor, tools.docker, ["--context", "orbstack", "context", "show"], {
    stage: "toolchain",
    code: "private_docker_context_unavailable",
    timeoutMs: 10_000,
  });
  if (privateContext.stdout.toString("utf8").trim() !== "orbstack") fail("private_docker_context_not_orbstack", "toolchain");
  const buildxVersion = await runDocker(supervisor, tools.docker, ["--context", "orbstack", "buildx", "version"], {
    stage: "toolchain",
    code: "private_docker_buildx_unavailable",
    timeoutMs: 10_000,
  });
  availableEvidence.docker_buildx = versionToken(buildxVersion.stdout.toString("utf8"), "buildx", "docker_buildx_version_invalid");
  availableEvidence.private_home_mode = privateEnvironment.homeMode;
  availableEvidence.private_docker_config_mode = privateEnvironment.dockerConfigMode;
  availableEvidence.private_buildx_realpath_sha256 = privateEnvironment.buildxRealpathSha256;
  const nodeVersion = await supervisor.run(tools.node.real, ["--version"], { stage: "toolchain", code: "node_22_version_failed", timeoutMs: 10_000 });
  if (nodeVersion.stdout.toString("utf8").trim() !== `v${REQUIRED_NODE_VERSION}`) fail("node_22_version_invalid", "toolchain");
  availableEvidence.node = REQUIRED_NODE_VERSION;
  for (const [field, template] of [["docker_client", "{{.Client.Version}}"], ["docker_server", "{{.Server.Version}}"]]) {
    const version = await runDocker(supervisor, tools.docker, ["--context", "orbstack", "version", "--format", template], {
      stage: "toolchain",
      code: `${field}_version_failed`,
      timeoutMs: 10_000,
    });
    availableEvidence[field] = sanitizedToolVersion(version.stdout.toString("utf8"), "", `${field}_version_invalid`);
  }
  return Object.freeze({
    paths: tools,
    evidence: Object.freeze({ ...availableEvidence }),
  });
}

export function validateRepositoryBindings(value, expected) {
  exactKeys(
    value,
    [
      "head",
      "status",
      "sourceCommit",
      "sourceTree",
      "sourceMigrationTree",
      "sourceMainEquivalentCommit",
      "sourceMainEquivalentTree",
      "sourceMainEquivalentMigrationTree",
      "targetCommit",
      "targetTree",
      "targetMigrationTree",
      "objectFormat",
      "equivalentIsAncestor",
    ],
    "repository_binding_invalid",
    "repository",
  );
  exactKeys(
    expected,
    ["sourceRepositoryCommit", "sourceMigrationTree", "sourceMainEquivalentCommit", "targetRepositoryCommit", "targetMigrationTree"],
    "repository_binding_invalid",
    "repository",
  );
  for (const key of [
    "head",
    "sourceCommit",
    "sourceTree",
    "sourceMigrationTree",
    "sourceMainEquivalentCommit",
    "sourceMainEquivalentTree",
    "sourceMainEquivalentMigrationTree",
    "targetCommit",
    "targetTree",
    "targetMigrationTree",
  ]) {
    string(value[key], GIT_OID, "repository_binding_invalid", "repository");
  }
  if (value.status !== "") fail("repository_dirty", "repository");
  if (value.head !== expected.targetRepositoryCommit || value.targetCommit !== expected.targetRepositoryCommit) {
    fail("target_repository_commit_mismatch", "repository");
  }
  if (value.sourceCommit !== expected.sourceRepositoryCommit) fail("source_repository_commit_mismatch", "repository");
  if (value.sourceMainEquivalentCommit !== expected.sourceMainEquivalentCommit) fail("source_main_equivalent_commit_mismatch", "repository");
  if (value.sourceMigrationTree !== expected.sourceMigrationTree) fail("source_migration_tree_mismatch", "repository");
  if (value.sourceTree !== value.sourceMainEquivalentTree) fail("source_main_equivalent_tree_mismatch", "repository");
  if (value.sourceMigrationTree !== value.sourceMainEquivalentMigrationTree) fail("source_main_equivalent_migration_tree_mismatch", "repository");
  if (value.targetMigrationTree !== expected.targetMigrationTree) fail("target_migration_tree_mismatch", "repository");
  if (!new Set(["sha1", "sha256"]).has(value.objectFormat)) fail("repository_object_format_invalid", "repository");
  if (value.equivalentIsAncestor !== true) fail("source_main_equivalent_not_ancestor", "repository");
  return Object.freeze({
    source: Object.freeze({
      receiptCommit: value.sourceCommit,
      tree: value.sourceTree,
      migrationTree: value.sourceMigrationTree,
      mainEquivalentCommit: value.sourceMainEquivalentCommit,
      mainEquivalentTree: value.sourceMainEquivalentTree,
      mainEquivalentMigrationTree: value.sourceMainEquivalentMigrationTree,
    }),
    target: Object.freeze({
      commit: value.targetCommit,
      tree: value.targetTree,
      migrationTree: value.targetMigrationTree,
      objectFormat: value.objectFormat,
    }),
    sourceTreeEqualsMainEquivalent: true,
    sourceMainEquivalentIsAncestorOfTarget: true,
  });
}

async function repositorySnapshot(supervisor, tools, options) {
  const expected = {
    sourceRepositoryCommit: options.sourceRepositoryCommit,
    sourceMigrationTree: options.sourceMigrationTree,
    sourceMainEquivalentCommit: options.sourceMainEquivalentCommit,
    targetRepositoryCommit: options.targetRepositoryCommit,
    targetMigrationTree: options.targetMigrationTree,
  };
  const [
    headResult,
    statusResult,
    sourceCommitResult,
    sourceFullTreeResult,
    sourceTreeResult,
    equivalentCommitResult,
    equivalentFullTreeResult,
    equivalentTreeResult,
    targetCommitResult,
    targetFullTreeResult,
    targetTreeResult,
    objectFormatResult,
  ] = await Promise.all([
    supervisor.run(tools.git.real, ["rev-parse", "HEAD"], { cwd: repositoryRoot, stage: "repository", code: "repository_head_failed" }),
    supervisor.run(tools.git.real, ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repositoryRoot, stage: "repository", code: "repository_status_failed" }),
    supervisor.run(tools.git.real, ["rev-parse", `${options.sourceRepositoryCommit}^{commit}`], { cwd: repositoryRoot, stage: "repository", code: "source_repository_commit_missing" }),
    supervisor.run(tools.git.real, ["rev-parse", `${options.sourceRepositoryCommit}^{tree}`], { cwd: repositoryRoot, stage: "repository", code: "source_repository_tree_missing" }),
    supervisor.run(tools.git.real, ["rev-parse", `${options.sourceRepositoryCommit}:supabase/migrations`], { cwd: repositoryRoot, stage: "repository", code: "source_migration_tree_failed" }),
    supervisor.run(tools.git.real, ["rev-parse", `${options.sourceMainEquivalentCommit}^{commit}`], { cwd: repositoryRoot, stage: "repository", code: "source_main_equivalent_commit_missing" }),
    supervisor.run(tools.git.real, ["rev-parse", `${options.sourceMainEquivalentCommit}^{tree}`], { cwd: repositoryRoot, stage: "repository", code: "source_main_equivalent_tree_missing" }),
    supervisor.run(tools.git.real, ["rev-parse", `${options.sourceMainEquivalentCommit}:supabase/migrations`], { cwd: repositoryRoot, stage: "repository", code: "source_main_equivalent_migration_tree_failed" }),
    supervisor.run(tools.git.real, ["rev-parse", `${options.targetRepositoryCommit}^{commit}`], { cwd: repositoryRoot, stage: "repository", code: "target_repository_commit_missing" }),
    supervisor.run(tools.git.real, ["rev-parse", `${options.targetRepositoryCommit}^{tree}`], { cwd: repositoryRoot, stage: "repository", code: "target_repository_tree_missing" }),
    supervisor.run(tools.git.real, ["rev-parse", `${options.targetRepositoryCommit}:supabase/migrations`], { cwd: repositoryRoot, stage: "repository", code: "target_migration_tree_failed" }),
    supervisor.run(tools.git.real, ["rev-parse", "--show-object-format"], { cwd: repositoryRoot, stage: "repository", code: "repository_object_format_failed" }),
  ]);
  await supervisor.run(
    tools.git.real,
    ["merge-base", "--is-ancestor", options.sourceMainEquivalentCommit, options.targetRepositoryCommit],
    { cwd: repositoryRoot, stage: "repository", code: "source_main_equivalent_not_ancestor", timeoutMs: 30_000 },
  );
  return validateRepositoryBindings({
    head: headResult.stdout.toString("utf8").trim(),
    status: statusResult.stdout.toString("utf8").trim(),
    sourceCommit: sourceCommitResult.stdout.toString("utf8").trim(),
    sourceTree: sourceFullTreeResult.stdout.toString("utf8").trim(),
    sourceMigrationTree: sourceTreeResult.stdout.toString("utf8").trim(),
    sourceMainEquivalentCommit: equivalentCommitResult.stdout.toString("utf8").trim(),
    sourceMainEquivalentTree: equivalentFullTreeResult.stdout.toString("utf8").trim(),
    sourceMainEquivalentMigrationTree: equivalentTreeResult.stdout.toString("utf8").trim(),
    targetCommit: targetCommitResult.stdout.toString("utf8").trim(),
    targetTree: targetFullTreeResult.stdout.toString("utf8").trim(),
    targetMigrationTree: targetTreeResult.stdout.toString("utf8").trim(),
    objectFormat: objectFormatResult.stdout.toString("utf8").trim(),
    equivalentIsAncestor: true,
  }, expected);
}

function readPrivateJson(path, code) {
  const bytes = readFileSync(path);
  if (bytes.length === 0 || bytes.length > MAX_JSON_BYTES) fail(code, "artifact_validation");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code, "artifact_validation");
  }
}

function normalizedPublicKeyLine(bytes) {
  const text = bytes.toString("utf8");
  if (text.includes("\r") || !text.endsWith("\n") || text.trim().split("\n").length !== 1) {
    fail("trusted_public_key_invalid", "signature_verification");
  }
  const line = text.trim();
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\u0000-\u001f\u007f]{1,256})?$/u.test(line)) {
    fail("trusted_public_key_invalid", "signature_verification");
  }
  return line;
}

function parseFingerprint(output) {
  const match = /\b(SHA256:[A-Za-z0-9+/]+)\b/u.exec(output.trim());
  if (!match) fail("trusted_public_key_fingerprint_invalid", "signature_verification");
  return match[1];
}

/** Signature verification is completed before receipt JSON is parsed. */
export async function verifyReceiptSignature(options, harnessRoot, supervisor, toolchain) {
  const backupRoot = privateBackupDirectory(options.backupDir);
  const receiptSource = ownedRegularFile(join(backupRoot, "receipt.json"), { code: "receipt", maximum: MAX_JSON_BYTES, privateMode: true });
  const signatureSource = ownedRegularFile(join(backupRoot, "receipt.json.sig"), { code: "receipt_signature", maximum: MAX_JSON_BYTES, privateMode: true });
  const trustedSource = ownedRegularFile(options.trustedPublicKey, { code: "trusted_public_key", maximum: MAX_JSON_BYTES });
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  if (pathAtOrBelow(trustedSource, backupRoot) || pathAtOrBelow(trustedSource, canonicalRepositoryRoot)) {
    fail("trusted_public_key_not_independent", "signature_verification");
  }
  const receipt = join(harnessRoot, "receipt.json");
  const signature = join(harnessRoot, "receipt.json.sig");
  const trustedKey = join(harnessRoot, "trusted-export-key.pub");
  cpSync(receiptSource, receipt, { force: false, errorOnExist: true });
  cpSync(signatureSource, signature, { force: false, errorOnExist: true });
  cpSync(trustedSource, trustedKey, { force: false, errorOnExist: true });
  chmodSync(receipt, 0o600);
  chmodSync(signature, 0o600);
  chmodSync(trustedKey, 0o600);
  const publicLine = normalizedPublicKeyLine(readFileSync(trustedKey));
  const fingerprintResult = await supervisor.run(toolchain.paths.sshKeygen.real, ["-lf", trustedKey, "-E", "sha256"], {
    stage: "signature_verification",
    code: "trusted_public_key_fingerprint_failed",
    timeoutMs: 10_000,
  });
  const fingerprint = parseFingerprint(fingerprintResult.stdout.toString("utf8"));
  const allowedSigners = join(harnessRoot, "allowed_signers");
  writeFileSync(allowedSigners, `${SIGNATURE_IDENTITY} ${publicLine}\n`, { mode: 0o600, flag: "wx" });
  await supervisor.run(
    toolchain.paths.sshKeygen.real,
    ["-Y", "verify", "-f", allowedSigners, "-I", SIGNATURE_IDENTITY, "-n", SIGNATURE_NAMESPACE, "-s", signature],
    {
      cwd: harnessRoot,
      input: readFileSync(receipt),
      stage: "signature_verification",
      code: "receipt_signature_invalid",
      timeoutMs: 30_000,
    },
  );
  return Object.freeze({ backupRoot, receiptPath: receipt, fingerprint, trustedKeySha256: sha256(readFileSync(trustedKey)) });
}

async function decryptArtifact(input, output, identity, supervisor, tools) {
  await supervisor.run(tools.age.real, ["--decrypt", "--identity", identity, "--output", output, input], {
    stage: "decryption",
    code: "artifact_decryption_failed",
    timeoutMs: 30 * 60 * 1_000,
    maxCaptureBytes: 16 * 1_024,
  });
  chmodSync(output, 0o600);
}

async function verifyPlaintext(path, expected, code) {
  const metadata = statSync(path);
  if (!metadata.isFile() || metadata.size !== expected.bytes || (await sha256File(path)) !== expected.sha256) {
    fail(code, "artifact_validation");
  }
}

async function prepareArtifacts(options, harnessRoot, supervisor, toolchain) {
  const signed = await verifyReceiptSignature(options, harnessRoot, supervisor, toolchain);
  const receipt = validateSignedReceipt(readPrivateJson(signed.receiptPath, "receipt_json_invalid"), {
    sourceRepositoryCommit: options.sourceRepositoryCommit,
    sourceMigrationTree: options.sourceMigrationTree,
    trustedFingerprint: signed.fingerprint,
    now: new Date(),
    maxAgeHours: options.maxAgeHours,
  });
  const ciphertext = {};
  for (const name of ARTIFACTS) {
    const maximum = name.endsWith(".json.age") ? MAX_JSON_BYTES * 4 : name === "storage-objects.tar.age" ? MAX_ARCHIVE_BYTES : MAX_SQL_BYTES;
    const path = ownedRegularFile(join(signed.backupRoot, name), { code: "encrypted_artifact", maximum, privateMode: true });
    const metadata = statSync(path);
    const digest = await sha256File(path);
    if (metadata.size !== receipt.encryptedArtifacts[name].bytes || digest !== receipt.encryptedArtifacts[name].sha256) {
      fail("encrypted_artifact_receipt_mismatch", "artifact_validation", { artifact: name });
    }
    ciphertext[name] = Object.freeze({ path, bytes: metadata.size, sha256: digest });
  }
  const identity = ownedRegularFile(options.ageIdentity, { code: "age_identity", maximum: MAX_JSON_BYTES, privateMode: true });
  const plaintextRoot = join(harnessRoot, "plaintext");
  mkdirSync(plaintextRoot, { mode: 0o700 });
  const plaintext = {};
  for (const name of ARTIFACTS) {
    const outputName = name.slice(0, -4);
    const output = join(plaintextRoot, outputName);
    await decryptArtifact(ciphertext[name].path, output, identity, supervisor, toolchain.paths);
    plaintext[outputName] = output;
    if ((await sha256File(ciphertext[name].path)) !== ciphertext[name].sha256) {
      fail("encrypted_artifact_changed_during_decryption", "artifact_validation", { artifact: name });
    }
  }
  const database = validateDatabaseManifest(readPrivateJson(plaintext["database-manifest.json"], "database_manifest_json_invalid"), {
    receipt,
    projectRef: options.projectRef,
    organizationId: options.supabaseOrganizationId,
  });
  for (const name of SQL_ARTIFACTS) await verifyPlaintext(plaintext[name], database.artifacts[name], "database_plaintext_mismatch");
  const storage = validateStorageManifest(readPrivateJson(plaintext["storage-manifest.json"], "storage_manifest_json_invalid"), {
    receipt,
    databaseCapturedAt: database.capturedAt,
  });
  if (
    database.aggregates.storage_bucket_row_count !== storage.aggregates.bucket_count ||
    database.aggregates.storage_object_row_count !== storage.aggregates.object_count
  ) {
    fail("database_storage_inventory_mismatch", "artifact_validation");
  }
  for (const name of SQL_ARTIFACTS) await validateRestrictedSqlFile(plaintext[name], name);
  if (statSync(plaintext["history-data.sql"]).size > 128 * 1_024 * 1_024) {
    fail("migration_history_dump_too_large", "artifact_validation");
  }
  const historyText = readFileSync(plaintext["history-data.sql"], "utf8");
  const ledger = extractExactMigrationLedger(historyText);
  if (ledger.copyRowsSha256 !== database.ledger.copy_rows_sha256) fail("migration_history_manifest_mismatch", "artifact_validation");
  return Object.freeze({ signed, receipt, database, storage, ledger, plaintext: Object.freeze(plaintext), ciphertext: Object.freeze(ciphertext) });
}

async function rootMigrationEntries(supervisor, tools, commit, harnessRoot, identity) {
  if (!new Set(["source", "target"]).has(identity)) fail("migration_root_identity_invalid", "migration_rehearsal");
  const listing = await supervisor.run(tools.git.real, ["ls-tree", "-r", "--long", commit, "--", "supabase/migrations"], {
    cwd: repositoryRoot,
    stage: "migration_rehearsal",
    code: "root_migration_tree_read_failed",
    timeoutMs: 30_000,
    maxCaptureBytes: 4 * 1_024 * 1_024,
  });
  const filenames = listing.stdout.toString("utf8").split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^100644 blob [0-9a-f]{40}\s+\d+\tsupabase\/migrations\/([^/]+)$/u.exec(line);
    if (!match) fail("root_migration_tree_invalid", "migration_rehearsal");
    return match[1];
  }).filter((name) => name.endsWith(".sql")).sort((left, right) => left.localeCompare(right, "en"));
  const snapshotRoot = join(harnessRoot, `trusted-${identity}-migrations`);
  mkdirSync(snapshotRoot, { mode: 0o700 });
  const entries = [];
  for (let index = 0; index < filenames.length; index += 1) {
    const filename = filenames[index];
    const match = /^(\d{3})_([a-z0-9_]+)\.sql$/u.exec(filename);
    if (!match || match[1] !== String(index + 1).padStart(3, "0")) fail("root_migration_sequence_invalid", "migration_rehearsal");
    const result = await supervisor.run(tools.git.real, ["show", `${commit}:supabase/migrations/${filename}`], {
      cwd: repositoryRoot,
      stage: "migration_rehearsal",
      code: "root_migration_blob_read_failed",
      timeoutMs: 30_000,
      maxCaptureBytes: 32 * 1_024 * 1_024,
    });
    const path = join(snapshotRoot, filename);
    writeFileSync(path, result.stdout, { mode: 0o600, flag: "wx" });
    const statementDigest = migrationStatementsDigest(result.stdout.toString("utf8"));
    entries.push(Object.freeze({
      version: match[1],
      name: match[2],
      filename,
      bytes: result.stdout.length,
      sha256: sha256(result.stdout),
      statementCount: statementDigest.statementCount,
      statementsSha256: statementDigest.statementsSha256,
      path,
    }));
  }
  if (entries.length === 0) fail("root_migrations_missing", "migration_rehearsal");
  const historyResult = await supervisor.run(tools.git.real, ["show", `${commit}:supabase/migration-history.json`], { cwd: repositoryRoot, stage: "migration_rehearsal", code: "root_migration_history_read_failed" });
  let history;
  try {
    history = JSON.parse(historyResult.stdout.toString("utf8"));
  } catch {
    fail("root_migration_history_invalid", "migration_rehearsal");
  }
  if (history.algorithm !== "sha256" || !Array.isArray(history.files) || history.files.length > entries.length) fail("root_migration_history_invalid", "migration_rehearsal");
  history.files.forEach((file, index) => {
    const expected = entries[index];
    if (!isRecord(file) || file.name !== expected.filename || file.bytes !== expected.bytes || file.sha256 !== expected.sha256) {
      fail("root_migration_history_mismatch", "migration_rehearsal");
    }
  });
  const configResult = await supervisor.run(tools.git.real, ["show", `${commit}:supabase/config.toml`], { cwd: repositoryRoot, stage: "migration_rehearsal", code: "root_supabase_config_read_failed" });
  return Object.freeze({ entries: Object.freeze(entries), recordedHistoryCount: history.files.length, snapshotRoot, config: configResult.stdout.toString("utf8") });
}

async function reservePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function reservePorts() {
  const originals = [45420, 45421, 45422, 45423, 45424, 45425, 45426, 45427, 45428, 45429, 3000];
  const values = [];
  while (values.length < originals.length + 1) {
    const candidate = await reservePort();
    if (!values.includes(candidate)) values.push(candidate);
  }
  return Object.freeze({
    replacements: Object.freeze(Object.fromEntries(originals.map((port, index) => [port, values[index]]))),
    app: values.at(-2),
    scanner: values.at(-1),
  });
}

const STORAGE_SIZE_MULTIPLIERS = Object.freeze({
  B: 1,
  KB: 1_000,
  MB: 1_000_000,
  GB: 1_000_000_000,
  KiB: 1_024,
  MiB: 1_024 * 1_024,
  GiB: 1_024 * 1_024 * 1_024,
});

function targetStorageSize(value) {
  const match = /^([1-9][0-9]{0,8})(B|KB|MB|GB|KiB|MiB|GiB)$/u.exec(value);
  if (!match) fail("target_storage_bucket_size_invalid", "target_storage_configuration");
  const bytes = Number(match[1]) * STORAGE_SIZE_MULTIPLIERS[match[2]];
  if (!Number.isSafeInteger(bytes)) fail("target_storage_bucket_size_invalid", "target_storage_configuration");
  return bytes;
}

function targetStorageMimeTypes(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0 || item !== item.trim()) ||
    new Set(value).size !== value.length
  ) {
    fail("target_storage_bucket_mime_types_invalid", "target_storage_configuration");
  }
  return Object.freeze([...value].sort((left, right) => left.localeCompare(right, "en")));
}

export function parseTargetStorageBucketConfig(source) {
  if (
    typeof source !== "string" ||
    source.length === 0 ||
    Buffer.byteLength(source, "utf8") > MAX_TARGET_CONFIG_BYTES
  ) {
    fail("target_storage_config_invalid", "target_storage_configuration");
  }
  let parsed;
  try {
    parsed = parseToml(source);
  } catch {
    fail("target_storage_config_invalid", "target_storage_configuration");
  }
  const configured = parsed?.storage?.buckets;
  if (!isPlainTable(configured) || Object.keys(configured).length === 0) {
    fail("target_storage_buckets_missing", "target_storage_configuration");
  }
  const buckets = [];
  const allowedKeys = new Set(["public", "file_size_limit", "allowed_mime_types", "objects_path"]);
  for (const [id, bucket] of Object.entries(configured)) {
    string(id, /^[A-Za-z0-9_-]+$/u, "target_storage_bucket_identity_invalid", "target_storage_configuration", 1_024);
    if (!isPlainTable(bucket)) fail("target_storage_bucket_config_invalid", "target_storage_configuration");
    for (const key of Object.keys(bucket)) {
      if (!allowedKeys.has(key)) fail("target_storage_bucket_config_invalid", "target_storage_configuration");
      if (key === "objects_path") fail("target_storage_bucket_objects_path_forbidden", "target_storage_configuration");
    }
    if (bucket.public !== undefined && typeof bucket.public !== "boolean") {
      fail("target_storage_bucket_public_invalid", "target_storage_configuration");
    }
    buckets.push(Object.freeze({
      id,
      name: id,
      public: bucket.public ?? false,
      file_size_limit: bucket.file_size_limit === undefined ? null : targetStorageSize(bucket.file_size_limit),
      allowed_mime_types: bucket.allowed_mime_types === undefined ? null : targetStorageMimeTypes(bucket.allowed_mime_types),
    }));
  }
  return Object.freeze(buckets.sort((left, right) => left.id.localeCompare(right.id, "en")));
}

function normalizeRuntimeStorageBucket(bucket) {
  if (!isRecord(bucket)) fail("target_storage_bucket_inventory_invalid", "target_storage_configuration");
  const normalized = {
    id: string(bucket.id, null, "target_storage_bucket_inventory_invalid", "target_storage_configuration", 1_024),
    name: string(bucket.name, null, "target_storage_bucket_inventory_invalid", "target_storage_configuration", 1_024),
    public: bucket.public,
    file_size_limit: bucket.file_size_limit === null ? null : Number(bucket.file_size_limit),
    allowed_mime_types: bucket.allowed_mime_types === null
      ? null
      : Array.isArray(bucket.allowed_mime_types)
        ? [...bucket.allowed_mime_types].map((item) => String(item)).sort((left, right) => left.localeCompare(right, "en"))
        : fail("target_storage_bucket_inventory_invalid", "target_storage_configuration"),
  };
  if (
    typeof normalized.public !== "boolean" ||
    (normalized.file_size_limit !== null && (!Number.isSafeInteger(normalized.file_size_limit) || normalized.file_size_limit < 0))
  ) {
    fail("target_storage_bucket_inventory_invalid", "target_storage_configuration");
  }
  return Object.freeze(normalized);
}

export function validateTargetStorageBuckets(expected, actual, sourceBucketCount) {
  if (!Array.isArray(expected) || expected.length === 0 || !Array.isArray(actual)) {
    fail("target_storage_bucket_inventory_invalid", "target_storage_configuration");
  }
  integer(sourceBucketCount, "target_storage_bucket_inventory_invalid", "target_storage_configuration");
  const normalized = actual.map(normalizeRuntimeStorageBucket);
  const byId = new Map();
  for (const bucket of normalized) {
    if (byId.has(bucket.id)) fail("target_storage_bucket_inventory_duplicate", "target_storage_configuration");
    byId.set(bucket.id, bucket);
  }
  const configured = expected.map((bucket) => {
    const candidate = byId.get(bucket.id);
    if (!candidate || !sameJson(candidate, bucket)) fail("target_storage_bucket_mismatch", "target_storage_configuration");
    return candidate;
  });
  return Object.freeze({
    buckets: Object.freeze(configured),
    evidence: Object.freeze({
      lifecycle: "storage_api_reconcile_local",
      sourceBucketCount,
      configuredBucketCount: configured.length,
      configuredPrivateBucketCount: configured.filter((bucket) => !bucket.public).length,
      postUpgradeBucketCount: normalized.length,
      configuredInventorySha256: sha256(canonicalJson(configured)),
    }),
  });
}

function targetStorageBucketProjection(bucket) {
  return Object.freeze({
    id: bucket.id,
    name: bucket.name,
    public: bucket.public,
    file_size_limit: bucket.file_size_limit,
    allowed_mime_types: bucket.allowed_mime_types === null
      ? null
      : Object.freeze([...bucket.allowed_mime_types].sort((left, right) => left.localeCompare(right, "en"))),
  });
}

export async function reconcileTargetStorageBuckets(
  status,
  targetConfig,
  sourceBuckets,
  interruptionGuard,
  { fetchImpl = globalThis.fetch } = {},
) {
  if (
    !isRecord(status) ||
    typeof status.apiUrl !== "string" ||
    typeof status.serviceRoleKey !== "string" ||
    !Array.isArray(sourceBuckets) ||
    !(interruptionGuard instanceof RecoveryInterruptionGuard) ||
    typeof fetchImpl !== "function"
  ) {
    fail("target_storage_configuration_input_invalid", "target_storage_configuration");
  }
  const expected = parseTargetStorageBucketConfig(targetConfig);
  const headers = Object.freeze({
    apikey: status.serviceRoleKey,
    Authorization: `Bearer ${status.serviceRoleKey}`,
    "content-type": "application/json",
  });
  const listBuckets = async () => {
    const response = await apiRequest(
      new URL("/storage/v1/bucket", status.apiUrl),
      { headers },
      [200],
      "target_storage_bucket_list_failed",
      "target_storage_configuration",
      interruptionGuard,
      { fetchImpl },
    );
    let payload;
    try {
      payload = await interruptionGuard.run("target_storage_configuration", async () => await response.json());
    } catch (error) {
      if (error instanceof RecoveryFailure) throw error;
      fail("target_storage_bucket_inventory_invalid", "target_storage_configuration");
    }
    if (!Array.isArray(payload)) fail("target_storage_bucket_inventory_invalid", "target_storage_configuration");
    return payload.map(normalizeRuntimeStorageBucket).sort((left, right) => left.id.localeCompare(right.id, "en"));
  };
  const before = await listBuckets();
  const restoredSource = sourceBuckets
    .map((bucket) => targetStorageBucketProjection(validateBucket(bucket)))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (!sameJson(before, restoredSource)) {
    fail("source_storage_bucket_restore_mismatch", "target_storage_configuration");
  }
  const byId = new Map(before.map((bucket) => [bucket.id, bucket]));
  let createdBucketCount = 0;
  let updatedBucketCount = 0;
  for (const bucket of expected) {
    const current = byId.get(bucket.id);
    if (current && sameJson(current, bucket)) continue;
    const creating = !current;
    const url = creating
      ? new URL("/storage/v1/bucket", status.apiUrl)
      : new URL(`/storage/v1/bucket/${encodeURIComponent(bucket.id)}`, status.apiUrl);
    const response = await apiRequest(
      url,
      { method: creating ? "POST" : "PUT", headers, body: JSON.stringify(bucket) },
      [200],
      creating ? "target_storage_bucket_create_failed" : "target_storage_bucket_update_failed",
      "target_storage_configuration",
      interruptionGuard,
      { fetchImpl },
    );
    await interruptionGuard.run("target_storage_configuration", async () => await response.arrayBuffer());
    if (creating) createdBucketCount += 1;
    else updatedBucketCount += 1;
  }
  const after = await listBuckets();
  const expectedPostUpgrade = new Map(before.map((bucket) => [bucket.id, bucket]));
  for (const bucket of expected) expectedPostUpgrade.set(bucket.id, bucket);
  const expectedAfter = [...expectedPostUpgrade.values()]
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (!sameJson(after, expectedAfter)) {
    fail("target_storage_bucket_inventory_mismatch", "target_storage_configuration");
  }
  const verified = validateTargetStorageBuckets(expected, after, restoredSource.length);
  return Object.freeze({
    buckets: verified.buckets,
    evidence: Object.freeze({
      ...verified.evidence,
      createdBucketCount,
      updatedBucketCount,
    }),
  });
}

function isolatedConfig(source, projectName, ports) {
  let content = source;
  content = content.replace(/^project_id\s*=.*$/mu, `project_id = "${projectName}"`);
  for (const [source, target] of Object.entries(ports.replacements)) content = content.replaceAll(String(source), String(target));
  content = content.replace(/^site_url\s*=.*$/mu, `site_url = "http://127.0.0.1:${ports.app}"`);
  content = content.replace(/^additional_redirect_urls\s*=.*$/mu, `additional_redirect_urls = ["http://127.0.0.1:${ports.app}"]`);
  const lines = [];
  let skippingBucket = false;
  for (const line of content.split("\n")) {
    if (/^\[storage\.buckets\./u.test(line)) {
      skippingBucket = true;
      continue;
    }
    if (skippingBucket && /^\[/u.test(line)) skippingBucket = false;
    if (!skippingBucket) lines.push(line);
  }
  content = lines.join("\n").replace(/(\[db\.migrations\][\s\S]*?^enabled\s*=\s*)true/mu, "$1false");
  return content;
}

function enableMigrations(configPath) {
  const content = readFileSync(configPath, "utf8").replace(/(\[db\.migrations\][\s\S]*?^enabled\s*=\s*)false/mu, "$1true");
  writeFileSync(configPath, content, { mode: 0o600 });
}

function parseStatus(output) {
  const result = {};
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (!match) continue;
    try {
      result[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
    } catch {
      fail("supabase_status_invalid", "local_supabase_start");
    }
  }
  for (const key of ["DB_URL", "API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (typeof result[key] !== "string" || result[key].length === 0) fail("supabase_status_invalid", "local_supabase_start");
  }
  for (const key of ["DB_URL", "API_URL"]) {
    const url = new URL(result[key]);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) fail("supabase_status_not_loopback", "local_supabase_start");
  }
  return Object.freeze({ dbUrl: result.DB_URL, apiUrl: result.API_URL, publishableKey: result.ANON_KEY, serviceRoleKey: result.SERVICE_ROLE_KEY });
}

async function psql(supervisor, toolchain, status, args, options = {}) {
  return await supervisor.run(toolchain.paths.psql.real, [status.dbUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=verbose", ...args], {
    stage: options.stage ?? "database_restore",
    code: options.code ?? "psql_failed",
    timeoutMs: options.timeoutMs ?? 30 * 60 * 1_000,
    maxCaptureBytes: options.maxCaptureBytes ?? 2 * 1_024 * 1_024,
    env: safeEnvironment({ PGAPPNAME: "evo_v3_isolated_managed_recovery" }),
    sanitizeDiagnostic: sanitizePsqlDiagnostic,
  });
}

async function psqlJson(supervisor, toolchain, status, sql, stage = "database_verification", maxCaptureBytes = 2 * 1_024 * 1_024) {
  const result = await psql(supervisor, toolchain, status, ["--tuples-only", "--no-align", "--command", sql], { stage, timeoutMs: 5 * 60 * 1_000, maxCaptureBytes });
  try {
    return JSON.parse(result.stdout.toString("utf8").trim());
  } catch {
    fail("database_json_result_invalid", stage);
  }
}

async function startLocalSupabase(state, root, ports, supervisor, toolchain) {
  const workdir = join(state.harnessRoot, "supabase-workdir");
  state.supabaseRoot = workdir;
  mkdirSync(join(workdir, "supabase"), { recursive: true, mode: 0o700 });
  const configPath = join(workdir, "supabase", "config.toml");
  writeFileSync(configPath, isolatedConfig(root.config, state.projectName, ports), { mode: 0o600, flag: "wx" });
  await verifyPinnedSupabaseImageTags(supervisor, toolchain);
  beginContainerMutationCapture(state, "local_supabase_start");
  const createdNetwork = await runDocker(supervisor, toolchain.paths.docker, [
    "--context", "orbstack", "network", "create",
    "--driver", "bridge",
    "--opt", "com.docker.network.bridge.enable_ip_masquerade=false",
    "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
    "--label", `evo.recovery.owner=${state.projectName}`,
    state.networkName,
  ], {
    stage: "local_supabase_start",
    code: "isolated_network_create_failed",
    timeoutMs: 30_000,
  });
  const networkId = createdNetwork.stdout.toString("utf8").trim();
  if (!SHA256.test(networkId)) fail("isolated_network_id_invalid", "local_supabase_start");
  state.networkId = networkId;
  state.networkCreated = true;
  await supervisor.run(toolchain.paths.supabaseNative.real, ["start", "--workdir", workdir, "--network-id", state.networkName, "--exclude", EXCLUDED_SERVICES, "--ignore-health-check", "--debug", "--yes"], {
    stage: "local_supabase_start",
    code: "local_supabase_start_failed",
    timeoutMs: 10 * 60 * 1_000,
    maxCaptureBytes: 32 * 1_024 * 1_024,
    env: pinnedSupabaseEnvironment(toolchain.paths),
  });
  state.stackStarted = true;
  const statusResult = await supervisor.run(toolchain.paths.supabaseNative.real, ["status", "--workdir", workdir, "--output", "env"], {
    stage: "local_supabase_start",
    code: "local_supabase_status_failed",
    timeoutMs: 60_000,
    env: pinnedSupabaseEnvironment(toolchain.paths),
  });
  const status = parseStatus(statusResult.stdout.toString("utf8"));
  const endpoint = await inspectLocalSupabaseNetwork(state, status, supervisor, toolchain);
  if (endpoint.networkId !== state.networkId) fail("isolated_network_identity_drift", "local_supabase_start");
  state.supabaseContainerIds = endpoint.memberIds;
  const egress = await proveRecoveryNetworkEgressBlocked(endpoint, supervisor, toolchain);
  return Object.freeze({ status, configPath, endpoint, egress });
}

function parsedJson(value, code, stage) {
  try {
    return JSON.parse(value);
  } catch {
    fail(code, stage);
  }
}

function projectedContainers(output, code, stage) {
  const lines = String(output).split(/\r?\n/u).filter(Boolean);
  if (lines.length === 0) fail(code, stage);
  const records = lines.map((line) => {
    const fields = line.split("\t");
    if (fields.length !== 7) fail(code, stage);
    const [id, name, image, labels, networkMode, ports, networks] = fields.map((field) => parsedJson(field, code, stage));
    if (
      !SHA256.test(id) ||
      typeof name !== "string" ||
      !name.startsWith("/") ||
      !/^sha256:[0-9a-f]{64}$/u.test(image) ||
      !isRecord(labels) ||
      typeof networkMode !== "string" ||
      !isRecord(ports) ||
      !isRecord(networks)
    ) {
      fail(code, stage);
    }
    return Object.freeze({ id, name: name.slice(1), image, labels, networkMode, ports, networks });
  });
  if (new Set(records.map(({ id }) => id)).size !== records.length) fail(code, stage);
  return Object.freeze(records);
}

export function validatePinnedSupabaseServiceImages(records, projectName, expected = PINNED_SUPABASE_SERVICE_IMAGES) {
  if (
    !Array.isArray(records) ||
    !isPlainTable(expected) ||
    typeof projectName !== "string" ||
    !/^evov3recovery[0-9a-f]{12}$/u.test(projectName)
  ) {
    fail("supabase_service_image_set_invalid", "local_supabase_start");
  }
  const expectedServices = Object.keys(expected).sort();
  const actual = [];
  for (const service of expectedServices) {
    const binding = expected[service];
    if (
      !/^[a-z][a-z0-9-]{0,31}$/u.test(service) ||
      !isPlainTable(binding) ||
      !sameJson(Object.keys(binding).sort(), ["digest", "reference"]) ||
      typeof binding.reference !== "string" ||
      !binding.reference.startsWith("public.ecr.aws/supabase/") ||
      !IMAGE.test(binding.digest)
    ) {
      fail("supabase_service_image_binding_invalid", "local_supabase_start");
    }
    const name = `supabase_${service}_${projectName}`;
    const matches = records.filter((record) => record?.name === name);
    if (matches.length !== 1 || matches[0].image !== binding.digest) {
      fail("supabase_service_image_set_invalid", "local_supabase_start");
    }
    actual.push(Object.freeze({ service, digest: binding.digest }));
  }
  if (records.length !== expectedServices.length) fail("supabase_service_image_set_invalid", "local_supabase_start");
  return Object.freeze({
    serviceCount: actual.length,
    imageSetSha256: sha256(canonicalJson(actual)),
  });
}

async function verifyPinnedSupabaseImageTags(supervisor, toolchain) {
  const expectedArchitecture = process.arch === "arm64" ? "arm64" : null;
  if (process.platform !== "darwin" || expectedArchitecture === null) {
    fail("supabase_service_image_platform_unsupported", "local_supabase_start");
  }
  for (const binding of Object.values(PINNED_SUPABASE_SERVICE_IMAGES)) {
    const result = await runDocker(supervisor, toolchain.paths.docker, [
      "--context", "orbstack", "image", "inspect", "--format", SAFE_PINNED_IMAGE_INSPECT_FORMAT, binding.reference,
    ], {
      stage: "local_supabase_start",
      code: "supabase_service_image_missing",
      timeoutMs: 60_000,
    });
    const fields = result.stdout.toString("utf8").trim().split("\t").map((field) => parsedJson(field, "supabase_service_image_inspection_invalid", "local_supabase_start"));
    if (fields.length !== 5) fail("supabase_service_image_inspection_invalid", "local_supabase_start");
    const [id, repoDigests, repoTags, operatingSystem, architecture] = fields;
    const repository = binding.reference.slice(0, binding.reference.lastIndexOf(":"));
    if (
      id !== binding.digest ||
      !Array.isArray(repoDigests) ||
      !repoDigests.includes(`${repository}@${binding.digest}`) ||
      !Array.isArray(repoTags) ||
      !repoTags.includes(binding.reference) ||
      operatingSystem !== "linux" ||
      architecture !== expectedArchitecture
    ) {
      fail("supabase_service_image_inspection_invalid", "local_supabase_start");
    }
  }
}

function recoveryNetwork(value, expected, code, stage) {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) fail(code, stage);
  const network = value[0];
  if (
    !SHA256.test(network.Id ?? "") ||
    network.Name !== expected.networkName ||
    network.Driver !== "bridge" ||
    network.Scope !== "local" ||
    network.Internal !== false ||
    network.EnableIPv6 !== false ||
    network.Ingress !== false ||
    network.Options?.["com.docker.network.bridge.host_binding_ipv4"] !== "127.0.0.1" ||
    network.Options?.["com.docker.network.bridge.enable_ip_masquerade"] !== "false" ||
    network.Labels?.["evo.recovery.owner"] !== expected.projectName ||
    !isRecord(network.Containers) ||
    Object.keys(network.Containers).length === 0
  ) {
    fail(code, stage);
  }
  for (const [id, member] of Object.entries(network.Containers)) {
    if (!SHA256.test(id) || !isRecord(member) || typeof member.Name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(member.Name)) {
      fail(code, stage);
    }
  }
  return network;
}

function validateContainerNetwork(record, network, networkName, code, stage) {
  if (record.networkMode !== networkName || Object.keys(record.networks).length !== 1 || !isRecord(record.networks[networkName])) {
    fail(code, stage);
  }
  const attachment = record.networks[networkName];
  if (attachment.NetworkID !== network.Id || !Array.isArray(attachment.Aliases) || attachment.Aliases.length === 0) fail(code, stage);
  if (attachment.Aliases.some((alias) => typeof alias !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(alias))) fail(code, stage);
  return attachment;
}

function loopbackPortBindings(ports, code, stage) {
  const published = [];
  for (const [portKey, bindings] of Object.entries(ports)) {
    const portMatch = /^(\d+)\/(tcp|udp)$/u.exec(portKey);
    if (!portMatch) fail(code, stage);
    const containerPort = Number(portMatch[1]);
    if (containerPort < 1 || containerPort > 65_535) fail(code, stage);
    if (bindings === null) continue;
    if (!Array.isArray(bindings) || bindings.length === 0) fail(code, stage);
    for (const binding of bindings) {
      if (!isRecord(binding) || binding.HostIp !== "127.0.0.1" || !/^\d{1,5}$/u.test(binding.HostPort ?? "")) fail(code, stage);
      const hostPort = Number(binding.HostPort);
      if (hostPort < 1 || hostPort > 65_535) fail(code, stage);
      published.push(Object.freeze({ containerPort, hostPort, protocol: portMatch[2] }));
    }
  }
  return Object.freeze(published);
}

function containerRuntimeShapeSha256(record) {
  return sha256(canonicalJson({
    image: record.image,
    labels: record.labels,
    networkMode: record.networkMode,
    ports: record.ports,
    networks: record.networks,
  }));
}

function validatedContainerCensus(value, code, stage) {
  if (!isRecord(value)) fail(code, stage);
  exactKeys(value, ["appOwnerIds", "ids", "scannerIds", "supabaseIds"], code, stage);
  for (const field of ["appOwnerIds", "ids", "scannerIds", "supabaseIds"]) {
    if (
      !Array.isArray(value[field]) ||
      value[field].some((id) => !SHA256.test(id)) ||
      new Set(value[field]).size !== value[field].length ||
      !sameJson(value[field], [...value[field]].sort())
    ) {
      fail(code, stage);
    }
  }
  const members = [...value.supabaseIds, ...value.appOwnerIds, ...value.scannerIds];
  if (new Set(members).size !== members.length || !sameJson(value.ids, [...members].sort())) fail(code, stage);
  return value;
}

export function validateContainerCensusIds(
  projectOutput,
  ownerOutput,
  scannerOutput = "",
  { requireOwner = false, requireScanner = false } = {},
) {
  const parse = (output) => String(output).split(/\r?\n/u).filter(Boolean).map((id) =>
    string(id, SHA256, "container_census_invalid", "isolation_identity", 64)).sort();
  const supabaseIds = parse(projectOutput);
  const appOwnerIds = parse(ownerOutput);
  const scannerIds = parse(scannerOutput);
  if (
    supabaseIds.length === 0 ||
    appOwnerIds.length > 1 ||
    scannerIds.length > 1 ||
    (requireOwner && appOwnerIds.length !== 1) ||
    (requireScanner && scannerIds.length !== 1)
  ) {
    fail("container_census_invalid", "isolation_identity");
  }
  const ids = [...supabaseIds, ...appOwnerIds, ...scannerIds];
  if (
    new Set(supabaseIds).size !== supabaseIds.length ||
    new Set(appOwnerIds).size !== appOwnerIds.length ||
    new Set(scannerIds).size !== scannerIds.length ||
    new Set(ids).size !== ids.length
  ) {
    fail("container_census_invalid", "isolation_identity");
  }
  return Object.freeze({
    appOwnerIds: Object.freeze(appOwnerIds),
    ids: Object.freeze(ids.sort()),
    scannerIds: Object.freeze(scannerIds),
    supabaseIds: Object.freeze(supabaseIds),
  });
}

async function containerCensus(
  supervisor,
  toolchain,
  projectName,
  { requireOwner = false, requireScanner = false, stage = "local_supabase_start" } = {},
) {
  const common = ["--context", "orbstack", "ps", "--all", "--no-trunc", "--format", "{{.ID}}"];
  const [project, owner, scanner] = await Promise.all([
    runDocker(supervisor, toolchain.paths.docker, [...common, "--filter", `label=com.supabase.cli.project=${projectName}`], {
      stage, code: "supabase_project_container_census_failed", timeoutMs: 30_000,
    }),
    runDocker(supervisor, toolchain.paths.docker, [...common, "--filter", `label=evo.recovery.owner=${projectName}`], {
      stage, code: "recovery_app_container_census_failed", timeoutMs: 30_000,
    }),
    runDocker(supervisor, toolchain.paths.docker, [...common, "--filter", `label=evo.recovery.scanner=${projectName}`], {
      stage, code: "recovery_scanner_container_census_failed", timeoutMs: 30_000,
    }),
  ]);
  return validateContainerCensusIds(
    project.stdout.toString("utf8"),
    owner.stdout.toString("utf8"),
    scanner.stdout.toString("utf8"),
    { requireOwner, requireScanner },
  );
}

function validateScannerContainerRecord(record, network, expected, code, stage) {
  if (!isRecord(expected)) fail(code, stage);
  exactKeys(expected, ["containerId", "containerName", "imageId", "networkHost", "projectName"], code, stage);
  if (
    record.id !== expected.containerId ||
    record.name !== expected.containerName ||
    record.image !== expected.imageId
  ) {
    fail(code, stage);
  }
  if (
    record.labels["com.docker.compose.project"] !== expected.projectName ||
    record.labels["com.evo.runtime.role"] !== "private-malware-scanner" ||
    record.labels["evo.recovery.project"] !== expected.projectName ||
    record.labels["evo.recovery.scanner"] !== expected.projectName ||
    record.labels["evo.recovery.type"] !== "malware-scanner"
  ) {
    fail(code, stage);
  }
  validateContainerNetwork(record, network, network.Name, code, stage);
  const aliases = record.networks[network.Name].Aliases;
  if (!sameJson(aliases, [expected.networkHost]) || loopbackPortBindings(record.ports, code, stage).length !== 0) fail(code, stage);
}

export function validateLocalSupabaseNetwork(networkPayload, projectionOutput, expected) {
  exactKeys(expected, ["apiUrl", "census", "networkName", "projectName", "scanner"], "local_supabase_network_invalid", "local_supabase_start");
  const census = validatedContainerCensus(expected.census, "local_supabase_container_census_mismatch", "local_supabase_start");
  const network = recoveryNetwork(networkPayload, expected, "local_supabase_network_invalid", "local_supabase_start");
  const records = projectedContainers(projectionOutput, "local_supabase_container_inspection_invalid", "local_supabase_start");
  const memberIds = Object.keys(network.Containers).sort();
  const censusIds = [...census.ids];
  const recordIds = records.map((record) => record.id).sort();
  if (
    (expected.scanner === null && census.scannerIds.length !== 0) ||
    (isRecord(expected.scanner) && census.scannerIds.length !== 1) ||
    !sameJson(censusIds, memberIds) ||
    !sameJson(recordIds, censusIds)
  ) {
    fail("local_supabase_container_census_mismatch", "local_supabase_start");
  }
  let apiPort;
  try {
    const parsed = new URL(expected.apiUrl);
    if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname) || parsed.port === "") throw new Error("not loopback");
    apiPort = Number(parsed.port);
    if (!Number.isSafeInteger(apiPort) || apiPort < 1 || apiPort > 65_535) throw new Error("invalid port");
  } catch {
    fail("local_supabase_network_invalid", "local_supabase_start");
  }
  const matches = [];
  const databaseMatches = [];
  for (const record of records) {
    const member = network.Containers[record.id];
    const isSupabase = census.supabaseIds.includes(record.id);
    const isScanner = census.scannerIds.includes(record.id);
    if (
      !memberIds.includes(record.id) ||
      member.Name !== record.name ||
      Number(isSupabase) + Number(isScanner) !== 1
    ) {
      fail("local_supabase_container_inspection_invalid", "local_supabase_start");
    }
    if (isScanner) {
      validateScannerContainerRecord(
        record,
        network,
        expected.scanner,
        "local_supabase_container_inspection_invalid",
        "local_supabase_start",
      );
      continue;
    }
    if (
      !record.name.startsWith("supabase_") ||
      !record.name.endsWith(`_${expected.projectName}`) ||
      record.labels["com.supabase.cli.project"] !== expected.projectName
    ) {
      fail("local_supabase_container_inspection_invalid", "local_supabase_start");
    }
    validateContainerNetwork(record, network, expected.networkName, "local_supabase_container_inspection_invalid", "local_supabase_start");
    if (record.name === `supabase_db_${expected.projectName}`) databaseMatches.push(record);
    for (const binding of loopbackPortBindings(record.ports, "local_supabase_container_inspection_invalid", "local_supabase_start")) {
      if (binding.protocol === "tcp" && binding.hostPort === apiPort) matches.push(Object.freeze({ record, targetPort: binding.containerPort }));
    }
  }
  if (matches.length !== 1) fail("local_supabase_api_endpoint_ambiguous", "local_supabase_start");
  if (databaseMatches.length !== 1) fail("local_supabase_database_container_ambiguous", "local_supabase_start");
  return Object.freeze({
    networkId: network.Id,
    memberIds: Object.freeze(memberIds),
    memberShapeSha256ById: Object.freeze(Object.fromEntries(
      records.map((record) => [record.id, containerRuntimeShapeSha256(record)]),
    )),
    targetHost: matches[0].record.name,
    targetPort: matches[0].targetPort,
    apiLoopbackPort: apiPort,
    databaseContainerId: databaseMatches[0].id,
  });
}

async function proveRecoveryContainerInternetTcpBlocked(containerId, internalHost, internalPort, supervisor, toolchain, stage) {
  if (
    !SHA256.test(containerId) ||
    typeof internalHost !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(internalHost) ||
    !Number.isSafeInteger(internalPort) ||
    internalPort < 1 ||
    internalPort > 65_535
  ) {
    fail("recovery_network_egress_probe_input_invalid", stage);
  }
  const command = String.raw`command -v timeout >/dev/null 2>&1 || exit 96
test -x /bin/bash || exit 96
timeout 3 /bin/bash -c '</dev/tcp/$1/$2' _ "$1" "$2" >/dev/null 2>&1 || exit 95
set +e
timeout 3 /bin/bash -c '</dev/tcp/1.1.1.1/443' >/dev/null 2>&1
result=$?
set -e
case "$result" in
  0) exit 97 ;;
  1|124) printf egress-blocked ;;
  *) exit 94 ;;
esac`;
  const result = await runDocker(supervisor, toolchain.paths.docker, [
    "--context", "orbstack", "exec", containerId, "/bin/bash", "-c", command, "_", internalHost, String(internalPort),
  ], {
    stage,
    code: "recovery_network_egress_not_blocked",
    timeoutMs: 10_000,
  });
  if (result.stdout.toString("utf8") !== "egress-blocked") {
    fail("recovery_network_egress_proof_invalid", stage);
  }
  return Object.freeze({
    status: "bounded_probe_blocked",
    scope: "public_ipv4_tcp_443",
    mechanism: "bridge_ip_masquerade_disabled_plus_exact_container_probe",
    probeContainerIdSha256: sha256(containerId),
    positiveControlTargetSha256: sha256(`${internalHost}:${internalPort}`),
    positiveControl: "private_network_tcp_connected",
    probeTargetSha256: sha256("1.1.1.1:443"),
  });
}

async function proveRecoveryNetworkEgressBlocked(endpoint, supervisor, toolchain) {
  return Object.freeze({
    ipMasquerade: false,
    ipv6: false,
    database: await proveRecoveryContainerInternetTcpBlocked(
      endpoint.databaseContainerId,
      endpoint.targetHost,
      endpoint.targetPort,
      supervisor,
      toolchain,
      "local_supabase_start",
    ),
  });
}

export function validateCandidateNetworkAttachment(networkPayload, projectionOutput, expected) {
  exactKeys(expected, ["appContainerId", "appContainerName", "appImageId", "appNetworkAlias", "appPort", "census", "networkName", "previousMemberIds", "previousMemberShapeSha256ById", "projectName", "scanner"], "candidate_network_attachment_invalid", "image_verification");
  const census = validatedContainerCensus(expected.census, "candidate_container_census_mismatch", "image_verification");
  if (typeof expected.appNetworkAlias !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(expected.appNetworkAlias)) {
    fail("candidate_network_attachment_invalid", "image_verification");
  }
  const network = recoveryNetwork(networkPayload, expected, "candidate_network_attachment_invalid", "image_verification");
  const records = projectedContainers(projectionOutput, "candidate_container_inspection_invalid", "image_verification");
  const record = records.find((candidate) => candidate.id === expected.appContainerId);
  const censusIds = [...census.ids];
  const members = Object.keys(network.Containers).sort();
  const recordIds = records.map((candidate) => candidate.id).sort();
  if (!sameJson(censusIds, members) || !sameJson(recordIds, censusIds)) {
    fail("candidate_container_census_mismatch", "image_verification");
  }
  if (!isPlainTable(expected.previousMemberShapeSha256ById)) {
    fail("candidate_supabase_container_shape_changed", "image_verification");
  }
  const previousShapeEntries = Object.entries(expected.previousMemberShapeSha256ById);
  if (
    previousShapeEntries.length !== census.supabaseIds.length ||
    previousShapeEntries.some(([id, digest]) => !census.supabaseIds.includes(id) || !SHA256.test(digest)) ||
    census.supabaseIds.some((id) => {
      const previousRecord = records.find((candidate) => candidate.id === id);
      return !previousRecord || containerRuntimeShapeSha256(previousRecord) !== expected.previousMemberShapeSha256ById[id];
    })
  ) {
    fail("candidate_supabase_container_shape_changed", "image_verification");
  }
  if (
    !record ||
    record.id !== expected.appContainerId ||
    record.name !== expected.appContainerName ||
    record.image !== expected.appImageId ||
    record.labels["evo.recovery.owner"] !== expected.projectName ||
    record.labels["evo.recovery.project"] !== expected.projectName ||
    record.labels["evo.recovery.type"] !== "candidate-app" ||
    census.appOwnerIds.length !== 1 ||
    census.appOwnerIds[0] !== record.id ||
    census.scannerIds.length !== 1 ||
    network.Containers[record.id]?.Name !== record.name
  ) {
    fail("candidate_container_inspection_invalid", "image_verification");
  }
  for (const candidate of records) {
    if (network.Containers[candidate.id]?.Name !== candidate.name) {
      fail("candidate_container_inspection_invalid", "image_verification");
    }
    const networkAttachment = validateContainerNetwork(candidate, network, expected.networkName, "candidate_network_attachment_invalid", "image_verification");
    loopbackPortBindings(candidate.ports, "candidate_network_attachment_invalid", "image_verification");
    if (candidate.id === record.id) {
      if (!sameJson(networkAttachment.Aliases, [expected.appNetworkAlias])) {
        fail("candidate_app_network_alias_invalid", "image_verification");
      }
    } else if (census.scannerIds.includes(candidate.id)) {
      if (loopbackPortBindings(candidate.ports, "candidate_network_attachment_invalid", "image_verification").length !== 0) {
        fail("candidate_scanner_published_port_forbidden", "image_verification");
      }
      validateScannerContainerRecord(
        candidate,
        network,
        expected.scanner,
        "candidate_scanner_inspection_invalid",
        "image_verification",
      );
    } else if (
      !census.supabaseIds.includes(candidate.id) ||
      !candidate.name.startsWith("supabase_") ||
      !candidate.name.endsWith(`_${expected.projectName}`) ||
      candidate.labels["com.supabase.cli.project"] !== expected.projectName
    ) {
      fail("candidate_container_inspection_invalid", "image_verification");
    }
  }
  if (!sameJson(record.networks[expected.networkName].Aliases, [expected.appNetworkAlias])) {
    fail("candidate_network_attachment_invalid", "image_verification");
  }
  const previous = [...expected.previousMemberIds].sort();
  if (members.length !== previous.length + 1 || !previous.every((id) => members.includes(id))) {
    fail("candidate_network_membership_changed", "image_verification");
  }
  const published = loopbackPortBindings(record.ports, "candidate_network_attachment_invalid", "image_verification");
  if (published.length !== 1 || published[0].protocol !== "tcp" || published[0].containerPort !== expected.appPort || published[0].hostPort !== expected.appPort) {
    fail("candidate_network_attachment_invalid", "image_verification");
  }
  return Object.freeze({
    schema: "evo-v3-recovery-app-network/v2",
    appContainerIdSha256: sha256(record.id),
    appImageIdSha256: sha256(record.image),
    networkIdSha256: sha256(network.Id),
    attachedNetworkCount: 1,
    publishedPortCount: 1,
    loopbackOnly: true,
    ipMasquerade: false,
  });
}

async function inspectLocalSupabaseNetwork(state, status, supervisor, toolchain) {
  const networkResult = await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "network", "inspect", state.networkName], {
    stage: "local_supabase_start", code: "local_supabase_network_inspect_failed", timeoutMs: 30_000, maxCaptureBytes: 4 * 1_024 * 1_024,
  });
  const networkPayload = parsedJson(networkResult.stdout.toString("utf8"), "local_supabase_network_invalid", "local_supabase_start");
  const census = await containerCensus(supervisor, toolchain, state.projectName, {
    requireScanner: isRecord(state.scannerIdentity),
  });
  const containerResult = await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "inspect", "--format", SAFE_CONTAINER_INSPECT_FORMAT, ...census.ids], {
    stage: "local_supabase_start", code: "local_supabase_container_inspect_failed", timeoutMs: 30_000, maxCaptureBytes: 4 * 1_024 * 1_024,
  });
  const projection = containerResult.stdout.toString("utf8");
  const endpoint = validateLocalSupabaseNetwork(networkPayload, projection, {
    apiUrl: status.apiUrl,
    census,
    networkName: state.networkName,
    projectName: state.projectName,
    scanner: state.scannerIdentity ?? null,
  });
  if (typeof state.networkId === "string" && endpoint.networkId !== state.networkId) {
    fail("isolated_network_identity_drift", "local_supabase_start");
  }
  if (Array.isArray(state.supabaseContainerIds)) {
    const expectedMemberIds = [
      ...state.supabaseContainerIds,
      ...(typeof state.scannerContainer === "string" ? [state.scannerContainer] : []),
    ].sort();
    if (!sameJson(endpoint.memberIds, expectedMemberIds)) {
      fail("local_supabase_container_identity_drift", "local_supabase_start");
    }
  }
  const serviceImages = validatePinnedSupabaseServiceImages(
    projectedContainers(projection, "supabase_service_image_set_invalid", "local_supabase_start")
      .filter((record) => census.supabaseIds.includes(record.id)),
    state.projectName,
  );
  return Object.freeze({ ...endpoint, serviceImages });
}

function pgmqRelationCounts(counts, code, stage) {
  if (!isRecord(counts)) fail(code, stage);
  const entries = Object.entries(counts)
    .filter(([table]) => table.startsWith("pgmq."))
    .sort(([left], [right]) => left.localeCompare(right, "en"));
  if (
    entries.length !== RECOVERY_PGMQ_RELATIONS.length ||
    entries.some(([table, count], index) => {
      integer(count, code, stage);
      return table !== RECOVERY_PGMQ_RELATIONS[index];
    })
  ) {
    fail(code, stage);
  }
  return Object.freeze(Object.fromEntries(entries));
}

export function validatePgmqRestoreInventory(counts, columns) {
  const relationCounts = pgmqRelationCounts(counts, "pgmq_restore_inventory_invalid", "database_restore");
  if (!isRecord(columns)) fail("pgmq_restore_inventory_invalid", "database_restore");
  const pgmqColumns = Object.fromEntries(Object.entries(columns)
    .filter(([table]) => table.startsWith("pgmq."))
    .sort(([left], [right]) => left.localeCompare(right, "en")));
  if (!sameJson(pgmqColumns, RECOVERY_PGMQ_COPY_COLUMNS)) {
    fail("pgmq_restore_inventory_invalid", "database_restore");
  }
  return Object.freeze({
    queueSetSha256: sha256(canonicalJson(RECOVERY_PGMQ_QUEUES)),
    relationSetSha256: sha256(canonicalJson(RECOVERY_PGMQ_RELATIONS)),
    relationCountsSha256: sha256(canonicalJson(relationCounts)),
    copyColumnsSha256: sha256(canonicalJson(pgmqColumns)),
    signedRowCount: Object.values(relationCounts).reduce((total, count) => total + count, 0),
  });
}

export function validatePgmqContainmentProof(verified, inventory, options = {}) {
  const stage = options.stage ?? "database_restore";
  const phase = options.phase;
  const signedRelationCountsSha256 = inventory?.relationCountsSha256 ?? inventory?.signedRelationCountsSha256;
  exactKeys(verified, [
    "queueMetadata", "queueMetadataTotalCount", "queueRelationCount",
    "requiredRelationCount", "loggedRelationCount", "identitySequenceCount",
    "copyCompatibleColumnCount", "requiredSignatureCount", "missingRoleCount", "directForbiddenGrantCount",
    "forbiddenOwnerReachabilityCount", "effectiveForbiddenPrivilegeCount", "additiveDefaultGrantCount",
    "restoredRelationCounts",
  ], "pgmq_extension_relation_containment_failed", stage);
  if (!new Set(["pre_data", "post_data", "post_migration"]).has(phase)) {
    fail("pgmq_extension_relation_containment_failed", stage);
  }
  const requireCountsMatch = phase !== "pre_data";
  if (options.requireCountsMatch !== undefined && options.requireCountsMatch !== requireCountsMatch) {
    fail("pgmq_extension_relation_containment_failed", stage);
  }
  const expectedMetadata = RECOVERY_PGMQ_QUEUES.map((queueName) => Object.freeze({
    queueName,
    isPartitioned: false,
    isUnlogged: false,
  }));
  const zeroFields = [
    "missingRoleCount", "directForbiddenGrantCount",
    "forbiddenOwnerReachabilityCount", "effectiveForbiddenPrivilegeCount", "additiveDefaultGrantCount",
  ];
  if (
    !isRecord(inventory) ||
    !SHA256.test(signedRelationCountsSha256 ?? "") ||
    !SHA256.test(inventory.copyColumnsSha256 ?? "") ||
    !sameJson(verified.queueMetadata, expectedMetadata) ||
    verified.queueMetadataTotalCount !== RECOVERY_PGMQ_QUEUES.length ||
    verified.queueRelationCount !== RECOVERY_PGMQ_RELATIONS.length ||
    verified.requiredRelationCount !== RECOVERY_PGMQ_RELATIONS.length ||
    verified.loggedRelationCount !== RECOVERY_PGMQ_RELATIONS.length ||
    verified.identitySequenceCount !== RECOVERY_PGMQ_QUEUES.length ||
    verified.copyCompatibleColumnCount !== RECOVERY_PGMQ_COPY_COLUMN_COUNT ||
    verified.requiredSignatureCount !== RECOVERY_PGMQ_SIGNATURES.length ||
    zeroFields.some((field) => verified[field] !== 0)
  ) {
    fail("pgmq_extension_relation_containment_failed", stage);
  }
  const restoredCounts = pgmqRelationCounts(
    verified.restoredRelationCounts,
    "pgmq_extension_relation_containment_failed",
    stage,
  );
  const restoredRelationCountsSha256 = sha256(canonicalJson(restoredCounts));
  const relationCountsMatch = restoredRelationCountsSha256 === signedRelationCountsSha256;
  if (requireCountsMatch && !relationCountsMatch) {
    fail("pgmq_extension_relation_count_mismatch", stage);
  }
  return Object.freeze({
    status: requireCountsMatch ? "restored_and_contained" : "created_and_contained",
    phase,
    signedRelationCountsSha256,
    restoredRelationCountsSha256,
    relationCountsMatch,
    copyColumnsSha256: inventory.copyColumnsSha256,
    queueMetadataSha256: sha256(canonicalJson(verified.queueMetadata)),
    queueMetadataTotalCount: verified.queueMetadataTotalCount,
    queueRelationCount: verified.queueRelationCount,
    requiredRelationCount: verified.requiredRelationCount,
    loggedRelationCount: verified.loggedRelationCount,
    identitySequenceCount: verified.identitySequenceCount,
    copyCompatibleColumnCount: verified.copyCompatibleColumnCount,
    requiredSignatureCount: verified.requiredSignatureCount,
    missingRoleCount: verified.missingRoleCount,
    directForbiddenGrantCount: verified.directForbiddenGrantCount,
    forbiddenOwnerReachabilityCount: verified.forbiddenOwnerReachabilityCount,
    effectiveForbiddenPrivilegeCount: verified.effectiveForbiddenPrivilegeCount,
    additiveDefaultGrantCount: verified.additiveDefaultGrantCount,
  });
}

async function inspectPgmqExtensionRelations(inventory, phase, status, supervisor, toolchain, options = {}) {
  const stage = options.stage ?? "database_restore";
  const structure = await psqlJson(supervisor, toolchain, status, String.raw`
    WITH forbidden_role_names(role_name) AS (
      VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin')
    ), named_roles AS (
      SELECT roles.oid, roles.rolname
      FROM pg_roles AS roles
      JOIN forbidden_role_names AS forbidden ON forbidden.role_name = roles.rolname
    ), target_namespaces AS (
      SELECT namespace.oid, namespace.nspname, namespace.nspowner
      FROM pg_namespace AS namespace
      WHERE namespace.nspname IN ('pgmq', 'pgmq_public')
    ), forbidden_direct_acl AS (
      SELECT 1
      FROM pg_namespace AS namespace
      JOIN target_namespaces AS target ON target.oid = namespace.oid
      CROSS JOIN LATERAL aclexplode(coalesce(namespace.nspacl, acldefault('n'::"char", namespace.nspowner))) AS acl
      WHERE CASE WHEN acl.grantee = 0 THEN true ELSE EXISTS (
        SELECT 1 FROM named_roles AS role
        WHERE role.oid = acl.grantee
           OR pg_has_role(role.oid, acl.grantee, 'USAGE')
           OR pg_has_role(role.oid, acl.grantee, 'SET')
      ) END
      UNION ALL
      SELECT 1
      FROM pg_class AS relation
      JOIN target_namespaces AS namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(
        relation.relacl,
        acldefault((CASE WHEN relation.relkind = 'S' THEN 's' ELSE 'r' END)::"char", relation.relowner)
      )) AS acl
      WHERE relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND CASE WHEN acl.grantee = 0 THEN true ELSE EXISTS (
          SELECT 1 FROM named_roles AS role
          WHERE role.oid = acl.grantee
             OR pg_has_role(role.oid, acl.grantee, 'USAGE')
             OR pg_has_role(role.oid, acl.grantee, 'SET')
        ) END
      UNION ALL
      SELECT 1
      FROM pg_attribute AS attribute
      JOIN pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN target_namespaces AS namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
      WHERE attribute.attnum > 0 AND NOT attribute.attisdropped
        AND CASE WHEN acl.grantee = 0 THEN true ELSE EXISTS (
          SELECT 1 FROM named_roles AS role
          WHERE role.oid = acl.grantee
             OR pg_has_role(role.oid, acl.grantee, 'USAGE')
             OR pg_has_role(role.oid, acl.grantee, 'SET')
        ) END
      UNION ALL
      SELECT 1
      FROM pg_proc AS routine
      JOIN target_namespaces AS namespace ON namespace.oid = routine.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(routine.proacl, acldefault('f'::"char", routine.proowner))) AS acl
      WHERE CASE WHEN acl.grantee = 0 THEN true ELSE EXISTS (
        SELECT 1 FROM named_roles AS role
        WHERE role.oid = acl.grantee
           OR pg_has_role(role.oid, acl.grantee, 'USAGE')
           OR pg_has_role(role.oid, acl.grantee, 'SET')
      ) END
    ), forbidden_owner_reachability AS (
      SELECT 1
      FROM named_roles AS role
      CROSS JOIN target_namespaces AS namespace
      WHERE role.oid = namespace.nspowner
         OR pg_has_role(role.oid, namespace.nspowner, 'USAGE')
         OR pg_has_role(role.oid, namespace.nspowner, 'SET')
      UNION ALL
      SELECT 1
      FROM named_roles AS role
      CROSS JOIN pg_class AS relation
      JOIN target_namespaces AS namespace ON namespace.oid = relation.relnamespace
      WHERE relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND (
          role.oid = relation.relowner
          OR pg_has_role(role.oid, relation.relowner, 'USAGE')
          OR pg_has_role(role.oid, relation.relowner, 'SET')
        )
      UNION ALL
      SELECT 1
      FROM named_roles AS role
      CROSS JOIN pg_proc AS routine
      JOIN target_namespaces AS namespace ON namespace.oid = routine.pronamespace
      WHERE role.oid = routine.proowner
         OR pg_has_role(role.oid, routine.proowner, 'USAGE')
         OR pg_has_role(role.oid, routine.proowner, 'SET')
      UNION ALL
      SELECT 1
      FROM named_roles AS role
      CROSS JOIN pg_default_acl AS defaults
      LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
      WHERE (defaults.defaclnamespace = 0 OR namespace.nspname IN ('pgmq', 'pgmq_public'))
        AND (
          role.oid = defaults.defaclrole
          OR pg_has_role(role.oid, defaults.defaclrole, 'USAGE')
          OR pg_has_role(role.oid, defaults.defaclrole, 'SET')
        )
    ), forbidden_effective_privilege AS (
      SELECT 1
      FROM named_roles AS role
      CROSS JOIN target_namespaces AS namespace
      WHERE has_schema_privilege(role.oid, namespace.oid, 'USAGE')
         OR has_schema_privilege(role.oid, namespace.oid, 'CREATE')
      UNION ALL
      SELECT 1
      FROM named_roles AS role
      CROSS JOIN pg_class AS relation
      JOIN target_namespaces AS namespace ON namespace.oid = relation.relnamespace
      WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (
          has_table_privilege(role.oid, relation.oid, 'SELECT')
          OR has_table_privilege(role.oid, relation.oid, 'INSERT')
          OR has_table_privilege(role.oid, relation.oid, 'UPDATE')
          OR has_table_privilege(role.oid, relation.oid, 'DELETE')
          OR has_table_privilege(role.oid, relation.oid, 'TRUNCATE')
          OR has_table_privilege(role.oid, relation.oid, 'REFERENCES')
          OR has_table_privilege(role.oid, relation.oid, 'TRIGGER')
          OR has_any_column_privilege(role.oid, relation.oid, 'SELECT')
          OR has_any_column_privilege(role.oid, relation.oid, 'INSERT')
          OR has_any_column_privilege(role.oid, relation.oid, 'UPDATE')
          OR has_any_column_privilege(role.oid, relation.oid, 'REFERENCES')
        )
      UNION ALL
      SELECT 1
      FROM named_roles AS role
      CROSS JOIN pg_class AS relation
      JOIN target_namespaces AS namespace ON namespace.oid = relation.relnamespace
      WHERE relation.relkind = 'S'
        AND (
          has_sequence_privilege(role.oid, relation.oid, 'USAGE')
          OR has_sequence_privilege(role.oid, relation.oid, 'SELECT')
          OR has_sequence_privilege(role.oid, relation.oid, 'UPDATE')
        )
      UNION ALL
      SELECT 1
      FROM named_roles AS role
      CROSS JOIN pg_proc AS routine
      JOIN target_namespaces AS namespace ON namespace.oid = routine.pronamespace
      WHERE has_function_privilege(role.oid, routine.oid, 'EXECUTE')
    ), forbidden_default_acl AS (
      SELECT 1
      FROM pg_default_acl AS defaults
      LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
      CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS acl
      WHERE (defaults.defaclnamespace = 0 OR namespace.nspname IN ('pgmq', 'pgmq_public'))
        AND CASE WHEN acl.grantee = 0 THEN true ELSE EXISTS (
          SELECT 1 FROM named_roles AS role
          WHERE role.oid = acl.grantee
             OR pg_has_role(role.oid, acl.grantee, 'USAGE')
             OR pg_has_role(role.oid, acl.grantee, 'SET')
        ) END
    ), expected_columns(relation_name, column_name, type_oid) AS (
      VALUES
        ('a_platform_dead_letter_v1', 'msg_id', 'int8'::regtype),
        ('a_platform_dead_letter_v1', 'read_ct', 'int4'::regtype),
        ('a_platform_dead_letter_v1', 'enqueued_at', 'timestamptz'::regtype),
        ('a_platform_dead_letter_v1', 'archived_at', 'timestamptz'::regtype),
        ('a_platform_dead_letter_v1', 'vt', 'timestamptz'::regtype),
        ('a_platform_dead_letter_v1', 'message', 'jsonb'::regtype),
        ('a_platform_dead_letter_v1', 'headers', 'jsonb'::regtype),
        ('a_platform_work_v1', 'msg_id', 'int8'::regtype),
        ('a_platform_work_v1', 'read_ct', 'int4'::regtype),
        ('a_platform_work_v1', 'enqueued_at', 'timestamptz'::regtype),
        ('a_platform_work_v1', 'archived_at', 'timestamptz'::regtype),
        ('a_platform_work_v1', 'vt', 'timestamptz'::regtype),
        ('a_platform_work_v1', 'message', 'jsonb'::regtype),
        ('a_platform_work_v1', 'headers', 'jsonb'::regtype),
        ('q_platform_dead_letter_v1', 'msg_id', 'int8'::regtype),
        ('q_platform_dead_letter_v1', 'read_ct', 'int4'::regtype),
        ('q_platform_dead_letter_v1', 'enqueued_at', 'timestamptz'::regtype),
        ('q_platform_dead_letter_v1', 'vt', 'timestamptz'::regtype),
        ('q_platform_dead_letter_v1', 'message', 'jsonb'::regtype),
        ('q_platform_dead_letter_v1', 'headers', 'jsonb'::regtype),
        ('q_platform_work_v1', 'msg_id', 'int8'::regtype),
        ('q_platform_work_v1', 'read_ct', 'int4'::regtype),
        ('q_platform_work_v1', 'enqueued_at', 'timestamptz'::regtype),
        ('q_platform_work_v1', 'vt', 'timestamptz'::regtype),
        ('q_platform_work_v1', 'message', 'jsonb'::regtype),
        ('q_platform_work_v1', 'headers', 'jsonb'::regtype)
    )
    SELECT json_build_object(
      'queueMetadata', (
        SELECT coalesce(json_agg(json_build_object(
          'queueName', queue_name,
          'isPartitioned', is_partitioned,
          'isUnlogged', is_unlogged
        ) ORDER BY queue_name), '[]'::json)
        FROM pgmq.meta
        WHERE queue_name IN ('platform_dead_letter_v1', 'platform_work_v1')
      ),
      'queueMetadataTotalCount', (SELECT count(*)::integer FROM pgmq.meta),
      'queueRelationCount', (
        SELECT count(*)::integer
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'pgmq'
          AND relation.relkind IN ('r', 'p')
          AND relation.relname ~ '^[aq]_'
      ),
      'requiredRelationCount', (
        SELECT count(*)::integer
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'pgmq'
          AND relation.relkind IN ('r', 'p')
          AND relation.relname IN (
            'a_platform_dead_letter_v1', 'a_platform_work_v1',
            'q_platform_dead_letter_v1', 'q_platform_work_v1'
          )
      ),
      'loggedRelationCount', (
        SELECT count(*)::integer
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'pgmq'
          AND relation.relkind = 'r'
          AND relation.relpersistence = 'p'
          AND relation.relname IN (
            'a_platform_dead_letter_v1', 'a_platform_work_v1',
            'q_platform_dead_letter_v1', 'q_platform_work_v1'
          )
      ),
      'identitySequenceCount', (
        SELECT count(*)::integer
        FROM pg_attribute AS attribute
        JOIN pg_class AS relation ON relation.oid = attribute.attrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'pgmq'
          AND relation.relname IN ('q_platform_dead_letter_v1', 'q_platform_work_v1')
          AND attribute.attname = 'msg_id'
          AND attribute.attidentity IN ('a', 'd')
          AND pg_get_serial_sequence(format('%I.%I', namespace.nspname, relation.relname), attribute.attname) IS NOT NULL
      ),
      'copyCompatibleColumnCount', (
        SELECT count(*)::integer
        FROM expected_columns AS expected
        JOIN pg_class AS relation ON relation.relname = expected.relation_name
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace AND namespace.nspname = 'pgmq'
        JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
          AND attribute.attname = expected.column_name
          AND attribute.atttypid = expected.type_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ),
      'requiredSignatureCount', (
        SELECT count(*)::integer
        FROM unnest(ARRAY[
          'pgmq.create(text)',
          'pgmq.read(text,integer,integer,jsonb)',
          'pgmq.send(text,jsonb,integer)',
          'pgmq.set_vt(text,bigint,integer)',
          'pgmq.archive(text,bigint)'
        ]) AS signature(name)
        WHERE to_regprocedure(signature.name) IS NOT NULL
      ),
      'missingRoleCount', (
        SELECT (count(*) - (SELECT count(*) FROM named_roles))::integer
        FROM forbidden_role_names
      ),
      'directForbiddenGrantCount', (SELECT count(*)::integer FROM forbidden_direct_acl),
      'forbiddenOwnerReachabilityCount', (SELECT count(*)::integer FROM forbidden_owner_reachability),
      'effectiveForbiddenPrivilegeCount', (SELECT count(*)::integer FROM forbidden_effective_privilege),
      'additiveDefaultGrantCount', (SELECT count(*)::integer FROM forbidden_default_acl)
    )::text`, stage);
  const zeroCounts = Object.freeze(Object.fromEntries(RECOVERY_PGMQ_RELATIONS.map((relation) => [relation, 0])));
  const restoredRelationCounts = await restoredTableCounts(zeroCounts, supervisor, toolchain, status, stage);
  return validatePgmqContainmentProof(
    { ...structure, restoredRelationCounts },
    inventory,
    { stage, phase, requireCountsMatch: options.requireCountsMatch },
  );
}

async function restorePgmqExtensionRelations(dataPath, status, supervisor, toolchain) {
  const dump = await dataDumpTableInventory(dataPath);
  const inventory = validatePgmqRestoreInventory(dump.counts, dump.columns);
  await psql(supervisor, toolchain, status, ["--command", String.raw`
    BEGIN;
    DO $$
    DECLARE
      required_signature TEXT;
    BEGIN
      FOREACH required_signature IN ARRAY ARRAY[
        'pgmq.create(text)',
        'pgmq.read(text,integer,integer,jsonb)',
        'pgmq.send(text,jsonb,integer)',
        'pgmq.set_vt(text,bigint,integer)',
        'pgmq.archive(text,bigint)'
      ]
      LOOP
        IF to_regprocedure(required_signature) IS NULL THEN
          RAISE EXCEPTION 'Required PGMQ signature is unavailable'
            USING ERRCODE = '0A000';
        END IF;
      END LOOP;
    END
    $$;
    SELECT pgmq.create('platform_work_v1');
    SELECT pgmq.create('platform_dead_letter_v1');
    REVOKE ALL ON SCHEMA pgmq
      FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
    REVOKE ALL ON ALL TABLES IN SCHEMA pgmq
      FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq
      FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgmq
      FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pgmq
      REVOKE ALL PRIVILEGES ON TABLES
      FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pgmq
      REVOKE ALL PRIVILEGES ON SEQUENCES
      FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pgmq
      REVOKE ALL PRIVILEGES ON FUNCTIONS
      FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
    DO $$
    BEGIN
      IF to_regnamespace('pgmq_public') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON SCHEMA pgmq_public FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin';
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA pgmq_public FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq_public FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin';
        EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pgmq_public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pgmq_public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pgmq_public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin';
      END IF;
    END
    $$;
    COMMIT;`], {
    stage: "database_restore",
    code: "pgmq_extension_relation_restore_failed",
  });
  const preData = await inspectPgmqExtensionRelations(
    inventory,
    "pre_data",
    status,
    supervisor,
    toolchain,
    { requireCountsMatch: false },
  );
  return Object.freeze({ inventory, preData });
}

async function restoreDatabase(artifacts, status, supervisor, toolchain) {
  const order = ["roles.sql", "schema.sql"];
  for (const name of order) await psql(supervisor, toolchain, status, ["--file", artifacts.plaintext[name]], { stage: "database_restore", code: `${name.replaceAll(/[^a-z]/gu, "_")}_restore_failed` });
  await psql(supervisor, toolchain, status, ["--command", "DROP SCHEMA IF EXISTS supabase_migrations CASCADE"], { stage: "database_restore", code: "history_target_reset_failed" });
  for (const name of ["history-schema.sql", "history-data.sql"]) {
    await psql(supervisor, toolchain, status, ["--file", artifacts.plaintext[name]], { stage: "database_restore", code: `${name.replaceAll(/[^a-z]/gu, "_")}_restore_failed` });
  }
  const extensionBootstrap = await restorePgmqExtensionRelations(
    artifacts.plaintext["data.sql"],
    status,
    supervisor,
    toolchain,
  );
  await psql(supervisor, toolchain, status, ["--file", artifacts.plaintext["data.sql"]], {
    stage: "database_restore",
    code: "data_sql_restore_failed",
  });
  const postData = await inspectPgmqExtensionRelations(
    extensionBootstrap.inventory,
    "post_data",
    status,
    supervisor,
    toolchain,
  );
  return Object.freeze({
    ...postData,
    preDataChecked: extensionBootstrap.preData.phase === "pre_data",
  });
}

export function databaseAggregatesFromTableCounts(counts, code = "restored_database_aggregate_invalid") {
  if (!isRecord(counts)) fail(code, "database_restore");
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, "en"));
  for (const [table, count] of entries) {
    const parts = table.split(".");
    if (parts.length !== 2 || parts.some((part) => !/^[a-z_][a-z0-9_]*$/u.test(part))) fail(code, "database_restore");
    integer(count, code, "database_restore");
  }
  return Object.freeze({
    table_count: entries.length,
    row_count: entries.reduce((total, [, count]) => total + count, 0),
    auth_user_count: counts["auth.users"] ?? 0,
    table_counts_sha256: sha256(signedExportCanonicalJson(Object.fromEntries(entries))),
  });
}

export function validateRestoredDatabaseAggregates(expected, actual, options = {}) {
  const comparison = options.comparison ?? "unspecified";
  if (!new Set(["unspecified", "signed_dump", "restored_database"]).has(comparison)) {
    fail("restored_database_aggregate_invalid", "database_restore");
  }
  const fields = ["table_count", "row_count", "auth_user_count", "table_counts_sha256"];
  exactKeys(actual, fields, "restored_database_aggregate_invalid", "database_restore");
  for (const field of fields.slice(0, 3)) {
    integer(expected?.[field], "signed_database_aggregate_invalid", "database_restore");
    integer(actual[field], "restored_database_aggregate_invalid", "database_restore");
  }
  string(expected?.table_counts_sha256, SHA256, "signed_database_aggregate_invalid", "database_restore", 64);
  string(actual.table_counts_sha256, SHA256, "restored_database_aggregate_invalid", "database_restore", 64);
  const mismatches = fields.filter((field) => actual[field] !== expected[field]);
  if (mismatches.length > 0) {
    const firstField = mismatches[0];
    fail("restored_database_aggregate_mismatch", "database_restore", Object.freeze({
      comparison,
      mismatchCount: mismatches.length,
      mismatchSetSha256: sha256(canonicalJson(mismatches)),
      firstField,
      expectedValue: expected[firstField],
      actualValue: actual[firstField],
    }));
  }
  return Object.freeze({
    tableCount: actual.table_count,
    rowCount: actual.row_count,
    authUserCount: actual.auth_user_count,
    tableCountsSha256: actual.table_counts_sha256,
  });
}

export function validateRestoredTableCounts(expected, actual) {
  if (!isRecord(expected) || !isRecord(actual)) {
    fail("restored_database_table_inventory_mismatch", "database_restore");
  }
  const tables = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .sort((left, right) => left.localeCompare(right, "en"));
  for (const table of tables) {
    quotedQualifiedTable(table);
    if (Object.hasOwn(expected, table)) integer(expected[table], "database_dump_aggregate_invalid", "database_restore");
    if (Object.hasOwn(actual, table)) integer(actual[table], "restored_database_aggregate_invalid", "database_restore");
  }
  const mismatches = tables.filter((table) => expected[table] !== actual[table]);
  if (mismatches.length > 0) {
    const firstTable = mismatches[0];
    fail("restored_database_table_count_mismatch", "database_restore", Object.freeze({
      mismatchCount: mismatches.length,
      mismatchSetSha256: sha256(canonicalJson(mismatches)),
      firstTable,
      expectedCount: Object.hasOwn(expected, firstTable) ? expected[firstTable] : null,
      actualCount: Object.hasOwn(actual, firstTable) ? actual[firstTable] : null,
    }));
  }
  return Object.freeze(actual);
}

async function dataDumpTableInventory(path) {
  const counts = {};
  const columns = {};
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let current;
  try {
    for await (const line of lines) {
      if (current) {
        if (line === "\\.") {
          counts[current.table] = current.rows;
          current = undefined;
        } else {
          current.rows += 1;
        }
        continue;
      }
      if (!line.startsWith("COPY ")) continue;
      const header = copyHeader(line);
      if (!header || Object.hasOwn(counts, header.table)) fail("database_data_copy_invalid", "database_restore");
      columns[header.table] = header.columns;
      current = { table: header.table, rows: 0 };
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (current) fail("database_data_copy_invalid", "database_restore");
  return Object.freeze({
    counts: Object.freeze(Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, "en")))),
    columns: Object.freeze(Object.fromEntries(Object.entries(columns).sort(([left], [right]) => left.localeCompare(right, "en")))),
  });
}

async function dataDumpTableCounts(path) {
  return (await dataDumpTableInventory(path)).counts;
}

function quotedQualifiedTable(table) {
  const parts = table.split(".");
  if (parts.length !== 2 || parts.some((part) => !/^[a-z_][a-z0-9_]*$/u.test(part))) {
    fail("database_table_identity_invalid", "database_restore");
  }
  return parts.map((part) => `"${part}"`).join(".");
}

async function restoredTableCounts(expectedCounts, supervisor, toolchain, status, stage = "database_restore") {
  const tables = Object.keys(expectedCounts);
  if (tables.length === 0) return Object.freeze({});
  const values = tables.map((table) => `(${sqlLiteral(table)}, (SELECT count(*)::bigint FROM ${quotedQualifiedTable(table)}))`).join(",\n");
  const actual = await psqlJson(supervisor, toolchain, status, String.raw`
    SELECT coalesce(jsonb_object_agg(table_name, row_count ORDER BY table_name), '{}'::jsonb)::text
    FROM (VALUES ${values}) AS restored_counts(table_name, row_count)`, stage, 16 * 1_024 * 1_024);
  if (!isRecord(actual) || Object.keys(actual).length !== tables.length || tables.some((table) => !Object.hasOwn(actual, table))) {
    fail("restored_database_table_inventory_mismatch", "database_restore");
  }
  return Object.freeze(actual);
}

async function reconcileRestoredDatabase(artifacts, status, supervisor, toolchain) {
  const signed = Object.freeze({
    table_count: artifacts.database.aggregates.table_count,
    row_count: artifacts.database.aggregates.row_count,
    auth_user_count: artifacts.database.aggregates.auth_user_count,
    table_counts_sha256: artifacts.database.aggregates.table_counts_sha256,
  });
  const dumpCounts = await dataDumpTableCounts(artifacts.plaintext["data.sql"]);
  validateRestoredDatabaseAggregates(
    signed,
    databaseAggregatesFromTableCounts(dumpCounts, "database_dump_aggregate_invalid"),
    { comparison: "signed_dump" },
  );
  const actualCounts = await restoredTableCounts(dumpCounts, supervisor, toolchain, status);
  validateRestoredTableCounts(dumpCounts, actualCounts);
  return validateRestoredDatabaseAggregates(
    signed,
    databaseAggregatesFromTableCounts(actualCounts),
    { comparison: "restored_database" },
  );
}

async function databaseLedger(supervisor, toolchain, status) {
  const rows = await psqlJson(
    supervisor,
    toolchain,
    status,
    "SELECT coalesce(json_agg(json_build_object('version', version, 'name', name, 'statements', statements) ORDER BY version), '[]'::json)::text FROM supabase_migrations.schema_migrations",
    "migration_rehearsal",
    64 * 1_024 * 1_024,
  );
  if (!Array.isArray(rows) || rows.some((row) =>
    !isRecord(row) ||
    !MIGRATION_VERSION.test(row.version) ||
    !MIGRATION_NAME.test(row.name) ||
    !Array.isArray(row.statements) ||
    (row.statements.length === 0 && (
      RECORDED_ROOT_HISTORY_EXCEPTIONS[row.version]?.name !== row.name ||
      RECORDED_ROOT_HISTORY_EXCEPTIONS[row.version]?.signedStatementCount !== 0
    )) ||
    row.statements.some((statement) => typeof statement !== "string"))) {
    fail("restored_migration_ledger_invalid", "migration_rehearsal");
  }
  return rows.map((row) => Object.freeze({
    version: row.version,
    name: row.name,
    statementCount: row.statements.length,
    statementsSha256: sha256(canonicalJson(row.statements)),
  }));
}

async function applyPendingMigrations(state, local, root, verified, extensionInventory, supervisor, toolchain) {
  const restored = await databaseLedger(supervisor, toolchain, local.status);
  if (
    restored.length !== verified.recordedSource.length ||
    restored.some((row, index) =>
      row.version !== verified.recordedSource[index].version ||
      row.name !== verified.recordedSource[index].name ||
      row.statementCount !== verified.recordedSource[index].statementCount ||
      row.statementsSha256 !== verified.recordedSource[index].statementsSha256)
  ) {
    fail("restored_migration_ledger_mismatch", "migration_rehearsal");
  }
  const migrationsTarget = join(state.supabaseRoot, "supabase", "migrations");
  cpSync(root.snapshotRoot, migrationsTarget, { recursive: true, force: false, errorOnExist: true });
  enableMigrations(local.configPath);
  if (verified.pending.length > 0) {
    await supervisor.run(toolchain.paths.supabaseNative.real, ["migration", "up", "--local", "--workdir", state.supabaseRoot], {
      stage: "migration_rehearsal",
      code: "pending_migration_apply_failed",
      timeoutMs: 30 * 60 * 1_000,
      maxCaptureBytes: 8 * 1_024 * 1_024,
      env: pinnedSupabaseEnvironment(toolchain.paths),
    });
  }
  const final = await databaseLedger(supervisor, toolchain, local.status);
  const expectedFinal = [...verified.recordedSource, ...verified.pending];
  if (
    expectedFinal.length !== root.entries.length ||
    final.length !== expectedFinal.length ||
    final.some((row, index) =>
      row.version !== expectedFinal[index].version ||
      row.name !== expectedFinal[index].name ||
      row.statementCount !== expectedFinal[index].statementCount ||
      row.statementsSha256 !== expectedFinal[index].statementsSha256)
  ) {
    fail("final_migration_ledger_mismatch", "migration_rehearsal");
  }
  const extensionRelations = await inspectPgmqExtensionRelations(
    extensionInventory,
    "post_migration",
    local.status,
    supervisor,
    toolchain,
    { stage: "migration_rehearsal" },
  );
  return Object.freeze({
    sourceCount: verified.source.length,
    pendingApplied: verified.pending.length,
    finalCount: final.length,
    orderedSourceLedgerSha256: verified.orderedLedgerSha256,
    extensionRelations,
  });
}

function safeTarMember(name) {
  if (typeof name !== "string" || name.length === 0 || name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === "..")) {
    fail("storage_archive_member_unsafe", "storage_restore");
  }
  return name.replace(/\/$/u, "");
}

async function extractStorage(artifacts, state, supervisor, toolchain) {
  const archive = artifacts.plaintext["storage-objects.tar"];
  const listing = await supervisor.run(toolchain.paths.tar.real, ["-tf", archive], { stage: "storage_restore", code: "storage_archive_list_failed", timeoutMs: 5 * 60 * 1_000, maxCaptureBytes: 64 * 1_024 * 1_024 });
  const members = listing.stdout.toString("utf8").split(/\r?\n/u).filter(Boolean).map(safeTarMember);
  const expected = new Set(["storage-blobs", "storage-manifest.json", ...artifacts.storage.objects.map((object) => `storage-blobs/${object.blob}`)]);
  if (new Set(members).size !== members.length || members.some((member) => !expected.has(member)) || [...expected].some((member) => !members.includes(member))) {
    fail("storage_archive_inventory_mismatch", "storage_restore");
  }
  const target = join(state.harnessRoot, "storage-extracted");
  mkdirSync(target, { mode: 0o700 });
  await supervisor.run(toolchain.paths.tar.real, ["-xf", archive, "-C", target, "--no-same-owner", "--no-same-permissions"], { stage: "storage_restore", code: "storage_archive_extract_failed", timeoutMs: 30 * 60 * 1_000 });
  if ((await sha256File(join(target, "storage-manifest.json"))) !== (await sha256File(artifacts.plaintext["storage-manifest.json"]))) {
    fail("storage_archive_embedded_manifest_mismatch", "storage_restore");
  }
  for (const object of artifacts.storage.objects) {
    const path = join(target, "storage-blobs", object.blob);
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== object.bytes || (await sha256File(path)) !== object.sha256) {
      fail("storage_blob_integrity_failed", "storage_restore");
    }
  }
  return target;
}

function storageInventoryKey(value) {
  return `${value.bucket_id}\0${value.path}`;
}

function normalizedStorageIdentity(value) {
  if (
    !isRecord(value) ||
    !UUID.test(value.source_id) ||
    (value.source_version !== null && !UUID.test(value.source_version)) ||
    typeof value.bucket_id !== "string" ||
    typeof value.path !== "string"
  ) {
    fail("restored_storage_inventory_invalid", "storage_verification");
  }
  if (value.bucket_id.includes("/") || value.bucket_id.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value.bucket_id) || [".", ".."].includes(value.bucket_id)) {
    fail("restored_storage_inventory_invalid", "storage_verification");
  }
  safeObjectPath(value.path, "restored_storage_inventory_invalid");
  return Object.freeze({
    source_id: value.source_id,
    source_version: value.source_version,
    bucket_id: value.bucket_id,
    path: value.path,
  });
}

function verifyRestoredStorageIdentities(sourceObjects, restoredRows) {
  if (!Array.isArray(sourceObjects) || !Array.isArray(restoredRows)) {
    fail("restored_storage_inventory_invalid", "storage_verification");
  }
  const expected = sourceObjects.map(normalizedStorageIdentity).sort((left, right) => storageInventoryKey(left).localeCompare(storageInventoryKey(right), "en"));
  const actual = restoredRows.map(normalizedStorageIdentity).sort((left, right) => storageInventoryKey(left).localeCompare(storageInventoryKey(right), "en"));
  if (
    new Set(expected.map(storageInventoryKey)).size !== expected.length ||
    new Set(actual.map(storageInventoryKey)).size !== actual.length ||
    !sameJson(actual, expected)
  ) {
    fail("restored_storage_identity_mismatch", "storage_verification");
  }
  return Object.freeze(actual);
}

export function verifyRestoredStorageInventory(sourceObjects, restoredRows, readbacks) {
  const identities = verifyRestoredStorageIdentities(sourceObjects, restoredRows);
  if (!Array.isArray(readbacks)) fail("restored_storage_readback_invalid", "storage_verification");
  const readbackByKey = new Map();
  for (const value of readbacks) {
    if (
      !isRecord(value) ||
      typeof value.bucket_id !== "string" ||
      typeof value.path !== "string" ||
      !SHA256.test(value.sha256) ||
      !Number.isSafeInteger(value.bytes) ||
      value.bytes < 0
    ) {
      fail("restored_storage_readback_invalid", "storage_verification");
    }
    safeObjectPath(value.path, "restored_storage_readback_invalid");
    const key = storageInventoryKey(value);
    if (readbackByKey.has(key)) fail("restored_storage_readback_duplicate", "storage_verification");
    readbackByKey.set(key, value);
  }
  const actual = identities.map((identity) => {
    const readback = readbackByKey.get(storageInventoryKey(identity));
    if (!readback) fail("restored_storage_readback_missing", "storage_verification");
    return Object.freeze({ ...identity, sha256: readback.sha256, bytes: readback.bytes });
  });
  if (readbackByKey.size !== actual.length) fail("restored_storage_readback_extra", "storage_verification");
  const expected = sourceObjects.map((object) => Object.freeze({
    ...normalizedStorageIdentity(object),
    sha256: string(object.sha256, SHA256, "restored_storage_inventory_invalid", "storage_verification"),
    bytes: integer(object.bytes, "restored_storage_inventory_invalid", "storage_verification"),
  })).sort((left, right) => storageInventoryKey(left).localeCompare(storageInventoryKey(right), "en"));
  const sortedActual = actual.sort((left, right) => storageInventoryKey(left).localeCompare(storageInventoryKey(right), "en"));
  if (!sameJson(sortedActual, expected)) fail("restored_storage_content_mismatch", "storage_verification");
  return Object.freeze({
    objectCount: sortedActual.length,
    totalBytes: sortedActual.reduce((sum, object) => sum + object.bytes, 0),
    restoredInventorySha256: sha256(canonicalJson(sortedActual)),
  });
}

export function storageSourceRecoveryReadiness(verified) {
  if (!isRecord(verified) || !Number.isSafeInteger(verified.objectCount) || verified.objectCount < 0) {
    fail("storage_source_recovery_invalid", "storage_verification");
  }
  return Object.freeze(verified.objectCount === 0
    ? { status: "not_ready", blocker: "storage_source_object_missing", recoveredObjectCount: 0 }
    : { status: "ready", blocker: null, recoveredObjectCount: verified.objectCount });
}

export async function apiRequest(
  url,
  init,
  accepted,
  code,
  stage,
  interruptionGuard,
  { fetchImpl = globalThis.fetch, allowAfterInterrupt = false, timeoutMs = 30_000 } = {},
) {
  if (!(interruptionGuard instanceof RecoveryInterruptionGuard) || typeof fetchImpl !== "function") {
    fail("interruption_guard_invalid", stage);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30 * 60 * 1_000) fail("http_timeout_invalid", stage);
  let response;
  try {
    response = await interruptionGuard.run(stage, async (signal) => await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(allowAfterInterrupt ? [] : [signal]),
      ]),
    }), { allowAfterInterrupt });
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    fail(code, stage, { category: "network_failure" });
  }
  if (!accepted.includes(response.status)) {
    let body = "";
    try {
      body = await interruptionGuard.run(stage, async () => await response.text(), { allowAfterInterrupt });
    } catch (error) {
      if (error instanceof RecoveryFailure) throw error;
    }
    fail(code, stage, { status: response.status, bodySha256: sha256(body), bytes: Buffer.byteLength(body) });
  }
  return response;
}

export async function uploadStorageObjectFromFile(
  path,
  { url, headers, expectedBytes },
  interruptionGuard,
  { fetchImpl = globalThis.fetch } = {},
) {
  interruptionGuard.assertActive("storage_restore");
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    fail("storage_blob_missing", "storage_restore");
  }
  if (
    !isAbsolute(path) ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== expectedBytes ||
    metadata.size > MAX_ARCHIVE_BYTES
  ) {
    fail("storage_blob_invalid", "storage_restore");
  }
  const body = createReadStream(path, { highWaterMark: 64 * 1_024 });
  const bodyFinished = finished(body, { cleanup: true }).catch(() => undefined);
  const abortStream = () => body.destroy();
  interruptionGuard.signal.addEventListener("abort", abortStream, { once: true });
  try {
    return await apiRequest(url, {
      method: "POST",
      headers,
      body,
      duplex: "half",
    }, [200], "storage_object_restore_failed", "storage_restore", interruptionGuard, {
      fetchImpl,
      timeoutMs: 30 * 60 * 1_000,
    });
  } finally {
    interruptionGuard.signal.removeEventListener("abort", abortStream);
    body.destroy();
    await bodyFinished;
  }
}

function objectUrl(apiUrl, bucket, path, prefix = "object") {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return new URL(`/storage/v1/${prefix}/${encodeURIComponent(bucket)}/${encoded}`, apiUrl).toString();
}

export function resolveStorageSignedObjectUrl(apiUrl, bucket, path, signedPath) {
  string(signedPath, null, "private_document_signed_url_invalid", "document_proof", 16_384);
  let base;
  let candidate;
  let expectedPath;
  try {
    base = new URL(apiUrl);
    expectedPath = new URL(objectUrl(apiUrl, bucket, path, "object/sign")).pathname;
    candidate = signedPath.startsWith("/object/sign/")
      ? new URL(`/storage/v1${signedPath}`, base)
      : new URL(signedPath, base);
  } catch {
    fail("private_document_signed_url_invalid", "document_proof");
  }
  const queryKeys = [...candidate.searchParams.keys()];
  if (
    candidate.origin !== base.origin ||
    candidate.username !== "" ||
    candidate.password !== "" ||
    candidate.hash !== "" ||
    candidate.pathname !== expectedPath ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== "token" ||
    !candidate.searchParams.get("token")
  ) {
    fail("private_document_signed_url_invalid", "document_proof");
  }
  return candidate;
}

async function databaseStorageIdentities(supervisor, toolchain, status) {
  return await psqlJson(supervisor, toolchain, status, String.raw`
    SELECT coalesce(json_agg(json_build_object(
      'source_id', object.id::text,
      'source_version', object.version::text,
      'bucket_id', object.bucket_id,
      'path', object.name,
      'mime_type', object.metadata->>'mimetype',
      'cache_control', object.metadata->>'cacheControl'
    ) ORDER BY object.bucket_id, object.name), '[]'::json)::text
    FROM storage.objects AS object`, "storage_verification", 32 * 1_024 * 1_024);
}

function parseContainerEnvironment(entries) {
  if (!Array.isArray(entries)) fail("storage_container_environment_invalid", "storage_restore");
  const result = new Map();
  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.includes("=")) fail("storage_container_environment_invalid", "storage_restore");
    const split = entry.indexOf("=");
    const key = entry.slice(0, split);
    if (result.has(key)) fail("storage_container_environment_invalid", "storage_restore");
    result.set(key, entry.slice(split + 1));
  }
  return result;
}

async function localStorageBackend(state, supervisor, toolchain) {
  const containerName = `supabase_storage_${state.projectName}`;
  const result = await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "inspect", containerName], {
    stage: "storage_restore",
    code: "storage_container_inspection_failed",
    timeoutMs: 30_000,
    maxCaptureBytes: 4 * 1_024 * 1_024,
  });
  let containers;
  try {
    containers = JSON.parse(result.stdout.toString("utf8"));
  } catch {
    fail("storage_container_inspection_invalid", "storage_restore");
  }
  if (!Array.isArray(containers) || containers.length !== 1) fail("storage_container_inspection_invalid", "storage_restore");
  const container = containers[0];
  if (!isRecord(container) || container.Name !== `/${containerName}` || container.State?.Running !== true) {
    fail("storage_container_identity_invalid", "storage_restore");
  }
  const environment = parseContainerEnvironment(container.Config?.Env);
  const destination = environment.get("FILE_STORAGE_BACKEND_PATH") ?? environment.get("STORAGE_FILE_BACKEND_PATH");
  const tenantId = environment.get("TENANT_ID");
  const internalBucket = environment.get("GLOBAL_S3_BUCKET") ?? environment.get("STORAGE_S3_BUCKET");
  if (environment.get("STORAGE_BACKEND") !== "file" || !["/var/lib/storage", "/mnt"].includes(destination) || tenantId !== "stub" || internalBucket !== "stub") {
    fail("storage_container_backend_invalid", "storage_restore");
  }
  const mounts = Array.isArray(container.Mounts) ? container.Mounts.filter((mount) => mount?.Destination === destination) : [];
  if (mounts.length !== 1 || typeof mounts[0].Source !== "string" || !isAbsolute(mounts[0].Source)) {
    fail("storage_container_mount_invalid", "storage_restore");
  }
  const mountRoot = realpathSync(mounts[0].Source);
  const relativeMount = relative(realpathSync(state.harnessRoot), mountRoot);
  if (!relativeMount || relativeMount.startsWith("..") || isAbsolute(relativeMount)) fail("storage_container_mount_outside_harness", "storage_restore");
  return Object.freeze({ mountRoot, tenantId, internalBucket });
}

function uploadedBlobCandidates(backend, object, generatedVersion) {
  const base = join(backend.mountRoot, backend.internalBucket, backend.tenantId, object.bucket_id, ...object.path.split("/"));
  return Object.freeze([
    Object.freeze({ style: "directory", base, path: join(base, generatedVersion) }),
    Object.freeze({ style: "suffix", base, path: `${base}-$v-${generatedVersion}` }),
  ]);
}

async function relocateUploadedBlob(backend, object, generatedVersion) {
  if (!UUID.test(generatedVersion)) fail("storage_generated_version_invalid", "storage_restore");
  const candidates = uploadedBlobCandidates(backend, object, generatedVersion).filter((candidate) => existsSync(candidate.path));
  if (candidates.length !== 1) fail("storage_uploaded_blob_location_invalid", "storage_restore");
  const current = candidates[0];
  const metadata = lstatSync(current.path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== object.bytes || (await sha256File(current.path)) !== object.sha256) {
    fail("storage_uploaded_blob_integrity_failed", "storage_restore");
  }
  let target;
  if (current.style === "suffix") target = object.source_version === null ? current.base : `${current.base}-$v-${object.source_version}`;
  else target = object.source_version === null ? current.base : join(current.base, object.source_version);
  if (target === current.path) return;
  if (existsSync(target) && !(current.style === "directory" && object.source_version === null && target === current.base)) {
    fail("storage_source_version_target_exists", "storage_restore");
  }
  if (current.style === "directory" && object.source_version === null) {
    const siblings = readdirSync(current.base);
    if (siblings.length !== 1 || siblings[0] !== generatedVersion) fail("storage_unversioned_target_unsafe", "storage_restore");
    const temporary = join(dirname(current.base), `.evo-recovery-${randomUUID()}`);
    renameSync(current.path, temporary);
    rmSync(current.base);
    renameSync(temporary, target);
  } else {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    renameSync(current.path, target);
  }
  const restored = lstatSync(target);
  if (!restored.isFile() || restored.isSymbolicLink() || restored.size !== object.bytes || (await sha256File(target)) !== object.sha256) {
    fail("storage_source_version_blob_invalid", "storage_restore");
  }
}

async function readBackStorageObject(status, object, interruptionGuard) {
  const response = await apiRequest(objectUrl(status.apiUrl, object.bucket_id, object.path, "object/authenticated"), {
    headers: { apikey: status.serviceRoleKey, Authorization: `Bearer ${status.serviceRoleKey}` },
  }, [200], "storage_object_readback_failed", "storage_verification", interruptionGuard);
  if (!response.body) fail("storage_object_readback_body_missing", "storage_verification");
  const digest = createHash("sha256");
  let bytes = 0;
  await interruptionGuard.run("storage_verification", async () => {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > object.bytes) fail("storage_object_readback_size_mismatch", "storage_verification");
      digest.update(buffer);
    }
  });
  return Object.freeze({ bucket_id: object.bucket_id, path: object.path, bytes, sha256: digest.digest("hex") });
}

async function restoreStorage(artifacts, extracted, status, state, supervisor, toolchain, interruptionGuard) {
  const originalRows = await databaseStorageIdentities(supervisor, toolchain, status);
  verifyRestoredStorageIdentities(artifacts.storage.objects, originalRows);
  if (artifacts.storage.objects.length === 0) {
    const verified = verifyRestoredStorageInventory([], originalRows, []);
    return Object.freeze({
      bucketCount: artifacts.storage.aggregates.bucket_count,
      ...verified,
      readiness: storageSourceRecoveryReadiness(verified),
    });
  }
  const backend = await localStorageBackend(state, supervisor, toolchain);
  const uploadMetadata = new Map(originalRows.map((row) => {
    const mimeType = row.mime_type ?? "application/octet-stream";
    const cacheControl = row.cache_control ?? "no-cache";
    if (
      typeof mimeType !== "string" ||
      typeof cacheControl !== "string" ||
      mimeType.length === 0 ||
      mimeType.length > 256 ||
      cacheControl.length === 0 ||
      cacheControl.length > 256 ||
      /[\r\n]/u.test(mimeType) ||
      /[\r\n]/u.test(cacheControl)
    ) {
      fail("storage_upload_metadata_invalid", "storage_restore");
    }
    return [storageInventoryKey(row), Object.freeze({ mimeType, cacheControl })];
  }));
  await psql(supervisor, toolchain, status, ["--command", String.raw`
    BEGIN;
    CREATE SCHEMA evo_recovery_storage_metadata;
    CREATE TABLE evo_recovery_storage_metadata.objects AS TABLE storage.objects;
    UPDATE storage.objects SET version = gen_random_uuid()::text;
    COMMIT;`], {
    stage: "storage_restore",
    code: "storage_metadata_snapshot_failed",
  });
  for (const object of artifacts.storage.objects) {
    const metadata = uploadMetadata.get(storageInventoryKey(object));
    if (!metadata) fail("storage_upload_metadata_missing", "storage_restore");
    const response = await uploadStorageObjectFromFile(
      join(extracted, "storage-blobs", object.blob),
      {
        url: objectUrl(status.apiUrl, object.bucket_id, object.path),
        expectedBytes: object.bytes,
        headers: {
        apikey: status.serviceRoleKey,
        Authorization: `Bearer ${status.serviceRoleKey}`,
        "content-type": metadata.mimeType,
        "cache-control": metadata.cacheControl,
        "x-upsert": "true",
        },
      },
      interruptionGuard,
    );
    await interruptionGuard.run("storage_restore", async () => await response.arrayBuffer());
    const current = await psqlJson(supervisor, toolchain, status, String.raw`
      SELECT coalesce(json_agg(json_build_object(
        'source_id', candidate.id::text,
        'source_version', candidate.version::text,
        'bucket_id', candidate.bucket_id,
        'path', candidate.name
      )), '[]'::json)::text
      FROM storage.objects AS candidate
      WHERE candidate.bucket_id = ${sqlLiteral(object.bucket_id)}
        AND candidate.name = ${sqlLiteral(object.path)}`, "storage_restore");
    if (!Array.isArray(current) || current.length !== 1 || current[0].source_id !== object.source_id || !UUID.test(current[0].source_version)) {
      fail("storage_uploaded_object_identity_invalid", "storage_restore");
    }
    await interruptionGuard.run("storage_restore", async () => await relocateUploadedBlob(backend, object, current[0].source_version));
  }
  await psql(supervisor, toolchain, status, ["--command", String.raw`
    BEGIN;
    DELETE FROM storage.objects;
    INSERT INTO storage.objects SELECT * FROM evo_recovery_storage_metadata.objects;
    DROP SCHEMA evo_recovery_storage_metadata CASCADE;
    COMMIT;`], {
    stage: "storage_restore",
    code: "storage_metadata_restore_failed",
  });
  const restoredRows = await databaseStorageIdentities(supervisor, toolchain, status);
  const readbacks = [];
  for (const object of artifacts.storage.objects) readbacks.push(await readBackStorageObject(status, object, interruptionGuard));
  const verified = verifyRestoredStorageInventory(artifacts.storage.objects, restoredRows, readbacks);
  return Object.freeze({
    bucketCount: artifacts.storage.aggregates.bucket_count,
    ...verified,
    readiness: storageSourceRecoveryReadiness(verified),
  });
}

export function assessRepresentativeCohort(rows, expected) {
  if (!Array.isArray(rows)) fail("representative_cohort_invalid", "auth_rls_proof");
  const roleMap = Object.freeze({ admin: "admin", sales: "sales", curator: "admissions" });
  const selected = {};
  for (const row of rows) {
    if (
      !isRecord(row) ||
      !UUID.test(row.userId) ||
      !UUID.test(row.profileId) ||
      !UUID.test(row.membershipId) ||
      !UUID.test(row.organizationId) ||
      !Object.hasOwn(roleMap, row.databaseRole) ||
      typeof row.email !== "string" ||
      !row.email.includes("@")
    ) {
      fail("representative_cohort_invalid", "auth_rls_proof");
    }
    const appRole = roleMap[row.databaseRole];
    if (row.userId === expected[`${appRole}UserId`]) {
      if (selected[appRole]) fail("representative_cohort_duplicate", "auth_rls_proof");
      selected[appRole] = Object.freeze({ ...row, appRole });
    }
  }
  if (new Set(Object.values(selected).map((actor) => actor.organizationId)).size > 1) {
    fail("representative_cohort_organization_mismatch", "auth_rls_proof");
  }
  if (Object.values(selected).some((actor) => actor.organizationId !== expected.platformOrganizationId)) {
    fail("representative_cohort_expected_organization_mismatch", "auth_rls_proof");
  }
  const blockers = ["admin", "sales", "admissions"]
    .filter((role) => !selected[role])
    .map((role) => `${role}_representative_missing`);
  return Object.freeze({ actors: Object.freeze(selected), blockers: Object.freeze(blockers) });
}

export function validateRepresentativeCohort(rows, expected) {
  const assessed = assessRepresentativeCohort(rows, expected);
  if (assessed.blockers.length > 0) fail("authorized_representative_missing", "auth_rls_proof");
  return assessed.actors;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function suppliedRepresentativeUserIds(options) {
  const ids = [options?.adminUserId, options?.salesUserId, options?.admissionsUserId]
    .filter((value) => value !== undefined);
  if (
    ids.length < 1 ||
    ids.some((value) => typeof value !== "string" || !UUID.test(value)) ||
    new Set(ids).size !== ids.length
  ) {
    fail("representative_query_ids_invalid", "auth_rls_proof");
  }
  return Object.freeze(ids);
}

async function discoverActors(options, status, supervisor, toolchain) {
  const ids = suppliedRepresentativeUserIds(options).map(sqlLiteral).join(",");
  const rows = await psqlJson(supervisor, toolchain, status, String.raw`
    SELECT coalesce(json_agg(row_to_json(actor) ORDER BY actor."databaseRole"), '[]'::json)::text
    FROM (
      SELECT auth_user.id AS "userId", profile.id AS "profileId",
        membership.id AS "membershipId", membership.organization_id AS "organizationId",
        membership.current_role::text AS "databaseRole", auth_user.email AS email
      FROM auth.users AS auth_user
      JOIN platform.profiles AS profile ON profile.auth_user_id = auth_user.id
      JOIN platform.organization_memberships AS membership ON membership.profile_id = profile.id
      WHERE auth_user.id IN (${ids})
        AND profile.status = 'active' AND membership.status = 'active'
    ) AS actor`, "auth_rls_proof");
  return assessRepresentativeCohort(rows, options);
}

async function localPasswordSession(actor, status, interruptionGuard) {
  const password = `Recovery!${randomBytes(36).toString("base64url")}`;
  const reset = await apiRequest(new URL(`/auth/v1/admin/users/${actor.userId}`, status.apiUrl), {
    method: "PUT",
    headers: { apikey: status.serviceRoleKey, Authorization: `Bearer ${status.serviceRoleKey}`, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  }, [200], "local_representative_password_reset_failed", "auth_rls_proof", interruptionGuard);
  await interruptionGuard.run("auth_rls_proof", async () => await reset.arrayBuffer());
  const login = await apiRequest(new URL("/auth/v1/token?grant_type=password", status.apiUrl), {
    method: "POST",
    headers: { apikey: status.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ email: actor.email, password }),
  }, [200], "local_representative_login_failed", "auth_rls_proof", interruptionGuard);
  let payload;
  try {
    payload = await interruptionGuard.run("auth_rls_proof", async () => await login.json());
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    payload = null;
  }
  if (!isRecord(payload) || typeof payload.access_token !== "string" || payload.user?.id !== actor.userId) {
    fail("local_representative_session_invalid", "auth_rls_proof");
  }
  return Object.freeze({ ...actor, password, accessToken: payload.access_token });
}

async function prepareActors(options, status, supervisor, toolchain, interruptionGuard) {
  const restored = await discoverActors(options, status, supervisor, toolchain);
  const actors = {};
  for (const role of ["admin", "sales", "admissions"]) {
    if (restored.actors[role]) actors[role] = await localPasswordSession(restored.actors[role], status, interruptionGuard);
  }
  return Object.freeze({ actors: Object.freeze(actors), blockers: restored.blockers });
}

async function platformGet(status, actor, resource, query, interruptionGuard) {
  const url = new URL(`/rest/v1/${resource}`, status.apiUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await apiRequest(url, {
    headers: {
      apikey: status.publishableKey,
      Authorization: `Bearer ${actor.accessToken}`,
      "Accept-Profile": "platform",
    },
  }, [200], "platform_read_failed", "auth_rls_proof", interruptionGuard);
  let payload;
  try {
    payload = await interruptionGuard.run("auth_rls_proof", async () => await response.json());
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    payload = null;
  }
  if (!Array.isArray(payload)) fail("platform_read_response_invalid", "auth_rls_proof");
  return payload;
}

async function platformRpc(status, actor, functionName, body, interruptionGuard, stage = "malware_scanner_proof") {
  const response = await apiRequest(new URL(`/rest/v1/rpc/${functionName}`, status.apiUrl), {
    method: "POST",
    headers: {
      apikey: status.publishableKey,
      Authorization: `Bearer ${actor.accessToken}`,
      "Accept-Profile": "platform",
      "Content-Profile": "platform",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }, [200], `${functionName}_failed`, stage, interruptionGuard);
  let payload;
  try {
    payload = await interruptionGuard.run(stage, async () => await response.json());
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    payload = null;
  }
  if (payload === null) fail(`${functionName}_response_invalid`, stage);
  return payload;
}

async function assertPlatformRpcDenied(status, actor, functionName, body, interruptionGuard) {
  const stage = "role_outcome_proof";
  const response = await apiRequest(new URL(`/rest/v1/rpc/${functionName}`, status.apiUrl), {
    method: "POST",
    headers: {
      apikey: status.publishableKey,
      Authorization: `Bearer ${actor.accessToken}`,
      "Accept-Profile": "platform",
      "Content-Profile": "platform",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }, [400, 401, 403], `${functionName}_unexpectedly_authorized`, stage, interruptionGuard);
  let payload;
  try {
    payload = await interruptionGuard.run(stage, async () => await response.json());
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    payload = null;
  }
  if (!isRecord(payload) || payload.code !== "42501") {
    fail(`${functionName}_denial_contract_invalid`, stage, { status: response.status });
  }
}

function requiredPositiveVersion(value, code) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(code, "role_outcome_proof");
  return parsed;
}

function assertReplayResult(first, replayed, code) {
  if (!sameJson(first, replayed)) fail(code, "role_outcome_proof");
}

async function assertRoleMutationAudit(supervisor, toolchain, status, {
  action,
  actor,
  requestId,
  receiptKind,
}) {
  const receiptCount = receiptKind === "sales"
    ? `(SELECT count(*) FROM platform_private.sales_lead_workflow_receipts AS receipt
        WHERE receipt.request_id = ${sqlLiteral(requestId)}::uuid
          AND receipt.actor_membership_id = ${sqlLiteral(actor.membershipId)}::uuid)`
    : receiptKind === "admissions"
      ? `(SELECT count(*) FROM platform.case_task_events AS event
          WHERE event.request_id = ${sqlLiteral(requestId)}::uuid
            AND event.actor_membership_id = ${sqlLiteral(actor.membershipId)}::uuid)`
      : null;
  if (receiptCount === null) fail("role_mutation_receipt_kind_invalid", "role_outcome_proof");
  const facts = await psqlJson(supervisor, toolchain, status, `SELECT json_build_object(
    'auditCount', (
      SELECT count(*) FROM platform.audit_events AS audit
      WHERE audit.request_id = ${sqlLiteral(requestId)}::uuid
        AND audit.action = ${sqlLiteral(action)}
        AND audit.actor_profile_id = ${sqlLiteral(actor.profileId)}::uuid
    ),
    'receiptCount', ${receiptCount}
  )::text`, "role_outcome_proof");
  if (Number(facts?.auditCount) !== 1 || Number(facts?.receiptCount) !== 1) {
    fail("role_mutation_audit_correlation_failed", "role_outcome_proof");
  }
  const appendOnly = await psql(supervisor, toolchain, status, ["--tuples-only", "--no-align", "--command", String.raw`
    DO $audit_append_only$
    BEGIN
      BEGIN
        UPDATE platform.audit_events SET reason = reason || ' forbidden'
        WHERE request_id = ${sqlLiteral(requestId)}::uuid;
        RAISE EXCEPTION 'audit update unexpectedly succeeded';
      EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
      END;
      BEGIN
        DELETE FROM platform.audit_events WHERE request_id = ${sqlLiteral(requestId)}::uuid;
        RAISE EXCEPTION 'audit delete unexpectedly succeeded';
      EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
      END;
    END
    $audit_append_only$;
    SELECT count(*)::text FROM platform.audit_events
    WHERE request_id = ${sqlLiteral(requestId)}::uuid;`], {
    stage: "role_outcome_proof",
    code: "audit_append_only_proof_failed",
  });
  if (appendOnly.stdout.toString("utf8").trim().split(/\s+/u).at(-1) !== "1") {
    fail("audit_append_only_row_missing", "role_outcome_proof");
  }
}

async function recordRecoveryProviderBoundary(status, organizationId, repositoryCommit, interruptionGuard) {
  const evidence = {};
  for (const target of ["waha", "ai"]) {
    const response = await apiRequest(new URL("/rest/v1/rpc/record_messaging_integration_health_event", status.apiUrl), {
      method: "POST",
      headers: {
        apikey: status.serviceRoleKey,
        Authorization: `Bearer ${status.serviceRoleKey}`,
        "Accept-Profile": "platform",
        "Content-Profile": "platform",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_target: target,
        p_readiness: "unconfigured",
        p_evidence_kind: "configuration_check",
        p_reason: "Managed recovery contour has no external provider configuration",
        p_evidence_ref: `v3-recovery:${repositoryCommit.slice(0, 12)}:${target}`,
        p_request_id: randomUUID(),
      }),
    }, [200], `${target}_provider_configuration_boundary_append_failed`, "provider_boundary", interruptionGuard);
    const event = await interruptionGuard.run("provider_boundary", async () => await response.json()).catch(() => null);
    if (!isRecord(event) || event.target !== target || event.readiness !== "unconfigured" || event.evidence_kind !== "configuration_check") {
      fail(`${target}_provider_configuration_boundary_response_invalid`, "provider_boundary");
    }
    evidence[target] = "configuration_check_unconfigured";
  }
  return Object.freeze(evidence);
}

async function expectDatabaseDenial(operation, expectedCode, expected) {
  try {
    await operation();
  } catch (error) {
    if (
      error instanceof RecoveryFailure &&
      error.code === expectedCode &&
      classifyExpectedDatabaseDenial(error.diagnostic, expected)
    ) return true;
    throw error;
  }
  return false;
}

const NEXT_ADMISSIONS_TASK_STATUS = Object.freeze({
  open: "in_progress",
  in_progress: "open",
  blocked: "open",
  done: "open",
  cancelled: "open",
});

export function selectAdmissionsTaskMutation(task) {
  exactKeys(task, [
    "id",
    "status",
    "assigneeMembershipId",
    "priority",
    "dueAt",
    "dueOn",
    "studentVisible",
    "version",
  ], "authorized_admissions_task_invalid", "admissions_write_proof");
  const status = NEXT_ADMISSIONS_TASK_STATUS[task.status];
  if (
    !UUID.test(task.id) ||
    !UUID.test(task.assigneeMembershipId) ||
    typeof status !== "string" ||
    status === task.status ||
    !["low", "normal", "high", "urgent"].includes(task.priority) ||
    (task.dueAt !== null && typeof task.dueAt !== "string") ||
    (task.dueOn !== null && typeof task.dueOn !== "string") ||
    typeof task.studentVisible !== "boolean" ||
    !Number.isSafeInteger(task.version) ||
    task.version < 1
  ) {
    fail("authorized_admissions_task_invalid", "admissions_write_proof");
  }
  return Object.freeze({ ...task, status });
}

export function validateWriteBoundaryResults(value) {
  exactKeys(value, [
    "adminAuditCount",
    "crossOrganizationWriteDenied",
    "salesAdminWriteDenied",
    "admissionsTaskAuditCount",
    "admissionsAdminWriteDenied",
  ], "authorization_write_boundary_invalid", "auth_rls_proof");
  if (
    value.adminAuditCount !== 1 ||
    value.crossOrganizationWriteDenied !== true ||
    value.salesAdminWriteDenied !== true ||
    value.admissionsTaskAuditCount !== 1 ||
    value.admissionsAdminWriteDenied !== true
  ) {
    fail("authorization_write_boundary_failed", "auth_rls_proof");
  }
  return Object.freeze({
    canonicalWriteRollbackOnly: "passed",
    auditRollbackOnly: "passed",
    crossOrganizationWriteDenied: true,
    salesAdminWriteDenied: true,
    admissionsTaskWriteRollbackOnly: "passed",
    admissionsAdminWriteDenied: true,
  });
}

async function proveRlsAndCanonicalWrite(options, status, actors, supervisor, toolchain, interruptionGuard) {
  const otherOrganizations = await psqlJson(supervisor, toolchain, status,
    `SELECT coalesce(json_agg(id ORDER BY id), '[]'::json)::text FROM platform.organizations WHERE id <> ${sqlLiteral(options.platformOrganizationId)}::uuid`,
    "auth_rls_proof");
  const crossOrganizationId = Array.isArray(otherOrganizations)
    ? otherOrganizations.find((value) => UUID.test(value))
    : undefined;
  const blockers = [];
  if (!crossOrganizationId) blockers.push("preexisting_cross_organization_reference_missing");
  for (const role of ["admin", "sales", "admissions"]) {
    const own = await platformGet(status, actors[role], "organizations", { select: "id", id: `eq.${options.platformOrganizationId}` }, interruptionGuard);
    if (own.length !== 1) fail("organization_rls_boundary_failed", "auth_rls_proof", { role });
    if (crossOrganizationId) {
      const cross = await platformGet(status, actors[role], "organizations", { select: "id", id: `eq.${crossOrganizationId}` }, interruptionGuard);
      if (cross.length !== 0) fail("organization_rls_boundary_failed", "auth_rls_proof", { role });
    }
  }
  const requestId = randomUUID();
  const claims = JSON.stringify({ sub: actors.admin.userId, role: "authenticated" });
  const writeProbe = String.raw`
    BEGIN;
    SELECT set_config('request.jwt.claims', ${sqlLiteral(claims)}, true);
    SET LOCAL ROLE authenticated;
    SELECT platform.change_membership_permission(
      ${sqlLiteral(options.platformOrganizationId)}::uuid,
      ${sqlLiteral(actors.admin.membershipId)}::uuid,
      'contract.evidence.confirm', true,
      'isolated recovery rollback-only authorization proof',
      ${sqlLiteral(requestId)}::uuid
    );
    SELECT count(*)::text FROM platform.audit_events WHERE request_id = ${sqlLiteral(requestId)}::uuid;
    ROLLBACK;`;
  const positive = await psql(supervisor, toolchain, status, ["--tuples-only", "--no-align", "--command", writeProbe], { stage: "canonical_write_audit_proof", code: "canonical_write_audit_failed" });
  const adminAuditCount = Number(positive.stdout.toString("utf8").trim().split(/\s+/u).at(-1));
  const crossOrganizationWriteDenied = crossOrganizationId
    ? await expectDatabaseDenial(() => psql(supervisor, toolchain, status, ["--command", String.raw`
        BEGIN;
        SELECT set_config('request.jwt.claims', ${sqlLiteral(claims)}, true);
        SET LOCAL ROLE authenticated;
        SELECT platform.change_membership_permission(
          ${sqlLiteral(crossOrganizationId)}::uuid,
          ${sqlLiteral(actors.admin.membershipId)}::uuid,
          'contract.evidence.confirm', true, 'must be denied across organizations', ${sqlLiteral(randomUUID())}::uuid
        );
        ROLLBACK;`], { stage: "cross_organization_write_negative_proof", code: "expected_cross_organization_write_denial" }), "expected_cross_organization_write_denial", ADMIN_MEMBERSHIP_DENIAL)
    : null;
  const salesClaims = JSON.stringify({ sub: actors.sales.userId, role: "authenticated" });
  const salesAdminWriteDenied = await expectDatabaseDenial(() => psql(supervisor, toolchain, status, ["--command", String.raw`
      BEGIN;
      SELECT set_config('request.jwt.claims', ${sqlLiteral(salesClaims)}, true);
      SET LOCAL ROLE authenticated;
      SELECT platform.change_membership_permission(
        ${sqlLiteral(options.platformOrganizationId)}::uuid,
        ${sqlLiteral(actors.admin.membershipId)}::uuid,
        'contract.evidence.confirm', true, 'must be denied', ${sqlLiteral(randomUUID())}::uuid
      );
      ROLLBACK;`], { stage: "canonical_write_negative_proof", code: "expected_sales_write_denial" }), "expected_sales_write_denial", ADMIN_MEMBERSHIP_DENIAL);
  const admissionsClaims = JSON.stringify({ sub: actors.admissions.userId, role: "authenticated" });
  const admissionsAdminWriteDenied = await expectDatabaseDenial(() => psql(supervisor, toolchain, status, ["--command", String.raw`
    BEGIN;
    SELECT set_config('request.jwt.claims', ${sqlLiteral(admissionsClaims)}, true);
    SET LOCAL ROLE authenticated;
    SELECT platform.change_membership_permission(
      ${sqlLiteral(options.platformOrganizationId)}::uuid,
      ${sqlLiteral(actors.admin.membershipId)}::uuid,
      'contract.evidence.confirm', true, 'Admissions must not administer staff', ${sqlLiteral(randomUUID())}::uuid
    );
    ROLLBACK;`], { stage: "admissions_admin_negative_proof", code: "expected_admissions_admin_write_denial" }), "expected_admissions_admin_write_denial", ADMIN_MEMBERSHIP_DENIAL);
  if (
    adminAuditCount !== 1 ||
    salesAdminWriteDenied !== true ||
    admissionsAdminWriteDenied !== true ||
    (crossOrganizationId && crossOrganizationWriteDenied !== true)
  ) fail("authorization_write_boundary_failed", "auth_rls_proof");
  return Object.freeze({
    evidence: Object.freeze({
      sameOrganization: "passed",
      crossOrganization: crossOrganizationId ? "passed" : "not_run_missing_restored_reference",
      canonicalRead: "passed",
      canonicalWriteRollbackOnly: "passed",
      auditRollbackOnly: "passed",
      crossOrganizationWriteDenied,
      salesAdminWriteDenied: true,
      admissionsAdminWriteDenied: true,
      admissionsTaskWrite: "proved_by_restored_role_outcome_suite",
    }),
    blockers: Object.freeze(blockers),
  });
}

function admissionsTaskBrowserDay(task) {
  if (typeof task.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(task.dueOn)) return task.dueOn;
  if (typeof task.dueAt !== "string" || !Number.isFinite(Date.parse(task.dueAt))) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(task.dueAt)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function proveRestoredRoleServerOutcomes(options, status, actors, supervisor, toolchain, interruptionGuard) {
  const outcomes = {
    admin: "incomplete_role_outcome_suite",
    sales: isRecord(actors.sales) ? "incomplete_role_outcome_suite" : "missing_restored_identity",
    admissions: isRecord(actors.admissions) ? "incomplete_role_outcome_suite" : "missing_restored_identity",
  };
  const blockers = [];
  let salesProof;
  let admissionsProof;
  let documentProof;
  if (![actors.admin, actors.sales, actors.admissions].every(isRecord)) {
    return Object.freeze({
      outcomes: Object.freeze(outcomes),
      blockers: Object.freeze(blockers),
      evidence: Object.freeze({
        salesMutationReplayAudit: "not_run_missing_restored_identity",
        admissionsMutationReplayAudit: "not_run_missing_restored_identity",
        privateDocument: "not_run_missing_restored_identity",
      }),
    });
  }

  const salesPageBody = Object.freeze({
    p_limit: 101,
    p_cursor_updated_at: null,
    p_cursor_id: null,
    p_connection_filter: "all",
    p_stage_filter: "all",
    p_assignment_filter: "all",
    p_owner_membership_id: null,
    p_due_filter: "all",
    p_query: null,
  });
  await assertPlatformRpcDenied(status, actors.admissions, "staff_sales_lead_page", salesPageBody, interruptionGuard);
  const salesCandidates = await psqlJson(supervisor, toolchain, status, String.raw`
    SELECT coalesce(json_agg(row_to_json(candidate) ORDER BY candidate.lead_id), '[]'::json)::text
    FROM (
      SELECT lead.id::text AS lead_id
      FROM platform.leads AS lead
      WHERE lead.organization_id = ${sqlLiteral(options.platformOrganizationId)}::uuid
        AND lead.lifecycle_state = 'open'
        AND (lead.current_owner_membership_id IS NULL
          OR lead.current_owner_membership_id = ${sqlLiteral(actors.sales.membershipId)}::uuid)
      ORDER BY lead.id
      LIMIT 1
    ) AS candidate`, "role_outcome_proof");
  const salesCandidate = Array.isArray(salesCandidates) ? salesCandidates[0] : undefined;
  const salesRows = isRecord(salesCandidate) && UUID.test(salesCandidate.lead_id)
    ? await platformRpc(status, actors.sales, "staff_sales_lead_page", {
        ...salesPageBody,
        p_query: salesCandidate.lead_id,
      }, interruptionGuard, "role_outcome_proof")
    : [];
  const salesLead = Array.isArray(salesRows)
    ? salesRows.find((row) => isRecord(row) && row.lead_id === salesCandidate?.lead_id &&
      row.lifecycle_state === "open" && [null, actors.sales.membershipId].includes(row.current_owner_membership_id))
    : undefined;
  if (isRecord(salesCandidate) && UUID.test(salesCandidate.lead_id) && !salesLead) {
    fail("restored_sales_lead_role_projection_failed", "role_outcome_proof");
  }
  if (!salesLead) {
    outcomes.sales = "missing_restored_sales_lead";
    blockers.push("restored_sales_lead_missing");
  } else {
    const workflowVersion = requiredPositiveVersion(salesLead.workflow_version, "restored_sales_workflow_version_invalid");
    if (typeof salesLead.stage_key !== "string" || salesLead.stage_key.length === 0) {
      fail("restored_sales_stage_invalid", "role_outcome_proof");
    }
    const requestId = randomUUID();
    const marker = `Recovery Sales ${randomUUID()}`;
    const mutationBody = Object.freeze({
      p_lead_id: salesLead.lead_id,
      p_expected_workflow_version: workflowVersion,
      p_request_id: requestId,
      p_stage_key: salesLead.stage_key,
      p_owner_membership_id: actors.sales.membershipId,
      p_next_action_text: marker,
      p_next_action_due_date: "2099-12-31",
      p_clear_next_action: false,
      p_reason: null,
    });
    const result = await platformRpc(status, actors.sales, "mutate_sales_lead_workflow", mutationBody, interruptionGuard, "role_outcome_proof");
    const replayed = await platformRpc(status, actors.sales, "mutate_sales_lead_workflow", mutationBody, interruptionGuard, "role_outcome_proof");
    assertReplayResult(result, replayed, "sales_workflow_replay_mismatch");
    if (!isRecord(result) || result.lead_id !== salesLead.lead_id || result.next_action_text !== marker ||
      requiredPositiveVersion(result.workflow_version, "sales_workflow_result_version_invalid") !== workflowVersion + 1) {
      fail("sales_workflow_result_invalid", "role_outcome_proof");
    }
    for (const actor of [actors.sales, actors.admin]) {
      const rows = await platformRpc(status, actor, "staff_sales_lead_page", { ...salesPageBody, p_query: salesLead.lead_id }, interruptionGuard, "role_outcome_proof");
      const readback = Array.isArray(rows) ? rows.find((row) => row?.lead_id === salesLead.lead_id) : undefined;
      if (readback?.next_action_text !== marker || Number(readback?.workflow_version) !== workflowVersion + 1) {
        fail("sales_workflow_role_readback_failed", "role_outcome_proof");
      }
    }
    await assertRoleMutationAudit(supervisor, toolchain, status, {
      action: "lead.sales.workflow.changed",
      actor: actors.sales,
      requestId,
      receiptKind: "sales",
    });
    outcomes.sales = "passed";
    salesProof = Object.freeze({ leadId: salesLead.lead_id, marker, workflowVersion: workflowVersion + 1 });
  }

  const admissionsTasks = await psqlJson(supervisor, toolchain, status, String.raw`
    SELECT coalesce(json_agg(row_to_json(candidate) ORDER BY candidate.id), '[]'::json)::text
    FROM (
      SELECT task.id::text AS id, task.student_case_id::text AS "studentCaseId",
        task.status::text AS status, task.assignee_membership_id::text AS "assigneeMembershipId",
        task.priority::text AS priority, task.due_at::text AS "dueAt",
        task.due_on::text AS "dueOn", task.student_visible AS "studentVisible",
        task.version AS version
      FROM platform.case_tasks AS task
      JOIN platform.student_cases AS student_case
        ON student_case.organization_id = task.organization_id
        AND student_case.id = task.student_case_id
      WHERE task.organization_id = ${sqlLiteral(options.platformOrganizationId)}::uuid
        AND task.assignee_membership_id = ${sqlLiteral(actors.admissions.membershipId)}::uuid
        AND student_case.current_curator_membership_id = ${sqlLiteral(actors.admissions.membershipId)}::uuid
        AND student_case.state IN ('active', 'closed')
        AND student_case.handoff_at IS NOT NULL
        AND (task.due_at IS NOT NULL OR task.due_on IS NOT NULL)
      ORDER BY task.id
      LIMIT 1
    ) AS candidate`, "role_outcome_proof");
  const admissionsTask = Array.isArray(admissionsTasks) ? admissionsTasks[0] : undefined;
  if (!isRecord(admissionsTask) || !UUID.test(admissionsTask.id) || !UUID.test(admissionsTask.studentCaseId)) {
    outcomes.admissions = "missing_restored_admissions_task";
    blockers.push("restored_admissions_task_missing");
  } else {
    const admissionsMutation = selectAdmissionsTaskMutation({
      id: admissionsTask.id,
      status: admissionsTask.status,
      assigneeMembershipId: admissionsTask.assigneeMembershipId,
      priority: admissionsTask.priority,
      dueAt: admissionsTask.dueAt,
      dueOn: admissionsTask.dueOn,
      studentVisible: admissionsTask.studentVisible,
      version: requiredPositiveVersion(admissionsTask.version, "restored_admissions_task_version_invalid"),
    });
    if (admissionsMutation.assigneeMembershipId !== actors.admissions.membershipId) {
      fail("restored_admissions_task_assignee_invalid", "role_outcome_proof");
    }
    const browserDay = admissionsTaskBrowserDay(admissionsMutation);
    if (browserDay === null) fail("restored_admissions_task_deadline_invalid", "role_outcome_proof");
    const requestId = randomUUID();
    const workspaceBody = Object.freeze({ p_student_case_id: admissionsTask.studentCaseId });
    await assertPlatformRpcDenied(status, actors.sales, "staff_student_case_task_workspace", workspaceBody, interruptionGuard);
    const mutationBody = Object.freeze({
      p_organization_id: options.platformOrganizationId,
      p_case_task_id: admissionsMutation.id,
      p_new_status: admissionsMutation.status,
      p_new_assignee_membership_id: admissionsMutation.assigneeMembershipId,
      p_priority: admissionsMutation.priority,
      p_due_at: admissionsMutation.dueAt,
      p_due_on: admissionsMutation.dueOn,
      p_student_visible: admissionsMutation.studentVisible,
      p_expected_version: admissionsMutation.version,
      p_request_id: requestId,
    });
    const result = await platformRpc(status, actors.admissions, "change_case_task", mutationBody, interruptionGuard, "role_outcome_proof");
    const replayed = await platformRpc(status, actors.admissions, "change_case_task", mutationBody, interruptionGuard, "role_outcome_proof");
    assertReplayResult(result, replayed, "admissions_task_replay_mismatch");
    const resultVersion = requiredPositiveVersion(result?.version, "admissions_task_result_version_invalid");
    if (!isRecord(result) || result.case_task_id !== admissionsTask.id || result.student_case_id !== admissionsTask.studentCaseId ||
      result.status !== admissionsMutation.status || resultVersion !== admissionsMutation.version + 1) {
      fail("admissions_task_result_invalid", "role_outcome_proof");
    }
    for (const actor of [actors.admissions, actors.admin]) {
      const workspace = await platformRpc(status, actor, "staff_student_case_task_workspace", workspaceBody, interruptionGuard, "role_outcome_proof");
      const readback = Array.isArray(workspace?.tasks)
        ? workspace.tasks.find((task) => task?.case_task_id === admissionsTask.id)
        : undefined;
      if (readback?.status !== admissionsMutation.status || Number(readback?.version) !== resultVersion) {
        fail("admissions_task_role_readback_failed", "role_outcome_proof");
      }
    }
    await assertRoleMutationAudit(supervisor, toolchain, status, {
      action: "task.change",
      actor: actors.admissions,
      requestId,
      receiptKind: "admissions",
    });
    outcomes.admissions = "passed";
    admissionsProof = Object.freeze({
      taskId: admissionsTask.id,
      studentCaseId: admissionsTask.studentCaseId,
      status: admissionsMutation.status,
      version: resultVersion,
      browserDay,
    });
  }

  const documentBody = Object.freeze({ p_limit: 101 });
  const adminDocuments = await platformRpc(status, actors.admin, "staff_document_queue", documentBody, interruptionGuard, "role_outcome_proof");
  const admissionsDocuments = await platformRpc(status, actors.admissions, "staff_document_queue", documentBody, interruptionGuard, "role_outcome_proof");
  await assertPlatformRpcDenied(status, actors.sales, "staff_document_queue", documentBody, interruptionGuard);
  const document = Array.isArray(admissionsDocuments)
    ? admissionsDocuments.find((row) => isRecord(row) && row.download_ready === true &&
      UUID.test(row.current_version_id) && SHA256.test(row.current_sha256_hex) &&
      Number.isSafeInteger(Number(row.current_byte_size)) && Number(row.current_byte_size) >= 0)
    : undefined;
  const adminDocument = document && Array.isArray(adminDocuments)
    ? adminDocuments.find((row) => row?.current_version_id === document.current_version_id && row.download_ready === true)
    : undefined;
  if (!document || !adminDocument) {
    blockers.push("restored_downloadable_document_missing");
    if (outcomes.sales === "passed") outcomes.sales = "missing_restored_downloadable_document";
    if (outcomes.admissions === "passed") outcomes.admissions = "missing_restored_downloadable_document";
  } else {
    const storageBinding = await psqlJson(supervisor, toolchain, status, String.raw`
      SELECT coalesce((
        SELECT json_build_object(
          'bucketId', binding.bucket_id,
          'objectName', binding.object_name
        )
        FROM platform_private.document_storage_bindings AS binding
        WHERE binding.organization_id = ${sqlLiteral(options.platformOrganizationId)}::uuid
          AND binding.document_version_id = ${sqlLiteral(document.current_version_id)}::uuid
      ), 'null'::json)::text`, "role_outcome_proof");
    if (
      !isRecord(storageBinding) ||
      storageBinding.bucketId !== "platform-documents" ||
      typeof storageBinding.objectName !== "string" ||
      !/^[0-9a-f]{2}\/[0-9a-f]{62}$/u.test(storageBinding.objectName)
    ) {
      fail("restored_document_storage_binding_invalid", "role_outcome_proof");
    }
    documentProof = Object.freeze({
      versionId: document.current_version_id,
      sha256Hex: document.current_sha256_hex,
      byteSize: Number(document.current_byte_size),
      bucketId: storageBinding.bucketId,
      objectName: storageBinding.objectName,
    });
  }
  if (outcomes.sales === "passed" && outcomes.admissions === "passed" && documentProof) outcomes.admin = "passed";
  return Object.freeze({
    outcomes: Object.freeze(outcomes),
    blockers: Object.freeze(blockers),
    sales: salesProof,
    admissions: admissionsProof,
    document: documentProof,
    evidence: Object.freeze({
      salesMutationReplayAudit: salesProof ? "passed" : "not_run_missing_restored_sales_lead",
      admissionsMutationReplayAudit: admissionsProof ? "passed" : "not_run_missing_restored_admissions_task",
      privateDocument: documentProof ? "passed_role_scoped_projection" : "not_run_missing_restored_downloadable_document",
    }),
  });
}

export function canonicalRecoveryPdfBytes() {
  const header = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> >>",
  ];
  const offsets = [0];
  let document = header;
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, "latin1"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, "latin1");
  document += `xref\n0 ${objects.length + 1}\n`;
  document += "0000000000 65535 f \n";
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "latin1");
}

async function provePrivateDocument(status, actor, buckets, interruptionGuard) {
  const bucket = buckets.find((candidate) => candidate.id === "platform-documents" && candidate.public === false);
  if (!bucket) fail("private_document_bucket_missing", "document_proof");
  if (!Array.isArray(bucket.allowed_mime_types) || !bucket.allowed_mime_types.includes("application/pdf")) {
    fail("private_document_pdf_not_allowed", "document_proof");
  }
  const path = `recovery-proof/${randomUUID()}.pdf`;
  const bytes = canonicalRecoveryPdfBytes();
  const url = objectUrl(status.apiUrl, bucket.id, path);
  try {
    const written = await apiRequest(url, {
      method: "POST",
      headers: { apikey: status.serviceRoleKey, Authorization: `Bearer ${status.serviceRoleKey}`, "content-type": "application/pdf", "x-upsert": "false" },
      body: bytes,
    }, [200], "private_document_write_failed", "document_proof", interruptionGuard);
    await interruptionGuard.run("document_proof", async () => await written.arrayBuffer());
    await apiRequest(url, { headers: { apikey: status.publishableKey } }, [400, 401, 403, 404], "private_document_publicly_readable", "document_proof", interruptionGuard);
    await apiRequest(url, { headers: { apikey: status.publishableKey, Authorization: `Bearer ${actor.accessToken}` } }, [400, 401, 403, 404], "private_document_direct_readable", "document_proof", interruptionGuard);
    const signed = await apiRequest(objectUrl(status.apiUrl, bucket.id, path, "object/sign"), {
      method: "POST",
      headers: { apikey: status.serviceRoleKey, Authorization: `Bearer ${status.serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    }, [200], "private_document_sign_failed", "document_proof", interruptionGuard);
    let signedPayload;
    try {
      signedPayload = await interruptionGuard.run("document_proof", async () => await signed.json());
    } catch (error) {
      if (error instanceof RecoveryFailure) throw error;
      signedPayload = null;
    }
    if (!isRecord(signedPayload) || typeof signedPayload.signedURL !== "string") fail("private_document_signed_url_invalid", "document_proof");
    const download = await apiRequest(
      resolveStorageSignedObjectUrl(status.apiUrl, bucket.id, path, signedPayload.signedURL),
      {},
      [200],
      "private_document_signed_read_failed",
      "document_proof",
      interruptionGuard,
    );
    const actual = Buffer.from(await interruptionGuard.run("document_proof", async () => await download.arrayBuffer()));
    if (!actual.equals(bytes)) fail("private_document_roundtrip_mismatch", "document_proof");
  } finally {
    const deleted = await apiRequest(
      url,
      { method: "DELETE", headers: { apikey: status.serviceRoleKey, Authorization: `Bearer ${status.serviceRoleKey}` } },
      [200, 204, 404],
      "private_document_cleanup_failed",
      "document_proof",
      interruptionGuard,
      { allowAfterInterrupt: true },
    );
    await interruptionGuard.run("document_proof", async () => await deleted.arrayBuffer(), { allowAfterInterrupt: true });
  }
  return Object.freeze({
    privateBucket: bucket.id,
    anonymousDirectRead: "denied",
    authenticatedDirectRead: "denied",
    signedRoundTrip: "passed",
    canaryDeleted: true,
    canaryMimeType: "application/pdf",
    canarySha256: sha256(bytes),
    evidenceScope: "behavior_canary_only_not_source_recovery",
  });
}

function safeTargetPath(value, code = "target_snapshot_path_invalid") {
  const components = typeof value === "string" ? value.split("/") : [];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8_192 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f\ufffd]/u.test(value) ||
    components.some((part) => ["", ".", ".."].includes(part)) ||
    components.some((part) => part
      .normalize("NFD")
      .replace(/[\u200c-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, "")
      .toLocaleLowerCase("en-US") === ".git")
  ) {
    fail(code, "image_verification");
  }
  return value;
}

export async function gitBlobOid(path, objectFormat) {
  if (!new Set(["sha1", "sha256"]).has(objectFormat)) fail("repository_object_format_invalid", "image_verification");
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("target_snapshot_blob_invalid", "image_verification");
  const digest = createHash(objectFormat);
  digest.update(`blob ${metadata.size}\0`);
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

export function parseTargetTreeListing(output) {
  const records = Buffer.isBuffer(output) ? output.toString("utf8").split("\0") : String(output).split("\0");
  const entries = records.filter(Boolean).map((record) => {
    const match = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(record);
    if (!match) fail("target_snapshot_git_entry_invalid", "image_verification");
    return Object.freeze({ mode: match[1], oid: match[2], path: safeTargetPath(match[3]) });
  });
  if (entries.length === 0 || new Set(entries.map(({ path }) => path)).size !== entries.length) {
    fail("target_snapshot_git_entry_invalid", "image_verification");
  }
  for (const required of [".dockerignore", "Dockerfile", "package.json", "package-lock.json", "scripts/check-node-runtime.mjs"]) {
    if (!entries.some((entry) => entry.path === required)) fail("target_snapshot_build_input_missing", "image_verification");
  }
  return Object.freeze(entries);
}

export function orderedTargetEntries(entries, objectFormat) {
  if (!Array.isArray(entries) || !new Set(["sha1", "sha256"]).has(objectFormat)) {
    fail("repository_object_format_invalid", "image_verification");
  }
  const expectedOidLength = objectFormat === "sha256" ? 64 : 40;
  if (entries.some(({ oid }) => typeof oid !== "string" || oid.length !== expectedOidLength)) {
    fail("target_snapshot_object_format_mismatch", "image_verification");
  }
  return Object.freeze([...entries].sort((left, right) => left.path.localeCompare(right.path, "en")));
}

function snapshotFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const canonical = relative(root, path).split(sep).join("/");
      safeTargetPath(canonical);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) fail("target_snapshot_symlink_forbidden", "image_verification");
      if (metadata.isDirectory()) visit(path);
      else if (metadata.isFile()) files.push(canonical);
      else fail("target_snapshot_special_file_forbidden", "image_verification");
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function materializeTargetSnapshot(repository, state, supervisor, toolchain) {
  const listing = await supervisor.run(toolchain.paths.git.real, ["ls-tree", "-r", "-z", repository.target.commit], {
    cwd: repositoryRoot,
    stage: "image_verification",
    code: "target_snapshot_tree_read_failed",
    timeoutMs: 60_000,
    maxCaptureBytes: 64 * 1_024 * 1_024,
  });
  const entries = parseTargetTreeListing(listing.stdout);
  const orderedEntries = orderedTargetEntries(entries, repository.target.objectFormat);
  const archive = join(state.harnessRoot, "target-source.tar");
  await supervisor.run(toolchain.paths.git.real, ["archive", "--format=tar", "--output", archive, repository.target.commit], {
    cwd: repositoryRoot,
    stage: "image_verification",
    code: "target_snapshot_archive_failed",
    timeoutMs: 5 * 60 * 1_000,
    maxCaptureBytes: 64 * 1_024,
  });
  chmodSync(archive, 0o600);
  const archiveMetadata = lstatSync(archive);
  if (!archiveMetadata.isFile() || archiveMetadata.isSymbolicLink() || archiveMetadata.size <= 0 || archiveMetadata.size > MAX_ARCHIVE_BYTES) {
    fail("target_snapshot_archive_invalid", "image_verification");
  }
  const tarListing = await supervisor.run(toolchain.paths.tar.real, ["-tf", archive], {
    stage: "image_verification",
    code: "target_snapshot_archive_list_failed",
    timeoutMs: 5 * 60 * 1_000,
    maxCaptureBytes: 64 * 1_024 * 1_024,
  });
  const archiveFiles = tarListing.stdout.toString("utf8").split(/\r?\n/u).filter((name) => name && !name.endsWith("/")).map((name) => safeTargetPath(name));
  const expectedFiles = orderedEntries.map(({ path }) => path);
  if (new Set(archiveFiles).size !== archiveFiles.length || !sameJson([...archiveFiles].sort((left, right) => left.localeCompare(right, "en")), expectedFiles)) {
    fail("target_snapshot_archive_inventory_mismatch", "image_verification");
  }
  const snapshotRoot = join(state.harnessRoot, "target-source");
  mkdirSync(snapshotRoot, { mode: 0o700 });
  await supervisor.run(toolchain.paths.tar.real, ["-xf", archive, "-C", snapshotRoot, "--no-same-owner", "--no-same-permissions"], {
    stage: "image_verification",
    code: "target_snapshot_extract_failed",
    timeoutMs: 10 * 60 * 1_000,
    maxCaptureBytes: 64 * 1_024,
  });
  const extractedFiles = snapshotFiles(snapshotRoot);
  if (!sameJson(extractedFiles, expectedFiles)) fail("target_snapshot_extracted_inventory_mismatch", "image_verification");
  for (const entry of orderedEntries) {
    const executable = (lstatSync(join(snapshotRoot, entry.path)).mode & 0o111) !== 0;
    if (executable !== (entry.mode === "100755")) fail("target_snapshot_mode_mismatch", "image_verification");
  }
  const actualOids = await Promise.all(orderedEntries.map(async ({ path }) => await gitBlobOid(
    join(snapshotRoot, path),
    repository.target.objectFormat,
  )));
  if (actualOids.length !== orderedEntries.length || orderedEntries.some((entry, index) => entry.oid !== actualOids[index])) {
    fail("target_snapshot_blob_mismatch", "image_verification");
  }
  return Object.freeze({
    root: snapshotRoot,
    archiveSha256: await sha256File(archive),
    fileCount: orderedEntries.length,
    listingSha256: sha256(canonicalJson(orderedEntries)),
    tree: repository.target.tree,
  });
}

export function validateBuiltImageInspection(output, expected) {
  exactKeys(expected, ["archiveSha256", "imageId", "projectName", "targetCommit", "targetTree"], "app_image_inspection_invalid", "image_verification");
  const lines = String(output).trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) fail("app_image_inspection_invalid", "image_verification");
  const fields = lines[0].split("\t");
  if (fields.length !== 5) fail("app_image_inspection_invalid", "image_verification");
  let id;
  let repoDigests;
  let labels;
  let operatingSystem;
  let architecture;
  try {
    id = JSON.parse(fields[0]);
    repoDigests = JSON.parse(fields[1]);
    labels = JSON.parse(fields[2]);
    operatingSystem = JSON.parse(fields[3]);
    architecture = JSON.parse(fields[4]);
  } catch {
    fail("app_image_inspection_invalid", "image_verification");
  }
  if (
    !IMAGE.test(id) ||
    id !== expected.imageId ||
    !Array.isArray(repoDigests) ||
    !isRecord(labels) ||
    labels["org.opencontainers.image.revision"] !== expected.targetCommit ||
    labels["evo.recovery.project"] !== expected.projectName ||
    labels["evo.recovery.type"] !== "candidate-image" ||
    labels["evo.recovery.target-tree"] !== expected.targetTree ||
    labels["evo.recovery.snapshot-archive-sha256"] !== expected.archiveSha256 ||
    labels["evo.recovery.build-network"] !== "dependency-fetch-only" ||
    operatingSystem !== "linux" ||
    architecture !== "amd64"
  ) {
    fail("app_image_provenance_mismatch", "image_verification");
  }
  return Object.freeze({
    id,
    revision: expected.targetCommit,
    repoDigests: Object.freeze(repoDigests),
    operatingSystem,
    architecture,
    buildNetwork: "dependency_fetch_only_not_candidate_runtime",
  });
}

async function buildCandidateImage(repository, state, supervisor, toolchain) {
  const snapshot = await materializeTargetSnapshot(repository, state, supervisor, toolchain);
  state.appImageTag = `evo-v3-recovery-${state.projectName}:candidate`;
  const iidFile = join(state.harnessRoot, "candidate-image-id");
  beginContainerMutationCapture(state, "exact_target_image_build");
  await runDocker(supervisor, toolchain.paths.docker, [
    "--context", "orbstack", "build",
    "--platform=linux/amd64",
    "--pull=false",
    "--network=default",
    "--no-cache",
    "--iidfile", iidFile,
    "--tag", state.appImageTag,
    "--build-arg", "EVO_IMAGE_SOURCE=local-exact-git-snapshot",
    "--build-arg", `EVO_IMAGE_REVISION=${repository.target.commit}`,
    "--build-arg", `EVO_IMAGE_VERSION=recovery-${repository.target.commit.slice(0, 12)}`,
    "--label", `org.opencontainers.image.revision=${repository.target.commit}`,
    "--label", `evo.recovery.project=${state.projectName}`,
    "--label", "evo.recovery.type=candidate-image",
    "--label", `evo.recovery.target-tree=${repository.target.tree}`,
    "--label", `evo.recovery.snapshot-archive-sha256=${snapshot.archiveSha256}`,
    "--label", "evo.recovery.build-network=dependency-fetch-only",
    snapshot.root,
  ], {
    stage: "image_verification",
    code: "target_snapshot_image_build_failed",
    timeoutMs: 30 * 60 * 1_000,
    maxCaptureBytes: 32 * 1_024 * 1_024,
    env: safeEnvironment({ DOCKER_BUILDKIT: "1" }),
  });
  chmodSync(iidFile, 0o600);
  const imageId = readFileSync(iidFile, "utf8").trim();
  if (!IMAGE.test(imageId)) fail("app_image_id_invalid", "image_verification");
  state.appImageId = imageId;
  const inspected = await runDocker(supervisor, toolchain.paths.docker, [
    "--context", "orbstack", "image", "inspect", "--format", SAFE_IMAGE_INSPECT_FORMAT, imageId,
  ], {
    stage: "image_verification",
    code: "app_image_inspect_failed",
    timeoutMs: 60_000,
    maxCaptureBytes: 64 * 1_024,
  });
  const image = validateBuiltImageInspection(inspected.stdout.toString("utf8"), {
    archiveSha256: snapshot.archiveSha256,
    imageId,
    projectName: state.projectName,
    targetCommit: repository.target.commit,
    targetTree: repository.target.tree,
  });
  state.appImageIdentity = Object.freeze({
    archiveSha256: snapshot.archiveSha256,
    buildNetwork: "dependency-fetch-only",
    id: image.id,
    projectName: state.projectName,
    tag: state.appImageTag,
    targetCommit: repository.target.commit,
    targetTree: repository.target.tree,
  });
  completeContainerMutationCapture(state, "exact_target_image_build");
  return Object.freeze({ ...image, snapshot });
}

async function waitForHttp(url, expected, timeoutMs, code, stage, state, interruptionGuard) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    interruptionGuard.assertActive(stage);
    if (state?.browserRecord?.spawnError) fail("browser_executable_start_failed", "browser_proof");
    if (state?.browserRecord && !childRunning(state.browserRecord.child)) fail("browser_exited_before_ready", "browser_proof");
    if (state?.browserRecord?.overflow) fail("browser_output_limit_exceeded", "browser_proof");
    try {
      const response = await interruptionGuard.run(stage, async (signal) => await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.any([AbortSignal.timeout(2_000), signal]),
      }));
      if (expected.includes(response.status)) return response;
    } catch (error) {
      if (error instanceof RecoveryFailure) throw error;
      // Bounded polling is the only emitted state.
    }
    await interruptionGuard.run(stage, async () => await delay(250));
  }
  fail(code, stage);
}

async function waitForRecoveryScanner(containerId, supervisor, toolchain, interruptionGuard) {
  const deadline = Date.now() + 10 * 60 * 1_000;
  while (Date.now() < deadline) {
    interruptionGuard.assertActive("malware_scanner_proof");
    const state = await runDocker(supervisor, toolchain.paths.docker, [
      "--context", "orbstack", "inspect", "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
      containerId,
    ], { stage: "malware_scanner_proof", code: "malware_scanner_inspect_failed", timeoutMs: 30_000 });
    const health = state.stdout.toString("utf8").trim();
    if (health === "healthy") return;
    if (["dead", "exited", "removing"].includes(health)) fail("malware_scanner_exited", "malware_scanner_proof");
    await interruptionGuard.run("malware_scanner_proof", async () => await delay(5_000));
  }
  fail("malware_scanner_health_timeout", "malware_scanner_proof");
}

async function startRecoveryScanner(state, status, repositorySnapshotRoot, supervisor, toolchain, interruptionGuard) {
  const compose = readFileSync(join(repositorySnapshotRoot, "docker-compose.prod.yml"), "utf8");
  if (!compose.includes(`image: "${CLAMAV_IMAGE}"`)) fail("malware_scanner_image_contract_mismatch", "malware_scanner_proof");
  try {
    await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "image", "inspect", CLAMAV_IMAGE], {
      stage: "malware_scanner_proof", code: "malware_scanner_image_missing", timeoutMs: 60_000,
    });
  } catch (error) {
    if (!(error instanceof RecoveryFailure) || error.code !== "malware_scanner_image_missing") throw error;
    await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "pull", "--platform", "linux/amd64", CLAMAV_IMAGE], {
      stage: "malware_scanner_proof", code: "malware_scanner_image_pull_failed", timeoutMs: 20 * 60 * 1_000,
      maxCaptureBytes: 8 * 1_024 * 1_024,
    });
  }
  const platform = await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "image", "inspect", "--format", "{{json .Id}}\t{{.Os}}/{{.Architecture}}", CLAMAV_IMAGE], {
    stage: "malware_scanner_proof", code: "malware_scanner_image_inspect_failed", timeoutMs: 60_000,
  });
  const [imageIdJson, imagePlatform] = platform.stdout.toString("utf8").trim().split("\t");
  let imageId;
  try {
    imageId = JSON.parse(imageIdJson);
  } catch {
    fail("malware_scanner_image_platform_invalid", "malware_scanner_proof");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageId ?? "") || imagePlatform !== "linux/amd64") {
    fail("malware_scanner_image_platform_invalid", "malware_scanner_proof");
  }
  const containerName = `supabase_clamav_${state.projectName}`;
  const networkHost = `evo-recovery-clamav-${state.projectName.slice(-12)}`;
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(networkHost)) fail("malware_scanner_network_host_invalid", "malware_scanner_proof");
  const signatureVolume = `supabase_clamav_signatures_${state.projectName}`;
  // The shared pinned ClamAV image is not harness-owned. Capture begins at the
  // first owned mutation so a killed volume/container create stays quarantined.
  beginContainerMutationCapture(state, "malware_scanner_start");
  state.scannerSignatureVolume = signatureVolume;
  await runDocker(supervisor, toolchain.paths.docker, [
    "--context", "orbstack", "volume", "create",
    "--label", `com.docker.compose.project=${state.projectName}`,
    "--label", `evo.recovery.project=${state.projectName}`,
    "--label", `evo.recovery.scanner=${state.projectName}`,
    "--label", "evo.recovery.type=clamav-signatures",
    signatureVolume,
  ], { stage: "malware_scanner_proof", code: "malware_scanner_volume_create_failed", timeoutMs: 60_000 });
  const inspectedVolume = await runDocker(supervisor, toolchain.paths.docker, [
    "--context", "orbstack", "volume", "inspect", "--format", SAFE_CLEANUP_VOLUME_INSPECT_FORMAT,
    signatureVolume,
  ], { stage: "malware_scanner_proof", code: "malware_scanner_volume_inspect_failed", timeoutMs: 60_000 });
  if (!sameJson(selectOwnedVolumeNames(inspectedVolume.stdout.toString("utf8"), state.projectName), [signatureVolume])) {
    fail("malware_scanner_volume_ownership_invalid", "malware_scanner_proof");
  }
  const started = await runDocker(supervisor, toolchain.paths.docker, [
    "--context", "orbstack", "run", "--detach",
    "--platform", "linux/amd64",
    "--name", containerName,
    "--network", state.networkName,
    "--network-alias", networkHost,
    "--init",
    "--cpus", "2.0",
    "--memory", "4096m",
    "--pids-limit", "256",
    "--label", `com.docker.compose.project=${state.projectName}`,
    "--label", "com.evo.runtime.role=private-malware-scanner",
    "--label", `evo.recovery.project=${state.projectName}`,
    "--label", `evo.recovery.scanner=${state.projectName}`,
    "--label", "evo.recovery.type=malware-scanner",
    "--volume", `${signatureVolume}:/var/lib/clamav`,
    "--health-cmd", "/usr/local/bin/clamdcheck.sh",
    "--health-interval", "5s",
    "--health-timeout", "10s",
    "--health-retries", "60",
    "--health-start-period", "180s",
    CLAMAV_IMAGE,
  ], { stage: "malware_scanner_proof", code: "malware_scanner_start_failed", timeoutMs: 2 * 60 * 1_000 });
  const containerId = started.stdout.toString("utf8").trim();
  if (!SHA256.test(containerId)) fail("malware_scanner_container_id_invalid", "malware_scanner_proof");
  state.scannerContainer = containerId;
  state.scannerIdentity = Object.freeze({
    containerId,
    containerName,
    imageId,
    networkHost,
    projectName: state.projectName,
  });
  await waitForRecoveryScanner(containerId, supervisor, toolchain, interruptionGuard);
  await inspectLocalSupabaseNetwork(state, status, supervisor, toolchain);
  return Object.freeze({
    containerId,
    containerName,
    networkHost,
    image: CLAMAV_IMAGE,
    network: "owned_egress_blocked_non_internal_bridge",
    publish: "none",
  });
}

async function createRecoveryTlsMaterial(state, supervisor, toolchain) {
  const directory = join(state.harnessRoot, "app-tls");
  const configPath = join(directory, "openssl.cnf");
  const certificatePath = join(directory, "ca.pem");
  const privateKeyPath = join(directory, "key.pem");
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(configPath, `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = v3\n[dn]\nCN = ${RECOVERY_SUPABASE_HOSTNAME}\n[v3]\nsubjectAltName = DNS:${RECOVERY_SUPABASE_HOSTNAME}\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,digitalSignature,keyEncipherment,keyCertSign\n`, { mode: 0o600, flag: "wx" });
  await supervisor.run(toolchain.paths.openssl.real, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", privateKeyPath,
    "-out", certificatePath,
    "-days", "1",
    "-config", configPath,
  ], { stage: "image_verification", code: "recovery_tls_material_generation_failed", timeoutMs: 60_000 });
  for (const path of [certificatePath, privateKeyPath]) {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) fail("recovery_tls_material_invalid", "image_verification");
    chmodSync(path, 0o444);
  }
  return Object.freeze({
    certificatePath: realpathSync(certificatePath),
    privateKeyPath: realpathSync(privateKeyPath),
    certificateSha256: await sha256File(certificatePath),
  });
}

function writeCandidateEntrypoint(path) {
  const source = `await import("/app/server.js");\n`;
  writeFileSync(path, source, { mode: 0o444, flag: "wx" });
}

async function inspectCandidateAttachment(state, endpoint, supervisor, toolchain, image, appPort, appContainerId) {
  const networkResult = await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "network", "inspect", state.networkName], {
    stage: "image_verification", code: "candidate_network_inspect_failed", timeoutMs: 30_000, maxCaptureBytes: 4 * 1_024 * 1_024,
  });
  const census = await containerCensus(supervisor, toolchain, state.projectName, {
    requireOwner: true,
    requireScanner: true,
    stage: "image_verification",
  });
  const containerResult = await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "inspect", "--format", SAFE_CONTAINER_INSPECT_FORMAT, ...census.ids], {
    stage: "image_verification", code: "candidate_container_inspect_failed", timeoutMs: 30_000, maxCaptureBytes: 4 * 1_024 * 1_024,
  });
  return validateCandidateNetworkAttachment(
    parsedJson(networkResult.stdout.toString("utf8"), "candidate_network_attachment_invalid", "image_verification"),
    containerResult.stdout.toString("utf8"),
    {
      appContainerId,
      appContainerName: state.appContainer,
      appNetworkAlias: state.appContainer,
      appImageId: image.id,
      appPort,
      census,
      networkName: state.networkName,
      previousMemberShapeSha256ById: Object.freeze(Object.fromEntries(
        state.supabaseContainerIds.map((id) => [id, endpoint.memberShapeSha256ById[id]]),
      )),
      previousMemberIds: endpoint.memberIds,
      projectName: state.projectName,
      scanner: state.scannerIdentity,
    },
  );
}

async function startCandidateApp(options, status, actors, state, supervisor, toolchain, image, scanner, appPort, interruptionGuard) {
  const endpoint = await inspectLocalSupabaseNetwork(state, status, supervisor, toolchain);
  const envFile = join(state.harnessRoot, "candidate.env");
  const entrypoint = join(state.harnessRoot, "candidate-entrypoint.mjs");
  writeCandidateEntrypoint(entrypoint);
  const tls = await createRecoveryTlsMaterial(state, supervisor, toolchain);
  const observabilitySecret = randomBytes(48).toString("base64url");
  const environment = {
    NODE_ENV: "production",
    PORT: String(appPort),
    HOSTNAME: "0.0.0.0",
    NEXT_PUBLIC_SUPABASE_URL: `https://${RECOVERY_SUPABASE_HOSTNAME}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: status.serviceRoleKey,
    EVO_PLATFORM_ORGANIZATION_ID: options.platformOrganizationId,
    EVO_PLATFORM_P7A_AUDIT_ENABLED: "1",
    EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
    EVO_PLATFORM_AI_MEMORY_ENABLED: "0",
    EVO_PLATFORM_STAFF_ASSISTANT_ENABLED: "0",
    EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED: "0",
    EVO_CLAMD_HOST: scanner.networkHost,
    EVO_CLAMD_PORT: "3310",
    EVO_CLAMD_TIMEOUT_MS: "10000",
    EVO_V2_AMOCRM_WRITES_ENABLED: "0",
    EVO_V2_AMOCRM_PROVIDER_AUTHORIZED: "0",
    EVO_ENABLE_EXTERNAL_TRANSCRIPT_IMPROVEMENT: "0",
    EVO_PLATFORM_GEMINI_API_KEY: "",
    EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "",
    EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: observabilitySecret,
    NODE_EXTRA_CA_CERTS: "/run/evo-recovery-ca.pem",
  };
  writeFileSync(envFile, `${Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600, flag: "wx" });
  beginContainerMutationCapture(state, "candidate_start");
  state.appContainer = `supabase_app_${state.projectName}`;
  const started = await runDocker(supervisor, toolchain.paths.docker, [
    "--context", "orbstack", "run", "--detach", "--name", state.appContainer,
    "--label", `evo.recovery.owner=${state.projectName}`,
    "--label", `evo.recovery.project=${state.projectName}`,
    "--label", "evo.recovery.type=candidate-app",
    "--network", state.networkName,
    "--network-alias", state.appContainer,
    "--add-host", `${RECOVERY_SUPABASE_HOSTNAME}:127.0.0.1`,
    "--publish", `127.0.0.1:${appPort}:${appPort}`,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--env-file", envFile,
    "--mount", `type=bind,source=${entrypoint},target=/opt/evo-recovery-entry.mjs,readonly`,
    "--mount", `type=bind,source=${tls.certificatePath},target=/run/evo-recovery-ca.pem,readonly`,
    "--entrypoint", "node",
    image.id,
    "/opt/evo-recovery-entry.mjs",
  ], { stage: "image_verification", code: "candidate_container_start_failed", timeoutMs: 2 * 60 * 1_000 });
  const containerId = started.stdout.toString("utf8").trim();
  if (!/^[0-9a-f]{64}$/u.test(containerId)) fail("candidate_container_id_invalid", "image_verification");
  state.appContainerId = containerId;
  const appUrl = `http://127.0.0.1:${appPort}`;
  const appNetworkAttachment = await inspectCandidateAttachment(state, endpoint, supervisor, toolchain, image, appPort, containerId);
  const runtimeInternetTcpEgress = Object.freeze({
    app: await proveRecoveryContainerInternetTcpBlocked(
      containerId,
      endpoint.targetHost,
      endpoint.targetPort,
      supervisor,
      toolchain,
      "image_verification",
    ),
    scanner: await proveRecoveryContainerInternetTcpBlocked(
      scanner.containerId,
      endpoint.targetHost,
      endpoint.targetPort,
      supervisor,
      toolchain,
      "image_verification",
    ),
  });
  state.isolationInput.destination = {
    ...state.isolationInput.destination,
    urls: [...state.isolationInput.destination.urls, appUrl],
    appNetworkAttachment,
  };
  state.isolationEvidence = buildIsolationEvidence(state.isolationInput, { requireComplete: true, requireAppNetwork: true });
  state.appProxyContainer = `supabase_app_proxy_${state.projectName}`;
  const proxySource = String.raw`
const fs = require("node:fs");
const net = require("node:net");
const tls = require("node:tls");
const [targetHost, targetPortRaw] = process.argv.slice(1);
const targetPort = Number(targetPortRaw);
const server = tls.createServer({
  cert: fs.readFileSync("/run/evo-recovery-cert.pem"),
  key: fs.readFileSync("/run/evo-recovery-key.pem"),
}, (client) => {
  const upstream = net.connect({ host: targetHost, port: targetPort });
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
});
server.listen(443, "0.0.0.0");
`;
  const proxyStarted = await runDocker(supervisor, toolchain.paths.docker, [
    "--context", "orbstack", "run", "--detach", "--name", state.appProxyContainer,
    "--label", `evo.recovery.project=${state.projectName}`,
    "--label", `evo.recovery.proxy=${state.projectName}`,
    "--label", "evo.recovery.type=app-tls-proxy",
    "--network", `container:${state.appContainer}`,
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--mount", `type=bind,source=${tls.certificatePath},target=/run/evo-recovery-cert.pem,readonly`,
    "--mount", `type=bind,source=${tls.privateKeyPath},target=/run/evo-recovery-key.pem,readonly`,
    "--entrypoint", "node",
    image.id,
    "--eval", proxySource,
    endpoint.targetHost, String(endpoint.targetPort),
  ], { stage: "image_verification", code: "recovery_app_tls_proxy_start_failed", timeoutMs: 2 * 60 * 1_000 });
  const proxyContainerId = proxyStarted.stdout.toString("utf8").trim();
  if (!SHA256.test(proxyContainerId)) fail("recovery_app_tls_proxy_id_invalid", "image_verification");
  state.appProxyContainerId = proxyContainerId;
  completeContainerMutationCapture(state, "candidate_start");
  await waitForHttp(`${appUrl}/api/health`, [200], 3 * 60 * 1_000, "candidate_app_start_timeout", "image_verification", state, interruptionGuard);
  return Object.freeze({
    appUrl,
    observabilitySecret,
    actors,
    supabaseTls: Object.freeze({
      origin: `https://${RECOVERY_SUPABASE_HOSTNAME}`,
      certificateSha256: tls.certificateSha256,
    }),
    runtimeInternetTcpEgress,
  });
}

export function isTrustedPlaywrightChromiumVersion(value) {
  return typeof value === "string" && PLAYWRIGHT_CHROMIUM_VERSION.test(value);
}

export function validatePinnedPlaywrightBrowser(value, bindings = PLAYWRIGHT_BROWSER_BINDINGS) {
  exactKeys(value, [
    "ambientPathPresent",
    "architecture",
    "binarySha256",
    "canonicalPath",
    "currentUid",
    "expectedPath",
    "isFile",
    "isSymbolicLink",
    "mode",
    "ownerUid",
    "platform",
    "playwrightPath",
    "version",
  ], "browser_executable_untrusted", "browser_proof");
  if (value.ambientPathPresent !== false) fail("browser_ambient_path_forbidden", "browser_proof");
  const binding = bindings?.[`${value.platform}-${value.architecture}`];
  if (!isRecord(binding) || !SHA256.test(binding.sha256 ?? "")) {
    fail("browser_platform_unsupported", "browser_proof");
  }
  if (
    value.expectedPath !== value.canonicalPath ||
    value.playwrightPath !== value.canonicalPath ||
    value.isFile !== true ||
    value.isSymbolicLink !== false ||
    !Number.isSafeInteger(value.mode) ||
    (value.mode & 0o111) === 0 ||
    (value.mode & 0o022) !== 0 ||
    (value.currentUid !== null && value.ownerUid !== value.currentUid) ||
    value.binarySha256 !== binding.sha256 ||
    value.version !== binding.version
  ) {
    fail("browser_executable_untrusted", "browser_proof");
  }
  return Object.freeze({ version: binding.version, binarySha256: binding.sha256 });
}

export function validateBrowserDebuggerUrl(value, debugPort) {
  string(value, null, "browser_debug_endpoint_invalid", "browser_proof", 2_048);
  if (!Number.isSafeInteger(debugPort) || debugPort < 1_024 || debugPort > 65_535) {
    fail("browser_debug_endpoint_invalid", "browser_proof");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("browser_debug_endpoint_invalid", "browser_proof");
  }
  if (
    parsed.protocol !== "ws:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== String(debugPort) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/devtools\/browser\/[A-Za-z0-9-]{1,128}$/u.test(parsed.pathname)
  ) {
    fail("browser_debug_endpoint_invalid", "browser_proof");
  }
  return parsed.toString();
}

async function browserExecutable(supervisor) {
  const ambientPathPresent = Object.prototype.hasOwnProperty.call(process.env, "PLAYWRIGHT_BROWSERS_PATH");
  if (ambientPathPresent) fail("browser_ambient_path_forbidden", "browser_proof");
  const binding = PLAYWRIGHT_BROWSER_BINDINGS[`${process.platform}-${process.arch}`];
  if (!binding) fail("browser_platform_unsupported", "browser_proof");
  const expectedPath = join(
    realpathSync(homedir()),
    "Library",
    "Caches",
    "ms-playwright",
    `chromium-${binding.revision}`,
    binding.directory,
    binding.executable,
  );
  let canonicalPath;
  let metadata;
  let binarySha256;
  let chromium;
  try {
    canonicalPath = realpathSync(expectedPath);
    metadata = lstatSync(expectedPath);
    binarySha256 = await sha256File(expectedPath);
    ({ chromium } = await import("@playwright/test"));
  } catch {
    fail("browser_executable_untrusted", "browser_proof");
  }
  let playwrightPath;
  try {
    playwrightPath = realpathSync(chromium.executablePath());
  } catch {
    fail("browser_executable_untrusted", "browser_proof");
  }
  if (binarySha256 !== binding.sha256) fail("browser_executable_untrusted", "browser_proof");
  const version = await supervisor.run(canonicalPath, ["--version"], {
    stage: "browser_proof",
    code: "browser_version_failed",
    timeoutMs: 10_000,
  });
  const value = version.stdout.toString("utf8").trim();
  if (!isTrustedPlaywrightChromiumVersion(value)) fail("browser_version_invalid", "browser_proof");
  validatePinnedPlaywrightBrowser({
    ambientPathPresent,
    architecture: process.arch,
    binarySha256,
    canonicalPath,
    currentUid: typeof process.getuid === "function" ? process.getuid() : null,
    expectedPath,
    isFile: metadata.isFile(),
    isSymbolicLink: metadata.isSymbolicLink(),
    mode: metadata.mode,
    ownerUid: metadata.uid,
    platform: process.platform,
    playwrightPath,
    version: value,
  });
  return Object.freeze({ chromium, path: canonicalPath, version: value, binarySha256 });
}

async function proveBrowserHostSandbox(supervisor, toolchain) {
  const listener = createServer((socket) => socket.end());
  const listen = await new Promise((resolveListen, rejectListen) => {
    listener.once("error", rejectListen);
    listener.listen(0, "127.0.0.1", () => resolveListen(listener.address()));
  }).catch(() => fail("browser_sandbox_loopback_listener_failed", "browser_proof"));
  if (!isRecord(listen) || listen.address !== "127.0.0.1" || !Number.isSafeInteger(listen.port)) {
    listener.close();
    fail("browser_sandbox_loopback_listener_failed", "browser_proof");
  }
  try {
    const loopbackScript = String.raw`import { connect } from "node:net";
const socket = connect({ host: "127.0.0.1", port: Number(process.argv[1]) });
socket.once("connect", () => { process.stdout.write("loopback-ok"); socket.end(); });
socket.once("error", () => process.exit(97));
setTimeout(() => process.exit(98), 3000).unref();`;
    const loopback = await supervisor.run(toolchain.paths.sandboxExec.real, [
      "-p", BROWSER_SANDBOX_PROFILE,
      toolchain.paths.node.real,
      "--input-type=module",
      "--eval",
      loopbackScript,
      String(listen.port),
    ], {
      argv0: "sandbox-exec",
      stage: "browser_proof",
      code: "browser_sandbox_loopback_probe_failed",
      timeoutMs: 10_000,
    });
    if (loopback.stdout.toString("utf8") !== "loopback-ok") {
      fail("browser_sandbox_loopback_probe_failed", "browser_proof");
    }
  } finally {
    await new Promise((resolveClose) => listener.close(resolveClose));
  }
  const blockedScript = String.raw`import { connect } from "node:net";
const socket = connect({ host: "1.1.1.1", port: 443 });
socket.once("connect", () => process.exit(97));
socket.once("error", (error) => { if (error.code !== "EPERM") process.exit(96); process.stdout.write("sandbox-blocked"); });
setTimeout(() => process.exit(98), 3000).unref();`;
  const blocked = await supervisor.run(toolchain.paths.sandboxExec.real, [
    "-p", BROWSER_SANDBOX_PROFILE,
    toolchain.paths.node.real,
    "--input-type=module",
    "--eval",
    blockedScript,
  ], {
    argv0: "sandbox-exec",
    stage: "browser_proof",
    code: "browser_sandbox_external_probe_not_blocked",
    timeoutMs: 10_000,
  });
  if (blocked.stdout.toString("utf8") !== "sandbox-blocked") {
    fail("browser_sandbox_external_probe_not_blocked", "browser_proof");
  }
  return Object.freeze({
    status: "os_policy_enforced",
    mechanism: "macos_sandbox_exec_deny_network_outbound_except_loopback",
    profileSha256: sha256(BROWSER_SANDBOX_PROFILE),
    loopbackProbe: "allowed",
    publicIpv4Tcp443Probe: "blocked_with_eperm",
    probeTargetSha256: sha256("1.1.1.1:443"),
  });
}

export function validateBrowserRouteProof(value) {
  exactKeys(value, ["appOrigin", "requestedRoute", "responseStatus", "finalUrl", "moduleMarker", "markerVisible"], "browser_route_proof_invalid", "browser_proof");
  if (!new Set(["/v3/main", "/v3/calendar"]).has(value.requestedRoute)) fail("browser_route_proof_invalid", "browser_proof");
  if (!Number.isSafeInteger(value.responseStatus) || value.responseStatus < 200 || value.responseStatus >= 300) {
    fail("browser_route_response_failed", "browser_proof");
  }
  let origin;
  let final;
  try {
    origin = new URL(value.appOrigin);
    final = new URL(value.finalUrl);
  } catch {
    fail("browser_final_route_mismatch", "browser_proof");
  }
  if (
    final.origin !== origin.origin ||
    final.pathname !== value.requestedRoute ||
    final.search !== "" ||
    final.hash !== ""
  ) {
    fail("browser_final_route_mismatch", "browser_proof");
  }
  string(value.moduleMarker, /^[a-z][a-z0-9_]{0,63}$/u, "browser_route_proof_invalid", "browser_proof", 64);
  if (value.markerVisible !== true) fail("browser_module_marker_missing", "browser_proof");
  return Object.freeze({ route: value.requestedRoute, moduleMarker: value.moduleMarker, responseStatus: value.responseStatus });
}

export function browserRequestAllowed(requestUrl, appOrigin) {
  try {
    const allowed = new URL(appOrigin);
    const requested = new URL(requestUrl);
    return allowed.protocol === "http:" &&
      new Set(["127.0.0.1", "localhost", "[::1]"]).has(allowed.hostname) &&
      allowed.port !== "" &&
      requested.origin === allowed.origin;
  } catch {
    return false;
  }
}

export function validateBrowserNetworkProof(value) {
  exactKeys(value, [
    "allowedOriginSha256",
    "deniedExternalRequestCount",
    "serviceWorkers",
    "webSocketAttemptCount",
    "webSockets",
  ], "browser_network_proof_invalid", "browser_proof");
  string(value.allowedOriginSha256, SHA256, "browser_network_proof_invalid", "browser_proof", 64);
  integer(value.deniedExternalRequestCount, "browser_network_proof_invalid", "browser_proof");
  integer(value.webSocketAttemptCount, "browser_network_proof_invalid", "browser_proof");
  if (value.serviceWorkers !== "blocked") fail("browser_service_workers_not_blocked", "browser_proof");
  if (value.webSockets !== "blocked_all") fail("browser_websockets_not_blocked", "browser_proof");
  if (value.deniedExternalRequestCount !== 0) fail("browser_external_request_attempted", "browser_proof");
  if (value.webSocketAttemptCount !== 0) fail("browser_websocket_attempted", "browser_proof");
  return Object.freeze({ ...value });
}

export async function installBrowserWebSocketBlocker(context, browserNetwork, browserStep = async (operation) => await operation()) {
  await browserStep(async () => await context.routeWebSocket("**/*", async (webSocket) => {
    browserNetwork.webSocketAttemptCount += 1;
    await webSocket.close({ code: 1008, reason: "Blocked by recovery isolation" });
  }));
}

async function proveFailClosedReadiness(app, interruptionGuard) {
  const requestId = randomUUID();
  const timestamp = String(Date.now());
  const hmac = createHmac("sha256", app.observabilitySecret)
    .update(`GET\n/api/readiness\n${requestId}\n${timestamp}`)
    .digest("hex");
  const response = await apiRequest(new URL("/api/readiness", app.appUrl), {
    headers: {
      "x-evo-observability-request-id": requestId,
      "x-evo-observability-timestamp": timestamp,
      "x-evo-observability-hmac-algorithm": "sha256",
      "x-evo-observability-hmac": hmac,
    },
  }, [503], "readiness_fail_closed_status_invalid", "browser_proof", interruptionGuard);
  let payload;
  try {
    payload = await interruptionGuard.run("browser_proof", async () => await response.json());
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    payload = null;
  }
  if (
    !isRecord(payload) || payload.status !== "not_ready" ||
    payload.components?.supabase?.status !== "ready" ||
    payload.components?.audit_append?.status !== "ready" ||
    payload.components?.waha?.status === "ready" ||
    payload.components?.ai?.status === "ready" ||
    payload.signals?.waha_evidence_kind !== "configuration_check" ||
    payload.signals?.ai_evidence_kind !== "configuration_check"
  ) {
    fail("readiness_component_contract_failed", "browser_proof");
  }
  return Object.freeze({
    status: "not_ready",
    supabase: "ready",
    auditAppend: "ready",
    providersBlocked: true,
  });
}

async function browserCompanyFileUpload(page, appUrl, companyFile, bytes, filename, requestId) {
  return await page.evaluate(async ({ baseUrl, fileId, expectedVersion, encoded, name, id }) => {
    const form = new FormData();
    form.set("expected_file_version", expectedVersion);
    form.set("request_id", id);
    const binary = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    form.set("file", new File([binary], name, { type: "text/plain" }));
    const response = await fetch(`${baseUrl}/api/v3/company-files/${encodeURIComponent(fileId)}/versions`, { method: "POST", body: form });
    return Object.freeze({ status: response.status, payload: await response.json().catch(() => null) });
  }, {
    baseUrl: appUrl,
    fileId: companyFile.id,
    expectedVersion: companyFile.version,
    encoded: Buffer.from(bytes).toString("base64"),
    name: filename,
    id: requestId,
  });
}

async function readScannerPersistenceState(status, supervisor, toolchain) {
  const value = await psqlJson(supervisor, toolchain, status, `SELECT json_build_object(
    'reservations', (SELECT count(*) FROM platform_private.company_file_upload_reservations),
    'finalizations', (SELECT count(*) FROM platform_private.company_file_upload_finalizations),
    'versions', (SELECT count(*) FROM platform.company_file_versions),
    'proofs', (SELECT count(*) FROM platform_private.company_file_malware_scan_attestations),
    'storageObjects', (SELECT count(*) FROM storage.objects)
  )::text`, "malware_scanner_proof");
  if (!isRecord(value) || Object.values(value).some((count) => !Number.isSafeInteger(Number(count)) || Number(count) < 0)) {
    fail("malware_persistence_inventory_invalid", "malware_scanner_proof");
  }
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, count]) => [key, Number(count)])));
}

async function readCompanyFileScannerAttestation(status, organizationId, companyFileId, companyFileVersionId, supervisor, toolchain) {
  const value = await psqlJson(supervisor, toolchain, status, `SELECT coalesce((
    SELECT json_build_object(
      'engine', attestation.scanner_engine,
      'engineVersion', attestation.scanner_engine_version,
      'signatureVersion', attestation.scanner_signature_version,
      'protocol', attestation.scanner_protocol,
      'scannedAt', attestation.scanned_at,
      'sha256Hex', attestation.scanned_sha256_hex
    )
    FROM platform_private.company_file_malware_scan_attestations AS attestation
    WHERE attestation.organization_id = ${sqlLiteral(organizationId)}::uuid
      AND attestation.company_file_id = ${sqlLiteral(companyFileId)}::uuid
      AND attestation.company_file_version_id = ${sqlLiteral(companyFileVersionId)}::uuid
  ), 'null'::json)::text`, "malware_scanner_proof");
  if (!isRecord(value)) fail("malware_scanner_attestation_missing", "malware_scanner_proof");
  return Object.freeze(value);
}

function assertScannerAttestation(proof, expectedSha256, code) {
  if (
    proof.engine !== "ClamAV" || proof.protocol !== "clamd-zinstream-v1" ||
    proof.sha256Hex !== expectedSha256 || !Number.isFinite(Date.parse(proof.scannedAt ?? "")) ||
    typeof proof.engineVersion !== "string" || !/^[0-9][0-9A-Za-z.+~-]{0,63}$/u.test(proof.engineVersion) ||
    typeof proof.signatureVersion !== "string" || !/^[1-9][0-9]{0,18}$/u.test(proof.signatureVersion)
  ) fail(code, "malware_scanner_proof");
}

async function proveScannerDataPath(status, adminActor, page, appUrl, scanner, supervisor, toolchain, interruptionGuard) {
  const created = await platformRpc(status, adminActor, "create_company_file", {
    p_organization_id: adminActor.organizationId,
    p_folder_id: null,
    p_display_name: `Recovery scanner proof ${randomUUID()}`,
    p_request_id: randomUUID(),
  }, interruptionGuard);
  if (!isRecord(created) || !UUID.test(created.company_file_id) || typeof created.version !== "string" || !/^\d+$/u.test(created.version)) {
    fail("scanner_proof_company_file_invalid", "malware_scanner_proof");
  }
  let companyFile = Object.freeze({ id: created.company_file_id, version: created.version });
  const cleanBytes = Buffer.from("EVO recovery clean company file\n", "utf8");
  const clean = await browserCompanyFileUpload(page, appUrl, companyFile, cleanBytes, "recovery-clean.txt", randomUUID());
  if (
    clean.status !== 201 || !isRecord(clean.payload?.companyFile) ||
    clean.payload.companyFile.companyFileId !== companyFile.id ||
    !UUID.test(clean.payload.companyFile.companyFileVersionId ?? "") ||
    typeof clean.payload.companyFile.fileVersion !== "string" ||
    clean.payload.companyFile.sha256Hex !== sha256(cleanBytes)
  ) fail("malware_scanner_clean_data_path_failed", "malware_scanner_proof");
  const cleanAttestation = await readCompanyFileScannerAttestation(status, adminActor.organizationId, companyFile.id, clean.payload.companyFile.companyFileVersionId, supervisor, toolchain);
  assertScannerAttestation(cleanAttestation, sha256(cleanBytes), "malware_scanner_clean_attestation_invalid");
  companyFile = Object.freeze({ ...companyFile, version: clean.payload.companyFile.fileVersion });
  const afterClean = await readScannerPersistenceState(status, supervisor, toolchain);

  const infected = await browserCompanyFileUpload(page, appUrl, companyFile, Buffer.from(EICAR, "ascii"), "recovery-eicar.txt", randomUUID());
  if (infected.status !== 422 || infected.payload?.error !== "malware_detected") fail("malware_scanner_eicar_data_path_not_blocked", "malware_scanner_proof");
  if (!sameJson(await readScannerPersistenceState(status, supervisor, toolchain), afterClean)) fail("malware_scanner_eicar_persisted_state", "malware_scanner_proof");

  await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "stop", "--time", "30", scanner.containerId], {
    stage: "malware_scanner_proof", code: "malware_scanner_outage_stop_failed", timeoutMs: 60_000,
  });
  const outage = await browserCompanyFileUpload(page, appUrl, companyFile, Buffer.from("EVO recovery scanner outage proof\n", "utf8"), "recovery-outage.txt", randomUUID());
  if (outage.status !== 503 || outage.payload?.error !== "malware_scanner_unavailable") fail("malware_scanner_outage_not_fail_closed", "malware_scanner_proof");
  if (!sameJson(await readScannerPersistenceState(status, supervisor, toolchain), afterClean)) fail("malware_scanner_outage_persisted_state", "malware_scanner_proof");

  await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", "start", scanner.containerId], {
    stage: "malware_scanner_proof", code: "malware_scanner_recovery_start_failed", timeoutMs: 60_000,
  });
  await waitForRecoveryScanner(scanner.containerId, supervisor, toolchain, interruptionGuard);
  const recoveredBytes = Buffer.from("EVO recovery scanner restored proof\n", "utf8");
  const recovered = await browserCompanyFileUpload(page, appUrl, companyFile, recoveredBytes, "recovery-restored.txt", randomUUID());
  if (
    recovered.status !== 201 || !isRecord(recovered.payload?.companyFile) ||
    recovered.payload.companyFile.companyFileId !== companyFile.id ||
    !UUID.test(recovered.payload.companyFile.companyFileVersionId ?? "") ||
    recovered.payload.companyFile.sha256Hex !== sha256(recoveredBytes)
  ) fail("malware_scanner_recovered_data_path_failed", "malware_scanner_proof");
  const recoveredAttestation = await readCompanyFileScannerAttestation(status, adminActor.organizationId, companyFile.id, recovered.payload.companyFile.companyFileVersionId, supervisor, toolchain);
  assertScannerAttestation(recoveredAttestation, sha256(recoveredBytes), "malware_scanner_recovered_attestation_invalid");
  const afterRecovered = await readScannerPersistenceState(status, supervisor, toolchain);
  for (const key of ["reservations", "finalizations", "versions", "proofs", "storageObjects"]) {
    if (afterRecovered[key] !== afterClean[key] + 1) fail("malware_scanner_recovered_persistence_invalid", "malware_scanner_proof");
  }
  return Object.freeze({
    image: scanner.image,
    network: scanner.network,
    publish: scanner.publish,
    clean: "passed_with_persisted_attestation",
    eicar: "blocked_without_persistence",
    outage: "blocked_without_persistence",
    recovery: "passed_with_persisted_attestation",
  });
}

async function proveBrowserDocumentDownload(page, appUrl, status, document, allowed, role, browserStep) {
  const response = await browserStep(async () => await page.request.get(
    `${appUrl}/api/v2/document-versions/${document.versionId}/download`,
    { failOnStatusCode: false, maxRedirects: 0 },
  ));
  if (!allowed) {
    if (response.status() !== 403) fail(`browser_${role}_document_denial_failed`, "browser_proof");
    return;
  }
  if (response.status() !== 307) fail(`browser_${role}_document_grant_failed`, "browser_proof");
  const location = response.headers().location;
  let signedUrl;
  try {
    signedUrl = resolveStorageSignedObjectUrl(
      `https://${RECOVERY_SUPABASE_HOSTNAME}`,
      document.bucketId,
      document.objectName,
      location,
    );
  } catch (error) {
    if (error instanceof RecoveryFailure && error.code === "private_document_signed_url_invalid") {
      fail(`browser_${role}_document_redirect_invalid`, "browser_proof");
    }
    throw error;
  }
  if (signedUrl.protocol !== "https:" || signedUrl.hostname !== RECOVERY_SUPABASE_HOSTNAME) {
    fail(`browser_${role}_document_redirect_invalid`, "browser_proof");
  }
  const localSignedUrl = new URL(`${signedUrl.pathname}${signedUrl.search}`, status.apiUrl);
  const download = await browserStep(async () => await page.request.get(localSignedUrl.toString(), {
    failOnStatusCode: false,
    maxRedirects: 0,
  }));
  if (download.status() !== 200) fail(`browser_${role}_document_download_failed`, "browser_proof");
  const bytes = Buffer.from(await browserStep(async () => await download.body()));
  if (bytes.byteLength !== document.byteSize || sha256(bytes) !== document.sha256Hex) {
    fail(`browser_${role}_document_bytes_mismatch`, "browser_proof");
  }
}

async function proveBrowserSalesReadback(page, appUrl, salesProof, role, browserStep) {
  await browserStep(async () => await page.goto(`${appUrl}/v3/pipeline`, { waitUntil: "domcontentloaded" }));
  await browserStep(async () => await page.getByTestId("v3-shell").waitFor({ state: "visible", timeout: 45_000 }));
  const panel = await browserStep(async () => page.locator(
    `[data-testid="v3-pipeline-decision"][data-lead-id="${salesProof.leadId}"]`,
  ));
  await browserStep(async () => await panel.waitFor({ state: "visible", timeout: 45_000 }));
  if (await browserStep(async () => await panel.getAttribute("open")) === null) {
    await browserStep(async () => await panel.locator("summary").click());
  }
  const form = await browserStep(async () => panel.getByTestId("v3-pipeline-workflow-form"));
  await browserStep(async () => await form.waitFor({ state: "visible", timeout: 45_000 }));
  const marker = await browserStep(async () => await form.getByTestId("v3-pipeline-next-action").inputValue());
  const version = Number(await browserStep(async () => await form.locator('input[name="expected_version"]').inputValue()));
  if (marker !== salesProof.marker || version !== salesProof.workflowVersion) {
    fail(`browser_${role}_sales_readback_failed`, "browser_proof");
  }
}

async function proveBrowserAdmissionsReadback(page, appUrl, admissionsProof, role, browserStep) {
  await browserStep(async () => await page.goto(
    `${appUrl}/v3/calendar?view=day&date=${admissionsProof.browserDay}`,
    { waitUntil: "domcontentloaded" },
  ));
  await browserStep(async () => await page.getByTestId("v3-shell").waitFor({ state: "visible", timeout: 45_000 }));
  const task = await browserStep(async () => page.locator(`#task-${admissionsProof.taskId}`));
  await browserStep(async () => await task.waitFor({ state: "visible", timeout: 45_000 }));
  await browserStep(async () => await task.click());
  const controls = await browserStep(async () => page.getByTestId("v3-calendar-task-controls"));
  await browserStep(async () => await controls.waitFor({ state: "visible", timeout: 45_000 }));
  const form = await browserStep(async () => controls.getByTestId("v3-calendar-task-change-form"));
  if (!(await browserStep(async () => await form.isVisible()))) {
    await browserStep(async () => await controls.getByText("Изменить задачу", { exact: true }).click());
  }
  await browserStep(async () => await form.waitFor({ state: "visible", timeout: 45_000 }));
  const statusValue = await browserStep(async () => await form.locator('select[name="status"]').inputValue());
  const version = Number(await browserStep(async () => await form.locator('input[name="expected_version"]').inputValue()));
  if (statusValue !== admissionsProof.status || version !== admissionsProof.version) {
    fail(`browser_${role}_admissions_readback_failed`, "browser_proof");
  }
}

async function proveBrowser(app, status, scanner, roleServerProof, state, supervisor, toolchain, interruptionGuard) {
  const browserStep = async (operation, options) => await runBrowserOperation(interruptionGuard, operation, options);
  let browserPhase = "tool_binding";
  let browserTool;
  let browserSandbox;
  let browserRecord;
  let browser;
  try {
    browserTool = await browserExecutable(supervisor);
    state.availableTools.chromium = browserTool.version;
    state.availableTools.chromium_binary_sha256 = browserTool.binarySha256;
    browserPhase = "sandbox_validation";
    browserSandbox = await proveBrowserHostSandbox(supervisor, toolchain);
    browserPhase = "debug_port_reservation";
    const debugPort = await reservePort();
    const profile = join(state.harnessRoot, "chromium-profile");
    mkdirSync(profile, { mode: 0o700 });
    browserPhase = "process_start";
    browserRecord = supervisor.start(toolchain.paths.sandboxExec.real, [
      "-p", BROWSER_SANDBOX_PROFILE,
      browserTool.path,
      "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
      `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`, "about:blank",
    ], { argv0: "sandbox-exec", stage: "browser_proof", maxCaptureBytes: 2 * 1_024 * 1_024 });
    state.browserRecord = browserRecord;
    browserPhase = "startup";
    const versionResponse = await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, [200], 45_000, "browser_start_timeout", "browser_proof", state, interruptionGuard);
    let versionPayload;
    try {
      versionPayload = await browserStep(async () => await versionResponse.json());
    } catch (error) {
      if (error instanceof RecoveryFailure) throw error;
      versionPayload = null;
    }
    if (!isRecord(versionPayload) || typeof versionPayload.webSocketDebuggerUrl !== "string") fail("browser_debug_endpoint_invalid", "browser_proof");
    const debuggerUrl = validateBrowserDebuggerUrl(versionPayload.webSocketDebuggerUrl, debugPort);
    browserPhase = "connect";
    browser = await browserStep(async () => await browserTool.chromium.connectOverCDP(debuggerUrl, { timeout: 10_000 }));
    const routes = Object.freeze({
      admin: Object.freeze({ path: "/v3/main", marker: "main_heading", heading: "EVO Admissions" }),
      sales: Object.freeze({ path: "/v3/main", marker: "main_heading", heading: "EVO Admissions" }),
      admissions: Object.freeze({ path: "/v3/calendar", marker: "calendar_heading", heading: "Календарь" }),
    });
    const routeProofs = {};
    const roleReadbacks = {};
    let scannerDataPath;
    const browserNetwork = {
      allowedOriginSha256: sha256(new URL(app.appUrl).origin),
      deniedExternalRequestCount: 0,
      serviceWorkers: "blocked",
      webSocketAttemptCount: 0,
      webSockets: "blocked_all",
    };
    const availableRoles = ["admin", "sales", "admissions"].filter((role) => isRecord(app.actors[role]));
    if (availableRoles.length === 0) fail("browser_representative_missing", "browser_proof");
    for (const role of availableRoles) {
      browserPhase = `${role}_context`;
      const context = await browserStep(async () => await browser.newContext({ locale: "ru-RU", serviceWorkers: "block" }));
      await browserStep(async () => await context.route("**/*", async (route) => {
        if (interruptionGuard.interrupted) {
          await route.abort("blockedbyclient");
          return;
        }
        if (browserRequestAllowed(route.request().url(), app.appUrl)) {
          await route.continue();
          return;
        }
        browserNetwork.deniedExternalRequestCount += 1;
        await route.abort("blockedbyclient");
      }));
      await installBrowserWebSocketBlocker(context, browserNetwork, browserStep);
      const page = await browserStep(async () => await context.newPage());
      browserPhase = `${role}_login`;
      await browserStep(async () => await page.goto(`${app.appUrl}/login`, { waitUntil: "domcontentloaded" }));
      await browserStep(async () => await page.locator("#staff-email").fill(app.actors[role].email));
      await browserStep(async () => await page.locator("#staff-password").fill(app.actors[role].password));
      await browserStep(async () => await page.getByRole("button", { name: "Войти в CRM" }).click());
      const shell = await browserStep(async () => page.getByTestId("v3-shell"));
      await browserStep(async () => await shell.waitFor({ state: "visible", timeout: 45_000 }));
      if (await browserStep(async () => await shell.getAttribute("data-authority-role")) !== role) {
        fail("browser_role_mismatch", "browser_proof", { role });
      }
      browserPhase = `${role}_route`;
      const route = routes[role];
      const response = await browserStep(async () => await page.goto(`${app.appUrl}${route.path}`, { waitUntil: "domcontentloaded" }));
      await browserStep(async () => await page.getByTestId("v3-shell").waitFor({ state: "visible", timeout: 45_000 }));
      let markerVisible = false;
      try {
        await browserStep(async () => await page.getByRole("heading", { name: route.heading, exact: true }).waitFor({ state: "visible", timeout: 45_000 }));
        await browserStep(async () => await page.getByTestId("v3-operational-dashboard").waitFor({ state: "visible", timeout: 45_000 }));
        markerVisible = true;
      } catch (error) {
        interruptionGuard.assertActive("browser_proof", { afterOperation: true });
        if (error instanceof RecoveryFailure) throw error;
        markerVisible = false;
      }
      const navigation = await browserStep(async () => Object.freeze({
        responseStatus: response?.status() ?? 0,
        finalUrl: page.url(),
      }));
      routeProofs[role] = await browserStep(async () => validateBrowserRouteProof({
        appOrigin: app.appUrl,
        requestedRoute: route.path,
        responseStatus: navigation.responseStatus,
        finalUrl: navigation.finalUrl,
        moduleMarker: route.marker,
        markerVisible,
      }));
      if (role === "admin") {
        browserPhase = "admin_scanner";
        scannerDataPath = await proveScannerDataPath(
          status,
          app.actors.admin,
          page,
          app.appUrl,
          scanner,
          supervisor,
          toolchain,
          interruptionGuard,
        );
        if (roleServerProof?.sales) {
          browserPhase = "admin_sales_readback";
          await proveBrowserSalesReadback(page, app.appUrl, roleServerProof.sales, role, browserStep);
        }
        if (roleServerProof?.admissions) {
          browserPhase = "admin_admissions_readback";
          await proveBrowserAdmissionsReadback(page, app.appUrl, roleServerProof.admissions, role, browserStep);
        }
        if (roleServerProof?.document) {
          browserPhase = "admin_document_readback";
          await proveBrowserDocumentDownload(page, app.appUrl, status, roleServerProof.document, true, role, browserStep);
        }
        roleReadbacks.admin = roleServerProof?.outcomes?.admin === "passed" &&
          roleServerProof.sales && roleServerProof.admissions && roleServerProof.document
          ? "passed"
          : "not_run_incomplete_server_outcomes";
      } else if (role === "sales") {
        if (roleServerProof?.sales) {
          browserPhase = "sales_readback";
          await proveBrowserSalesReadback(page, app.appUrl, roleServerProof.sales, role, browserStep);
        }
        if (roleServerProof?.document) {
          browserPhase = "sales_document_readback";
          await proveBrowserDocumentDownload(page, app.appUrl, status, roleServerProof.document, false, role, browserStep);
        }
        roleReadbacks.sales = roleServerProof?.outcomes?.sales === "passed" &&
          roleServerProof.sales && roleServerProof.document
          ? "passed"
          : "not_run_incomplete_server_outcomes";
      } else if (role === "admissions") {
        if (roleServerProof?.admissions) {
          browserPhase = "admissions_readback";
          await proveBrowserAdmissionsReadback(page, app.appUrl, roleServerProof.admissions, role, browserStep);
        }
        if (roleServerProof?.document) {
          browserPhase = "admissions_document_readback";
          await proveBrowserDocumentDownload(page, app.appUrl, status, roleServerProof.document, true, role, browserStep);
        }
        roleReadbacks.admissions = roleServerProof?.outcomes?.admissions === "passed" &&
          roleServerProof.admissions && roleServerProof.document
          ? "passed"
          : "not_run_incomplete_server_outcomes";
      }
      browserPhase = `${role}_context_close`;
      await browserStep(async () => await context.close(), { allowAfterInterrupt: true });
      validateBrowserNetworkProof(browserNetwork);
    }
    for (const role of ["admin", "sales", "admissions"]) {
      roleReadbacks[role] ??= "not_run_missing_representative";
    }
    browserPhase = "readiness";
    const readiness = await proveFailClosedReadiness(app, interruptionGuard);
    return Object.freeze({
      admin: availableRoles.includes("admin") ? "passed" : "not_run_missing_representative",
      sales: availableRoles.includes("sales") ? "passed" : "not_run_missing_representative",
      admissions: availableRoles.includes("admissions") ? "passed" : "not_run_missing_representative",
      routes: Object.freeze(routeProofs),
      roleOutcomes: Object.freeze(roleReadbacks),
      network: validateBrowserNetworkProof(browserNetwork),
      sandbox: browserSandbox,
      chromium: browserTool.version,
      exactCandidateImage: true,
      readiness,
      supabaseTls: app.supabaseTls,
      malwareScanner: scannerDataPath,
      evidenceScope: availableRoles.length === 3
        ? "complete_real_representative_browser_proof"
        : "available_real_representatives_only",
    });
  } catch (error) {
    if (error instanceof RecoveryFailure) throw error;
    fail(`browser_${browserPhase}_operation_failed`, "browser_proof", sanitizeBrowserDiagnostic(error));
  } finally {
    if (browser) {
      await browserStep(async () => await browser.close(), { allowAfterInterrupt: true }).catch(() => undefined);
    }
    if (browserRecord) {
      const drained = await supervisor.stopOne(browserRecord);
      state.browserRecord = undefined;
      if (!drained) fail("browser_descendants_not_drained", "browser_proof");
    }
  }
}

function identityStrings(values, code) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0 || value.length > 8_192)) {
    fail(code, "isolation_identity");
  }
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function normalizedEndpointIdentity(value, destination) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("endpoint_identity_invalid", "isolation_identity");
  }
  if (!new Set(["http:", "https:", "postgres:", "postgresql:"]).has(parsed.protocol)) {
    fail("endpoint_identity_invalid", "isolation_identity");
  }
  if (destination && !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    fail("destination_endpoint_not_loopback", "isolation_identity");
  }
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}//${parsed.hostname}${port}${parsed.pathname}`;
}

function disjoint(left, right) {
  const rightSet = new Set(right);
  return left.every((value) => !rightSet.has(value));
}

function identityDigest(values) {
  return values.length > 0 ? sha256(canonicalJson(values)) : null;
}

function sanitizedAppNetworkAttachment(value) {
  if (value === null) return null;
  exactKeys(value, [
    "appContainerIdSha256",
    "appImageIdSha256",
    "attachedNetworkCount",
    "ipMasquerade",
    "loopbackOnly",
    "networkIdSha256",
    "publishedPortCount",
    "schema",
  ], "destination_app_network_invalid", "isolation_identity");
  if (
    value.schema !== "evo-v3-recovery-app-network/v2" ||
    !SHA256.test(value.appContainerIdSha256) ||
    !SHA256.test(value.appImageIdSha256) ||
    !SHA256.test(value.networkIdSha256) ||
    value.attachedNetworkCount !== 1 ||
    value.publishedPortCount !== 1 ||
    value.loopbackOnly !== true ||
    value.ipMasquerade !== false
  ) {
    fail("destination_app_network_invalid", "isolation_identity");
  }
  return Object.freeze({ ...value });
}

export function buildIsolationEvidence(value, { requireComplete = false, requireAppNetwork = false } = {}) {
  exactKeys(value, ["source", "destination"], "isolation_identity_invalid", "isolation_identity");
  exactKeys(value.source, ["projectRef", "urls", "networks", "volumes"], "source_identity_invalid", "isolation_identity");
  exactKeys(value.destination, ["appNetworkAttachment", "projectRef", "urls", "networks", "volumes"], "destination_identity_invalid", "isolation_identity");
  const appNetworkAttachment = sanitizedAppNetworkAttachment(value.destination.appNetworkAttachment);
  const sourceRef = value.source.projectRef;
  const destinationRef = value.destination.projectRef;
  if (sourceRef !== null) string(sourceRef, PROJECT_REF, "source_identity_invalid", "isolation_identity", 20);
  string(destinationRef, null, "destination_identity_invalid", "isolation_identity", 128);
  if (sourceRef !== null && sourceRef === destinationRef) fail("source_destination_not_isolated", "isolation_identity");
  if (!/^evov3recovery[0-9a-f]{12}$/u.test(destinationRef)) fail("destination_identity_invalid", "isolation_identity");
  const sourceUrls = identityStrings(value.source.urls, "source_identity_invalid").map((url) => normalizedEndpointIdentity(url, false));
  const destinationUrlValues = identityStrings(value.destination.urls, "destination_identity_invalid");
  const destinationUrls = destinationUrlValues.map((url) => normalizedEndpointIdentity(url, false));
  const sourceNetworks = identityStrings(value.source.networks, "source_identity_invalid");
  const destinationNetworks = identityStrings(value.destination.networks, "destination_identity_invalid");
  const sourceVolumes = identityStrings(value.source.volumes, "source_identity_invalid");
  const destinationVolumes = identityStrings(value.destination.volumes, "destination_identity_invalid");
  const separation = Object.freeze({
    projectRefsUnequal: sourceRef === null ? null : sourceRef !== destinationRef,
    urlsDisjoint: sourceUrls.length === 0 || destinationUrls.length === 0 ? null : disjoint(sourceUrls, destinationUrls),
    networksDisjoint: sourceNetworks.length === 0 || destinationNetworks.length === 0 ? null : disjoint(sourceNetworks, destinationNetworks),
    volumesDisjoint: sourceVolumes.length === 0 || destinationVolumes.length === 0 ? null : disjoint(sourceVolumes, destinationVolumes),
  });
  if (Object.values(separation).some((result) => result === false)) fail("source_destination_not_isolated", "isolation_identity");
  destinationUrlValues.forEach((url) => normalizedEndpointIdentity(url, true));
  if (destinationNetworks.length > 0 && (destinationNetworks.length !== 1 || destinationNetworks[0] !== `${destinationRef}_private`)) {
    fail("destination_identity_invalid", "isolation_identity");
  }
  if (destinationVolumes.some((volume) => !volume.startsWith("supabase_") || !volume.endsWith(`_${destinationRef}`))) {
    fail("destination_identity_invalid", "isolation_identity");
  }
  const complete = sourceRef !== null &&
    sourceUrls.length > 0 && destinationUrls.length > 0 &&
    sourceNetworks.length > 0 && destinationNetworks.length > 0 &&
    sourceVolumes.length > 0 && destinationVolumes.length > 0 &&
    Object.values(separation).every((result) => result === true);
  if (requireComplete && !complete) fail("source_destination_identity_incomplete", "isolation_identity");
  if (requireAppNetwork && appNetworkAttachment === null) fail("destination_app_network_missing", "isolation_identity");
  return Object.freeze({
    status: complete ? "verified" : "partial",
    source: Object.freeze({
      projectRefSha256: sourceRef === null ? null : sha256(sourceRef),
      urlSetSha256: identityDigest(sourceUrls),
      networkSetSha256: identityDigest(sourceNetworks),
      volumeSetSha256: identityDigest(sourceVolumes),
      urlCount: sourceUrls.length,
      networkCount: sourceNetworks.length,
      volumeCount: sourceVolumes.length,
    }),
    destination: Object.freeze({
      projectRefSha256: sha256(destinationRef),
      urlSetSha256: identityDigest(destinationUrls),
      networkSetSha256: identityDigest(destinationNetworks),
      volumeSetSha256: identityDigest(destinationVolumes),
      urlCount: destinationUrls.length,
      networkCount: destinationNetworks.length,
      volumeCount: destinationVolumes.length,
      runtime: "local_orbstack",
      appNetworkAttachment,
    }),
    separation,
  });
}

function validatedHarnessRoot(path, projectName) {
  if (
    !path ||
    !isAbsolute(path) ||
    !new RegExp(`^${HARNESS_PREFIX}[A-Za-z0-9]{6}$`, "u").test(basename(path)) ||
    !/^evov3recovery[0-9a-f]{12}$/u.test(projectName ?? "")
  ) return null;
  try {
    const canonicalTmp = realpathSync(tmpdir());
    const canonical = realpathSync(path);
    const rel = relative(canonicalTmp, canonical);
    const rootMetadata = lstatSync(path);
    const markerPath = join(canonical, MARKER);
    const markerMetadata = lstatSync(markerPath);
    if (
      resolve(path) !== canonical ||
      rel.length === 0 || rel.startsWith("..") || isAbsolute(rel) ||
      !rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() ||
      typeof process.getuid !== "function" || rootMetadata.uid !== process.getuid() ||
      (rootMetadata.mode & 0o077) !== 0 ||
      !markerMetadata.isFile() || markerMetadata.isSymbolicLink() ||
      markerMetadata.uid !== process.getuid() || (markerMetadata.mode & 0o077) !== 0 ||
      readFileSync(markerPath, "utf8") !== `${projectName}\n`
    ) return null;
    return canonical;
  } catch {
    return null;
  }
}

function safeHarnessRoot(path, projectName) {
  return validatedHarnessRoot(path, projectName) !== null;
}

export function guardedRemoveHarness(path, projectName, { beforeRootRemoval = null } = {}) {
  const canonical = validatedHarnessRoot(path, projectName);
  if (canonical === null) fail("cleanup_target_invalid", "cleanup");
  const markerPath = join(canonical, MARKER);
  const markerContent = `${projectName}\n`;
  for (const entry of readdirSync(canonical)) {
    if (entry === MARKER) continue;
    rmSync(join(canonical, entry), {
      recursive: true,
      force: false,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
  unlinkSync(markerPath);
  try {
    beforeRootRemoval?.(canonical);
    rmdirSync(canonical);
  } catch {
    try {
      if (existsSync(canonical) && !existsSync(markerPath)) {
        writeFileSync(markerPath, markerContent, { mode: 0o600, flag: "wx" });
      }
    } catch {
      fail("cleanup_marker_restore_failed", "cleanup");
    }
    fail("cleanup_directory_not_empty", "cleanup");
  }
}

export function cleanupDisposition({ descendantsDrained, targetsOwned, cleanupSucceeded }) {
  return descendantsDrained && targetsOwned && cleanupSucceeded ? "remove" : "quarantine";
}

function beginContainerMutationCapture(state, stage) {
  if (
    !isRecord(state) ||
    !CONTAINER_MUTATION_CAPTURE_STAGES.has(stage) ||
    state.containerMutationCapture?.status === "pending"
  ) {
    fail("container_mutation_capture_invalid", stage);
  }
  state.containerMutationAttempted = true;
  state.containerMutationCapture = Object.freeze({ stage, status: "pending" });
}

function completeContainerMutationCapture(state, stage) {
  if (
    !isRecord(state) ||
    !CONTAINER_MUTATION_CAPTURE_STAGES.has(stage) ||
    state.containerMutationCapture?.stage !== stage ||
    state.containerMutationCapture?.status !== "pending"
  ) {
    fail("container_mutation_capture_invalid", stage);
  }
  state.containerMutationCapture = Object.freeze({ stage, status: "complete" });
}

function containerMutationCaptureComplete(state) {
  return (
    isRecord(state?.containerMutationCapture) &&
    CONTAINER_MUTATION_CAPTURE_STAGES.has(state.containerMutationCapture.stage) &&
    state.containerMutationCapture.status === "complete" &&
    Object.keys(state.containerMutationCapture).length === 2
  );
}

export function cleanupContainerPolicy(state, toolchainAvailable) {
  const mutationAttempted = state?.containerMutationAttempted === true;
  const runtimeFlags =
    state?.networkCreated === true ||
    typeof state?.networkId === "string" ||
    Array.isArray(state?.supabaseContainerIds) ||
    Array.isArray(state?.ownedVolumeNames) ||
    Array.isArray(state?.ownedVolumeIdentities) ||
    state?.stackStarted === true ||
    typeof state?.appContainer === "string" ||
    typeof state?.appContainerId === "string" ||
    typeof state?.appProxyContainer === "string" ||
    typeof state?.appProxyContainerId === "string" ||
    typeof state?.appImageTag === "string" ||
    typeof state?.appImageId === "string" ||
    isRecord(state?.appImageIdentity) ||
    typeof state?.scannerContainer === "string" ||
    typeof state?.scannerSignatureVolume === "string";
  const contradictory =
    (runtimeFlags && !mutationAttempted) ||
    (mutationAttempted && !containerMutationCaptureComplete(state)) ||
    (state?.stackStarted === true && state?.networkCreated !== true) ||
    (typeof state?.appContainer === "string" && (state?.stackStarted !== true || state?.networkCreated !== true)) ||
    ((mutationAttempted || runtimeFlags) && (state?.containerPreflightPassed !== true || toolchainAvailable !== true));
  if (contradictory) return "quarantine";
  return mutationAttempted ? "container_cleanup" : "local_only";
}

function assertCleanupProject(projectName) {
  if (!/^evov3recovery[0-9a-f]{12}$/u.test(projectName)) fail("cleanup_project_scope_invalid", "cleanup");
}

const RESERVED_RECOVERY_OWNERSHIP_LABELS = Object.freeze([
  "com.docker.compose.project",
  "com.evo.runtime.role",
  "com.supabase.cli.project",
  "evo.recovery.owner",
  "evo.recovery.project",
  "evo.recovery.proxy",
  "evo.recovery.scanner",
  "evo.recovery.type",
]);

function assertExactRecoveryOwnershipLabels(labels, required, optional, code) {
  if (!isRecord(labels) || !isRecord(required) || !isRecord(optional)) fail(code, "cleanup");
  for (const label of RESERVED_RECOVERY_OWNERSHIP_LABELS) {
    const present = Object.hasOwn(labels, label);
    if (Object.hasOwn(required, label)) {
      if (!present || labels[label] !== required[label]) fail(code, "cleanup");
    } else if (Object.hasOwn(optional, label)) {
      if (present && labels[label] !== optional[label]) fail(code, "cleanup");
    } else if (present) {
      fail(code, "cleanup");
    }
  }
}

function cleanupContainerRecords(output) {
  const records = [];
  for (const line of String(output).split(/\r?\n/u).filter(Boolean)) {
    const fields = line.split("\t");
    let id;
    let name;
    let image;
    let labels;
    try {
      [id, name, image, labels] = fields.map((field) => JSON.parse(field));
    } catch {
      fail("cleanup_container_inventory_invalid", "cleanup");
    }
    if (
      fields.length !== 4 ||
      !SHA256.test(id ?? "") ||
      typeof name !== "string" || !name.startsWith("/") ||
      !/^sha256:[0-9a-f]{64}$/u.test(image ?? "") ||
      (labels !== null && !isRecord(labels))
    ) {
      fail("cleanup_container_inventory_invalid", "cleanup");
    }
    records.push(Object.freeze({ id, name: name.slice(1), image, labels }));
  }
  if (new Set(records.map(({ id }) => id)).size !== records.length) {
    fail("cleanup_container_inventory_invalid", "cleanup");
  }
  return Object.freeze(records);
}

export function selectCandidateImageContainerReferences(output, imageId) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageId ?? "")) fail("cleanup_image_reference_invalid", "cleanup");
  return Object.freeze(cleanupContainerRecords(output)
    .filter((record) => record.image === imageId)
    .map((record) => record.id)
    .sort());
}

export function selectOwnedContainerIds(output, projectName) {
  assertCleanupProject(projectName);
  const ids = [];
  const typeCounts = { app: 0, proxy: 0, scanner: 0 };
  for (const { id, name: normalizedName, labels } of cleanupContainerRecords(output)) {
    const namedForProject = normalizedName.startsWith("supabase_") && normalizedName.endsWith(`_${projectName}`);
    const labeledForProject = isRecord(labels) && [
      labels["com.supabase.cli.project"],
      labels["evo.recovery.owner"],
      labels["evo.recovery.project"],
      labels["evo.recovery.proxy"],
      labels["evo.recovery.scanner"],
    ].includes(projectName);
    if (!namedForProject && !labeledForProject) continue;
    if (!isRecord(labels)) fail("cleanup_container_ownership_invalid", "cleanup");
    const categories = {
      app: labels["evo.recovery.owner"] === projectName,
      proxy: labels["evo.recovery.proxy"] === projectName,
      scanner: labels["evo.recovery.scanner"] === projectName,
      supabase: labels["com.supabase.cli.project"] === projectName,
    };
    if (Object.values(categories).filter(Boolean).length !== 1) fail("cleanup_container_ownership_invalid", "cleanup");
    if (categories.supabase) {
      if (!namedForProject || labels["com.docker.compose.project"] !== projectName) {
        fail("cleanup_container_ownership_invalid", "cleanup");
      }
      assertExactRecoveryOwnershipLabels(labels, {
        "com.docker.compose.project": projectName,
        "com.supabase.cli.project": projectName,
      }, {}, "cleanup_container_ownership_invalid");
    } else {
      const expected = categories.app
        ? { name: `supabase_app_${projectName}`, type: "candidate-app", count: "app" }
        : categories.proxy
          ? { name: `supabase_app_proxy_${projectName}`, type: "app-tls-proxy", count: "proxy" }
          : { name: `supabase_clamav_${projectName}`, type: "malware-scanner", count: "scanner" };
      if (
        normalizedName !== expected.name ||
        labels["evo.recovery.project"] !== projectName ||
        labels["evo.recovery.type"] !== expected.type
      ) {
        fail("cleanup_container_ownership_invalid", "cleanup");
      }
      if (categories.scanner && (
        labels["com.docker.compose.project"] !== projectName ||
        labels["com.evo.runtime.role"] !== "private-malware-scanner"
      )) {
        fail("cleanup_container_ownership_invalid", "cleanup");
      }
      assertExactRecoveryOwnershipLabels(labels, categories.app
        ? {
          "evo.recovery.owner": projectName,
          "evo.recovery.project": projectName,
          "evo.recovery.type": "candidate-app",
        }
        : categories.proxy
          ? {
            "evo.recovery.project": projectName,
            "evo.recovery.proxy": projectName,
            "evo.recovery.type": "app-tls-proxy",
          }
          : {
            "com.docker.compose.project": projectName,
            "com.evo.runtime.role": "private-malware-scanner",
            "evo.recovery.project": projectName,
            "evo.recovery.scanner": projectName,
            "evo.recovery.type": "malware-scanner",
          }, {}, "cleanup_container_ownership_invalid");
      typeCounts[expected.count] += 1;
    }
    ids.push(id);
  }
  if (Object.values(typeCounts).some((count) => count > 1) || new Set(ids).size !== ids.length) {
    fail("cleanup_container_ownership_invalid", "cleanup");
  }
  return Object.freeze(ids.sort());
}

function cleanupVolumeRecords(output) {
  const records = [];
  for (const line of String(output).split(/\r?\n/u).filter(Boolean)) {
    const fields = line.split("\t");
    let name;
    let createdAt;
    let driver;
    let scope;
    let labels;
    let options;
    try {
      [name, createdAt, driver, scope, labels, options] = fields.map((field) => JSON.parse(field));
    } catch {
      fail("cleanup_volume_inventory_invalid", "cleanup");
    }
    if (
      fields.length !== 6 ||
      typeof name !== "string" || name.length === 0 ||
      typeof createdAt !== "string" || createdAt.length === 0 ||
      typeof driver !== "string" || driver.length === 0 ||
      typeof scope !== "string" || scope.length === 0 ||
      (labels !== null && !isRecord(labels)) ||
      (options !== null && !isRecord(options))
    ) {
      fail("cleanup_volume_inventory_invalid", "cleanup");
    }
    records.push(Object.freeze({ createdAt, driver, labels, name, options, scope }));
  }
  if (new Set(records.map(({ name }) => name)).size !== records.length) fail("cleanup_volume_inventory_invalid", "cleanup");
  return Object.freeze(records);
}

function validatedCleanupVolumeIdentity(identity) {
  if (!isRecord(identity)) fail("cleanup_volume_identity_invalid", "cleanup");
  exactKeys(identity, ["createdAt", "driver", "labelsSha256", "name", "optionsSha256", "scope"], "cleanup_volume_identity_invalid", "cleanup");
  if (
    typeof identity.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/u.test(identity.name) ||
    typeof identity.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(identity.createdAt) ||
    !Number.isFinite(Date.parse(identity.createdAt)) ||
    identity.driver !== "local" || identity.scope !== "local" ||
    !SHA256.test(identity.labelsSha256 ?? "") || !SHA256.test(identity.optionsSha256 ?? "")
  ) {
    fail("cleanup_volume_identity_invalid", "cleanup");
  }
  return identity;
}

export function selectOwnedVolumeIdentities(output, projectName) {
  assertCleanupProject(projectName);
  const identities = [];
  let scannerVolumeCount = 0;
  for (const { createdAt, driver, labels, name, options, scope } of cleanupVolumeRecords(output)) {
    const namedForProject = name.startsWith("supabase_") && name.endsWith(`_${projectName}`);
    const labeledForProject = isRecord(labels) && [
      labels["com.supabase.cli.project"],
      labels["evo.recovery.project"],
      labels["evo.recovery.scanner"],
    ].includes(projectName);
    if (!namedForProject && !labeledForProject) continue;
    if (
      !isRecord(labels) ||
      !/^\d{4}-\d{2}-\d{2}T/u.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) ||
      driver !== "local" || scope !== "local" ||
      (options !== null && !isRecord(options))
    ) fail("cleanup_volume_ownership_invalid", "cleanup");
    const supabaseOwned = labels["com.supabase.cli.project"] === projectName;
    const scannerOwned = labels["evo.recovery.scanner"] === projectName;
    if (Number(supabaseOwned) + Number(scannerOwned) !== 1) fail("cleanup_volume_ownership_invalid", "cleanup");
    if (supabaseOwned) {
      if (!namedForProject) fail("cleanup_volume_ownership_invalid", "cleanup");
      assertExactRecoveryOwnershipLabels(labels, {
        "com.supabase.cli.project": projectName,
      }, {
        "com.docker.compose.project": projectName,
      }, "cleanup_volume_ownership_invalid");
    }
    if (scannerOwned) {
      if (
        name !== `supabase_clamav_signatures_${projectName}` ||
        labels["com.docker.compose.project"] !== projectName ||
        labels["evo.recovery.project"] !== projectName ||
        labels["evo.recovery.type"] !== "clamav-signatures"
      ) {
        fail("cleanup_volume_ownership_invalid", "cleanup");
      }
      assertExactRecoveryOwnershipLabels(labels, {
        "com.docker.compose.project": projectName,
        "evo.recovery.project": projectName,
        "evo.recovery.scanner": projectName,
        "evo.recovery.type": "clamav-signatures",
      }, {}, "cleanup_volume_ownership_invalid");
      scannerVolumeCount += 1;
    }
    identities.push(Object.freeze({
      createdAt,
      driver,
      labelsSha256: sha256(canonicalJson(labels)),
      name,
      optionsSha256: sha256(canonicalJson(options)),
      scope,
    }));
  }
  if (scannerVolumeCount > 1 || new Set(identities.map(({ name }) => name)).size !== identities.length) {
    fail("cleanup_volume_ownership_invalid", "cleanup");
  }
  return Object.freeze(identities.sort((left, right) => left.name.localeCompare(right.name, "en")));
}

export function selectOwnedVolumeNames(output, projectName) {
  return Object.freeze(selectOwnedVolumeIdentities(output, projectName).map(({ name }) => name));
}

export function selectOwnedNetworkIds(output, networkName) {
  if (!/^evov3recovery[0-9a-f]{12}_private$/u.test(networkName)) fail("cleanup_network_scope_invalid", "cleanup");
  const lines = String(output).split(/\r?\n/u).filter(Boolean);
  if (lines.length === 0) return Object.freeze([]);
  if (lines.length !== 1) fail("cleanup_network_inventory_invalid", "cleanup");
  const fields = lines[0].split("\t");
  let id;
  let name;
  let labels;
  try {
    [id, name, labels] = fields.map((field) => JSON.parse(field));
  } catch {
    fail("cleanup_network_inventory_invalid", "cleanup");
  }
  const projectName = networkName.slice(0, -"_private".length);
  if (
    fields.length !== 3 ||
    !SHA256.test(id ?? "") ||
    name !== networkName ||
    !isRecord(labels) ||
    labels["evo.recovery.owner"] !== projectName
  ) {
    fail("cleanup_network_ownership_invalid", "cleanup");
  }
  assertExactRecoveryOwnershipLabels(labels, {
    "evo.recovery.owner": projectName,
  }, {}, "cleanup_network_ownership_invalid");
  return Object.freeze([id]);
}

export function selectOwnedImageIds(output, expected) {
  if (!isRecord(expected)) fail("cleanup_image_inventory_invalid", "cleanup");
  exactKeys(expected, ["archiveSha256", "buildNetwork", "id", "projectName", "tag", "targetCommit", "targetTree"], "cleanup_image_inventory_invalid", "cleanup");
  assertCleanupProject(expected.projectName);
  if (
    !/^sha256:[0-9a-f]{64}$/u.test(expected.id ?? "") ||
    typeof expected.tag !== "string" || expected.tag !== `evo-v3-recovery-${expected.projectName}:candidate` ||
    !SHA256.test(expected.archiveSha256 ?? "") ||
    !GIT_OID.test(expected.targetCommit ?? "") ||
    !GIT_OID.test(expected.targetTree ?? "") ||
    expected.buildNetwork !== "dependency-fetch-only"
  ) {
    fail("cleanup_image_inventory_invalid", "cleanup");
  }
  const lines = String(output).split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) fail("cleanup_image_inventory_invalid", "cleanup");
  const ids = [];
  for (const line of lines) {
    const fields = line.split("\t");
    let id;
    let tags;
    let labels;
    try {
      [id, tags, labels] = fields.map((field) => JSON.parse(field));
    } catch {
      fail("cleanup_image_inventory_invalid", "cleanup");
    }
    if (
      fields.length !== 3 ||
      !/^sha256:[0-9a-f]{64}$/u.test(id ?? "") ||
      !Array.isArray(tags) ||
      tags.some((tag) => typeof tag !== "string" || tag.length === 0) ||
      !isRecord(labels) ||
      id !== expected.id ||
      !sameJson(tags, [expected.tag]) ||
      labels["org.opencontainers.image.revision"] !== expected.targetCommit ||
      labels["evo.recovery.project"] !== expected.projectName ||
      labels["evo.recovery.type"] !== "candidate-image" ||
      labels["evo.recovery.target-tree"] !== expected.targetTree ||
      labels["evo.recovery.snapshot-archive-sha256"] !== expected.archiveSha256 ||
      labels["evo.recovery.build-network"] !== expected.buildNetwork
    ) {
      fail("cleanup_image_inventory_invalid", "cleanup");
    }
    assertExactRecoveryOwnershipLabels(labels, {
      "evo.recovery.project": expected.projectName,
      "evo.recovery.type": "candidate-image",
    }, {}, "cleanup_image_inventory_invalid");
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) fail("cleanup_image_inventory_invalid", "cleanup");
  return Object.freeze(ids);
}

export function selectCandidateImageIds(output) {
  const ids = String(output).split(/\r?\n/u).filter(Boolean);
  if (ids.some((id) => !/^sha256:[0-9a-f]{64}$/u.test(id))) {
    fail("cleanup_image_list_invalid", "cleanup");
  }
  return Object.freeze([...new Set(ids)]);
}

function cleanupCapturedIdentity(state) {
  const containers = [
    ...(Array.isArray(state?.supabaseContainerIds) ? state.supabaseContainerIds : []),
    state?.scannerContainer,
    state?.appContainerId,
    state?.appProxyContainerId,
  ].filter((id) => typeof id === "string").sort();
  const volumes = Array.isArray(state?.ownedVolumeNames) ? [...state.ownedVolumeNames].sort() : [];
  const volumeIdentities = Array.isArray(state?.ownedVolumeIdentities)
    ? state.ownedVolumeIdentities.map((identity) => validatedCleanupVolumeIdentity(identity))
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
    : [];
  const networkIds = typeof state?.networkId === "string" ? [state.networkId] : [];
  const images = isRecord(state?.appImageIdentity) ? [state.appImageIdentity.id] : [];
  const imageReferenceContainerIds = images.length === 1
    ? [state?.appContainerId, state?.appProxyContainerId].filter((id) => typeof id === "string").sort()
    : [];
  if (
    containers.some((id) => !SHA256.test(id)) || new Set(containers).size !== containers.length ||
    volumes.some((name) => typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/u.test(name)) ||
    new Set(volumes).size !== volumes.length ||
    new Set(volumeIdentities.map(({ name }) => name)).size !== volumeIdentities.length ||
    !sameJson(volumes, volumeIdentities.map(({ name }) => name)) ||
    networkIds.some((id) => !SHA256.test(id)) ||
    images.some((id) => !/^sha256:[0-9a-f]{64}$/u.test(id)) ||
    (images.length === 1 && state?.appImageId !== images[0]) ||
    ((typeof state?.appContainerId === "string" || typeof state?.appProxyContainerId === "string") && images.length !== 1) ||
    imageReferenceContainerIds.some((id) => !containers.includes(id))
  ) {
    fail("cleanup_captured_identity_invalid", "cleanup");
  }
  return Object.freeze({
    containers: Object.freeze(containers),
    volumes: Object.freeze(volumes),
    volumeIdentities: Object.freeze(volumeIdentities),
    networkIds: Object.freeze(networkIds),
    images: Object.freeze(images),
    imageReferenceContainerIds: Object.freeze(imageReferenceContainerIds),
  });
}

function assertCleanupInventoryIdentity(inventory, expected) {
  for (const field of ["containers", "volumes", "volumeIdentities", "networkIds", "images", "imageReferenceContainerIds"]) {
    if (!Array.isArray(inventory?.[field]) || !Array.isArray(expected?.[field])) {
      fail("cleanup_captured_identity_invalid", "cleanup");
    }
    if (!sameJson([...inventory[field]].sort(), [...expected[field]].sort())) {
      fail("cleanup_identity_drift", "cleanup");
    }
  }
}

async function cleanupInventory(state, supervisor, tools, {
  allowAfterInterrupt = false,
  expectedIdentity,
  stage = "cleanup",
} = {}) {
  const [containerList, volumeList, networkList, imageList] = await Promise.all([
    runDocker(supervisor, tools.docker, ["--context", "orbstack", "ps", "--all", "--no-trunc", "--format", "{{.ID}}"], { stage, code: "cleanup_container_inventory_failed", allowAfterInterrupt, maxCaptureBytes: 4 * 1_024 * 1_024 }),
    runDocker(supervisor, tools.docker, ["--context", "orbstack", "volume", "ls", "--format", "{{.Name}}"], { stage, code: "cleanup_volume_inventory_failed", allowAfterInterrupt }),
    runDocker(supervisor, tools.docker, ["--context", "orbstack", "network", "ls", "--format", "{{.Name}}"], { stage, code: "cleanup_network_inventory_failed", allowAfterInterrupt }),
    runDocker(supervisor, tools.docker, [
      "--context", "orbstack", "image", "ls", "--all", "--no-trunc",
      "--filter", `label=evo.recovery.project=${state.projectName}`,
      "--filter", "label=evo.recovery.type=candidate-image",
      "--format", "{{.ID}}",
    ], { stage, code: "cleanup_image_inventory_failed", allowAfterInterrupt }),
  ]);
  const containerIds = containerList.stdout.toString("utf8").split(/\r?\n/u).filter(Boolean);
  if (containerIds.some((id) => !SHA256.test(id)) || new Set(containerIds).size !== containerIds.length) {
    fail("cleanup_container_inventory_invalid", "cleanup");
  }
  const volumeNames = volumeList.stdout.toString("utf8").split(/\r?\n/u).filter(Boolean);
  if (
    volumeNames.some((name) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/u.test(name)) ||
    new Set(volumeNames).size !== volumeNames.length
  ) {
    fail("cleanup_volume_inventory_invalid", "cleanup");
  }
  const networkNames = networkList.stdout.toString("utf8").split(/\r?\n/u).filter(Boolean);
  const candidateNetworkNames = networkNames.filter((name) => name === state.networkName);
  if (candidateNetworkNames.length > 1) fail("cleanup_network_inventory_invalid", "cleanup");
  const [containerInspection, volumeInspection, networkInspection] = await Promise.all([
    containerIds.length === 0
      ? Promise.resolve({ stdout: Buffer.from("") })
      : runDocker(supervisor, tools.docker, [
        "--context", "orbstack", "inspect", "--format", SAFE_CLEANUP_CONTAINER_INSPECT_FORMAT, ...containerIds,
      ], { stage, code: "cleanup_container_inspection_failed", allowAfterInterrupt, maxCaptureBytes: 4 * 1_024 * 1_024 }),
    volumeNames.length === 0
      ? Promise.resolve({ stdout: Buffer.from("") })
      : runDocker(supervisor, tools.docker, [
        "--context", "orbstack", "volume", "inspect", "--format", SAFE_CLEANUP_VOLUME_INSPECT_FORMAT, ...volumeNames,
      ], { stage, code: "cleanup_volume_inspection_failed", allowAfterInterrupt, maxCaptureBytes: 4 * 1_024 * 1_024 }),
    candidateNetworkNames.length === 0
      ? Promise.resolve({ stdout: Buffer.from("") })
      : runDocker(supervisor, tools.docker, [
        "--context", "orbstack", "network", "inspect", "--format", SAFE_CLEANUP_NETWORK_INSPECT_FORMAT, ...candidateNetworkNames,
      ], { stage, code: "cleanup_network_inspection_failed", allowAfterInterrupt }),
  ]);
  const candidateImageIds = selectCandidateImageIds(imageList.stdout.toString("utf8"));
  const containerInspectionText = containerInspection.stdout.toString("utf8");
  let images = Object.freeze([]);
  if (candidateImageIds.length > 0) {
    if (!isRecord(state.appImageIdentity)) fail("cleanup_image_inventory_invalid", "cleanup");
    const inspected = await runDocker(supervisor, tools.docker, [
      "--context", "orbstack", "image", "inspect",
      "--format", "{{json .Id}}\t{{json .RepoTags}}\t{{json .Config.Labels}}",
      ...candidateImageIds,
    ], { stage, code: "cleanup_image_inspection_failed", allowAfterInterrupt });
    images = selectOwnedImageIds(inspected.stdout.toString("utf8"), state.appImageIdentity);
    if (!sameJson([...images].sort(), [...candidateImageIds].sort())) {
      fail("cleanup_image_inventory_invalid", "cleanup");
    }
  }
  const networkIds = selectOwnedNetworkIds(networkInspection.stdout.toString("utf8"), state.networkName);
  const volumeIdentities = selectOwnedVolumeIdentities(volumeInspection.stdout.toString("utf8"), state.projectName);
  const inventory = Object.freeze({
    containers: selectOwnedContainerIds(containerInspectionText, state.projectName),
    volumes: Object.freeze(volumeIdentities.map(({ name }) => name)),
    volumeIdentities,
    networks: networkIds.length === 0 ? Object.freeze([]) : Object.freeze([state.networkName]),
    networkIds,
    images,
    imageReferenceContainerIds: isRecord(state.appImageIdentity)
      ? selectCandidateImageContainerReferences(containerInspectionText, state.appImageIdentity.id)
      : Object.freeze([]),
  });
  if (expectedIdentity !== undefined) assertCleanupInventoryIdentity(inventory, expectedIdentity);
  return inventory;
}

export async function cleanupState(state, supervisor, toolchain) {
  const descendantsDrained = await supervisor.stopAll();
  const targetsOwned = safeHarnessRoot(state.harnessRoot, state.projectName);
  const containerPolicy = cleanupContainerPolicy(state, Boolean(
    toolchain?.paths?.docker?.real &&
    toolchain?.paths?.supabaseNative?.real &&
    toolchain?.paths?.supabaseGo?.real,
  ));
  let cleanupSucceeded = descendantsDrained && targetsOwned;
  if (containerPolicy === "quarantine") cleanupSucceeded = false;
  if (descendantsDrained && targetsOwned && containerPolicy === "container_cleanup") {
    const run = async (args) => {
      try {
        await runDocker(supervisor, toolchain.paths.docker, ["--context", "orbstack", ...args], { stage: "cleanup", code: "cleanup_command_failed", timeoutMs: 2 * 60 * 1_000, allowAfterInterrupt: true });
        return true;
      } catch {
        return false;
      }
    };
    try {
      let expectedIdentity = cleanupCapturedIdentity(state);
      let owned = await cleanupInventory(state, supervisor, toolchain.paths, { allowAfterInterrupt: true, expectedIdentity });
      if (owned.containers.length > 0) {
        cleanupSucceeded = (await run(["rm", "--force", ...owned.containers])) && cleanupSucceeded;
        expectedIdentity = Object.freeze({
          ...expectedIdentity,
          containers: Object.freeze([]),
          imageReferenceContainerIds: Object.freeze([]),
        });
        owned = await cleanupInventory(state, supervisor, toolchain.paths, { allowAfterInterrupt: true, expectedIdentity });
      }
      if (owned.containers.length > 0) cleanupSucceeded = false;
      if (cleanupSucceeded && owned.images.length > 0) {
        cleanupSucceeded = (await run(["image", "rm", ...owned.images])) && cleanupSucceeded;
        expectedIdentity = Object.freeze({ ...expectedIdentity, images: Object.freeze([]) });
        owned = await cleanupInventory(state, supervisor, toolchain.paths, { allowAfterInterrupt: true, expectedIdentity });
      }
      if (cleanupSucceeded && owned.volumes.length > 0) {
        cleanupSucceeded = (await run(["volume", "rm", ...owned.volumes])) && cleanupSucceeded;
        expectedIdentity = Object.freeze({
          ...expectedIdentity,
          volumes: Object.freeze([]),
          volumeIdentities: Object.freeze([]),
        });
        owned = await cleanupInventory(state, supervisor, toolchain.paths, { allowAfterInterrupt: true, expectedIdentity });
      }
      if (cleanupSucceeded && owned.networkIds.length > 0) {
        cleanupSucceeded = (await run(["network", "rm", ...owned.networkIds])) && cleanupSucceeded;
        expectedIdentity = Object.freeze({ ...expectedIdentity, networkIds: Object.freeze([]) });
        owned = await cleanupInventory(state, supervisor, toolchain.paths, { allowAfterInterrupt: true, expectedIdentity });
      }
      if (
        owned.containers.length ||
        owned.volumes.length ||
        owned.volumeIdentities.length ||
        owned.networkIds.length ||
        owned.images.length ||
        owned.imageReferenceContainerIds.length
      ) {
        cleanupSucceeded = false;
      }
    } catch {
      cleanupSucceeded = false;
    }
  }
  let disposition = cleanupDisposition({ descendantsDrained, targetsOwned, cleanupSucceeded });
  if (disposition === "remove") {
    try {
      guardedRemoveHarness(state.harnessRoot, state.projectName);
    } catch {
      cleanupSucceeded = false;
      disposition = "quarantine";
    }
  }
  if (disposition === "quarantine" && safeHarnessRoot(state.harnessRoot, state.projectName)) {
    const quarantine = `${state.harnessRoot}${QUARANTINE_SUFFIX}-${randomUUID()}`;
    try {
      renameSync(state.harnessRoot, quarantine);
      chmodSync(quarantine, 0o700);
    } catch {
      // The private marked root remains in place if even quarantine cannot be proved.
    }
  }
  return Object.freeze({ descendantsDrained, targetsOwned, cleanupSucceeded, disposition, containerPolicy });
}

class StageTimings {
  constructor() {
    this.entries = [];
  }

  async run(name, operation) {
    const started = Date.now();
    try {
      const value = await operation();
      this.entries.push(Object.freeze({ stage: name, status: "passed", durationMs: Date.now() - started }));
      return value;
    } catch (error) {
      this.entries.push(Object.freeze({ stage: name, status: "failed", durationMs: Date.now() - started }));
      throw error;
    }
  }
}

export function writeEvidence(path, evidence) {
  const parent = dirname(path);
  const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  let fd;
  try {
    try {
      fd = openSync(temporary, "wx", 0o600);
      chmodSync(temporary, 0o600);
      writeFileSync(fd, `${JSON.stringify(evidence, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    linkSync(temporary, path);
    unlinkSync(temporary);
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
      fail("evidence_file_invalid", "evidence");
    }
    const parentFd = openSync(parent, "r");
    try {
      fsyncSync(parentFd);
    } finally {
      closeSync(parentFd);
    }
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function safeFailure(error) {
  if (error instanceof RecoveryFailure) {
    return Object.freeze({ code: error.code, stage: error.stage, diagnostic: error.diagnostic ?? null });
  }
  return Object.freeze({ code: "unexpected_failure", stage: "internal", diagnostic: null });
}

function durableToolEvidence(value) {
  const allowed = new Set([
    "age",
    "git",
    "psql",
    "supabase_cli",
    "supabase_go_cli",
    "tar",
    "orb",
    "orb_version",
    "docker_context",
    "docker_client",
    "docker_server",
    "docker_buildx",
    "node",
    "private_home_mode",
    "private_docker_config_mode",
    "chromium",
    "git_realpath_sha256",
    "sshKeygen_realpath_sha256",
    "tar_realpath_sha256",
    "age_realpath_sha256",
    "orb_realpath_sha256",
    "docker_realpath_sha256",
    "psql_realpath_sha256",
    "node_realpath_sha256",
    "openssl_realpath_sha256",
    "sandboxExec_realpath_sha256",
    "dockerBuildx_realpath_sha256",
    "supabaseLauncher_realpath_sha256",
    "supabaseNative_realpath_sha256",
    "supabaseGo_realpath_sha256",
    "git_binary_sha256",
    "sshKeygen_binary_sha256",
    "tar_binary_sha256",
    "age_binary_sha256",
    "orb_binary_sha256",
    "docker_binary_sha256",
    "psql_binary_sha256",
    "node_binary_sha256",
    "openssl_binary_sha256",
    "sandboxExec_binary_sha256",
    "dockerBuildx_binary_sha256",
    "private_buildx_realpath_sha256",
    "supabaseLauncher_binary_sha256",
    "supabaseNative_binary_sha256",
    "supabaseGo_binary_sha256",
    "supabase_bin_link_sha256",
    "supabase_execution_chain_sha256",
    "chromium_binary_sha256",
  ]);
  if (!isRecord(value)) return Object.freeze({});
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    if (!allowed.has(key) || typeof field !== "string" || field.length === 0 || field.length > 256) continue;
    const valid = key.endsWith("_sha256")
      ? SHA256.test(field)
      : key === "git"
        ? /^git version \d[A-Za-z0-9 .()+_-]*$/u.test(field)
        : key === "tar"
          ? /^(?:bsdtar|tar) \d[A-Za-z0-9.+_-]*$/u.test(field)
          : key === "psql"
            ? /^\d+\.\d+$/u.test(field)
            : new Set(["supabase_cli", "supabase_go_cli"]).has(key)
              ? VERSION.test(field)
              : key === "age"
                ? /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u.test(field)
                : key === "orb"
                  ? field === "Running"
                  : key === "orb_version"
                    ? /^OrbStack \d[A-Za-z0-9.+_-]*$/u.test(field)
                    : key === "docker_context"
                      ? field === "orbstack"
                      : key === "node"
                        ? field === REQUIRED_NODE_VERSION
                        : key === "docker_buildx"
                          ? /^buildx \d[A-Za-z0-9.+_-]*$/u.test(field)
                          : new Set(["private_home_mode", "private_docker_config_mode"]).has(key)
                            ? field === "700"
                      : new Set(["docker_client", "docker_server"]).has(key)
                        ? VERSION.test(field)
                        : key === "chromium"
                          ? isTrustedPlaywrightChromiumVersion(field)
                          : false;
    if (!valid) continue;
    result[key] = field;
  }
  return Object.freeze(result);
}

export function buildDurableEvidence({ result, failure, interrupted, stages, cleanup, tools, isolation }) {
  const notReady = isRecord(result) &&
    result.schema === RESULT_SCHEMA &&
    result.ok === false &&
    result.status === "not_ready" &&
    Array.isArray(result.blockers) &&
    result.blockers.length > 0 &&
    new Set(result.blockers).size === result.blockers.length &&
    result.blockers.every((blocker) => new Set([
      "admin_representative_missing",
      "sales_representative_missing",
      "admissions_representative_missing",
      "storage_source_object_missing",
      "preexisting_cross_organization_reference_missing",
      "restored_sales_lead_missing",
      "restored_admissions_task_missing",
      "restored_downloadable_document_missing",
      "restored_role_outcome_proof_incomplete",
    ]).has(blocker));
  let durableFailure = interrupted
    ? Object.freeze({ code: "recovery_interrupted", stage: "signal", diagnostic: Object.freeze({ signal: interrupted }) })
    : failure;
  if (!durableFailure && cleanup?.disposition !== "remove") {
    durableFailure = Object.freeze({ code: "cleanup_quarantined", stage: "cleanup", diagnostic: null });
  }
  if (!durableFailure && !notReady && (!isRecord(result) || result.ok !== true)) {
    durableFailure = Object.freeze({ code: "recovery_result_missing", stage: "internal", diagnostic: null });
  }
  const safeTools = durableToolEvidence(tools);
  if (durableFailure) {
    return Object.freeze({
      schema: RESULT_SCHEMA,
      ok: false,
      status: interrupted ? "interrupted" : "failed",
      failure: durableFailure,
      tools: safeTools,
      isolation,
      stages,
      cleanup,
    });
  }
  if (notReady) {
    return Object.freeze({
      ...result,
      failure: Object.freeze({
        code: "recovery_not_ready",
        stage: "acceptance",
        diagnostic: Object.freeze({
          blockerCount: result.blockers.length,
          blockersSha256: sha256(canonicalJson(result.blockers)),
        }),
      }),
      tools: safeTools,
      isolation,
      stages,
      cleanup,
    });
  }
  return Object.freeze({ ...result, tools: safeTools, isolation, stages, cleanup });
}

export function buildRestoredRoleOutcomeReadiness(actors, serverProof = {}, browserProof = {}) {
  const outcomes = {};
  for (const role of ["admin", "sales", "admissions"]) {
    if (!isRecord(actors?.[role])) {
      outcomes[role] = "missing_restored_identity";
    } else if (serverProof?.outcomes?.[role] !== "passed") {
      outcomes[role] = typeof serverProof?.outcomes?.[role] === "string"
        ? serverProof.outcomes[role]
        : "incomplete_mutation_replay_audit_document_suite";
    } else if (browserProof?.roleOutcomes?.[role] !== "passed") {
      outcomes[role] = "incomplete_exact_role_browser_readback";
    } else {
      outcomes[role] = "passed";
    }
  }
  const complete = Object.values(outcomes).every((outcome) => outcome === "passed");
  const acceptedDataBlockers = new Set([
    "restored_sales_lead_missing",
    "restored_admissions_task_missing",
    "restored_downloadable_document_missing",
  ]);
  const blockers = complete
    ? []
    : [
        ...(Array.isArray(serverProof?.blockers)
          ? serverProof.blockers.filter((blocker) => acceptedDataBlockers.has(blocker))
          : []),
        "restored_role_outcome_proof_incomplete",
      ];
  return Object.freeze({
    complete,
    blocker: complete ? null : "restored_role_outcome_proof_incomplete",
    blockers: Object.freeze([...new Set(blockers)]),
    outcomes: Object.freeze(outcomes),
    required: "Sales and Admissions canonical mutation, idempotent replay, correlated append-only audit, private-document readback, and exact-role browser readback",
  });
}

export function latchInterruption(state, supervisor, signal) {
  if (!isRecord(state) || !["SIGINT", "SIGTERM"].includes(signal)) fail("signal_invalid", "signal");
  if (!(state.interruptionGuard instanceof RecoveryInterruptionGuard)) fail("interruption_guard_invalid", "signal");
  state.signalCount = (state.signalCount ?? 0) + 1;
  state.interrupted ??= signal;
  state.interruptionGuard.latch(signal);
  supervisor.latchInterruption();
  state.signalShutdown ??= Promise.resolve(supervisor.stopAll());
  return state.signalShutdown;
}

function contract() {
  return Object.freeze({
    ok: true,
    status: "contract",
    proof: "not_run",
    optIn: OPT_IN,
    signedInput: Object.freeze({
      receipt: "receipt.json",
      signature: "receipt.json.sig",
      namespace: SIGNATURE_NAMESPACE,
      identity: SIGNATURE_IDENTITY,
      encryptedArtifacts: ARTIFACTS,
    }),
    requiredBindings: Object.freeze([
      "independent trusted public key and fingerprint",
      "managed project ref and Supabase organization id",
      "exact signed source commit and source migration tree",
      "exact identical-tree source main-equivalent commit",
      "exact target checkout commit and target migration tree",
      "pre-existing Platform organization plus required Admin and optional explicit Sales Admissions user ids",
      "locally built candidate image from the exact target Git tree",
      "private durable evidence destination",
    ]),
    safety: Object.freeze({
      remoteManagedSupabaseContact: false,
      providerContact: false,
      productionMutation: false,
      syntheticActors: false,
      syntheticBusinessRows: false,
      migrationLedgerReconstruction: false,
      plaintext: "private_marked_temporary_root_only",
      interruption: "tracked_process_groups_term_kill_drain_then_targeted_cleanup",
      unsafeCleanup: "quarantine",
    }),
  });
}

async function executeMode(mode, options) {
  const evidenceOut = evidenceDestination(options.evidenceOut);
  const harnessRoot = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), HARNESS_PREFIX)));
  chmodSync(harnessRoot, 0o700);
  validateEvidenceRuntimeSeparation(evidenceOut, harnessRoot);
  const projectName = `evov3recovery${randomBytes(6).toString("hex")}`;
  const state = {
    harnessRoot,
    projectName,
    networkName: `${projectName}_private`,
    supabaseRoot: undefined,
    containerPreflightPassed: false,
    containerMutationAttempted: false,
    containerMutationCapture: Object.freeze({ stage: null, status: "not_started" }),
    stackStarted: false,
    networkCreated: false,
    networkId: undefined,
    supabaseContainerIds: undefined,
    ownedVolumeNames: undefined,
    ownedVolumeIdentities: undefined,
    appContainer: undefined,
    appContainerId: undefined,
    appProxyContainer: undefined,
    appProxyContainerId: undefined,
    appImageTag: undefined,
    appImageId: undefined,
    appImageIdentity: undefined,
    scannerContainer: undefined,
    scannerIdentity: undefined,
    scannerSignatureVolume: undefined,
    browserRecord: undefined,
    interrupted: undefined,
    signalCount: 0,
    interruptionGuard: new RecoveryInterruptionGuard(),
    availableTools: {},
    isolationInput: {
      source: { projectRef: null, urls: [], networks: [], volumes: [] },
      destination: {
        projectRef: projectName,
        urls: [],
        networks: [`${projectName}_private`],
        volumes: [],
        appNetworkAttachment: null,
      },
    },
  };
  state.isolationEvidence = buildIsolationEvidence(state.isolationInput);
  writeFileSync(join(harnessRoot, MARKER), `${projectName}\n`, { mode: 0o600, flag: "wx" });
  const supervisor = new ProcessSupervisor();
  const timings = new StageTimings();
  const runStage = async (stage, operation) => await timings.run(
    stage,
    async () => await state.interruptionGuard.run(stage, operation),
  );
  let toolchain;
  let result;
  let failure;
  const onSignal = (signal) => {
    latchInterruption(state, supervisor, signal);
  };
  const sigint = () => onSignal("SIGINT");
  const sigterm = () => onSignal("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  try {
    if (process.versions.node !== REQUIRED_NODE_VERSION) fail("node_22_required", "toolchain");
    toolchain = await runStage("toolchain", () => trustedToolchain(supervisor, harnessRoot, state.availableTools));
    state.containerPreflightPassed = true;
    const repository = await runStage("repository", () => repositorySnapshot(supervisor, toolchain.paths, options));
    const artifacts = await runStage("signed_artifact_validation", () => prepareArtifacts(options, harnessRoot, supervisor, toolchain));
    const sourceStorageReadiness = storageSourceRecoveryReadiness({ objectCount: artifacts.storage.objects.length });
    const sourceProject = artifacts.database.source.project;
    state.isolationInput.source = {
      projectRef: sourceProject.ref,
      urls: [
        `https://${sourceProject.ref}.supabase.co`,
        `postgresql://${sourceProject.database.host}:5432/postgres`,
        `postgresql://${artifacts.database.source.pooler.host}:${artifacts.database.source.pooler.session_port}/postgres`,
      ],
      networks: [`managed-supabase:${sourceProject.organization_id}:${sourceProject.ref}`],
      volumes: [
        `managed-database-backup:${artifacts.database.source.backup.id}`,
        `managed-storage-inventory:${artifacts.receipt.storage.inventory_sha256}`,
      ],
    };
    state.isolationEvidence = buildIsolationEvidence(state.isolationInput);
    if (
      artifacts.database.tools.supabase_cli !== toolchain.evidence.supabase_cli ||
      artifacts.database.tools.psql !== toolchain.evidence.psql
    ) {
      fail("recovery_export_tool_version_mismatch", "toolchain");
    }
    if (
      artifacts.receipt.git.head !== repository.source.receiptCommit ||
      artifacts.receipt.git.migration_tree !== repository.source.migrationTree
    ) {
      fail("receipt_source_repository_mismatch", "repository");
    }
    const { sourceRoot, targetRoot } = await runStage("migration_ledger_validation", async () => Object.freeze({
      sourceRoot: await rootMigrationEntries(supervisor, toolchain.paths, repository.source.receiptCommit, harnessRoot, "source"),
      targetRoot: await rootMigrationEntries(supervisor, toolchain.paths, repository.target.commit, harnessRoot, "target"),
    }));
    const repositoryMigrationPrefix = verifyMigrationTreePrefix(sourceRoot, targetRoot);
    const sourceDatabaseLedger = verifyLedgerAgainstRoot(artifacts.ledger, sourceRoot, artifacts.database.ledger);
    const verifiedLedger = verifyLedgerAgainstRoot(artifacts.ledger, targetRoot, artifacts.database.ledger);
    const image = await runStage("exact_target_image_build", () => buildCandidateImage(repository, state, supervisor, toolchain));
    const shared = {
      repository: Object.freeze({
        sourceReceiptCommitSha256: sha256(repository.source.receiptCommit),
        sourceFullTreeSha256: sha256(repository.source.tree),
        sourceMigrationTreeSha256: sha256(repository.source.migrationTree),
        sourceMainEquivalentCommitSha256: sha256(repository.source.mainEquivalentCommit),
        sourceMainEquivalentFullTreeSha256: sha256(repository.source.mainEquivalentTree),
        sourceMainEquivalentMigrationTreeSha256: sha256(repository.source.mainEquivalentMigrationTree),
        targetCommitSha256: sha256(repository.target.commit),
        targetFullTreeSha256: sha256(repository.target.tree),
        targetMigrationTreeSha256: sha256(repository.target.migrationTree),
        sourceTreeEqualsMainEquivalent: repository.sourceTreeEqualsMainEquivalent,
        sourceMainEquivalentIsAncestorOfTarget: repository.sourceMainEquivalentIsAncestorOfTarget,
        sourceCodeMigrationCount: repositoryMigrationPrefix.source.length,
        sourceCodePendingAfterDatabaseCount: sourceDatabaseLedger.pending.length,
        targetCodeMigrationCount: targetRoot.entries.length,
        targetCodeMigrationSuffixCount: repositoryMigrationPrefix.pending.length,
        sourceCodeMigrationLedgerSha256: repositoryMigrationPrefix.sourceLedgerSha256,
        targetCodeMigrationSuffixSha256: repositoryMigrationPrefix.targetSuffixSha256,
      }),
      source: Object.freeze({
        receiptSha256: sha256(readFileSync(artifacts.signed.receiptPath)),
        sourceIdentitySha256: artifacts.receipt.sourceIdentity,
        captureTimestamp: artifacts.receipt.capturedAt,
        ageHours: Number(artifacts.receipt.ageHours.toFixed(3)),
        providerBackupIdSha256: sha256(artifacts.receipt.providerBackup.id),
        providerBackupTimestamp: artifacts.receipt.providerBackup.inserted_at,
        signatureFingerprint: artifacts.signed.fingerprint,
        trustedPublicKeySha256: artifacts.signed.trustedKeySha256,
        ciphertextSetSha256: sha256(canonicalJson(Object.fromEntries(ARTIFACTS.map((name) => [name, artifacts.ciphertext[name].sha256])))),
        storageRecoveryReadiness: sourceStorageReadiness,
      }),
      ledger: Object.freeze({
        restoredDatabaseCount: verifiedLedger.source.length,
        pendingDatabaseMigrationCount: verifiedLedger.pending.length,
        orderedLedgerSha256: verifiedLedger.orderedLedgerSha256,
        recordedRootHistoryExceptionCount: verifiedLedger.recordedRootHistoryExceptions.length,
        recordedRootHistoryExceptionSha256: sha256(canonicalJson(verifiedLedger.recordedRootHistoryExceptions)),
        emptyStatementHistoryExceptionCount: verifiedLedger.emptyStatementHistoryExceptions.length,
        emptyStatementHistoryExceptionSha256: sha256(canonicalJson(verifiedLedger.emptyStatementHistoryExceptions)),
        sourceRecordedHistoryValidatedCount: sourceRoot.recordedHistoryCount,
        targetRecordedHistoryValidatedCount: targetRoot.recordedHistoryCount,
      }),
      image: Object.freeze({
        idSha256: sha256(image.id),
        repoDigestSetSha256: sha256(canonicalJson(image.repoDigests)),
        revisionSha256: sha256(image.revision),
        revisionMatchesTarget: image.revision === repository.target.commit,
        provenance: "locally_built_from_exact_target_git_tree",
        operatingSystem: image.operatingSystem,
        architecture: image.architecture,
        buildNetwork: image.buildNetwork,
        targetSnapshotArchiveSha256: image.snapshot.archiveSha256,
        targetSnapshotListingSha256: image.snapshot.listingSha256,
        targetSnapshotFileCount: image.snapshot.fileCount,
        targetSnapshotTreeSha256: sha256(image.snapshot.tree),
      }),
      tools: toolchain.evidence,
      isolation: state.isolationEvidence,
    };
    if (mode === "preflight") {
      result = { schema: RESULT_SCHEMA, ok: true, status: "preflight_passed", proof: "not_run", ...shared };
    } else {
      const ports = await runStage("port_reservation", reservePorts);
      const local = await runStage("local_supabase_start", () => startLocalSupabase(state, targetRoot, ports, supervisor, toolchain));
      const localDestinationInventory = await runStage("local_supabase_identity", () => cleanupInventory(state, supervisor, toolchain.paths, { stage: "local_supabase_identity" }));
      state.ownedVolumeNames = localDestinationInventory.volumes;
      state.ownedVolumeIdentities = localDestinationInventory.volumeIdentities;
      assertCleanupInventoryIdentity(localDestinationInventory, cleanupCapturedIdentity(state));
      completeContainerMutationCapture(state, "local_supabase_start");
      const scanner = await runStage("malware_scanner_start", () => startRecoveryScanner(
        state,
        local.status,
        image.snapshot.root,
        supervisor,
        toolchain,
        state.interruptionGuard,
      ));
      const destinationInventory = await runStage("destination_identity", () => cleanupInventory(state, supervisor, toolchain.paths, { stage: "destination_identity" }));
      state.ownedVolumeNames = destinationInventory.volumes;
      state.ownedVolumeIdentities = destinationInventory.volumeIdentities;
      assertCleanupInventoryIdentity(destinationInventory, cleanupCapturedIdentity(state));
      completeContainerMutationCapture(state, "malware_scanner_start");
      state.isolationInput.destination = {
        projectRef: state.projectName,
        urls: [local.status.apiUrl, local.status.dbUrl],
        networks: destinationInventory.networks,
        volumes: destinationInventory.volumes,
        appNetworkAttachment: null,
      };
      state.isolationEvidence = buildIsolationEvidence(state.isolationInput, { requireComplete: true });
      const isolation = state.isolationEvidence;
      const extracted = await runStage("storage_archive_validation", () => extractStorage(artifacts, state, supervisor, toolchain));
      const database = await runStage("database_restore", async () => {
        const extensionRelations = await restoreDatabase(artifacts, local.status, supervisor, toolchain);
        return Object.freeze({
          ...await reconcileRestoredDatabase(artifacts, local.status, supervisor, toolchain),
          extensionRelations,
        });
      });
      const migrations = await runStage("pending_migration_rehearsal", () => applyPendingMigrations(
        state,
        local,
        targetRoot,
        verifiedLedger,
        database.extensionRelations,
        supervisor,
        toolchain,
      ));
      const storage = await runStage("storage_restore", () => restoreStorage(artifacts, extracted, local.status, state, supervisor, toolchain, state.interruptionGuard));
      if (!sameJson(storage.readiness, sourceStorageReadiness)) fail("storage_source_readiness_mismatch", "storage_verification");
      const targetStorage = await runStage("target_storage_configuration", () => reconcileTargetStorageBuckets(
        local.status,
        targetRoot.config,
        artifacts.storage.buckets,
        state.interruptionGuard,
      ));
      const actorReadiness = await runStage("representative_auth", () => prepareActors(options, local.status, supervisor, toolchain, state.interruptionGuard));
      const actors = actorReadiness.actors;
      const completeRoleCohort = ["admin", "sales", "admissions"].every((role) => isRecord(actors[role]));
      const authorizationProof = await runStage("authorization_and_audit", async () => completeRoleCohort
        ? await proveRlsAndCanonicalWrite(options, local.status, actors, supervisor, toolchain, state.interruptionGuard)
        : Object.freeze({
          evidence: Object.freeze({
            status: "not_run_missing_representatives",
            evidenceScope: "requires_distinct_real_admin_sales_admissions",
          }),
          blockers: Object.freeze([]),
        }));
      const roleServerProof = await runStage("role_outcome_proof", () => proveRestoredRoleServerOutcomes(
        options,
        local.status,
        actors,
        supervisor,
        toolchain,
        state.interruptionGuard,
      ));
      const documentActor = actors.sales ?? actors.admin;
      const document = await runStage("private_document", async () => documentActor
        ? await provePrivateDocument(local.status, documentActor, targetStorage.buckets, state.interruptionGuard)
        : Object.freeze({
          status: "not_run_missing_representative",
          evidenceScope: "behavior_canary_only_not_source_recovery",
        }));
      const providerConfigurationBoundary = await runStage("provider_boundary", () => recordRecoveryProviderBoundary(
        local.status,
        options.platformOrganizationId,
        repository.target.commit,
        state.interruptionGuard,
      ));
      const storageReadiness = await runStage("storage_source_readiness", async () => sourceStorageReadiness);
      const app = await runStage("candidate_start", () => startCandidateApp(options, local.status, actors, state, supervisor, toolchain, image, scanner, ports.app, state.interruptionGuard));
      const browser = await runStage("browser_proof", async () => Object.keys(actors).length > 0
        ? await proveBrowser(app, local.status, scanner, roleServerProof, state, supervisor, toolchain, state.interruptionGuard)
        : Object.freeze({ status: "not_run_missing_representative", evidenceScope: "no_real_representative_available" }));
      const roleOutcomes = buildRestoredRoleOutcomeReadiness(actors, roleServerProof, browser);
      const blockers = Object.freeze([...new Set([
        ...actorReadiness.blockers,
        ...authorizationProof.blockers,
        ...(storageReadiness.status === "ready" ? [] : [storageReadiness.blocker]),
        ...roleOutcomes.blockers,
      ])]);
      const representatives = Object.freeze({
        presentRoles: Object.freeze(["admin", "sales", "admissions"].filter((role) => isRecord(actors[role]))),
        userIdSha256ByRole: Object.freeze(Object.fromEntries(
          Object.entries(actors).map(([role, actor]) => [role, sha256(actor.userId)]),
        )),
        provenance: "preexisting_restored_snapshot",
      });
      const proof = {
        schema: RESULT_SCHEMA,
        ...shared,
        isolation,
        networkEgress: Object.freeze({
          bridgeFoundation: local.egress,
          supabaseServiceImages: local.endpoint.serviceImages,
          candidateRuntime: app.runtimeInternetTcpEgress,
          browserHost: browser.sandbox ?? Object.freeze({ status: "not_run_missing_representative" }),
        }),
        database,
        migrations,
        storage,
        targetStorage: targetStorage.evidence,
        representatives,
        authorization: Object.freeze({
          ...authorizationProof.evidence,
          roleOutcomeProof: roleServerProof.evidence,
        }),
        document,
        providerConfigurationBoundary,
        malwareScanner: browser.malwareScanner ?? Object.freeze({
          status: "not_run_missing_admin_representative",
          image: scanner.image,
          network: scanner.network,
          publish: scanner.publish,
        }),
        browser,
        roleOutcomes,
      };
      result = blockers.length > 0
        ? Object.freeze({
          ...proof,
          ok: false,
          status: "not_ready",
          proof: "isolated_recovery_behavior_only_acceptance_blocked",
          blockers,
        })
        : Object.freeze({
          ...proof,
          ok: true,
          status: "passed",
          proof: "isolated_orbstack_restore_and_exact_image_browser",
        });
    }
  } catch (error) {
    failure = safeFailure(error);
  }
  try {
    let cleanup;
    try {
      if (state.signalShutdown) await state.signalShutdown;
      cleanup = await cleanupState(state, supervisor, toolchain);
    } catch {
      cleanup = Object.freeze({ descendantsDrained: false, targetsOwned: safeHarnessRoot(state.harnessRoot, state.projectName), cleanupSucceeded: false, disposition: "quarantine" });
    }
    const evidence = buildDurableEvidence({
      result,
      failure,
      interrupted: state.interrupted,
      stages: timings.entries,
      cleanup,
      tools: state.availableTools,
      isolation: state.isolationEvidence,
    });
    writeEvidence(evidenceOut, evidence);
    if (!evidence.ok) fail(evidence.failure.code, evidence.failure.stage, evidence.failure.diagnostic);
    return evidence;
  } finally {
    process.removeListener("SIGINT", sigint);
    process.removeListener("SIGTERM", sigterm);
  }
}

async function main() {
  const mode = process.argv[2] ?? "contract";
  if (!new Set(["contract", "preflight", "run"]).has(mode)) fail("subcommand_invalid", "arguments");
  if (mode === "contract") {
    process.stdout.write(`${JSON.stringify(contract())}\n`);
    return;
  }
  if (process.env[OPT_IN] !== OPT_IN_VALUE) fail("explicit_opt_in_required", "opt_in");
  const options = parseHarnessOptions(process.argv.slice(3));
  const evidence = await executeMode(mode, options);
  process.stdout.write(`${JSON.stringify({ ok: true, status: evidence.status, evidenceSha256: sha256(canonicalJson(evidence)) })}\n`);
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    const failure = safeFailure(error);
    process.stdout.write(`${JSON.stringify({ ok: false, ...failure })}\n`);
    process.exitCode = error instanceof RecoveryFailure && error.code === "recovery_interrupted" ? 130 : 1;
  });
}
