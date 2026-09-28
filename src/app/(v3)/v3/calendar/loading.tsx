import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/** Заготовка того же белого листа, что у календаря: строка периода и сетка. */
export default function CalendarLoading() {
  return (
    <PartShell title="Календарь">
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="t-body-compact text-fg-2">Загружаем календарь…</p>
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <div className="p-2">
            <SkeletonBlock className="h-11 w-full max-w-xs" />
          </div>
          <div className="border-t border-border p-2">
            <SkeletonBlock className="h-[420px]" />
          </div>
        </div>
      </div>
    </PartShell>
  );
}
