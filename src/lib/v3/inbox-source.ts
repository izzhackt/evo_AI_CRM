import "server-only";

import type {
  InboxConversation,
  InboxMessage,
  InboxSelectedConversation,
  InboxView,
} from "@/components/v3/Inbox";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  getPlatformConversationThread,
  getPlatformConversationCommandContext,
  getPlatformWahaSessionHealth,
  listPlatformConversations,
  type PlatformConversationCursor,
  type PlatformConversationMessage,
  type PlatformConversationSummary,
} from "@/lib/platform-communications";
import type { CanonicalAmoCrmCommandAvailability } from "@/lib/server/canonical-amocrm-command-actions";
import { readCanonicalAmoCrmCommandAvailability } from "@/lib/server/canonical-amocrm-command-actions";
import {
  PlatformAmoCrmCommandRpcError,
  readPlatformBlockingAmoCrmCommand,
  type PlatformAmoCrmCommandOperationName,
} from "@/lib/server/platform-amocrm-command-rpc";
import {
  listStaffGeminiProposalReviews,
  readLatestManualWhatsAppSendAttempt,
  readStaffGeminiProposal,
  type PlatformGeminiProposalReview,
  type PlatformManualWhatsAppSendAttempt,
  type PlatformStaffGeminiProposal,
} from "@/lib/platform-provider-workflows";
import { isFreshWorkingWahaSession } from "@/lib/provider-display-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const INBOX_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 50;

const BISHKEK_TIME = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Bishkek",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type InboxReadOptions = Readonly<{
  conversationId: string | null;
  queueCursor: PlatformConversationCursor | null;
  messageCursor: PlatformConversationCursor | null;
}>;

export type InboxProviderWorkflow = Readonly<{
  proposal: PlatformStaffGeminiProposal | null;
  reviews: readonly PlatformGeminiProposalReview[];
  latestAttempt: PlatformManualWhatsAppSendAttempt | null;
}>;

export type InboxAmoCrmBlockingAttempt = Readonly<{
  attemptId: string;
  operationName: PlatformAmoCrmCommandOperationName;
  status: "prepared" | "unknown";
  providerDispatchedAt: string | null;
}>;

export type InboxAmoCrmCommand =
  | Readonly<{
      status: "available";
      scope: "sales" | "admissions";
      leadId: string;
      studentCaseId: string | null;
      availability: CanonicalAmoCrmCommandAvailability;
      blockingAttempt: InboxAmoCrmBlockingAttempt | null;
    }>
  | Readonly<{
      status: "blocked";
      reason:
        | "canonical_scope_missing"
        | "role_scope_mismatch"
        | "canonical_runtime_unavailable";
    }>;

export type InboxReadModel = Readonly<{
  view: InboxView;
  providerWorkflow: InboxProviderWorkflow | null;
  amoCrmCommand: InboxAmoCrmCommand | null;
}>;

function formatInboxTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error("V3 inbox is unavailable.");
  }
  return BISHKEK_TIME.format(parsed).replace(",", "");
}

function queueSearchParams(
  queueCursor: PlatformConversationCursor | null,
): URLSearchParams {
  const query = new URLSearchParams();
  if (queueCursor) {
    query.set("before_at", queueCursor.sortAt);
    query.set("before_id", queueCursor.id);
  }
  return query;
}

function inboxHref({
  conversationId,
  queueCursor,
  messageCursor,
}: Readonly<{
  conversationId?: string;
  queueCursor?: PlatformConversationCursor | null;
  messageCursor?: PlatformConversationCursor | null;
}> = {}): string {
  const query = queueSearchParams(queueCursor ?? null);
  if (conversationId) query.set("conversation", conversationId);
  if (messageCursor) {
    query.set("messages_before_at", messageCursor.sortAt);
    query.set("messages_before_id", messageCursor.id);
  }
  const serialized = query.toString();
  return serialized ? `/v3/inbox?${serialized}` : "/v3/inbox";
}

