/**
 * PORT-9d: подготовка managed-хранения фото вузов (docs/PLAN_CHANGES.md).
 *
 * Три режима по идиоме scripts/configure-university-template-storage.mjs —
 * офлайн-план по умолчанию, явные --check/--apply:
 *   (без аргументов | --plan)  офлайн: полнота метаданных и деление записей
 *                              библиотеки на eligible/ineligible по лицензии;
 *   --check                    сеть, строго read-only: скачивает eligible-
 *                              оригиналы, проверяет 200 + image/* + размер,
 *                              считает sha256 и пишет манифест
 *                              scripts/portal/university-photos-manifest.json;
 *   --apply                    координатор: создаёт отсутствующий public-read
 *                              bucket через Storage API, пере-скачивает и
 *                              сверяет байты с манифестом, загружает их и
 *                              после readback ставит migrated=true.
 *
 * Креды — ТОЛЬКО из окружения и только для --apply:
 *   NEXT_PUBLIC_SUPABASE_URL            ровно https://iosckaqtovbbnssqcpde.supabase.co
 *   EVO_PLATFORM_SUPABASE_SECRET_KEY    sb_secret_* или service-role JWT
 * (контракт getPlatformSupabaseBackendConfig). Отсутствие/чужой проект —
 * отказ до какой-либо сети; plan и check работают без кредов вовсе.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformSupabaseBackendConfig } from "../../src/lib/server/platform-supabase-backend-config.ts";

export const UNIVERSITY_PHOTO_PROJECT = "iosckaqtovbbnssqcpde";
const ORIGIN = `https://${UNIVERSITY_PHOTO_PROJECT}.supabase.co`;
export const UNIVERSITY_PHOTO_BUCKET = Object.freeze({
  id: "portal-university-photos", name: "portal-university-photos",
  public: true, file_size_limit: 20 * 1024 * 1024,
  allowed_mime_types: Object.freeze(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]) });
export const UNIVERSITY_PHOTO_MANIFEST_SCHEMA = "evo-university-photos-manifest/v1";
export const UNIVERSITY_PHOTO_MANIFEST_FILE = "scripts/portal/university-photos-manifest.json";
/** Точные строки лицензий библиотеки, разрешающие копирование байтов к нам.
 * Неизвестная строка — ineligible по умолчанию (право не заявлено). */
export const REDISTRIBUTABLE_LICENSES = Object.freeze([
  "CC BY 3.0", "CC BY 3.0 pl", "CC BY 4.0",
  "CC BY-SA 2.0", "CC BY-SA 2.5", "CC BY-SA 3.0", "CC BY-SA 4.0",
  "CC0", "FAL", "Public domain", "Public domain (PD-self)", "Public domain (author release)",
]);
const EXTENSION_BY_TYPE = Object.freeze({ "image/avif": "avif", "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });
const MIN_BYTES = 1024, MAX_BYTES = UNIVERSITY_PHOTO_BUCKET.file_size_limit, DOWNLOAD_TIMEOUT_MS = 60_000;
const LIBRARY_URL = new URL("../../src/lib/university-photo-library.json", import.meta.url);
const MANIFEST_URL = new URL("./university-photos-manifest.json", import.meta.url);
const LIBRARY_FIELDS = Object.freeze(["path", "author", "title", "caption", "sourceUrl", "license", "licenseUrl"]);

class MigrationError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new MigrationError(code); };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function readUniversityPhotoLibrary() {
  const library = JSON.parse(readFileSync(LIBRARY_URL, "utf8"));
  if (library === null || typeof library !== "object" || Array.isArray(library)) fail("library_invalid");
  return library;
}
/** Полнота метаданных записи: непустые строки, https-ссылки, ключ по конвенции. */
export function libraryEntryProblems(key, entry) {
  const problems = [];
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key)) problems.push("key_format");
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [...problems, "entry_shape"];
  for (const field of LIBRARY_FIELDS) {
    const value = entry[field];
    if (typeof value !== "string" || value.trim().length === 0) problems.push(`${field}_missing`);
    else if (["path", "sourceUrl", "licenseUrl"].includes(field) && !value.startsWith("https://")) problems.push(`${field}_not_https`);
  }
  return problems;
}
export const licenseAllowsRedistribution = license => REDISTRIBUTABLE_LICENSES.includes(license);

