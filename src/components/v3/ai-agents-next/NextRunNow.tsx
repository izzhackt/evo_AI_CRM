"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { aiAgentHref, formatUsd } from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "@/components/v3/ai-agents/Notices";
import type { useAgentsAction } from "@/components/v3/ai-agents/useAgentsAction";
import { CONFIRM_CLASS } from "./buttons";

/**
 * «Запустить по расписанию сейчас»: платный запуск спрашивает подтверждение и называет потолок расхода.
 * Нечего запускать (поручения для расписания нет) — кнопки нет. Причину запрета говорит строка под кнопкой.
 */
export function NextRunNow({
  run, agentKey, prompt, canRunNow, note, budgetUsd,
}: Readonly<{ run: ReturnType<typeof useAgentsAction>; agentKey: AiAgentKey; prompt: string; canRunNow: boolean; note: string | null; budgetUsd: number }>) {
  const [confirming, setConfirming] = useState(false);
  if (!prompt) return null;
  const disabled = !canRunNow || run.pending;
  return (
    <div className="grid gap-2">
      <div><Button type="button" variant="outline" disabled={disabled} onClick={() => setConfirming(true)} data-testid="v3-aia-run-schedule-now">{run.pending ? "Запускаю…" : "Запустить по расписанию сейчас"}</Button></div>
      {!canRunNow && note ? <p className="t-meta text-fg-3">{note}</p> : null}
      {confirming && !disabled ? (
        <div role="group" aria-label="Подтверждение запуска" className="rounded-card border border-border bg-surface-2 p-3">
          <p className="max-w-[60ch] t-body-compact text-fg">Агент начнёт работу сейчас, расход — {budgetUsd > 0 ? `до ${formatUsd(budgetUsd)}` : "без потолка"}. Запустить?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" className={CONFIRM_CLASS} onClick={() => { setConfirming(false); run.submit({ key: agentKey, text: prompt, send_authority: "0" }); }} data-testid="v3-aia-run-schedule-confirm">Запустить</Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Отмена</Button>
          </div>
        </div>
      ) : null}
      {run.state.status === "saved" && run.state.runId ? (
        <p role="status" className="t-body-compact text-fg-2">
          Запуск начат. <Link href={aiAgentHref(agentKey, { tab: "command", run: run.state.runId })} className="text-fg underline underline-offset-4">Открыть ход работы</Link>
        </p>
      ) : (
        <ActionMessage state={run.state} />
      )}
    </div>
  );
}
