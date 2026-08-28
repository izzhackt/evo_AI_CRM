import { createHash } from "node:crypto";

import type { PlatformActor } from "./platform-auth";

const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const MAX_POSTGRES_BIGINT = "9223372036854775807";
const MAX_REASON_LENGTH = 500;
const MAX_MESSAGE_TEXT_LENGTH = 5_000;

export type PlatformAiDraftLanguage = "ru" | "en";
export type PlatformAiDraftReviewDecision =
  | "approved"
  | "rework"
  | "handoff";
export type PlatformAiDraftState =
  | "requested"
  | "awaiting_language_selection"
  | "language_selected"
  | "review_required"
  | "rework_requested"
  | "ready_for_manual_send"
  | "manual_send_authorized"
  | "handed_off";
export type PlatformOutboxState =
  | "queued"
  | "leased"
  | "retry_wait"
  | "succeeded"
  | "dead_lettered"
  | "unknown_manual_review"
  | "conflict_manual_review";

export type PlatformWorkflowIntegration = Readonly<{
  readiness:
    | "unconfigured"
    | "configured_unverified"
    | "ready"
    | "blocked";
  evidenceKind:
    | "none"
    | "configuration_check"
    | "local_non_provider"
    | "provider_observed";
  fresh: boolean;
  providerProved: boolean;
  observedAt: string | null;
}>;

export type PlatformKnowledgeCatalogItem = Readonly<{
  id: string;
  key: string;
  title: string;
  version: string;
  contentText: string;
  contentSha256: string;
  provenanceRef: string;
  approvedAt: string;
}>;

export type PlatformWorkflowKnowledgeSelection = Readonly<{
  id: string;
  key: string;
  title: string;
  version: string;
  contentSha256: string;
}>;

export type PlatformAiDraftWorkflow = Readonly<{
  requestId: string;
  aiDraftId: string | null;
  requestReason: string;
  requestedLanguage: PlatformAiDraftLanguage | null;
  detectionStatus: "confident" | "uncertain" | null;
  selectedLanguage: PlatformAiDraftLanguage | null;
  knowledgeVersionId: string | null;
  state: PlatformAiDraftState;
  generatedText: string | null;
  reviewedText: string | null;
  failureOutcome: string | null;
  requestedAt: string;
  createdAt: string | null;
  updatedAt: string;
}>;

export type PlatformManualSendWorkflow = Readonly<{
  authorizationId: string;
  finalText: string;
  authorizedAt: string;
}>;

export type PlatformOutboxWorkflow = Readonly<{
  workItemId: string;
  kind: "ai_draft_generate" | "manual_whatsapp_send";
  state: PlatformOutboxState;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  updatedAt: string;
  reviewCaseId: string | null;
  reviewStatus: "open" | "resolved" | null;
  observationKind:
    | "message_observed"
    | "ack_observed"
    | "link_resolved"
    | "conflict"
    | "unknown_result"
    | null;
  observedAt: string | null;
}>;

export type PlatformWorkflowHealth = Readonly<{
  status:
    | "ready"
    | "in_progress"
    | "persisted_not_staged"
    | "attention_required";
  draftPersisted: boolean;
  draftStaged: boolean;
  manualAuthorizationPersisted: boolean;
  manualSendStaged: boolean;
  canRequestAiDraft: boolean;
  canReviewAiDraft: boolean;
  canAuthorizeManualSend: boolean;
  canRetryStaging: boolean;
}>;

export type PlatformConversationWorkflow = Readonly<{
  conversationId: string;
  latestInbound: Readonly<{
    id: string;
    bodyText: string;
    language: "ru" | "en" | "undetermined";
    createdAt: string;
  }> | null;
  selectedKnowledge: PlatformWorkflowKnowledgeSelection | null;
  draft: PlatformAiDraftWorkflow | null;
  manualSend: PlatformManualSendWorkflow | null;
  outbox: readonly PlatformOutboxWorkflow[];
  health: PlatformWorkflowHealth;
  integrations: Readonly<{
    aiProvider: PlatformWorkflowIntegration;
    waha: PlatformWorkflowIntegration;
  }>;
  latestAuditAction: string | null;
  latestAuditAt: string | null;
}>;

export type PlatformMessagingMutationStatus =
  | "completed"
  | "persisted_not_staged"
  | "invalid"
  | "unavailable";

export type PlatformMessagingOperation =
  | "request_ai_draft"
  | "review_ai_draft"
  | "authorize_manual_send";

