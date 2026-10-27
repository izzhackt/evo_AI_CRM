import Link from "next/link";

import { KeyFacts, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AI_AGENT_RUN_STATUS_LABELS, AI_AGENT_TRIGGER_LABELS, type AiAgentKey, type AiAgentRunRow } from "@/lib/ai-agents/contract";
import { AI_AGENT_DAILY_BUDGET_REACHED_CODE } from "@/lib/ai-agents/daily-cap";
import { aiAgentHref, durationWords, formatUsdCents, runErrorWords, runOriginLabel, runStatusTone } from "@/lib/v3/ai-agents-view";

import { Markdown } from "@/components/v3/ai-agents/Markdown";
import { RunActions } from "@/components/v3/ai-agents/RunActions";

export const runSheetTitle = (run: Pick<AiAgentRunRow, "triggerKind">) => (run.triggerKind === "command" ? "Поручение" : AI_AGENT_TRIGGER_LABELS[run.triggerKind]);

/** Причина остановки или ошибки: лимит WhatsApp — спокойно (задуманное поведение), ошибка — красным и на виду. */
export function RunProblem({ run }: Readonly<{ run: Pick<AiAgentRunRow, "status" | "errorCode" | "errorMessage"> }>) {
  if (run.errorCode === AI_AGENT_DAILY_BUDGET_REACHED_CODE) {
    return <p role="status" className="rounded-card bg-warn-weak px-3 py-2 t-body-compact text-warn" data-testid="v3-aia-run-cap">{runErrorWords(run.errorCode, run.errorMessage)}</p>;
  }
  if (run.status === "failed" || run.errorCode) {
    return <p role="alert" className="rounded-card bg-danger-weak px-3 py-2 t-body-compact text-danger" data-testid="v3-aia-run-error">{runErrorWords(run.errorCode, run.errorMessage)}</p>;
  }
  return null;
}

/** Запуск в панели списка «Истории работы»: статус, причина, поручение, итог и действия над запуском. Хроника и действия агента — по ссылке. */
export function NextRunSheetBody({
  agentKey,
  run,
  viewerName,
  canAct,
  canStopAny,
  canRun,
}: Readonly<{ agentKey: AiAgentKey; run: AiAgentRunRow; viewerName?: string; canAct: boolean; canStopAny: boolean; canRun: boolean }>) {
  const ownCommand = run.triggerKind === "command" && runOriginLabel(run, viewerName) === "Вы";
  return (
    <div className="grid gap-4" data-testid="v3-aia-run-sheet">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={AI_AGENT_RUN_STATUS_LABELS[run.status]} tone={runStatusTone(run.status)} />
        {run.sendAuthority ? <StatusBadge label="Отправка без черновика" tone="warn" /> : null}
      </div>
      <RunProblem run={run} />
      <KeyFacts columns={2} facts={[
        { label: "Длительность", value: durationWords(run.durationSeconds) },
        { label: "Расход", value: <span className="tabular-nums">{formatUsdCents(run.costCents)}</span> },
        { label: "Действий агента", value: run.actionsCount },
        { label: "Черновиков", value: run.draftsCount > 0 ? run.draftsCount : null },
      ]} />
      {run.promptPreview ? (
        <section>
          {run.triggerKind === "command" ? null : <h3 className="t-caption text-fg-3">Поручение</h3>}
          <p className="whitespace-pre-wrap break-words t-body text-fg">{run.promptPreview}</p>
        </section>
      ) : null}
      {run.summary ? (
        <section>
          <h3 className="mb-1 t-caption text-fg-3">Итог агента</h3>
          <Markdown source={run.summary} />
        </section>
      ) : null}
      <RunActions agentKey={agentKey} run={run} ownCommand={ownCommand} canAct={canAct} canStopAny={canStopAny} canRun={canRun} />
      <Button variant="outline" asChild className="justify-self-start">
        <Link href={aiAgentHref(agentKey, { tab: "runs", run: run.id })} data-testid="v3-aia-run-open-full">Хроника и действия агента</Link>
      </Button>
    </div>
  );
}
