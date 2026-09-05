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

const OPT_IN = "EVO_RUN_V3_MANAGED_SUPABASE_RECOVERY_ORBSTACK";
const OPT_IN_VALUE = "1";
const DATABASE_SCHEMA = "evo-managed-supabase-logical-backup/v1";
const STORAGE_SCHEMA = "evo-managed-supabase-storage-backup/v1";
const MIGRATION_LEDGER_ATTESTATION_SCHEMA =
  "evo-managed-supabase-migration-ledger-attestation/v1";
const RESULT_SCHEMA = "evo-v3-managed-supabase-recovery-result/v1";
const HARNESS_PREFIX = "evo-v3-managed-recovery-";
const MARKER = ".evo-v3-managed-recovery-harness";
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_SQL_BYTES = 128 * 1024 * 1024 * 1024;
const MAX_STORAGE_ARCHIVE_BYTES = 256 * 1024 * 1024 * 1024;
const MAX_STORAGE_OBJECT_BYTES = 50 * 1024 * 1024;
const MAX_BACKUP_AGE_HOURS = 24 * 31;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_CAPTURE_SPAN_MS = 60 * 60 * 1000;
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
const REGION_PATTERN = /^[a-z][a-z0-9-]{1,62}$/u;
const MIGRATION_VERSION_PATTERN = /^\d{3}$/u;
const MIGRATION_NAME_PATTERN = /^[a-z0-9][a-z0-9_]{0,126}$/u;
const BUCKET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/u;
const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;
const SAFE_ARCHIVE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SQL_FILES = Object.freeze(["roles.sql", "schema.sql", "data.sql"]);
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

export function deriveSourceIdentitySha256(projectRef, region) {
  requiredString(projectRef, PROJECT_REF_PATTERN, "source_project_ref_invalid");
  requiredString(region, REGION_PATTERN, "source_region_invalid");
  return sha256Text(`${projectRef}\n${region}`);
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
    bytes: nonNegativeInteger(value.bytes, code),
    sha256: requiredString(value.sha256, SHA256_PATTERN, code),
  });
}

function validateMigrationLedger(value) {
  exactKeys(
    value,
    ["count", "minVersion", "maxVersion"],
    "database_migration_ledger_invalid",
  );
  const count = positiveInteger(value.count, "database_migration_ledger_invalid");
  const minVersion = requiredString(
    value.minVersion,
    MIGRATION_VERSION_PATTERN,
    "database_migration_ledger_invalid",
  );
  const maxVersion = requiredString(
    value.maxVersion,
    MIGRATION_VERSION_PATTERN,
    "database_migration_ledger_invalid",
  );
  if (
    Number(minVersion) > Number(maxVersion) ||
    count !== Number(maxVersion) - Number(minVersion) + 1
  ) {
    fail("database_migration_ledger_invalid", "artifact_validation");
  }
  return Object.freeze({ count, minVersion, maxVersion });
}

function migrationLedgerDigest(entries) {
  return sha256Text(JSON.stringify(entries.map(({ version, name }) => ({ version, name }))));
}

/** Validate the separately captured, encrypted managed migration ledger. */
export function validateMigrationLedgerAttestation(attestation, expected) {
  exactKeys(
    attestation,
    [
      "schema",
      "createdAt",
      "databaseCreatedAt",
      "sourceIdentitySha256",
      "ledgerSha256",
      "source",
    ],
    "migration_ledger_attestation_shape_invalid",
  );
  if (attestation.schema !== MIGRATION_LEDGER_ATTESTATION_SCHEMA) {
    fail("migration_ledger_attestation_schema_invalid", "artifact_validation");
  }
  const createdAt = parseIsoTimestamp(
    attestation.createdAt,
    "migration_ledger_attestation_timestamp_invalid",
  ).toISOString();
  const databaseCreatedAt = parseIsoTimestamp(
    attestation.databaseCreatedAt,
    "migration_ledger_attestation_database_timestamp_invalid",
  ).toISOString();
  if (databaseCreatedAt !== expected.databaseCreatedAt) {
    fail("migration_ledger_attestation_database_timestamp_mismatch", "artifact_validation");
  }
  if (new Date(createdAt).valueOf() < new Date(databaseCreatedAt).valueOf()) {
    fail("migration_ledger_attestation_precedes_database", "artifact_validation");
  }
  const sourceIdentitySha256 = requiredString(
    attestation.sourceIdentitySha256,
    SHA256_PATTERN,
    "migration_ledger_attestation_source_invalid",
  );
  if (sourceIdentitySha256 !== expected.sourceIdentitySha256) {
    fail("migration_ledger_attestation_source_mismatch", "artifact_validation");
  }
  if (!Array.isArray(attestation.source) || attestation.source.length === 0) {
    fail("migration_ledger_attestation_source_invalid", "artifact_validation");
  }
  const source = attestation.source.map((entry, index) => {
    exactKeys(entry, ["version", "name"], "migration_ledger_attestation_entry_invalid");
    const version = requiredString(
      entry.version,
      MIGRATION_VERSION_PATTERN,
      "migration_ledger_attestation_entry_invalid",
    );
    const name = requiredString(
      entry.name,
      MIGRATION_NAME_PATTERN,
      "migration_ledger_attestation_entry_invalid",
    );
    if (version !== String(index + 1).padStart(3, "0")) {
      fail("migration_ledger_attestation_sequence_invalid", "artifact_validation");
    }
    return Object.freeze({ version, name });
  });
  const ledgerSha256 = requiredString(
    attestation.ledgerSha256,
    SHA256_PATTERN,
    "migration_ledger_attestation_digest_invalid",
  );
  if (ledgerSha256 !== migrationLedgerDigest(source)) {
    fail("migration_ledger_attestation_digest_mismatch", "artifact_validation");
  }
  return Object.freeze({
    schema: MIGRATION_LEDGER_ATTESTATION_SCHEMA,
    createdAt,
    databaseCreatedAt,
    sourceIdentitySha256,
    ledgerSha256,
    source: Object.freeze(source),
  });
}

