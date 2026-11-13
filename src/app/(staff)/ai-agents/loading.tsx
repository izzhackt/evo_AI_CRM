import { SkeletonBlock } from "@/components/ui";
import { PageShell } from "@/components/kit";

/**
 * Пока читается хаб: заготовки по форме новой главной — тёмная полоса «Сейчас» и первые карточки агентов в той же сетке
 * (2 / 3 / 5 колонок), что и список «Агенты».
 */
export default function Loading() {
  return (
    <PageShell title="ИИ-агенты" testId="v3-ai-agents-loading">
      <div className="space-y-4" aria-busy="true">
        <SkeletonBlock className="h-[100px]" />
        <div className="@container">
          <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-3 @5xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => <SkeletonBlock key={index} className="h-72" />)}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
