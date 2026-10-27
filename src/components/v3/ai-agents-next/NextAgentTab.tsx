import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { AI_AGENT_DEFAULTS, AI_AGENT_PREAMBLE } from "@/content/ai-agents";
import { EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { spentTodayCents } from "@/lib/ai-agents/daily-cap";
import { AI_AGENT_STARTERS, aiAgentHref } from "@/lib/v3/ai-agents-view";

import type { AgentBodyProps, TabRead } from "@/components/v3/ai-agents/AgentBody";
import { AgentSetup, SetupAction } from "@/components/v3/ai-agents/AgentSetup";
import { CommandWorkspace } from "@/components/v3/ai-agents/CommandWorkspace";
import type { AgentGate } from "./agent-gate";
import { AgentAlert, NextNotReady, NextUnavailable } from "./NextNotices";
import { NextDrafts } from "./NextDrafts";
import { NextOverview } from "./NextOverview";
import { NextRules } from "./NextRules";
import { NextRunDetail } from "./NextRunDetail";
import { NextRuns } from "./NextRuns";
import { NextSettings } from "./NextSettings";
import { NextSyncCard } from "./NextSyncCard";

function failure(read: TabRead<unknown>, what: string, retryHref: string) {
  return read.status === "not_ready" ? <NextNotReady /> : <NextUnavailable what={what} retryHref={retryHref} denied={read.status === "denied"} />;
}

/** Содержимое выбранной вкладки страницы агента в «Новом виде»: те же чтения и условия, что у `AgentBody`, другие виджеты. */
export function NextAgentTab({ props, gate }: Readonly<{ props: AgentBodyProps; gate: AgentGate }>) {
  const { detail, tab, now, canEdit, canManage, preview, runtimeConfigured, needsSync } = props;
  const defaults = AI_AGENT_DEFAULTS[detail.key];
  const { canRun, step, blockedNote, hasInstructions } = gate;
  const key = detail.key;
  // Что мешает запуску: администратору — шаги и кнопка первого несделанного шага, остальным — слова. Ключ Claude и просмотр роли уже сказаны плашками выше.
  const setup = canRun ? null
    : step ? <AgentSetup agentKey={key} configVersion={detail.configVersion} step={step} />
      : preview || !runtimeConfigured || !blockedNote ? null
        : <AgentAlert tone="muted" testId="v3-aia-blocked-note">{blockedNote}</AgentAlert>;

  switch (tab) {
    case "overview":
      return <NextOverview detail={detail} digests={props.digests?.status === "available" ? props.digests.data.digests : []} now={now} canRun={canRun} setup={setup} canMakeTasks={Boolean(props.canMakeTasks) && !preview} />;
    case "command":
      // Разговор живёт в состоянии `CommandWorkspace`, а не в адресе: после действий страница перерисовывается сервером (#1293).
      return (
        <CommandWorkspace
          agentKey={key} agentTitle={detail.title} autoSend={detail.autoSend} canRun={canRun} blockedNote={blockedNote}
          canDirect={canManage && !preview} canMakeTasks={Boolean(props.canMakeTasks) && !preview} now={now}
          conversations={props.conversations ?? []} resume={props.resume} starters={AI_AGENT_STARTERS[key]}
          nextStep={step ? <SetupAction step={step} agentKey={key} configVersion={detail.configVersion} /> : null}
        />
      );
    case "runs": {
      const retry = aiAgentHref(key, { tab: "runs", run: props.runId });
      if (props.runId) {
        const read = props.run;
        if (!read) return null;
        if (read.status === "missing") {
          return (
            <div data-testid="v3-aia-run-missing" className="rounded-card border border-border bg-surface">
              <EmptyState icon={SearchXIcon} title="Такого запуска нет." action={<Button variant="outline" asChild><Link href={aiAgentHref(key, { tab: "runs" })}>Вся история работы</Link></Button>} />
            </div>
          );
        }
        return read.status === "available"
          ? <NextRunDetail agentKey={key} agentTitle={detail.title} data={read.data} now={now} viewerName={props.viewerName} canAct={!preview} canStopAny={canEdit} canRun={canRun} />
          : failure(read, "запуск", retry);
      }
      const read = props.runs;
      if (!read) return null;
      if (read.status !== "available") return failure(read, "запуски", retry);
      const { runs, hasMore } = read.data;
      return <NextRuns agentKey={key} runs={runs.slice(0, props.runsLimit)} hasMore={hasMore || runs.length > props.runsLimit} limit={props.runsLimit} now={now} viewerName={props.viewerName} canRun={canRun} canAct={!preview} canStopAny={canEdit} />;
    }
    case "drafts": {
      const read = props.drafts;
      if (!read) return null;
      return read.status === "available"
        ? <NextDrafts agentKey={key} drafts={read.data.drafts} counts={read.data.counts} filter={props.draftsFilter} canManage={canManage && !preview} now={now} />
        : failure(read, "черновики", aiAgentHref(key, { tab: "drafts", show: props.draftsFilter === "all" ? "all" : null }));
    }
    case "instructions":
      return (
        <NextRules
          agentKey={key} configVersion={detail.configVersion} current={detail.instructionsOverride?.trim() ? detail.instructionsOverride : defaults.instructions}
          isOverride={Boolean(detail.instructionsOverride?.trim())} defaultText={defaults.instructions} preamble={AI_AGENT_PREAMBLE}
          canEdit={canEdit} runtimeConfigured={runtimeConfigured}
        />
      );
    case "settings":
      // «Включён» и «Авто» живут только в шапке страницы: здесь второй пары переключателей нет.
      return (
        <NextSettings
          detail={detail} defaultSchedulePrompt={defaults.schedulePrompt} canEdit={canEdit} canRunNow={canRun} runNowNote={blockedNote}
          whatsappCap={props.whatsappDailyCapCents ? {
            capCents: props.whatsappDailyCapCents,
            spentTodayCents: props.whatsappCapState?.spentCents ?? spentTodayCents(detail.charts.spendPerDay, Date.parse(now)),
            reservedCents: props.whatsappCapState?.reservedCents ?? 0,
          } : null}
          extra={<NextSyncCard agentKey={key} sync={detail.sync} needsSync={needsSync} runtimeConfigured={runtimeConfigured} hasInstructions={hasInstructions} canEdit={canEdit && !preview} now={now} />}
        />
      );
  }
}
