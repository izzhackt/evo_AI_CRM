import { EVO_MARK_PATH } from "./EvoMark";

/**
 * Pattern No. 1 from the logobook (p. 16).
 *
 * The book tessellates the mark **tightly** on its own isometric lattice —
 * cubes interlock edge to edge with no gap — and clips the field to a wedge
 * in one corner, so the page keeps a large clear area and the texture never
 * runs under the content.
 *
 * The mark's silhouette is an isometric cube, i.e. a pointy-top regular
 * hexagon: width/height = sqrt(3)/2 = 0.866, and the extracted path measures
 * 0.874. That is what makes a seamless tiling possible at all, and it fixes
 * the lattice: columns one width apart, rows three quarters of a height
 * apart, alternate rows offset by half a width.
 *
 * It belongs only on surfaces with room to spare: the gate, the entry page, a
 * deferred module, a denied route. It never sits behind dense working data.
 *
 * One inert SVG, one <pattern> tile, no image request, invisible to assistive
 * technology and untouchable by the pointer.
 */
const CUBE_ASPECT = 0.874; // the mark's own width-to-height ratio

export function EvoIsometricField({
  className = "",
  opacity = 0.06,
  scale = 76,
}: {
  className?: string;
  opacity?: number;
  scale?: number;
}) {
  // The id is derived from the geometry, not from a counter: a module-level
  // counter would advance per server render and desynchronise from the
  // client's, and React would report a hydration mismatch on the attribute.
  // Two fields at the same scale produce byte-identical tiles, so sharing one
  // definition is correct; different scales get different ids.
  const uid = `evo-iso-${String(scale).replace(".", "_")}`;

  const cubeH = scale;
  const cubeW = scale * CUBE_ASPECT;
  // Pointy-top hexagonal tiling: one column wide, two staggered rows tall.
  const tileW = cubeW;
  const tileH = cubeH * 1.5;
  const unit = scale / 100;

  // Row A at the tile origin, row B offset half a column and three quarters
  // of a cube down. Each is repeated across every tile edge it crosses so the
  // seam closes on all four sides.
  const seats: Array<[number, number]> = [];
  for (const [cx, cy] of [
    [0, 0],
    [tileW / 2, cubeH * 0.75],
  ]) {
    for (const dx of [-tileW, 0, tileW]) {
      for (const dy of [-tileH, 0, tileH]) {
        seats.push([cx + dx - cubeW / 2, cy + dy - cubeH / 2]);
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
        <pattern id={uid} width={tileW} height={tileH} patternUnits="userSpaceOnUse">
          <g fill="var(--evo-iso-ink)" fillRule="evenodd">
            {seats.map(([x, y]) => (
              <path
                key={`${x.toFixed(2)}-${y.toFixed(2)}`}
                d={EVO_MARK_PATH}
                transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${unit})`}
              />
            ))}
          </g>
        </pattern>
        {/* The book's corner wedge. The diagonal reaches full transparency at
            the box's own top-right and bottom-left corners, so the field has
            no hard edge anywhere except the page corner it sits in. */}
        <linearGradient id={`${uid}-wedge`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={`${uid}-mask`}>
          <rect width="100%" height="100%" fill={`url(#${uid}-wedge)`} />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={`url(#${uid})`}
        mask={`url(#${uid}-mask)`}
      />
    </svg>
  );
}
