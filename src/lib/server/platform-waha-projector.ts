import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const EVIDENCE_REF_PATTERN = /^[\x20-\x7e]{1,500}$/;
const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const WORKER_REF = "nextjs:p5b-waha-projection";
const VISIBILITY_TIMEOUT_SECONDS = 60;
const RETRY_DELAY_SECONDS = 30;

type RpcClient = Pick<SupabaseClient, "schema">;
type JsonObject = Record<string, unknown>;

type ProjectionDisposition =
  | "succeeded"
  | "retryable_error"
  | "terminal_error";

type ClaimedWork = Readonly<{
  claimed: true;
  eventType: "message" | "message.any" | "message.ack";
  workItemId: string;
  attemptId: string;
}>;

type CompletedWork = Readonly<{
  claimed: false;
  terminal: false;
  eventType: "message" | "message.any" | "message.ack";
  workItemId: string;
}>;

type TerminalWork = Readonly<{
  claimed: false;
  terminal: true;
  eventType: "message" | "message.any" | "message.ack";
  workItemId: string;
}>;

type ExactClaim = ClaimedWork | CompletedWork | TerminalWork;

type ProjectionResult = Readonly<{
  disposition: ProjectionDisposition;
  evidenceRef: string;
  errorCode: string | null;
}>;

type FinishResult = Readonly<{
  state: "succeeded" | "retry_wait" | "dead_lettered";
}>;

export type PlatformWahaProjectionResult = Readonly<{
  workItemId: string;
  eventType: "message" | "message.any" | "message.ack";
  disposition: "succeeded";
  state: "succeeded";
  deduplicated: boolean;
}>;

export type PlatformWahaProjectorInput = Readonly<{
  client: RpcClient;
  organizationId: string;
  workItemId: string;
  requestId?: string;
  environment?: NodeJS.ProcessEnv;
}>;

export class PlatformWahaProjectorError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code = "provider_projection_unavailable", status = 503) {
    super("Platform WAHA projection is unavailable.");
    this.name = "PlatformWahaProjectorError";
    this.code = code;
    this.status = status;
  }
}

function unavailable(): never {
  throw new PlatformWahaProjectorError();
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === "00000000-0000-0000-0000-000000000000"
    ? null
    : normalized;
}

