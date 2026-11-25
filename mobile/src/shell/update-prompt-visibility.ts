// Видна ли карточка «Вышла новая версия» (features/app/UpdatePrompt). Карточка «Не удалось обновить уведомления»
// (shell/PollFailureNotice) стоит в том же углу и уступает ей место, пока та ВИДНА. Видна она не пока обновление скачано, а пока оно
// скачано и студент не нажал «Позже»: после «Позже» обновление остаётся скачанным до перезапуска, и сбой опроса опять нужно показывать
// (у веба «Позже» нет: там карточка сбоя скрывается только при устаревшей версии, `failed && !stale`).
import { useSyncExternalStore } from "react";

let promptVisible = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Карточка обновления сообщает, видна ли она сейчас; при исчезновении (в том числе при размонтировании) сообщает «нет». */
export function reportUpdatePromptVisible(visible: boolean): void {
  const next = Boolean(visible);
  if (promptVisible === next) return;
  promptVisible = next;
  for (const listener of [...listeners]) listener();
}

/** Видна ли сейчас карточка «Вышла новая версия». */
export function useUpdatePromptVisible(): boolean {
  return useSyncExternalStore(subscribe, () => promptVisible, () => false);
}
