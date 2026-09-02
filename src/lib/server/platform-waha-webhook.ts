import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getPlatformMessagingBackendConfig,
  PLATFORM_WAHA_SESSION_NAME,
  PlatformMessagingBackendConfigurationError,
  type PlatformMessagingBackendConfig,
} from "./platform-messaging-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  PlatformWahaProjectorError,
  projectPlatformWahaWorkItem,
} from "./platform-waha-projector.ts";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_IDENTIFIER_BYTES = 256;
const MIN_WEBHOOK_SECRET_BYTES = 32;
const MAX_WEBHOOK_SECRET_BYTES = 128;
const SHA512_HEX_PATTERN = /^[0-9a-f]{128}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const DIRECT_CHAT_PATTERN =
  /^[1-9][0-9]{6,14}@(c\.us|s\.whatsapp\.net)$/;
const WAHA_ACK_NAMES = new Map<number, string>([
  [-1, "ERROR"],
  [0, "PENDING"],
  [1, "SERVER"],
  [2, "DEVICE"],
  [3, "READ"],
  [4, "PLAYED"],
]);
const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

type RpcClient = Pick<SupabaseClient, "schema">;

export type PlatformWahaWebhookDependencies = Readonly<{
  createServiceClient(config: PlatformMessagingBackendConfig): RpcClient;
}>;

const defaultDependencies: PlatformWahaWebhookDependencies = {
  createServiceClient: createPlatformSupabaseServiceClient,
};

type JsonObject = Record<string, unknown>;

type WahaEventDescriptor = Readonly<{
  eventType: "message.any" | "message.ack" | "session.status";
  payloadId: string;
  providerEventVariantRef: string | null;
  providerRequestId: string;
  occurredAt: string;
  businessKeySha256: string;
  shouldEnqueue: boolean;
  shouldSynchronizeSession: boolean;
}>;

type PersistedEvent = Readonly<{
  id: string;
  deduplicated: boolean;
}>;

class PlatformWahaWebhookRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "PlatformWahaWebhookRequestError";
    this.status = status;
    this.code = code;
  }
}

class PlatformWahaWebhookConfigurationError extends Error {
  constructor() {
    super("Platform WAHA webhook is not configured.");
    this.name = "PlatformWahaWebhookConfigurationError";
  }
}

function reject(status: number, code: string): never {
  throw new PlatformWahaWebhookRequestError(status, code);
}

