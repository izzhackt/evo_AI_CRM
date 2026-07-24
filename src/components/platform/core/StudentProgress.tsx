import { cn } from "@/components/ui";

type StageItem = {
  key: string;
  label: string;
};

export function StudentProgress({
  stages,
  currentStage,
  label,
  currentLabel,
  compact = false,
}: {
  stages: StageItem[];
  currentStage: string;
  label: string;
  currentLabel: string;
  compact?: boolean;
}) {
  const visibleStages = stages.filter((stage) => stage.key !== "archived");
  const safeStage = currentStage === "archived" ? "enrolled" : currentStage;
  const currentIndex = Math.max(0, visibleStages.findIndex((stage) => stage.key === safeStage));
  const progress = Math.round(((currentIndex + 1) / Math.max(1, visibleStages.length)) * 100);

  if (compact) {
    return (
      <div className="min-w-[128px]">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-fg-3">
          <span className="truncate">{currentLabel}</span>
          <span className="shrink-0 font-mono">{progress}%</span>
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-1.5 overflow-hidden rounded-full bg-surface-3"
        >
          <span className="block h-full rounded-full bg-ok" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-1">
      <ol aria-label={label} className="grid min-w-[720px] grid-cols-8">
        {visibleStages.map((stage, index) => {
          const complete = index < currentIndex;
          const current = index === currentIndex;
          return (
            <li
              key={stage.key}
              aria-current={current ? "step" : undefined}
              className="relative flex min-w-0 flex-col items-center px-1 text-center"
            >
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-1/2 top-[7px] h-px w-full",
                    index <= currentIndex ? "bg-ok" : "bg-border-strong",
                  )}
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-[1] h-[15px] w-[15px] rounded-full border-[3px] border-surface",
                  complete && "bg-ok",
                  current && "bg-accent",
                  !complete && !current && "bg-surface-3",
                )}
              />
              <span
                className={cn(
                  "mt-2 block max-w-[110px] text-[10.5px] leading-4",
                  current ? "font-bold text-fg" : complete ? "font-medium text-fg-2" : "text-fg-3",
                )}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
