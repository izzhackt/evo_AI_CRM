// Серверные действия чата «Продажи → WhatsApp» (решение владельца 06.10.2026,
// миграция 266). Поведение отправки и проверки доказывает настоящая цепочка
// Postgres (supabase/tests/platform_whatsapp_chat_replies.sql); здесь —
// контракт исходника: точный разбор намерения, ключ v2 на клик, никакого
// получателя из браузера, ни Gemini, ни подтверждения «одной отправки».
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/lib/platform-provider-actions.ts", import.meta.url),
  "utf8",
);

test("chat actions parse the exact staff intent and act for the actor's organization", () => {
  assert.match(source, /^"use server";/m);
  assert.match(source, /parsePlatformWhatsAppChatSendInput\(input\)/u);
  assert.match(source, /parsePlatformWhatsAppChatReconcileInput\(input\)/u);
  assert.equal(
    source.match(/requirePlatformMutationCapability\("messaging\.send", "\/v3\/inbox"\)/gu)?.length,
    2,
    "both actions: send capability, never in a role preview",
  );
  assert.match(source, /organizationId:\s*actor\.organizationId/u);
  assert.doesNotMatch(source, /form\.get\(|FormData/u);
});

test("the Gemini draft, its review and the one-send confirmation are gone", () => {
  assert.doesNotMatch(source, /Gemini|EVO_PLATFORM_GEMINI_API_KEY|confirm_send|confirmSend/iu);
  assert.doesNotMatch(source, /export async function (request|review)PlatformGemini/u);
  assert.deepEqual(
    [...source.matchAll(/export async function (\w+)/gu)].map((match) => match[1]),
    ["sendPlatformWhatsAppMessageAction", "reconcilePlatformWhatsAppSendAction"],
  );
});

test("every click is its own work item: the migration-266 v2 key binds the request id", () => {
  const input = JSON.stringify([
    "evo-platform-work-v2",
    "manual_whatsapp_send",
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "staff-authored",
    "44444444-4444-4444-8444-444444444444",
  ]);
  // The same bytes Postgres hashes: array_to_json(ARRAY[...])::TEXT.
  assert.equal(input, '["evo-platform-work-v2","manual_whatsapp_send","11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333","staff-authored","44444444-4444-4444-8444-444444444444"]');
  assert.match(createHash("sha256").update(input, "utf8").digest("hex"), /^[0-9a-f]{64}$/u);

  assert.match(source, /JSON\.stringify\(\[[\s\S]*?"evo-platform-work-v2"[\s\S]*?"manual_whatsapp_send"[\s\S]*?organizationId[\s\S]*?conversationId[\s\S]*?sourceMessageId[\s\S]*?"staff-authored"[\s\S]*?requestId[\s\S]*?\]\)/u);
  assert.match(source, /chatReplyBusinessKey\(\s*actor\.organizationId,\s*parsed\.conversationId,\s*parsed\.sourceMessageId,\s*parsed\.requestId/u);
  assert.match(source, /requestId: parsed\.requestId/u);
  assert.match(source, /aiDraftId:\s*null/u);
  assert.doesNotMatch(source, /rawChatId|recipient|WAHA_API_KEY|session_name|phone/iu);
});

test("a replay never claims twice: only a queued item is claimed, a refused claim is retried briefly", () => {
  assert.match(source, /if \(state\.status === "queued"\) \{\s*outcome = await claimAndSend\(actor, parsed\.conversationId, authorization\);/u);
  assert.match(source, /CLAIM_ATTEMPTS = 3/u);
  assert.match(source, /executePlatformManualWhatsAppSend\([\s\S]*?\{ quoteSource: false \}/u, "chat replies do not quote the customer message (D3)");
  assert.match(source, /if \(error instanceof PlatformManualSendRefusedError\) \{\s*return result\(await refusalStatus\(/u);
});

test("a stuck chat drains without a send: an expired lease ahead is settled as unknown by its exact claim", () => {
  // The exact claim of an expired lease never sends (migration 097): it only
  // opens the unknown review, so any member's click may run it.
  assert.match(source, /async function settleExpiredLease\(workItemId: string, organizationId: string\)/u);
  assert.match(source, /attempt\.workItemId !== ownWorkItemId && attempt\.status === "prepared" && leaseOver\(attempt\.claimedAt\)/u);
  assert.match(source, /if \(attempt === 1\) await releaseExpiredHead\(actor, conversationId, authorization\.workItemId\)/u);
  // settleExpiredLease never calls the provider: only the claim RPC.
  const settle = source.slice(source.indexOf("async function settleExpiredLease"), source.indexOf("async function releaseExpiredHead"));
  assert.match(settle, /claimManualWhatsAppSendItem\(createServiceClient\(\)/u);
  assert.doesNotMatch(settle, /sendClaimedManualWhatsApp|executePlatformManualWhatsAppSend|sendText/u);
  // «Проверить» on a send whose lease ran out settles it first, then reads back.
  assert.match(source, /if \(attempt\?\.status === "prepared"\) \{\s*if \(!leaseOver\(attempt\.claimedAt\)\) return Object\.freeze\(\{ status: "unavailable" \}\);\s*await settleExpiredLease\(attempt\.workItemId, actor\.organizationId\);/u);
});

test("a closed chat is told apart from a newer customer message", () => {
  assert.match(source, /return state\.latestInboundMessageId === sourceMessageId \? "closed" : "stale_source";/u);
});

test("reconciliation is send-free and names the exact attempt; neither action revalidates (the browser refreshes once)", () => {
  assert.match(source, /executePlatformManualWhatsAppReconciliation\(/u);
  assert.match(source, /attemptId: parsed\.attemptId/u);
  assert.doesNotMatch(source, /sendText|broadcast|autonomous/iu);
  assert.doesNotMatch(source, /revalidatePath/u);
  const chat = readFileSync(new URL("../src/components/v3/inbox/InboxChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /startTransition\(\(\) => router\.refresh\(\)\)/u);
});
