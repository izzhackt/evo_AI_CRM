import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/** Каркас доски поступления: разделы, поиск и фильтры, пять колонок этапов. */
export default function AdmissionsPipelineLoading() {
  return (
    <PartShell width="board" title="Воронка поступления">
      <div aria-busy="true" className="flex min-h-0 flex-1 flex-col gap-3">
        <p role="status" className="sr-only">Загружаем воронку поступления…</p>
        <div className="flex flex-wrap gap-3">
          <SkeletonBlock className="h-11 w-64" />
          <SkeletonBlock className="h-11 w-full max-w-[30rem]" />
          <SkeletonBlock className="hidden h-11 w-48 @2xl:block" />
        </div>
        <div className="grid min-h-[320px] flex-1 justify-start gap-2 @5xl:grid-cols-[repeat(5,minmax(168px,360px))]">
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBlock key={index} className={index === 0 ? "h-full min-h-40" : "hidden h-full @5xl:block"} />
          ))}
        </div>
      </div>
    </PartShell>
  );
}
