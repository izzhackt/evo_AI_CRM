/** Independent current counts: the connected path never implies conversion. */
export type FunnelStage = Readonly<{ name: string; value: number }>;

export function Funnel({ stages, caption }: {
  stages: readonly FunnelStage[];
  caption: string;
}) {
  const largest = Math.max(0, ...stages.map(stage => stage.value));
  return (
    <ol aria-label={caption} className="relative space-y-1">
      {stages.map((stage, index) => (
        <li key={stage.name} className="relative grid min-h-12 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2">
          <span aria-hidden="true" className="relative flex h-full items-center justify-center">
            {index > 0 ? <span className="absolute bottom-1/2 top-[-0.75rem] w-px bg-control-edge" /> : null}
            {index < stages.length - 1 ? <span className="absolute bottom-[-0.75rem] top-1/2 w-px bg-control-edge" /> : null}
            <span className={`relative size-2 rounded-full ${stage.value > 0 ? "bg-accent" : "border border-control-edge bg-surface"}`} />
          </span>
          <span className="min-w-0 text-sm text-fg-2">{stage.name}</span>
          <span className="text-sm font-semibold tabular-nums text-fg">{stage.value.toLocaleString("ru-RU")}</span>
          <span aria-hidden="true" className="col-start-2 col-end-4 mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${largest === 0 ? 0 : stage.value / largest * 100}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}