export type PlatformMessagingMutationResult = Readonly<{
  status: PlatformMessagingMutationStatus;
  operation: PlatformMessagingOperation;
  workflow: PlatformConversationWorkflow | null;
  retryable: boolean;
}>;

export type RequestPlatformAiDraftInput = Readonly<{
  conversationId: string;
  sourceMessageId: string;
  knowledgeVersionId: string;
  requestedLanguage: PlatformAiDraftLanguage | null;
  reason: string;
}>;

export type ReviewPlatformAiDraftInput = Readonly<{
  conversationId: string;
  aiDraftId: string;
  decision: PlatformAiDraftReviewDecision;
  reviewedText?: string;
  reason: string;
}>;

export type AuthorizePlatformManualSendInput = Readonly<{
  conversationId: string;
  sourceMessageId: string;
  aiDraftId: string | null;
  finalText: string;
  reason: string;
}>;

export class PlatformMessagingWorkflowError extends Error {
  constructor() {
    super("Platform messaging workflow is unavailable.");
    this.name = "PlatformMessagingWorkflowError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidShape(): never {
  throw new PlatformMessagingWorkflowError();
}

function parsePlatformRouteUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function parseRequiredText(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) return null;
  return normalized;
}

function parseOptionalText(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): string | null | undefined {
  if (value === null) return null;
  return parseRequiredText(value, maxLength) ?? undefined;
}

function parseTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return null;
  }
  return value;
}

function parseOptionalTimestamp(
  value: unknown,
): string | null | undefined {
  if (value === null) return null;
  return parseTimestamp(value) ?? undefined;
}

function parsePositiveBigint(value: unknown): string | null {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return String(value);
  }
  if (
    typeof value === "string" &&
    POSITIVE_INTEGER_PATTERN.test(value) &&
    (value.length < MAX_POSTGRES_BIGINT.length ||
      (value.length === MAX_POSTGRES_BIGINT.length &&
        value <= MAX_POSTGRES_BIGINT))
  ) {
    return value;
  }
  return null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}

function parseOptionalUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parsePlatformRouteUuid(value) ?? undefined;
}

function parseSha256(value: unknown): string | null {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value
    : null;
}

function isMessagingActor(actor: PlatformActor): boolean {
  return (
    (actor.platformRole === "admin" ||
      actor.platformRole === "sales" ||
      actor.platformRole === "admissions") &&
    parsePlatformRouteUuid(actor.organizationId) !== null
  );
}

function normalizeIntegration(
  readinessValue: unknown,
  evidenceValue: unknown,
  freshValue: unknown,
  observedAtValue: unknown,
): PlatformWorkflowIntegration {
  // The projection uses LEFT JOINs, so an organization with no recorded
  // integration event can legitimately expose a fully-null health group.
  if (
    readinessValue === null &&
    evidenceValue === null &&
    freshValue === null &&
    observedAtValue === null
  ) {
    return {
      readiness: "unconfigured",
      evidenceKind: "none",
      fresh: false,
      providerProved: false,
      observedAt: null,
    };
  }

  if (
    readinessValue !== "ready" &&
    readinessValue !== "blocked" &&
    readinessValue !== "configured_unverified" &&
    readinessValue !== "unconfigured"
  ) {
    return invalidShape();
  }

  if (
    evidenceValue !== null &&
    evidenceValue !== "configuration_check" &&
    evidenceValue !== "local_non_provider" &&
    evidenceValue !== "provider_observed"
  ) {
    return invalidShape();
  }

  if (typeof freshValue !== "boolean") return invalidShape();
  const observedAt = parseOptionalTimestamp(observedAtValue);
  if (observedAt === undefined) {
    return invalidShape();
  }

  const hasEvidence = evidenceValue !== null;
  if (hasEvidence !== (observedAt !== null)) {
    return invalidShape();
  }
  if (freshValue && evidenceValue !== "provider_observed") return invalidShape();

  const providerProved =
    readinessValue === "ready" &&
    evidenceValue === "provider_observed" &&
    freshValue;
  const readiness =
    (readinessValue === "ready" || readinessValue === "configured_unverified") &&
    !providerProved
      ? "configured_unverified"
      : readinessValue;

  return {
    readiness,
    evidenceKind: evidenceValue ?? "none",
    fresh: freshValue,
    providerProved,
    observedAt,
  };
}

