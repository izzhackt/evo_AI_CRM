import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  isTeamChatChannel, teamChatCursor, teamChatUuid,
  type TeamChatChannel, type TeamChatMessage, type TeamChatPage,
  type TeamChatParticipant, type TeamChatQuery, type TeamChatFailure,
} from "../platform-team-chat.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

export class TeamChatReadError extends Error {
  constructor(readonly status: TeamChatFailure) { super(status); }
}
export function teamChatErrorStatus(error: { code?: string }): TeamChatFailure {
  if (error.code === "42501" || error.code === "PGRST301") return "forbidden";
  if (error.code === "40001") return "conflict";
  if (error.code === "P0002") return "not_found";
  if (error.code?.startsWith("22")) return "invalid";
  return "unavailable";
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const nullableUuid = (value: unknown) => value === null || teamChatUuid(value);
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown) => value === null || timestamp(value);
function message(value: unknown): value is TeamChatMessage {
  return record(value) && teamChatUuid(value.id) && isTeamChatChannel(value.channelKey)
    && teamChatCursor(value.sequence) && teamChatUuid(value.authorMembershipId)
    && typeof value.authorName === "string" && typeof value.body === "string" && value.body.length <= 16000
    && nullableUuid(value.parentMessageId) && teamChatCursor(value.version) && value.version !== "0"
    && timestamp(value.createdAt) && nullableTimestamp(value.editedAt) && nullableTimestamp(value.deletedAt)
    && Number.isSafeInteger(value.replyCount) && Number(value.replyCount) >= 0
    && Array.isArray(value.mentionedMembershipIds) && value.mentionedMembershipIds.length <= 20
    && value.mentionedMembershipIds.every(teamChatUuid)
    && (value.linkedTaskIds === undefined || (Array.isArray(value.linkedTaskIds) && value.linkedTaskIds.every(teamChatUuid)));
}
export async function readTeamChatPage(actor: ActivePlatformActor, query: TeamChatQuery): Promise<TeamChatPage> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("team_chat_read_page", {
    p_organization_id: actor.organizationId, p_channel_key: query.channel, p_mode: query.mode,
    p_cursor: query.cursor ?? "0", p_message_id: query.messageId ?? null, p_query: query.query ?? null,
  });
  if (error) throw new TeamChatReadError(teamChatErrorStatus(error));
  if (!record(data) || !Array.isArray(data.messages) || !data.messages.every(message)
    || !data.messages.every((row: TeamChatMessage) => row.channelKey === query.channel)
    || !teamChatCursor(data.cursor) || !teamChatCursor(data.watermark) || typeof data.hasMore !== "boolean"
    || !nullableUuid(data.latestMessageId) || !nullableUuid(data.rootId)) throw new TeamChatReadError("unavailable");
  return data as TeamChatPage;
}
export async function readTeamChatChannels(actor: ActivePlatformActor): Promise<readonly TeamChatChannel[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("team_chat_channels", { p_organization_id: actor.organizationId });
  if (error) throw new TeamChatReadError(teamChatErrorStatus(error));
  if (!Array.isArray(data) || !data.every((row: unknown) => record(row) && isTeamChatChannel(row.key)
    && typeof row.muted === "boolean" && teamChatCursor(row.preferenceVersion) && teamChatCursor(row.readSequence)
    && Number.isSafeInteger(row.unreadCount) && Number(row.unreadCount) >= 0 && nullableUuid(row.firstUnreadId))) {
    throw new TeamChatReadError("unavailable");
  }
  return data as TeamChatChannel[];
}
export async function readTeamChatParticipants(actor: ActivePlatformActor): Promise<readonly TeamChatParticipant[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_workspace_participants", { p_organization_id: actor.organizationId });
  if (error) throw new TeamChatReadError(teamChatErrorStatus(error));
  if (!Array.isArray(data)) throw new TeamChatReadError("unavailable");
  return data.map((row: unknown) => {
    if (!record(row) || !teamChatUuid(row.membership_id) || typeof row.display_name !== "string"
      || !["admin", "sales", "curator"].includes(String(row.platform_role))) throw new TeamChatReadError("unavailable");
    return { membershipId: row.membership_id, displayName: row.display_name,
      role: row.platform_role === "curator" ? "admissions" : row.platform_role as "admin" | "sales" };
  });
}
