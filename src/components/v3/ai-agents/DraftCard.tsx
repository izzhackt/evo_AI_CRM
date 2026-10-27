"use client";

import Link from "next/link";
import { useState } from "react";

import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { AI_AGENT_DRAFT_CHANNEL_LABELS, AI_AGENT_LIMITS, type AiAgentDraftRow } from "@/lib/ai-agents/contract";
import { decideAiAgentDraftAction } from "@/lib/platform-ai-agents-actions";
import { draftStatusWords, draftTargetHref, formatDateTimeRu, relativeTimeRu } from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "./Notices";
import { useAgentsAction } from "./useAgentsAction";
import { useDirtyGuard } from "./useDirtyGuard";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Счётчик знаков появляется, когда до предела остаётся мало. */
const COUNTER_FROM_SHARE = 0.9;

/**
 * Черновик сообщения клиенту (контракт §D.4, п. 4): входящее сообщение клиента,
 * ответ агента (в очереди его можно поправить на месте), причина. Одобрить
 * может только держатель `ai.agent.manage`; результат — словами, в том числе
 * «Не отправлено: WhatsApp сейчас не подключён» и что черновик остаётся в очереди.
 * Карточка, по которой нажали «Одобрить» или «Отклонить», остаётся на месте со статусом и
 * словом результата: `onDeciding` вызывается в момент нажатия и отдаёт её списку, потому что
 * сервер уже не вернёт её в «Ждут решения», а ответ и обновлённый список приходят вместе.
 * `bare` — карточка внутри панели «Нового вида»: рамки и заголовка с адресатом и временем нет (их уже называет заголовок
 * панели), остаются слово состояния, ссылка на переписку и «действует до …», пока срок близок.
 */
