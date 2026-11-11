import Link from "next/link";
import { AlertTriangleIcon, CheckCircle2Icon, LoaderCircleIcon, XCircleIcon, type LucideIcon } from "lucide-react";

import { WidgetCard } from "@/components/kit";
import { AI_AGENT_RUN_STATUS_LABELS, type AiAgentListItem, type AiAgentRunRow, type AiAgentRunStatus } from "@/lib/ai-agents/contract";
import { aiAgentHref, relativeTimeRu } from "@/lib/v3/ai-agents-view";

const STATUS_ICON: Readonly<Record<AiAgentRunStatus, Readonly<{ icon: LucideIcon; tone: string }>>> = {
  starting: { icon: LoaderCircleIcon, tone: "text-info" },
  running: { icon: LoaderCircleIcon, tone: "text-info" },
  completed: { icon: CheckCircle2Icon, tone: "text-ok" },
  failed: { icon: XCircleIcon, tone: "text-danger" },
  interrupted: { icon: XCircleIcon, tone: "text-danger" },
  budget_reached: { icon: AlertTriangleIcon, tone: "text-warn" },
  needs_attention: { icon: AlertTriangleIcon, tone: "text-warn" },
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
    <WidgetCard title="Что сделали агенты" bodyClassName="p-0">
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
                  className="flex gap-3 px-5 py-3 transition-colors hover:bg-surface-2 motion-reduce:transition-none"
                >
                  <Icon aria-hidden="true" className={`mt-0.5 size-[18px] shrink-0 ${tone} ${run.status === "running" ? "animate-spin motion-reduce:animate-none" : ""}`} />
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
