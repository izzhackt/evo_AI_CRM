import { teamChatCursor, teamChatUuid, type TeamChatChannelKey, type TeamChatMessage } from "./platform-team-chat.ts";
import { teamChatValidPostV2Input } from "./platform-team-chat-post-v2.ts";

export type TeamChatDraftTarget =
  | { kind: "post-v2"; quoteMessageId: string | null }
  | { kind: "post-v1"; parentMessageId: string | null }
  | { kind: "edit"; messageId: string; expectedVersion: string | null };
export type TeamChatDraft = {
  schemaVersion: 2; body: string; mentions: string[]; requestId: string;
  target: TeamChatDraftTarget; retryInput?: string;
};
export type TeamChatDraftEntry = { key: string; draft: TeamChatDraft | null };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nullableId = (value: unknown): value is string | null => value === null || teamChatUuid(value);
const sameId = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string"
  ? a.toLowerCase() === b.toLowerCase() : a === b;
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function teamChatDraftPrefix(scope: string, channel: TeamChatChannelKey, version: 1 | 2) {
  return `evo-team-draft-v${version}:${scope}:${channel}:`;
}

export function newTeamChatDraft(requestId: string, edit?: TeamChatMessage): TeamChatDraft {
  return {
    schemaVersion: 2, body: edit?.body ?? "", mentions: [...edit?.mentionedMembershipIds ?? []], requestId,
    target: edit ? { kind: "edit", messageId: edit.id, expectedVersion: edit.version }
      : { kind: "post-v2", quoteMessageId: null },
  };
}

/** Recovery reads only this identity's channel keys and never rewrites the source. */
export function decodeTeamChatDraft(raw: string, key: string, scope: string, channel: TeamChatChannelKey): TeamChatDraft | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || typeof value.body !== "string" || !Array.isArray(value.mentions)
      || !value.mentions.every(teamChatUuid) || !teamChatUuid(value.requestId)
      || (value.retryInput !== undefined && typeof value.retryInput !== "string")) return null;
    let target: TeamChatDraftTarget;
    const legacyPrefix = teamChatDraftPrefix(scope, channel, 1);
    const currentPrefix = teamChatDraftPrefix(scope, channel, 2);
    if (key.startsWith(legacyPrefix)) {
      const suffix = key.slice(legacyPrefix.length);
      if (suffix.startsWith("edit:") && teamChatUuid(suffix.slice(5))) {
        target = { kind: "edit", messageId: suffix.slice(5), expectedVersion: null };
        if (value.schemaVersion === 2 && record(value.target) && value.target.kind === "edit"
          && sameId(value.target.messageId, target.messageId) && teamChatCursor(value.target.expectedVersion)) {
          target.expectedVersion = value.target.expectedVersion;
        }
        if (value.retryInput) {
          const input: unknown = JSON.parse(value.retryInput);
          if (!record(input) || !teamChatCursor(input.expectedVersion)) return null;
          target.expectedVersion = input.expectedVersion;
        }
      } else if (suffix === "channel" || teamChatUuid(suffix)) {
        target = { kind: "post-v1", parentMessageId: suffix === "channel" ? null : suffix };
      } else return null;
    } else if (key.startsWith(currentPrefix) && value.schemaVersion === 2 && record(value.target)) {
      const input = value.target;
      const suffix = key.slice(currentPrefix.length);
      if (suffix === "post" && input.kind === "post-v2" && exact(input, ["kind", "quoteMessageId"]) && nullableId(input.quoteMessageId)) {
        target = { kind: "post-v2", quoteMessageId: input.quoteMessageId };
      } else if (input.kind === "edit" && exact(input, ["kind", "messageId", "expectedVersion"])
        && teamChatUuid(input.messageId) && suffix === `edit:${input.messageId}` && teamChatCursor(input.expectedVersion)) {
        target = { kind: "edit", messageId: input.messageId, expectedVersion: input.expectedVersion };
      } else return null;
    } else return null;
    const draft: TeamChatDraft = { schemaVersion: 2, body: value.body, mentions: value.mentions,
      requestId: value.requestId, target, ...(value.retryInput === undefined ? {} : { retryInput: value.retryInput }) };
    if (draft.retryInput !== undefined && !teamChatDraftInput(draft)) return null;
    return draft;
  } catch { return null; }
}

/** Validate a frozen payload before sending: a composer may only post or edit. */
export function teamChatDraftInput(draft: TeamChatDraft): string | null {
  const { target } = draft;
  if (target.kind === "edit" && target.expectedVersion === null) return null;
  const expected = target.kind === "post-v2"
    ? { body: draft.body, quoteMessageId: target.quoteMessageId, mentionedMembershipIds: draft.mentions }
    : target.kind === "post-v1"
      ? { operation: "post", body: draft.body, parentMessageId: target.parentMessageId, mentionedMembershipIds: draft.mentions }
      : { operation: "edit", messageId: target.messageId, expectedVersion: target.expectedVersion, body: draft.body, mentionedMembershipIds: draft.mentions };
  const raw = draft.retryInput ?? JSON.stringify(expected);
  try {
    const input: unknown = JSON.parse(raw);
    if (!record(input) || !exact(input, Object.keys(expected)) || input.body !== draft.body
      || JSON.stringify(input.mentionedMembershipIds) !== JSON.stringify(draft.mentions)) return null;
    if (target.kind === "post-v2") return teamChatValidPostV2Input(input) && sameId(input.quoteMessageId, target.quoteMessageId) ? raw : null;
    if (!teamChatValidPostV2Input({ body: input.body, quoteMessageId: null, mentionedMembershipIds: input.mentionedMembershipIds })) return null;
    if (target.kind === "post-v1") return input.operation === "post" && sameId(input.parentMessageId, target.parentMessageId) ? raw : null;
    return input.operation === "edit" && sameId(input.messageId, target.messageId) && input.expectedVersion === target.expectedVersion ? raw : null;
  } catch { return null; }
}

export function teamChatDraftHasContent(draft: TeamChatDraft) {
  return Boolean(draft.body || draft.mentions.length || draft.retryInput || draft.target.kind !== "post-v2" || draft.target.quoteMessageId);
}

export function teamChatDraftLabel(draft: TeamChatDraft) {
  const label = draft.target.kind === "edit" ? "Правка сообщения"
    : draft.target.kind === "post-v1" ? draft.target.parentMessageId ? "Ответ из прежнего обсуждения" : "Прежний черновик"
      : draft.target.quoteMessageId ? "Ответ на сообщение" : "Новое сообщение";
  return `${label}${draft.retryInput ? " · ожидает подтверждения" : ""}`;
}
