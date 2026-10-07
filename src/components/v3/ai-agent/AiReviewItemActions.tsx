"use client";

import { startTransition, useActionState, useId, useRef, useState, type FormEvent } from "react";

import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { resolveAiReviewItemAction, type AiActionState } from "@/lib/platform-ai-agent-actions";
import { aiDateTime } from "@/lib/v3/ai-agent";
import {
  AI_REVIEW_RESOLUTION_LABEL,
  AI_REVIEW_VALUE_LIMIT,
  isAiReviewCorrection,
  type AiReviewItem,
} from "@/lib/v3/ai-agent-knowledge";

const MESSAGES: Readonly<Record<Exclude<AiActionState["status"], "idle">, string>> = {
  saved: "Сохранено.",
  conflict: "Пункт уже решили — обновите страницу.",
  forbidden: "Нет права решать пункты сверки.",
  invalid: "Исправление — одна строка до 200 знаков.",
  consent_required: "Сначала администратор записывает согласие на Gemini.",
  unavailable: "Результат пока неизвестен — безопасно повторите.",
};

/**
 * Действия пункта «Листа сверки» (§7): «Подтвердить» (предложенное значение,
 * пункт решён сразу), «Исправить» (одна строка — пункт «применяется», пока
 * агент правит текст и фрагменты), «Оставить как есть», «Открыть снова».
 * Ожидаемый статус уходит в базу: двое не решат один пункт дважды.
 */
export function AiReviewItemActions({
  item,
  requestId: initialRequestId,
  canManage,
}: Readonly<{ item: AiReviewItem; requestId: string; canManage: boolean }>) {
  const ids = useId();
  const [requestId, setRequestId] = useState(initialRequestId);
  const [correcting, setCorrecting] = useState(false);
  const [value, setValue] = useState(item.proposed ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, run, pending] = useActionState(async (previous: AiActionState, form: FormData): Promise<AiActionState> => {
    try {
      const result = await resolveAiReviewItemAction(previous, form);
      if (result.status === "saved" || result.status === "conflict" || result.status === "invalid") setRequestId(crypto.randomUUID());
      if (result.status === "saved") setCorrecting(false);
      return result;
    } catch {
      return { status: "unavailable", requestId: previous.requestId };
    }
  }, { status: "idle", requestId: null });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const form = new FormData(event.currentTarget, submitter);
    startTransition(() => run(form));
  };

  const hidden = (action: string | null, withValue: boolean) => (
    <>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="item_id" value={item.id} />
      <input type="hidden" name="expected_status" value={item.status} />
      {action ? <input type="hidden" name="review_action" value={action} /> : null}
      {withValue ? null : <input type="hidden" name="value" value="" />}
    </>
  );
  const message = state.status === "idle" ? null : MESSAGES[state.status];

  if (item.status === "applying") {
    return <p role="status" className="t-body-compact text-fg-2" data-testid="v3-ai-review-applying">Исправление применяется…</p>;
  }
  if (item.status === "resolved" || item.status === "dismissed") {
    const label = item.resolution ? AI_REVIEW_RESOLUTION_LABEL[item.resolution] : item.status === "dismissed" ? "Оставлено как есть" : "Решено";
    return (
      <div className="space-y-1">
        <p className="t-body-compact text-fg-2">
          {label}
          {item.resolution === "corrected" && item.value ? <> — <span className="font-mono tabular-nums text-fg">{item.value}</span></> : null}
          {item.resolvedByName ? ` · ${item.resolvedByName}` : ""}
          {item.resolvedAt ? ` · ${aiDateTime(item.resolvedAt)}` : ""}
        </p>
        {canManage ? (
          <form onSubmit={submit} className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-busy={pending}>
            {hidden("reopen", false)}
            <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg disabled:text-fg-3">
              {pending ? "Открываю…" : "Открыть снова"}
            </button>
            {message ? <p role={state.status === "saved" ? "status" : "alert"} className={`t-body-compact ${state.status === "saved" ? "text-fg-2" : "text-danger"}`}>{message}</p> : null}
          </form>
        ) : null}
      </div>
    );
  }
  if (!canManage) return <p className="t-body-compact text-fg-3">Решает сотрудник с правом управления «ИИ-агентом».</p>;

  const valid = isAiReviewCorrection(value);
  return (
    <div className="space-y-2" data-testid="v3-ai-review-actions">
      {correcting ? (
        <form
          onSubmit={(event) => {
            if (!valid) {
              event.preventDefault();
              inputRef.current?.focus();
              return;
            }
            submit(event);
          }}
          className="space-y-2"
          aria-busy={pending}
        >
          {hidden("correct", true)}
          <label htmlFor={`${ids}-value`} className="block t-label text-fg-2">Верное значение</label>
          <input
            ref={inputRef}
            id={`${ids}-value`}
            name="value"
            autoFocus
            maxLength={AI_REVIEW_VALUE_LIMIT}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            aria-invalid={!valid || undefined}
            className="h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 font-mono t-body tabular-nums text-fg focus-visible:border-accent"
            data-testid="v3-ai-review-value"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={QUEUE_CONFIRM} disabled={pending} aria-disabled={!valid || undefined}>
              {pending ? "Сохраняю…" : "Сохранить исправление"}
            </button>
            <button type="button" className="inline-flex min-h-11 items-center px-2 t-label text-fg-2 underline underline-offset-4 hover:text-fg" onClick={() => setCorrecting(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2" aria-busy={pending}>
          {hidden(null, false)}
          {item.proposed !== null ? (
            <button type="submit" name="review_action" value="confirm" className={QUEUE_CONFIRM} disabled={pending} data-testid="v3-ai-review-confirm">
              Подтвердить
            </button>
          ) : null}
          <button type="button" className={QUEUE_SECONDARY} disabled={pending} onClick={() => { setValue(item.proposed ?? ""); setCorrecting(true); }}>
            Исправить
          </button>
          <button type="submit" name="review_action" value="dismiss" disabled={pending} className="inline-flex min-h-11 items-center px-2 t-label text-fg-2 underline underline-offset-4 hover:text-fg disabled:text-fg-3">
            Оставить как есть
          </button>
        </form>
      )}
      {message ? <p role={state.status === "saved" ? "status" : "alert"} className={`t-body-compact ${state.status === "saved" ? "text-fg-2" : "text-danger"}`}>{message}</p> : null}
    </div>
  );
}
