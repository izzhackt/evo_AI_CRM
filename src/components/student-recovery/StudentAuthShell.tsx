import type { ReactNode } from "react";

import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import type { Locale } from "@/lib/i18n-data";
import type { Theme } from "@/lib/theme";

/** The same card as the Student sign-in on /login, for the recovery steps. */
export function StudentAuthShell({
  locale,
  theme,
  titleId,
  title,
  intro,
  children,
}: Readonly<{
  locale: Locale;
  theme: Theme;
  titleId: string;
  title: string;
  intro?: string;
  children: ReactNode;
}>) {
  return (
    <main className="flex min-h-dvh flex-col bg-bg px-4 py-6 sm:px-6">
      <div className="flex min-h-11 items-center justify-end gap-3">
        <LangSwitcher current={locale} />
        <ThemeToggle locale={locale} initialTheme={theme} />
      </div>

      <div className="flex flex-1 items-center justify-center py-8 sm:py-12">
        <section
          aria-labelledby={titleId}
          className="w-full max-w-[420px] rounded-card border border-border bg-surface p-6 sm:p-8"
        >
          <div data-theme="light" className="mb-6 w-fit rounded-ctl bg-surface p-4">
            <EvoLogo width={156} />
          </div>
          <h1
            id={titleId}
            className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-fg"
          >
            {title}
          </h1>
          {intro ? <p className="mt-2 text-sm leading-6 text-fg-2">{intro}</p> : null}
          {/* Without a fixed intro the body owns its first line under the title. */}
          <div className={intro ? "mt-6" : "mt-2"}>{children}</div>
        </section>
      </div>
    </main>
  );
}
