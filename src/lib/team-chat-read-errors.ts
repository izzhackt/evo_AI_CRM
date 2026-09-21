import type { TeamChatChannelKey, TeamChatFailure } from "./platform-team-chat.ts";
import type { TeamChatTimelineQuery } from "./platform-team-chat-timeline.ts";

export type TeamChatReadAttempt = Readonly<
  | { kind: "search"; channel: TeamChatChannelKey; term: string; cursor?: string; append: boolean }
  | { kind: "navigate"; input: TeamChatTimelineQuery; returnPoint: boolean }
  | { kind: "extend"; input: Extract<TeamChatTimelineQuery, { mode: "before" | "after" }> }
  | { kind: "refresh"; channel: TeamChatChannelKey; cursor: string }
  | { kind: "resume-edit"; channel: TeamChatChannelKey; messageId: string }
>;
export type TeamChatReadOwner = "foreground" | "background";
export type TeamChatReadTicket = Readonly<{
  id: number; attempt: TeamChatReadAttempt; failure: TeamChatFailure | null; pending: boolean;
}>;
export type TeamChatReadErrors = Readonly<{
  forbidden: boolean; foreground: TeamChatReadTicket | null; background: TeamChatReadTicket | null;
}>;
export type TeamChatReadEvent =
  | { type: "begin"; owner: TeamChatReadOwner; id: number; attempt: TeamChatReadAttempt }
  | { type: "settle"; owner: TeamChatReadOwner; id: number; failure: TeamChatFailure | null }
  | { type: "cancel"; owner: TeamChatReadOwner }
  | { type: "forbidden" };

export function emptyTeamChatReadErrors(): TeamChatReadErrors {
  return { forbidden: false, foreground: null, background: null };
}

/** A partially hydrated refresh must leave its tail marker available to retry. */
export async function hydrateTeamChatRefreshTail(input: {
  tailChanged: boolean;
  hydrateContexts: () => Promise<boolean>;
  hydrateAfter: () => Promise<boolean>;
  commitTail: () => void;
}): Promise<boolean> {
  if (!await input.hydrateContexts()) return false;
  if (input.tailChanged && !await input.hydrateAfter()) return false;
  input.commitTail();
  return true;
}

/** Read errors belong to a particular operation, never to a write or another lane. */
export function reduceTeamChatReadErrors(state: TeamChatReadErrors, event: TeamChatReadEvent): TeamChatReadErrors {
  if (state.forbidden) return state;
  // Access revocation is terminal even when the response belongs to an old read.
  if (event.type === "forbidden" || (event.type === "settle" && event.failure === "forbidden")) {
    return { forbidden: true, foreground: null, background: null };
  }
  if (event.type === "cancel") return state[event.owner] ? { ...state, [event.owner]: null } : state;
  if (event.type === "begin") {
    const attempt = "input" in event.attempt
      ? { ...event.attempt, input: { ...event.attempt.input } } as TeamChatReadAttempt
      : { ...event.attempt };
    // Periodic catch-up must not hide an unresolved refresh error while it is
    // merely trying again. A new explicit foreground task replaces its issue.
    const failure = event.owner === "background" ? state.background?.failure ?? null : null;
    return { ...state, [event.owner]: { id: event.id, attempt, failure, pending: true } };
  }
  const ticket = state[event.owner];
  if (!ticket || ticket.id !== event.id) return state;
  return { ...state, [event.owner]: event.failure ? { ...ticket, failure: event.failure, pending: false } : null };
}

/** Keep a background issue available without replacing a failed foreground task. */
export function visibleTeamChatReadFailure(state: TeamChatReadErrors): { owner: TeamChatReadOwner; ticket: TeamChatReadTicket } | null {
  if (state.forbidden) return null;
  for (const owner of ["foreground", "background"] as const) {
    const ticket = state[owner];
    if (ticket?.failure) return { owner, ticket };
  }
  return null;
}

export function teamChatReadFailureCopy(ticket: TeamChatReadTicket): { message: string; retryLabel: string | null } {
  const { attempt, failure } = ticket;
  if (failure === "forbidden") return { message: "Доступ к каналу изменился. Войдите снова.", retryLabel: null };
  if (failure === "not_found") return { message: "Сообщение недоступно. Вернитесь к истории канала.", retryLabel: null };
  if (failure === "invalid") return { message: attempt.kind === "search" ? "Проверьте поисковый запрос." : "Не удалось прочитать выбранную часть истории. Откройте её заново.", retryLabel: null };
  if (attempt.kind === "resume-edit") return { message: "Не удалось загрузить сообщение для правки. Повторите восстановление правки в редакторе.", retryLabel: null };
  if (attempt.kind === "search") return { message: "Не удалось выполнить поиск. Повторите попытку.", retryLabel: "Повторить поиск" };
  if (attempt.kind === "refresh") return { message: "Не удалось обновить историю канала. Повторите попытку.", retryLabel: "Повторить обновление" };
  if (attempt.kind === "navigate" && attempt.input.mode === "context") return { message: "Не удалось открыть сообщение в переписке. Повторите попытку.", retryLabel: "Открыть сообщение снова" };
  return { message: "Не удалось загрузить сообщения. Повторите попытку.", retryLabel: "Повторить загрузку" };
}
