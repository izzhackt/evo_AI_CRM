import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getPlatformMessagingBackendConfig } from "./platform-messaging-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  PlatformWahaProjectorError,
  projectPlatformWahaWorkItem,
} from "./platform-waha-projector.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const HMAC_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MIN_TRIGGER_SECRET_BYTES = 32;
const MAX_TRIGGER_SECRET_BYTES = 128;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

type RpcClient = Pick<SupabaseClient, "schema">;
type JsonObject = Record<string, unknown>;

export type PlatformWahaProjectionRecoveryDisabledConfig = Readonly<{
  enabled: false;
}>;

export type PlatformWahaProjectionRecoveryEnabledConfig = Readonly<{
  enabled: true;
  organizationId: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  triggerSecret: string;
  intakeSalesMembershipId: string;
  maxClockSkewMs: number;
}>;

export type PlatformWahaProjectionRecoveryConfig =
  | PlatformWahaProjectionRecoveryDisabledConfig
  | PlatformWahaProjectionRecoveryEnabledConfig;

type RecoveryDependencies = Readonly<{
  config?: PlatformWahaProjectionRecoveryConfig;
  nowMs?: () => number;
  client?: RpcClient;
}>;

type DueWork = Readonly<{
  workItemId: string;
  eventType: "message" | "message.any" | "message.ack";
}>;

type RecoveryResult =
  | Readonly<{ processed: false; requestId: string }>
  | Readonly<{
      processed: true;
      requestId: string;
      workItemId: string;
      eventType: "message" | "message.any" | "message.ack";
      state: "succeeded";
      deduplicated: boolean;
    }>;

export class PlatformWahaProjectionRecoveryConfigurationError extends Error {
  constructor() {
    super("Platform WAHA projection recovery is not configured.");
    this.name = "PlatformWahaProjectionRecoveryConfigurationError";
  }
}

function configurationError(): never {
  throw new PlatformWahaProjectionRecoveryConfigurationError();
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value === NIL_UUID ? null : value;
}

function requiredUuid(value: string | undefined): string {
  if (value === undefined || value !== value.trim()) return configurationError();
  const normalized = uuid(value.toLowerCase());
  return normalized ?? configurationError();
}

function triggerSecret(value: string | undefined): string {
  if (value === undefined) return configurationError();
  const byteLength = Buffer.byteLength(value, "utf8");
  if (
    value !== value.trim() ||
    !/^[\x21-\x7e]+$/.test(value) ||
    byteLength < MIN_TRIGGER_SECRET_BYTES ||
    byteLength > MAX_TRIGGER_SECRET_BYTES
  ) {
    return configurationError();
  }
  return value;
}

export function loadPlatformWahaProjectionRecoveryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformWahaProjectionRecoveryConfig {
  if (environment.EVO_PLATFORM_WAHA_WORKER_ENABLED !== "1") {
    return Object.freeze({ enabled: false });
  }

  const backend = getPlatformMessagingBackendConfig(environment);
  return Object.freeze({
    enabled: true,
    organizationId: backend.organizationId,
    supabaseUrl: backend.supabaseUrl,
    supabaseSecretKey: backend.supabaseSecretKey,
    triggerSecret: triggerSecret(
      environment.EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET,
    ),
    intakeSalesMembershipId: requiredUuid(
      environment.EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID,
    ),
    maxClockSkewMs: MAX_CLOCK_SKEW_MS,
  });
}

function normalizeDueWork(
  value: unknown,
  organizationId: string,
): DueWork | null {
  if (!isObject(value)) throw new Error("Invalid WAHA recovery selection.");
  if (
    value.found === false &&
    value.organization_id === organizationId &&
    value.queue === "platform_work_v1" &&
    Object.keys(value).sort().join(",") ===
      "found,organization_id,queue"
  ) {
    return null;
  }

  const eventType = value.event_type;
  const queueMessageId = value.queue_message_id;
  const workItemId = uuid(value.work_item_id);
  if (
    value.found !== true ||
    value.organization_id !== organizationId ||
    value.kind !== "provider_webhook_process" ||
    value.queue !== "platform_work_v1" ||
    workItemId === null ||
    (eventType !== "message" &&
      eventType !== "message.any" &&
      eventType !== "message.ack") ||
    (value.state !== "queued" &&
      value.state !== "leased" &&
      value.state !== "retry_wait") ||
    !Number.isSafeInteger(queueMessageId) ||
    (queueMessageId as number) < 1 ||
    Object.keys(value).sort().join(",") !==
      "event_type,found,kind,organization_id,queue,queue_message_id,state,work_item_id"
  ) {
    throw new Error("Invalid WAHA recovery selection.");
  }

  return Object.freeze({ workItemId, eventType });
}

