import type { TeamChatMessage, TeamChatSnapshot } from "./platform-team-chat.ts";
import type { TeamChatQuote } from "./platform-team-chat-timeline.ts";
import type { TeamChatTimelineV2Page, TeamChatV2Message } from "./platform-team-chat-timeline-v2.ts";

export type TeamChatFeedSnapshot = Omit<TeamChatSnapshot, "page"> & { page: TeamChatTimelineV2Page };

/** Cached identities and the currently displayed continuous range are separate. */
export type TeamChatFeedStore = Readonly<{
  messages: Readonly<Record<string, TeamChatV2Message>>;
  quotes: Readonly<Record<string, TeamChatQuote>>;
  pendingChanges: Readonly<Record<string, TeamChatMessage>>;
}>;
export type TeamChatFeedRange = Readonly<{
  ids: readonly string[];
  beforeCursor: string; afterCursor: string; hasBefore: boolean; hasAfter: boolean;
}>;
export type TeamChatScrollAnchor = Readonly<{ messageId: string; offset: number }>;

const key = (id: string) => id.toLowerCase();
const atLeast = (version: string, previous?: { version: string }) =>
  !previous || BigInt(version) >= BigInt(previous.version);

export function teamChatQuoteFromMessage(message: TeamChatMessage): TeamChatQuote {
  return {
    id: message.id, sequence: message.sequence, authorMembershipId: message.authorMembershipId,
    authorName: message.authorName, version: message.version, deletedAt: message.deletedAt,
    bodyPreview: message.deletedAt ? "" : Array.from(message.body).slice(0, 240).join(""),
  };
}

export function emptyTeamChatFeed(): TeamChatFeedStore {
  return { messages: {}, quotes: {}, pendingChanges: {} };
}

/** Only a validated V2 page can introduce a message's direct quote identity. */
export function mergeTeamChatFeedPage(store: TeamChatFeedStore, page: TeamChatTimelineV2Page): TeamChatFeedStore {
  const messages = { ...store.messages };
  const quotes = { ...store.quotes };
  const pendingChanges = { ...store.pendingChanges };
  for (const row of page.messages) {
    const id = key(row.id);
    const pending = pendingChanges[id];
    const current = pending && atLeast(pending.version, row)
      ? { ...pending, quoteMessageId: row.quoteMessageId } : row;
    if (atLeast(current.version, messages[id])) messages[id] = current;
    delete pendingChanges[id];
  }
  for (const quote of page.quotes) {
    const id = key(quote.id);
    if (atLeast(quote.version, quotes[id])) quotes[id] = quote;
  }
  // A newer cached original wins over a delayed page's quote projection.
  for (const original of Object.values(messages)) {
    const id = key(original.id);
    if (atLeast(original.version, quotes[id])) quotes[id] = teamChatQuoteFromMessage(original);
  }
  return { messages, quotes, pendingChanges };
}

/** V1 changes update known base fields, but cannot manufacture a V2 reply. */
export function mergeTeamChatFeedChanges(store: TeamChatFeedStore, changes: readonly TeamChatMessage[]): {
  store: TeamChatFeedStore; unknownIds: readonly string[];
} {
  const messages = { ...store.messages };
  const quotes = { ...store.quotes };
  const pendingChanges = { ...store.pendingChanges };
  const unknownIds: string[] = [];
  for (const row of changes) {
    const id = key(row.id);
    const previous = messages[id];
    if (!previous) {
      unknownIds.push(row.id);
      if (atLeast(row.version, pendingChanges[id])) pendingChanges[id] = row;
    }
    else if (atLeast(row.version, previous)) messages[id] = { ...row, quoteMessageId: previous.quoteMessageId };
    // Also refresh a quoted original which is not in the displayed/cached range.
    if (atLeast(row.version, quotes[id])) quotes[id] = teamChatQuoteFromMessage(row);
  }
  return { store: { messages, quotes, pendingChanges }, unknownIds };
}

export function teamChatFeedMessage(store: TeamChatFeedStore, id: string): TeamChatV2Message | null {
  return store.messages[key(id)] ?? null;
}

export function teamChatFeedQuote(store: TeamChatFeedStore, id: string): TeamChatQuote | null {
  return store.quotes[key(id)] ?? null;
}

export function teamChatFeedRange(page: TeamChatTimelineV2Page): TeamChatFeedRange {
  return {
    ids: page.messages.map((row) => row.id), beforeCursor: page.beforeCursor,
    afterCursor: page.afterCursor, hasBefore: page.hasBefore, hasAfter: page.hasAfter,
  };
}

/** Extend one boundary only. A context/latest replacement uses a new range. */
export function extendTeamChatFeedRange(
  range: TeamChatFeedRange, page: TeamChatTimelineV2Page,
  direction: "before" | "after", requestedCursor: string,
): TeamChatFeedRange {
  if (range[direction === "before" ? "beforeCursor" : "afterCursor"] !== requestedCursor) return range;
  const added = page.messages.map((row) => row.id);
  const candidates = direction === "before" ? [...added, ...range.ids] : [...range.ids, ...added];
  const seen = new Set<string>();
  const ids = candidates.filter((id) => {
    if (seen.has(key(id))) return false;
    seen.add(key(id));
    return true;
  });
  return direction === "before"
    ? { ...range, ids, beforeCursor: page.beforeCursor === "0" ? range.beforeCursor : page.beforeCursor, hasBefore: page.hasBefore }
    : { ...range, ids, afterCursor: page.afterCursor === "0" ? range.afterCursor : page.afterCursor, hasAfter: page.hasAfter };
}

export function teamChatFeedRows(store: TeamChatFeedStore, range: TeamChatFeedRange): readonly TeamChatV2Message[] {
  return range.ids.flatMap((id) => {
    const row = teamChatFeedMessage(store, id);
    return row ? [row] : [];
  });
}

export function mergeTeamChatSearchChanges(
  rows: readonly TeamChatMessage[], changes: readonly TeamChatMessage[],
): readonly TeamChatMessage[] {
  const updated = new Map(changes.map((row) => [key(row.id), row]));
  return rows.map((row) => {
    const next = updated.get(key(row.id));
    return next && atLeast(next.version, row) ? next : row;
  }).filter((row) => row.deletedAt === null);
}

export const TEAM_CHAT_SEEN_DWELL_MS = 500;
export const TEAM_CHAT_SEEN_BATCH_LIMIT = 50;

export function teamChatBodyVisible(bodyHeight: number, visibleHeight: number): boolean {
  return Number.isFinite(bodyHeight) && bodyHeight > 0 && Number.isFinite(visibleHeight)
    && visibleHeight >= Math.min(bodyHeight * 0.5, 160);
}
