#!/usr/bin/env node
/**
 * Загрузка фото стран и городов (сид 283) в существующий публичный бакет
 * portal-university-photos под префиксом geography/. По образцу
 * scripts/portal/migrate-university-photos.mjs:
 *
 *   (по умолчанию | --plan)  офлайн: список файлов, путей и sha256 из входов
 *                            сида (scripts/catalog/geography-seed-lib.mjs);
 *                            ни сети, ни ключей;
 *   --check                  сеть, только чтение публичных адресов: какие
 *                            объекты уже есть и совпадают ли байты;
 *   --apply                  загрузка отсутствующих объектов (x-upsert: false),
 *                            затем чтение обратно и сверка sha256.
 *
 * Идемпотентно по sha256: путь объекта содержит 12 знаков sha256 файла, тот
 * же файл всегда идёт в тот же путь; объект с теми же байтами пропускается,
 * объект с другими байтами по тому же пути это конфликт, перезаписи нет.
 *
 * Адрес и ключ только из окружения, в вывод не попадают:
 *   NEXT_PUBLIC_SUPABASE_URL          https://<ref>.supabase.co или
 *                                     http://127.0.0.1:<порт> (локальный стек);
 *   EVO_PLATFORM_SUPABASE_SECRET_KEY  sb_secret_* или JWT service_role (только --apply).
 * Папка сида: --seed-dir или EVO_GEOGRAPHY_SEED_DIR.
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PHOTO_BUCKET, REPO_ROOT, SeedError, loadGeographySeed, sha256 } from "./geography-seed-lib.mjs";
import { SELFHOSTED_SUPABASE_ORIGIN } from "../lib/evo-supabase-target.mjs";

const TIMEOUT_MS = 60_000;

class UploadError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = (code) => { throw new UploadError(code); };

/** Только проект Supabase или локальный стек; возвращает origin и вид цели без адреса. */
export function readTarget(environment) {
  const raw = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) fail("missing_supabase_url");
  let url;
  try { url = new URL(raw); } catch { fail("invalid_supabase_url"); }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) fail("invalid_supabase_url");
  const project = /^([a-z0-9]{20})\.supabase\.co$/u.exec(url.hostname);
  if (url.protocol === "https:" && project && !url.port) return { origin: url.origin, kind: `supabase-project ${project[1]}` };
  // Exactly the self-hosted stack (docs/runbooks/selfhosted-cutover.md); the cloud branch above goes after the cutover (#1271).
  if (url.origin === SELFHOSTED_SUPABASE_ORIGIN) return { origin: url.origin, kind: "supabase-selfhosted" };
  if (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port) return { origin: url.origin, kind: "local-stack" };
  fail("unsupported_supabase_url");
}

