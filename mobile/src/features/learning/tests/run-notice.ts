// Плашка над заданиями: что сказать студенту и какое действие предложить. Правила взяты у веба
// (`AssessmentRunner.tsx`, блок `errorNotice`): текст по коду ошибки, «Показать сохранённые ответы» после конфликта
// и после неудачного чтения сохранённого, «Повторить сохранение», когда сохранение не подтверждено, и отдельная строка,
// если студент пытался уйти раньше, чем сервер подтвердил ответы (`exitBlocked` или `reloadBeforeExit`).
// Чего у веба нет и что добавлено для телефона: строка «ответы ещё не сохранены» (на телефоне есть выходы, которых защита не
// видит: меню ☰ и вкладки) и «Выйти без сохранения» после нескольких неудачных попыток подряд (без связи экран держал бы вечно).
import { ASSESSMENT_LEAVE_AFTER_FAILURES, type AssessmentUiState } from "@/features/learning/tests/assessment-session";

/** Строки веба (`tests`) и две строки приложения: `assess.unsavedNote` и `assess.swipeOff`. */
export type RunNoticeKey = "error.conflict" | "error.invalid" | "error.denied" | "error.unavailable" | "reloadUnavailable" | "reloadBeforeExit" | "exitBlocked" | "assess.unsavedNote" | "assess.swipeOff";
export type RunNoticeAction = "loadSaved" | "retrySave" | "leaveAnyway";
export type RunNotice = Readonly<{ messages: readonly RunNoticeKey[]; actions: readonly RunNoticeAction[] }>;

type NoticeState = Pick<AssessmentUiState, "error" | "saveStatus" | "reloadRequired" | "reload" | "unsaved" | "failures">;

/** Ответы ещё не лежат на сервере, и это уже не короткая отправка, а сбой (не подтверждено или нужна сверка): защита держит экран, а свайп назад выключен. */
export function isBlocked(state: Pick<AssessmentUiState, "saveStatus" | "reloadRequired" | "unsaved">): boolean {
  return state.unsaved && (state.reloadRequired || state.saveStatus === "unconfirmed");
}

/** `swipeOff`: на этом телефоне жест назад выключен, пока защита держит экран (iPhone; у Android «назад» идёт через защиту, как кнопка). */
export function runNotice(state: NoticeState, exitNotice: boolean, swipeOff = false): RunNotice {
  const messages: RunNoticeKey[] = [];
  const actions: RunNoticeAction[] = [];
  if (state.reloadRequired) {
    // Ответы на экране не сверены с сервером: чтение сохранённого не удалось (связь) или ещё не начиналось (конфликт).
    messages.push(state.reload === "failed" ? "reloadUnavailable" : "error.conflict");
    actions.push("loadSaved");
  } else if (state.error !== null) {
    messages.push(state.error === "invalid" ? "error.invalid" : state.error === "denied" ? "error.denied" : "error.unavailable");
    if (state.saveStatus === "unconfirmed" && state.unsaved) actions.push("retrySave");
  } else if (state.saveStatus === "unconfirmed") {
    messages.push("error.unavailable");
    if (state.unsaved) actions.push("retrySave");
  }
  if (exitNotice) messages.push(state.reloadRequired ? "reloadBeforeExit" : "exitBlocked");
  if (isBlocked(state)) {
    messages.push("assess.unsavedNote");
    if (swipeOff) messages.push("assess.swipeOff");
    if (state.failures >= ASSESSMENT_LEAVE_AFTER_FAILURES) actions.push("leaveAnyway");
  }
  return { messages, actions };
}
