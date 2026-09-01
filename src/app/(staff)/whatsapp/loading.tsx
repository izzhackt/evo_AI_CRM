import { getT } from "@/lib/i18n";

function Skeleton({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-nav bg-surface-3 motion-reduce:animate-none ${className}`}
    />
  );
}

export default async function WhatsAppLoading() {
  const { t } = await getT();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="whatsapp-loading"
      className="space-y-4"
    >
      <div className="rounded-card border border-border bg-surface px-4 py-4 shadow-evo">
        <h1 className="text-md font-bold text-fg">{t("whatsappLoadingTitle")}</h1>
        <p className="max-w-[56ch] mt-1 text-sm leading-5 text-fg-3">
          {t("whatsappLoadingHint")}
        </p>
      </div>

      <div className="flex h-[calc(100dvh-310px)] min-h-[500px] overflow-hidden rounded-card border border-border bg-surface shadow-evo">
        <div className="w-full border-border md:w-[336px] md:shrink-0 md:border-r">
          <div className="border-b border-border p-4">
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-1 p-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-1 py-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="hidden flex-1 p-6 md:block">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="mt-6 h-20 w-2/3" />
          <Skeleton className="ml-auto mt-3 h-20 w-2/3" />
        </div>
      </div>
    </div>
  );
}
