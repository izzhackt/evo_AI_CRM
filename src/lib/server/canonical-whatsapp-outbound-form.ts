import "server-only";

import { exactActionStringFields } from "./action-form-fields.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIRECT_WAHA_CHAT_ID_PATTERN = /^[1-9][0-9]{4,31}@(c[.]us|lid)$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const SEND_FIELDS = [
  "conversation_id",
  "send_request_id",
  "message_text",
  "confirmed_recipient",
  "confirm_send",
  "source_proposal_id",
  "reply_to_external_message_id",
] as const;

const RECONCILE_FIELDS = [
  "conversation_id",
  "attempt_id",
  "reconcile_request_id",
] as const;

export type CanonicalWhatsAppSendForm = Readonly<{
  conversationId: string;
  requestId: string;
  messageText: string;
  confirmedRecipient: string;
  sourceProposalId: string | null;
  replyToExternalMessageId: string | null;
}>;

export type CanonicalWhatsAppReconcileForm = Readonly<{
  conversationId: string;
  attemptId: string;
  requestId: string;
}>;

function normalizedUuid(value: string | undefined): string | null {
  if (value === undefined || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function optionalUuid(value: string | undefined): string | null | undefined {
  if (value === "") return null;
  const normalized = normalizedUuid(value);
  return normalized ?? undefined;
}

export function parseCanonicalWhatsAppSendForm(
  form: FormData,
): CanonicalWhatsAppSendForm | null {
  const fields = exactActionStringFields(form, SEND_FIELDS);
  if (fields === null) return null;

  const conversationId = normalizedUuid(fields.get("conversation_id"));
  const requestId = normalizedUuid(fields.get("send_request_id"));
  const messageText = fields.get("message_text");
  const confirmedRecipient = fields.get("confirmed_recipient");
  const sourceProposalId = optionalUuid(fields.get("source_proposal_id"));
  const replyToExternalMessageId = fields.get(
    "reply_to_external_message_id",
  );
  if (
    conversationId === null ||
    requestId === null ||
    messageText === undefined ||
    messageText.trim().length === 0 ||
    messageText.length > 3_000 ||
    CONTROL_CHARACTER_PATTERN.test(messageText) ||
    confirmedRecipient === undefined ||
    !DIRECT_WAHA_CHAT_ID_PATTERN.test(confirmedRecipient) ||
    fields.get("confirm_send") !== "1" ||
    sourceProposalId === undefined ||
    replyToExternalMessageId === undefined ||
    replyToExternalMessageId.length > 255 ||
    CONTROL_CHARACTER_PATTERN.test(replyToExternalMessageId)
  ) {
    return null;
  }

  return Object.freeze({
    conversationId,
    requestId,
    messageText,
    confirmedRecipient,
    sourceProposalId,
    replyToExternalMessageId:
      replyToExternalMessageId.length === 0 ? null : replyToExternalMessageId,
  });
}

export function parseCanonicalWhatsAppReconcileForm(
  form: FormData,
): CanonicalWhatsAppReconcileForm | null {
  const fields = exactActionStringFields(form, RECONCILE_FIELDS);
  if (fields === null) return null;

  const conversationId = normalizedUuid(fields.get("conversation_id"));
  const attemptId = normalizedUuid(fields.get("attempt_id"));
  const requestId = normalizedUuid(fields.get("reconcile_request_id"));
  if (conversationId === null || attemptId === null || requestId === null) {
    return null;
  }
  return Object.freeze({ conversationId, attemptId, requestId });
}
