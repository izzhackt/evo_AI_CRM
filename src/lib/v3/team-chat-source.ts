import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import { teamChatRoleCanAccess, type TeamChatQuery, type TeamChatSnapshot } from "../platform-team-chat.ts";
import { readTeamChatChannels, readTeamChatPage, readTeamChatParticipants, TeamChatReadError } from "../server/platform-team-chat-repository.ts";

export async function readV3TeamChat(actor: ActivePlatformActor, query: TeamChatQuery): Promise<TeamChatSnapshot> {
  if (!teamChatRoleCanAccess(actor.presentationRole, query.channel)) throw new TeamChatReadError("forbidden");
  const [page, channels, participants] = await Promise.all([
    readTeamChatPage(actor, query), readTeamChatChannels(actor), readTeamChatParticipants(actor),
  ]);
  return {
    page,
    channels: channels.filter((channel) => teamChatRoleCanAccess(actor.presentationRole, channel.key)),
    participants: participants.filter((participant) => teamChatRoleCanAccess(participant.role, query.channel)),
  };
}
