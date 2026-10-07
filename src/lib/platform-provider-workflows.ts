import "server-only";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9][0-9]*$/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";

const SAFE_WORKFLOW_ERROR_MESSAGE =
  "Platform provider workflow is unavailable.";

export const PLATFORM_WAHA_SESSION_NAME = "crm_primary" as const;
export const PLATFORM_WAHA_BASE_URL = "http://evo-crm-waha:3000" as const;

type PlatformProviderRpcResponse = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type PlatformProviderRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<PlatformProviderRpcResponse>;
  }>;
}>;

export class PlatformProviderWorkflowError extends Error {
  constructor() {
    super(SAFE_WORKFLOW_ERROR_MESSAGE);
    this.name = "PlatformProviderWorkflowError";
  }
}

/**
 * The database refused a manual-send request before anything was recorded
 * (migrations 050/266). Only the reason travels; the database message and
 * SQLSTATE stay on the server.
 */
export type PlatformManualSendRefusalReason =
  | "stale_source"
  | "duplicate"
  | "not_ready"
  | "forbidden"
  | "invalid";

export class PlatformManualSendRefusedError extends PlatformProviderWorkflowError {
  readonly reason: PlatformManualSendRefusalReason;

  constructor(reason: PlatformManualSendRefusalReason) {
    super();
    this.name = "PlatformManualSendRefusedError";
    this.reason = reason;
  }
}

/** SQLSTATE and message of the manual-send request → the one reason staff can act on. */
export function classifyManualSendRefusal(
  error: unknown,
): PlatformManualSendRefusalReason | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  const message = String((error as { message?: unknown }).message ?? "");
  if (code === "42501") return "forbidden";
  if (code === "22023") return "invalid";
  if (code !== "55000") return null;
  if (message.startsWith("duplicate_of_unresolved")) return "duplicate";
  if (/integration is not fresh provider-observed ready/u.test(message)) return "not_ready";
  if (/latest inbound message/u.test(message)) return "stale_source";
  return null;
}

function unavailable(): never {
  throw new PlatformProviderWorkflowError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key));
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return unavailable();
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? unavailable() : normalized;
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return unavailable();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function requiredTrimmedText(
  value: unknown,
  minLength: number,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    return unavailable();
  }
  return value;
}

function requiredReason(value: unknown): string {
  const reason = requiredTrimmedText(value, 1, 1_000);
  return CONTROL_CHARACTER_PATTERN.test(reason) ? unavailable() : reason;
}

function requiredInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum
    ? value
    : unavailable();
}

function requiredBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : unavailable();
}

function requiredSha256(value: unknown): string {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value
    : unavailable();
}

function requiredPositiveBigint(value: unknown): string {
  const normalized = typeof value === "number"
    ? Number.isSafeInteger(value) && value > 0 ? String(value) : unavailable()
    : value;
  if (
    typeof normalized !== "string" ||
    !POSITIVE_BIGINT_PATTERN.test(normalized) ||
    normalized.length > POSTGRES_BIGINT_MAX.length ||
    (
      normalized.length === POSTGRES_BIGINT_MAX.length &&
      normalized > POSTGRES_BIGINT_MAX
    )
  ) {
    return unavailable();
  }
  return normalized;
}

function requiredSafeIdentifier(value: unknown, maximumLength = 512): string {
  const identifier = requiredTrimmedText(value, 1, maximumLength);
  return CONTROL_CHARACTER_PATTERN.test(identifier) ? unavailable() : identifier;
}

function requiredPrintableProviderId(value: unknown): string {
  const identifier = requiredTrimmedText(value, 1, 512);
  return PRINTABLE_ASCII_PATTERN.test(identifier) ? identifier : unavailable();
}

function requiredErrorCode(value: unknown): string {
  const code = requiredTrimmedText(value, 2, 64);
  return ERROR_CODE_PATTERN.test(code) ? code : unavailable();
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : unavailable();
}

function exactOneRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return unavailable();
  }
  return value[0];
}

