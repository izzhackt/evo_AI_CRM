import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformSupabaseBackendConfig } from "../src/lib/server/platform-supabase-backend-config.ts";
import { awaitUniversityTemplateOperation, readUniversityTemplateStream } from "../src/lib/server/university-template-source-storage.ts";

const PROJECT = "iosckaqtovbbnssqcpde", ORIGIN = `https://${PROJECT}.supabase.co`;
export const UNIVERSITY_TEMPLATE_BUCKET = Object.freeze({ id: "platform-document-templates", name: "platform-document-templates",
  public: false, file_size_limit: 20 * 1024 * 1024,
  allowed_mime_types: Object.freeze(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) });
class ConfigurationError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new ConfigurationError(code); };
function settingsMatch(value) {
  return value?.id === UNIVERSITY_TEMPLATE_BUCKET.id && value.name === UNIVERSITY_TEMPLATE_BUCKET.name && value.public === false
    && value.file_size_limit === UNIVERSITY_TEMPLATE_BUCKET.file_size_limit && [undefined, "STANDARD"].includes(value.type)
    && Array.isArray(value.allowed_mime_types) && value.allowed_mime_types.length === 2
    && [...value.allowed_mime_types].sort().every((mime, index) => mime === UNIVERSITY_TEMPLATE_BUCKET.allowed_mime_types[index]);
}
async function request(method, path, headers, fetchImpl) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 10_000);
  try {
    const response = await awaitUniversityTemplateOperation(() => fetchImpl(`${ORIGIN}/storage/v1/bucket${path}`, {
      method, headers, redirect: "error", cache: "no-store", signal: stop.signal,
      ...(method === "POST" ? { body: JSON.stringify(UNIVERSITY_TEMPLATE_BUCKET) } : {}),
    }), stop.signal);
    if (response.status === 401 || response.status === 403) { void response.body?.cancel().catch(() => {}); fail("credentials_rejected"); }
    if (response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => {}); fail("redirect_rejected"); }
    if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) { void response.body?.cancel().catch(() => {}); fail("response_invalid"); }
    const bytes = await readUniversityTemplateStream(response.body, 64 * 1024, stop.signal);
    let body; try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("response_invalid"); }
    return { status: response.status, body };
  } finally { clearTimeout(timer); stop.abort(); }
}

export async function configureUniversityTemplateStorage({ mode = "plan", environment = process.env, fetchImpl = fetch } = {}) {
  const report = { schema: "evo-university-template-storage/v1", mode: ["plan", "check", "apply"].includes(mode) ? mode : "invalid", projectRef: PROJECT, bucket: UNIVERSITY_TEMPLATE_BUCKET,
    status: "planned", mutationAttempted: false, readbackVerified: false, globalLimitVerified: false, ingressAcceptance: false };
  let stage = "configuration";
  try {
    if (!["plan", "check", "apply"].includes(mode)) fail("arguments_invalid");
    if (mode === "plan") return { exitCode: 0, report };
    let config; try { config = getPlatformSupabaseBackendConfig(environment); } catch { fail("configuration_invalid"); }
    if (config.supabaseUrl !== ORIGIN) fail("project_mismatch");
    const key = config.supabaseSecretKey, headers = { apikey: key, "content-type": "application/json", accept: "application/json" };
    if (!key.startsWith("sb_secret_")) {
      try { if (JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).ref !== PROJECT) fail("credential_invalid"); }
      catch { fail("credential_invalid"); }
      headers.Authorization = `Bearer ${key}`;
    }
    const read = () => request("GET", `/${UNIVERSITY_TEMPLATE_BUCKET.id}`, headers, fetchImpl);
    stage = "before_read";
    const current = await read();
    if (current.status === 200) {
      if (!settingsMatch(current.body)) fail("bucket_settings_conflict");
      report.status = "ready"; report.readbackVerified = true; return { exitCode: 0, report };
    }
    // Accept the exact legacy envelope observed on managed Storage, not generic400.
    // https://supabase.com/docs/guides/storage/debugging/error-codes
    const legacyMissing = current.status === 400 && current.body?.statusCode === "404"
      && current.body.code === "NoSuchBucket" && current.body.error === "Bucket not found"
      && current.body.message === "Bucket not found" && Object.keys(current.body).length === 4;
    if (!legacyMissing && (current.status !== 404 || current.body?.code !== "NoSuchBucket")) fail("bucket_read_failed");
    if (mode !== "apply") fail("bucket_missing");
    // Explicit apply creates once; never overwrite settings, objects or policies.
    stage = "create"; report.mutationAttempted = true;
    const created = await request("POST", "", headers, fetchImpl);
    if (created.status === 409) fail("create_conflict");
    if (![200, 201].includes(created.status) || created.body?.name !== UNIVERSITY_TEMPLATE_BUCKET.name) fail("create_outcome_unknown");
    stage = "after_read";
    const after = await read();
    if (after.status !== 200 || !settingsMatch(after.body)) fail("readback_failed");
    report.status = "created_and_verified"; report.readbackVerified = true;
    return { exitCode: 0, report };
  } catch (error) {
    const code = error instanceof ConfigurationError ? error.code : "request_failed";
    report.status = stage === "create" && !["credentials_rejected", "create_conflict"].includes(code) ? "create_outcome_unknown"
      : stage === "after_read" ? "readback_failed" : code;
    return { exitCode: 1, report };
  }
}
export async function runUniversityTemplateStorageCli(argv, options = {}) {
  const write = options.write ?? (value => process.stdout.write(value));
  if (argv.length === 1 && argv[0] === "--help") {
    write("Usage: node --conditions=react-server --experimental-strip-types scripts/configure-university-template-storage.mjs [--check|--apply]\nDefault: offline plan. Check is read-only; apply only creates an absent exact private20MiB PDF/DOCX bucket.\n");
    return 0;
  }
  if (argv.length > 1 || (argv.length === 1 && !["--check", "--apply"].includes(argv[0]))) {
    write('{"schema":"evo-university-template-storage/v1","status":"arguments_invalid"}\n'); return 1;
  }
  const result = await configureUniversityTemplateStorage({ ...options, mode: argv[0] === "--apply" ? "apply" : argv[0] === "--check" ? "check" : "plan" });
  write(`${JSON.stringify(result.report)}\n`); return result.exitCode;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runUniversityTemplateStorageCli(process.argv.slice(2));
