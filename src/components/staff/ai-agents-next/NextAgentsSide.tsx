import Link from "next/link";

import { HelpTip, WidgetCard } from "@/components/kit";
import { AI_AGENT_GROUPS, AI_AGENT_GROUP_LABELS, type AiAgentDraftRow, type AiAgentListItem } from "@/lib/ai-agents/contract";
import { aiAgentHref, aiAgentIsRunnable, aiAgentRoleLine, aiAgentStateChip, pluralRu, relativeTimeRu } from "@/lib/v3/ai-agents-view";

const DOT = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", neutral: "bg-fg-3", info: "bg-info" } as const;
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
 * «Агенты» — список на главной: точка состояния, имя (ссылка), «?» с ролью, когда работал и «Поручить» — сразу в чат агента.
 * Агент без правил — в своей группе со словами «нет правил» и ссылкой на правила администратору.
 */
export function NextAgentsRoster({ agents, now, canAskOf, hasInstructionsOf, canWriteRules }: Readonly<{
  agents: readonly AiAgentListItem[];
  now: string;
  canAskOf: (agent: AiAgentListItem) => boolean;
  hasInstructionsOf: (agent: AiAgentListItem) => boolean;
  canWriteRules: boolean;
}>) {
  return (
    <WidgetCard title="Агенты" size="sm" bodyClassName="p-0">
      {AI_AGENT_GROUPS.map((group) => {
        const list = agents.filter((agent) => agent.groupKey === group).sort((a, b) => a.sortOrder - b.sortOrder);
        if (list.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`aia-group-${group}`} data-testid={`v3-aia-group-${group}`} className="border-t border-border">
            <h3 id={`aia-group-${group}`} className="px-4 pt-3 pb-0.5 t-meta font-semibold text-fg-3">{AI_AGENT_GROUP_LABELS[group]}</h3>
            <ul>
              {list.map((agent) => {
                const rules = hasInstructionsOf(agent);
                const state = aiAgentStateChip({ enabled: agent.enabled, hasInstructions: rules, syncStatus: agent.sync.status, needsSync: false });
                const runnable = rules && canAskOf(agent) && agent.enabled && aiAgentIsRunnable(agent.sync);
                return (
                  <li key={agent.key} data-testid={`v3-aia-card-${agent.key}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[state.tone as keyof typeof DOT] ?? DOT.neutral}`} />
                    <span className="grid min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1">
                        <Link href={aiAgentHref(agent.key)} className="truncate t-body-compact font-medium text-fg underline-offset-4 hover:underline">{agent.title}</Link>
                        <HelpTip label={`Пояснение: ${agent.title}`}>{aiAgentRoleLine(agent.roleLine)}</HelpTip>
                      </span>
                      <span className="t-meta text-fg-3">
                        {!rules ? "нет правил" : agent.stats.lastRunAt ? `${state.label} · ${relativeTimeRu(agent.stats.lastRunAt, now)}` : `${state.label} · ещё не запускался`}
                        {agent.stats.draftsPending > 0 ? (
                          <> · <Link href={aiAgentHref(agent.key, { tab: "drafts" })} className="underline underline-offset-4" data-testid={`v3-aia-drafts-${agent.key}`}>
                            {agent.stats.draftsPending} {pluralRu(agent.stats.draftsPending, ["черновик ждёт", "черновика ждут", "черновиков ждут"])} решения
                          </Link></>
                        ) : null}
                      </span>
                    </span>
                    {runnable ? (
                      <Link href={aiAgentHref(agent.key, { tab: "command" })} data-testid={`v3-aia-ask-${agent.key}`} className="inline-flex min-h-11 shrink-0 items-center t-meta font-medium text-fg underline underline-offset-4">Поручить</Link>
                    ) : !rules && canWriteRules ? (
                      <Link href={aiAgentHref(agent.key, { tab: "instructions" })} data-testid={`v3-aia-rules-${agent.key}`} className="inline-flex min-h-11 shrink-0 items-center t-meta font-medium text-fg underline underline-offset-4">Правила</Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </WidgetCard>
  );
}
