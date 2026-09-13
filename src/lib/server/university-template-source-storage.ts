import "server-only";
import { createHash } from "node:crypto";
import type { UniversityTemplateIngressFailure } from "../university-template-ingress.ts";
import type { PlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import type { UniversityTemplateMime } from "../university-form-registry.ts";

export class UniversityTemplateSourceError extends Error {
  readonly code: UniversityTemplateIngressFailure;
  constructor(code: UniversityTemplateIngressFailure) { super(code); this.code = code; }
}

// The race bounds callers even when an external implementation ignores abort.
// No continuation may start another phase after this boundary rejects.
export async function awaitUniversityTemplateOperation<T>(operation: () => PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new UniversityTemplateSourceError("expired");
  let aborted: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    aborted = () => reject(new UniversityTemplateSourceError("expired"));
    signal.addEventListener("abort", aborted, { once: true });
  });
  try {
    const result = await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw new UniversityTemplateSourceError("expired");
      return operation();
    }), stopped]);
    if (signal.aborted) throw new UniversityTemplateSourceError("expired");
    return result;
  } finally { if (aborted) signal.removeEventListener("abort", aborted); }
}

export async function readUniversityTemplateStream(stream: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal): Promise<Buffer> {
  if (!stream || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 * 1024 * 1024) throw new UniversityTemplateSourceError("source_mismatch");
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await awaitUniversityTemplateOperation(() => reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array) || chunks.length >= 4096 || value.byteLength > limit - size) throw new UniversityTemplateSourceError("source_mismatch");
      size += value.byteLength; chunks.push(Buffer.from(value));
    }
    if (size === 0) throw new UniversityTemplateSourceError("source_mismatch");
    return Buffer.concat(chunks, size);
  } finally {
    // Stream cancellation is cleanup, never a detached database/HTTP mutation.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function universityTemplateSha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

type StorageSource = Readonly<{ bucket_id: "platform-document-templates"; object_name: string; mime_type: UniversityTemplateMime }>;
export type UniversityTemplateFetch = (url: string, init: RequestInit) => Promise<Response>;
function storageUrl(source: StorageSource, config: PlatformSupabaseBackendConfig): string {
  const id = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
  if (source.bucket_id !== "platform-document-templates" || !new RegExp(`^${id}/${id}/${id}\\.(pdf|docx)$`, "u").test(source.object_name))
    throw new UniversityTemplateSourceError("source_changed");
  return `${config.supabaseUrl}/storage/v1/object/${source.bucket_id}/${source.object_name}`;
}
function credentials(config: PlatformSupabaseBackendConfig): Record<string, string> {
  return { apikey: config.supabaseSecretKey,
    ...(config.supabaseSecretKey.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${config.supabaseSecretKey}` }) };
}
export async function uploadUniversityTemplateSource(source: StorageSource, bytes: Buffer, config: PlatformSupabaseBackendConfig,
  signal: AbortSignal, fetcher: UniversityTemplateFetch = fetch): Promise<void> {
  let response: Response;
  try {
    response = await awaitUniversityTemplateOperation(() => fetcher(storageUrl(source, config), {
      method: "POST", redirect: "error", cache: "no-store", signal, body: new Uint8Array(bytes),
      headers: { ...credentials(config), "content-type": source.mime_type, "content-length": String(bytes.byteLength),
        "cache-control": "max-age=0", "x-upsert": "false" },
    }), signal);
  } catch { throw new UniversityTemplateSourceError("storage_unavailable"); }
  // Do not interpret a response body or retry: the subsequent exact readback is proof.
  void response.body?.cancel().catch(() => {});
  if (response.status !== 200 && response.status !== 201) throw new UniversityTemplateSourceError("storage_unavailable");
}

export async function readUniversityTemplateSource(source: StorageSource & { byte_size: number }, config: PlatformSupabaseBackendConfig,
  signal: AbortSignal, fetcher: UniversityTemplateFetch = fetch): Promise<Buffer | null> {
  let response: Response;
  try {
    response = await awaitUniversityTemplateOperation(() => fetcher(storageUrl(source, config), {
      method: "GET", redirect: "error", cache: "no-store", signal, headers: credentials(config),
    }), signal);
  } catch { throw new UniversityTemplateSourceError("storage_unavailable"); }
  try {
    if (response.status !== 200) {
      // A generic404 can mean a missing bucket, tenant or denied access. Only the
      // documented object-specific code is sufficient to report a missing object.
      if (response.status === 404 || response.status === 400) {
        try {
          const error = JSON.parse((await readUniversityTemplateStream(response.body, 1024, signal)).toString("utf8")) as unknown;
          if (error && typeof error === "object" && !Array.isArray(error) && "code" in error && error.code === "NoSuchKey") return null;
        } catch { /* Unclassified responses remain unavailable, never missing. */ }
      }
      throw new UniversityTemplateSourceError("storage_unavailable");
    }
    const length = response.headers.get("content-length");
    if (response.headers.get("content-type") !== source.mime_type
      || (length !== null && (!/^[1-9][0-9]*$/u.test(length) || Number(length) !== source.byte_size)))
      throw new UniversityTemplateSourceError("integrity_failed");
    const bytes = await readUniversityTemplateStream(response.body, source.byte_size, signal);
    if (bytes.byteLength !== source.byte_size) throw new UniversityTemplateSourceError("integrity_failed");
    return bytes;
  } finally { void response.body?.cancel().catch(() => {}); }
}
