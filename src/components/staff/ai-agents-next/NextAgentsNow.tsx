import Link from "next/link";

import type { AiAgentsListResult } from "@/lib/ai-agents/contract";
import { aiAgentHref, formatUsdCents, pluralRu } from "@/lib/v3/ai-agents-view";

/** Запуски всех агентов по дням за последние 7 дней (из `runsPerDay14` каждого агента), от старого к новому. */
function runsPerDay(list: AiAgentsListResult): number[] {
  return Array.from({ length: 7 }, (_, index) =>
    list.agents.reduce((total, agent) => total + (agent.stats.runsPerDay14.at(index - 7) ?? 0), 0));
}

/**
 * «Сейчас» — тёмная полоса главной «ИИ-агентов» (11.11.2026, по образцу Molar AI «AI agent · live»; упрощена по слову
 * владельца «перегружено»): «ИИ-агенты · в работе», сколько поручений выполняется прямо сейчас и кем, и три числа за
 * 7 дней без плиток и графиков: запуски, доля без ошибок, расход. Всё из чтения списка агентов.
 */
export function NextAgentsNow({ list }: Readonly<{ list: AiAgentsListResult }>) {
  const running = list.agents.filter((agent) => agent.stats.runsRunning > 0);
  const workingNow = running.reduce((total, agent) => total + agent.stats.runsRunning, 0);
  const today = runsPerDay(list).at(-1) ?? 0;
  const failed = list.agents.reduce((total, agent) => total + agent.stats.failed7d, 0);
  const share = list.summary.runs7d > 0 ? Math.round(((list.summary.runs7d - failed) / list.summary.runs7d) * 100) : null;
  const stats = [
    { label: "Запусков за 7 дней", value: String(list.summary.runs7d) },
    { label: "Без ошибок", value: share === null ? "—" : `${share}%` },
    { label: "Расход за 7 дней", value: formatUsdCents(list.summary.costCents7d) },
  ];
  return (
    <section aria-labelledby="aia-now" data-testid="v3-aia-now" className="v3-aia-hero @container rounded-card p-6">
      <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:items-end">
        <div className="grid min-w-0 gap-2">
          <h2 id="aia-now" className="v3-aia-hero-muted inline-flex items-center gap-2 t-meta font-semibold">
            <span aria-hidden="true" className={`size-2 rounded-full ${workingNow > 0 ? "animate-pulse bg-ok motion-reduce:animate-none" : "v3-aia-hero-bar"}`} />
            ИИ-агенты · {workingNow > 0 ? "в работе" : "на связи"}
          </h2>
          <p className="t-record-title text-balance" data-testid="v3-aia-now-line">
            {workingNow > 0
              ? `Выполняют ${workingNow} ${pluralRu(workingNow, ["поручение", "поручения", "поручений"])} прямо сейчас`
              : `Сегодня ${today} ${pluralRu(today, ["запуск", "запуска", "запусков"])}, сейчас никто не занят`}
          </p>
          {running.length > 0 ? (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 t-meta" aria-label="Кто работает">
              {running.map((agent) => (
                <li key={agent.key}>
                  <Link href={aiAgentHref(agent.key, { tab: "runs" })} className="underline underline-offset-4">{agent.title}</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <dl aria-label="Показатели за 7 дней" data-testid="v3-aia-summary" className="grid grid-cols-3">
          {stats.map(({ label, value }, index) => (
            <div key={label} className={`grid content-between gap-1 ${index === 0 ? "pe-4" : "v3-aia-hero-sep px-4"}`}>
              <dt className="v3-aia-hero-muted t-meta">{label}</dt>
              <dd className="t-record-title tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
