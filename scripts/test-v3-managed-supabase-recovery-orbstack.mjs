#!/usr/bin/env node

/**
 * #551 managed-Supabase recovery rehearsal.
 *
 * This is intentionally a restore-only consumer. Exporting from managed
 * Supabase is a separate, read-only operator stage and there is no remote URL,
 * project-link, provider, VPS, webhook, or production mutation command here.
 * All decrypted material lives below one mode-0700 mktemp directory and is
 * removed after targeted cleanup of the uniquely named local contour.
 *
 * Official logical payloads expected by this consumer:
 *   supabase db dump ... --role-only  -> roles.sql
 *   supabase db dump ...              -> schema.sql
 *   supabase db dump ... --data-only  -> data.sql
 * Each payload and both manifests are encrypted independently with age.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  assertRedactedReceipt as assertExporterReceipt,
  canonicalJson,
  sshPublicKeyFingerprint,
} from "./export-v3-managed-supabase-backup.mjs";

const OPT_IN = "EVO_RUN_V3_MANAGED_SUPABASE_RECOVERY_ORBSTACK";
const OPT_IN_VALUE = "1";
const DATABASE_SCHEMA = "evo-v3-managed-supabase-logical-backup/v1";
const STORAGE_SCHEMA = "evo-v3-managed-supabase-storage-backup/v1";
const RECEIPT_SCHEMA = "evo-v3-managed-supabase-export-receipt/v1";
const SIGNATURE_NAMESPACE = "evo-v3-managed-supabase-recovery";
const SIGNATURE_IDENTITY = "evo-v3-managed-supabase-export";
const RESULT_SCHEMA = "evo-v3-managed-supabase-recovery-result/v1";
const HARNESS_PREFIX = "evo-v3-managed-recovery-";
const MARKER = ".evo-v3-managed-recovery-harness";
const EXPORT_MARKER = ".evo-v3-managed-supabase-export";
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_SQL_BYTES = 128 * 1024 * 1024 * 1024;
const MAX_STORAGE_ARCHIVE_BYTES = 256 * 1024 * 1024 * 1024;
const MAX_STORAGE_OBJECT_BYTES = 50 * 1024 * 1024;
const MAX_BACKUP_AGE_HOURS = 24 * 31;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const CLAMAV_IMAGE = "clamav/clamav@sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9";
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;
const MIGRATION_HISTORY_COLUMNS = Object.freeze([
  "version",
  "statements",
  "name",
  "created_by",
  "idempotency_key",
  "rollback",
]);
const REQUIRED_LOCAL_SERVICES = Object.freeze([
  ["database", "db"],
  ["postgrest", "rest"],
  ["auth", "auth"],
  ["storage", "storage"],
  ["kong", "kong"],
]);
const RECOVERY_EXCLUDED_SERVICES =
  "imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const MIGRATION_VERSION_PATTERN = /^\d{3}$/u;
const MIGRATION_NAME_PATTERN = /^[a-z0-9][a-z0-9_]{0,126}$/u;
const BUCKET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/u;
const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SQL_FILES = Object.freeze([
  "roles.sql",
  "schema.sql",
  "data.sql",
  "history-schema.sql",
  "history-data.sql",
]);
const ENCRYPTED_ARTIFACTS = Object.freeze([
  ...SQL_FILES.map((name) => `${name}.age`),
  "database-manifest.json.age",
  "storage-manifest.json.age",
  "storage-objects.tar.age",
]);
const EXPORT_BUNDLE_FILES = Object.freeze([
  EXPORT_MARKER,
  ...ENCRYPTED_ARTIFACTS,
  "receipt.json",
  "receipt.json.sig",
]);
const AGGREGATE_RELATIONS = Object.freeze({
  authUsers: "auth.users",
  organizations: "platform.organizations",
  memberships: "platform.organization_memberships",
  leads: "platform.leads",
  clients: "platform.clients",
  studentCases: "platform.student_cases",
  documentVersions: "platform.document_versions",
  storageObjects: "storage.objects",
  auditEvents: "platform.audit_events",
});
const NON_DECREASING_AGGREGATES = Object.freeze([
  "authUsers",
  "organizations",
  "memberships",
  "clients",
  "studentCases",
  "documentVersions",
  "storageObjects",
]);
const V3_AUTHORITATIVE_BUCKET_IDS = Object.freeze([
  "platform-documents",
  "platform-company-files",
  "platform-whatsapp-media",
]);
const COPY_ALLOWED_SCHEMAS = new Set([
  "auth",
  "pgmq",
  "platform",
  "platform_private",
  "public",
  "storage",
]);
const SQL_IDENTIFIER_SOURCE = "[a-z_][a-z0-9_]{0,62}";
const SQL_COLUMN_SOURCE = `(?:"${SQL_IDENTIFIER_SOURCE}"|${SQL_IDENTIFIER_SOURCE})`;
const COPY_HEADER_PATTERN = new RegExp(
  `^COPY\\s+(?:"(${SQL_IDENTIFIER_SOURCE})"|(${SQL_IDENTIFIER_SOURCE}))\\.` +
  `(?:"(${SQL_IDENTIFIER_SOURCE})"|(${SQL_IDENTIFIER_SOURCE}))\\s+` +
  `\\(${SQL_COLUMN_SOURCE}(?:,\\s*${SQL_COLUMN_SOURCE})*\\)\\s+` +
  "FROM\\s+stdin;$",
  "u",
);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCli = join(repositoryRoot, "node_modules", ".bin", "supabase");
let activeCleanupState;
let activeCleanupRunning = false;
let activeBrowserProof;

class HarnessFailure extends Error {
  constructor(code, stage = "contract", diagnostic) {
    super(code);
    this.name = "HarnessFailure";
    this.code = code;
    this.stage = stage;
    this.diagnostic = diagnostic;
  }
}

function fail(code, stage, diagnostic) {
  throw new HarnessFailure(code, stage, diagnostic);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, expected, code, stage = "artifact_validation") {
  if (!isRecord(value)) fail(code, stage);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, stage);
  }
  return value;
}

function requiredString(value, pattern, code, stage = "artifact_validation") {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail(code, stage);
  }
  if (pattern && !pattern.test(value)) fail(code, stage);
  return value;
}

function nonNegativeInteger(value, code, stage = "artifact_validation") {
  if (!Number.isSafeInteger(value) || value < 0) fail(code, stage);
  return value;
}

function positiveInteger(value, code, stage = "artifact_validation") {
  if (!Number.isSafeInteger(value) || value <= 0) fail(code, stage);
  return value;
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function parseIsoTimestamp(value, code, stage = "artifact_validation") {
  requiredString(value, null, code, stage);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    fail(code, stage);
  }
  return parsed;
}

function checkArtifactAge(createdAt, now, maxAgeHours) {
  const created = parseIsoTimestamp(createdAt, "backup_created_at_invalid");
  const ageMs = now.valueOf() - created.valueOf();
  if (ageMs < -FUTURE_SKEW_MS) fail("backup_timestamp_in_future", "artifact_validation");
  if (ageMs > maxAgeHours * 60 * 60 * 1000) {
    fail("backup_artifact_too_old", "artifact_validation");
  }
  return Math.max(0, ageMs / (60 * 60 * 1000));
}

function validateFileDescriptor(value, code) {
  exactKeys(value, ["bytes", "sha256"], code);
  return Object.freeze({
    bytes: positiveInteger(value.bytes, code),
    sha256: requiredString(value.sha256, SHA256_PATTERN, code),
  });
}

function validateMigrationLedger(value) {
  exactKeys(
    value,
    ["count", "min_version", "max_version", "copy_rows_sha256"],
    "database_migration_ledger_invalid",
  );
  const count = positiveInteger(value.count, "database_migration_ledger_invalid");
  const minVersion = requiredString(
    value.min_version,
    /^\d+$/u,
    "database_migration_ledger_invalid",
  );
  const maxVersion = requiredString(
    value.max_version,
    /^\d+$/u,
    "database_migration_ledger_invalid",
  );
  if (minVersion.localeCompare(maxVersion, "en") > 0) {
    fail("database_migration_ledger_invalid", "artifact_validation");
  }
  return Object.freeze({
    count,
    minVersion,
    maxVersion,
    copyRowsSha256: requiredString(
      value.copy_rows_sha256,
      SHA256_PATTERN,
      "database_migration_ledger_invalid",
    ),
  });
}

function sameCanonicalValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

/** Validate the signed plaintext receipt after its detached SSH signature passes. */
export function validateExportReceipt(receipt, expected) {
  try {
    assertExporterReceipt(receipt);
  } catch {
    fail("receipt_shape_invalid", "receipt_verification");
  }
  exactKeys(receipt.git, ["head", "migration_tree"], "receipt_git_invalid", "receipt_verification");
  exactKeys(receipt.source, ["identity_sha256"], "receipt_source_invalid", "receipt_verification");
  exactKeys(
    receipt.provider_backup,
    ["id", "inserted_at", "status", "physical"],
    "receipt_provider_backup_invalid",
    "receipt_verification",
  );
  requiredString(receipt.provider_backup.id, null, "receipt_provider_backup_invalid", "receipt_verification");
  parseIsoTimestamp(receipt.provider_backup.inserted_at, "receipt_provider_backup_invalid", "receipt_verification");
  if (receipt.provider_backup.status !== "COMPLETED" || typeof receipt.provider_backup.physical !== "boolean") {
    fail("receipt_provider_backup_invalid", "receipt_verification");
  }
  const head = requiredString(receipt.git.head, GIT_OID_PATTERN, "receipt_git_invalid", "receipt_verification");
  const migrationTree = requiredString(
    receipt.git.migration_tree,
    GIT_OID_PATTERN,
    "receipt_git_invalid",
    "receipt_verification",
  );
  if (head !== expected.exportCommit) fail("receipt_export_commit_mismatch", "receipt_verification");
  if (migrationTree !== expected.exportMigrationTree) {
    fail("receipt_export_migration_tree_mismatch", "receipt_verification");
  }
  const sourceIdentitySha256 = requiredString(
    receipt.source.identity_sha256,
    SHA256_PATTERN,
    "receipt_source_invalid",
    "receipt_verification",
  );
  if (sourceIdentitySha256 !== expected.sourceIdentitySha256) {
    fail("receipt_source_identity_mismatch", "receipt_verification");
  }
  if (receipt.signature.public_key_fingerprint !== expected.trustedPublicKeyFingerprint) {
    fail("receipt_signing_fingerprint_mismatch", "receipt_verification");
  }
  exactKeys(
    receipt.encrypted_artifacts,
    ENCRYPTED_ARTIFACTS,
    "receipt_encrypted_artifacts_invalid",
    "receipt_verification",
  );
  const encryptedArtifacts = Object.freeze(Object.fromEntries(
    ENCRYPTED_ARTIFACTS.map((name) => [
      name,
      validateFileDescriptor(receipt.encrypted_artifacts[name], "receipt_encrypted_artifact_invalid"),
    ]),
  ));
  exactKeys(
    receipt.database,
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
    "receipt_verification",
  );
  const database = Object.freeze({
    postgresMajor: positiveInteger(receipt.database.postgres_major, "receipt_database_invalid", "receipt_verification"),
    migrationLedger: validateMigrationLedger({
      count: receipt.database.migration_count,
      min_version: receipt.database.migration_min_version,
      max_version: receipt.database.migration_max_version,
      copy_rows_sha256: receipt.database.migration_copy_rows_sha256,
    }),
    dataCopySectionsSha256: requiredString(
      receipt.database.data_copy_sections_sha256,
      SHA256_PATTERN,
      "receipt_database_invalid",
      "receipt_verification",
    ),
    stabilityProofSha256: requiredString(
      receipt.database.stability_proof_sha256,
      SHA256_PATTERN,
      "receipt_database_invalid",
      "receipt_verification",
    ),
    snapshotMode: requiredString(
      receipt.database.snapshot_mode,
      null,
      "receipt_database_invalid",
      "receipt_verification",
    ),
    tableCount: nonNegativeInteger(receipt.database.table_count, "receipt_database_invalid", "receipt_verification"),
    rowCount: nonNegativeInteger(receipt.database.row_count, "receipt_database_invalid", "receipt_verification"),
    authUserCount: nonNegativeInteger(receipt.database.auth_user_count, "receipt_database_invalid", "receipt_verification"),
  });
  exactKeys(
    receipt.storage,
    [
      "inventory_sha256",
      "bucket_count",
      "private_bucket_count",
      "public_bucket_count",
      "object_count",
      "total_bytes",
    ],
    "receipt_storage_invalid",
    "receipt_verification",
  );
  const storage = Object.freeze({
    inventorySha256: requiredString(receipt.storage.inventory_sha256, SHA256_PATTERN, "receipt_storage_invalid", "receipt_verification"),
    bucketCount: nonNegativeInteger(receipt.storage.bucket_count, "receipt_storage_invalid", "receipt_verification"),
    privateBucketCount: nonNegativeInteger(receipt.storage.private_bucket_count, "receipt_storage_invalid", "receipt_verification"),
    publicBucketCount: nonNegativeInteger(receipt.storage.public_bucket_count, "receipt_storage_invalid", "receipt_verification"),
    objectCount: nonNegativeInteger(receipt.storage.object_count, "receipt_storage_invalid", "receipt_verification"),
    totalBytes: nonNegativeInteger(receipt.storage.total_bytes, "receipt_storage_invalid", "receipt_verification"),
  });
  if (storage.privateBucketCount + storage.publicBucketCount !== storage.bucketCount) {
    fail("receipt_storage_invalid", "receipt_verification");
  }
  return Object.freeze({
    schema: RECEIPT_SCHEMA,
    capturedAt: parseIsoTimestamp(receipt.captured_at, "receipt_timestamp_invalid", "receipt_verification").toISOString(),
    git: Object.freeze({ head, migrationTree }),
    sourceIdentitySha256,
    encryptedArtifacts,
    database,
    storage,
    tools: receipt.tools,
    raw: receipt,
  });
}

/** Validate the encrypted database manifest after age decryption. */
export function validateDatabaseManifest(manifest, expected) {
  exactKeys(
    manifest,
    [
      "schema",
      "captured_at",
      "source_receipt",
      "git",
      "tools",
      "artifacts",
      "migration_ledger",
      "data_copy_sections_sha256",
      "stability",
      "aggregates",
    ],
    "database_manifest_shape_invalid",
  );
  if (manifest.schema !== DATABASE_SCHEMA) {
    fail("database_manifest_schema_invalid", "artifact_validation");
  }
  const createdAt = parseIsoTimestamp(
    manifest.captured_at,
    "database_manifest_timestamp_invalid",
  ).toISOString();
  if (createdAt !== expected.receipt.capturedAt) {
    fail("database_manifest_timestamp_mismatch", "artifact_validation");
  }
  exactKeys(
    manifest.source_receipt,
    ["project", "backup", "pooler", "sha256"],
    "database_manifest_source_receipt_invalid",
  );
  if (!isRecord(manifest.source_receipt.project)) {
    fail("database_manifest_source_receipt_invalid", "artifact_validation");
  }
  const sourceProjectRef = requiredString(
    manifest.source_receipt.project.ref,
    PROJECT_REF_PATTERN,
    "database_manifest_source_receipt_invalid",
  );
  const sourceIdentitySha256 = requiredString(
    manifest.source_receipt.sha256,
    SHA256_PATTERN,
    "database_manifest_source_receipt_invalid",
  );
  const computedSourceIdentity = sha256Text(canonicalJson({
    project: manifest.source_receipt.project,
    backup: manifest.source_receipt.backup,
    pooler: manifest.source_receipt.pooler,
  }));
  if (
    computedSourceIdentity !== sourceIdentitySha256 ||
    sourceIdentitySha256 !== expected.receipt.sourceIdentitySha256
  ) {
    fail("database_manifest_source_identity_mismatch", "artifact_validation");
  }
  if (
    !sameCanonicalValue(manifest.git, expected.receipt.raw.git) ||
    !sameCanonicalValue(manifest.tools, expected.receipt.tools)
  ) {
    fail("database_manifest_receipt_binding_mismatch", "artifact_validation");
  }
  exactKeys(manifest.artifacts, SQL_FILES, "database_manifest_files_invalid");
  const files = Object.fromEntries(
    SQL_FILES.map((name) => [
      name,
      validateFileDescriptor(manifest.artifacts[name], "database_manifest_file_invalid"),
    ]),
  );
  const migrationLedger = validateMigrationLedger(manifest.migration_ledger);
  if (!sameCanonicalValue(migrationLedger, expected.receipt.database.migrationLedger)) {
    fail("database_manifest_migration_ledger_mismatch", "artifact_validation");
  }
  const dataCopySectionsSha256 = requiredString(
    manifest.data_copy_sections_sha256,
    SHA256_PATTERN,
    "database_manifest_data_digest_invalid",
  );
  if (dataCopySectionsSha256 !== expected.receipt.database.dataCopySectionsSha256) {
    fail("database_manifest_data_digest_mismatch", "artifact_validation");
  }
  exactKeys(
    manifest.stability,
    ["snapshot_mode", "artifact_semantic_sha256", "proof_sha256"],
    "database_manifest_stability_invalid",
  );
  exactKeys(
    manifest.stability.artifact_semantic_sha256,
    SQL_FILES,
    "database_manifest_stability_invalid",
  );
  for (const value of Object.values(manifest.stability.artifact_semantic_sha256)) {
    requiredString(value, SHA256_PATTERN, "database_manifest_stability_invalid");
  }
  if (
    manifest.stability.snapshot_mode !== expected.receipt.database.snapshotMode ||
    manifest.stability.proof_sha256 !== expected.receipt.database.stabilityProofSha256 ||
    manifest.stability.proof_sha256 !==
      sha256Text(canonicalJson(manifest.stability.artifact_semantic_sha256))
  ) {
    fail("database_manifest_stability_mismatch", "artifact_validation");
  }
  exactKeys(
    manifest.aggregates,
    [
      "table_count",
      "row_count",
      "auth_user_count",
      "storage_bucket_row_count",
      "storage_object_row_count",
      "table_counts_sha256",
    ],
    "database_manifest_aggregates_invalid",
  );
  const aggregates = Object.freeze({
    tableCount: nonNegativeInteger(manifest.aggregates.table_count, "database_manifest_aggregates_invalid"),
    rowCount: nonNegativeInteger(manifest.aggregates.row_count, "database_manifest_aggregates_invalid"),
    authUserCount: nonNegativeInteger(manifest.aggregates.auth_user_count, "database_manifest_aggregates_invalid"),
    storageBucketRowCount: nonNegativeInteger(manifest.aggregates.storage_bucket_row_count, "database_manifest_aggregates_invalid"),
    storageObjectRowCount: nonNegativeInteger(manifest.aggregates.storage_object_row_count, "database_manifest_aggregates_invalid"),
    tableCountsSha256: requiredString(manifest.aggregates.table_counts_sha256, SHA256_PATTERN, "database_manifest_aggregates_invalid"),
  });
  if (
    aggregates.tableCount !== expected.receipt.database.tableCount ||
    aggregates.rowCount !== expected.receipt.database.rowCount ||
    aggregates.authUserCount !== expected.receipt.database.authUserCount ||
    aggregates.storageBucketRowCount !== expected.receipt.storage.bucketCount ||
    aggregates.storageObjectRowCount !== expected.receipt.storage.objectCount
  ) {
    fail("database_manifest_aggregates_mismatch", "artifact_validation");
  }
  return Object.freeze({
    createdAt,
    sourceIdentitySha256,
    sourceProjectRef,
    databaseMajor: expected.receipt.database.postgresMajor,
    migrationLedger,
    files: Object.freeze(files),
    aggregates,
  });
}