export function planUniversityPhotoMigration(library) {
  const keys = Object.keys(library).sort();
  const invalid = [], eligible = [], ineligible = [];
  for (const key of keys) {
    const problems = libraryEntryProblems(key, library[key]);
    if (problems.length > 0) { invalid.push({ key, problems }); continue; }
    (licenseAllowsRedistribution(library[key].license) ? eligible : ineligible).push(key);
  }
  return { schema: "evo-university-photos-plan/v1", bucket: UNIVERSITY_PHOTO_BUCKET.id, projectRef: UNIVERSITY_PHOTO_PROJECT,
    totals: { entries: keys.length, eligible: eligible.length, ineligible: ineligible.length, invalid: invalid.length },
    eligible, ineligible: ineligible.map(key => ({ key, license: library[key].license })), invalid };
}

async function downloadPhoto(url, fetchImpl) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { redirect: "follow", cache: "no-store", signal: stop.signal,
      headers: { accept: "image/*", "user-agent": "evo-crm-university-photo-migration/1.0 (PORT-9d; contact: EVO admissions engineering)" } });
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); return { failure: `http_${response.status}` }; }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!Object.hasOwn(EXTENSION_BY_TYPE, contentType)) { void response.body?.cancel().catch(() => {}); return { failure: `unsupported_content_type:${contentType || "missing"}` }; }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BYTES) { void response.body?.cancel().catch(() => {}); return { failure: `size_over_limit:${declared}` }; }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength < MIN_BYTES) return { failure: `size_below_minimum:${bytes.byteLength}` };
    if (bytes.byteLength > MAX_BYTES) return { failure: `size_over_limit:${bytes.byteLength}` };
    return { bytes, contentType, finalUrl: response.url && response.url !== url ? response.url : null };
  } catch (error) {
    return { failure: stop.signal.aborted ? "timeout" : `network_error:${error?.name ?? "unknown"}` };
  } finally { clearTimeout(timer); stop.abort(); }
}

function readExistingManifest() {
  let raw;
  try { raw = readFileSync(MANIFEST_URL, "utf8"); } catch { return null; }
  try {
    const manifest = JSON.parse(raw);
    return manifest?.schema === UNIVERSITY_PHOTO_MANIFEST_SCHEMA && manifest.entries && typeof manifest.entries === "object" ? manifest : null;
  } catch { return null; }
}
function manifestTotals(entries) {
  const values = Object.values(entries);
  return { entries: values.length,
    verified: values.filter(entry => entry.status === "verified").length,
    ineligible: values.filter(entry => entry.status === "ineligible").length,
    failed: values.filter(entry => entry.status === "failed").length,
    migrated: values.filter(entry => entry.migrated === true).length };
}
const baseManifestEntry = record => ({ sourceUrl: record.path, finalUrl: null, pageUrl: record.sourceUrl,
  license: record.license, licenseUrl: record.licenseUrl, attribution: record.author,
  sha256: null, bytes: null, contentType: null, objectPath: null, status: "failed", reason: null, migrated: false });

export async function checkUniversityPhotoMigration({ library, fetchImpl = fetch, previous = null, concurrency = 4 } = {}) {
  const plan = planUniversityPhotoMigration(library);
  if (plan.totals.invalid > 0) return { exitCode: 1, report: { ...plan, status: "library_invalid" }, manifest: null };
  const entries = {};
  for (const { key } of plan.ineligible) {
    entries[key] = { ...baseManifestEntry(library[key]), status: "ineligible", reason: "license_not_redistributable" };
  }
  const queue = [...plan.eligible];
  const worker = async () => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      const record = library[key], result = await downloadPhoto(record.path, fetchImpl), entry = baseManifestEntry(record);
      if (result.failure) { entry.reason = result.failure; }
      else {
        entry.status = "verified"; entry.finalUrl = result.finalUrl;
        entry.sha256 = sha256(result.bytes); entry.bytes = result.bytes.byteLength;
        entry.contentType = result.contentType; entry.objectPath = `${key}.${EXTENSION_BY_TYPE[result.contentType]}`;
        const before = previous?.entries?.[key];
        if (before?.migrated === true) {
          if (before.sha256 === entry.sha256 && before.objectPath === entry.objectPath) entry.migrated = true;
          else entry.reason = "source_drifted_since_migration";
        }
      }
      entries[key] = entry;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  const sorted = Object.fromEntries(Object.keys(entries).sort().map(key => [key, entries[key]]));
  const manifest = { schema: UNIVERSITY_PHOTO_MANIFEST_SCHEMA, generatedAt: new Date().toISOString(),
    projectRef: UNIVERSITY_PHOTO_PROJECT, bucket: UNIVERSITY_PHOTO_BUCKET.id, source: "src/lib/university-photo-library.json",
    totals: manifestTotals(sorted), entries: sorted };
  return { exitCode: 0, report: { schema: "evo-university-photos-check/v1", status: "manifest_written", manifestFile: UNIVERSITY_PHOTO_MANIFEST_FILE, totals: manifest.totals,
    failed: Object.entries(sorted).filter(([, entry]) => entry.status === "failed").map(([key, entry]) => ({ key, reason: entry.reason })) }, manifest };
}

