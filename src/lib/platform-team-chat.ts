import type { FixedRole } from "./fixed-role-policy.ts";

export const TEAM_CHAT_CHANNELS = ["general", "sales", "admissions"] as const;
export type TeamChatChannelKey = (typeof TEAM_CHAT_CHANNELS)[number];
export const TEAM_CHAT_LABELS: Record<TeamChatChannelKey, string> = {
  general: "Общий", sales: "Продажи", admissions: "Поступление",
};
export const TEAM_CHAT_BODY_LIMIT = 8000;
export const TEAM_CHAT_PAGE_MODES = ["latest", "before", "changes", "thread", "search", "message"] as const;
export type TeamChatPageMode = (typeof TEAM_CHAT_PAGE_MODES)[number];
export type TeamChatParticipant = Readonly<{ membershipId: string; displayName: string; role: FixedRole }>;
export type TeamChatChannel = Readonly<{
  key: TeamChatChannelKey; muted: boolean; preferenceVersion: string;
  readSequence: string; unreadCount: number; firstUnreadId: string | null;
}>;
export type TeamChatMessage = Readonly<{
  id: string; channelKey: TeamChatChannelKey; sequence: string; authorMembershipId: string;
  authorName: string; body: string; parentMessageId: string | null;
  mentionedMembershipIds: readonly string[]; version: string; createdAt: string;
  editedAt: string | null; deletedAt: string | null; replyCount: number;
  /** Enriched only after independent source AND task authorization. */
  linkedTaskIds?: readonly string[];
}>;
export type TeamChatPage = Readonly<{
  messages: readonly TeamChatMessage[]; cursor: string; watermark: string;
  hasMore: boolean; latestMessageId: string | null; rootId: string | null;
}>;
export type TeamChatQuery = Readonly<{
  channel: TeamChatChannelKey; mode: TeamChatPageMode; cursor?: string;
  messageId?: string | null; query?: string | null;
}>;
export type TeamChatSnapshot = Readonly<{
  page: TeamChatPage; channels: readonly TeamChatChannel[]; participants: readonly TeamChatParticipant[];
}>;
export type TeamChatFailure = "invalid" | "forbidden" | "conflict" | "not_found" | "unavailable";
export type TeamChatActionState = Readonly<{
  status: "idle" | "saved" | TeamChatFailure; requestId: string | null; messageId: string | null;
}>;
export const TEAM_CHAT_INITIAL_ACTION: TeamChatActionState = { status: "idle", requestId: null, messageId: null };
export const TEAM_CHAT_FAILURE_COPY: Record<TeamChatFailure, string> = {
  invalid: "Проверьте текст и выбранных участников. Сообщение должно содержать от 1 до 8000 символов.",
  forbidden: "Доступ изменился. Обновите страницу или войдите снова. Новые сообщения недоступны.",
  conflict: "Сообщение уже изменилось или этот запрос был использован. Обновите данные и проверьте черновик перед повтором.",
  not_found: "Сообщение недоступно. Обновите историю канала.",
  unavailable: "Не удалось подтвердить результат. Черновик сохранён в этой вкладке; повтор использует тот же запрос.",
};

export function isTeamChatChannel(value: unknown): value is TeamChatChannelKey {
  return typeof value === "string" && TEAM_CHAT_CHANNELS.some((key) => key === value);
}
export function teamChatRoleCanAccess(role: FixedRole, channel: TeamChatChannelKey): boolean {
  return role === "admin" || channel === "general" || role === channel;
}
export function teamChatUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function teamChatCursor(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= BigInt("9223372036854775807");
}
export function teamChatValidQuery(value: TeamChatQuery): boolean {
  return Boolean(value && isTeamChatChannel(value.channel) && TEAM_CHAT_PAGE_MODES.includes(value.mode)
    && (value.cursor === undefined || teamChatCursor(value.cursor))
    && (value.messageId == null || teamChatUuid(value.messageId))
    && (!["thread", "message"].includes(value.mode) || teamChatUuid(value.messageId))
    && (value.mode !== "search" || (typeof value.query === "string" && value.query.trim().length >= 2 && value.query.length <= 200)));
}
export function teamChatMergeMessages(current: readonly TeamChatMessage[], incoming: readonly TeamChatMessage[]): TeamChatMessage[] {
  const indexed = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previous = indexed.get(message.id);
    if (!previous || BigInt(message.version) >= BigInt(previous.version)) indexed.set(message.id, message);
  }
  return Array.from(indexed.values()).sort((left, right) => BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1);
}