function validateBucket(value) {
  exactKeys(
    value,
    ["id", "name", "public", "file_size_limit", "allowed_mime_types", "created_at", "updated_at"],
    "storage_bucket_invalid",
  );
  const id = requiredString(value.id, BUCKET_ID_PATTERN, "storage_bucket_invalid");
  const name = requiredString(value.name, BUCKET_ID_PATTERN, "storage_bucket_invalid");
  if (typeof value.public !== "boolean") {
    fail("storage_bucket_invalid", "artifact_validation");
  }
  if (value.file_size_limit !== null) {
    nonNegativeInteger(value.file_size_limit, "storage_bucket_limit_invalid");
  }
  if (value.allowed_mime_types !== null && !Array.isArray(value.allowed_mime_types)) {
    fail("storage_bucket_mime_types_invalid", "artifact_validation");
  }
  const allowedMimeTypes = value.allowed_mime_types === null
    ? null
    : value.allowed_mime_types.map((candidate) =>
      requiredString(candidate, CONTENT_TYPE_PATTERN, "storage_bucket_mime_types_invalid"));
  if (allowedMimeTypes !== null && new Set(allowedMimeTypes).size !== allowedMimeTypes.length) {
    fail("storage_bucket_mime_types_invalid", "artifact_validation");
  }
  return Object.freeze({
    id,
    name,
    public: value.public,
    fileSizeLimit: value.file_size_limit,
    allowedMimeTypes: allowedMimeTypes === null ? null : Object.freeze(allowedMimeTypes),
  });
}

function validateObjectEntry(value, buckets, index) {
  exactKeys(
    value,
    ["bucket_id", "path", "source_id", "source_version", "blob", "bytes", "sha256"],
    "storage_object_manifest_invalid",
  );
  const bucketId = requiredString(value.bucket_id, BUCKET_ID_PATTERN, "storage_object_bucket_invalid");
  if (!buckets.has(bucketId)) fail("storage_object_bucket_unknown", "artifact_validation");
  const objectPath = requiredString(value.path, null, "storage_object_path_invalid");
  if (
    objectPath.length > 1024 ||
    objectPath.startsWith("/") ||
    objectPath.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(objectPath) ||
    objectPath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail("storage_object_path_invalid", "artifact_validation");
  }
  const bytes = nonNegativeInteger(value.bytes, "storage_object_bytes_invalid");
  if (bytes > MAX_STORAGE_OBJECT_BYTES) {
    fail("storage_object_exceeds_local_limit", "artifact_validation");
  }
  const expectedBlob = `${String(index).padStart(8, "0")}.bin`;
  const blob = requiredString(value.blob, /^\d{8}\.bin$/u, "storage_object_blob_invalid");
  if (blob !== expectedBlob) fail("storage_object_blob_mapping_invalid", "artifact_validation");
  return Object.freeze({
    archivePath: `storage-blobs/${blob}`,
    blob,
    bucketId,
    objectPath,
    sourceId: requiredString(value.source_id, UUID_PATTERN, "storage_object_source_id_invalid"),
    sourceVersion: value.source_version === null
      ? null
      : requiredString(value.source_version, null, "storage_object_source_version_invalid"),
    bytes,
    sha256: requiredString(value.sha256, SHA256_PATTERN, "storage_object_sha256_invalid"),
  });
}

/** Validate the Storage manifest after age decryption. */
export function validateStorageManifest(manifest, expected) {
  exactKeys(
    manifest,
    [
      "schema",
      "captured_at",
      "source_receipt_sha256",
      "inventory_sha256",
      "buckets",
      "objects",
      "aggregates",
    ],
    "storage_manifest_shape_invalid",
  );
  if (manifest.schema !== STORAGE_SCHEMA) {
    fail("storage_manifest_schema_invalid", "artifact_validation");
  }
  const createdAt = parseIsoTimestamp(
    manifest.captured_at,
    "storage_manifest_timestamp_invalid",
  ).toISOString();
  if (createdAt !== expected.receipt.capturedAt) {
    fail("backup_capture_window_exceeded", "artifact_validation");
  }
  if (
    manifest.source_receipt_sha256 !== expected.receipt.sourceIdentitySha256 ||
    manifest.inventory_sha256 !== expected.receipt.storage.inventorySha256
  ) {
    fail("storage_manifest_source_identity_mismatch", "artifact_validation");
  }
  exactKeys(
    manifest.aggregates,
    ["bucket_count", "private_bucket_count", "public_bucket_count", "object_count", "total_bytes"],
    "storage_aggregates_invalid",
  );
  const bucketCount = nonNegativeInteger(manifest.aggregates.bucket_count, "storage_bucket_count_invalid");
  const privateBucketCount = nonNegativeInteger(manifest.aggregates.private_bucket_count, "storage_private_bucket_count_invalid");
  const publicBucketCount = nonNegativeInteger(manifest.aggregates.public_bucket_count, "storage_public_bucket_count_invalid");
  const objectCount = nonNegativeInteger(manifest.aggregates.object_count, "storage_object_count_invalid");
  const totalBytes = nonNegativeInteger(manifest.aggregates.total_bytes, "storage_total_bytes_invalid");
  if (!sameCanonicalValue({
    inventorySha256: manifest.inventory_sha256,
    bucketCount,
    privateBucketCount,
    publicBucketCount,
    objectCount,
    totalBytes,
  }, expected.receipt.storage)) {
    fail("storage_manifest_receipt_mismatch", "artifact_validation");
  }
  if (!Array.isArray(manifest.buckets) || manifest.buckets.length !== bucketCount) {
    fail("storage_bucket_count_mismatch", "artifact_validation");
  }
  const buckets = manifest.buckets.map(validateBucket);
  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  if (bucketIds.size !== buckets.length) fail("storage_bucket_duplicate", "artifact_validation");
  if (buckets.some((bucket, index) => index > 0 && buckets[index - 1].id.localeCompare(bucket.id, "en") >= 0)) {
    fail("storage_bucket_order_invalid", "artifact_validation");
  }
  if (buckets.filter((bucket) => bucket.public).length !== publicBucketCount) {
    fail("storage_public_bucket_count_mismatch", "artifact_validation");
  }
  if (!Array.isArray(manifest.objects)) fail("storage_object_manifest_invalid", "artifact_validation");
  const objects = manifest.objects.map((value, index) => validateObjectEntry(value, bucketIds, index));
  if (objects.length !== objectCount) fail("storage_object_count_mismatch", "artifact_validation");
  if (new Set(objects.map((object) => object.archivePath)).size !== objects.length) {
    fail("storage_archive_path_duplicate", "artifact_validation");
  }
  if (new Set(objects.map((object) => `${object.bucketId}\n${object.objectPath}`)).size !== objects.length) {
    fail("storage_object_duplicate", "artifact_validation");
  }
  if (objects.reduce((sum, object) => sum + object.bytes, 0) !== totalBytes) {
    fail("storage_total_bytes_mismatch", "artifact_validation");
  }
  return Object.freeze({
    createdAt,
    sourceIdentitySha256: expected.receipt.sourceIdentitySha256,
    inventorySha256: manifest.inventory_sha256,
    bucketCount,
    privateBucketCount,
    publicBucketCount,
    objectCount,
    totalBytes,
    buckets: Object.freeze(buckets),
    objects: Object.freeze(objects),
  });
}

function parseRawFlags(args) {
  const result = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) fail("unknown_positional_argument", "arguments");
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const value = equals === -1 ? args[index + 1] : token.slice(equals + 1);
    if (equals === -1) index += 1;
    if (!name || value === undefined || value === "" || value.startsWith("--") || result.has(name)) {
      fail("invalid_or_duplicate_argument", "arguments");
    }
    result.set(name, value);
  }
  return result;
}

const OPTION_DEFINITIONS = Object.freeze({
  bundle: ["bundle", "EVO_V3_RECOVERY_BUNDLE"],
  ageIdentity: ["age-identity", "EVO_V3_RECOVERY_AGE_IDENTITY"],
  trustedPublicKey: ["trusted-public-key", "EVO_V3_RECOVERY_TRUSTED_PUBLIC_KEY"],
  trustedPublicKeyFingerprint: [
    "trusted-public-key-fingerprint",
    "EVO_V3_RECOVERY_TRUSTED_PUBLIC_KEY_FINGERPRINT",
  ],
  sourceIdentitySha256: ["source-identity-sha256", "EVO_V3_RECOVERY_SOURCE_IDENTITY_SHA256"],
  expectedExportCommit: ["expected-export-commit", "EVO_V3_RECOVERY_EXPECTED_EXPORT_COMMIT"],
  expectedExportMigrationTree: [
    "expected-export-migration-tree",
    "EVO_V3_RECOVERY_EXPECTED_EXPORT_MIGRATION_TREE",
  ],
  expectedRepositoryCommit: [
    "expected-repository-commit",
    "EVO_V3_RECOVERY_EXPECTED_REPOSITORY_COMMIT",
  ],
  maxAgeHours: ["max-age-hours", "EVO_V3_RECOVERY_MAX_AGE_HOURS"],
  evidenceOut: ["evidence-out", "EVO_V3_RECOVERY_EVIDENCE_OUT"],
});

export function parseHarnessOptions(args, environment = process.env) {
  const flags = parseRawFlags(args);
  const known = new Set(Object.values(OPTION_DEFINITIONS).map(([flag]) => flag));
  if ([...flags.keys()].some((name) => !known.has(name))) {
    fail("unknown_argument", "arguments");
  }
  const options = {};
  for (const [key, [flag, envName]] of Object.entries(OPTION_DEFINITIONS)) {
    const fromFlag = flags.get(flag);
    const fromEnvironment = environment[envName];
    if (fromFlag !== undefined && typeof fromEnvironment === "string" && fromEnvironment.length > 0) {
      fail("argument_environment_conflict", "arguments");
    }
    options[key] = fromFlag ?? fromEnvironment;
  }
  const required = [
    "bundle",
    "ageIdentity",
    "trustedPublicKey",
    "trustedPublicKeyFingerprint",
    "sourceIdentitySha256",
    "expectedExportCommit",
    "expectedExportMigrationTree",
    "expectedRepositoryCommit",
  ];
  if (required.some((key) => typeof options[key] !== "string" || options[key].length === 0)) {
    fail("required_argument_missing", "arguments");
  }
  requiredString(options.sourceIdentitySha256, SHA256_PATTERN, "source_identity_sha256_invalid", "arguments");
  requiredString(
    options.trustedPublicKeyFingerprint,
    /^SHA256:[A-Za-z0-9+/]+$/u,
    "trusted_public_key_fingerprint_invalid",
    "arguments",
  );
  requiredString(options.expectedExportCommit, GIT_OID_PATTERN, "expected_export_commit_invalid", "arguments");
  requiredString(
    options.expectedExportMigrationTree,
    GIT_OID_PATTERN,
    "expected_export_migration_tree_invalid",
    "arguments",
  );
  requiredString(
    options.expectedRepositoryCommit,
    GIT_OID_PATTERN,
    "expected_repository_commit_invalid",
    "arguments",
  );
  const maxAgeHours = options.maxAgeHours === undefined
    ? 72
    : Number(options.maxAgeHours);
  if (!Number.isSafeInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > MAX_BACKUP_AGE_HOURS) {
    fail("max_age_hours_invalid", "arguments");
  }
  options.maxAgeHours = maxAgeHours;
  return Object.freeze(options);
}

function assertPrivateRegularFile(path, { maxBytes, code }) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(`${code}_path_invalid`, "preflight");
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    fail(`${code}_missing`, "preflight");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${code}_not_regular`, "preflight");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail(`${code}_owner_invalid`, "preflight");
  }
  if ((metadata.mode & 0o077) !== 0) fail(`${code}_permissions_too_open`, "preflight");
  if (metadata.size <= 0 || metadata.size > maxBytes) fail(`${code}_size_invalid`, "preflight");
  return realpathSync(path);
}

function assertTrustedPublicKey(path) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    fail("trusted_public_key_path_invalid", "preflight");
  }
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    fail("trusted_public_key_missing", "preflight");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail("trusted_public_key_not_regular", "preflight");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail("trusted_public_key_owner_invalid", "preflight");
  }
  if ((metadata.mode & 0o022) !== 0 || metadata.size <= 0 || metadata.size > 1024 * 1024) {
    fail("trusted_public_key_permissions_or_size_invalid", "preflight");
  }
  return realpathSync(path);
}

export function assertExactExportBundle(path) {
  if (typeof path !== "string" || !isAbsolute(path)) fail("export_bundle_path_invalid", "preflight");
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    fail("export_bundle_missing", "preflight");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("export_bundle_not_directory", "preflight");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail("export_bundle_owner_invalid", "preflight");
  }
  if ((metadata.mode & 0o077) !== 0) fail("export_bundle_permissions_too_open", "preflight");
  const root = realpathSync(path);
  const actual = readdirSync(root).sort();
  const expected = [...EXPORT_BUNDLE_FILES].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    fail("export_bundle_inventory_invalid", "preflight");
  }
  const marker = assertPrivateRegularFile(join(root, EXPORT_MARKER), {
    maxBytes: 1024,
    code: "export_bundle_marker",
  });
  if (readFileSync(marker, "utf8") !== "managed-supabase-export\n") {
    fail("export_bundle_marker_invalid", "preflight");
  }
  return root;
}

function assertEvidenceDestination(path) {
  if (path === undefined) return undefined;
  if (!isAbsolute(path) || existsSync(path)) fail("evidence_destination_invalid", "preflight");
  const parent = realpathSync(dirname(path));
  const metadata = lstatSync(parent);
  if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0) {
    fail("evidence_parent_not_private", "preflight");
  }
  return join(parent, relative(parent, path));
}

function minimalChildEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: process.env.HOME ?? tmpdir(),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: "C",
    DOCKER_CONTEXT: "orbstack",
    SUPABASE_TELEMETRY_DISABLED: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    ...extra,
  };
}

export function validateRepositoryStateSnapshot(snapshot, expectedCommit) {
  exactKeys(snapshot, ["commit", "tree", "status"], "repository_state_invalid", "repository_preflight");
  const expected = requiredString(
    expectedCommit,
    GIT_OID_PATTERN,
    "expected_repository_commit_invalid",
    "repository_preflight",
  );
  const commit = requiredString(
    snapshot.commit,
    GIT_OID_PATTERN,
    "repository_commit_invalid",
    "repository_preflight",
  );
  const tree = requiredString(
    snapshot.tree,
    GIT_OID_PATTERN,
    "repository_tree_invalid",
    "repository_preflight",
  );
  if (commit !== expected) fail("repository_commit_mismatch", "repository_preflight");
  if (snapshot.status !== "") fail("repository_worktree_not_clean", "repository_preflight");
  return Object.freeze({ commit, tree });
}

function assertRepositoryState(expectedCommit) {
  const gitEnvironment = minimalChildEnvironment({ GIT_OPTIONAL_LOCKS: "0" });
  const topLevel = execute("git", ["rev-parse", "--show-toplevel"], {
    env: gitEnvironment,
    code: "repository_root_query_failed",
    stage: "repository_preflight",
  });
  if (realpathSync(topLevel) !== realpathSync(repositoryRoot)) {
    fail("repository_root_mismatch", "repository_preflight");
  }
  return validateRepositoryStateSnapshot({
    commit: execute("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      env: gitEnvironment,
      code: "repository_commit_query_failed",
      stage: "repository_preflight",
    }),
    tree: execute("git", ["rev-parse", "--verify", "HEAD^{tree}"], {
      env: gitEnvironment,
      code: "repository_tree_query_failed",
      stage: "repository_preflight",
    }),
    status: execute("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      env: gitEnvironment,
      code: "repository_status_query_failed",
      stage: "repository_preflight",
    }),
  }, expectedCommit);
}

export function classifyLocalSupabaseStartFailure(output, processErrorCode) {
  if (processErrorCode) return "local_supabase_start_process_failed";
  const diagnostic = String(output).toLowerCase();
  if (/failed to connect to postgres[\s\S]{0,240}(?:econnrefused|connection refused)[\s\S]{0,80}127\.0\.0\.1/u.test(diagnostic)) {
    return "local_supabase_start_postgres_loopback_unreachable";
  }
  if (/network[\s\S]{0,160}(?:not found|does not exist|could not be found)/u.test(diagnostic)) {
    return "local_supabase_start_network_unavailable";
  }
  if (/port is already allocated|address already in use|failed to bind|bind for .* failed/u.test(diagnostic)) {
    return "local_supabase_start_port_conflict";
  }
  if (/failed (?:to )?(?:parse|parsing|decode|load).*config|config(?:\.toml)?[\s\S]{0,120}(?:invalid|parse error)/u.test(diagnostic)) {
    return "local_supabase_start_config_invalid";
  }
  if (/unhealthy|health[- ]check|did not become healthy/u.test(diagnostic)) {
    return "local_supabase_start_health_check_failed";
  }
  if (/no space left on device/u.test(diagnostic)) {
    return "local_supabase_start_storage_exhausted";
  }
  if (/cannot connect to the docker daemon|is the docker daemon running/u.test(diagnostic)) {
    return "local_supabase_start_docker_unavailable";
  }
  if (/failed to pull|pull access denied|manifest unknown/u.test(diagnostic)) {
    return "local_supabase_start_image_unavailable";
  }
  return "local_supabase_start_failed_unclassified";
}

export function sanitizeLocalSupabaseStartDiagnostic(output, exitStatus) {
  const raw = String(output);
  const lower = raw.toLowerCase();
  const fingerprints = Object.entries({
    container_create: /failed to create docker container/u,
    container_start: /failed to start docker container/u,
    container_runtime: /error running container/u,
    name_conflict: /already in use|already used|conflict/u,
    network_endpoint: /invalid endpoint settings|configured subnet|ip-range/u,
    network_missing: /network[\s\S]{0,160}(?:not found|does not exist)/u,
    postgres_loopback_refused: /failed to connect to postgres[\s\S]{0,240}(?:econnrefused|connection refused)[\s\S]{0,80}127\.0\.0\.1/u,
    volume_create: /failed to create (?:docker )?volume/u,
    mount_invalid: /mounts denied|invalid mount|bind source path/u,
    config_invalid: /failed (?:to )?(?:parse|parsing|decode|load).*config/u,
    path_missing: /no such file or directory/u,
    permission_denied: /permission denied|operation not permitted/u,
  }).filter(([, pattern]) => pattern.test(lower)).map(([name]) => name);
  const sanitizedErrorTemplates = raw.split(/\r?\n/u)
    .filter((line) => /error|fail|fatal|invalid|not found|already|warn/u.test(line))
    .filter((line) => !/(?:key|secret|token|password|jwt|anon|service[_ -]?role|db_url|api_url)/iu.test(line))
    .map((line) => line
      .replace(/https?:\/\/\S+/giu, "[url]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email]")
      .replace(/(?:\/Users|\/private|\/var\/folders|\/tmp)\/[^\s"',)]+/gu, "[path]")
      .replace(/evo_v3_recovery_[0-9a-f]{12}_private/gu, "[network]")
      .replace(/evov3recovery[0-9a-f]{12}/gu, "[project]")
      .replace(/\b[0-9a-f]{24,}\b/giu, "[opaque]")
      .replace(/\b[A-Za-z0-9_+./=-]{32,}\b/gu, "[opaque]")
      .slice(0, 300))
    .slice(0, 6);
  return Object.freeze({
    exitStatus: Number.isInteger(exitStatus) ? exitStatus : null,
    outputBytes: Buffer.byteLength(raw),
    outputSha256: sha256Text(raw),
    lineCount: raw.split(/\r?\n/u).length,
    fingerprints: Object.freeze(fingerprints),
    sanitizedErrorTemplates: Object.freeze(sanitizedErrorTemplates),
  });
}

export function classifyMigrationLedgerQueryFailure(output, processErrorCode) {
  if (processErrorCode) return "migration_ledger_query_process_failed";
  const diagnostic = String(output).toLowerCase();
  if (/relation ["']?supabase_migrations\.schema_migrations["']? does not exist/u.test(diagnostic)) {
    return "migration_ledger_relation_missing";
  }
  if (/column ["']?(?:schema_migrations\.)?version["']? does not exist/u.test(diagnostic)) {
    return "migration_ledger_version_column_missing";
  }
  if (/permission denied for (?:schema supabase_migrations|table schema_migrations)/u.test(diagnostic)) {
    return "migration_ledger_permission_denied";
  }
  if (/password authentication failed|no pg_hba\.conf entry/u.test(diagnostic)) {
    return "migration_ledger_authentication_failed";
  }
  if (/connection refused|could not connect to server|server closed the connection/u.test(diagnostic)) {
    return "migration_ledger_connection_failed";
  }
  return "migration_ledger_query_failed_unclassified";
}

export function sanitizeDatabaseCommandDiagnostic(output, exitStatus) {
  const raw = String(output);
  const lower = raw.toLowerCase();
  const fingerprints = Object.entries({
    relation_missing: /relation ["'][^"']+["'] does not exist/u,
    column_missing: /column ["'][^"']+["'] does not exist/u,
    permission_denied: /permission denied/u,
    authentication_failed: /password authentication failed|no pg_hba\.conf entry/u,
    connection_failed: /connection refused|could not connect to server|server closed the connection/u,
    syntax_error: /syntax error/u,
    constraint_violation: /violates .* constraint|duplicate key value/u,
  }).filter(([, pattern]) => pattern.test(lower)).map(([name]) => name);
  return Object.freeze({
    exitStatus: Number.isInteger(exitStatus) ? exitStatus : null,
    outputBytes: Buffer.byteLength(raw),
    outputSha256: sha256Text(raw),
    lineCount: raw.split(/\r?\n/u).length,
    fingerprints: Object.freeze(fingerprints),
  });
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? minimalChildEnvironment(),
    encoding: options.capture === false ? undefined : "utf8",
    stdio: options.capture === false ? "ignore" : "pipe",
    timeout: options.timeout ?? 60_000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    input: options.input,
  });
  const accepted = options.accepted ?? [0];
  if (result.error || !accepted.includes(result.status)) {
    const failureOutput = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
    const code = typeof options.failureClassifier === "function"
      ? options.failureClassifier(
        failureOutput,
        result.error?.code,
      )
      : options.code ?? "command_failed";
    const diagnostic = typeof options.failureDiagnostic === "function"
      ? options.failureDiagnostic(failureOutput, result.status)
      : undefined;
    fail(code, options.stage ?? "execution", diagnostic);
  }
  return options.capture === false ? "" : String(result.stdout ?? "").trim();
}

export function verifyReceiptSignature({
  receiptPath,
  signaturePath,
  trustedPublicKeyPath,
  expectedFingerprint,
  workingDirectory,
}) {
  let publicKey;
  let fingerprint;
  try {
    publicKey = readFileSync(trustedPublicKeyPath, "utf8").trim();
    fingerprint = sshPublicKeyFingerprint(publicKey);
  } catch {
    fail("trusted_public_key_invalid", "receipt_verification");
  }
  if (fingerprint !== expectedFingerprint) {
    fail("trusted_public_key_fingerprint_mismatch", "receipt_verification");
  }
  const fields = publicKey.split(/\s+/u);
  if (fields.length < 2) fail("trusted_public_key_invalid", "receipt_verification");
  const allowedSigners = join(workingDirectory, "receipt-allowed-signers");
  writeFileSync(allowedSigners, `${SIGNATURE_IDENTITY} ${fields[0]} ${fields[1]}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    execute(
      "ssh-keygen",
      [
        "-Y",
        "verify",
        "-f",
        allowedSigners,
        "-I",
        SIGNATURE_IDENTITY,
        "-n",
        SIGNATURE_NAMESPACE,
        "-s",
        signaturePath,
      ],
      {
        cwd: dirname(receiptPath),
        input: readFileSync(receiptPath),
        code: "receipt_signature_verification_failed",
        stage: "receipt_verification",
      },
    );
  } finally {
    rmSync(allowedSigners, { force: true });
  }
  return fingerprint;
}