async function selectDueWork(
  client: RpcClient,
  organizationId: string,
): Promise<DueWork | null> {
  let response;
  try {
    response = await client
      .schema("platform")
      .rpc("next_recoverable_waha_webhook_work_item", {
        p_organization_id: organizationId,
      });
  } catch {
    throw new PlatformWahaProjectorError();
  }
  if (response.error) throw new PlatformWahaProjectorError();
  return normalizeDueWork(response.data, organizationId);
}

/**
 * Runs at most one due pointer through the same exact projector used inline by
 * the webhook. This function does not schedule itself and performs no WAHA or
 * other provider call. A private deployment scheduler must POST periodically
 * with a fresh request ID so retry_wait rows recover after their visibility
 * delay even when WAHA sends no new delivery; retrying one scheduler request ID
 * replays that request's exact claim/project/finish receipts.
 */
async function recoverOne(
  client: RpcClient,
  config: PlatformWahaProjectionRecoveryEnabledConfig,
  requestId: string,
): Promise<RecoveryResult> {
  const due = await selectDueWork(client, config.organizationId);
  if (due === null) return Object.freeze({ processed: false, requestId });

  const projected = await projectPlatformWahaWorkItem({
    client,
    organizationId: config.organizationId,
    workItemId: due.workItemId,
    requestId,
    environment: {
      ...process.env,
      EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID:
        config.intakeSalesMembershipId,
    },
  });
  if (projected.eventType !== due.eventType) {
    throw new PlatformWahaProjectorError();
  }

  return Object.freeze({
    processed: true,
    requestId,
    workItemId: projected.workItemId,
    eventType: projected.eventType,
    state: projected.state,
    deduplicated: projected.deduplicated,
  });
}

function authenticatedRequestId(
  request: Request,
  config: PlatformWahaProjectionRecoveryEnabledConfig,
  nowMs: number,
): string | null {
  const requestId = request.headers.get("x-evo-worker-request-id");
  const timestamp = request.headers.get("x-evo-worker-timestamp");
  const algorithm = request.headers.get("x-evo-worker-hmac-algorithm");
  const signature = request.headers.get("x-evo-worker-hmac");
  if (
    requestId === null ||
    uuid(requestId) !== requestId ||
    timestamp === null ||
    !/^\d{13}$/.test(timestamp) ||
    algorithm !== "sha256" ||
    signature === null ||
    !HMAC_SHA256_PATTERN.test(signature)
  ) {
    return null;
  }

  const timestampMs = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampMs) ||
    !Number.isSafeInteger(nowMs) ||
    Math.abs(nowMs - timestampMs) > config.maxClockSkewMs
  ) {
    return null;
  }

  const expected = createHmac("sha256", config.triggerSecret)
    .update(`${requestId}.${timestamp}`, "utf8")
    .digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? requestId
    : null;
}

async function isBodylessPost(request: Request): Promise<boolean> {
  if (request.method !== "POST" || request.headers.has("transfer-encoding")) {
    return false;
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) return request.body === null;
  if (contentLength !== "0") return false;
  if (request.body === null) return true;

  const reader = request.body.getReader();
  try {
    const { done, value } = await reader.read();
    return done && (value === undefined || value.byteLength === 0);
  } catch {
    return false;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export function createPlatformWahaProjectionRecoveryHandler(
  dependencies: RecoveryDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    let config: PlatformWahaProjectionRecoveryConfig;
    try {
      config =
        dependencies.config ?? loadPlatformWahaProjectionRecoveryConfig();
    } catch {
      return jsonError("worker_not_configured", 503);
    }
    if (!config.enabled) return jsonError("worker_disabled", 503);

    const requestId = authenticatedRequestId(
      request,
      config,
      (dependencies.nowMs ?? Date.now)(),
    );
    if (requestId === null) return jsonError("unauthorized", 401);
    if (!(await isBodylessPost(request))) {
      return jsonError("body_not_allowed", 400);
    }

    try {
      const client =
        dependencies.client ?? createPlatformSupabaseServiceClient(config);
      const result = await recoverOne(client, config, requestId);
      return Response.json({ ok: true, ...result }, { status: 200 });
    } catch (error) {
      if (error instanceof PlatformWahaProjectorError) {
        return jsonError(error.code, error.status);
      }
      return jsonError("provider_projection_unavailable", 503);
    }
  };
}
