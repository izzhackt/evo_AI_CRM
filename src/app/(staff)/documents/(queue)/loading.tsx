import { getLocale } from "@/lib/i18n";

const COPY = {
  ru: {
    loading: "Загружаем приватные документы…",
    loadingHint: "Читаем последние версии из PostgreSQL.",
  },
  ky: {
    loading: "Жеке документтер жүктөлүүдө…",
    loadingHint: "PostgreSQL базасынан акыркы версиялар окулууда.",
  },
  en: {
    loading: "Loading private documents…",
    loadingHint: "Reading the latest versions from PostgreSQL.",
  },
} as const;

function SkeletonBlock({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-nav bg-surface-3 motion-reduce:animate-none ${className}`}
    />
  );
}

export default async function DocumentsLoading() {
  const locale = await getLocale();
  const copy = COPY[locale];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-5"
    >
      <div className="rounded-card border border-border bg-surface px-4 py-4 shadow-evo">
        <h1 className="text-md font-bold text-fg">{copy.loading}</h1>
        <p className="mt-1 text-sm text-fg-3">{copy.loadingHint}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="rounded-card border border-border bg-surface p-4 shadow-evo"
          >
            <SkeletonBlock className="h-3 w-2/3" />
            <SkeletonBlock className="mt-3 h-7 w-1/3" />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonBlock key={index} className="h-10 w-24 rounded-full" />
        ))}
      </div>

      <div className="space-y-3 md:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="rounded-card border border-border bg-surface p-4 shadow-evo"
          >
            <SkeletonBlock className="h-4 w-2/3" />
            <SkeletonBlock className="mt-2 h-3 w-1/2" />
            <SkeletonBlock className="mt-4 h-16 w-full" />
          </div>
        ))}
      </div>

      <div className="hidden rounded-card border border-border bg-surface p-5 shadow-evo md:block">
        <SkeletonBlock className="h-10 w-full" />
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonBlock key={index} className="mt-3 h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
