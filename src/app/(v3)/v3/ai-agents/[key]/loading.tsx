import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/** Пока читается агент: заготовки по форме страницы — шапка, полоса показателей, график. */
export default function Loading() {
  return (
    <PartShell title="ИИ-агенты" testId="v3-ai-agent-loading">
      <div className="space-y-4" aria-busy="true">
        <SkeletonBlock className="h-8 w-64" />
        <SkeletonBlock className="h-11 w-full max-w-xl" />
        <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <SkeletonBlock key={index} className="h-20" />)}
        </div>
        <SkeletonBlock className="h-56" />
      </div>
    </PartShell>
  );
}
