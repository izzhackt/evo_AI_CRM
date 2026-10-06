"use server";

import { createHash, randomUUID } from "node:crypto";

import {
  parsePlatformWhatsAppChatReconcileInput,
  parsePlatformWhatsAppChatSendInput,
} from "./platform-provider-action-contract";
import {
  getPlatformWhatsAppChatState,
  type PlatformWhatsAppChatState,
} from "./platform-communications";
import {
  claimManualWhatsAppSendItem,
  PlatformManualSendRefusedError,
  requestManualWhatsAppSendWithAuthorization,
  type PlatformManualWhatsAppSendAuthorization,
} from "./platform-provider-workflows";
import { requirePlatformMutationCapability } from "./platform-guards";
import {
  executePlatformManualWhatsAppReconciliation,
  executePlatformManualWhatsAppSend,
} from "./server/platform-provider-orchestrator";
import { getPlatformSupabaseBackendConfig } from "./server/platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./server/platform-supabase-service-client";
import { createSupabaseServerClient } from "./supabase/server";
import {
  WHATSAPP_CHAT_LEASE_OVER_MS,
  type WhatsAppChatReconcileStatus,
  type WhatsAppChatSendResult,
} from "./v3/whatsapp-chat";

/**
 * «Продажи → WhatsApp» as a chat (owner decision 06.10.2026, migration 266).
 * One click = one request id = one authorized, audited manual send whose
 * sender is the member who wrote it. The text answers the latest customer
 * message (reply-only); several replies in a row are separate work items.
 * A repeated click with the same request id replays the stored authorization
 * and never claims twice; an unknown provider result is only ever checked by
 * an exact readback, never resent.
 *
 * Neither action revalidates the route: the chat refreshes itself once after
 * every answer (router.refresh in the browser), so one action is one render.
 */

const MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS = 120;
const MANUAL_SEND_WORKER_REF = "next-app-chat-send";
const CLAIM_ATTEMPTS = 3;
const CLAIM_RETRY_DELAY_MS = 650;

type Actor = Awaited<ReturnType<typeof requirePlatformMutationCapability>>;

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

function itemState(state: PlatformWhatsAppChatState, workItemId: string): ItemState {
  const attempt = state.attempts.find((entry) => entry.workItemId === workItemId);
  // The chat state lists every send that is not accepted; a fresh item that
  // is missing from it has been accepted.
  if (!attempt) return { status: "accepted", attemptId: null, claimedAt: null };
  return { status: attempt.status, attemptId: attempt.attemptId, claimedAt: attempt.claimedAt };
}

/** The work item's state as the staff member may read it (the chat state, 266). */
async function readItemState(actor: Actor, conversationId: string, workItemId: string): Promise<ItemState> {
  return itemState(await getPlatformWhatsAppChatState(actor, conversationId), workItemId);
}

function leaseOver(claimedAt: string | null): boolean {
  return claimedAt !== null && Date.now() - Date.parse(claimedAt) > WHATSAPP_CHAT_LEASE_OVER_MS;
}

/**
 * The exact claim of a claimed item whose lease ran out (the application died
 * during its provider call). The claim never sends it: it only turns it into
 * an unknown result for a readback (migration 097), so any member may run it.
 * Its answer is not a claimed item, so the parser refuses it; the change is
 * already durable and the caller reads the state again.
 */
async function settleExpiredLease(workItemId: string, organizationId: string): Promise<void> {
  try {
    await claimManualWhatsAppSendItem(createServiceClient(), {
      organizationId,
      workItemId,
      visibilityTimeoutSeconds: MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS,
      workerRef: MANUAL_SEND_WORKER_REF,
      requestId: randomUUID(),
    });
  } catch {
    // Either it was converted (the answer has another shape) or it is not the
    // chat's head; both leave nothing to undo.
  }
}

/**
 * A chat whose head is someone else's send with an expired lease waits until
 * an exact claim of that item settles it as unknown (no send). The oldest such
 * item of the chat is settled once per click.
 */
async function releaseExpiredHead(actor: Actor, conversationId: string, ownWorkItemId: string): Promise<void> {
  const state = await getPlatformWhatsAppChatState(actor, conversationId);
  const head = state.attempts
    .filter((attempt) => attempt.workItemId !== ownWorkItemId && attempt.status === "prepared" && leaseOver(attempt.claimedAt))
    .sort((left, right) => (left.authorizedAt < right.authorizedAt ? -1 : left.authorizedAt > right.authorizedAt ? 1 : 0))[0];
  if (head) await settleExpiredLease(head.workItemId, actor.organizationId);
}

