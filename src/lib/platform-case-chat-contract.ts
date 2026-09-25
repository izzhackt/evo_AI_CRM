/**
 * OTH-5 «Переписка по делу» — client-safe contract: types, the await-state
 * dictionary of values (labels live in v3/wording.ts, like every other
 * dictionary), and strict manual decode helpers. MUST stay free of any
 * server-only import (supabase/server is traced into the client bundle
 * otherwise — the Build gate enforces it, same discipline as
 * platform-admissions-pipeline-contract.ts and platform-team-chat.ts).
 */
export const CASE_CHAT_AWAIT_STATES = ["none", "needs_reply", "awaiting_student"] as const;
export type CaseChatAwaitState = (typeof CASE_CHAT_AWAIT_STATES)[number];

export const CASE_CHAT_QUEUES = ["all", "needs_reply", "awaiting_student"] as const;
export type CaseChatQueue = (typeof CASE_CHAT_QUEUES)[number];

export function parseCaseChatQueue(value: unknown): CaseChatQueue | null {
  if (value === undefined) return "all";
  return typeof value === "string" && (CASE_CHAT_QUEUES as readonly string[]).includes(value)
    ? value as CaseChatQueue : null;
}

export function isCaseChatListQuery(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Array.from(value.trim()).length <= 200);
}

export function caseChatHref(query: string, queue: CaseChatQueue, caseId: string | null = null, attachment: CaseChatPendingAttachment | null = null): string {
  const params = new URLSearchParams();
  if (caseId) params.set("case", caseId);
  if (query) params.set("q", query);
  if (queue !== "all") params.set("queue", queue);
  // An attachment belongs to its selected case, never to the list itself.
  if (caseId && attachment) params.set("attach", `${attachment.kind}:${attachment.id}`);
  const search = params.toString();
  return search ? `/v3/messages?${search}` : "/v3/messages";
}

export const CASE_CHAT_ATTACHMENT_KINDS = ["document", "case_task"] as const;
export type CaseChatAttachmentKind = (typeof CASE_CHAT_ATTACHMENT_KINDS)[number];

export const CASE_CHAT_BODY_LIMIT = 8000;

export type CaseChatQuotedPreview = Readonly<{
  id: string; authorName: string; bodyPreview: string;
}>;

export type CaseChatMessage = Readonly<{
  id: string; sequenceId: string; authorMembershipId: string; authorName: string;
  body: string; createdAt: string;
  quotedMessageId: string | null; quotedPreview: CaseChatQuotedPreview | null;
  attachmentKind: CaseChatAttachmentKind | null; attachmentId: string | null; attachmentLabel: string | null;
}>;

export type CaseChatThread = Readonly<{
  awaitState: CaseChatAwaitState; lastMessageAt: string | null; lastMessageSequenceId: string | null;
}>;

export type CaseChatPage = Readonly<{
  messages: readonly CaseChatMessage[]; cursor: string; hasMore: boolean;
  thread: CaseChatThread; readSequenceId: string;
}>;

/** Pages are newest-first (sequence DESC): an older page goes after the loaded messages. */
export function appendOlderCaseChatPage(loaded: CaseChatPage, older: CaseChatPage): CaseChatPage {
  return { ...older, messages: [...loaded.messages, ...older.messages] };
}

export type CaseChatThreadRow = Readonly<{
  studentCaseId: string; studentDisplayName: string; lastMessageSnippet: string | null;
  lastMessageAt: string | null; lastMessageAuthorMembershipId: string | null;
  awaitState: CaseChatAwaitState; unread: boolean;
}>;

export type CaseChatThreadsList = Readonly<{
  rows: readonly CaseChatThreadRow[]; truncated: boolean;
}>;

/** ?attach=document:<slotId> or ?attach=case_task:<taskId> — a pending link-card, removable before send. */
export type CaseChatPendingAttachment = Readonly<{ kind: CaseChatAttachmentKind; id: string }>;

export type CaseChatFailure = "invalid" | "forbidden" | "not_found" | "request_conflict" | "unavailable";
export type CaseChatActionState = Readonly<{
  status: "idle" | "saved" | CaseChatFailure; requestId: string | null;
}>;
export const CASE_CHAT_INITIAL_ACTION: CaseChatActionState = { status: "idle", requestId: null };

export const CASE_CHAT_FAILURE_COPY: Record<CaseChatFailure, string> = {
  invalid: "Проверьте текст, вложение и цитату. Сообщение должно содержать от 1 до 8000 символов.",
  forbidden: "Доступ к этому делу изменился. Обновите страницу.",
  not_found: "Сообщение или вложение больше не найдено. Обновите переписку.",
  request_conflict: "Этот запрос уже использован с другими данными. Обновите переписку и повторите.",
  unavailable: "Не удалось подтвердить результат. Черновик сохранён; повтор использует тот же запрос.",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function caseChatUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
export function caseChatCursor(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= BigInt("9223372036854775807");
}
export function isCaseChatAwaitState(value: unknown): value is CaseChatAwaitState {
  return typeof value === "string" && (CASE_CHAT_AWAIT_STATES as readonly string[]).includes(value);
}
export function isCaseChatAttachmentKind(value: unknown): value is CaseChatAttachmentKind {
  return typeof value === "string" && (CASE_CHAT_ATTACHMENT_KINDS as readonly string[]).includes(value);
}
/** Parses the ?attach= query param into a pending link-card, or null if absent/malformed. */
export function parseCaseChatAttachParam(value: string | null | undefined): CaseChatPendingAttachment | null {
  if (!value) return null;
  const [kind, id] = value.split(":");
  if (!isCaseChatAttachmentKind(kind) || !caseChatUuid(id)) return null;
  return { kind, id };
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export function caseChatBodyValid(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length >= 1 && Array.from(trimmed).length <= CASE_CHAT_BODY_LIMIT && !CONTROL_CHARACTER_PATTERN.test(trimmed);
}
