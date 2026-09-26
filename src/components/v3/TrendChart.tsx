/**
 * График «Динамики по дням» «Отчёта продаж»: основная серия сплошной линией,
 * остальные — пунктиром своего рисунка, редкая сетка, отмеченный последний
 * узел.
 *
 * ЧЕРНИЛА, А НЕ КРАСНЫЙ (Э3, 26.09.2026). Красный в этом мире — главное
 * действие страницы и проблема (DESIGN.md, уточнение 25.09), а график не
 * одно и не другое: линии — цвет текста, без розовой заливки под линией.
 * Серии различаются рисунком линии и подписаны в легенде — не цветом.
 *
 * ПО ШИРИНЕ КОНТЕЙНЕРА. Поле графика — SVG с `preserveAspectRatio="none"`:
 * оно растягивается на любую ширину, а толщина и пунктир линий не меняются
 * (`vector-effect: non-scaling-stroke`). Подписи осей и последний узел — HTML
 * поверх поля, поэтому на телефоне кегль тот же 12 px, что на широком
 * экране, и видны все дни периода без прокрутки. Какие подписи дат стоят,
 * решает `trendTicks` заранее для ступеней ширины контейнера (container
 * queries): на узком графике подписи редеют, но первая и последняя остаются.
 *
 * Библиотеки графиков нет: она принесла бы свою палитру и типографику.
 */

export type TrendSeries = Readonly<{
  label: string;
  values: readonly number[];
  /** Основная серия — сплошная линия, остальные — пунктир по порядку `SECONDARY_DASH`. */
  emphasis: "primary" | "secondary";
}>;

/** Рисунок пунктира второстепенных серий по порядку: две серии не сливаются в одну. */
export const SECONDARY_DASH = ["5 4", "1.5 3.5"] as const;

/**
 * Ступени ширины контейнера графика (px), с которых меняется набор подписей
 * дат. Нулевая ступень считается для самого узкого графика — телефона 320 px
 * без полей страницы и карточки.
 */
export const TICK_TIERS = [240, 320, 448, 640] as const;
// Классы ступеней — строками целиком: так их находит Tailwind.
const TIER_SHOW = ["block", "@min-[20rem]/trend:block", "@min-[28rem]/trend:block", "@min-[40rem]/trend:block"] as const;
const TIER_HIDE = ["hidden", "@min-[20rem]/trend:hidden", "@min-[28rem]/trend:hidden", "@min-[40rem]/trend:hidden"] as const;

/** Ширина оси значений и зазора до поля, px (четыре цифры `t-meta` с запасом). */
const AXIS_WIDTH = 40;
/** Средняя ширина знака подписи 12 px, px, с запасом (Golos, цифры ≈ 6.4). */
const LABEL_CHAR_PX = 7.2;
const LABEL_GAP_PX = 12;

export type TrendTick = Readonly<{
  label: string;
  index: number;
  /** Место на оси, доля ширины поля 0…1. */
  at: number;
  anchor: "start" | "middle" | "end";
  /** Видна ли подпись на каждой ступени `TICK_TIERS`. */
  shown: readonly boolean[];
}>;

/**
 * Подписи делений, которые на каждой ступени ширины встают без наложения.
 * На ступени берётся каждая k-я подпись с наименьшим k, при котором ничего не
 * наезжает, — шаг ровный. Крайние подписи прижаты к своему краю, остальные —
 * по центру деления. Последнее деление называет конец периода и остаётся
 * всегда (соседняя с ним подпись уступает место). Первая подпись может нести
 * год («26 дек 2025») и тогда шире шага — уступает только её сосед.
 */
export function trendTicks(ticks: readonly string[]): readonly TrendTick[] {
  const last = ticks.length - 1;
  const placed = ticks.flatMap((label, index) => label ? [{
    label,
    index,
    at: last > 0 ? index / last : 0,
    anchor: (index === 0 ? "start" : index === last ? "end" : "middle") as TrendTick["anchor"],
  }] : []);
  const tiers = TICK_TIERS.map((container) => {
    const width = container - AXIS_WIDTH;
    const span = (tick: (typeof placed)[number]) => {
      const x = tick.at * width;
      const size = tick.label.length * LABEL_CHAR_PX;
      const left = tick.anchor === "start" ? x : tick.anchor === "end" ? x - size : x - size / 2;
      return { left, right: left + size };
    };
    const overlaps = (a: (typeof placed)[number], b: (typeof placed)[number]) => span(b).left < span(a).right + LABEL_GAP_PX;
    const wideFirst = placed.length > 1 && placed[0].index === 0 && placed[0].label.length > placed[1].label.length;
    for (let step = 1; step <= Math.max(placed.length, 1); step += 1) {
      const chosen = placed.filter((tick, order) => order % step === 0 || tick.index === last);
      // Конец периода остаётся: соседи, на которых он наезжает, уступают.
      while (chosen.length > 1 && chosen.at(-1)!.index === last && overlaps(chosen.at(-2)!, chosen.at(-1)!)) chosen.splice(-2, 1);
      // Первая подпись с годом шире шага: уступает только сосед.
      if (wideFirst) while (chosen.length > 2 && overlaps(chosen[0], chosen[1])) chosen.splice(1, 1);
      if (chosen.every((tick, order) => order === 0 || !overlaps(chosen[order - 1], tick))) return new Set(chosen.map((tick) => tick.index));
    }
    return new Set(placed.filter((tick) => tick.index === last || tick.index === placed[0]?.index).map((tick) => tick.index));
  });
  return placed.map((tick) => Object.freeze({ ...tick, shown: Object.freeze(tiers.map((tier) => tier.has(tick.index))) }));
}