export function normalizePlatformKnowledgeCatalogItem(
  value: unknown,
): PlatformKnowledgeCatalogItem {
  if (!isRecord(value)) return invalidShape();

  const id = parsePlatformRouteUuid(value.knowledge_version_id);
  const key = parseRequiredText(value.knowledge_key, 250);
  const title = parseRequiredText(value.title, 500);
  const version = parsePositiveBigint(value.version);
  const contentText = parseRequiredText(value.content_text);
  const contentSha256 = parseSha256(value.content_sha256);
  const provenanceRef = parseRequiredText(value.provenance_ref, 1_000);
  const approvedAt = parseTimestamp(value.approved_at);

  if (
    id === null ||
    key === null ||
    title === null ||
    version === null ||
    contentText === null ||
    contentSha256 === null ||
    provenanceRef === null ||
    approvedAt === null
  ) {
    return invalidShape();
  }

  return {
    id,
    key,
    title,
    version,
    contentText,
    contentSha256,
    provenanceRef,
    approvedAt,
  };
}

function parseLatestInbound(
  row: Record<string, unknown>,
): PlatformConversationWorkflow["latestInbound"] {
  const id = parseOptionalUuid(row.latest_inbound_message_id);
  const bodyText = parseOptionalText(
    row.latest_inbound_body_text,
    MAX_MESSAGE_TEXT_LENGTH,
  );
  const createdAt = parseOptionalTimestamp(row.latest_inbound_created_at);
  const language = row.latest_inbound_language;
  const isAbsent =
    id === null &&
    bodyText === null &&
    language === null &&
    createdAt === null;

  if (isAbsent) return null;
  if (
    id === null ||
    id === undefined ||
    bodyText === null ||
    bodyText === undefined ||
    (language !== "ru" &&
      language !== "en" &&
      language !== "undetermined") ||
    createdAt === null ||
    createdAt === undefined
  ) {
    return invalidShape();
  }

  return { id, bodyText, language, createdAt };
}

function parseSelectedKnowledge(
  row: Record<string, unknown>,
): PlatformWorkflowKnowledgeSelection | null {
  const id = parseOptionalUuid(row.selected_knowledge_version_id);
  const key = parseOptionalText(row.selected_knowledge_key, 250);
  const version =
    row.selected_knowledge_version === null
      ? null
      : parsePositiveBigint(row.selected_knowledge_version);
  const title = parseOptionalText(row.selected_knowledge_title, 500);
  const contentSha256 =
    row.selected_knowledge_content_sha256 === null
      ? null
      : parseSha256(row.selected_knowledge_content_sha256);

  if (
    id === null &&
    key === null &&
    version === null &&
    title === null &&
    contentSha256 === null
  ) {
    return null;
  }
  if (
    id === null ||
    id === undefined ||
    key === null ||
    key === undefined ||
    version === null ||
    title === null ||
    title === undefined ||
    contentSha256 === null
  ) {
    return invalidShape();
  }

  return { id, key, version, title, contentSha256 };
}

