import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import { teamChatRoleCanAccess, teamChatUuid, type TeamChatQuery, type TeamChatSnapshot } from "../platform-team-chat.ts";
import { readTeamChatChannels, readTeamChatPage, readTeamChatParticipants, TeamChatReadError } from "../server/platform-team-chat-repository.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

export async function readV3TeamChat(actor: ActivePlatformActor, query: TeamChatQuery): Promise<TeamChatSnapshot> {
  if (!teamChatRoleCanAccess(actor.presentationRole, query.channel)) throw new TeamChatReadError("forbidden");
  const [page, channels, participants] = await Promise.all([
    readTeamChatPage(actor, query), readTeamChatChannels(actor), readTeamChatParticipants(actor),
  ]);
  const linkedTasks = new Map<string, string[]>();
  if (page.messages.length) {
    const client = await createSupabaseServerClient();
    // A changes page may contain 100 changed replies plus their 100 roots.
    for (let offset = 0; offset < page.messages.length; offset += 100) {
      const ids = page.messages.slice(offset, offset + 100).map((message) => message.id);
      const { data, error } = await client.schema("platform").rpc("team_chat_task_links", {
        p_organization_id: actor.organizationId, p_message_ids: ids,
      });
      if (error || !Array.isArray(data)) throw new TeamChatReadError("unavailable");
      for (const entry of data) {
        if (!entry || !teamChatUuid(entry.message_id) || !ids.includes(entry.message_id)
          || !teamChatUuid(entry.staff_task_id)) throw new TeamChatReadError("unavailable");
        linkedTasks.set(entry.message_id, [...(linkedTasks.get(entry.message_id) ?? []), entry.staff_task_id]);
      }
    }
  }
  return {
    page: { ...page, messages: page.messages.map((message) => ({ ...message, linkedTaskIds: linkedTasks.get(message.id) ?? [] })) },
    channels: channels.filter((channel) => teamChatRoleCanAccess(actor.presentationRole, channel.key)),
    participants: participants.filter((participant) => teamChatRoleCanAccess(participant.role, query.channel)),
  };
}
