import Link from "next/link";
import { SparklesIcon } from "lucide-react";

import type { AiAgentsListResult } from "@/lib/ai-agents/contract";
import { aiAgentHref, formatUsdCents, pluralRu } from "@/lib/v3/ai-agents-view";

/** Запуски всех агентов по дням за последние 7 дней (из `runsPerDay14` каждого агента), от старого к новому. */
function runsPerDay(list: AiAgentsListResult): number[] {
  return Array.from({ length: 7 }, (_, index) =>
    list.agents.reduce((total, agent) => total + (agent.stats.runsPerDay14.at(index - 7) ?? 0), 0));
}

function Bars({ values, label }: Readonly<{ values: readonly number[]; label: string }>) {
  const top = Math.max(1, ...values);
  return (
    <span role="img" aria-label={label} className="flex h-6 items-end gap-0.5">
      {values.map((value, index) => (
        <span key={index} className="v3-aia-hero-bar w-1.5 rounded-sm" data-empty={value === 0 ? "" : undefined} style={{ height: `${Math.max(12, (value / top) * 100)}%` }} />
      ))}
    </span>
  );
}

/**
 * «Сейчас» — тёмная полоса главной «ИИ-агентов» (11.11.2026, по образцу Molar AI «AI agent · live»): значок, «ИИ-агенты ·
 * в работе», сколько поручений выполняется прямо сейчас и кем, справа три плитки с мини-графиком запусков за 7 дней.
 * Всё из чтения списка агентов.
 */
export function NextAgentsNow({ list }: Readonly<{ list: AiAgentsListResult }>) {
  const running = list.agents.filter((agent) => agent.stats.runsRunning > 0);
  const workingNow = running.reduce((total, agent) => total + agent.stats.runsRunning, 0);
  const days = runsPerDay(list);
  const today = days.at(-1) ?? 0;
  const failed = list.agents.reduce((total, agent) => total + agent.stats.failed7d, 0);
  const share = list.summary.runs7d > 0 ? Math.round(((list.summary.runs7d - failed) / list.summary.runs7d) * 100) : null;
  const withDrafts = list.agents.filter((agent) => agent.stats.draftsPending > 0);
  return (
    <section aria-labelledby="aia-now" data-testid="v3-aia-now" className="v3-aia-hero grid gap-5 rounded-card p-5 @4xl:grid-cols-[minmax(0,1fr)_auto] @4xl:items-center">
      <div className="flex min-w-0 items-center gap-4">
        <span aria-hidden="true" className="v3-aia-hero-tile grid size-14 shrink-0 place-items-center rounded-full"><SparklesIcon className="size-6" /></span>
        <div className="grid min-w-0 gap-1.5">
          <h2 id="aia-now" className="v3-aia-hero-tile inline-flex w-fit items-center gap-2 rounded-full px-2.5 py-0.5 t-meta font-semibold">
            <span aria-hidden="true" className={`size-2 rounded-full ${workingNow > 0 ? "animate-pulse bg-ok motion-reduce:animate-none" : "v3-aia-hero-bar"}`} />
            ИИ-агенты · {workingNow > 0 ? "в работе" : "на связи"}
          </h2>
          <p className="t-record-title" data-testid="v3-aia-now-line">
            {workingNow > 0
              ? `Выполняют ${workingNow} ${pluralRu(workingNow, ["поручение", "поручения", "поручений"])} прямо сейчас`
              : `Сегодня ${today} ${pluralRu(today, ["запуск", "запуска", "запусков"])}, сейчас никто не занят`}
          </p>
          {running.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Кто работает">
              {running.map((agent) => (
                <li key={agent.key}>
                  <Link href={aiAgentHref(agent.key, { tab: "runs" })} className="v3-aia-hero-tile inline-flex min-h-8 items-center rounded-full px-3 t-meta underline-offset-4 hover:underline">{agent.title}</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <dl aria-label="Показатели за 7 дней" data-testid="v3-aia-summary" className="grid grid-cols-3 gap-2">
        <div className="v3-aia-hero-tile grid gap-1 rounded-item p-3">
          <dt className="v3-aia-hero-muted t-meta">Запусков за 7 дней</dt>
          <dd className="flex items-end justify-between gap-3"><span className="t-record-title tabular-nums">{list.summary.runs7d}</span><Bars values={days} label={`По дням: ${days.join(", ")}`} /></dd>
        </div>
        <div className="v3-aia-hero-tile grid gap-1 rounded-item p-3">
          <dt className="v3-aia-hero-muted t-meta">Без ошибок</dt>
          <dd className="t-record-title tabular-nums">{share === null ? "—" : `${share}%`}</dd>
        </div>
        <div className="v3-aia-hero-tile grid gap-1 rounded-item p-3">
          <dt className="v3-aia-hero-muted t-meta">Ждут решения</dt>
          <dd className="t-record-title tabular-nums">
            {withDrafts.length === 1 && list.summary.draftsPending > 0
              ? <Link href={aiAgentHref(withDrafts[0].key, { tab: "drafts" })} className="underline underline-offset-4">{list.summary.draftsPending}</Link>
              : list.summary.draftsPending}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** Ряд из четырёх карточек под полосой (как у Molar AI): число, подпись и полоса доли там, где доля что-то значит. */
export function NextAgentsKpis({ list }: Readonly<{ list: AiAgentsListResult }>) {
  const total = list.agents.length;
  const actions = list.agents.reduce((sum, agent) => sum + agent.stats.actions7d, 0);
  const failed = list.agents.reduce((sum, agent) => sum + agent.stats.failed7d, 0);
  const cards = [
    { label: "Включено агентов", value: `${list.summary.enabled} из ${total}`, share: total > 0 ? list.summary.enabled / total : null },
    { label: "Расход за 7 дней", value: formatUsdCents(list.summary.costCents7d), share: null },
    { label: "Действий за 7 дней", value: String(actions), share: null },
    { label: "Ошибок за 7 дней", value: String(failed), share: null },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 @4xl:grid-cols-4" aria-label="Итоги агентов">
      {cards.map((card) => (
        <li key={card.label} className="grid gap-2 rounded-card border border-border bg-surface p-4">
          <span className="t-meta text-fg-2">{card.label}</span>
          <span className="t-record-title tabular-nums text-fg">{card.value}</span>
          {card.share !== null ? (
            <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-fg" style={{ width: `${Math.round(card.share * 100)}%` }} /></span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
