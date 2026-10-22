"use client";

import Link from "next/link";
import { useState } from "react";

import { btnCls, btnGhostCls } from "@/components/ui";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { AI_AGENT_DRAFT_CHANNEL_LABELS, AI_AGENT_LIMITS, type AiAgentDraftRow } from "@/lib/ai-agents/contract";
import { decideAiAgentDraftAction } from "@/lib/platform-ai-agents-actions";
import { draftStatusWords, draftTargetHref, formatDateTimeRu, relativeTimeRu } from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "./Notices";
import { useAgentsAction } from "./useAgentsAction";

/**
 * Черновик сообщения клиенту (контракт §D.4, п. 4): входящее сообщение клиента,
 * ответ агента (в очереди его можно поправить на месте), причина. Одобрить
 * может только держатель `ai.agent.manage`; результат — словами, в том числе
 * «Не отправлено: WhatsApp сейчас не подключён» и что черновик остаётся в очереди.
 */
export function DraftCard({
  draft,
  canManage,
  now,
}: Readonly<{ draft: AiAgentDraftRow; canManage: boolean; now: string }>) {
  const [text, setText] = useState(draft.text);
  const { state, pending, submit } = useAgentsAction(decideAiAgentDraftAction);
  const decided = state.status === "saved" && (state.draftStatus === "sent" || state.draftStatus === "discarded");
  const effective = draft.status === "pending" && !decided;
  const words = draftStatusWords(draft);
  const href = draftTargetHref(draft);
  const max = draft.channel === "whatsapp" ? AI_AGENT_LIMITS.whatsappTextMaxChars : AI_AGENT_LIMITS.portalTextMaxChars;
  const edited = text.trim() !== draft.text.trim();
  const failure = state.failureCode ?? (draft.status === "pending" ? draft.failureCode : null);
  const label = state.draftStatus === "sent" ? { label: "Отправлен", tone: "ok" as const }
    : state.draftStatus === "discarded" ? { label: "Отклонён", tone: "neutral" as const }
      : { label: words.label, tone: words.tone };

  function decide(decision: "approve" | "discard") {
    submit({ draft_id: draft.id, decision, edited_text: decision === "approve" && edited ? text : "" });
  }

  return (
    <article className="rounded-card border border-border bg-surface p-4" data-testid="v3-aia-draft" data-status={draft.status} aria-labelledby={`aia-draft-${draft.id}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusChip label={label.label} tone={label.tone} />
        <h3 id={`aia-draft-${draft.id}`} className="t-item min-w-0 text-fg">
          {AI_AGENT_DRAFT_CHANNEL_LABELS[draft.channel]}
          {draft.targetLabel ? " · " : ""}
          {draft.targetLabel ? (href ? <Link href={href} className="underline underline-offset-4">{draft.targetLabel}</Link> : draft.targetLabel) : null}
        </h3>
        <span className="t-meta text-fg-3">
          {relativeTimeRu(draft.createdAt, now)}
          {draft.status === "pending" ? ` · действует до ${formatDateTimeRu(draft.expiresAt, now).split(",")[0]}` : ""}
        </span>
      </header>

      {draft.sourceMessage ? (
        <div className="mt-3 rounded-nav bg-surface-2 px-3 py-2">
          <p className="t-meta text-fg-3">Клиент написал · {formatDateTimeRu(draft.sourceMessage.at, now)}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words t-body-compact text-fg">{draft.sourceMessage.text}</p>
        </div>
      ) : null}

      <div className="mt-3">
        {effective && canManage ? (
          <>
            <label htmlFor={`aia-draft-text-${draft.id}`} className="mb-1 block t-label text-fg-2">Ответ агента — можно поправить перед отправкой</label>
            <textarea
              id={`aia-draft-text-${draft.id}`}
              value={text}
              maxLength={max}
              rows={4}
              disabled={pending}
              onChange={(event) => setText(event.target.value)}
              className="min-h-28 w-full resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-base text-fg focus-visible:border-accent disabled:bg-surface-2"
              data-testid="v3-aia-draft-text"
            />
            <p className="mt-1 flex justify-between gap-2 t-meta text-fg-3">
              <span>{edited ? "Текст изменён вами" : "Текст агента без правок"}</span>
              <span className="tabular-nums">{text.length} из {max}</span>
            </p>
          </>
        ) : (
          <>
            <p className="t-meta text-fg-3">{draft.editedText ? "Отправленный текст (поправлен сотрудником)" : "Ответ агента"}</p>
            <p className="whitespace-pre-wrap break-words t-body-compact text-fg">{draft.editedText ?? draft.text}</p>
          </>
        )}
      </div>

      {draft.reason ? <p className="mt-2 t-meta text-fg-3">Почему агент так ответил: {draft.reason}</p> : null}
      {words.note && draft.status !== "sent" ? <p className="mt-2 t-body-compact text-fg-2">{words.note}</p> : null}
      {draft.status === "sent" || draft.status === "discarded" ? (
        <p className="mt-1 t-meta text-fg-3">
          {draft.decidedByName ? `Решение: ${draft.decidedByName}` : draft.sentByAgent ? "Отправил агент сам (Авто)" : ""}
          {draft.decidedAt || draft.sentAt ? ` · ${formatDateTimeRu(draft.decidedAt ?? draft.sentAt, now)}` : ""}
        </p>
      ) : null}
      {failure === "whatsapp_unavailable" && draft.channel === "whatsapp" ? (
        <p className="mt-2 t-body-compact text-fg-2">
          Подключите WhatsApp в <Link href="/v3/settings" className="underline underline-offset-4">Настройки → Интеграции</Link> — затем одобрите черновик ещё раз.
        </p>
      ) : null}

      {effective && canManage ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={btnCls} disabled={pending || !text.trim()} onClick={() => decide("approve")} data-testid="v3-aia-approve">
            {pending ? "Отправляю…" : "Одобрить и отправить"}
          </button>
          <button type="button" className={btnGhostCls} disabled={pending} onClick={() => decide("discard")} data-testid="v3-aia-discard">Отклонить</button>
        </div>
      ) : effective ? (
        <p className="mt-3 t-meta text-fg-3">Решает сотрудник с правом управлять ИИ-агентами.</p>
      ) : null}
      <div className="mt-2"><ActionMessage state={state} /></div>
    </article>
  );
}
