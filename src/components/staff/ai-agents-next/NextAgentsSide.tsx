import Link from "next/link";

import { WidgetCard } from "@/components/kit";
import { AI_AGENT_GROUPS, AI_AGENT_GROUP_LABELS, type AiAgentListItem } from "@/lib/ai-agents/contract";
import { aiAgentHref, aiAgentIsRunnable, pluralRu, type AiAgentPendingRow } from "@/lib/v3/ai-agents-view";

import { NextAgentCard } from "./NextAgentCard";

/**
 * «Ждут решения» (по образцу Molar AI — то, что ждёт человека): свежие черновики всех агентов, по одному тексту на строку.
 * Строк мало (`total` — сколько ждёт всего): остальное названо внизу «Ещё N» и ведёт в «На одобрение» тех агентов, у кого
 * они остались, — общей очереди нет, у каждого агента своя. Числа нет (`total` null) — и строки «Ещё» нет.
 */
export function NextAgentsDrafts({ drafts, total, agents }: Readonly<{ drafts: readonly AiAgentPendingRow[]; total: number | null; agents: readonly AiAgentListItem[] }>) {
  if (drafts.length === 0) return null;
  const titleOf = new Map(agents.map((agent) => [agent.key, agent.title]));
  const more = (total ?? 0) - drafts.length;
  const rest = agents
    .map((agent) => ({ agent, left: agent.stats.draftsPending - drafts.filter((draft) => draft.agentKey === agent.key).length }))
    .filter(({ left }) => left > 0)
    .sort((a, b) => b.left - a.left);
  return (
    <WidgetCard title="Ждут решения" size="sm" bodyClassName="p-0">
      <ul className="divide-y divide-border border-t border-border" data-testid="v3-aia-pending">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <Link href={aiAgentHref(draft.agentKey, { tab: "drafts" })} className="grid gap-0.5 px-4 py-3 transition-colors hover:bg-surface-2 motion-reduce:transition-none">
              <span className="t-meta text-fg-3">{titleOf.get(draft.agentKey) ?? draft.agentKey}{draft.targetLabel ? ` → ${draft.targetLabel}` : ""}</span>
              <span className="line-clamp-2 t-body-compact text-fg">{draft.text}</span>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 border-t border-border px-4 t-meta text-fg-3" data-testid="v3-aia-pending-more">
          <span className="inline-flex min-h-11 items-center">Ещё {more} {pluralRu(more, ["черновик", "черновика", "черновиков"])}{rest.length > 0 ? ":" : ""}</span>
          {rest.length > 0 ? (
            <ul aria-label="Остальные черновики по агентам" className="flex flex-wrap gap-x-4">
              {rest.map(({ agent, left }) => (
                <li key={agent.key}>
                  <Link href={aiAgentHref(agent.key, { tab: "drafts" })} className="inline-flex min-h-11 items-center text-fg underline underline-offset-4">{agent.title} · {left}</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </WidgetCard>
  );
}

/**
 * Колонки карточек агентов (ширина блока): 2, от 48rem — 3, от 64rem — 5. Пять кураторов ложатся как 3 + 2 и 5, а не 3 + 3 + 1
 * (4 колонки оставляли последнюю карточку одну в ряду на ноутбуке).
 */
const COLUMNS = "grid grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5";

/**
 * «Агенты» — галерея карточек с маскотами (12.11.2026, по просьбе Айвара) по группам Продажи / Аналитика / Кураторы; заголовки
 * групп на виду (отзыв к #1450: группа — часть задания владельца). Группа из одного агента занимает одну колонку и стоит рядом
 * с такой же, длинная — на всю ширину; ширина карточки у всех одна (те же колонки и зазор). Карточка — `NextAgentCard`.
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
      <div className={`${COLUMNS} gap-x-3 gap-y-6`}>
        {AI_AGENT_GROUPS.map((group) => {
          const list = agents.filter((agent) => agent.groupKey === group).sort((a, b) => a.sortOrder - b.sortOrder);
          if (list.length === 0) return null;
          const wide = list.length > 1;
          return (
            <section key={group} aria-labelledby={`aia-group-${group}`} data-testid={`v3-aia-group-${group}`} className={wide ? "col-span-full grid gap-2" : "grid content-start gap-2"}>
              <h3 id={`aia-group-${group}`} className="t-item text-fg-2">{AI_AGENT_GROUP_LABELS[group]}</h3>
              <ul className={wide ? `${COLUMNS} gap-3` : "grid"}>
                {list.map((agent) => {
                  const rules = hasInstructionsOf(agent);
                  const runnable = rules && canAskOf(agent) && agent.enabled && aiAgentIsRunnable(agent.sync);
                  return <NextAgentCard key={agent.key} agent={agent} now={now} rules={rules} action={runnable ? "ask" : !rules && canWriteRules ? "rules" : "open"} />;
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
