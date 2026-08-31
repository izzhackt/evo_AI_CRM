/**
 * The EVO Admissions mark, taken verbatim from the vector in
 * docs/company/brand/evo-admissions-logobook.pdf (page 9).
 *
 * The logobook forbids recolouring it arbitrarily, distorting its
 * proportions, and applying effects, so this component exposes only the
 * treatments the book itself defines: brand red, mono-dark, and inverted.
 * It never scales non-uniformly and never takes a shadow or gradient.
 */
const MARK_PATH =
  "M 50.00 49.74 L 32.58 39.65 L 70.19 17.19 C 70.29 17.14 70.35 17.03 70.35 16.91 L 70.35 12.99 C 70.35 11.97 69.24 11.34 68.37 11.87 L 27.19 36.54 L 12.39 27.99 L 49.99 5.57 C 50.09 5.51 50.15 5.40 50.15 5.29 L 50.15 1.64 C 50.15 0.63 49.06 0.00 48.18 0.50 L 8.92 23.16 C 7.29 24.10 6.29 25.83 6.29 27.71 L 6.29 73.22 C 6.29 74.39 6.92 75.47 7.93 76.05 L 48.36 99.41 C 49.38 100.00 50.62 100.00 51.64 99.41 L 92.24 75.96 C 93.15 75.43 93.71 74.46 93.71 73.41 L 93.71 26.75 C 93.71 25.74 92.62 25.11 91.74 25.62 Z M 50.00 49.74";

export type EvoMarkTone = "brand" | "inverted" | "mono";

const TONE_FILL: Record<EvoMarkTone, string> = {
  brand: "var(--accent)",
  inverted: "var(--on-accent)",
  mono: "currentColor",
};

export function EvoMark({
  size = 24,
  tone = "brand",
  className = "",
}: {
  size?: number;
  tone?: EvoMarkTone;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={MARK_PATH} fill={TONE_FILL[tone]} fillRule="evenodd" />
    </svg>
  );
}

export { MARK_PATH as EVO_MARK_PATH };
