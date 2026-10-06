// «Продажи → WhatsApp» как чат (решение владельца 06.10.2026, миграция 266):
// браузер называет только чат, сообщение клиента, свой ключ запроса и
// итоговый текст. Получателя, сессии и идентификаторов WhatsApp в контракте нет.
import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_WHATSAPP_TEXT_LIMIT,
  parsePlatformWhatsAppChatReconcileInput,
  parsePlatformWhatsAppChatSendInput,
} from "../src/lib/platform-provider-action-contract.ts";

const IDS = Object.freeze({
  conversation: "11111111-1111-4111-8111-111111111111",
  sourceMessage: "22222222-2222-4222-8222-222222222222",
  sendRequest: "55555555-5555-4555-8555-555555555555",
  attempt: "66666666-6666-4666-8666-666666666666",
  reconcileRequest: "77777777-7777-4777-8777-777777777777",
});

const send = (overrides = {}) => ({
  conversationId: IDS.conversation,
  sourceMessageId: IDS.sourceMessage,
  requestId: IDS.sendRequest,
  text: "Добрый день! Документы получили.",
  ...overrides,
});

test("a chat message is exactly chat, source message, request id and final text", () => {
  assert.deepEqual(parsePlatformWhatsAppChatSendInput(send()), send());
  assert.deepEqual(
    parsePlatformWhatsAppChatSendInput(send({ conversationId: IDS.conversation.toUpperCase() })),
    send(),
    "UUIDs are normalized to lower case",
  );
  assert.deepEqual(
    parsePlatformWhatsAppChatSendInput(send({ text: "Первая строка\nвторая строка" })).text,
    "Первая строка\nвторая строка",
    "line feeds are message content",
  );
});

test("no confirmation field, no recipient and no extra key: anything else is refused", () => {
  assert.equal(parsePlatformWhatsAppChatSendInput({ ...send(), confirmSend: "1" }), null);
  assert.equal(parsePlatformWhatsAppChatSendInput({ ...send(), recipient: "79990000000@c.us" }), null);
  const withoutText = send();
  delete withoutText.text;
  assert.equal(parsePlatformWhatsAppChatSendInput(withoutText), null);
  assert.equal(parsePlatformWhatsAppChatSendInput(null), null);
  assert.equal(parsePlatformWhatsAppChatSendInput([send()]), null);
  assert.equal(parsePlatformWhatsAppChatSendInput(new Map(Object.entries(send()))), null);
});

test("identifiers must be non-nil UUIDs", () => {
  for (const key of ["conversationId", "sourceMessageId", "requestId"]) {
    assert.equal(parsePlatformWhatsAppChatSendInput(send({ [key]: "not-a-uuid" })), null, key);
    assert.equal(parsePlatformWhatsAppChatSendInput(send({ [key]: "00000000-0000-0000-0000-000000000000" })), null, key);
    assert.equal(parsePlatformWhatsAppChatSendInput(send({ [key]: 7 })), null, key);
  }
});

test("text: trimmed, 1..3000 Unicode code points, no control characters but line feeds", () => {
  assert.equal(PLATFORM_WHATSAPP_TEXT_LIMIT, 3_000);
  assert.equal(parsePlatformWhatsAppChatSendInput(send({ text: "" })), null);
  assert.equal(parsePlatformWhatsAppChatSendInput(send({ text: " ответ" })), null, "leading space");
  assert.equal(parsePlatformWhatsAppChatSendInput(send({ text: "ответ\n" })), null, "trailing line feed");
  assert.equal(parsePlatformWhatsAppChatSendInput(send({ text: "a\tb" })), null, "tab");
  assert.equal(parsePlatformWhatsAppChatSendInput(send({ text: "a\rb" })), null, "carriage return");
  assert.equal(parsePlatformWhatsAppChatSendInput(send({ text: "a\u0000b" })), null, "NUL");
  assert.notEqual(parsePlatformWhatsAppChatSendInput(send({ text: "🚀".repeat(3_000) })), null, "3000 code points (6000 UTF-16 units)");
  assert.equal(parsePlatformWhatsAppChatSendInput(send({ text: "🚀".repeat(3_001) })), null);
});

test("a readback names the chat, the exact attempt and its own request id", () => {
  const input = { conversationId: IDS.conversation, attemptId: IDS.attempt, requestId: IDS.reconcileRequest };
  assert.deepEqual(parsePlatformWhatsAppChatReconcileInput(input), input);
  assert.equal(parsePlatformWhatsAppChatReconcileInput({ ...input, text: "x" }), null);
  assert.equal(parsePlatformWhatsAppChatReconcileInput({ ...input, attemptId: "latest" }), null);
  assert.equal(parsePlatformWhatsAppChatReconcileInput({ conversationId: IDS.conversation, requestId: IDS.reconcileRequest }), null);
});
