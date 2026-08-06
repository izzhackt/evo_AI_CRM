import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { PlatformWahaIngressEnabledConfig } from "./platform-waha-ingress-config.ts";

const REQUEST_ID_PATTERN = /^[\x21-\x7e]+$/;
const HMAC_SHA512_PATTERN = /^[0-9a-f]{128}$/;
const EVENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_EVENT_TYPE_LENGTH = 128;
const MAX_EVENT_ID_LENGTH = 512;
const PROCESSABLE_EVENT_TYPES = new Set([
  "message",
  "message.any",
  "message.ack",
  "session.status",
]);
const MESSAGE_EVENT_TYPES = new Set(["message", "message.any", "message.ack"]);
const ACK_NAMES = new Set([
  "ERROR",
  "PENDING",
  "SERVER",
  "DEVICE",
  "READ",
  "PLAYED",
]);

export type PlatformWahaWebhookRequestErrorCode =
  | "payload_too_large"
  | "invalid_signature"
  | "invalid_payload"
  | "invalid_session";

export class PlatformWahaWebhookRequestError extends Error {
  readonly code: PlatformWahaWebhookRequestErrorCode;
  readonly status: number;

  constructor(code: PlatformWahaWebhookRequestErrorCode, status: number) {
    super("Platform WAHA webhook request was rejected.");
    this.name = "PlatformWahaWebhookRequestError";
    this.code = code;
    this.status = status;
  }
}

export type PlatformWahaWebhookAuthentication = Readonly<{
  providerRequestId: string;
}>;

export type PlatformWahaWebhookEvent = Readonly<{
  eventType: string;
  sessionName: string;
  payloadId: string;
  providerOccurredAt: string;
  providerEventVariantRef: string | null;
  ignoredAsDuplicateAlias: boolean;
  processable: boolean;
  rawPayload: Record<string, unknown>;
}>;

function reject(
  code: PlatformWahaWebhookRequestErrorCode,
  status: number,
): never {
  throw new PlatformWahaWebhookRequestError(code, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedExactString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > maxLength || value !== value.trim()) {
    return null;
  }
  return value;
}

function bodyTimestampToIso(value: unknown): string | null {
  const timestamp = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;

  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function safeHeader(
  request: Request,
  name: string,
  maxLength: number,
): string | null {
  const value = request.headers.get(name);
  return boundedExactString(value, maxLength);
}

/** Reads the exact request bytes without ever buffering more than the limit. */
export async function readPlatformWahaRawBody(
  request: Request,
  maxBodyBytes: number,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return reject("invalid_payload", 400);
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength)) return reject("invalid_payload", 400);
    if (declaredLength > maxBodyBytes) return reject("payload_too_large", 413);
  }

  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        return reject("payload_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const rawBody = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return rawBody;
}

/** Verifies WAHA's exact raw-body SHA-512 HMAC and fresh millisecond header. */
export function verifyPlatformWahaWebhookAuthentication(
  request: Request,
  rawBody: Uint8Array,
  config: Pick<
    PlatformWahaIngressEnabledConfig,
    "webhookHmacSecret" | "maxClockSkewMs"
  >,
  nowMs: number,
): PlatformWahaWebhookAuthentication {
  const providerRequestId = safeHeader(
    request,
    "x-webhook-request-id",
    MAX_REQUEST_ID_LENGTH,
  );
  const timestampHeader = safeHeader(request, "x-webhook-timestamp", 32);
  const algorithm = safeHeader(request, "x-webhook-hmac-algorithm", 16);
  const signature = safeHeader(request, "x-webhook-hmac", 128);

  if (
    providerRequestId === null ||
    !REQUEST_ID_PATTERN.test(providerRequestId) ||
    timestampHeader === null ||
    !/^\d{13}$/.test(timestampHeader) ||
    algorithm !== "sha512" ||
    signature === null ||
    !HMAC_SHA512_PATTERN.test(signature)
  ) {
    return reject("invalid_signature", 403);
  }

  const timestampMs = Number(timestampHeader);
  if (
    !Number.isSafeInteger(timestampMs) ||
    !Number.isSafeInteger(nowMs) ||
    Math.abs(nowMs - timestampMs) > config.maxClockSkewMs
  ) {
    return reject("invalid_signature", 403);
  }

  const expected = createHmac("sha512", config.webhookHmacSecret)
    .update(rawBody)
    .digest();
  const supplied = Buffer.from(signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return reject("invalid_signature", 403);
  }

  return Object.freeze({ providerRequestId });
}

export function parsePlatformWahaWebhookEvent(
  rawBody: Uint8Array,
  expectedSessionName: string,
): PlatformWahaWebhookEvent {
  let rawText: string;
  try {
    rawText = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  } catch {
    return reject("invalid_payload", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return reject("invalid_payload", 400);
  }
  if (!isRecord(parsed)) return reject("invalid_payload", 400);

  const eventType = boundedExactString(parsed.event, MAX_EVENT_TYPE_LENGTH);
  if (eventType === null || !EVENT_TYPE_PATTERN.test(eventType)) {
    return reject("invalid_payload", 400);
  }

  const sessionName = boundedExactString(parsed.session, 128);
  if (sessionName !== expectedSessionName) return reject("invalid_session", 403);

  const providerOccurredAt = bodyTimestampToIso(parsed.timestamp);
  if (providerOccurredAt === null) return reject("invalid_payload", 400);

  const payload = isRecord(parsed.payload) ? parsed.payload : null;
  const payloadIdValue = MESSAGE_EVENT_TYPES.has(eventType)
    ? payload?.id
    : parsed.id;
  const payloadId = boundedExactString(payloadIdValue, MAX_EVENT_ID_LENGTH);
  if (payloadId === null) return reject("invalid_payload", 400);

  let providerEventVariantRef: string | null = null;
  if (eventType === "message.ack") {
    const ackName = payload?.ackName;
    providerEventVariantRef =
      typeof ackName === "string" && ACK_NAMES.has(ackName)
        ? ackName.toLowerCase()
        : "unknown";
  }

  // WAHA emits `message.any` for every message creation, including the same
  // inbound creation also exposed as `message`. Keep `message.any` canonical
  // so subscribing to both cannot persist or enqueue one inbound message twice.
  const ignoredAsDuplicateAlias = eventType === "message";

  return Object.freeze({
    eventType,
    sessionName,
    payloadId,
    providerOccurredAt,
    providerEventVariantRef,
    ignoredAsDuplicateAlias,
    processable:
      PROCESSABLE_EVENT_TYPES.has(eventType) && !ignoredAsDuplicateAlias,
    rawPayload: parsed,
  });
}

export function sha256PlatformWahaRawBody(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function platformWahaVerificationHeaders(): Readonly<
  Record<string, string | boolean>
> {
  return Object.freeze({
    hmac_algorithm: "sha512",
    hmac_verified: true,
    request_id_present: true,
    timestamp_freshness_verified: true,
  });
}