function assertOrbStackPreflight() {
  const orbStatus = execute("orb", ["status"], {
    code: "orbstack_status_unavailable",
    stage: "orbstack_preflight",
  });
  if (!/(?:^|\s)Running(?:\s|$)/u.test(orbStatus)) {
    fail("orbstack_not_running", "orbstack_preflight");
  }
  const context = execute("docker", ["context", "show"], {
    code: "docker_context_unavailable",
    stage: "orbstack_preflight",
  });
  if (context !== "orbstack") fail("docker_context_not_orbstack", "orbstack_preflight");
  if (process.env.DOCKER_HOST) fail("docker_host_override_present", "orbstack_preflight");
}

function decryptAge(inputPath, outputPath, identityPath) {
  execute(
    "age",
    ["--decrypt", "--identity", identityPath, "--output", outputPath, inputPath],
    { capture: false, timeout: 2 * 60 * 60 * 1000, code: "age_decrypt_failed", stage: "decryption" },
  );
  chmodSync(outputPath, 0o600);
}

function readPrivateJson(path, code) {
  const metadata = statSync(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_MANIFEST_BYTES) {
    fail(code, "artifact_validation");
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(code, "artifact_validation");
  }
  return parsed;
}

async function assertPlaintextFile(path, expected, code) {
  const metadata = statSync(path);
  if (!metadata.isFile() || metadata.size !== expected.bytes) fail(`${code}_bytes_mismatch`, "artifact_validation");
  if (await sha256File(path) !== expected.sha256) fail(`${code}_sha256_mismatch`, "artifact_validation");
}

export function parseExportedMigrationHistory(text, manifestLedger) {
  if (typeof text !== "string" || text.includes("\0")) {
    fail("exported_migration_history_invalid", "artifact_validation");
  }
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  let section;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("COPY")) continue;
    const match = /^COPY\s+(?:"supabase_migrations"|supabase_migrations)\.(?:"schema_migrations"|schema_migrations)\s+\((.+)\)\s+FROM\s+stdin;$/u.exec(lines[index]);
    if (!match || section) fail("exported_migration_history_target_invalid", "artifact_validation");
    const header = lines[index];
    const rows = [];
    index += 1;
    while (index < lines.length && lines[index] !== "\\.") {
      rows.push(lines[index]);
      index += 1;
    }
    if (index >= lines.length) fail("exported_migration_history_unterminated", "artifact_validation");
    section = { header, columns: match[1], rows };
  }
  if (!section || section.rows.length === 0) {
    fail("exported_migration_history_missing", "artifact_validation");
  }
  const columns = section.columns.split(",").map((column) => column.trim().replaceAll('"', ""));
  if (JSON.stringify(columns) !== JSON.stringify(MIGRATION_HISTORY_COLUMNS)) {
    fail("exported_migration_history_columns_invalid", "artifact_validation");
  }
  const versionIndex = columns.indexOf("version");
  const nameIndex = columns.indexOf("name");
  const statementsIndex = columns.indexOf("statements");
  const entries = [];
  for (const row of section.rows) {
    const cells = row.split("\t");
    const version = requiredString(cells[versionIndex], /^\d+$/u, "exported_migration_history_row_invalid");
    const name = requiredString(cells[nameIndex], MIGRATION_NAME_PATTERN, "exported_migration_history_row_invalid");
    if (cells[statementsIndex] === undefined) {
      fail("exported_migration_history_row_invalid", "artifact_validation");
    }
    if (entries.length > 0 && entries.at(-1).version.localeCompare(version, "en") >= 0) {
      fail("exported_migration_history_order_invalid", "artifact_validation");
    }
    entries.push(Object.freeze({ version, name }));
  }
  const copyRowsSha256 = sha256Text(`${section.header}\n${section.rows.join("\n")}\n\\.\n`);
  if (
    entries.length !== manifestLedger.count ||
    entries[0].version !== manifestLedger.minVersion ||
    entries.at(-1).version !== manifestLedger.maxVersion ||
    copyRowsSha256 !== manifestLedger.copyRowsSha256
  ) {
    fail("exported_migration_history_manifest_mismatch", "artifact_validation");
  }
  return Object.freeze({ entries: Object.freeze(entries), copyRowsSha256 });
}

async function prepareArtifacts(options, harnessRoot, decryptPayloads) {
  const bundle = assertExactExportBundle(options.bundle);
  const paths = {
    bundle,
    receipt: assertPrivateRegularFile(join(bundle, "receipt.json"), { maxBytes: MAX_MANIFEST_BYTES, code: "receipt" }),
    signature: assertPrivateRegularFile(join(bundle, "receipt.json.sig"), { maxBytes: 1024 * 1024, code: "receipt_signature" }),
    ageIdentity: assertPrivateRegularFile(options.ageIdentity, { maxBytes: 1024 * 1024, code: "age_identity" }),
    trustedPublicKey: assertTrustedPublicKey(options.trustedPublicKey),
    evidenceOut: assertEvidenceDestination(options.evidenceOut),
  };
  for (const name of ENCRYPTED_ARTIFACTS) {
    const maxBytes = name === "storage-objects.tar.age"
      ? MAX_STORAGE_ARCHIVE_BYTES
      : name.endsWith("-manifest.json.age")
        ? MAX_MANIFEST_BYTES
        : MAX_SQL_BYTES;
    paths[name] = assertPrivateRegularFile(join(bundle, name), {
      maxBytes,
      code: "encrypted_artifact",
    });
  }
  if (new Set([bundle, paths.ageIdentity, paths.trustedPublicKey, paths.evidenceOut].filter(Boolean)).size !==
    [bundle, paths.ageIdentity, paths.trustedPublicKey, paths.evidenceOut].filter(Boolean).length) {
    fail("artifact_paths_must_be_distinct", "preflight");
  }

  const decryptedRoot = join(harnessRoot, "decrypted");
  mkdirSync(decryptedRoot, { mode: 0o700 });
  verifyReceiptSignature({
    receiptPath: paths.receipt,
    signaturePath: paths.signature,
    trustedPublicKeyPath: paths.trustedPublicKey,
    expectedFingerprint: options.trustedPublicKeyFingerprint,
    workingDirectory: decryptedRoot,
  });
  let rawReceipt;
  const receiptText = readFileSync(paths.receipt, "utf8");
  try {
    rawReceipt = JSON.parse(receiptText);
  } catch {
    fail("receipt_json_invalid", "receipt_verification");
  }
  if (receiptText !== canonicalJson(rawReceipt)) fail("receipt_not_canonical", "receipt_verification");
  const receipt = validateExportReceipt(rawReceipt, {
    sourceIdentitySha256: options.sourceIdentitySha256,
    exportCommit: options.expectedExportCommit,
    exportMigrationTree: options.expectedExportMigrationTree,
    trustedPublicKeyFingerprint: options.trustedPublicKeyFingerprint,
  });
  const ciphertextHashes = {};
  for (const name of ENCRYPTED_ARTIFACTS) {
    const metadata = statSync(paths[name]);
    const expected = receipt.encryptedArtifacts[name];
    const digest = await sha256File(paths[name]);
    if (metadata.size !== expected.bytes || digest !== expected.sha256) {
      fail("encrypted_artifact_receipt_mismatch", "receipt_verification");
    }
    ciphertextHashes[name] = digest;
  }
  const databaseManifestPath = join(decryptedRoot, "database-manifest.json");
  const storageManifestPath = join(decryptedRoot, "storage-manifest.json");
  decryptAge(paths["database-manifest.json.age"], databaseManifestPath, paths.ageIdentity);
  decryptAge(paths["storage-manifest.json.age"], storageManifestPath, paths.ageIdentity);
  const rawDatabaseManifest = readPrivateJson(databaseManifestPath, "database_manifest_json_invalid");
  const database = validateDatabaseManifest(rawDatabaseManifest, { receipt });
  const storage = validateStorageManifest(
    readPrivateJson(storageManifestPath, "storage_manifest_json_invalid"),
    { receipt },
  );
  const now = new Date();
  const ageHours = checkArtifactAge(receipt.capturedAt, now, options.maxAgeHours);
  const plaintext = { databaseManifest: databaseManifestPath, storageManifest: storageManifestPath };
  const historyDataPath = join(decryptedRoot, "history-data.sql");
  decryptAge(paths["history-data.sql.age"], historyDataPath, paths.ageIdentity);
  await assertPlaintextFile(historyDataPath, database.files["history-data.sql"], "history_data");
  plaintext.historyData = historyDataPath;
  const exportedHistory = parseExportedMigrationHistory(
    readFileSync(historyDataPath, "utf8"),
    database.migrationLedger,
  );
  if (decryptPayloads) {
    for (const name of SQL_FILES.filter((name) => name !== "history-data.sql")) {
      const key = name.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase()).replace(".sql", "");
      const output = join(decryptedRoot, name);
      decryptAge(paths[`${name}.age`], output, paths.ageIdentity);
      await assertPlaintextFile(output, database.files[name], name.replace(".sql", ""));
      plaintext[key] = output;
    }
    const storageArchivePath = join(decryptedRoot, "storage-objects.tar");
    decryptAge(paths["storage-objects.tar.age"], storageArchivePath, paths.ageIdentity);
    const archiveMetadata = statSync(storageArchivePath);
    if (!archiveMetadata.isFile() || archiveMetadata.size <= 0 || archiveMetadata.size > MAX_STORAGE_ARCHIVE_BYTES) {
      fail("storage_archive_size_invalid", "artifact_validation");
    }
    plaintext.storageArchive = storageArchivePath;
  }
  return Object.freeze({
    paths: Object.freeze(paths),
    receipt,
    database,
    exportedHistory,
    storage,
    plaintext: Object.freeze(plaintext),
    ciphertextHashes: Object.freeze(ciphertextHashes),
    ageHours,
  });
}

async function reserveLoopbackPort() {
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

async function reservePortMap() {
  const originals = [45420, 45421, 45422, 45423, 45424, 45425, 45426, 45427, 45428, 45429];
  const ports = [];
  while (ports.length < originals.length + 2) {
    const port = await reserveLoopbackPort();
    if (!ports.includes(port)) ports.push(port);
  }
  return Object.freeze({
    replacements: Object.freeze(Object.fromEntries(originals.map((value, index) => [value, ports[index]]))),
    app: ports.at(-2),
    clamd: ports.at(-1),
  });
}

function renderIsolatedSupabaseConfig(projectName, portMap) {
  let content = readFileSync(join(repositoryRoot, "supabase", "config.toml"), "utf8");
  content = content.replace(/^project_id\s*=.*$/mu, `project_id = "${projectName}"`);
  for (const [from, to] of Object.entries(portMap.replacements)) {
    content = content.replaceAll(String(from), String(to));
  }
  content = content.replace(
    /^site_url\s*=.*$/mu,
    `site_url = "http://127.0.0.1:${portMap.app}"`,
  );
  content = content.replace(
    /^additional_redirect_urls\s*=.*$/mu,
    `additional_redirect_urls = ["http://127.0.0.1:${portMap.app}"]`,
  );
  const lines = content.split("\n");
  const retained = [];
  let skipBucket = false;
  for (const line of lines) {
    if (/^\[storage\.buckets\./u.test(line)) {
      skipBucket = true;
      continue;
    }
    if (skipBucket && /^\[/u.test(line)) skipBucket = false;
    if (!skipBucket) retained.push(line);
  }
  content = retained.join("\n");
  content = content.replace(
    /(\[db\.migrations\][\s\S]*?^enabled\s*=\s*)true/mu,
    "$1false",
  );
  return content;
}

function setMigrationsEnabled(configPath) {
  const content = readFileSync(configPath, "utf8").replace(
    /(\[db\.migrations\][\s\S]*?^enabled\s*=\s*)false/mu,
    "$1true",
  );
  writeFileSync(configPath, content, { mode: 0o600 });
}

function decodedJwtRole(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function parseSupabaseStatus(output) {
  const values = {};
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        fail("supabase_status_invalid", "local_supabase_start");
      }
    }
    values[match[1]] = value;
  }
  const apiUrl = values.API_URL;
  const dbUrl = values.DB_URL;
  const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  const serverSecretKey = values.SECRET_KEY ?? serviceRoleKey;
  if (![apiUrl, dbUrl, publishableKey, serviceRoleKey, serverSecretKey].every((value) =>
    typeof value === "string" && value.length > 0)) {
    fail("supabase_status_missing_required_value", "local_supabase_start");
  }
  if (decodedJwtRole(serviceRoleKey) !== "service_role") {
    fail("supabase_status_service_role_key_invalid", "local_supabase_start");
  }
  assertLoopbackUrl(apiUrl, "supabase_api_not_loopback");
  assertLoopbackUrl(dbUrl, "supabase_database_not_loopback", ["postgresql:", "postgres:"]);
  return Object.freeze({ apiUrl, dbUrl, publishableKey, serviceRoleKey, serverSecretKey });
}

function assertLoopbackUrl(raw, code, protocols = ["http:", "https:"]) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(code, "isolation");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname) || !protocols.includes(url.protocol)) {
    fail(code, "isolation");
  }
  return url;
}

