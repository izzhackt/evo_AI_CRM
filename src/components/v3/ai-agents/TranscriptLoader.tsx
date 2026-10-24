"use client";

import { useState } from "react";

import { QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import type { AiAgentUiEvent } from "@/lib/ai-agents/contract";
import { loadAiAgentRunTranscriptAction } from "@/lib/platform-ai-agents-actions";
import { aiAgentsErrorCopy, buildChatItems } from "@/lib/v3/ai-agents-view";

import { ChatTimeline } from "./ChatTimeline";

/**
 * «Показать переписку» (вкладка «Запуски»): хроника читается у Claude по
 * кнопке и в базе CRM не хранится, поэтому страница запуска открывается быстро
 * и без персональных данных переписки в разметке.
 */
export function TranscriptLoader({ runId, agentTitle }: Readonly<{ runId: string; agentTitle: string }>) {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [events, setEvents] = useState<readonly AiAgentUiEvent[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setPhase("loading");
    setMessage(null);
    try {
      const result = await loadAiAgentRunTranscriptAction(runId);
      if (result.ok) { setEvents(result.events); setTruncated(result.truncated); setPhase("ready"); }
      else { setMessage(aiAgentsErrorCopy(result.code === "not_found" ? "not_found" : result.code)); setPhase("failed"); }
    } catch {
      setMessage(aiAgentsErrorCopy("unavailable"));
      setPhase("failed");
    }
  }

  return (
    <section aria-label="Переписка агента" className="rounded-card border border-border bg-surface p-4" data-testid="v3-aia-transcript">
      {phase === "idle" || phase === "failed" ? (
        <button type="button" className={QUEUE_SECONDARY} title="Переписка читается у Claude и в базе CRM не хранится" onClick={() => void load()}>Показать переписку</button>
      ) : phase === "ready" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`aia-transcript-${runId}`} className="t-section text-fg">Переписка агента</h3>
          <button type="button" className={QUEUE_SECONDARY} onClick={() => void load()}>Обновить</button>
        </div>
      ) : null}
      <div className={phase === "idle" ? undefined : "mt-3"} aria-live="polite">
        {phase === "loading" ? <p className="t-body-compact text-fg-2">Загружаю…</p> : null}
        {phase === "failed" && message ? <p role="alert" className="t-body-compact text-danger">{message}</p> : null}
        {phase === "ready" ? (
          events.length === 0
            ? <p className="t-body-compact text-fg-2">У Claude для этого запуска событий нет.</p>
            : (
              <div className="space-y-3">
                <ChatTimeline items={buildChatItems(events)} userLabel="Поручение" agentLabel={agentTitle} />
                {truncated ? <p className="t-meta text-fg-3">Показаны первые события: переписка длиннее.</p> : null}
              </div>
            )
        ) : null}
      </div>
    </section>
  );
}
