import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

export default function InboxLoading() {
  return (
    <PartShell title="WhatsApp" fill>
      <p role="status" className="text-sm text-fg-2">Загружаем диалоги…</p>
      <div
        aria-busy="true"
        aria-label="Диалоги"
        className="mt-3 grid min-h-0 flex-1 gap-4 @4xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]"
      >
        <div className="flex min-h-0 flex-col gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonBlock key={index} className="h-16" />
          ))}
        </div>
        <SkeletonBlock className="hidden min-h-0 @4xl:block" />
      </div>
    </PartShell>
  );
}