async function callRpc(
  client: PlatformProviderRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  options?: Readonly<{ get?: boolean }>,
): Promise<unknown> {
  try {
    const response = await client.schema("platform").rpc(
      functionName,
      args,
      options,
    );
    if (
      !isRecord(response) ||
      !("data" in response) ||
      !("error" in response) ||
      response.error !== null
    ) {
      return unavailable();
    }
    return response.data;
  } catch {
    return unavailable();
  }
}

export type PlatformManualWhatsAppSendRequest = Readonly<{
  organizationId: string;
  conversationId: string;
  sourceMessageId: string;
  aiDraftId: string | null;
  finalText: string;
  reason: string;
  businessKeySha256: string;
  requestId: string;
}>;

export type PlatformManualWhatsAppSendAuthorization = Readonly<{
  organizationId: string;
  manualSendAuthorizationId: string;
  communicationConversationId: string;
  sourceMessageId: string;
  aiDraftId: string | null;
  finalText: string;
  finalTextSha256: string;
  authorizedByMembershipId: string;
  state: "manual_send_authorized";
  requestedByMembershipId: string;
  workItemId: string;
  workState: "queued";
  queueMessageId: string;
  businessKeySha256: string;
  wahaReadiness: "ready";
  wahaReadinessEvidenceKind: "provider_observed";
  wahaReadinessFresh: true;
  wahaReadinessObservedAt: string;
}>;

const MANUAL_SEND_AUTHORIZATION_KEYS = Object.freeze([
  "organization_id",
  "manual_send_authorization_id",
  "communication_conversation_id",
  "source_message_id",
  "ai_draft_id",
  "final_text",
  "final_text_sha256",
  "authorized_by_membership_id",
  "state",
  "requested_by_membership_id",
  "work_item_id",
  "work_state",
  "queue_message_id",
  "business_key_sha256",
  "waha_readiness",
  "waha_readiness_evidence_kind",
  "waha_readiness_fresh",
  "waha_readiness_observed_at",
] as const);

export async function requestManualWhatsAppSendWithAuthorization(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppSendRequest,
): Promise<PlatformManualWhatsAppSendAuthorization> {
  const organizationId = requiredUuid(input.organizationId);
  const conversationId = requiredUuid(input.conversationId);
  const sourceMessageId = requiredUuid(input.sourceMessageId);
  const aiDraftId = optionalUuid(input.aiDraftId);
  const finalText = requiredTrimmedText(input.finalText, 1, 16_000);
  const businessKeySha256 = requiredSha256(input.businessKeySha256);
  const args = {
    p_organization_id: organizationId,
    p_conversation_id: conversationId,
    p_source_message_id: sourceMessageId,
    p_ai_draft_id: aiDraftId,
    p_final_text: finalText,
    p_reason: requiredReason(input.reason),
    p_business_key_sha256: businessKeySha256,
    p_request_id: requiredUuid(input.requestId),
  };
  let response: PlatformProviderRpcResponse;
  try {
    response = await client.schema("platform").rpc(
      "request_manual_whatsapp_send_with_authorization",
      args,
    );
  } catch {
    return unavailable();
  }
  if (!isRecord(response) || !("data" in response) || !("error" in response)) {
    return unavailable();
  }
  if (response.error !== null) {
    const reason = classifyManualSendRefusal(response.error);
    if (reason !== null) throw new PlatformManualSendRefusedError(reason);
    return unavailable();
  }
  const row = response.data;
  if (!isRecord(row) || !hasExactKeys(row, MANUAL_SEND_AUTHORIZATION_KEYS)) {
    return unavailable();
  }

  const result: PlatformManualWhatsAppSendAuthorization = Object.freeze({
    organizationId: requiredUuid(row.organization_id),
    manualSendAuthorizationId: requiredUuid(
      row.manual_send_authorization_id,
    ),
    communicationConversationId: requiredUuid(
      row.communication_conversation_id,
    ),
    sourceMessageId: requiredUuid(row.source_message_id),
    aiDraftId: optionalUuid(row.ai_draft_id),
    finalText: requiredTrimmedText(row.final_text, 1, 16_000),
    finalTextSha256: requiredSha256(row.final_text_sha256),
    authorizedByMembershipId: requiredUuid(
      row.authorized_by_membership_id,
    ),
    state: requiredEnum(row.state, ["manual_send_authorized"] as const),
    requestedByMembershipId: requiredUuid(
      row.requested_by_membership_id,
    ),
    workItemId: requiredUuid(row.work_item_id),
    workState: requiredEnum(row.work_state, ["queued"] as const),
    queueMessageId: requiredPositiveBigint(row.queue_message_id),
    businessKeySha256: requiredSha256(row.business_key_sha256),
    wahaReadiness: requiredEnum(row.waha_readiness, ["ready"] as const),
    wahaReadinessEvidenceKind: requiredEnum(
      row.waha_readiness_evidence_kind,
      ["provider_observed"] as const,
    ),
    wahaReadinessFresh: requiredBoolean(row.waha_readiness_fresh) as true,
    wahaReadinessObservedAt: requiredTimestamp(
      row.waha_readiness_observed_at,
    ),
  });

  if (
    result.organizationId !== organizationId ||
    result.communicationConversationId !== conversationId ||
    result.sourceMessageId !== sourceMessageId ||
    result.aiDraftId !== aiDraftId ||
    result.finalText !== finalText ||
    result.authorizedByMembershipId !== result.requestedByMembershipId ||
    result.businessKeySha256 !== businessKeySha256 ||
    result.wahaReadinessFresh !== true
  ) {
    return unavailable();
  }
  return result;
}

