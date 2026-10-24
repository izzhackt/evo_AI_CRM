import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/** Пока читается агент: заготовки по форме страницы любой вкладки — строка вкладок и один блок; число плиток и графиков заранее неизвестно. */
export default function Loading() {
  return (
    <PartShell title="ИИ-агенты" testId="v3-ai-agent-loading">
      <div className="space-y-4" aria-busy="true">
        <SkeletonBlock className="h-11 w-full max-w-xl" />
        <SkeletonBlock className="h-56" />
      </div>
    </PartShell>
  );
}
