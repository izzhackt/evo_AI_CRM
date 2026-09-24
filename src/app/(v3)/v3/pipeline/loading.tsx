import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/** Каркас доски: строка инструментов, 6 рабочих колонок и рейка «Переданы». */
export default function PipelineLoading() {
  return (
    <PartShell width="board" title="Воронка продаж">
      <div aria-busy="true" className="flex min-h-0 flex-1 flex-col gap-3">
        <p role="status" className="sr-only">Загружаем воронку…</p>
        <div className="flex flex-wrap gap-3">
          <SkeletonBlock className="h-11 w-full max-w-[30rem]" />
          <SkeletonBlock className="hidden h-11 w-56 @2xl:block" />
          <SkeletonBlock className="hidden h-11 w-80 @2xl:block" />
        </div>
        <div className="grid min-h-[320px] flex-1 gap-2 @6xl:grid-cols-[repeat(6,minmax(0,1fr))_44px]">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonBlock key={index} className={index === 0 ? "h-full min-h-40" : "hidden h-full @6xl:block"} />
          ))}
          <SkeletonBlock className="hidden h-full @6xl:block" />
        </div>
      </div>
    </PartShell>
  );
}
