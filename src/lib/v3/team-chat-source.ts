import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import { staffCanAccessChatChannel, type TeamChatQuery, type TeamChatSnapshot } from "../platform-team-chat.ts";
import { readTeamChatChannels, readTeamChatPage, readTeamChatParticipants, TeamChatReadError } from "../server/platform-team-chat-repository.ts";
import { readTeamChatTimelineV2 } from "../server/platform-team-chat-v2-repository.ts";
import type { TeamChatTimelineQuery } from "../platform-team-chat-timeline.ts";
import type { TeamChatFeedSnapshot } from "../team-chat-feed.ts";

export async function readV3TeamChatFeed(actor: ActivePlatformActor, query: TeamChatTimelineQuery): Promise<TeamChatFeedSnapshot> {
  if (!staffCanAccessChatChannel(actor, query.channel)) throw new TeamChatReadError("forbidden");
  const [page, channels, participants] = await Promise.all([
    readTeamChatTimelineV2(actor, query), readTeamChatChannels(actor), readTeamChatParticipants(actor, query.channel),
  ]);
  return { page, channels: channels.filter((channel) => staffCanAccessChatChannel(actor, channel.key)), participants };
}

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