function toInboxConversation(
  summary: PlatformConversationSummary,
  queueCursor: PlatformConversationCursor | null,
): InboxConversation {
  return Object.freeze({
    id: summary.id,
    person: summary.subject,
    queue: summary.queue,
    status: summary.status,
    updatedAt: formatInboxTime(summary.sortAt),
    href: inboxHref({ conversationId: summary.id, queueCursor }),
  });
}

function toInboxMessage(message: PlatformConversationMessage): InboxMessage {
  return Object.freeze({
    id: message.id,
    inbound: message.direction === "inbound",
    body: message.bodyText,
    at: formatInboxTime(message.createdAt),
  });
}

function latestInboundMessageId(
  messages: readonly PlatformConversationMessage[],
  messageCursor: PlatformConversationCursor | null,
): string | null {
  // On an older page this is intentionally unavailable. A provider action must
  // always bind to the newest inbound message from the current transcript.
  if (messageCursor !== null) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.direction === "inbound") return message.id;
  }
  return null;
}

/**
 * One bounded canonical Inbox view. The queue and selected transcript retain
 * their independent keyset cursors; transcripts are never preloaded for queue
 * rows. The selected conversation is resolved again through the authenticated
 * conversation reader before its canonical EVO identity is exposed.
 */
export async function readInbox(
  actor: ActivePlatformActor,
  options: InboxReadOptions,
): Promise<InboxReadModel> {
  const presentationQueue =
    actor.presentationRole === "admin" ? undefined : actor.presentationRole;
  const [queue, resolvedThread] = await Promise.all([
    listPlatformConversations(actor, {
      cursor: options.queueCursor,
      pageSize: INBOX_PAGE_SIZE,
      ...(presentationQueue ? { queue: presentationQueue } : {}),
    }),
    options.conversationId
      ? getPlatformConversationThread(actor, options.conversationId, {
          cursor: options.messageCursor,
          pageSize: MESSAGE_PAGE_SIZE,
        })
      : Promise.resolve(null),
  ]);
  const thread =
    resolvedThread &&
    (presentationQueue === undefined ||
      resolvedThread.conversation.queue === presentationQueue)
      ? resolvedThread
      : null;

  let selected: InboxSelectedConversation | null = null;
  let providerWorkflow: InboxProviderWorkflow | null = null;
  let amoCrmCommand: InboxAmoCrmCommand | null = null;
  if (thread) {
    const staffClient = await createSupabaseServerClient();
    const [context, health, proposal, reviews, latestAttempt] = await Promise.all([
      getPlatformConversationCommandContext(actor, thread.conversation.id),
      thread.conversation.wahaSessionName === "crm_primary"
        ? getPlatformWahaSessionHealth(actor, "crm_primary")
        : Promise.resolve(null),
      readStaffGeminiProposal(staffClient, {
        organizationId: actor.organizationId,
        conversationId: thread.conversation.id,
      }),
      listStaffGeminiProposalReviews(staffClient, {
        organizationId: actor.organizationId,
        conversationId: thread.conversation.id,
        limit: 20,
      }),
      readLatestManualWhatsAppSendAttempt(staffClient, {
        organizationId: actor.organizationId,
        conversationId: thread.conversation.id,
      }),
    ]);
    if (context === null || context.conversationId !== thread.conversation.id) {
      throw new Error("V3 inbox is unavailable.");
    }

    selected = Object.freeze({
      ...toInboxConversation(thread.conversation, options.queueCursor),
      messages: Object.freeze(thread.messages.map(toInboxMessage)),
      latestInboundSourceMessageId: latestInboundMessageId(
        thread.messages,
        options.messageCursor,
      ),
      newestMessagesHref: options.messageCursor
        ? inboxHref({
            conversationId: thread.conversation.id,
            queueCursor: options.queueCursor,
          })
        : null,
      olderMessagesHref: thread.nextMessageCursor
        ? inboxHref({
            conversationId: thread.conversation.id,
            queueCursor: options.queueCursor,
            messageCursor: thread.nextMessageCursor,
          })
        : null,
      channelState:
        health === null
          ? "unknown"
          : isFreshWorkingWahaSession(health)
            ? "ready"
            : "attention",
      channelObservedAt: health ? formatInboxTime(health.observedAt) : null,
      canonicalContext: Object.freeze({
        leadId: context.canonicalLeadId,
        clientId: context.canonicalClientId,
        studentCaseId: context.studentCaseId,
      }),
    });
    providerWorkflow = Object.freeze({ proposal, reviews, latestAttempt });
    amoCrmCommand = await readInboxAmoCrmCommand(
      actor,
      thread.conversation.queue,
      context,
      staffClient,
    );
  }

  return Object.freeze({
    view: Object.freeze({
      conversations: Object.freeze(
        queue.rows.map((summary) =>
          toInboxConversation(summary, options.queueCursor),
        ),
      ),
      selected,
      queueCurrentHref: inboxHref({ queueCursor: options.queueCursor }),
      queueNewestHref: options.queueCursor ? "/v3/inbox" : null,
      queueOlderHref: queue.nextCursor
        ? inboxHref({ queueCursor: queue.nextCursor })
        : null,
    }),
    providerWorkflow,
    amoCrmCommand,
  });
}

