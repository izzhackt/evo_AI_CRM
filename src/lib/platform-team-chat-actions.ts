"use server";

import { resolvePlatformActor } from "./platform-auth";
import {
  isTeamChatChannel, teamChatCursor, teamChatUuid, teamChatValidQuery,
  type TeamChatActionState, type TeamChatQuery, type TeamChatSnapshot, type TeamChatFailure,
} from "./platform-team-chat";
import { teamChatErrorStatus, TeamChatReadError } from "./server/platform-team-chat-repository";
import { createSupabaseServerClient } from "./supabase/server";
import { readV3TeamChat } from "./v3/team-chat-source";

export async function readTeamChatAction(query: TeamChatQuery): Promise<
  { status: "ready"; snapshot: TeamChatSnapshot } | { status: TeamChatFailure }
> {
  try {
    if (!teamChatValidQuery(query)) return { status: "invalid" };
    const authorization = await resolvePlatformActor();
    if (authorization.status !== "authenticated") return { status: "forbidden" };
    return { status: "ready", snapshot: await readV3TeamChat(authorization.actor, query) };
  } catch (error) {
    return { status: error instanceof TeamChatReadError ? error.status : "unavailable" };
  }
}

export async function teamChatCommandAction(_previous: TeamChatActionState, form: FormData): Promise<TeamChatActionState> {
  const fail = (status: TeamChatFailure, requestId: string | null = null): TeamChatActionState => ({ status, requestId, messageId: null });
  let requestId: string | null = null;
  try {
    for (const [key, value] of form.entries()) {
      if (key.startsWith("$ACTION_")) continue;
      if (!["request_id", "channel", "input"].includes(key) || typeof value !== "string" || form.getAll(key).length !== 1) return fail("invalid");
    }
    const rawRequest = form.get("request_id");
    const channel = form.get("channel");
    const rawInput = form.get("input");
    if (!teamChatUuid(rawRequest) || !isTeamChatChannel(channel) || typeof rawInput !== "string" || rawInput.length > 20000) return fail("invalid");
    requestId = rawRequest;
    const input: unknown = JSON.parse(rawInput);
    if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("invalid", requestId);
    const value = input as Record<string, unknown>;
    const fields: Record<string, readonly string[]> = {
      post: ["operation", "body", "parentMessageId", "mentionedMembershipIds"],
      edit: ["operation", "messageId", "expectedVersion", "body", "mentionedMembershipIds"],
      delete: ["operation", "messageId", "expectedVersion"],
      moderate: ["operation", "messageId", "expectedVersion", "reason"],
      read: ["operation", "messageId"], mute: ["operation", "muted", "expectedVersion"],
    };
    const operation = typeof value.operation === "string" ? value.operation : "";
    const allowed = fields[operation];
    if (!allowed || Object.keys(value).some((key) => !allowed.includes(key))) return fail("invalid", requestId);
    if (["post", "edit"].includes(operation)) {
      if (typeof value.body !== "string" || Array.from(value.body.trim()).length < 1 || Array.from(value.body).length > 8000
        || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value.body)
        || !Array.isArray(value.mentionedMembershipIds) || value.mentionedMembershipIds.length > 20
        || !value.mentionedMembershipIds.every(teamChatUuid)) return fail("invalid", requestId);
    }
    if (operation === "post" && value.parentMessageId != null && !teamChatUuid(value.parentMessageId)) return fail("invalid", requestId);
    if (["edit", "delete", "moderate", "read"].includes(operation) && !teamChatUuid(value.messageId)) return fail("invalid", requestId);
    if (["edit", "delete", "moderate", "mute"].includes(operation) && !teamChatCursor(value.expectedVersion)) return fail("invalid", requestId);
    if (operation === "mute" && typeof value.muted !== "boolean") return fail("invalid", requestId);
    if (operation === "moderate" && (typeof value.reason !== "string" || value.reason.trim().length < 3 || value.reason.length > 500)) return fail("invalid", requestId);
    const authorization = await resolvePlatformActor();
    if (authorization.status !== "authenticated") return fail("forbidden", requestId);
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("team_chat_command", {
      p_organization_id: authorization.actor.organizationId, p_channel_key: channel, p_request_id: requestId, p_input: value,
    });
    if (error) return fail(teamChatErrorStatus(error), requestId);
    if (!data || data.requestId !== requestId || data.channelKey !== channel || data.operation !== operation
      || (data.messageId !== null && !teamChatUuid(data.messageId))
      || (data.version !== null && !teamChatCursor(data.version))) return fail("unavailable", requestId);
    return { status: "saved", requestId, messageId: data.messageId };
  } catch (error) {
    return fail(error instanceof SyntaxError ? "invalid" : "unavailable", requestId);
  }
}
