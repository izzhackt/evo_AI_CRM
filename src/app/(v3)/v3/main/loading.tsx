import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

export default function MainLoading() {
  return (
    <PartShell title="Главная">
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="text-sm text-fg-2">Загружаем обзор…</p>
        <SkeletonBlock className="h-14 w-full max-w-md" />
        <div className="mt-2 grid grid-cols-2 gap-3 @4xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonBlock key={index} className="h-20" />
          ))}
        </div>
        <div className="mt-1 grid gap-3 @5xl:grid-cols-[1.15fr_1fr]">
          <SkeletonBlock className="h-72" />
          <SkeletonBlock className="h-72" />
        </div>
        <SkeletonBlock className="h-40" />
      </div>
    </PartShell>
  );
}
