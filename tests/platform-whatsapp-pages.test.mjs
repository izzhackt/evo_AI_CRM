import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("WhatsApp list page uses canonical platform queue route contract", () => {
  const page = source("src/app/(staff)/whatsapp/page.tsx");

  assert.match(page, /listPlatformConversations/);
  assert.match(page, /requirePlatformMessagingActor/);
  assert.match(page, /parsePlatformConversationCursor/);
  assert.match(page, /assertExpectedQueryKeys\(query, \["before_at", "before_id"\]\)/);
  assert.match(page, /queueResetHref=\{cursor \? "\/whatsapp" : null\}/);
  assert.match(page, /queueNextHref=\{page\.nextCursor \? queueHref\(page\.nextCursor\) : null\}/);
  assert.doesNotMatch(page, /canonical-whatsapp|Canonical/);
});

test("WhatsApp thread page uses platform workflow actions and keeps provider identifiers out of client components", () => {
  const page = source("src/app/(staff)/whatsapp/[id]/page.tsx");
  const controls = source(
    "src/components/platform/communications/PlatformProviderWorkflowControls.tsx",
  );

  assert.match(page, /getPlatformConversationThread/);
  assert.match(page, /listPlatformConversations/);
  assert.match(page, /getPlatformWahaSessionHealth/);
  assert.match(page, /requestPlatformGeminiProposalAction/);
  assert.match(page, /reviewPlatformGeminiProposalAction/);
  assert.match(page, /sendPlatformWhatsAppMessageAction/);
  assert.match(page, /reconcilePlatformWhatsAppSendAction/);
  assert.match(
    page,
    /assertExpectedQueryKeys\(query, \[\s*"before_at",\s*"before_id",\s*"messages_before_at",\s*"messages_before_id",\s*\]\)/,
  );

  for (const forbidden of [
    "wahaMessageId",
    "kommoAccountId",
    "kommoConversationId",
    "amocrmAccountId",
    "amocrmLeadId",
    "amocrmContactId",
  ]) {
    assert.doesNotMatch(page, new RegExp(forbidden));
    assert.doesNotMatch(controls, new RegExp(forbidden));
  }
});

test("PlatformStaffWhatsApp exposes queue and thread outcome hooks only", () => {
  const workspace = source(
    "src/components/platform/communications/PlatformStaffWhatsApp.tsx",
  );

  for (const required of [
    'data-testid="platform-staff-whatsapp-page"',
    'data-testid="platform-staff-whatsapp-thread"',
    'data-testid="platform-staff-whatsapp-queue"',
    'data-testid="platform-staff-whatsapp-messages"',
    'data-testid="platform-staff-whatsapp-thread-region"',
    "Newest conversations",
    "Older conversations",
    "Newest messages",
    "Older messages",
    "before_at",
    "before_id",
    "isFreshWorkingWahaSession",
  ]) {
    assert.match(workspace, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const forbidden of [
    "wahaSessionName",
    "wahaMessageId",
    "kommoAccountId",
    "kommoConversationId",
    "amocrmAccountId",
    "amocrmLeadId",
    "amocrmContactId",
  ]) {
    assert.doesNotMatch(workspace, new RegExp(forbidden));
  }
});
