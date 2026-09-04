import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

function path(relativePath) {
  return new URL(`../${relativePath}`, import.meta.url);
}

function source(relativePath) {
  return readFileSync(path(relativePath), "utf8");
}

test("V3 Inbox owns the canonical queue, selected transcript and command surface", () => {
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  const inboxSource = source("src/lib/v3/inbox-source.ts");
  const inbox = source("src/components/v3/Inbox.tsx");

  assert.match(page, /requirePlatformMessagingActor/);
  assert.match(page, /readInbox\(actor/);
  assert.match(page, /InboxProviderWorkflowControls/);
  assert.match(page, /CanonicalAmoCrmCommandPanel/);
  assert.match(
    page,
    /"conversation"[\s\S]*"before_at"[\s\S]*"before_id"[\s\S]*"messages_before_at"[\s\S]*"messages_before_id"/,
  );

  assert.match(inboxSource, /listPlatformConversations/);
  assert.match(inboxSource, /getPlatformConversationThread/);
  assert.match(inboxSource, /getPlatformConversationCommandContext/);
  assert.match(inboxSource, /getPlatformWahaSessionHealth\(actor, "crm_primary"\)/);
  assert.match(inboxSource, /readStaffGeminiProposal/);
  assert.match(inboxSource, /listStaffGeminiProposalReviews/);
  assert.match(inboxSource, /readLatestManualWhatsAppSendAttempt/);
  assert.match(inbox, /data-testid="v3-inbox"/);
  assert.match(inbox, /data-testid="v3-inbox-thread"/);
  assert.match(inbox, /data-testid="v3-inbox-messages"/);
  assert.doesNotMatch(
    `${page}\n${inboxSource}\n${inbox}`,
    /PlatformStaffWhatsApp|PlatformProviderWorkflowControls|service[_-]?role|drizzle|fallback/i,
  );
});

test("V3 provider controls use the four reviewed server actions without provider targets", () => {
  const controls = source("src/components/v3/InboxProviderWorkflowControls.tsx");

  assert.equal(controls.match(/useActionState\(/g)?.length, 4);
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
    "message_text",
    "attempt_id",
  ]) {
    assert.match(controls, new RegExp(`name="${field}"`));
  }
  for (const forbidden of [
    "rawChatId",
    "recipient",
    "wahaMessageId",
    "kommoAccountId",
    "kommoConversationId",
    "amocrmAccountId",
    "amocrmLeadId",
    "amocrmContactId",
  ]) {
    assert.doesNotMatch(controls, new RegExp(forbidden));
  }
  assert.doesNotMatch(
    controls,
    /localStorage|sessionStorage|fetch\(|broadcast|autonomous/i,
  );
});

test("the superseded V2 Inbox routes and controls are physically removed", () => {
  for (const relativePath of [
    "src/app/(staff)/whatsapp/page.tsx",
    "src/app/(staff)/whatsapp/[id]/page.tsx",
    "src/app/(staff)/whatsapp/error.tsx",
    "src/app/(staff)/whatsapp/loading.tsx",
    "src/components/platform/communications/PlatformProviderWorkflowControls.tsx",
    "src/components/platform/communications/PlatformStaffWhatsApp.tsx",
  ]) {
    assert.equal(existsSync(path(relativePath)), false, relativePath);
  }
});
