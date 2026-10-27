"use client";

import { useState } from "react";

import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { ChatTimeline } from "@/components/v3/ai-agents/ChatTimeline";
import type { AiAgentUiEvent } from "@/lib/ai-agents/contract";
import { loadAiAgentRunTranscriptAction } from "@/lib/platform-ai-agents-actions";
import { aiAgentsErrorCopy, buildChatItems } from "@/lib/v3/ai-agents-view";

/**
 * «Показать переписку» в «Новом виде»: хроника читается у Claude по кнопке и в базе CRM не хранится, поэтому страница запуска
 * открывается быстро и без персональных данных переписки в разметке. Что она читается у Claude — за «?». Действие то же.
 */
export function NextTranscript({ runId, agentTitle }: Readonly<{ runId: string; agentTitle: string }>) {
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
    <div data-testid="v3-aia-transcript" aria-live="polite">
      <WidgetCard
        title="Переписка агента"
        headingLevel={3}
        help="Читается у Claude по кнопке, в CRM не хранится."
        actions={<Button variant="outline" disabled={phase === "loading"} onClick={() => void load()}>{phase === "idle" || phase === "failed" ? "Показать переписку" : "Обновить"}</Button>}
      >
        {phase === "idle" ? undefined : phase === "loading" ? <p className="t-body-compact text-fg-2">Загружаю…</p>
          : phase === "failed" ? <p role="alert" className="t-body-compact text-danger">{message}</p>
            : events.length === 0 ? <p className="t-body-compact text-fg-2">У Claude для этого запуска событий нет.</p>
              : (
                <div className="grid gap-3">
                  <ChatTimeline items={buildChatItems(events)} userLabel="Поручение" agentLabel={agentTitle} />
                  {truncated ? <p className="t-meta text-fg-3">Показаны первые события: переписка длиннее.</p> : null}
                </div>
              )}
      </WidgetCard>
    </div>
  );
}
