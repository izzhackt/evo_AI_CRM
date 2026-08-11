import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadPlatformAutonomousReplyConfig,
  PlatformAutonomousReplyConfigurationError,
  type PlatformAutonomousReplyConfig,
  type PlatformAutonomousReplyEnabledConfig,
} from "./platform-autonomous-reply-config.ts";
import {
  createPlatformAutonomousReplyWahaClient,
  PlatformAutonomousReplyWahaError,
  type PlatformAutonomousReplyPreflightResult,
} from "./platform-autonomous-reply-waha-client.ts";
import {
  isSafeWahaProviderId,
  isWahaDirectChatId,
} from "./platform-waha-identifiers.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const HMAC_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const BLOCKED_REASON_CODES = new Set([
  "autonomy_paused",
  "staff_takeover",
  "staff_outbound_after_enable",
  "opted_out",
  "conversation_closed",
  "source_not_latest",
  "source_not_inbound",
  "source_unsupported",
  "outside_reply_window",
  "outside_business_hours",
  "proposal_unavailable",
  "proposal_not_ready",
  "unsupported_language",
  "unsupported_intent",
  "low_confidence",
  "risk_not_low",
  "handoff_required",
  "handoff_reason_present",
  "approved_evidence_missing",
  "session_unhealthy",
  "cooldown_active",
  "rolling_rate_exhausted",
  "consecutive_limit_reached",
  "binding_unavailable",
  "mutable_gate_blocked",
]);
const MAX_REPLY_TEXT_CHARACTERS = 4_096;
const CLAIM_POLICY_VERSION = "p5f3-v1" as const;
const WAHA_SESSION_NAME = "evo-inbox" as const;

type EmptyClaim = Readonly<{
  state: "empty";
}>;

type BlockedClaim = Readonly<{
  state: "blocked";
  decisionId: string;
  conversationId: string;
  sourceMessageId: string;
  proposalRequestId: string;
  intentId: string | null;
  reasonCode: string;
}>;

type ClaimedReply = Readonly<{
  state: "claimed";
  organizationId: string;
  decisionId: string;
  intentId: string;
  attemptId: string;
  conversationId: string;
  sourceMessageId: string;
  proposalRequestId: string;
  rawChatId: string;
  rawReplyTo: string;
  replyText: string;
  leaseExpiresAt: string;
  leaseExpiresAtMs: number;
}>;

type ClaimResult = EmptyClaim | BlockedClaim | ClaimedReply;
type FinishInputOutcome = "accepted" | "rejected" | "unknown" | "blocked";
type FinishState = "accepted" | "rejected" | "unknown" | "manual_review";

type FinishResult = Readonly<{
  organizationId: string;
  intentId: string;
  attemptId: string;
  conversationId: string;
  sourceMessageId: string;
  outcome: FinishState;
  communicationMessageId: string | null;
  ackName: "ERROR" | "PENDING" | "SERVER" | "DEVICE" | "READ" | "PLAYED" | null;
}>;

export type PlatformAutonomousReplyRepository = Readonly<{
  claim(input: Readonly<{
    organizationId: string;
    workerRef: string;
    visibilityTimeoutSeconds: number;
    policyVersion: string;
    requestId: string;
  }>): Promise<ClaimResult>;
  finish(input: Readonly<{
    organizationId: string;
    intentId: string;
    attemptId: string;
    outcome: FinishInputOutcome;
    errorCode: string | null;
    providerMessageId: string | null;
    providerObservedAt: string | null;
    requestId: string;
  }>): Promise<FinishResult>;
}>;

export type PlatformAutonomousReplyProvider = Readonly<{
  preflight(): Promise<PlatformAutonomousReplyPreflightResult>;
  sendText(input: Readonly<{
    chatId: string;
    replyTo: string;
    text: string;
  }>): Promise<Readonly<{ providerMessageId: string }>>;
}>;

export type PlatformAutonomousReplyHandlerDependencies = Readonly<{
  config?: PlatformAutonomousReplyConfig;
  repository?: PlatformAutonomousReplyRepository;
  provider?: PlatformAutonomousReplyProvider;
  nowMs?: () => number;
}>;

export class PlatformAutonomousReplyRepositoryError extends Error {
  constructor() {
    super("Platform autonomous reply repository returned an invalid result.");
    this.name = "PlatformAutonomousReplyRepositoryError";
  }
}

function repositoryError(): never {
  throw new PlatformAutonomousReplyRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function uuid(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !UUID_PATTERN.test(value) ||
    value.toLowerCase() === NIL_UUID
  ) {
    return null;
  }
  return value.toLowerCase();
}

