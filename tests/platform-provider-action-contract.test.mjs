import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePlatformGeminiRequestForm,
  parsePlatformGeminiReviewForm,
  parsePlatformWhatsAppReconcileForm,
  parsePlatformWhatsAppSendForm,
} from "../src/lib/platform-provider-action-contract.ts";

const IDS = Object.freeze({
  conversation: "11111111-1111-4111-8111-111111111111",
  sourceMessage: "22222222-2222-4222-8222-222222222222",
  proposalRequest: "33333333-3333-4333-8333-333333333333",
  reviewRequest: "44444444-4444-4444-8444-444444444444",
  sendRequest: "55555555-5555-4555-8555-555555555555",
  attempt: "66666666-6666-4666-8666-666666666666",
  reconcileRequest: "77777777-7777-4777-8777-777777777777",
});

function form(entries) {
  const value = new FormData();
  for (const [key, entry] of entries) value.append(key, entry);
  return value;
}

test("Gemini request and review forms expose only exact staff intent", () => {
  assert.deepEqual(
    parsePlatformGeminiRequestForm(form([
      ["conversation_id", IDS.conversation],
      ["source_message_id", IDS.sourceMessage],
      ["request_id", IDS.proposalRequest],
    ])),
    {
      conversationId: IDS.conversation,
      sourceMessageId: IDS.sourceMessage,
      requestId: IDS.proposalRequest,
    },
  );

  assert.deepEqual(
    parsePlatformGeminiReviewForm(form([
      ["conversation_id", IDS.conversation],
      ["proposal_request_id", IDS.proposalRequest],
      ["review_request_id", IDS.reviewRequest],
      ["decision", "edited"],
      ["edited_reply_text", "Уточнённый ответ менеджера"],
      ["reason", "Исправлена формулировка"],
    ])),
    {
      conversationId: IDS.conversation,
      proposalRequestId: IDS.proposalRequest,
      reviewRequestId: IDS.reviewRequest,
      decision: "edited",
      editedReplyText: "Уточнённый ответ менеджера",
      reason: "Исправлена формулировка",
    },
  );

  const rejectedWithoutReason = form([
    ["conversation_id", IDS.conversation],
    ["proposal_request_id", IDS.proposalRequest],
    ["review_request_id", IDS.reviewRequest],
    ["decision", "rejected"],
    ["edited_reply_text", ""],
    ["reason", ""],
  ]);
  assert.equal(parsePlatformGeminiReviewForm(rejectedWithoutReason), null);
});

test("manual send contains no browser recipient and requires exact human confirmation", () => {
  const accepted = form([
    ["conversation_id", IDS.conversation],
    ["source_message_id", IDS.sourceMessage],
    ["send_request_id", IDS.sendRequest],
    ["message_text", "Здравствуйте! Проверил ответ и подтверждаю отправку."],
    ["confirm_send", "1"],
  ]);
  assert.deepEqual(parsePlatformWhatsAppSendForm(accepted), {
    conversationId: IDS.conversation,
    sourceMessageId: IDS.sourceMessage,
    requestId: IDS.sendRequest,
    messageText: "Здравствуйте! Проверил ответ и подтверждаю отправку.",
  });
  assert.equal(accepted.has("recipient"), false);
  assert.equal(accepted.has("raw_chat_id"), false);

  accepted.set("confirm_send", "0");
  assert.equal(parsePlatformWhatsAppSendForm(accepted), null);
  accepted.set("confirm_send", "1");
  accepted.set("message_text", " trailing ");
  assert.equal(parsePlatformWhatsAppSendForm(accepted), null);
});

test("reconciliation identifies one attempt and cannot carry provider evidence", () => {
  assert.deepEqual(
    parsePlatformWhatsAppReconcileForm(form([
      ["conversation_id", IDS.conversation],
      ["attempt_id", IDS.attempt],
      ["reconcile_request_id", IDS.reconcileRequest],
    ])),
    {
      conversationId: IDS.conversation,
      attemptId: IDS.attempt,
      requestId: IDS.reconcileRequest,
    },
  );

  const forged = form([
    ["conversation_id", IDS.conversation],
    ["attempt_id", IDS.attempt],
    ["reconcile_request_id", IDS.reconcileRequest],
    ["provider_message_id", "forged"],
  ]);
  assert.equal(parsePlatformWhatsAppReconcileForm(forged), null);
});

test("duplicate, unknown and malformed action fields fail closed", () => {
  const duplicate = form([
    ["conversation_id", IDS.conversation],
    ["source_message_id", IDS.sourceMessage],
    ["request_id", IDS.proposalRequest],
    ["request_id", IDS.proposalRequest],
  ]);
  assert.equal(parsePlatformGeminiRequestForm(duplicate), null);

  const unknown = form([
    ["conversation_id", IDS.conversation],
    ["source_message_id", IDS.sourceMessage],
    ["request_id", IDS.proposalRequest],
    ["model", "attacker-selected-model"],
  ]);
  assert.equal(parsePlatformGeminiRequestForm(unknown), null);

  const malformed = form([
    ["conversation_id", "not-a-uuid"],
    ["source_message_id", IDS.sourceMessage],
    ["request_id", IDS.proposalRequest],
  ]);
  assert.equal(parsePlatformGeminiRequestForm(malformed), null);
});

test("React action-state envelopes retain the same exact contract", () => {
  const value = form([
    ["_1_$ACTION_REF_8", ""],
    ["_1_$ACTION_8:0", ""],
    ["_1_$ACTION_KEY", "state-key"],
    ["_1_conversation_id", IDS.conversation],
    ["_1_source_message_id", IDS.sourceMessage],
    ["_1_request_id", IDS.proposalRequest],
    ["0", "previous-state"],
  ]);
  assert.equal(
    parsePlatformGeminiRequestForm(value)?.requestId,
    IDS.proposalRequest,
  );
});
