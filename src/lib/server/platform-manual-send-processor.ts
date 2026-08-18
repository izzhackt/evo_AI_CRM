import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadPlatformManualSendConfig,
  PlatformManualSendConfigurationError,
  type PlatformManualSendEnabledConfig,
} from "./platform-manual-send-config.ts";
import {
  createPlatformManualSendWahaClientFromSettings,
  PlatformManualSendWahaError,
} from "./platform-manual-send-waha-client.ts";
import {
  isSafeWahaProviderId,
  isWahaDirectChatId,
} from "./platform-waha-identifiers.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HMAC_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const MAX_FINAL_TEXT_CHARACTERS = 4_096;

type EmptyClaim = Readonly<{ claimed: false; queue: "platform_work_v1" }>;
type ClaimedWork = Readonly<{
  claimed: true;
  organizationId: string;
  workItemId: string;
  attemptId: string;
  authorizationId: string;
  conversationId: string;
  sourceMessageId: string;
  wahaSessionName: "crm_primary";
  chatId: string;
  replyTo: string;
  finalText: string;
  finalTextSha256: string;
  attemptNumber: 1;
  maxAttempts: 1;
  leaseExpiresAt: string;
}>;
type ClaimResult = EmptyClaim | ClaimedWork;
type FinishOutcome = "succeeded" | "terminal_error" | "unknown_result";
type FinishResult = Readonly<{
  organizationId: string;
  workItemId: string;
  attemptId: string;
  outcome: FinishOutcome;
  state: string;
}>;

export type PlatformManualSendRepository = Readonly<{
  claim(input: Readonly<{
    organizationId: string;
    workerRef: string;
    visibilityTimeoutSeconds: number;
    requestId: string;
  }>): Promise<ClaimResult>;
  finish(input: Readonly<{
    organizationId: string;
    workItemId: string;
    attemptId: string;
    authorizationId: string;
    outcome: FinishOutcome;
    errorCode: string | null;
    providerMessageId: string | null;
    providerObservedAt: string | null;
    requestId: string;
  }>): Promise<FinishResult>;
}>;

export type PlatformManualSendProvider = Readonly<{
  preflight(input: Readonly<{ session: "crm_primary" }>): Promise<
    | Readonly<{ ready: true }>
    | Readonly<{ ready: false; reasonCode: string }>
  >;
  sendText(input: Readonly<{
    session: "crm_primary";
    chatId: string;
    replyTo: string;
    text: string;
  }>): Promise<Readonly<{ providerMessageId: string }>>;
}>;

export class PlatformManualSendRepositoryError extends Error {
  constructor() {
    super("Platform manual-send repository returned an invalid result.");
    this.name = "PlatformManualSendRepositoryError";
  }
}