export type PlatformManualWhatsAppClaimRequest = Readonly<{
  organizationId: string;
  workItemId: string;
  visibilityTimeoutSeconds: number;
  workerRef: string;
  requestId: string;
}>;

export type PlatformManualWhatsAppUnavailableClaim = Readonly<{
  claimed: false;
  queue: "platform_work_v1";
  requestedWorkItemId: string;
}>;

export type PlatformManualWhatsAppClaimedItem = Readonly<{
  claimed: true;
  organizationId: string;
  workItemId: string;
  requestedWorkItemId: string;
  attemptId: string;
  kind: "manual_whatsapp_send";
  manualSendAuthorizationId: string;
  conversationId: string;
  sourceMessageId: string;
  wahaSessionName: typeof PLATFORM_WAHA_SESSION_NAME;
  rawChatId: string;
  rawReplyTo: string;
  finalText: string;
  finalTextSha256: string;
  attemptNumber: 1;
  maxAttempts: 1;
  leaseExpiresAt: string;
  queuePayloadIsPointerOnly: true;
}>;

export type PlatformManualWhatsAppClaimResult =
  | PlatformManualWhatsAppUnavailableClaim
  | PlatformManualWhatsAppClaimedItem;

const MANUAL_SEND_UNAVAILABLE_CLAIM_KEYS = Object.freeze([
  "claimed",
  "queue",
  "requested_work_item_id",
] as const);

const MANUAL_SEND_CLAIMED_ITEM_KEYS = Object.freeze([
  "claimed",
  "organization_id",
  "work_item_id",
  "requested_work_item_id",
  "attempt_id",
  "kind",
  "manual_send_authorization_id",
  "conversation_id",
  "source_message_id",
  "waha_session_name",
  "raw_chat_id",
  "raw_reply_to",
  "final_text",
  "final_text_sha256",
  "attempt_number",
  "max_attempts",
  "lease_expires_at",
  "queue_payload_is_pointer_only",
] as const);

