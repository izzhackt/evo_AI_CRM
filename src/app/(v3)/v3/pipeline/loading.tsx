import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

export default function PipelineLoading() {
  return (
    <PartShell title="Воронка продаж">
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="text-sm text-fg-2">Загружаем воронку…</p>
        <SkeletonBlock className="h-11 w-full max-w-lg" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <SkeletonBlock key={index} className="h-9 w-full max-w-md" />
          ))}
        </div>
        <SkeletonBlock className="mt-2 h-[480px]" />
      </div>
    </PartShell>
  );
}