function psqlEnvironment(dbUrl, userOverride) {
  const url = assertLoopbackUrl(dbUrl, "psql_database_not_loopback", ["postgresql:", "postgres:"]);
  return minimalChildEnvironment({
    PGHOST: url.hostname.replace(/^\[|\]$/gu, ""),
    PGPORT: url.port,
    PGUSER: userOverride ?? decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//u, ""),
    PGSSLMODE: "disable",
  });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quotedSqlIdentifier(value) {
  if (!new RegExp(`^${SQL_IDENTIFIER_SOURCE}$`, "u").test(value)) {
    fail("copy_target_identifier_invalid", "database_restore");
  }
  return `"${value}"`;
}

export function parseQualifiedCopyHeader(line) {
  if (typeof line !== "string") fail("copy_header_invalid", "database_restore");
  const match = COPY_HEADER_PATTERN.exec(line);
  if (!match) fail("copy_header_invalid", "database_restore");
  const schema = match[1] ?? match[2];
  const table = match[3] ?? match[4];
  if (!COPY_ALLOWED_SCHEMAS.has(schema)) {
    fail("copy_target_schema_not_allowed", "database_restore");
  }
  if (schema === "pgmq" && !/^[qa]_[a-z][a-z0-9_]{0,62}$/u.test(table)) {
    fail("pgmq_copy_inventory_unsupported", "database_restore");
  }
  return Object.freeze({ schema, table });
}

async function scanCopyInventory(dataPath) {
  const targets = new Map();
  let active;
  const lines = createInterface({
    input: createReadStream(dataPath),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (active) {
      if (line === "\\.") {
        active = undefined;
      } else {
        targets.get(active).rows += 1;
      }
      continue;
    }
    if (!line.startsWith("COPY")) continue;
    const target = parseQualifiedCopyHeader(line);
    const key = `${target.schema}.${target.table}`;
    if (targets.has(key)) fail("copy_target_duplicate", "database_restore");
    targets.set(key, { ...target, rows: 0 });
    active = key;
  }
  if (active) fail("copy_inventory_unterminated", "database_restore");
  if (targets.size === 0) fail("copy_inventory_empty", "database_restore");
  return Object.freeze([...targets.values()].map((target) => Object.freeze(target)));
}

function pgmqQueuesFromCopyInventory(copyTargets) {
  const queues = new Map();
  for (const target of copyTargets.filter(({ schema }) => schema === "pgmq")) {
    const match = /^([qa])_([a-z][a-z0-9_]{0,62})$/u.exec(target.table);
    if (!match) fail("pgmq_copy_inventory_unsupported", "database_restore");
    const queue = queues.get(match[2]) ?? { name: match[2], relations: new Map() };
    if (queue.relations.has(match[1])) fail("pgmq_copy_inventory_unsupported", "database_restore");
    queue.relations.set(match[1], Object.freeze({ relation: target.table, rows: target.rows }));
    queues.set(match[2], queue);
  }
  for (const queue of queues.values()) {
    if (!queue.relations.has("q") || !queue.relations.has("a")) {
      fail("pgmq_copy_inventory_incomplete", "database_restore");
    }
  }
  return Object.freeze([...queues.values()].map((queue) => Object.freeze({
    name: queue.name,
    relations: Object.freeze([...queue.relations.values()]),
  })));
}

function assertCopyTargetsExist(status, copyTargets) {
  for (const target of copyTargets) {
    const relationKind = psqlScalar(
      status,
      `SELECT coalesce((SELECT relation.relkind::text
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = ${sqlLiteral(target.schema)}
          AND relation.relname = ${sqlLiteral(target.table)}), '')`,
      "database_restore",
      true,
    );
    if (!new Set(["r", "p"]).has(relationKind)) {
      fail("copy_target_relation_missing", "database_restore");
    }
  }
}

function truncateCopyTargets(status, copyTargets) {
  assertCopyTargetsExist(status, copyTargets);
  const exactTargets = copyTargets.map(({ schema, table }) =>
    `${quotedSqlIdentifier(schema)}.${quotedSqlIdentifier(table)}`).join(",\n");
  psqlScalar(
    status,
    `SET session_replication_role = replica;
     TRUNCATE TABLE ${exactTargets} RESTART IDENTITY CASCADE;
     SELECT 'truncated'`,
    "database_restore",
    true,
  );
}

function preparePgmqQueues(status, queues) {
  for (const queue of queues) {
    const existence = queue.relations.map(({ relation }) =>
      psqlScalar(
        status,
        `SELECT (to_regclass(${sqlLiteral(`pgmq.${relation}`)}) IS NOT NULL)::text`,
        "database_restore",
        true,
      ) === "true");
    if (existence.some(Boolean) && !existence.every(Boolean)) {
      fail("pgmq_queue_partial_before_restore", "database_restore");
    }
    if (!existence.some(Boolean)) {
      psqlScalar(
        status,
        `SELECT pgmq.create(${sqlLiteral(queue.name)})`,
        "database_restore",
        true,
      );
    }
    for (const { relation } of queue.relations) {
      const count = Number(psqlScalar(
        status,
        `SELECT count(*)::text FROM pgmq.${relation}`,
        "database_restore",
        true,
      ));
      if (count !== 0) fail("pgmq_queue_not_empty_before_restore", "database_restore");
    }
  }
}

function verifyPgmqQueueRows(status, queues) {
  for (const queue of queues) {
    for (const { relation, rows } of queue.relations) {
      const count = Number(psqlScalar(
        status,
        `SELECT count(*)::text FROM pgmq.${relation}`,
        "database_restore",
        true,
      ));
      if (!Number.isSafeInteger(count) || count !== rows) {
        fail("pgmq_queue_row_count_mismatch", "database_restore");
      }
    }
  }
}

function restoreLogicalDatabase(status, artifacts, copyTargets) {
  // Supabase's official restore contract starts a blank Supabase stack first:
  // auth, storage, extension, and other managed system schemas already exist,
  // while the official schema dump excludes those system-owned definitions.
  // Local app migrations and config buckets remain disabled during this step.
  execute(
    "psql",
    [
      "--no-psqlrc",
      "--single-transaction",
      "--variable",
      "ON_ERROR_STOP=1",
      "--file",
      artifacts.plaintext.roles,
      "--file",
      artifacts.plaintext.schema,
    ],
    {
      env: psqlEnvironment(status.dbUrl, "supabase_admin"),
      capture: false,
      timeout: 4 * 60 * 60 * 1000,
      code: "logical_database_schema_restore_failed",
      stage: "database_restore",
    },
  );
  const pgmqQueues = pgmqQueuesFromCopyInventory(copyTargets);
  preparePgmqQueues(status, pgmqQueues);
  truncateCopyTargets(status, copyTargets);
  execute(
    "psql",
    [
      "--no-psqlrc",
      "--single-transaction",
      "--variable",
      "ON_ERROR_STOP=1",
      "--command",
      "SET session_replication_role = replica",
      "--file",
      artifacts.plaintext.data,
    ],
    {
      env: psqlEnvironment(status.dbUrl, "supabase_admin"),
      capture: false,
      timeout: 4 * 60 * 60 * 1000,
      code: "logical_database_data_restore_failed",
      stage: "database_restore",
    },
  );
  verifyPgmqQueueRows(status, pgmqQueues);
  return pgmqQueues;
}

function psqlScalar(
  status,
  sql,
  stage = "database_verification",
  privileged = false,
  failureCode = "database_query_failed",
  failureClassifier,
  failureDiagnostic,
) {
  return execute(
    "psql",
    ["--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", sql],
    {
      env: psqlEnvironment(status.dbUrl, privileged ? "supabase_admin" : undefined),
      timeout: 5 * 60 * 1000,
      code: failureCode,
      stage,
      maxBuffer: 2 * 1024 * 1024,
      failureClassifier,
      failureDiagnostic,
    },
  );
}

function psqlJson(
  status,
  sql,
  stage,
  privileged = false,
  failureCode = "database_query_failed",
  failureClassifier,
  failureDiagnostic,
) {
  let value;
  try {
    value = JSON.parse(psqlScalar(
      status,
      sql,
      stage,
      privileged,
      failureCode,
      failureClassifier,
      failureDiagnostic,
    ));
  } catch (error) {
    if (error instanceof HarnessFailure) throw error;
    fail("database_json_invalid", stage);
  }
  return value;
}

function assertLocalDatabaseMajor(status, expectedMajor) {
  const versionNumber = Number(psqlScalar(
    status,
    "SHOW server_version_num",
    "database_restore",
    true,
  ));
  const actualMajor = Math.floor(versionNumber / 10_000);
  if (!Number.isSafeInteger(actualMajor) || actualMajor !== expectedMajor) {
    fail("local_database_major_mismatch", "database_restore");
  }
  return actualMajor;
}

function readAggregates(status, requireAll = false) {
  const counts = {};
  for (const [name, relation] of Object.entries(AGGREGATE_RELATIONS)) {
    const exists = psqlScalar(
      status,
      `SELECT (to_regclass(${sqlLiteral(relation)}) IS NOT NULL)::text`,
      "aggregate_reconciliation",
    ) === "true";
    if (!exists) {
      if (requireAll) fail("aggregate_relation_missing_after_migrations", "aggregate_reconciliation");
      counts[name] = null;
      continue;
    }
    const raw = psqlScalar(status, `SELECT count(*)::text FROM ${relation}`, "aggregate_reconciliation");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) fail("aggregate_count_invalid", "aggregate_reconciliation");
    counts[name] = value;
  }
  return Object.freeze(counts);
}

function assertNonDecreasingAggregates(before, after) {
  for (const key of NON_DECREASING_AGGREGATES) {
    if (before[key] !== null && after[key] < before[key]) {
      fail("aggregate_reconciliation_decreased", "aggregate_reconciliation");
    }
  }
}

function rootMigrationEntries() {
  const migrationsRoot = join(repositoryRoot, "supabase", "migrations");
  const migrationDirectoryEntries = readdirSync(migrationsRoot);
  const invalidSqlFilename = migrationDirectoryEntries.find((name) =>
    name.endsWith(".sql") && !/^\d{3}_[a-z0-9_]+\.sql$/u.test(name));
  if (invalidSqlFilename) fail("root_migration_filename_invalid", "migration_rehearsal");
  const filenames = migrationDirectoryEntries
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right));
  const entries = filenames.map((name, index) => {
    const match = /^(\d{3})_([a-z0-9_]+)\.sql$/u.exec(name);
    const expectedVersion = String(index + 1).padStart(3, "0");
    if (!match || match[1] !== expectedVersion) {
      fail("root_migration_sequence_not_contiguous", "migration_rehearsal");
    }
    const path = join(migrationsRoot, name);
    const bytes = statSync(path).size;
    const sha256 = sha256Text(readFileSync(path));
    return Object.freeze({ version: match[1], name: match[2], filename: name, bytes, sha256 });
  });
  if (entries.length === 0) fail("root_migration_files_missing", "migration_rehearsal");

  const history = JSON.parse(readFileSync(join(repositoryRoot, "supabase", "migration-history.json"), "utf8"));
  if (history.algorithm !== "sha256" || !Array.isArray(history.files) || history.files.length > entries.length) {
    fail("root_migration_history_invalid", "migration_rehearsal");
  }
  history.files.forEach((recorded, index) => {
    const actual = entries[index];
    if (
      !isRecord(recorded) ||
      recorded.name !== actual.filename ||
      recorded.bytes !== actual.bytes ||
      recorded.sha256 !== actual.sha256
    ) {
      fail("root_migration_history_disk_mismatch", "migration_rehearsal");
    }
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    recordedHistoryCount: history.files.length,
  });
}

function readAppliedMigrationVersions(status, stage = "migration_rehearsal") {
  const value = psqlJson(
    status,
    "SELECT coalesce(json_agg(version ORDER BY version), '[]'::json)::text FROM supabase_migrations.schema_migrations",
    stage,
    true,
    "migration_ledger_query_failed",
    classifyMigrationLedgerQueryFailure,
    sanitizeDatabaseCommandDiagnostic,
  );
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !MIGRATION_VERSION_PATTERN.test(item))) {
    fail("restored_migration_ledger_invalid", stage);
  }
  return value;
}

function readAppliedMigrationEntries(status, stage = "database_restore") {
  const value = psqlJson(
    status,
    `SELECT coalesce(
       json_agg(json_build_object('version', version, 'name', name) ORDER BY version),
       '[]'::json
     )::text
     FROM supabase_migrations.schema_migrations`,
    stage,
    true,
    "migration_ledger_query_failed",
    classifyMigrationLedgerQueryFailure,
    sanitizeDatabaseCommandDiagnostic,
  );
  if (!Array.isArray(value) || value.some((entry) =>
    !isRecord(entry) ||
    !MIGRATION_VERSION_PATTERN.test(entry.version) ||
    !MIGRATION_NAME_PATTERN.test(entry.name))) {
    fail("restored_migration_ledger_invalid", stage);
  }
  return Object.freeze(value.map(({ version, name }) => Object.freeze({ version, name })));
}

export function verifiedExportedHistoryPrefix(root, manifestLedger, exportedHistory) {
  if (
    exportedHistory.entries.length !== manifestLedger.count ||
    exportedHistory.entries[0]?.version !== manifestLedger.minVersion ||
    exportedHistory.entries.at(-1)?.version !== manifestLedger.maxVersion ||
    exportedHistory.copyRowsSha256 !== manifestLedger.copyRowsSha256
  ) {
    fail("exported_migration_history_manifest_mismatch", "database_restore");
  }
  const prefix = root.entries.slice(0, exportedHistory.entries.length);
  if (
    prefix.length !== exportedHistory.entries.length ||
    JSON.stringify(prefix.map(({ version, name }) => ({ version, name }))) !==
      JSON.stringify(exportedHistory.entries)
  ) {
    fail("exported_migration_history_root_prefix_mismatch", "database_restore");
  }
  return Object.freeze(prefix);
}

function assertLocalMigrationLedgerShape(status) {
  const shapeIsExact = psqlScalar(
    status,
    `SELECT (
       (SELECT pg_get_userbyid(namespace.nspowner) = 'postgres'
        FROM pg_catalog.pg_namespace AS namespace
        WHERE namespace.nspname = 'supabase_migrations')
       AND
       (SELECT pg_get_userbyid(relation.relowner) = 'postgres'
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'supabase_migrations'
          AND relation.relname = 'schema_migrations'
          AND relation.relkind IN ('r', 'p'))
       AND
       (SELECT count(*) = 6
          AND count(*) FILTER (
            WHERE column_name = 'version' AND udt_name = 'text' AND is_nullable = 'NO'
          ) = 1
          AND count(*) FILTER (
            WHERE column_name = 'statements' AND udt_name = '_text' AND is_nullable = 'YES'
          ) = 1
          AND count(*) FILTER (
            WHERE column_name = 'name' AND udt_name = 'text' AND is_nullable = 'YES'
          ) = 1
          AND count(*) FILTER (
            WHERE column_name = 'created_by' AND udt_name = 'text' AND is_nullable = 'YES'
          ) = 1
          AND count(*) FILTER (
            WHERE column_name = 'idempotency_key' AND udt_name = 'text' AND is_nullable = 'YES'
          ) = 1
          AND count(*) FILTER (
            WHERE column_name = 'rollback' AND udt_name = '_text' AND is_nullable = 'YES'
          ) = 1
        FROM information_schema.columns
        WHERE table_schema = 'supabase_migrations'
          AND table_name = 'schema_migrations')
       AND
       (SELECT count(*) = 2
          AND count(*) FILTER (
            WHERE table_constraint.constraint_type = 'PRIMARY KEY'
              AND key_column_usage.column_name = 'version'
          ) = 1
          AND count(*) FILTER (
            WHERE table_constraint.constraint_type = 'UNIQUE'
              AND key_column_usage.column_name = 'idempotency_key'
          ) = 1
        FROM information_schema.table_constraints AS table_constraint
        JOIN information_schema.key_column_usage AS key_column_usage
          ON key_column_usage.constraint_catalog = table_constraint.constraint_catalog
         AND key_column_usage.constraint_schema = table_constraint.constraint_schema
         AND key_column_usage.constraint_name = table_constraint.constraint_name
        WHERE table_constraint.table_schema = 'supabase_migrations'
          AND table_constraint.table_name = 'schema_migrations')
     )::text`,
    "database_restore",
    true,
    "migration_ledger_shape_query_failed",
    undefined,
    sanitizeDatabaseCommandDiagnostic,
  );
  if (shapeIsExact !== "true") fail("migration_ledger_shape_invalid", "database_restore");
}

function restoreExportedMigrationHistory(status, historySchemaPath, historyDataPath) {
  const ledgerAlreadyExists = psqlScalar(
    status,
    "SELECT (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)::text",
    "database_restore",
    true,
    "migration_ledger_preexistence_query_failed",
    undefined,
    sanitizeDatabaseCommandDiagnostic,
  ) === "true";
  if (ledgerAlreadyExists) {
    fail("base_migration_ledger_already_exists", "database_restore");
  }
  execute(
    "psql",
    [
      "--no-psqlrc",
      "--single-transaction",
      "--variable",
      "ON_ERROR_STOP=1",
      "--file",
      historySchemaPath,
      "--file",
      historyDataPath,
    ],
    {
      env: psqlEnvironment(status.dbUrl, "supabase_admin"),
      capture: false,
      timeout: 60 * 60 * 1000,
      code: "exported_migration_history_restore_failed",
      stage: "database_restore",
    },
  );
  assertLocalMigrationLedgerShape(status);
}

function assertManifestLedger(applied, prefix) {
  if (
    applied.length !== prefix.length ||
    applied.some((entry, index) =>
      entry.version !== prefix[index].version || entry.name !== prefix[index].name)
  ) {
    fail("restored_migration_ledger_mismatch", "database_restore");
  }
}

function assertExactRootLedger(applied, root) {
  const expected = root.entries.map((entry) => entry.version);
  if (applied.length !== expected.length || applied.some((value, index) => value !== expected[index])) {
    fail("pending_migrations_not_exact_root", "migration_rehearsal");
  }
  return Object.freeze({
    count: applied.length,
    minVersion: applied[0],
    maxVersion: applied.at(-1),
    recordedHistoryCount: root.recordedHistoryCount,
  });
}

function safeStorageObjectUrl(apiUrl, bucketId, objectPath, prefix = "object") {
  const base = assertLoopbackUrl(apiUrl, "storage_api_not_loopback");
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  return new URL(`/storage/v1/${prefix}/${encodeURIComponent(bucketId)}/${encoded}`, base).toString();
}

