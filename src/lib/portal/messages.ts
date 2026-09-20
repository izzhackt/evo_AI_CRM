/**
 * Чистые помощники «Сообщений по делу» (PORT-5c, план §6 «Общение»).
 * Серверный контракт — миграция 200 поверх модели чата 191. Файл
 * клиент-безопасный: только типы и строгие парсеры, никакого транспорта.
 */
import { universityUuid } from "../platform-university-catalog.ts";

export const PORTAL_CASE_MESSAGE_BODY_LIMIT = 2000;

export const PORTAL_CASE_CHAT_AWAIT_STATES = [
  "none",
  "needs_reply",
  "awaiting_student",
] as const;

export type PortalCaseChatAwaitState =
  (typeof PORTAL_CASE_CHAT_AWAIT_STATES)[number];

export type PortalCaseMessage = Readonly<{
  id: string;
  /** BIGINT из БД приходит строкой; сравнение — только через BigInt. */
  sequenceId: string;
  mine: boolean;
  authorName: string;
  body: string;
  createdAt: string;
  attachmentKind: "document" | "case_task" | null;
  attachmentLabel: string | null;
  quotedBodyPreview: string | null;
}>;

export type PortalCaseMessagesPage = Readonly<{
  /** Как отдаёт RPC: новые первыми (DESC по sequenceId). */
  messages: readonly PortalCaseMessage[];
  cursor: string;
  hasMore: boolean;
  awaitState: PortalCaseChatAwaitState;
}>;

export type PortalCaseMessagePostReceipt = Readonly<{
  requestId: string;
  messageId: string;
  sequenceId: string;
  createdAt: string;
}>;

export type PortalCaseMessagesLoadResult =
  | Readonly<{ ok: true; page: PortalCaseMessagesPage }>
  | Readonly<{ ok: false }>;

export type PortalCaseMessageSendResult =
  | Readonly<{ ok: true; receipt: PortalCaseMessagePostReceipt }>
  | Readonly<{ ok: false }>;

const SEQUENCE_PATTERN = /^(0|[1-9][0-9]{0,18})$/;

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && !Number.isNaN(Date.parse(value))
  );
}

function sequence(value: unknown): value is string {
  return typeof value === "string" && SEQUENCE_PATTERN.test(value);
}

/** Строгий разбор одной строки сообщения: любое отклонение формы — null. */
export function parsePortalCaseMessage(value: unknown): PortalCaseMessage | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",")
    !== "attachmentKind,attachmentLabel,authorName,body,createdAt,id,mine,quotedBodyPreview,sequenceId"
  ) return null;
  if (
    !universityUuid(row.id)
    || !sequence(row.sequenceId)
    || typeof row.mine !== "boolean"
    || typeof row.authorName !== "string" || row.authorName.length < 1 || row.authorName.length > 200
    || typeof row.body !== "string" || row.body.length > 8000
    || !timestamp(row.createdAt)
    || (row.attachmentKind !== null && row.attachmentKind !== "document" && row.attachmentKind !== "case_task")
    || (row.attachmentLabel !== null
      && (typeof row.attachmentLabel !== "string" || row.attachmentLabel.length > 300))
    || (row.attachmentKind === null && row.attachmentLabel !== null)
    || (row.quotedBodyPreview !== null
      && (typeof row.quotedBodyPreview !== "string" || row.quotedBodyPreview.length > 140))
  ) return null;
  return {
    id: row.id as string,
    sequenceId: row.sequenceId,
    mine: row.mine,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt,
    attachmentKind: row.attachmentKind,
    attachmentLabel: row.attachmentLabel as string | null,
    quotedBodyPreview: row.quotedBodyPreview as string | null,
  };
}

/** Строгий разбор страницы portal_case_chat_page_v1. */
export function parsePortalCaseMessagesPage(value: unknown): PortalCaseMessagesPage | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "awaitState,cursor,hasMore,messages") return null;
  if (
    !Array.isArray(row.messages) || row.messages.length > 30
    || !sequence(row.cursor)
    || typeof row.hasMore !== "boolean"
    || !PORTAL_CASE_CHAT_AWAIT_STATES.includes(row.awaitState as PortalCaseChatAwaitState)
  ) return null;
  const messages: PortalCaseMessage[] = [];
  let previous: bigint | null = null;
  for (const entry of row.messages) {
    const message = parsePortalCaseMessage(entry);
    if (message === null) return null;
    const current = BigInt(message.sequenceId);
    // Контракт RPC: строго убывающие sequenceId (новые первыми, без дублей).
    if (previous !== null && current >= previous) return null;
    previous = current;
    messages.push(message);
  }
  return {
    messages: Object.freeze(messages),
    cursor: row.cursor,
    hasMore: row.hasMore,
    awaitState: row.awaitState as PortalCaseChatAwaitState,
  };
}

/** Строгий разбор receipt отправки portal_case_chat_post_v1. */
export function parsePortalCaseMessagePostReceipt(
  value: unknown,
): PortalCaseMessagePostReceipt | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",")
    !== "createdAt,messageId,mode,requestId,sequenceId,studentCaseId"
  ) return null;
  if (
    row.mode !== "portal_post"
    || !universityUuid(row.requestId)
    || !universityUuid(row.messageId)
    || !universityUuid(row.studentCaseId)
    || !sequence(row.sequenceId)
    || !timestamp(row.createdAt)
  ) return null;
  return {
    requestId: row.requestId as string,
    messageId: row.messageId as string,
    sequenceId: row.sequenceId,
    createdAt: row.createdAt,
  };
}

/**
 * Объединение уже загруженных сообщений со свежей страницей: ключ —
 * sequenceId, порядок — по возрастанию (старые выше). Поллинг и «показать
 * более ранние» сливаются без дублей и без потери загруженного окна.
 */
export function mergePortalCaseMessages(
  existing: readonly PortalCaseMessage[],
  incoming: readonly PortalCaseMessage[],
): readonly PortalCaseMessage[] {
  const byKey = new Map<string, PortalCaseMessage>();
  for (const message of [...existing, ...incoming]) byKey.set(message.sequenceId, message);
  return Object.freeze(
    [...byKey.values()].sort((left, right) => {
      const a = BigInt(left.sequenceId);
      const b = BigInt(right.sequenceId);
      return a < b ? -1 : a > b ? 1 : 0;
    }),
  );
}
