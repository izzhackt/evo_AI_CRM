import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/** Пока читается страница: скелет под заголовком. Он же держит `Suspense` над входом нового вида (`next/dynamic`). */
export default function SettingsLoading() {
  return (
    <PartShell title="Настройки" testId="v3-settings-loading">
      <div aria-busy="true" className="space-y-4">
        <p role="status" className="sr-only">Загружаем настройки…</p>
        <SkeletonBlock className="h-11 w-full max-w-md" />
        <SkeletonBlock className="h-64" />
      </div>
    </PartShell>
  );
}
