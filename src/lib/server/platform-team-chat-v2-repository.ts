import "server-only";

import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { staffCanAccessChatChannel, type TeamChatFailure } from "../platform-team-chat.ts";
import {
  decodeTeamChatPostV2Receipt, teamChatValidPostV2Request,
  type TeamChatPostV2Receipt, type TeamChatPostV2Request,
} from "../platform-team-chat-post-v2.ts";
import { teamChatTimelineValidQuery, type TeamChatTimelineQuery } from "../platform-team-chat-timeline.ts";
import { decodeTeamChatTimelineV2Page, type TeamChatTimelineV2Page } from "../platform-team-chat-timeline-v2.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import { teamChatErrorStatus } from "./platform-team-chat-repository.ts";

export class TeamChatV2Error extends Error {
  constructor(readonly status: TeamChatFailure) { super(status); }
}

export async function postTeamChatV2(actor: ActivePlatformActor, request: TeamChatPostV2Request): Promise<TeamChatPostV2Receipt> {
  if (!teamChatValidPostV2Request(request)) throw new TeamChatV2Error("invalid");
  if (isStaffPreview(actor) || !staffCanAccessChatChannel(actor, request.channel)) throw new TeamChatV2Error("forbidden");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("team_chat_post_v2", {
    p_organization_id: actor.organizationId, p_channel_key: request.channel,
    p_request_id: request.requestId, p_input: request.input,
  });
  if (error) throw new TeamChatV2Error(teamChatErrorStatus(error));
  const receipt = decodeTeamChatPostV2Receipt(data, request);
  if (!receipt) throw new TeamChatV2Error("unavailable");
  return receipt;
}

export async function readTeamChatTimelineV2(actor: ActivePlatformActor, query: TeamChatTimelineQuery): Promise<TeamChatTimelineV2Page> {
  if (!teamChatTimelineValidQuery(query)) throw new TeamChatV2Error("invalid");
  if (isStaffPreview(actor) || !staffCanAccessChatChannel(actor, query.channel)) throw new TeamChatV2Error("forbidden");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("team_chat_read_timeline_v2", {
    p_organization_id: actor.organizationId, p_channel_key: query.channel,
    p_mode: query.mode, p_cursor: query.cursor ?? "0", p_message_id: query.messageId ?? null,
  });
  if (error) throw new TeamChatV2Error(teamChatErrorStatus(error));
  const page = decodeTeamChatTimelineV2Page(data, query);
  if (!page) throw new TeamChatV2Error("unavailable");
  return page;
}
