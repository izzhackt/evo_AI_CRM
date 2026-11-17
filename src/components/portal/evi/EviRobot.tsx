import { useId } from "react";

import type { EviMood } from "@/lib/portal/evi";

export type EviFace = EviMood | "idle";

/**
 * Робот Эви (образец выбрал владелец 16.11.2026): белый шлем с объёмом, тёмное кольцо, визор и глаза-огоньки. Только
 * рисунок — лицо приходит готовым (`face`), выбирает его `EviMascot`. Мимика — глаза и рот: `idle` и `talk` — полумесяцы
 * (у `talk` рот говорит), `happy` — купола и улыбка, `wow` — овалы и «о», `thinking` — полоски, `eureka` — звёздочки.
 * Цвета — токены `--pt-evi-*` в portal.css (у градиентов — через классы `<stop>`), без свечения и фильтров; движение —
 * блок «Живой Эви» там же. Идентификаторы градиентов уникальны, чтобы на одном экране могло стоять несколько роботов.
 */
export function EviRobot({ face, listening = false, settled = false }: Readonly<{
  face: EviFace;
  listening?: boolean;
  /** Лицо без разовой реакции (подскок, «поп», прыжок): реплика уже не новая. */
  settled?: boolean;
}>) {
  const id = useId().replace(/\W/gu, "");
  return (
    <svg
      className="pt-evi-mascot"
      data-mood={face}
      data-listening={listening ? "" : undefined}
      data-settled={settled ? "" : undefined}
      viewBox="0 0 160 130"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-h`} cx=".38" cy=".3" r=".8">
          <stop offset="0" className="pt-evi-helm-0" />
          <stop offset=".55" className="pt-evi-helm-1" />
          <stop offset=".85" className="pt-evi-helm-2" />
          <stop offset="1" className="pt-evi-helm-3" />
        </radialGradient>
        <radialGradient id={`${id}-v`} cx=".5" cy=".55" r=".65">
          <stop offset="0" className="pt-evi-vis-0" />
          <stop offset=".7" className="pt-evi-vis-1" />
          <stop offset="1" className="pt-evi-vis-2" />
        </radialGradient>
        <linearGradient id={`${id}-n`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="pt-evi-nub-0" />
          <stop offset="1" className="pt-evi-nub-1" />
        </linearGradient>
      </defs>
      <g className="pt-evi-robot-head">
        <rect className="pt-evi-nub" x="67" y="4" width="26" height="11" rx="5.5" fill={`url(#${id}-n)`} />
        <rect className="pt-evi-gloss" x="72" y="5.5" width="11" height="3" rx="1.5" />
        <rect className="pt-evi-ear" x="-4" y="51" width="16" height="38" rx="6" />
        <rect className="pt-evi-ear-line" x="-1.5" y="54" width="3" height="32" rx="1.5" />
        <rect className="pt-evi-band" x="4" y="53" width="3.5" height="34" rx="1.75" />
        <rect className="pt-evi-ear" x="148" y="51" width="16" height="38" rx="6" />
        <rect className="pt-evi-ear-line" x="158.5" y="54" width="3" height="32" rx="1.5" />
        <rect className="pt-evi-band" x="152.5" y="53" width="3.5" height="34" rx="1.75" />
        <rect x="8" y="10" width="144" height="116" rx="58" fill={`url(#${id}-h)`} />
        <rect className="pt-evi-ring" x="13" y="15" width="134" height="106" rx="53" />
        <rect x="16" y="18" width="128" height="100" rx="50" fill={`url(#${id}-v)`} />
        <path className="pt-evi-shine" d="M34 42 Q52 26 84 24" />
        <rect className="pt-evi-flash" x="16" y="18" width="128" height="100" rx="50" />
        <g className="pt-evi-eyes">
          <g className="pt-evi-face pt-evi-lids" data-face="bowl">
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
            <rect x="45" y="64" width="22" height="7" rx="3.5" />
            <rect x="93" y="64" width="22" height="7" rx="3.5" />
          </g>
          <g className="pt-evi-face" data-face="star">
            <path className="pt-evi-star" d="M56 55 Q58.2 65.8 69 68 Q58.2 70.2 56 81 Q53.8 70.2 43 68 Q53.8 65.8 56 55 Z" />
            <path className="pt-evi-star" d="M104 55 Q106.2 65.8 117 68 Q106.2 70.2 104 81 Q101.8 70.2 91 68 Q101.8 65.8 104 55 Z" />
          </g>
        </g>
        <path className="pt-evi-face pt-evi-smile" data-face="smile" d="M72 95 Q80 100 88 95" />
        <rect className="pt-evi-face pt-evi-mouth-talk" data-face="talk" x="72" y="91" width="16" height="7" rx="3.5" />
        <ellipse className="pt-evi-face" data-face="o" cx="80" cy="96" rx="6" ry="8" />
      </g>
    </svg>
  );
}
