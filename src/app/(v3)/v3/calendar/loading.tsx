import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

export default function CalendarLoading() {
  return (
    <PartShell title="Календарь">
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="text-sm text-fg-2">Загружаем календарь…</p>
        <SkeletonBlock className="h-11 w-full max-w-xs" />
        <SkeletonBlock className="h-[420px]" />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <SkeletonBlock key={index} className="h-16" />
          ))}
        </div>
      </div>
    </PartShell>
  );
}