export function sanitizeHttpResponseDiagnostic(response) {
  const proxyStatus = response?.headers?.get?.("proxy-status") ?? "";
  const match = /(?:^|[;\s])error="?(PGRST[0-9A-Z]{3}|[0-9A-Z]{5})"?(?:[;\s]|$)/iu.exec(proxyStatus);
  return Object.freeze({
    httpStatus: Number.isInteger(response?.status) ? response.status : null,
    ...(match ? { proxyErrorCode: match[1].toUpperCase() } : {}),
  });
}

async function storageRequest(status, url, init, accepted, code, stage = "storage_restore") {
  assertLoopbackUrl(url, "storage_request_not_loopback");
  let response;
  try {
    response = await fetch(url, { ...init, redirect: "manual" });
  } catch {
    fail(code, stage);
  }
  if (!accepted.includes(response.status)) {
    fail(code, stage, sanitizeHttpResponseDiagnostic(response));
  }
  return response;
}

async function waitForPostgrestSchemaReadiness(status, timeoutMs = 60_000) {
  const url = new URL("/rest/v1/organizations", status.apiUrl);
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "0");
  const deadline = Date.now() + timeoutMs;
  let lastDiagnostic = Object.freeze({ httpStatus: null });
  while (Date.now() < deadline) {
    let response;
    try {
      response = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        headers: {
          apikey: status.serviceRoleKey,
          Authorization: `Bearer ${status.serviceRoleKey}`,
          "Accept-Profile": "platform",
        },
      });
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      continue;
    }
    lastDiagnostic = sanitizeHttpResponseDiagnostic(response);
    if (response.status === 200) return;
    if (response.status !== 503) {
      fail("post_migration_postgrest_probe_failed", "migration_rehearsal", lastDiagnostic);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  fail("post_migration_postgrest_reload_timeout", "migration_rehearsal", lastDiagnostic);
}

function readBucketState(status, bucketId) {
  return psqlJson(
    status,
    `SELECT coalesce((SELECT json_build_object(
      'id', id,
      'name', name,
      'public', public,
      'fileSizeLimit', file_size_limit,
      'allowedMimeTypes', allowed_mime_types
    ) FROM storage.buckets WHERE id = ${sqlLiteral(bucketId)}), 'null'::json)::text`,
    "storage_restore",
    true,
  );
}

function bucketStateMatches(actual, expected) {
  if (!isRecord(actual)) return false;
  const actualLimit = actual.fileSizeLimit === null ? null : Number(actual.fileSizeLimit);
  const actualMimeTypes = actual.allowedMimeTypes === null
    ? null
    : Array.isArray(actual.allowedMimeTypes) ? [...actual.allowedMimeTypes].sort() : undefined;
  const expectedMimeTypes = expected.allowedMimeTypes === null
    ? null
    : [...expected.allowedMimeTypes].sort();
  return actual.id === expected.id &&
    actual.name === expected.name &&
    actual.public === expected.public &&
    actualLimit === expected.fileSizeLimit &&
    JSON.stringify(actualMimeTypes) === JSON.stringify(expectedMimeTypes);
}

async function writeBucket(status, bucket, method, url, code) {
  await storageRequest(
    status,
    url,
    {
      method,
      headers: {
        apikey: status.serviceRoleKey,
        Authorization: `Bearer ${status.serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...(method === "POST" ? { id: bucket.id, name: bucket.name } : {}),
        public: bucket.public,
        file_size_limit: bucket.fileSizeLimit,
        allowed_mime_types: bucket.allowedMimeTypes,
      }),
    },
    [200, 201],
    code,
  );
}

async function ensureBuckets(status, buckets, { allowUpdate }) {
  for (const bucket of buckets) {
    const bucketUrl = new URL(`/storage/v1/bucket/${encodeURIComponent(bucket.id)}`, status.apiUrl).toString();
    const current = readBucketState(status, bucket.id);
    if (current === null) {
      await writeBucket(
        status,
        bucket,
        "POST",
        new URL("/storage/v1/bucket", status.apiUrl).toString(),
        "storage_bucket_restore_failed",
      );
    } else if (!bucketStateMatches(current, bucket)) {
      if (!allowUpdate) fail("storage_source_bucket_collision", "storage_restore");
      await writeBucket(status, bucket, "PUT", bucketUrl, "v3_storage_bucket_update_failed");
    }
    if (!bucketStateMatches(readBucketState(status, bucket.id), bucket)) {
      fail("storage_bucket_restore_mismatch", "storage_restore");
    }
  }
}

function readV3PrivateBucketContract() {
  const lines = readFileSync(join(repositoryRoot, "supabase", "config.toml"), "utf8").split(/\r?\n/u);
  return Object.freeze(V3_AUTHORITATIVE_BUCKET_IDS.map((id) => {
    const header = `[storage.buckets.${id}]`;
    const start = lines.indexOf(header);
    if (start === -1) fail("v3_storage_bucket_config_missing", "storage_privacy_proof");
    let end = start + 1;
    while (end < lines.length && !lines[end].startsWith("[")) end += 1;
    const block = lines.slice(start + 1, end).join("\n");
    if (!/^public\s*=\s*false$/mu.test(block)) {
      fail("v3_storage_bucket_config_not_private", "storage_privacy_proof");
    }
    const limitMatch = /^file_size_limit\s*=\s*"(\d+)MiB"$/mu.exec(block);
    const mimeMatch = /^allowed_mime_types\s*=\s*(\[[^\n]+\])$/mu.exec(block);
    if (!limitMatch || !mimeMatch) fail("v3_storage_bucket_config_invalid", "storage_privacy_proof");
    let allowedMimeTypes;
    try {
      allowedMimeTypes = JSON.parse(mimeMatch[1]);
    } catch {
      fail("v3_storage_bucket_config_invalid", "storage_privacy_proof");
    }
    if (!Array.isArray(allowedMimeTypes) || allowedMimeTypes.some((value) =>
      typeof value !== "string" || !CONTENT_TYPE_PATTERN.test(value))) {
      fail("v3_storage_bucket_config_invalid", "storage_privacy_proof");
    }
    return Object.freeze({
      id,
      name: id,
      public: false,
      fileSizeLimit: Number(limitMatch[1]) * 1024 * 1024,
      allowedMimeTypes: Object.freeze(allowedMimeTypes),
    });
  }));
}

function activeSourceFiles(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...activeSourceFiles(path));
    } else if (
      entry.isFile() &&
      /\.(?:[cm]?[jt]sx?)$/u.test(entry.name) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)
    ) {
      result.push(path);
    }
  }
  return result;
}

function assertNoActivePublicLegacyBucketDependency(sourceBuckets) {
  const publicIds = sourceBuckets.filter((bucket) => bucket.public).map((bucket) => bucket.id);
  let references = 0;
  for (const path of activeSourceFiles(join(repositoryRoot, "src"))) {
    const content = readFileSync(path, "utf8");
    for (const id of publicIds) {
      if ([`'${id}'`, `"${id}"`, `\`${id}\``].some((literal) => content.includes(literal))) {
        references += 1;
      }
    }
  }
  if (references !== 0) fail("active_v3_public_legacy_bucket_dependency", "storage_privacy_proof");
  return references;
}

async function establishV3PrivateStorage(status, sourceBuckets) {
  const buckets = readV3PrivateBucketContract();
  await ensureBuckets(status, buckets, { allowUpdate: true });
  if (buckets.some((bucket) => readBucketState(status, bucket.id)?.public !== false)) {
    fail("v3_storage_bucket_not_private", "storage_privacy_proof");
  }
  return Object.freeze({
    buckets,
    evidence: Object.freeze({
      authoritativeBucketCount: buckets.length,
      allAuthoritativeBucketsPrivate: true,
      activePublicLegacyReferences: assertNoActivePublicLegacyBucketDependency(sourceBuckets),
    }),
  });
}

export function validateStorageArchiveEntries(entries, objects) {
  if (!Array.isArray(entries) || !Array.isArray(objects)) {
    fail("storage_archive_inventory_invalid", "storage_restore");
  }
  const files = [];
  const directories = [];
  for (const entry of entries) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.startsWith("/") ||
      entry.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(entry) ||
      entry.split("/").some((part, index, parts) =>
        part === "." || part === ".." || (part === "" && index !== parts.length - 1))
    ) {
      fail("storage_archive_entry_unsafe", "storage_restore");
    }
    if (entry.endsWith("/")) directories.push(entry);
    else files.push(entry);
  }
  if (directories.length !== 1 || directories[0] !== "storage-blobs/") {
    fail("storage_archive_directory_inventory_mismatch", "storage_restore");
  }
  const expected = ["storage-manifest.json", ...objects.map((object) => object.archivePath)].sort();
  const actual = [...files].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    fail("storage_archive_inventory_mismatch", "storage_restore");
  }
  return Object.freeze({ files: Object.freeze(actual), directories: Object.freeze(directories) });
}

function inspectTarArchive(archivePath, objects) {
  const listed = execute("tar", ["-tf", archivePath], {
    code: "storage_archive_list_failed",
    stage: "storage_restore",
    timeout: 30 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  }).split(/\r?\n/u).filter(Boolean);
  validateStorageArchiveEntries(listed, objects);
  const verbose = execute("tar", ["-tvf", archivePath], {
    code: "storage_archive_types_failed",
    stage: "storage_restore",
    timeout: 30 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  }).split(/\r?\n/u).filter(Boolean);
  const regularCount = verbose.filter((line) => line.startsWith("-")).length;
  const directoryCount = verbose.filter((line) => line.startsWith("d")).length;
  if (
    regularCount !== objects.length + 1 ||
    directoryCount !== 1 ||
    regularCount + directoryCount !== verbose.length
  ) {
    fail("storage_archive_non_regular_entry", "storage_restore");
  }
}

function extractOneTarEntry(archivePath, archiveEntry, destination) {
  const fd = openSync(destination, "wx", 0o600);
  try {
    const result = spawnSync("tar", ["-xOf", archivePath, archiveEntry], {
      cwd: repositoryRoot,
      env: minimalChildEnvironment(),
      stdio: ["ignore", fd, "ignore"],
      timeout: 30 * 60 * 1000,
    });
    if (result.error || result.status !== 0) fail("storage_object_extract_failed", "storage_restore");
  } finally {
    closeSync(fd);
  }
}

async function uploadAndVerifyObject(status, object, path) {
  await assertPlaintextFile(path, object, "storage_object");
  const sourceMetadata = psqlJson(
    status,
    `SELECT coalesce((
       SELECT json_build_object(
         'id', id::text,
         'version', version,
         'bytes', coalesce((metadata ->> 'size')::bigint, 0),
         'contentType', metadata ->> 'mimetype'
       )
       FROM storage.objects
       WHERE bucket_id = ${sqlLiteral(object.bucketId)}
         AND name = ${sqlLiteral(object.objectPath)}
     ), 'null'::json)::text`,
    "storage_restore",
    true,
  );
  if (
    !isRecord(sourceMetadata) ||
    sourceMetadata.id !== object.sourceId ||
    (sourceMetadata.version ?? null) !== object.sourceVersion ||
    Number(sourceMetadata.bytes) !== object.bytes
  ) {
    fail("storage_object_manifest_database_mapping_mismatch", "storage_restore");
  }
  const contentType = requiredString(
    sourceMetadata.contentType,
    CONTENT_TYPE_PATTERN,
    "storage_object_content_type_missing",
    "storage_restore",
  );
  const bytes = readFileSync(path);
  const url = safeStorageObjectUrl(status.apiUrl, object.bucketId, object.objectPath);
  await storageRequest(
    status,
    url,
    {
      method: "POST",
      headers: {
        apikey: status.serviceRoleKey,
        Authorization: `Bearer ${status.serviceRoleKey}`,
        "content-type": contentType,
        "x-upsert": "true",
      },
      body: bytes,
    },
    [200],
    "storage_object_upload_failed",
  );
  const download = await storageRequest(
    status,
    url,
    { headers: { apikey: status.serviceRoleKey, Authorization: `Bearer ${status.serviceRoleKey}` } },
    [200],
    "storage_object_download_failed",
  );
  const restored = Buffer.from(await download.arrayBuffer());
  if (restored.length !== object.bytes || sha256Text(restored) !== object.sha256) {
    fail("storage_object_round_trip_mismatch", "storage_restore");
  }
}

async function restoreStorageBytes(status, artifacts, workRoot) {
  const initialInventory = psqlJson(
    status,
    `SELECT json_build_object(
      'buckets', (SELECT count(*) FROM storage.buckets),
      'publicBuckets', (SELECT count(*) FROM storage.buckets WHERE public),
      'objects', (SELECT count(*) FROM storage.objects)
    )::text`,
    "storage_restore",
    true,
  );
  const metadataRestoredByLogicalDump = isRecord(initialInventory) &&
    Number(initialInventory.buckets) === artifacts.storage.bucketCount &&
    Number(initialInventory.publicBuckets) === artifacts.storage.publicBucketCount &&
    Number(initialInventory.objects) === artifacts.storage.objectCount;
  if (!metadataRestoredByLogicalDump) {
    fail("source_storage_metadata_state_invalid", "storage_restore");
  }
  await ensureBuckets(status, artifacts.storage.buckets, { allowUpdate: false });
  inspectTarArchive(artifacts.plaintext.storageArchive, artifacts.storage.objects);
  const objectRoot = join(workRoot, "storage-object");
  mkdirSync(objectRoot, { mode: 0o700 });
  const embeddedManifest = join(objectRoot, "storage-manifest.json");
  extractOneTarEntry(artifacts.plaintext.storageArchive, "storage-manifest.json", embeddedManifest);
  if (
    statSync(embeddedManifest).size !== statSync(artifacts.plaintext.storageManifest).size ||
    await sha256File(embeddedManifest) !== await sha256File(artifacts.plaintext.storageManifest)
  ) {
    fail("storage_archive_manifest_mismatch", "storage_restore");
  }
  rmSync(embeddedManifest, { force: true });
  for (let index = 0; index < artifacts.storage.objects.length; index += 1) {
    const object = artifacts.storage.objects[index];
    const destination = join(objectRoot, `${String(index).padStart(8, "0")}.bin`);
    extractOneTarEntry(artifacts.plaintext.storageArchive, object.archivePath, destination);
    await uploadAndVerifyObject(status, object, destination);
    rmSync(destination, { force: true });
  }
  const count = Number(psqlScalar(status, "SELECT count(*)::text FROM storage.objects", "storage_restore"));
  if (!Number.isSafeInteger(count) || count !== artifacts.storage.objectCount) {
    fail("storage_metadata_count_mismatch", "storage_restore");
  }
  const bucketCounts = psqlJson(
    status,
    `SELECT json_build_object(
      'total', count(*),
      'public', count(*) FILTER (WHERE public)
    )::text FROM storage.buckets`,
    "storage_restore",
    true,
  );
  if (
    !isRecord(bucketCounts) ||
    Number(bucketCounts.total) !== artifacts.storage.bucketCount ||
    Number(bucketCounts.public) !== artifacts.storage.publicBucketCount
  ) {
    fail("storage_bucket_inventory_mismatch", "storage_restore");
  }
  return Object.freeze({
    mode: artifacts.storage.objectCount === 0
      ? "exact_empty_inventory"
      : "restored_object_bytes",
    metadataMode: "logical_dump_cross_checked_against_storage_manifest",
    bucketCount: artifacts.storage.bucketCount,
    publicBucketCount: artifacts.storage.publicBucketCount,
    objectCount: artifacts.storage.objectCount,
    totalBytes: artifacts.storage.totalBytes,
  });
}

function discoverRestoredRepresentativeActors(status) {
  const sql = String.raw`
    SELECT coalesce(json_agg(row_to_json(candidate)), '[]'::json)::text
    FROM (
      SELECT
        profile.auth_user_id AS "userId",
        membership.organization_id AS "organizationId",
        membership.current_role::text AS "databaseRole",
        auth_user.email AS email
      FROM platform.organization_memberships AS membership
      JOIN platform.profiles AS profile ON profile.id = membership.profile_id
      JOIN auth.users AS auth_user ON auth_user.id = profile.auth_user_id
      WHERE membership.status = 'active'
        AND profile.status = 'active'
        AND membership.current_role IN ('admin', 'sales', 'curator')
        AND auth_user.email IS NOT NULL
      ORDER BY membership.organization_id, membership.current_role, membership.id
    ) AS candidate`;
  const rows = psqlJson(status, sql, "auth_rls_proof");
  if (!Array.isArray(rows)) fail("representative_actor_query_invalid", "auth_rls_proof");
  const valid = [];
  for (const row of rows) {
    if (
      !isRecord(row) ||
      !UUID_PATTERN.test(row.userId) ||
      !UUID_PATTERN.test(row.organizationId) ||
      !["admin", "sales", "curator"].includes(row.databaseRole) ||
      typeof row.email !== "string" ||
      !row.email.includes("@")
    ) continue;
    valid.push(row);
  }
  const admin = valid.find((row) => row.databaseRole === "admin");
  if (!admin) fail("restored_admin_actor_missing", "auth_rls_proof");
  const inOrganization = valid.filter((row) => row.organizationId === admin.organizationId);
  const firstRole = (role) => inOrganization.find((row) => row.databaseRole === role);
  return Object.freeze({
    organizationId: admin.organizationId,
    admin: Object.freeze({ ...admin, appRole: "admin", landing: "/v3/main", provenance: "restored_snapshot" }),
    sales: firstRole("sales")
      ? Object.freeze({ ...firstRole("sales"), appRole: "sales", landing: "/v3/main", provenance: "restored_snapshot" })
      : undefined,
    admissions: firstRole("curator")
      ? Object.freeze({ ...firstRole("curator"), appRole: "admissions", landing: "/v3/calendar", provenance: "restored_snapshot" })
      : undefined,
    restoredRoleCounts: Object.freeze({
      admin: inOrganization.filter((row) => row.databaseRole === "admin").length,
      sales: inOrganization.filter((row) => row.databaseRole === "sales").length,
      admissions: inOrganization.filter((row) => row.databaseRole === "curator").length,
    }),
  });
}

