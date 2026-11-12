import Link from "next/link";

import { WidgetCard } from "@/components/kit";
import { AI_AGENT_GROUPS, AI_AGENT_GROUP_LABELS, type AiAgentDraftRow, type AiAgentListItem } from "@/lib/ai-agents/contract";
import { aiAgentHref, aiAgentIsRunnable } from "@/lib/v3/ai-agents-view";

import { NextAgentCard } from "./NextAgentCard";

/** «Ждут решения» (по образцу Molar AI — то, что ждёт человека): черновики всех агентов, по одному тексту на строку. */
export function NextAgentsDrafts({ drafts, agents }: Readonly<{ drafts: readonly AiAgentDraftRow[]; agents: readonly AiAgentListItem[] }>) {
  if (drafts.length === 0) return null;
  const titleOf = new Map(agents.map((agent) => [agent.key, agent.title]));
  return (
    <WidgetCard title="Ждут решения" size="sm" bodyClassName="p-0">
      <ul className="divide-y divide-border border-t border-border" data-testid="v3-aia-pending">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <Link href={aiAgentHref(draft.agentKey, { tab: "drafts" })} className="grid gap-0.5 px-4 py-3 transition-colors hover:bg-surface-2 motion-reduce:transition-none">
              <span className="t-meta text-fg-3">{titleOf.get(draft.agentKey) ?? draft.agentKey}{draft.targetLabel ? ` → ${draft.targetLabel}` : ""}</span>
              <span className="line-clamp-2 t-body-compact text-fg">{draft.editedText ?? draft.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

/**
 * «Агенты» — галерея карточек с маскотами (12.11.2026, по просьбе Айвара): одна сетка на всех, по порядку групп; группа
 * остаётся разделом для читалки (заголовок `sr-only`), на глаз её называет имя агента. Карточка — `NextAgentCard`.
 */
export function NextAgentsRoster({ agents, now, canAskOf, hasInstructionsOf, canWriteRules }: Readonly<{
  agents: readonly AiAgentListItem[];
  now: string;
  canAskOf: (agent: AiAgentListItem) => boolean;
  hasInstructionsOf: (agent: AiAgentListItem) => boolean;
  canWriteRules: boolean;
}>) {
  return (
    <section aria-labelledby="aia-roster" className="@container grid gap-3">
      <h2 id="aia-roster" className="t-section text-fg">Агенты</h2>
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-3 @5xl:grid-cols-4">
        {AI_AGENT_GROUPS.map((group) => {
          const list = agents.filter((agent) => agent.groupKey === group).sort((a, b) => a.sortOrder - b.sortOrder);
          if (list.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`aia-group-${group}`} data-testid={`v3-aia-group-${group}`} className="contents">
              <h3 id={`aia-group-${group}`} className="sr-only">{AI_AGENT_GROUP_LABELS[group]}</h3>
              <ul className="contents">
                {list.map((agent) => {
                  const rules = hasInstructionsOf(agent);
                  const runnable = rules && canAskOf(agent) && agent.enabled && aiAgentIsRunnable(agent.sync);
                  return <NextAgentCard key={agent.key} agent={agent} now={now} rules={rules} action={runnable ? "ask" : !rules && canWriteRules ? "rules" : null} />;
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
