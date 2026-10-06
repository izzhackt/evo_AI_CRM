"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  parsePlatformWhatsAppChatReconcileInput,
  parsePlatformWhatsAppChatSendInput,
} from "./platform-provider-action-contract";
import { getPlatformWhatsAppChatState } from "./platform-communications";
import {
  claimManualWhatsAppSendItem,
  PlatformManualSendRefusedError,
  requestManualWhatsAppSendWithAuthorization,
  type PlatformManualWhatsAppSendAuthorization,
} from "./platform-provider-workflows";
import { requirePlatformMutationCapability } from "./platform-guards";
import {
  executePlatformManualWhatsAppReconciliation,
  sendClaimedManualWhatsApp,
} from "./server/platform-provider-orchestrator";
import { getPlatformSupabaseBackendConfig } from "./server/platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./server/platform-supabase-service-client";
import { createSupabaseServerClient } from "./supabase/server";
import type {
  WhatsAppChatReconcileStatus,
  WhatsAppChatSendResult,
} from "./v3/whatsapp-chat";

/**
 * «Продажи → WhatsApp» as a chat (owner decision 06.10.2026, migration 266).
 * One click = one request id = one authorized, audited manual send whose
 * sender is the member who wrote it. The text answers the latest customer
 * message (reply-only); several replies in a row are separate work items.
 * A repeated click with the same request id replays the stored authorization
 * and never claims twice; an unknown provider result is only ever checked by
 * an exact readback, never resent.
 */

const MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS = 120;
const MANUAL_SEND_WORKER_REF = "next-app-chat-send";
const CLAIM_ATTEMPTS = 3;
const CLAIM_RETRY_DELAY_MS = 650;

function revalidateInboxPath(): void {
  try {
    revalidatePath("/v3/inbox");
  } catch {
    // The provider result is already durable. A cache failure must not make a
    // safely idempotent action look as though it can be repeated.
  }
}

function createServiceClient() {
  return createPlatformSupabaseServiceClient(
    getPlatformSupabaseBackendConfig(),
  );
}

/**
 * Migration 266's v2 key: the message cycle plus this click's request id, so
 * every click is its own work item while a replay of the click is the same one.
 */
function chatReplyBusinessKey(
  organizationId: string,
  conversationId: string,
  sourceMessageId: string,
  requestId: string,
): string {
  const immutableCycle = JSON.stringify([
    "evo-platform-work-v2",
    "manual_whatsapp_send",
    organizationId,
    conversationId,
    sourceMessageId,
    "staff-authored",
    requestId,
  ]);
  return createHash("sha256").update(immutableCycle, "utf8").digest("hex");
}

const result = (
  status: WhatsAppChatSendResult["status"],
  fields: Partial<Omit<WhatsAppChatSendResult, "status">> = {},
): WhatsAppChatSendResult => Object.freeze({
  status,
  workItemId: fields.workItemId ?? null,
  attemptId: fields.attemptId ?? null,
  messageId: fields.messageId ?? null,
});

const pause = (milliseconds: number) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });

type ItemState = Readonly<{
  status: "queued" | "prepared" | "unknown" | "rejected" | "accepted";
  attemptId: string | null;
  claimedAt: string | null;
}>;

/** The work item's state as the staff member may read it (the chat state, 266). */
async function readItemState(
  actor: Awaited<ReturnType<typeof requirePlatformMutationCapability>>,
  conversationId: string,
  workItemId: string,
): Promise<ItemState> {
  const state = await getPlatformWhatsAppChatState(actor, conversationId);
  const attempt = state.attempts.find((entry) => entry.workItemId === workItemId);
  // The chat state lists every send that is not accepted; a fresh item that
  // is missing from it has been accepted.
  if (!attempt) return { status: "accepted", attemptId: null, claimedAt: null };
  return { status: attempt.status, attemptId: attempt.attemptId, claimedAt: attempt.claimedAt };
}

async function claimAndSend(
  authorization: PlatformManualWhatsAppSendAuthorization,
): Promise<WhatsAppChatSendResult | null> {
  const serviceClient = createServiceClient();
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await pause(CLAIM_RETRY_DELAY_MS);
    let claim: Awaited<ReturnType<typeof claimManualWhatsAppSendItem>>;
    try {
      // A refused claim (another send of this chat is still ahead) changes
      // nothing and is safe to ask again; the claim itself is the only
      // authority for the one provider call below.
      claim = await claimManualWhatsAppSendItem(serviceClient, {
        organizationId: authorization.organizationId,
        workItemId: authorization.workItemId,
        visibilityTimeoutSeconds: MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS,
        workerRef: MANUAL_SEND_WORKER_REF,
        requestId: randomUUID(),
      });
    } catch {
      continue;
    }
    if (!claim.claimed) return null;
    const execution = await sendClaimedManualWhatsApp(
      serviceClient,
      claim,
      authorization,
      randomUUID(),
      {},
      { quoteSource: false },
    );
    const outcome = execution.result.outcome;
    return result(
      outcome === "succeeded" ? "sent" : outcome === "unknown_result" ? "unknown" : "rejected",
      {
        workItemId: claim.workItemId,
        attemptId: claim.attemptId,
        messageId: execution.result.communicationMessageId,
      },
    );
  }
  return result("queued", { workItemId: authorization.workItemId });
}