function operationRequestId(
  runRequestId: string,
  operation: "claim" | "project" | "finish",
): string {
  const bytes = createHash("sha256")
    .update(`evo:p5b:waha-projector:${runRequestId}:${operation}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function intakeSalesMembershipId(environment: NodeJS.ProcessEnv): string {
  const value = environment.EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID;
  const normalized = uuid(value);
  if (normalized === null || value !== value?.trim()) return unavailable();
  return normalized;
}

async function rpc(
  client: RpcClient,
  name: string,
  args: JsonObject,
): Promise<unknown> {
  let response;
  try {
    response = await client.schema("platform").rpc(name, args);
  } catch {
    return unavailable();
  }
  if (response.error) return unavailable();
  return response.data;
}

function normalizeClaim(
  value: unknown,
  organizationId: string,
  requestedWorkItemId: string,
): ExactClaim {
  if (!isObject(value)) return unavailable();

  const responseOrganizationId = uuid(value.organization_id);
  const workItemId = uuid(value.work_item_id);
  const requested = uuid(value.requested_work_item_id);
  const eventType = value.event_type;

  if (
    responseOrganizationId !== organizationId ||
    workItemId !== requestedWorkItemId ||
    requested !== requestedWorkItemId ||
    value.kind !== "provider_webhook_process" ||
    value.queue !== "platform_work_v1" ||
    (eventType !== "message" &&
      eventType !== "message.any" &&
      eventType !== "message.ack")
  ) {
    return unavailable();
  }

  if (
    value.claimed === false &&
    value.completed === true &&
    value.state === "succeeded"
  ) {
    return Object.freeze({
      claimed: false,
      terminal: false,
      eventType,
      workItemId,
    });
  }

  if (
    value.claimed === false &&
    value.completed === true &&
    value.terminal === true &&
    value.state === "dead_lettered" &&
    uuid(value.attempt_id) !== null &&
    (value.outcome === "retryable_error" ||
      value.outcome === "terminal_error") &&
    typeof value.error_code === "string" &&
    ERROR_CODE_PATTERN.test(value.error_code) &&
    typeof value.evidence_ref === "string" &&
    EVIDENCE_REF_PATTERN.test(value.evidence_ref) &&
    value.automatic_retry_allowed === false
  ) {
    return Object.freeze({
      claimed: false,
      terminal: true,
      eventType,
      workItemId,
    });
  }

  const attemptId = uuid(value.attempt_id);
  const sourceWebhookEventId = uuid(value.source_webhook_event_id);
  if (
    value.claimed !== true ||
    value.completed !== false ||
    attemptId === null ||
    sourceWebhookEventId === null ||
    typeof value.attempt_number !== "number" ||
    !Number.isSafeInteger(value.attempt_number) ||
    value.attempt_number < 1 ||
    typeof value.max_attempts !== "number" ||
    !Number.isSafeInteger(value.max_attempts) ||
    value.max_attempts < value.attempt_number ||
    typeof value.lease_expires_at !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value.lease_expires_at) ||
    Number.isNaN(Date.parse(value.lease_expires_at))
  ) {
    return unavailable();
  }

  return Object.freeze({ claimed: true, eventType, workItemId, attemptId });
}

function normalizeProjection(
  value: unknown,
  organizationId: string,
  claim: ClaimedWork,
): ProjectionResult {
  if (!isObject(value)) return unavailable();
  const disposition = value.disposition;
  const errorCode = value.error_code;
  if (
    uuid(value.organization_id) !== organizationId ||
    uuid(value.work_item_id) !== claim.workItemId ||
    uuid(value.attempt_id) !== claim.attemptId ||
    (disposition !== "succeeded" &&
      disposition !== "retryable_error" &&
      disposition !== "terminal_error") ||
    typeof value.evidence_ref !== "string" ||
    !EVIDENCE_REF_PATTERN.test(value.evidence_ref) ||
    (disposition === "succeeded" && errorCode !== null) ||
    (disposition !== "succeeded" &&
      (typeof errorCode !== "string" || !ERROR_CODE_PATTERN.test(errorCode)))
  ) {
    return unavailable();
  }

  return Object.freeze({
    disposition,
    evidenceRef: value.evidence_ref,
    errorCode: errorCode as string | null,
  });
}

function normalizeFinish(
  value: unknown,
  organizationId: string,
  claim: ClaimedWork,
  projection: ProjectionResult,
): FinishResult {
  if (!isObject(value)) return unavailable();
  const state = value.state;
  if (
    uuid(value.organization_id) !== organizationId ||
    uuid(value.work_item_id) !== claim.workItemId ||
    uuid(value.attempt_id) !== claim.attemptId ||
    value.outcome !== projection.disposition ||
    (projection.disposition === "succeeded" && state !== "succeeded") ||
    (projection.disposition === "retryable_error" &&
      state !== "retry_wait" &&
      state !== "dead_lettered") ||
    (projection.disposition === "terminal_error" && state !== "dead_lettered")
  ) {
    return unavailable();
  }

  return Object.freeze({ state: state as FinishResult["state"] });
}

export async function projectPlatformWahaWorkItem({
  client,
  organizationId: rawOrganizationId,
  workItemId: rawWorkItemId,
  requestId: rawRequestId,
  environment = process.env,
}: PlatformWahaProjectorInput): Promise<PlatformWahaProjectionResult> {
  const organizationId = uuid(rawOrganizationId);
  const workItemId = uuid(rawWorkItemId);
  const runRequestId =
    rawRequestId === undefined ? randomUUID() : uuid(rawRequestId);
  if (
    organizationId === null ||
    workItemId === null ||
    runRequestId === null
  ) {
    return unavailable();
  }

  const claim = normalizeClaim(
    await rpc(client, "claim_waha_webhook_work_item", {
      p_organization_id: organizationId,
      p_work_item_id: workItemId,
      p_visibility_timeout_seconds: VISIBILITY_TIMEOUT_SECONDS,
      p_worker_ref: WORKER_REF,
      p_request_id: operationRequestId(runRequestId, "claim"),
    }),
    organizationId,
    workItemId,
  );

  if (!claim.claimed) {
    if (claim.terminal) {
      throw new PlatformWahaProjectorError("provider_projection_rejected", 422);
    }
    return Object.freeze({
      workItemId: claim.workItemId,
      eventType: claim.eventType,
      disposition: "succeeded",
      state: "succeeded",
      deduplicated: true,
    });
  }

  const salesMembershipId = intakeSalesMembershipId(environment);

  const projectionRpc =
    claim.eventType === "message.ack"
      ? "project_claimed_waha_observation"
      : "project_claimed_waha_event";
  const finishRpc =
    claim.eventType === "message.ack"
      ? "finish_waha_event_projection"
      : "finish_waha_webhook_work";

  const projection = normalizeProjection(
    await rpc(client, projectionRpc, {
      p_organization_id: organizationId,
      p_work_item_id: claim.workItemId,
      p_attempt_id: claim.attemptId,
      p_intake_sales_membership_id: salesMembershipId,
      p_request_id: operationRequestId(runRequestId, "project"),
    }),
    organizationId,
    claim,
  );

  const finish = normalizeFinish(
    await rpc(client, finishRpc, {
      p_organization_id: organizationId,
      p_work_item_id: claim.workItemId,
      p_attempt_id: claim.attemptId,
      p_outcome: projection.disposition,
      p_error_code: projection.errorCode,
      p_evidence_ref: projection.evidenceRef,
      p_retry_delay_seconds:
        projection.disposition === "retryable_error"
          ? RETRY_DELAY_SECONDS
          : null,
      p_request_id: operationRequestId(runRequestId, "finish"),
    }),
    organizationId,
    claim,
    projection,
  );

  if (finish.state === "retry_wait") {
    throw new PlatformWahaProjectorError(
      "provider_projection_retry_scheduled",
      503,
    );
  }
  if (finish.state === "dead_lettered") {
    throw new PlatformWahaProjectorError("provider_projection_rejected", 422);
  }

  return Object.freeze({
    workItemId: claim.workItemId,
    eventType: claim.eventType,
    disposition: "succeeded",
    state: "succeeded",
    deduplicated: false,
  });
}
