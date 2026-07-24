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
      <span className="evo-wordmark__name">EVO</span>
      <span className="evo-wordmark__dot" />
      <span className="evo-wordmark__admissions">Admissions</span>
    </span>
  );
}
