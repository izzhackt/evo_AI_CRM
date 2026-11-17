"use client";

import { useRef, useState, useTransition } from "react";

import { setOwnAiConsentAction } from "@/lib/portal/ai-consent-actions";

/**
 * «Разрешить ИИ-помощников» — то же действие, что в «Профиле». Повтор после сбоя отправляет тот же идентификатор
 * попытки; после ответа сервера — `onDone` (экран разрешения перечитывает страницу, чат повторяет вопрос).
 */
export function useAllowAi(onDone: () => void) {
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null);

  function allow() {
    if (pending) return;
    requestId.current ??= crypto.randomUUID();
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await setOwnAiConsentAction("granted", requestId.current);
        if (!result.ok) { setFailed(true); return; }
        requestId.current = null;
        onDone();
      } catch {
        setFailed(true);
      }
    });
  }

  return { allow, pending, failed };
}
