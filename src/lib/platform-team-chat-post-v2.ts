import {
  isTeamChatChannel, teamChatCursor, teamChatUuid, TEAM_CHAT_BODY_LIMIT,
  type TeamChatChannelKey, type TeamChatFailure,
} from "./platform-team-chat.ts";

export type TeamChatPostV2Input = Readonly<{
  body: string; quoteMessageId: string | null; mentionedMembershipIds: readonly string[];
}>;
export type TeamChatPostV2Request = Readonly<{
  channel: TeamChatChannelKey; requestId: string; input: TeamChatPostV2Input;
}>;
export type TeamChatPostV2Receipt = Readonly<{
  schemaVersion: 2; requestId: string; channelKey: TeamChatChannelKey; operation: "post";
  messageId: string; version: string; quoteMessageId: string | null; rootParentMessageId: string | null;
}>;
export type TeamChatPostV2Result =
  | Readonly<{ status: "saved"; receipt: TeamChatPostV2Receipt }>
  | Readonly<{ status: TeamChatFailure }>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
const nullableUuid = (value: unknown): value is string | null => value === null || teamChatUuid(value);
const sameUuid = (left: string | null, right: string | null) => left?.toLowerCase() === right?.toLowerCase();

export function teamChatValidPostV2Input(value: unknown): value is TeamChatPostV2Input {
  return record(value) && exactKeys(value, ["body", "quoteMessageId", "mentionedMembershipIds"])
    && typeof value.body === "string" && Array.from(value.body.trim()).length >= 1
    && Array.from(value.body).length <= TEAM_CHAT_BODY_LIMIT
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value.body)
    && nullableUuid(value.quoteMessageId) && Array.isArray(value.mentionedMembershipIds)
    && value.mentionedMembershipIds.length <= 20 && Array.from(value.mentionedMembershipIds).every(teamChatUuid);
}
export function teamChatValidPostV2Request(value: unknown): value is TeamChatPostV2Request {
  return record(value) && exactKeys(value, ["channel", "requestId", "input"])
    && isTeamChatChannel(value.channel) && teamChatUuid(value.requestId) && teamChatValidPostV2Input(value.input);
}

/** Only the exact frozen request can acknowledge success. No V1 fallback. */
export function decodeTeamChatPostV2Receipt(value: unknown, request: TeamChatPostV2Request): TeamChatPostV2Receipt | null {
  if (!teamChatValidPostV2Request(request) || !record(value)
    || !exactKeys(value, ["schemaVersion", "requestId", "channelKey", "operation", "messageId", "version", "quoteMessageId", "rootParentMessageId"])
    || value.schemaVersion !== 2 || value.operation !== "post" || value.channelKey !== request.channel
    || !teamChatUuid(value.requestId) || !sameUuid(value.requestId, request.requestId)
    || !teamChatUuid(value.messageId) || !teamChatCursor(value.version) || value.version === "0"
    || !nullableUuid(value.quoteMessageId) || !nullableUuid(value.rootParentMessageId)
    || !sameUuid(value.quoteMessageId, request.input.quoteMessageId)
    || (value.quoteMessageId === null) !== (value.rootParentMessageId === null)
    || sameUuid(value.messageId, value.quoteMessageId) || sameUuid(value.messageId, value.rootParentMessageId)) return null;
  return value as TeamChatPostV2Receipt;
}
