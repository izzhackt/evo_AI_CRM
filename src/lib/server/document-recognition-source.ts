import "server-only";
import { createHash } from "node:crypto";
import { getPlatformSupabaseBackendConfig, type PlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const MAX_BYTES = 25 * 1024 * 1024;
const DEADLINE_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
type Mime = "application/pdf" | "image/jpeg" | "image/png";
type Failure = "source_unavailable" | "source_changed" | "document_not_eligible" | "claim_unavailable" | "access_revoked";
export class DocumentRecognitionSourceError extends Error {
  readonly code: Failure;
  constructor(code: Failure = "source_unavailable") { super("Document source is unavailable"); this.name = "DocumentRecognitionSourceError"; this.code = code; }
}
export type DocumentRecognitionSourceIdentity = Readonly<{
  attempt_id: string; job_id: string; organization_id: string; student_case_id: string;
  document_slot_id: string; source_version_id: string; source_sha256: string;
  source_bytes: number; source_mime: Mime;
}>;
type Grant = DocumentRecognitionSourceIdentity & Readonly<{
  bucket_id: "platform-documents"; object_name: string; access_event_id: string; granted_at: string; expires_at: string;
}>;
export type DocumentRecognitionSourceDependencies = Readonly<{
  getBackendConfig(): PlatformSupabaseBackendConfig;
  grantSource(attemptId: string, claimToken: string, signal: AbortSignal): Promise<{ data: unknown; error: unknown }>;
  fetch: typeof fetch;
  now(): number;
}>;
const DEFAULTS: DocumentRecognitionSourceDependencies = {
  getBackendConfig: () => getPlatformSupabaseBackendConfig(),
  async grantSource(attemptId, claimToken, signal) {
    const client = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
    return client.schema("platform").rpc("grant_document_recognition_source", {
      p_attempt_id: attemptId, p_claim_token: claimToken,
    }).abortSignal(signal);
  },
  fetch: (...args) => fetch(...args), now: () => Date.now(),
};
const ID_KEYS = ["attempt_id", "job_id", "organization_id", "student_case_id", "document_slot_id", "source_version_id"] as const;
const GRANT_KEYS = [...ID_KEYS, "source_sha256", "source_bytes", "source_mime", "bucket_id", "object_name", "access_event_id", "granted_at", "expires_at"];
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function fail(code: Failure = "source_unavailable"): never { throw new DocumentRecognitionSourceError(code); }
function validIdentity(value: DocumentRecognitionSourceIdentity): boolean {
  return ID_KEYS.every(key => typeof value[key] === "string" && UUID.test(value[key]))
    && SHA.test(value.source_sha256) && Number.isSafeInteger(value.source_bytes) && value.source_bytes > 0 && value.source_bytes <= MAX_BYTES
    && ["application/pdf", "image/jpeg", "image/png"].includes(value.source_mime);
}
function parseGrant(value: unknown, expected: DocumentRecognitionSourceIdentity, now: number): Grant {
  if (!record(value) || Object.keys(value).length !== GRANT_KEYS.length || !GRANT_KEYS.every(key => Object.hasOwn(value, key))) fail();
  if (!ID_KEYS.every(key => value[key] === expected[key]) || value.source_sha256 !== expected.source_sha256
    || value.source_bytes !== expected.source_bytes || value.source_mime !== expected.source_mime) fail("source_changed");
  if (value.bucket_id !== "platform-documents" || typeof value.object_name !== "string" || !/^[0-9a-f]{2}\/[0-9a-f]{62}$/.test(value.object_name)
    || typeof value.access_event_id !== "string" || !UUID.test(value.access_event_id)
    || typeof value.granted_at !== "string" || typeof value.expires_at !== "string") fail();
  const granted = Date.parse(value.granted_at); const expires = Date.parse(value.expires_at);
  if (!Number.isFinite(granted) || !Number.isFinite(expires) || granted > now + 1_000 || expires <= now
    || expires <= granted || expires - granted > DEADLINE_MS) fail("claim_unavailable");
  return value as Grant;
}
function rpcFailure(error: unknown): never {
  if (record(error)) {
    if (error.code === "42501") fail("access_revoked");
    if (error.code === "40001" && error.message === "claim_unavailable") fail("claim_unavailable");
    if (error.code === "40001" && error.message === "source_changed") fail("source_changed");
  }
  fail();
}
function hasMagic(bytes: Uint8Array, mime: Mime): boolean {
  const signature = mime === "application/pdf" ? [0x25, 0x50, 0x44, 0x46, 0x2d]
    : mime === "image/jpeg" ? [0xff, 0xd8, 0xff] : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((value, index) => bytes[index] === value);
}
function storageUrl(config: PlatformSupabaseBackendConfig, grant: Grant): string {
  // Revalidate the supplied config too; dependency composition is not authority.
  const validated = getPlatformSupabaseBackendConfig({
    NODE_ENV: process.env.NODE_ENV ?? "production",
    NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl, EVO_PLATFORM_SUPABASE_SECRET_KEY: config.supabaseSecretKey,
  });
  return new URL(`/storage/v1/object/platform-documents/${grant.object_name}`, validated.supabaseUrl).href;
}

/** Exact authorized bytes only. This does NOT parse a PDF/image or prove parser isolation. */
export async function loadDocumentRecognitionSource(
  expected: DocumentRecognitionSourceIdentity, claimToken: string, options: { signal: AbortSignal },
  dependencies: DocumentRecognitionSourceDependencies = DEFAULTS,
): Promise<Readonly<{ bytes: Uint8Array; accessEventId: string }>> {
  if (!validIdentity(expected) || !UUID.test(claimToken)) fail();
  const identity = Object.freeze({ ...expected });
  const timeout = AbortSignal.timeout(DEADLINE_MS);
  const signal = AbortSignal.any([options.signal, timeout]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let responseBody: ReadableStream<Uint8Array> | null = null;
  try {
    signal.throwIfAborted();
    const result = await dependencies.grantSource(identity.attempt_id, claimToken, signal);
    signal.throwIfAborted();
    if (result.error) rpcFailure(result.error);
    const grant = parseGrant(result.data, identity, dependencies.now());
    const config = dependencies.getBackendConfig();
    const headers: Record<string, string> = { apikey: config.supabaseSecretKey, "Accept-Encoding": "identity" };
    if (!config.supabaseSecretKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${config.supabaseSecretKey}`;
    const response = await dependencies.fetch(storageUrl(config, grant), {
      method: "GET", headers, redirect: "error", cache: "no-store", signal,
    });
    responseBody = response.body;
    signal.throwIfAborted();
    if (dependencies.now() >= Date.parse(grant.expires_at)) fail("claim_unavailable");
    if (response.status !== 200 || response.redirected || !response.body) fail();
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") fail();
    if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== identity.source_mime) fail("source_changed");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^[1-9][0-9]*$/.test(length) || Number(length) !== identity.source_bytes)) fail("source_changed");
    const bytes = new Uint8Array(identity.source_bytes);
    const digest = createHash("sha256"); let offset = 0;
    reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read(); signal.throwIfAborted();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > bytes.byteLength - offset) fail("source_changed");
      bytes.set(chunk.value, offset); digest.update(chunk.value); offset += chunk.value.byteLength;
    }
    if (offset !== identity.source_bytes || digest.digest("hex") !== identity.source_sha256) fail("source_changed");
    if (dependencies.now() >= Date.parse(grant.expires_at)) fail("claim_unavailable");
    if (!hasMagic(bytes, identity.source_mime)) fail("document_not_eligible");
    return Object.freeze({ bytes, accessEventId: grant.access_event_id });
  } catch (error) {
    if (error instanceof DocumentRecognitionSourceError) throw error;
    return fail();
  } finally {
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    else if (responseBody) void responseBody.cancel().catch(() => {});
  }
}
