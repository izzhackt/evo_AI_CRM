import {
  TEAM_CHAT_CHANNELS, isTeamChatChannel, teamChatCursor, teamChatUuid,
  type TeamChatChannel, type TeamChatChannelPreview,
} from "./platform-team-chat.ts";

export const TEAM_CHAT_CHANNEL_PREVIEW_LIMIT = 240;
const previewFields = ["id", "sequence", "version", "authorMembershipId", "authorName", "bodyPreview", "deletedAt"] as const;
const channelFields = ["key", "muted", "preferenceVersion", "readSequence", "unreadCount", "firstUnreadId", "latestPreview"] as const;
const positiveCursor = (value: unknown): value is string => teamChatCursor(value) && value !== "0";
const nullableUuid = (value: unknown): value is string | null => value === null || teamChatUuid(value);
const nullableTimestamp = (value: unknown): value is string | null => value === null
  || (typeof value === "string" && Number.isFinite(Date.parse(value)));
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function preview(value: unknown): value is TeamChatChannelPreview {
  return record(value) && Object.keys(value).length === previewFields.length
    && previewFields.every((key) => Object.hasOwn(value, key))
    && teamChatUuid(value.id) && positiveCursor(value.sequence) && positiveCursor(value.version)
    && teamChatUuid(value.authorMembershipId) && typeof value.authorName === "string"
    && typeof value.bodyPreview === "string" && Array.from(value.bodyPreview).length <= TEAM_CHAT_CHANNEL_PREVIEW_LIMIT
    && nullableTimestamp(value.deletedAt)
    && (value.deletedAt === null ? value.bodyPreview.length > 0 : value.bodyPreview === "");
}

/** Missing metadata is a failed read, never evidence of an empty channel. */
export function decodeTeamChatChannels(value: unknown): readonly TeamChatChannel[] | null {
  if (!Array.isArray(value) || value.length > TEAM_CHAT_CHANNELS.length) return null;
  const channels: TeamChatChannel[] = [];
  const keys = new Set<string>();
  const messageIds = new Set<string>();
  const sequences = new Set<string>();
  for (const row of value) {
    if (!record(row) || !channelFields.every((key) => Object.hasOwn(row, key))
      || !isTeamChatChannel(row.key) || keys.has(row.key) || typeof row.muted !== "boolean"
      || !teamChatCursor(row.preferenceVersion) || !teamChatCursor(row.readSequence)
      || !Number.isSafeInteger(row.unreadCount) || Number(row.unreadCount) < 0 || !nullableUuid(row.firstUnreadId)
      || (row.latestPreview !== null && !preview(row.latestPreview))) return null;
    if (row.latestPreview) {
      const id = row.latestPreview.id.toLowerCase();
      if (messageIds.has(id) || sequences.has(row.latestPreview.sequence)) return null;
      messageIds.add(id); sequences.add(row.latestPreview.sequence);
    }
    keys.add(row.key);
    channels.push({
      key: row.key, muted: row.muted, preferenceVersion: row.preferenceVersion,
      readSequence: row.readSequence, unreadCount: Number(row.unreadCount), firstUnreadId: row.firstUnreadId,
      latestPreview: row.latestPreview === null ? null : { ...row.latestPreview },
    });
  }
  return channels;
}

export type TeamChatChannelsState = Readonly<{
  requestId: number;
  channels: readonly TeamChatChannel[];
}>;

/**
 * Call after DTO decoding, before committing channels or advancing a watermark.
 * Search and refresh must allocate tickets from the same component-local counter.
 * Terminal revocation/unmount is enforced by the caller, outside this pure merge.
 */
export function acceptTeamChatChannels(
  previous: TeamChatChannelsState, incoming: readonly TeamChatChannel[], requestId: number,
): TeamChatChannelsState | null {
  if (!Number.isSafeInteger(requestId) || requestId < 1
    || !Number.isSafeInteger(previous.requestId) || previous.requestId < 0) return null;
  if (requestId <= previous.requestId) return previous;
  const channels: TeamChatChannel[] = [];
  for (const channel of incoming) {
    const before = previous.channels.find((item) => item.key === channel.key)?.latestPreview;
    let latestPreview = channel.latestPreview;
    if (before && latestPreview) {
      const sameId = before.id.toLowerCase() === latestPreview.id.toLowerCase();
      const sameSequence = before.sequence === latestPreview.sequence;
      if (sameId !== sameSequence) return null;
      if (BigInt(before.sequence) > BigInt(latestPreview.sequence)
        || (sameId && BigInt(before.version) > BigInt(latestPreview.version))) latestPreview = before;
    } else if (before && latestPreview === null) {
      // Current product deletion preserves the latest row as a tombstone.
      latestPreview = before;
    }
    channels.push({ ...channel, latestPreview: latestPreview ? { ...latestPreview } : null });
  }
  // The incoming authorized list controls membership; never append cached channels.
  return { requestId, channels };
}