function repositoryError(): never {
  throw new PlatformManualSendRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return value === normalized && UUID_PATTERN.test(normalized) ? normalized : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" &&
    TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function validateClaim(value: unknown): ClaimResult {
  if (!isRecord(value) || typeof value.claimed !== "boolean") {
    return repositoryError();
  }
  if (!value.claimed) {
    if (value.queue !== "platform_work_v1") return repositoryError();
    return Object.freeze({ claimed: false, queue: "platform_work_v1" });
  }

  const organizationId = uuid(value.organizationId);
  const workItemId = uuid(value.workItemId);
  const attemptId = uuid(value.attemptId);
  const authorizationId = uuid(value.authorizationId);
  const conversationId = uuid(value.conversationId);
  const sourceMessageId = uuid(value.sourceMessageId);
  const leaseExpiresAt = timestamp(value.leaseExpiresAt);
  const finalText = typeof value.finalText === "string" ? value.finalText : null;
  const finalTextSha256 =
    typeof value.finalTextSha256 === "string" &&
    HMAC_SHA256_PATTERN.test(value.finalTextSha256)
      ? value.finalTextSha256
      : null;
  if (
    organizationId === null ||
    workItemId === null ||
    attemptId === null ||
    authorizationId === null ||
    conversationId === null ||
    sourceMessageId === null ||
    value.wahaSessionName !== "crm_primary" ||
    !isWahaDirectChatId(value.chatId) ||
    !isSafeWahaProviderId(value.replyTo) ||
    finalText === null ||
    finalText.trim().length === 0 ||
    finalText.length > MAX_FINAL_TEXT_CHARACTERS ||
    finalTextSha256 === null ||
    createHash("sha256").update(finalText, "utf8").digest("hex") !==
      finalTextSha256 ||
    value.attemptNumber !== 1 ||
    value.maxAttempts !== 1 ||
    leaseExpiresAt === null
  ) {
    return repositoryError();
  }
  return Object.freeze({
    claimed: true,
    organizationId,
    workItemId,
    attemptId,
    authorizationId,
    conversationId,
    sourceMessageId,
    wahaSessionName: "crm_primary",
    chatId: value.chatId,
    replyTo: value.replyTo,
    finalText,
    finalTextSha256,
    attemptNumber: 1,
    maxAttempts: 1,
    leaseExpiresAt,
  });
}

function normalizeClaim(value: unknown): ClaimResult {
  if (!isRecord(value) || typeof value.claimed !== "boolean") {
    return repositoryError();
  }
  if (!value.claimed) {
    return validateClaim(value);
  }
  return validateClaim({
    claimed: true,
    organizationId: value.organization_id,
    workItemId: value.work_item_id,
    attemptId: value.attempt_id,
    authorizationId: value.manual_send_authorization_id,
    conversationId: value.conversation_id,
    sourceMessageId: value.source_message_id,
    wahaSessionName: value.waha_session_name,
    chatId: value.raw_chat_id,
    replyTo: value.raw_reply_to,
    finalText: value.final_text,
    finalTextSha256: value.final_text_sha256,
    attemptNumber: value.attempt_number,
    maxAttempts: value.max_attempts,
    leaseExpiresAt: value.lease_expires_at,
  });
}

function validateFinish(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    workItemId: string;
    attemptId: string;
    outcome: FinishOutcome;
  }>,
): FinishResult {
  if (!isRecord(value)) return repositoryError();
  const result = {
    organizationId: uuid(value.organizationId ?? value.organization_id),
    workItemId: uuid(value.workItemId ?? value.work_item_id),
    attemptId: uuid(value.attemptId ?? value.attempt_id),
    outcome: value.outcome,
    state: value.state,
  };
  if (
    result.organizationId !== expected.organizationId ||
    result.workItemId !== expected.workItemId ||
    result.attemptId !== expected.attemptId ||
    result.outcome !== expected.outcome ||
    typeof result.state !== "string" ||
    result.state.length === 0 ||
    result.state.length > 64
  ) {
    return repositoryError();
  }
  return Object.freeze(result as FinishResult);
}

export function createPlatformManualSendRepository(
  client: SupabaseClient,
): PlatformManualSendRepository {
  return Object.freeze({
    async claim(input) {
      const response = await client.schema("platform").rpc(
        "claim_manual_whatsapp_send",
        {
          p_organization_id: input.organizationId,
          p_visibility_timeout_seconds: input.visibilityTimeoutSeconds,
          p_worker_ref: input.workerRef,
          p_request_id: input.requestId,
        },
      );
      if (response.error) return repositoryError();
      return normalizeClaim(response.data);
    },
    async finish(input) {
      const response = await client.schema("platform").rpc(
        "finish_manual_whatsapp_send",
        {
          p_organization_id: input.organizationId,
          p_work_item_id: input.workItemId,
          p_attempt_id: input.attemptId,
          p_authorization_id: input.authorizationId,
          p_outcome: input.outcome,
          p_error_code: input.errorCode,
          p_provider_message_id: input.providerMessageId,
          p_provider_observed_at: input.providerObservedAt,
          p_request_id: input.requestId,
        },
      );
      if (response.error) return repositoryError();
      return validateFinish(response.data, input);
    },
  });
}

