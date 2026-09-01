/**
 * Воронка поступления.
 *
 * Форма взята из референса: трапеция на ступень, верхнее ребро пропорционально
 * её числу, нижнее — числу следующей; число внутри; подпись слева с указателем;
 * конверсия на дуге справа.
 *
 * Геометрия считается из данных, поэтому ступень без потерь рисуется прямой
 * стенкой, а не подделывается под сужение. Это не мелочь: на горизонтальных
 * полосах три одинаковые ступени читались как «ещё три строки», а трубой они
 * сразу показывают, что процесс перестал отсеивать.
 *
 * Цвета — только токены EVO, иначе фигура не переживёт смену темы.
 */

export type FunnelStage = Readonly<{
  /** Подпись слева. */
  name: string;
  /** Число внутри ступени. */
  value: number;
}>;

const TOP = 34;
const BAND = 52;
const GAP = 5;
const CENTRE = 392;
const HALF_MAX = 146;
/** Пол, чтобы узкий конец всё ещё держал своё число. */
const HALF_MIN = 38;
const LABEL_COLUMN = 200;
const VIEW_WIDTH = 760;

function halfWidth(value: number, top: number) {
  if (top <= 0) return HALF_MIN;
  return HALF_MIN + (HALF_MAX - HALF_MIN) * (value / top);
}

export function Funnel({
  stages,
  caption,
}: {
  stages: readonly FunnelStage[];
  caption: string;
}) {
  if (stages.length === 0) return null;

  const top = stages[0].value;
  const bands = stages.map((stage, index) => {
    const next = stages[index + 1]?.value ?? stage.value;
    const y0 = TOP + index * (BAND + GAP);
    const halfTop = halfWidth(stage.value, top);
    const halfBottom = halfWidth(next, top);
    const previous = stages[index - 1];
    return {
      ...stage,
      y0,
      y1: y0 + BAND,
      middle: y0 + BAND / 2,
      halfTop,
      halfBottom,
      // Прямая стенка означает «здесь ничего не отсеивается» и рисуется как есть.
      narrows: halfBottom < halfTop - 0.5,
      conversion:
        previous && previous.value > 0
          ? Math.round((stage.value / previous.value) * 100)
          : null,
    };
  });

  const height = bands[bands.length - 1].y1 + 22;
  const spoken = stages.map((s) => `${s.name} ${s.value}`).join(", ");

  return (
    // Фигура шире телефона; прокручивается внутри своего контейнера, чтобы
    // страница никогда не ехала вбок (SC 1.4.10). Прокручиваемая область
    // обязана иметь клавиатурный доступ (SC 2.1.1) -- без tabIndex мышь
    // прокручивает, а клавиатура нет, и часть фигуры недостижима. Кольцо
    // фокуса приходит из globals.css, где оно уже висит на любом [tabindex].
    //
    // Контраст внутри фигуры axe посчитать не может (текст в SVG), поэтому
    // проверен арифметически по токенам: число #ffffff на #d70217 = 5.37:1,
    // процент на поверхности 5.73:1 (светлая) и 5.98:1 (тёмная).
    <div
      role="group"
      aria-label={caption}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-ctl"
    >
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        className="h-auto w-full min-w-[700px]"
        role="img"
        aria-label={`${caption}: ${spoken}`}
      >
        <defs>
          <linearGradient id="evo-funnel-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent-2, var(--accent))" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          <marker
            id="evo-funnel-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6.5"
            refY="3.5"
            orient="auto"
          >
            <path d="M0 0 L7 3.5 L0 7 z" fill="var(--control-edge)" />
          </marker>
        </defs>

        {bands.map((band) => (
          <g key={band.name}>
            <text
              x="14"
              y={band.middle + 5}
              fontSize="14"
              fill="var(--text)"
              fontFamily="var(--font-golos), system-ui, sans-serif"
            >
              {band.name}{" "}
              <tspan fill="var(--text-3)">({band.value})</tspan>
            </text>

            <line
              x1={LABEL_COLUMN}
              y1={band.middle}
              x2={CENTRE - band.halfTop - 12}
              y2={band.middle}
              stroke="var(--control-edge)"
              strokeWidth="1.4"
              markerEnd="url(#evo-funnel-arrow)"
            />

            <path
              d={`M ${CENTRE - band.halfTop} ${band.y0} L ${CENTRE + band.halfTop} ${band.y0} L ${CENTRE + band.halfBottom} ${band.y1} L ${CENTRE - band.halfBottom} ${band.y1} Z`}
              fill="url(#evo-funnel-face)"
            />

            <text
              x={CENTRE}
              y={band.middle + 7}
              textAnchor="middle"
              fontSize="19"
              fontWeight="600"
              fill="var(--on-accent)"
              style={{ fontVariantNumeric: "tabular-nums" }}
              fontFamily="var(--font-golos), system-ui, sans-serif"
            >
              {band.value}
            </text>
          </g>
        ))}

        {bands.map((band, index) => {
          if (band.conversion === null) return null;
          const previous = bands[index - 1];
          const startX = CENTRE + previous.halfBottom + 6;
          const startY = previous.middle + 16;
          const endX = CENTRE + band.halfTop + 6;
          const endY = band.middle - 4;
          const pillX = Math.max(startX, endX) + 58;
          const pillY = (startY + endY) / 2;
          return (
            <g key={`${band.name}-conversion`}>
              <path
                d={`M ${startX} ${startY} C ${pillX} ${startY} ${pillX} ${endY} ${endX} ${endY}`}
                fill="none"
                stroke="var(--control-edge)"
                strokeWidth="1.4"
              />
              <rect
                x={pillX - 25}
                y={pillY - 12}
                width="50"
                height="24"
                rx="12"
                fill="var(--surface)"
                stroke="var(--control-edge)"
              />
              <text
                x={pillX}
                y={pillY + 5}
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                fill="var(--accent-text)"
                style={{ fontVariantNumeric: "tabular-nums" }}
                fontFamily="var(--font-golos), system-ui, sans-serif"
              >
                {band.conversion}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
