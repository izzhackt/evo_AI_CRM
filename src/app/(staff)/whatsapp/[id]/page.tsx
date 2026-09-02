import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PlatformProviderWorkflowControls } from "@/components/platform/communications/PlatformProviderWorkflowControls";
import { PlatformStaffWhatsAppWorkspace } from "@/components/platform/communications/PlatformStaffWhatsApp";
import { buildRouteMetadata } from "@/lib/route-metadata";
import { getT } from "@/lib/i18n";
import {
  getPlatformConversationThread,
  getPlatformWahaSessionHealth,
  listPlatformConversations,
  parsePlatformConversationCursor,
  parsePlatformRouteUuid,
  type PlatformConversationCursor,
} from "@/lib/platform-communications";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";
import {
  reconcilePlatformWhatsAppSendAction,
  requestPlatformGeminiProposalAction,
  reviewPlatformGeminiProposalAction,
  sendPlatformWhatsAppMessageAction,
} from "@/lib/platform-provider-actions";
import {
  listStaffGeminiProposalReviews,
  readLatestManualWhatsAppSendAttempt,
  readStaffGeminiProposal,
} from "@/lib/platform-provider-workflows";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  messages_before_at?: string | string[];
  messages_before_id?: string | string[];
}>;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: "WhatsApp · Диалог",
    ky: "WhatsApp · Диалог",
    en: "WhatsApp · Conversation",
  });
}

export default async function WhatsAppConversationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}>) {
  const [{ id }, query, { locale }, actor] = await Promise.all([
    params,
    searchParams,
    getT(),
    requirePlatformMessagingActor(),
  ]);
  assertExpectedQueryKeys(query, [
    "before_at",
    "before_id",
    "messages_before_at",
    "messages_before_id",
  ]);
  const conversationId = parsePlatformRouteUuid(id);
  if (conversationId === null) notFound();
  const queueCursor = parseQueueCursor(query);
  const messageCursor = parseMessageCursor(query);

  const [queue, thread] = await Promise.all([
    listPlatformConversations(actor, {
      cursor: queueCursor,
      pageSize: 50,
    }),
    getPlatformConversationThread(actor, conversationId, {
      cursor: messageCursor,
      pageSize: 50,
    }),
  ]);
  if (thread === null) notFound();

  const staffClient = await createSupabaseServerClient();
  const [wahaSessionHealth, proposal, reviews, latestAttempt] = await Promise.all([
    thread.conversation.wahaSessionName === "crm_primary"
      ? getPlatformWahaSessionHealth(actor, "crm_primary")
      : null,
    readStaffGeminiProposal(staffClient, {
      organizationId: actor.organizationId,
      conversationId,
    }),
    listStaffGeminiProposalReviews(staffClient, {
      organizationId: actor.organizationId,
      conversationId,
      limit: 20,
    }),
    readLatestManualWhatsAppSendAttempt(staffClient, {
      organizationId: actor.organizationId,
      conversationId,
    }),
  ]);
  const latestInboundSourceMessageId = latestInboundMessageId(
    thread.messages,
    messageCursor,
  );

  return (
    <PlatformStaffWhatsAppWorkspace
      locale={locale}
      actorRole={actor.presentationRole}
      conversations={queue.rows}
      queueCursor={queueCursor}
      queueResetHref={queueCursor ? "/whatsapp" : null}
      queueNextHref={queue.nextCursor ? queueHref(queue.nextCursor) : null}
      selectedConversationId={conversationId}
      workflowControls={
        <PlatformProviderWorkflowControls
          key={`${proposal?.proposalRequestId ?? "no-proposal"}:${
            reviews.find((review) => review.proposalRequestId === proposal?.proposalRequestId)
              ?.reviewId ?? "unreviewed"
          }`}
          locale={locale}
          conversationId={conversationId}
          latestInboundSourceMessageId={latestInboundSourceMessageId}
          proposal={proposal}
          reviews={reviews}
          latestAttempt={latestAttempt}
          requestIds={{
            gemini: randomUUID(),
            review: randomUUID(),
            send: randomUUID(),
            reconcile: randomUUID(),
          }}
          requestGemini={requestPlatformGeminiProposalAction}
          reviewGemini={reviewPlatformGeminiProposalAction}
          sendWhatsApp={sendPlatformWhatsAppMessageAction}
          reconcileWhatsApp={reconcilePlatformWhatsAppSendAction}
        />
      }
      thread={{
        conversation: thread.conversation,
        messages: thread.messages,
        wahaSessionHealth,
        newestMessagesHref: messageCursor
          ? threadHref(conversationId, queueCursor)
          : null,
        olderMessagesHref: thread.nextMessageCursor
          ? threadHref(conversationId, queueCursor, thread.nextMessageCursor)
          : null,
      }}
    />
  );
}

function latestInboundMessageId(
  messages: readonly Readonly<{ id: string; direction: string }>[],
  messageCursor: PlatformConversationCursor | null,
): string | null {
  if (messageCursor === null) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.direction === "inbound") return messages[index]?.id ?? null;
    }
  }
  return null;
}

function parseQueueCursor(params: SearchParams): PlatformConversationCursor | null {
  return parseCursor(params.before_at, params.before_id);
}

function parseMessageCursor(
  params: SearchParams,
): PlatformConversationCursor | null {
  return parseCursor(params.messages_before_at, params.messages_before_id);
}

function parseCursor(
  rawSortAt: string | string[] | undefined,
  rawId: string | string[] | undefined,
): PlatformConversationCursor | null {
  const sortAt = singleValue(rawSortAt);
  const id = singleValue(rawId);
  if (sortAt === undefined && id === undefined) return null;
  if (sortAt === undefined || id === undefined) notFound();

  const cursor = parsePlatformConversationCursor(sortAt, id);
  if (cursor === null) notFound();
  return cursor;
}

function singleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) notFound();
  return value;
}

function assertExpectedQueryKeys(
  params: SearchParams,
  allowedKeys: readonly string[],
) {
  if (Object.keys(params).some((key) => !allowedKeys.includes(key))) {
    notFound();
  }
}

function queueHref(cursor: PlatformConversationCursor) {
  const query = new URLSearchParams({
    before_at: cursor.sortAt,
    before_id: cursor.id,
  });
  return `/whatsapp?${query.toString()}`;
}

function threadHref(
  conversationId: string,
  queueCursor: PlatformConversationCursor | null,
  messageCursor?: PlatformConversationCursor,
) {
  const query = new URLSearchParams();
  if (queueCursor) {
    query.set("before_at", queueCursor.sortAt);
    query.set("before_id", queueCursor.id);
  }
  if (messageCursor) {
    query.set("messages_before_at", messageCursor.sortAt);
    query.set("messages_before_id", messageCursor.id);
  }
  const serialized = query.toString();
  return `/whatsapp/${conversationId}${serialized ? `?${serialized}` : ""}`;
}
