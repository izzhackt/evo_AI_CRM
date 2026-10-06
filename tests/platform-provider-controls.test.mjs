// Управление отправкой в чате «Продажи → WhatsApp» (решение владельца
// 06.10.2026): поле ответа отправляет одно сообщение на клик через серверное
// действие, без ИИ-черновика и без подтверждения «одной отправки»; результат
// каждой отправки виден в её пузыре; неизвестный итог проверяется без новой
// отправки именно для своей попытки.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chat = read("src/components/v3/inbox/InboxChat.tsx");
const composer = read("src/components/v3/inbox/InboxComposer.tsx");
const page = read("src/app/(v3)/v3/inbox/page.tsx");
const inboxSource = read("src/lib/v3/inbox-source.ts");

test("the chat sends through the one reviewed server action, one request id per message", () => {
  assert.match(chat, /sendPlatformWhatsAppMessageAction\(\{\s*conversationId,\s*sourceMessageId: next\.sourceMessageId,\s*requestId: next\.requestId,\s*text: next\.text,\s*\}\)/u);
  assert.match(chat, /requestId: crypto\.randomUUID\(\)/u);
  assert.match(chat, /sourceMessageId: chat\.latestInboundMessageId/u, "reply-only: the source is the latest customer message");
  assert.doesNotMatch(chat, /useActionState|confirm_send|confirmSend|Gemini|proposal/iu);
  assert.doesNotMatch(`${chat}\n${composer}`, /recipient|rawChatId|wahaMessageId|session_name|phone_number/iu);
});

test("a lost answer is retried with the same request id; the queue sends one message at a time", () => {
  assert.match(chat, /if \(!canSend \|\| store\.inFlight\.length > 0\) return;\s*const next = store\.local\.find\(\(item\) => item\.state === "sending"\);/u);
  assert.match(chat, /function retry\(requestId: string\)/u);
  assert.match(chat, /CONNECTION_LOST_COPY/u);
  assert.match(chat, /WHATSAPP_CHAT_PENDING_LIMIT/u);
  // The draft and the pending sends survive a reload (localStorage via the chat store).
  assert.match(read("src/components/v3/inbox/chat-store.ts"), /window\.localStorage\.setItem\(key, JSON\.stringify\(\{ draft: next\.draft, local: next\.local \}\)\)/u);
});

test("an unknown result is checked for THAT attempt without a resend", () => {
  assert.match(chat, /reconcilePlatformWhatsAppSendAction\(\{\s*conversationId,\s*attemptId,\s*requestId: crypto\.randomUUID\(\),\s*\}\)/u);
  assert.match(chat, /aria-label=\{`Проверить результат сообщения от \$\{time\}`\}/u);
  assert.match(chat, /В WhatsApp не найдено\. Повторно не отправлялось/u);
  assert.match(chat, /Не отправлено: WhatsApp отклонил сообщение/u);
  assert.match(chat, /Вернуть текст в поле/u);
});

test("templates only edit the text; Enter sends with a mouse, Shift+Enter and touch Enter make a new line, IME never sends", () => {
  assert.match(composer, /<ReplySnippetPicker[\s\S]*onMessageTextChange=\{\(next\) => \{\s*onChange\(next\);/u);
  assert.doesNotMatch(composer.match(/<ReplySnippetPicker[\s\S]*?\/>/u)?.[0] ?? "", /onSend|type="submit"/u);
  assert.match(composer, /native\.isComposing \|\| composing\.current \|\| event\.keyCode === 229/u);
  assert.match(composer, /event\.key !== "Enter" \|\| event\.shiftKey/u);
  assert.match(composer, /\(pointer: coarse\)/u);
  assert.match(composer, /event\.key === "\/" && value === ""/u);
});

test("the page offers the composer only to a member who may answer this chat", () => {
  assert.match(inboxSource, /function replyAccessOf\(/u);
  assert.match(inboxSource, /if \(state\.latestInboundMessageId === null\) return "no_client_message";/u);
  assert.match(inboxSource, /if \(conversation\.wahaSessionName !== "crm_primary"\) return "old_session";/u);
  assert.match(page, /canReply \? readSnippets\(actor\) : Promise\.resolve\(null\)/u);
  assert.match(page, /staffPresentationCan\(actor, "messaging\.send"\)/u);
  assert.doesNotMatch(`${page}\n${inboxSource}`, /service[_-]?role|EVO_PLATFORM_SUPABASE_SECRET_KEY|recipient|rawChat|fallback/iu);
});