export async function sendPlatformWhatsAppMessageAction(
  input: unknown,
): Promise<WhatsAppChatSendResult> {
  const actor = await requirePlatformMutationCapability("messaging.send", "/v3/inbox");
  const parsed = parsePlatformWhatsAppChatSendInput(input);
  if (parsed === null) return result("invalid");

  let authorization: PlatformManualWhatsAppSendAuthorization;
  try {
    const staffClient = await createSupabaseServerClient();
    authorization = await requestManualWhatsAppSendWithAuthorization(
      staffClient,
      {
        organizationId: actor.organizationId,
        conversationId: parsed.conversationId,
        sourceMessageId: parsed.sourceMessageId,
        aiDraftId: null,
        finalText: parsed.text,
        reason: "staff_chat_reply",
        businessKeySha256: chatReplyBusinessKey(
          actor.organizationId,
          parsed.conversationId,
          parsed.sourceMessageId,
          parsed.requestId,
        ),
        requestId: parsed.requestId,
      },
    );
  } catch (error) {
    if (error instanceof PlatformManualSendRefusedError) return result(error.reason);
    return result("unavailable");
  }

  try {
    // A replay of an earlier click returns the stored authorization; claim
    // only what is still waiting in the queue.
    const state = await readItemState(actor, parsed.conversationId, authorization.workItemId);
    const fields = { workItemId: authorization.workItemId, attemptId: state.attemptId };
    let outcome: WhatsAppChatSendResult | null = null;
    if (state.status === "queued") {
      outcome = await claimAndSend(authorization);
    } else if (state.status === "prepared") {
      // Claimed by an earlier click; once its lease has run out, the exact
      // claim turns it into an unknown result for a readback (no resend).
      const leaseOver = state.claimedAt !== null
        && Date.now() - Date.parse(state.claimedAt) > (MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS + 15) * 1_000;
      if (leaseOver) await claimAndSend(authorization).catch(() => null);
      outcome = result("sending", fields);
    } else if (state.status === "accepted") {
      outcome = result("sent", fields);
    } else {
      outcome = result(state.status === "unknown" ? "unknown" : "rejected", fields);
    }
    revalidateInboxPath();
    if (outcome === null) {
      // Claimed by someone else between the read and the claim.
      const after = await readItemState(actor, parsed.conversationId, authorization.workItemId);
      return result(after.status === "accepted" ? "sent" : after.status === "queued" ? "queued"
        : after.status === "prepared" ? "sending" : after.status === "unknown" ? "unknown" : "rejected",
      { workItemId: authorization.workItemId, attemptId: after.attemptId });
    }
    return outcome;
  } catch {
    // The authorization is durable; the outcome of this click is not known
    // here. The same request id replays it safely.
    revalidateInboxPath();
    return result("unavailable", { workItemId: authorization.workItemId });
  }
}

export async function reconcilePlatformWhatsAppSendAction(
  input: unknown,
): Promise<Readonly<{ status: WhatsAppChatReconcileStatus }>> {
  const actor = await requirePlatformMutationCapability("messaging.send", "/v3/inbox");
  const parsed = parsePlatformWhatsAppChatReconcileInput(input);
  if (parsed === null) return Object.freeze({ status: "invalid" });

  try {
    const staffClient = await createSupabaseServerClient();
    const serviceClient = createServiceClient();
    const execution = await executePlatformManualWhatsAppReconciliation(
      staffClient,
      serviceClient,
      {
        organizationId: actor.organizationId,
        conversationId: parsed.conversationId,
        attemptId: parsed.attemptId,
        requestId: parsed.requestId,
        reason: "staff_requested_exact_waha_readback",
        completionRequestId: randomUUID(),
      },
    );
    revalidateInboxPath();
    if (execution.status === "already_completed") {
      return Object.freeze({ status: "already_completed" });
    }
    if (execution.status === "readback_failed") {
      return Object.freeze({ status: "readback_failed" });
    }
    return Object.freeze({
      status: execution.result.reconciliationRequired ? "not_found" : "confirmed",
    });
  } catch {
    return Object.freeze({ status: "unavailable" });
  }
}
