import {
  isTeamChatChannel, teamChatCursor, teamChatUuid,
  type TeamChatMessage, type TeamChatFailure,
} from "./platform-team-chat.ts";

import {
  teamChatTimelineValidQuery, type TeamChatQuote, type TeamChatTimelineQuery,
} from "./platform-team-chat-timeline.ts";

export type TeamChatV2Message = TeamChatMessage & Readonly<{ quoteMessageId: string | null }>;
export type TeamChatTimelineV2Result =
  | Readonly<{ status: "loaded"; page: TeamChatTimelineV2Page }>
  | Readonly<{ status: TeamChatFailure }>;
export type TeamChatTimelineV2Page = Readonly<{
  schemaVersion: 2; messages: readonly TeamChatV2Message[]; quotes: readonly TeamChatQuote[];
  beforeCursor: string; afterCursor: string; hasBefore: boolean; hasAfter: boolean;
  watermark: string; latestMessageId: string | null; focusMessageId: string | null;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const positiveCursor = (value: unknown): value is string => teamChatCursor(value) && value !== "0";
const nullableUuid = (value: unknown): value is string | null => value === null || teamChatUuid(value);
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown) => value === null || timestamp(value);
const uuidKey = (value: string) => value.toLowerCase();
const sameUuid = (left: string | null, right: string | null) => left?.toLowerCase() === right?.toLowerCase();

function message(value: unknown): value is TeamChatV2Message {
  return record(value) && teamChatUuid(value.id) && isTeamChatChannel(value.channelKey)
    && Object.keys(value).every((key) => ["id", "channelKey", "sequence", "authorMembershipId", "authorName",
      "body", "parentMessageId", "quoteMessageId", "mentionedMembershipIds", "version", "createdAt",
      "editedAt", "deletedAt", "replyCount", "linkedTaskIds"].includes(key))
    && positiveCursor(value.sequence) && teamChatUuid(value.authorMembershipId)
    && typeof value.authorName === "string" && typeof value.body === "string"
    && Array.from(value.body).length <= 8000 && nullableUuid(value.parentMessageId)
    && nullableUuid(value.quoteMessageId) && !sameUuid(value.id, value.quoteMessageId)
    && (value.parentMessageId === null) === (value.quoteMessageId === null)
    && !sameUuid(value.id, value.parentMessageId) && positiveCursor(value.version)
    && timestamp(value.createdAt) && nullableTimestamp(value.editedAt) && nullableTimestamp(value.deletedAt)
    && Number.isSafeInteger(value.replyCount) && Number(value.replyCount) >= 0
    && Array.isArray(value.mentionedMembershipIds) && value.mentionedMembershipIds.length <= 20
    && Array.from(value.mentionedMembershipIds).every(teamChatUuid)
    && (value.deletedAt === null ? value.body.length > 0 : value.body === "" && value.mentionedMembershipIds.length === 0)
    && (value.linkedTaskIds === undefined || (Array.isArray(value.linkedTaskIds) && Array.from(value.linkedTaskIds).every(teamChatUuid)));
}
function quote(value: unknown): value is TeamChatQuote {
  return record(value) && Object.keys(value).length === 7 && teamChatUuid(value.id) && positiveCursor(value.sequence)
    && teamChatUuid(value.authorMembershipId) && typeof value.authorName === "string"
    && positiveCursor(value.version) && nullableTimestamp(value.deletedAt)
    && typeof value.bodyPreview === "string" && Array.from(value.bodyPreview).length <= 240
    && (value.deletedAt === null ? value.bodyPreview.length > 0 : value.bodyPreview === "");
}

/** Fail closed on a partial/malformed page instead of silently losing old replies. */
export function decodeTeamChatTimelineV2Page(value: unknown, query: TeamChatTimelineQuery): TeamChatTimelineV2Page | null {
  if (!teamChatTimelineValidQuery(query) || !record(value) || value.schemaVersion !== 2
    || Object.keys(value).length !== 10
    || Object.keys(value).some((key) => !["schemaVersion", "messages", "quotes", "beforeCursor", "afterCursor",
      "hasBefore", "hasAfter", "watermark", "latestMessageId", "focusMessageId"].includes(key))
    || !Array.isArray(value.messages) || value.messages.length > 50 || !Array.from(value.messages).every(message)
    || !Array.isArray(value.quotes) || value.quotes.length > 50 || !Array.from(value.quotes).every(quote)
    || !teamChatCursor(value.beforeCursor) || !teamChatCursor(value.afterCursor) || !teamChatCursor(value.watermark)
    || typeof value.hasBefore !== "boolean" || typeof value.hasAfter !== "boolean"
    || !nullableUuid(value.latestMessageId) || !nullableUuid(value.focusMessageId)) return null;
  const messages: TeamChatV2Message[] = value.messages;
  const quotes: TeamChatQuote[] = value.quotes;
  const byId = new Map<string, TeamChatV2Message>();
  const targets = new Set<string>();
  let previousSequence = BigInt(0);
  for (const row of messages) {
    const sequence = BigInt(row.sequence);
    if (row.channelKey !== query.channel || byId.has(uuidKey(row.id)) || sequence <= previousSequence
      || (query.mode === "before" && sequence >= BigInt(query.cursor))
      || (query.mode === "after" && sequence <= BigInt(query.cursor))) return null;
    byId.set(uuidKey(row.id), row);
    previousSequence = sequence;
    if (row.quoteMessageId) targets.add(uuidKey(row.quoteMessageId));
  }
  if (value.beforeCursor !== (messages[0]?.sequence ?? "0")
    || value.afterCursor !== (messages.at(-1)?.sequence ?? "0")) return null;
  if (!messages.length && (value.hasBefore || value.hasAfter)) return null;
  const last = messages.at(-1);
  if (last && (value.latestMessageId === null || sameUuid(last.id, value.latestMessageId) === value.hasAfter)) return null;
  if (query.mode === "latest" && (value.hasAfter || (!last && value.latestMessageId !== null))) return null;
  if (query.mode === "context") {
    const anchorIndex = messages.findIndex((row) => sameUuid(row.id, query.messageId));
    if (!sameUuid(value.focusMessageId, query.messageId) || anchorIndex < 0 || anchorIndex > 25
      || messages.length - anchorIndex - 1 > 24) return null;
  } else if (value.focusMessageId !== null) return null;

  const seenQuotes = new Set<string>();
  for (const item of quotes) {
    const id = uuidKey(item.id);
    if (!targets.has(id) || seenQuotes.has(id)) return null;
    seenQuotes.add(id);
    const original = byId.get(id);
    if (original && (item.sequence !== original.sequence || item.version !== original.version
      || !sameUuid(item.authorMembershipId, original.authorMembershipId) || item.authorName !== original.authorName
      || item.deletedAt !== original.deletedAt || item.bodyPreview !== Array.from(original.body).slice(0, 240).join(""))) return null;
  }
  if (seenQuotes.size !== targets.size) return null;
  const quotesById = new Map(quotes.map((item) => [uuidKey(item.id), item]));
  for (const row of messages) {
    if (row.quoteMessageId === null) continue;
    const target = quotesById.get(uuidKey(row.quoteMessageId));
    if (!target || BigInt(target.sequence) >= BigInt(row.sequence)) return null;
    const original = byId.get(uuidKey(row.quoteMessageId));
    if (original && !sameUuid(row.parentMessageId, original.parentMessageId ?? original.id)) return null;
    const root = row.parentMessageId && byId.get(uuidKey(row.parentMessageId));
    if (root && root.parentMessageId !== null) return null;
  }
  return value as TeamChatTimelineV2Page;
}
