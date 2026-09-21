import "server-only";

import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { staffCanAccessChatChannel, type TeamChatFailure } from "../platform-team-chat.ts";
import {
  decodeTeamChatSeenReceipt, teamChatValidSeenBatch,
  type TeamChatSeenBatch, type TeamChatSeenReceipt,
} from "../platform-team-chat-seen.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import { teamChatErrorStatus } from "./platform-team-chat-repository.ts";

export class TeamChatSeenError extends Error {
  constructor(readonly status: TeamChatFailure) { super(status); }
}

export async function markTeamChatSeen(actor: ActivePlatformActor, batch: TeamChatSeenBatch): Promise<TeamChatSeenReceipt> {
  if (!teamChatValidSeenBatch(batch)) throw new TeamChatSeenError("invalid");
  if (isStaffPreview(actor) || !staffCanAccessChatChannel(actor, batch.channel)) throw new TeamChatSeenError("forbidden");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("team_chat_mark_seen", {
    p_organization_id: actor.organizationId, p_channel_key: batch.channel, p_message_ids: batch.messageIds,
  });
  if (error) throw new TeamChatSeenError(teamChatErrorStatus(error));
  const receipt = decodeTeamChatSeenReceipt(data, batch);
  if (!receipt) throw new TeamChatSeenError("unavailable");
  return receipt;
}