/** Validate the encrypted database manifest after age decryption. */
export function validateDatabaseManifest(manifest, expected) {
  exactKeys(
    manifest,
    [
      "schema",
      "createdAt",
      "projectRef",
      "region",
      "databaseMajor",
      "migrationLedger",
      "files",
    ],
    "database_manifest_shape_invalid",
  );
  if (manifest.schema !== DATABASE_SCHEMA) {
    fail("database_manifest_schema_invalid", "artifact_validation");
  }
  const createdAt = parseIsoTimestamp(
    manifest.createdAt,
    "database_manifest_timestamp_invalid",
  ).toISOString();
  if (createdAt !== expected.createdAt) {
    fail("database_manifest_timestamp_mismatch", "artifact_validation");
  }
  const projectRef = requiredString(
    manifest.projectRef,
    PROJECT_REF_PATTERN,
    "database_manifest_project_invalid",
  );
  const region = requiredString(
    manifest.region,
    REGION_PATTERN,
    "database_manifest_region_invalid",
  );
  const sourceIdentitySha256 = deriveSourceIdentitySha256(projectRef, region);
  if (sourceIdentitySha256 !== expected.sourceIdentitySha256) {
    fail("database_manifest_source_identity_mismatch", "artifact_validation");
  }
  if (!Number.isSafeInteger(manifest.databaseMajor) || manifest.databaseMajor < 15 || manifest.databaseMajor > 17) {
    fail("database_manifest_major_invalid", "artifact_validation");
  }
  exactKeys(manifest.files, SQL_FILES, "database_manifest_files_invalid");
  const files = Object.fromEntries(
    SQL_FILES.map((name) => [
      name,
      validateFileDescriptor(manifest.files[name], "database_manifest_file_invalid"),
    ]),
  );
  return Object.freeze({
    createdAt,
    sourceIdentitySha256,
    databaseMajor: manifest.databaseMajor,
    migrationLedger: validateMigrationLedger(manifest.migrationLedger),
    files: Object.freeze(files),
  });
}

function validateBucket(value) {
  exactKeys(
    value,
    ["id", "name", "public", "fileSizeLimit", "allowedMimeTypes"],
    "storage_bucket_invalid",
  );
  const id = requiredString(value.id, BUCKET_ID_PATTERN, "storage_bucket_invalid");
  const name = requiredString(value.name, BUCKET_ID_PATTERN, "storage_bucket_invalid");
  if (typeof value.public !== "boolean") {
    fail("storage_bucket_invalid", "artifact_validation");
  }
  if (value.fileSizeLimit !== null) {
    positiveInteger(value.fileSizeLimit, "storage_bucket_limit_invalid");
  }
  if (value.allowedMimeTypes !== null && !Array.isArray(value.allowedMimeTypes)) {
    fail("storage_bucket_mime_types_invalid", "artifact_validation");
  }
  const allowedMimeTypes = value.allowedMimeTypes === null
    ? null
    : value.allowedMimeTypes.map((candidate) =>
      requiredString(candidate, CONTENT_TYPE_PATTERN, "storage_bucket_mime_types_invalid"));
  if (allowedMimeTypes !== null && new Set(allowedMimeTypes).size !== allowedMimeTypes.length) {
    fail("storage_bucket_mime_types_invalid", "artifact_validation");
  }
  return Object.freeze({
    id,
    name,
    public: value.public,
    fileSizeLimit: value.fileSizeLimit,
    allowedMimeTypes: allowedMimeTypes === null ? null : Object.freeze(allowedMimeTypes),
  });
}

function validateObjectEntry(value, buckets) {
  exactKeys(
    value,
    ["archivePath", "bucketId", "contentType", "objectPath", "bytes", "sha256"],
    "storage_object_manifest_invalid",
  );
  const archivePath = requiredString(
    value.archivePath,
    SAFE_ARCHIVE_PATH_PATTERN,
    "storage_archive_path_invalid",
  );
  if (
    archivePath.startsWith("/") ||
    archivePath.includes("\\") ||
    archivePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail("storage_archive_path_invalid", "artifact_validation");
  }
  const bucketId = requiredString(value.bucketId, BUCKET_ID_PATTERN, "storage_object_bucket_invalid");
  if (!buckets.has(bucketId)) fail("storage_object_bucket_unknown", "artifact_validation");
  const objectPath = requiredString(value.objectPath, null, "storage_object_path_invalid");
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
  return Object.freeze({
    archivePath,
    bucketId,
    objectPath,
    contentType: requiredString(value.contentType, CONTENT_TYPE_PATTERN, "storage_object_content_type_invalid"),
    bytes,
    sha256: requiredString(value.sha256, SHA256_PATTERN, "storage_object_sha256_invalid"),
  });
}

