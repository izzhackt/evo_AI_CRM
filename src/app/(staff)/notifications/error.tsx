"use client";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import { DICTS, LOCALES } from "@/lib/i18n-data";

export default function NotificationsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      role="alert"
      className="rounded-card border border-danger/30 bg-danger-weak p-5 text-danger"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-nav bg-surface/70">
          <Icon name="alert" size={18} />
        </span>
        {LOCALES.map((locale) => {
          const dict = DICTS[locale];
          return (
            <div
              key={locale}
              lang={locale}
              className={`locale-copy locale-copy--${locale} min-w-0 flex-1`}
            >
              <h2 className="text-md font-bold">{dict.recoveryTitle}</h2>
              <p className="mt-1 text-sm leading-5 opacity-80">{dict.recoveryHint}</p>
              <button type="button" onClick={reset} className={`${btnCls} mt-4`}>
                <Icon name="refresh" size={16} />
                {dict.retry}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