async function readInboxAmoCrmCommand(
  actor: ActivePlatformActor,
  queue: PlatformConversationSummary["queue"],
  context: Readonly<{
    canonicalLeadId: string | null;
    canonicalClientId: string | null;
    studentCaseId: string | null;
  }>,
  staffClient: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<InboxAmoCrmCommand> {
  const leadId = context.canonicalLeadId;
  const clientId = context.canonicalClientId;
  const studentCaseId = context.studentCaseId;
  if (
    leadId === null ||
    clientId === null ||
    (queue === "sales" && studentCaseId !== null) ||
    (queue === "admissions" && studentCaseId === null)
  ) {
    return Object.freeze({
      status: "blocked" as const,
      reason: "canonical_scope_missing" as const,
    });
  }

  const roleMatches =
    actor.authorityRole === "admin" ||
    (queue === "sales" && actor.authorityRole === "sales") ||
    (queue === "admissions" && actor.authorityRole === "admissions");
  if (!roleMatches) {
    return Object.freeze({
      status: "blocked" as const,
      reason: "role_scope_mismatch" as const,
    });
  }

  const scope = queue === "sales" ? "sales" : "admissions";
  try {
    const [availability, blockingAttempt] = await Promise.all([
      readCanonicalAmoCrmCommandAvailability(),
      readPlatformBlockingAmoCrmCommand(staffClient, {
        organizationId: actor.organizationId,
        authorization: {
          actorRole: actor.authorityRole,
          workflowScope:
            scope === "sales"
              ? "sales_pre_handoff"
              : "admissions_post_handoff",
          workflowLeadId: leadId,
          studentCaseId: scope === "sales" ? null : studentCaseId,
        },
        personId: clientId,
        leadId,
      }),
    ]);
    if (
      blockingAttempt !== null &&
      blockingAttempt.status !== "prepared" &&
      blockingAttempt.status !== "unknown"
    ) {
      throw new PlatformAmoCrmCommandRpcError();
    }
    return Object.freeze({
      status: "available" as const,
      scope,
      leadId,
      studentCaseId: scope === "sales" ? null : studentCaseId,
      availability,
      blockingAttempt:
        blockingAttempt === null
          ? null
          : Object.freeze({
              attemptId: blockingAttempt.attemptId,
              operationName: blockingAttempt.operationName,
              status: blockingAttempt.status as "prepared" | "unknown",
              providerDispatchedAt: blockingAttempt.providerDispatchedAt,
            }),
    });
  } catch (error: unknown) {
    if (error instanceof PlatformAmoCrmCommandRpcError) {
      return Object.freeze({
        status: "blocked" as const,
        reason: "canonical_runtime_unavailable" as const,
      });
    }
    throw error;
  }
}
