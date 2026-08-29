import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCanonicalWhatsAppReconcileForm,
  parseCanonicalWhatsAppSendForm,
} from "../src/lib/server/canonical-whatsapp-outbound-form.ts";

const IDS = Object.freeze({
  conversation: "11111111-1111-4111-8111-111111111111",
  proposal: "22222222-2222-4222-8222-222222222222",
  request: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444",
});

function sendForm(overrides = {}) {
  const form = new FormData();
  form.set("conversation_id", IDS.conversation);
  form.set("send_request_id", IDS.request);
  form.set("message_text", "  Final reviewed reply  ");
  form.set("confirmed_recipient", "15551234567@c.us");
  form.set("confirm_send", "1");
  form.set("source_proposal_id", IDS.proposal);
  form.set("reply_to_external_message_id", "inbound-message-1");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

test("send parser requires one exact confirmed direct-recipient payload", () => {
  assert.deepEqual(parseCanonicalWhatsAppSendForm(sendForm()), {
    conversationId: IDS.conversation,
    requestId: IDS.request,
    messageText: "  Final reviewed reply  ",
    confirmedRecipient: "15551234567@c.us",
    sourceProposalId: IDS.proposal,
    replyToExternalMessageId: "inbound-message-1",
  });

  assert.deepEqual(
    parseCanonicalWhatsAppSendForm(
      sendForm({
        confirmed_recipient: "998877665544@lid",
        source_proposal_id: "",
        reply_to_external_message_id: "",
      }),
    ),
    {
      conversationId: IDS.conversation,
      requestId: IDS.request,
      messageText: "  Final reviewed reply  ",
      confirmedRecipient: "998877665544@lid",
      sourceProposalId: null,
      replyToExternalMessageId: null,
    },
  );
});

test("send parser rejects missing confirmation, indirect recipients and form ambiguity", () => {
  for (const form of [
    sendForm({ confirm_send: "0" }),
    sendForm({ confirmed_recipient: "120363000000@g.us" }),
    sendForm({ confirmed_recipient: "broadcast" }),
    sendForm({ message_text: "   " }),
    sendForm({ send_request_id: "not-a-uuid" }),
  ]) {
    assert.equal(parseCanonicalWhatsAppSendForm(form), null);
  }

  const unknown = sendForm();
  unknown.set("send_without_review", "1");
  assert.equal(parseCanonicalWhatsAppSendForm(unknown), null);

  const duplicate = sendForm();
  duplicate.append("message_text", "second payload");
  assert.equal(parseCanonicalWhatsAppSendForm(duplicate), null);
});

test("reconcile parser accepts only the exact attempt and fresh request identity", () => {
  const form = new FormData();
  form.set("conversation_id", IDS.conversation);
  form.set("attempt_id", IDS.attempt);
  form.set("reconcile_request_id", IDS.request);
  assert.deepEqual(parseCanonicalWhatsAppReconcileForm(form), {
    conversationId: IDS.conversation,
    attemptId: IDS.attempt,
    requestId: IDS.request,
  });

  form.set("attempt_id", "not-a-uuid");
  assert.equal(parseCanonicalWhatsAppReconcileForm(form), null);
  form.set("attempt_id", IDS.attempt);
  form.append("attempt_id", IDS.attempt);
  assert.equal(parseCanonicalWhatsAppReconcileForm(form), null);
});

test("React action-state envelopes stay exact for send and reconcile", () => {
  const send = new FormData();
  for (const field of [
    "conversation_id",
    "send_request_id",
    "message_text",
    "confirmed_recipient",
    "confirm_send",
    "source_proposal_id",
    "reply_to_external_message_id",
  ]) {
    send.set(`_1_${field}`, sendForm().get(field));
  }
  send.set("_1_$ACTION_REF_12", "");
  send.set("_1_$ACTION_12:0", "");
  send.set("_1_$ACTION_12:1", "");
  send.set("_1_$ACTION_KEY", "state-key");
  send.set("0", "previous-state");
  assert.equal(parseCanonicalWhatsAppSendForm(send)?.requestId, IDS.request);

  const reconcile = new FormData();
  reconcile.set("_1_conversation_id", IDS.conversation);
  reconcile.set("_1_attempt_id", IDS.attempt);
  reconcile.set("_1_reconcile_request_id", IDS.request);
  reconcile.set("_1_$ACTION_REF_12", "");
  reconcile.set("_1_$ACTION_12:0", "");
  reconcile.set("_1_$ACTION_12:1", "");
  reconcile.set("_1_$ACTION_KEY", "state-key");
  reconcile.set("0", "previous-state");
  assert.equal(parseCanonicalWhatsAppReconcileForm(reconcile)?.attemptId, IDS.attempt);
});