export async function claimManualWhatsAppSendItem(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppClaimRequest,
): Promise<PlatformManualWhatsAppClaimResult> {
  const organizationId = requiredUuid(input.organizationId);
  const workItemId = requiredUuid(input.workItemId);
  const data = await callRpc(client, "claim_manual_whatsapp_send_item", {
    p_organization_id: organizationId,
    p_work_item_id: workItemId,
    p_visibility_timeout_seconds: requiredInteger(
      input.visibilityTimeoutSeconds,
      1,
      3_600,
    ),
    p_worker_ref: requiredSafeIdentifier(input.workerRef, 160),
    p_request_id: requiredUuid(input.requestId),
  });
  if (!isRecord(data)) return unavailable();

  if (data.claimed === false) {
    if (!hasExactKeys(data, MANUAL_SEND_UNAVAILABLE_CLAIM_KEYS)) {
      return unavailable();
    }
    const result: PlatformManualWhatsAppUnavailableClaim = Object.freeze({
      claimed: false,
      queue: requiredEnum(data.queue, ["platform_work_v1"] as const),
      requestedWorkItemId: requiredUuid(data.requested_work_item_id),
    });
    return result.requestedWorkItemId === workItemId ? result : unavailable();
  }

  if (
    data.claimed !== true ||
    !hasExactKeys(data, MANUAL_SEND_CLAIMED_ITEM_KEYS)
  ) {
    return unavailable();
  }
  const result: PlatformManualWhatsAppClaimedItem = Object.freeze({
    claimed: true,
    organizationId: requiredUuid(data.organization_id),
    workItemId: requiredUuid(data.work_item_id),
    requestedWorkItemId: requiredUuid(data.requested_work_item_id),
    attemptId: requiredUuid(data.attempt_id),
    kind: requiredEnum(data.kind, ["manual_whatsapp_send"] as const),
    manualSendAuthorizationId: requiredUuid(
      data.manual_send_authorization_id,
    ),
    conversationId: requiredUuid(data.conversation_id),
    sourceMessageId: requiredUuid(data.source_message_id),
    wahaSessionName: requiredEnum(data.waha_session_name, [
      PLATFORM_WAHA_SESSION_NAME,
    ] as const),
    rawChatId: requiredSafeIdentifier(data.raw_chat_id),
    rawReplyTo: requiredPrintableProviderId(data.raw_reply_to),
    finalText: requiredTrimmedText(data.final_text, 1, 16_000),
    finalTextSha256: requiredSha256(data.final_text_sha256),
    attemptNumber: requiredInteger(data.attempt_number, 1, 1) as 1,
    maxAttempts: requiredInteger(data.max_attempts, 1, 1) as 1,
    leaseExpiresAt: requiredTimestamp(data.lease_expires_at),
    queuePayloadIsPointerOnly: requiredBoolean(
      data.queue_payload_is_pointer_only,
    ) as true,
  });
  return result.organizationId === organizationId &&
      result.workItemId === workItemId &&
      result.requestedWorkItemId === workItemId &&
      result.queuePayloadIsPointerOnly === true
    ? result
    : unavailable();
}

export type PlatformManualSendWahaRuntime = Readonly<{
  wahaSessionName: typeof PLATFORM_WAHA_SESSION_NAME;
  wahaBaseUrl: typeof PLATFORM_WAHA_BASE_URL;
  wahaApiKey: string;
  bindingVersion: string;
}>;

const MANUAL_SEND_WAHA_RUNTIME_KEYS = Object.freeze([
  "waha_session_name",
  "waha_base_url",
  "waha_api_key",
  "binding_version",
] as const);

export async function resolveManualSendWahaRuntime(
  client: PlatformProviderRpcClient,
  organizationId: string,
): Promise<PlatformManualSendWahaRuntime> {
  const row = exactOneRow(await callRpc(
    client,
    "resolve_manual_send_waha_runtime",
    { p_organization_id: requiredUuid(organizationId) },
  ));
  if (!hasExactKeys(row, MANUAL_SEND_WAHA_RUNTIME_KEYS)) {
    return unavailable();
  }
  const wahaApiKey = requiredTrimmedText(row.waha_api_key, 16, 4_096);
  if (/[\r\n]/.test(wahaApiKey)) return unavailable();
  return Object.freeze({
    wahaSessionName: requiredEnum(row.waha_session_name, [
      PLATFORM_WAHA_SESSION_NAME,
    ] as const),
    wahaBaseUrl: requiredEnum(row.waha_base_url, [
      PLATFORM_WAHA_BASE_URL,
    ] as const),
    wahaApiKey,
    bindingVersion: requiredPositiveBigint(row.binding_version),
  });
}

