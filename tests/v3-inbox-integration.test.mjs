import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.match(adapter, /messages_before_at/u);
  assert.match(adapter, /messages_before_id/u);
  assert.match(adapter, /before_at/u);
  assert.match(adapter, /before_id/u);

  assert.match(page, /conversation\?: string \| string\[\]/u);
  assert.match(page, /parsePlatformRouteUuid/u);
  assert.match(page, /parsePlatformConversationCursor/u);
  assert.match(page, /conversationId === null && messageCursor !== null/u);
  assert.match(page, /conversationId !== null && view\.selected === null/u);
  assert.doesNotMatch(inbox, /useState|onClick=/u);
  assert.match(inbox, /href=\{conversation\.href\}/u);
  assert.match(inbox, /href=\{open\.olderMessagesHref\}/u);
  assert.match(inbox, /href=\{view\.queueOlderHref\}/u);
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
