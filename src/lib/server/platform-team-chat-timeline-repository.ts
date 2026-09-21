import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import { staffCanAccessChatChannel } from "../platform-team-chat.ts";
import {
  decodeTeamChatTimelinePage, teamChatTimelineValidQuery,
  type TeamChatTimelinePage, type TeamChatTimelineQuery,
} from "../platform-team-chat-timeline.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import { teamChatErrorStatus, TeamChatReadError } from "./platform-team-chat-repository.ts";

export async function readTeamChatTimeline(actor: ActivePlatformActor, query: TeamChatTimelineQuery): Promise<TeamChatTimelinePage> {
  if (!teamChatTimelineValidQuery(query)) throw new TeamChatReadError("invalid");
  if (!staffCanAccessChatChannel(actor, query.channel)) throw new TeamChatReadError("forbidden");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("team_chat_read_timeline", {
    p_organization_id: actor.organizationId, p_channel_key: query.channel,
    p_mode: query.mode, p_cursor: query.cursor ?? "0", p_message_id: query.messageId ?? null,
  });
  if (error) throw new TeamChatReadError(teamChatErrorStatus(error));
  const page = decodeTeamChatTimelinePage(data, query);
  if (!page) throw new TeamChatReadError("unavailable");
  return page;
}