/** Validate the Storage manifest after age decryption. */
export function validateStorageManifest(manifest, expected) {
  const required = [
    "schema",
    "createdAt",
    "projectRef",
    "bucketCount",
    "publicBucketCount",
    "objectCount",
    "totalBytes",
    "archive",
    "buckets",
  ];
  const allowed = new Set([...required, "objects"]);
  if (!isRecord(manifest)) fail("storage_manifest_shape_invalid", "artifact_validation");
  const actualKeys = Object.keys(manifest);
  if (required.some((key) => !actualKeys.includes(key)) || actualKeys.some((key) => !allowed.has(key))) {
    fail("storage_manifest_shape_invalid", "artifact_validation");
  }
  if (manifest.schema !== STORAGE_SCHEMA) {
    fail("storage_manifest_schema_invalid", "artifact_validation");
  }
  const createdAt = parseIsoTimestamp(
    manifest.createdAt,
    "storage_manifest_timestamp_invalid",
  ).toISOString();
  const databaseCreatedAt = parseIsoTimestamp(
    expected.databaseCreatedAt ?? expected.createdAt,
    "database_manifest_timestamp_invalid",
  );
  if (Math.abs(new Date(createdAt).valueOf() - databaseCreatedAt.valueOf()) > MAX_CAPTURE_SPAN_MS) {
    fail("backup_capture_window_exceeded", "artifact_validation");
  }
  const projectRef = requiredString(
    manifest.projectRef,
    PROJECT_REF_PATTERN,
    "storage_manifest_project_invalid",
  );
  if (sha256Text(projectRef) !== expected.projectRefSha256) {
    fail("storage_manifest_source_identity_mismatch", "artifact_validation");
  }
  const bucketCount = positiveInteger(manifest.bucketCount, "storage_bucket_count_invalid");
  const publicBucketCount = nonNegativeInteger(
    manifest.publicBucketCount,
    "storage_public_bucket_count_invalid",
  );
  const objectCount = nonNegativeInteger(manifest.objectCount, "storage_object_count_invalid");
  const totalBytes = nonNegativeInteger(manifest.totalBytes, "storage_total_bytes_invalid");
  if (!Array.isArray(manifest.buckets) || manifest.buckets.length !== bucketCount) {
    fail("storage_bucket_count_mismatch", "artifact_validation");
  }
  const buckets = manifest.buckets.map(validateBucket);
  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  if (bucketIds.size !== buckets.length) fail("storage_bucket_duplicate", "artifact_validation");
  if (buckets.filter((bucket) => bucket.public).length !== publicBucketCount) {
    fail("storage_public_bucket_count_mismatch", "artifact_validation");
  }
  exactKeys(manifest.archive, ["format", "bytes", "sha256"], "storage_archive_invalid");
  if (manifest.archive.format !== "tar.gz") fail("storage_archive_format_invalid", "artifact_validation");
  const archive = Object.freeze({
    format: "tar.gz",
    bytes: positiveInteger(manifest.archive.bytes, "storage_archive_invalid"),
    sha256: requiredString(manifest.archive.sha256, SHA256_PATTERN, "storage_archive_invalid"),
  });
  const rawObjects = manifest.objects ?? [];
  if (!Array.isArray(rawObjects)) fail("storage_object_manifest_invalid", "artifact_validation");
  if (objectCount > 0 && !Object.hasOwn(manifest, "objects")) {
    fail("storage_object_manifest_missing", "artifact_validation");
  }
  const objects = rawObjects.map((value) => validateObjectEntry(value, bucketIds));
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
    projectRefSha256: sha256Text(projectRef),
    bucketCount,
    publicBucketCount,
    objectCount,
    totalBytes,
    archive,
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
  databaseManifest: ["database-manifest", "EVO_V3_RECOVERY_DATABASE_MANIFEST"],
  migrationLedgerAttestation: [
    "migration-ledger-attestation",
    "EVO_V3_RECOVERY_MIGRATION_LEDGER_ATTESTATION",
  ],
  roles: ["roles", "EVO_V3_RECOVERY_ROLES"],
  schema: ["schema", "EVO_V3_RECOVERY_SCHEMA"],
  data: ["data", "EVO_V3_RECOVERY_DATA"],
  storageManifest: ["storage-manifest", "EVO_V3_RECOVERY_STORAGE_MANIFEST"],
  storageArchive: ["storage-archive", "EVO_V3_RECOVERY_STORAGE_ARCHIVE"],
  ageIdentity: ["age-identity", "EVO_V3_RECOVERY_AGE_IDENTITY"],
  createdAt: ["backup-created-at", "EVO_V3_RECOVERY_BACKUP_CREATED_AT"],
  sourceIdentitySha256: ["source-identity-sha256", "EVO_V3_RECOVERY_SOURCE_IDENTITY_SHA256"],
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
    "databaseManifest",
    "migrationLedgerAttestation",
    "roles",
    "schema",
    "data",
    "storageManifest",
    "storageArchive",
    "ageIdentity",
    "createdAt",
    "sourceIdentitySha256",
    "expectedRepositoryCommit",
  ];
  if (required.some((key) => typeof options[key] !== "string" || options[key].length === 0)) {
    fail("required_argument_missing", "arguments");
  }
  requiredString(options.sourceIdentitySha256, SHA256_PATTERN, "source_identity_sha256_invalid", "arguments");
  requiredString(
    options.expectedRepositoryCommit,
    GIT_OID_PATTERN,
    "expected_repository_commit_invalid",
    "arguments",
  );
  options.createdAt = parseIsoTimestamp(options.createdAt, "backup_created_at_invalid", "arguments").toISOString();
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

