import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  caseChatCursor, caseChatUuid, isCaseChatAttachmentKind, isCaseChatAwaitState,
  type CaseChatFailure, type CaseChatMessage, type CaseChatPage, type CaseChatThreadRow, type CaseChatThreadsList,
} from "../platform-case-chat-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

export class CaseChatReadError extends Error {
  constructor(readonly status: CaseChatFailure) { super(status); }
}
/** 22023→invalid, 42501/PGRST301→forbidden, 40001→request_conflict (replay with a different payload), P0002→not_found. */
export function caseChatErrorStatus(error: { code?: string }): CaseChatFailure {
  if (error.code === "42501" || error.code === "PGRST301") return "forbidden";
  if (error.code === "40001") return "request_conflict";
  if (error.code === "P0002") return "not_found";
  if (error.code?.startsWith("22")) return "invalid";
  return "unavailable";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const nullableUuid = (value: unknown) => value === null || caseChatUuid(value);
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown) => value === null || timestamp(value);

function quotedPreview(value: unknown): CaseChatMessage["quotedPreview"] {
  if (value === null) return null;
  if (!record(value) || !caseChatUuid(value.id) || typeof value.authorName !== "string"
    || typeof value.bodyPreview !== "string" || value.bodyPreview.length > 140) throw new CaseChatReadError("unavailable");
  return { id: value.id, authorName: value.authorName, bodyPreview: value.bodyPreview };
}
function message(value: unknown): CaseChatMessage {
  if (!record(value) || !caseChatUuid(value.id) || !caseChatCursor(value.sequenceId)
    || !caseChatUuid(value.authorMembershipId) || typeof value.authorName !== "string"
    || typeof value.body !== "string" || value.body.length > 8000 || !timestamp(value.createdAt)
    || !nullableUuid(value.quotedMessageId)
    || (value.attachmentKind !== null && !isCaseChatAttachmentKind(value.attachmentKind))
    || !nullableUuid(value.attachmentId) || (value.attachmentLabel !== null && typeof value.attachmentLabel !== "string")
    || (value.attachmentKind === null) !== (value.attachmentId === null)) throw new CaseChatReadError("unavailable");
  return {
    id: value.id as string, sequenceId: value.sequenceId as string, authorMembershipId: value.authorMembershipId as string,
    authorName: value.authorName as string, body: value.body as string, createdAt: value.createdAt as string,
    quotedMessageId: value.quotedMessageId as string | null,
    quotedPreview: quotedPreview(value.quotedPreview), attachmentKind: value.attachmentKind as CaseChatMessage["attachmentKind"],
    attachmentId: value.attachmentId as string | null, attachmentLabel: value.attachmentLabel as string | null,
  };
}

export async function readCaseChatPage(
  actor: ActivePlatformActor, studentCaseId: string, mode: "latest" | "before", beforeSequenceId?: string,
): Promise<CaseChatPage> {
  if (!caseChatUuid(studentCaseId) || (mode === "before" && !caseChatCursor(beforeSequenceId))) throw new CaseChatReadError("invalid");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("case_chat_read_page_v1", {
    p_organization_id: actor.organizationId, p_student_case_id: studentCaseId,
    p_mode: mode, p_before_sequence_id: mode === "before" ? beforeSequenceId : null,
  });
  if (error) throw new CaseChatReadError(caseChatErrorStatus(error));
  if (!record(data) || !Array.isArray(data.messages) || !caseChatCursor(data.cursor) || typeof data.hasMore !== "boolean"
    || !record(data.thread) || !isCaseChatAwaitState(data.thread.awaitState)
    || !nullableTimestamp(data.thread.lastMessageAt) || !(data.thread.lastMessageSequenceId === null || caseChatCursor(data.thread.lastMessageSequenceId))
    || !caseChatCursor(data.readSequenceId)) throw new CaseChatReadError("unavailable");
  const messages = data.messages.map(message);
  return {
    messages, cursor: data.cursor, hasMore: data.hasMore, readSequenceId: data.readSequenceId,
    thread: {
      awaitState: data.thread.awaitState, lastMessageAt: data.thread.lastMessageAt as string | null,
      lastMessageSequenceId: data.thread.lastMessageSequenceId as string | null,
    },
  };
}

function threadRow(value: unknown): CaseChatThreadRow {
  if (!record(value) || !caseChatUuid(value.studentCaseId) || typeof value.studentDisplayName !== "string"
    || (value.lastMessageSnippet !== null && typeof value.lastMessageSnippet !== "string")
    || !nullableTimestamp(value.lastMessageAt) || !nullableUuid(value.lastMessageAuthorMembershipId)
    || !isCaseChatAwaitState(value.awaitState) || typeof value.unread !== "boolean") throw new CaseChatReadError("unavailable");
  return {
    studentCaseId: value.studentCaseId, studentDisplayName: value.studentDisplayName,
    lastMessageSnippet: value.lastMessageSnippet as string | null, lastMessageAt: value.lastMessageAt as string | null,
    lastMessageAuthorMembershipId: value.lastMessageAuthorMembershipId as string | null,
    awaitState: value.awaitState, unread: value.unread,
  };
}

export async function readStaffCaseChatThreads(actor: ActivePlatformActor, query: string | null): Promise<CaseChatThreadsList> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_case_chat_threads_v1", {
    p_query: query && query.trim() ? query.trim() : null,
  });
  if (error) throw new CaseChatReadError(caseChatErrorStatus(error));
  if (!record(data) || !Array.isArray(data.rows) || typeof data.truncated !== "boolean") throw new CaseChatReadError("unavailable");
  return { rows: data.rows.map(threadRow), truncated: data.truncated };
}
