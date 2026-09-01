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

/**
 * Две раскладки одной фигуры.
 *
 * Просторная — как в референсе: подпись слева с указателем, конверсия справа
 * на дуге. Ей нужно 760 единиц ширины.
 *
 * Плотная — для узкой колонки, где просторная не помещается и её подписи
 * уезжают за край. Дуги справа убраны, конверсия встаёт короткой строкой у
 * ступени. График, у которого не видно подписей, бесполезен, поэтому здесь
 * лучше отказаться от украшения, чем от читаемости.
 */
const LAYOUT = {
  roomy: { centre: 392, halfMax: 146, halfMin: 38, labelColumn: 200, width: 760, arcs: true, connectors: true },
  // Самая длинная подпись кончается на 174 единицах (замерено в браузере),
  // поэтому колонка 186 и никаких стрелок: на них осталось бы 6 единиц, а
  // указатель длиной в шесть пикселей -- это не указатель.
  tight: { centre: 314, halfMax: 118, halfMin: 34, labelColumn: 186, width: 490, arcs: false, connectors: false },
} as const;

function halfWidth(value: number, top: number, halfMin: number, halfMax: number) {
  if (top <= 0) return halfMin;
  return halfMin + (halfMax - halfMin) * (value / top);
}

export function Funnel({
  stages,
  caption,
  density = "roomy",
}: {
  stages: readonly FunnelStage[];
  caption: string;
  /** «tight» — для колонки уже ~560px, где просторная раскладка обрезается. */
  density?: keyof typeof LAYOUT;
}) {
  if (stages.length === 0) return null;

  const L = LAYOUT[density];
  const top = stages[0].value;
  const bands = stages.map((stage, index) => {
    const next = stages[index + 1]?.value ?? stage.value;
    const y0 = TOP + index * (BAND + GAP);
    const halfTop = halfWidth(stage.value, top, L.halfMin, L.halfMax);
    const halfBottom = halfWidth(next, top, L.halfMin, L.halfMax);
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
        viewBox={`0 0 ${L.width} ${height}`}
        className={`h-auto w-full ${density === "roomy" ? "min-w-[700px]" : "min-w-[440px]"}`}
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

            {L.connectors ? (
              <line
                x1={L.labelColumn}
                y1={band.middle}
                x2={L.centre - band.halfTop - 12}
                y2={band.middle}
                stroke="var(--control-edge)"
                strokeWidth="1.4"
                markerEnd="url(#evo-funnel-arrow)"
              />
            ) : null}

            <path
              d={`M ${L.centre - band.halfTop} ${band.y0} L ${L.centre + band.halfTop} ${band.y0} L ${L.centre + band.halfBottom} ${band.y1} L ${L.centre - band.halfBottom} ${band.y1} Z`}
              fill="url(#evo-funnel-face)"
            />

            <text
              x={L.centre}
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

          if (!L.arcs) {
            // Плотная раскладка: процент стоит у ступени, без дуги и пилюли.
            return (
              <text
                key={`${band.name}-conversion`}
                x={L.centre + band.halfTop + 10}
                y={band.middle + 4}
                fontSize="12"
                fontWeight="600"
                fill="var(--accent-text)"
                style={{ fontVariantNumeric: "tabular-nums" }}
                fontFamily="var(--font-golos), system-ui, sans-serif"
              >
                {band.conversion}%
              </text>
            );
          }

          const previous = bands[index - 1];
          const startX = L.centre + previous.halfBottom + 6;
          const startY = previous.middle + 16;
          const endX = L.centre + band.halfTop + 6;
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
