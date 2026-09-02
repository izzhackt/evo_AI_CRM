import { notFound } from "next/navigation";

import {
  CanonicalSalesConversationTranscript,
  CanonicalSalesTranscriptUnavailable,
} from "@/components/platform/sales/CanonicalSalesConversations";
import { getT } from "@/lib/i18n";
import {
  getPlatformConversationThread,
  parsePlatformConversationCursor,
  PlatformCommunicationsRepositoryError,
  type PlatformConversationCursor,
} from "@/lib/platform-communications";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  isPlatformLeadConversationLinked,
  parsePlatformSalesUuid,
  PlatformSalesRepositoryError,
} from "@/lib/platform-sales";

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
  const leadId = parsePlatformSalesUuid(id);
  const normalizedConversationId = parsePlatformSalesUuid(conversationId);
  if (leadId === null || normalizedConversationId === null) notFound();
  const messageCursor = parseMessageCursor(query);

  let isLinked = false;
  let thread: Awaited<ReturnType<typeof getPlatformConversationThread>> = null;
  let readUnavailable = false;

  try {
    [isLinked, thread] = await Promise.all([
      isPlatformLeadConversationLinked(
        actor,
        leadId,
        normalizedConversationId,
      ),
      getPlatformConversationThread(actor, normalizedConversationId, {
        cursor: messageCursor,
        pageSize: 50,
      }),
    ]);
  } catch (error: unknown) {
    if (
      error instanceof PlatformSalesRepositoryError ||
      error instanceof PlatformCommunicationsRepositoryError
    ) {
      readUnavailable = true;
    } else {
      throw error;
    }
  }

  if (readUnavailable) {
    return <CanonicalSalesTranscriptUnavailable leadId={leadId} locale={locale} />;
  }
  if (!isLinked || thread === null) {
    notFound();
  }

  return (
    <CanonicalSalesConversationTranscript
      leadId={leadId}
      conversation={thread.conversation}
      messages={thread.messages}
      locale={locale}
      newestMessagesHref={
        messageCursor
          ? transcriptHref(leadId, normalizedConversationId)
          : null
      }
      olderMessagesHref={
        thread.nextMessageCursor
          ? transcriptHref(
              leadId,
              normalizedConversationId,
              thread.nextMessageCursor,
            )
          : null
      }
    />
  );
}

function parseMessageCursor(params: SearchParams): PlatformConversationCursor | null {
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
  if (beforeAt === undefined || beforeId === undefined) notFound();

  const cursor = parsePlatformConversationCursor(beforeAt, beforeId);
  if (cursor === null) notFound();
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
