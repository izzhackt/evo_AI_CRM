import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  loadPlatformP6COverdueConfig,
  PlatformP6COverdueConfigurationError,
  type PlatformP6COverdueConfig,
  type PlatformP6COverdueEnabledConfig,
} from "./platform-p6c-overdue-config.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const HMAC_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type PlatformP6COverdueProcessResult = Readonly<{
  requestId: string;
  status: "completed";
  organizationsProcessed: number;
  taskCandidates: number;
  taskPublished: number;
  taskResolved: number;
  paymentCandidates: number;
  paymentPublished: number;
  paymentResolved: number;
}>;

export type PlatformP6COverdueRepository = Readonly<{
  process(input: Readonly<{
    requestId: string;
    workerId: string;
  }>): Promise<PlatformP6COverdueProcessResult>;
}>;

type HandlerDependencies = Readonly<{
  config?: PlatformP6COverdueConfig;
  nowMs?: () => number;
  repository?: PlatformP6COverdueRepository;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) && value !== NIL_UUID
    ? value
    : null;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Invalid P6C count.");
  }
  return value as number;
}

function normalizeProcessResult(
  value: unknown,
  expectedRequestId: string,
): PlatformP6COverdueProcessResult {
  if (!isRecord(value)) throw new Error("Invalid P6C result.");
  const expectedKeys = [
    "organizations_processed",
    "payment_candidates",
    "payment_published",
    "payment_resolved",
    "request_id",
    "status",
    "task_candidates",
    "task_published",
    "task_resolved",
  ];
  if (Object.keys(value).sort().join(",") !== expectedKeys.join(",")) {
    throw new Error("Invalid P6C result.");
  }
  const requestId = uuid(value.request_id);
  if (requestId !== expectedRequestId || value.status !== "completed") {
    throw new Error("Invalid P6C result.");
  }
  return {
    requestId,
    status: "completed",
    organizationsProcessed: count(value.organizations_processed),
    taskCandidates: count(value.task_candidates),
    taskPublished: count(value.task_published),
    taskResolved: count(value.task_resolved),
    paymentCandidates: count(value.payment_candidates),
    paymentPublished: count(value.payment_published),
    paymentResolved: count(value.payment_resolved),
  };
}

export function createPlatformP6COverdueRepository(
  client: SupabaseClient,
): PlatformP6COverdueRepository {
  return {
    async process(input) {
      const response = await client
        .schema("platform")
        .rpc("process_student_portal_overdue_notifications_v1", {
          p_request_id: input.requestId,
          p_worker_id: input.workerId,
        });
      if (response.error) throw new Error("P6C processor unavailable.");
      return normalizeProcessResult(response.data, input.requestId);
    },
  };
}

function defaultRepository(
  config: PlatformP6COverdueEnabledConfig,
): PlatformP6COverdueRepository {
  return createPlatformP6COverdueRepository(
    createPlatformSupabaseServiceClient(config),
  );
}

function authenticatedRequestId(
  request: Request,
  config: PlatformP6COverdueEnabledConfig,
  nowMs: number,
): string | null {
  const requestId = request.headers.get("x-evo-portal-overdue-request-id");
  const timestamp = request.headers.get("x-evo-portal-overdue-timestamp");
  const algorithm = request.headers.get("x-evo-portal-overdue-hmac-algorithm");
  const signature = request.headers.get("x-evo-portal-overdue-hmac");
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

export function createPlatformP6COverdueHandler(
  dependencies: HandlerDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    let config: PlatformP6COverdueConfig;
    try {
      config = dependencies.config ?? loadPlatformP6COverdueConfig();
    } catch (error) {
      return jsonError(
        error instanceof PlatformP6COverdueConfigurationError
          ? "not_configured"
          : "processor_unavailable",
        503,
      );
    }
    if (!config.enabled) return jsonError("processor_disabled", 503);

    const requestId = authenticatedRequestId(
      request,
      config,
      (dependencies.nowMs ?? Date.now)(),
    );
    if (!requestId) return jsonError("unauthorized", 401);
    if (!(await isBodylessPost(request))) {
      return jsonError("body_not_allowed", 400);
    }

    try {
      const result = await (dependencies.repository ?? defaultRepository(config)).process({
        requestId,
        workerId: config.workerId,
      });
      return Response.json({ ok: true, ...result }, { status: 200 });
    } catch {
      return jsonError("processor_unavailable", 503);
    }
  };
}