function settingsMatch(value) {
  return value?.id === UNIVERSITY_PHOTO_BUCKET.id && value.name === UNIVERSITY_PHOTO_BUCKET.name && value.public === true
    && value.file_size_limit === UNIVERSITY_PHOTO_BUCKET.file_size_limit && [undefined, "STANDARD"].includes(value.type)
    && Array.isArray(value.allowed_mime_types) && value.allowed_mime_types.length === UNIVERSITY_PHOTO_BUCKET.allowed_mime_types.length
    && [...value.allowed_mime_types].sort().every((mime, index) => mime === UNIVERSITY_PHOTO_BUCKET.allowed_mime_types[index]);
}
async function bucketRequest(method, path, headers, fetchImpl) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 10_000);
  try {
    const response = await fetchImpl(`${ORIGIN}/storage/v1/bucket${path}`, { method, headers, redirect: "error", cache: "no-store", signal: stop.signal,
      ...(method === "POST" ? { body: JSON.stringify(UNIVERSITY_PHOTO_BUCKET) } : {}) });
    if (response.status === 401 || response.status === 403) { void response.body?.cancel().catch(() => {}); fail("credentials_rejected"); }
    if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) { void response.body?.cancel().catch(() => {}); fail("response_invalid"); }
    let body; try { body = JSON.parse(Buffer.from(await response.arrayBuffer()).toString("utf8")); } catch { fail("response_invalid"); }
    return { status: response.status, body };
  } finally { clearTimeout(timer); stop.abort(); }
}
/** Создание строго по идиоме configure-university-template-storage.mjs:
 * существующий bucket с иными настройками — конфликт, никогда не перезапись. */
async function ensureBucket(headers, fetchImpl, report) {
  const read = () => bucketRequest("GET", `/${UNIVERSITY_PHOTO_BUCKET.id}`, headers, fetchImpl);
  const current = await read();
  if (current.status === 200) { if (!settingsMatch(current.body)) fail("bucket_settings_conflict"); report.bucketStatus = "ready"; return; }
  const legacyMissing = current.status === 400 && current.body?.statusCode === "404"
    && current.body.code === "NoSuchBucket" && current.body.error === "Bucket not found"
    && current.body.message === "Bucket not found" && Object.keys(current.body).length === 4;
  if (!legacyMissing && (current.status !== 404 || current.body?.code !== "NoSuchBucket")) fail("bucket_read_failed");
  report.mutationAttempted = true;
  const created = await bucketRequest("POST", "", headers, fetchImpl);
  if (created.status === 409) fail("bucket_create_conflict");
  if (![200, 201].includes(created.status) || created.body?.name !== UNIVERSITY_PHOTO_BUCKET.name) fail("bucket_create_outcome_unknown");
  const after = await read();
  if (after.status !== 200 || !settingsMatch(after.body)) fail("bucket_readback_failed");
  report.bucketStatus = "created_and_verified";
}
export const universityPhotoPublicUrl = objectPath =>
  `${ORIGIN}/storage/v1/object/public/${UNIVERSITY_PHOTO_BUCKET.id}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;

async function uploadVerifiedEntry(key, entry, headers, fetchImpl) {
  const source = await downloadPhoto(entry.sourceUrl, fetchImpl);
  if (source.failure) return `redownload_failed:${source.failure}`;
  if (sha256(source.bytes) !== entry.sha256) return "content_drifted";
  const readback = async () => {
    const result = await downloadPhoto(universityPhotoPublicUrl(entry.objectPath), fetchImpl);
    return !result.failure && sha256(result.bytes) === entry.sha256 ? null : "readback_mismatch";
  };
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${ORIGIN}/storage/v1/object/${UNIVERSITY_PHOTO_BUCKET.id}/${entry.objectPath}`, {
      method: "POST", redirect: "error", cache: "no-store", signal: stop.signal, body: source.bytes,
      headers: { ...headers, "content-type": entry.contentType, "x-upsert": "false", "cache-control": "max-age=604800" } });
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) fail("credentials_rejected");
    // 409/400 Duplicate: объект уже есть — принимаем только байт-идентичный.
    if ([200, 201].includes(response.status) || [400, 409].includes(response.status)) {
      const mismatch = await readback();
      if (mismatch && [200, 201].includes(response.status)) return "readback_mismatch";
      return mismatch ? "upload_rejected_or_object_conflict" : null;
    }
    return `upload_http_${response.status}`;
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    return stop.signal.aborted ? "upload_timeout" : "upload_network_error";
  } finally { clearTimeout(timer); stop.abort(); }
}

