import "server-only";

import type { InboxThread } from "@/components/v3/Inbox";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  getPlatformConversationThread,
  listPlatformConversations,
  type PlatformConversationSummary,
  type PlatformConversationThread,
} from "@/lib/platform-communications";

const INBOX_PAGE_SIZE = 20;
const MESSAGE_PAGE_SIZE = 100;
const THREAD_READ_CONCURRENCY = 5;

const BISHKEK_TIME = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Bishkek",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatInboxTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error("V3 inbox is unavailable.");
  }
  return BISHKEK_TIME.format(parsed).replace(",", "");
}

function toInboxThread(
  summary: PlatformConversationSummary,
  thread: PlatformConversationThread,
): InboxThread {
  if (thread.conversation.id !== summary.id) {
    throw new Error("V3 inbox is unavailable.");
  }

  return {
    id: summary.id,
    person: summary.subject,
    channel: "WhatsApp",
    status: summary.status,
    role: summary.queue,
    stage: null,
    // The canonical communication projection does not expose an EVO lead id.
    // An amoCRM id is external provider metadata and must not be used as one.
    leadHref: null,
    messages: thread.messages.map((message) => ({
      id: message.id,
      inbound: message.direction === "inbound",
      body: message.bodyText,
      at: formatInboxTime(message.createdAt),
    })),
  };
}

/**
 * Диалоги и переписка.
 *
 * The current Platform contract exposes a paged queue and a paged transcript,
 * rather than a bulk transcript RPC. Keep that bounded here: at most twenty
 * queue rows, at most one hundred latest messages per row, and five concurrent
 * transcript reads. No direct table read or legacy fallback is used.
 */
export async function readInbox(
  actor: ActivePlatformActor,
): Promise<readonly InboxThread[]> {
  const page = await listPlatformConversations(actor, {
    pageSize: INBOX_PAGE_SIZE,
  });
  const result: InboxThread[] = [];

  for (let start = 0; start < page.rows.length; start += THREAD_READ_CONCURRENCY) {
    const batch = page.rows.slice(start, start + THREAD_READ_CONCURRENCY);
    const batchThreads = await Promise.all(
      batch.map(async (summary) => {
        const thread = await getPlatformConversationThread(actor, summary.id, {
          pageSize: MESSAGE_PAGE_SIZE,
        });
        // A summary disappearing from the same authenticated read boundary is
        // not an empty transcript. Stop instead of showing inconsistent data.
        if (thread === null) throw new Error("V3 inbox is unavailable.");
        return toInboxThread(summary, thread);
      }),
    );
    result.push(...batchThreads);
  }

  return result;
}
