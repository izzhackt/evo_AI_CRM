import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { CanonicalStaffWhatsAppWorkspace } from "@/components/platform/communications/CanonicalStaffWhatsApp";
import { getT } from "@/lib/i18n";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";
import { readCanonicalGeminiProposalAvailability } from "@/lib/server/canonical-gemini-proposal-config";
import { readCanonicalWahaProviderAvailability } from "@/lib/server/canonical-waha-provider";
import {
  CanonicalCrmRepositoryError,
  getCanonicalStaffConversationThread,
  listCanonicalStaffConversations,
  parseCanonicalMessageCursor,
  parseCanonicalReadCursor,
  readLatestCanonicalGeminiProposal,
  readLatestCanonicalWhatsAppSendAttempt,
  type CanonicalMessageCursor,
  type CanonicalReadCursor,
} from "@/lib/server/canonical-crm-repository";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  messages_before_at?: string | string[];
  messages_before_id?: string | string[];
}>;

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
  const queueCursor = parseQueueCursor(query);
  const messageCursor = parseMessageCursor(query);

  let queue;
  let thread;
  let geminiProposal;
  let latestSendAttempt;
  try {
    [queue, thread, geminiProposal, latestSendAttempt] = await Promise.all([
      listCanonicalStaffConversations({
        actorRole: actor.platformRole,
        cursor: queueCursor ?? undefined,
        pageSize: 50,
      }),
      getCanonicalStaffConversationThread({
        actorRole: actor.platformRole,
        conversationId: id,
        cursor: messageCursor ?? undefined,
        pageSize: 50,
      }),
      readLatestCanonicalGeminiProposal({
        actorRole: actor.platformRole,
        conversationId: id,
      }),
      readLatestCanonicalWhatsAppSendAttempt({
        actorRole: actor.platformRole,
        conversationId: id,
      }),
    ]);
  } catch (error: unknown) {
    if (error instanceof CanonicalCrmRepositoryError) {
      if (error.code === "invalid_input" || error.code === "not_found") {
        notFound();
      }
    }
    throw error;
  }

  return (
    <CanonicalStaffWhatsAppWorkspace
      locale={locale}
      actorRole={actor.platformRole}
      conversations={queue.rows}
      queueCursor={queueCursor}
      queueResetHref={queueCursor ? "/whatsapp" : null}
      queueNextHref={queue.nextCursor ? queueHref(queue.nextCursor) : null}
      selectedConversationId={id}
      thread={{
        conversation: thread.conversation,
        messages: thread.messages,
        geminiAvailability: readCanonicalGeminiProposalAvailability(),
        geminiProposal,
        geminiReviewRequestId:
          geminiProposal?.reviewDecision === "pending" ? randomUUID() : null,
        wahaAvailability: readCanonicalWahaProviderAvailability(),
        latestSendAttempt,
        sendRequestId: randomUUID(),
        reconcileRequestId: randomUUID(),
        newestMessagesHref: messageCursor ? threadHref(id, queueCursor) : null,
        olderMessagesHref: thread.nextCursor
          ? threadHref(id, queueCursor, thread.nextCursor)
          : null,
      }}
    />
  );
}

function parseQueueCursor(params: SearchParams): CanonicalReadCursor | null {
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
  if (beforeAt === undefined && beforeId === undefined) return null;
  try {
    return parseCanonicalReadCursor(beforeAt, beforeId);
  } catch (error: unknown) {
    if (
      error instanceof CanonicalCrmRepositoryError &&
      error.code === "invalid_input"
    ) {
      notFound();
    }
    throw error;
  }
}

function parseMessageCursor(params: SearchParams): CanonicalMessageCursor | null {
  const beforeAt = singleValue(params.messages_before_at);
  const beforeId = singleValue(params.messages_before_id);
  if (beforeAt === undefined && beforeId === undefined) return null;
  try {
    return parseCanonicalMessageCursor(beforeAt, beforeId);
  } catch (error: unknown) {
    if (
      error instanceof CanonicalCrmRepositoryError &&
      error.code === "invalid_input"
    ) {
      notFound();
    }
    throw error;
  }
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

function queueHref(cursor: CanonicalReadCursor) {
  const query = new URLSearchParams({
    before_at: cursor.updatedAt,
    before_id: cursor.id,
  });
  return `/whatsapp?${query.toString()}`;
}

function threadHref(
  conversationId: string,
  queueCursor: CanonicalReadCursor | null,
  messageCursor?: CanonicalMessageCursor,
) {
  const query = new URLSearchParams();
  if (queueCursor) {
    query.set("before_at", queueCursor.updatedAt);
    query.set("before_id", queueCursor.id);
  }
  if (messageCursor) {
    query.set("messages_before_at", messageCursor.occurredAt);
    query.set("messages_before_id", messageCursor.id);
  }
  const serialized = query.toString();
  return `/whatsapp/${conversationId}${serialized ? `?${serialized}` : ""}`;
}
