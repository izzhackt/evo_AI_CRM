"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformMessagingActor } from "@/lib/platform-guards";

import { requestCanonicalGeminiProposal } from "./canonical-gemini-proposal-service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CanonicalGeminiProposalActionState = Readonly<{
  status: "idle" | "created" | "blocked" | "error" | "invalid";
  reason: string | null;
  proposalId: string | null;
}>;

function single(form: FormData, key: string): FormDataEntryValue | undefined {
  const values = form.getAll(key);
  return values.length === 1 ? values[0] : undefined;
}

export async function requestCanonicalGeminiProposalAction(
  _previous: CanonicalGeminiProposalActionState,
  form: FormData,
): Promise<CanonicalGeminiProposalActionState> {
  const actor = await requirePlatformMessagingActor();
  const conversationId = single(form, "conversation_id");
  if (
    typeof conversationId !== "string" ||
    !UUID_PATTERN.test(conversationId)
  ) {
    return Object.freeze({
      status: "invalid",
      reason: "invalid_conversation",
      proposalId: null,
    });
  }

  const result = await requestCanonicalGeminiProposal({
    actorRole: actor.platformRole,
    conversationId: conversationId.toLowerCase(),
  });
  if (result.status === "created") {
    revalidatePath(`/whatsapp/${conversationId.toLowerCase()}`);
    return Object.freeze({
      status: "created",
      reason: null,
      proposalId: result.proposal.proposalId,
    });
  }
  return Object.freeze({
    status: result.status,
    reason: result.reason,
    proposalId: null,
  });
}
