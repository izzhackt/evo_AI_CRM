import { cn } from "@/components/ui";
import type { DocumentStatus } from "@/lib/domain";
import type { DocumentExperienceCopy } from "./document-copy";

type StepState = "complete" | "current" | "danger" | "blocked" | "upcoming";

function journeyStates(status: DocumentStatus, correctionRequested: boolean): StepState[] {
  if (status === "required" && !correctionRequested) {
    return ["current", "upcoming", "upcoming", "upcoming", "blocked"];
  }
  if (status === "uploaded") {
    return ["complete", "current", "upcoming", "upcoming", "blocked"];
  }
  if (status === "review") {
    return ["complete", "complete", "current", "upcoming", "blocked"];
  }
  if (status === "approved") {
    return ["complete", "complete", "complete", "current", "upcoming"];
  }
  return ["complete", "complete", "complete", "danger", "blocked"];
}

export function DocumentJourney({
  status,
  correctionRequested,
  copy,
}: {
  status: DocumentStatus;
  correctionRequested: boolean;
  copy: DocumentExperienceCopy;
}) {
  const labels = [
    copy.workflowSteps.requirement,
    copy.workflowSteps.received,
    copy.workflowSteps.review,
    copy.workflowSteps.decision,
    copy.workflowSteps.nextVersion,
  ];
  const states = journeyStates(status, correctionRequested);

  return (
    <section aria-labelledby="document-journey-title" className="rounded-card border border-border bg-surface shadow-evo">
      <header className="border-b border-border px-4 py-4 sm:px-5">
        <h2 id="document-journey-title" className="text-[14.5px] font-semibold text-fg">
          {copy.workflowTitle}
        </h2>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-fg-3">{copy.workflowDescription}</p>
      </header>
      <ol className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-5">
        {labels.map((label, index) => {
          const state = states[index];
          const stateLabel =
            state === "complete"
              ? copy.completedStep
              : state === "current" || state === "danger"
                ? copy.currentStep
                : state === "blocked"
                  ? copy.blockedStep
                  : "";

          return (
            <li
              key={label}
              aria-current={state === "current" || state === "danger" ? "step" : undefined}
              className={cn(
                "relative min-w-0 rounded-nav border px-3 py-3",
                state === "complete" && "border-ok/25 bg-ok-weak text-ok",
                state === "current" && "border-accent/30 bg-accent-weak text-accent",
                state === "danger" && "border-danger/30 bg-danger-weak text-danger",
                state === "blocked" && "border-warn/30 bg-warn-weak text-warn",
                state === "upcoming" && "border-border bg-surface-2 text-fg-3",
              )}
            >
              <span className="block font-mono text-[10px] font-semibold opacity-70">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="mt-1 block text-[12.5px] font-semibold leading-4">{label}</span>
              {stateLabel && <span className="mt-1.5 block text-[10.5px] font-medium opacity-75">{stateLabel}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
