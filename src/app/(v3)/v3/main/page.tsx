import Link from "next/link";

import { Funnel } from "@/components/v3/Funnel";
import { MetricRow } from "@/components/v3/MetricCard";
import { TrendChart } from "@/components/v3/TrendChart";
import { readAdmissionsFunnel, readDashboardMetrics } from "@/lib/v3/funnel-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Главная" };

/**
 * Ряд динамики — образец: все записи в базе созданы одним днём, истории по
 * неделям пока нет. Живёт здесь, а не в компоненте, чтобы подключение к
 * реальному ряду было заменой этого блока.
 */
const SAMPLE_TREND = [
  { label: "Лиды", values: [3, 5, 4, 7, 6, 9, 8, 12, 11, 14, 13, 19], emphasis: "primary" as const },
  { label: "Переданы", values: [0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4], emphasis: "secondary" as const },
];
const SAMPLE_TICKS = ["1 авг", "", "8", "", "15", "", "22", "", "29", "", "5 сен", ""];

export default async function MainPart() {
  const [metrics, stages] = await Promise.all([
    readDashboardMetrics(),
    readAdmissionsFunnel(),
  ]);

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <Link href="/v3" className="font-mono text-xs text-accent-text hover:underline">
        ← Части интерфейса
      </Link>

      {/* Приветствие, поиск и профиль — верхняя полоса из референса. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-[-0.02em] text-fg">
            С возвращением, Айгерим
          </h1>
          <p className="mt-0.5 text-sm text-fg-3">
            Вот что происходит в приёмной кампании сегодня
          </p>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <label className="flex h-10 min-w-0 flex-1 max-w-[340px] items-center gap-2 rounded-full border border-control-edge bg-surface px-4">
            <span className="sr-only">Поиск</span>
            <input
              type="search"
              placeholder="Поиск по имени, телефону, UUID…"
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
            />
          </label>
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3">
            <span aria-hidden="true" className="block h-7 w-7 rounded-full bg-accent" />
            <span className="text-xs">
              <span className="block font-semibold text-fg">Айгерим Н.</span>
              <span className="block text-2xs text-fg-3">Admissions</span>
            </span>
          </span>
        </div>
      </div>

      <div className="mt-5">
        <MetricRow metrics={metrics} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.15fr_1fr]">
        <section className="min-w-0 rounded-card border border-border bg-surface px-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-md font-bold text-fg">Динамика</h2>
            <span className="rounded-nav border border-border px-2 py-0.5 text-2xs text-fg-3">
              1 авг — 2 сен
            </span>
          </div>

          <p className="mt-2 flex gap-4 text-2xs text-fg-3">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0.5 w-3.5 bg-accent" />
              Лиды
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0 w-3.5 border-t-2 border-dashed border-fg-3" />
              Переданы
            </span>
          </p>

          <div className="mt-3">
            <TrendChart series={SAMPLE_TREND} ticks={SAMPLE_TICKS} caption="Динамика за период" />
          </div>

          {/* Сводка под графиком — из референса. */}
          <dl className="-mx-4 mt-2 grid grid-cols-3 gap-px border-t border-border bg-border">
            <div className="bg-surface px-4 py-2.5">
              <dd className="font-mono text-md font-semibold text-fg">19</dd>
              <dt className="text-2xs text-fg-3">лидов за период</dt>
            </div>
            <div className="bg-surface px-4 py-2.5">
              <dd className="font-mono text-md font-semibold text-fg">4</dd>
              <dt className="text-2xs text-fg-3">передано</dt>
            </div>
            <div className="bg-surface px-4 py-2.5">
              <dd className="font-mono text-md font-semibold text-fg">21%</dd>
              <dt className="text-2xs text-fg-3">доходимость</dt>
            </div>
          </dl>
        </section>

        <section className="min-w-0 rounded-card border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-md font-bold text-fg">Воронка поступления</h2>
            <span className="rounded-nav border border-border px-2 py-0.5 text-2xs text-fg-3">
              Все источники
            </span>
          </div>
          <div className="mt-3">
            <Funnel stages={stages} caption="Воронка поступления" />
          </div>
        </section>
      </div>

      <p className="mt-4 max-w-[66ch] text-xs leading-5 text-fg-3">
        Карточки и воронка читают настоящую PostgreSQL. Ряд динамики — образец:
        все записи созданы одним днём, истории по неделям пока нет.
      </p>
    </main>
  );
}
