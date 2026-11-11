import Link from "next/link";

import type { AiAgentsListResult } from "@/lib/ai-agents/contract";
import { aiAgentHref, formatUsdCents, pluralRu } from "@/lib/v3/ai-agents-view";

/**
 * «Сейчас» — первая карточка главной «ИИ-агентов» (11.11.2026, по образцу Molar AI «AI agent · live»): кто из агентов
 * работает прямо сейчас (живая точка), сколько запусков сегодня, итоги за 7 дней и сколько черновиков ждут решения.
 * В CRM панели не красим (CLAUDE.md): карточка белая, «живое» — точка и слово. Всё из чтения списка агентов.
 */
export function NextAgentsNow({ list }: Readonly<{ list: AiAgentsListResult }>) {
  const running = list.agents.filter((agent) => agent.stats.runsRunning > 0);
  const workingNow = running.reduce((total, agent) => total + agent.stats.runsRunning, 0);
  const today = list.agents.reduce((total, agent) => total + (agent.stats.runsPerDay14.at(-1) ?? 0), 0);
  const withDrafts = list.agents.filter((agent) => agent.stats.draftsPending > 0);
  const draftsHref = withDrafts.length === 1 ? aiAgentHref(withDrafts[0].key, { tab: "drafts" }) : null;
  return (
    <section aria-labelledby="aia-now" data-testid="v3-aia-now" className="grid gap-4 rounded-card border border-border bg-surface p-5 @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:items-center">
      <div className="grid min-w-0 gap-2">
        <h2 id="aia-now" className="flex items-center gap-2 t-meta font-semibold text-fg-2">
          <span aria-hidden="true" className={`size-2 rounded-full ${workingNow > 0 ? "animate-pulse bg-ok motion-reduce:animate-none" : "bg-fg-3"}`} />
          Сейчас
        </h2>
        <p className="t-record-title text-fg" data-testid="v3-aia-now-line">
          {workingNow > 0
            ? `Агенты выполняют ${workingNow} ${pluralRu(workingNow, ["поручение", "поручения", "поручений"])}`
            : "Сейчас агенты ничего не выполняют"}
        </p>
        {running.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Кто работает">
            {running.map((agent) => (
              <li key={agent.key}>
                <Link href={aiAgentHref(agent.key, { tab: "runs" })} className="inline-flex min-h-8 items-center rounded-full border border-border px-3 t-meta text-fg underline-offset-4 hover:underline">
                  {agent.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-meta text-fg-2">Сегодня {today} {pluralRu(today, ["запуск", "запуска", "запусков"])} · включено агентов {list.summary.enabled} из {list.agents.length}</p>
        )}
      </div>
      <dl aria-label="Показатели за 7 дней" data-testid="v3-aia-summary" className="grid grid-cols-3 gap-4 @3xl:gap-6">
        <div><dt className="t-meta text-fg-2">Запусков за 7 дней</dt><dd className="t-record-title tabular-nums text-fg">{list.summary.runs7d}</dd></div>
        <div><dt className="t-meta text-fg-2">Расход за 7 дней</dt><dd className="t-record-title tabular-nums text-fg">{formatUsdCents(list.summary.costCents7d)}</dd></div>
        <div>
          <dt className="t-meta text-fg-2">Ждут решения</dt>
          <dd className="t-record-title tabular-nums text-fg">
            {draftsHref && list.summary.draftsPending > 0
              ? <Link href={draftsHref} className="underline underline-offset-4">{list.summary.draftsPending}</Link>
              : list.summary.draftsPending}
          </dd>
        </div>
      </dl>
    </section>
  );
}
