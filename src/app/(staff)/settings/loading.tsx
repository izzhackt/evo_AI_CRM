import { getT } from "@/lib/i18n";

function Skeleton({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-nav bg-surface-3 motion-reduce:animate-none ${className}`}
    />
  );
}

export default async function SettingsLoading() {
  const { t } = await getT();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="settings-loading"
      className="space-y-5"
    >
      <div className="rounded-card border border-border bg-surface px-4 py-4 shadow-evo">
        <h1 className="text-[15px] font-bold text-fg">{t("settingsLoadingTitle")}</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-fg-3">
          {t("settingsLoadingHint")}
        </p>
      </div>

      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-28 shrink-0 rounded-full" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="rounded-card border border-border bg-surface p-5 shadow-evo"
            >
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-3 h-3 w-4/5" />
              <Skeleton className="mt-5 h-10 w-full" />
            </div>
          ))}
        </div>
        <div className="rounded-card border border-border bg-surface p-5 shadow-evo">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-4 h-24 w-full" />
          <Skeleton className="mt-3 h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