export type PlatformManualWhatsAppSendOutcome =
  | "succeeded"
  | "terminal_error"
  | "unknown_result";

export type PlatformManualWhatsAppFinishRequest = Readonly<{
  organizationId: string;
  workItemId: string;
  attemptId: string;
  authorizationId: string;
  outcome: PlatformManualWhatsAppSendOutcome;
  errorCode: string | null;
  providerMessageId: string | null;
  providerObservedAt: string | null;
  requestId: string;
}>;

export type PlatformManualWhatsAppFinishResult = Readonly<{
  organizationId: string;
  workItemId: string;
  attemptId: string;
  outcome: PlatformManualWhatsAppSendOutcome;
  communicationMessageId: string | null;
  providerIdentityPrivate: true;
}>;

const MANUAL_SEND_OUTCOMES = Object.freeze([
  "succeeded",
  "terminal_error",
  "unknown_result",
] as const);

export async function finishManualWhatsAppSend(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppFinishRequest,
): Promise<PlatformManualWhatsAppFinishResult> {
  const organizationId = requiredUuid(input.organizationId);
  const workItemId = requiredUuid(input.workItemId);
  const attemptId = requiredUuid(input.attemptId);
  const outcome = requiredEnum(input.outcome, MANUAL_SEND_OUTCOMES);
  const errorCode = input.errorCode === null
    ? null
    : requiredErrorCode(input.errorCode);
  const providerMessageId = input.providerMessageId === null
    ? null
    : requiredPrintableProviderId(input.providerMessageId);
  const providerObservedAt = optionalTimestamp(input.providerObservedAt);
  if (
    (outcome === "succeeded" &&
      (errorCode !== null ||
        providerMessageId === null ||
        providerObservedAt === null)) ||
    (outcome !== "succeeded" &&
      (errorCode === null ||
        providerMessageId !== null ||
        providerObservedAt !== null))
  ) {
    return unavailable();
  }

  const data = await callRpc(client, "finish_manual_whatsapp_send", {
    p_organization_id: organizationId,
    p_work_item_id: workItemId,
    p_attempt_id: attemptId,
    p_authorization_id: requiredUuid(input.authorizationId),
    p_outcome: outcome,
    p_error_code: errorCode,
    p_provider_message_id: providerMessageId,
    p_provider_observed_at: providerObservedAt,
    p_request_id: requiredUuid(input.requestId),
  });
  if (!isRecord(data)) return unavailable();

  const result: PlatformManualWhatsAppFinishResult = Object.freeze({
    organizationId: requiredUuid(data.organization_id),
    workItemId: requiredUuid(data.work_item_id),
    attemptId: requiredUuid(data.attempt_id),
    outcome: requiredEnum(data.outcome, MANUAL_SEND_OUTCOMES),
    communicationMessageId: optionalUuid(data.communication_message_id),
    providerIdentityPrivate: requiredBoolean(
      data.provider_identity_private,
    ) as true,
  });
  if (
    result.organizationId !== organizationId ||
    result.workItemId !== workItemId ||
    result.attemptId !== attemptId ||
    result.outcome !== outcome ||
    result.providerIdentityPrivate !== true ||
    (outcome === "succeeded") !==
      (result.communicationMessageId !== null) ||
    data.automatic_retry_allowed !== false
  ) {
    return unavailable();
  }
  return result;
}

export type PlatformWhatsAppProviderSource = "api" | "app";

export type PlatformWhatsAppAckName =
  | "ERROR"
  | "PENDING"
  | "SERVER"
  | "DEVICE"
  | "READ"
  | "PLAYED"
  | "UNKNOWN";

export type PlatformManualWhatsAppReconciliationKind =
  | "unknown_recovery"
  | "ack_refresh";

export type PlatformManualWhatsAppReconciliationOutcome =
  | "message_confirmed"
  | "message_not_found"
  | "delivery_refreshed";

