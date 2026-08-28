import { notFound } from "next/navigation";

import {
  PlatformSalesReadOnlyTranscript,
  PlatformSalesTranscriptUnavailable,
} from "@/components/platform/communications/PlatformSalesReadOnlyTranscript";
import { getT } from "@/lib/i18n";
import {
  PlatformCommunicationsRepositoryError,
  getPlatformConversationThread,
  parsePlatformConversationCursor,
  parsePlatformRouteUuid,
  type PlatformConversationCursor,
} from "@/lib/platform-communications";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  PlatformSalesIntakeRepositoryError,
  isPlatformLeadConversationLinked,
} from "@/lib/platform-sales-intake";

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
  const leadId = parsePlatformRouteUuid(id);
  const normalizedConversationId = parsePlatformRouteUuid(conversationId);
  if (!leadId || !normalizedConversationId) notFound();

  const messageCursor = parseMessageCursor(query);

  const linkResult = await isPlatformLeadConversationLinked(
    actor,
    leadId,
    normalizedConversationId,
  )
    .then((linked) => ({ linked, unavailable: false as const }))
    .catch((error: unknown) => {
      if (error instanceof PlatformSalesIntakeRepositoryError) {
        return { linked: false, unavailable: true as const };
      }
      throw error;
    });

  if (linkResult.unavailable) {
    return <PlatformSalesTranscriptUnavailable leadId={leadId} locale={locale} />;
  }
  if (!linkResult.linked) notFound();

  const threadResult = await getPlatformConversationThread(
    actor,
    normalizedConversationId,
    {
      cursor: messageCursor,
      pageSize: 50,
    },
  )
    .then((thread) => ({ thread, unavailable: false as const }))
    .catch((error: unknown) => {
      if (error instanceof PlatformCommunicationsRepositoryError) {
        return { thread: null, unavailable: true as const };
      }
      throw error;
    });

  if (threadResult.unavailable) {
    return <PlatformSalesTranscriptUnavailable leadId={leadId} locale={locale} />;
  }
  if (!threadResult.thread) notFound();

  return (
    <PlatformSalesReadOnlyTranscript
      leadId={leadId}
      conversation={threadResult.thread.conversation}
      messages={threadResult.thread.messages}
      locale={locale}
      newestMessagesHref={
        messageCursor ? transcriptHref(leadId, normalizedConversationId) : null
      }
      olderMessagesHref={
        threadResult.thread.nextMessageCursor
          ? transcriptHref(
              leadId,
              normalizedConversationId,
              threadResult.thread.nextMessageCursor,
            )
          : null
      }
    />
  );
}

function parseMessageCursor(params: SearchParams): PlatformConversationCursor | null {
  if (Object.keys(params).some((key) => key !== "before_at" && key !== "before_id")) {
    notFound();
  }
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
  if (beforeAt === undefined && beforeId === undefined) return null;
  const cursor = parsePlatformConversationCursor(beforeAt, beforeId);
  if (!cursor) notFound();
  return cursor;
}

function singleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) notFound();
  return value;
}

function transcriptHref(
  leadId: string,
  conversationId: string,
  cursor?: PlatformConversationCursor,
) {
  const path = `/sales/${leadId}/conversations/${conversationId}`;
  if (!cursor) return path;
  const query = new URLSearchParams({
    before_at: cursor.sortAt,
    before_id: cursor.id,
  });
  return `${path}?${query.toString()}`;
}
