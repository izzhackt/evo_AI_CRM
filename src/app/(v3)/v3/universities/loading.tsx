import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

/** Загрузка каталога — волосяные строки таблицы (Э6), а не плитки карточек. */
export default function UniversitiesLoading() {
  return (
    <PartShell title="Университеты">
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="t-body-compact text-fg-2">Загружаем каталог…</p>
        <SkeletonBlock className="h-11 w-full max-w-3xl" />
        <ul className="border-t border-border">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="flex items-center gap-3 border-b border-border px-3 py-2">
              <SkeletonBlock className="size-12 shrink-0" />
              <SkeletonBlock className="h-4 w-full max-w-md" />
            </li>
          ))}
        </ul>
      </div>
    </PartShell>
  );
}
