"use client";

import { useQueueKeyboard } from "./useQueueKeyboard";

/**
 * Клавиатура очереди для страницы, чьи строки рисует сервер: тот же
 * `useQueueKeyboard`, без собственной разметки.
 */
export function QueueKeyboard({ openKey = null }: Readonly<{ openKey?: string | null }>) {
  useQueueKeyboard({ openKey });
  return null;
}
