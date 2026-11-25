// Плашка над заданиями: что сказать студенту и какое действие предложить. Правила взяты у веба
// (`AssessmentRunner.tsx`, блок `errorNotice`): текст по коду ошибки, «Показать сохранённые ответы» после конфликта
// и после неудачного чтения сохранённого, «Повторить сохранение», когда сохранение не подтверждено, и отдельная строка,
// если студент пытался уйти раньше, чем сервер подтвердил ответы (`exitBlocked` или `reloadBeforeExit`).
import type { AssessmentUiState } from "@/features/learning/tests/assessment-session";

export type RunNoticeKey = "error.conflict" | "error.invalid" | "error.denied" | "error.unavailable" | "reloadUnavailable" | "reloadBeforeExit" | "exitBlocked";
export type RunNoticeAction = "loadSaved" | "retrySave";
export type RunNotice = Readonly<{ messages: readonly RunNoticeKey[]; action: RunNoticeAction | null }>;

type NoticeState = Pick<AssessmentUiState, "error" | "saveStatus" | "reloadRequired" | "reload" | "unsaved">;

export function runNotice(state: NoticeState, exitNotice: boolean): RunNotice {
  const messages: RunNoticeKey[] = [];
  let action: RunNoticeAction | null = null;
  if (state.reloadRequired) {
    // Ответы на экране не сверены с сервером: чтение сохранённого не удалось (связь) или ещё не начиналось (конфликт).
    messages.push(state.reload === "failed" ? "reloadUnavailable" : "error.conflict");
    action = "loadSaved";
  } else if (state.error !== null) {
    messages.push(state.error === "invalid" ? "error.invalid" : state.error === "denied" ? "error.denied" : "error.unavailable");
    if (state.saveStatus === "unconfirmed" && state.unsaved) action = "retrySave";
  } else if (state.saveStatus === "unconfirmed") {
    messages.push("error.unavailable");
    if (state.unsaved) action = "retrySave";
  }
  if (exitNotice) messages.push(state.reloadRequired ? "reloadBeforeExit" : "exitBlocked");
  return { messages, action };
}