function reasonCode(value: unknown): string | null {
  return typeof value === "string" &&
    SAFE_REASON_CODE_PATTERN.test(value) &&
    BLOCKED_REASON_CODES.has(value)
    ? value
    : null;
}

function normalizeClaim(
  value: unknown,
  organizationId: string,
): ClaimResult {
  if (!isRecord(value) || typeof value.state !== "string") {
    return repositoryError();
  }
  if (value.state === "empty") {
    if (
      !hasExactKeys(value, ["state", "policy_version"]) ||
      value.policy_version !== CLAIM_POLICY_VERSION
    ) {
      return repositoryError();
    }
    return Object.freeze({ state: "empty" });
  }
  if (value.state === "blocked") {
    if (
      !hasExactKeys(value, [
        "state",
        "decision_id",
        "conversation_id",
        "source_message_id",
        "proposal_request_id",
        "intent_id",
        "reason_code",
        "policy_version",
      ]) ||
      value.policy_version !== CLAIM_POLICY_VERSION
    ) {
      return repositoryError();
    }
    const decisionId = uuid(value.decision_id);
    const conversationId = uuid(value.conversation_id);
    const sourceMessageId = uuid(value.source_message_id);
    const proposalRequestId = uuid(value.proposal_request_id);
    const intentId = value.intent_id === null ? null : uuid(value.intent_id);
    const normalizedReasonCode = reasonCode(value.reason_code);
    if (
      decisionId === null ||
      conversationId === null ||
      sourceMessageId === null ||
      proposalRequestId === null ||
      (value.intent_id !== null && intentId === null) ||
      normalizedReasonCode === null
    ) {
      return repositoryError();
    }
    return Object.freeze({
      state: "blocked",
      decisionId,
      conversationId,
      sourceMessageId,
      proposalRequestId,
      intentId,
      reasonCode: normalizedReasonCode,
    });
  }
  if (value.state !== "claimed") return repositoryError();
  if (
    !hasExactKeys(value, [
      "state",
      "decision_id",
      "intent_id",
      "attempt_id",
      "conversation_id",
      "source_message_id",
      "proposal_request_id",
      "policy_version",
      "lease_expires_at",
      "waha_session_name",
      "reply_text",
      "raw_chat_id",
      "raw_reply_to",
    ]) ||
    value.policy_version !== CLAIM_POLICY_VERSION ||
    value.waha_session_name !== WAHA_SESSION_NAME
  ) {
    return repositoryError();
  }
  const decisionId = uuid(value.decision_id);
  const intentId = uuid(value.intent_id);
  const attemptId = uuid(value.attempt_id);
  const conversationId = uuid(value.conversation_id);
  const sourceMessageId = uuid(value.source_message_id);
  const proposalRequestId = uuid(value.proposal_request_id);
  const leaseExpiresAt = value.lease_expires_at;
  const leaseExpiresAtMs =
    typeof leaseExpiresAt === "string" ? Date.parse(leaseExpiresAt) : NaN;
  if (
    decisionId === null ||
    intentId === null ||
    attemptId === null ||
    conversationId === null ||
    sourceMessageId === null ||
    proposalRequestId === null ||
    typeof leaseExpiresAt !== "string" ||
    !Number.isFinite(leaseExpiresAtMs) ||
    !isWahaDirectChatId(value.raw_chat_id) ||
    !isSafeWahaProviderId(value.raw_reply_to) ||
    typeof value.reply_text !== "string" ||
    value.reply_text.trim().length === 0 ||
    value.reply_text.length > MAX_REPLY_TEXT_CHARACTERS
  ) {
    return repositoryError();
  }
  return Object.freeze({
    state: "claimed",
    organizationId,
    decisionId,
    intentId,
    attemptId,
    conversationId,
    sourceMessageId,
    proposalRequestId,
    rawChatId: value.raw_chat_id,
    rawReplyTo: value.raw_reply_to,
    replyText: value.reply_text,
    leaseExpiresAt,
    leaseExpiresAtMs,
  });
}

