import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/lib/platform-provider-actions.ts", import.meta.url),
  "utf8",
);

test("provider server actions use the exact staff-intent parsers and actor organization", () => {
  assert.match(source, /^"use server";/m);
  for (const parser of [
    "parsePlatformGeminiRequestForm",
    "parsePlatformGeminiReviewForm",
    "parsePlatformWhatsAppSendForm",
    "parsePlatformWhatsAppReconcileForm",
  ]) {
    assert.match(source, new RegExp(`${parser}\\(form\\)`));
  }

  assert.match(source, /requirePlatformMessagingActor\(\)/g);
  assert.match(source, /requirePlatformMessagingSendActor\(\)/g);
  assert.match(source, /organizationId:\s*actor\.organizationId/g);
  assert.doesNotMatch(source, /organization_id["']\)|form\.get\(/);
});

test("Gemini action has one server-only key and delegates pinned execution to the orchestrator", () => {
  assert.match(source, /process\.env\.EVO_PLATFORM_GEMINI_API_KEY/);
  assert.deepEqual(
    [...source.matchAll(/process\.env\.([A-Z0-9_]*GEMINI[A-Z0-9_]*)/g)].map(
      (match) => match[1],
    ),
    ["EVO_PLATFORM_GEMINI_API_KEY"],
  );
  assert.doesNotMatch(source, /EVO_V2_GEMINI|GEMINI_MODEL|FEATURE|ENABLED|fallback/i);
  assert.match(source, /createPlatformGeminiProvider\(geminiApiKey\)/);
  assert.match(
    source,
    /requestGeminiProposal\([\s\S]*?requestId:\s*input\.requestId[\s\S]*?executePlatformGeminiProposal\([\s\S]*?requestId:\s*input\.requestId/,
  );
  assert.doesNotMatch(source, /maxOutputTokens|temperature|timeoutMs|model:/);
});

test("review action rereads the stored proposal and lets the browser edit only reply_text", () => {
  assert.match(source, /readStaffGeminiProposal\(/);
  assert.match(source, /proposalRequestId\s*!==\s*input\.proposalRequestId/);
  assert.match(source, /if \(decision === "accepted"\) return proposal/);
  assert.match(
    source,
    /if \(editedReplyText === null\) return null;[\s\S]*?\.\.\.proposal,[\s\S]*?reply_text:\s*editedReplyText/,
  );
  assert.match(source, /if \(decision === "rejected"\) return null/);
  assert.doesNotMatch(source, /reviewed_payload|providerInteraction|provider_evidence/);
});

test("manual send computes the migration-050 business key and exposes no provider target", () => {
  const expected = "d16c20ca302e39e8fa6b7443ac04b78ec8e22051acca836a64551864f4d687b1";
  const input = JSON.stringify([
    "evo-platform-work-v1",
    "manual_whatsapp_send",
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "staff-authored",
  ]);
  assert.equal(createHash("sha256").update(input, "utf8").digest("hex"), expected);

  assert.match(source, /JSON\.stringify\(\[[\s\S]*?"evo-platform-work-v1"[\s\S]*?"manual_whatsapp_send"[\s\S]*?organizationId[\s\S]*?conversationId[\s\S]*?sourceMessageId[\s\S]*?"staff-authored"[\s\S]*?\]\)/);
  assert.match(source, /manualSendBusinessKey\(\s*actor\.organizationId,\s*input\.conversationId,\s*input\.sourceMessageId/);
  assert.match(source, /createHash\("sha256"\)\.update\([^)]*,\s*"utf8"\)\.digest\("hex"\)/);
  assert.match(source, /aiDraftId:\s*null/);
  assert.match(source, /executePlatformManualWhatsAppSend\([\s\S]*?\{\s*authorization,/);
  assert.doesNotMatch(source, /rawChatId|recipient|WAHA_API_KEY|session_name|phone/i);
});

test("reconciliation is send-free and every durable result revalidates only the active V3 Inbox", () => {
  assert.match(source, /executePlatformManualWhatsAppReconciliation\(/);
  assert.doesNotMatch(source, /sendText|broadcast|autonomous/i);
  assert.match(source, /revalidatePath\("\/v3\/inbox"\)/);
  assert.doesNotMatch(source, /revalidatePath\([^\n]*\/whatsapp|revalidatePath\("\/"/);
});
