import { SkeletonBlock } from "@/components/ui";
import { PageShell } from "@/components/kit";

/** Каркас доски поступления: разделы, поиск и фильтры, пять колонок этапов. */
export default function AdmissionsPipelineLoading() {
  return (
    <PageShell title="Воронка поступления">
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="sr-only">Загружаем воронку поступления…</p>
        <div className="flex flex-wrap gap-3">
          <SkeletonBlock className="h-11 w-64" />
          <SkeletonBlock className="h-11 w-full max-w-[30rem]" />
          <SkeletonBlock className="hidden h-11 w-48 @2xl:block" />
        </div>
        <div className="grid min-h-[320px] flex-1 justify-start gap-2 @[43.75rem]:grid-cols-[repeat(5,minmax(168px,1fr))]">
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBlock key={index} className={index === 0 ? "h-full min-h-40" : "hidden h-full @[43.75rem]:block"} />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
