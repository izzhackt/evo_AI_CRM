import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/**
 * Загрузка карточки лида или дела — форма будущей страницы: полоса «Этап · Что дальше», ряд вкладок и две
 * колонки «Обзора». Не очередь «Студентов»: её заголовок и строки на пути в карточку говорили бы неправду.
 */
export function ProfileSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4" data-testid="profile-skeleton">
      <p role="status" className="sr-only">Загружаем карточку…</p>
      <div className="grid grid-cols-1 gap-3 border-y border-border py-3 sm:flex sm:gap-8">
        <div className="space-y-1.5"><SkeletonBlock className="h-3 w-12 rounded-nav" /><SkeletonBlock className="h-4 w-48 rounded-nav" /></div>
        <div className="min-w-0 flex-1 space-y-1.5"><SkeletonBlock className="h-3 w-20 rounded-nav" /><SkeletonBlock className="h-4 w-2/3 rounded-nav" /></div>
      </div>
      <div className="flex gap-2 border-b border-border pb-2">
        {["w-20", "w-30", "w-20", "w-24"].map((width, index) => <SkeletonBlock key={index} className={`h-11 rounded-nav ${width}`} />)}
      </div>
      <div className="grid gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="space-y-1.5 border-b border-border py-3">
              <SkeletonBlock className={`h-3.5 rounded-nav ${index % 2 ? "w-5/12" : "w-7/12"}`} />
              <SkeletonBlock className="h-3 w-1/4 rounded-nav" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="space-y-1 border-b border-border py-2.5">
              <SkeletonBlock className="h-3 w-16 rounded-nav" />
              <SkeletonBlock className="h-3.5 w-2/3 rounded-nav" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Страница загрузки карточки: нейтральный заголовок, пока имя человека ещё не прочитано. */
export function ProfileLoadingCard() {
  return <PartShell title="Загрузка" dense><ProfileSkeleton /></PartShell>;
}
