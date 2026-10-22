"use client";

import { startTransition, useActionState, useCallback, useRef } from "react";

import { AI_AGENTS_IDLE, aiAgentsErrorCopy, type AiAgentsActionState } from "@/lib/v3/ai-agents-view";

type Action = (previous: AiAgentsActionState, form: FormData) => Promise<AiAgentsActionState>;

/**
 * Запуск серверного действия формой с id запроса, замороженным при повторе:
 * пока результат неизвестен (`unavailable`), тот же ввод уходит тем же id, и
 * база отвечает прежней квитанцией; другой ввод получает новый id. Id рождается
 * при отправке, а не в разметке, поэтому серверной разметке он не нужен.
 */
export function useAgentsAction(action: Action) {
  const frozen = useRef<{ fingerprint: string; id: string } | null>(null);
  const [state, run, pending] = useActionState(async (previous: AiAgentsActionState, form: FormData): Promise<AiAgentsActionState> => {
    try {
      const result = await action(previous, form);
      if (result.status === "saved" || (result.status === "failed" && result.code !== "unavailable")) frozen.current = null;
      return result;
    } catch {
      return { status: "failed", code: "unavailable", message: aiAgentsErrorCopy("unavailable"), requestId: previous.requestId };
    }
  }, AI_AGENTS_IDLE);

  const submit = useCallback((fields: Readonly<Record<string, string>>) => {
    const fingerprint = JSON.stringify(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
    const id = frozen.current?.fingerprint === fingerprint ? frozen.current.id : crypto.randomUUID();
    frozen.current = { fingerprint, id };
    const form = new FormData();
    form.set("request_id", id);
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    startTransition(() => run(form));
  }, [run]);

  return { state, pending, submit } as const;
}
