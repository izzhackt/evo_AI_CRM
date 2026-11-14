import Link from "next/link";

import type { AiAgentListItem, AiAgentsListResult } from "@/lib/ai-agents/contract";
import { aiAgentHref, aiAgentIsRunnable, formatUsdCents, pluralRu, successShare } from "@/lib/v3/ai-agents-view";

/**
 * «Сейчас» — тёмная полоса главной «ИИ-агентов» (11.11.2026, по образцу Molar AI «AI agent · live»; упрощена по слову
 * владельца «перегружено»): состояние агентов одним словом, сколько поручений выполняется прямо сейчас и кем, и три числа
 * за 7 дней без плиток и графиков: запуски, доля без ошибок, расход. Всё из чтения списка агентов.
 *
 * Слово состояния правдивое (отзыв к #1449): «на связи» — только когда ключ Claude задан и хотя бы один включённый агент готов
 * к запуску (`aiAgentIsRunnable`: синхронизирован или сохранил рабочую настройку); «в работе» — когда запуск идёт. Иначе полоса
 * говорит «не подключены» (нет ключа), «выключены» (не включён никто) или «ждут настройки» (включённые не готовы) и не называет
 * тех, кто «работает».
 * Название работающего агента — ссылка на его «Историю работы», кроме Директора для не администратора: ту вкладку база
 * ему не отдаёт, и ссылка вела бы на «Нет доступа к этому разделу». Ссылка — цель 44 px; она занимает зазор над рядом и поле
 * полосы под ним (отрицательные поля `ul`), поэтому полоса выше всего на 8 px.
 */
export function NextAgentsNow({ list, runtimeConfigured }: Readonly<{ list: AiAgentsListResult; runtimeConfigured: boolean }>) {
  const running = list.agents.filter((agent) => agent.stats.runsRunning > 0);
  const workingNow = running.reduce((total, agent) => total + agent.stats.runsRunning, 0);
  const today = list.agents.reduce((total, agent) => total + (agent.stats.runsPerDay14.at(-1) ?? 0), 0);
  const failed = list.agents.reduce((total, agent) => total + agent.stats.failed7d, 0);
  const share = successShare({ runs7d: list.summary.runs7d, failed7d: failed });
  const enabled = list.agents.filter((agent) => agent.enabled);
  const mode = !runtimeConfigured ? "key" : enabled.length === 0 ? "off" : workingNow > 0 ? "working" : !enabled.some((agent) => aiAgentIsRunnable(agent.sync)) ? "setup" : "idle";
  const state = { key: "не подключены", off: "выключены", setup: "ждут настройки", working: "в работе", idle: "на связи" }[mode];
  const line = mode === "key" ? "Запуски недоступны: не задан ключ Claude"
    : mode === "off" ? "Ни один агент не включён"
      : mode === "setup" ? "Включённые агенты не готовы: нужна синхронизация с Claude"
        : mode === "working" ? `Выполняют ${workingNow} ${pluralRu(workingNow, ["поручение", "поручения", "поручений"])} прямо сейчас`
          : `Сегодня ${today} ${pluralRu(today, ["запуск", "запуска", "запусков"])}, сейчас никто не занят`;
  const canOpenRuns = (agent: AiAgentListItem) => agent.key !== "director" || list.isAdmin;
  const stats = [
    { label: "Запусков за 7 дней", value: String(list.summary.runs7d) },
    { label: "Без ошибок", value: share === null ? "—" : `${share}%` },
    { label: "Расход за 7 дней", value: formatUsdCents(list.summary.costCents7d) },
  ];
  return (
    <section aria-labelledby="aia-now" data-testid="v3-aia-now" data-mode={mode} className="v3-aia-hero @container rounded-card p-6">
      <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:items-end">
        <div className="grid min-w-0 gap-2">
          <h2 id="aia-now" className="v3-aia-hero-muted inline-flex items-center gap-2 t-meta font-semibold">
            <span aria-hidden="true" className={`size-2 rounded-full ${mode === "working" ? "animate-pulse bg-ok motion-reduce:animate-none" : "v3-aia-hero-bar"}`} />
            ИИ-агенты · {state}
          </h2>
          <p className="t-record-title text-balance" data-testid="v3-aia-now-line">{line}</p>
          {mode === "working" ? (
            <ul className="-mb-3 -mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 t-meta" aria-label="Кто работает">
              {running.map((agent) => (
                <li key={agent.key}>
                  {canOpenRuns(agent)
                    ? <Link href={aiAgentHref(agent.key, { tab: "runs" })} className="inline-flex min-h-11 items-center underline underline-offset-4">{agent.title}</Link>
                    : agent.title}
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
