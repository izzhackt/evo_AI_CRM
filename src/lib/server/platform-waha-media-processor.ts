import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  createPlatformWahaMediaProvider,
  PlatformWahaMediaProviderError,
  type PlatformWahaMediaErrorDisposition,
  type PlatformWahaMediaProvider,
} from "./platform-waha-media-client.ts";
import {
  loadPlatformWahaMediaConfig,
  PlatformWahaMediaConfigurationError,
  type PlatformWahaMediaConfig,
  type PlatformWahaMediaEnabledConfig,
} from "./platform-waha-media-config.ts";
import {
  isSafeWahaProviderId,
  isWahaDirectChatId,
} from "./platform-waha-identifiers.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_NAME_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}$/;
const HMAC_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const QUEUE_NAME = "platform_waha_media_v1" as const;

type NoClaimResult = Readonly<{
  claimed: false;
  queue: typeof QUEUE_NAME;
}>;

type ClaimedResult = Readonly<{
  claimed: true;
  organizationId: string;
  workId: string;
  attemptId: string;
  mediaId: string;
  communicationMessageId: string;
  rawChatId: string;
  rawMessageId: string;
  direction: "inbound" | "outbound";
  objectName: string;
  leaseExpiresAt: string;
  leaseExpiresAtMs: number;
  attemptNumber: number;
  maxAttempts: number;
}>;

type ClaimResult = NoClaimResult | ClaimedResult;

type FinishOutcome = "archived" | PlatformWahaMediaErrorDisposition;

type FinishResult = Readonly<{
  organizationId: string;
  workId: string;
  attemptId: string;
  mediaId: string;
  state: FinishOutcome;
  outcome: FinishOutcome;
}>;

export type PlatformWahaMediaMetadata = Readonly<{
  mediaKind: "image" | "video" | "audio" | "pdf" | "file";
  mimeType:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/gif"
    | "video/mp4"
    | "audio/ogg"
    | "audio/mpeg"
    | "audio/wav"
    | "application/pdf"
    | "application/octet-stream";
  fileName: string;
  inlineSafe: boolean;
}>;

export type PlatformWahaMediaRepository = Readonly<{
  claim(input: Readonly<{
    organizationId: string;
    workerRef: string;
    visibilityTimeoutSeconds: number;
    requestId: string;
  }>): Promise<ClaimResult>;
  finish(input: Readonly<{
    organizationId: string;
    workId: string;
    attemptId: string;
    outcome: FinishOutcome;
    errorCode: string | null;
    mediaKind: PlatformWahaMediaMetadata["mediaKind"] | null;
    mimeType: PlatformWahaMediaMetadata["mimeType"] | null;
    fileName: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    requestId: string;
  }>): Promise<FinishResult>;
}>;

export type PlatformWahaMediaStorage = Readonly<{
  upload(input: Readonly<{
    bucket: string;
    objectName: string;
    bytes: Uint8Array;
    mimeType: PlatformWahaMediaMetadata["mimeType"];
    sha256: string;
  }>): Promise<void>;
}>;

export type PlatformWahaMediaHandlerDependencies = Readonly<{
  config?: PlatformWahaMediaConfig;
  repository?: PlatformWahaMediaRepository;
  provider?: PlatformWahaMediaProvider;
  storage?: PlatformWahaMediaStorage;
  nowMs?: () => number;
}>;

export class PlatformWahaMediaRepositoryError extends Error {
  constructor() {
    super("Platform WAHA media repository returned an invalid result.");
    this.name = "PlatformWahaMediaRepositoryError";
  }
}

export class PlatformWahaMediaStorageError extends Error {
  readonly disposition: PlatformWahaMediaErrorDisposition;
  readonly code: "storage_unavailable" | "storage_conflict";

  constructor(
    disposition: PlatformWahaMediaErrorDisposition = "retryable_error",
    code: "storage_unavailable" | "storage_conflict" = "storage_unavailable",
  ) {
    super("Platform private media storage is unavailable.");
    this.name = "PlatformWahaMediaStorageError";
    this.disposition = disposition;
    this.code = code;
  }
}

