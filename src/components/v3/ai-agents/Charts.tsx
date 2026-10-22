import {
  chartAxisTop,
  chartDateTicks,
  formatUsdCents,
  pluralRu,
  type ChartBarRow,
  type ChartHorizontalRow,
} from "@/lib/v3/ai-agents-view";

/*
 * Графики раздела «ИИ-агенты» (контракт §D.4, «Обзор»). Библиотеки нет: вёрстка
 * по образцу `TrendChart.tsx` — чернила, а не красный (красный в этом мире —
 * главное действие и проблема), честная ось от нуля, подписи словами, у
 * каждого графика текстовый эквивалент (таблица под раскрывающейся строкой).
 * Провалы (запуски с ошибкой) отличаются штриховкой, а не цветом.
 */

type BarMode = "count" | "money";

const valueText = (mode: BarMode, value: number) => (mode === "money" ? formatUsdCents(value) : String(value));

function barTitle(mode: BarMode, row: ChartBarRow): string {
  if (mode === "money") return `${row.label}: ${formatUsdCents(row.value)}`;
  const base = `${row.label}: ${row.value} ${pluralRu(row.value, ["запуск", "запуска", "запусков"])}`;
  return row.failed > 0 ? `${base}, из них с ошибкой — ${row.failed}` : base;
}

