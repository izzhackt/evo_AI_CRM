import { SkeletonBlock } from "@/components/ui";

export default function StudentPortalLoading() {
  return (
    <main
      className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-6 sm:py-10"
      aria-busy="true"
      aria-label="Загружаем кабинет студента"
    >
      <SkeletonBlock className="h-3 w-28" />
      <SkeletonBlock className="mt-3 h-8 w-56 max-w-full" />
      <SkeletonBlock className="mt-3 h-11 w-64 max-w-full" />
      <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SkeletonBlock className="h-80" />
        <SkeletonBlock className="h-80" />
      </div>
      <p role="status" className="mt-5 text-sm text-fg-2">Загружаем данные… Можно перейти в другой раздел.</p>
    </main>
  );
}
