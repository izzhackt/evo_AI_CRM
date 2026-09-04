"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildPlatformCreateDecisionBacklogRpcArgs,
  buildPlatformTransitionDecisionBacklogRpcArgs,
  doesPlatformDecisionCreateTargetMatchWorkspace,
  doesPlatformDecisionMutationPreserveSnapshot,
  getPlatformConversationBw4Workspace,
  normalizePlatformDecisionMutationResponse,
  parsePlatformBw4Uuid,
  parsePlatformCreateDecisionBacklogEntryForm,
  parsePlatformTransitionDecisionBacklogEntryForm,
  type PlatformConversationBw4Workspace,
  type PlatformCreateDecisionBacklogMutation,
} from "./platform-bw4-workflow";
import { requirePlatformMessagingActor } from "./platform-guards";
import { createSupabaseServerClient } from "./supabase/server";

type PlatformDecisionMutationOutcome = "saved" | "invalid" | "unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInvalidMutationError(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.code === "22023" || value.code === "40001")
  );
}

function fallbackUuid(form: FormData, key: string): string | null {
  const values = form.getAll(key);
  return values.length === 1 ? parsePlatformBw4Uuid(values[0]) : null;
}

function mutationRedirect(
  conversationId: string | null,
  outcome: PlatformDecisionMutationOutcome,
  requestId?: string | null,
): never {
  const query = new URLSearchParams();
  if (conversationId) query.set("conversation", conversationId);
  const target = query.size > 0 ? `/v3/inbox?${query.toString()}` : "/v3/inbox";
  const fragment = new URLSearchParams({ result: outcome });
  if (requestId && outcome !== "saved") {
    fragment.set("retry_request_id", requestId);
  }
  redirect(`${target}#${fragment.toString()}`);
}

function canApplySharedMutation(
  workspace: PlatformConversationBw4Workspace,
  input: PlatformCreateDecisionBacklogMutation,
): boolean {
  return (
    workspace.canManageDecisions &&
    workspace.conversationId === input.conversationId &&
    doesPlatformDecisionCreateTargetMatchWorkspace(workspace, input) &&
    workspace.allowedOwnerRoles.includes(input.ownerRole)
  );
}

async function refreshWorkspace(
  actor: Awaited<ReturnType<typeof requirePlatformMessagingActor>>,
  conversationId: string,
): Promise<PlatformConversationBw4Workspace | null> {
  try {
    return await getPlatformConversationBw4Workspace(actor, conversationId);
  } catch {
    return null;
  }
}

function revalidateInboxPath(): void {
  try {
    revalidatePath("/v3/inbox");
  } catch {
    // The mutation is already durable. Cache invalidation failure must not turn
    // a committed idempotent request into a reported database failure.
  }
}

export async function createPlatformDecisionBacklogEntryAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformMessagingActor();
  const input = parsePlatformCreateDecisionBacklogEntryForm(form);
  if (input === null) {
    mutationRedirect(
      fallbackUuid(form, "conversation_id"),
      "invalid",
      fallbackUuid(form, "request_id"),
    );
  }

  const workspace = await refreshWorkspace(actor, input.conversationId);
  if (workspace === null) {
    mutationRedirect(input.conversationId, "unavailable", input.requestId);
  }
  if (!canApplySharedMutation(workspace, input)) {
    mutationRedirect(input.conversationId, "invalid", input.requestId);
  }

  let response: { data: unknown; error: unknown };
  try {
    const client = await createSupabaseServerClient();
    response = await client
      .schema("platform")
      .rpc(
        "create_decision_backlog_entry",
        buildPlatformCreateDecisionBacklogRpcArgs(
          actor.organizationId,
          input,
        ),
      );
  } catch {
    mutationRedirect(input.conversationId, "unavailable", input.requestId);
  }
  if (response.error) {
    mutationRedirect(
      input.conversationId,
      isInvalidMutationError(response.error) ? "invalid" : "unavailable",
      input.requestId,
    );
  }
  try {
    normalizePlatformDecisionMutationResponse(response.data, {
      organizationId: actor.organizationId,
      conversationId: input.conversationId,
      studentCaseId: input.studentCaseId,
      status: "unresolved",
    });
  } catch {
    mutationRedirect(input.conversationId, "unavailable", input.requestId);
  }

  revalidateInboxPath();
  mutationRedirect(input.conversationId, "saved");
}

export async function transitionPlatformDecisionBacklogEntryAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformMessagingActor();
  const input = parsePlatformTransitionDecisionBacklogEntryForm(form);
  if (input === null) {
    mutationRedirect(
      fallbackUuid(form, "conversation_id"),
      "invalid",
      fallbackUuid(form, "request_id"),
    );
  }

  const workspace = await refreshWorkspace(actor, input.conversationId);
  if (workspace === null) {
    mutationRedirect(input.conversationId, "unavailable", input.requestId);
  }
  const decision = workspace.decisions.find(
    (item) => item.decisionBacklogId === input.decisionBacklogId,
  );
  if (
    !canApplySharedMutation(workspace, input) ||
    decision === undefined ||
    (decision.currentVersion.status === "retired" &&
      input.newStatus !== "retired") ||
    (input.newStatus === "retired" &&
      !doesPlatformDecisionMutationPreserveSnapshot(
        decision.currentVersion,
        input,
      ))
  ) {
    mutationRedirect(input.conversationId, "invalid", input.requestId);
  }

  let response: { data: unknown; error: unknown };
  try {
    const client = await createSupabaseServerClient();
    response = await client
      .schema("platform")
      .rpc(
        "transition_decision_backlog_entry",
        buildPlatformTransitionDecisionBacklogRpcArgs(
          actor.organizationId,
          input,
        ),
      );
  } catch {
    mutationRedirect(input.conversationId, "unavailable", input.requestId);
  }
  if (response.error) {
    mutationRedirect(
      input.conversationId,
      isInvalidMutationError(response.error) ? "invalid" : "unavailable",
      input.requestId,
    );
  }
  try {
    normalizePlatformDecisionMutationResponse(response.data, {
      organizationId: actor.organizationId,
      conversationId: input.conversationId,
      decisionBacklogId: input.decisionBacklogId,
      expectedEffectiveVersion: input.expectedEffectiveVersion,
      previousStatus: decision.currentVersion.status,
      status: input.newStatus,
    });
  } catch {
    mutationRedirect(input.conversationId, "unavailable", input.requestId);
  }

  revalidateInboxPath();
  mutationRedirect(input.conversationId, "saved");
}
