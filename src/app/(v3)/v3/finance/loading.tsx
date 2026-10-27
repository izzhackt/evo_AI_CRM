import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/** Пока читается страница: скелет под заголовком. Он же держит `Suspense` над входом нового вида (`next/dynamic`). */
export default function FinanceLoading() {
  return (
    <PartShell title="Финансы" testId="v3-finance-loading">
      <div aria-busy="true" className="space-y-4">
        <p role="status" className="sr-only">Загружаем отчёт…</p>
        <SkeletonBlock className="h-11 w-full max-w-md" />
        <SkeletonBlock className="h-64" />
      </div>
    </PartShell>
  );
}
