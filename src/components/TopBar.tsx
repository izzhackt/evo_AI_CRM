"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import type { Locale } from "@/lib/i18n-data";

type Meta = { title: string; hint?: string };

const ADD_ROUTES = new Set(["/sales", "/clients", "/tasks", "/finance", "/calls", "/whatsapp"]);

export function TopBar({
  titles,
  locale,
  addLabel,
  themeLabel,
}: {
  titles: Record<string, Meta>;
  locale: Locale;
  addLabel: string;
  themeLabel: string;
}) {
  const pathname = usePathname();
  const base = `/${pathname.split("/")[1] ?? ""}`;
  const meta = titles[base] ?? titles["/dashboard"];
  const showAdd = ADD_ROUTES.has(base);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-[color-mix(in_oklab,var(--bg)_80%,transparent)] backdrop-blur">
      <div className="flex min-h-[68px] items-center justify-between gap-3 px-5 py-3 sm:px-7">
        <div className="min-w-0">
          <div className="truncate text-[19px] font-bold leading-tight text-fg">{meta.title}</div>
          {meta.hint && <div className="mt-0.5 truncate text-[13px] text-fg-3">{meta.hint}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="hidden sm:block">
            <LangSwitcher current={locale} />
          </div>
          <ThemeToggle label={themeLabel} />
          {showAdd && (
            <Link href={`${base}#add`} className={btnCls}>
              <Icon name="plus" size={16} />
              <span className="hidden sm:inline">{addLabel}</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