async function updateLocalPassword(status, actor) {
  const password = `R9!${randomBytes(30).toString("base64url")}`;
  const response = await storageRequest(
    status,
    new URL(`/auth/v1/admin/users/${actor.userId}`, status.apiUrl).toString(),
    {
      method: "PUT",
      headers: {
        apikey: status.serviceRoleKey,
        Authorization: `Bearer ${status.serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password }),
    },
    [200],
    "local_auth_password_reset_failed",
    "auth_rls_proof",
  );
  await response.arrayBuffer();
  return Object.freeze({ ...actor, password });
}

async function signInLocalActor(status, actor) {
  const response = await storageRequest(
    status,
    new URL("/auth/v1/token?grant_type=password", status.apiUrl).toString(),
    {
      method: "POST",
      headers: { apikey: status.publishableKey, "content-type": "application/json" },
      body: JSON.stringify({ email: actor.email, password: actor.password }),
    },
    [200],
    "local_auth_sign_in_failed",
    "auth_rls_proof",
  );
  const payload = await response.json().catch(() => null);
  if (!isRecord(payload) || typeof payload.access_token !== "string") {
    fail("local_auth_token_missing", "auth_rls_proof");
  }
  return Object.freeze({ ...actor, accessToken: payload.access_token });
}

async function platformRpc(status, actor, functionName, body, stage = "malware_scanner_proof") {
  const response = await storageRequest(
    status,
    new URL(`/rest/v1/rpc/${functionName}`, status.apiUrl).toString(),
    {
      method: "POST",
      headers: {
        apikey: status.publishableKey,
        Authorization: `Bearer ${actor.accessToken}`,
        "Accept-Profile": "platform",
        "Content-Profile": "platform",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    [200],
    `${functionName}_failed`,
    stage,
  );
  const payload = await response.json().catch(() => null);
  if (payload === null) fail(`${functionName}_response_invalid`, stage);
  return payload;
}

async function assertHistoricalScannerGate(status, adminActor, finalLedger) {
  if (!finalLedger.includes("115")) {
    fail("malware_scanner_migration_missing", "malware_scanner_proof");
  }
  const facts = psqlJson(
    status,
    `SELECT json_build_object(
      'unprovedCleanDocuments', (
        SELECT count(*) FROM platform.document_versions AS version
        WHERE version.malware_status = 'clean'
          AND version.malware_scan_attestation_id IS NULL
      ),
      'invalidatedHistoricalDocuments', (
        SELECT count(*) FROM platform.document_validation_events AS event
        WHERE event.validation_source = 'migration:115_malware_scanner_enforcement'
      ),
      'unprovedCurrentCompanyFiles', (
        SELECT count(*)
        FROM platform.company_files AS company_file
        JOIN platform.company_file_versions AS version
          ON version.organization_id = company_file.organization_id
          AND version.id = company_file.current_version_id
          AND version.company_file_id = company_file.id
        LEFT JOIN platform_private.company_file_malware_scan_attestations AS proof
          ON proof.organization_id = version.organization_id
          AND proof.company_file_version_id = version.id
          AND proof.company_file_id = version.company_file_id
          AND proof.scanned_sha256_hex = version.sha256_hex
        WHERE company_file.organization_id = ${sqlLiteral(adminActor.organizationId)}
          AND proof.id IS NULL
      )
    )::text`,
    "malware_scanner_proof",
    true,
  );
  if (!isRecord(facts) || Number(facts.unprovedCleanDocuments) !== 0) {
    fail("historical_unproved_clean_document_visible", "malware_scanner_proof");
  }
  const workspace = await platformRpc(
    status,
    adminActor,
    "staff_company_file_workspace",
    { p_organization_id: adminActor.organizationId },
  );
  if (!Array.isArray(workspace)) {
    fail("company_file_workspace_response_invalid", "malware_scanner_proof");
  }
  const unprovedIds = psqlJson(
    status,
    `SELECT coalesce(json_agg(company_file.id), '[]'::json)::text
     FROM platform.company_files AS company_file
     JOIN platform.company_file_versions AS version
       ON version.organization_id = company_file.organization_id
       AND version.id = company_file.current_version_id
       AND version.company_file_id = company_file.id
     LEFT JOIN platform_private.company_file_malware_scan_attestations AS proof
       ON proof.organization_id = version.organization_id
       AND proof.company_file_version_id = version.id
       AND proof.company_file_id = version.company_file_id
       AND proof.scanned_sha256_hex = version.sha256_hex
     WHERE company_file.organization_id = ${sqlLiteral(adminActor.organizationId)}
       AND proof.id IS NULL`,
    "malware_scanner_proof",
  );
  if (!Array.isArray(unprovedIds)) {
    fail("historical_company_file_inventory_invalid", "malware_scanner_proof");
  }
  const unprovedSet = new Set(unprovedIds);
  if (workspace.some((row) =>
    isRecord(row) && unprovedSet.has(row.item_id) && row.current_version_id !== null)) {
    fail("historical_unproved_company_file_visible", "malware_scanner_proof");
  }
  return Object.freeze({
    migration115: "applied",
    unprovedCleanDocuments: 0,
    invalidatedHistoricalDocuments: Number(facts.invalidatedHistoricalDocuments),
    unprovedCurrentCompanyFiles: Number(facts.unprovedCurrentCompanyFiles),
    unprovedCompanyFileBytesExposed: false,
  });
}

function readScannerPersistenceState(status) {
  const value = psqlJson(
    status,
    `SELECT json_build_object(
      'reservations', (SELECT count(*) FROM platform_private.company_file_upload_reservations),
      'finalizations', (SELECT count(*) FROM platform_private.company_file_upload_finalizations),
      'versions', (SELECT count(*) FROM platform.company_file_versions),
      'proofs', (SELECT count(*) FROM platform_private.company_file_malware_scan_attestations),
      'storageObjects', (SELECT count(*) FROM storage.objects)
    )::text`,
    "malware_scanner_proof",
    true,
  );
  if (!isRecord(value) || Object.values(value).some((count) =>
    !Number.isSafeInteger(Number(count)) || Number(count) < 0)) {
    fail("malware_persistence_inventory_invalid", "malware_scanner_proof");
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, count]) => [key, Number(count)]),
  ));
}

async function createScannerProofCompanyFile(status, adminActor) {
  const value = await platformRpc(status, adminActor, "create_company_file", {
    p_organization_id: adminActor.organizationId,
    p_folder_id: null,
    p_display_name: `Recovery scanner proof ${randomUUID()}`,
    p_request_id: randomUUID(),
  });
  if (
    !isRecord(value) || !UUID_PATTERN.test(value.company_file_id) ||
    typeof value.version !== "string" || !/^\d+$/u.test(value.version)
  ) {
    fail("scanner_proof_company_file_invalid", "malware_scanner_proof");
  }
  return Object.freeze({ id: value.company_file_id, version: value.version });
}

async function prepareRepresentativeActors(status) {
  const restored = discoverRestoredRepresentativeActors(status);
  const admin = await signInLocalActor(status, await updateLocalPassword(status, restored.admin));
  const actors = { organizationId: restored.organizationId, admin };
  for (const role of ["sales", "admissions"]) {
    if (!restored[role]) continue;
    const actor = await updateLocalPassword(status, restored[role]);
    actors[role] = await signInLocalActor(status, actor);
  }
  actors.missingRoles = Object.freeze(
    ["sales", "admissions"].filter((role) => !actors[role]),
  );
  actors.evidence = Object.freeze({
    sourceRoleCountsBeforeTestIdentitySetup: restored.restoredRoleCounts,
    restoredRoleStatus: Object.freeze({
      admin: "available",
      sales: actors.sales ? "available" : "missing",
      admissions: actors.admissions ? "available" : "missing",
    }),
    provenance: Object.freeze({
      admin: actors.admin.provenance,
      sales: actors.sales?.provenance ?? "missing_from_authenticated_export",
      admissions: actors.admissions?.provenance ?? "missing_from_authenticated_export",
    }),
  });
  return Object.freeze(actors);
}

export function buildRestoredRoleReadiness(availability) {
  exactKeys(
    availability,
    ["admin", "sales", "admissions"],
    "restored_role_availability_invalid",
    "auth_rls_proof",
  );
  if (Object.values(availability).some((value) => typeof value !== "boolean")) {
    fail("restored_role_availability_invalid", "auth_rls_proof");
  }
  const roleStatus = Object.freeze(Object.fromEntries(
    Object.entries(availability).map(([role, available]) => [
      role,
      available ? "passed" : "missing_restored_identity",
    ]),
  ));
  const missingRoles = Object.freeze(
    ["admin", "sales", "admissions"].filter((role) => !availability[role]),
  );
  const complete = missingRoles.length === 0;
  return Object.freeze({
    complete,
    missingRoles,
    roleStatus,
    blocker: complete ? undefined : Object.freeze({
      code: "restored_representative_staff_roles_missing",
      missingRoles,
      roleStatus,
    }),
  });
}

async function proveSameAndCrossOrganizationRls(status, adminActor) {
  const crossOrganizationId = randomUUID();
  psqlScalar(
    status,
    `SET session_replication_role = replica;
     INSERT INTO platform.organizations (id, name, status)
     VALUES (${sqlLiteral(crossOrganizationId)}, 'EVO recovery isolation canary', 'active');
     SELECT 'inserted'`,
    "auth_rls_proof",
    true,
  );
  try {
    const query = async (id) => {
      const url = new URL("/rest/v1/organizations", status.apiUrl);
      url.searchParams.set("select", "id");
      url.searchParams.set("id", `eq.${id}`);
      const response = await storageRequest(
        status,
        url.toString(),
        {
          headers: {
            apikey: status.publishableKey,
            Authorization: `Bearer ${adminActor.accessToken}`,
            "Accept-Profile": "platform",
          },
        },
        [200],
        "organization_rls_query_failed",
        "auth_rls_proof",
      );
      const payload = await response.json().catch(() => null);
      if (!Array.isArray(payload)) fail("organization_rls_response_invalid", "auth_rls_proof");
      return payload.length;
    };
    if (await query(adminActor.organizationId) !== 1) {
      fail("same_organization_rls_failed", "auth_rls_proof");
    }
    if (await query(crossOrganizationId) !== 0) {
      fail("cross_organization_rls_failed", "auth_rls_proof");
    }
  } finally {
    psqlScalar(
      status,
      `SET session_replication_role = replica;
       DELETE FROM platform.organizations WHERE id = ${sqlLiteral(crossOrganizationId)};
       SELECT 'deleted'`,
      "auth_rls_proof",
      true,
    );
  }
  return Object.freeze({ sameOrganization: "passed", crossOrganization: "passed", crossOrganizationMode: "isolated_canary" });
}

async function provePrivateStorage(status, v3Buckets, sourceObjectCount, authenticatedActor) {
  const bucket = v3Buckets.find((candidate) =>
    candidate.id === "platform-documents" &&
    (candidate.allowedMimeTypes === null || candidate.allowedMimeTypes.includes("image/png")));
  if (!bucket) fail("private_storage_canary_bucket_missing", "storage_privacy_proof");
  const objectPath = `recovery-canary/${randomUUID()}.png`;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const url = safeStorageObjectUrl(status.apiUrl, bucket.id, objectPath);
  await storageRequest(
    status,
    url,
    {
      method: "POST",
      headers: {
        apikey: status.serviceRoleKey,
        Authorization: `Bearer ${status.serviceRoleKey}`,
        "content-type": "image/png",
      },
      body: bytes,
    },
    [200],
    "private_storage_canary_upload_failed",
    "storage_privacy_proof",
  );
  try {
    await storageRequest(
      status,
      url,
      { headers: { apikey: status.publishableKey } },
      [400, 401, 403, 404],
      "anonymous_storage_read_not_denied",
      "storage_privacy_proof",
    );
    await storageRequest(
      status,
      url,
      {
        headers: {
          apikey: status.publishableKey,
          Authorization: `Bearer ${authenticatedActor.accessToken}`,
        },
      },
      [400, 401, 403, 404],
      "authenticated_storage_read_not_denied",
      "storage_privacy_proof",
    );
    const signResponse = await storageRequest(
      status,
      safeStorageObjectUrl(status.apiUrl, bucket.id, objectPath, "object/sign"),
      {
        method: "POST",
        headers: {
          apikey: status.serviceRoleKey,
          Authorization: `Bearer ${status.serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 60 }),
      },
      [200],
      "private_storage_sign_failed",
      "storage_privacy_proof",
    );
    const signed = await signResponse.json().catch(() => null);
    const signedPath = isRecord(signed) ? signed.signedURL ?? signed.signedUrl : null;
    if (typeof signedPath !== "string" || signedPath.length === 0) {
      fail("private_storage_signed_url_missing", "storage_privacy_proof");
    }
    const signedUrl = new URL(signedPath, status.apiUrl).toString();
    const signedDownload = await storageRequest(
      status,
      signedUrl,
      {},
      [200],
      "private_storage_signed_download_failed",
      "storage_privacy_proof",
    );
    const restored = Buffer.from(await signedDownload.arrayBuffer());
    if (!restored.equals(bytes)) fail("private_storage_canary_round_trip_mismatch", "storage_privacy_proof");
  } finally {
    await storageRequest(
      status,
      url,
      {
        method: "DELETE",
        headers: { apikey: status.serviceRoleKey, Authorization: `Bearer ${status.serviceRoleKey}` },
      },
      [200, 204, 404],
      "private_storage_canary_cleanup_failed",
      "storage_privacy_proof",
    );
  }
  return Object.freeze({
    directAnonymousRead: "denied",
    directAuthenticatedRead: "denied",
    signedRead: "passed",
    canaryDeleted: true,
    canaryMode: sourceObjectCount === 0
      ? "post_restore_behavior_only_source_inventory_empty"
      : "post_restore_behavior_supplement",
  });
}

