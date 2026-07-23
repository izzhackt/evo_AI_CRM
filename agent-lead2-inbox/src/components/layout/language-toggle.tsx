"use client";

import { Languages } from "lucide-react";

import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

const OPTIONS: Array<{ locale: Locale; short: string }> = [
  { locale: "en", short: "EN" },
  { locale: "ru", short: "RU" },
];

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLanguage();

  return (
    <div
      className={cn(
        "inline-flex h-10 items-center gap-1 rounded-md border border-border bg-muted/35 p-1",
        className,
      )}
      role="group"
      aria-label={t("language.toggleLabel")}
      title={t("language.toggleLabel")}
    >
      <Languages className="ml-1 size-4 text-muted-foreground" />
      {OPTIONS.map((option) => {
        const active = option.locale === locale;
        return (
          <button
            key={option.locale}
            type="button"
            onClick={() => setLocale(option.locale)}
            aria-pressed={active}
            className={cn(
              "flex h-7 min-w-8 items-center justify-center rounded px-2 text-xs font-semibold transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            )}
          >
            {option.short}
          </button>
        );
      })}
    </div>
  );
}
