import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import { staffCanAccessChatChannel, type TeamChatQuery, type TeamChatSnapshot } from "../platform-team-chat.ts";
import { readTeamChatChannels, readTeamChatPage, readTeamChatParticipants, TeamChatReadError } from "../server/platform-team-chat-repository.ts";

export async function readV3TeamChat(actor: ActivePlatformActor, query: TeamChatQuery): Promise<TeamChatSnapshot> {
  if (!staffCanAccessChatChannel(actor, query.channel)) throw new TeamChatReadError("forbidden");
  const [page, channels, participants] = await Promise.all([
    readTeamChatPage(actor, query), readTeamChatChannels(actor), readTeamChatParticipants(actor, query.channel),
  ]);
  return {
    page,
    channels: channels.filter((channel) => staffCanAccessChatChannel(actor, channel.key)),
    participants,
  };
}
