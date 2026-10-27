import Link from "next/link";

import { HelpTip, KeyFacts, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AI_AGENT_RUN_STATUS_LABELS, type AiAgentListItem } from "@/lib/ai-agents/contract";
import { aiAgentHref, aiAgentIsRunnable, aiAgentRoleLine, aiAgentStateChip, formatUsdCents, pluralRu, relativeTimeRu } from "@/lib/v3/ai-agents-view";

/**
 * Карточка агента в хабе «Нового вида»: название (ссылка на всю карточку), «?» с описанием роли, состояние словом,
 * два данных и две ссылки — «Поручить» и очередь черновиков. Роль агента — пояснение: на экране её нет, она за «?».
 * Спарклайна нет: запуски по дням — на «Обзоре» агента.
 */
export function NextAgentCard({ agent, now, canAsk }: Readonly<{ agent: AiAgentListItem; now: string; canAsk: boolean }>) {
  // Карточка не знает точного хеша настроек (его считает страница агента): «Нужна синхронизация» — по статусу.
  const state = aiAgentStateChip({ enabled: agent.enabled, hasInstructions: true, syncStatus: agent.sync.status, needsSync: false });
  const { stats } = agent;
  const lastRun = stats.lastRunAt
    ? `${relativeTimeRu(stats.lastRunAt, now)}${stats.lastRunStatus ? ` · ${AI_AGENT_RUN_STATUS_LABELS[stats.lastRunStatus]}` : ""}`
    : "ещё не запускался";
  const runnable = canAsk && agent.enabled && aiAgentIsRunnable(agent.sync);
  const hasLinks = runnable || stats.draftsPending > 0;
  return (
    <li data-testid={`v3-aia-card-${agent.key}`} className="min-w-0">
      <Card className="relative h-full transition-colors hover:border-border-strong has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring motion-reduce:transition-none">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-1.5">
            <CardTitle as="h3">
              <Link href={aiAgentHref(agent.key)} className="rounded-nav outline-none after:absolute after:inset-0 after:rounded-card">{agent.title}</Link>
            </CardTitle>
            <HelpTip label={`Пояснение: ${agent.title}`} className="z-10">{aiAgentRoleLine(agent.roleLine)}</HelpTip>
          </div>
          <CardAction className="flex flex-wrap items-center justify-end gap-1.5">
            {agent.autoSend ? <StatusBadge label="Авто: вкл" tone="warn" title="Агент сам пишет клиентам и студентам без одобрения" /> : null}
            <StatusBadge label={state.label} tone={state.tone} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <KeyFacts columns={2} facts={[
            { label: "Последний запуск", value: lastRun },
            { label: "Расход за 7 дней", value: <span className="tabular-nums">{formatUsdCents(stats.costCents7d)}</span> },
          ]} />
        </CardContent>
        {hasLinks ? (
          <CardFooter className="flex-wrap">
            {runnable ? (
              <Button variant="ghost" asChild className="relative z-10 -ms-3">
                <Link href={aiAgentHref(agent.key, { tab: "command" })} data-testid={`v3-aia-ask-${agent.key}`}>Поручить →</Link>
              </Button>
            ) : null}
            {stats.draftsPending > 0 ? (
              <Button variant="outline" asChild className="relative z-10">
                <Link href={aiAgentHref(agent.key, { tab: "drafts" })} data-testid={`v3-aia-drafts-${agent.key}`}>
                  {stats.draftsPending} {pluralRu(stats.draftsPending, ["черновик ждёт", "черновика ждут", "черновиков ждут"])} решения
                </Link>
              </Button>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>
    </li>
  );
}