const PROVIDER_SOURCES = Object.freeze(["api", "app"] as const);
const WAHA_ACK_NAMES = Object.freeze([
  "ERROR",
  "PENDING",
  "SERVER",
  "DEVICE",
  "READ",
  "PLAYED",
  "UNKNOWN",
] as const);
const RECONCILIATION_KINDS = Object.freeze([
  "unknown_recovery",
  "ack_refresh",
] as const);
const RECONCILIATION_OUTCOMES = Object.freeze([
  "message_confirmed",
  "message_not_found",
  "delivery_refreshed",
] as const);

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return value === null ? null : requiredEnum(value, allowed);
}

export type PlatformManualWhatsAppReconciliationRequest = Readonly<{
  organizationId: string;
  conversationId: string;
  attemptId: string;
  requestId: string;
  reason: string;
}>;

export type PlatformManualWhatsAppReconciliationReceipt = Readonly<{
  reconciliationRequestId: string;
  reconciliationKind: PlatformManualWhatsAppReconciliationKind;
  replayed: boolean;
}>;

const RECONCILIATION_RECEIPT_KEYS = Object.freeze([
  "reconciliation_request_id",
  "reconciliation_kind",
  "replayed",
] as const);

export async function requestManualWhatsAppReconciliation(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppReconciliationRequest,
): Promise<PlatformManualWhatsAppReconciliationReceipt> {
  const row = exactOneRow(await callRpc(
    client,
    "request_manual_whatsapp_reconciliation",
    {
      p_organization_id: requiredUuid(input.organizationId),
      p_conversation_id: requiredUuid(input.conversationId),
      p_attempt_id: requiredUuid(input.attemptId),
      p_request_id: requiredUuid(input.requestId),
      p_reason: requiredReason(input.reason),
    },
  ));
  if (!hasExactKeys(row, RECONCILIATION_RECEIPT_KEYS)) {
    return unavailable();
  }
  return Object.freeze({
    reconciliationRequestId: requiredUuid(row.reconciliation_request_id),
    reconciliationKind: requiredEnum(
      row.reconciliation_kind,
      RECONCILIATION_KINDS,
    ),
    replayed: requiredBoolean(row.replayed),
  });
}

export type PlatformManualWhatsAppReconciliationContext = Readonly<{
  reconciliationRequestId: string;
  requestId: string;
  organizationId: string;
  conversationId: string;
  sourceMessageId: string;
  workItemId: string;
  attemptId: string;
  manualSendAuthorizationId: string;
  reconciliationKind: PlatformManualWhatsAppReconciliationKind;
  wahaSessionName: typeof PLATFORM_WAHA_SESSION_NAME;
  rawChatId: string;
  finalText: string;
  finalTextSha256: string;
  expectedProviderMessageId: string | null;
  providerWindowStart: string;
  providerWindowEnd: string;
  completed: boolean;
}>;

const RECONCILIATION_CONTEXT_KEYS = Object.freeze([
  "reconciliation_request_id",
  "request_id",
  "organization_id",
  "conversation_id",
  "source_message_id",
  "work_item_id",
  "attempt_id",
  "manual_send_authorization_id",
  "reconciliation_kind",
  "waha_session_name",
  "raw_chat_id",
  "final_text",
  "final_text_sha256",
  "expected_provider_message_id",
  "provider_window_start",
  "provider_window_end",
  "completed",
] as const);