async function prepareArtifacts(options, harnessRoot, decryptPayloads) {
  const paths = Object.freeze({
    databaseManifest: assertPrivateRegularFile(options.databaseManifest, { maxBytes: MAX_MANIFEST_BYTES, code: "database_manifest" }),
    migrationLedgerAttestation: assertPrivateRegularFile(options.migrationLedgerAttestation, {
      maxBytes: MAX_MANIFEST_BYTES,
      code: "migration_ledger_attestation",
    }),
    roles: assertPrivateRegularFile(options.roles, { maxBytes: MAX_SQL_BYTES, code: "roles_artifact" }),
    schema: assertPrivateRegularFile(options.schema, { maxBytes: MAX_SQL_BYTES, code: "schema_artifact" }),
    data: assertPrivateRegularFile(options.data, { maxBytes: MAX_SQL_BYTES, code: "data_artifact" }),
    storageManifest: assertPrivateRegularFile(options.storageManifest, { maxBytes: MAX_MANIFEST_BYTES, code: "storage_manifest" }),
    storageArchive: assertPrivateRegularFile(options.storageArchive, { maxBytes: MAX_STORAGE_ARCHIVE_BYTES, code: "storage_archive" }),
    ageIdentity: assertPrivateRegularFile(options.ageIdentity, { maxBytes: 1024 * 1024, code: "age_identity" }),
    evidenceOut: assertEvidenceDestination(options.evidenceOut),
  });
  if (new Set(Object.values(paths).filter(Boolean)).size !== Object.values(paths).filter(Boolean).length) {
    fail("artifact_paths_must_be_distinct", "preflight");
  }

  const decryptedRoot = join(harnessRoot, "decrypted");
  mkdirSync(decryptedRoot, { mode: 0o700 });
  const databaseManifestPath = join(decryptedRoot, "database-manifest.json");
  const migrationLedgerAttestationPath = join(decryptedRoot, "migration-ledger-attestation.json");
  const storageManifestPath = join(decryptedRoot, "storage-manifest.json");
  decryptAge(paths.databaseManifest, databaseManifestPath, paths.ageIdentity);
  decryptAge(paths.migrationLedgerAttestation, migrationLedgerAttestationPath, paths.ageIdentity);
  decryptAge(paths.storageManifest, storageManifestPath, paths.ageIdentity);
  const rawDatabaseManifest = readPrivateJson(databaseManifestPath, "database_manifest_json_invalid");
  const database = validateDatabaseManifest(rawDatabaseManifest, {
    createdAt: options.createdAt,
    sourceIdentitySha256: options.sourceIdentitySha256,
  });
  const migrationLedgerAttestation = validateMigrationLedgerAttestation(
    readPrivateJson(migrationLedgerAttestationPath, "migration_ledger_attestation_json_invalid"),
    {
      databaseCreatedAt: database.createdAt,
      sourceIdentitySha256: options.sourceIdentitySha256,
    },
  );
  const storage = validateStorageManifest(
    readPrivateJson(storageManifestPath, "storage_manifest_json_invalid"),
    {
      databaseCreatedAt: database.createdAt,
      projectRefSha256: sha256Text(rawDatabaseManifest.projectRef),
    },
  );
  const now = new Date();
  const ageHours = checkArtifactAge(database.createdAt, now, options.maxAgeHours);
  const storageAgeHours = checkArtifactAge(storage.createdAt, now, options.maxAgeHours);
  const migrationLedgerAttestationAgeHours = checkArtifactAge(
    migrationLedgerAttestation.createdAt,
    now,
    options.maxAgeHours,
  );
  const captureSpanMinutes = Math.abs(
    new Date(storage.createdAt).valueOf() - new Date(database.createdAt).valueOf(),
  ) / 60_000;
  const ciphertextHashes = {};
  for (const key of [
    "databaseManifest",
    "migrationLedgerAttestation",
    "roles",
    "schema",
    "data",
    "storageManifest",
    "storageArchive",
  ]) {
    ciphertextHashes[key] = await sha256File(paths[key]);
  }
  const plaintext = {};
  if (decryptPayloads) {
    for (const name of SQL_FILES) {
      const key = name === "roles.sql" ? "roles" : name === "schema.sql" ? "schema" : "data";
      const output = join(decryptedRoot, name);
      decryptAge(paths[key], output, paths.ageIdentity);
      await assertPlaintextFile(output, database.files[name], name.replace(".sql", ""));
      plaintext[key] = output;
    }
    const storageArchivePath = join(decryptedRoot, "storage-objects.tar.gz");
    decryptAge(paths.storageArchive, storageArchivePath, paths.ageIdentity);
    await assertPlaintextFile(storageArchivePath, storage.archive, "storage_archive");
    plaintext.storageArchive = storageArchivePath;
  }
  return Object.freeze({
    paths,
    database,
    migrationLedgerAttestation,
    storage,
    plaintext: Object.freeze(plaintext),
    ciphertextHashes: Object.freeze(ciphertextHashes),
    ageHours,
    storageAgeHours,
    migrationLedgerAttestationAgeHours,
    captureSpanMinutes,
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
  while (ports.length < originals.length + 1) {
    const port = await reserveLoopbackPort();
    if (!ports.includes(port)) ports.push(port);
  }
  return Object.freeze({
    replacements: Object.freeze(Object.fromEntries(originals.map((value, index) => [value, ports[index]]))),
    app: ports.at(-1),
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

function parseSupabaseStatus(output) {
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
  const serviceRoleKey = values.SECRET_KEY ?? values.SERVICE_ROLE_KEY;
  if (![apiUrl, dbUrl, publishableKey, serviceRoleKey].every((value) => typeof value === "string" && value.length > 0)) {
    fail("supabase_status_missing_required_value", "local_supabase_start");
  }
  assertLoopbackUrl(apiUrl, "supabase_api_not_loopback");
  assertLoopbackUrl(dbUrl, "supabase_database_not_loopback", ["postgresql:", "postgres:"]);
  return Object.freeze({ apiUrl, dbUrl, publishableKey, serviceRoleKey });
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

export function verifiedAttestedPrefix(root, manifestLedger, attestation) {
  if (
    attestation.source.length !== manifestLedger.count ||
    attestation.source[0]?.version !== manifestLedger.minVersion ||
    attestation.source.at(-1)?.version !== manifestLedger.maxVersion
  ) {
    fail("migration_ledger_attestation_manifest_mismatch", "database_restore");
  }
  const prefix = root.entries.slice(0, attestation.source.length);
  if (
    prefix.length !== attestation.source.length ||
    JSON.stringify(prefix.map(({ version, name }) => ({ version, name }))) !==
      JSON.stringify(attestation.source)
  ) {
    fail("migration_ledger_attestation_root_prefix_mismatch", "database_restore");
  }
  return Object.freeze(prefix);
}

function initializeLocalMigrationLedger(status) {
  // `supabase start` does not create its CLI history table when migrations are
  // disabled for the exact logical restore. Run the official CLI ledger DDL as
  // local `postgres` before seeding the manifest-verified prefix. IF NOT EXISTS
  // deliberately preserves other CLI-owned objects such as `cli_init`.
  psqlScalar(
    status,
    `BEGIN;
     SET LOCAL lock_timeout = '4s';
     CREATE SCHEMA IF NOT EXISTS supabase_migrations;
     CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
       version text NOT NULL PRIMARY KEY
     );
     ALTER TABLE supabase_migrations.schema_migrations
       ADD COLUMN IF NOT EXISTS statements text[];
     ALTER TABLE supabase_migrations.schema_migrations
       ADD COLUMN IF NOT EXISTS name text;
     COMMIT;
     SELECT 'initialized'`,
    "database_restore",
    false,
    "migration_ledger_initialize_failed",
    undefined,
    sanitizeDatabaseCommandDiagnostic,
  );
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
       (SELECT count(*) = 3
          AND count(*) FILTER (
            WHERE column_name = 'version' AND udt_name = 'text' AND is_nullable = 'NO'
          ) = 1
          AND count(*) FILTER (
            WHERE column_name = 'statements' AND udt_name = '_text' AND is_nullable = 'YES'
          ) = 1
          AND count(*) FILTER (
            WHERE column_name = 'name' AND udt_name = 'text' AND is_nullable = 'YES'
          ) = 1
        FROM information_schema.columns
        WHERE table_schema = 'supabase_migrations'
          AND table_name = 'schema_migrations')
       AND
       (SELECT count(*) = 1
          AND count(*) FILTER (WHERE key_column_usage.column_name = 'version') = 1
        FROM information_schema.table_constraints AS table_constraint
        JOIN information_schema.key_column_usage AS key_column_usage
          ON key_column_usage.constraint_catalog = table_constraint.constraint_catalog
         AND key_column_usage.constraint_schema = table_constraint.constraint_schema
         AND key_column_usage.constraint_name = table_constraint.constraint_name
        WHERE table_constraint.table_schema = 'supabase_migrations'
          AND table_constraint.table_name = 'schema_migrations'
          AND table_constraint.constraint_type = 'PRIMARY KEY')
     )::text`,
    "database_restore",
    true,
    "migration_ledger_shape_query_failed",
    undefined,
    sanitizeDatabaseCommandDiagnostic,
  );
  if (shapeIsExact !== "true") fail("migration_ledger_shape_invalid", "database_restore");
}

function reconstructManifestLedger(status, prefix) {
  initializeLocalMigrationLedger(status);
  if (readAppliedMigrationVersions(status, "database_restore").length !== 0) {
    fail("base_migration_ledger_not_empty", "database_restore");
  }
  const values = prefix.map((entry) =>
    `(${sqlLiteral(entry.version)}, ARRAY[]::text[], ${sqlLiteral(entry.name)})`).join(",\n");
  psqlScalar(
    status,
    `INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ${values}; SELECT 'seeded'`,
    "database_restore",
    true,
  );
}

function assertManifestLedger(applied, prefix) {
  if (
    applied.length !== prefix.length ||
    applied.some((version, index) => version !== prefix[index].version)
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

function inspectTarArchive(archivePath, objects) {
  const listed = execute("tar", ["-tzf", archivePath], {
    code: "storage_archive_list_failed",
    stage: "storage_restore",
    timeout: 30 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  }).split(/\r?\n/u).filter(Boolean);
  const harmlessDirectories = listed.filter((entry) => entry === "." || entry === "./" || entry.endsWith("/"));
  for (const entry of harmlessDirectories) {
    if (entry.includes("..") || entry.startsWith("/")) fail("storage_archive_entry_unsafe", "storage_restore");
  }
  const files = listed.filter((entry) => !harmlessDirectories.includes(entry));
  const expected = objects.map((object) => object.archivePath).sort();
  const actual = [...files].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    fail("storage_archive_inventory_mismatch", "storage_restore");
  }
  if (objects.length > 0) {
    const verbose = execute("tar", ["-tvzf", archivePath], {
      code: "storage_archive_types_failed",
      stage: "storage_restore",
      timeout: 30 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    }).split(/\r?\n/u).filter(Boolean);
    const nonDirectories = verbose.filter((line) => !line.startsWith("d"));
    if (nonDirectories.length !== objects.length || nonDirectories.some((line) => !line.startsWith("-"))) {
      fail("storage_archive_non_regular_entry", "storage_restore");
    }
  }
}

function extractOneTarObject(archivePath, object, destination) {
  const fd = openSync(destination, "wx", 0o600);
  try {
    const result = spawnSync("tar", ["-xOzf", archivePath, object.archivePath], {
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
        "content-type": object.contentType,
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
  const metadataAbsent = isRecord(initialInventory) &&
    Number(initialInventory.buckets) === 0 &&
    Number(initialInventory.publicBuckets) === 0 &&
    Number(initialInventory.objects) === 0;
  const metadataRestoredByLogicalDump = isRecord(initialInventory) &&
    Number(initialInventory.buckets) === artifacts.storage.bucketCount &&
    Number(initialInventory.publicBuckets) === artifacts.storage.publicBucketCount &&
    Number(initialInventory.objects) === artifacts.storage.objectCount;
  if (!metadataAbsent && !metadataRestoredByLogicalDump) {
    fail("source_storage_metadata_state_invalid", "storage_restore");
  }
  await ensureBuckets(status, artifacts.storage.buckets, { allowUpdate: false });
  inspectTarArchive(artifacts.plaintext.storageArchive, artifacts.storage.objects);
  const objectRoot = join(workRoot, "storage-object");
  mkdirSync(objectRoot, { mode: 0o700 });
  for (let index = 0; index < artifacts.storage.objects.length; index += 1) {
    const object = artifacts.storage.objects[index];
    const destination = join(objectRoot, `${String(index).padStart(8, "0")}.bin`);
    extractOneTarObject(artifacts.plaintext.storageArchive, object, destination);
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
    metadataMode: metadataRestoredByLogicalDump
      ? "logical_dump_cross_checked_against_storage_manifest"
      : "storage_manifest_reconstructed_metadata",
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

async function createLocalRepresentativeAuthUser(status, specification) {
  const password = `R9!${randomBytes(30).toString("base64url")}`;
  const email = `evo-recovery-${specification.appRole}-${randomBytes(10).toString("hex")}@example.invalid`;
  const response = await storageRequest(
    status,
    new URL("/auth/v1/admin/users", status.apiUrl).toString(),
    {
      method: "POST",
      headers: {
        apikey: status.serviceRoleKey,
        Authorization: `Bearer ${status.serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: specification.displayName },
      }),
    },
    [200, 201],
    "local_representative_auth_create_failed",
    "auth_rls_proof",
  );
  const payload = await response.json().catch(() => null);
  const user = isRecord(payload?.user) ? payload.user : payload;
  if (!isRecord(user) || !UUID_PATTERN.test(user.id)) {
    fail("local_representative_auth_user_invalid", "auth_rls_proof");
  }
  return Object.freeze({
    userId: user.id,
    email,
    password,
    databaseRole: specification.databaseRole,
    appRole: specification.appRole,
    landing: specification.landing,
    provenance: "isolated_local_test_identity",
  });
}

async function provisionLocalRepresentative(status, adminActor, organizationId, specification) {
  const actor = await createLocalRepresentativeAuthUser(status, specification);
  const response = await storageRequest(
    status,
    new URL("/rest/v1/rpc/provision_pilot_staff_member", status.apiUrl).toString(),
    {
      method: "POST",
      headers: {
        apikey: status.publishableKey,
        Authorization: `Bearer ${adminActor.accessToken}`,
        "content-type": "application/json",
        "Content-Profile": "platform",
        "Accept-Profile": "platform",
      },
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_member_auth_user_id: actor.userId,
        p_member_display_name: specification.displayName,
        p_role: specification.databaseRole,
        p_reason: `Provision isolated recovery ${specification.appRole} verification identity`,
        p_request_id: randomUUID(),
      }),
    },
    [200],
    "local_representative_membership_provision_failed",
    "auth_rls_proof",
  );
  await response.arrayBuffer();
  const confirmed = psqlJson(
    status,
    `SELECT coalesce((SELECT row_to_json(candidate) FROM (
      SELECT membership.organization_id AS "organizationId",
             membership.current_role::text AS "databaseRole"
      FROM platform.organization_memberships AS membership
      JOIN platform.profiles AS profile ON profile.id = membership.profile_id
      WHERE profile.auth_user_id = ${sqlLiteral(actor.userId)}
        AND profile.status = 'active'
        AND membership.status = 'active'
    ) AS candidate), 'null'::json)::text`,
    "auth_rls_proof",
  );
  if (
    !isRecord(confirmed) ||
    confirmed.organizationId !== organizationId ||
    confirmed.databaseRole !== specification.databaseRole
  ) {
    fail("local_representative_authority_mismatch", "auth_rls_proof");
  }
  return Object.freeze({ ...actor, organizationId });
}