async function claimAndSend(
  actor: Actor,
  conversationId: string,
  authorization: PlatformManualWhatsAppSendAuthorization,
): Promise<WhatsAppChatSendResult | null> {
  const serviceClient = createServiceClient();
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await pause(CLAIM_RETRY_DELAY_MS);
    // After a refused claim, an expired lease ahead of this send is the one
    // blocker nobody else would clear; a send never claimed for a minute no
    // longer holds the chat (migration 266).
    if (attempt === 1) await releaseExpiredHead(actor, conversationId, authorization.workItemId).catch(() => undefined);
    let execution: Awaited<ReturnType<typeof executePlatformManualWhatsAppSend>>;
    try {
      // A refused claim (another send of this chat is still ahead) changes
      // nothing and is safe to ask again; the claim itself is the only
      // authority for the one provider call it may lead to.
      execution = await executePlatformManualWhatsAppSend(
        serviceClient,
        {
          authorization,
          visibilityTimeoutSeconds: MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS,
          workerRef: MANUAL_SEND_WORKER_REF,
          claimRequestId: randomUUID(),
          completionRequestId: randomUUID(),
        },
        {},
        { quoteSource: false },
      );
    } catch {
      continue;
    }
    if (execution.status === "not_claimed") return null;
    const outcome = execution.result.outcome;
    return result(
      outcome === "succeeded" ? "sent" : outcome === "unknown_result" ? "unknown" : "rejected",
      {
        workItemId: execution.result.workItemId,
        attemptId: execution.result.attemptId,
        messageId: execution.result.communicationMessageId,
      },
    );
  }
  return result("queued", { workItemId: authorization.workItemId });
}

/**
 * The database gives one message for a source that is no longer the latest
 * customer message and for a closed conversation. The chat state tells them
 * apart: if the source is still the latest, the conversation was closed.
 */
async function refusalStatus(
  actor: Actor,
  error: PlatformManualSendRefusedError,
  conversationId: string,
  sourceMessageId: string,
): Promise<WhatsAppChatSendResult["status"]> {
  if (error.reason !== "stale_source") return error.reason;
  try {
    const state = await getPlatformWhatsAppChatState(actor, conversationId);
    return state.latestInboundMessageId === sourceMessageId ? "closed" : "stale_source";
  } catch {
    return "stale_source";
  }
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
    if (error instanceof PlatformManualSendRefusedError) {
      return result(await refusalStatus(actor, error, parsed.conversationId, parsed.sourceMessageId));
    }
    return result("unavailable");
  }

  try {
    // A replay of an earlier click returns the stored authorization; claim
    // only what is still waiting in the queue.
    const state = await readItemState(actor, parsed.conversationId, authorization.workItemId);
    const fields = { workItemId: authorization.workItemId, attemptId: state.attemptId };
    let outcome: WhatsAppChatSendResult | null = null;
    if (state.status === "queued") {
      outcome = await claimAndSend(actor, parsed.conversationId, authorization);
    } else if (state.status === "prepared") {
      // Claimed by an earlier click; once its lease has run out, the exact
      // claim turns it into an unknown result for a readback (no resend).
      if (leaseOver(state.claimedAt)) await settleExpiredLease(authorization.workItemId, actor.organizationId);
      outcome = result("sending", fields);
    } else if (state.status === "accepted") {
      outcome = result("sent", fields);
    } else {
      outcome = result(state.status === "unknown" ? "unknown" : "rejected", fields);
    }
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
    // A send whose lease ran out without a result (the application died
    // during the provider call) is first settled as unknown by its exact
    // claim — never sent — and then checked like any unknown attempt.
    const state = await getPlatformWhatsAppChatState(actor, parsed.conversationId);
    const attempt = state.attempts.find((entry) => entry.attemptId === parsed.attemptId);
    if (attempt?.status === "prepared") {
      if (!leaseOver(attempt.claimedAt)) return Object.freeze({ status: "unavailable" });
      await settleExpiredLease(attempt.workItemId, actor.organizationId);
    }

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
