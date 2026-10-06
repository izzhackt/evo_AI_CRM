"use client";

import { startTransition, useActionState, useId, useState } from "react";

import { btnCls, fieldLabelCls } from "@/components/ui";
import { saveAiRulesAction, type AiActionState } from "@/lib/platform-ai-agent-actions";
import { AI_RULES_BYTE_LIMIT, utf8Bytes } from "@/lib/v3/ai-agent";

const MESSAGES: Readonly<Record<Exclude<AiActionState["status"], "idle">, string>> = {
  saved: "Новая версия сохранена и уже действует. Её нужно проверить.",
  conflict: "Пока вы правили, кто-то сохранил другую версию. Скопируйте свой текст и обновите страницу.",
  forbidden: "Нет права менять «Правила общения».",
  invalid: "Текст пустой или длиннее 32 КБ.",
  consent_required: "Сначала администратор записывает согласие на Gemini.",
  unavailable: "Результат пока неизвестен. Текст остался в поле — безопасно сохраните ещё раз.",
};

/** Счётчик — только у предела (тихий интерфейс): от 90 % объёма. */
const COUNTER_FROM = Math.floor(AI_RULES_BYTE_LIMIT * 0.9);

/**
 * «Правила общения» (план §8): текст системного промпта. Сохранение не
 * перезаписывает версию — добавляет новую и делает её текущей (база держит
 * историю); ожидаемая текущая версия защищает от гонки двух правок. Текст
 * остаётся в поле до подтверждённой записи.
 */
export function AiRulesEditor({
  initialBody,
  expectedVersion,
  requestId: initialRequestId,
}: Readonly<{ initialBody: string; expectedVersion: number | null; requestId: string }>) {
  const fieldId = useId();
  const [body, setBody] = useState(initialBody);
  const [requestId, setRequestId] = useState(initialRequestId);
  const [state, run, pending] = useActionState(async (previous: AiActionState, form: FormData): Promise<AiActionState> => {
    try {
      const result = await saveAiRulesAction(previous, form);
      if (result.status === "saved" || result.status === "conflict" || result.status === "invalid") setRequestId(crypto.randomUUID());
      return result;
    } catch {
      return { status: "unavailable", requestId: previous.requestId };
    }
  }, { status: "idle", requestId: null });
  const bytes = utf8Bytes(body);
  const tooLong = bytes > AI_RULES_BYTE_LIMIT;
  const unchanged = body === initialBody;
  return (
    <form
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => run(form));
      }}
      className="space-y-3"
      data-testid="v3-ai-rules-editor"
    >
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="expected_version" value={expectedVersion === null ? "" : String(expectedVersion)} />
      <label htmlFor={fieldId} className={fieldLabelCls}>Текст правил</label>
      <textarea
        id={fieldId}
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={18}
        spellCheck
        aria-invalid={tooLong || undefined}
        className="block min-h-[18rem] w-full resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 t-body text-fg focus-visible:border-accent"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" className={btnCls} disabled={pending || unchanged || tooLong || !body.trim()}>
          {pending ? "Сохраняю…" : expectedVersion === null ? "Сохранить первую версию" : "Сохранить новую версию"}
        </button>
        {bytes >= COUNTER_FROM ? (
          <p className={`t-meta tabular-nums ${tooLong ? "text-danger" : "text-fg-3"}`}>
            {(bytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} из 32 КБ
          </p>
        ) : null}
        {state.status !== "idle" ? (
          <p role={state.status === "saved" ? "status" : "alert"} className={`t-body-compact ${state.status === "saved" ? "text-fg-2" : "text-danger"}`}>
            {MESSAGES[state.status]}
          </p>
        ) : null}
      </div>
    </form>
  );
}
