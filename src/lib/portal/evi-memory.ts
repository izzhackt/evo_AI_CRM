import type { EviFailure } from "./evi.ts";
import type { EviMessage, EviOptions } from "./evi-conversation.ts";

/** Разговор, который держат, пока открыт кабинет: реплики (без `fresh` — робот не реагирует заново) и текущие варианты. */
export type EviSnapshot = Readonly<{ messages: readonly EviMessage[]; options: EviOptions }>;
/**
 * Где держать разговор, пока открыт кабинет (решение владельца 17.11.2026: нигде не записывается, после перезагрузки или
 * выхода — заново). Веб передаёт память оболочки кабинета: переход на карточку профессии и «Назад» разговор не стирают.
 * Приложение не передаёт ничего — у него разговор живёт, пока открыт экран.
 */
export type EviMemory = Readonly<{ load(): EviSnapshot | null; save(snapshot: EviSnapshot | null): void }>;

/** Что держать: разговор, где ученик уже ответил; иначе — ничего. */
export function eviSnapshot(messages: readonly EviMessage[], options: EviOptions): EviSnapshot | null {
  if (!messages.some((message) => message.role === "user")) return null;
  return { messages: messages.map(({ role, text, mood, results, progress }) => ({ role, text, mood, results, progress })), options };
}

/** Ответ на последний вопрос не пришёл (ученик ушёл со страницы раньше) — тот же вопрос повторяют одной кнопкой. */
export function restoredEviFailure(snapshot: EviSnapshot | null, initialFailure: EviFailure | null): EviFailure | null {
  if (initialFailure !== null || !snapshot) return initialFailure;
  return snapshot.messages[snapshot.messages.length - 1]?.role === "user" ? "error" : null;
}
