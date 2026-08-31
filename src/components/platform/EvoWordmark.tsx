import { EvoMark } from "./brand/EvoMark";

/**
 * Lockup: the logobook mark beside the EVO / ADMISSIONS lettering. Until this
 * session the shell shipped the lettering alone, so the product never carried
 * its own mark.
 */
export function EvoWordmark({
  inverted = false,
  className = "",
}: {
  inverted?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`evo-wordmark ${inverted ? "evo-wordmark--inverted" : ""} ${className}`.trim()}
    >
      <EvoMark size={26} tone={inverted ? "inverted" : "brand"} className="evo-wordmark__mark" />
      <span className="evo-wordmark__lettering">
        <span className="evo-wordmark__name">EVO</span>
        <span className="evo-wordmark__admissions">Admissions</span>
      </span>
    </span>
  );
}
