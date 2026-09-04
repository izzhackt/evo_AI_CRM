import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controls = readFileSync(
  new URL(
    "../src/components/v3/InboxProviderWorkflowControls.tsx",
    import.meta.url,
  ),
  "utf8",
);
const page = readFileSync(
  new URL("../src/app/(v3)/v3/inbox/page.tsx", import.meta.url),
  "utf8",
);
const inboxSource = readFileSync(
  new URL("../src/lib/v3/inbox-source.ts", import.meta.url),
  "utf8",
);

test("V3 Gemini controls remain advisory and require an explicit review decision", () => {
  assert.match(controls, /useActionState\(\s*requestPlatformGeminiProposalAction/);
  assert.match(controls, /useActionState\(\s*reviewPlatformGeminiProposalAction/);
  assert.match(controls, /proposal\?\.outcome === "proposal_ready"/);
  for (const decision of ["accepted", "edited", "rejected"]) {
    assert.match(controls, new RegExp(`"${decision}"`));
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
  ]) {
    assert.match(controls, new RegExp(`name="${field}"`));
  }
  assert.doesNotMatch(
    controls,
    /auto(?:nomous)?[_ -]?send|broadcast|providerInteraction|reviewed_payload/i,
  );
});

test("V3 WhatsApp send is one-recipient, confirmed and blocked by unresolved attempts", () => {
  assert.match(controls, /useActionState\(\s*sendPlatformWhatsAppMessageAction/);
  assert.match(
    controls,
    /latestAttempt\?\.status === "prepared" \|\| latestAttempt\?\.status === "unknown"/,
  );
  assert.match(controls, /name="confirm_send"/);
  assert.match(controls, /unresolvedAttempt[\s\S]*!confirmed/);
  assert.match(controls, /data-testid="v3-inbox-send"/);
  for (const field of [
    "conversation_id",
    "source_message_id",
    "request_id",
    "message_text",
    "confirm_send",
  ]) {
    assert.match(controls, new RegExp(`name="${field}"`));
  }
  assert.doesNotMatch(
    controls,
    /recipient|rawChatId|wahaMessageId|session_name|phone/i,
  );
});

test("unknown delivery exposes readback reconciliation without a resend path", () => {
  assert.match(controls, /useActionState\(\s*reconcilePlatformWhatsAppSendAction/);
  assert.match(controls, /latestAttempt\.reconciliationRequired/);
  assert.match(controls, /data-testid="v3-inbox-reconcile"/);
  assert.match(controls, /name="attempt_id"/);
  assert.match(controls, /name="reconcile_request_id"/);
  assert.match(
    controls,
    /Проверить результат без новой отправки/,
  );
});

test("V3 page reads provider state through the authenticated canonical source", () => {
  assert.match(page, /requirePlatformMessagingActor/);
  assert.match(page, /readInbox\(actor/);
  assert.match(page, /<InboxProviderWorkflowControls/);
  assert.match(inboxSource, /readStaffGeminiProposal/);
  assert.match(inboxSource, /listStaffGeminiProposalReviews/);
  assert.match(inboxSource, /readLatestManualWhatsAppSendAttempt/);
  assert.match(inboxSource, /getPlatformConversationCommandContext/);
  assert.doesNotMatch(
    `${page}\n${inboxSource}`,
    /service[_-]?role|EVO_PLATFORM_SUPABASE_SECRET_KEY|recipient|rawChat|fallback/i,
  );
});
