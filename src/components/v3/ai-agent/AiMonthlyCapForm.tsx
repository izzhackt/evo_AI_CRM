"use client";

import { startTransition, useActionState, useId, useState } from "react";

import { btnGhostCls, fieldLabelCls, inputCls } from "@/components/ui";
import { saveAiMonthlyCapAction, type AiActionState } from "@/lib/platform-ai-agent-actions";

const MESSAGES: Readonly<Record<Exclude<AiActionState["status"], "idle">, string>> = {
  saved: "Лимит сохранён.",
  conflict: "Настройки уже изменились — обновите страницу.",
  forbidden: "Нет права менять лимит.",
  invalid: "Лимит — число от 0 до 100 000 долларов.",
  consent_required: "Сначала администратор записывает согласие на Gemini.",
  unavailable: "Результат пока неизвестен — безопасно сохраните ещё раз.",
};

/**
 * Месячный лимит расходов на ИИ (план §10): при исчерпании ИИ-вызовы
 * отклоняются с понятным сообщением в окне чата. Тихая кнопка — у страницы
 * «Расходы» нет красного действия.
 */
export function AiMonthlyCapForm({
  capUsd,
  expectedVersion,
  requestId: initialRequestId,
}: Readonly<{ capUsd: number; expectedVersion: number; requestId: string }>) {
  const fieldId = useId();
  const [requestId, setRequestId] = useState(initialRequestId);
  const [state, run, pending] = useActionState(async (previous: AiActionState, form: FormData): Promise<AiActionState> => {
    try {
      const result = await saveAiMonthlyCapAction(previous, form);
      if (result.status === "saved" || result.status === "conflict" || result.status === "invalid") setRequestId(crypto.randomUUID());
      return result;
    } catch {
      return { status: "unavailable", requestId: previous.requestId };
    }
  }, { status: "idle", requestId: null });
  return (
    <form
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => run(form));
      }}
      className="flex flex-wrap items-end gap-x-3 gap-y-2"
      data-testid="v3-ai-cap-form"
    >
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="expected_version" value={String(expectedVersion)} />
      <div className="w-40">
        <label htmlFor={fieldId} className={fieldLabelCls}>Лимит на месяц, $</label>
        <input
          id={fieldId}
          name="monthly_cap_usd"
          inputMode="decimal"
          required
          maxLength={9}
          defaultValue={String(capUsd)}
          className={`${inputCls} tabular-nums`}
        />
      </div>
      <button type="submit" className={btnGhostCls} disabled={pending}>{pending ? "Сохраняю…" : "Сохранить лимит"}</button>
      {state.status !== "idle" ? (
        <p role={state.status === "saved" ? "status" : "alert"} className={`basis-full t-body-compact ${state.status === "saved" ? "text-fg-2" : "text-danger"}`}>
          {MESSAGES[state.status]}
        </p>
      ) : null}
    </form>
  );
}