export async function getManualWhatsAppReconciliationContext(
  client: PlatformProviderRpcClient,
  reconciliationRequestId: string,
): Promise<PlatformManualWhatsAppReconciliationContext> {
  const expectedRequestId = requiredUuid(reconciliationRequestId);
  const data = await callRpc(
    client,
    "manual_whatsapp_reconciliation_context",
    { p_reconciliation_request_id: expectedRequestId },
  );
  if (!isRecord(data) || !hasExactKeys(data, RECONCILIATION_CONTEXT_KEYS)) {
    return unavailable();
  }
  const kind = requiredEnum(data.reconciliation_kind, RECONCILIATION_KINDS);
  const expectedProviderMessageId = data.expected_provider_message_id === null
    ? null
    : requiredPrintableProviderId(data.expected_provider_message_id);
  const providerWindowStart = requiredTimestamp(data.provider_window_start);
  const providerWindowEnd = requiredTimestamp(data.provider_window_end);
  const result: PlatformManualWhatsAppReconciliationContext = Object.freeze({
    reconciliationRequestId: requiredUuid(data.reconciliation_request_id),
    requestId: requiredUuid(data.request_id),
    organizationId: requiredUuid(data.organization_id),
    conversationId: requiredUuid(data.conversation_id),
    sourceMessageId: requiredUuid(data.source_message_id),
    workItemId: requiredUuid(data.work_item_id),
    attemptId: requiredUuid(data.attempt_id),
    manualSendAuthorizationId: requiredUuid(
      data.manual_send_authorization_id,
    ),
    reconciliationKind: kind,
    wahaSessionName: requiredEnum(data.waha_session_name, [
      PLATFORM_WAHA_SESSION_NAME,
    ] as const),
    rawChatId: requiredSafeIdentifier(data.raw_chat_id),
    finalText: requiredTrimmedText(data.final_text, 1, 16_000),
    finalTextSha256: requiredSha256(data.final_text_sha256),
    expectedProviderMessageId,
    providerWindowStart,
    providerWindowEnd,
    completed: requiredBoolean(data.completed),
  });
  if (
    result.reconciliationRequestId !== expectedRequestId ||
    (kind === "unknown_recovery") !==
      (expectedProviderMessageId === null) ||
    Date.parse(providerWindowStart) > Date.parse(providerWindowEnd)
  ) {
    return unavailable();
  }
  return result;
}

/** At most this many provider ids are excluded from one readback (migration 266). */
const BOUND_MESSAGE_ID_LIMIT = 200;

/**
 * Provider ids of the chat's OTHER accepted CRM sends around the readback
 * window (migration 266, service role only). The bounded readback never takes
 * one of them for the attempt it checks: with several replies in a row the
 * same short text is likely to have been sent twice within the window.
 */
export async function getManualWhatsAppReconciliationBoundMessageIds(
  client: PlatformProviderRpcClient,
  reconciliationRequestId: string,
): Promise<readonly string[]> {
  const data = await callRpc(
    client,
    "manual_whatsapp_reconciliation_bound_message_ids",
    { p_reconciliation_request_id: requiredUuid(reconciliationRequestId) },
  );
  if (!Array.isArray(data) || data.length > BOUND_MESSAGE_ID_LIMIT) {
    return unavailable();
  }
  const ids = data.map((value) => requiredPrintableProviderId(value));
  return new Set(ids).size === ids.length ? Object.freeze(ids) : unavailable();
}

export type PlatformWhatsAppAckState =
  | "error"
  | "pending"
  | "server"
  | "device"
  | "read"
  | "played"
  | "unknown";

type PlatformManualWhatsAppReconciliationFinishCommon = Readonly<{
  reconciliationRequestId: string;
  wahaSessionName: typeof PLATFORM_WAHA_SESSION_NAME;
  rawChatId: string;
  finalTextSha256: string;
  completionRequestId: string;
}>;

export type PlatformManualWhatsAppReconciliationFinishRequest =
  PlatformManualWhatsAppReconciliationFinishCommon & (
    | Readonly<{
      matchCount: 0;
      providerMessageId: null;
      providerSource: null;
      ackState: null;
      providerObservedAt: null;
      ackObservedAt: null;
    }>
    | Readonly<{
      matchCount: 1;
      providerMessageId: string;
      providerSource: PlatformWhatsAppProviderSource;
      ackState: PlatformWhatsAppAckState;
      providerObservedAt: string;
      ackObservedAt: string;
    }>
  );

export type PlatformManualWhatsAppReconciliationFinishResult = Readonly<{
  reconciliationRequestId: string;
  organizationId: string;
  conversationId: string;
  attemptId: string;
  outcome: PlatformManualWhatsAppReconciliationOutcome;
  communicationMessageId: string | null;
  ackName: PlatformWhatsAppAckName | null;
  reconciliationRequired: boolean;
  replayed: boolean;
}>;

