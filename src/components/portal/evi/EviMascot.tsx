import type { EviMood } from "@/lib/portal/evi";

/**
 * Маскот Эви (решение владельца 16.11.2026, образец — робот-голова с тёмным визором): белый шлем, тёмное кольцо,
 * визор и глаза-огоньки. Мимика — только глаза и рот: `talk` и спокойствие — полумесяцы, `happy` — купола и улыбка,
 * `wow` — овалы и «о», `thinking` — полоски с взглядом в сторону, `eureka` — звёздочки. Слушает — смотрит вниз.
 * Цвета — токены `--pt-evi-*` в portal.css, без свечения; смена выражения — короткий переход, без зацикливания.
 */
export function EviMascot({ mood, listening = false }: Readonly<{ mood: EviMood | "idle"; listening?: boolean }>) {
  return (
    <svg
      className="pt-evi-mascot"
      data-mood={mood}
      data-listening={listening ? "" : undefined}
      viewBox="0 0 160 130"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="pt-evi-nub" x="67" y="4" width="26" height="11" rx="5.5" />
      <rect className="pt-evi-ear" x="-4" y="51" width="16" height="38" rx="6" />
      <rect className="pt-evi-band" x="4" y="53" width="3.5" height="34" rx="1.75" />
      <rect className="pt-evi-ear" x="148" y="51" width="16" height="38" rx="6" />
      <rect className="pt-evi-band" x="152.5" y="53" width="3.5" height="34" rx="1.75" />
      <rect className="pt-evi-helmet" x="8" y="10" width="144" height="116" rx="58" />
      <rect className="pt-evi-ring" x="13" y="15" width="134" height="106" rx="53" />
      <rect className="pt-evi-visor" x="16" y="18" width="128" height="100" rx="50" />
      <path className="pt-evi-shine" d="M34 42 Q52 26 84 24" />
      <g className="pt-evi-eyes">
        <g className="pt-evi-face" data-face="bowl">
          <path d="M41 63 H71 Q71 78 56 78 Q41 78 41 63 Z" />
          <path d="M89 63 H119 Q119 78 104 78 Q89 78 89 63 Z" />
        </g>
        <g className="pt-evi-face" data-face="dome">
          <path d="M41 76 Q41 58 56 58 Q71 58 71 76 Q56 70 41 76 Z" />
          <path d="M89 76 Q89 58 104 58 Q119 58 119 76 Q104 70 89 76 Z" />
        </g>
        <g className="pt-evi-face" data-face="oval">
          <ellipse cx="56" cy="67" rx="15" ry="10" />
          <ellipse cx="104" cy="67" rx="15" ry="10" />
        </g>
        <g className="pt-evi-face" data-face="scan">
          <rect x="39" y="64" width="22" height="7" rx="3.5" />
          <rect x="87" y="64" width="22" height="7" rx="3.5" />
        </g>
        <g className="pt-evi-face" data-face="star">
          <path d="M56 55 Q58.2 65.8 69 68 Q58.2 70.2 56 81 Q53.8 70.2 43 68 Q53.8 65.8 56 55 Z" />
          <path d="M104 55 Q106.2 65.8 117 68 Q106.2 70.2 104 81 Q101.8 70.2 91 68 Q101.8 65.8 104 55 Z" />
        </g>
      </g>
      <path className="pt-evi-face pt-evi-smile" data-face="smile" d="M72 95 Q80 100 88 95" />
      <ellipse className="pt-evi-face" data-face="o" cx="80" cy="96" rx="5.5" ry="7" />
    </svg>
  );
}