/** Классы видимости подписи по ступеням: только там, где видимость меняется. */
function tierClass(shown: readonly boolean[]): string {
  return shown.map((on, tier) => tier === 0 || on !== shown[tier - 1] ? (on ? TIER_SHOW[tier] : TIER_HIDE[tier]) : "")
    .filter(Boolean).join(" ");
}

export type TrendGrid = Readonly<{ value: number; y: number }>;

/** Линии сетки: 0, середина и максимум — без повторов; `y` — доля высоты сверху (0…100). */
export function trendGrid(series: readonly TrendSeries[]): Readonly<{ max: number; grid: readonly TrendGrid[] }> {
  const max = Math.max(1, ...series.flatMap((one) => [...one.values]));
  const grid = [...new Set([0, Math.round(max / 2), max])].map((value) => Object.freeze({ value, y: 100 - (value / max) * 100 }));
  return Object.freeze({ max, grid: Object.freeze(grid) });
}

function pointsOf(values: readonly number[], max: number) {
  const steps = Math.max(values.length - 1, 1);
  return values.map((value, index) => ({ x: (index / steps) * 100, y: 100 - (value / max) * 100 }));
}

function dashOf(series: readonly TrendSeries[], one: TrendSeries): string | undefined {
  if (one.emphasis === "primary") return undefined;
  const order = series.filter((entry) => entry.emphasis === "secondary").indexOf(one);
  return SECONDARY_DASH[Math.max(0, order) % SECONDARY_DASH.length];
}

export function TrendChart({
  series,
  ticks,
  caption,
}: {
  series: readonly TrendSeries[];
  /** Подписи по оси. Пустая строка — деление без подписи. */
  ticks: readonly string[];
  caption: string;
}) {
  const { max, grid } = trendGrid(series);
  const primary = series.find((one) => one.emphasis === "primary");
  const lastPoint = primary ? pointsOf(primary.values, max).at(-1) : undefined;
  const spoken = series.map((one) => `${one.label}: ${one.values.join(", ")}`).join("; ");

  return (
    <figure role="group" aria-label={caption} className="@container/trend min-w-0">
      {series.length > 1 ? (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 t-meta text-fg-2">
          {series.map((one) => (
            <li key={one.label} className="inline-flex items-center gap-1.5">
              <svg aria-hidden="true" width="18" height="6" viewBox="0 0 18 6" className="shrink-0">
                <line x1="0" y1="3" x2="18" y2="3" stroke={one.emphasis === "primary" ? "var(--text)" : "var(--text-2)"}
                  strokeWidth={one.emphasis === "primary" ? 2 : 1.5} strokeDasharray={dashOf(series, one)} strokeLinecap="round" />
              </svg>
              {one.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* Ось значений: невидимый максимум задаёт ширину колонки. */}
        <div aria-hidden="true" className="relative h-44 t-meta tabular-nums text-fg-3">
          <span className="invisible block">{max}</span>
          {grid.map((line) => (
            <span key={line.value} data-trend-value={line.value} className="absolute end-0 -translate-y-1/2" style={{ top: `${line.y}%` }}>
              {line.value}
            </span>
          ))}
        </div>

        <div className="relative h-44 min-w-0">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" role="img" aria-label={`${caption}. ${spoken}`}>
            {grid.map((line) => (
              <line key={line.value} x1="0" y1={line.y} x2="100" y2={line.y} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((one) => {
              const points = pointsOf(one.values, max);
              if (points.length === 0) return null;
              return (
                <path
                  key={one.label}
                  d={`M ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")}`}
                  fill="none"
                  stroke={one.emphasis === "primary" ? "var(--text)" : "var(--text-2)"}
                  strokeWidth={one.emphasis === "primary" ? 2 : 1.5}
                  strokeDasharray={dashOf(series, one)}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          {/* Последний узел основной серии: «вот где мы сейчас». */}
          {lastPoint ? (
            <span aria-hidden="true" className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fg bg-surface"
              style={{ left: `${lastPoint.x}%`, top: `${lastPoint.y}%` }} />
          ) : null}
        </div>

        <span aria-hidden="true" />
        <div aria-hidden="true" className="relative h-6 t-meta tabular-nums text-fg-3">
          {trendTicks(ticks).map((tick) => (
            <span
              key={`${tick.label}-${tick.index}`}
              data-trend-tick={tick.index}
              className={`absolute top-1.5 whitespace-nowrap ${tick.anchor === "middle" ? "-translate-x-1/2" : tick.anchor === "end" ? "-translate-x-full" : ""} ${tierClass(tick.shown)}`}
              style={{ left: `${tick.at * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
