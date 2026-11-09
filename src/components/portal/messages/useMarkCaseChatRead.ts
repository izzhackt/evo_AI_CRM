"use client";

import { useEffect, useRef, type RefObject } from "react";

import { markPortalCaseChatReadAction } from "@/lib/portal/messages-actions";
import { noteStaleDeployment } from "@/lib/stale-deployment";

/**
 * Показанный на экране чат считается прочитанным: уведомление о сообщениях снимается до последнего
 * показанного. Скрытая вкладка не читает: новое сообщение, пришедшее в неё, ждёт возвращения. Чат, скрытый
 * раскладкой (`shown` без размеров: список чатов на телефоне, 08.11.2026), тоже не читает — его откроют позже.
 */
export function useMarkCaseChatRead(
  newestSequenceId: string | null,
  shown: RefObject<HTMLElement | null> | null = null,
): void {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (newestSequenceId === null) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || sent.current === newestSequenceId) return;
      const element = shown?.current;
      if (element && element.getClientRects().length === 0) return;
      sent.current = newestSequenceId;
      void markPortalCaseChatReadAction(newestSequenceId)
        .then((result) => { if (!result.ok) sent.current = null; })
        .catch((cause: unknown) => { sent.current = null; noteStaleDeployment(cause); });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [newestSequenceId, shown]);
}