const WAHA_ACK_STATES = Object.freeze([
  "error",
  "pending",
  "server",
  "device",
  "read",
  "played",
  "unknown",
] as const);

const RECONCILIATION_FINISH_RESULT_KEYS = Object.freeze([
  "reconciliation_request_id",
  "organization_id",
  "conversation_id",
  "attempt_id",
  "outcome",
  "communication_message_id",
  "ack_name",
  "reconciliation_required",
  "replayed",
] as const);

export async function finishManualWhatsAppReconciliation(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppReconciliationFinishRequest,
): Promise<PlatformManualWhatsAppReconciliationFinishResult> {
  const reconciliationRequestId = requiredUuid(
    input.reconciliationRequestId,
  );
  const matchCount = requiredInteger(input.matchCount, 0, 1) as 0 | 1;
  const providerMessageId = input.providerMessageId === null
    ? null
    : requiredPrintableProviderId(input.providerMessageId);
  const providerSource = optionalEnum(input.providerSource, PROVIDER_SOURCES);
  const ackState = optionalEnum(input.ackState, WAHA_ACK_STATES);
  const providerObservedAt = optionalTimestamp(input.providerObservedAt);
  const ackObservedAt = optionalTimestamp(input.ackObservedAt);
  if (
    (matchCount === 0 &&
      (providerMessageId !== null ||
        providerSource !== null ||
        ackState !== null ||
        providerObservedAt !== null ||
        ackObservedAt !== null)) ||
    (matchCount === 1 &&
      (providerMessageId === null ||
        providerSource === null ||
        ackState === null ||
        providerObservedAt === null ||
        ackObservedAt === null ||
        Date.parse(ackObservedAt) < Date.parse(providerObservedAt)))
  ) {
    return unavailable();
  }

  const data = await callRpc(
    client,
    "finish_manual_whatsapp_reconciliation",
    {
      p_reconciliation_request_id: reconciliationRequestId,
      p_waha_session_name: requiredEnum(input.wahaSessionName, [
        PLATFORM_WAHA_SESSION_NAME,
      ] as const),
      p_raw_chat_id: requiredSafeIdentifier(input.rawChatId),
      p_final_text_sha256: requiredSha256(input.finalTextSha256),
      p_match_count: matchCount,
      p_provider_message_id: providerMessageId,
      p_provider_source: providerSource,
      p_ack_state: ackState,
      p_provider_observed_at: providerObservedAt,
      p_ack_observed_at: ackObservedAt,
      p_completion_request_id: requiredUuid(input.completionRequestId),
    },
  );
  if (
    !isRecord(data) ||
    !hasExactKeys(data, RECONCILIATION_FINISH_RESULT_KEYS)
  ) {
    return unavailable();
  }
  const result: PlatformManualWhatsAppReconciliationFinishResult =
    Object.freeze({
      reconciliationRequestId: requiredUuid(
        data.reconciliation_request_id,
      ),
      organizationId: requiredUuid(data.organization_id),
      conversationId: requiredUuid(data.conversation_id),
      attemptId: requiredUuid(data.attempt_id),
      outcome: requiredEnum(data.outcome, RECONCILIATION_OUTCOMES),
      communicationMessageId: optionalUuid(data.communication_message_id),
      ackName: optionalEnum(data.ack_name, WAHA_ACK_NAMES),
      reconciliationRequired: requiredBoolean(
        data.reconciliation_required,
      ),
      replayed: requiredBoolean(data.replayed),
    });
  const foundMessage = result.outcome !== "message_not_found";
  if (
    result.reconciliationRequestId !== reconciliationRequestId ||
    result.reconciliationRequired !== !foundMessage ||
    foundMessage !== (result.communicationMessageId !== null) ||
    foundMessage !== (result.ackName !== null) ||
    (matchCount === 0) !== (result.outcome === "message_not_found")
  ) {
    return unavailable();
  }
  return result;
}
