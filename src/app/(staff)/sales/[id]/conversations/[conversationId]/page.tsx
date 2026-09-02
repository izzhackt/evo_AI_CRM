import { notFound } from "next/navigation";

import {
  CanonicalSalesConversationTranscript,
  CanonicalSalesTranscriptUnavailable,
} from "@/components/platform/sales/CanonicalSalesConversations";
import { getT } from "@/lib/i18n";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  CanonicalCrmRepositoryError,
  getCanonicalLeadConversationThread,
  parseCanonicalMessageCursor,
  type CanonicalMessageCursor,
} from "@/lib/server/canonical-crm-repository";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
}>;

export default async function SalesConversationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string; conversationId: string }>;
  searchParams: Promise<SearchParams>;
}>) {
  const [{ id, conversationId }, query, { locale }, actor] = await Promise.all([
    params,
    searchParams,
    getT(),
    requirePlatformSalesActor(),
  ]);
  const messageCursor = parseMessageCursor(query);

  let thread: Awaited<ReturnType<typeof getCanonicalLeadConversationThread>>;
  try {
    thread = await getCanonicalLeadConversationThread({
      actorRole: actor.authorityRole,
      leadId: id,
      conversationId,
      cursor: messageCursor,
      pageSize: 50,
    });
  } catch (error: unknown) {
    if (error instanceof CanonicalCrmRepositoryError) {
      if (error.code === "invalid_input" || error.code === "not_found") {
        notFound();
      }
      if (error.code === "unavailable") {
        return <CanonicalSalesTranscriptUnavailable leadId={id} locale={locale} />;
      }
    }
    throw error;
  }

  return (
    <CanonicalSalesConversationTranscript
      leadId={id}
      conversation={thread.conversation}
      messages={thread.messages}
      locale={locale}
      newestMessagesHref={
        messageCursor ? transcriptHref(id, conversationId) : null
      }
      olderMessagesHref={
        thread.nextCursor
          ? transcriptHref(id, conversationId, thread.nextCursor)
          : null
      }
    />
  );
}

function parseMessageCursor(params: SearchParams): CanonicalMessageCursor | null {
  if (
    Object.keys(params).some(
      (key) => key !== "before_at" && key !== "before_id",
    )
  ) {
    notFound();
  }
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
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

function transcriptHref(
  leadId: string,
  conversationId: string,
  cursor?: CanonicalMessageCursor,
) {
  const path = `/sales/${leadId}/conversations/${conversationId}`;
  if (!cursor) return path;
  const query = new URLSearchParams({
    before_at: cursor.occurredAt,
    before_id: cursor.id,
  });
  return `${path}?${query.toString()}`;
}
