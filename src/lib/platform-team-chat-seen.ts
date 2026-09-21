import {
  isTeamChatChannel, teamChatUuid,
  type TeamChatChannelKey, type TeamChatFailure,
} from "./platform-team-chat.ts";

export const TEAM_CHAT_SEEN_BATCH_LIMIT = 50;
export type TeamChatSeenBatch = Readonly<{
  channel: TeamChatChannelKey;
  messageIds: readonly string[];
}>;
export type TeamChatSeenReceipt = Readonly<{
  channelKey: TeamChatChannelKey;
  messageIds: readonly string[];
}>;
export type TeamChatSeenResult =
  | Readonly<{ status: "saved"; receipt: TeamChatSeenReceipt }>
  | Readonly<{ status: TeamChatFailure }>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uniqueIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= TEAM_CHAT_SEEN_BATCH_LIMIT
    && Array.from(value).every(teamChatUuid)
    && new Set(value.map((id: string) => id.toLowerCase())).size === value.length;
}
export function teamChatValidSeenBatch(value: unknown): value is TeamChatSeenBatch {
  return record(value) && Object.keys(value).length === 2
    && Object.keys(value).every((key) => key === "channel" || key === "messageIds")
    && isTeamChatChannel(value.channel) && uniqueIds(value.messageIds);
}

/** A partial, duplicated or cross-channel ack must never hide an unread gap. */
export function decodeTeamChatSeenReceipt(value: unknown, batch: TeamChatSeenBatch): TeamChatSeenReceipt | null {
  if (!teamChatValidSeenBatch(batch) || !record(value) || Object.keys(value).length !== 2
    || Object.keys(value).some((key) => key !== "channelKey" && key !== "messageIds")
    || value.channelKey !== batch.channel || !uniqueIds(value.messageIds)
    || value.messageIds.length !== batch.messageIds.length) return null;
  const expected = new Set(batch.messageIds.map((id) => id.toLowerCase()));
  if (value.messageIds.some((id) => !expected.has(id.toLowerCase()))) return null;
  return { channelKey: batch.channel, messageIds: value.messageIds.map((id) => id.toLowerCase()) };
}
