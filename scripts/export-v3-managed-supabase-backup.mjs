#!/usr/bin/env node

/**
 * Read-only #551 managed-Supabase backup exporter.
 *
 * The command never links, migrates, restores, uploads, deletes, or changes a
 * provider project. It binds one authenticated Management API receipt to
 * encrypted logical database/Auth artifacts and a separately captured Storage
 * byte archive. Only the redacted signed receipt is safe to publish.
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  readSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OPT_IN = "EVO_RUN_V3_MANAGED_SUPABASE_EXPORT";
const OPT_IN_VALUE = "1";
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const AGE_RECIPIENT = /^age1[023456789acdefghjklmnpqrstuvwxyz]{20,}$/u;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const MAX_MANAGEMENT_BYTES = 2 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 16 * 1024;
const MAX_PROVIDER_BACKUP_AGE_MS = 48 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const COMMAND_KILL_GRACE_MS = 2_000;
const SNAPSHOT_HOLDER_TIMEOUT_MS = 35 * 60 * 1000;
const SNAPSHOT_OUTPUT_PREFIX = "EVO_SYNC_SNAPSHOT:";
const SNAPSHOT_ID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[1-9][0-9]*$/u;
const STORAGE_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const STORAGE_PAGE_SIZE = 100;
const MAX_STORAGE_PAGES = 100_000;
const MAX_STORAGE_OBJECTS = 1_000_000;
const MAX_STORAGE_OBJECT_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_STORAGE_TOTAL_BYTES = 500 * 1024 * 1024 * 1024;
const DATABASE_SCHEMA = "evo-v3-managed-supabase-logical-backup/v1";
const STORAGE_SCHEMA = "evo-v3-managed-supabase-storage-backup/v1";
const RECEIPT_SCHEMA = "evo-v3-managed-supabase-export-receipt/v1";
const SIGNATURE_NAMESPACE = "evo-v3-managed-supabase-recovery";
const SIGNATURE_IDENTITY = "evo-v3-managed-supabase-export";
const RUN_MARKER = ".evo-v3-managed-supabase-export";
const NORMALIZED_PSQL_GUARD = "evo_semantic_digest_guard".padEnd(63, "0");
const PROCESS_GROUP_DRAIN_POLL_MS = 20;
const SUPABASE_DATABASE_CA_SHA256 = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
const SUPABASE_DATABASE_CA_FINGERPRINT = "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";
const SUPABASE_CLI_PACKAGES = Object.freeze({
  darwin: Object.freeze({ arm64: Object.freeze(["darwin-arm64"]), x64: Object.freeze(["darwin-x64"]) }),
  linux: Object.freeze({
    arm64: Object.freeze(["linux-arm64", "linux-arm64-musl"]),
    x64: Object.freeze(["linux-x64", "linux-x64-musl"]),
  }),
});
const SUPABASE_INTERNAL_SCHEMAS = Object.freeze([
  "information_schema", "pg_*", "_analytics", "_realtime", "_supavisor", "auth",
  "etl", "extensions", "pgbouncer", "realtime", "storage", "supabase_functions",
  "supabase_migrations", "cron", "dbdev", "graphql", "graphql_public", "net", "pgmq",
  "pgsodium", "pgsodium_masks", "pgtle", "repack", "tiger", "tiger_data",
  "timescaledb_*", "_timescaledb_*", "topology", "vault",
]);
const SUPABASE_DATA_EXCLUDED_SCHEMAS = Object.freeze([
  "information_schema", "pg_*", "graphql", "graphql_public", "pgsodium",
  "pgsodium_masks", "pgtle", "repack", "tiger", "tiger_data", "timescaledb_*",
  "_timescaledb_*", "topology", "vault", "etl", "extensions", "pgbouncer", "realtime",
  "supabase_migrations", "_analytics", "_realtime", "_supavisor",
]);
const SUPABASE_RESERVED_ROLES = Object.freeze([
  "anon", "authenticated", "authenticator", "cli_login_.*", "dashboard_user", "pgbouncer",
  "postgres", "service_role", "supabase_.*", "pgsodium_keyholder", "pgsodium_keyiduser",
  "pgsodium_keymaker", "pgtle_admin",
]);
const SUPABASE_ALLOWED_CONFIGS = Object.freeze([
  "pgaudit.*", "pgrst.*", "session_replication_role", "statement_timeout", "track_io_timing",
]);
const REQUIRED_SECRET_NAMES = Object.freeze([
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY",
  "EVO_PLATFORM_SUPABASE_SECRET_KEY",
]);
const EXPECTED_ARTIFACTS = Object.freeze([
  "roles.sql",
  "schema.sql",
  "data.sql",
  "history-schema.sql",
  "history-data.sql",
]);

export class ManagedSupabaseExportError extends Error {
  constructor(code) {
    super(code);
    this.name = "ManagedSupabaseExportError";
    this.code = code;
  }
}

function fail(code) {
  throw new ManagedSupabaseExportError(code);
}

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

function requiredString(value, code, maxLength = 4_096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    fail(code);
  }
  return value;
}

function requireExactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code);
  }
}

function isInside(root, candidate) {
  const relation = relative(root, candidate);
  return (
    relation !== "" &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function canonicalExistingPath(path, code) {
  requiredString(path, code);
  if (!isAbsolute(path)) fail(code);
  let canonical;
  try {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) fail(code);
    canonical = realpathSync(path);
  } catch (error) {
    if (error instanceof ManagedSupabaseExportError) throw error;
    fail(code);
  }
  if (canonical !== resolve(path)) fail(code);
  return canonical;
}

export function validateOutputRoot(path, forbiddenRoot = process.cwd()) {
  const canonical = canonicalExistingPath(path, "output_root_invalid");
  const metadata = statSync(canonical);
  if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0) fail("output_root_invalid");
  const forbidden = realpathSync(forbiddenRoot);
  if (
    canonical === "/" ||
    canonical === resolve(process.env.HOME ?? "/nonexistent") ||
    canonical === forbidden ||
    isInside(forbidden, canonical) ||
    isInside(canonical, forbidden)
  ) {
    fail("output_root_forbidden");
  }
  return canonical;
}

export function validateOperatorHome(path) {
  const canonical = canonicalExistingPath(path, "operator_home_invalid");
  const metadata = statSync(canonical);
  if (
    !metadata.isDirectory() ||
    typeof process.getuid !== "function" ||
    metadata.uid !== process.getuid() ||
    (metadata.mode & 0o022) !== 0
  ) {
    fail("operator_home_invalid");
  }
  return canonical;
}

function validateSigningKey(path, trustedPublicKeyPath, outputRoot, repositoryRoot) {
  const canonical = canonicalExistingPath(path, "signing_key_invalid");
  const metadata = statSync(canonical);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) fail("signing_key_invalid");
  const canonicalPublic = canonicalExistingPath(
    trustedPublicKeyPath,
    "signing_public_key_invalid",
  );
  const publicMetadata = statSync(canonicalPublic);
  if (!publicMetadata.isFile() || (publicMetadata.mode & 0o022) !== 0) {
    fail("signing_public_key_invalid");
  }
  for (const candidate of [canonical, canonicalPublic]) {
    if (
      candidate === outputRoot ||
      candidate === repositoryRoot ||
      isInside(outputRoot, candidate) ||
      isInside(repositoryRoot, candidate)
    ) {
      fail("signing_trust_root_invalid");
    }
  }
  return Object.freeze({ privateKey: canonical, publicKey: canonicalPublic });
}

export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) fail("arguments_invalid");
  const command = argv[0];
  if (!new Set(["preflight", "run"]).has(command)) fail("command_invalid");
  const values = new Map();
  const allowed = new Set([
    "--project-ref",
    "--output-root",
    "--age-recipient",
    "--signing-key",
    "--trusted-public-key",
  ]);
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || values.has(name)) {
      fail("arguments_invalid");
    }
    values.set(name, value);
  }
  if (values.size !== allowed.size || argv.length !== 1 + allowed.size * 2) {
    fail("arguments_invalid");
  }
  const projectRef = requiredString(values.get("--project-ref"), "project_ref_invalid");
  if (!PROJECT_REF.test(projectRef)) fail("project_ref_invalid");
  const ageRecipient = requiredString(values.get("--age-recipient"), "age_recipient_invalid");
  if (!AGE_RECIPIENT.test(ageRecipient)) fail("age_recipient_invalid");
  return Object.freeze({
    command,
    projectRef,
    outputRoot: values.get("--output-root"),
    ageRecipient,
    signingKey: values.get("--signing-key"),
    trustedPublicKey: values.get("--trusted-public-key"),
  });
}

function requireSecrets(environment) {
  const result = {};
  for (const name of REQUIRED_SECRET_NAMES) {
    result[name] = requiredString(environment[name], "required_secret_missing", 16_384);
  }
  if (!isSupabasePublishableKey(result.EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY)) {
    fail("publishable_key_invalid");
  }
  if (!isSupabaseSecretKey(result.EVO_PLATFORM_SUPABASE_SECRET_KEY)) {
    fail("secret_key_invalid");
  }
  return Object.freeze(result);
}

function jwtRole(value) {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function isSupabasePublishableKey(value) {
  return /^sb_publishable_[A-Za-z0-9_-]+$/u.test(value) || jwtRole(value) === "anon";
}

function isSupabaseSecretKey(value) {
  return /^sb_secret_[A-Za-z0-9_-]{16,}$/u.test(value) || jwtRole(value) === "service_role";
}

export function storageDownloadHeaders(secretKey) {
  if (!isSupabaseSecretKey(secretKey)) fail("secret_key_invalid");
  return Object.freeze({
    "Accept-Encoding": "identity",
    apikey: secretKey,
    ...(jwtRole(secretKey) === "service_role"
      ? { Authorization: `Bearer ${secretKey}` }
      : {}),
  });
}

export function storageClientHeaders(inputHeaders, secretKey) {
  if (!isSupabaseSecretKey(secretKey)) fail("secret_key_invalid");
  const headers = new Headers(inputHeaders);
  headers.set("apikey", secretKey);
  if (jwtRole(secretKey) === "service_role") {
    headers.set("Authorization", `Bearer ${secretKey}`);
  } else if (headers.get("Authorization") === `Bearer ${secretKey}`) {
    headers.delete("Authorization");
  }
  return headers;
}

function validatedStorageOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("storage_origin_invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^[a-z0-9]{20}\.supabase\.co$/u.test(parsed.hostname)
  ) {
    fail("storage_origin_invalid");
  }
  return parsed.origin;
}

function assertStorageRequestOrigin(input, origin) {
  let parsed;
  try {
    parsed = new URL(input instanceof Request ? input.url : input);
  } catch {
    fail("storage_origin_invalid");
  }
  if (parsed.origin !== origin || parsed.username !== "" || parsed.password !== "") {
    fail("storage_origin_invalid");
  }
}

export function createStorageClientFetch(origin, secretKey, signal, fetchImpl = fetch) {
  const allowedOrigin = validatedStorageOrigin(origin);
  return (url, options = {}) => {
    assertStorageRequestOrigin(url, allowedOrigin);
    return fetchImpl(url, {
      ...options,
      redirect: "error",
      headers: storageClientHeaders(options.headers, secretKey),
      signal: combineSignals(signal, REQUEST_TIMEOUT_MS),
    });
  };
}

function isoTimestamp(value, code) {
  const timestamp = new Date(requiredString(value, code, 128));
  if (!Number.isFinite(timestamp.valueOf())) fail(code);
  return timestamp.toISOString();
}

export function normalizeProjectReceipt(project, expectedRef) {
  if (!PROJECT_REF.test(expectedRef)) fail("project_ref_invalid");
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    fail("management_project_invalid");
  }
  const database = project.database;
  if (!database || typeof database !== "object" || Array.isArray(database)) {
    fail("management_project_invalid");
  }
  const ref = requiredString(project.id, "management_project_invalid", 128);
  const host = requiredString(database.host, "management_project_invalid", 512);
  if (ref !== expectedRef || host !== `db.${expectedRef}.supabase.co`) {
    fail("management_project_mismatch");
  }
  if (project.status !== "ACTIVE_HEALTHY") fail("management_project_not_healthy");
  const postgresEngine = requiredString(
    database.postgres_engine,
    "management_project_invalid",
    32,
  );
  if (!/^\d+$/u.test(postgresEngine)) fail("management_project_invalid");
  const region = requiredString(project.region, "management_project_invalid", 128);
  if (!/^[a-z0-9-]+$/u.test(region)) fail("management_project_invalid");
  return Object.freeze({
    ref,
    organization_id: requiredString(
      project.organization_id,
      "management_project_invalid",
      256,
    ),
    name: requiredString(project.name, "management_project_invalid", 512),
    region,
    created_at: isoTimestamp(project.created_at, "management_project_invalid"),
    status: "ACTIVE_HEALTHY",
    database: Object.freeze({
      host,
      version: requiredString(database.version, "management_project_invalid", 128),
      postgres_engine: postgresEngine,
      release_channel: requiredString(
        database.release_channel,
        "management_project_invalid",
        128,
      ),
    }),
  });
}

export function normalizePoolerReceipt(payload, project) {
  if (!Array.isArray(payload)) fail("management_pooler_invalid");
  const matches = payload.filter((candidate) =>
    candidate?.identifier === project.ref && candidate?.database_type === "PRIMARY");
  if (matches.length !== 1) fail("management_pooler_invalid");
  const pooler = matches[0];
  const host = requiredString(pooler.db_host, "management_pooler_invalid", 512);
  const expectedHost = new RegExp(
    `^aws-[0-9]+-${project.region}\\.pooler\\.supabase\\.com$`,
    "u",
  );
  if (
    !expectedHost.test(host) ||
    pooler.db_user !== `postgres.${project.ref}` ||
    pooler.db_name !== "postgres" ||
    pooler.pool_mode !== "transaction" ||
    pooler.db_port !== 6543
  ) {
    fail("management_pooler_invalid");
  }
  return Object.freeze({
    host,
    user: `postgres.${project.ref}`,
    database: "postgres",
    session_port: 5432,
    source_mode: "transaction",
    source_port: 6543,
  });
}

function normalizedBackupId(value) {
  if (typeof value === "string") {
    return requiredString(value, "provider_backup_receipt_invalid", 512);
  }
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  fail("provider_backup_receipt_invalid");
}

export function selectLatestCompletedBackup(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.backups)) {
    fail("provider_backup_receipt_invalid");
  }
  const completed = payload.backups
    .filter((backup) => backup?.status === "COMPLETED")
    .map((backup) => ({
      id: normalizedBackupId(backup.id),
      inserted_at: isoTimestamp(backup.inserted_at, "provider_backup_receipt_invalid"),
      is_physical_backup: backup.is_physical_backup === true,
      status: "COMPLETED",
    }))
    .sort((left, right) => right.inserted_at.localeCompare(left.inserted_at, "en"));
  if (completed.length === 0) fail("provider_backup_missing");
  const selected = completed[0];
  const ageMs = nowMs - Date.parse(selected.inserted_at);
  if (ageMs < 0 || ageMs > MAX_PROVIDER_BACKUP_AGE_MS) fail("provider_backup_stale");
  return Object.freeze(selected);
}

function splitLinesPreservingFinal(text) {
  return text.replace(/\r\n/gu, "\n").split("\n");
}

export function parseCopySections(text) {
  if (typeof text !== "string" || text.includes("\0")) fail("copy_dump_invalid");
  const lines = splitLinesPreservingFinal(text);
  const sections = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const match = /^COPY ([^\s(]+) \((.+)\) FROM stdin;$/u.exec(header);
    if (!match) continue;
    const rows = [];
    index += 1;
    while (index < lines.length && lines[index] !== "\\.") {
      rows.push(lines[index]);
      index += 1;
    }
    if (index >= lines.length) fail("copy_dump_invalid");
    sections.push(Object.freeze({
      table: match[1].replaceAll('"', ""),
      columns: match[2],
      rows: Object.freeze(rows),
      raw_sha256: sha256(`${header}\n${rows.join("\n")}\n\\.\n`),
    }));
  }
  return Object.freeze(sections);
}

export function exactMigrationLedger(text) {
  const matches = parseCopySections(text).filter(
    (section) => section.table === "supabase_migrations.schema_migrations",
  );
  if (matches.length !== 1 || matches[0].rows.length === 0) fail("migration_ledger_invalid");
  const section = matches[0];
  const columns = section.columns.split(",").map((column) => column.trim().replaceAll('"', ""));
  const versionIndex = columns.indexOf("version");
  const nameIndex = columns.indexOf("name");
  const statementsIndex = columns.indexOf("statements");
  if (versionIndex < 0 || nameIndex < 0 || statementsIndex < 0) {
    fail("migration_ledger_invalid");
  }
  const versions = section.rows.map((row) => {
    const cells = row.split("\t");
    const version = cells[versionIndex];
    if (!/^\d+$/u.test(version) || cells[nameIndex] == null || cells[statementsIndex] == null) {
      fail("migration_ledger_invalid");
    }
    return version;
  });
  for (let index = 1; index < versions.length; index += 1) {
    if (versions[index - 1].localeCompare(versions[index], "en") >= 0) {
      fail("migration_ledger_invalid");
    }
  }
  return Object.freeze({
    count: versions.length,
    min_version: versions[0],
    max_version: versions.at(-1),
    copy_rows_sha256: section.raw_sha256,
  });
}

export function dataRowAggregates(text) {
  const counts = {};
  for (const section of parseCopySections(text)) {
    if (Object.hasOwn(counts, section.table)) fail("copy_dump_duplicate_table");
    counts[section.table] = section.rows.length;
  }
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, "en"));
  return Object.freeze({
    table_count: entries.length,
    row_count: entries.reduce((total, [, count]) => total + count, 0),
    auth_user_count: counts["auth.users"] ?? 0,
    storage_bucket_row_count: counts["storage.buckets"] ?? 0,
    storage_object_row_count: counts["storage.objects"] ?? 0,
    table_counts_sha256: sha256(canonicalJson(Object.fromEntries(entries))),
  });
}

function normalizedStorageMetadata(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) fail("storage_inventory_invalid");
  return canonicalValue(value);
}

function normalizedBucket(bucket) {
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
    fail("storage_inventory_invalid");
  }
  const id = requiredString(bucket.id, "storage_inventory_invalid", 1_024);
  if (id.includes("\0")) fail("storage_inventory_invalid");
  if (typeof bucket.public !== "boolean") fail("storage_inventory_invalid");
  if (bucket.allowed_mime_types != null && !Array.isArray(bucket.allowed_mime_types)) {
    fail("storage_inventory_invalid");
  }
  const fileSizeLimit = bucket.file_size_limit == null ? null : Number(bucket.file_size_limit);
  if (fileSizeLimit != null && (!Number.isSafeInteger(fileSizeLimit) || fileSizeLimit < 0)) {
    fail("storage_inventory_invalid");
  }
  return Object.freeze({
    id,
    name: requiredString(bucket.name, "storage_inventory_invalid", 1_024),
    public: bucket.public === true,
    file_size_limit: fileSizeLimit,
    allowed_mime_types:
      bucket.allowed_mime_types == null
        ? null
        : [...bucket.allowed_mime_types].map((item) => String(item)).sort(),
    created_at: bucket.created_at == null ? null : String(bucket.created_at),
    updated_at: bucket.updated_at == null ? null : String(bucket.updated_at),
  });
}

function normalizedStorageObject(bucketId, path, item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    fail("storage_inventory_invalid");
  }
  requiredString(path, "storage_inventory_invalid", 8_192);
  if (path.startsWith("/") || path.includes("\0")) fail("storage_inventory_invalid");
  const metadata = normalizedStorageMetadata(item.metadata);
  if (!metadata || !Object.hasOwn(metadata, "size")) fail("storage_object_size_invalid");
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_STORAGE_OBJECT_BYTES) {
    fail("storage_object_size_invalid");
  }
  return Object.freeze({
    bucket_id: bucketId,
    path,
    id: requiredString(item.id, "storage_inventory_invalid", 1_024),
    version: item.version == null ? null : String(item.version),
    created_at: item.created_at == null ? null : String(item.created_at),
    updated_at: item.updated_at == null ? null : String(item.updated_at),
    metadata,
    user_metadata: normalizedStorageMetadata(item.user_metadata),
    size,
  });
}

export function storageInventoryDigest(inventory) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    fail("storage_inventory_invalid");
  }
  const buckets = [...inventory.buckets].map(normalizedBucket).sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );
  const objects = [...inventory.objects]
    .map((item) => normalizedStorageObject(item.bucket_id, item.path, item))
    .sort((left, right) =>
      `${left.bucket_id}\0${left.path}`.localeCompare(
        `${right.bucket_id}\0${right.path}`,
        "en",
      ),
    );
  const seen = new Set();
  const bucketIds = new Set();
  for (const bucket of buckets) {
    if (bucketIds.has(bucket.id)) fail("storage_inventory_duplicate_bucket");
    bucketIds.add(bucket.id);
  }
  let totalBytes = 0;
  for (const item of objects) {
    const key = `${item.bucket_id}\0${item.path}`;
    if (seen.has(key)) fail("storage_inventory_duplicate_object");
    if (!bucketIds.has(item.bucket_id)) fail("storage_inventory_invalid");
    seen.add(key);
    totalBytes += item.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_STORAGE_TOTAL_BYTES) {
      fail("storage_inventory_too_large");
    }
  }
  if (objects.length > MAX_STORAGE_OBJECTS) fail("storage_inventory_too_large");
  const normalized = Object.freeze({ buckets: Object.freeze(buckets), objects: Object.freeze(objects) });
  return Object.freeze({
    normalized,
    sha256: sha256(canonicalJson(normalized)),
    bucket_count: buckets.length,
    public_bucket_count: buckets.filter((bucket) => bucket.public).length,
    private_bucket_count: buckets.filter((bucket) => !bucket.public).length,
    object_count: objects.length,
    total_bytes: totalBytes,
  });
}

function artifactMetadata(path, { allowEmpty = false } = {}) {
  const metadata = statSync(path);
  if (!metadata.isFile() || (!allowEmpty && metadata.size <= 0)) fail("artifact_invalid");
  const digest = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return Object.freeze({
    bytes: metadata.size,
    sha256: digest.digest("hex"),
  });
}

async function analyzeCopyDumpFile(path, requireLedger = false) {
  const counts = {};
  const sectionHashes = {};
  let current = null;
  let ledger = null;
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (current) {
        if (line === "\\.") {
          current.hash.update("\\.\n");
          if (Object.hasOwn(counts, current.table)) fail("copy_dump_duplicate_table");
          counts[current.table] = current.count;
          const sectionHash = current.hash.digest("hex");
          sectionHashes[current.table] = sectionHash;
          if (current.table === "supabase_migrations.schema_migrations") {
            if (ledger || current.count === 0) fail("migration_ledger_invalid");
            ledger = Object.freeze({
              count: current.count,
              min_version: current.minVersion,
              max_version: current.maxVersion,
              copy_rows_sha256: sectionHash,
            });
          }
          current = null;
          continue;
        }
        current.hash.update(`${line}\n`);
        current.count += 1;
        if (current.table === "supabase_migrations.schema_migrations") {
          const cells = line.split("\t");
          const version = cells[current.versionIndex];
          if (
            !/^\d+$/u.test(version) ||
            cells[current.nameIndex] == null ||
            cells[current.statementsIndex] == null ||
            (current.maxVersion != null && current.maxVersion.localeCompare(version, "en") >= 0)
          ) {
            fail("migration_ledger_invalid");
          }
          current.minVersion ??= version;
          current.maxVersion = version;
        }
        continue;
      }
      const match = /^COPY ([^\s(]+) \((.+)\) FROM stdin;$/u.exec(line);
      if (!match) continue;
      const table = match[1].replaceAll('"', "");
      const columns = match[2].split(",").map((column) => column.trim().replaceAll('"', ""));
      current = {
        table,
        count: 0,
        hash: createHash("sha256").update(`${line}\n`),
        versionIndex: columns.indexOf("version"),
        nameIndex: columns.indexOf("name"),
        statementsIndex: columns.indexOf("statements"),
        minVersion: null,
        maxVersion: null,
      };
      if (
        table === "supabase_migrations.schema_migrations" &&
        (current.versionIndex < 0 || current.nameIndex < 0 || current.statementsIndex < 0)
      ) {
        fail("migration_ledger_invalid");
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (current) fail("copy_dump_invalid");
  if (requireLedger && !ledger) fail("migration_ledger_invalid");
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, "en"));
  return Object.freeze({
    ledger,
    copy_sections_sha256: sha256(
      canonicalJson(
        Object.fromEntries(
          Object.entries(sectionHashes).sort(([left], [right]) => left.localeCompare(right, "en")),
        ),
      ),
    ),
    aggregates: Object.freeze({
      table_count: entries.length,
      row_count: entries.reduce((total, [, count]) => total + count, 0),
      auth_user_count: counts["auth.users"] ?? 0,
      storage_bucket_row_count: counts["storage.buckets"] ?? 0,
      storage_object_row_count: counts["storage.objects"] ?? 0,
      table_counts_sha256: sha256(canonicalJson(Object.fromEntries(entries))),
    }),
  });
}

function readExactFileSlice(path, start, length) {
  const descriptor = openSync(path, "r");
  const buffer = Buffer.alloc(length);
  let offset = 0;
  try {
    while (offset < length) {
      const bytesRead = readSync(descriptor, buffer, offset, length - offset, start + offset);
      if (bytesRead === 0) fail("dump_guard_envelope_invalid");
      offset += bytesRead;
    }
  } finally {
    closeSync(descriptor);
  }
  return buffer;
}

function isGuardToken(buffer) {
  return buffer.length === 63 && buffer.every((byte) =>
    (byte >= 48 && byte <= 57) ||
    (byte >= 65 && byte <= 90) ||
    (byte >= 97 && byte <= 122));
}

async function updateDigestFromRange(digest, path, start, endExclusive) {
  if (endExclusive <= start) return;
  const input = createReadStream(path, { start, end: endExclusive - 1 });
  try {
    for await (const chunk of input) digest.update(chunk);
  } finally {
    input.destroy();
  }
}

export async function semanticSqlFileDigest(path, artifactName = basename(path)) {
  const digest = createHash("sha256");
  const envelope = new Map([
    ["data.sql", Object.freeze({
      opening: "SET session_replication_role = replica;\n\n--\n-- PostgreSQL database dump\n--\n\n\\restrict ",
      openingTail: "\n\n",
      closing: "--\n-- PostgreSQL database dump complete\n--\n\n\\unrestrict ",
      closingTail: "\n\nRESET ALL;\n",
    })],
    ["history-data.sql", Object.freeze({
      opening: "SET session_replication_role = replica;\n\n--\n-- PostgreSQL database dump\n--\n\n\\restrict ",
      openingTail: "\n\n",
      closing: "--\n-- PostgreSQL database dump complete\n--\n\n\\unrestrict ",
      closingTail: "\n\nRESET ALL;\n",
    })],
    ["schema.sql", Object.freeze({
      opening: "\n\\restrict ",
      openingTail: "\n\n",
      closing: "\\unrestrict ",
      closingTail: "\n\n",
    })],
    ["history-schema.sql", Object.freeze({
      opening: "\n\\restrict ",
      openingTail: "\n\n",
      closing: "\\unrestrict ",
      closingTail: "\n\n",
    })],
    ["roles.sql", Object.freeze({
      opening: "\n\\restrict ",
      openingTail: "\n\n",
      closing: "\\unrestrict ",
      closingTail: "\n\nRESET ALL;\n",
    })],
  ]).get(artifactName);
  if (!envelope) {
    await updateDigestFromRange(digest, path, 0, statSync(path).size);
    return digest.digest("hex");
  }

  const opening = Buffer.from(envelope.opening);
  const openingTail = Buffer.from(envelope.openingTail);
  const closing = Buffer.from(envelope.closing);
  const closingTail = Buffer.from(envelope.closingTail);
  const tokenBytes = 63;
  const size = statSync(path).size;
  const openingLength = opening.length + tokenBytes + openingTail.length;
  const closingLength = closing.length + tokenBytes + closingTail.length;
  if (size < openingLength + closingLength) fail("dump_guard_envelope_invalid");

  const openingSlice = readExactFileSlice(path, 0, openingLength);
  const openingToken = openingSlice.subarray(opening.length, opening.length + tokenBytes);
  if (
    !openingSlice.subarray(0, opening.length).equals(opening) ||
    !openingSlice.subarray(opening.length + tokenBytes).equals(openingTail) ||
    !isGuardToken(openingToken)
  ) {
    fail("dump_guard_envelope_invalid");
  }

  const closingStart = size - closingLength;
  const closingSlice = readExactFileSlice(path, closingStart, closingLength);
  const closingToken = closingSlice.subarray(closing.length, closing.length + tokenBytes);
  if (
    !closingSlice.subarray(0, closing.length).equals(closing) ||
    !closingSlice.subarray(closing.length + tokenBytes).equals(closingTail) ||
    !isGuardToken(closingToken) ||
    !openingToken.equals(closingToken)
  ) {
    fail("dump_guard_envelope_invalid");
  }

  const normalizedToken = Buffer.from(NORMALIZED_PSQL_GUARD);
  await updateDigestFromRange(digest, path, 0, opening.length);
  digest.update(normalizedToken);
  await updateDigestFromRange(
    digest,
    path,
    opening.length + tokenBytes,
    closingStart + closing.length,
  );
  digest.update(normalizedToken);
  await updateDigestFromRange(digest, path, closingStart + closing.length + tokenBytes, size);
  return digest.digest("hex");
}

function sanitizedText(value) {
  return JSON.stringify(value).toLowerCase();
}

export function assertRedactedReceipt(receipt) {
  requireExactKeys(
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
  const text = sanitizedText(receipt);
  for (const forbidden of [
    "access_token",
    "db_password",
    "secret_key",
    "publishable_key",
    "authorization",
    "service_role",
    "customer",
    "object_path",
    "object_name",
    "email",
    "phone",
    "connection_string",
  ]) {
    if (text.includes(forbidden)) fail("receipt_contains_sensitive_material");
  }
  if (receipt.schema !== RECEIPT_SCHEMA || receipt.result !== "export_verified") {
    fail("receipt_shape_invalid");
  }
  requireExactKeys(
    receipt.signature,
    ["namespace", "identity", "public_key_fingerprint", "trust_root"],
    "receipt_shape_invalid",
  );
  if (
    receipt.signature.namespace !== SIGNATURE_NAMESPACE ||
    receipt.signature.identity !== SIGNATURE_IDENTITY ||
    receipt.signature.trust_root !== "operator-held-external-public-key" ||
    !/^SHA256:[A-Za-z0-9+/]+$/u.test(receipt.signature.public_key_fingerprint)
  ) {
    fail("receipt_shape_invalid");
  }
  if (!SHA256.test(receipt.source.identity_sha256)) fail("receipt_shape_invalid");
  for (const artifact of Object.values(receipt.encrypted_artifacts)) {
    requireExactKeys(artifact, ["bytes", "sha256"], "receipt_shape_invalid");
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || !SHA256.test(artifact.sha256)) {
      fail("receipt_shape_invalid");
    }
  }
  return Object.freeze(receipt);
}

function combineSignals(outerSignal, timeoutMs) {
  return AbortSignal.any([outerSignal, AbortSignal.timeout(timeoutMs)]);
}

async function fetchJson(url, options, code, outerSignal) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: combineSignals(outerSignal, REQUEST_TIMEOUT_MS),
    });
  } catch {
    fail(code);
  }
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // Response bodies are never logged by this command.
    }
    fail(code);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_MANAGEMENT_BYTES) fail(code);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_MANAGEMENT_BYTES) fail(code);
  try {
    return JSON.parse(text);
  } catch {
    fail(code);
  }
}

function limitedCollector(limit = MAX_CAPTURE_BYTES) {
  const chunks = [];
  let bytes = 0;
  return Object.freeze({
    push(chunk) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limit) fail("command_output_too_large");
      chunks.push(buffer);
    },
    value() {
      return Buffer.concat(chunks).toString("utf8");
    },
  });
}

export function spawnCommand(command, args, {
  cwd,
  environment,
  argv0,
  signal,
  input = null,
  captureStdout = false,
  stdoutPath = null,
  code = "command_failed",
  timeoutMs = COMMAND_TIMEOUT_MS,
  killGraceMs = COMMAND_KILL_GRACE_MS,
  state,
} = {}) {
  return new Promise((accept, reject) => {
    if (!environment || typeof environment !== "object") {
      reject(new ManagedSupabaseExportError("command_environment_required"));
      return;
    }
    if (signal?.aborted) {
      reject(new ManagedSupabaseExportError("export_interrupted"));
      return;
    }
    if (process.platform === "win32") {
      reject(new ManagedSupabaseExportError("process_group_unsupported"));
      return;
    }
    if (captureStdout && stdoutPath != null) {
      reject(new ManagedSupabaseExportError("command_output_contract_invalid"));
      return;
    }
    const stdout = limitedCollector();
    let outputDescriptor = null;
    let child;
    try {
      if (stdoutPath != null) outputDescriptor = openSync(stdoutPath, "wx", 0o600);
      child = spawn(command, args, {
        cwd,
        env: environment,
        ...(argv0 ? { argv0 } : {}),
        detached: true,
        stdio: [
          input == null ? "ignore" : "pipe",
          outputDescriptor ?? (captureStdout ? "pipe" : "ignore"),
          "ignore",
        ],
      });
    } catch {
      if (outputDescriptor != null) closeSync(outputDescriptor);
      reject(new ManagedSupabaseExportError(code));
      return;
    }
    if (outputDescriptor != null) closeSync(outputDescriptor);
    let finished = false;
    let settling = false;
    let terminationCode = null;
    let killTimer = null;
    const processGroupId = child.pid;
    if (processGroupId != null) state?.processGroups?.add(processGroupId);
    const processGroupAlive = () => {
      if (processGroupId == null) return false;
      try {
        process.kill(-processGroupId, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        return true;
      }
    };
    const signalProcessGroup = (childSignal) => {
      if (processGroupId == null) return child.kill(childSignal);
      try {
        process.kill(-processGroupId, childSignal);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        try {
          return child.kill(childSignal);
        } catch {
          return false;
        }
      }
    };
    const terminate = (reason, force = false) => {
      if (finished) return;
      terminationCode ??= reason;
      if (force) {
        if (killTimer) clearTimeout(killTimer);
        killTimer = null;
        signalProcessGroup("SIGKILL");
        return;
      }
      signalProcessGroup("SIGTERM");
      if (!killTimer) {
        killTimer = setTimeout(() => {
          if (!finished) signalProcessGroup("SIGKILL");
        }, killGraceMs);
        killTimer.unref?.();
      }
    };
    state?.terminators.add(terminate);
    const timeout = setTimeout(() => terminate(code), timeoutMs);
    const abort = () => terminate("export_interrupted");
    signal?.addEventListener("abort", abort, { once: true });
    const finish = () => {
      finished = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      state?.terminators.delete(terminate);
    };
    const settle = async (status, childSignal) => {
      if (settling) return;
      settling = true;
      if (processGroupAlive()) {
        terminate(terminationCode ?? "process_tree_not_drained");
        const deadline = Date.now() + killGraceMs + 2_000;
        while (processGroupAlive() && Date.now() < deadline) {
          await new Promise((resolveWait) => setTimeout(resolveWait, PROCESS_GROUP_DRAIN_POLL_MS));
        }
      }
      if (processGroupAlive()) {
        terminationCode = "process_tree_termination_failed";
      } else if (processGroupId != null) {
        state?.processGroups?.delete(processGroupId);
      }
      finish();
      if (terminationCode) {
        reject(new ManagedSupabaseExportError(terminationCode));
      } else if (signal?.aborted) {
        reject(new ManagedSupabaseExportError("export_interrupted"));
      } else if (childSignal || status !== 0) {
        reject(new ManagedSupabaseExportError(code));
      } else {
        accept(stdout.value());
      }
    };
    child.once("error", () => {
      terminationCode ??= code;
    });
    child.once("close", (status, childSignal) => {
      void settle(status, childSignal);
    });
    if (captureStdout) {
      child.stdout.on("data", (chunk) => {
        try {
          stdout.push(chunk);
        } catch (error) {
          terminate(
            error instanceof ManagedSupabaseExportError
              ? error.code
              : "command_output_too_large",
          );
        }
      });
    }
    if (input != null) {
      child.stdin.on("error", () => terminate(code));
      child.stdin.end(input);
    }
  });
}

export function synchronizedSnapshotFlag(value) {
  if (typeof value !== "string" || !SNAPSHOT_ID.test(value)) {
    fail("database_snapshot_id_invalid");
  }
  return `--snapshot=${value}`;
}

export async function openSynchronizedDatabaseSnapshot(command, args, {
  cwd,
  environment,
  signal,
  state,
  timeoutMs = SNAPSHOT_HOLDER_TIMEOUT_MS,
  killGraceMs = COMMAND_KILL_GRACE_MS,
} = {}) {
  if (!environment || typeof environment !== "object") {
    fail("command_environment_required");
  }
  if (signal?.aborted) fail("export_interrupted");
  if (process.platform === "win32") fail("process_group_unsupported");

  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env: environment,
      detached: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    fail("database_snapshot_holder_failed");
  }

  const processGroupId = child.pid;
  if (processGroupId != null) state?.processGroups?.add(processGroupId);
  let finished = false;
  let settling = false;
  let closeRequested = false;
  let readySettled = false;
  let terminationCode = null;
  let killTimer = null;
  let output = "";
  let snapshotId = null;
  let resolveReady;
  let rejectReady;
  let resolveDone;
  let rejectDone;
  const readyPromise = new Promise((resolveReadyPromise, rejectReadyPromise) => {
    resolveReady = resolveReadyPromise;
    rejectReady = rejectReadyPromise;
  });
  const donePromise = new Promise((resolveDonePromise, rejectDonePromise) => {
    resolveDone = resolveDonePromise;
    rejectDone = rejectDonePromise;
  });
  // A holder can fail between becoming ready and the caller entering its first
  // Promise.race. Keep the rejection observed without changing its semantics.
  void donePromise.catch(() => undefined);

  const processGroupAlive = () => {
    if (processGroupId == null) return false;
    try {
      process.kill(-processGroupId, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      return true;
    }
  };
  const signalProcessGroup = (childSignal) => {
    if (processGroupId == null) return child.kill(childSignal);
    try {
      process.kill(-processGroupId, childSignal);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      try {
        return child.kill(childSignal);
      } catch {
        return false;
      }
    }
  };
  const rejectReadiness = (code) => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(new ManagedSupabaseExportError(code));
  };
  const resolveReadiness = (value) => {
    if (readySettled) return;
    readySettled = true;
    resolveReady(value);
  };
  const terminate = (reason, force = false) => {
    terminationCode ??= reason;
    if (finished) return;
    signalProcessGroup(force ? "SIGKILL" : "SIGTERM");
    if (!force && killTimer == null) {
      killTimer = setTimeout(() => {
        killTimer = null;
        if (!finished && processGroupAlive()) signalProcessGroup("SIGKILL");
      }, killGraceMs);
    }
  };
  state?.terminators?.add(terminate);
  const timeout = setTimeout(
    () => terminate("database_snapshot_holder_timeout"),
    timeoutMs,
  );
  const abort = () => terminate("export_interrupted");
  signal?.addEventListener("abort", abort, { once: true });
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    if (killTimer != null) clearTimeout(killTimer);
    signal?.removeEventListener("abort", abort);
    state?.terminators?.delete(terminate);
    if (!processGroupAlive() && processGroupId != null) {
      state?.processGroups?.delete(processGroupId);
    }
  };
  const settle = async (status, childSignal) => {
    if (settling) return;
    settling = true;
    if (processGroupAlive()) {
      terminate(terminationCode ?? "database_snapshot_process_tree_not_drained");
      const deadline = Date.now() + killGraceMs + 2_000;
      while (processGroupAlive() && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, PROCESS_GROUP_DRAIN_POLL_MS));
      }
    }
    if (processGroupAlive()) {
      terminationCode = "database_snapshot_process_tree_termination_failed";
    }
    const failureCode = terminationCode ?? (
      signal?.aborted
        ? "export_interrupted"
        : !closeRequested || childSignal || status !== 0
          ? "database_snapshot_holder_exited_early"
          : snapshotId == null
            ? "database_snapshot_holder_output_invalid"
            : null
    );
    finish();
    if (failureCode) {
      rejectReadiness(failureCode);
      rejectDone(new ManagedSupabaseExportError(failureCode));
    } else {
      resolveDone();
    }
  };

  child.once("error", () => terminate("database_snapshot_holder_failed"));
  child.once("close", (status, childSignal) => {
    void settle(status, childSignal);
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.length > MAX_CAPTURE_BYTES) {
      terminate("database_snapshot_holder_output_invalid");
      return;
    }
    const lines = output.split(/\r?\n/u);
    output = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") continue;
      if (!line.startsWith(SNAPSHOT_OUTPUT_PREFIX) || snapshotId != null) {
        terminate("database_snapshot_holder_output_invalid");
        return;
      }
      try {
        snapshotId = synchronizedSnapshotFlag(
          line.slice(SNAPSHOT_OUTPUT_PREFIX.length),
        ).slice("--snapshot=".length);
      } catch {
        terminate("database_snapshot_holder_output_invalid");
        return;
      }
      resolveReadiness(snapshotId);
    }
  });
  child.stdin.on("error", () => terminate("database_snapshot_holder_failed"));
  child.stdin.write(
    `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n` +
      `SELECT '${SNAPSHOT_OUTPUT_PREFIX}' || pg_export_snapshot();\n`,
    (error) => {
      if (error) terminate("database_snapshot_holder_failed");
    },
  );

  const readySnapshot = await readyPromise;
  return Object.freeze({
    snapshotId: readySnapshot,
    done: donePromise,
    close: async () => {
      if (!closeRequested && !finished) {
        closeRequested = true;
        try {
          child.stdin.end("ROLLBACK;\n\\q\n");
        } catch {
          terminate("database_snapshot_holder_close_failed");
        }
      }
      await donePromise;
    },
  });
}

export function registerSignalCleanup(abortController, state) {
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      state.signal = signal;
      state.signalCount += 1;
      abortController.abort(new ManagedSupabaseExportError("export_interrupted"));
      for (const terminate of state.terminators) {
        terminate("export_interrupted", state.signalCount > 1);
      }
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

export async function drainConcurrentOperations(operations, outerSignal, state) {
  const branchController = new AbortController();
  const branchSignal = AbortSignal.any([outerSignal, branchController.signal]);
  let branchFailure = null;
  const settled = await Promise.allSettled(operations.map((operation) =>
    Promise.resolve()
      .then(() => operation(branchSignal))
      .catch((error) => {
        if (branchFailure == null) {
          branchFailure = error;
          branchController.abort(error);
        }
        throw error;
      })));
  if (state.terminators.size !== 0 || state.processGroups?.size !== 0) {
    fail("child_process_drain_failed");
  }
  if (branchFailure != null) throw branchFailure;
  return settled.map((result) => result.value);
}

export function guardedRemove(path, { beforeRootRemoval = null } = {}) {
  if (!path || !isAbsolute(path) || !existsSync(path)) return;
  const canonical = realpathSync(path);
  if (!basename(canonical).startsWith("evo-v3-managed-export-")) fail("cleanup_target_invalid");
  const metadata = lstatSync(canonical);
  if (
    !metadata.isDirectory() ||
    typeof process.getuid !== "function" ||
    metadata.uid !== process.getuid() ||
    (metadata.mode & 0o077) !== 0
  ) {
    fail("cleanup_target_invalid");
  }
  const marker = join(canonical, RUN_MARKER);
  const markerMetadata = existsSync(marker) ? lstatSync(marker) : null;
  const markerContent = markerMetadata?.isFile() ? readFileSync(marker, "utf8") : null;
  if (
    !existsSync(marker) ||
    !markerMetadata?.isFile() ||
    markerMetadata.uid !== process.getuid() ||
    (markerMetadata.mode & 0o077) !== 0 ||
    !new Set(["managed-supabase-export\n", "managed-supabase-export-runtime\n"]).has(markerContent)
  ) {
    fail("cleanup_target_invalid");
  }
  for (const entry of readdirSync(canonical)) {
    if (entry === RUN_MARKER) continue;
    rmSync(join(canonical, entry), {
      recursive: true,
      force: false,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
  unlinkSync(marker);
  try {
    beforeRootRemoval?.(canonical);
    rmdirSync(canonical);
  } catch {
    try {
      if (existsSync(canonical) && !existsSync(marker)) {
        writeFileSync(marker, markerContent, { mode: 0o600, flag: "wx" });
      }
    } catch {
      fail("cleanup_marker_restore_failed");
    }
    fail("cleanup_directory_not_empty");
  }
}

function runCleanupActions(state, actions) {
  if (state.terminators.size !== 0 || state.processGroups.size !== 0) {
    fail("child_process_drain_failed");
  }
  let firstFailure = null;
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure) throw firstFailure;
}

async function listStorageInventory(storageClient) {
  const { data: bucketData, error: bucketError } = await storageClient.listBuckets();
  if (bucketError || !Array.isArray(bucketData)) fail("storage_bucket_list_failed");
  const buckets = bucketData.map(normalizedBucket).sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );
  const objects = [];
  let pages = 0;
  for (const bucket of buckets) {
    const prefixes = [""];
    const visitedPrefixes = new Set();
    while (prefixes.length > 0) {
      const prefix = prefixes.shift();
      if (visitedPrefixes.has(prefix)) fail("storage_prefix_cycle");
      visitedPrefixes.add(prefix);
      let offset = 0;
      for (;;) {
        pages += 1;
        if (pages > MAX_STORAGE_PAGES) fail("storage_pagination_limit");
        const { data, error } = await storageClient.from(bucket.id).list(prefix, {
          limit: STORAGE_PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (error || !Array.isArray(data)) fail("storage_object_list_failed");
        for (const item of data) {
          const name = requiredString(item?.name, "storage_inventory_invalid", 8_192);
          if (name.includes("/") || name === "." || name === "..") {
            fail("storage_inventory_invalid");
          }
          const path = prefix === "" ? name : `${prefix}/${name}`;
          if (item?.id == null) {
            if (path === prefix || path.startsWith(`${prefix}/../`)) {
              fail("storage_inventory_invalid");
            }
            prefixes.push(path);
          } else {
            objects.push(normalizedStorageObject(bucket.id, path, item));
            if (objects.length > MAX_STORAGE_OBJECTS) fail("storage_inventory_too_large");
          }
        }
        if (data.length < STORAGE_PAGE_SIZE) break;
        offset += data.length;
      }
    }
  }
  return storageInventoryDigest({ buckets, objects });
}

function encodedObjectPath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export async function downloadStorageObjects({
  inventory,
  origin,
  secretKey,
  outputDirectory,
  signal,
  fetchImpl = fetch,
  idleTimeoutMs = STORAGE_DOWNLOAD_IDLE_TIMEOUT_MS,
}) {
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    fail("storage_download_timeout_invalid");
  }
  const allowedOrigin = validatedStorageOrigin(origin);
  mkdirSync(outputDirectory, { mode: 0o700 });
  const downloaded = [];
  let totalBytes = 0;
  for (const [index, item] of inventory.normalized.objects.entries()) {
    if (signal.aborted) fail("export_interrupted");
    const filename = `${String(index).padStart(8, "0")}.bin`;
    const output = join(outputDirectory, filename);
    const url = `${allowedOrigin}/storage/v1/object/authenticated/${encodeURIComponent(item.bucket_id)}/${encodedObjectPath(item.path)}`;
    let response;
    const downloadController = new AbortController();
    const downloadSignal = AbortSignal.any([signal, downloadController.signal]);
    let idleTimer = null;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => downloadController.abort(new ManagedSupabaseExportError("storage_object_download_timed_out")),
        idleTimeoutMs,
      );
    };
    resetIdleTimer();
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: storageDownloadHeaders(secretKey),
        redirect: "error",
        signal: downloadSignal,
      });
    } catch {
      if (signal.aborted) fail("export_interrupted");
      if (downloadController.signal.aborted) fail("storage_object_download_timed_out");
      fail("storage_object_download_failed");
    }
    resetIdleTimer();
    if (!response.ok || (!response.body && item.size !== 0)) {
      try {
        await response.body?.cancel();
      } catch {
        // The body is deliberately discarded.
      }
      if (idleTimer) clearTimeout(idleTimer);
      fail("storage_object_download_failed");
    }
    const lengthHeader = response.headers.get("content-length");
    const declaredLength = Number(lengthHeader ?? item.size);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_STORAGE_OBJECT_BYTES ||
      (lengthHeader != null && declaredLength !== item.size)
    ) {
      downloadController.abort(new ManagedSupabaseExportError("storage_object_size_invalid"));
      try {
        await response.body?.cancel();
      } catch {
        // The rejected response body is deliberately discarded.
      }
      if (idleTimer) clearTimeout(idleTimer);
      fail("storage_object_size_invalid");
    }
    const writer = createWriteStream(output, { flags: "wx", mode: 0o600 });
    const digest = createHash("sha256");
    let downloadedBytes = 0;
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        resetIdleTimer();
        downloadedBytes += chunk.length;
        if (downloadedBytes > item.size || downloadedBytes > MAX_STORAGE_OBJECT_BYTES) {
          callback(new ManagedSupabaseExportError("storage_object_size_mismatch"));
          return;
        }
        digest.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      const source = response.body ? Readable.fromWeb(response.body) : Readable.from([]);
      await pipeline(source, progress, writer, { signal: downloadSignal });
    } catch (error) {
      if (idleTimer) clearTimeout(idleTimer);
      if (signal.aborted) fail("export_interrupted");
      if (downloadController.signal.aborted) fail("storage_object_download_timed_out");
      if (error instanceof ManagedSupabaseExportError) throw error;
      fail("storage_object_download_failed");
    }
    if (idleTimer) clearTimeout(idleTimer);
    const outputMetadata = statSync(output);
    if (
      !outputMetadata.isFile() ||
      outputMetadata.size !== item.size ||
      downloadedBytes !== item.size
    ) {
      fail("storage_object_size_mismatch");
    }
    const metadata = Object.freeze({
      bytes: downloadedBytes,
      sha256: digest.digest("hex"),
    });
    totalBytes += metadata.bytes;
    if (totalBytes > MAX_STORAGE_TOTAL_BYTES) fail("storage_inventory_too_large");
    downloaded.push(Object.freeze({
      bucket_id: item.bucket_id,
      path: item.path,
      source_id: item.id,
      source_version: item.version,
      blob: filename,
      bytes: metadata.bytes,
      sha256: metadata.sha256,
    }));
  }
  return Object.freeze({ objects: Object.freeze(downloaded), totalBytes });
}

async function managementReceipt(projectRef, accessToken, signal, nowMs) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const projects = await fetchJson(
    "https://api.supabase.com/v1/projects",
    { method: "GET", headers },
    "management_project_lookup_failed",
    signal,
  );
  if (!Array.isArray(projects)) fail("management_project_lookup_failed");
  const matches = projects.filter((project) => project?.id === projectRef);
  if (matches.length !== 1) fail("management_project_mismatch");
  const project = normalizeProjectReceipt(matches[0], projectRef);
  const backups = await fetchJson(
    `https://api.supabase.com/v1/projects/${projectRef}/database/backups`,
    { method: "GET", headers },
    "provider_backup_lookup_failed",
    signal,
  );
  const backup = selectLatestCompletedBackup(backups, nowMs);
  const poolerPayload = await fetchJson(
    `https://api.supabase.com/v1/projects/${projectRef}/config/database/pooler`,
    { method: "GET", headers },
    "management_pooler_lookup_failed",
    signal,
  );
  const pooler = normalizePoolerReceipt(poolerPayload, project);
  return Object.freeze({
    project,
    backup,
    pooler,
    sha256: sha256(canonicalJson({ project, backup, pooler })),
  });
}

async function verifyProjectKeys(projectRef, publishableKey, secretKey, signal) {
  const origin = `https://${projectRef}.supabase.co`;
  for (const request of [
    {
      url: `${origin}/auth/v1/settings`,
      headers: { apikey: publishableKey },
      code: "publishable_key_project_mismatch",
    },
    {
      url: `${origin}/auth/v1/admin/users?page=1&per_page=1`,
      headers: {
        apikey: secretKey,
        ...(jwtRole(secretKey) === "service_role"
          ? { Authorization: `Bearer ${secretKey}` }
          : {}),
      },
      code: "secret_key_project_mismatch",
    },
  ]) {
    let response;
    try {
      response = await fetch(request.url, {
        method: "GET",
        headers: request.headers,
        redirect: "error",
        signal: combineSignals(signal, REQUEST_TIMEOUT_MS),
      });
    } catch {
      fail("supabase_key_verification_unavailable");
    }
    const accepted = response.status === 200;
    try {
      await response.body?.cancel();
    } catch {
      // The response content may include staff data and is never consumed.
    }
    if (!accepted) fail(request.code);
  }
}

function resolveTrustedExecutable(candidates, allowedRealLocations, code, argv0 = null) {
  for (const candidate of candidates) {
    try {
      if (!isAbsolute(candidate) || !existsSync(candidate)) continue;
      const real = realpathSync(candidate);
      const metadata = statSync(real);
      const allowed = allowedRealLocations.some((location) =>
        location.endsWith(sep) ? real.startsWith(location) : real === location,
      );
      if (
        !allowed ||
        !metadata.isFile() ||
        (metadata.mode & 0o111) === 0 ||
        (metadata.mode & 0o022) !== 0
      ) {
        continue;
      }
      return Object.freeze({ path: candidate, real, argv0 });
    } catch {
      // Try the next fixed, absolute installation location.
    }
  }
  fail(code);
}

function resolveSupabaseCliBinary(root) {
  const platformPackages = SUPABASE_CLI_PACKAGES[process.platform]?.[process.arch];
  if (!platformPackages) fail("supabase_cli_platform_unsupported");
  const executableName = process.platform === "win32" ? "supabase.exe" : "supabase";
  const candidates = platformPackages.map((suffix) =>
    join(root, "node_modules", "@supabase", `cli-${suffix}`, "bin", executableName));
  const resolved = resolveTrustedExecutable(
    candidates,
    candidates,
    "supabase_cli_missing",
  );
  return Object.freeze({
    ...resolved,
    packageJson: join(dirname(dirname(resolved.real)), "package.json"),
  });
}

function resolvePostgresClient(name) {
  return resolveTrustedExecutable(
    [
      `/opt/homebrew/opt/libpq/bin/${name}`,
      `/usr/local/opt/libpq/bin/${name}`,
    ],
    [
      "/opt/homebrew/Cellar/libpq/",
      "/usr/local/Cellar/libpq/",
    ],
    `${name}_unavailable`,
  );
}

export function validateSupabaseDatabaseCa(path, nowMs = Date.now()) {
  if (!isAbsolute(path) || !existsSync(path) || realpathSync(path) !== path) {
    fail("database_ca_invalid");
  }
  const metadata = statSync(path);
  if (!metadata.isFile() || (metadata.mode & 0o022) !== 0) fail("database_ca_invalid");
  const bytes = readFileSync(path);
  if (sha256(bytes) !== SUPABASE_DATABASE_CA_SHA256) fail("database_ca_invalid");
  let certificate;
  try {
    certificate = new X509Certificate(bytes);
  } catch {
    fail("database_ca_invalid");
  }
  if (
    !certificate.ca ||
    certificate.fingerprint256 !== SUPABASE_DATABASE_CA_FINGERPRINT ||
    Date.parse(certificate.validFrom) > nowMs ||
    Date.parse(certificate.validTo) <= nowMs
  ) {
    fail("database_ca_invalid");
  }
  return Object.freeze({
    path,
    sha256: SUPABASE_DATABASE_CA_SHA256,
    fingerprint: SUPABASE_DATABASE_CA_FINGERPRINT,
  });
}

function trustedExecutables(root) {
  return Object.freeze({
    cli: resolveSupabaseCliBinary(root),
    pgDump: resolvePostgresClient("pg_dump"),
    pgDumpAll: resolvePostgresClient("pg_dumpall"),
    psql: resolvePostgresClient("psql"),
    bash: resolveTrustedExecutable(["/bin/bash"], ["/bin/bash"], "bash_unavailable"),
    git: resolveTrustedExecutable(["/usr/bin/git"], ["/usr/bin/git"], "git_unavailable"),
    ssh: resolveTrustedExecutable(["/usr/bin/ssh"], ["/usr/bin/ssh"], "ssh_unavailable"),
    sshKeygen: resolveTrustedExecutable(
      ["/usr/bin/ssh-keygen"],
      ["/usr/bin/ssh-keygen"],
      "ssh_keygen_unavailable",
    ),
    tar: resolveTrustedExecutable(
      ["/usr/bin/tar"],
      ["/usr/bin/tar", "/usr/bin/bsdtar"],
      "tar_unavailable",
    ),
    age: resolveTrustedExecutable(
      ["/opt/homebrew/bin/age", "/usr/local/bin/age"],
      ["/opt/homebrew/Cellar/age/", "/usr/local/Cellar/age/"],
      "age_unavailable",
    ),
    orb: resolveTrustedExecutable(
      [
        "/Applications/OrbStack.app/Contents/MacOS/scli.app/Contents/MacOS/scli",
        "/usr/local/bin/orb",
      ],
      ["/Applications/OrbStack.app/Contents/MacOS/scli.app/Contents/MacOS/scli"],
      "orbstack_unavailable",
      "orb",
    ),
    docker: resolveTrustedExecutable(
      [
        "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
        "/usr/local/bin/docker",
      ],
      ["/Applications/OrbStack.app/Contents/MacOS/xbin/docker-tools"],
      "docker_unavailable",
      "docker",
    ),
  });
}

export function patchedPostgresClientVersion(output, name) {
  const match = new RegExp(`^${name} \\(PostgreSQL\\) (\\d+)\\.(\\d+)(?:\\.\\d+)?$`, "u")
    .exec(output.trim());
  if (!match) fail("postgres_client_version_invalid");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const minimumMinor = new Map([[14, 24], [15, 19], [16, 15], [17, 11], [18, 6]])
    .get(major);
  if (minimumMinor == null || minor < minimumMinor) fail("postgres_client_security_update_required");
  return `${major}.${minor}`;
}

function safeCommandEnvironment(tools, runtimeDirectory) {
  const environment = {
    PATH: `${dirname(tools.pgDump.real)}:${dirname(tools.docker.real)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: join(runtimeDirectory, "home"),
    TMPDIR: join(runtimeDirectory, "tmp"),
    LANG: "C.UTF-8",
    LC_ALL: "C",
    DOCKER_CONTEXT: "orbstack",
  };
  return environment;
}

async function toolEvidence(
  root,
  signal,
  state,
  commandEnvironment,
  orbEnvironment,
  executables,
) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const expectedSupabase = packageJson.devDependencies?.supabase;
  if (expectedSupabase !== "2.116.0") fail("supabase_cli_not_pinned");
  const platformPackage = JSON.parse(readFileSync(executables.cli.packageJson, "utf8"));
  if (platformPackage.version !== expectedSupabase) fail("supabase_cli_version_mismatch");
  const supabaseVersion = (
    await spawnCommand(executables.cli.real, ["--version"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "supabase_cli_version_failed",
      timeoutMs: 10_000,
    })
  ).trim();
  if (supabaseVersion !== expectedSupabase || !VERSION.test(supabaseVersion)) {
    fail("supabase_cli_version_mismatch");
  }
  const pgDumpVersion = patchedPostgresClientVersion(
    await spawnCommand(executables.pgDump.real, ["--version"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "pg_dump_version_failed",
      timeoutMs: 10_000,
    }),
    "pg_dump",
  );
  const pgDumpAllVersion = patchedPostgresClientVersion(
    await spawnCommand(executables.pgDumpAll.real, ["--version"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "pg_dumpall_version_failed",
      timeoutMs: 10_000,
    }),
    "pg_dumpall",
  );
  const psqlVersion = patchedPostgresClientVersion(
    await spawnCommand(executables.psql.real, ["--version"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "psql_version_failed",
      timeoutMs: 10_000,
    }),
    "psql",
  );
  if (pgDumpVersion !== pgDumpAllVersion || pgDumpVersion !== psqlVersion) {
    fail("postgres_client_version_mismatch");
  }
  const orbStatus = (
    await spawnCommand(executables.orb.real, ["status"], {
      cwd: root,
      environment: orbEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "orbstack_unavailable",
      timeoutMs: 10_000,
      argv0: executables.orb.argv0,
    })
  ).trim();
  if (orbStatus !== "Running") fail("orbstack_unavailable");
  const dockerContext = (
    await spawnCommand(executables.docker.real, ["context", "show"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "docker_context_invalid",
      timeoutMs: 10_000,
      argv0: executables.docker.argv0,
    })
  ).trim();
  if (dockerContext !== "orbstack") fail("docker_context_invalid");
  const ageVersion = (
    await spawnCommand(executables.age.real, ["--version"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "age_unavailable",
      timeoutMs: 10_000,
    })
  ).trim();
  const sshVersion = (
    await spawnCommand(executables.ssh.real, ["-V"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: false,
      code: "ssh_unavailable",
      timeoutMs: 10_000,
    }).then(() => "available")
  );
  return Object.freeze({
    supabase_cli: supabaseVersion,
    pg_dump: pgDumpVersion,
    pg_dumpall: pgDumpAllVersion,
    psql: psqlVersion,
    age: requiredString(ageVersion, "age_unavailable", 256),
    ssh: sshVersion,
    orb: orbStatus,
    docker_context: dockerContext,
  });
}

async function repositoryEvidence(root, signal, state, commandEnvironment, executables) {
  const head = (
    await spawnCommand(executables.git.real, ["rev-parse", "HEAD"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "git_head_unavailable",
      timeoutMs: 10_000,
    })
  ).trim();
  if (!/^[0-9a-f]{40}$/u.test(head)) fail("git_head_invalid");
  const migrationTree = (
    await spawnCommand(executables.git.real, ["rev-parse", "HEAD:supabase/migrations"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "migration_tree_unavailable",
      timeoutMs: 10_000,
    })
  ).trim();
  if (!/^[0-9a-f]{40}$/u.test(migrationTree)) fail("migration_tree_invalid");
  const status = await spawnCommand(executables.git.real, ["status", "--porcelain"], {
    cwd: root,
    environment: commandEnvironment,
    signal,
    state,
    captureStdout: true,
    code: "git_status_unavailable",
    timeoutMs: 10_000,
  });
  if (status.trim() !== "") fail("worktree_not_clean");
  return Object.freeze({ head, migration_tree: migrationTree });
}

async function snapshotManagedDumpInputs({
  root,
  runtimeDirectory,
  gitHead,
  signal,
  state,
  environment,
  executables,
}) {
  const directory = join(runtimeDirectory, "managed-dump-inputs");
  mkdirSync(directory, { mode: 0o700 });
  const definitions = Object.freeze([
    Object.freeze({
      key: "database_ca",
      relativePath: "scripts/support/supabase-prod-ca-2021.crt",
      destination: "supabase-prod-ca-2021.crt",
      mode: 0o600,
    }),
    Object.freeze({
      key: "schema",
      relativePath: "scripts/support/v3-managed-supabase-dump-schema.sh",
      destination: "dump-schema.sh",
      mode: 0o700,
    }),
    Object.freeze({
      key: "data",
      relativePath: "scripts/support/v3-managed-supabase-dump-data.sh",
      destination: "dump-data.sh",
      mode: 0o700,
    }),
    Object.freeze({
      key: "roles",
      relativePath: "scripts/support/v3-managed-supabase-dump-roles.sh",
      destination: "dump-roles.sh",
      mode: 0o700,
    }),
  ]);
  const snapshots = {};
  const hashes = {};
  for (const definition of definitions) {
    const source = join(root, definition.relativePath);
    if (!existsSync(source) || realpathSync(source) !== source) fail("managed_dump_input_invalid");
    const metadata = statSync(source);
    if (!metadata.isFile() || (metadata.mode & 0o022) !== 0) {
      fail("managed_dump_input_invalid");
    }
    const bytes = readFileSync(source);
    const expectedBlob = (
      await spawnCommand(
        executables.git.real,
        ["rev-parse", `${gitHead}:${definition.relativePath}`],
        {
          cwd: root,
          environment,
          signal,
          state,
          captureStdout: true,
          code: "managed_dump_input_untracked",
          timeoutMs: 10_000,
        },
      )
    ).trim();
    const actualBlob = (
      await spawnCommand(executables.git.real, ["hash-object", "--stdin"], {
        cwd: root,
        environment,
        signal,
        state,
        input: bytes,
        captureStdout: true,
        code: "managed_dump_input_hash_failed",
        timeoutMs: 10_000,
      })
    ).trim();
    if (!/^[0-9a-f]{40}$/u.test(expectedBlob) || actualBlob !== expectedBlob) {
      fail("managed_dump_input_changed");
    }
    const destination = join(directory, definition.destination);
    writeFileSync(destination, bytes, { mode: definition.mode, flag: "wx" });
    hashes[definition.key] = sha256(bytes);
    snapshots[definition.key] = destination;
  }
  const databaseCa = validateSupabaseDatabaseCa(snapshots.database_ca);
  return Object.freeze({
    databaseCa,
    dumpScripts: Object.freeze({
      schema: resolveTrustedExecutable(
        [snapshots.schema],
        [snapshots.schema],
        "managed_dump_script_invalid",
      ),
      data: resolveTrustedExecutable(
        [snapshots.data],
        [snapshots.data],
        "managed_dump_script_invalid",
      ),
      roles: resolveTrustedExecutable(
        [snapshots.roles],
        [snapshots.roles],
        "managed_dump_script_invalid",
      ),
    }),
    sha256: Object.freeze(hashes),
  });
}

export function managedDatabaseDumpPlan(snapshotId) {
  const snapshotFlag = synchronizedSnapshotFlag(snapshotId);
  return Object.freeze([
    Object.freeze({
      filename: "roles.sql",
      scriptKey: "roles",
      variables: Object.freeze({
        RESERVED_ROLES: SUPABASE_RESERVED_ROLES.join("|"),
        ALLOWED_CONFIGS: SUPABASE_ALLOWED_CONFIGS.join("|"),
        EXTRA_SED: "/^--/d",
      }),
    }),
    Object.freeze({
      filename: "schema.sql",
      scriptKey: "schema",
      variables: Object.freeze({
        EXCLUDED_SCHEMAS: SUPABASE_INTERNAL_SCHEMAS.join("|"),
        EXTRA_FLAGS: snapshotFlag,
        EXTRA_SED: "/^--/d",
      }),
    }),
    Object.freeze({
      filename: "data.sql",
      scriptKey: "data",
      variables: Object.freeze({
        EXCLUDED_SCHEMAS: SUPABASE_DATA_EXCLUDED_SCHEMAS.join("|"),
        INCLUDED_SCHEMAS: "*",
        EXTRA_FLAGS: `--exclude-table storage.buckets_vectors --exclude-table storage.vector_indexes ${snapshotFlag}`,
      }),
    }),
    Object.freeze({
      filename: "history-schema.sql",
      scriptKey: "schema",
      variables: Object.freeze({
        EXCLUDED_SCHEMAS: "",
        EXTRA_FLAGS: `--schema=supabase_migrations ${snapshotFlag}`,
        EXTRA_SED: "/^--/d",
      }),
    }),
    Object.freeze({
      filename: "history-data.sql",
      scriptKey: "data",
      variables: Object.freeze({
        EXCLUDED_SCHEMAS: "",
        INCLUDED_SCHEMAS: "supabase_migrations",
        EXTRA_FLAGS: snapshotFlag,
      }),
    }),
  ]);
}

async function dumpDatabase({
  root,
  executables,
  projectRef,
  snapshotId,
  staging,
  signal,
  state,
  environment,
  reverse = false,
}) {
  if (environment.PGUSER !== `postgres.${projectRef}`) fail("database_source_mismatch");
  const commands = managedDatabaseDumpPlan(snapshotId);
  const orderedCommands = reverse ? [...commands].reverse() : commands;
  for (const command of orderedCommands) {
    const output = join(staging, command.filename);
    await spawnCommand(
      executables.bash.real,
      [executables.dumpScripts[command.scriptKey].real],
      {
        cwd: root,
        environment: { ...environment, ...command.variables },
        signal,
        state,
        stdoutPath: output,
        code: `database_dump_${command.filename.replaceAll(/[^a-z]+/gu, "_")}_failed`,
      },
    );
    chmodSync(output, 0o600);
    artifactMetadata(output);
  }
}

async function verifyDatabaseSnapshotStable({
  root,
  executables,
  projectRef,
  snapshotId,
  staging,
  signal,
  state,
  environment,
}) {
  const verification = join(staging, "database-stability");
  mkdirSync(verification, { mode: 0o700 });
  await dumpDatabase({
    root,
    executables,
    projectRef,
    snapshotId,
    staging: verification,
    signal,
    state,
    environment,
    reverse: true,
  });
  const semanticArtifacts = {};
  for (const filename of EXPECTED_ARTIFACTS) {
    const [first, second] = await Promise.all([
      semanticSqlFileDigest(join(staging, filename)),
      semanticSqlFileDigest(join(verification, filename)),
    ]);
    if (first !== second) fail("database_snapshot_drift");
    semanticArtifacts[filename] = first;
  }
  rmSync(verification, { recursive: true, force: false });
  return Object.freeze({
    snapshot_mode: "postgresql-exported-repeatable-read-read-only",
    artifact_semantic_sha256: Object.freeze(semanticArtifacts),
    proof_sha256: sha256(canonicalJson(semanticArtifacts)),
  });
}

async function encryptArtifact({
  source,
  destination,
  recipient,
  cwd,
  signal,
  state,
  environment,
  executables,
}) {
  await spawnCommand(
    executables.age.real,
    ["--encrypt", "--recipient", recipient, "--output", destination, source],
    {
      cwd,
      environment,
      signal,
      state,
      code: "artifact_encryption_failed",
      timeoutMs: COMMAND_TIMEOUT_MS,
    },
  );
  chmodSync(destination, 0o600);
  return artifactMetadata(destination);
}

function normalizedSshPublicKey(value) {
  const fields = requiredString(value.trim(), "signing_public_key_invalid", 16_384).split(/\s+/u);
  if (
    fields.length < 2 ||
    !/^[A-Za-z0-9@._+-]+$/u.test(fields[0]) ||
    !/^[A-Za-z0-9+/]+={0,3}$/u.test(fields[1])
  ) {
    fail("signing_public_key_invalid");
  }
  return `${fields[0]} ${fields[1]}`;
}

export function sshPublicKeyFingerprint(value) {
  const publicLine = normalizedSshPublicKey(value);
  const encoded = publicLine.split(" ")[1];
  const keyBlob = Buffer.from(encoded, "base64");
  if (
    keyBlob.length === 0 ||
    keyBlob.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")
  ) {
    fail("signing_public_key_invalid");
  }
  return `SHA256:${createHash("sha256").update(keyBlob).digest("base64").replace(/=+$/u, "")}`;
}

export async function verifyPrivateSigningKey(
  privateKey,
  trustedPublicLine,
  cwd,
  signal,
  state,
  environment,
  executables,
) {
  const derived = await spawnCommand(
    executables.sshKeygen.real,
    ["-y", "-f", privateKey],
    {
      cwd,
      environment,
      signal,
      state,
      captureStdout: true,
      code: "signing_key_derivation_failed",
      timeoutMs: 30_000,
    },
  );
  if (normalizedSshPublicKey(derived) !== trustedPublicLine) {
    fail("signing_trust_root_mismatch");
  }
}

export async function verifySigningKeyPair(
  signing,
  cwd,
  signal,
  state,
  environment,
  executables,
) {
  const publicLine = normalizedSshPublicKey(readFileSync(signing.publicKey, "utf8"));
  const fingerprint = sshPublicKeyFingerprint(publicLine);
  await verifyPrivateSigningKey(
    signing.privateKey,
    publicLine,
    cwd,
    signal,
    state,
    environment,
    executables,
  );
  return Object.freeze({ publicLine, fingerprint });
}

export async function signAndVerifyReceipt({
  receiptPath,
  signingKey,
  trustedPublicLine,
  temporaryDirectory,
  signal,
  state,
  environment,
  executables,
}) {
  await verifyPrivateSigningKey(
    signingKey,
    trustedPublicLine,
    dirname(receiptPath),
    signal,
    state,
    environment,
    executables,
  );
  await spawnCommand(
    executables.sshKeygen.real,
    ["-Y", "sign", "-f", signingKey, "-n", SIGNATURE_NAMESPACE, receiptPath],
    {
      cwd: dirname(receiptPath),
      environment,
      signal,
      state,
      code: "receipt_signing_failed",
      timeoutMs: 30_000,
    },
  );
  const signaturePath = `${receiptPath}.sig`;
  chmodSync(signaturePath, 0o600);
  const allowedSigners = join(temporaryDirectory, "allowed_signers");
  writeFileSync(allowedSigners, `${SIGNATURE_IDENTITY} ${trustedPublicLine}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await spawnCommand(
    executables.sshKeygen.real,
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
      environment,
      signal,
      state,
      input: readFileSync(receiptPath),
      code: "receipt_signature_verification_failed",
      timeoutMs: 30_000,
    },
  );
  return Object.freeze({
    signature: artifactMetadata(signaturePath),
  });
}

function writePrivateJson(path, value) {
  writeFileSync(path, canonicalJson(value), { mode: 0o600, flag: "wx" });
  return artifactMetadata(path);
}

function ensureInterrupted(signal) {
  if (signal.aborted) fail("export_interrupted");
}

async function collectPreflight({
  args,
  root,
  runtimeDirectory,
  operatorHome,
  secrets,
  signal,
  state,
}) {
  const outputRoot = validateOutputRoot(args.outputRoot, root);
  const signing = validateSigningKey(
    args.signingKey,
    args.trustedPublicKey,
    outputRoot,
    root,
  );
  const executables = trustedExecutables(root);
  mkdirSync(join(runtimeDirectory, "home"), { mode: 0o700 });
  mkdirSync(join(runtimeDirectory, "tmp"), { mode: 0o700 });
  const commandEnvironment = safeCommandEnvironment(executables, runtimeDirectory);
  const orbEnvironment = { ...commandEnvironment, HOME: operatorHome };
  const [baseTools, git, signingTrust] = await drainConcurrentOperations([
    (branchSignal) => toolEvidence(
      root,
      branchSignal,
      state,
      commandEnvironment,
      orbEnvironment,
      executables,
    ),
    (branchSignal) => repositoryEvidence(
      root,
      branchSignal,
      state,
      commandEnvironment,
      executables,
    ),
    (branchSignal) => verifySigningKeyPair(
      signing,
      root,
      branchSignal,
      state,
      commandEnvironment,
      executables,
    ),
  ], signal, state);
  const managedDumpInputs = await snapshotManagedDumpInputs({
    root,
    runtimeDirectory,
    gitHead: git.head,
    signal,
    state,
    environment: commandEnvironment,
    executables,
  });
  const runtimeExecutables = Object.freeze({
    ...executables,
    dumpScripts: managedDumpInputs.dumpScripts,
  });
  const databaseCa = managedDumpInputs.databaseCa;
  const tools = Object.freeze({
    ...baseTools,
    database_ca_sha256: databaseCa.sha256,
    database_ca_fingerprint: databaseCa.fingerprint,
    managed_dump_inputs_sha256: managedDumpInputs.sha256,
  });
  let createClient;
  try {
    ({ createClient } = await import("@supabase/supabase-js"));
  } catch {
    fail("supabase_client_unavailable");
  }
  if (typeof createClient !== "function") fail("supabase_client_unavailable");
  const origin = `https://${args.projectRef}.supabase.co`;
  let storageClient;
  try {
    storageClient = createClient(origin, secrets.EVO_PLATFORM_SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: createStorageClientFetch(
          origin,
          secrets.EVO_PLATFORM_SUPABASE_SECRET_KEY,
          signal,
        ),
      },
    }).storage;
  } catch {
    fail("supabase_client_unavailable");
  }
  ensureInterrupted(signal);
  const source = await managementReceipt(
    args.projectRef,
    secrets.SUPABASE_ACCESS_TOKEN,
    signal,
    Date.now(),
  );
  const databaseEnvironment = Object.freeze({
    ...commandEnvironment,
    PGHOST: source.pooler.host,
    PGPORT: String(source.pooler.session_port),
    PGUSER: source.pooler.user,
    PGPASSWORD: secrets.SUPABASE_DB_PASSWORD,
    PGDATABASE: source.pooler.database,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: databaseCa.path,
    PGCONNECT_TIMEOUT: "20",
    PGAPPNAME: "evo_v3_managed_backup_export",
    PG_DUMP_BIN: executables.pgDump.real,
    PG_DUMPALL_BIN: executables.pgDumpAll.real,
  });
  await verifyProjectKeys(
    args.projectRef,
    secrets.EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY,
    secrets.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    signal,
  );
  const storageBefore = await listStorageInventory(storageClient);
  return Object.freeze({
    outputRoot,
    signing,
    signingTrust,
    tools,
    git,
    source,
    origin,
    storageClient,
    storageBefore,
    commandEnvironment,
    databaseEnvironment,
    executables: runtimeExecutables,
  });
}

function redactedPreflight(preflight) {
  return Object.freeze({
    result: "preflight_verified",
    source_identity_sha256: preflight.source.sha256,
    provider_backup_inserted_at: preflight.source.backup.inserted_at,
    storage_bucket_count: preflight.storageBefore.bucket_count,
    storage_object_count: preflight.storageBefore.object_count,
    storage_total_bytes: preflight.storageBefore.total_bytes,
    git_head: preflight.git.head,
    migration_tree: preflight.git.migration_tree,
  });
}

async function executeExport({ args, root, secrets, signal, state, preflight }) {
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replaceAll(/[^0-9]/gu, "").slice(0, 14);
  const runName = `evo-v3-managed-export-${safeTimestamp}-${randomUUID()}`;
  let partialDirectory = join(preflight.outputRoot, `${runName}.partial`);
  const finalDirectory = join(preflight.outputRoot, runName);
  let temporaryDirectory;
  const parentCleanup = state.cleanup;
  const cleanup = () => {
    runCleanupActions(state, [
      () => {
        if (temporaryDirectory && existsSync(temporaryDirectory)) guardedRemove(temporaryDirectory);
      },
      () => {
        if (partialDirectory && existsSync(partialDirectory)) guardedRemove(partialDirectory);
      },
      () => parentCleanup?.(),
    ]);
  };
  try {
    mkdirSync(partialDirectory, { mode: 0o700 });
    writeFileSync(join(partialDirectory, RUN_MARKER), "managed-supabase-export\n", {
      mode: 0o600,
      flag: "wx",
    });
    temporaryDirectory = realpathSync(
      mkdtempSync(join(tmpdir(), "evo-v3-managed-export-")),
    );
    chmodSync(temporaryDirectory, 0o700);
    writeFileSync(join(temporaryDirectory, RUN_MARKER), "managed-supabase-export\n", {
      mode: 0o600,
      flag: "wx",
    });
    state.cleanup = cleanup;

    const snapshotHolder = await openSynchronizedDatabaseSnapshot(
      preflight.executables.psql.real,
      [
        "--no-psqlrc",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--set",
        "ON_ERROR_STOP=1",
      ],
      {
        cwd: root,
        environment: preflight.databaseEnvironment,
        signal,
        state,
      },
    );
    const databaseController = new AbortController();
    const databaseSignal = AbortSignal.any([signal, databaseController.signal]);
    const runWithSnapshot = async (operation) => {
      try {
        return await Promise.race([
          operation,
          snapshotHolder.done.then(() => {
            fail("database_snapshot_holder_exited_early");
          }),
        ]);
      } catch (error) {
        databaseController.abort(error);
        await Promise.allSettled([operation]);
        throw error;
      }
    };
    let databaseStability;
    try {
      await runWithSnapshot(dumpDatabase({
        root,
        executables: preflight.executables,
        projectRef: args.projectRef,
        snapshotId: snapshotHolder.snapshotId,
        staging: temporaryDirectory,
        signal: databaseSignal,
        state,
        environment: preflight.databaseEnvironment,
      }));
      databaseStability = await runWithSnapshot(verifyDatabaseSnapshotStable({
        root,
        executables: preflight.executables,
        projectRef: args.projectRef,
        snapshotId: snapshotHolder.snapshotId,
        staging: temporaryDirectory,
        signal: databaseSignal,
        state,
        environment: preflight.databaseEnvironment,
      }));
    } finally {
      await snapshotHolder.close();
    }
    ensureInterrupted(signal);

    const databaseArtifacts = Object.fromEntries(
      EXPECTED_ARTIFACTS.map((filename) => [filename, artifactMetadata(join(temporaryDirectory, filename))]),
    );
    const historyAnalysis = await analyzeCopyDumpFile(
      join(temporaryDirectory, "history-data.sql"),
      true,
    );
    const dataAnalysis = await analyzeCopyDumpFile(join(temporaryDirectory, "data.sql"));
    const ledger = historyAnalysis.ledger;
    const aggregates = dataAnalysis.aggregates;
    if (
      aggregates.storage_bucket_row_count !== preflight.storageBefore.bucket_count ||
      aggregates.storage_object_row_count !== preflight.storageBefore.object_count
    ) {
      fail("storage_database_inventory_mismatch");
    }
    const databaseManifest = Object.freeze({
      schema: DATABASE_SCHEMA,
      captured_at: timestamp,
      source_receipt: preflight.source,
      git: preflight.git,
      tools: preflight.tools,
      artifacts: databaseArtifacts,
      migration_ledger: ledger,
      data_copy_sections_sha256: dataAnalysis.copy_sections_sha256,
      stability: databaseStability,
      aggregates,
    });
    const databaseManifestPath = join(temporaryDirectory, "database-manifest.json");
    writePrivateJson(databaseManifestPath, databaseManifest);

    const blobDirectory = join(temporaryDirectory, "storage-blobs");
    const downloaded = await downloadStorageObjects({
      inventory: preflight.storageBefore,
      origin: preflight.origin,
      secretKey: secrets.EVO_PLATFORM_SUPABASE_SECRET_KEY,
      outputDirectory: blobDirectory,
      signal,
    });
    const storageAfter = await listStorageInventory(preflight.storageClient);
    if (preflight.storageBefore.sha256 !== storageAfter.sha256) fail("storage_inventory_drift");
    if (downloaded.totalBytes !== preflight.storageBefore.total_bytes) {
      fail("storage_byte_count_mismatch");
    }
    const storageManifest = Object.freeze({
      schema: STORAGE_SCHEMA,
      captured_at: timestamp,
      source_receipt_sha256: preflight.source.sha256,
      inventory_sha256: preflight.storageBefore.sha256,
      buckets: preflight.storageBefore.normalized.buckets,
      objects: downloaded.objects,
      aggregates: Object.freeze({
        bucket_count: preflight.storageBefore.bucket_count,
        private_bucket_count: preflight.storageBefore.private_bucket_count,
        public_bucket_count: preflight.storageBefore.public_bucket_count,
        object_count: preflight.storageBefore.object_count,
        total_bytes: preflight.storageBefore.total_bytes,
      }),
    });
    const storageManifestPath = join(temporaryDirectory, "storage-manifest.json");
    writePrivateJson(storageManifestPath, storageManifest);
    const storageArchivePath = join(temporaryDirectory, "storage-objects.tar");
    await spawnCommand(
      preflight.executables.tar.real,
      ["-cf", storageArchivePath, "-C", temporaryDirectory, "storage-blobs", "storage-manifest.json"],
      {
        cwd: root,
        environment: preflight.commandEnvironment,
        signal,
        state,
        code: "storage_archive_failed",
      },
    );
    chmodSync(storageArchivePath, 0o600);
    artifactMetadata(storageArchivePath);

    const plaintext = [
      ...EXPECTED_ARTIFACTS.map((filename) => [filename, join(temporaryDirectory, filename)]),
      ["database-manifest.json", databaseManifestPath],
      ["storage-manifest.json", storageManifestPath],
      ["storage-objects.tar", storageArchivePath],
    ];
    const encryptedArtifacts = {};
    for (const [name, source] of plaintext) {
      encryptedArtifacts[`${name}.age`] = await encryptArtifact({
        source,
        destination: join(partialDirectory, `${name}.age`),
        recipient: args.ageRecipient,
        cwd: root,
        signal,
        state,
        environment: preflight.commandEnvironment,
        executables: preflight.executables,
      });
    }

    const receipt = assertRedactedReceipt(Object.freeze({
      schema: RECEIPT_SCHEMA,
      captured_at: timestamp,
      git: preflight.git,
      source: Object.freeze({ identity_sha256: preflight.source.sha256 }),
      provider_backup: Object.freeze({
        id: preflight.source.backup.id,
        inserted_at: preflight.source.backup.inserted_at,
        status: preflight.source.backup.status,
        physical: preflight.source.backup.is_physical_backup,
      }),
      database: Object.freeze({
        postgres_major: Number(preflight.source.project.database.postgres_engine),
        migration_count: ledger.count,
        migration_min_version: ledger.min_version,
        migration_max_version: ledger.max_version,
        migration_copy_rows_sha256: ledger.copy_rows_sha256,
        data_copy_sections_sha256: dataAnalysis.copy_sections_sha256,
        stability_proof_sha256: databaseStability.proof_sha256,
        snapshot_mode: databaseStability.snapshot_mode,
        table_count: aggregates.table_count,
        row_count: aggregates.row_count,
        auth_user_count: aggregates.auth_user_count,
      }),
      storage: Object.freeze({
        inventory_sha256: preflight.storageBefore.sha256,
        bucket_count: preflight.storageBefore.bucket_count,
        private_bucket_count: preflight.storageBefore.private_bucket_count,
        public_bucket_count: preflight.storageBefore.public_bucket_count,
        object_count: preflight.storageBefore.object_count,
        total_bytes: preflight.storageBefore.total_bytes,
      }),
      encrypted_artifacts: Object.freeze(encryptedArtifacts),
      tools: preflight.tools,
      signature: Object.freeze({
        namespace: SIGNATURE_NAMESPACE,
        identity: SIGNATURE_IDENTITY,
        public_key_fingerprint: preflight.signingTrust.fingerprint,
        trust_root: "operator-held-external-public-key",
      }),
      result: "export_verified",
    }));
    const receiptPath = join(partialDirectory, "receipt.json");
    writePrivateJson(receiptPath, receipt);
    await signAndVerifyReceipt({
      receiptPath,
      signingKey: preflight.signing.privateKey,
      trustedPublicLine: preflight.signingTrust.publicLine,
      temporaryDirectory,
      signal,
      state,
      environment: preflight.commandEnvironment,
      executables: preflight.executables,
    });
    ensureInterrupted(signal);
    renameSync(partialDirectory, finalDirectory);
    partialDirectory = null;
    return Object.freeze({
      directory: finalDirectory,
      receipt_sha256: sha256(readFileSync(join(finalDirectory, "receipt.json"))),
    });
  } finally {
    try {
      cleanup();
    } finally {
      if (state.cleanup === cleanup) state.cleanup = parentCleanup;
    }
  }
}

export async function runManagedSupabaseExport(argv, environment = process.env) {
  if (environment[OPT_IN] !== OPT_IN_VALUE) fail("explicit_opt_in_required");
  const args = parseArgs(argv);
  const secrets = requireSecrets(environment);
  const operatorHome = validateOperatorHome(environment.HOME);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const abortController = new AbortController();
  const state = {
    cleanup: null,
    signal: null,
    signalCount: 0,
    terminators: new Set(),
    processGroups: new Set(),
  };
  const removeSignalHandlers = registerSignalCleanup(abortController, state);
  let runtimeDirectory;
  try {
    runtimeDirectory = realpathSync(
      mkdtempSync(join(tmpdir(), "evo-v3-managed-export-runtime-")),
    );
    chmodSync(runtimeDirectory, 0o700);
    writeFileSync(join(runtimeDirectory, RUN_MARKER), "managed-supabase-export-runtime\n", {
      mode: 0o600,
      flag: "wx",
    });
    const runtimeCleanup = () => {
      runCleanupActions(state, [() => {
        if (runtimeDirectory && existsSync(runtimeDirectory)) guardedRemove(runtimeDirectory);
      }]);
    };
    state.cleanup = runtimeCleanup;
    const preflight = await collectPreflight({
      args,
      root,
      runtimeDirectory,
      operatorHome,
      secrets,
      signal: abortController.signal,
      state,
    });
    if (args.command === "preflight") return redactedPreflight(preflight);
    return await executeExport({
      args,
      root,
      secrets,
      signal: abortController.signal,
      state,
      preflight,
    });
  } finally {
    try {
      state.cleanup?.();
    } finally {
      state.cleanup = null;
      removeSignalHandlers();
    }
  }
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isDirectRun()) {
  runManagedSupabaseExport(process.argv.slice(2))
    .then((result) => {
      if (result.result === "preflight_verified") {
        process.stdout.write(`${canonicalJson(result)}`);
      } else {
        process.stdout.write(`managed_supabase_export_ready=${result.directory}\n`);
        process.stdout.write(`receipt_sha256=${result.receipt_sha256}\n`);
      }
    })
    .catch((error) => {
      const code = error instanceof ManagedSupabaseExportError ? error.code : "unexpected_failure";
      process.stderr.write(`managed_supabase_export_failed=${code}\n`);
      process.exitCode = code === "export_interrupted" ? 130 : 1;
    });
}
