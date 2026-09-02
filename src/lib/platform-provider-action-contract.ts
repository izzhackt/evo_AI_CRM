import "server-only";

import { exactActionStringFields } from "./server/action-form-fields.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const UNSAFE_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0009\u000b-\u001f\u007f]/;

const GEMINI_REQUEST_FIELDS = [
  "conversation_id",
  "source_message_id",
  "request_id",
] as const;
const GEMINI_REVIEW_FIELDS = [
  "conversation_id",
  "proposal_request_id",
  "review_request_id",
  "decision",
  "edited_reply_text",
  "reason",
] as const;
const WHATSAPP_SEND_FIELDS = [
  "conversation_id",
  "source_message_id",
  "send_request_id",
  "message_text",
  "confirm_send",
] as const;
const WHATSAPP_RECONCILE_FIELDS = [
  "conversation_id",
  "attempt_id",
  "reconcile_request_id",
] as const;

export type PlatformGeminiRequestForm = Readonly<{
  conversationId: string;
  sourceMessageId: string;
  requestId: string;
}>;

export type PlatformGeminiReviewForm = Readonly<{
  conversationId: string;
  proposalRequestId: string;
  reviewRequestId: string;
  decision: "accepted" | "edited" | "rejected";
  editedReplyText: string | null;
  reason: string | null;
}>;

export type PlatformWhatsAppSendForm = Readonly<{
  conversationId: string;
  sourceMessageId: string;
  requestId: string;
  messageText: string;
}>;

export type PlatformWhatsAppReconcileForm = Readonly<{
  conversationId: string;
  attemptId: string;
  requestId: string;
}>;

function normalizedUuid(value: string | undefined): string | null {
  if (value === undefined || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function exactText(
  value: string | undefined,
  minimumLength: number,
  maximumLength: number,
): string | null {
  if (
    value === undefined ||
    value !== value.trim() ||
    value.length < minimumLength ||
    value.length > maximumLength ||
    UNSAFE_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

function optionalText(
  value: string | undefined,
  maximumLength: number,
): string | null | undefined {
  if (value === "") return null;
  if (value === undefined) return undefined;
  return exactText(value, 1, maximumLength) ?? undefined;
}

export function parsePlatformGeminiRequestForm(
  form: FormData,
): PlatformGeminiRequestForm | null {
  const fields = exactActionStringFields(form, GEMINI_REQUEST_FIELDS);
  if (fields === null) return null;
  const conversationId = normalizedUuid(fields.get("conversation_id"));
  const sourceMessageId = normalizedUuid(fields.get("source_message_id"));
  const requestId = normalizedUuid(fields.get("request_id"));
  if (conversationId === null || sourceMessageId === null || requestId === null) {
    return null;
  }
  return Object.freeze({ conversationId, sourceMessageId, requestId });
}

export function parsePlatformGeminiReviewForm(
  form: FormData,
): PlatformGeminiReviewForm | null {
  const fields = exactActionStringFields(form, GEMINI_REVIEW_FIELDS);
  if (fields === null) return null;
  const conversationId = normalizedUuid(fields.get("conversation_id"));
  const proposalRequestId = normalizedUuid(fields.get("proposal_request_id"));
  const reviewRequestId = normalizedUuid(fields.get("review_request_id"));
  const decision = fields.get("decision");
  const reason = optionalText(fields.get("reason"), 1_000);
  const editedReplyText = optionalText(fields.get("edited_reply_text"), 3_000);
  if (
    conversationId === null ||
    proposalRequestId === null ||
    reviewRequestId === null ||
    (decision !== "accepted" && decision !== "edited" && decision !== "rejected") ||
    reason === undefined ||
    editedReplyText === undefined ||
    (decision === "edited" && editedReplyText === null) ||
    (decision !== "edited" && editedReplyText !== null) ||
    (decision === "rejected" && reason === null)
  ) {
    return null;
  }
  return Object.freeze({
    conversationId,
    proposalRequestId,
    reviewRequestId,
    decision,
    editedReplyText,
    reason,
  });
}

export function parsePlatformWhatsAppSendForm(
  form: FormData,
): PlatformWhatsAppSendForm | null {
  const fields = exactActionStringFields(form, WHATSAPP_SEND_FIELDS);
  if (fields === null || fields.get("confirm_send") !== "1") return null;
  const conversationId = normalizedUuid(fields.get("conversation_id"));
  const sourceMessageId = normalizedUuid(fields.get("source_message_id"));
  const requestId = normalizedUuid(fields.get("send_request_id"));
  const messageText = exactText(fields.get("message_text"), 1, 3_000);
  if (
    conversationId === null ||
    sourceMessageId === null ||
    requestId === null ||
    messageText === null
  ) {
    return null;
  }
  return Object.freeze({
    conversationId,
    sourceMessageId,
    requestId,
    messageText,
  });
}

export function parsePlatformWhatsAppReconcileForm(
  form: FormData,
): PlatformWhatsAppReconcileForm | null {
  const fields = exactActionStringFields(form, WHATSAPP_RECONCILE_FIELDS);
  if (fields === null) return null;
  const conversationId = normalizedUuid(fields.get("conversation_id"));
  const attemptId = normalizedUuid(fields.get("attempt_id"));
  const requestId = normalizedUuid(fields.get("reconcile_request_id"));
  if (conversationId === null || attemptId === null || requestId === null) {
    return null;
  }
  return Object.freeze({ conversationId, attemptId, requestId });
}
