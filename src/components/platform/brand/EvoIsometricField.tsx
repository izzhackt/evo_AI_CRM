import { EVO_MARK_PATH } from "./EvoMark";

/**
 * The logobook's pattern: the mark repeated on a diagonal isometric lattice.
 *
 * The book spaces its cubes apart rather than tiling them edge to edge — this
 * mark is not a closed hexagon, so touching copies merge into horizontal bands
 * and stop reading as the mark at all. The gaps below reproduce Pattern No. 1.
 *
 * It belongs only on surfaces with room to spare: the gate, the entry page, a
 * deferred module, a denied route. It never sits behind dense working data,
 * where texture competes with the task.
 *
 * One inert SVG, one <pattern> tile, no image request, invisible to assistive
 * technology and untouchable by the pointer.
 */
const CUBE_ASPECT = 0.874; // the mark's own width-to-height ratio
const GAP_X = 1.7;
const GAP_Y = 1.25;

export function EvoIsometricField({
  className = "",
  opacity = 0.06,
  scale = 88,
}: {
  className?: string;
  opacity?: number;
  scale?: number;
}) {
  const cubeW = scale * CUBE_ASPECT;
  const tileW = cubeW * GAP_X;
  const tileH = scale * GAP_Y * 2;
  const unit = scale / 100;

  // Two cubes per tile on opposite diagonals, each repeated across every tile
  // edge it crosses so the seam closes in both axes.
  const seats: Array<[number, number]> = [];
  for (const [cx, cy] of [
    [tileW * 0.25, tileH * 0.25],
    [tileW * 0.75, tileH * 0.75],
  ]) {
    for (const dx of [-tileW, 0, tileW]) {
      for (const dy of [-tileH, 0, tileH]) {
        seats.push([cx + dx - cubeW / 2, cy + dy - scale / 2]);
      }
    }
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`evo-iso-field ${className}`.trim()}
      style={{ opacity }}
    >
      <defs>
        <pattern
          id="evo-iso"
          width={tileW}
          height={tileH}
          patternUnits="userSpaceOnUse"
        >
          <g fill="currentColor" fillRule="evenodd">
            {seats.map(([x, y]) => (
              <path
                key={`${x.toFixed(2)}-${y.toFixed(2)}`}
                d={EVO_MARK_PATH}
                transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${unit})`}
              />
            ))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#evo-iso)" />
    </svg>
  );
}