export async function applyUniversityPhotoMigration({ environment = process.env, fetchImpl = fetch, manifest } = {}) {
  const report = { schema: "evo-university-photos-apply/v1", status: "failed", bucketStatus: "unknown", mutationAttempted: false,
    uploaded: [], alreadyMigrated: [], failures: [] };
  if (manifest?.schema !== UNIVERSITY_PHOTO_MANIFEST_SCHEMA || manifest.entries === null || typeof manifest.entries !== "object") {
    return { exitCode: 1, report: { ...report, status: "manifest_missing_run_check_first" }, manifest: null };
  }
  try {
    let config; try { config = getPlatformSupabaseBackendConfig(environment); } catch { fail("configuration_invalid"); }
    if (config.supabaseUrl !== ORIGIN) fail("project_mismatch");
    const key = config.supabaseSecretKey, headers = { apikey: key, accept: "application/json" };
    if (!key.startsWith("sb_secret_")) {
      try { if (JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).ref !== UNIVERSITY_PHOTO_PROJECT) fail("credential_invalid"); }
      catch (error) { fail(error instanceof MigrationError ? error.code : "credential_invalid"); }
      headers.Authorization = `Bearer ${key}`;
    }
    await ensureBucket({ ...headers, "content-type": "application/json" }, fetchImpl, report);
    const entries = { ...manifest.entries };
    for (const [photoKey, entry] of Object.entries(entries)) {
      if (entry.status !== "verified") continue;
      if (entry.migrated === true) { report.alreadyMigrated.push(photoKey); continue; }
      const failure = await uploadVerifiedEntry(photoKey, entry, headers, fetchImpl);
      if (failure === null) { entries[photoKey] = { ...entry, migrated: true, reason: null }; report.uploaded.push(photoKey); }
      else { entries[photoKey] = { ...entry, status: "failed", migrated: false, reason: failure }; report.failures.push({ key: photoKey, reason: failure }); }
    }
    const next = { ...manifest, generatedAt: new Date().toISOString(), totals: manifestTotals(entries), entries };
    report.status = report.failures.length === 0 ? "applied" : "applied_with_failures";
    return { exitCode: report.failures.length === 0 ? 0 : 1, report: { ...report, totals: next.totals }, manifest: next };
  } catch (error) {
    return { exitCode: 1, report: { ...report, status: error instanceof MigrationError ? error.code : "request_failed" }, manifest: null };
  }
}

export async function runUniversityPhotoMigrationCli(argv, options = {}) {
  const write = options.write ?? (value => process.stdout.write(value));
  if (argv.length === 1 && argv[0] === "--help") {
    write("Usage: node --conditions=react-server --experimental-strip-types scripts/portal/migrate-university-photos.mjs [--plan|--check|--apply]\n"
      + "Default: offline plan (no network, no credentials). --check is network read-only and writes the manifest;\n"
      + "--apply needs NEXT_PUBLIC_SUPABASE_URL + EVO_PLATFORM_SUPABASE_SECRET_KEY in the environment only.\n");
    return 0;
  }
  if (argv.length > 1 || (argv.length === 1 && !["--plan", "--check", "--apply"].includes(argv[0]))) {
    write('{"schema":"evo-university-photos-plan/v1","status":"arguments_invalid"}\n'); return 1;
  }
  const mode = argv[0] === "--apply" ? "apply" : argv[0] === "--check" ? "check" : "plan";
  let library; try { library = readUniversityPhotoLibrary(); } catch { write('{"status":"library_invalid"}\n'); return 1; }
  if (mode === "plan") {
    const plan = planUniversityPhotoMigration(library);
    write(`${JSON.stringify(plan)}\n`); return plan.totals.invalid === 0 ? 0 : 1;
  }
  const writeManifest = options.writeManifest
    ?? (manifest => writeFileSync(MANIFEST_URL, `${JSON.stringify(manifest, null, 2)}\n`));
  if (mode === "check") {
    const result = await checkUniversityPhotoMigration({ library, ...options });
    if (result.manifest) writeManifest(result.manifest);
    write(`${JSON.stringify(result.report)}\n`); return result.exitCode;
  }
  const result = await applyUniversityPhotoMigration({ ...options, manifest: options.manifest ?? readExistingManifest() });
  if (result.manifest) writeManifest(result.manifest);
  write(`${JSON.stringify(result.report)}\n`); return result.exitCode;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runUniversityPhotoMigrationCli(process.argv.slice(2), { previous: readExistingManifest() });
}
