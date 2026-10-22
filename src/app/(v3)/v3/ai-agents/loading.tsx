import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/** Пока читается хаб: полоса показателей и первые карточки. */
export default function Loading() {
  return (
    <PartShell title="ИИ-агенты" testId="v3-ai-agents-loading">
      <div className="space-y-5" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-20" />)}
        </div>
        <div className="grid gap-3 @3xl:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-40" />)}
        </div>
      </div>
    </PartShell>
  );
}