function normalizeFinish(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    intentId: string;
    attemptId: string;
    inputOutcome: FinishInputOutcome;
  }>,
): FinishResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "state",
      "intent_id",
      "attempt_id",
      "conversation_id",
      "source_message_id",
      "communication_message_id",
      "ack_name",
    ])
  ) {
    return repositoryError();
  }
  const expectedState: FinishState =
    expected.inputOutcome === "blocked"
      ? "manual_review"
      : expected.inputOutcome;
  const intentId = uuid(value.intent_id);
  const attemptId = uuid(value.attempt_id);
  const conversationId = uuid(value.conversation_id);
  const sourceMessageId = uuid(value.source_message_id);
  const communicationMessageId =
    value.communication_message_id === null
      ? null
      : uuid(value.communication_message_id);
  const ackName = value.ack_name;
  if (
    value.state !== expectedState ||
    intentId !== expected.intentId ||
    attemptId !== expected.attemptId ||
    conversationId === null ||
    sourceMessageId === null ||
    (value.communication_message_id !== null && communicationMessageId === null) ||
    (ackName !== null &&
      ackName !== "ERROR" &&
      ackName !== "PENDING" &&
      ackName !== "SERVER" &&
      ackName !== "DEVICE" &&
      ackName !== "READ" &&
      ackName !== "PLAYED") ||
    (expectedState === "accepted"
      ? communicationMessageId === null || ackName !== null
      : communicationMessageId !== null || ackName !== null)
  ) {
    return repositoryError();
  }
  return Object.freeze({
    organizationId: expected.organizationId,
    intentId,
    attemptId,
    conversationId,
    sourceMessageId,
    outcome: expectedState,
    communicationMessageId,
    ackName,
  });
}

