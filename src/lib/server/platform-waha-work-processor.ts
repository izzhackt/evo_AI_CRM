import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  loadPlatformWahaWorkerConfig,
  PlatformWahaWorkerConfigurationError,
  type PlatformWahaWorkerConfig,
  type PlatformWahaWorkerEnabledConfig,
} from "./platform-waha-worker-config.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const EVIDENCE_REF_PATTERN = /^[\x20-\x7e]{1,500}$/;
const MAX_POSTGRES_BIGINT = "9223372036854775807";
const HMAC_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const WORKER_TRIGGER_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

type ProjectionDisposition =
  | "succeeded"
  | "retryable_error"
  | "terminal_error";

type ClaimResult =
  | Readonly<{ claimed: false; queue: "platform_work_v1" }>
  | Readonly<{
      claimed: true;
      organizationId: string;
      workItemId: string;
      attemptId: string;
      sourceWebhookEventId: string;
      queueMessageId: string;
      attemptNumber: number;
      maxAttempts: number;
      leaseExpiresAt: string;
    }>;

type ProjectionResult = Readonly<{
  organizationId: string;
  workItemId: string;
  attemptId: string;
  disposition: ProjectionDisposition;
  evidenceRef: string;
  errorCode: string | null;
}>;

type FinishResult = Readonly<{
  organizationId: string;
  workItemId: string;
  attemptId: string;
  state: string;
  outcome: string;
}>;

export type PlatformWahaWorkRepository = Readonly<{
  claim(input: Readonly<{
    organizationId: string;
    visibilityTimeoutSeconds: number;
    workerRef: string;
    requestId: string;
  }>): Promise<ClaimResult>;
  project(input: Readonly<{
    organizationId: string;
    workItemId: string;
    attemptId: string;
    intakeSalesMembershipId: string;
    requestId: string;
  }>): Promise<ProjectionResult>;
  finish(input: Readonly<{
    organizationId: string;
    workItemId: string;
    attemptId: string;
    outcome: ProjectionDisposition;
    errorCode: string | null;
    evidenceRef: string;
    retryDelaySeconds: number | null;
    requestId: string;
  }>): Promise<FinishResult>;
}>;

export type PlatformWahaWorkHandlerDependencies = Readonly<{
  config?: PlatformWahaWorkerConfig;
  repository?: PlatformWahaWorkRepository;
  nowMs?: () => number;
}>;

