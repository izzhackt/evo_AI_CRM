import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { DetailSheet, KeyFacts, StatusBadge, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  AI_AGENT_DRAFT_CHANNEL_LABELS,
  AI_AGENT_RUN_STATUS_LABELS,
  type AiAgentKey,
  type AiAgentRunGetResult,
} from "@/lib/ai-agents/contract";
import { aiAgentHref, draftStatusWords, draftTargetHref, durationWords, formatDateTimeRu, formatUsdCents, pluralRu, runOriginLabel, runStatusTone } from "@/lib/v3/ai-agents-view";

import { Markdown } from "@/components/v3/ai-agents/Markdown";
import { RunActions } from "@/components/v3/ai-agents/RunActions";
import { NextRunActionsTable } from "./NextRunActionsTable";
import { NextTranscript } from "./NextTranscript";
import { RunProblem, runSheetTitle } from "./NextRunSheet";

/**
 * Запуск целиком в «Новом виде» (`?tab=runs&run=…`): карточка запуска, действия агента таблицей, черновики запуска
 * и переписка по кнопке. Модель и токены — в панели «Технические данные». Данные и действия те же, что у `RunDetail`.
 */
export function NextRunDetail({
  agentKey, agentTitle, data, now, viewerName, canAct = false, canStopAny = false, canRun = false,
}: Readonly<{ agentKey: AiAgentKey; agentTitle: string; data: AiAgentRunGetResult; now: string; viewerName?: string; canAct?: boolean; canStopAny?: boolean; canRun?: boolean }>) {
  const { run, actions, drafts } = data;
  const origin = runOriginLabel(run, viewerName);
  const failed = actions.filter((action) => action.resultStatus !== "ok").length;
  const ordered = [...actions].sort((a, b) => Number(b.resultStatus !== "ok") - Number(a.resultStatus !== "ok"));
  return (
    <div className="grid gap-4" data-testid="v3-aia-run-detail">
      <div>
        <Button variant="ghost" asChild className="-ms-3">
          <Link href={aiAgentHref(agentKey, { tab: "runs" })}><ArrowLeftIcon aria-hidden="true" /> Вся история работы</Link>
        </Button>
      </div>
      <WidgetCard
        title={runSheetTitle(run)}
        actions={
          <>
            <StatusBadge label={AI_AGENT_RUN_STATUS_LABELS[run.status]} tone={runStatusTone(run.status)} />
            {run.sendAuthority ? <StatusBadge label="Отправка без черновика" tone="warn" /> : null}
          </>
        }
      >
        <div className="grid gap-4">
          <KeyFacts facts={[
            { label: "Когда", value: formatDateTimeRu(run.startedAt, now) },
            { label: "Длительность", value: durationWords(run.durationSeconds) },
            { label: "Расход", value: <span className="tabular-nums">{formatUsdCents(run.costCents)}</span> },
            { label: "Кто запустил", value: origin },
          ]} />
          {run.status === "completed" && failed > 0 ? (
            <p role="status" className="t-body-compact text-warn" data-testid="v3-aia-run-partial">
              {failed} {pluralRu(failed, ["действие не выполнено", "действия не выполнены", "действий не выполнено"])}
            </p>
          ) : null}
          <RunProblem run={run} />
          {run.promptPreview ? (
            <section>
              {run.triggerKind === "command" ? null : <h3 className="t-caption text-fg-3">Поручение</h3>}
              <p className="whitespace-pre-wrap break-words t-body-compact text-fg">{run.promptPreview}</p>
            </section>
          ) : null}
          {run.summary ? (
            <section>
              <h3 className="mb-1 t-caption text-fg-3">Итог агента</h3>
              <Markdown source={run.summary} />
            </section>
          ) : null}
          <RunActions agentKey={agentKey} run={run} ownCommand={run.triggerKind === "command" && origin === "Вы"} canAct={canAct} canStopAny={canStopAny} canRun={canRun} />
          <DetailSheet title="Технические данные" trigger={<Button variant="outline" className="justify-self-start">Технические данные</Button>}>
            <KeyFacts columns={1} facts={[
              { label: "Модель", value: `${run.model ?? "—"}${run.agentVersion !== null ? ` · версия ${run.agentVersion}` : ""}` },
              { label: "Токены", value: `вход ${run.inputTokens.toLocaleString("ru-RU")} · выход ${run.outputTokens.toLocaleString("ru-RU")}${run.cacheReadTokens > 0 ? ` · из кэша ${run.cacheReadTokens.toLocaleString("ru-RU")}` : ""}` },
            ]} />
          </DetailSheet>
        </div>
      </WidgetCard>

      <WidgetCard title="Действия агента" headingLevel={3} actions={<span className="t-meta tabular-nums text-fg-3">{actions.length}{failed > 0 ? ` · ${failed} с ошибкой` : ""}</span>}>
        {actions.length === 0 ? <p className="t-body-compact text-fg-2">В этом запуске агент не вызывал инструменты.</p> : <NextRunActionsTable actions={ordered} startedAt={run.startedAt} />}
      </WidgetCard>

      {drafts.length > 0 ? (
        <WidgetCard title="Черновики этого запуска" headingLevel={3} actions={<span className="t-meta tabular-nums text-fg-3">{drafts.length}</span>} footer={<Button variant="outline" asChild><Link href={aiAgentHref(agentKey, { tab: "drafts", show: "all" })}>Все черновики агента</Link></Button>}>
          <ul className="divide-y divide-border">
            {drafts.map((draft) => {
              const words = draftStatusWords(draft);
              const href = draftTargetHref(draft);
              return (
                <li key={draft.id} className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={words.label} tone={words.tone} />
                    <span className="t-label text-fg">{AI_AGENT_DRAFT_CHANNEL_LABELS[draft.channel]}</span>
                    {draft.targetLabel ? (href ? <Link href={href} className="t-label text-fg underline underline-offset-4">{draft.targetLabel}</Link> : <span className="t-label text-fg-2">{draft.targetLabel}</span>) : null}
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap break-words t-body-compact text-fg-2">{draft.editedText ?? draft.text}</p>
                  {words.note ? <p className="t-meta text-fg-3">{words.note}</p> : null}
                </li>
              );
            })}
          </ul>
        </WidgetCard>
      ) : null}

      {run.sessionId ? <NextTranscript runId={run.id} agentTitle={agentTitle} /> : (
        <p className="t-meta text-fg-3" data-testid="v3-aia-no-session">У запуска нет сессии Claude — переписки нет.</p>
      )}
    </div>
  );
}
