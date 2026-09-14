import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOCUMENT_EXPORT_STORAGE_PROJECT = "iosckaqtovbbnssqcpde";
export const DOCUMENT_EXPORT_STORAGE_ORIGIN = `https://${DOCUMENT_EXPORT_STORAGE_PROJECT}.supabase.co`;
export const DOCUMENT_EXPORT_BUCKET = Object.freeze({
  id: "platform-document-exports",
  name: "platform-document-exports",
  public: false,
  file_size_limit: 5 * 1024 * 1024,
  allowed_mime_types: Object.freeze(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
});
const MIME = DOCUMENT_EXPORT_BUCKET.allowed_mime_types[0];
export const UNIVERSITY_FORM_EXPORT_BUCKET = Object.freeze({ ...DOCUMENT_EXPORT_BUCKET,
  file_size_limit: 20 * 1024 * 1024, allowed_mime_types: Object.freeze([MIME, "application/pdf"]),
});
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const BUCKET_PATH = `/storage/v1/bucket/${DOCUMENT_EXPORT_BUCKET.id}`;

class ConfigurationError extends Error {
  constructor(code) { super(code); this.name = "DocumentExportStorageConfigurationError"; this.code = code; }
}
const fail = code => { throw new ConfigurationError(code); };
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function parseDocumentExportStorageArgs(argv) {
  if (argv.length === 0) return { apply: false, help: false };
  if (argv.length === 1 && argv[0] === "--apply") return { apply: true, help: false };
  if (argv.length === 1 && argv[0] === "--help") return { apply: false, help: true };
  if (argv.includes("--university-forms") && new Set(argv).size === argv.length
    && argv.every(value => value === "--apply" || value === "--university-forms"))
    return { apply: argv.includes("--apply"), help: false, universityForms: true };
  fail("arguments_invalid");
}

function configuration(environment) {
  const rawUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  // No configurable host/path/bucket, redirects or credential-valued arguments.
  if (rawUrl !== DOCUMENT_EXPORT_STORAGE_ORIGIN && rawUrl !== `${DOCUMENT_EXPORT_STORAGE_ORIGIN}/`) fail("project_mismatch");
  const key = environment.EVO_PLATFORM_SUPABASE_SECRET_KEY;
  if (typeof key !== "string" || key.length > 4096) fail("credential_invalid");
  const headers = { apikey: key, "content-type": "application/json", accept: "application/json" };
  if (/^sb_secret_[A-Za-z0-9_-]{16,}$/u.test(key)) return headers;
  try {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(key)) fail("credential_invalid");
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    if (payload?.role !== "service_role" || payload.ref !== DOCUMENT_EXPORT_STORAGE_PROJECT) fail("credential_invalid");
  } catch { fail("credential_invalid"); }
  // Shape/project checks are not JWT signature verification; the server verifies it.
  headers.Authorization = `Bearer ${key}`;
  return headers;
}

function bucketSettings(value) {
  if (!isRecord(value) || value.id !== DOCUMENT_EXPORT_BUCKET.id || value.name !== DOCUMENT_EXPORT_BUCKET.name
    || typeof value.public !== "boolean"
    || !(value.file_size_limit === null || (Number.isSafeInteger(value.file_size_limit) && value.file_size_limit >= 0))
    || !(value.allowed_mime_types === null || (Array.isArray(value.allowed_mime_types) && value.allowed_mime_types.length <= 64
      && value.allowed_mime_types.every(mime => typeof mime === "string" && mime.length <= 256)))) fail("bucket_response_invalid");
  return {
    ...DOCUMENT_EXPORT_BUCKET, public: value.public, file_size_limit: value.file_size_limit,
    allowed_mime_types: value.allowed_mime_types === null ? null : value.allowed_mime_types.map(mime =>
      UNIVERSITY_FORM_EXPORT_BUCKET.allowed_mime_types.includes(mime) ? mime : "OTHER_MIME").sort(),
    type: value.type === undefined || value.type === "STANDARD" ? "STANDARD" : "OTHER_TYPE",
  };
}

function settingsMatch(value, expected = DOCUMENT_EXPORT_BUCKET) {
  return value !== null && value.public === false && value.file_size_limit === expected.file_size_limit
    && value.type === "STANDARD" && JSON.stringify(value.allowed_mime_types) === JSON.stringify([...expected.allowed_mime_types].sort());
}