class PlatformWahaWorkRepositoryError extends Error {
  constructor() {
    super("Platform WAHA work processing is unavailable.");
    this.name = "PlatformWahaWorkRepositoryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function positiveBigint(value: unknown): string | null {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : null;
  if (normalized === null || !/^[1-9]\d*$/.test(normalized)) return null;
  if (
    normalized.length > MAX_POSTGRES_BIGINT.length ||
    (normalized.length === MAX_POSTGRES_BIGINT.length &&
      normalized > MAX_POSTGRES_BIGINT)
  ) {
    return null;
  }
  return normalized;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !TIMESTAMPTZ_PATTERN.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function evidenceRef(value: unknown): string | null {
  return typeof value === "string" && EVIDENCE_REF_PATTERN.test(value)
    ? value
    : null;
}

function errorCode(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && ERROR_CODE_PATTERN.test(value)
    ? value
    : undefined;
}

function normalizeClaim(value: unknown): ClaimResult {
  if (!isRecord(value) || typeof value.claimed !== "boolean") {
    throw new PlatformWahaWorkRepositoryError();
  }
  if (!value.claimed) {
    if (value.queue !== "platform_work_v1") {
      throw new PlatformWahaWorkRepositoryError();
    }
    return Object.freeze({ claimed: false, queue: "platform_work_v1" });
  }

  const organizationId = uuid(value.organization_id);
  const workItemId = uuid(value.work_item_id);
  const attemptId = uuid(value.attempt_id);
  const sourceWebhookEventId = uuid(value.source_webhook_event_id);
  const queueMessageId = positiveBigint(value.queue_message_id);
  const attemptNumber = positiveInteger(value.attempt_number);
  const maxAttempts = positiveInteger(value.max_attempts);
  const leaseExpiresAt = timestamp(value.lease_expires_at);

  if (
    value.kind !== "provider_webhook_process" ||
    value.queue !== "platform_work_v1" ||
    organizationId === null ||
    workItemId === null ||
    attemptId === null ||
    sourceWebhookEventId === null ||
    queueMessageId === null ||
    attemptNumber === null ||
    maxAttempts === null ||
    attemptNumber > maxAttempts ||
    leaseExpiresAt === null
  ) {
    throw new PlatformWahaWorkRepositoryError();
  }

  return Object.freeze({
    claimed: true,
    organizationId,
    workItemId,
    attemptId,
    sourceWebhookEventId,
    queueMessageId,
    attemptNumber,
    maxAttempts,
    leaseExpiresAt,
  });
}

function normalizeProjection(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    workItemId: string;
    attemptId: string;
  }>,
): ProjectionResult {
  if (!isRecord(value)) throw new PlatformWahaWorkRepositoryError();

  const organizationId = uuid(value.organization_id);
  const workItemId = uuid(value.work_item_id);
  const attemptId = uuid(value.attempt_id);
  const disposition = value.disposition;
  const normalizedEvidenceRef = evidenceRef(value.evidence_ref);
  const normalizedErrorCode = errorCode(value.error_code);

  if (
    organizationId !== expected.organizationId ||
    workItemId !== expected.workItemId ||
    attemptId !== expected.attemptId ||
    (disposition !== "succeeded" &&
      disposition !== "retryable_error" &&
      disposition !== "terminal_error") ||
    normalizedEvidenceRef === null ||
    normalizedErrorCode === undefined ||
    (disposition === "succeeded" && normalizedErrorCode !== null) ||
    (disposition !== "succeeded" && normalizedErrorCode === null)
  ) {
    throw new PlatformWahaWorkRepositoryError();
  }

  return Object.freeze({
    organizationId,
    workItemId,
    attemptId,
    disposition,
    evidenceRef: normalizedEvidenceRef,
    errorCode: normalizedErrorCode,
  });
}

function normalizeFinish(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    workItemId: string;
    attemptId: string;
    outcome: ProjectionDisposition;
  }>,
): FinishResult {
  if (!isRecord(value)) throw new PlatformWahaWorkRepositoryError();

  const organizationId = uuid(value.organization_id);
  const workItemId = uuid(value.work_item_id);
  const attemptId = uuid(value.attempt_id);
  if (
    organizationId !== expected.organizationId ||
    workItemId !== expected.workItemId ||
    attemptId !== expected.attemptId ||
    value.outcome !== expected.outcome ||
    typeof value.state !== "string" ||
    value.state.length === 0
  ) {
    throw new PlatformWahaWorkRepositoryError();
  }

  return Object.freeze({
    organizationId,
    workItemId,
    attemptId,
    state: value.state,
    outcome: expected.outcome,
  });
}

export function createPlatformWahaWorkRepository(
  client: SupabaseClient,
): PlatformWahaWorkRepository {
  return Object.freeze({
    async claim(input) {
      const response = await client.schema("platform").rpc(
        "claim_waha_webhook_work",
        {
          p_organization_id: input.organizationId,
          p_visibility_timeout_seconds: input.visibilityTimeoutSeconds,
          p_worker_ref: input.workerRef,
          p_request_id: input.requestId,
        },
      );
      if (response.error) throw new PlatformWahaWorkRepositoryError();
      return normalizeClaim(response.data);
    },

    async project(input) {
      const response = await client.schema("platform").rpc(
        "project_claimed_waha_event",
        {
          p_organization_id: input.organizationId,
          p_work_item_id: input.workItemId,
          p_attempt_id: input.attemptId,
          p_intake_sales_membership_id: input.intakeSalesMembershipId,
          p_request_id: input.requestId,
        },
      );
      if (response.error) throw new PlatformWahaWorkRepositoryError();
      return normalizeProjection(response.data, input);
    },

    async finish(input) {
      const response = await client.schema("platform").rpc(
        "finish_waha_webhook_work",
        {
          p_organization_id: input.organizationId,
          p_work_item_id: input.workItemId,
          p_attempt_id: input.attemptId,
          p_outcome: input.outcome,
          p_error_code: input.errorCode,
          p_evidence_ref: input.evidenceRef,
          p_retry_delay_seconds: input.retryDelaySeconds,
          p_request_id: input.requestId,
        },
      );
      if (response.error) throw new PlatformWahaWorkRepositoryError();
      return normalizeFinish(response.data, {
        organizationId: input.organizationId,
        workItemId: input.workItemId,
        attemptId: input.attemptId,
        outcome: input.outcome,
      });
    },
  });
}

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
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
  secret: string,
  nowMs: number,
): string | null {
  const requestId = request.headers.get("x-evo-worker-request-id");
  const timestampHeader = request.headers.get("x-evo-worker-timestamp");
  const algorithm = request.headers.get("x-evo-worker-hmac-algorithm");
  const signature = request.headers.get("x-evo-worker-hmac");

  if (
    requestId === null ||
    uuid(requestId) !== requestId.toLowerCase() ||
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
    Math.abs(nowMs - timestampMs) > WORKER_TRIGGER_MAX_CLOCK_SKEW_MS
  ) {
    return null;
  }

  const expected = createHmac("sha256", secret)
    .update(`${requestId.toLowerCase()}.${timestampHeader}`, "utf8")
    .digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? requestId.toLowerCase()
    : null;
}