async function prepareRepresentativeActors(status) {
  const restored = discoverRestoredRepresentativeActors(status);
  const admin = await signInLocalActor(status, await updateLocalPassword(status, restored.admin));
  const specifications = Object.freeze({
    sales: Object.freeze({
      databaseRole: "sales",
      appRole: "sales",
      displayName: "EVO isolated recovery Sales verifier",
      landing: "/v3/main",
    }),
    admissions: Object.freeze({
      databaseRole: "curator",
      appRole: "admissions",
      displayName: "EVO isolated recovery Admissions verifier",
      landing: "/v3/calendar",
    }),
  });
  const actors = { organizationId: restored.organizationId, admin };
  for (const role of ["sales", "admissions"]) {
    const actor = restored[role]
      ? await updateLocalPassword(status, restored[role])
      : await provisionLocalRepresentative(status, admin, restored.organizationId, specifications[role]);
    actors[role] = await signInLocalActor(status, actor);
  }
  actors.evidence = Object.freeze({
    sourceRoleCountsBeforeTestIdentitySetup: restored.restoredRoleCounts,
    provenance: Object.freeze({
      admin: actors.admin.provenance,
      sales: actors.sales.provenance,
      admissions: actors.admissions.provenance,
    }),
  });
  return Object.freeze(actors);
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

async function stopApp(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 10_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function proveV3BrowserAndReadiness(status, actors, appPort, harnessRoot) {
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
        EVO_PLATFORM_SUPABASE_SECRET_KEY: status.serviceRoleKey,
        EVO_PLATFORM_ORGANIZATION_ID: actors.organizationId,
        EVO_PLATFORM_P7A_AUDIT_ENABLED: "1",
        EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
        EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: observabilitySecret,
        EVO_PLATFORM_AI_MEMORY_ENABLED: "0",
        EVO_PLATFORM_STAFF_ASSISTANT_ENABLED: "0",
        EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED: "0",
        EVO_V2_AMOCRM_WRITES_ENABLED: "0",
        EVO_V2_AMOCRM_PROVIDER_AUTHORIZED: "0",
        EVO_ENABLE_EXTERNAL_TRANSCRIPT_IMPROVEMENT: "0",
      }),
      stdio: ["ignore", logFd, logFd],
    },
  );
  let browser;
  try {
    await waitForApp(child, appUrl);
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true });
    for (const actor of [actors.admin, actors.sales, actors.admissions]) {
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
      sales: "passed",
      admissions: "passed",
      readinessStatus: "not_ready",
      supabase: "ready",
      auditAppend: "ready",
      providersBlocked: true,
    });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await stopApp(child);
    closeSync(logFd);
  }
}