async function request(path, method, headers, fetchImpl, payload = DOCUMENT_EXPORT_BUCKET) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let reader;
  try {
    const response = await fetchImpl(`${DOCUMENT_EXPORT_STORAGE_ORIGIN}${path}`, {
      method, headers, redirect: "error", cache: "no-store", signal: controller.signal,
      ...(["POST", "PUT"].includes(method) ? { body: JSON.stringify(payload) } : {}),
    });
    if (response.status === 401 || response.status === 403) fail("credentials_rejected");
    if (response.status >= 300 && response.status < 400) fail("redirect_rejected");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) fail("response_invalid");
    if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) fail("response_invalid");
    if (!response.body) fail("response_invalid");
    reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { controller.abort(); fail("response_invalid"); }
      chunks.push(value);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { fail("response_invalid"); }
    return { status: response.status, body };
  } finally {
    controller.abort();
    clearTimeout(timeout);
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

async function readBucket(headers, fetchImpl) {
  const { status, body } = await request(BUCKET_PATH, "GET", headers, fetchImpl);
  if (status === 404 && body?.code === "NoSuchBucket") return null;
  if (status !== 200) fail("bucket_read_failed");
  return bucketSettings(body);
}

export async function configureDocumentExportStorage({ apply = false, universityForms = false, environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const report = {
    schema: "evo-document-export-storage/v1", mode: apply === true ? "apply" : "check",
    projectRef: DOCUMENT_EXPORT_STORAGE_PROJECT, bucket: DOCUMENT_EXPORT_BUCKET.id,
    status: "not_checked", before: null, after: null, mutationAttempted: false,
    readbackVerified: false, globalLimitVerified: false, artifactAcceptance: false,
  };
  let stage = "configuration";
  try {
    if (typeof apply !== "boolean" || typeof universityForms !== "boolean" || !isRecord(environment) || typeof fetchImpl !== "function") fail("arguments_invalid");
    const expected = universityForms ? UNIVERSITY_FORM_EXPORT_BUCKET : DOCUMENT_EXPORT_BUCKET;
    const headers = configuration(environment);
    stage = "before_read";
    report.before = await readBucket(headers, fetchImpl);
    if (report.before !== null) {
      report.after = report.before;
      if (!settingsMatch(report.before, expected)) {
        if (!universityForms || !settingsMatch(report.before)) fail("bucket_settings_conflict");
        if (!apply) fail("university_forms_upgrade_required");
        // Exactly the known D2 bucket, with no object, policy or public-access change.
        stage = "update"; report.mutationAttempted = true;
        const updated = await request(BUCKET_PATH, "PUT", headers, fetchImpl, expected);
        if (updated.status !== 200) fail("update_outcome_unknown");
        stage = "after_read"; report.after = await readBucket(headers, fetchImpl);
        if (!settingsMatch(report.after, expected)) fail("readback_failed");
        report.readbackVerified = true; report.status = "updated_and_verified";
        return { exitCode: 0, report };
      }
      report.readbackVerified = true; report.status = "ready";
      return { exitCode: 0, report };
    }
    if (!apply) fail("bucket_missing");
    // A single create only. No retry, policy changes or object access.
    stage = "create"; report.mutationAttempted = true;
    const created = await request("/storage/v1/bucket", "POST", headers, fetchImpl, expected);
    if (created.status === 409) fail("create_conflict");
    if (![200, 201].includes(created.status) || created.body?.name !== DOCUMENT_EXPORT_BUCKET.name) fail("create_outcome_unknown");
    stage = "after_read";
    report.after = await readBucket(headers, fetchImpl);
    if (!settingsMatch(report.after, expected)) fail("readback_failed");
    report.readbackVerified = true; report.status = "created_and_verified";
    return { exitCode: 0, report };
  } catch (error) {
    const code = error instanceof ConfigurationError ? error.code : "request_failed";
    report.status = stage === "create" && !["credentials_rejected", "create_conflict"].includes(code)
      ? "create_outcome_unknown" : stage === "update" && code !== "credentials_rejected"
        ? "update_outcome_unknown" : stage === "after_read" && code !== "credentials_rejected"
        ? "readback_failed" : code;
    return { exitCode: 1, report };
  }
}

export async function runDocumentExportStorageCli(argv, options = {}) {
  const write = options.write ?? (text => process.stdout.write(text));
  try {
    const args = parseDocumentExportStorageArgs(argv);
    if (args.help) {
      write("Usage: node scripts/configure-document-export-storage.mjs [--apply] [--university-forms]\nDefault: check only; --apply creates the absent exact private DOCX 5MiB bucket.\n--university-forms targets private DOCX/PDF 20MiB; with --apply it may upgrade only the exact former DOCX 5MiB bucket.\n");
      return 0;
    }
    const result = await configureDocumentExportStorage({ ...options, apply: args.apply, universityForms: args.universityForms ?? false });
    write(`${JSON.stringify(result.report)}\n`);
    return result.exitCode;
  } catch {
    write(`${JSON.stringify({ schema: "evo-document-export-storage/v1", status: "arguments_invalid" })}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDocumentExportStorageCli(process.argv.slice(2));
}