export function DraftCard({
  draft,
  canManage,
  now,
  onDeciding,
  bare = false,
}: Readonly<{ draft: AiAgentDraftRow; canManage: boolean; now: string; onDeciding?: () => void; bare?: boolean }>) {
  const [text, setText] = useState(draft.text);
  const { state, pending, submit } = useAgentsAction(decideAiAgentDraftAction);
  // Решение принято: любой итог, кроме «остаётся в очереди» (там карточка нужна для новой попытки).
  const outcome = state.draftStatus && state.draftStatus !== "pending" ? state.draftStatus : null;
  const decided = outcome !== null;
  const effective = draft.status === "pending" && !decided;
  const words = draftStatusWords(draft);
  const href = draftTargetHref(draft);
  const max = draft.channel === "whatsapp" ? AI_AGENT_LIMITS.whatsappTextMaxChars : AI_AGENT_LIMITS.portalTextMaxChars;
  const edited = text.trim() !== draft.text.trim();
  useDirtyGuard(effective && canManage && edited);
  const failure = state.failureCode ?? (draft.status === "pending" ? draft.failureCode : null);
  const label = outcome
    ? draftStatusWords({ status: outcome, failureCode: state.failureCode ?? null, sentByAgent: false })
    : words;
  // Срок называется, только когда он близок: «действует до 25 окт» у каждой карточки — шум.
  const expiresSoon = draft.status === "pending" && !decided && Date.parse(draft.expiresAt) - Date.parse(now) < DAY_MS;

  function decide(decision: "approve" | "discard") {
    onDeciding?.();
    submit({ draft_id: draft.id, decision, edited_text: decision === "approve" && edited ? text : "" });
  }

  return (
    <article className={bare ? undefined : "rounded-card border border-border bg-surface p-4"} data-testid="v3-aia-draft" data-status={outcome ?? draft.status} aria-labelledby={bare ? undefined : `aia-draft-${draft.id}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusChip label={label.label} tone={label.tone} />
        {bare ? (
          <>
            {href ? <Link href={href} className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4">{draft.channel === "whatsapp" ? "Открыть чат" : "Открыть переписку"}</Link> : null}
            {expiresSoon ? <span className="t-meta text-fg-3">действует до {formatDateTimeRu(draft.expiresAt, now)}</span> : null}
          </>
        ) : (
          <>
            <h3 id={`aia-draft-${draft.id}`} className="t-item min-w-0 text-fg">
              {AI_AGENT_DRAFT_CHANNEL_LABELS[draft.channel]}
              {draft.targetLabel ? " · " : ""}
              {draft.targetLabel ? (href ? <Link href={href} className="underline underline-offset-4">{draft.targetLabel}</Link> : draft.targetLabel) : null}
            </h3>
            <span className="t-meta text-fg-3">
              {relativeTimeRu(draft.createdAt, now)}
              {expiresSoon ? ` · действует до ${formatDateTimeRu(draft.expiresAt, now)}` : ""}
            </span>
          </>
        )}
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
            <label htmlFor={`aia-draft-text-${draft.id}`} className="mb-1 block t-label text-fg-2">Ответ агента</label>
            <textarea
              id={`aia-draft-text-${draft.id}`}
              value={text}
              maxLength={max}
              rows={4}
              disabled={pending}
              onChange={(event) => setText(event.target.value)}
              className="min-h-28 w-full resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 t-body text-fg focus-visible:border-accent disabled:bg-surface-2"
              data-testid="v3-aia-draft-text"
            />
            {edited || text.length >= max * COUNTER_FROM_SHARE ? (
              <p className="mt-1 flex justify-between gap-2 t-meta text-fg-3">
                <span>{edited ? "Текст изменён вами" : ""}</span>
                {text.length >= max * COUNTER_FROM_SHARE ? <span className="tabular-nums">{text.length} из {max}</span> : null}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="t-meta text-fg-3">{decided ? (edited ? "Текст поправлен сотрудником" : "Ответ агента") : draft.editedText ? "Отправленный текст (поправлен сотрудником)" : "Ответ агента"}</p>
            <p className="whitespace-pre-wrap break-words t-body-compact text-fg">{decided ? text : draft.editedText ?? draft.text}</p>
          </>
        )}
      </div>

      {draft.reason && !decided ? <p className="mt-2 t-meta text-fg-3">Почему агент так ответил: {draft.reason}</p> : null}
      {words.note && draft.status !== "sent" && !decided ? <p className="mt-2 t-body-compact text-fg-2">{words.note}</p> : null}
      {draft.status === "sent" || draft.status === "discarded" ? (
        <p className="mt-1 t-meta text-fg-3">
          {draft.decidedByName ? `Решение: ${draft.decidedByName}` : draft.sentByAgent ? "Отправил агент сам (Авто)" : ""}
          {draft.decidedAt || draft.sentAt ? ` · ${formatDateTimeRu(draft.decidedAt ?? draft.sentAt, now)}` : ""}
        </p>
      ) : null}
      {failure === "whatsapp_unavailable" && draft.channel === "whatsapp" && !decided ? (
        <p className="mt-2 t-body-compact text-fg-2">
          Подключите WhatsApp в <Link href="/v3/settings" className="underline underline-offset-4">Настройки → Интеграции</Link> — затем одобрите черновик ещё раз.
        </p>
      ) : null}

      {effective && canManage ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={QUEUE_CONFIRM} disabled={pending || !text.trim()} onClick={() => decide("approve")} data-testid="v3-aia-approve">
            {pending ? "Отправляю…" : "Одобрить и отправить"}
          </button>
          <button type="button" className={QUEUE_SECONDARY} disabled={pending} onClick={() => decide("discard")} data-testid="v3-aia-discard">Отклонить</button>
        </div>
      ) : null}
      <div className="mt-2">
        <ActionMessage state={state} testId="v3-aia-draft-result" />
        {outcome === "sent" && href && !bare ? (
          <p><Link href={href} className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4">{draft.channel === "whatsapp" ? "Открыть чат" : "Открыть переписку"}</Link></p>
        ) : null}
      </div>
    </article>
  );
}
