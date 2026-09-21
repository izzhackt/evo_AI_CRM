"use server";

import { isStaffPreview } from "./platform-access.ts";
import { resolvePlatformActor } from "./platform-auth";
import { teamChatValidPostV2Request, type TeamChatPostV2Result } from "./platform-team-chat-post-v2.ts";
import { teamChatTimelineValidQuery } from "./platform-team-chat-timeline.ts";
import type { TeamChatTimelineV2Result } from "./platform-team-chat-timeline-v2.ts";
import { postTeamChatV2, readTeamChatTimelineV2, TeamChatV2Error } from "./server/platform-team-chat-v2-repository.ts";

/** Additive entry points; current UI and frozen V1 drafts retain their old path. */
export async function postTeamChatV2Action(input: unknown): Promise<TeamChatPostV2Result> {
  if (!teamChatValidPostV2Request(input)) return { status: "invalid" };
  try {
    const authorization = await resolvePlatformActor();
    if (authorization.status !== "authenticated" || isStaffPreview(authorization.actor)) return { status: "forbidden" };
    return { status: "saved", receipt: await postTeamChatV2(authorization.actor, input) };
  } catch (error) {
    return { status: error instanceof TeamChatV2Error ? error.status : "unavailable" };
  }
}

export async function readTeamChatTimelineV2Action(input: unknown): Promise<TeamChatTimelineV2Result> {
  if (!teamChatTimelineValidQuery(input)) return { status: "invalid" };
  try {
    const authorization = await resolvePlatformActor();
    if (authorization.status !== "authenticated" || isStaffPreview(authorization.actor)) return { status: "forbidden" };
    return { status: "loaded", page: await readTeamChatTimelineV2(authorization.actor, input) };
  } catch (error) {
    return { status: error instanceof TeamChatV2Error ? error.status : "unavailable" };
  }
}
