import { EVI_FAILURE_ACTION, type EviFailure } from "./evi.ts";
import type { EviMessage, EviOptions } from "./evi-conversation.ts";

/**
 * Разговор, который держат, пока открыт кабинет: реплики (без `fresh` — робот не реагирует заново), текущие варианты и
 * сбой, если он был («Разговор получился длинным» после возврата остаётся им, а не превращается в «Повторить»).
 */
export type EviSnapshot = Readonly<{ messages: readonly EviMessage[]; options: EviOptions; failure: EviFailure | null }>;
/**
 * Где держать разговор, пока открыт кабинет (решение владельца 17.11.2026: нигде не записывается, после перезагрузки или
 * выхода — заново). Веб передаёт память оболочки кабинета: переход на карточку профессии и «Назад» разговор не стирают.
 * Приложение не передаёт ничего — у него разговор живёт, пока открыт экран.
 */
export type EviMemory = Readonly<{ load(): EviSnapshot | null; save(snapshot: EviSnapshot | null): void }>;

/** Что держать: разговор, где ученик уже ответил; иначе — ничего. */
export function eviSnapshot(messages: readonly EviMessage[], options: EviOptions, failure: EviFailure | null): EviSnapshot | null {
  if (!messages.some((message) => message.role === "user")) return null;
  return { messages: messages.map(({ role, text, mood, results, progress }) => ({ role, text, mood, results, progress })), options, failure };
}

/**
 * Сбой после возврата: недоступность Эви на странице главнее всего. Затем сбой самого разговора, который был до ухода
 * («Разговор сбился», «получился длинным», «занят», «не получилось»). «Нет согласия» и «Эви недоступен» не
 * восстанавливаются: страница только что проверила их заново, и устаревшая копия заперла бы чат с одной ссылкой в каталог.
 * Ответ на последнюю реплику ученика не пришёл (ушёл, пока Эви печатала, или такой сбой) — её повторяют одной кнопкой.
 */
export function restoredEviFailure(snapshot: EviSnapshot | null, initialFailure: EviFailure | null): EviFailure | null {
  if (initialFailure !== null || !snapshot) return initialFailure;
  if (snapshot.failure !== null && EVI_FAILURE_ACTION[snapshot.failure] !== "catalog") return snapshot.failure;
  return snapshot.messages[snapshot.messages.length - 1]?.role === "user" ? "error" : null;
}

/** Память кабинета: один разговор с меткой ученика (`owner`). Другой метке она ничего не отдаёт. */
export type EviMemoryStore = Readonly<{
  load(owner: string): EviSnapshot | null;
  save(owner: string, snapshot: EviSnapshot | null): void;
}>;

export function createEviMemoryStore(): EviMemoryStore {
  let kept: Readonly<{ owner: string; snapshot: EviSnapshot }> | null = null;
  return {
    load: (owner) => (kept?.owner === owner ? kept.snapshot : null),
    save: (owner, snapshot) => { kept = snapshot ? { owner, snapshot } : null; },
  };
}
