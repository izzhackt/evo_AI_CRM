import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { HelpTip } from "@/components/kit";
import { StatusChip } from "@/components/staff/blocks/StatusChip";
import type { AiAgentListItem } from "@/lib/ai-agents/contract";
import { aiAgentHref, aiAgentRoleLine, aiAgentStateChip, pluralRu, relativeTimeRu } from "@/lib/v3/ai-agents-view";

import { AGENT_MASCOTS } from "./agent-mascots";

const ACTION = "relative z-10 inline-flex min-h-11 items-center gap-1 t-meta font-medium text-fg underline underline-offset-4";

/**
 * Карточка агента в списке «Агенты» (12.11.2026, по просьбе Айвара — маскоты): сверху маскот на сером столе (при наведении
 * чуть приподнимается), ниже имя (вся карточка ведёт к агенту), «?» с ролью, чип состояния словом и когда работал,
 * черновики, внизу одно действие — «Поручить» (сразу в чат) или «Правила».
 */
export function NextAgentCard({ agent, now, rules, action }: Readonly<{
  agent: AiAgentListItem;
  now: string;
  rules: boolean;
  action: "ask" | "rules" | null;
}>) {
  const state = aiAgentStateChip({ enabled: agent.enabled, hasInstructions: rules, syncStatus: agent.sync.status, needsSync: false });
  const mascot = AGENT_MASCOTS[agent.key];
  const when = !rules ? null : agent.stats.lastRunAt ? relativeTimeRu(agent.stats.lastRunAt, now) : "ещё не запускался";
  return (
    <li
      data-testid={`v3-aia-card-${agent.key}`}
      className="group/agent relative flex flex-col overflow-hidden rounded-card border border-border bg-surface transition-colors hover:border-border-strong has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring motion-reduce:transition-none"
    >
      <span aria-hidden="true" className="grid h-32 place-items-center border-b border-border bg-surface-2">
        {mascot ? (
          <Image src={mascot} alt="" width={112} height={112} className="size-28 object-contain transition-transform duration-200 ease-out group-hover/agent:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover/agent:translate-y-0" />
        ) : null}
      </span>
      <span className="grid flex-1 content-start gap-2 p-3">
        <span className="flex min-w-0 items-start gap-1">
          <Link href={aiAgentHref(agent.key)} className="min-w-0 t-item text-fg outline-none after:absolute after:inset-0 after:rounded-card">{agent.title}</Link>
          <HelpTip label={`Пояснение: ${agent.title}`} className="relative z-10">{aiAgentRoleLine(agent.roleLine)}</HelpTip>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 t-meta text-fg-3">
          <StatusChip label={state.label} tone={state.tone} size="sm" />
          {when ? <span>{when}</span> : null}
        </span>
        {agent.stats.draftsPending > 0 ? (
          <Link href={aiAgentHref(agent.key, { tab: "drafts" })} className="relative z-10 w-fit t-meta text-fg underline underline-offset-4" data-testid={`v3-aia-drafts-${agent.key}`}>
            {agent.stats.draftsPending} {pluralRu(agent.stats.draftsPending, ["черновик ждёт", "черновика ждут", "черновиков ждут"])} решения
          </Link>
        ) : null}
      </span>
      {action ? (
        <span className="border-t border-border px-3">
          {action === "ask" ? (
            <Link href={aiAgentHref(agent.key, { tab: "command" })} data-testid={`v3-aia-ask-${agent.key}`} className={ACTION}>Поручить<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>
          ) : (
            <Link href={aiAgentHref(agent.key, { tab: "instructions" })} data-testid={`v3-aia-rules-${agent.key}`} className={ACTION}>Правила<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>
          )}
        </span>
      ) : null}
    </li>
  );
}