export function readServiceHeaders(environment) {
  const key = environment.EVO_PLATFORM_SUPABASE_SECRET_KEY;
  if (!key || key.length > 4096 || /\s/u.test(key)) fail("missing_secret_key");
  if (/^sb_secret_[A-Za-z0-9_-]{16,}$/u.test(key)) return { apikey: key };
  let role = null;
  try { role = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8")).role; } catch { role = null; }
  if (role !== "service_role") fail("secret_key_not_service_role");
  return { apikey: key, Authorization: `Bearer ${key}` };
}

const publicUrl = (origin, path) => `${origin}/storage/v1/object/public/${PHOTO_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;

async function request(fetchImpl, url, init) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { redirect: "error", cache: "no-store", signal: stop.signal, ...init });
  } catch {
    fail(stop.signal.aborted ? "request_timeout" : "network_error");
  } finally {
    clearTimeout(timer);
  }
}

/** Состояние объекта по публичному адресу: present (те же байты), missing или mismatch. */
async function objectState(fetchImpl, origin, upload) {
  const response = await request(fetchImpl, publicUrl(origin, upload.path), { method: "GET" });
  if (response.status === 404 || response.status === 400) { void response.body?.cancel().catch(() => {}); return "missing"; }
  if (response.status !== 200) { void response.body?.cancel().catch(() => {}); fail(`public_read_http_${response.status}`); }
  const bytes = Buffer.from(await response.arrayBuffer());
  return sha256(bytes) === upload.sha256 ? "present" : "mismatch";
}

async function ensureBucket(fetchImpl, origin, headers) {
  const response = await request(fetchImpl, `${origin}/storage/v1/bucket/${PHOTO_BUCKET}`, { method: "GET", headers: { ...headers, accept: "application/json" } });
  if (response.status === 401 || response.status === 403) fail("credentials_rejected");
  let body = null;
  try { body = JSON.parse(Buffer.from(await response.arrayBuffer()).toString("utf8")); } catch { body = null; }
  if (response.status !== 200 || body?.id !== PHOTO_BUCKET) fail("bucket_missing");
  if (body.public !== true) fail("bucket_not_public");
}

async function uploadOne(fetchImpl, origin, headers, upload) {
  const bytes = readFileSync(upload.file);
  if (sha256(bytes) !== upload.sha256) return "local_file_changed";
  const response = await request(fetchImpl, `${origin}/storage/v1/object/${PHOTO_BUCKET}/${upload.path}`, {
    method: "POST", body: bytes,
    headers: { ...headers, "content-type": upload.contentType, "x-upsert": "false", "cache-control": "max-age=31536000" } });
  void response.body?.cancel().catch(() => {});
  if (response.status === 401 || response.status === 403) fail("credentials_rejected");
  if (![200, 201, 400, 409].includes(response.status)) return `upload_http_${response.status}`;
  const after = await objectState(fetchImpl, origin, upload);
  if (after === "present") return null;
  return [200, 201].includes(response.status) ? "readback_mismatch" : "object_conflict";
}

export async function runUpload(argv, { environment = process.env, fetchImpl = fetch, write = (text) => process.stdout.write(text) } = {}) {
  let mode = "plan";
  let seedDir = environment.EVO_GEOGRAPHY_SEED_DIR ?? resolve(REPO_ROOT, "output/student-app-v2/seed");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--plan", "--check", "--apply"].includes(arg)) mode = arg.slice(2);
    else if (arg === "--seed-dir") seedDir = argv[++index];
    else if (arg === "--help") {
      write("Usage: node scripts/catalog/upload-geography-photos.mjs [--seed-dir DIR] [--plan|--check|--apply]\n");
      return 0;
    } else { write(`${JSON.stringify({ status: "arguments_invalid" })}\n`); return 1; }
  }
  let seed;
  try { seed = loadGeographySeed({ seedDir: resolve(seedDir), allowMissing: true }); } catch (error) {
    if (error instanceof SeedError) { write(`${JSON.stringify({ status: "seed_invalid", problems: error.problems }, null, 2)}\n`); return 1; }
    throw error;
  }
  const uploads = seed.uploads.map(({ scope, key, path, sha256: digest, bytes, contentType, file }) => ({ scope, key, path, sha256: digest, bytes, contentType, file }));
  const report = { schema: "evo-geography-photos/v1", mode, bucket: PHOTO_BUCKET, photos: uploads.length,
    bytes: uploads.reduce((sum, item) => sum + item.bytes, 0) };
  if (mode === "plan") {
    write(`${JSON.stringify({ ...report, status: "planned",
      items: uploads.map(({ scope, key, path, sha256: digest, bytes }) => ({ scope, key, path, sha256: digest, bytes })) }, null, 2)}\n`);
    return 0;
  }
  try {
    const target = readTarget(environment);
    report.target = target.kind;
    const states = { present: [], missing: [], mismatch: [] };
    if (mode === "check") {
      for (const upload of uploads) states[await objectState(fetchImpl, target.origin, upload)].push(upload.path);
      write(`${JSON.stringify({ ...report, status: states.mismatch.length === 0 ? "checked" : "checked_with_conflicts",
        present: states.present.length, missing: states.missing, mismatch: states.mismatch }, null, 2)}\n`);
      return states.mismatch.length === 0 ? 0 : 1;
    }
    const headers = readServiceHeaders(environment);
    await ensureBucket(fetchImpl, target.origin, headers);
    const uploaded = [], present = [], failures = [];
    for (const upload of uploads) {
      const state = await objectState(fetchImpl, target.origin, upload);
      if (state === "present") { present.push(upload.path); continue; }
      if (state === "mismatch") { failures.push({ path: upload.path, reason: "object_conflict" }); continue; }
      const failure = await uploadOne(fetchImpl, target.origin, headers, upload);
      if (failure === null) uploaded.push(upload.path); else failures.push({ path: upload.path, reason: failure });
    }
    write(`${JSON.stringify({ ...report, status: failures.length === 0 ? "applied" : "applied_with_failures",
      uploaded, alreadyPresent: present.length, failures }, null, 2)}\n`);
    return failures.length === 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof UploadError) { write(`${JSON.stringify({ ...report, status: error.code })}\n`); return 1; }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runUpload(process.argv.slice(2));
}