export function createPlatformAutonomousReplyRepository(
  client: SupabaseClient,
): PlatformAutonomousReplyRepository {
  return Object.freeze({
    async claim(input) {
      const response = await client.schema("platform").rpc(
        "claim_autonomous_reply",
        {
          p_organization_id: input.organizationId,
          p_worker_ref: input.workerRef,
          p_visibility_timeout_seconds: input.visibilityTimeoutSeconds,
          p_policy_version: input.policyVersion,
          p_request_id: input.requestId,
        },
      );
      if (response.error) return repositoryError();
      return normalizeClaim(response.data, input.organizationId);
    },

    async finish(input) {
      const response = await client.schema("platform").rpc(
        "finish_autonomous_reply",
        {
          p_organization_id: input.organizationId,
          p_intent_id: input.intentId,
          p_attempt_id: input.attemptId,
          p_outcome: input.outcome,
          p_error_code: input.errorCode,
          p_provider_message_id: input.providerMessageId,
          p_provider_observed_at: input.providerObservedAt,
          p_request_id: input.requestId,
        },
      );
      if (response.error) return repositoryError();
      return normalizeFinish(response.data, {
        organizationId: input.organizationId,
        intentId: input.intentId,
        attemptId: input.attemptId,
        inputOutcome: input.outcome,
      });
    },
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
  config: PlatformAutonomousReplyEnabledConfig,
  nowMs: number,
): string | null {
  const requestId = request.headers.get("x-evo-autonomous-reply-request-id");
  const timestampHeader = request.headers.get(
    "x-evo-autonomous-reply-timestamp",
  );
  const algorithm = request.headers.get(
    "x-evo-autonomous-reply-hmac-algorithm",
  );
  const signature = request.headers.get("x-evo-autonomous-reply-hmac");
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
    reader.releaseLock();
  }
}

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

function defaultBoundaries(config: PlatformAutonomousReplyEnabledConfig): {
  repository: PlatformAutonomousReplyRepository;
  provider: PlatformAutonomousReplyProvider;
} {
  const client = createPlatformSupabaseServiceClient(config);
  return {
    repository: createPlatformAutonomousReplyRepository(client),
    provider: createPlatformAutonomousReplyWahaClient(config),
  };
}

async function finishClaim(
  repository: PlatformAutonomousReplyRepository,
  claim: ClaimedReply,
  input: Readonly<{
    outcome: FinishInputOutcome;
    errorCode: string | null;
    providerMessageId: string | null;
    providerObservedAt: string | null;
    triggerRequestId: string;
  }>,
): Promise<FinishResult> {
  const result = await repository.finish({
    organizationId: claim.organizationId,
    intentId: claim.intentId,
    attemptId: claim.attemptId,
    outcome: input.outcome,
    errorCode: input.errorCode,
    providerMessageId: input.providerMessageId,
    providerObservedAt: input.providerObservedAt,
    requestId: deterministicOperationUuid(
      input.triggerRequestId,
      `finish:${claim.attemptId}:${input.outcome}`,
    ),
  });
  if (
    result.organizationId !== claim.organizationId ||
    result.intentId !== claim.intentId ||
    result.attemptId !== claim.attemptId ||
    result.conversationId !== claim.conversationId ||
    result.sourceMessageId !== claim.sourceMessageId
  ) {
    return repositoryError();
  }
  return result;
}

export function createPlatformAutonomousReplyHandler(
  dependencies: PlatformAutonomousReplyHandlerDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    let config: PlatformAutonomousReplyConfig;
    try {
      config =
        dependencies.config ?? loadPlatformAutonomousReplyConfig(process.env);
    } catch (error) {
      if (error instanceof PlatformAutonomousReplyConfigurationError) {
        return jsonError("not_configured", 503);
      }
      return jsonError("autonomous_reply_unavailable", 503);
    }
    if (!config.enabled) return jsonError("autonomous_replies_disabled", 503);
    if (config.killSwitchEngaged) {
      return jsonError("autonomous_replies_stopped", 503);
    }

    const now = dependencies.nowMs ?? Date.now;
    const triggerRequestId = authenticatedRequestId(request, config, now());
    if (triggerRequestId === null) return jsonError("unauthorized", 401);
    if (!(await isBodylessPost(request))) {
      return jsonError("invalid_request", 400);
    }

    const defaults =
      dependencies.repository !== undefined && dependencies.provider !== undefined
        ? null
        : defaultBoundaries(config);
    const repository = dependencies.repository ?? defaults!.repository;
    const provider = dependencies.provider ?? defaults!.provider;

    let claim: ClaimResult;
    try {
      claim = await repository.claim({
        organizationId: config.organizationId,
        workerRef: config.workerRef,
        visibilityTimeoutSeconds: config.visibilityTimeoutSeconds,
        policyVersion: config.policyVersion,
        requestId: deterministicOperationUuid(triggerRequestId, "claim"),
      });
    } catch {
      return jsonError("autonomous_reply_unavailable", 503);
    }
    if (claim.state === "empty" || claim.state === "blocked") {
      return Response.json({ ok: true, state: claim.state }, { status: 200 });
    }
    if (
      claim.organizationId !== config.organizationId ||
      claim.leaseExpiresAtMs <= now()
    ) {
      try {
        await finishClaim(repository, claim, {
          outcome: "blocked",
          errorCode: "lease_expired",
          providerMessageId: null,
          providerObservedAt: null,
          triggerRequestId,
        });
      } catch {
        return jsonError("autonomous_reply_unavailable", 503);
      }
      return Response.json(
        { ok: true, state: "blocked", intentId: claim.intentId },
        { status: 200 },
      );
    }

    let preflight: PlatformAutonomousReplyPreflightResult;
    try {
      preflight = await provider.preflight();
    } catch {
      preflight = { ready: false, reasonCode: "session_status_uncertain" };
    }
    if (!preflight.ready) {
      try {
        await finishClaim(repository, claim, {
          outcome: "blocked",
          errorCode: "provider_preflight_failed",
          providerMessageId: null,
          providerObservedAt: null,
          triggerRequestId,
        });
      } catch {
        return jsonError("autonomous_reply_unavailable", 503);
      }
      return Response.json(
        { ok: true, state: "blocked", intentId: claim.intentId },
        { status: 200 },
      );
    }

    try {
      const sent = await provider.sendText({
        chatId: claim.rawChatId,
        replyTo: claim.rawReplyTo,
        text: claim.replyText,
      });
      const providerObservedAt = new Date(now()).toISOString();
      const finish = await finishClaim(repository, claim, {
        outcome: "accepted",
        errorCode: null,
        providerMessageId: sent.providerMessageId,
        providerObservedAt,
        triggerRequestId,
      });
      return Response.json(
        {
          ok: true,
          state: "accepted",
          intentId: claim.intentId,
          communicationMessageId: finish.communicationMessageId,
        },
        { status: 200 },
      );
    } catch (error) {
      if (!(error instanceof PlatformAutonomousReplyWahaError)) {
        // A repository/programming failure has an unknown durable state. Leave
        // the append-only attempt for the SQL expiry path; never send again.
        return jsonError("autonomous_reply_unavailable", 503);
      }
      const outcome: FinishInputOutcome =
        error.kind === "rejected" ? "rejected" : "unknown";
      try {
        await finishClaim(repository, claim, {
          outcome,
          errorCode: error.code,
          providerMessageId: null,
          providerObservedAt: null,
          triggerRequestId,
        });
      } catch {
        return jsonError("autonomous_reply_unavailable", 503);
      }
      return Response.json(
        { ok: true, state: outcome, intentId: claim.intentId },
        { status: 200 },
      );
    }
  };
}
