import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import {
  appendCanonicalInboundMessage,
  CanonicalCrmRepositoryError,
  createCanonicalPersonLead,
} from "./canonical-crm-repository.ts";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const HMAC_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;
const UTC_ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MESSAGE_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

type CreatePersonLeadInput = Parameters<typeof createCanonicalPersonLead>[0];
type AppendInboundMessageInput = Parameters<
  typeof appendCanonicalInboundMessage
>[0];

type CreatePersonLeadResult = Readonly<{ leadId: string }>;
type AppendInboundMessageResult = Awaited<
  ReturnType<typeof appendCanonicalInboundMessage>
>;

export type CanonicalWhatsAppInboundDependencies = Readonly<{
  getSecret(): string | undefined;
  now(): number;
  createPersonLead(
    input: CreatePersonLeadInput,
  ): Promise<CreatePersonLeadResult>;
  appendInboundMessage(
    input: AppendInboundMessageInput,
  ): Promise<AppendInboundMessageResult>;
}>;

const defaultDependencies: CanonicalWhatsAppInboundDependencies = {
  getSecret: () => process.env.EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET,
  now: Date.now,
  createPersonLead: createCanonicalPersonLead,
  appendInboundMessage: appendCanonicalInboundMessage,
};

type InboundPayload = Readonly<{
  event: "message.received";
  senderPhone: string;
  externalConversationId: string;
  externalMessageId: string;
  text: string;
  occurredAt: string;
}>;

type InboundErrorStatus = 400 | 403 | 409 | 413 | 415 | 500 | 503;
type InboundErrorCode =
  | "invalid_request"
  | "forbidden"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media_type"
  | "inbound_unavailable"
  | "internal_error";

class CanonicalWhatsAppInboundRequestError extends Error {
  readonly status: InboundErrorStatus;
  readonly code: InboundErrorCode;

  constructor(status: InboundErrorStatus, code: InboundErrorCode) {
    super("Canonical WhatsApp inbound request was rejected.");
    this.name = "CanonicalWhatsAppInboundRequestError";
    this.status = status;
    this.code = code;
  }
}

const RESPONSE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
} as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function reject(status: InboundErrorStatus, code: InboundErrorCode): never {
  throw new CanonicalWhatsAppInboundRequestError(status, code);
}

function errorResponse(
  status: InboundErrorStatus,
  code: InboundErrorCode,
): Response {
  return Response.json(
    { ok: false, error: code },
    { status, headers: RESPONSE_HEADERS },
  );
}

function requireJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    reject(415, "unsupported_media_type");
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!UNIX_SECONDS_PATTERN.test(contentLength)) {
      reject(400, "invalid_request");
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      reject(400, "invalid_request");
    }
    if (declaredBytes > MAX_BODY_BYTES) {
      reject(413, "payload_too_large");
    }
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
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        reject(413, "payload_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CanonicalWhatsAppInboundRequestError) throw error;
    reject(400, "invalid_request");
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

function boundedIdentifier(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 255 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    reject(400, "invalid_request");
  }
  return normalized;
}

function normalizedMessageText(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (
    normalized.length === 0 ||
    normalized.length > 65_535 ||
    MESSAGE_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    reject(400, "invalid_request");
  }
  return normalized;
}

function normalizedUtcTimestamp(value: string): string {
  const match = UTC_ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) reject(400, "invalid_request");
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second)
  ) {
    reject(400, "invalid_request");
  }
  return parsed.toISOString();
}

function parsePayload(rawBody: string): InboundPayload {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    reject(400, "invalid_request");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    reject(400, "invalid_request");
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "event",
    "externalConversationId",
    "externalMessageId",
    "occurredAt",
    "senderPhone",
    "text",
  ];
  if (
    Object.keys(record).sort().join("\0") !== expectedKeys.join("\0") ||
    record.event !== "message.received" ||
    typeof record.senderPhone !== "string" ||
    !E164_PATTERN.test(record.senderPhone) ||
    typeof record.externalConversationId !== "string" ||
    typeof record.externalMessageId !== "string" ||
    typeof record.text !== "string" ||
    typeof record.occurredAt !== "string"
  ) {
    reject(400, "invalid_request");
  }

  return {
    event: "message.received",
    senderPhone: record.senderPhone,
    externalConversationId: boundedIdentifier(record.externalConversationId),
    externalMessageId: boundedIdentifier(record.externalMessageId),
    text: normalizedMessageText(record.text),
    occurredAt: normalizedUtcTimestamp(record.occurredAt),
  };
}

function authenticate(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: Uint8Array,
  now: number,
): void {
  if (
    timestamp === null ||
    signature === null ||
    !UNIX_SECONDS_PATTERN.test(timestamp) ||
    !HMAC_SHA256_PATTERN.test(signature)
  ) {
    reject(403, "forbidden");
  }
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(now - timestampSeconds * 1_000) > MAX_CLOCK_SKEW_MS
  ) {
    reject(403, "forbidden");
  }
  const expected = createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest();
  const provided = Buffer.from(signature, "hex");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    reject(403, "forbidden");
  }
}

export function createCanonicalWhatsAppInboundHandler(
  dependencies: CanonicalWhatsAppInboundDependencies = defaultDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const secret = dependencies.getSecret();
    if (typeof secret !== "string" || secret.trim().length === 0) {
      return errorResponse(503, "inbound_unavailable");
    }

    try {
      requireJsonContentType(request);
      const rawBytes = await readBoundedBody(request);
      authenticate(
        secret,
        request.headers.get("x-evo-v2-timestamp"),
        request.headers.get("x-evo-v2-signature"),
        rawBytes,
        dependencies.now(),
      );
      let rawBody: string;
      try {
        rawBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
      } catch {
        reject(400, "invalid_request");
      }
      const payload = parsePayload(rawBody);
      const messageIdentityHash = sha256(
        `${payload.externalConversationId}\0${payload.externalMessageId}`,
      );
      const correlationId = `wa:${messageIdentityHash}`;

      const lead = await dependencies.createPersonLead({
        actorRole: "sales",
        idempotencyKey: `wa-lead:${sha256(payload.senderPhone)}`,
        correlationId,
        displayName: `WhatsApp ••••${payload.senderPhone.slice(-4)}`,
        phone: payload.senderPhone,
        source: "whatsapp",
      });
      const message = await dependencies.appendInboundMessage({
        actorRole: "sales",
        idempotencyKey: `wa-msg:${messageIdentityHash}`,
        correlationId,
        leadId: lead.leadId,
        channel: "whatsapp",
        externalConversationId: payload.externalConversationId,
        externalMessageId: payload.externalMessageId,
        body: payload.text,
        occurredAt: payload.occurredAt,
      });

      return Response.json(
        {
          ok: true,
          leadId: message.leadId,
          conversationId: message.conversationId,
          messageId: message.messageId,
        },
        { status: 202, headers: RESPONSE_HEADERS },
      );
    } catch (error) {
      if (error instanceof CanonicalWhatsAppInboundRequestError) {
        return errorResponse(error.status, error.code);
      }
      if (error instanceof CanonicalCrmRepositoryError) {
        switch (error.code) {
          case "invalid_input":
            return errorResponse(400, "invalid_request");
          case "forbidden":
            return errorResponse(403, "forbidden");
          case "not_found":
          case "conflict":
          case "idempotency_conflict":
            return errorResponse(409, "conflict");
          case "unavailable":
            return errorResponse(503, "inbound_unavailable");
          default:
            return errorResponse(500, "internal_error");
        }
      }
      return errorResponse(500, "internal_error");
    }
  };
}