class PlatformWahaMediaLeaseError extends Error {
  readonly disposition = "retryable_error" as const;
  readonly code = "lease_expired" as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repositoryError(): never {
  throw new PlatformWahaMediaRepositoryError();
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}

function validObjectName(value: unknown): string | null {
  if (typeof value !== "string" || !OBJECT_NAME_PATTERN.test(value)) {
    return null;
  }
  const segments = value.split("/");
  return segments.some(
    (segment) => segment.length === 0 || segment === "." || segment === "..",
  )
    ? null
    : value;
}

function normalizeClaim(value: unknown): ClaimResult {
  if (!isRecord(value) || typeof value.claimed !== "boolean") {
    return repositoryError();
  }
  if (value.claimed === false) {
    if (value.queue !== QUEUE_NAME) return repositoryError();
    return Object.freeze({ claimed: false, queue: QUEUE_NAME });
  }

  const organizationId = uuid(value.organization_id);
  const workId = uuid(value.work_id);
  const attemptId = uuid(value.attempt_id);
  const mediaId = uuid(value.media_id);
  const communicationMessageId = uuid(value.communication_message_id);
  const objectName = validObjectName(value.object_name);
  const attemptNumber = positiveInteger(value.attempt_number);
  const maxAttempts = positiveInteger(value.max_attempts);
  const leaseExpiresAt = value.lease_expires_at;
  const leaseExpiresAtMs =
    typeof leaseExpiresAt === "string" ? Date.parse(leaseExpiresAt) : NaN;
  if (
    organizationId === null ||
    workId === null ||
    attemptId === null ||
    mediaId === null ||
    communicationMessageId === null ||
    typeof value.raw_chat_id !== "string" ||
    !isWahaDirectChatId(value.raw_chat_id) ||
    typeof value.raw_message_id !== "string" ||
    !isSafeWahaProviderId(value.raw_message_id) ||
    (value.direction !== "inbound" && value.direction !== "outbound") ||
    objectName === null ||
    typeof leaseExpiresAt !== "string" ||
    !Number.isFinite(leaseExpiresAtMs) ||
    attemptNumber === null ||
    maxAttempts === null ||
    attemptNumber > maxAttempts
  ) {
    return repositoryError();
  }

  return Object.freeze({
    claimed: true,
    organizationId,
    workId,
    attemptId,
    mediaId,
    communicationMessageId,
    rawChatId: value.raw_chat_id,
    rawMessageId: value.raw_message_id,
    direction: value.direction,
    objectName,
    leaseExpiresAt,
    leaseExpiresAtMs,
    attemptNumber,
    maxAttempts,
  });
}

function normalizeFinish(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    workId: string;
    attemptId: string;
    mediaId: string;
    outcome: FinishOutcome;
  }>,
): FinishResult {
  if (!isRecord(value)) return repositoryError();
  const organizationId = uuid(value.organization_id);
  const workId = uuid(value.work_id);
  const attemptId = uuid(value.attempt_id);
  const mediaId = uuid(value.media_id);
  const resolvedOutcome =
    expected.outcome === "retryable_error" &&
    value.outcome === "terminal_error" &&
    value.state === "terminal_error"
      ? "terminal_error"
      : expected.outcome;
  if (
    organizationId !== expected.organizationId ||
    workId !== expected.workId ||
    attemptId !== expected.attemptId ||
    mediaId !== expected.mediaId ||
    value.outcome !== resolvedOutcome ||
    value.state !== resolvedOutcome
  ) {
    return repositoryError();
  }
  return Object.freeze({
    organizationId,
    workId,
    attemptId,
    mediaId,
    state: resolvedOutcome,
    outcome: resolvedOutcome,
  });
}