function json(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function errorResponse(status: number, code: string): Response {
  return json(status, { ok: false, error: code });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedIdentifier(value: unknown, code: string): string {
  if (typeof value !== "string") return reject(400, code);
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized !== value ||
    Buffer.byteLength(normalized, "utf8") > MAX_IDENTIFIER_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return reject(400, code);
  }
  return normalized;
}

function readWebhookSecret(environment: NodeJS.ProcessEnv): string {
  const secret = environment.EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET;
  const bytes = secret === undefined ? 0 : Buffer.byteLength(secret, "utf8");
  if (
    secret === undefined ||
    secret !== secret.trim() ||
    bytes < MIN_WEBHOOK_SECRET_BYTES ||
    bytes > MAX_WEBHOOK_SECRET_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(secret)
  ) {
    throw new PlatformWahaWebhookConfigurationError();
  }
  return secret;
}

function verifySignature(request: Request, rawBody: Uint8Array, secret: string) {
  const algorithm = request.headers.get("x-webhook-hmac-algorithm");
  const supplied = request.headers
    .get("x-webhook-hmac")
    ?.replace(/^sha512=/i, "")
    .trim();
  if (algorithm?.toLowerCase() !== "sha512" || !supplied) {
    return reject(401, "invalid_signature");
  }
  if (!SHA512_HEX_PATTERN.test(supplied)) {
    return reject(401, "invalid_signature");
  }

  const expected = createHmac("sha512", secret).update(rawBody).digest();
  const provided = Buffer.from(supplied, "hex");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return reject(401, "invalid_signature");
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseOccurredAt(value: unknown): string | null {
  let milliseconds: number;
  if (typeof value === "number" && Number.isFinite(value)) {
    milliseconds = value < 100_000_000_000 ? value * 1_000 : value;
  } else if (typeof value === "string" && value.trim() === value) {
    const numeric = Number(value);
    milliseconds = Number.isFinite(numeric)
      ? numeric < 100_000_000_000
        ? numeric * 1_000
        : numeric
      : Date.parse(value);
  } else {
    return null;
  }
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function providerRequestId(body: JsonObject): string {
  if (typeof body.id === "string") {
    return boundedIdentifier(body.id, "invalid_provider_request_id");
  }
  return `local-waha-delivery:${randomUUID()}`;
}

function parseMessageAny(
  body: JsonObject,
  payload: JsonObject,
  requestId: string,
): WahaEventDescriptor {
  const payloadId = boundedIdentifier(payload.id, "invalid_message_id");
  if (typeof payload.fromMe !== "boolean") {
    return reject(400, "invalid_message_direction");
  }
  if (payload.fromMe === false) {
    const from = boundedIdentifier(payload.from, "invalid_message_sender");
    if (!DIRECT_CHAT_PATTERN.test(from)) {
      return reject(400, "invalid_message_sender");
    }
    if (
      typeof payload.body !== "string" ||
      payload.body.trim().length === 0 ||
      payload.body.length > 4_000
    ) {
      return reject(400, "invalid_message_body");
    }
  }
  const occurredAt = parseOccurredAt(body.timestamp ?? payload.timestamp);
  if (occurredAt === null) return reject(400, "invalid_event_timestamp");

  return {
    eventType: "message.any",
    payloadId,
    providerEventVariantRef: null,
    providerRequestId: requestId,
    occurredAt,
    businessKeySha256: sha256(
      `waha:${PLATFORM_WAHA_SESSION_NAME}:message:${payloadId}`,
    ),
    shouldEnqueue: payload.fromMe === false,
    shouldSynchronizeSession: false,
  };
}

function parseMessageAck(
  body: JsonObject,
  payload: JsonObject,
  requestId: string,
  rawPayloadSha256: string,
): WahaEventDescriptor {
  const rawMessageId = boundedIdentifier(payload.id, "invalid_message_id");
  if (payload.fromMe !== true) {
    return reject(400, "invalid_ack_direction");
  }
  if (!Number.isInteger(payload.ack)) return reject(400, "invalid_ack");
  const expectedName = WAHA_ACK_NAMES.get(payload.ack as number);
  if (
    expectedName === undefined ||
    payload.ackName !== expectedName
  ) {
    return reject(400, "invalid_ack");
  }
  const providerTimestamp = body.timestamp ?? payload.timestamp;
  const parsedOccurredAt = parseOccurredAt(providerTimestamp);
  const occurredAt = parsedOccurredAt ?? new Date().toISOString();
  const payloadId =
    parsedOccurredAt === null
      ? `local-message-ack-delivery:${rawPayloadSha256}:${sha256(requestId)}`
      : rawMessageId;
  const variant = expectedName.toLowerCase();

  return {
    eventType: "message.ack",
    payloadId,
    providerEventVariantRef: variant,
    providerRequestId: requestId,
    occurredAt,
    businessKeySha256: sha256(
      `waha:${PLATFORM_WAHA_SESSION_NAME}:message.ack:${rawMessageId}:${variant}:${parsedOccurredAt ?? rawPayloadSha256}`,
    ),
    shouldEnqueue: true,
    shouldSynchronizeSession: false,
  };
}

function parseSessionStatus(
  body: JsonObject,
  payload: JsonObject,
  requestId: string,
  rawPayloadSha256: string,
): WahaEventDescriptor {
  if (payload.name !== PLATFORM_WAHA_SESSION_NAME) {
    return reject(403, "invalid_session");
  }
  const status = boundedIdentifier(payload.status, "invalid_session_status");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(status)) {
    return reject(400, "invalid_session_status");
  }
  const parsedOccurredAt = parseOccurredAt(body.timestamp);
  const occurredAt = parsedOccurredAt ?? new Date().toISOString();
  const payloadId =
    typeof body.id === "string"
      ? boundedIdentifier(body.id, "invalid_provider_request_id")
      : `local-session-status-delivery:${rawPayloadSha256}:${sha256(requestId)}`;

  return {
    eventType: "session.status",
    payloadId,
    providerEventVariantRef: null,
    providerRequestId: requestId,
    occurredAt,
    businessKeySha256: sha256(
      `waha:${PLATFORM_WAHA_SESSION_NAME}:session.status:${typeof body.id === "string" ? body.id : rawPayloadSha256}`,
    ),
    shouldEnqueue: false,
    shouldSynchronizeSession: true,
  };
}

function parseEvent(
  body: JsonObject,
  rawPayloadSha256: string,
): WahaEventDescriptor | null {
  if (body.session !== PLATFORM_WAHA_SESSION_NAME) {
    return reject(403, "invalid_session");
  }
  if (typeof body.event !== "string") return reject(400, "invalid_event");
  if (!isObject(body.payload)) return reject(400, "invalid_payload");
  const requestId = providerRequestId(body);

  if (body.event === "message.any") {
    return parseMessageAny(body, body.payload, requestId);
  }
  if (body.event === "message.ack") {
    return parseMessageAck(
      body,
      body.payload,
      requestId,
      rawPayloadSha256,
    );
  }
  if (body.event === "session.status") {
    return parseSessionStatus(
      body,
      body.payload,
      requestId,
      rawPayloadSha256,
    );
  }
  return null;
}

function normalizePersistedEvent(value: unknown): PersistedEvent {
  if (!isObject(value)) return reject(503, "provider_evidence_unavailable");
  const id = value.provider_webhook_event_id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return reject(503, "provider_evidence_unavailable");
  }
  if (typeof value.deduplicated !== "boolean") {
    return reject(503, "provider_evidence_unavailable");
  }
  return { id: id.toLowerCase(), deduplicated: value.deduplicated };
}

async function persistEvent(
  client: RpcClient,
  config: PlatformMessagingBackendConfig,
  body: JsonObject,
  descriptor: WahaEventDescriptor,
  rawPayloadSha256: string,
): Promise<PersistedEvent> {
  let result;
  try {
    result = await client.schema("platform").rpc("persist_provider_webhook_event", {
      p_organization_id: config.organizationId,
      p_provider: "waha",
      p_provider_account_ref: "waha:evo-inbox",
      p_provider_conversation_ref: null,
      p_provider_event_variant_ref: descriptor.providerEventVariantRef,
      p_provider_request_id: descriptor.providerRequestId,
      p_waha_session_name: PLATFORM_WAHA_SESSION_NAME,
      p_payload_id: descriptor.payloadId,
      p_event_type: descriptor.eventType,
      p_provider_occurred_at: descriptor.occurredAt,
      p_verification_status: "verified",
      p_raw_payload: body,
      p_verification_headers: {
        hmac_algorithm: "sha512",
        hmac_verified: true,
        request_id_present: !descriptor.providerRequestId.startsWith(
          "local-waha-delivery:",
        ),
        timestamp_freshness_verified: false,
      },
      p_verification_evidence_ref: `waha-raw-sha256:${rawPayloadSha256}`,
      p_payload_sha256: rawPayloadSha256,
      p_request_id: randomUUID(),
    });
  } catch {
    return reject(503, "provider_evidence_unavailable");
  }
  const { data, error } = result;
  if (error) return reject(503, "provider_evidence_unavailable");
  return normalizePersistedEvent(data);
}

async function enqueueEvent(
  client: RpcClient,
  config: PlatformMessagingBackendConfig,
  persisted: PersistedEvent,
  descriptor: WahaEventDescriptor,
): Promise<string> {
  let result;
  try {
    result = await client.schema("platform").rpc("enqueue_verified_webhook_work", {
      p_organization_id: config.organizationId,
      p_source_webhook_event_id: persisted.id,
      p_business_key_sha256: descriptor.businessKeySha256,
      p_max_attempts: 8,
      p_request_id: randomUUID(),
    });
  } catch {
    return reject(503, "provider_queue_unavailable");
  }
  const { data, error } = result;
  if (
    error ||
    !isObject(data) ||
    typeof data.work_item_id !== "string" ||
    data.work_item_id !== data.work_item_id.trim() ||
    !UUID_PATTERN.test(data.work_item_id)
  ) {
    return reject(503, "provider_queue_unavailable");
  }
  return data.work_item_id.toLowerCase();
}

async function synchronizeSession(
  client: RpcClient,
  config: PlatformMessagingBackendConfig,
  persisted: PersistedEvent,
) {
  let result;
  try {
    result = await client.schema("platform").rpc("sync_lead_agent_session_status", {
      p_organization_id: config.organizationId,
      p_provider_webhook_event_id: persisted.id,
      p_request_id: randomUUID(),
    });
  } catch {
    return reject(503, "session_sync_unavailable");
  }
  const { data, error } = result;
  if (
    error ||
    !isObject(data) ||
    data.waha_session_name !== PLATFORM_WAHA_SESSION_NAME ||
    typeof data.status !== "string"
  ) {
    return reject(503, "session_sync_unavailable");
  }
}

export function createPlatformWahaWebhookHandler(
  dependencies: PlatformWahaWebhookDependencies = defaultDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      const rawBody = new Uint8Array(await request.arrayBuffer());
      if (rawBody.byteLength === 0) return errorResponse(400, "invalid_json");
      if (rawBody.byteLength > MAX_BODY_BYTES) {
        return errorResponse(413, "payload_too_large");
      }

      let body: unknown;
      try {
        body = JSON.parse(Buffer.from(rawBody).toString("utf8"));
      } catch {
        return errorResponse(400, "invalid_json");
      }
      if (!isObject(body)) return errorResponse(400, "invalid_json");

      const config = getPlatformMessagingBackendConfig();
      const secret = readWebhookSecret(process.env);
      verifySignature(request, rawBody, secret);
      const rawPayloadSha256 = sha256(rawBody);
      const descriptor = parseEvent(body, rawPayloadSha256);
      if (descriptor === null) {
        return json(202, { ok: true, status: "ignored" });
      }

      const client = dependencies.createServiceClient(config);
      const persisted = await persistEvent(
        client,
        config,
        body,
        descriptor,
        rawPayloadSha256,
      );
      if (descriptor.shouldSynchronizeSession) {
        await synchronizeSession(client, config, persisted);
        return json(200, {
          ok: true,
          status: "synchronized",
          eventType: descriptor.eventType,
          deduplicated: persisted.deduplicated,
        });
      }
      if (!descriptor.shouldEnqueue) {
        return json(202, {
          ok: true,
          status: "observed",
          eventType: descriptor.eventType,
          deduplicated: persisted.deduplicated,
        });
      }
      const workItemId = await enqueueEvent(
        client,
        config,
        persisted,
        descriptor,
      );
      const projection = await projectPlatformWahaWorkItem({
        client,
        organizationId: config.organizationId,
        workItemId,
        requestId: persisted.id,
      });
      return json(200, {
        ok: true,
        status: "projected",
        eventType: descriptor.eventType,
        deduplicated: persisted.deduplicated || projection.deduplicated,
      });
    } catch (error) {
      if (error instanceof PlatformWahaWebhookRequestError) {
        return errorResponse(error.status, error.code);
      }
      if (error instanceof PlatformMessagingBackendConfigurationError) {
        return errorResponse(503, "waha_webhook_unavailable");
      }
      if (error instanceof PlatformWahaWebhookConfigurationError) {
        return errorResponse(503, "waha_webhook_unavailable");
      }
      if (error instanceof PlatformWahaProjectorError) {
        return errorResponse(error.status, error.code);
      }
      return errorResponse(500, "internal_error");
    }
  };
}
