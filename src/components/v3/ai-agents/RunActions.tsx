"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { aiAgentRunIsActive, aiAgentHref } from "@/lib/v3/ai-agents-view";
import type { AiAgentKey, AiAgentRunRow } from "@/lib/ai-agents/contract";
import { interruptAiAgentRunAction, startAiAgentRunAction } from "@/lib/platform-ai-agents-actions";

import { AIA_LINK_SECONDARY } from "./buttons";
import { ActionMessage } from "./Notices";
import { useAgentsAction } from "./useAgentsAction";

/** У `prompt_preview` в базе потолок 500 знаков: длиннее — поручение могло быть обрезано, и повторять нечего. */
const PROMPT_PREVIEW_CAP = 500;
const COPIED_MS = 2000;

/**
 * Действия над запуском в «Запусках»: «Открыть в чате» (своё поручение), «Остановить»
 * (идущий запуск: свой; чужой, плановый или по событию — только системному администратору),
 * «Повторить» (своё неудавшееся поручение — только целое, без права отправлять клиентам без
 * черновика) и «Скопировать» итог. Каждое — уже существующее серверное действие. Права и
 * состояние решает сервер, интерфейс не предлагает то, что заведомо откажет: сервер по праву
 * `ai.agent.use` остановил бы и чужой запуск, но звать гасить работу коллеги кнопкой незачем.
 */
export function RunActions({
  agentKey,
  run,
  ownCommand,
  canAct,
  canStopAny = false,
  canRun,
}: Readonly<{
  agentKey: AiAgentKey;
  run: Pick<AiAgentRunRow, "id" | "status" | "summary" | "promptPreview">;
  /** Своё `command`-поручение сотрудника: его можно открыть в чате и повторить. */
  ownCommand: boolean;
  /** Не просмотр роли. */
  canAct: boolean;
  /** Системный администратор: может остановить и чужой идущий запуск (плановый, по событию, коллеги). */
  canStopAny?: boolean;
  /** Агент включён, синхронизирован, ключ задан: новое поручение уйдёт. */
  canRun: boolean;
}>) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const [stop, setStop] = useState<"idle" | "pending" | "asked" | "failed">("idle");
  const [stopMessage, setStopMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const repeat = useAgentsAction(startAiAgentRunAction);
  useEffect(() => () => clearTimeout(timer.current), []);

  const prompt = run.promptPreview?.trim() ?? "";
  const active = aiAgentRunIsActive(run.status);
  const canRepeat = ownCommand && canAct && canRun && run.status === "failed" && prompt !== "" && prompt.length < PROMPT_PREVIEW_CAP;
  const summary = run.summary?.trim() ?? "";
  const canStop = active && canAct && (ownCommand || canStopAny);
  if (!ownCommand && !canStop && !summary) return null;

  async function copySummary() {
    let next: "done" | "failed" = "done";
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      next = "failed";
    }
    setCopy(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy("idle"), COPIED_MS);
  }

  async function stopRun() {
    setStop("pending");
    setStopMessage(null);
    const result = await interruptAiAgentRunAction(run.id).catch(() => null);
    if (result && result.ok) setStop("asked");
    else { setStop("failed"); setStopMessage(result && !result.ok ? result.message : null); }
  }

  const started = repeat.state.status === "saved" && repeat.state.runId ? repeat.state.runId : null;
  return (
    <div className="mt-3 space-y-2" data-testid="v3-aia-run-actions">
      <div className="flex flex-wrap items-center gap-2">
        {ownCommand ? (
          <Link href={aiAgentHref(agentKey, { tab: "command", run: run.id })} className={AIA_LINK_SECONDARY} data-testid="v3-aia-run-open-chat">
            <Icon name="messages-square" size={16} className="shrink-0" />
            Открыть в чате
          </Link>
        ) : null}
        {canStop ? (
          <button type="button" className={QUEUE_SECONDARY} disabled={stop === "pending" || stop === "asked"} onClick={() => void stopRun()} data-testid="v3-aia-run-stop">
            {stop === "pending" ? "Останавливаю…" : "Остановить"}
          </button>
        ) : null}
        {canRepeat ? (
          <button
            type="button"
            className={QUEUE_SECONDARY}
            disabled={repeat.pending || !repeat.ready || started !== null}
            onClick={() => repeat.submit({ key: agentKey, text: prompt, send_authority: "0" })}
            data-testid="v3-aia-run-repeat"
          >
            {repeat.pending ? "Запускаю…" : "Повторить"}
          </button>
        ) : null}
        {summary ? (
          <button type="button" className={QUEUE_SECONDARY} onClick={() => void copySummary()} data-testid="v3-aia-run-copy">
            <Icon name={copy === "done" ? "check" : "copy"} size={16} className="shrink-0" />
            <span className={copy === "failed" ? "text-danger" : undefined}>{copy === "done" ? "Скопировано" : copy === "failed" ? "Не скопировалось" : "Скопировать итог"}</span>
          </button>
        ) : null}
      </div>
      {stop === "asked" ? (
        <p role="status" className="t-body-compact text-fg-2">Остановка запрошена. <a href={aiAgentHref(agentKey, { tab: "runs", run: run.id })} className="text-fg underline underline-offset-4">Обновить страницу</a></p>
      ) : null}
      {stop === "failed" && stopMessage ? <p role="alert" className="t-body-compact text-danger">{stopMessage}</p> : null}
      {started ? (
        <p role="status" className="t-body-compact text-fg-2">
          Запуск начат. <Link href={aiAgentHref(agentKey, { tab: "command", run: started })} className="text-fg underline underline-offset-4">Открыть ход работы</Link>
        </p>
      ) : (
        <ActionMessage state={repeat.state} />
      )}
    </div>
  );
}
