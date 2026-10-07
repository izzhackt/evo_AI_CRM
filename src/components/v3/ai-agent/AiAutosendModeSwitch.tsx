"use client";

import { startTransition, useActionState, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import type { AiActionState } from "@/lib/platform-ai-agent-actions";
import { AI_AUTOSEND_COPY, AI_AUTOSEND_MODE_LABEL } from "@/lib/v3/ai-agent-autosend";

type Mode = "shadow" | "live";

const FAILURES: Readonly<Record<Exclude<AiActionState["status"], "idle" | "saved">, string>> = {
  conflict: "Настройки изменились — обновите страницу.",
  forbidden: "Нет права менять режим автоответчика.",
  invalid: "Проверьте данные и повторите.",
  consent_required: "Пока нельзя: нужны три ночи проверки, подтверждённая строка о помощнике и снятая пауза.",
  unavailable: "Результат пока неизвестен — безопасно повторите.",
};

/**
 * Режим включённого автоответчика (план §11): «Проверка без отправки» ↔
 * «Отвечает». Два положения одной группой; выбранное — нейтральное
 * «выбрано», как у вкладок. «Отвечает» заперт, пока база не разрешит
 * (три ночи проверки, подтверждённая строка о помощнике, без паузы): кнопка
 * `aria-disabled` с причиной рядом, фокус не теряется. «Проверка без
 * отправки» — сразу записью; «Отвечает» (настоящие ответы клиентам) — только
 * после подтверждения плашкой под группой, как «Выключить автоответчик».
 * Итог — строкой под группой.
 */
export function AiAutosendModeSwitch({
  mode,
  lock,
  version,
  requestId: initialRequestId,
  action,
}: Readonly<{
  mode: Mode;
  /** Почему «Отвечает» нельзя («Нужно ещё 2 ночи проверки»); null — можно. */
  lock: string | null;
  version: number;
  requestId: string;
  action: (previous: AiActionState, form: FormData) => Promise<AiActionState>;
}>) {
  const id = useId();
  const [requestId, setRequestId] = useState(initialRequestId);
  const [confirming, setConfirming] = useState(false);
  const liveRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [state, run, pending] = useActionState(async (previous: AiActionState, form: FormData): Promise<AiActionState> => {
    try {
      const result = await action(previous, form);
      if (result.status === "saved" || result.status === "conflict" || result.status === "invalid") setRequestId(crypto.randomUUID());
      return result;
    } catch {
      return { status: "unavailable", requestId: previous.requestId };
    }
  }, { status: "idle", requestId: null });

  function submit(next: Mode) {
    setConfirming(false);
    const form = new FormData();
    form.set("request_id", requestId);
    form.set("expected_version", String(version));
    form.set("mode", next);
    startTransition(() => run(form));
  }

  function choose(next: Mode) {
    if (pending || next === mode || (next === "live" && lock)) return;
    if (next === "shadow") { submit("shadow"); return; }
    setConfirming(true);
    requestAnimationFrame(() => confirmRef.current?.focus());
  }

  function cancel() {
    setConfirming(false);
    requestAnimationFrame(() => liveRef.current?.focus());
  }

  const option = (value: Mode) => {
    const selected = value === mode;
    const locked = value === "live" && !selected && lock !== null;
    return (
      <button
        ref={value === "live" ? liveRef : undefined}
        type="button"
        aria-pressed={selected}
        aria-disabled={locked || pending || undefined}
        aria-describedby={locked ? `${id}-lock` : undefined}
        onClick={() => choose(value)}
        className="v3-choice inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-nav px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 aria-disabled:hover:bg-transparent"
        data-mode={value}
      >
        {locked ? <Icon name="lock" size={14} className="shrink-0" /> : null}
        {AI_AUTOSEND_MODE_LABEL[value]}
      </button>
    );
  };

  return (
    <div className="space-y-1" data-testid="v3-ai-autosend-mode" data-mode={mode}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id={`${id}-label`} className="t-label text-fg-2">Режим</span>
        <div role="group" aria-labelledby={`${id}-label`} aria-busy={pending || undefined}
          className="inline-flex flex-wrap gap-1 rounded-ctl border border-border bg-surface p-0.5">
          {option("shadow")}
          {option("live")}
        </div>
        {lock && mode === "shadow" ? (
          <span id={`${id}-lock`} className="t-meta text-fg-2" data-testid="v3-ai-autosend-lock">{lock}</span>
        ) : null}
      </div>
      {confirming && mode === "shadow" && !lock ? (
        <div role="group" aria-labelledby={`${id}-confirm`} data-testid="v3-ai-autosend-live-confirm"
          className="max-w-md space-y-2 rounded-ctl border border-border bg-bg px-3 py-2.5">
          <p id={`${id}-confirm`} className="t-body-compact text-fg">{AI_AUTOSEND_COPY.liveConfirm}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button ref={confirmRef} type="button" className={QUEUE_CONFIRM} aria-disabled={pending || undefined}
              onClick={() => {
                if (pending) return;
                submit("live");
                // Плашка закрывается — фокус возвращается на «Отвечает», итог — строкой под группой.
                requestAnimationFrame(() => liveRef.current?.focus());
              }}>
              {AI_AUTOSEND_COPY.liveConfirmAction}
            </button>
            <button type="button" onClick={cancel}
              className="inline-flex min-h-11 items-center t-label text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg">
              Отмена
            </button>
          </div>
        </div>
      ) : null}
      {state.status === "saved" ? (
        <p role="status" className="t-body-compact text-fg-2">Режим изменён.</p>
      ) : state.status !== "idle" ? (
        <p role="alert" className="t-body-compact text-danger">{FAILURES[state.status]}</p>
      ) : null}
    </div>
  );
}
