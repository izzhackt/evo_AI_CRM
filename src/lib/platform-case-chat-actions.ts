"use server";
import { isStaffPreview } from "./platform-access.ts";
import { resolvePlatformActor } from "./platform-auth";
import {
  caseChatCursor, caseChatUuid, isCaseChatAttachmentKind, isCaseChatAwaitState,
  type CaseChatActionState, type CaseChatFailure, type CaseChatPage, type CaseChatThreadsList,
} from "./platform-case-chat-contract";
import { caseChatErrorStatus, CaseChatReadError, readCaseChatPage, readStaffCaseChatThreads } from "./v3/case-chat-source";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

export async function readCaseChatPageAction(
  studentCaseId: string, mode: "latest" | "before", beforeSequenceId?: string,
): Promise<{ status: "ready"; page: CaseChatPage } | { status: CaseChatFailure }> {
  try {
    const authorization = await resolvePlatformActor();
    if (authorization.status !== "authenticated") return { status: "forbidden" };
    const page = await readCaseChatPage(authorization.actor, studentCaseId, mode, beforeSequenceId);
    return { status: "ready", page };
  } catch (error) {
    return { status: error instanceof CaseChatReadError ? error.status : "unavailable" };
  }
}

export async function loadStaffCaseChatThreadsAction(
  query: string | null,
): Promise<{ status: "ready"; list: CaseChatThreadsList } | { status: CaseChatFailure }> {
  try {
    const authorization = await resolvePlatformActor();
    if (authorization.status !== "authenticated") return { status: "forbidden" };
    const list = await readStaffCaseChatThreads(authorization.actor, query);
    return { status: "ready", list };
  } catch (error) {
    return { status: error instanceof CaseChatReadError ? error.status : "unavailable" };
  }
}

async function runCaseChatCommand(
  caseId: string, requestId: string, input: Record<string, unknown>,
): Promise<{ status: "saved" | CaseChatFailure }> {
  const authorization = await resolvePlatformActor();
  if (authorization.status !== "authenticated" || isStaffPreview(authorization.actor)) return { status: "forbidden" };
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("case_chat_command", {
    p_organization_id: authorization.actor.organizationId, p_student_case_id: caseId, p_request_id: requestId, p_input: input,
  });
  if (error) return { status: caseChatErrorStatus(error) };
  if (!data || data.requestId !== requestId || data.studentCaseId !== caseId) return { status: "unavailable" };
  return { status: "saved" };
}

/**
 * Frozen-retry semantics: this action always echoes back exactly the
 * request id it was given, never mints a new one. On "unavailable" the
 * calling composer (see CaseChatThread.tsx, the src/lib/platform-finance-
 * entry-actions.ts + FinanceEntryForms pattern) keeps the SAME request id
 * and the same serialized input for the next submit, so a retry can only
 * ever replay the original command — the RPC's fingerprint-checked receipt
 * table guarantees no second message is ever stored.
 */
export async function postCaseChatMessageAction(_previous: CaseChatActionState, form: FormData): Promise<CaseChatActionState> {
  const fail = (status: CaseChatFailure, requestId: string | null = null): CaseChatActionState => ({ status, requestId });
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["request_id", "case_id", "body", "quoted_message_id", "attachment_kind", "attachment_id"]);
    if (!fields) return fail("invalid");
    const rawRequest = fields.get("request_id")!;
    const caseId = fields.get("case_id")!;
    if (!caseChatUuid(rawRequest) || !caseChatUuid(caseId)) return fail("invalid");
    requestId = rawRequest;
    const body = fields.get("body")!;
    const quotedMessageId = fields.get("quoted_message_id")!;
    const attachmentKind = fields.get("attachment_kind")!;
    const attachmentId = fields.get("attachment_id")!;
    if (Array.from(body).length > 8000) return fail("invalid", requestId);
    if (quotedMessageId && !caseChatUuid(quotedMessageId)) return fail("invalid", requestId);
    if (attachmentKind && !isCaseChatAttachmentKind(attachmentKind)) return fail("invalid", requestId);
    if (attachmentId && !caseChatUuid(attachmentId)) return fail("invalid", requestId);
    if ((attachmentKind === "") !== (attachmentId === "")) return fail("invalid", requestId);
    if (!body.trim() && !attachmentId) return fail("invalid", requestId);
    const input: Record<string, unknown> = { mode: "post", body: body.trim() ? body : null };
    if (quotedMessageId) input.quotedMessageId = quotedMessageId;
    if (attachmentKind) { input.attachmentKind = attachmentKind; input.attachmentId = attachmentId; }
    const result = await runCaseChatCommand(caseId, requestId, input);
    return { status: result.status, requestId };
  } catch {
    return fail("unavailable", requestId);
  }
}

/** Explicit action only — «Ждём студента» / «Ответ не требуется». Never called by an ordinary send. */
export async function setCaseChatAwaitAction(_previous: CaseChatActionState, form: FormData): Promise<CaseChatActionState> {
  const fail = (status: CaseChatFailure, requestId: string | null = null): CaseChatActionState => ({ status, requestId });
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["request_id", "case_id", "state"]);
    if (!fields) return fail("invalid");
    const rawRequest = fields.get("request_id")!;
    const caseId = fields.get("case_id")!;
    const state = fields.get("state")!;
    if (!caseChatUuid(rawRequest) || !caseChatUuid(caseId) || !isCaseChatAwaitState(state)) return fail("invalid");
    requestId = rawRequest;
    const result = await runCaseChatCommand(caseId, requestId, { mode: "set_await", state });
    return { status: result.status, requestId };
  } catch {
    return fail("unavailable", requestId);
  }
}

/** Read alone never clears «Нужен ответ» — this only ever bumps the CALLER's own cursor. */
export async function markCaseChatReadAction(_previous: CaseChatActionState, form: FormData): Promise<CaseChatActionState> {
  const fail = (status: CaseChatFailure, requestId: string | null = null): CaseChatActionState => ({ status, requestId });
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["request_id", "case_id", "sequence_id"]);
    if (!fields) return fail("invalid");
    const rawRequest = fields.get("request_id")!;
    const caseId = fields.get("case_id")!;
    const sequenceId = fields.get("sequence_id")!;
    if (!caseChatUuid(rawRequest) || !caseChatUuid(caseId) || !caseChatCursor(sequenceId)) return fail("invalid");
    requestId = rawRequest;
    const result = await runCaseChatCommand(caseId, requestId, { mode: "read", sequenceId });
    return { status: result.status, requestId };
  } catch {
    return fail("unavailable", requestId);
  }
}
