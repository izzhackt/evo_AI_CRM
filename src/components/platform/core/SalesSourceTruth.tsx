import { Icon } from "@/components/icons";
import type { SalesCopy } from "./SalesCopy";

export function SalesSourceTruth({
  copy,
  title,
  body,
  syncLabel,
}: {
  copy: SalesCopy;
  title: string;
  body: string;
  syncLabel: string;
}) {
  return (
    <aside
      aria-labelledby="sales-source-truth-title"
      className="rounded-card border border-border bg-warn-weak px-4 py-4 sm:px-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-surface text-warn shadow-evo">
          <Icon name="alert" size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="sales-source-truth-title"
              className="text-[14px] font-semibold text-fg"
            >
              {title}
            </h2>
            <span className="inline-flex min-h-6 items-center rounded-full bg-surface px-2.5 text-[11px] font-semibold text-warn">
              {syncLabel}
            </span>
          </div>
          <p className="mt-1.5 max-w-4xl text-[12.5px] leading-5 text-fg-2">
            {body}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-fg-3">
            {copy.stageSeparation}
          </p>
        </div>
      </div>
    </aside>
  );
}