export function createPlatformWahaMediaRepository(
  client: SupabaseClient,
): PlatformWahaMediaRepository {
  return Object.freeze({
    async claim(input) {
      const response = await client.schema("platform").rpc(
        "claim_waha_media_archive",
        {
          p_organization_id: input.organizationId,
          p_worker_ref: input.workerRef,
          p_visibility_timeout_seconds: input.visibilityTimeoutSeconds,
          p_request_id: input.requestId,
        },
      );
      if (response.error) return repositoryError();
      return normalizeClaim(response.data);
    },

    async finish(input) {
      const response = await client.schema("platform").rpc(
        "finish_waha_media_archive",
        {
          p_organization_id: input.organizationId,
          p_work_id: input.workId,
          p_attempt_id: input.attemptId,
          p_outcome: input.outcome,
          p_error_code: input.errorCode,
          p_media_kind: input.mediaKind,
          p_mime_type: input.mimeType,
          p_file_name: input.fileName,
          p_size_bytes: input.sizeBytes,
          p_sha256: input.sha256,
          p_request_id: input.requestId,
        },
      );
      if (response.error) return repositoryError();
      return normalizeFinish(response.data, {
        organizationId: input.organizationId,
        workId: input.workId,
        attemptId: input.attemptId,
        // The media id is immutable on the claimed work row. The SQL result is
        // checked by the handler against the claim after this call.
        mediaId: uuid(response.data?.media_id) ?? repositoryError(),
        outcome: input.outcome,
      });
    },
  });
}

export function createPlatformWahaMediaStorage(
  client: SupabaseClient,
): PlatformWahaMediaStorage {
  return Object.freeze({
    async upload(input) {
      const bucket = client.storage.from(input.bucket);
      const response = await bucket.upload(input.objectName, input.bytes, {
          contentType: input.mimeType,
          cacheControl: "0",
          upsert: false,
          metadata: { sha256: input.sha256 },
        });
      if (!response.error) return;

      // One stable DB-reserved object name makes crash recovery idempotent
      // without ever overwriting an append-only object. A prior attempt counts
      // as success only after metadata and the exact private bytes both match.
      const info = await bucket.info(input.objectName);
      if (info.error) throw new PlatformWahaMediaStorageError();
      if (
        info.data.size !== input.bytes.byteLength ||
        info.data.contentType !== input.mimeType ||
        info.data.metadata?.sha256 !== input.sha256
      ) {
        throw new PlatformWahaMediaStorageError(
          "terminal_error",
          "storage_conflict",
        );
      }
      const existing = await bucket.download(input.objectName);
      if (existing.error) throw new PlatformWahaMediaStorageError();
      const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
      const existingSha256 = createHash("sha256")
        .update(existingBytes)
        .digest("hex");
      if (
        existingBytes.byteLength !== input.bytes.byteLength ||
        existingSha256 !== input.sha256
      ) {
        throw new PlatformWahaMediaStorageError(
          "terminal_error",
          "storage_conflict",
        );
      }
    },
  });
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return (
    bytes.byteLength >= prefix.length &&
    prefix.every((value, index) => bytes[index] === value)
  );
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (bytes.byteLength < offset + value.length) return false;
  return [...value].every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0),
  );
}

const SAFE_MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "mp41",
  "mp42",
  "M4V ",
  "avc1",
]);

function safeFileName(providerFileName: string | null, extension: string): string {
  const raw = providerFileName ?? "attachment";
  const normalized = raw
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 100);
  const stem = normalized.replace(/\.[^.]*$/, "").replace(/[.-]+$/, "");
  return `${stem || "attachment"}.${extension}`;
}

/** Content type is derived from bytes, never trusted from WAHA headers. */
export function classifyPlatformWahaMedia(
  bytes: Uint8Array,
  providerFileName: string | null,
): PlatformWahaMediaMetadata {
  let detected: Readonly<{
    mediaKind: PlatformWahaMediaMetadata["mediaKind"];
    mimeType: PlatformWahaMediaMetadata["mimeType"];
    extension: string;
    inlineSafe: boolean;
  }>;

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    detected = { mediaKind: "image", mimeType: "image/jpeg", extension: "jpg", inlineSafe: true };
  } else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    detected = { mediaKind: "image", mimeType: "image/png", extension: "png", inlineSafe: true };
  } else if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    detected = { mediaKind: "image", mimeType: "image/webp", extension: "webp", inlineSafe: true };
  } else if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) {
    detected = { mediaKind: "image", mimeType: "image/gif", extension: "gif", inlineSafe: true };
  } else if (
    asciiAt(bytes, 4, "ftyp") &&
    bytes.byteLength >= 12 &&
    SAFE_MP4_BRANDS.has(
      new TextDecoder("ascii").decode(bytes.subarray(8, 12)),
    )
  ) {
    detected = { mediaKind: "video", mimeType: "video/mp4", extension: "mp4", inlineSafe: true };
  } else if (asciiAt(bytes, 0, "OggS")) {
    detected = { mediaKind: "audio", mimeType: "audio/ogg", extension: "ogg", inlineSafe: true };
  } else if (
    asciiAt(bytes, 0, "ID3") ||
    (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    detected = { mediaKind: "audio", mimeType: "audio/mpeg", extension: "mp3", inlineSafe: true };
  } else if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE")) {
    detected = { mediaKind: "audio", mimeType: "audio/wav", extension: "wav", inlineSafe: true };
  } else if (asciiAt(bytes, 0, "%PDF-")) {
    detected = { mediaKind: "pdf", mimeType: "application/pdf", extension: "pdf", inlineSafe: false };
  } else {
    detected = { mediaKind: "file", mimeType: "application/octet-stream", extension: "bin", inlineSafe: false };
  }

  return Object.freeze({
    mediaKind: detected.mediaKind,
    mimeType: detected.mimeType,
    fileName: safeFileName(providerFileName, detected.extension),
    inlineSafe: detected.inlineSafe,
  });
}