function parseDraft(
  row: Record<string, unknown>,
  selectedKnowledge: PlatformWorkflowKnowledgeSelection | null,
): PlatformAiDraftWorkflow | null {
  const requestId = parseOptionalUuid(row.latest_ai_draft_request_id);
  const requestedAt = parseOptionalTimestamp(
    row.latest_ai_draft_request_created_at,
  );
  const requestReason = parseOptionalText(
    row.latest_ai_draft_request_reason,
    MAX_REASON_LENGTH,
  );
  const requestedLanguage = row.latest_ai_draft_requested_language;
  const aiDraftId = parseOptionalUuid(row.latest_ai_draft_id);

  if (requestId === null) {
    if (
      requestedAt !== null ||
      requestReason !== null ||
      requestedLanguage !== null ||
      aiDraftId !== null ||
      selectedKnowledge !== null
    ) {
      return invalidShape();
    }
    return null;
  }
  if (
    requestId === undefined ||
    requestedAt === null ||
    requestedAt === undefined ||
    requestReason === null ||
    requestReason === undefined ||
    (requestedLanguage !== null &&
      requestedLanguage !== "ru" &&
      requestedLanguage !== "en")
  ) {
    return invalidShape();
  }

  if (aiDraftId === null) {
    for (const field of [
      row.latest_ai_draft_state,
      row.latest_ai_draft_detection_status,
      row.latest_ai_draft_selected_language,
      row.latest_ai_draft_generated_text,
      row.latest_ai_draft_reviewed_text,
      row.latest_ai_draft_created_at,
      row.latest_ai_draft_updated_at,
      row.latest_ai_draft_failure_outcome,
    ]) {
      if (field !== null) return invalidShape();
    }

    return {
      requestId,
      aiDraftId: null,
      requestReason,
      requestedLanguage,
      detectionStatus: null,
      selectedLanguage: null,
      knowledgeVersionId: selectedKnowledge?.id ?? null,
      state: "requested",
      generatedText: null,
      reviewedText: null,
      failureOutcome: null,
      requestedAt,
      createdAt: null,
      updatedAt: requestedAt,
    };
  }
  if (aiDraftId === undefined) return invalidShape();

  const state = row.latest_ai_draft_state;
  const detectionStatus = row.latest_ai_draft_detection_status;
  const selectedLanguage = row.latest_ai_draft_selected_language;
  const generatedText = parseOptionalText(
    row.latest_ai_draft_generated_text,
    MAX_MESSAGE_TEXT_LENGTH,
  );
  const reviewedText = parseOptionalText(
    row.latest_ai_draft_reviewed_text,
    MAX_MESSAGE_TEXT_LENGTH,
  );
  const failureOutcome = parseOptionalText(
    row.latest_ai_draft_failure_outcome,
    1_000,
  );
  const createdAt = parseOptionalTimestamp(row.latest_ai_draft_created_at);
  const updatedAt = parseOptionalTimestamp(row.latest_ai_draft_updated_at);

  const allowedStates: readonly PlatformAiDraftState[] = [
    "awaiting_language_selection",
    "language_selected",
    "review_required",
    "rework_requested",
    "ready_for_manual_send",
    "manual_send_authorized",
    "handed_off",
  ];
  if (
    !allowedStates.includes(state as PlatformAiDraftState) ||
    (detectionStatus !== "confident" && detectionStatus !== "uncertain") ||
    (selectedLanguage !== null &&
      selectedLanguage !== "ru" &&
      selectedLanguage !== "en") ||
    generatedText === undefined ||
    reviewedText === undefined ||
    failureOutcome === undefined ||
    createdAt === null ||
    createdAt === undefined ||
    updatedAt === null ||
    updatedAt === undefined
  ) {
    return invalidShape();
  }

  return {
    requestId,
    aiDraftId,
    requestReason,
    requestedLanguage,
    detectionStatus,
    selectedLanguage,
    knowledgeVersionId: selectedKnowledge?.id ?? null,
    state: state as PlatformAiDraftState,
    generatedText,
    reviewedText,
    failureOutcome,
    requestedAt,
    createdAt,
    updatedAt,
  };
}

function parseManualSend(
  row: Record<string, unknown>,
): PlatformManualSendWorkflow | null {
  const authorizationId = parseOptionalUuid(
    row.latest_manual_send_authorization_id,
  );
  const finalText = parseOptionalText(
    row.latest_manual_send_final_text,
    MAX_MESSAGE_TEXT_LENGTH,
  );
  const authorizedAt = parseOptionalTimestamp(
    row.latest_manual_send_authorized_at,
  );

  if (
    authorizationId === null &&
    finalText === null &&
    authorizedAt === null
  ) {
    return null;
  }
  if (
    authorizationId === null ||
    authorizationId === undefined ||
    finalText === null ||
    finalText === undefined ||
    authorizedAt === null ||
    authorizedAt === undefined
  ) {
    return invalidShape();
  }

  return { authorizationId, finalText, authorizedAt };
}