function prepareAppWorkspace(harnessRoot) {
  const appRoot = join(harnessRoot, "app");
  mkdirSync(appRoot, { mode: 0o700 });
  for (const directory of ["src", "public"]) {
    cpSync(join(repositoryRoot, directory), join(appRoot, directory), { recursive: true });
  }
  for (const file of ["package.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "next-env.d.ts"]) {
    const source = join(repositoryRoot, file);
    if (existsSync(source)) cpSync(source, join(appRoot, file));
  }
  symlinkSync(join(repositoryRoot, "node_modules"), join(appRoot, "node_modules"), "dir");
  return appRoot;
}

async function waitForApp(child, appUrl) {
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail("v3_application_exited", "v3_browser_proof");
    try {
      const response = await fetch(new URL("/api/health", appUrl), { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // The bounded loop is the readiness authority; raw network errors stay private.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  fail("v3_application_start_timeout", "v3_browser_proof");
}

function childIsRunning(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

function processGroupIsRunning(child) {
  if (!child || !Number.isInteger(child.pid)) return false;
  if (process.platform === "win32") return childIsRunning(child);
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (["EPERM", "ESRCH"].includes(error?.code)) return childIsRunning(child);
    throw error;
  }
}

function signalExactProcessGroup(child, signal) {
  if (process.platform !== "win32" && Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code === "ESRCH" && !childIsRunning(child)) return;
    }
  }
  if (childIsRunning(child)) child.kill(signal);
}

async function waitForProcessGroupExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsRunning(child) && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return !processGroupIsRunning(child);
}

async function waitForChildExit(child, timeoutMs) {
  if (!childIsRunning(child)) return true;
  let timer;
  const stopped = await Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return stopped || !childIsRunning(child);
}

async function settleWithin(operation, timeoutMs) {
  let timer;
  const settled = await Promise.race([
    Promise.resolve().then(operation).then(() => true, () => false),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return settled;
}

async function stopApp(child) {
  try {
    if (!processGroupIsRunning(child)) return true;
    signalExactProcessGroup(child, "SIGTERM");
    if (await waitForProcessGroupExit(child, 10_000)) {
      await waitForChildExit(child, 1_000);
      return true;
    }
    signalExactProcessGroup(child, "SIGKILL");
    const groupStopped = await waitForProcessGroupExit(child, 5_000);
    await waitForChildExit(child, 1_000);
    return groupStopped;
  } catch {
    try {
      if (childIsRunning(child)) child.kill("SIGKILL");
    } catch {
      // The caller still proceeds to the independently scoped contour cleanup.
    }
    await waitForChildExit(child, 1_000).catch(() => false);
    return !childIsRunning(child);
  }
}

async function stopBrowserServer(browserServer) {
  if (!browserServer) return true;
  let child;
  try {
    child = browserServer.process();
  } catch {
    return false;
  }
  if (!childIsRunning(child)) return true;
  await settleWithin(() => browserServer.close(), 10_000);
  if (!childIsRunning(child)) return true;
  await settleWithin(() => browserServer.kill(), 5_000);
  if (childIsRunning(child)) {
    try {
      child.kill("SIGKILL");
    } catch {
      return false;
    }
  }
  await waitForChildExit(child, 5_000);
  return !childIsRunning(child);
}

function registerActiveBrowserProof(state) {
  if (activeBrowserProof) fail("browser_proof_state_already_registered", "v3_browser_proof");
  activeBrowserProof = state;
}

async function stopBrowserProof(state = activeBrowserProof) {
  if (!state) return;
  if (!state.shutdownPromise) {
    state.shutdownPromise = (async () => {
      let browserServer;
      if (state.browserServerPromise) {
        try {
          browserServer = await state.browserServerPromise;
        } catch {
          // A failed launch has no BrowserServer handle; app teardown still runs.
        }
      }
      try {
        await stopBrowserServer(browserServer);
      } catch {
        // App and contour teardown remain independent of browser shutdown.
      }
      try {
        await stopApp(state.appChild);
      } catch {
        // Contour teardown and the explicit signal exit must still run.
      }
      if (!state.logClosed && Number.isInteger(state.logFd)) {
        state.logClosed = true;
        try {
          closeSync(state.logFd);
        } catch {
          // The descriptor is scoped to this proof and may already be closed.
        }
      }
      if (activeBrowserProof === state) activeBrowserProof = undefined;
    })();
  }
  await state.shutdownPromise;
}

async function browserCompanyFileUpload(page, appUrl, companyFile, bytes, filename, requestId) {
  return await page.evaluate(async ({ baseUrl, fileId, expectedVersion, encoded, name, id }) => {
    const form = new FormData();
    form.set("expected_file_version", expectedVersion);
    form.set("request_id", id);
    const binary = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    form.set("file", new File([binary], name, { type: "text/plain" }));
    const response = await fetch(
      `${baseUrl}/api/v3/company-files/${encodeURIComponent(fileId)}/versions`,
      { method: "POST", body: form },
    );
    return {
      status: response.status,
      payload: await response.json().catch(() => null),
    };
  }, {
    baseUrl: appUrl,
    fileId: companyFile.id,
    expectedVersion: companyFile.version,
    encoded: Buffer.from(bytes).toString("base64"),
    name: filename,
    id: requestId,
  });
}

async function proveScannerDataPath(status, adminActor, page, appUrl, scanner) {
  const directClean = scanWithProductClient(
    scanner,
    Buffer.from("EVO restored-contour scanner clean proof\n", "utf8"),
    "clean",
  );
  if (
    !isRecord(directClean.proof) || directClean.proof.engine !== "ClamAV" ||
    directClean.proof.protocol !== "clamd-zinstream-v1" ||
    !SHA256_PATTERN.test(directClean.proof.sha256Hex)
  ) {
    fail("malware_scanner_clean_proof_invalid", "malware_scanner_proof");
  }
  assertPlaintextScannerProof(directClean.proof);
  if (scanWithProductClient(scanner, Buffer.from(EICAR, "ascii"), "infected").outcome !== "infected") {
    fail("malware_scanner_eicar_not_blocked", "malware_scanner_proof");
  }

  let companyFile = await createScannerProofCompanyFile(status, adminActor);
  const cleanBytes = Buffer.from("EVO recovery clean company file\n", "utf8");
  const clean = await browserCompanyFileUpload(
    page,
    appUrl,
    companyFile,
    cleanBytes,
    "recovery-clean.txt",
    randomUUID(),
  );
  if (
    clean.status !== 201 || !isRecord(clean.payload?.companyFile) ||
    clean.payload.companyFile.companyFileId !== companyFile.id ||
    typeof clean.payload.companyFile.fileVersion !== "string"
  ) {
    fail("malware_scanner_clean_data_path_failed", "malware_scanner_proof");
  }
  companyFile = Object.freeze({
    ...companyFile,
    version: clean.payload.companyFile.fileVersion,
  });
  const afterClean = readScannerPersistenceState(status);

  const infected = await browserCompanyFileUpload(
    page,
    appUrl,
    companyFile,
    Buffer.from(EICAR, "ascii"),
    "recovery-eicar.txt",
    randomUUID(),
  );
  if (infected.status !== 422 || infected.payload?.error !== "malware_detected") {
    fail("malware_scanner_eicar_data_path_not_blocked", "malware_scanner_proof");
  }
  if (!sameCanonicalValue(readScannerPersistenceState(status), afterClean)) {
    fail("malware_scanner_eicar_persisted_state", "malware_scanner_proof");
  }

  docker(["stop", "--time", "30", scanner.containerName], {
    code: "malware_scanner_outage_stop_failed",
    stage: "malware_scanner_proof",
  });
  const outage = await browserCompanyFileUpload(
    page,
    appUrl,
    companyFile,
    Buffer.from("EVO recovery scanner outage proof\n", "utf8"),
    "recovery-outage.txt",
    randomUUID(),
  );
  if (outage.status !== 503 || outage.payload?.error !== "malware_scanner_unavailable") {
    fail("malware_scanner_outage_not_fail_closed", "malware_scanner_proof");
  }
  if (!sameCanonicalValue(readScannerPersistenceState(status), afterClean)) {
    fail("malware_scanner_outage_persisted_state", "malware_scanner_proof");
  }

  docker(["start", scanner.containerName], {
    code: "malware_scanner_recovery_start_failed",
    stage: "malware_scanner_proof",
  });
  await waitForRecoveryScanner(scanner.containerName);
  const recovered = await browserCompanyFileUpload(
    page,
    appUrl,
    companyFile,
    Buffer.from("EVO recovery scanner restored proof\n", "utf8"),
    "recovery-restored.txt",
    randomUUID(),
  );
  if (recovered.status !== 201 || !isRecord(recovered.payload?.companyFile)) {
    fail("malware_scanner_recovered_data_path_failed", "malware_scanner_proof");
  }
  const afterRecovered = readScannerPersistenceState(status);
  for (const key of ["reservations", "finalizations", "versions", "proofs", "storageObjects"]) {
    if (afterRecovered[key] !== afterClean[key] + 1) {
      fail("malware_scanner_recovered_persistence_invalid", "malware_scanner_proof");
    }
  }
  return Object.freeze({
    image: scanner.image,
    network: scanner.network,
    publish: scanner.publish,
    clean: "passed_with_attestation",
    eicar: "blocked_without_persistence",
    outage: "blocked_without_persistence",
    recovery: "passed_with_attestation",
  });
}

function assertPlaintextScannerProof(proof) {
  if (
    typeof proof.engineVersion !== "string" ||
    !/^[0-9][0-9A-Za-z.+~-]{0,63}$/u.test(proof.engineVersion) ||
    typeof proof.signatureVersion !== "string" ||
    !/^[1-9][0-9]{0,18}$/u.test(proof.signatureVersion)
  ) {
    fail("malware_scanner_identity_invalid", "malware_scanner_proof");
  }
}

async function proveV3BrowserAndReadiness(status, actors, appPort, harnessRoot, scanner) {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor !== 22) fail("node_22_required", "v3_browser_proof");
  const appRoot = prepareAppWorkspace(harnessRoot);
  const appLog = join(harnessRoot, "app.log");
  const logFd = openSync(appLog, "wx", 0o600);
  const observabilitySecret = randomBytes(40).toString("base64url");
  const appUrl = `http://127.0.0.1:${appPort}`;
  const child = spawn(
    process.execPath,
    [join(appRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(appPort)],
    {
      cwd: appRoot,
      env: minimalChildEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
        EVO_PLATFORM_SUPABASE_SECRET_KEY: status.serverSecretKey,
        EVO_PLATFORM_ORGANIZATION_ID: actors.organizationId,
        EVO_PLATFORM_P7A_AUDIT_ENABLED: "1",
        EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
        EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: observabilitySecret,
        EVO_PLATFORM_AI_MEMORY_ENABLED: "0",
        EVO_PLATFORM_STAFF_ASSISTANT_ENABLED: "0",
        EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED: "0",
        EVO_CLAMD_HOST: scanner.host,
        EVO_CLAMD_PORT: String(scanner.port),
        EVO_CLAMD_TIMEOUT_MS: "10000",
        EVO_V2_AMOCRM_WRITES_ENABLED: "0",
        EVO_V2_AMOCRM_PROVIDER_AUTHORIZED: "0",
        EVO_ENABLE_EXTERNAL_TRANSCRIPT_IMPROVEMENT: "0",
      }),
      detached: process.platform !== "win32",
      stdio: ["ignore", logFd, logFd],
    },
  );
  const browserProof = {
    appChild: child,
    browserServerPromise: undefined,
    logFd,
    logClosed: false,
    shutdownPromise: undefined,
  };
  registerActiveBrowserProof(browserProof);
  let browser;
  try {
    await waitForApp(child, appUrl);
    const { chromium } = await import("@playwright/test");
    browserProof.browserServerPromise = chromium.launchServer({ headless: true, timeout: 45_000 });
    const browserServer = await browserProof.browserServerPromise;
    browser = await chromium.connect(browserServer.wsEndpoint());
    let scannerDataPath;
    const availableActors = [actors.admin, actors.sales, actors.admissions].filter(Boolean);
    for (const actor of availableActors) {
      const context = await browser.newContext({ locale: "ru-RU" });
      const page = await context.newPage();
      await page.goto(`${appUrl}/login`, { waitUntil: "domcontentloaded" });
      await page.locator("#staff-email").fill(actor.email);
      await page.locator("#staff-password").fill(actor.password);
      await page.getByRole("button", { name: "Войти в CRM" }).click();
      const shell = page.getByTestId("v3-shell");
      await shell.waitFor({ state: "visible", timeout: 45_000 });
      if (await shell.getAttribute("data-authority-role") !== actor.appRole) {
        fail("v3_browser_role_mismatch", "v3_browser_proof");
      }
      await page.goto(`${appUrl}${actor.landing}`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("v3-shell").waitFor({ state: "visible", timeout: 45_000 });
      if (actor.appRole === "admin") {
        scannerDataPath = await proveScannerDataPath(status, actor, page, appUrl, scanner);
      }
      await context.close();
    }

    const requestId = randomUUID();
    const timestamp = String(Date.now());
    const hmac = createHmac("sha256", observabilitySecret)
      .update(`GET\n/api/readiness\n${requestId}\n${timestamp}`)
      .digest("hex");
    const readiness = await fetch(`${appUrl}/api/readiness`, {
      headers: {
        "x-evo-observability-request-id": requestId,
        "x-evo-observability-timestamp": timestamp,
        "x-evo-observability-hmac-algorithm": "sha256",
        "x-evo-observability-hmac": hmac,
      },
      redirect: "manual",
    });
    if (readiness.status !== 503) fail("readiness_fail_closed_status_invalid", "v3_browser_proof");
    const payload = await readiness.json().catch(() => null);
    if (
      !isRecord(payload) ||
      payload.status !== "not_ready" ||
      payload.components?.supabase?.status !== "ready" ||
      payload.components?.audit_append?.status !== "ready" ||
      payload.components?.waha?.status === "ready" ||
      payload.components?.ai?.status === "ready"
    ) {
      fail("readiness_component_contract_failed", "v3_browser_proof");
    }
    return Object.freeze({
      admin: "passed",
      sales: actors.sales ? "passed" : "not_run_missing_restored_identity",
      admissions: actors.admissions ? "passed" : "not_run_missing_restored_identity",
      readinessStatus: "not_ready",
      supabase: "ready",
      auditAppend: "ready",
      providersBlocked: true,
      malwareScanner: scannerDataPath,
    });
  } finally {
    await stopBrowserProof(browserProof);
  }
}

function docker(args, options = {}) {
  return execute("docker", ["--context", "orbstack", ...args], {
    ...options,
    stage: options.stage ?? "cleanup",
  });
}

function dockerStatus(args) {
  const result = spawnSync("docker", ["--context", "orbstack", ...args], {
    cwd: repositoryRoot,
    env: minimalChildEnvironment(),
    stdio: "ignore",
    timeout: 60_000,
  });
  if (result.error || !Number.isInteger(result.status)) {
    fail("docker_status_check_failed", "malware_scanner_proof");
  }
  return result.status;
}

async function waitForRecoveryScanner(containerName) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const health = docker([
      "inspect",
      "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
      containerName,
    ], {
      accepted: [0, 1],
      code: "malware_scanner_inspect_failed",
      stage: "malware_scanner_proof",
    });
    if (health === "healthy") return;
    if (["dead", "exited", "removing"].includes(health)) {
      fail("malware_scanner_exited", "malware_scanner_proof");
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
  }
  fail("malware_scanner_health_timeout", "malware_scanner_proof");
}

async function startRecoveryScanner(state, port) {
  const compose = readFileSync(join(repositoryRoot, "docker-compose.prod.yml"), "utf8");
  if (!compose.includes(`image: "${CLAMAV_IMAGE}"`)) {
    fail("malware_scanner_image_contract_mismatch", "malware_scanner_proof");
  }
  if (dockerStatus(["image", "inspect", CLAMAV_IMAGE]) !== 0) {
    docker(["pull", "--platform", "linux/amd64", CLAMAV_IMAGE], {
      capture: false,
      timeout: 20 * 60 * 1000,
      code: "malware_scanner_image_pull_failed",
      stage: "malware_scanner_proof",
    });
  }
  if (docker([
    "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", CLAMAV_IMAGE,
  ], { code: "malware_scanner_image_inspect_failed", stage: "malware_scanner_proof" }) !== "linux/amd64") {
    fail("malware_scanner_image_platform_invalid", "malware_scanner_proof");
  }
  const containerName = `supabase_clamav_${state.projectName}`;
  const signatureVolume = `supabase_clamav_signatures_${state.projectName}`;
  docker([
    "volume", "create",
    "--label", `com.docker.compose.project=${state.projectName}`,
    signatureVolume,
  ], { code: "malware_scanner_volume_create_failed", stage: "malware_scanner_proof" });
  docker([
    "run", "--detach",
    "--platform", "linux/amd64",
    "--name", containerName,
    "--network", state.networkName,
    "--init",
    "--cpus", "2.00",
    "--memory", "4096m",
    "--pids-limit", "256",
    "--log-driver", "json-file",
    "--log-opt", "max-size=10m",
    "--log-opt", "max-file=5",
    "--label", `com.docker.compose.project=${state.projectName}`,
    "--label", "com.evo.runtime.role=private-malware-scanner",
    "--publish", `127.0.0.1:${port}:3310`,
    "--volume", `${signatureVolume}:/var/lib/clamav`,
    "--health-cmd", "/usr/local/bin/clamdcheck.sh",
    "--health-interval", "5s",
    "--health-timeout", "10s",
    "--health-retries", "60",
    "--health-start-period", "180s",
    CLAMAV_IMAGE,
  ], {
    code: "malware_scanner_start_failed",
    stage: "malware_scanner_proof",
  });
  state.scannerContainer = containerName;
  state.scannerSignatureVolume = signatureVolume;
  await waitForRecoveryScanner(containerName);
  const bindings = JSON.parse(docker([
    "inspect", "--format", "{{json .HostConfig.PortBindings}}", containerName,
  ], { code: "malware_scanner_binding_inspect_failed", stage: "malware_scanner_proof" }));
  const binding = bindings?.["3310/tcp"];
  if (
    !Array.isArray(binding) || binding.length !== 1 ||
    binding[0]?.HostIp !== "127.0.0.1" || binding[0]?.HostPort !== String(port)
  ) {
    fail("malware_scanner_not_loopback_only", "malware_scanner_proof");
  }
  const networks = docker([
    "inspect", "--format", "{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{\"\\n\"}}{{end}}", containerName,
  ], { code: "malware_scanner_network_inspect_failed", stage: "malware_scanner_proof" })
    .split(/\r?\n/u).filter(Boolean);
  if (networks.length !== 1 || networks[0] !== state.networkName) {
    fail("malware_scanner_network_invalid", "malware_scanner_proof");
  }
  return Object.freeze({
    containerName,
    host: "127.0.0.1",
    port,
    image: CLAMAV_IMAGE,
    network: "unique_private_recovery_network",
    publish: "loopback_only",
  });
}

const scannerProbeSource = String.raw`
import {
  ClamdScanError,
  scanBytesWithClamd,
} from "${join(repositoryRoot, "src", "lib", "server", "clamd-malware-scanner.ts")}";

const bytes = Buffer.from(process.argv[1], "base64");
const host = process.argv[2];
const port = Number(process.argv[3]);
const expected = process.argv[4];
try {
  const proof = await scanBytesWithClamd(bytes, { host, port, timeoutMs: 10_000 });
  if (expected !== "clean") throw new Error("unexpected_clean_result");
  process.stdout.write(JSON.stringify({ outcome: "clean", proof }));
} catch (error) {
  if (!(error instanceof ClamdScanError) || error.code !== expected) throw error;
  process.stdout.write(JSON.stringify({ outcome: error.code }));
}
`;

function scanWithProductClient(scanner, bytes, expected) {
  const output = execute(process.execPath, [
    "--conditions=react-server",
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    scannerProbeSource,
    Buffer.from(bytes).toString("base64"),
    scanner.host,
    String(scanner.port),
    expected,
  ], {
    timeout: 30_000,
    code: "malware_scanner_product_client_failed",
    stage: "malware_scanner_proof",
  });
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    fail("malware_scanner_product_client_output_invalid", "malware_scanner_proof");
  }
  if (!isRecord(parsed) || parsed.outcome !== expected) {
    fail("malware_scanner_product_client_outcome_invalid", "malware_scanner_proof");
  }
  return parsed;
}

function inspectLocalContainerState(containerName) {
  const result = spawnSync(
    "docker",
    [
      "--context",
      "orbstack",
      "inspect",
      "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
      containerName,
    ],
    {
      env: minimalChildEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    },
  );
  if (result.error || result.status !== 0) return "missing";
  const state = String(result.stdout ?? "").trim();
  return state || "unknown";
}

function localSupabaseCliStatusReady(supabaseRoot) {
  const result = spawnSync(
    supabaseCli,
    ["status", "--workdir", supabaseRoot, "-o", "json"],
    {
      env: minimalChildEnvironment(),
      stdio: "ignore",
      timeout: 10_000,
    },
  );
  return !result.error && result.status === 0;
}

async function waitForLocalSupabaseReadiness(state, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let serviceStates = [];
  let cliReady = false;
  while (Date.now() < deadline) {
    serviceStates = REQUIRED_LOCAL_SERVICES.map(([service, containerPart]) => ({
      service,
      state: inspectLocalContainerState(`supabase_${containerPart}_${state.projectName}`),
    }));
    const containersReady = serviceStates.every(({ state: containerState }) =>
      containerState === "healthy" || containerState === "running");
    cliReady = containersReady && localSupabaseCliStatusReady(state.supabaseRoot);
    if (containersReady && cliReady) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }

  const failed = serviceStates.find(({ state: containerState }) =>
    containerState !== "healthy" && containerState !== "running");
  if (failed) {
    const suffix = failed.state === "missing"
      ? "missing"
      : new Set(["dead", "exited", "removing"]).has(failed.state) ? "stopped" : "not_ready";
    fail(`local_supabase_start_${failed.service}_${suffix}`, "local_supabase_start");
  }
  if (!cliReady) fail("local_supabase_start_cli_status_unavailable", "local_supabase_start");
  fail("local_supabase_start_readiness_failed", "local_supabase_start");
}

export function safeHarnessRoot(path) {
  const temporaryRoot = realpathSync(tmpdir());
  const candidate = realpathSync(path);
  return dirname(candidate) === temporaryRoot && candidate.startsWith(`${temporaryRoot}${sep}`) &&
    candidate.split(sep).at(-1).startsWith(HARNESS_PREFIX);
}

function assertCleanupProjectName(projectName) {
  if (!/^evov3recovery[0-9a-f]{12}$/u.test(projectName)) {
    fail("cleanup_project_scope_invalid", "cleanup");
  }
}

export function selectOwnedContainerIds(output, projectName) {
  assertCleanupProjectName(projectName);
  const owned = [];
  for (const line of String(output).split(/\r?\n/u).filter(Boolean)) {
    const fields = line.split("\t");
    if (fields.length !== 2 || !/^[0-9a-f]{12,64}$/u.test(fields[0]) || !fields[1]) {
      fail("cleanup_container_inventory_invalid", "cleanup");
    }
    const [id, name] = fields;
    if (name.startsWith("supabase_") && name.endsWith(`_${projectName}`)) owned.push(id);
  }
  return Object.freeze(owned);
}

export function selectOwnedVolumeNames(output, projectName) {
  assertCleanupProjectName(projectName);
  return Object.freeze(String(output).split(/\r?\n/u).filter(Boolean)
    .filter((name) => name.startsWith("supabase_") && name.endsWith(`_${projectName}`)));
}

export function selectOwnedNetworkNames(output, networkName) {
  if (!/^evo_v3_recovery_[0-9a-f]{12}_private$/u.test(networkName)) {
    fail("cleanup_network_scope_invalid", "cleanup");
  }
  return Object.freeze(String(output).split(/\r?\n/u).filter(Boolean)
    .filter((name) => name === networkName));
}

function ownedContainerIds(state) {
  return selectOwnedContainerIds(
    docker(["ps", "--all", "--format", "{{.ID}}\t{{.Names}}"], {
      code: "cleanup_container_inventory_failed",
      stage: "cleanup",
    }),
    state.projectName,
  );
}

function ownedVolumeNames(state) {
  return selectOwnedVolumeNames(
    docker(["volume", "ls", "--format", "{{.Name}}"], {
      code: "cleanup_volume_inventory_failed",
      stage: "cleanup",
    }),
    state.projectName,
  );
}