/** Столбики по дням (30 дней): «Запуски по дням» и «Расход по дням». */
export function DayBars({
  rows,
  mode,
  caption,
  emptyText,
  tableHead,
}: Readonly<{
  rows: readonly ChartBarRow[];
  mode: BarMode;
  caption: string;
  emptyText: string;
  tableHead: readonly [string, string, string?];
}>) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (rows.length === 0 || total === 0) {
    return (
      <figure className="min-w-0" aria-label={caption}>
        <p className="t-body-compact text-fg-2" data-testid="v3-aia-chart-empty">{emptyText}</p>
      </figure>
    );
  }
  const top = chartAxisTop(Math.max(...rows.map((row) => row.value)));
  const ticks = chartDateTicks(rows);
  const anyFailed = rows.some((row) => row.failed > 0);
  const lastIndex = rows.length - 1;
  const spoken = mode === "money"
    ? `${caption}. За ${rows.length} ${pluralRu(rows.length, ["день", "дня", "дней"])} — ${formatUsdCents(total)}. Данные по дням — в таблице под графиком.`
    : `${caption}. За ${rows.length} ${pluralRu(rows.length, ["день", "дня", "дней"])} — ${total} ${pluralRu(total, ["запуск", "запуска", "запусков"])}. Данные по дням — в таблице под графиком.`;
  return (
    <figure className="min-w-0" aria-label={caption}>
      <p className="mb-2 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 t-meta text-fg-2" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-fg-2" />{mode === "money" ? "Расход за день" : "Запуски за день"}</span>
        {anyFailed ? <span className="inline-flex items-center gap-1.5"><span className="v3-aia-hatch size-2.5 rounded-[2px] border border-fg" />Из них с ошибкой</span> : null}
      </p>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div aria-hidden="true" className="relative h-40 t-meta tabular-nums text-fg-3">
          <span className="invisible block">{valueText(mode, top)}</span>
          {[0, top / 2, top].map((value) => (
            <span key={value} className="absolute end-0 -translate-y-1/2" style={{ top: `${100 - (value / top) * 100}%` }}>
              {valueText(mode, value)}
            </span>
          ))}
        </div>
        <div className="relative h-40 min-w-0" role="img" aria-label={spoken} data-testid="v3-aia-day-bars">
          {[0, 50, 100].map((line) => (
            <span key={line} aria-hidden="true" className="absolute inset-x-0 border-t border-border" style={{ top: `${line}%` }} />
          ))}
          <div aria-hidden="true" className="absolute inset-0 flex items-end gap-[2px]">
            {rows.map((row, index) => {
              const height = (row.value / top) * 100;
              const failedShare = row.value > 0 ? (row.failed / row.value) * 100 : 0;
              return (
                <div key={row.date} title={barTitle(mode, row)} className="flex h-full min-w-0 flex-1 items-end">
                  {row.value > 0 ? (
                    <div className="flex w-full flex-col overflow-hidden rounded-t-[2px]" style={{ height: `${height}%`, minHeight: 3 }}>
                      {failedShare > 0 ? <div className="v3-aia-hatch shrink-0 border-b border-surface" style={{ height: `${failedShare}%`, minHeight: 2 }} /> : null}
                      <div className={`min-h-0 flex-1 ${index === lastIndex ? "bg-fg" : "bg-fg-2"}`} />
                    </div>
                  ) : (
                    <div className="h-px w-full bg-border-strong" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <span aria-hidden="true" />
        <div aria-hidden="true" className="relative h-6 t-meta tabular-nums text-fg-3">
          {ticks.map((tick) => {
            const at = ((tick.index + 0.5) / rows.length) * 100;
            const anchor = tick.index === 0 ? "" : tick.index === lastIndex ? "-translate-x-full" : "-translate-x-1/2";
            return (
              <span key={tick.index} className={`absolute top-1.5 whitespace-nowrap ${anchor}`} style={{ left: tick.index === 0 ? 0 : tick.index === lastIndex ? "100%" : `${at}%` }}>
                {tick.label}
              </span>
            );
          })}
        </div>
      </div>
      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center t-meta text-fg-2 underline underline-offset-4">Показать данные таблицей</summary>
        <div className="max-h-72 overflow-auto rounded-card border border-border">
          <table className="w-full t-body-compact">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-border text-start text-fg-2">
                <th scope="col" className="px-3 py-2 text-start font-medium">{tableHead[0]}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{tableHead[1]}</th>
                {tableHead[2] ? <th scope="col" className="px-3 py-2 text-end font-medium">{tableHead[2]}</th> : null}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((row) => (
                <tr key={row.date} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-3 py-1.5 text-start font-normal text-fg-2">{row.label}</th>
                  <td className="px-3 py-1.5 text-end tabular-nums text-fg">{valueText(mode, row.value)}</td>
                  {tableHead[2] ? <td className="px-3 py-1.5 text-end tabular-nums text-fg-2">{row.failed}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** «Что делает агент»: горизонтальные столбики по числу вызовов инструмента. */
export function ToolBars({ rows, emptyText }: Readonly<{ rows: readonly ChartHorizontalRow[]; emptyText: string }>) {
  if (rows.length === 0) return <p className="t-body-compact text-fg-2" data-testid="v3-aia-chart-empty">{emptyText}</p>;
  const max = Math.max(...rows.map((row) => row.count));
  return (
    <figure className="min-w-0" aria-label="Что делает агент: вызовы инструментов за 30 дней">
      <ul className="space-y-2.5" data-testid="v3-aia-tool-bars">
        {rows.map((row) => (
          <li key={row.tool}>
            <div className="flex items-baseline justify-between gap-3 t-body-compact">
              <span className="min-w-0 text-fg">{row.label}</span>
              <span className="shrink-0 tabular-nums text-fg-2">{row.count}</span>
            </div>
            <div aria-hidden="true" className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-fg-2" style={{ width: `${Math.max(2, (row.count / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Спарклайн карточки хаба: запуски за 14 дней, столбики одной высотной шкалы. */
export function RunsSparkline({ values }: Readonly<{ values: readonly number[] }>) {
  const total = values.reduce((sum, value) => sum + value, 0);
  const max = Math.max(1, ...values);
  const spoken = total === 0
    ? "За последние 14 дней запусков не было"
    : `Запусков за последние 14 дней: ${total}. По дням: ${values.join(", ")}`;
  return (
    <div role="img" aria-label={spoken} className="flex h-9 items-end gap-[2px]" data-testid="v3-aia-sparkline">
      {values.map((value, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`block min-w-[3px] flex-1 rounded-t-[2px] ${value > 0 ? "bg-fg-2" : "bg-border-strong"}`}
          style={{ height: value > 0 ? `${Math.max(12, (value / max) * 100)}%` : 1 }}
        />
      ))}
    </div>
  );
}
