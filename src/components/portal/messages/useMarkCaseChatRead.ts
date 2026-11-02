"use client";

import { useEffect, useRef } from "react";

import { markPortalCaseChatReadAction } from "@/lib/portal/messages-actions";
import { noteStaleDeployment } from "@/lib/stale-deployment";

/**
 * Показанный на экране чат считается прочитанным: уведомление о сообщениях снимается до последнего
 * показанного. Скрытая вкладка не читает: новое сообщение, пришедшее в неё, ждёт возвращения.
 */
export function useMarkCaseChatRead(newestSequenceId: string | null): void {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (newestSequenceId === null) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || sent.current === newestSequenceId) return;
      sent.current = newestSequenceId;
      void markPortalCaseChatReadAction(newestSequenceId)
        .then((result) => { if (!result.ok) sent.current = null; })
        .catch((cause: unknown) => { sent.current = null; noteStaleDeployment(cause); });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [newestSequenceId]);
}
