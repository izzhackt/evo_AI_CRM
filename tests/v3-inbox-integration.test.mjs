import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildV3InboxHref } from "../src/lib/v3/inbox-href.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 Inbox reads one URL-selected canonical transcript with exact cursors", () => {
  const adapter = source("src/lib/v3/inbox-source.ts");
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  const inbox = source("src/components/v3/Inbox.tsx");

  assert.match(adapter, /listPlatformConversations\(actor,/u);
  assert.match(adapter, /actor\.presentationRole === "admin" \? undefined : actor\.presentationRole/u);
  assert.match(adapter, /queue: presentationQueue/u);
  assert.match(adapter, /resolvedThread\.conversation\.queue === presentationQueue/u);
  assert.match(adapter, /getPlatformConversationThread\(actor, options\.conversationId,/u);
  assert.match(
    adapter,
    /getPlatformConversationCommandContext\(actor, thread\.conversation\.id\)/u,
  );
  assert.doesNotMatch(adapter, /THREAD_READ_CONCURRENCY|batch\.map/u);
  assert.match(adapter, /if \(messageCursor !== null\) return null/u);
  assert.match(adapter, /message\?\.direction === "inbound"/u);
  assert.match(adapter, /query: options\.query \?\? undefined/u);
  assert.match(adapter, /waitingOnly: options\.waitingOnly/u);
  assert.match(adapter, /buildV3InboxHref/u);

  assert.match(page, /conversation\?: string \| string\[\]/u);
  assert.match(page, /parsePlatformRouteUuid/u);
  assert.match(page, /parsePlatformConversationCursor/u);
  assert.match(page, /conversationId === null && messageCursor !== null/u);
  assert.match(page, /conversationId !== null && view\.selected === null/u);
  assert.match(page, /q\?: string \| string\[\]/u);
  assert.match(page, /waiting\?: string \| string\[\]/u);
  assert.match(page, /value !== "1"/u);
  assert.match(page, /normalized\.length > 200/u);
  assert.match(page, /if \(Array\.isArray\(value\)\) notFound\(\)/u);
  assert.match(
    page,
    /if \(Object\.keys\(params\)\.some\(\(key\) => !allowed\.has\(key\)\)\) notFound\(\)/u,
  );
  assert.match(
    page,
    /if \(sortAt === undefined \|\| id === undefined\) notFound\(\)/u,
  );
  assert.doesNotMatch(inbox, /useState|onClick=/u);
  assert.match(inbox, /href=\{conversation\.href\}/u);
  assert.match(inbox, /href=\{open\.olderMessagesHref\}/u);
  assert.match(inbox, /href=\{view\.queueOlderHref\}/u);
});

test("V3 Inbox href preserves filters and both cursor pairs behaviorally", () => {
  const href = buildV3InboxHref({
    filters: { query: "Иван Петров", waitingOnly: true },
    queueCursor: {
      sortAt: "2026-09-07T09:00:00.000Z",
      id: "62000000-0000-4000-8000-000000000001",
    },
    conversationId: "62000000-0000-4000-8000-000000000002",
    messageCursor: {
      sortAt: "2026-09-07T08:00:00.000Z",
      id: "62000000-0000-4000-8000-000000000003",
    },
  });

  assert.equal(
    href,
    "/v3/inbox?q=%D0%98%D0%B2%D0%B0%D0%BD+%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B2&waiting=1&before_at=2026-09-07T09%3A00%3A00.000Z&before_id=62000000-0000-4000-8000-000000000001&conversation=62000000-0000-4000-8000-000000000002&messages_before_at=2026-09-07T08%3A00%3A00.000Z&messages_before_id=62000000-0000-4000-8000-000000000003",
  );
});

test("V3 Inbox href produces q-only, waiting-toggle and newest states", () => {
  assert.equal(
    buildV3InboxHref({
      filters: { query: "Анна", waitingOnly: false },
    }),
    "/v3/inbox?q=%D0%90%D0%BD%D0%BD%D0%B0",
  );
  assert.equal(
    buildV3InboxHref({
      filters: { query: "Анна", waitingOnly: true },
    }),
    "/v3/inbox?q=%D0%90%D0%BD%D0%BD%D0%B0&waiting=1",
  );
  assert.equal(
    buildV3InboxHref({
      filters: { query: null, waitingOnly: true },
      conversationId: "62000000-0000-4000-8000-000000000002",
    }),
    "/v3/inbox?waiting=1&conversation=62000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    buildV3InboxHref({ filters: { query: null, waitingOnly: false } }),
    "/v3/inbox",
  );
});

test("V3 Inbox search and waiting UI use the server waiting_since projection", () => {
  const adapter = source("src/lib/v3/inbox-source.ts");
  const inbox = source("src/components/v3/Inbox.tsx");

  assert.match(adapter, /summary\.waitingSince/u);
  assert.match(adapter, /formatWaitingRu\(summary\.waitingSince\)/u);
  assert.doesNotMatch(adapter, /function awaitingReplyFor/u);
  assert.match(adapter, /waitingToggleHref/u);
  assert.match(inbox, /name="q"/u);
  assert.match(inbox, /name="waiting" value="1"/u);
  assert.match(inbox, /Только ждут ответа/u);
  assert.match(inbox, /Ждёт ответа с \{conversation\.waitingSince\}/u);
  assert.match(inbox, /Ждёт ответа с \{open\.waitingSince\}/u);
  assert.doesNotMatch(`${adapter}\n${inbox}`, /lastMessageAt.*formatWaitingRu/su);
});

test("V3 owns human-reviewed Gemini and explicit WhatsApp action controls", () => {
  const controls = source(
    "src/components/v3/InboxProviderWorkflowControls.tsx",
  );
  const page = source("src/app/(v3)/v3/inbox/page.tsx");

  for (const action of [
    "requestPlatformGeminiProposalAction",
    "reviewPlatformGeminiProposalAction",
    "sendPlatformWhatsAppMessageAction",
    "reconcilePlatformWhatsAppSendAction",
  ]) {
    assert.match(controls, new RegExp(action));
  }
  for (const field of [
    "conversation_id",
    "source_message_id",
    "request_id",
    "proposal_request_id",
    "review_request_id",
    "decision",
    "edited_reply_text",
    "reason",
    "send_request_id",
    "message_text",
    "confirm_send",
    "attempt_id",
    "reconcile_request_id",
  ]) {
    assert.match(controls, new RegExp(`name="${field}"`), field);
  }
  for (const status of [
    "proposal_ready",
    "human_review",
    "in_progress",
    "blocked",
    "invalid",
    "unavailable",
    "reviewed",
    "succeeded",
    "unknown_result",
    "terminal_error",
    "not_claimed",
    "reconciled",
    "still_unknown",
    "already_completed",
    "readback_failed",
  ]) {
    assert.match(controls, new RegExp(status), status);
  }
  assert.match(controls, /latestInboundSourceMessageId === null/u);
  assert.match(controls, /unresolvedAttempt/u);
  assert.match(controls, /ACK_LABELS\[latestAttempt\.ackName\]/u);
  assert.doesNotMatch(controls, />\{latestAttempt\.ackName\}</u);
  assert.match(controls, /Проверить результат без новой отправки/u);
  assert.doesNotMatch(controls, /QR|broadcast|autonomous|localStorage|fetch\(/iu);
  assert.doesNotMatch(
    page,
    /PlatformProviderWorkflowControls|PlatformStaffWhatsAppWorkspace/u,
  );
});

test("V3 Inbox loads exact-audience reply snippets only for a selected send-capable conversation", () => {
  const controls = source(
    "src/components/v3/InboxProviderWorkflowControls.tsx",
  );
  const picker = source(
    "src/components/v3/reply-snippets/ReplySnippetPicker.tsx",
  );
  const page = source("src/app/(v3)/v3/inbox/page.tsx");

  assert.match(
    page,
    /if \(view\.selected\)[\s\S]*fixedRoleCan\([\s\S]*actor\.presentationRole,[\s\S]*"messaging\.send",[\s\S]*\)[\s\S]*readV3ReplySnippets\(actor\)/u,
  );
  assert.match(
    page,
    /\(\{ replySnippetId, title, body \}\) => \(\{ replySnippetId, title, body \}\)/u,
  );
  assert.match(page, /replySnippets=\{replySnippets\}/u);
  assert.match(controls, /replySnippets !== null \? \(/u);
  assert.match(controls, /<ReplySnippetPicker[\s\S]*name="message_text"/u);
  assert.match(
    controls,
    /onMessageTextChange=\{\(value\) => \{[\s\S]*setMessageText\(value\);[\s\S]*setConfirmed\(false\);/u,
  );
  assert.match(picker, /type="button"/u);
  assert.match(picker, /role="alert"/u);
  assert.doesNotMatch(picker, /sendPlatform|type="submit"|form action/u);
});

test("conversation or latest-source changes remount the stateful composer", () => {
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  const controlsStart = page.indexOf("<InboxProviderWorkflowControls");
  const controlsEnd = page.indexOf("/>", controlsStart);

  assert.notEqual(controlsStart, -1);
  assert.notEqual(controlsEnd, -1);
  assert.match(
    page.slice(controlsStart, controlsEnd),
    /key=\{`\$\{selected\.id\}:\$\{selected\.latestInboundSourceMessageId \?\? "no-source"\}:/u,
  );
});

test("V3 Inbox scopes amoCRM commands to exact canonical EVO identity", () => {
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  const adapter = source("src/lib/v3/inbox-source.ts");

  assert.match(page, /selected\.canonicalContext/u);
  assert.match(adapter, /"sales_pre_handoff"/u);
  assert.match(adapter, /"admissions_post_handoff"/u);
  assert.match(adapter, /studentCaseId: scope === "sales" \? null : studentCaseId/u);
  assert.match(adapter, /personId: clientId/u);
  assert.match(adapter, /leadId,/u);
  assert.match(adapter, /readPlatformBlockingAmoCrmCommand/u);
  assert.match(adapter, /readCanonicalAmoCrmCommandAvailability/u);
  assert.match(page, /CanonicalAmoCrmCommandPanel/u);
  assert.match(page, /Запись через другой путь не выполняется/u);
  assert.doesNotMatch(`${page}\n${adapter}`, /amocrmLeadId|amocrmContactId|kommo/u);
});

test("V3 Inbox surfaces current WhatsApp readiness without a channel setup flow", () => {
  const adapter = source("src/lib/v3/inbox-source.ts");
  const inbox = source("src/components/v3/Inbox.tsx");

  assert.match(adapter, /wahaSessionName === "crm_primary"/u);
  assert.match(adapter, /getPlatformWahaSessionHealth\(actor, "crm_primary"\)/u);
  assert.match(adapter, /isFreshWorkingWahaSession/u);
  assert.match(inbox, /WhatsApp подключён/u);
  assert.match(inbox, /WhatsApp требует проверки/u);
  assert.match(inbox, /Состояние WhatsApp не подтверждено/u);
  assert.doesNotMatch(inbox, /WAHA|crm_primary|QR|подключить канал/iu);
});
