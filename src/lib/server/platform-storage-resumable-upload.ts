import "server-only";

import type { PlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";

export const STANDARD_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

const TUS_VERSION = "1.0.0";
const TUS_REQUEST_TIMEOUT_MS = 60_000;
const MAX_TUS_RECOVERY_ATTEMPTS = 3;

export type PlatformStorageTusDependencies = Readonly<{
  backendConfig(): PlatformSupabaseBackendConfig;
  fetch(input: string | URL, init: RequestInit): Promise<Response>;
  now(): number;
}>;

export type PlatformStorageTusTarget = Readonly<{
  bucketId: string;
  objectName: string;
  expiresAt: string;
}>;

function tusEndpoint(supabaseUrl: string): URL {
  const base = new URL(supabaseUrl);
  const managedSuffix = ".supabase.co";
  if (
    base.protocol === "https:"
    && base.hostname.endsWith(managedSuffix)
    && base.hostname.length > managedSuffix.length
  ) {
    const projectRef = base.hostname.slice(0, -managedSuffix.length);
    return new URL(
      `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
    );
  }
  return new URL("/storage/v1/upload/resumable", base);
}

function tusAuthHeaders(secretKey: string): Readonly<Record<string, string>> {
  const headers: Record<string, string> = { apikey: secretKey };
  if (!secretKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${secretKey}`;
  }
  return headers;
}

function tusMetadata(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(([key, value]) =>
      `${key} ${Buffer.from(value, "utf8").toString("base64")}`)
    .join(",");
}

function exactTusUploadUrl(endpoint: URL, location: string | null): URL | null {
  if (!location) return null;
  let resolved: URL;
  try {
    resolved = new URL(location, endpoint);
  } catch {
    return null;
  }
  const expectedPrefix = endpoint.pathname.endsWith("/")
    ? endpoint.pathname
    : `${endpoint.pathname}/`;
  return resolved.origin === endpoint.origin
    && resolved.pathname.startsWith(expectedPrefix)
    && !resolved.username
    && !resolved.password
    && !resolved.search
    && !resolved.hash
    ? resolved
    : null;
}

function exactOffset(value: string | null, maximum: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= maximum
    ? offset
    : null;
}

function beforeExpiry(expiresAt: string, now: number): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && now < expiry;
}

/**
 * Minimal server-side TUS client following Supabase's resumable-upload
 * contract. A failed or ambiguous PATCH is reconciled by HEAD against the one
 * server-created upload URL; this helper never creates a replacement URL.
 */
export async function uploadSupabaseStorageObjectWithTus(
  bytes: Uint8Array,
  target: PlatformStorageTusTarget,
  mimeType: string,
  dependencies: PlatformStorageTusDependencies,
): Promise<boolean> {
  const config = dependencies.backendConfig();
  const endpoint = tusEndpoint(config.supabaseUrl);
  const authHeaders = tusAuthHeaders(config.supabaseSecretKey);
  if (!beforeExpiry(target.expiresAt, dependencies.now())) return false;

  let creation: Response;
  try {
    creation = await dependencies.fetch(endpoint, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Tus-Resumable": TUS_VERSION,
        "Upload-Length": String(bytes.byteLength),
        "Upload-Metadata": tusMetadata({
          bucketName: target.bucketId,
          objectName: target.objectName,
          contentType: mimeType,
          cacheControl: "0",
        }),
      },
      redirect: "error",
      signal: AbortSignal.timeout(TUS_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return false;
  }
  if (creation.status !== 201) return false;
  const uploadUrl = exactTusUploadUrl(endpoint, creation.headers.get("location"));
  if (!uploadUrl) return false;

  let offset = 0;
  let recoveryAttempts = 0;
  while (offset < bytes.byteLength) {
    if (!beforeExpiry(target.expiresAt, dependencies.now())) return false;
    const chunkEnd = Math.min(offset + TUS_CHUNK_BYTES, bytes.byteLength);
    const chunk = bytes.slice(offset, chunkEnd);
    try {
      const response = await dependencies.fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Tus-Resumable": TUS_VERSION,
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset),
        },
        body: chunk,
        redirect: "error",
        signal: AbortSignal.timeout(TUS_REQUEST_TIMEOUT_MS),
      });
      const nextOffset = exactOffset(
        response.headers.get("upload-offset"),
        bytes.byteLength,
      );
      if (response.status === 204 && nextOffset === chunkEnd) {
        offset = nextOffset;
        recoveryAttempts = 0;
        continue;
      }
      if (response.status < 500 && response.status !== 409) return false;
    } catch {
      // A timeout may hide a committed PATCH. Reconcile below with HEAD.
    }

    recoveryAttempts += 1;
    if (recoveryAttempts > MAX_TUS_RECOVERY_ATTEMPTS) return false;
    if (!beforeExpiry(target.expiresAt, dependencies.now())) return false;
    try {
      const head = await dependencies.fetch(uploadUrl, {
        method: "HEAD",
        headers: {
          ...authHeaders,
          "Tus-Resumable": TUS_VERSION,
        },
        redirect: "error",
        signal: AbortSignal.timeout(TUS_REQUEST_TIMEOUT_MS),
      });
      if (head.status !== 200 && head.status !== 204) return false;
      const serverOffset = exactOffset(
        head.headers.get("upload-offset"),
        bytes.byteLength,
      );
      if (
        serverOffset === null
        || serverOffset < offset
        || serverOffset > chunkEnd
      ) {
        return false;
      }
      offset = serverOffset;
    } catch {
      if (recoveryAttempts >= MAX_TUS_RECOVERY_ATTEMPTS) return false;
    }
  }
  return true;
}