function parseOutbox(
  row: Record<string, unknown>,
): readonly PlatformOutboxWorkflow[] {
  const workItemId = parseOptionalUuid(row.latest_outbox_work_item_id);
  if (workItemId === null) {
    for (const field of [
      row.latest_outbox_kind,
      row.latest_outbox_work_state,
      row.latest_outbox_attempt_count,
      row.latest_outbox_max_attempts,
      row.latest_outbox_available_at,
      row.latest_outbox_updated_at,
      row.latest_outbox_work_review_case_id,
      row.latest_outbox_work_review_status,
      row.latest_outbox_observation_kind,
      row.latest_outbox_observed_at,
    ]) {
      if (field !== null) return invalidShape();
    }
    return [];
  }
  if (workItemId === undefined) return invalidShape();

  const kind = row.latest_outbox_kind;
  const state = row.latest_outbox_work_state;
  const attemptCount = parseNonNegativeInteger(
    row.latest_outbox_attempt_count,
  );
  const maxAttempts = parsePositiveInteger(row.latest_outbox_max_attempts);
  const availableAt = parseTimestamp(row.latest_outbox_available_at);
  const updatedAt = parseTimestamp(row.latest_outbox_updated_at);
  const reviewCaseId = parseOptionalUuid(
    row.latest_outbox_work_review_case_id,
  );
  const reviewStatus = row.latest_outbox_work_review_status;
  const observationKind = row.latest_outbox_observation_kind;
  const observedAt = parseOptionalTimestamp(row.latest_outbox_observed_at);
  const allowedStates: readonly PlatformOutboxState[] = [
    "queued",
    "leased",
    "retry_wait",
    "succeeded",
    "dead_lettered",
    "unknown_manual_review",
    "conflict_manual_review",
  ];
  const allowedObservations = [
    "message_observed",
    "ack_observed",
    "link_resolved",
    "conflict",
    "unknown_result",
  ] as const;

  if (
    (kind !== "ai_draft_generate" && kind !== "manual_whatsapp_send") ||
    !allowedStates.includes(state as PlatformOutboxState) ||
    attemptCount === null ||
    maxAttempts === null ||
    availableAt === null ||
    updatedAt === null ||
    reviewCaseId === undefined ||
    (reviewStatus !== null &&
      reviewStatus !== "open" &&
      reviewStatus !== "resolved") ||
    (reviewCaseId === null) !== (reviewStatus === null) ||
    (observationKind !== null &&
      !allowedObservations.includes(
        observationKind as (typeof allowedObservations)[number],
      )) ||
    observedAt === undefined ||
    (observationKind === null) !== (observedAt === null)
  ) {
    return invalidShape();
  }

  return [
    {
      workItemId,
      kind,
      state: state as PlatformOutboxState,
      attemptCount,
      maxAttempts,
      availableAt,
      updatedAt,
      reviewCaseId,
      reviewStatus,
      observationKind: observationKind as PlatformOutboxWorkflow["observationKind"],
      observedAt,
    },
  ];
}

function deriveWorkflowHealth(
  latestInbound: PlatformConversationWorkflow["latestInbound"],
  draft: PlatformAiDraftWorkflow | null,
  selectedKnowledge: PlatformWorkflowKnowledgeSelection | null,
  manualSend: PlatformManualSendWorkflow | null,
  outbox: readonly PlatformOutboxWorkflow[],
  aiProvider: PlatformWorkflowIntegration,
  waha: PlatformWorkflowIntegration,
): PlatformWorkflowHealth {
  const latestOutbox = outbox[0] ?? null;
  const draftPersisted = draft !== null;
  // Migration 049 persists the knowledge selection and AI work pointer in one
  // transaction. A selected knowledge row is therefore durable staging proof.
  const draftStaged =
    draft !== null &&
    (draft.aiDraftId !== null || selectedKnowledge !== null);
  const manualAuthorizationPersisted = manualSend !== null;
  const manualSendStaged =
    manualSend !== null &&
    latestOutbox?.kind === "manual_whatsapp_send";
  const persistedNotStaged =
    (draftPersisted && !draftStaged) ||
    (manualAuthorizationPersisted && !manualSendStaged);
  const attentionRequired =
    latestOutbox?.state === "dead_lettered" ||
    latestOutbox?.state === "unknown_manual_review" ||
    latestOutbox?.state === "conflict_manual_review";
  const inProgress =
    (draft !== null && draft.aiDraftId === null) ||
    latestOutbox?.state === "queued" ||
    latestOutbox?.state === "leased" ||
    latestOutbox?.state === "retry_wait";

  return {
    status: attentionRequired
      ? "attention_required"
      : persistedNotStaged
        ? "persisted_not_staged"
        : inProgress
          ? "in_progress"
          : "ready",
    draftPersisted,
    draftStaged,
    manualAuthorizationPersisted,
    manualSendStaged,
    canRequestAiDraft: draft === null && aiProvider.providerProved,
    canReviewAiDraft: draft?.state === "review_required",
    canAuthorizeManualSend:
      latestInbound !== null && manualSend === null && waha.providerProved,
    canRetryStaging: persistedNotStaged,
  };
}

