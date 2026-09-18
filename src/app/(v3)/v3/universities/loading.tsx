import { SkeletonBlock } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";

export default function UniversitiesLoading() {
  return (
    <PartShell title="Университеты">
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="text-sm text-fg-2">Загружаем каталог…</p>
        <SkeletonBlock className="h-11 w-full" />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index}>
              <SkeletonBlock className="h-52" />
            </li>
          ))}
        </ul>
      </div>
    </PartShell>
  );
}
