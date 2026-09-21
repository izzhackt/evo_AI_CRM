"use server";

import { isStaffPreview } from "./platform-access.ts";
import { resolvePlatformActor } from "./platform-auth";
import { teamChatValidSeenBatch, type TeamChatSeenResult } from "./platform-team-chat-seen.ts";
import { markTeamChatSeen, TeamChatSeenError } from "./server/platform-team-chat-seen-repository.ts";

/** Not connected to the current UI; only explicit visible IDs belong here. */
export async function markTeamChatSeenAction(input: unknown): Promise<TeamChatSeenResult> {
  if (!teamChatValidSeenBatch(input)) return { status: "invalid" };
  try {
    const authorization = await resolvePlatformActor();
    if (authorization.status !== "authenticated" || isStaffPreview(authorization.actor)) return { status: "forbidden" };
    return { status: "saved", receipt: await markTeamChatSeen(authorization.actor, input) };
  } catch (error) {
    return { status: error instanceof TeamChatSeenError ? error.status : "unavailable" };
  }
}
