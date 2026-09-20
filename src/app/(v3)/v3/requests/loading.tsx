import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

export default function RequestsLoading() {
  return (
    <PartShell title="Заявки">
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="text-sm text-fg-2">Загружаем заявки…</p>
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonBlock key={index} className="h-11 w-24" />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonBlock key={index} className="h-24 w-full" />
          ))}
        </div>
      </div>
    </PartShell>
  );
}