function docker(args, options = {}) {
  return execute("docker", ["--context", "orbstack", ...args], {
    ...options,
    stage: options.stage ?? "cleanup",
  });
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

function safeHarnessRoot(path) {
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

function terminationHandler(signal) {
  cleanupActiveState();
  process.exit(signal === "SIGINT" ? 130 : 143);
}

function exitCleanupHandler() {
  cleanupActiveState();
}

function installProcessCleanupHandlers() {
  process.once("SIGINT", () => terminationHandler("SIGINT"));
  process.once("SIGTERM", () => terminationHandler("SIGTERM"));
  process.once("exit", exitCleanupHandler);
}

function writeSanitizedEvidence(path, evidence) {
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
    requiredEncryptedInputs: [
      "database-manifest.json.age",
      "migration-ledger-attestation.json.age",
      "roles.sql.age",
      "schema.sql.age",
      "data.sql.age",
      "storage-manifest.json.age",
      "storage-objects.tar.gz.age",
      "age identity file",
    ],
    requiredRepositoryBinding: "exact_full_commit_and_clean_worktree",
    sourceIdentityDerivation: "sha256(projectRef + newline + region)",
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
    const rootMigrations = rootMigrationEntries();
    const sourceMigrationPrefix = verifiedAttestedPrefix(
      rootMigrations,
      artifacts.database.migrationLedger,
      artifacts.migrationLedgerAttestation,
    );
    result = Object.freeze({
      ok: true,
      status: "preflight_passed",
      proof: "not_run",
      repository,
      sourceIdentitySha256: options.sourceIdentitySha256,
      databaseCreatedAt: artifacts.database.createdAt,
      storageCreatedAt: artifacts.storage.createdAt,
      captureSpanMinutes: Number(artifacts.captureSpanMinutes.toFixed(3)),
      databaseAgeHours: Number(artifacts.ageHours.toFixed(3)),
      storageAgeHours: Number(artifacts.storageAgeHours.toFixed(3)),
      migrationLedgerAttestationAgeHours: Number(
        artifacts.migrationLedgerAttestationAgeHours.toFixed(3),
      ),
      databaseManifestSha256: artifacts.ciphertextHashes.databaseManifest,
      migrationLedgerAttestationSha256: artifacts.ciphertextHashes.migrationLedgerAttestation,
      migrationLedgerSha256: artifacts.migrationLedgerAttestation.ledgerSha256,
      migrationLedgerRepositoryPrefix: {
        status: "passed",
        count: sourceMigrationPrefix.length,
        recordedHistoryValidatedCount: rootMigrations.recordedHistoryCount,
      },
      storageManifestSha256: artifacts.ciphertextHashes.storageManifest,
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
    const rootMigrations = rootMigrationEntries();
    const sourceMigrationPrefix = verifiedAttestedPrefix(
      rootMigrations,
      artifacts.database.migrationLedger,
      artifacts.migrationLedgerAttestation,
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
    reconstructManifestLedger(status, sourceMigrationPrefix);
    const restoredLedger = readAppliedMigrationVersions(status, "database_restore");
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
    const finalLedger = assertExactRootLedger(readAppliedMigrationVersions(status), rootMigrations);
    verifyPgmqQueueRows(status, pgmqQueues);
    const aggregatesAfter = readAggregates(status, true);
    assertNonDecreasingAggregates(aggregatesBefore, aggregatesAfter);

    const v3Storage = await establishV3PrivateStorage(status, artifacts.storage.buckets);
    const actors = await prepareRepresentativeActors(status);
    const rls = await proveSameAndCrossOrganizationRls(status, actors.admin);
    const storagePrivacy = await provePrivateStorage(
      status,
      v3Storage.buckets,
      artifacts.storage.objectCount,
      actors.sales,
    );
    const browser = await proveV3BrowserAndReadiness(status, actors, portMap.app, harnessRoot);

    evidence = {
      schema: RESULT_SCHEMA,
      ok: true,
      status: "passed",
      repository,
      source: {
        identitySha256: options.sourceIdentitySha256,
        databaseCreatedAt: artifacts.database.createdAt,
        storageCreatedAt: artifacts.storage.createdAt,
        captureSpanMinutes: Number(artifacts.captureSpanMinutes.toFixed(3)),
        databaseAgeHours: Number(artifacts.ageHours.toFixed(3)),
        storageAgeHours: Number(artifacts.storageAgeHours.toFixed(3)),
        databaseManifestSha256: artifacts.ciphertextHashes.databaseManifest,
        migrationLedgerAttestationSha256:
          artifacts.ciphertextHashes.migrationLedgerAttestation,
        migrationLedgerAttestationCreatedAt: artifacts.migrationLedgerAttestation.createdAt,
        migrationLedgerSha256: artifacts.migrationLedgerAttestation.ledgerSha256,
        storageManifestSha256: artifacts.ciphertextHashes.storageManifest,
        encryptedLogicalSetSha256: sha256Text([
          artifacts.ciphertextHashes.roles,
          artifacts.ciphertextHashes.schema,
          artifacts.ciphertextHashes.data,
        ].join("\n")),
        encryptedStorageArchiveSha256: artifacts.ciphertextHashes.storageArchive,
      },
      database: {
        restore: "passed",
        localDatabaseMajor,
        sourceLedger: artifacts.database.migrationLedger,
        ledgerReconstruction: {
          mode: "verified_exact_root_prefix",
          seededCount: sourceMigrationPrefix.length,
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
        admin: "passed",
        sales: "passed",
        admissions: "passed",
        actors: actors.evidence,
        ...rls,
      },
      application: browser,
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
