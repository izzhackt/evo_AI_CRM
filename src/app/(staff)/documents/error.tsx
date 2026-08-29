"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { btnCls, btnGhostCls } from "@/components/ui";
import type { Locale } from "@/lib/i18n-data";

const COPY = {
  ru: {
    errorTitle: "Документы временно недоступны",
    errorDescription:
      "PostgreSQL или приватное файловое хранилище не ответило. Старый путь не используется.",
    tryAgain: "Повторить",
    backToQueue: "К очереди",
  },
  ky: {
    errorTitle: "Документтер убактылуу жеткиликсиз",
    errorDescription:
      "PostgreSQL же жеке файл сактагычы жооп берген жок. Эски жол колдонулбайт.",
    tryAgain: "Кайра аракет кылуу",
    backToQueue: "Кезекке кайтуу",
  },
  en: {
    errorTitle: "Documents are temporarily unavailable",
    errorDescription:
      "PostgreSQL or private file storage did not respond. No legacy path is used.",
    tryAgain: "Try again",
    backToQueue: "Back to queue",
  },
} as const;

export default function DocumentsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore<Locale>(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"],
      });
      return () => observer.disconnect();
    },
    () => {
      const htmlLocale = document.documentElement.lang;
      return htmlLocale === "ky" || htmlLocale === "en" || htmlLocale === "ru"
        ? (htmlLocale as Locale)
        : ("ru" as Locale);
    },
    () => "ru" as Locale,
  );

  const copy = COPY[locale];

  return (
    <section
      role="alert"
      className="mx-auto max-w-2xl rounded-card border border-danger/30 bg-surface p-5 shadow-evo sm:p-7"
    >
      <span className="grid h-11 w-11 place-items-center rounded-card bg-danger-weak text-danger">
        <Icon name="alert" size={20} />
      </span>
      <h1 className="mt-4 text-[19px] font-bold text-fg">{copy.errorTitle}</h1>
      <p className="mt-2 text-[13px] leading-6 text-fg-2">
        {copy.errorDescription}
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={reset} className={btnCls}>
          {copy.tryAgain}
        </button>
        <Link href="/documents" className={btnGhostCls}>
          {copy.backToQueue}
        </Link>
      </div>
    </section>
  );
}
