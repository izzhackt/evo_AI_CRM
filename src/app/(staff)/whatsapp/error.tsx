"use client";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import { DICTS, LOCALES } from "@/lib/i18n-data";

export default function WhatsAppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      role="alert"
      data-testid="whatsapp-error"
      className="mx-auto max-w-2xl rounded-card border border-danger/30 bg-surface p-5 shadow-evo sm:p-7"
    >
      <span className="grid h-11 w-11 place-items-center rounded-card bg-danger-weak text-danger">
        <Icon name="alert" size={20} />
      </span>
      {LOCALES.map((locale) => {
        const dict = DICTS[locale];
        return (
          <div
            key={locale}
            lang={locale}
            className={`locale-copy locale-copy--${locale}`}
          >
            <h1 className="mt-4 text-xl font-bold text-fg">
              {dict.whatsappErrorTitle}
            </h1>
            <p className="mt-2 text-sm leading-6 text-fg-2">
              {dict.whatsappErrorHint}
            </p>
            <button type="button" onClick={reset} className={`${btnCls} mt-5`}>
              <Icon name="refresh" size={16} />
              {dict.retry}
            </button>
          </div>
        );
      })}
    </section>
  );
}