function ownedNetworkNames(state) {
  return selectOwnedNetworkNames(
    docker(["network", "ls", "--format", "{{.Name}}"], {
      code: "cleanup_network_inventory_failed",
      stage: "cleanup",
    }),
    state.networkName,
  );
}

function cleanupContour(state) {
  const failures = [];
  const attempt = (fn) => {
    try {
      fn();
    } catch {
      failures.push(1);
    }
  };
  if (state.stackStarted) {
    attempt(() => execute(
      supabaseCli,
      ["stop", "--no-backup", "--project-id", state.projectName, "--workdir", state.supabaseRoot],
      { capture: false, timeout: 20 * 60 * 1000, code: "supabase_stop_failed", stage: "cleanup" },
    ));
  }
  attempt(() => {
    const owned = ownedContainerIds(state);
    if (owned.length > 0) {
      docker(["rm", "--force", ...owned], {
        capture: false,
        code: "cleanup_container_remove_failed",
        stage: "cleanup",
      });
    }
  });
  attempt(() => {
    const names = ownedVolumeNames(state);
    if (names.length > 0) docker(["volume", "rm", "--force", ...names], { capture: false, code: "cleanup_volume_remove_failed" });
  });
  if (state.networkCreated) {
    attempt(() => docker(["network", "rm", state.networkName], {
      accepted: [0, 1],
      capture: false,
      code: "cleanup_network_remove_failed",
    }));
  }
  attempt(() => {
    if (ownedContainerIds(state).length !== 0) fail("cleanup_owned_containers_remain", "cleanup");
  });
  attempt(() => {
    if (ownedVolumeNames(state).length !== 0) fail("cleanup_owned_volumes_remain", "cleanup");
  });
  attempt(() => {
    if (ownedNetworkNames(state).length !== 0) fail("cleanup_owned_network_remains", "cleanup");
  });
  attempt(() => cleanupHarnessRoot(state));
  return failures.length === 0 ? "passed" : "incomplete";
}

function cleanupHarnessRoot(state) {
  if (!existsSync(state.harnessRoot)) return;
  const markerPath = join(state.harnessRoot, MARKER);
  if (
    !safeHarnessRoot(state.harnessRoot) ||
    !existsSync(markerPath) ||
    readFileSync(markerPath, "utf8") !== state.projectName
  ) {
    fail("cleanup_harness_root_scope_invalid", "cleanup");
  }
  rmSync(state.harnessRoot, { recursive: true, force: true });
  if (existsSync(state.harnessRoot)) fail("cleanup_harness_root_remains", "cleanup");
}

function registerActiveCleanupState(state) {
  if (activeCleanupState) fail("cleanup_state_already_registered", "cleanup");
  activeCleanupState = state;
}

function cleanupActiveState(state = activeCleanupState) {
  if (!state) return "passed";
  if (activeCleanupRunning || state !== activeCleanupState) return "incomplete";
  activeCleanupRunning = true;
  let result = "incomplete";
  try {
    if (state.kind === "recovery") {
      result = cleanupContour(state);
    } else {
      try {
        cleanupHarnessRoot(state);
        result = "passed";
      } catch {
        result = "incomplete";
      }
    }
    if (result === "passed" && activeCleanupState === state) activeCleanupState = undefined;
    return result;
  } finally {
    activeCleanupRunning = false;
  }
}

export function installProcessCleanupHandlers({
  getBrowserProof = () => activeBrowserProof,
  cleanup = cleanupActiveState,
  exit = (code) => process.exit(code),
} = {}) {
  let terminationPromise;
  let terminationStarted = false;
  function terminationHandler(signal) {
    if (terminationPromise) return terminationPromise;
    const exitCode = signal === "SIGINT" ? 130 : 143;
    process.exitCode = exitCode;
    terminationStarted = true;
    const shutdownLifetime = setInterval(() => undefined, 1_000);
    terminationPromise = (async () => {
      try {
        await stopBrowserProof(getBrowserProof());
      } catch {
        // Browser-proof teardown is best-effort; contour cleanup must still run.
      }
      try {
        cleanup();
      } catch {
        // The exact signal exit code remains authoritative even if cleanup fails.
      } finally {
        clearInterval(shutdownLifetime);
        process.removeListener("SIGINT", sigintHandler);
        process.removeListener("SIGTERM", sigtermHandler);
        exit(exitCode);
      }
    })();
    return terminationPromise;
  }
  function exitCleanupHandler() {
    if (!terminationStarted) cleanup();
  }
  function sigintHandler() {
    terminationHandler("SIGINT");
  }
  function sigtermHandler() {
    terminationHandler("SIGTERM");
  }
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);
  process.once("exit", exitCleanupHandler);
}

export function validateSanitizedEvidence(evidence) {
  if (!isRecord(evidence)) fail("evidence_shape_invalid", "result");
  const serialized = JSON.stringify(evidence);
  if (
    /"(?:email|password|accessToken|userId|organizationId|customer|phone)"\s*:/iu.test(serialized) ||
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(serialized) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(serialized)
  ) {
    fail("evidence_contains_sensitive_material", "result");
  }
  return evidence;
}

function writeSanitizedEvidence(path, evidence) {
  validateSanitizedEvidence(evidence);
  if (!path) return;
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
}

function contractOutput() {
  return Object.freeze({
    ok: true,
    status: "contract",
    proof: "not_run",
    optIn: OPT_IN,
    subcommands: ["contract", "preflight", "run"],
    exportStage: "separate_read_only_operator_process",
    requiredBundle: Object.freeze([...EXPORT_BUNDLE_FILES]),
    requiredExternalTrust: ["age identity file", "trusted SSH public key", "trusted SSH public-key fingerprint"],
    requiredRepositoryBinding: "signed_export_commit_and_tree_plus_exact_clean_recovery_commit",
    sourceIdentityBinding: "signed_receipt_source_identity_sha256",
    safety: {
      destination: "unique_disposable_local_orbstack_only",
      managedSupabase: "never_contacted",
      production: "never_contacted",
      providers: "disabled_and_not_called",
      decryptedMaterial: "mode_0700_mktemp_only",
      logs: "aggregate_counts_hashes_status_only",
      schemaApply: "pending_root_migrations_local_only",
    },
  });
}

async function runPreflight(options) {
  const repository = assertRepositoryState(options.expectedRepositoryCommit);
  assertOrbStackPreflight();
  const temporaryRoot = realpathSync(tmpdir());
  const harnessRoot = realpathSync(mkdtempSync(join(temporaryRoot, HARNESS_PREFIX)));
  chmodSync(harnessRoot, 0o700);
  const projectName = `evov3recovery${randomBytes(6).toString("hex")}`;
  writeFileSync(join(harnessRoot, MARKER), projectName, { mode: 0o600 });
  const state = { kind: "preflight", harnessRoot, projectName };
  registerActiveCleanupState(state);
  let cleanupStatus = "not_started";
  let result;
  try {
    const artifacts = await prepareArtifacts(options, harnessRoot, false);
    if (projectName === artifacts.database.sourceProjectRef) {
      fail("recovery_destination_matches_managed_source", "preflight");
    }
    const rootMigrations = rootMigrationEntries();
    const sourceMigrationPrefix = verifiedExportedHistoryPrefix(
      rootMigrations,
      artifacts.database.migrationLedger,
      artifacts.exportedHistory,
    );
    result = Object.freeze({
      ok: true,
      status: "preflight_passed",
      proof: "not_run",
      repository,
      sourceIdentitySha256: artifacts.receipt.sourceIdentitySha256,
      receiptCapturedAt: artifacts.receipt.capturedAt,
      receiptAgeHours: Number(artifacts.ageHours.toFixed(3)),
      receiptSignature: "verified",
      exportGit: artifacts.receipt.git,
      databaseManifestSha256: artifacts.ciphertextHashes["database-manifest.json.age"],
      migrationHistorySha256: artifacts.database.migrationLedger.copyRowsSha256,
      migrationHistoryRepositoryPrefix: {
        status: "passed",
        count: sourceMigrationPrefix.length,
        recordedHistoryValidatedCount: rootMigrations.recordedHistoryCount,
      },
      storageManifestSha256: artifacts.ciphertextHashes["storage-manifest.json.age"],
      databaseLedger: artifacts.database.migrationLedger,
      storage: {
        bucketCount: artifacts.storage.bucketCount,
        publicBucketCount: artifacts.storage.publicBucketCount,
        objectCount: artifacts.storage.objectCount,
        totalBytes: artifacts.storage.totalBytes,
      },
      managedSupabaseTouched: false,
      localSupabaseStarted: false,
    });
  } finally {
    cleanupStatus = cleanupActiveState(state);
  }
  if (cleanupStatus !== "passed") fail("cleanup_incomplete", "cleanup");
  return result;
}

async function runRecovery(options) {
  const repository = assertRepositoryState(options.expectedRepositoryCommit);
  assertOrbStackPreflight();
  const temporaryRoot = realpathSync(tmpdir());
  const harnessRoot = realpathSync(mkdtempSync(join(temporaryRoot, HARNESS_PREFIX)));
  chmodSync(harnessRoot, 0o700);
  const suffix = randomBytes(6).toString("hex");
  const projectName = `evov3recovery${suffix}`;
  const networkName = `evo_v3_recovery_${suffix}_private`;
  writeFileSync(join(harnessRoot, MARKER), projectName, { mode: 0o600 });
  const state = {
    kind: "recovery",
    harnessRoot,
    projectName,
    networkName,
    supabaseRoot: undefined,
    networkCreated: false,
    stackStarted: false,
  };
  registerActiveCleanupState(state);
  let cleanupStatus = "not_started";
  let evidence;
  try {
    const artifacts = await prepareArtifacts(options, harnessRoot, true);
    if (projectName === artifacts.database.sourceProjectRef) {
      fail("recovery_destination_matches_managed_source", "preflight");
    }
    const rootMigrations = rootMigrationEntries();
    const sourceMigrationPrefix = verifiedExportedHistoryPrefix(
      rootMigrations,
      artifacts.database.migrationLedger,
      artifacts.exportedHistory,
    );
    const portMap = await reservePortMap();
    const supabaseRoot = join(harnessRoot, "supabase-workdir");
    state.supabaseRoot = supabaseRoot;
    mkdirSync(join(supabaseRoot, "supabase"), { recursive: true, mode: 0o700 });
    const configPath = join(supabaseRoot, "supabase", "config.toml");
    writeFileSync(configPath, renderIsolatedSupabaseConfig(projectName, portMap), { mode: 0o600 });
    state.networkCreated = true;
    docker([
      "network",
      "create",
      // Supabase CLI bootstraps Postgres from the macOS host through its
      // published loopback port. OrbStack cannot route that port when the
      // bridge uses internal mode, so isolation is provided by a unique network
      // plus an enforced 127.0.0.1 default bind for every published port.
      "--opt",
      "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
      networkName,
    ], { capture: false, code: "isolated_network_create_failed", stage: "local_supabase_start" });
    const scanner = await startRecoveryScanner(state, portMap.clamd);
    state.stackStarted = true;
    execute(
      supabaseCli,
      [
        "start",
        "--workdir",
        supabaseRoot,
        "--network-id",
        networkName,
        "--exclude",
        RECOVERY_EXCLUDED_SERVICES,
        "--ignore-health-check",
        "--debug",
        "--yes",
      ],
      {
        timeout: 10 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
        code: "local_supabase_start_failed",
        stage: "local_supabase_start",
        failureClassifier: classifyLocalSupabaseStartFailure,
        failureDiagnostic: sanitizeLocalSupabaseStartDiagnostic,
      },
    );
    await waitForLocalSupabaseReadiness(state);
    const status = parseSupabaseStatus(execute(
      supabaseCli,
      ["status", "--workdir", supabaseRoot, "-o", "env"],
      { code: "local_supabase_status_failed", stage: "local_supabase_start" },
    ));

    const copyTargets = await scanCopyInventory(artifacts.plaintext.data);
    const localDatabaseMajor = assertLocalDatabaseMajor(status, artifacts.database.databaseMajor);
    const pgmqQueues = restoreLogicalDatabase(status, artifacts, copyTargets);
    restoreExportedMigrationHistory(
      status,
      artifacts.plaintext.historySchema,
      artifacts.plaintext.historyData,
    );
    const restoredLedger = readAppliedMigrationEntries(status, "database_restore");
    assertManifestLedger(restoredLedger, sourceMigrationPrefix);
    const storageRestore = await restoreStorageBytes(status, artifacts, harnessRoot);
    const aggregatesBefore = readAggregates(status);

    cpSync(
      join(repositoryRoot, "supabase", "migrations"),
      join(supabaseRoot, "supabase", "migrations"),
      { recursive: true },
    );
    setMigrationsEnabled(configPath);
    execute(
      supabaseCli,
      ["migration", "up", "--local", "--include-all", "--workdir", supabaseRoot],
      { capture: false, timeout: 4 * 60 * 60 * 1000, code: "pending_migration_apply_failed", stage: "migration_rehearsal" },
    );
    psqlScalar(
      status,
      "NOTIFY pgrst, 'reload schema'; SELECT 'reloaded'",
      "migration_rehearsal",
      false,
      "post_migration_schema_reload_failed",
    );
    await waitForPostgrestSchemaReadiness(status);
    const appliedMigrationVersions = readAppliedMigrationVersions(status);
    const finalLedger = assertExactRootLedger(appliedMigrationVersions, rootMigrations);
    verifyPgmqQueueRows(status, pgmqQueues);
    const aggregatesAfter = readAggregates(status, true);
    assertNonDecreasingAggregates(aggregatesBefore, aggregatesAfter);

    const v3Storage = await establishV3PrivateStorage(status, artifacts.storage.buckets);
    const actors = await prepareRepresentativeActors(status);
    const historicalScannerGate = await assertHistoricalScannerGate(
      status,
      actors.admin,
      appliedMigrationVersions,
    );
    const rls = await proveSameAndCrossOrganizationRls(status, actors.admin);
    const storagePrivacy = await provePrivateStorage(
      status,
      v3Storage.buckets,
      artifacts.storage.objectCount,
      actors.sales ?? actors.admin,
    );
    const browser = await proveV3BrowserAndReadiness(
      status,
      actors,
      portMap.app,
      harnessRoot,
      scanner,
    );
    const roleReadiness = buildRestoredRoleReadiness({
      admin: true,
      sales: Boolean(actors.sales),
      admissions: Boolean(actors.admissions),
    });

    evidence = {
      schema: RESULT_SCHEMA,
      ok: roleReadiness.complete,
      status: roleReadiness.complete ? "passed" : "not_ready",
      ...(roleReadiness.blocker ? { blocker: roleReadiness.blocker } : {}),
      repository,
      source: {
        identitySha256: artifacts.receipt.sourceIdentitySha256,
        receiptCapturedAt: artifacts.receipt.capturedAt,
        receiptAgeHours: Number(artifacts.ageHours.toFixed(3)),
        receiptSignature: "verified",
        exportGit: artifacts.receipt.git,
        databaseManifestSha256: artifacts.ciphertextHashes["database-manifest.json.age"],
        migrationHistorySha256: artifacts.database.migrationLedger.copyRowsSha256,
        storageManifestSha256: artifacts.ciphertextHashes["storage-manifest.json.age"],
        encryptedLogicalSetSha256: sha256Text([
          ...SQL_FILES.map((name) => artifacts.ciphertextHashes[`${name}.age`]),
        ].join("\n")),
        encryptedStorageArchiveSha256: artifacts.ciphertextHashes["storage-objects.tar.age"],
      },
      database: {
        restore: "passed",
        localDatabaseMajor,
        sourceLedger: artifacts.database.migrationLedger,
        ledgerReconstruction: {
          mode: "authenticated_exported_history_then_exact_forward_migrations",
          restoredCount: sourceMigrationPrefix.length,
          recordedHistoryValidatedCount: rootMigrations.recordedHistoryCount,
        },
        pgmqQueueRelationsReconciled: pgmqQueues.reduce(
          (count, queue) => count + queue.relations.length,
          0,
        ),
        pgmqRowsAfterMigrations: "passed",
        copyRelationsTruncated: copyTargets.length,
        finalLedger,
        aggregateCountsBeforeMigrations: aggregatesBefore,
        aggregateCountsAfterMigrationsBeforeTestIdentitySetup: aggregatesAfter,
        sourceAggregatesCapturedBeforeTestIdentitySetup: true,
      },
      storage: {
        ...storageRestore,
        v3Boundary: v3Storage.evidence,
        privacy: storagePrivacy,
      },
      authAndRls: {
        ...roleReadiness.roleStatus,
        actors: actors.evidence,
        ...rls,
      },
      application: browser,
      malwareScanner: {
        historicalGate: historicalScannerGate,
        dataPath: browser.malwareScanner,
      },
      managedSupabaseTouched: false,
      vpsTouched: false,
      providersCalled: false,
      webhooksTouched: false,
      cleanup: "pending",
    };
  } finally {
    cleanupStatus = cleanupActiveState(state);
  }
  if (!evidence) fail("recovery_evidence_missing", "result");
  if (cleanupStatus !== "passed") fail("cleanup_incomplete", "cleanup");
  evidence.cleanup = "passed";
  writeSanitizedEvidence(options.evidenceOut, evidence);
  if (!evidence.ok) {
    fail("restored_representative_staff_roles_missing", "auth_rls_proof", evidence.blocker);
  }
  return Object.freeze(evidence);
}

async function main() {
  const subcommand = process.argv[2] ?? "contract";
  if (subcommand === "contract") return contractOutput();
  if (!["preflight", "run"].includes(subcommand)) fail("unknown_subcommand", "arguments");
  if (process.env[OPT_IN] !== OPT_IN_VALUE) {
    return Object.freeze({
      ok: true,
      status: "skipped",
      code: "explicit_opt_in_required",
      optIn: OPT_IN,
      managedSupabaseTouched: false,
      localSupabaseStarted: false,
    });
  }
  const options = parseHarnessOptions(process.argv.slice(3));
  return subcommand === "preflight"
    ? await runPreflight(options)
    : await runRecovery(options);
}

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  installProcessCleanupHandlers();
  const previousUmask = process.umask(0o077);
  try {
    const result = await main();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const failure = error instanceof HarnessFailure
      ? error
      : new HarnessFailure("unexpected_harness_failure", "unexpected");
    process.stdout.write(`${JSON.stringify({
      schema: RESULT_SCHEMA,
      ok: false,
      status: "blocked",
      code: failure.code,
      stage: failure.stage,
      ...(failure.diagnostic ? { diagnostic: failure.diagnostic } : {}),
      managedSupabaseTouched: false,
      vpsTouched: false,
      providersCalled: false,
      webhooksTouched: false,
    })}\n`);
    process.exitCode = 1;
  } finally {
    process.umask(previousUmask);
  }
}
