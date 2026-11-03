"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";

import type { AiActionState } from "@/lib/platform-ai-agent-actions";

type Status = AiActionState["status"];

const DEFAULT_MESSAGES: Readonly<Record<Exclude<Status, "idle">, string>> = {
  saved: "Сохранено.",
  conflict: "Данные уже изменились — обновите страницу.",
  forbidden: "Нет права на это действие.",
  invalid: "Проверьте данные и повторите.",
  consent_required: "Сначала администратор записывает согласие на Gemini.",
  unavailable: "Результат пока неизвестен — безопасно повторите.",
};

/**
 * Одна кнопка-команда раздела «ИИ-агент» (повтор обработки, «Проверено»,
 * согласие): скрытые поля и id запроса. Id меняется только после записи или
 * конфликта: повтор при неизвестном результате идёт тем же запросом, и база
 * возвращает прежнюю квитанцию. Ответ — строкой рядом, без всплывающих окон.
 */
export function AiActionForm({
  requestId: initialRequestId,
  action,
  fields,
  label,
  pendingLabel,
  buttonClassName,
  messages = {},
  children,
  testId,
}: Readonly<{
  /** Первый id запроса — с сервера (одна разметка на сервере и при гидратации). */
  requestId: string;
  action: (previous: AiActionState, form: FormData) => Promise<AiActionState>;
  fields: Readonly<Record<string, string>>;
  label: string;
  pendingLabel: string;
  buttonClassName: string;
  messages?: Partial<Record<Exclude<Status, "idle">, string>>;
  /** Текст над кнопкой (например, текст согласия). */
  children?: ReactNode;
  testId?: string;
}>) {
  const [requestId, setRequestId] = useState(initialRequestId);
  const [state, run, pending] = useActionState(async (previous: AiActionState, form: FormData): Promise<AiActionState> => {
    try {
      const result = await action(previous, form);
      if (result.status === "saved" || result.status === "conflict" || result.status === "invalid") setRequestId(crypto.randomUUID());
      return result;
    } catch {
      return { status: "unavailable", requestId: previous.requestId };
    }
  }, { status: "idle", requestId: null });
  const message = state.status === "idle" ? null : messages[state.status] ?? DEFAULT_MESSAGES[state.status];
  return (
    <form
      data-testid={testId}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => run(form));
      }}
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      {children}
      <input type="hidden" name="request_id" value={requestId} />
      {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <button type="submit" className={buttonClassName} disabled={pending}>{pending ? pendingLabel : label}</button>
      {message ? (
        <p role={state.status === "saved" ? "status" : "alert"} className={`t-body-compact ${state.status === "saved" ? "text-fg-2" : "text-danger"}`}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