export function normalizePlatformConversationWorkflow(
  value: unknown,
  expectedConversationId?: string,
): PlatformConversationWorkflow {
  if (!isRecord(value)) return invalidShape();

  const conversationId = parsePlatformRouteUuid(value.conversation_id);
  if (
    conversationId === null ||
    (expectedConversationId !== undefined &&
      conversationId !== parsePlatformRouteUuid(expectedConversationId))
  ) {
    return invalidShape();
  }

  const latestInbound = parseLatestInbound(value);
  const selectedKnowledge = parseSelectedKnowledge(value);
  const draft = parseDraft(value, selectedKnowledge);
  const manualSend = parseManualSend(value);
  const outbox = parseOutbox(value);
  const aiProvider = normalizeIntegration(
    value.ai_readiness,
    value.ai_readiness_evidence_kind,
    value.ai_readiness_fresh,
    value.ai_readiness_observed_at,
  );
  const waha = normalizeIntegration(
    value.waha_readiness,
    value.waha_readiness_evidence_kind,
    value.waha_readiness_fresh,
    value.waha_readiness_observed_at,
  );
  const latestAuditAction = parseOptionalText(value.latest_audit_action, 250);
  const latestAuditAt = parseOptionalTimestamp(value.latest_audit_at);
  if (
    latestAuditAction === undefined ||
    latestAuditAt === undefined ||
    (latestAuditAction === null) !== (latestAuditAt === null)
  ) {
    return invalidShape();
  }

  return {
    conversationId,
    latestInbound,
    selectedKnowledge,
    draft,
    manualSend,
    outbox,
    health: deriveWorkflowHealth(
      latestInbound,
      draft,
      selectedKnowledge,
      manualSend,
      outbox,
      aiProvider,
      waha,
    ),
    integrations: { aiProvider, waha },
    latestAuditAction,
    latestAuditAt,
  };
}

function isPermissionDenied(error: unknown): boolean {
  return isRecord(error) && error.code === "42501";
}

async function getPlatformClient() {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export async function getPlatformConversationWorkflow(
  actor: PlatformActor,
  conversationIdValue: string,
): Promise<PlatformConversationWorkflow | null> {
  if (!isMessagingActor(actor)) throw new PlatformMessagingWorkflowError();
  const organizationId = parsePlatformRouteUuid(actor.organizationId);
  const conversationId = parsePlatformRouteUuid(conversationIdValue);
  if (organizationId === null || conversationId === null) return null;

  try {
    const client = await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc("staff_conversation_workflow", {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
      });

    if (response.error) {
      if (isPermissionDenied(response.error)) return null;
      return invalidShape();
    }
    if (!Array.isArray(response.data)) return invalidShape();
    if (response.data.length === 0) return null;
    if (response.data.length !== 1) return invalidShape();

    return normalizePlatformConversationWorkflow(
      response.data[0],
      conversationId,
    );
  } catch (error) {
    if (error instanceof PlatformMessagingWorkflowError) throw error;
    throw new PlatformMessagingWorkflowError();
  }
}

export async function listApprovedPlatformKnowledge(
  actor: PlatformActor,
): Promise<readonly PlatformKnowledgeCatalogItem[]> {
  if (!isMessagingActor(actor)) throw new PlatformMessagingWorkflowError();
  const organizationId = parsePlatformRouteUuid(actor.organizationId);
  if (organizationId === null) throw new PlatformMessagingWorkflowError();

  try {
    const client = await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc("approved_knowledge_catalog", {
        p_organization_id: organizationId,
      });

    if (response.error || !Array.isArray(response.data)) {
      return invalidShape();
    }

    const seenIds = new Set<string>();
    return response.data.map((row) => {
      const item = normalizePlatformKnowledgeCatalogItem(row);
      if (seenIds.has(item.id)) return invalidShape();
      seenIds.add(item.id);
      return item;
    });
  } catch (error) {
    if (error instanceof PlatformMessagingWorkflowError) throw error;
    throw new PlatformMessagingWorkflowError();
  }
}

export function normalizePlatformMutationReason(value: unknown): string | null {
  const reason = parseRequiredText(value, MAX_REASON_LENGTH);
  return reason !== null && reason.length >= 3 ? reason : null;
}

export function normalizePlatformMessageText(value: unknown): string | null {
  return parseRequiredText(value, MAX_MESSAGE_TEXT_LENGTH);
}

export function derivePlatformSemanticRequestId(
  operation: PlatformMessagingOperation,
  organizationId: string,
  parts: readonly string[],
): string {
  const normalizedOrganizationId = parsePlatformRouteUuid(organizationId);
  if (normalizedOrganizationId === null) return invalidShape();

  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "evo-platform-messaging-v1",
        operation,
        normalizedOrganizationId,
        ...parts,
      ]),
      "utf8",
    )
    .digest("hex");
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(
    16,
  );

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function derivePlatformBusinessKey(parts: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify(["evo-platform-work-v1", ...parts]), "utf8")
    .digest("hex");
}