function operationUuid(requestId: string, operation: string): string {
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
  config: PlatformManualSendEnabledConfig,
  nowMs: number,
): string | null {
  const requestId = request.headers.get("x-evo-manual-send-request-id");
  const timestampHeader = request.headers.get("x-evo-manual-send-timestamp");
  const algorithm = request.headers.get("x-evo-manual-send-hmac-algorithm");
  const signature = request.headers.get("x-evo-manual-send-hmac");
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

async function bodylessPost(request: Request): Promise<boolean> {
  if (request.method !== "POST" || request.headers.has("transfer-encoding")) {
    return false;
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && contentLength !== "0") return false;
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
  return Response.json({ error: { code: error } }, { status });
}

type HandlerDependencies = Readonly<{
  config?: PlatformManualSendEnabledConfig;
  repository?: PlatformManualSendRepository;
  provider?: PlatformManualSendProvider;
  nowMs?: () => number;
  nowIso?: () => string;
}>;

export function createPlatformManualSendHandler(
  dependencies: HandlerDependencies = {},
) {
  return async (request: Request): Promise<Response> => {
    let config: PlatformManualSendEnabledConfig;
    try {
      const loaded = dependencies.config ?? loadPlatformManualSendConfig();
      if (!loaded.enabled) return jsonError("manual_send_disabled", 503);
      config = loaded;
    } catch (error) {
      if (error instanceof PlatformManualSendConfigurationError) {
        return jsonError("manual_send_disabled", 503);
      }
      return jsonError("manual_send_unavailable", 503);
    }

    if (!(await bodylessPost(request))) return jsonError("invalid_request", 400);
    const triggerRequestId = authenticatedRequestId(
      request,
      config,
      (dependencies.nowMs ?? Date.now)(),
    );
    if (triggerRequestId === null) return jsonError("unauthorized", 401);

    let repository = dependencies.repository;
    let provider = dependencies.provider;
    try {
      if (repository === undefined) {
        repository = createPlatformManualSendRepository(
          createPlatformSupabaseServiceClient(config),
        );
      }
      provider ??= await createPlatformManualSendWahaClientFromSettings();
    } catch {
      return jsonError("manual_send_unavailable", 503);
    }

    try {
      const readiness = await provider.preflight({ session: "crm_primary" });
      if (!readiness.ready) return jsonError("provider_not_ready", 503);
    } catch {
      return jsonError("provider_not_ready", 503);
    }

    let claim: ClaimResult;
    try {
      claim = validateClaim(
        await repository.claim({
          organizationId: config.organizationId,
          workerRef: config.workerRef,
          visibilityTimeoutSeconds: config.visibilityTimeoutSeconds,
          requestId: operationUuid(triggerRequestId, "claim"),
        }),
      );
    } catch {
      return jsonError("manual_send_unavailable", 503);
    }
    if (!claim.claimed) {
      return Response.json({ ok: true, processed: false }, { status: 200 });
    }

    const finishBase = {
      organizationId: claim.organizationId,
      workItemId: claim.workItemId,
      attemptId: claim.attemptId,
      authorizationId: claim.authorizationId,
      requestId: operationUuid(triggerRequestId, "finish"),
    } as const;
    try {
      const sent = await provider.sendText({
        session: claim.wahaSessionName,
        chatId: claim.chatId,
        replyTo: claim.replyTo,
        text: claim.finalText,
      });
      if (!isSafeWahaProviderId(sent.providerMessageId)) {
        return jsonError("manual_send_unavailable", 503);
      }
      const finish = await repository.finish({
        ...finishBase,
        outcome: "succeeded",
        errorCode: null,
        providerMessageId: sent.providerMessageId,
        providerObservedAt: (dependencies.nowIso ?? (() => new Date().toISOString()))(),
      });
      return Response.json(
        { ok: true, processed: true, state: finish.state },
        { status: 200 },
      );
    } catch (error) {
      const providerError =
        error instanceof PlatformManualSendWahaError
          ? { kind: error.kind, code: error.code }
          : isRecord(error) &&
              (error.kind === "rejected" || error.kind === "unknown") &&
              typeof error.code === "string" &&
              ERROR_CODE_PATTERN.test(error.code)
            ? { kind: error.kind, code: error.code }
            : null;
      if (providerError === null) {
        return jsonError("manual_send_unavailable", 503);
      }
      const outcome =
        providerError.kind === "rejected" ? "terminal_error" : "unknown_result";
      try {
        const finish = await repository.finish({
          ...finishBase,
          outcome,
          errorCode: providerError.code,
          providerMessageId: null,
          providerObservedAt: null,
        });
        return Response.json(
          { ok: true, processed: true, state: finish.state },
          { status: 200 },
        );
      } catch {
        return jsonError("manual_send_unavailable", 503);
      }
    }
  };
}
