import type { TeamChatMessage } from "./platform-team-chat.ts";

type RunMessage = Pick<TeamChatMessage, "id" | "parentMessageId" | "replyCount" | "deletedAt">
  & Readonly<{ quoteMessageId?: string | null }>;

/** Строка ленты: сообщение или подряд идущие удалённые, свёрнутые в одну строку. */
export type TeamChatFeedItem<T> =
  | Readonly<{ kind: "message"; message: T; index: number }>
  | Readonly<{ kind: "deleted"; messages: readonly T[]; index: number }>;

const key = (id: string) => id.toLowerCase();

/**
 * Presentation only (Э8.9, 28.09.2026): use the visible range, as
 * `teamChatMessageContinuations` does. Consecutive deleted messages collapse
 * into one quiet line; the rows stay in the database and each collapsed
 * message keeps its own anchor in that line (permalink, task source,
 * first unread, highlight). A deleted message keeps its own tombstone while
 * a live reply may depend on it: a live row in the range names it as root
 * or direct quote, or its `replyCount` (which counts deleted replies too)
 * exceeds the deleted replies visible here — an unseen reply may be live.
 * Supersedes A15 «каждая удалённая строка видна» by the owner's «удали их».
 */
export function teamChatFeedItems<T extends RunMessage>(rows: readonly T[]): TeamChatFeedItem<T>[] {
  const liveTargets = new Set<string>();
  const deletedReplies = new Map<string, number>();
  for (const row of rows) {
    const targets = [row.parentMessageId, row.quoteMessageId ?? null].filter((id): id is string => id !== null);
    if (row.deletedAt === null) targets.forEach((id) => liveTargets.add(key(id)));
    else if (row.parentMessageId !== null) {
      deletedReplies.set(key(row.parentMessageId), (deletedReplies.get(key(row.parentMessageId)) ?? 0) + 1);
    }
  }
  const keepsTombstone = (row: T) => liveTargets.has(key(row.id))
    || !Number.isSafeInteger(row.replyCount) || row.replyCount > (deletedReplies.get(key(row.id)) ?? 0);

  const items: TeamChatFeedItem<T>[] = [];
  let run: T[] | null = null;
  for (const [index, row] of rows.entries()) {
    if (row.deletedAt !== null && !keepsTombstone(row)) {
      if (run) run.push(row);
      else { run = [row]; items.push({ kind: "deleted", messages: run, index }); }
      continue;
    }
    run = null;
    items.push({ kind: "message", message: row, index });
  }
  return items;
}

/** «Сообщение удалено» для одного, «Удалено сообщений: N» — без склонения по числу. */
export function teamChatDeletedRunLabel(count: number): string {
  return count === 1 ? "Сообщение удалено" : `Удалено сообщений: ${count}`;
}
