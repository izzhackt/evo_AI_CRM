import { unstable_isUnrecognizedActionError } from "next/navigation";

/**
 * Открытая вкладка пережила выпуск (A1, аудит 10.10.2026). Id server action
 * меняются с каждой сборкой, и новый сервер отвечает на старый id
 * `404` с `x-nextjs-action-not-found: 1`, а клиент Next 16 бросает
 * `UnrecognizedActionError`. Повтор такого запроса не поможет никогда —
 * помогает только перезагрузка страницы. Поэтому:
 *
 * - `isStaleDeploymentError` узнаёт эту ошибку (и её форму-ответ), чтобы
 *   она не выглядела как «Нет связи»;
 * - один флаг на страницу: первый, кто её поймал, отмечает страницу, и все
 *   опросы останавливаются, а не шлют дальше заведомо мёртвые запросы;
 * - подсказка «Вышла новая версия — обновите страницу» показывается один раз:
 *   общая строка оболочки прячется, пока своё место показывает ту же подсказку
 *   (граница ошибок, панель уведомлений).
 *
 * Флаг живёт до перезагрузки: после неё это уже новая сборка.
 */
export const ACTION_NOT_FOUND_HEADER = "x-nextjs-action-not-found";

const NOT_FOUND_MESSAGE = /^Server Action "[^"]*" was not found on the server/;

type ResponseLike = { status?: unknown; headers?: { get?: unknown } };

function isActionNotFoundResponse(value: object): boolean {
  const { status, headers } = value as ResponseLike;
  if (status !== 404 || typeof headers?.get !== "function") return false;
  return (headers as { get(name: string): string | null }).get(ACTION_NOT_FOUND_HEADER) === "1";
}

/** Сервер не знает action этой вкладки: вкладка открыта на прошлой сборке. */
export function isStaleDeploymentError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) return true;
  if (typeof error !== "object" || error === null) return false;
  if (isActionNotFoundResponse(error)) return true;
  // Тот же класс из второй копии модуля Next не пройдёт instanceof — узнаём по
  // имени и по точной фразе Next.
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === "UnrecognizedActionError" || (typeof message === "string" && NOT_FOUND_MESSAGE.test(message));
}

let stale = false;
let inlinePrompts = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Страница на прошлой сборке: опросы стоят, подсказка видна. */
export function isStaleDeployment(): boolean {
  return stale;
}

export function markStaleDeployment(): void {
  if (stale) return;
  stale = true;
  emit();
}

/** Отмечает страницу и возвращает true, если `error` — ошибка прошлой сборки. */
export function noteStaleDeployment(error: unknown): boolean {
  if (!isStaleDeploymentError(error)) return false;
  markStaleDeployment();
  return true;
}

export function subscribeStaleDeployment(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Общая строка оболочки нужна, только пока подсказку не показывает своё место. */
export function shouldShowStaleDeploymentNotice(): boolean {
  return stale && inlinePrompts === 0;
}

/** Своё место показывает подсказку; вызов возвращает снятие этой отметки. */
export function holdInlineStalePrompt(): () => void {
  inlinePrompts += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inlinePrompts -= 1;
    emit();
  };
}

export function reloadForNewDeployment(): void {
  window.location.reload();
}
