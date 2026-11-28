"use client";

import { useId, type FormEvent } from "react";

import type { AgentSuggestion } from "@/lib/agent-suggestions-contract";
import { agentSuggestionWords as words } from "@/lib/v3/wording";

import { formatQueueDay } from "../queue/due-bucket";
import { QUEUE_CONFIRM, QUEUE_FIELD, QUEUE_SECONDARY } from "../queue/queue-buttons";

/**
 * Строка предложения агента под «Шаг не задан»: его слова (текст, срок, исполнитель, «почему» мелко), «Принять» и «Не то».
 * «Не то» раскрывает одну необязательную строку причины. Решения принимает родитель (`AgentNextStep`); исполнитель только
 * показывается: у шага дела нет такого поля.
 */
export function AgentSuggestionRow({ suggestion, today, editable, version, busy, asking, reason, onReason, onAsk, onAccept, onDismiss }: Readonly<{
  suggestion: AgentSuggestion;
  today: string;
  editable: boolean;
  version: string | null;
  busy: "accept" | "dismiss" | null;
  asking: boolean;
  reason: string;
  onReason: (value: string) => void;
  onAsk: (value: boolean) => void;
  onAccept: () => void;
  onDismiss: (event: FormEvent) => void;
}>) {
  const reasonId = useId();
  return (
    <div className="flex flex-col gap-2 border-s-2 border-border ps-3" data-testid="v3-agent-suggestion" aria-label={words.proposalLabel}>
      <p className="t-caption text-fg-2">{suggestion.agentTitle ? `${words.proposalLabel} · ${suggestion.agentTitle}` : words.proposalLabel}</p>
      <p className="min-w-0 break-words t-body-compact text-fg" data-testid="v3-agent-suggestion-text">{suggestion.text}</p>
      <p className="flex flex-wrap items-baseline gap-x-3 t-body-compact text-fg-2">
        {suggestion.dueOn ? <span>{words.due}: <time dateTime={suggestion.dueOn} className="font-mono tabular-nums">{formatQueueDay(suggestion.dueOn, today)}</time></span> : null}
        {suggestion.assigneeName ? <span>{words.assignee}: {suggestion.assigneeName}</span> : null}
      </p>
      <p className="t-caption text-fg-2" data-testid="v3-agent-suggestion-reason">{words.why}: {suggestion.reason}</p>
      {editable ? (
        asking ? (
          <form onSubmit={onDismiss} className="flex flex-col gap-2" data-testid="v3-agent-dismiss-form">
            <label htmlFor={reasonId} className="t-label text-fg">{words.dismissReasonLabel}</label>
            <input id={reasonId} value={reason} maxLength={300} onChange={(event) => onReason(event.target.value)} autoComplete="off"
              disabled={busy !== null} className={QUEUE_FIELD} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy !== null} className={QUEUE_CONFIRM}>{busy === "dismiss" ? words.dismissing : words.dismissSend}</button>
              <button type="button" disabled={busy !== null} onClick={() => { onAsk(false); onReason(""); }} className={QUEUE_SECONDARY}>{words.dismissCancel}</button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null || version === null} onClick={onAccept} className={QUEUE_CONFIRM}>
              {busy === "accept" ? words.accepting : words.accept}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => onAsk(true)} className={QUEUE_SECONDARY}>{words.dismiss}</button>
          </div>
        )
      ) : null}
    </div>
  );
}
