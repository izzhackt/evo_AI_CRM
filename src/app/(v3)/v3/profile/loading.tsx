import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

export default function ProfileLoading() {
  return (
    <PartShell title="Поступление">
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="text-sm text-fg-2">Загружаем рабочий список…</p>
        <SkeletonBlock className="h-24 w-full sm:h-14" />
        <div className="divide-y divide-border rounded-card border border-border bg-surface">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="grid gap-3 p-5 sm:grid-cols-[minmax(160px,1fr)_minmax(200px,1.25fr)]">
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
            </div>
          ))}
        </div>
      </div>
    </PartShell>
  );
}
