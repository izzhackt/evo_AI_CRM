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
import { createHash, randomUUID } from "node:crypto";
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
  readFileSync,
  realpathSync,
  renameSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
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

function validateSigningKey(path) {
  const canonical = canonicalExistingPath(path, "signing_key_invalid");
  const metadata = statSync(canonical);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) fail("signing_key_invalid");
  const publicPath = `${canonical}.pub`;
  const canonicalPublic = canonicalExistingPath(publicPath, "signing_public_key_invalid");
  if (!statSync(canonicalPublic).isFile()) fail("signing_public_key_invalid");
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
  return Object.freeze({
    ref,
    organization_id: requiredString(
      project.organization_id,
      "management_project_invalid",
      256,
    ),
    name: requiredString(project.name, "management_project_invalid", 512),
    region: requiredString(project.region, "management_project_invalid", 128),
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
  const size = Number(metadata?.size ?? 0);
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

function artifactMetadata(path) {
  const metadata = statSync(path);
  if (!metadata.isFile() || metadata.size <= 0) fail("artifact_invalid");
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

function spawnCommand(command, args, {
  cwd,
  environment = process.env,
  signal,
  input = null,
  captureStdout = false,
  code = "command_failed",
  timeoutMs = COMMAND_TIMEOUT_MS,
  state,
} = {}) {
  return new Promise((accept, reject) => {
    if (signal?.aborted) {
      reject(new ManagedSupabaseExportError("export_interrupted"));
      return;
    }
    const stdout = limitedCollector();
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: [input == null ? "ignore" : "pipe", captureStdout ? "pipe" : "ignore", "ignore"],
    });
    if (state) state.child = child;
    let finished = false;
    const timeout = setTimeout(() => {
      if (!finished) child.kill("SIGTERM");
    }, timeoutMs);
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    if (captureStdout) {
      child.stdout.on("data", (chunk) => {
        try {
          stdout.push(chunk);
        } catch {
          child.kill("SIGTERM");
        }
      });
    }
    if (input != null) child.stdin.end(input);
    child.once("error", () => {
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (state?.child === child) state.child = null;
      reject(new ManagedSupabaseExportError(code));
    });
    child.once("close", (status, childSignal) => {
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (state?.child === child) state.child = null;
      if (signal?.aborted || childSignal) {
        reject(new ManagedSupabaseExportError("export_interrupted"));
      } else if (status !== 0) {
        reject(new ManagedSupabaseExportError(code));
      } else {
        accept(stdout.value());
      }
    });
  });
}

function registerSignalCleanup(abortController, state) {
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      state.signal = signal;
      abortController.abort(new ManagedSupabaseExportError("export_interrupted"));
      state.child?.kill("SIGTERM");
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

function guardedRemove(path) {
  if (!path || !isAbsolute(path) || !existsSync(path)) return;
  const canonical = realpathSync(path);
  if (!basename(canonical).startsWith("evo-v3-managed-export-")) fail("cleanup_target_invalid");
  const marker = join(canonical, RUN_MARKER);
  if (!existsSync(marker) || !lstatSync(marker).isFile()) fail("cleanup_target_invalid");
  rmSync(canonical, { recursive: true, force: false });
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

async function downloadStorageObjects({
  inventory,
  origin,
  secretKey,
  outputDirectory,
  signal,
}) {
  mkdirSync(outputDirectory, { mode: 0o700 });
  const downloaded = [];
  let totalBytes = 0;
  for (const [index, item] of inventory.normalized.objects.entries()) {
    if (signal.aborted) fail("export_interrupted");
    const filename = `${String(index).padStart(8, "0")}.bin`;
    const output = join(outputDirectory, filename);
    const url = `${origin}/storage/v1/object/authenticated/${encodeURIComponent(item.bucket_id)}/${encodedObjectPath(item.path)}`;
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
        },
        redirect: "error",
        signal: combineSignals(signal, REQUEST_TIMEOUT_MS),
      });
    } catch {
      fail("storage_object_download_failed");
    }
    if (!response.ok || !response.body) {
      try {
        await response.body?.cancel();
      } catch {
        // The body is deliberately discarded.
      }
      fail("storage_object_download_failed");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? item.size);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_STORAGE_OBJECT_BYTES
    ) {
      fail("storage_object_size_invalid");
    }
    const writer = createWriteStream(output, { flags: "wx", mode: 0o600 });
    try {
      await pipeline(Readable.fromWeb(response.body), writer, { signal });
    } catch {
      fail("storage_object_download_failed");
    }
    const metadata = artifactMetadata(output);
    if (metadata.bytes !== item.size) fail("storage_object_size_mismatch");
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
  return Object.freeze({
    project,
    backup,
    sha256: sha256(canonicalJson({ project, backup })),
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

function safeCommandEnvironment(secrets = null) {
  const environment = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? tmpdir(),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: "C.UTF-8",
    LC_ALL: "C",
    DOCKER_CONTEXT: "orbstack",
  };
  if (secrets) {
    environment.SUPABASE_ACCESS_TOKEN = secrets.SUPABASE_ACCESS_TOKEN;
    environment.SUPABASE_DB_PASSWORD = secrets.SUPABASE_DB_PASSWORD;
  }
  return environment;
}

async function toolEvidence(root, signal, state, commandEnvironment) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const expectedSupabase = packageJson.devDependencies?.supabase;
  if (expectedSupabase !== "2.116.0") fail("supabase_cli_not_pinned");
  const cliLink = join(root, "node_modules", ".bin", "supabase");
  if (!existsSync(cliLink)) fail("supabase_cli_missing");
  const cli = realpathSync(cliLink);
  const nodeModulesRoot = realpathSync(join(root, "node_modules"));
  if (!isInside(nodeModulesRoot, cli)) fail("supabase_cli_invalid");
  const supabaseVersion = (
    await spawnCommand(cli, ["--version"], {
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
  const orbStatus = (
    await spawnCommand("orb", ["status"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "orbstack_unavailable",
      timeoutMs: 10_000,
    })
  ).trim();
  if (orbStatus !== "Running") fail("orbstack_unavailable");
  const dockerContext = (
    await spawnCommand("docker", ["context", "show"], {
      cwd: root,
      environment: commandEnvironment,
      signal,
      state,
      captureStdout: true,
      code: "docker_context_invalid",
      timeoutMs: 10_000,
    })
  ).trim();
  if (dockerContext !== "orbstack") fail("docker_context_invalid");
  const ageVersion = (
    await spawnCommand("age", ["--version"], {
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
    await spawnCommand("ssh", ["-V"], {
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
    age: requiredString(ageVersion, "age_unavailable", 256),
    ssh: sshVersion,
    orb: orbStatus,
    docker_context: dockerContext,
  });
}

async function repositoryEvidence(root, signal, state, commandEnvironment) {
  const head = (
    await spawnCommand("git", ["rev-parse", "HEAD"], {
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
    await spawnCommand("git", ["rev-parse", "HEAD:supabase/migrations"], {
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
  const status = await spawnCommand("git", ["status", "--porcelain"], {
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

async function dumpDatabase({ root, cli, projectRef, staging, signal, state, environment }) {
  const commands = Object.freeze([
    ["roles.sql", ["--role-only"]],
    ["schema.sql", []],
    ["data.sql", ["--data-only", "--use-copy", "--exclude", "storage.buckets_vectors", "--exclude", "storage.vector_indexes"]],
    ["history-schema.sql", ["--schema", "supabase_migrations"]],
    ["history-data.sql", ["--schema", "supabase_migrations", "--data-only", "--use-copy"]],
  ]);
  for (const [filename, extra] of commands) {
    const output = join(staging, filename);
    await spawnCommand(
      cli,
      [
        "--log-level",
        "error",
        "db",
        "dump",
        "--project-ref",
        projectRef,
        "--file",
        output,
        ...extra,
      ],
      {
        cwd: root,
        environment,
        signal,
        state,
        code: `database_dump_${filename.replaceAll(/[^a-z]+/gu, "_")}_failed`,
      },
    );
    chmodSync(output, 0o600);
    artifactMetadata(output);
  }
}

async function verifyDatabaseSnapshotStable({
  root,
  cli,
  projectRef,
  staging,
  signal,
  state,
  environment,
}) {
  const verification = join(staging, "database-stability");
  mkdirSync(verification, { mode: 0o700 });
  const checks = Object.freeze([
    ["data.sql", ["--data-only", "--use-copy", "--exclude", "storage.buckets_vectors", "--exclude", "storage.vector_indexes"]],
    ["history-data.sql", ["--schema", "supabase_migrations", "--data-only", "--use-copy"]],
  ]);
  for (const [filename, extra] of checks) {
    const output = join(verification, filename);
    await spawnCommand(
      cli,
      [
        "--log-level",
        "error",
        "db",
        "dump",
        "--project-ref",
        projectRef,
        "--file",
        output,
        ...extra,
      ],
      {
        cwd: root,
        environment,
        signal,
        state,
        code: "database_stability_check_failed",
      },
    );
    artifactMetadata(output);
    const first = await analyzeCopyDumpFile(
      join(staging, filename),
      filename === "history-data.sql",
    );
    const second = await analyzeCopyDumpFile(output, filename === "history-data.sql");
    if (first.copy_sections_sha256 !== second.copy_sections_sha256) {
      fail("database_snapshot_drift");
    }
  }
  rmSync(verification, { recursive: true, force: false });
}

async function encryptArtifact({ source, destination, recipient, cwd, signal, state, environment }) {
  await spawnCommand(
    "age",
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

async function signingFingerprint(publicKey, cwd, signal, state, environment) {
  const output = await spawnCommand(
    "ssh-keygen",
    ["-lf", publicKey, "-E", "sha256"],
    {
      cwd,
      environment,
      signal,
      state,
      captureStdout: true,
      code: "signing_key_fingerprint_failed",
      timeoutMs: 10_000,
    },
  );
  const match = /\b(SHA256:[A-Za-z0-9+/]+)\b/u.exec(output);
  if (!match) fail("signing_key_fingerprint_failed");
  return match[1];
}

async function signAndVerifyReceipt({
  receiptPath,
  signingKey,
  publicKey,
  temporaryDirectory,
  signal,
  state,
  environment,
}) {
  await spawnCommand(
    "ssh-keygen",
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
  const publicLine = readFileSync(publicKey, "utf8").trim();
  if (!/^(?:ssh-ed25519|ecdsa-sha2-nistp256|sk-ssh-ed25519@openssh\.com)\s+[A-Za-z0-9+/=]+(?:\s+.*)?$/u.test(publicLine)) {
    fail("signing_public_key_invalid");
  }
  const allowedSigners = join(temporaryDirectory, "allowed_signers");
  writeFileSync(allowedSigners, `${SIGNATURE_IDENTITY} ${publicLine}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await spawnCommand(
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
      environment,
      signal,
      state,
      input: readFileSync(receiptPath),
      code: "receipt_signature_verification_failed",
      timeoutMs: 30_000,
    },
  );
  const publishedPublicKey = join(dirname(receiptPath), "receipt-signing-key.pub");
  writeFileSync(publishedPublicKey, `${publicLine}\n`, { mode: 0o600, flag: "wx" });
  return Object.freeze({
    signature: artifactMetadata(signaturePath),
    public_key: artifactMetadata(publishedPublicKey),
  });
}

function writePrivateJson(path, value) {
  writeFileSync(path, canonicalJson(value), { mode: 0o600, flag: "wx" });
  return artifactMetadata(path);
}

function ensureInterrupted(signal) {
  if (signal.aborted) fail("export_interrupted");
}

async function collectPreflight({ args, root, secrets, signal, state }) {
  const commandEnvironment = safeCommandEnvironment(secrets);
  const signing = validateSigningKey(args.signingKey);
  const outputRoot = validateOutputRoot(args.outputRoot, root);
  const [tools, git, source] = await Promise.all([
    toolEvidence(root, signal, state, commandEnvironment),
    repositoryEvidence(root, signal, state, commandEnvironment),
    managementReceipt(args.projectRef, secrets.SUPABASE_ACCESS_TOKEN, signal, Date.now()),
  ]);
  ensureInterrupted(signal);
  await verifyProjectKeys(
    args.projectRef,
    secrets.EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY,
    secrets.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    signal,
  );
  const { createClient } = await import("@supabase/supabase-js");
  const origin = `https://${args.projectRef}.supabase.co`;
  const storageClient = createClient(origin, secrets.EVO_PLATFORM_SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: combineSignals(signal, REQUEST_TIMEOUT_MS) }) },
  }).storage;
  const storageBefore = await listStorageInventory(storageClient);
  return Object.freeze({
    outputRoot,
    signing,
    tools,
    git,
    source,
    origin,
    storageClient,
    storageBefore,
    commandEnvironment,
    cli: realpathSync(join(root, "node_modules", ".bin", "supabase")),
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
  try {
    mkdirSync(partialDirectory, { mode: 0o700 });
    writeFileSync(join(partialDirectory, RUN_MARKER), "managed-supabase-export\n", {
      mode: 0o600,
      flag: "wx",
    });
    temporaryDirectory = mkdtempSync(join(tmpdir(), "evo-v3-managed-export-"));
    chmodSync(temporaryDirectory, 0o700);
    writeFileSync(join(temporaryDirectory, RUN_MARKER), "managed-supabase-export\n", {
      mode: 0o600,
      flag: "wx",
    });

    await dumpDatabase({
      root,
      cli: preflight.cli,
      projectRef: args.projectRef,
      staging: temporaryDirectory,
      signal,
      state,
      environment: preflight.commandEnvironment,
    });
    await verifyDatabaseSnapshotStable({
      root,
      cli: preflight.cli,
      projectRef: args.projectRef,
      staging: temporaryDirectory,
      signal,
      state,
      environment: preflight.commandEnvironment,
    });
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
      "tar",
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
      });
    }

    const fingerprint = await signingFingerprint(
      preflight.signing.publicKey,
      root,
      signal,
      state,
      preflight.commandEnvironment,
    );
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
        public_key_fingerprint: fingerprint,
      }),
      result: "export_verified",
    }));
    const receiptPath = join(partialDirectory, "receipt.json");
    writePrivateJson(receiptPath, receipt);
    await signAndVerifyReceipt({
      receiptPath,
      signingKey: preflight.signing.privateKey,
      publicKey: preflight.signing.publicKey,
      temporaryDirectory,
      signal,
      state,
      environment: preflight.commandEnvironment,
    });
    ensureInterrupted(signal);
    renameSync(partialDirectory, finalDirectory);
    partialDirectory = null;
    return Object.freeze({
      directory: finalDirectory,
      receipt_sha256: sha256(readFileSync(join(finalDirectory, "receipt.json"))),
    });
  } finally {
    if (temporaryDirectory && existsSync(temporaryDirectory)) guardedRemove(temporaryDirectory);
    if (partialDirectory && existsSync(partialDirectory)) guardedRemove(partialDirectory);
  }
}

export async function runManagedSupabaseExport(argv, environment = process.env) {
  if (environment[OPT_IN] !== OPT_IN_VALUE) fail("explicit_opt_in_required");
  const args = parseArgs(argv);
  const secrets = requireSecrets(environment);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const abortController = new AbortController();
  const state = { child: null, signal: null };
  const removeSignalHandlers = registerSignalCleanup(abortController, state);
  try {
    const preflight = await collectPreflight({
      args,
      root,
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
    removeSignalHandlers();
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