function createDefaultRepository(
  config: PlatformWahaWorkerEnabledConfig,
): PlatformWahaWorkRepository {
  return createPlatformWahaWorkRepository(
    createPlatformSupabaseServiceClient(config),
  );
}

export function createPlatformWahaWorkHandler(
  dependencies: PlatformWahaWorkHandlerDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    let config: PlatformWahaWorkerConfig;
    try {
      config = dependencies.config ?? loadPlatformWahaWorkerConfig();
    } catch (error) {
      if (error instanceof PlatformWahaWorkerConfigurationError) {
        return jsonError("not_configured", 503);
      }
      return jsonError("worker_unavailable", 503);
    }

    if (!config.enabled) return jsonError("worker_disabled", 503);
    const triggerRequestId = authenticatedRequestId(
      request,
      config.triggerSecret,
      (dependencies.nowMs ?? Date.now)(),
    );
    if (triggerRequestId === null) {
      return jsonError("unauthorized", 401);
    }

    const contentLength = request.headers.get("content-length");
    // Next's HTTP adapter can represent a real zero-byte POST as a non-null
    // body stream while preserving `content-length: 0`. Treat that exact wire
    // shape as bodyless, but keep ambiguous streaming and non-zero requests
    // fail-closed before durable work is claimed.
    const isExplicitlyEmptyBody = contentLength === "0";
    if (
      request.headers.has("transfer-encoding") ||
      (contentLength !== null && !isExplicitlyEmptyBody) ||
      (contentLength === null && request.body !== null)
    ) {
      return jsonError("invalid_request", 400);
    }

    const repository = dependencies.repository ?? createDefaultRepository(config);

    try {
      const claim = await repository.claim({
        organizationId: config.organizationId,
        visibilityTimeoutSeconds: config.visibilityTimeoutSeconds,
        workerRef: config.workerRef,
        requestId: triggerRequestId,
      });
      if (!claim.claimed) {
        return Response.json({ ok: true, processed: false }, { status: 200 });
      }
      if (claim.organizationId !== config.organizationId) {
        return jsonError("worker_unavailable", 503);
      }

      const projection = await repository.project({
        organizationId: claim.organizationId,
        workItemId: claim.workItemId,
        attemptId: claim.attemptId,
        intakeSalesMembershipId: config.intakeSalesMembershipId,
        requestId: deterministicOperationUuid(triggerRequestId, "project"),
      });

      const finish = await repository.finish({
        organizationId: claim.organizationId,
        workItemId: claim.workItemId,
        attemptId: claim.attemptId,
        outcome: projection.disposition,
        errorCode: projection.errorCode,
        evidenceRef: projection.evidenceRef,
        retryDelaySeconds:
          projection.disposition === "retryable_error"
            ? config.retryDelaySeconds
            : null,
        requestId: deterministicOperationUuid(triggerRequestId, "finish"),
      });

      return Response.json(
        {
          ok: true,
          processed: true,
          disposition: projection.disposition,
          state: finish.state,
        },
        { status: 200 },
      );
    } catch {
      // A failed/invalid projection response is deliberately not finished. The
      // durable lease expires and can be retried; no provider call happens in
      // this receive-only worker.
      return jsonError("worker_unavailable", 503);
    }
  };
}
