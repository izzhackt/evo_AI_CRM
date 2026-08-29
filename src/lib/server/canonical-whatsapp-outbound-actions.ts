"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformMessagingSendActor } from "@/lib/platform-guards";

import {
  parseCanonicalWhatsAppReconcileForm,
  parseCanonicalWhatsAppSendForm,
} from "./canonical-whatsapp-outbound-form";
import {
  reconcileCanonicalWhatsAppOutbound,
  sendCanonicalWhatsAppOutbound,
} from "./canonical-whatsapp-outbound-service";

export type CanonicalWhatsAppSendActionState = Readonly<{
  status:
    | "idle"
    | "accepted"
    | "unknown"
    | "rejected"
    | "blocked"
    | "error"
    | "invalid";
  reason: string | null;
  attemptId: string | null;
  messageId: string | null;
  ackName: string | null;
}>;

export type CanonicalWhatsAppReconcileActionState = Readonly<{
  status: "idle" | "reconciled" | "blocked" | "error" | "invalid";
  reason: string | null;
  attemptId: string | null;
  ackName: string | null;
}>;

function invalidSendState(): CanonicalWhatsAppSendActionState {
  return Object.freeze({
    status: "invalid",
    reason: "invalid_request",
    attemptId: null,
    messageId: null,
    ackName: null,
  });
}

function invalidReconcileState(): CanonicalWhatsAppReconcileActionState {
  return Object.freeze({
    status: "invalid",
    reason: "invalid_request",
    attemptId: null,
    ackName: null,
  });
}

export async function sendCanonicalWhatsAppOutboundAction(
  _previous: CanonicalWhatsAppSendActionState,
  form: FormData,
): Promise<CanonicalWhatsAppSendActionState> {
  const actor = await requirePlatformMessagingSendActor();
  const parsed = parseCanonicalWhatsAppSendForm(form);
  if (parsed === null) return invalidSendState();

  const result = await sendCanonicalWhatsAppOutbound(actor.platformRole, parsed);
  if (
    result.status === "accepted" ||
    result.status === "unknown" ||
    result.status === "rejected"
  ) {
    revalidatePath(`/whatsapp/${parsed.conversationId}`);
    return Object.freeze({
      status: result.status,
      reason: result.attempt.failureCode,
      attemptId: result.attempt.attemptId,
      messageId: result.attempt.messageId,
      ackName: result.attempt.ackName,
    });
  }
  return Object.freeze({
    status: "reason" in result ? result.status : "error",
    reason: "reason" in result ? result.reason : "storage_unavailable",
    attemptId: null,
    messageId: null,
    ackName: null,
  });
}

export async function reconcileCanonicalWhatsAppOutboundAction(
  _previous: CanonicalWhatsAppReconcileActionState,
  form: FormData,
): Promise<CanonicalWhatsAppReconcileActionState> {
  const actor = await requirePlatformMessagingSendActor();
  const parsed = parseCanonicalWhatsAppReconcileForm(form);
  if (parsed === null) return invalidReconcileState();

  const result = await reconcileCanonicalWhatsAppOutbound(
    actor.platformRole,
    parsed,
  );
  if (result.status === "reconciled") {
    revalidatePath(`/whatsapp/${parsed.conversationId}`);
    return Object.freeze({
      status: "reconciled",
      reason: null,
      attemptId: result.attempt.attemptId,
      ackName: result.attempt.ackName,
    });
  }
  return Object.freeze({
    status: result.status,
    reason: result.reason,
    attemptId: null,
    ackName: null,
  });
}
