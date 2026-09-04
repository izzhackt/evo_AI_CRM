/**
 * График динамики: основная серия площадью, вторая пунктиром, редкая сетка,
 * выделенный последний узел.
 *
 * Рисуется тем же способом, что и воронка — собственным SVG, а не графической
 * библиотекой. Библиотека принесла бы свою палитру и свою типографику, и с ними
 * пришлось бы воевать; здесь цвета берутся из токенов EVO и переживают смену
 * темы, а вся геометрия — это пересчёт значений в координаты.
 */

export type TrendSeries = Readonly<{
  label: string;
  values: readonly number[];
  /** Основная серия рисуется линией с площадью, вторая — пунктиром. */
  emphasis: "primary" | "secondary";
}>;

const WIDTH = 620;
const HEIGHT = 220;
const PAD_LEFT = 44;
const PAD_RIGHT = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;

function pointsOf(values: readonly number[], max: number) {
  const steps = Math.max(values.length - 1, 1);
  return values.map((value, index) => ({
    x: PAD_LEFT + (index * (WIDTH - PAD_LEFT - PAD_RIGHT)) / steps,
    y:
      HEIGHT -
      PAD_BOTTOM -
      (max > 0 ? value / max : 0) * (HEIGHT - PAD_TOP - PAD_BOTTOM),
  }));
}

function lineOf(points: { x: number; y: number }[], close = false) {
  const d = `M ${points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")}`;
  if (!close) return d;
  const last = points[points.length - 1];
  const first = points[0];
  return `${d} L ${last.x.toFixed(1)} ${HEIGHT - PAD_BOTTOM} L ${first.x.toFixed(1)} ${HEIGHT - PAD_BOTTOM} Z`;
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
  const max = Math.max(1, ...series.flatMap((s) => [...s.values]));
  const primary = series.find((s) => s.emphasis === "primary");
  const gridValues = [0, Math.round(max / 2), max];
  const spoken = series
    .map((s) => `${s.label}: ${s.values.join(", ")}`)
    .join("; ");

  return (
    // Прокручиваемая область обязана иметь клавиатурный доступ (SC 2.1.1):
    // без tabIndex мышь прокручивает график, а клавиатура нет.
    <div
      role="group"
      aria-label={caption}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-ctl"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full min-w-[480px]"
        role="img"
        aria-label={`${caption}. ${spoken}`}
      >
        <defs>
          <linearGradient id="evo-trend-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridValues.map((value) => {
          const y =
            HEIGHT -
            PAD_BOTTOM -
            (max > 0 ? value / max : 0) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
          return (
            <g key={value}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={WIDTH - PAD_RIGHT}
                y2={y}
                stroke="var(--border)"
                strokeWidth="1"
              />
              <text
                x={PAD_LEFT - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-3)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {value}
              </text>
            </g>
          );
        })}

        {primary ? (
          <path d={lineOf(pointsOf(primary.values, max), true)} fill="url(#evo-trend-area)" />
        ) : null}

        {series.map((one) => {
          const points = pointsOf(one.values, max);
          const isPrimary = one.emphasis === "primary";
          return (
            <path
              key={one.label}
              d={lineOf(points)}
              fill="none"
              stroke={isPrimary ? "var(--accent)" : "var(--text-3)"}
              strokeWidth={isPrimary ? 2.4 : 1.6}
              strokeDasharray={isPrimary ? undefined : "3 3"}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* Последняя точка основной серии: «вот где мы сейчас». */}
        {primary
          ? (() => {
              const last = pointsOf(primary.values, max).at(-1);
              if (!last) return null;
              return (
                <circle
                  cx={last.x}
                  cy={last.y}
                  r="4.5"
                  fill="var(--surface)"
                  stroke="var(--accent)"
                  strokeWidth="2.4"
                />
              );
            })()
          : null}

        {ticks.map((tick, index) =>
          tick ? (
            <text
              key={`${tick}-${index}`}
              x={PAD_LEFT + (index * (WIDTH - PAD_LEFT - PAD_RIGHT)) / Math.max(ticks.length - 1, 1)}
              y={HEIGHT - 8}
              // Крайние подписи прижимаются к своему краю, а не центрируются:
              // при семи и менее делениях последняя стояла ровно на границе
              // кадра и половина текста уходила за него.
              textAnchor={
                index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"
              }
              fontSize="10"
              fill="var(--text-3)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {tick}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
