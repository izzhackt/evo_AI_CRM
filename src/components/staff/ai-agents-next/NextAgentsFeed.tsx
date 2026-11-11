import Link from "next/link";
import { AlertTriangleIcon, CheckIcon, LoaderIcon, XIcon, type LucideIcon } from "lucide-react";

import { WidgetCard } from "@/components/kit";
import { AI_AGENT_RUN_STATUS_LABELS, type AiAgentListItem, type AiAgentRunRow, type AiAgentRunStatus } from "@/lib/ai-agents/contract";
import { aiAgentHref, relativeTimeRu } from "@/lib/v3/ai-agents-view";

/** Значок состояния на мягкой подложке своего смыслового цвета (как у Molar AI), всегда со словом в строке ниже. */
const STATUS_ICON: Readonly<Record<AiAgentRunStatus, Readonly<{ icon: LucideIcon; tone: string }>>> = {
  starting: { icon: LoaderIcon, tone: "bg-info-weak text-info" },
  running: { icon: LoaderIcon, tone: "bg-info-weak text-info" },
  completed: { icon: CheckIcon, tone: "bg-ok-weak text-ok" },
  failed: { icon: XIcon, tone: "bg-danger-weak text-danger" },
  interrupted: { icon: XIcon, tone: "bg-danger-weak text-danger" },
  budget_reached: { icon: AlertTriangleIcon, tone: "bg-warn-weak text-warn" },
  needs_attention: { icon: AlertTriangleIcon, tone: "bg-warn-weak text-warn" },
};

/**
 * «Что сделали агенты» (11.11.2026, по образцу Molar AI «AI agent activity»): последние запуски всех агентов одной
 * лентой — значок состояния, агент, итог запуска (или поручение, пока итога нет), время. Строка ведёт в запуск.
 * Значок — смысловой цвет состояния, со словом рядом. Неполное чтение говорится словом.
 */
export function NextAgentsFeed({ runs, agents, now, partial }: Readonly<{
  runs: readonly AiAgentRunRow[];
  agents: readonly AiAgentListItem[];
  now: string;
  partial: boolean;
}>) {
  const titleOf = new Map(agents.map((agent) => [agent.key, agent.title]));
  return (
    <WidgetCard title="Что сделали агенты" bodyClassName="p-0" actions={<span className="inline-flex items-center gap-1.5 t-meta text-fg-2"><span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />Последние запуски</span>}>
      {partial ? <p className="px-5 pb-2 t-meta text-warn" data-testid="v3-aia-feed-partial">Часть ленты не загрузилась — показано не всё.</p> : null}
      {runs.length === 0 ? (
        <p className="px-5 pb-5 t-meta text-fg-2" data-testid="v3-aia-feed-empty">Запусков ещё не было.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border" data-testid="v3-aia-feed">
          {runs.map((run) => {
            const { icon: Icon, tone } = STATUS_ICON[run.status];
            const text = run.summary ?? run.promptPreview;
            return (
              <li key={run.id}>
                <Link
                  href={aiAgentHref(run.agentKey, { tab: "runs", run: run.id })}
                  className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2 motion-reduce:transition-none"
                >
                  <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full ${tone}`}>
                    <Icon className={`size-[18px] ${run.status === "running" || run.status === "starting" ? "animate-spin [animation-duration:2s] motion-reduce:animate-none" : ""}`} strokeWidth={2.2} />
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="t-body-compact text-fg">
                      <span className="font-semibold">{titleOf.get(run.agentKey) ?? run.agentKey}</span>
                      {text ? <span className="text-fg-2"> — <span className="line-clamp-2 inline">{text}</span></span> : null}
                    </span>
                    <span className="t-meta text-fg-3">
                      {AI_AGENT_RUN_STATUS_LABELS[run.status]} · {relativeTimeRu(run.startedAt, now)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