function deterministicOperationUuid(requestId: string, operation: string): string {
  const bytes = createHash("sha256")
    .update(`${requestId}:${operation}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function authenticatedRequestId(
  request: Request,
  config: PlatformWahaMediaEnabledConfig,
  nowMs: number,
): string | null {
  const requestId = request.headers.get("x-evo-media-request-id");
  const timestampHeader = request.headers.get("x-evo-media-timestamp");
  const algorithm = request.headers.get("x-evo-media-hmac-algorithm");
  const signature = request.headers.get("x-evo-media-hmac");
  const normalizedRequestId = uuid(requestId);
  if (
    normalizedRequestId === null ||
    requestId !== normalizedRequestId ||
    timestampHeader === null ||
    !/^\d{13}$/.test(timestampHeader) ||
    algorithm !== "sha256" ||
    signature === null ||
    !HMAC_SHA256_PATTERN.test(signature)
  ) {
    return null;
  }
  const timestampMs = Number(timestampHeader);
  if (
    !Number.isSafeInteger(timestampMs) ||
    !Number.isSafeInteger(nowMs) ||
    Math.abs(nowMs - timestampMs) > config.maxClockSkewMs
  ) {
    return null;
  }
  const expected = createHmac("sha256", config.triggerSecret)
    .update(`${normalizedRequestId}.${timestampHeader}`, "utf8")
    .digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? normalizedRequestId
    : null;
}

function isBodylessPost(request: Request): boolean {
  if (request.method !== "POST" || request.headers.has("transfer-encoding")) {
    return false;
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength === "0") return true;
  return contentLength === null && request.body === null;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

function processingFailure(
  error: unknown,
): Readonly<{ disposition: PlatformWahaMediaErrorDisposition; code: string }> | null {
  if (
    error instanceof PlatformWahaMediaProviderError ||
    error instanceof PlatformWahaMediaStorageError ||
    error instanceof PlatformWahaMediaLeaseError
  ) {
    return Object.freeze({
      disposition: error.disposition,
      code: error.code,
    });
  }
  return null;
}

async function persistFinish(
  repository: PlatformWahaMediaRepository,
  claim: ClaimedResult,
  input: Readonly<{
    outcome: FinishOutcome;
    errorCode: string | null;
    metadata: PlatformWahaMediaMetadata | null;
    sizeBytes: number | null;
    sha256: string | null;
    triggerRequestId: string;
  }>,
): Promise<FinishResult> {
  const result = await repository.finish({
    organizationId: claim.organizationId,
    workId: claim.workId,
    attemptId: claim.attemptId,
    outcome: input.outcome,
    errorCode: input.errorCode,
    mediaKind: input.metadata?.mediaKind ?? null,
    mimeType: input.metadata?.mimeType ?? null,
    fileName: input.metadata?.fileName ?? null,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    requestId: deterministicOperationUuid(
      input.triggerRequestId,
      `finish:${claim.attemptId}:${input.outcome}`,
    ),
  });
  if (result.mediaId !== claim.mediaId) return repositoryError();
  if (
    input.outcome === "retryable_error" &&
    result.outcome === "terminal_error" &&
    claim.attemptNumber !== claim.maxAttempts
  ) {
    return repositoryError();
  }
  return result;
}

function defaultBoundaries(config: PlatformWahaMediaEnabledConfig): Readonly<{
  repository: PlatformWahaMediaRepository;
  storage: PlatformWahaMediaStorage;
}> {
  const client = createPlatformSupabaseServiceClient(config);
  return Object.freeze({
    repository: createPlatformWahaMediaRepository(client),
    storage: createPlatformWahaMediaStorage(client),
  });
}

export function createPlatformWahaMediaHandler(
  dependencies: PlatformWahaMediaHandlerDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    let config: PlatformWahaMediaConfig;
    try {
      config = dependencies.config ?? loadPlatformWahaMediaConfig();
    } catch (error) {
      if (error instanceof PlatformWahaMediaConfigurationError) {
        return jsonError("not_configured", 503);
      }
      return jsonError("media_unavailable", 503);
    }
    if (!config.enabled) return jsonError("media_disabled", 503);

    const now = dependencies.nowMs ?? Date.now;
    const triggerRequestId = authenticatedRequestId(request, config, now());
    if (triggerRequestId === null) return jsonError("unauthorized", 401);
    if (!isBodylessPost(request)) return jsonError("invalid_request", 400);

    const defaults =
      dependencies.repository !== undefined && dependencies.storage !== undefined
        ? null
        : defaultBoundaries(config);
    const repository = dependencies.repository ?? defaults!.repository;
    const storage = dependencies.storage ?? defaults!.storage;
    const provider =
      dependencies.provider ?? createPlatformWahaMediaProvider(config);

    let claim: ClaimResult;
    try {
      claim = await repository.claim({
        organizationId: config.organizationId,
        workerRef: config.workerRef,
        visibilityTimeoutSeconds: config.visibilityTimeoutSeconds,
        requestId: deterministicOperationUuid(triggerRequestId, "claim"),
      });
    } catch {
      return jsonError("media_unavailable", 503);
    }
    if (!claim.claimed) {
      return Response.json({ ok: true, claimed: false }, { status: 200 });
    }
    if (claim.organizationId !== config.organizationId) {
      return jsonError("media_unavailable", 503);
    }

    try {
      const download = await provider.download({
        rawChatId: claim.rawChatId,
        rawMessageId: claim.rawMessageId,
        direction: claim.direction,
      });
      const metadata = classifyPlatformWahaMedia(
        download.bytes,
        download.providerFileName,
      );

      // A new append-only upload (or exact crash-recovery verification) is
      // allowed only while this exact attempt owns the exclusive lease.
      if (now() >= claim.leaseExpiresAtMs) {
        throw new PlatformWahaMediaLeaseError();
      }
      const sha256 = createHash("sha256").update(download.bytes).digest("hex");
      if (!SHA256_PATTERN.test(sha256)) return repositoryError();
      await storage.upload({
        bucket: config.bucket,
        objectName: claim.objectName,
        bytes: download.bytes,
        mimeType: metadata.mimeType,
        sha256,
      });

      const finish = await persistFinish(repository, claim, {
        outcome: "archived",
        errorCode: null,
        metadata,
        sizeBytes: download.bytes.byteLength,
        sha256,
        triggerRequestId,
      });
      return Response.json(
        { ok: true, claimed: true, outcome: finish.outcome, state: finish.state },
        { status: 200 },
      );
    } catch (error) {
      const failure = processingFailure(error);
      if (failure === null) {
        // Unknown repository/programming outcomes leave the lease to expire.
        // In particular, never delete an object that may already be committed.
        return jsonError("media_unavailable", 503);
      }
      try {
        const finish = await persistFinish(repository, claim, {
          outcome: failure.disposition,
          errorCode: failure.code,
          metadata: null,
          sizeBytes: null,
          sha256: null,
          triggerRequestId,
        });
        return Response.json(
          { ok: true, claimed: true, outcome: finish.outcome, state: finish.state },
          { status: 200 },
        );
      } catch {
        return jsonError("media_unavailable", 503);
      }
    }
  };
}
