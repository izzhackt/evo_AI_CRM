"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";

import type { AiActionState } from "@/lib/platform-ai-agent-actions";
import { AI_MEMORY_SETTINGS_COPY } from "@/lib/v3/ai-agent-memory";

type Status = AiActionState["status"];
type MemoryAction = "enable" | "disable";
type ToggleState = AiActionState & Readonly<{ performed: MemoryAction | null }>;

const FAILURES: Readonly<Record<Exclude<Status, "idle" | "saved">, string>> = {
  conflict: "Настройки уже изменились — обновите страницу.",
  forbidden: "Нет права менять память о клиенте.",
  invalid: "Проверьте данные и повторите.",
  consent_required: AI_MEMORY_SETTINGS_COPY.noConsent,
  unavailable: "Результат пока неизвестен — безопасно повторите.",
};

const BLOCKED = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-surface aria-disabled:hover:text-fg-2 aria-disabled:active:scale-100";

/**
 * «Включить память» / «Выключить память» (P3, план §9; Q9 — любой сотрудник
 * с ai.agent.manage, Q12 — без согласия на Gemini не включается). Один
 * компонент на оба положения: после записи сервер перерисовывает страницу
 * (`revalidatePath`) и вид меняется, а строка итога (`role=status`) и фокус
 * остаются здесь — иначе «Память включена.» исчезла бы вместе с формой.
 * Id запроса меняется только после записи или конфликта: повтор при
 * неизвестном итоге идёт тем же id, и база вернёт прежнюю квитанцию.
 */
export function AiMemoryToggle({
  enabled,
  consentRecorded,
  version,
  requestId: initialRequestId,
  action,
  buttonClassName,
}: Readonly<{
  enabled: boolean;
  consentRecorded: boolean;
  version: number;
  /** Первый id запроса — с сервера (одна разметка на сервере и при гидратации). */
  requestId: string;
  action: (previous: AiActionState, form: FormData) => Promise<AiActionState>;
  buttonClassName: string;
}>) {
  const copy = AI_MEMORY_SETTINGS_COPY;
  const [requestId, setRequestId] = useState(initialRequestId);
  const [state, run, pending] = useActionState(async (previous: ToggleState, form: FormData): Promise<ToggleState> => {
    const performed = form.get("memory_action") === "disable" ? "disable" : "enable";
    try {
      const result = await action(previous, form);
      if (result.status === "saved" || result.status === "conflict" || result.status === "invalid") setRequestId(crypto.randomUUID());
      return { ...result, performed };
    } catch {
      return { status: "unavailable", requestId: previous.requestId, performed };
    }
  }, { status: "idle", requestId: null, performed: null });

  const enableRef = useRef<HTMLButtonElement>(null);
  const disableRef = useRef<HTMLElement>(null);
  const focused = useRef<ToggleState | null>(null);
  // Своя запись сменила вид — фокус на новое положение, а не на <body>. Новые
  // props (перерисовка страницы) и итог действия приходят в любом порядке:
  // фокус переносится, когда есть оба, и один раз на итог.
  useEffect(() => {
    if (state.status !== "saved" || !state.performed || focused.current === state) return;
    if (enabled !== (state.performed === "enable")) return;
    focused.current = state;
    (enabled ? disableRef.current : enableRef.current)?.focus();
  }, [enabled, state]);

  const saved = state.status === "saved" ? (state.performed === "disable" ? copy.disabled : copy.enabled) : null;
  const failure = state.status === "idle" || state.status === "saved" ? null : FAILURES[state.status];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => run(form));
  }
  const hidden = (memoryAction: MemoryAction) => (
    <>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="expected_version" value={String(version)} />
      <input type="hidden" name="memory_action" value={memoryAction} />
    </>
  );

  return (
    <div data-testid="v3-ai-memory-toggle">
      {!enabled && !consentRecorded ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="v3-ai-memory-blocked">
          <button
            ref={enableRef}
            type="button"
            className={`${buttonClassName} ${BLOCKED}`}
            aria-disabled="true"
            aria-describedby="ai-memory-consent-hint"
          >
            {copy.enable}
          </button>
          <p id="ai-memory-consent-hint" className="t-body-compact text-fg-2">{copy.noConsent}</p>
        </div>
      ) : !enabled ? (
        <form data-testid="v3-ai-memory-enable" aria-busy={pending} onSubmit={submit} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {hidden("enable")}
          <button ref={enableRef} type="submit" className={buttonClassName} disabled={pending}>{pending ? "Включаю…" : copy.enable}</button>
        </form>
      ) : (
        <details className="group" data-testid="v3-ai-memory-disable">
          <summary
            ref={disableRef}
            className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg [&::-webkit-details-marker]:hidden"
          >
            {copy.disable}
          </summary>
          <div className="space-y-1 pb-2">
            <p className="t-body-compact text-fg">{copy.disableConfirm}</p>
            <form data-testid="v3-ai-memory-disable-form" aria-busy={pending} onSubmit={submit} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {hidden("disable")}
              <button type="submit" className={buttonClassName} disabled={pending}>{pending ? "Выключаю…" : copy.disableSubmit}</button>
            </form>
          </div>
        </details>
      )}
      {/* Вне ветвей: смена вида после записи не уносит итог. Пустая строка высоты не занимает. */}
      <p role="status" className="t-body-compact text-fg-2" data-testid="v3-ai-memory-status">{saved}</p>
      {failure ? <p role="alert" className="t-body-compact text-danger" data-testid="v3-ai-memory-failure">{failure}</p> : null}
    </div>
  );
}
